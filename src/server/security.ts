import { getDb } from "./db";
import { getEnv } from "./env";

export class SecurityViolationError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly retryAfterSeconds?: number;

  constructor(code: string, message: string, status = 403, retryAfterSeconds?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Security headers applied to all HTTP responses to harden against XSS, clickjacking,
 * MIME sniffing, cross-origin leaks, and automated scanner exploitation.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data:",
    "connect-src 'self' https://huggingface.co https://*.hf.co https://*.huggingface.co",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

let securityTablesInitialized = false;

function ensureSecurityTables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_rate_limits (
      bucket_key TEXT PRIMARY KEY,
      hit_count INTEGER NOT NULL DEFAULT 0,
      window_start_ms INTEGER NOT NULL,
      blocked_until_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS security_auth_lockouts (
      identifier TEXT PRIMARY KEY,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      last_failed_ms INTEGER NOT NULL DEFAULT 0,
      locked_until_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS security_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      actor_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );
  `);
  securityTablesInitialized = true;
}

export function resetSecurityTablesForTesting(): void {
  securityTablesInitialized = false;
  ensureSecurityTables();
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim().slice(0, 64);
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim().slice(0, 64);
  }
  return "127.0.0.1";
}

export function logSecurityEvent(params: {
  eventType: string;
  ipAddress: string;
  actorId?: string | null;
  details?: string;
}): void {
  try {
    ensureSecurityTables();
    const db = getDb();
    db.prepare(
      `INSERT INTO security_audit_logs (event_type, ip_address, actor_id, details, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      params.eventType.slice(0, 64),
      params.ipAddress.slice(0, 64),
      params.actorId ?? null,
      params.details ? params.details.slice(0, 500) : null,
      new Date().toISOString()
    );
  } catch {
    // Non-fatal if DB is closing
  }
}

/**
 * Sliding-window rate limiter with automatic ban escalation.
 */
export function enforceRateLimit(params: {
  bucket: string;
  key: string;
  maxRequests: number;
  windowMs: number;
  blockDurationMs?: number;
}): void {
  ensureSecurityTables();
  const db = getDb();
  const now = Date.now();
  const bucketKey = `${params.bucket}:${params.key}`;

  const row = db
    .prepare("SELECT * FROM security_rate_limits WHERE bucket_key = ?")
    .get(bucketKey) as
    | {
        bucket_key: string;
        hit_count: number;
        window_start_ms: number;
        blocked_until_ms: number;
      }
    | undefined;

  if (row && row.blocked_until_ms > now) {
    const retrySec = Math.ceil((row.blocked_until_ms - now) / 1000);
    throw new SecurityViolationError(
      "RATE_LIMIT_EXCEEDED",
      `Too many requests. Please wait ${retrySec} seconds before retrying.`,
      429,
      retrySec
    );
  }

  if (!row || now - row.window_start_ms >= params.windowMs) {
    db.prepare(
      `INSERT INTO security_rate_limits (bucket_key, hit_count, window_start_ms, blocked_until_ms)
       VALUES (?, 1, ?, 0)
       ON CONFLICT(bucket_key) DO UPDATE SET
         hit_count = 1,
         window_start_ms = excluded.window_start_ms,
         blocked_until_ms = 0`
    ).run(bucketKey, now);
    return;
  }

  const nextHits = row.hit_count + 1;
  if (nextHits > params.maxRequests) {
    const blockMs = params.blockDurationMs ?? params.windowMs;
    const blockedUntil = now + blockMs;
    db.prepare(
      "UPDATE security_rate_limits SET hit_count = ?, blocked_until_ms = ? WHERE bucket_key = ?"
    ).run(nextHits, blockedUntil, bucketKey);

    const retrySec = Math.ceil(blockMs / 1000);
    throw new SecurityViolationError(
      "RATE_LIMIT_EXCEEDED",
      `Rate limit exceeded. Temporarily blocked for ${retrySec} seconds.`,
      429,
      retrySec
    );
  }

  db.prepare("UPDATE security_rate_limits SET hit_count = ? WHERE bucket_key = ?").run(
    nextHits,
    bucketKey
  );
}

/**
 * Progressive exponential brute-force lockout for authentication targets (email and IP).
 * Locks after 5 consecutive failures for 15 minutes (and escalates on repeat failures).
 */
const MAX_FAILED_AUTH_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export function checkAuthLockout(identifier: string): void {
  ensureSecurityTables();
  const db = getDb();
  const now = Date.now();
  const key = identifier.trim().toLowerCase();

  const row = db
    .prepare("SELECT * FROM security_auth_lockouts WHERE identifier = ?")
    .get(key) as
    | {
        identifier: string;
        failed_attempts: number;
        last_failed_ms: number;
        locked_until_ms: number;
      }
    | undefined;

  if (row && row.locked_until_ms > now) {
    const retrySec = Math.ceil((row.locked_until_ms - now) / 1000);
    throw new SecurityViolationError(
      "ACCOUNT_TEMPORARILY_LOCKED",
      `Too many failed authentication attempts. Locked for ${retrySec} seconds to prevent brute-force attacks.`,
      429,
      retrySec
    );
  }
}

export function recordFailedAuthAttempt(identifier: string, ipAddress = "127.0.0.1"): void {
  ensureSecurityTables();
  const db = getDb();
  const now = Date.now();
  const key = identifier.trim().toLowerCase();

  const row = db
    .prepare("SELECT * FROM security_auth_lockouts WHERE identifier = ?")
    .get(key) as
    | {
        identifier: string;
        failed_attempts: number;
        last_failed_ms: number;
        locked_until_ms: number;
      }
    | undefined;

  // Reset counter if last failure was more than 30 minutes ago
  const recentAttempts =
    row && now - row.last_failed_ms < 30 * 60 * 1000 ? row.failed_attempts + 1 : 1;

  let lockedUntil = 0;
  if (recentAttempts >= MAX_FAILED_AUTH_ATTEMPTS) {
    const multiplier = Math.min(8, Math.pow(2, recentAttempts - MAX_FAILED_AUTH_ATTEMPTS));
    lockedUntil = now + BASE_LOCKOUT_MS * multiplier;
    logSecurityEvent({
      eventType: "BRUTE_FORCE_LOCKOUT",
      ipAddress,
      details: `Locked identifier ${key} after ${recentAttempts} failed attempts`,
    });
  }

  db.prepare(
    `INSERT INTO security_auth_lockouts (identifier, failed_attempts, last_failed_ms, locked_until_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(identifier) DO UPDATE SET
       failed_attempts = excluded.failed_attempts,
       last_failed_ms = excluded.last_failed_ms,
       locked_until_ms = excluded.locked_until_ms`
  ).run(key, recentAttempts, now, lockedUntil);
}

export function clearAuthLockout(identifier: string): void {
  ensureSecurityTables();
  const db = getDb();
  const key = identifier.trim().toLowerCase();
  db.prepare("DELETE FROM security_auth_lockouts WHERE identifier = ?").run(key);
}

/**
 * Verifies CSRF Origin / Referer on state-changing requests when cookie authentication is used.
 * Exempts Apple OAuth `form_post` callback which originates from `https://appleid.apple.com`.
 */
export function verifyCsrfOrigin(req: Request, pathname: string): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return;
  }

  // Apple OIDC form_post callback legitimately posts from appleid.apple.com and is protected by single-use OAuth state + nonce
  if (pathname === "/api/auth/callback/apple") {
    return;
  }

  const origin = req.headers.get("origin");
  if (!origin) {
    // Same-origin fetch or non-browser test client without Origin header
    return;
  }

  const reqUrl = new URL(req.url, "http://localhost:5173");
  const allowedHosts = new Set<string>([
    reqUrl.host.toLowerCase(),
    "localhost:5173",
    "127.0.0.1:5173",
    "localhost:8888",
  ]);

  const configuredBase = getEnv("APP_BASE_URL") || getEnv("URL");
  if (configuredBase) {
    try {
      allowedHosts.add(new URL(configuredBase).host.toLowerCase());
    } catch {
      // ignore invalid URL
    }
  }

  try {
    const originHost = new URL(origin).host.toLowerCase();
    if (!allowedHosts.has(originHost)) {
      throw new SecurityViolationError(
        "CSRF_ORIGIN_MISMATCH",
        `Cross-origin state-changing request from '${origin}' was blocked.`,
        403
      );
    }
  } catch (err) {
    if (err instanceof SecurityViolationError) throw err;
    throw new SecurityViolationError(
      "CSRF_ORIGIN_INVALID",
      "Malformed Origin header on state-changing request.",
      403
    );
  }
}

/**
 * Inspects binary magic bytes of uploaded audio files to prevent polyglot / disguised
 * executable / HTML / script uploads (e.g., renaming a malicious script to .mp3 or .wav).
 */
export function verifyAudioMagicBytes(bytes: Uint8Array): {
  valid: boolean;
  detectedFormat?: string;
  reason?: string;
} {
  if (bytes.byteLength < 12) {
    return { valid: false, reason: "Audio file is too small to contain valid audio headers." };
  }

  // Reject HTML / XML / Script / ELF / MZ Windows PE / Shell shebang payloads disguised as audio
  const headAscii = Buffer.from(bytes.subarray(0, 64))
    .toString("utf8")
    .trimStart()
    .toLowerCase();

  if (
    headAscii.startsWith("<!doctype") ||
    headAscii.startsWith("<html") ||
    headAscii.startsWith("<script") ||
    headAscii.startsWith("<?xml") ||
    headAscii.startsWith("<svg") ||
    headAscii.startsWith("#!/") ||
    (bytes[0] === 0x4d && bytes[1] === 0x5a) || // Windows MZ executable
    (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) // Linux ELF binary
  ) {
    return {
      valid: false,
      reason: "Executable or script payload detected in uploaded file.",
    };
  }

  // 1. WAV: "RIFF" .... "WAVE"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return { valid: true, detectedFormat: "wav" };
  }

  // 2. OGG: "OggS"
  if (
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return { valid: true, detectedFormat: "ogg" };
  }

  // 3. WebM / Matroska: 0x1A 0x45 0xDF 0xA3
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return { valid: true, detectedFormat: "webm" };
  }

  // 4. MP3: "ID3" tag or MPEG audio frame sync (0xFF followed by 0xE0..0xFF)
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return { valid: true, detectedFormat: "mp3" };
  }

  // 5. MP4 / M4A: "ftyp" at offset 4
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return { valid: true, detectedFormat: "m4a" };
  }

  // 6. FLAC: "fLaC"
  if (
    bytes[0] === 0x66 &&
    bytes[1] === 0x4c &&
    bytes[2] === 0x61 &&
    bytes[3] === 0x43
  ) {
    return { valid: true, detectedFormat: "flac" };
  }

  return {
    valid: false,
    reason:
      "File binary signature does not match any valid audio container (WAV, MP3, M4A, WebM, OGG).",
  };
}

/**
 * Defends against autonomous AI agent prompt-injection attacks embedded inside transcripts or titles.
 * Strips system-instruction override markers and wraps untrusted user transcripts in a strict data boundary.
 */
export function sanitizeAgainstPromptInjection(input: string): {
  sanitized: string;
  flaggedPatterns: string[];
} {
  const flaggedPatterns: string[] = [];
  let text = input.replace(/\0/g, ""); // Strip null bytes

  const injectionPatterns: Array<{ name: string; regex: RegExp }> = [
    {
      name: "ignore_previous_instructions",
      regex: /ignore\s+(?:all\s+)?(?:previous|prior|above|system)\s+(?:instructions|prompts|rules|directions)/gi,
    },
    {
      name: "system_role_override",
      regex: /(?:^|\n)\s*(?:system|developer|assistant)\s*:\s*(?:you\s+are\s+now|override|disregard|reveal|exfiltrate)/gi,
    },
    {
      name: "special_llm_delimiters",
      regex: /(<\|im_start\|>|<\|im_end\|>|<\|system\|>|<\|endoftext\|>|\[INST\]|\[\/INST\]|<<SYS>>|<\/SYS>>)/gi,
    },
    {
      name: "secret_exfiltration_attempt",
      regex: /(?:print|output|reveal|dump|exfiltrate|send)\s+(?:all\s+)?(?:environment\s+variables|api\s+keys|process\.env|netlify\.env|system\s+prompt|session\s+tokens)/gi,
    },
  ];

  for (const pat of injectionPatterns) {
    if (pat.regex.test(text)) {
      flaggedPatterns.push(pat.name);
      text = text.replace(pat.regex, "[REDACTED_PROMPT_INJECTION_ATTEMPT]");
    }
  }

  return { sanitized: text, flaggedPatterns };
}

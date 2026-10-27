import crypto from "node:crypto";
import { getDb, generateId } from "./db";
import { getEnv, getAppBaseUrl } from "./env";
import type { AuthProviderType, LinkedIdentity, UserProfile, Workspace } from "../shared/types";
import { normalizeBcp47Tag } from "../shared/languages";

export const SESSION_COOKIE_NAME = "memoir_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const OAUTH_STATE_TTL_MS = 1000 * 60 * 10; // 10 minutes

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, "hex");
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function isApplePrivateRelayEmail(
  email: string | null | undefined,
  claimFlag?: boolean | string
): boolean {
  if (claimFlag === true || claimFlag === "true") return true;
  if (!email) return false;
  return email.toLowerCase().endsWith("@privaterelay.appleid.com");
}

export interface OAuthProviderStatus {
  google: {
    configured: boolean;
    callbackUrl: string;
    missingVars: string[];
  };
  apple: {
    configured: boolean;
    callbackUrl: string;
    missingVars: string[];
  };
}

export function getOAuthProviderStatus(reqUrl?: string): OAuthProviderStatus {
  const baseUrl = getAppBaseUrl(reqUrl);
  const googleMissing: string[] = [];
  if (!getEnv("GOOGLE_CLIENT_ID")) googleMissing.push("GOOGLE_CLIENT_ID");
  if (!getEnv("GOOGLE_CLIENT_SECRET")) googleMissing.push("GOOGLE_CLIENT_SECRET");

  const appleMissing: string[] = [];
  if (!getEnv("APPLE_CLIENT_ID")) appleMissing.push("APPLE_CLIENT_ID");
  if (!getEnv("APPLE_TEAM_ID")) appleMissing.push("APPLE_TEAM_ID");
  if (!getEnv("APPLE_KEY_ID")) appleMissing.push("APPLE_KEY_ID");
  if (!getEnv("APPLE_PRIVATE_KEY")) appleMissing.push("APPLE_PRIVATE_KEY");

  return {
    google: {
      configured: googleMissing.length === 0,
      callbackUrl: `${baseUrl}/api/auth/callback/google`,
      missingVars: googleMissing,
    },
    apple: {
      configured: appleMissing.length === 0,
      callbackUrl: `${baseUrl}/api/auth/callback/apple`,
      missingVars: appleMissing,
    },
  };
}

function mapUserRow(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.id),
    email: row.email ? String(row.email) : null,
    emailVerified: Boolean(row.email_verified),
    isPrivateRelayEmail: Boolean(row.is_private_relay_email),
    displayName: String(row.display_name),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    uiLanguage: String(row.ui_language || "en"),
    defaultSpokenLanguage: String(row.default_spoken_language || "auto"),
    defaultSummaryLanguage: String(row.default_summary_language || "en"),
    defaultInsightsLanguage: String(row.default_insights_language || "en"),
    preferredTranscriptionProvider: (row.preferred_transcription_provider as UserProfile["preferredTranscriptionProvider"]) || "auto",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getUserById(userId: string): UserProfile | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapUserRow(row) : null;
}

export function getUserIdentities(userId: string): LinkedIdentity[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM user_identities WHERE user_id = ? ORDER BY created_at ASC")
    .all(userId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    provider: r.provider as AuthProviderType,
    providerUserId: String(r.provider_user_id),
    providerEmail: r.provider_email ? String(r.provider_email) : null,
    emailVerified: Boolean(r.email_verified),
    isPrivateRelay: Boolean(r.is_private_relay),
    createdAt: String(r.created_at),
    lastSignInAt: String(r.last_sign_in_at),
  }));
}

export function ensureDefaultWorkspaceForUser(userId: string, displayName: string): Workspace {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT w.*, wm.role
       FROM workspaces w
       JOIN workspace_members wm ON wm.workspace_id = w.id
       WHERE wm.user_id = ?
       ORDER BY w.created_at ASC
       LIMIT 1`
    )
    .get(userId) as Record<string, unknown> | undefined;

  if (existing) {
    return {
      id: String(existing.id),
      name: String(existing.name),
      slug: String(existing.slug),
      ownerId: String(existing.owner_id),
      role: (existing.role as Workspace["role"]) || "owner",
      createdAt: String(existing.created_at),
    };
  }

  const now = new Date().toISOString();
  const wsId = generateId("ws");
  const slug = `ws-${userId.slice(-8)}-${crypto.randomBytes(3).toString("hex")}`;
  const wsName = `${displayName}'s Workspace`;

  db.prepare(
    "INSERT INTO workspaces (id, name, slug, owner_id, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(wsId, wsName, slug, userId, now);

  db.prepare(
    "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)"
  ).run(wsId, userId, now);

  return {
    id: wsId,
    name: wsName,
    slug,
    ownerId: userId,
    role: "owner",
    createdAt: now,
  };
}

export function createSession(
  userId: string,
  meta?: { ipAddress?: string | null; userAgent?: string | null }
): { token: string; expiresAt: string } {
  const db = getDb();
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS).toISOString();

  db.prepare(
    `INSERT INTO auth_sessions (id, token_hash, user_id, expires_at, ip_address, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    generateId("sess"),
    tokenHash,
    userId,
    expiresAt,
    meta?.ipAddress ?? null,
    meta?.userAgent ?? null,
    now.toISOString()
  );

  return { token: rawToken, expiresAt };
}

export function revokeSessionByToken(rawToken: string): void {
  const db = getDb();
  const tokenHash = hashToken(rawToken);
  db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
}

export function parseSessionTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");
  for (const part of cookies) {
    const [k, ...vParts] = part.trim().split("=");
    if (k === SESSION_COOKIE_NAME) {
      return decodeURIComponent(vParts.join("="));
    }
  }
  return null;
}

export function createSessionCookieHeader(token: string, expiresAt: string, reqUrl?: string): string {
  const isSecure = reqUrl ? reqUrl.startsWith("https://") : false;
  const expiresDate = new Date(expiresAt).toUTCString();
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresDate}`,
  ];
  if (isSecure) parts.push("Secure");
  return parts.join("; ");
}

export function createClearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function getAuthenticatedUser(req: Request): {
  user: UserProfile;
  workspace: Workspace;
  sessionToken: string;
} | null {
  const rawToken = parseSessionTokenFromRequest(req);
  if (!rawToken) return null;

  const db = getDb();
  const tokenHash = hashToken(rawToken);
  const sessionRow = db
    .prepare("SELECT * FROM auth_sessions WHERE token_hash = ?")
    .get(tokenHash) as Record<string, unknown> | undefined;

  if (!sessionRow) return null;

  const expiresAt = new Date(String(sessionRow.expires_at)).getTime();
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(String(sessionRow.id));
    return null;
  }

  const user = getUserById(String(sessionRow.user_id));
  if (!user) return null;

  const workspace = ensureDefaultWorkspaceForUser(user.id, user.displayName);
  return { user, workspace, sessionToken: rawToken };
}

export function registerWithEmailPassword(input: {
  email: string;
  password: string;
  displayName: string;
  uiLanguage?: string;
}): { user: UserProfile; workspace: Workspace; session: { token: string; expiresAt: string } } {
  const db = getDb();
  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = db
    .prepare("SELECT id FROM users WHERE lower(email) = ?")
    .get(normalizedEmail) as { id: string } | undefined;

  if (existing) {
    throw new AuthError("EMAIL_ALREADY_EXISTS", "An account with this email address already exists.", 409);
  }

  const now = new Date().toISOString();
  const userId = generateId("usr");
  const passwordHash = hashPassword(input.password);
  const uiLang = normalizeBcp47Tag(input.uiLanguage || "en");
  const safeUiLang = uiLang === "und" || uiLang === "auto" ? "en" : uiLang;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO users (
        id, email, email_verified, is_private_relay_email, password_hash,
        display_name, ui_language, default_spoken_language, default_summary_language,
        default_insights_language, preferred_transcription_provider, created_at, updated_at
      ) VALUES (?, ?, 1, 0, ?, ?, ?, 'auto', ?, ?, 'auto', ?, ?)`
    ).run(
      userId,
      normalizedEmail,
      passwordHash,
      input.displayName.trim(),
      safeUiLang,
      safeUiLang,
      safeUiLang,
      now,
      now
    );

    db.prepare(
      `INSERT INTO user_identities (
        id, user_id, provider, provider_user_id, provider_email,
        email_verified, is_private_relay, created_at, last_sign_in_at
      ) VALUES (?, ?, 'email', ?, ?, 1, 0, ?, ?)`
    ).run(generateId("ident"), userId, normalizedEmail, normalizedEmail, now, now);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const user = getUserById(userId)!;
  const workspace = ensureDefaultWorkspaceForUser(user.id, user.displayName);
  const session = createSession(user.id);
  return { user, workspace, session };
}

export function signInWithEmailPassword(input: {
  email: string;
  password: string;
}): { user: UserProfile; workspace: Workspace; session: { token: string; expiresAt: string } } {
  const db = getDb();
  const normalizedEmail = input.email.trim().toLowerCase();
  const row = db
    .prepare("SELECT * FROM users WHERE lower(email) = ?")
    .get(normalizedEmail) as Record<string, unknown> | undefined;

  if (!row || !row.password_hash) {
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email address or password.", 401);
  }

  const valid = verifyPassword(input.password, String(row.password_hash));
  if (!valid) {
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email address or password.", 401);
  }

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE user_identities SET last_sign_in_at = ? WHERE user_id = ? AND provider = 'email'"
  ).run(now, String(row.id));

  const user = mapUserRow(row);
  const workspace = ensureDefaultWorkspaceForUser(user.id, user.displayName);
  const session = createSession(user.id);
  return { user, workspace, session };
}

export function createMagicLinkToken(input: {
  email: string;
  uiLanguage?: string;
}): { rawToken: string; expiresAt: string } {
  const db = getDb();
  const normalizedEmail = input.email.trim().toLowerCase();
  const rawToken = crypto.randomBytes(24).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 15).toISOString();

  const existingUser = db
    .prepare("SELECT id FROM users WHERE lower(email) = ?")
    .get(normalizedEmail) as { id: string } | undefined;

  db.prepare(
    `INSERT INTO verification_tokens (
      id, token_hash, user_id, email, token_type, metadata_json, expires_at, created_at
    ) VALUES (?, ?, ?, ?, 'magic_link', ?, ?, ?)`
  ).run(
    generateId("vtok"),
    tokenHash,
    existingUser?.id ?? null,
    normalizedEmail,
    JSON.stringify({ uiLanguage: input.uiLanguage || "en" }),
    expiresAt,
    now.toISOString()
  );

  return { rawToken, expiresAt };
}

export function verifyMagicLinkToken(rawToken: string): {
  user: UserProfile;
  workspace: Workspace;
  session: { token: string; expiresAt: string };
} {
  const db = getDb();
  const tokenHash = hashToken(rawToken);
  const row = db
    .prepare("SELECT * FROM verification_tokens WHERE token_hash = ? AND token_type = 'magic_link'")
    .get(tokenHash) as Record<string, unknown> | undefined;

  if (!row || row.used_at) {
    throw new AuthError("INVALID_TOKEN", "This sign-in link is invalid or has already been used.", 400);
  }

  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    throw new AuthError("EXPIRED_TOKEN", "This sign-in link has expired. Please request a new one.", 400);
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE verification_tokens SET used_at = ? WHERE id = ?").run(now, String(row.id));

  const email = String(row.email).toLowerCase();
  const meta = JSON.parse(String(row.metadata_json || "{}")) as { uiLanguage?: string };
  const uiLang = normalizeBcp47Tag(meta.uiLanguage || "en");
  const safeUiLang = uiLang === "und" || uiLang === "auto" ? "en" : uiLang;

  let existingUser = db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(email) as
    | Record<string, unknown>
    | undefined;

  if (!existingUser) {
    const userId = generateId("usr");
    const displayName = email.split("@")[0];
    db.prepare(
      `INSERT INTO users (
        id, email, email_verified, is_private_relay_email, display_name,
        ui_language, default_spoken_language, default_summary_language,
        default_insights_language, preferred_transcription_provider, created_at, updated_at
      ) VALUES (?, ?, 1, 0, ?, ?, 'auto', ?, ?, 'auto', ?, ?)`
    ).run(userId, email, displayName, safeUiLang, safeUiLang, safeUiLang, now, now);

    db.prepare(
      `INSERT INTO user_identities (
        id, user_id, provider, provider_user_id, provider_email,
        email_verified, is_private_relay, created_at, last_sign_in_at
      ) VALUES (?, ?, 'magic_link', ?, ?, 1, 0, ?, ?)`
    ).run(generateId("ident"), userId, email, email, now, now);

    existingUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Record<string, unknown>;
  } else {
    db.prepare("UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?").run(
      now,
      String(existingUser.id)
    );
  }

  const user = mapUserRow(existingUser);
  const workspace = ensureDefaultWorkspaceForUser(user.id, user.displayName);
  const session = createSession(user.id);
  return { user, workspace, session };
}

/**
 * Resolves or links an OAuth identity (Google or Apple) safely.
 *
 * Security invariants (Section 12.C & 12.D):
 * 1. Identities are keyed by (provider, providerUserId / sub), never by email alone.
 * 2. Repeat Apple sign-ins where email/name are omitted still succeed because lookup uses (provider, providerUserId).
 * 3. If an unauthenticated OAuth sign-in returns an email that matches an existing user account
 *    which does NOT have this provider linked, we NEVER auto-merge accounts by email.
 *    Instead, we throw ACCOUNT_LINK_PROOF_REQUIRED so the user must authenticate to their
 *    existing account first and initiate linking from an authenticated session.
 * 4. If `authenticatedUserIdForLinking` is provided (user is signed in and clicked "Link Provider"),
 *    we verify the identity isn't bound to a different user and attach it to `authenticatedUserIdForLinking`.
 */
export function resolveOrLinkOAuthIdentity(params: {
  provider: "google" | "apple";
  providerUserId: string;
  email?: string | null;
  emailVerified?: boolean;
  isPrivateRelay?: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
  uiLanguage?: string;
  authenticatedUserIdForLinking?: string | null;
}): { user: UserProfile; workspace: Workspace; session: { token: string; expiresAt: string } } {
  const db = getDb();
  const now = new Date().toISOString();
  const normalizedEmail = params.email ? params.email.trim().toLowerCase() : null;
  const isPrivateRelay = isApplePrivateRelayEmail(normalizedEmail, params.isPrivateRelay);
  const emailVerified = Boolean(params.emailVerified);

  if (!params.providerUserId || !params.providerUserId.trim()) {
    throw new AuthError("INVALID_PROVIDER_CLAIMS", "Missing stable subject identifier (sub) from provider.", 400);
  }

  const existingIdentity = db
    .prepare("SELECT * FROM user_identities WHERE provider = ? AND provider_user_id = ?")
    .get(params.provider, params.providerUserId) as Record<string, unknown> | undefined;

  // Case 1: Authenticated user explicitly linking a provider
  if (params.authenticatedUserIdForLinking) {
    const targetUser = getUserById(params.authenticatedUserIdForLinking);
    if (!targetUser) {
      throw new AuthError("UNAUTHORIZED", "Authenticated user session not found for linking.", 401);
    }

    if (existingIdentity) {
      if (String(existingIdentity.user_id) !== targetUser.id) {
        throw new AuthError(
          "IDENTITY_ALREADY_LINKED",
          `This ${params.provider} account is already linked to another user account.`,
          409
        );
      }
      db.prepare("UPDATE user_identities SET last_sign_in_at = ? WHERE id = ?").run(
        now,
        String(existingIdentity.id)
      );
    } else {
      db.prepare(
        `INSERT INTO user_identities (
          id, user_id, provider, provider_user_id, provider_email,
          email_verified, is_private_relay, created_at, last_sign_in_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        generateId("ident"),
        targetUser.id,
        params.provider,
        params.providerUserId,
        normalizedEmail,
        emailVerified ? 1 : 0,
        isPrivateRelay ? 1 : 0,
        now,
        now
      );
    }

    const workspace = ensureDefaultWorkspaceForUser(targetUser.id, targetUser.displayName);
    const session = createSession(targetUser.id);
    return { user: targetUser, workspace, session };
  }

  // Case 2: Identity is already linked to a user (handles repeat Apple logins where email & name are omitted!)
  if (existingIdentity) {
    const userId = String(existingIdentity.user_id);
    db.prepare(
      `UPDATE user_identities
       SET last_sign_in_at = ?,
           provider_email = COALESCE(?, provider_email)
       WHERE id = ?`
    ).run(now, normalizedEmail, String(existingIdentity.id));

    const user = getUserById(userId);
    if (!user) {
      throw new AuthError("USER_NOT_FOUND", "Associated user record no longer exists.", 404);
    }
    const workspace = ensureDefaultWorkspaceForUser(user.id, user.displayName);
    const session = createSession(user.id);
    return { user, workspace, session };
  }

  // Case 3: New OAuth identity, check if email collides with an existing account
  if (normalizedEmail) {
    const existingEmailUser = db
      .prepare("SELECT id FROM users WHERE lower(email) = ?")
      .get(normalizedEmail) as { id: string } | undefined;

    if (existingEmailUser) {
      // Do NOT auto-merge accounts solely because email addresses match (prevents account takeover)
      throw new AuthError(
        "ACCOUNT_LINK_PROOF_REQUIRED",
        `An account with ${normalizedEmail} already exists. Please sign in with your existing method first and link ${params.provider} from Settings.`,
        409
      );
    }
  }

  // Case 4: Create a brand-new user and link this OAuth identity
  const userId = generateId("usr");
  const fallbackName =
    params.displayName?.trim() ||
    (normalizedEmail ? normalizedEmail.split("@")[0] : `${params.provider === "apple" ? "Apple" : "Google"} User`);
  const uiLang = normalizeBcp47Tag(params.uiLanguage || "en");
  const safeUiLang = uiLang === "und" || uiLang === "auto" ? "en" : uiLang;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO users (
        id, email, email_verified, is_private_relay_email, display_name, avatar_url,
        ui_language, default_spoken_language, default_summary_language,
        default_insights_language, preferred_transcription_provider, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'auto', ?, ?, 'auto', ?, ?)`
    ).run(
      userId,
      normalizedEmail,
      emailVerified ? 1 : 0,
      isPrivateRelay ? 1 : 0,
      fallbackName,
      params.avatarUrl ?? null,
      safeUiLang,
      safeUiLang,
      safeUiLang,
      now,
      now
    );

    db.prepare(
      `INSERT INTO user_identities (
        id, user_id, provider, provider_user_id, provider_email,
        email_verified, is_private_relay, created_at, last_sign_in_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      generateId("ident"),
      userId,
      params.provider,
      params.providerUserId,
      normalizedEmail,
      emailVerified ? 1 : 0,
      isPrivateRelay ? 1 : 0,
      now,
      now
    );

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const user = getUserById(userId)!;
  const workspace = ensureDefaultWorkspaceForUser(user.id, user.displayName);
  const session = createSession(user.id);
  return { user, workspace, session };
}

export function createOAuthAuthorizationRequest(params: {
  provider: "google" | "apple";
  intent: "signin" | "link";
  linkingUserId?: string | null;
  redirectTo?: string;
  reqUrl?: string;
}): { authorizationUrl: string; state: string } {
  const status = getOAuthProviderStatus(params.reqUrl);
  const providerStatus = status[params.provider];
  if (!providerStatus.configured) {
    throw new AuthError(
      "PROVIDER_NOT_CONFIGURED",
      `${params.provider.toUpperCase()} OAuth is not configured. Missing environment variables: ${providerStatus.missingVars.join(", ")}`,
      503
    );
  }

  const db = getDb();
  const state = crypto.randomBytes(24).toString("base64url");
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  const nonce = crypto.randomBytes(16).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OAUTH_STATE_TTL_MS).toISOString();

  db.prepare(
    `INSERT INTO oauth_states (
      state, provider, code_verifier, nonce, intent, linking_user_id, redirect_to, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    state,
    params.provider,
    codeVerifier,
    nonce,
    params.intent,
    params.linkingUserId ?? null,
    params.redirectTo || "/",
    expiresAt,
    now.toISOString()
  );

  if (params.provider === "google") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", getEnv("GOOGLE_CLIENT_ID"));
    url.searchParams.set("redirect_uri", providerStatus.callbackUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
    return { authorizationUrl: url.toString(), state };
  }

  // Apple Sign In OAuth 2.0 / OIDC
  const url = new URL("https://appleid.apple.com/auth/authorize");
  url.searchParams.set("client_id", getEnv("APPLE_CLIENT_ID"));
  url.searchParams.set("redirect_uri", providerStatus.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("scope", "name email");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  return { authorizationUrl: url.toString(), state };
}

export function consumeOAuthState(
  state: string,
  expectedProvider: "google" | "apple"
): {
  codeVerifier: string;
  nonce: string;
  intent: "signin" | "link";
  linkingUserId: string | null;
  redirectTo: string;
} {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM oauth_states WHERE state = ? AND provider = ?")
    .get(state, expectedProvider) as Record<string, unknown> | undefined;

  if (!row) {
    throw new AuthError("INVALID_OAUTH_STATE", "Invalid or mismatched OAuth state parameter (CSRF check failed).", 400);
  }

  // Single-use state deletion
  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);

  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    throw new AuthError("EXPIRED_OAUTH_STATE", "OAuth authorization session expired. Please try signing in again.", 400);
  }

  return {
    codeVerifier: String(row.code_verifier),
    nonce: String(row.nonce),
    intent: (row.intent as "signin" | "link") || "signin",
    linkingUserId: row.linking_user_id ? String(row.linking_user_id) : null,
    redirectTo: String(row.redirectTo || "/"),
  };
}

export function deleteUserAccount(userId: string): void {
  const db = getDb();
  // Clean up search_fts rows for user's meetings before cascading delete
  db.prepare("DELETE FROM search_fts WHERE owner_id = ?").run(userId);
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
}

export class AuthError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

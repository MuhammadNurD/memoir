import crypto from "node:crypto";
import { getEnv, getAppBaseUrl } from "./env";
import { AuthError } from "./auth";

export interface VerifiedOAuthClaims {
  provider: "google" | "apple";
  sub: string;
  email: string | null;
  emailVerified: boolean;
  isPrivateRelay: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}

function decodeJwtPayload(idToken: string): Record<string, unknown> {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new AuthError("INVALID_ID_TOKEN", "Malformed OpenID Connect ID token.", 400);
  }
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new AuthError("INVALID_ID_TOKEN", "Could not decode OpenID Connect ID token payload.", 400);
  }
}

export function verifyOidcClaims(params: {
  payload: Record<string, unknown>;
  expectedIssuers: string[];
  expectedAudience: string;
  expectedNonce: string;
}): void {
  const { payload, expectedIssuers, expectedAudience, expectedNonce } = params;

  const iss = String(payload.iss || "");
  if (!expectedIssuers.includes(iss)) {
    throw new AuthError("INVALID_ID_TOKEN", `Unexpected OIDC issuer: ${iss}`, 400);
  }

  const aud = payload.aud;
  const audMatches = Array.isArray(aud)
    ? aud.includes(expectedAudience)
    : String(aud || "") === expectedAudience;
  if (!audMatches) {
    throw new AuthError("INVALID_ID_TOKEN", "OIDC token audience mismatch.", 400);
  }

  const exp = Number(payload.exp || 0);
  if (!exp || exp * 1000 <= Date.now() - 30_000) {
    throw new AuthError("EXPIRED_ID_TOKEN", "OIDC ID token has expired.", 400);
  }

  if (payload.nonce && String(payload.nonce) !== expectedNonce) {
    throw new AuthError("INVALID_NONCE", "OIDC token nonce mismatch.", 400);
  }
}

export async function exchangeGoogleCode(params: {
  code: string;
  codeVerifier: string;
  expectedNonce: string;
  reqUrl?: string;
}): Promise<VerifiedOAuthClaims> {
  const clientId = getEnv("GOOGLE_CLIENT_ID");
  const clientSecret = getEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = `${getAppBaseUrl(params.reqUrl)}/api/auth/callback/google`;

  const body = new URLSearchParams({
    code: params.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: params.codeVerifier,
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new AuthError(
      "OAUTH_TOKEN_EXCHANGE_FAILED",
      `Google token exchange failed with HTTP ${res.status}.`,
      400
    );
  }

  const tokenData = (await res.json()) as { id_token?: string; access_token?: string };
  if (!tokenData.id_token) {
    throw new AuthError("MISSING_ID_TOKEN", "Google token response did not include an id_token.", 400);
  }

  const payload = decodeJwtPayload(tokenData.id_token);
  verifyOidcClaims({
    payload,
    expectedIssuers: ["https://accounts.google.com", "accounts.google.com"],
    expectedAudience: clientId,
    expectedNonce: params.expectedNonce,
  });

  return {
    provider: "google",
    sub: String(payload.sub || ""),
    email: payload.email ? String(payload.email) : null,
    emailVerified: Boolean(payload.email_verified),
    isPrivateRelay: false,
    displayName: payload.name ? String(payload.name) : null,
    avatarUrl: payload.picture ? String(payload.picture) : null,
  };
}

/**
 * Generates an ES256-signed client_secret JWT required by Apple's OAuth 2.0 token endpoint.
 */
export function generateAppleClientSecret(): string {
  const teamId = getEnv("APPLE_TEAM_ID");
  const clientId = getEnv("APPLE_CLIENT_ID");
  const keyId = getEnv("APPLE_KEY_ID");
  const privateKeyPem = getEnv("APPLE_PRIVATE_KEY").replace(/\\n/g, "\n");

  const nowSec = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" })).toString(
    "base64url"
  );
  const claims = Buffer.from(
    JSON.stringify({
      iss: teamId,
      iat: nowSec,
      exp: nowSec + 3600,
      aud: "https://appleid.apple.com",
      sub: clientId,
    })
  ).toString("base64url");

  const signingInput = `${header}.${claims}`;
  const signature = crypto
    .sign("sha256", Buffer.from(signingInput), {
      key: privateKeyPem,
      dsaEncoding: "ieee-p1363",
    })
    .toString("base64url");

  return `${signingInput}.${signature}`;
}

/**
 * Parses the optional `user` JSON payload sent by Apple ONLY during initial authorization.
 * Subsequent Apple sign-ins omit this parameter completely.
 */
export function parseAppleInitialUserPayload(rawUserJson?: string | null): {
  displayName: string | null;
  email: string | null;
} {
  if (!rawUserJson) return { displayName: null, email: null };
  try {
    const parsed = JSON.parse(rawUserJson) as {
      name?: { firstName?: string; lastName?: string };
      email?: string;
    };
    const first = parsed.name?.firstName?.trim() || "";
    const last = parsed.name?.lastName?.trim() || "";
    const fullName = [first, last].filter(Boolean).join(" ").trim() || null;
    const email = parsed.email?.trim() || null;
    return { displayName: fullName, email };
  } catch {
    return { displayName: null, email: null };
  }
}

export async function exchangeAppleCode(params: {
  code: string;
  expectedNonce: string;
  rawUserJson?: string | null;
  reqUrl?: string;
}): Promise<VerifiedOAuthClaims> {
  const clientId = getEnv("APPLE_CLIENT_ID");
  const clientSecret = generateAppleClientSecret();
  const redirectUri = `${getAppBaseUrl(params.reqUrl)}/api/auth/callback/apple`;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: params.code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const res = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new AuthError(
      "OAUTH_TOKEN_EXCHANGE_FAILED",
      `Apple token exchange failed with HTTP ${res.status}.`,
      400
    );
  }

  const tokenData = (await res.json()) as { id_token?: string };
  if (!tokenData.id_token) {
    throw new AuthError("MISSING_ID_TOKEN", "Apple token response did not include an id_token.", 400);
  }

  const payload = decodeJwtPayload(tokenData.id_token);
  verifyOidcClaims({
    payload,
    expectedIssuers: ["https://appleid.apple.com"],
    expectedAudience: clientId,
    expectedNonce: params.expectedNonce,
  });

  const initialProfile = parseAppleInitialUserPayload(params.rawUserJson);
  const claimEmail = payload.email ? String(payload.email) : initialProfile.email;
  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true";
  const isPrivateRelay =
    payload.is_private_email === true ||
    payload.is_private_email === "true" ||
    Boolean(claimEmail && claimEmail.toLowerCase().endsWith("@privaterelay.appleid.com"));

  return {
    provider: "apple",
    sub: String(payload.sub || ""),
    email: claimEmail,
    emailVerified,
    isPrivateRelay,
    displayName: initialProfile.displayName,
    avatarUrl: null,
  };
}

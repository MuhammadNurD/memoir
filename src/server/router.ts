import crypto from "node:crypto";
import { ZodError } from "zod";
import { getDb, generateId, rebuildMeetingSearchIndex } from "./db";
import {
  AuthError,
  consumeOAuthState,
  createClearSessionCookieHeader,
  createMagicLinkToken,
  createOAuthAuthorizationRequest,
  createSessionCookieHeader,
  deleteUserAccount,
  getAuthenticatedUser,
  getOAuthProviderStatus,
  getUserById,
  getUserIdentities,
  hashPassword,
  hashToken,
  parseSessionTokenFromRequest,
  registerWithEmailPassword,
  resolveOrLinkOAuthIdentity,
  revokeSessionByToken,
  signInWithEmailPassword,
  verifyMagicLinkToken,
} from "./auth";
import { exchangeAppleCode, exchangeGoogleCode } from "./oauth-providers";
import { getConfiguredProvidersStatus, ProviderCapabilityError } from "./ai-providers";
import {
  AccessDeniedError,
  createMeeting,
  generateOrRegenerateMeetingSummary,
  getMeetingDetailForUser,
  getSharedMeetingByToken,
  listMeetingsForUser,
  processMeetingTranscriptionAndSummary,
  requireAuthorizedMeetingAccess,
  searchMeetingsForUser,
  seedSampleMultilingualMeetingsForUser,
} from "./meetings-service";
import {
  deleteAudioBytes,
  readAudioBytes,
  saveAudioBytes,
  validateAudioUpload,
} from "./storage";
import {
  createActionItemSchema,
  createMeetingInputSchema,
  generateSummaryInputSchema,
  magicLinkInputSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  signInInputSchema,
  signUpInputSchema,
  updateActionItemSchema,
  updateMeetingInputSchema,
  updateSummaryContentSchema,
  updateTranscriptSegmentSchema,
  updateUserSettingsSchema,
} from "../shared/validation";
import { SUPPORTED_LANGUAGES, TRANSCRIPTION_PROVIDER_CAPABILITIES } from "../shared/languages";
import {
  checkAuthLockout,
  clearAuthLockout,
  enforceRateLimit,
  getClientIp,
  logSecurityEvent,
  recordFailedAuthAttempt,
  SECURITY_HEADERS,
  SecurityViolationError,
  verifyAudioMagicBytes,
  verifyCsrfOrigin,
} from "./security";

function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

function redirectResponse(location: string, extraHeaders?: Record<string, string>): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

async function parseJsonBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new AuthError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
}

export async function handleApiRequest(req: Request): Promise<Response> {
  const url = new URL(req.url, "http://localhost:5173");
  const pathname = url.pathname.replace(/^\/\.netlify\/functions\/api/, "/api");
  const method = req.method.toUpperCase();

  try {
    const clientIp = getClientIp(req);

    // Global IP rate limit (300 requests per minute)
    enforceRateLimit({
      bucket: "global_ip",
      key: clientIp,
      maxRequests: 300,
      windowMs: 60_000,
    });

    // CSRF Origin verification on state-changing requests
    verifyCsrfOrigin(req, pathname);

    // 1. Metadata & Languages Catalog
    if (pathname === "/api/catalog" && method === "GET") {
      return jsonResponse({
        languages: SUPPORTED_LANGUAGES,
        transcriptionProviders: TRANSCRIPTION_PROVIDER_CAPABILITIES,
        oauthProviders: getOAuthProviderStatus(req.url),
        aiProviders: getConfiguredProvidersStatus(),
      });
    }

    // 2. Auth Session Check
    if (pathname === "/api/auth/session" && method === "GET") {
      const auth = getAuthenticatedUser(req);
      if (!auth) {
        return jsonResponse({
          authenticated: false,
          user: null,
          workspace: null,
          identities: [],
          oauthProviders: getOAuthProviderStatus(req.url),
          aiProviders: getConfiguredProvidersStatus(),
        });
      }

      return jsonResponse({
        authenticated: true,
        user: auth.user,
        workspace: auth.workspace,
        identities: getUserIdentities(auth.user.id),
        oauthProviders: getOAuthProviderStatus(req.url),
        aiProviders: getConfiguredProvidersStatus(),
      });
    }

    // 3. Email/Password Sign Up
    if (pathname === "/api/auth/signup" && method === "POST") {
      enforceRateLimit({
        bucket: "auth_signup_ip",
        key: clientIp,
        maxRequests: 15,
        windowMs: 15 * 60_000,
      });
      const body = signUpInputSchema.parse(await parseJsonBody(req));
      const { user, workspace, session } = registerWithEmailPassword(body);
      const cookie = createSessionCookieHeader(session.token, session.expiresAt, req.url);
      return jsonResponse(
        {
          authenticated: true,
          user,
          workspace,
          identities: getUserIdentities(user.id),
          sessionToken: session.token,
        },
        201,
        { "Set-Cookie": cookie }
      );
    }

    // 4. Email/Password Sign In
    if (pathname === "/api/auth/signin" && method === "POST") {
      enforceRateLimit({
        bucket: "auth_signin_ip",
        key: clientIp,
        maxRequests: 25,
        windowMs: 15 * 60_000,
      });
      const body = signInInputSchema.parse(await parseJsonBody(req));
      const normalizedEmail = body.email.trim().toLowerCase();

      // Check account & IP brute-force lockout before checking credentials
      checkAuthLockout(`email:${normalizedEmail}`);
      checkAuthLockout(`ip:${clientIp}`);

      try {
        const { user, workspace, session } = signInWithEmailPassword(body);
        clearAuthLockout(`email:${normalizedEmail}`);
        clearAuthLockout(`ip:${clientIp}`);
        const cookie = createSessionCookieHeader(session.token, session.expiresAt, req.url);
        return jsonResponse(
          {
            authenticated: true,
            user,
            workspace,
            identities: getUserIdentities(user.id),
            sessionToken: session.token,
          },
          200,
          { "Set-Cookie": cookie }
        );
      } catch (authErr) {
        recordFailedAuthAttempt(`email:${normalizedEmail}`, clientIp);
        recordFailedAuthAttempt(`ip:${clientIp}`, clientIp);
        throw authErr;
      }
    }

    // 4b. Localhost Quick Sign-In (only enabled on localhost / 127.0.0.1)
    if (pathname === "/api/auth/local-dev" && method === "POST") {
      const isLocalhost =
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "::1";
      if (!isLocalhost) {
        throw new AuthError(
          "FORBIDDEN",
          "Local developer quick sign-in is only available on localhost.",
          403
        );
      }

      const localEmail = "local@memoir.workspace";
      const localPassword = "MemoirLocal2026!";
      let authResult: ReturnType<typeof signInWithEmailPassword>;
      try {
        authResult = signInWithEmailPassword({
          email: localEmail,
          password: localPassword,
        });
      } catch {
        authResult = registerWithEmailPassword({
          email: localEmail,
          password: localPassword,
          displayName: "Local Workspace Admin",
          uiLanguage: "en",
        });
      }

      const cookie = createSessionCookieHeader(
        authResult.session.token,
        authResult.session.expiresAt,
        req.url
      );
      return jsonResponse(
        {
          authenticated: true,
          user: authResult.user,
          workspace: authResult.workspace,
          identities: getUserIdentities(authResult.user.id),
          sessionToken: authResult.session.token,
        },
        200,
        { "Set-Cookie": cookie }
      );
    }

    // 5. Sign Out
    if (pathname === "/api/auth/signout" && method === "POST") {
      const token = parseSessionTokenFromRequest(req);
      if (token) {
        revokeSessionByToken(token);
      }
      return jsonResponse(
        { ok: true },
        200,
        { "Set-Cookie": createClearSessionCookieHeader() }
      );
    }

    // 6. Magic Link Request & Verify
    if (pathname === "/api/auth/magic-link/request" && method === "POST") {
      const body = magicLinkInputSchema.parse(await parseJsonBody(req));
      const { rawToken, expiresAt } = createMagicLinkToken(body);
      return jsonResponse({
        ok: true,
        expiresAt,
        verificationToken: rawToken,
      });
    }

    if (pathname === "/api/auth/magic-link/verify" && method === "POST") {
      const body = await parseJsonBody<{ token?: string }>(req);
      if (!body.token) {
        throw new AuthError("MISSING_TOKEN", "Verification token is required.", 400);
      }
      const { user, workspace, session } = verifyMagicLinkToken(body.token);
      const cookie = createSessionCookieHeader(session.token, session.expiresAt, req.url);
      return jsonResponse(
        {
          authenticated: true,
          user,
          workspace,
          identities: getUserIdentities(user.id),
          sessionToken: session.token,
        },
        200,
        { "Set-Cookie": cookie }
      );
    }

    // 7. Password Recovery Request & Confirm
    if (pathname === "/api/auth/password-reset/request" && method === "POST") {
      const body = passwordResetRequestSchema.parse(await parseJsonBody(req));
      const db = getDb();
      const normalizedEmail = body.email.trim().toLowerCase();
      const userRow = db
        .prepare("SELECT id FROM users WHERE lower(email) = ?")
        .get(normalizedEmail) as { id: string } | undefined;

      let resetToken: string | null = null;
      if (userRow) {
        resetToken = crypto.randomBytes(24).toString("base64url");
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 1000 * 60 * 30).toISOString();
        db.prepare(
          `INSERT INTO verification_tokens (
            id, token_hash, user_id, email, token_type, expires_at, created_at
          ) VALUES (?, ?, ?, ?, 'password_reset', ?, ?)`
        ).run(
          generateId("vtok"),
          hashToken(resetToken),
          userRow.id,
          normalizedEmail,
          expiresAt,
          now.toISOString()
        );
      }

      return jsonResponse({
        ok: true,
        resetToken,
      });
    }

    if (pathname === "/api/auth/password-reset/confirm" && method === "POST") {
      const body = passwordResetConfirmSchema.parse(await parseJsonBody(req));
      const db = getDb();
      const tokenHash = hashToken(body.token);
      const row = db
        .prepare(
          "SELECT * FROM verification_tokens WHERE token_hash = ? AND token_type = 'password_reset'"
        )
        .get(tokenHash) as Record<string, unknown> | undefined;

      if (!row || row.used_at || !row.user_id) {
        throw new AuthError("INVALID_RESET_TOKEN", "Invalid or already used password reset token.", 400);
      }

      if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
        throw new AuthError("EXPIRED_RESET_TOKEN", "Password reset token has expired.", 400);
      }

      const now = new Date().toISOString();
      const newHash = hashPassword(body.newPassword);
      db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(
        newHash,
        now,
        String(row.user_id)
      );
      db.prepare("UPDATE verification_tokens SET used_at = ? WHERE id = ?").run(now, String(row.id));

      return jsonResponse({ ok: true });
    }

    // 8. OAuth Start (Google / Apple)
    const oauthStartMatch = pathname.match(/^\/api\/auth\/oauth\/(google|apple)\/start$/);
    if (oauthStartMatch && (method === "GET" || method === "POST")) {
      const provider = oauthStartMatch[1] as "google" | "apple";
      const intent = (url.searchParams.get("intent") === "link" ? "link" : "signin") as
        | "signin"
        | "link";
      const redirectTo = url.searchParams.get("redirectTo") || "/";

      let linkingUserId: string | null = null;
      if (intent === "link") {
        const auth = getAuthenticatedUser(req);
        if (!auth) {
          throw new AuthError(
            "UNAUTHORIZED",
            "You must be signed in to link an additional authentication provider.",
            401
          );
        }
        linkingUserId = auth.user.id;
      }

      const { authorizationUrl, state } = createOAuthAuthorizationRequest({
        provider,
        intent,
        linkingUserId,
        redirectTo,
        reqUrl: req.url,
      });

      if (req.headers.get("accept")?.includes("application/json") || method === "POST") {
        return jsonResponse({ authorizationUrl, state });
      }
      return redirectResponse(authorizationUrl);
    }

    // 9. OAuth Callback (Google / Apple)
    const oauthCallbackMatch = pathname.match(/^\/api\/auth\/callback\/(google|apple)$/);
    if (oauthCallbackMatch && (method === "GET" || method === "POST")) {
      const provider = oauthCallbackMatch[1] as "google" | "apple";

      let code: string | null = url.searchParams.get("code");
      let state: string | null = url.searchParams.get("state");
      let errorParam: string | null = url.searchParams.get("error");
      let rawUserJson: string | null = url.searchParams.get("user");

      if (method === "POST") {
        const contentType = req.headers.get("content-type") || "";
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const formText = await req.text();
          const params = new URLSearchParams(formText);
          code = params.get("code") || code;
          state = params.get("state") || state;
          errorParam = params.get("error") || errorParam;
          rawUserJson = params.get("user") || rawUserJson;
        } else if (contentType.includes("application/json")) {
          const body = await parseJsonBody<Record<string, string>>(req);
          code = body.code || code;
          state = body.state || state;
          errorParam = body.error || errorParam;
          rawUserJson = body.user || rawUserJson;
        }
      }

      if (errorParam) {
        const errorRedirect = `/login?oauth_error=${encodeURIComponent(errorParam)}&provider=${provider}`;
        if (req.headers.get("accept")?.includes("application/json")) {
          return jsonResponse(
            {
              error: {
                code: "OAUTH_PROVIDER_CANCELLED",
                message: `Sign-in with ${provider} was cancelled or denied (${errorParam}).`,
              },
            },
            400
          );
        }
        return redirectResponse(errorRedirect);
      }

      if (!state || !code) {
        throw new AuthError("INVALID_OAUTH_CALLBACK", "Missing OAuth state or authorization code.", 400);
      }

      const stateRecord = consumeOAuthState(state, provider);

      const claims =
        provider === "google"
          ? await exchangeGoogleCode({
              code,
              codeVerifier: stateRecord.codeVerifier,
              expectedNonce: stateRecord.nonce,
              reqUrl: req.url,
            })
          : await exchangeAppleCode({
              code,
              expectedNonce: stateRecord.nonce,
              rawUserJson,
              reqUrl: req.url,
            });

      const { user, workspace, session } = resolveOrLinkOAuthIdentity({
        provider,
        providerUserId: claims.sub,
        email: claims.email,
        emailVerified: claims.emailVerified,
        isPrivateRelay: claims.isPrivateRelay,
        displayName: claims.displayName,
        avatarUrl: claims.avatarUrl,
        authenticatedUserIdForLinking:
          stateRecord.intent === "link" ? stateRecord.linkingUserId : null,
      });

      const cookie = createSessionCookieHeader(session.token, session.expiresAt, req.url);
      if (req.headers.get("accept")?.includes("application/json")) {
        return jsonResponse(
          {
            authenticated: true,
            user,
            workspace,
            sessionToken: session.token,
          },
          200,
          { "Set-Cookie": cookie }
        );
      }

      return redirectResponse(stateRecord.redirectTo || "/", { "Set-Cookie": cookie });
    }

    // 10. Public Shared Meeting Route (Read-Only when explicitly shared by owner)
    const sharedMatch = pathname.match(/^\/api\/shared\/([^/]+)$/);
    if (sharedMatch && method === "GET") {
      const detail = getSharedMeetingByToken(sharedMatch[1]);
      if (!detail) {
        return jsonResponse(
          { error: { code: "NOT_FOUND", message: "Shared meeting link is invalid or has been revoked." } },
          404
        );
      }
      return jsonResponse(detail);
    }

    // --- All routes below require an authenticated user session ---
    const auth = getAuthenticatedUser(req);
    if (!auth) {
      return jsonResponse(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required. Please sign in to access this resource.",
          },
        },
        401
      );
    }

    // 11. Unlink OAuth Identity
    const unlinkMatch = pathname.match(/^\/api\/auth\/identities\/([^/]+)$/);
    if (unlinkMatch && method === "DELETE") {
      const identityId = unlinkMatch[1];
      const identities = getUserIdentities(auth.user.id);
      const target = identities.find((i) => i.id === identityId);
      if (!target) {
        return jsonResponse(
          { error: { code: "NOT_FOUND", message: "Identity not found on your account." } },
          404
        );
      }
      if (identities.length <= 1) {
        return jsonResponse(
          {
            error: {
              code: "LAST_IDENTITY",
              message: "Cannot unlink your only sign-in method.",
            },
          },
          400
        );
      }
      getDb()
        .prepare("DELETE FROM user_identities WHERE id = ? AND user_id = ?")
        .run(identityId, auth.user.id);
      return jsonResponse({ identities: getUserIdentities(auth.user.id) });
    }

    // 12. User Settings & Account Deletion
    if (pathname === "/api/user/settings" && method === "PATCH") {
      const body = updateUserSettingsSchema.parse(await parseJsonBody(req));
      const db = getDb();
      const now = new Date().toISOString();

      db.prepare(
        `UPDATE users
         SET display_name = COALESCE(?, display_name),
             ui_language = COALESCE(?, ui_language),
             default_spoken_language = COALESCE(?, default_spoken_language),
             default_summary_language = COALESCE(?, default_summary_language),
             default_insights_language = COALESCE(?, default_insights_language),
             preferred_transcription_provider = COALESCE(?, preferred_transcription_provider),
             updated_at = ?
         WHERE id = ?`
      ).run(
        body.displayName ?? null,
        body.uiLanguage ?? null,
        body.defaultSpokenLanguage ?? null,
        body.defaultSummaryLanguage ?? null,
        body.defaultInsightsLanguage ?? null,
        body.preferredTranscriptionProvider ?? null,
        now,
        auth.user.id
      );

      return jsonResponse({ user: getUserById(auth.user.id) });
    }

    if (pathname === "/api/user/account" && method === "DELETE") {
      const db = getDb();
      const audioRows = db
        .prepare("SELECT storage_key FROM audio_assets WHERE owner_id = ?")
        .all(auth.user.id) as Array<{ storage_key: string }>;

      for (const a of audioRows) {
        await deleteAudioBytes(a.storage_key);
      }

      deleteUserAccount(auth.user.id);
      return jsonResponse(
        { deleted: true },
        200,
        { "Set-Cookie": createClearSessionCookieHeader() }
      );
    }

    // 13. Dashboard Overview
    if (pathname === "/api/dashboard" && method === "GET") {
      const meetings = listMeetingsForUser(auth.user.id);
      const totalMeetings = meetings.length;
      const totalDurationSeconds = meetings.reduce(
        (acc, m) => acc + (m.durationSeconds || 0),
        0
      );
      const langSet = new Set<string>();
      for (const m of meetings) {
        if (m.detectedLanguage && m.detectedLanguage !== "und") {
          langSet.add(m.detectedLanguage);
        }
        for (const dl of m.detectedLanguages) {
          if (dl && dl !== "und") langSet.add(dl);
        }
      }

      const db = getDb();
      const openActionsRows = db
        .prepare(
          `SELECT a.*, m.title as meeting_title
           FROM action_items a
           JOIN meetings m ON m.id = a.meeting_id
           LEFT JOIN workspace_members wm ON wm.workspace_id = m.workspace_id AND wm.user_id = ?
           WHERE (m.owner_id = ? OR wm.user_id IS NOT NULL)
             AND a.status != 'completed'
           ORDER BY a.created_at DESC
           LIMIT 15`
        )
        .all(auth.user.id, auth.user.id) as Array<Record<string, unknown>>;

      const openActionItems = openActionsRows.map((a) => ({
        id: String(a.id),
        meetingId: String(a.meeting_id),
        meetingTitle: String(a.meeting_title),
        language: String(a.language || "en"),
        title: String(a.title),
        owner: a.owner ? String(a.owner) : null,
        dueDate: a.due_date ? String(a.due_date) : null,
        status: String(a.status),
        confidence: String(a.confidence || "high"),
      }));

      return jsonResponse({
        stats: {
          totalMeetings,
          totalDurationSeconds,
          openActionItemsCount: openActionItems.length,
          languagesCaptured: Array.from(langSet),
        },
        recentMeetings: meetings.slice(0, 6),
        openActionItems,
      });
    }

    // 14. Seed Sample Multilingual Meetings
    if (pathname === "/api/meetings/seed-samples" && method === "POST") {
      const created = await seedSampleMultilingualMeetingsForUser(
        auth.user.id,
        auth.workspace.id
      );
      return jsonResponse({ meetings: created }, 201);
    }

    // 15. List or Create Meetings
    if (pathname === "/api/meetings" && method === "GET") {
      const status = url.searchParams.get("status") || undefined;
      const language = url.searchParams.get("language") || undefined;
      const query = url.searchParams.get("query") || undefined;
      const meetings = listMeetingsForUser(auth.user.id, { status, language, query });
      return jsonResponse({ meetings });
    }

    if (pathname === "/api/meetings" && method === "POST") {
      const body = createMeetingInputSchema.parse(await parseJsonBody(req));
      const meeting = createMeeting({
        userId: auth.user.id,
        workspaceId: auth.workspace.id,
        title: body.title,
        description: body.description,
        spokenLanguageConfig: body.spokenLanguageConfig,
        preferredSummaryLanguage: body.preferredSummaryLanguage,
        preferredInsightsLanguage: body.preferredInsightsLanguage,
        transcriptionProvider: body.transcriptionProvider,
        recordedAt: body.recordedAt,
      });

      if (body.rawTranscriptText && body.rawTranscriptText.trim()) {
        const detail = await processMeetingTranscriptionAndSummary({
          meetingId: meeting.id,
          userId: auth.user.id,
          rawTranscriptText: body.rawTranscriptText,
        });
        return jsonResponse(detail, 201);
      }

      return jsonResponse(getMeetingDetailForUser(meeting.id, auth.user.id), 201);
    }

    // 16. Single Meeting Detail, Update, Delete
    const meetingIdMatch = pathname.match(/^\/api\/meetings\/([^/]+)$/);
    if (meetingIdMatch) {
      const meetingId = meetingIdMatch[1];

      if (method === "GET") {
        const detail = getMeetingDetailForUser(meetingId, auth.user.id);
        return jsonResponse(detail);
      }

      if (method === "PATCH") {
        const meeting = requireAuthorizedMeetingAccess(meetingId, auth.user.id);
        const body = updateMeetingInputSchema.parse(await parseJsonBody(req));
        const db = getDb();
        const now = new Date().toISOString();

        let shareToken = meeting.shareToken;
        let isShared = meeting.isShared;
        if (body.isShared !== undefined) {
          isShared = body.isShared;
          if (isShared && !shareToken) {
            shareToken = crypto.randomBytes(16).toString("base64url");
          }
        }

        const languageOverridden =
          body.detectedLanguageOverride !== undefined ? 1 : meeting.languageOverridden ? 1 : 0;

        db.prepare(
          `UPDATE meetings
           SET title = COALESCE(?, title),
               description = CASE WHEN ? THEN ? ELSE description END,
               spoken_language_config = COALESCE(?, spoken_language_config),
               detected_language = COALESCE(?, detected_language),
               language_overridden = ?,
               preferred_summary_language = COALESCE(?, preferred_summary_language),
               preferred_insights_language = COALESCE(?, preferred_insights_language),
               is_shared = ?,
               share_token = ?,
               updated_at = ?
           WHERE id = ?`
        ).run(
          body.title ?? null,
          body.description !== undefined ? 1 : 0,
          body.description ?? null,
          body.spokenLanguageConfig ?? null,
          body.detectedLanguageOverride ?? null,
          languageOverridden,
          body.preferredSummaryLanguage ?? null,
          body.preferredInsightsLanguage ?? null,
          isShared ? 1 : 0,
          shareToken,
          now,
          meeting.id
        );

        rebuildMeetingSearchIndex(db, meeting.id);
        return jsonResponse(getMeetingDetailForUser(meeting.id, auth.user.id));
      }

      if (method === "DELETE") {
        const meeting = requireAuthorizedMeetingAccess(meetingId, auth.user.id);
        const db = getDb();
        const audioRow = db
          .prepare("SELECT storage_key FROM audio_assets WHERE meeting_id = ?")
          .get(meeting.id) as { storage_key: string } | undefined;

        if (audioRow) {
          await deleteAudioBytes(audioRow.storage_key);
        }

        db.prepare("DELETE FROM search_fts WHERE meeting_id = ?").run(meeting.id);
        db.prepare("DELETE FROM meetings WHERE id = ?").run(meeting.id);
        return jsonResponse({ deleted: true });
      }
    }

    // 17. Meeting Audio Upload & Protected Audio Streaming
    const audioRouteMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/audio$/);
    if (audioRouteMatch) {
      const meetingId = audioRouteMatch[1];
      const meeting = requireAuthorizedMeetingAccess(meetingId, auth.user.id);
      const db = getDb();

      if (method === "GET") {
        const audioRow = db
          .prepare("SELECT * FROM audio_assets WHERE meeting_id = ?")
          .get(meeting.id) as Record<string, unknown> | undefined;

        if (!audioRow) {
          return jsonResponse(
            { error: { code: "NOT_FOUND", message: "No audio recording found for this meeting." } },
            404
          );
        }

        const bytes = await readAudioBytes(String(audioRow.storage_key));
        if (!bytes) {
          return jsonResponse(
            { error: { code: "NOT_FOUND", message: "Audio file missing from storage." } },
            404
          );
        }

        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: {
            "Content-Type": String(audioRow.mime_type),
            "Content-Length": String(bytes.byteLength),
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=3600",
          },
        });
      }

      if (method === "POST") {
        const formData = await req.formData();
        const fileEntry = formData.get("audio");
        if (!fileEntry || !(fileEntry instanceof File)) {
          return jsonResponse(
            { error: { code: "MISSING_AUDIO_FILE", message: "An 'audio' file field is required." } },
            400
          );
        }

        const durationParam = formData.get("durationSeconds");
        const durationSeconds = durationParam ? Number(durationParam) : null;
        const clientTranscriptParam = formData.get("clientTranscriptText");
        const clientTranscriptText =
          typeof clientTranscriptParam === "string" && clientTranscriptParam.trim()
            ? clientTranscriptParam.trim()
            : undefined;

        const validation = validateAudioUpload({
          fileName: fileEntry.name || "recording.wav",
          mimeType: fileEntry.type || "audio/wav",
          sizeBytes: fileEntry.size,
        });

        if (!validation.valid) {
          return jsonResponse(
            { error: { code: "INVALID_AUDIO_FILE", message: validation.error } },
            400
          );
        }

        const arrayBuffer = await fileEntry.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        // Verify binary magic bytes to block disguised scripts, HTML, or executables
        const magicCheck = verifyAudioMagicBytes(bytes);
        if (!magicCheck.valid) {
          logSecurityEvent({
            eventType: "MALICIOUS_UPLOAD_BLOCKED",
            ipAddress: clientIp,
            actorId: auth.user.id,
            details: magicCheck.reason,
          });
          return jsonResponse(
            {
              error: {
                code: "MALICIOUS_OR_CORRUPT_AUDIO",
                message: magicCheck.reason || "Invalid audio binary signature.",
              },
            },
            400
          );
        }

        const ext = (fileEntry.name.split(".").pop() || "wav").replace(/[^a-z0-9]/gi, "");
        const storageKey = `${meeting.id}_${Date.now()}.${ext}`;

        await saveAudioBytes(storageKey, bytes);

        const now = new Date().toISOString();
        db.prepare("DELETE FROM audio_assets WHERE meeting_id = ?").run(meeting.id);
        db.prepare(
          `INSERT INTO audio_assets (
            id, meeting_id, owner_id, file_name, mime_type, size_bytes,
            duration_seconds, storage_key, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          generateId("aud"),
          meeting.id,
          auth.user.id,
          fileEntry.name || "recording.wav",
          validation.normalizedMime,
          fileEntry.size,
          durationSeconds,
          storageKey,
          now
        );

        if (durationSeconds) {
          db.prepare("UPDATE meetings SET duration_seconds = ?, updated_at = ? WHERE id = ?").run(
            Math.round(durationSeconds),
            now,
            meeting.id
          );
        }

        // Transcribe using free local Whisper / browser speech or configured provider
        try {
          const detail = await processMeetingTranscriptionAndSummary({
            meetingId: meeting.id,
            userId: auth.user.id,
            clientTranscriptText,
          });
          return jsonResponse(detail, 201);
        } catch (err) {
          const detail = getMeetingDetailForUser(meeting.id, auth.user.id);
          const status = err instanceof ProviderCapabilityError ? err.status : 500;
          return jsonResponse(
            {
              ...detail,
              error: {
                code: err instanceof ProviderCapabilityError ? err.code : "PROCESSING_FAILED",
                message: err instanceof Error ? err.message : "Audio processing failed.",
              },
            },
            status
          );
        }
      }
    }

    // 18. Retry / Process Meeting Transcription
    const processMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/process$/);
    if (processMatch && method === "POST") {
      const meetingId = processMatch[1];
      const body = await parseJsonBody<{
        rawTranscriptText?: string;
        idempotencyKey?: string;
      }>(req);

      const detail = await processMeetingTranscriptionAndSummary({
        meetingId,
        userId: auth.user.id,
        rawTranscriptText: body.rawTranscriptText,
        idempotencyKey: body.idempotencyKey,
      });
      return jsonResponse(detail);
    }

    // 19. Generate / Regenerate Summary in Another Language or Edit Summary
    const summariesMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/summaries$/);
    if (summariesMatch) {
      const meetingId = summariesMatch[1];

      if (method === "POST") {
        const body = generateSummaryInputSchema.parse(await parseJsonBody(req));
        await generateOrRegenerateMeetingSummary({
          meetingId,
          userId: auth.user.id,
          outputLanguage: body.outputLanguage,
          insightsLanguage: body.insightsLanguage || body.outputLanguage,
          idempotencyKey: body.idempotencyKey,
        });
        return jsonResponse(getMeetingDetailForUser(meetingId, auth.user.id));
      }

      if (method === "PATCH") {
        const meeting = requireAuthorizedMeetingAccess(meetingId, auth.user.id);
        const body = updateSummaryContentSchema.parse(await parseJsonBody(req));
        const db = getDb();
        const now = new Date().toISOString();

        db.prepare(
          `UPDATE meeting_summaries
           SET executive_summary = ?,
               key_discussion_points_json = ?,
               unresolved_questions_json = ?,
               is_user_edited = 1,
               updated_at = ?
           WHERE id = ? AND meeting_id = ?`
        ).run(
          body.executiveSummary,
          JSON.stringify(body.keyDiscussionPoints),
          JSON.stringify(body.unresolvedQuestions),
          now,
          body.summaryId,
          meeting.id
        );

        rebuildMeetingSearchIndex(db, meeting.id);
        return jsonResponse(getMeetingDetailForUser(meeting.id, auth.user.id));
      }
    }

    // 20. Edit Transcript Segment
    const segmentMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/transcript-segments$/);
    if (segmentMatch && method === "PATCH") {
      const meeting = requireAuthorizedMeetingAccess(segmentMatch[1], auth.user.id);
      const body = updateTranscriptSegmentSchema.parse(await parseJsonBody(req));
      const db = getDb();
      const now = new Date().toISOString();

      db.prepare(
        `UPDATE transcript_segments
         SET text = ?,
             speaker = CASE WHEN ? THEN ? ELSE speaker END,
             language = COALESCE(?, language),
             is_user_edited = 1
         WHERE id = ? AND meeting_id = ?`
      ).run(
        body.text,
        body.speaker !== undefined ? 1 : 0,
        body.speaker ?? null,
        body.language ?? null,
        body.segmentId,
        meeting.id
      );

      // Recompute full_text on transcript record
      const allSegs = db
        .prepare(
          "SELECT speaker, text FROM transcript_segments WHERE meeting_id = ? ORDER BY sequence_index ASC"
        )
        .all(meeting.id) as Array<{ speaker: string | null; text: string }>;
      const newFullText = allSegs
        .map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
        .join("\n");

      db.prepare(
        "UPDATE transcripts SET full_text = ?, is_user_edited = 1, updated_at = ? WHERE meeting_id = ?"
      ).run(newFullText, now, meeting.id);

      rebuildMeetingSearchIndex(db, meeting.id);
      return jsonResponse(getMeetingDetailForUser(meeting.id, auth.user.id));
    }

    // 21. Action Items Create / Update / Delete
    const actionCreateMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/action-items$/);
    if (actionCreateMatch && method === "POST") {
      const meeting = requireAuthorizedMeetingAccess(actionCreateMatch[1], auth.user.id);
      const body = createActionItemSchema.parse(await parseJsonBody(req));
      const db = getDb();
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO action_items (
          id, meeting_id, summary_id, language, title, owner, due_date,
          status, confidence, is_user_edited, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'open', 'high', 1, ?, ?)`
      ).run(
        generateId("act"),
        meeting.id,
        body.language || meeting.preferredInsightsLanguage,
        body.title,
        body.owner ?? null,
        body.dueDate ?? null,
        now,
        now
      );

      rebuildMeetingSearchIndex(db, meeting.id);
      return jsonResponse(getMeetingDetailForUser(meeting.id, auth.user.id), 201);
    }

    const actionItemMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/action-items\/([^/]+)$/);
    if (actionItemMatch) {
      const meeting = requireAuthorizedMeetingAccess(actionItemMatch[1], auth.user.id);
      const actionId = actionItemMatch[2];
      const db = getDb();

      if (method === "PATCH") {
        const body = updateActionItemSchema.parse(await parseJsonBody(req));
        const now = new Date().toISOString();

        db.prepare(
          `UPDATE action_items
           SET title = COALESCE(?, title),
               owner = CASE WHEN ? THEN ? ELSE owner END,
               due_date = CASE WHEN ? THEN ? ELSE due_date END,
               status = COALESCE(?, status),
               is_user_edited = 1,
               updated_at = ?
           WHERE id = ? AND meeting_id = ?`
        ).run(
          body.title ?? null,
          body.owner !== undefined ? 1 : 0,
          body.owner ?? null,
          body.dueDate !== undefined ? 1 : 0,
          body.dueDate ?? null,
          body.status ?? null,
          now,
          actionId,
          meeting.id
        );

        rebuildMeetingSearchIndex(db, meeting.id);
        return jsonResponse(getMeetingDetailForUser(meeting.id, auth.user.id));
      }

      if (method === "DELETE") {
        db.prepare("DELETE FROM action_items WHERE id = ? AND meeting_id = ?").run(
          actionId,
          meeting.id
        );
        rebuildMeetingSearchIndex(db, meeting.id);
        return jsonResponse(getMeetingDetailForUser(meeting.id, auth.user.id));
      }
    }

    // 22. Export Meeting (JSON or Markdown with full language metadata)
    const exportMatch = pathname.match(/^\/api\/meetings\/([^/]+)\/export$/);
    if (exportMatch && method === "GET") {
      const detail = getMeetingDetailForUser(exportMatch[1], auth.user.id);
      const format = url.searchParams.get("format") || "json";

      if (format === "md" || format === "markdown") {
        const m = detail.meeting;
        const sum = detail.activeSummary;
        const lines: string[] = [
          `# ${m.title}`,
          "",
          `- **Date**: ${m.recordedAt}`,
          `- **Spoken Language Config**: ${m.spokenLanguageConfig}`,
          `- **Detected Language**: ${m.detectedLanguage} (${m.detectedLanguages.join(", ") || m.detectedLanguage})`,
          `- **Summary Output Language**: ${sum?.outputLanguage || m.preferredSummaryLanguage}`,
          `- **Insights Language**: ${sum?.insightsLanguage || m.preferredInsightsLanguage}`,
          "",
        ];

        if (sum) {
          lines.push(`## Executive Summary (${sum.outputLanguage})`, "", sum.executiveSummary, "");
          if (sum.keyDiscussionPoints.length > 0) {
            lines.push("## Key Discussion Points", "");
            for (const pt of sum.keyDiscussionPoints) {
              lines.push(`- ${pt}`);
            }
            lines.push("");
          }
        }

        if (detail.decisions.length > 0) {
          lines.push("## Decisions", "");
          for (const d of detail.decisions) {
            lines.push(`- [${d.language}] ${d.decisionText}${d.madeBy ? ` (${d.madeBy})` : ""}`);
          }
          lines.push("");
        }

        if (detail.actionItems.length > 0) {
          lines.push("## Action Items", "");
          for (const a of detail.actionItems) {
            const check = a.status === "completed" ? "[x]" : "[ ]";
            lines.push(
              `- ${check} [${a.language}] ${a.title} (Owner: ${a.owner || "Unknown"}, Due: ${a.dueDate || "Unknown"})`
            );
          }
          lines.push("");
        }

        if (detail.transcript) {
          lines.push(
            `## Original Transcript (${detail.transcript.detectedLanguage})`,
            "",
            detail.transcript.fullText,
            ""
          );
        }

        return new Response(lines.join("\n"), {
          status: 200,
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Content-Disposition": `attachment; filename="meeting-${m.id}.md"`,
          },
        });
      }

      const exportPayload = {
        exportedAt: new Date().toISOString(),
        languageMetadata: {
          spokenLanguageConfig: detail.meeting.spokenLanguageConfig,
          detectedLanguage: detail.meeting.detectedLanguage,
          detectedLanguages: detail.meeting.detectedLanguages,
          languageConfidence: detail.meeting.languageConfidence,
          languageOverridden: detail.meeting.languageOverridden,
          isCodeSwitching: detail.transcript?.isCodeSwitching ?? false,
          preferredSummaryLanguage: detail.meeting.preferredSummaryLanguage,
          preferredInsightsLanguage: detail.meeting.preferredInsightsLanguage,
          availableSummaryLanguages: detail.summaries.map((s) => s.outputLanguage),
        },
        meeting: detail.meeting,
        transcript: detail.transcript,
        summaries: detail.summaries,
        decisions: detail.decisions,
        actionItems: detail.actionItems,
      };

      return new Response(JSON.stringify(exportPayload, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="meeting-${detail.meeting.id}.json"`,
        },
      });
    }

    // 23. Multilingual Search
    if (pathname === "/api/search" && method === "GET") {
      const q = url.searchParams.get("q") || "";
      const scope = url.searchParams.get("scope") || "all";
      const language = url.searchParams.get("language") || "all";

      const results = searchMeetingsForUser({
        userId: auth.user.id,
        query: q,
        scope,
        language,
      });

      return jsonResponse({ query: q, results });
    }

    return jsonResponse(
      { error: { code: "NOT_FOUND", message: `API endpoint not found: ${method} ${pathname}` } },
      404
    );
  } catch (err) {
    if (err instanceof ZodError) {
      const firstIssue = err.issues[0];
      return jsonResponse(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: firstIssue
              ? `${firstIssue.path.join(".") || "input"}: ${firstIssue.message}`
              : "Invalid input data.",
            issues: err.issues,
          },
        },
        400
      );
    }

    if (
      err instanceof AuthError ||
      err instanceof AccessDeniedError ||
      err instanceof ProviderCapabilityError ||
      err instanceof SecurityViolationError
    ) {
      const extraHeaders: Record<string, string> = {};
      if (err instanceof SecurityViolationError && err.retryAfterSeconds) {
        extraHeaders["Retry-After"] = String(err.retryAfterSeconds);
      }
      return jsonResponse(
        {
          error: {
            code: err.code,
            message: err.message,
          },
        },
        err.status,
        extraHeaders
      );
    }

    console.error("[Memoir API Error]", err instanceof Error ? err.message : "Unknown error");
    return jsonResponse(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected server error occurred.",
        },
      },
      500
    );
  }
}

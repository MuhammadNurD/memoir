# Memoir - Multilingual AI Meeting Notetaker & Knowledge Workspace

Memoir is a multilingual-first AI meeting notetaker and team knowledge workspace built with **React 19, TypeScript, Vite, Tailwind CSS v4, Motion (`motion/react`), `i18next`, Node.js SQLite (`node:sqlite` + FTS5 Unicode search), and Netlify Functions**.

---

## 1. Architecture Overview

- **Multilingual User Interface (`src/i18n/`)**:
  - Powered by `i18next`, `react-i18next`, and `i18next-browser-languagedetector`.
  - Ships with full UI translation catalogs for **English (`en`)**, **Afrikaans (`af`)**, **Spanish (`es`)**, **French (`fr`)**, **Japanese (`ja`)**, and **Arabic (`ar` with automatic `dir="rtl"` layout switching)**.
  - Persists language preferences in `localStorage` for unauthenticated visitors and syncs to the `users.ui_language` column across devices for authenticated users.
  - Formats dates, timestamps, durations, and numbers using locale-aware `Intl.DateTimeFormat` and `Intl.NumberFormat`.
- **Multilingual Transcription & AI Summaries (`src/server/ai-providers.ts`, `src/server/meetings-service.ts`)**:
  - Separates **meeting spoken language** (`spoken_language_config`), **detected language(s)** (`detected_language`, `detected_languages_json`, `is_code_switching`), **summary output language** (`output_language`), and **action items / decisions language** (`insights_language`).
  - Preserves the original source-language transcript untouched when generating or regenerating summaries in other languages.
  - Validates all AI outputs with Zod (`structuredAiSummaryOutputSchema`) and represents uncertain owners or deadlines as `null` ("Unknown") rather than inventing details.
- **Unicode & Diacritic-Insensitive Search (`src/server/db.ts`)**:
  - Uses SQLite FTS5 with `tokenize="unicode61 remove_diacritics 2"` plus Unicode NFD normalization so queries without accents (e.g. `reunion`) match accented content (`Réunion`) and non-Latin scripts (Japanese CJK, Arabic, Devanagari) are indexed and searchable.
  - Strictly enforces user ownership and workspace membership on every query.

---

## 2. Authentication Setup & Provider Configuration

### Why This Authentication Architecture Was Chosen
Memoir uses a standards-based server-side session and OpenID Connect (OIDC) / OAuth 2.0 implementation (`src/server/auth.ts` and `src/server/oauth-providers.ts`) backed by `HttpOnly; SameSite=Lax` cookies and SHA-256 hashed session tokens in SQLite. This eliminates third-party auth vendor lock-in while enforcing strict security invariants:
- Single-use CSRF `state`, `nonce`, and PKCE (`S256`) verification stored server-side (`oauth_states`).
- Identity resolution keyed by stable `(provider, provider_user_id)` (`sub`), never by mutable email addresses.
- **Zero automatic email merging**: If an unauthenticated OAuth login returns an email address that already belongs to an existing account, Memoir blocks automatic account merging (`ACCOUNT_LINK_PROOF_REQUIRED`) to prevent account-takeover attacks. Users must authenticate to their existing account first and link additional providers from **Settings**.

### Google Cloud OAuth 2.0 Configuration
1. Open the [Google Cloud Console](https://console.cloud.google.com/) and navigate to **APIs & Services > Credentials**.
2. Configure the **OAuth consent screen** with scopes `openid`, `email`, and `profile`.
3. Click **Create Credentials > OAuth client ID** and choose **Web application**.
4. Add Authorized JavaScript Origins:
   - Local development: `http://localhost:5173`
   - Production: `https://your-site.netlify.app`
5. Add Authorized Redirect URIs:
   - Local development: `http://localhost:5173/api/auth/callback/google`
   - Production: `https://your-site.netlify.app/api/auth/callback/google`
6. Copy the Client ID and Client Secret into `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Apple Developer (Sign in with Apple) Configuration
1. Sign in to the [Apple Developer Portal](https://developer.apple.com/account/resources/identifiers/list).
2. Create an **App ID** and enable the **Sign in with Apple** capability.
3. Create a **Services ID** (this serves as your web `APPLE_CLIENT_ID`, e.g., `com.yourcompany.memoir.web`).
4. Enable **Sign in with Apple** on the Services ID and configure **Domains and Subdomains** and **Return URLs**:
   - Production Return URL: `https://your-site.netlify.app/api/auth/callback/apple`
   - (Note: Apple requires HTTPS for live Return URLs; use a tunnel such as `ngrok` or Netlify Dev Live Tunnel when testing live Apple callbacks locally).
5. Under **Keys**, create a new key with **Sign in with Apple** enabled, download the `.p8` private key file, and record the **Key ID** (`APPLE_KEY_ID`) and your **Team ID** (`APPLE_TEAM_ID`).
6. Memoir's callback handler (`src/server/oauth-providers.ts`) automatically:
   - Signs the ES256 client secret JWT using `APPLE_TEAM_ID`, `APPLE_CLIENT_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`.
   - Parses Apple's `user` JSON payload on initial authorization.
   - Handles Apple's **Hide My Email** (`*@privaterelay.appleid.com`) addresses.
   - Resolves subsequent logins by Apple's stable `sub` claim even when Apple omits `email` and `name`.

### Required Environment Variables
Copy `.env.example` to `.env`:

| Variable | Description |
|---|---|
| `VITE_BRAND_NAME` | Configurable brand name (defaults to `Memoir`) |
| `APP_BASE_URL` | Base URL (`http://localhost:5173` locally, or production URL) |
| `AUTH_SESSION_SECRET` | Server secret for session signing |
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Web Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Web Client Secret |
| `APPLE_CLIENT_ID` | Apple Services ID |
| `APPLE_TEAM_ID` | 10-character Apple Developer Team ID |
| `APPLE_KEY_ID` | 10-character Apple Sign In Key ID |
| `APPLE_PRIVATE_KEY` | PEM-encoded `.p8` private key |
| `OPENAI_API_KEY` | Optional OpenAI key for Whisper audio transcription & GPT-4o-mini summaries |
| `GEMINI_API_KEY` | Optional Gemini key for multimodal audio transcription & summaries (auto-injected on Netlify AI Gateway) |
| `DEEPGRAM_API_KEY` | Optional Deepgram key for Nova-2 speaker-diarized audio transcription |

*Note on Verification Status*: Google and Apple OAuth flows are implemented end-to-end with CSRF state, PKCE, OIDC claim validation, and account-linking protection, and verified via automated integration tests. Live browser OAuth redirects require setting real `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` credentials in `.env`.

---

## 3. Running & Testing Locally

```bash
# Start local development server (Vite + API middleware)
npm run dev

# Run automated test suite (authentication, account isolation, multilingual workflows, Unicode search)
npm test

# Type-check and build production bundle
npm run build
```

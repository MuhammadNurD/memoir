import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import {
  Globe,
  ShieldCheck,
  Cpu,
  Trash2,
  Check,
  AlertCircle,
  Link2,
  Unlink,
} from "lucide-react";
import { useAuth } from "../client/AuthContext";
import { apiFetch } from "../client/api";
import {
  SUPPORTED_LANGUAGES,
  TRANSCRIPTION_PROVIDER_CAPABILITIES,
  UI_LOCALES,
  type TranscriptionProviderId,
} from "../shared/languages";

export function SettingsPage() {
  const { t } = useTranslation();
  const {
    user,
    identities,
    oauthProviders,
    aiProviders,
    updatePreferences,
    refreshSession,
  } = useAuth();
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();

  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [uiLanguage, setUiLanguage] = useState(user?.uiLanguage || "en");
  const [defaultSpokenLanguage, setDefaultSpokenLanguage] = useState(
    user?.defaultSpokenLanguage || "auto"
  );
  const [defaultSummaryLanguage, setDefaultSummaryLanguage] = useState(
    user?.defaultSummaryLanguage || "en"
  );
  const [defaultInsightsLanguage, setDefaultInsightsLanguage] = useState(
    user?.defaultInsightsLanguage || "en"
  );
  const [preferredProvider, setPreferredProvider] = useState<
    TranscriptionProviderId | "auto"
  >(user?.preferredTranscriptionProvider || "whisper-local");

  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updatePreferences({
        displayName,
        uiLanguage,
        defaultSpokenLanguage,
        defaultSummaryLanguage,
        defaultInsightsLanguage,
        preferredTranscriptionProvider: preferredProvider,
      });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleLinkOAuthProvider = async (provider: "google" | "apple") => {
    setError(null);
    try {
      const res = await apiFetch<{ authorizationUrl: string }>(
        `/api/auth/oauth/${provider}/start?intent=link&redirectTo=/settings`,
        { method: "POST" }
      );
      window.location.href = res.authorizationUrl;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("auth.providerNotConfigured", { provider })
      );
    }
  };

  const handleUnlinkIdentity = async (identityId: string) => {
    setError(null);
    try {
      await apiFetch(`/api/auth/identities/${identityId}`, { method: "DELETE" });
      await refreshSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlink identity.");
    }
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm(t("settings.deleteAccountConfirm"))) return;
    await apiFetch("/api/user/account", { method: "DELETE" });
    await refreshSession();
    navigate("/login");
  };

  const googleIdentity = identities.find((i) => i.provider === "google");
  const appleIdentity = identities.find((i) => i.provider === "apple");

  return (
    <motion.div
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-8 max-w-4xl"
    >
      <div className="border-b border-[#101626]/10 pb-5 dark:border-white/10">
        <span className="text-[11px] font-mono uppercase tracking-widest text-[#5B5BF0] dark:text-[#22D3EE]">
          Preferences
        </span>
        <h1 className="font-serif-editorial text-4xl sm:text-5xl tracking-tight text-[#101626] dark:text-white">
          {t("settings.title")}
        </h1>
        <p className="mt-1 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
          {t("settings.subtitle")}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* 1. Language & Studio Preferences */}
      <form
        onSubmit={handleSavePreferences}
        className="rounded-[2rem] border border-[#101626]/10 bg-white p-7 space-y-5 shadow-[0_8px_30px_rgba(16,22,38,0.03)] dark:border-white/10 dark:bg-[#13192B]"
      >
        <div className="flex items-center gap-2.5 border-b border-[#101626]/10 pb-4 dark:border-white/10">
          <Globe className="h-5 w-5 text-[#5B5BF0]" />
          <h2 className="font-serif-editorial text-2xl text-[#101626] dark:text-white">
            {t("settings.languageSection")}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300 mb-1">
              {t("auth.displayNameLabel")}
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-xl border border-[#101626]/12 bg-[#F7F6F2] px-3.5 py-2.5 text-xs font-medium text-[#101626] dark:border-white/15 dark:bg-[#0B0F1A] dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300 mb-1">
              {t("settings.uiLanguageLabel")}
            </label>
            <select
              value={uiLanguage}
              onChange={(e) => setUiLanguage(e.target.value)}
              className="w-full rounded-xl border border-[#101626]/12 bg-[#F7F6F2] px-3.5 py-2.5 text-xs font-medium text-[#101626] dark:border-white/15 dark:bg-[#0B0F1A] dark:text-white"
            >
              {UI_LOCALES.map((loc) => (
                <option key={loc.tag} value={loc.tag}>
                  {loc.nativeName} - {loc.englishName} ({loc.tag.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300 mb-1">
              {t("settings.defaultSpokenLabel")}
            </label>
            <select
              value={defaultSpokenLanguage}
              onChange={(e) => setDefaultSpokenLanguage(e.target.value)}
              className="w-full rounded-xl border border-[#101626]/12 bg-[#F7F6F2] px-3.5 py-2.5 text-xs font-medium text-[#101626] dark:border-white/15 dark:bg-[#0B0F1A] dark:text-white"
            >
              <option value="auto">{t("app.autoDetect")}</option>
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.tag} value={l.tag}>
                  {l.nativeName} - {l.englishName} ({l.tag})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300 mb-1">
              {t("settings.defaultSummaryLabel")}
            </label>
            <select
              value={defaultSummaryLanguage}
              onChange={(e) => setDefaultSummaryLanguage(e.target.value)}
              className="w-full rounded-xl border border-[#101626]/12 bg-[#F7F6F2] px-3.5 py-2.5 text-xs font-medium text-[#101626] dark:border-white/15 dark:bg-[#0B0F1A] dark:text-white"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.tag} value={l.tag}>
                  {l.nativeName} - {l.englishName} ({l.tag})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300 mb-1">
              {t("settings.defaultInsightsLabel")}
            </label>
            <select
              value={defaultInsightsLanguage}
              onChange={(e) => setDefaultInsightsLanguage(e.target.value)}
              className="w-full rounded-xl border border-[#101626]/12 bg-[#F7F6F2] px-3.5 py-2.5 text-xs font-medium text-[#101626] dark:border-white/15 dark:bg-[#0B0F1A] dark:text-white"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.tag} value={l.tag}>
                  {l.nativeName} - {l.englishName} ({l.tag})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300 mb-1">
              {t("meetings.providerLabel")}
            </label>
            <select
              value={preferredProvider}
              onChange={(e) =>
                setPreferredProvider(e.target.value as TranscriptionProviderId | "auto")
              }
              className="w-full rounded-xl border border-[#101626]/12 bg-[#F7F6F2] px-3.5 py-2.5 text-xs font-medium text-[#101626] dark:border-white/15 dark:bg-[#0B0F1A] dark:text-white"
            >
              <option value="whisper-local">
                Free Built-in Whisper ONNX (Zero API Key)
              </option>
              <option value="auto">Auto (Best available provider)</option>
              <option value="gemini">Google Gemini Multimodal Audio</option>
              <option value="openai">OpenAI Whisper</option>
              <option value="deepgram">Deepgram Nova-2</option>
              <option value="transcript-import">Structured Transcript Parser</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          {savedNotice && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
              <Check className="h-4 w-4" />
              {t("app.saved")}
            </span>
          )}
          <motion.button
            type="submit"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={saving}
            className="rounded-full bg-[#101626] px-6 py-2.5 text-xs font-semibold text-white hover:bg-[#5B5BF0] disabled:opacity-50 transition-colors cursor-pointer dark:bg-[#5B5BF0]"
          >
            {saving ? t("app.saving") : t("app.save")}
          </motion.button>
        </div>
      </form>

      {/* 2. Authentication & Linked Identities */}
      <div className="rounded-[2rem] border border-[#101626]/10 bg-white p-7 space-y-5 shadow-[0_8px_30px_rgba(16,22,38,0.03)] dark:border-white/10 dark:bg-[#13192B]">
        <div className="flex items-center gap-2.5 border-b border-[#101626]/10 pb-4 dark:border-white/10">
          <ShieldCheck className="h-5 w-5 text-[#5B5BF0]" />
          <div>
            <h2 className="font-serif-editorial text-2xl text-[#101626] dark:text-white">
              {t("settings.accountsSection")}
            </h2>
            <p className="text-xs text-zinc-500">
              {t("settings.accountsDescription")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {/* Google */}
          <div className="flex items-center justify-between rounded-2xl bg-[#F7F6F2] p-4 text-xs dark:bg-[#0B0F1A]">
            <div>
              <div className="font-bold text-[#101626] dark:text-white">Google</div>
              <div className="text-zinc-500 mt-0.5">
                {googleIdentity
                  ? `${t("settings.linkedStatus")} (${googleIdentity.providerEmail || googleIdentity.providerUserId})`
                  : oauthProviders?.google.configured
                    ? t("settings.notLinkedStatus")
                    : "Ready once GOOGLE_CLIENT_ID is set"}
              </div>
            </div>

            {googleIdentity ? (
              <button
                type="button"
                disabled={identities.length <= 1}
                onClick={() => handleUnlinkIdentity(googleIdentity.id)}
                className="inline-flex items-center gap-1 rounded-full border border-[#101626]/15 px-3 py-1.5 text-xs font-semibold hover:bg-white disabled:opacity-40 cursor-pointer"
              >
                <Unlink className="h-3.5 w-3.5" />
                <span>{t("settings.unlinkProvider")}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleLinkOAuthProvider("google")}
                className="inline-flex items-center gap-1 rounded-full bg-[#101626] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#5B5BF0] cursor-pointer dark:bg-[#5B5BF0]"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>{t("settings.linkProvider", { provider: "Google" })}</span>
              </button>
            )}
          </div>

          {/* Apple */}
          <div className="flex items-center justify-between rounded-2xl bg-[#F7F6F2] p-4 text-xs dark:bg-[#0B0F1A]">
            <div>
              <div className="font-bold text-[#101626] dark:text-white">Apple ID</div>
              <div className="text-zinc-500 mt-0.5">
                {appleIdentity
                  ? `${t("settings.linkedStatus")} (${appleIdentity.providerEmail || appleIdentity.providerUserId})`
                  : oauthProviders?.apple.configured
                    ? t("settings.notLinkedStatus")
                    : "Ready once APPLE_CLIENT_ID is set"}
              </div>
            </div>

            {appleIdentity ? (
              <button
                type="button"
                disabled={identities.length <= 1}
                onClick={() => handleUnlinkIdentity(appleIdentity.id)}
                className="inline-flex items-center gap-1 rounded-full border border-[#101626]/15 px-3 py-1.5 text-xs font-semibold hover:bg-white disabled:opacity-40 cursor-pointer"
              >
                <Unlink className="h-3.5 w-3.5" />
                <span>{t("settings.unlinkProvider")}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleLinkOAuthProvider("apple")}
                className="inline-flex items-center gap-1 rounded-full bg-[#101626] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#5B5BF0] cursor-pointer dark:bg-[#5B5BF0]"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>{t("settings.linkProvider", { provider: "Apple" })}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 3. Studio Transcription Engines */}
      <div className="rounded-[2rem] border border-[#101626]/10 bg-white p-7 space-y-5 shadow-[0_8px_30px_rgba(16,22,38,0.03)] dark:border-white/10 dark:bg-[#13192B]">
        <div className="flex items-center gap-2.5 border-b border-[#101626]/10 pb-4 dark:border-white/10">
          <Cpu className="h-5 w-5 text-[#5B5BF0]" />
          <h2 className="font-serif-editorial text-2xl text-[#101626] dark:text-white">
            {t("settings.providersSection")}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {Object.values(TRANSCRIPTION_PROVIDER_CAPABILITIES).map((cap) => {
            const isActive =
              cap.id === "transcript-import" || cap.id === "whisper-local"
                ? true
                : Boolean(aiProviders?.transcription[cap.id]);
            return (
              <div
                key={cap.id}
                className="rounded-2xl bg-[#F7F6F2] p-4 text-xs space-y-1.5 dark:bg-[#0B0F1A]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[#101626] dark:text-white">
                    {cap.name}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                      isActive
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-zinc-200/70 text-zinc-600 dark:bg-white/10 dark:text-zinc-400"
                    }`}
                  >
                    {isActive ? "Active" : "Optional API Key"}
                  </span>
                </div>
                <p className="text-zinc-500 leading-relaxed">{cap.notes}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Privacy & Account Deletion */}
      <div className="rounded-[2rem] border border-red-200/80 bg-white p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 dark:border-red-900/40 dark:bg-[#13192B]">
        <div>
          <h2 className="font-serif-editorial text-2xl text-red-700 dark:text-red-400">
            {t("settings.privacySection")}
          </h2>
          <p className="text-xs text-zinc-500">
            Permanently remove your profile, audio recordings, and all multilingual transcripts.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDeleteAccount}
          className="inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-red-500 shrink-0 cursor-pointer"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>{t("settings.deleteAccount")}</span>
        </button>
      </div>
    </motion.div>
  );
}

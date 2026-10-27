import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Globe,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Wand2,
  Zap,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { BRAND } from "../config/brand";
import { UI_LOCALES } from "../shared/languages";
import { changeInterfaceLanguage } from "../i18n";
import { useAuth } from "../client/AuthContext";
import { apiFetch } from "../client/api";
import { BrandLogoMark, BrandFooter, LivingWaveformBar } from "../components/BrandLogo";

function GoogleBrandLogo() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.275c0-.85-.075-1.675-.215-2.475H12v4.69h6.445c-.28 1.495-1.125 2.765-2.395 3.615v3.005h3.875c2.265-2.085 3.565-5.16 3.565-8.835z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.955-1.075 7.94-2.91l-3.875-3.005c-1.075.72-2.45 1.15-4.065 1.15-3.125 0-5.775-2.11-6.72-4.945H1.275v3.1C3.25 21.305 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.29c-.24-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.61H1.275C.465 8.23 0 10.06 0 12s.465 3.77 1.275 5.39l4.005-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.605 4.585 1.795l3.435-3.435C17.95 1.19 15.235 0 12 0 7.31 0 3.25 2.695 1.275 6.61l4.005 3.1c.945-2.835 3.595-4.96 6.72-4.96z"
      />
    </svg>
  );
}

function AppleBrandLogo() {
  return (
    <svg className="h-4 w-4 shrink-0 fill-current" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

const LIVE_SHOWCASE_SNIPPETS = [
  {
    lang: "Afrikaans + English",
    quote: "“Ons het besluit om die nuwe produk op 15 November vry te stel.”",
    insight: "Decision captured · Launch date locked for 15 Nov",
  },
  {
    lang: "Français",
    quote: "“Claire documentera l'architecture de sécurité avant vendredi.”",
    insight: "Action assigned to Claire · Due Friday",
  },
  {
    lang: "日本語 → English Summary",
    quote: "“多言語文字起こしエンジンの検証結果を共有します。”",
    insight: "Translated to English · Original Japanese preserved",
  },
];

export function AuthPage() {
  const { t, i18n } = useTranslation();
  const { authenticated, refreshSession } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const shouldReduceMotion = useReducedMotion();

  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkToken, setMagicLinkToken] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [newResetPassword, setNewResetPassword] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);
  const [showcaseIndex, setShowcaseIndex] = useState(0);

  const isLocalhost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "::1");

  useEffect(() => {
    if (authenticated) {
      navigate("/", { replace: true });
    }
  }, [authenticated, navigate]);

  useEffect(() => {
    const oauthErr = searchParams.get("oauth_error");
    const prov = searchParams.get("provider");
    if (oauthErr) {
      setError(
        t("auth.oauthCancelled", {
          provider: prov === "apple" ? "Apple" : "Google",
        })
      );
    }
  }, [searchParams, t]);

  useEffect(() => {
    if (shouldReduceMotion) return;
    const timer = window.setInterval(() => {
      setShowcaseIndex((i) => (i + 1) % LIVE_SHOWCASE_SNIPPETS.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [shouldReduceMotion]);

  const currentUiLang = (i18n.language || "en").split("-")[0];

  const handleOAuthStart = async (provider: "google" | "apple") => {
    setError(null);
    setOauthLoading(provider);
    try {
      const res = await apiFetch<{ authorizationUrl: string }>(
        `/api/auth/oauth/${provider}/start`,
        { method: "POST" }
      );
      window.location.href = res.authorizationUrl;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("auth.providerNotConfigured", {
              provider: provider === "apple" ? "Apple" : "Google",
            })
      );
      setOauthLoading(null);
    }
  };

  const handleLocalDevQuickLogin = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/api/auth/local-dev", { method: "POST" });
      await refreshSession();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Localhost login failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await apiFetch("/api/auth/signup", {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            displayName,
            uiLanguage: currentUiLang,
          }),
        });
      } else {
        await apiFetch("/api/auth/signin", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
      }
      await refreshSession();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleMagicLinkRequest = async () => {
    if (!email.trim()) {
      setError("Please enter your email address first.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ verificationToken: string }>("/api/auth/magic-link/request", {
        method: "POST",
        body: JSON.stringify({ email, uiLanguage: currentUiLang }),
      });
      setMagicLinkToken(res.verificationToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send magic link.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteMagicLink = async () => {
    if (!magicLinkToken) return;
    setSubmitting(true);
    try {
      await apiFetch("/api/auth/magic-link/verify", {
        method: "POST",
        body: JSON.stringify({ token: magicLinkToken }),
      });
      await refreshSession();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Magic link verification failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch<{ resetToken: string | null }>(
        "/api/auth/password-reset/request",
        {
          method: "POST",
          body: JSON.stringify({ email }),
        }
      );
      setResetToken(res.resetToken || "token-sent-if-account-exists");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset request failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/api/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token: resetToken, newPassword: newResetPassword }),
      });
      setResetSuccess(true);
      setResetToken(null);
      setMode("signin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setSubmitting(false);
    }
  };

  const activeSnippet = LIVE_SHOWCASE_SNIPPETS[showcaseIndex];

  return (
    <div className="min-h-screen flex flex-col justify-between memoir-paper-surface p-4 sm:p-6 lg:p-8">
      {/* Top Studio Header */}
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <div className="flex items-center gap-3">
          <BrandLogoMark className="h-10 w-10" />
          <div>
            <span className="font-serif-editorial italic text-3xl tracking-tight text-[#101626] dark:text-white leading-none">
              {BRAND.wordmark}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-[#101626]/10 bg-white/80 px-3 py-1.5 backdrop-blur-md dark:border-white/10 dark:bg-[#13192B]">
          <Globe className="h-3.5 w-3.5 text-[#5B5BF0] dark:text-[#22D3EE]" />
          <select
            aria-label={t("nav.interfaceLanguage")}
            value={currentUiLang}
            onChange={(e) => changeInterfaceLanguage(e.target.value)}
            className="bg-transparent text-xs font-semibold text-[#101626] focus:outline-none cursor-pointer dark:text-zinc-200"
          >
            {UI_LOCALES.map((loc) => (
              <option
                key={loc.tag}
                value={loc.tag}
                className="bg-white text-[#101626] dark:bg-[#101626] dark:text-white"
              >
                {loc.nativeName} ({loc.tag.toUpperCase()})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Split Editorial Showcase & Auth Experience */}
      <div className="mx-auto my-auto w-full max-w-6xl py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Column: Living Sound-to-Memory Editorial Sculpture */}
          <motion.div
            initial={{ opacity: 0, x: shouldReduceMotion ? 0 : -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="lg:col-span-7 relative overflow-hidden rounded-[2rem] bg-[#101626] p-8 sm:p-12 text-white shadow-[0_24px_60px_rgba(16,22,38,0.18)]"
          >
            {/* Ambient Violet & Soft Cyan Glows */}
            <div
              className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-[#5B5BF0]/30 blur-3xl"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-[#22D3EE]/20 blur-3xl"
              aria-hidden="true"
            />

            <div className="relative z-10 space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1 text-xs font-medium text-[#22D3EE]">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Multilingual Audio &amp; Conversation Studio</span>
              </div>

              <div className="space-y-3">
                <h1 className="font-serif-editorial text-4xl sm:text-6xl leading-[1.05] tracking-tight text-white">
                  Every conversation,{" "}
                  <span className="italic text-[#22D3EE]">remembered.</span>
                </h1>
                <p className="max-w-xl text-sm sm:text-base text-zinc-300 leading-relaxed">
                  Record live meetings or drop any audio file. Memoir listens across languages,
                  preserves every word, and distills clear decisions and next steps in the
                  language you choose.
                </p>
              </div>

              {/* Interactive Animated Soundwave to Journal Card */}
              <div className="rounded-2xl border border-white/12 bg-white/[0.06] p-5 backdrop-blur-md space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
                    <span className="h-2 w-2 rounded-full bg-[#22D3EE]" />
                    <span>Live Multilingual Capture</span>
                  </div>
                  <LivingWaveformBar bars={20} className="h-8" />
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={showcaseIndex}
                    initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -8 }}
                    transition={{ duration: 0.28 }}
                    className="space-y-2 border-t border-white/10 pt-3.5"
                  >
                    <div className="text-[11px] font-mono uppercase tracking-wider text-[#22D3EE]">
                      {activeSnippet.lang}
                    </div>
                    <p className="font-serif-editorial italic text-xl sm:text-2xl text-white">
                      {activeSnippet.quote}
                    </p>
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-[#5B5BF0]/30 px-3 py-1 text-xs font-medium text-indigo-200">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#22D3EE]" />
                      <span>{activeSnippet.insight}</span>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-2 text-xs text-zinc-400">
                <div>
                  <div className="font-semibold text-white">11+ Languages</div>
                  <div>Code-switching aware</div>
                </div>
                <div>
                  <div className="font-semibold text-white">Free Local Whisper</div>
                  <div>Zero API keys needed</div>
                </div>
                <div>
                  <div className="font-semibold text-white">Pen-Test Hardened</div>
                  <div>Strict account isolation</div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Right Column: Clean, Welcoming Sign-In Studio */}
          <motion.div
            initial={{ opacity: 0, x: shouldReduceMotion ? 0 : 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, ease: "easeOut", delay: 0.05 }}
            className="lg:col-span-5"
          >
            <div className="rounded-[2rem] border border-[#101626]/10 bg-white p-7 sm:p-9 shadow-[0_20px_50px_rgba(16,22,38,0.07)] dark:border-white/10 dark:bg-[#13192B]">
              <div className="space-y-1.5">
                <h2 className="font-serif-editorial text-3xl tracking-tight text-[#101626] dark:text-white">
                  {mode === "signin"
                    ? t("auth.signInTitle", { brand: BRAND.name })
                    : mode === "signup"
                      ? t("auth.signUpTitle", { brand: BRAND.name })
                      : t("auth.resetPasswordTitle")}
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {mode === "signin"
                    ? t("auth.signInSubtitle")
                    : mode === "signup"
                      ? t("auth.signUpSubtitle")
                      : t("auth.resetPasswordSubtitle")}
                </p>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50/90 p-3.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </motion.div>
              )}

              {resetSuccess && (
                <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Password updated. You can now sign in with your new password.</span>
                </div>
              )}

              {magicLinkToken && (
                <div className="mt-4 space-y-2 rounded-2xl border border-[#5B5BF0]/30 bg-[#5B5BF0]/5 p-4 text-xs text-[#101626] dark:text-indigo-200">
                  <p className="font-medium">{t("auth.magicLinkSent")}</p>
                  <button
                    type="button"
                    onClick={handleCompleteMagicLink}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#5B5BF0] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#4A4AE0] cursor-pointer"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    <span>{t("auth.useMagicLinkNow")}</span>
                  </button>
                </div>
              )}

              {mode !== "reset" && (
                <>
                  {/* Instant Localhost Entry Button */}
                  {isLocalhost && (
                    <motion.button
                      type="button"
                      whileHover={shouldReduceMotion ? undefined : { scale: 1.01 }}
                      whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
                      disabled={submitting}
                      onClick={handleLocalDevQuickLogin}
                      className="mt-5 flex w-full items-center justify-between rounded-2xl bg-gradient-to-r from-[#101626] via-[#1C2541] to-[#5B5BF0] p-4 text-left text-white shadow-md hover:shadow-lg transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-[#22D3EE]">
                          <Zap className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold tracking-tight">
                            Enter Local Studio Immediately
                          </div>
                          <div className="text-[11px] text-zinc-300">
                            One-click localhost sign-in · No setup required
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-[#22D3EE] shrink-0" />
                    </motion.button>
                  )}

                  {/* First-Class Google & Apple Sign-In */}
                  <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <motion.button
                      type="button"
                      whileHover={shouldReduceMotion ? undefined : { y: -1 }}
                      whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                      onClick={() => handleOAuthStart("google")}
                      disabled={oauthLoading !== null}
                      aria-label={t("auth.continueWithGoogle")}
                      className="flex items-center justify-center gap-2 rounded-full border border-[#101626]/15 bg-[#F7F6F2] px-4 py-2.5 text-xs font-semibold text-[#101626] hover:bg-[#EFECE6] transition-colors disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-white cursor-pointer"
                    >
                      {oauthLoading === "google" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <GoogleBrandLogo />
                      )}
                      <span>Google</span>
                    </motion.button>

                    <motion.button
                      type="button"
                      whileHover={shouldReduceMotion ? undefined : { y: -1 }}
                      whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                      onClick={() => handleOAuthStart("apple")}
                      disabled={oauthLoading !== null}
                      aria-label={t("auth.continueWithApple")}
                      className="flex items-center justify-center gap-2 rounded-full bg-[#101626] px-4 py-2.5 text-xs font-semibold text-white hover:bg-black transition-colors disabled:opacity-50 dark:bg-white dark:text-[#101626] cursor-pointer"
                    >
                      {oauthLoading === "apple" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <AppleBrandLogo />
                      )}
                      <span>Apple</span>
                    </motion.button>
                  </div>

                  <div className="relative my-5">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-[#101626]/10 dark:border-white/10" />
                    </div>
                    <div className="relative flex justify-center text-[11px]">
                      <span className="bg-white px-3 text-zinc-400 dark:bg-[#13192B]">
                        {t("auth.orContinueWithEmail")}
                      </span>
                    </div>
                  </div>

                  <form onSubmit={handleEmailAuth} className="space-y-3.5">
                    {mode === "signup" && (
                      <div>
                        <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300 mb-1">
                          {t("auth.displayNameLabel")}
                        </label>
                        <input
                          type="text"
                          required
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder={t("auth.displayNamePlaceholder")}
                          className="w-full rounded-xl border border-[#101626]/15 bg-[#F7F6F2]/70 px-3.5 py-2.5 text-sm text-[#101626] focus:border-[#5B5BF0] focus:bg-white focus:outline-none dark:border-white/15 dark:bg-white/5 dark:text-white"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300 mb-1">
                        {t("auth.emailLabel")}
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t("auth.emailPlaceholder")}
                        className="w-full rounded-xl border border-[#101626]/15 bg-[#F7F6F2]/70 px-3.5 py-2.5 text-sm text-[#101626] focus:border-[#5B5BF0] focus:bg-white focus:outline-none dark:border-white/15 dark:bg-white/5 dark:text-white"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300">
                          {t("auth.passwordLabel")}
                        </label>
                        {mode === "signin" && (
                          <button
                            type="button"
                            onClick={() => {
                              setMode("reset");
                              setError(null);
                            }}
                            className="text-xs font-medium text-[#5B5BF0] hover:underline cursor-pointer"
                          >
                            {t("auth.forgotPassword")}
                          </button>
                        )}
                      </div>
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t("auth.passwordPlaceholder")}
                        className="w-full rounded-xl border border-[#101626]/15 bg-[#F7F6F2]/70 px-3.5 py-2.5 text-sm text-[#101626] focus:border-[#5B5BF0] focus:bg-white focus:outline-none dark:border-white/15 dark:bg-white/5 dark:text-white"
                      />
                    </div>

                    <motion.button
                      type="submit"
                      whileHover={shouldReduceMotion ? undefined : { scale: 1.01 }}
                      whileTap={shouldReduceMotion ? undefined : { scale: 0.99 }}
                      disabled={submitting}
                      className="flex w-full items-center justify-center gap-2 rounded-full bg-[#5B5BF0] px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(91,91,240,0.3)] hover:bg-[#4A4AE0] transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                      <span>
                        {mode === "signin" ? t("auth.signInButton") : t("auth.signUpButton")}
                      </span>
                    </motion.button>

                    <button
                      type="button"
                      onClick={handleMagicLinkRequest}
                      disabled={submitting}
                      className="flex w-full items-center justify-center gap-1.5 rounded-full border border-[#101626]/10 bg-transparent px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-[#F7F6F2] dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5 cursor-pointer"
                    >
                      <Wand2 className="h-3.5 w-3.5 text-[#5B5BF0]" />
                      <span>{t("auth.sendMagicLink")}</span>
                    </button>
                  </form>

                  <div className="mt-5 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setMode(mode === "signin" ? "signup" : "signin");
                        setError(null);
                      }}
                      className="text-xs font-semibold text-zinc-600 hover:text-[#101626] dark:text-zinc-400 dark:hover:text-white cursor-pointer"
                    >
                      {mode === "signin" ? t("auth.SwitchToSignUp") : t("auth.switchToSignIn")}
                    </button>
                  </div>
                </>
              )}

              {mode === "reset" && (
                <div className="mt-5 space-y-4">
                  {!resetToken ? (
                    <form onSubmit={handleResetRequest} className="space-y-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300 mb-1">
                          {t("auth.emailLabel")}
                        </label>
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder={t("auth.emailPlaceholder")}
                          className="w-full rounded-xl border border-[#101626]/15 bg-[#F7F6F2] px-3.5 py-2.5 text-sm"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={submitting}
                        className="w-full rounded-full bg-[#5B5BF0] px-4 py-2.5 text-sm font-semibold text-white cursor-pointer"
                      >
                        {t("auth.sendResetLink")}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleConfirmReset} className="space-y-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300 mb-1">
                          New Password
                        </label>
                        <input
                          type="password"
                          required
                          minLength={8}
                          value={newResetPassword}
                          onChange={(e) => setNewResetPassword(e.target.value)}
                          placeholder={t("auth.passwordPlaceholder")}
                          className="w-full rounded-xl border border-[#101626]/15 bg-[#F7F6F2] px-3.5 py-2.5 text-sm"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={submitting}
                        className="w-full rounded-full bg-[#5B5BF0] px-4 py-2.5 text-sm font-semibold text-white cursor-pointer"
                      >
                        Confirm New Password
                      </button>
                    </form>
                  )}

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setMode("signin");
                        setResetToken(null);
                        setError(null);
                      }}
                      className="text-xs font-semibold text-zinc-600 hover:text-[#101626] cursor-pointer"
                    >
                      {t("auth.backToSignIn")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      <footer className="mx-auto w-full max-w-6xl pt-4 border-t border-[#101626]/10 dark:border-white/10">
        <BrandFooter />
      </footer>
    </div>
  );
}

import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import { Search as SearchIcon, Loader2, ArrowUpRight, Sparkles } from "lucide-react";
import { apiFetch } from "../client/api";
import type { SearchResultItem } from "../shared/types";
import { SUPPORTED_LANGUAGES } from "../shared/languages";
import { formatLocaleDate, formatTimestampMs } from "../i18n/formatters";
import { LanguageBadge } from "../components/LanguageBadge";

export function SearchPage() {
  const { t, i18n } = useTranslation();
  const shouldReduceMotion = useReducedMotion();

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [language, setLanguage] = useState("all");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchedOnce, setSearchedOnce] = useState(false);

  const runSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults([]);
      setSearchedOnce(false);
      return;
    }

    setLoading(true);
    setSearchedOnce(true);
    try {
      const params = new URLSearchParams({
        q: query.trim(),
        scope,
        language,
      });
      const res = await apiFetch<{ results: SearchResultItem[] }>(
        `/api/search?${params.toString()}`
      );
      setResults(res.results);
    } finally {
      setLoading(false);
    }
  }, [query, scope, language]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      runSearch();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [runSearch]);

  const quickExamples = [
    { label: "Réunion (accent-insensitive)", q: "reunion" },
    { label: "Kaapstad (Afrikaans)", q: "Kaapstad" },
    { label: "文字起こし (Japanese)", q: "文字起こし" },
    { label: "OAuth", q: "OAuth" },
  ];

  const scopes = [
    { id: "all", label: t("search.scopeAll") },
    { id: "transcript", label: t("search.scopeTranscript") },
    { id: "summary", label: t("search.scopeSummary") },
    { id: "decision", label: t("search.scopeDecision") },
    { id: "action_item", label: t("search.scopeActionItem") },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-8"
    >
      {/* Editorial Search Masthead */}
      <div className="rounded-[2rem] bg-[#101626] p-8 sm:p-10 text-white shadow-[0_20px_50px_rgba(16,22,38,0.16)] space-y-6">
        <div className="space-y-2 max-w-2xl">
          <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest text-[#22D3EE]">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Deep Recall across Scripts &amp; Accents</span>
          </div>
          <h1 className="font-serif-editorial text-4xl sm:text-5xl tracking-tight">
            {t("search.title")}
          </h1>
          <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
            {t("search.subtitle")}
          </p>
        </div>

        {/* Large Spotlight Search Input */}
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-5 top-4 h-5 w-5 text-[#22D3EE]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.inputPlaceholder")}
            className="w-full rounded-2xl border border-white/15 bg-white/10 pl-13 pr-5 py-3.5 text-sm sm:text-base text-white placeholder:text-zinc-400 focus:border-[#22D3EE] focus:bg-white/15 focus:outline-none backdrop-blur-md"
          />
        </div>

        {/* Scope Pills + Language Filter + Instant Query Chips */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {scopes.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScope(s.id)}
                className={`rounded-full px-3.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                  scope === s.id
                    ? "bg-[#22D3EE] text-[#101626]"
                    : "bg-white/10 text-zinc-300 hover:bg-white/20"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-semibold text-white focus:outline-none"
          >
            <option value="all" className="text-[#101626]">
              {t("meetings.filterAllLanguages")}
            </option>
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.tag} value={l.tag} className="text-[#101626]">
                {l.nativeName} ({l.tag.toUpperCase()})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10 text-xs">
          <span className="text-zinc-400">Try instant recall:</span>
          {quickExamples.map((ex) => (
            <button
              key={ex.q}
              type="button"
              onClick={() => setQuery(ex.q)}
              className="rounded-full border border-white/15 bg-white/5 px-3 py-0.5 text-[11px] font-medium text-zinc-200 hover:border-[#22D3EE] hover:text-[#22D3EE] transition-colors cursor-pointer"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results Stream */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-xs text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#5B5BF0]" />
          {t("app.loading")}
        </div>
      ) : searchedOnce && results.length === 0 ? (
        <div className="rounded-[2rem] border border-[#101626]/10 bg-white p-12 text-center text-sm text-zinc-500 dark:border-white/10 dark:bg-[#13192B]">
          {t("search.noResults", { query })}
        </div>
      ) : results.length > 0 ? (
        <div className="space-y-4">
          <div className="text-xs font-mono uppercase tracking-wider text-zinc-500">
            {t("search.resultsCount", { count: results.length })}
          </div>

          <div className="space-y-3">
            {results.map((r, idx) => (
              <motion.div
                key={`${r.meetingId}-${r.matchSource}-${idx}`}
                initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03, duration: 0.22 }}
                className="rounded-2xl border border-[#101626]/8 bg-white p-5 space-y-3 shadow-[0_4px_20px_rgba(16,22,38,0.03)] dark:border-white/10 dark:bg-[#13192B]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Link
                      to={`/meetings/${r.meetingId}`}
                      className="inline-flex items-center gap-1 font-serif-editorial text-2xl text-[#101626] hover:text-[#5B5BF0] dark:text-white dark:hover:text-[#22D3EE]"
                    >
                      <span>{r.meetingTitle}</span>
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                    <span className="rounded-full bg-[#5B5BF0]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase text-[#5B5BF0] dark:text-[#22D3EE]">
                      {r.matchSource.replace("_", " ")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
                    <LanguageBadge tag={r.matchLanguage} />
                    <span>{formatLocaleDate(r.recordedAt, i18n.language)}</span>
                  </div>
                </div>

                <div className="rounded-xl bg-[#F7F6F2] p-3.5 text-xs sm:text-sm text-[#101626]/85 leading-relaxed dark:bg-[#0B0F1A] dark:text-zinc-300">
                  {r.timestampMs !== null && (
                    <span className="font-mono font-bold text-[#5B5BF0] mr-2 dark:text-[#22D3EE]">
                      [{formatTimestampMs(r.timestampMs)}]
                    </span>
                  )}
                  {r.speaker && <strong className="mr-1.5">{r.speaker}:</strong>}
                  <span>{r.snippet}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}

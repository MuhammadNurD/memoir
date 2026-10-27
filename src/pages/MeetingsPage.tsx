import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import {
  Mic,
  Search,
  Trash2,
  Loader2,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
import { apiFetch } from "../client/api";
import type { MeetingRecord } from "../shared/types";
import { SUPPORTED_LANGUAGES } from "../shared/languages";
import { formatDurationSeconds, formatLocaleDateTime } from "../i18n/formatters";
import { LanguageBadge } from "../components/LanguageBadge";
import { LivingWaveformBar } from "../components/BrandLogo";

export function MeetingsPage({
  onOpenNewMeeting,
  refreshTrigger,
}: {
  onOpenNewMeeting: () => void;
  refreshTrigger: number;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();

  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [queryFilter, setQueryFilter] = useState("");
  const [seeding, setSeeding] = useState(false);

  const loadMeetings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (languageFilter !== "all") params.set("language", languageFilter);
      if (queryFilter.trim()) params.set("query", queryFilter.trim());

      const res = await apiFetch<{ meetings: MeetingRecord[] }>(
        `/api/meetings?${params.toString()}`
      );
      setMeetings(res.meetings);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, languageFilter, queryFilter]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings, refreshTrigger]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await apiFetch(`/api/meetings/${id}`, { method: "DELETE" });
    await loadMeetings();
  };

  const handleSeedSamples = async () => {
    setSeeding(true);
    try {
      await apiFetch("/api/meetings/seed-samples", { method: "POST" });
      await loadMeetings();
    } finally {
      setSeeding(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-8"
    >
      {/* Editorial Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#101626]/10 pb-6 dark:border-white/10">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-widest text-[#5B5BF0] dark:text-[#22D3EE]">
            Chronicle
          </span>
          <h1 className="font-serif-editorial text-4xl sm:text-5xl tracking-tight text-[#101626] dark:text-white">
            {t("meetings.title")}
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
            {t("meetings.subtitle")}
          </p>
        </div>

        <motion.button
          type="button"
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onOpenNewMeeting}
          className="inline-flex items-center gap-2 rounded-full bg-[#101626] px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#5B5BF0] transition-colors self-start sm:self-auto cursor-pointer dark:bg-[#5B5BF0]"
        >
          <Mic className="h-3.5 w-3.5 text-[#22D3EE]" />
          <span>{t("app.newMeeting")}</span>
        </motion.button>
      </div>

      {/* Floating Filter Ribbon */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 rounded-2xl border border-[#101626]/10 bg-white p-2.5 shadow-2xs dark:border-white/10 dark:bg-[#13192B]">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-2.5 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            value={queryFilter}
            onChange={(e) => setQueryFilter(e.target.value)}
            placeholder={t("meetings.searchPlaceholder")}
            className="w-full rounded-xl bg-[#F7F6F2] pl-10 pr-4 py-2 text-xs font-medium text-[#101626] focus:bg-white focus:outline-none dark:bg-[#0B0F1A] dark:text-white"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-[#101626]/10 bg-[#F7F6F2] px-3.5 py-2 text-xs font-semibold text-[#101626] dark:border-white/10 dark:bg-[#0B0F1A] dark:text-zinc-200"
          >
            <option value="all">{t("meetings.filterAllStatuses")}</option>
            <option value="ready">{t("meetings.status.ready")}</option>
            <option value="transcribing">{t("meetings.status.transcribing")}</option>
            <option value="summarizing">{t("meetings.status.summarizing")}</option>
            <option value="failed">{t("meetings.status.failed")}</option>
          </select>

          <select
            value={languageFilter}
            onChange={(e) => setLanguageFilter(e.target.value)}
            className="rounded-xl border border-[#101626]/10 bg-[#F7F6F2] px-3.5 py-2 text-xs font-semibold text-[#101626] dark:border-white/10 dark:bg-[#0B0F1A] dark:text-zinc-200"
          >
            <option value="all">{t("meetings.filterAllLanguages")}</option>
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.tag} value={l.tag}>
                {l.nativeName} ({l.tag.toUpperCase()})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Editorial Stream */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#5B5BF0]" />
          {t("app.loading")}
        </div>
      ) : meetings.length === 0 ? (
        <div className="rounded-[2rem] border border-[#101626]/10 bg-white p-12 text-center space-y-4 dark:border-white/10 dark:bg-[#13192B]">
          <LivingWaveformBar bars={18} className="h-9 mx-auto" />
          <div className="font-serif-editorial text-3xl text-[#101626] dark:text-white">
            {t("dashboard.noMeetingsTitle")}
          </div>
          <p className="text-xs text-zinc-500 max-w-md mx-auto">
            {t("dashboard.noMeetingsDescription")}
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={onOpenNewMeeting}
              className="inline-flex items-center gap-2 rounded-full bg-[#101626] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#5B5BF0] cursor-pointer"
            >
              <Mic className="h-3.5 w-3.5" />
              <span>{t("app.newMeeting")}</span>
            </button>
            <button
              type="button"
              disabled={seeding}
              onClick={handleSeedSamples}
              className="inline-flex items-center gap-2 rounded-full border border-[#101626]/15 bg-[#F7F6F2] px-5 py-2.5 text-xs font-semibold text-[#101626] hover:border-[#5B5BF0] dark:border-white/15 dark:bg-white/5 dark:text-white cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#5B5BF0]" />
              <span>{t("dashboard.seedSampleMeeting")}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {meetings.map((m, idx) => (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.22 }}
              whileHover={shouldReduceMotion ? undefined : { x: 4 }}
              onClick={() => navigate(`/meetings/${m.id}`)}
              className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-[#101626]/8 bg-white p-5 shadow-[0_4px_20px_rgba(16,22,38,0.03)] hover:border-[#5B5BF0]/45 transition-all cursor-pointer dark:border-white/10 dark:bg-[#13192B]"
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-mono text-zinc-400">
                  <span>{formatLocaleDateTime(m.recordedAt, i18n.language)}</span>
                  <span>·</span>
                  <span>{formatDurationSeconds(m.durationSeconds, i18n.language)}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-sans font-semibold ${
                      m.status === "ready"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : m.status === "failed"
                          ? "bg-red-500/10 text-red-600"
                          : "bg-amber-500/10 text-amber-700"
                    }`}
                  >
                    {t(`meetings.status.${m.status}`)}
                  </span>
                </div>

                <h2 className="font-serif-editorial text-2xl sm:text-3xl text-[#101626] group-hover:text-[#5B5BF0] transition-colors dark:text-white dark:group-hover:text-[#22D3EE]">
                  {m.title}
                </h2>

                {m.description && (
                  <p className="text-xs text-zinc-500 truncate max-w-2xl">{m.description}</p>
                )}
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                <LanguageBadge tag={m.detectedLanguage} />
                {m.detectedLanguages.length > 1 && (
                  <span className="rounded-full bg-[#5B5BF0]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#5B5BF0] dark:text-[#22D3EE]">
                    {m.detectedLanguages.map((l) => l.toUpperCase()).join("+")}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => handleDelete(e, m.id)}
                  aria-label={t("app.delete")}
                  className="rounded-full p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer dark:hover:bg-red-950/50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <ArrowUpRight className="h-4 w-4 text-zinc-300 group-hover:text-[#5B5BF0]" />
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

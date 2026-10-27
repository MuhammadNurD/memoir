import React, { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import {
  Mic,
  CheckCircle2,
  Circle,
  Sparkles,
  ArrowUpRight,
  Loader2,
  Upload,
} from "lucide-react";
import { useAuth } from "../client/AuthContext";
import { apiFetch } from "../client/api";
import type { MeetingRecord } from "../shared/types";
import {
  formatDurationSeconds,
  formatLocaleDate,
  formatLocaleNumber,
} from "../i18n/formatters";
import { LanguageBadge } from "../components/LanguageBadge";
import { LivingWaveformBar } from "../components/BrandLogo";

interface DashboardPayload {
  stats: {
    totalMeetings: number;
    totalDurationSeconds: number;
    openActionItemsCount: number;
    languagesCaptured: string[];
  };
  recentMeetings: MeetingRecord[];
  openActionItems: Array<{
    id: string;
    meetingId: string;
    meetingTitle: string;
    language: string;
    title: string;
    owner: string | null;
    dueDate: string | null;
    status: string;
  }>;
}

export function DashboardPage({
  onOpenNewMeeting,
  refreshTrigger,
}: {
  onOpenNewMeeting: () => void;
  refreshTrigger: number;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();

  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await apiFetch<DashboardPayload>("/api/dashboard");
      setData(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard, refreshTrigger]);

  const handleSeedSamples = async () => {
    setSeeding(true);
    try {
      await apiFetch("/api/meetings/seed-samples", { method: "POST" });
      await loadDashboard();
    } finally {
      setSeeding(false);
    }
  };

  const handleCompleteActionItem = async (meetingId: string, actionId: string) => {
    await apiFetch(`/api/meetings/${meetingId}/action-items/${actionId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });
    await loadDashboard();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#5B5BF0]" />
        {t("app.loading")}
      </div>
    );
  }

  const stats = data?.stats || {
    totalMeetings: 0,
    totalDurationSeconds: 0,
    openActionItemsCount: 0,
    languagesCaptured: [],
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="space-y-10"
    >
      {/* Editorial Studio Hero */}
      <div className="relative overflow-hidden rounded-[2rem] bg-[#101626] p-8 sm:p-10 text-white shadow-[0_20px_50px_rgba(16,22,38,0.16)]">
        <div
          className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-[#5B5BF0]/30 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-[#22D3EE]/20 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-end justify-between gap-8">
          <div className="space-y-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium text-[#22D3EE]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#22D3EE]" />
              <span>Personal Conversation Archive</span>
            </div>
            <h1 className="font-serif-editorial text-4xl sm:text-5xl tracking-tight leading-[1.08]">
              {t("dashboard.welcome", { name: user?.displayName || "" })}
            </h1>
            <p className="text-sm text-zinc-300 max-w-xl leading-relaxed">
              {t("dashboard.subtitle")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <motion.button
              type="button"
              whileHover={shouldReduceMotion ? undefined : { scale: 1.03, y: -1 }}
              whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
              onClick={onOpenNewMeeting}
              className="inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-[#5B5BF0] to-[#22D3EE] px-6 py-3.5 text-xs font-bold text-[#101626] shadow-[0_8px_28px_rgba(34,211,238,0.35)] cursor-pointer"
            >
              <Mic className="h-4 w-4" />
              <span>Record or Upload Audio</span>
            </motion.button>
          </div>
        </div>

        {/* Inline Ribbon Metrics (No Boxy SaaS Stat Cards) */}
        <div className="relative z-10 mt-8 pt-6 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-6">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-400">
              {t("dashboard.statsTotalMeetings")}
            </div>
            <div className="mt-1 font-serif-editorial text-3xl text-white">
              {formatLocaleNumber(stats.totalMeetings, i18n.language)}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-400">
              {t("dashboard.statsTotalDuration")}
            </div>
            <div className="mt-1 font-mono text-2xl font-bold text-[#22D3EE]">
              {formatDurationSeconds(stats.totalDurationSeconds, i18n.language)}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-400">
              {t("dashboard.statsOpenActions")}
            </div>
            <div className="mt-1 font-serif-editorial text-3xl text-white">
              {formatLocaleNumber(stats.openActionItemsCount, i18n.language)}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-400">
              {t("dashboard.statsLanguagesUsed")}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-serif-editorial text-3xl text-white">
                {formatLocaleNumber(stats.languagesCaptured.length, i18n.language)}
              </span>
              <span className="text-xs font-mono text-[#22D3EE] truncate">
                {stats.languagesCaptured.map((l) => l.toUpperCase()).join(" · ") || "AUTO"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Empty State or Editorial Journal Layout */}
      {stats.totalMeetings === 0 ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-[2rem] border border-[#101626]/10 bg-white p-10 sm:p-14 text-center space-y-6 shadow-[0_12px_40px_rgba(16,22,38,0.04)] dark:border-white/10 dark:bg-[#13192B]"
        >
          <LivingWaveformBar bars={22} className="h-10 mx-auto" />
          <div className="max-w-lg mx-auto space-y-2">
            <h2 className="font-serif-editorial text-3xl text-[#101626] dark:text-white">
              {t("dashboard.noMeetingsTitle")}
            </h2>
            <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {t("dashboard.noMeetingsDescription")}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <motion.button
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onOpenNewMeeting}
              className="inline-flex items-center gap-2 rounded-full bg-[#101626] px-6 py-3 text-xs font-semibold text-white hover:bg-[#5B5BF0] transition-colors cursor-pointer dark:bg-[#5B5BF0]"
            >
              <Upload className="h-4 w-4" />
              <span>{t("dashboard.createFirstMeeting")}</span>
            </motion.button>
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={seeding}
              onClick={handleSeedSamples}
              className="inline-flex items-center gap-2 rounded-full border border-[#101626]/15 bg-[#F7F6F2] px-5 py-3 text-xs font-semibold text-[#101626] hover:border-[#5B5BF0] dark:border-white/15 dark:bg-white/5 dark:text-white cursor-pointer"
            >
              {seeding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 text-[#5B5BF0]" />
              )}
              <span>{t("dashboard.seedSampleMeeting")}</span>
            </motion.button>
          </div>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left 7 Columns: Editorial Conversation Timeline */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-baseline justify-between border-b border-[#101626]/10 pb-3 dark:border-white/10">
              <h2 className="font-serif-editorial text-2xl text-[#101626] dark:text-white">
                {t("dashboard.recentMeetings")}
              </h2>
              <Link
                to="/meetings"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#5B5BF0] hover:underline dark:text-[#22D3EE]"
              >
                <span>{t("dashboard.viewAllMeetings")}</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="space-y-3">
              {data?.recentMeetings.map((m, idx) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05, duration: 0.25 }}
                  whileHover={shouldReduceMotion ? undefined : { x: 4 }}
                  onClick={() => navigate(`/meetings/${m.id}`)}
                  className="group relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-[#101626]/8 bg-white p-5 shadow-[0_4px_20px_rgba(16,22,38,0.03)] hover:border-[#5B5BF0]/40 transition-all cursor-pointer dark:border-white/10 dark:bg-[#13192B]"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2.5 text-[11px] font-mono text-zinc-400">
                      <span>{formatLocaleDate(m.recordedAt, i18n.language)}</span>
                      <span>·</span>
                      <span>{formatDurationSeconds(m.durationSeconds, i18n.language)}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-sans font-semibold ${
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

                    <h3 className="font-serif-editorial text-2xl text-[#101626] group-hover:text-[#5B5BF0] transition-colors truncate dark:text-white dark:group-hover:text-[#22D3EE]">
                      {m.title}
                    </h3>

                    {m.description && (
                      <p className="text-xs text-zinc-500 line-clamp-1">{m.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                    <LanguageBadge tag={m.detectedLanguage} />
                    {m.detectedLanguages.length > 1 && (
                      <span className="rounded-full bg-[#5B5BF0]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#5B5BF0] dark:text-[#22D3EE]">
                        {m.detectedLanguages.map((l) => l.toUpperCase()).join("+")}
                      </span>
                    )}
                    <ArrowUpRight className="h-4 w-4 text-zinc-300 group-hover:text-[#5B5BF0] transition-colors" />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Right 5 Columns: Tactile Commitments & Next Steps */}
          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-baseline justify-between border-b border-[#101626]/10 pb-3 dark:border-white/10">
              <h2 className="font-serif-editorial text-2xl text-[#101626] dark:text-white">
                {t("dashboard.recentActionItems")}
              </h2>
              <span className="font-mono text-xs text-zinc-400">
                {data?.openActionItems.length || 0} open
              </span>
            </div>

            <div className="rounded-3xl border border-[#101626]/8 bg-white p-5 shadow-[0_4px_20px_rgba(16,22,38,0.03)] dark:border-white/10 dark:bg-[#13192B]">
              {!data?.openActionItems.length ? (
                <div className="py-10 text-center text-xs text-zinc-500">
                  <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500 mb-2" />
                  {t("dashboard.noActionItems")}
                </div>
              ) : (
                <div className="divide-y divide-[#101626]/8 dark:divide-white/10">
                  {data.openActionItems.map((act) => (
                    <motion.div
                      key={act.id}
                      layout
                      className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => handleCompleteActionItem(act.meetingId, act.id)}
                        title="Complete item"
                        className="mt-0.5 text-zinc-400 hover:text-[#5B5BF0] transition-colors cursor-pointer"
                      >
                        <Circle className="h-4 w-4" />
                      </button>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="font-medium text-[#101626] leading-snug dark:text-zinc-100">
                          {act.title}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                          <Link
                            to={`/meetings/${act.meetingId}`}
                            className="font-semibold text-[#5B5BF0] hover:underline truncate max-w-[180px] dark:text-[#22D3EE]"
                          >
                            {act.meetingTitle}
                          </Link>
                          <span>·</span>
                          <span>{act.owner || t("detail.unassignedOwner")}</span>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  Copy,
  Check,
  Download,
  Share2,
  RefreshCw,
  Edit3,
  Plus,
  CheckCircle2,
  Circle,
  AlertCircle,
  Globe,
  Sparkles,
  Loader2,
  Trash2,
  Volume2,
} from "lucide-react";
import { apiFetch } from "../client/api";
import type { MeetingDetailPayload, MeetingSummaryRecord } from "../shared/types";
import { SUPPORTED_LANGUAGES } from "../shared/languages";
import {
  formatDurationSeconds,
  formatLocaleDateTime,
  formatTimestampMs,
} from "../i18n/formatters";
import { LanguageBadge } from "../components/LanguageBadge";

export function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [detail, setDetail] = useState<MeetingDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Summary language & regeneration controls
  const [selectedSummaryLang, setSelectedSummaryLang] = useState("en");
  const [selectedInsightsLang, setSelectedInsightsLang] = useState("en");
  const [regenerating, setRegenerating] = useState(false);

  // Summary editing state
  const [editingSummary, setEditingSummary] = useState(false);
  const [draftExecSummary, setDraftExecSummary] = useState("");
  const [draftPoints, setDraftPoints] = useState("");
  const [draftQuestions, setDraftQuestions] = useState("");

  // Transcript segment filter & editing
  const [transcriptFilter, setTranscriptFilter] = useState("");
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [draftSegmentText, setDraftSegmentText] = useState("");
  const [draftSegmentSpeaker, setDraftSegmentSpeaker] = useState("");

  // Action item creation
  const [newActionTitle, setNewActionTitle] = useState("");
  const [newActionOwner, setNewActionOwner] = useState("");

  // Copy feedback
  const [copied, setCopied] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await apiFetch<MeetingDetailPayload>(`/api/meetings/${id}`);
      setDetail(data);
      const activeLang =
        data.activeSummary?.outputLanguage || data.meeting.preferredSummaryLanguage || "en";
      setSelectedSummaryLang(activeLang);
      setSelectedInsightsLang(
        data.activeSummary?.insightsLanguage || data.meeting.preferredInsightsLanguage || activeLang
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load meeting.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-zinc-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-[#5B5BF0]" />
        {t("app.loading")}
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
        <p className="font-semibold">{error || "Meeting not found."}</p>
        <Link
          to="/meetings"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("detail.backToMeetings")}
        </Link>
      </div>
    );
  }

  const { meeting, audioAsset, transcript, summaries, actionItems, decisions } = detail;

  const displayedSummary: MeetingSummaryRecord | null =
    summaries.find((s) => s.outputLanguage === selectedSummaryLang) ||
    detail.activeSummary ||
    null;

  const handleOverrideDetectedLanguage = async (newLang: string) => {
    const updated = await apiFetch<MeetingDetailPayload>(`/api/meetings/${meeting.id}`, {
      method: "PATCH",
      body: JSON.stringify({ detectedLanguageOverride: newLang }),
    });
    setDetail(updated);
  };

  const handleGenerateSummaryInLanguage = async () => {
    setRegenerating(true);
    setError(null);
    try {
      const updated = await apiFetch<MeetingDetailPayload>(
        `/api/meetings/${meeting.id}/summaries`,
        {
          method: "POST",
          body: JSON.stringify({
            outputLanguage: selectedSummaryLang,
            insightsLanguage: selectedInsightsLang,
          }),
        }
      );
      setDetail(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Summary generation failed.");
    } finally {
      setRegenerating(false);
    }
  };

  const handleRetryTranscription = async () => {
    setRegenerating(true);
    setError(null);
    try {
      const updated = await apiFetch<MeetingDetailPayload>(
        `/api/meetings/${meeting.id}/process`,
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );
      setDetail(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRegenerating(false);
    }
  };

  const startEditSummary = (sum: MeetingSummaryRecord) => {
    setDraftExecSummary(sum.executiveSummary);
    setDraftPoints(sum.keyDiscussionPoints.join("\n"));
    setDraftQuestions(sum.unresolvedQuestions.join("\n"));
    setEditingSummary(true);
  };

  const handleSaveSummaryEdits = async () => {
    if (!displayedSummary) return;
    const updated = await apiFetch<MeetingDetailPayload>(
      `/api/meetings/${meeting.id}/summaries`,
      {
        method: "PATCH",
        body: JSON.stringify({
          summaryId: displayedSummary.id,
          executiveSummary: draftExecSummary,
          keyDiscussionPoints: draftPoints
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          unresolvedQuestions: draftQuestions
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      }
    );
    setDetail(updated);
    setEditingSummary(false);
  };

  const handleSaveSegmentEdit = async (segmentId: string) => {
    const updated = await apiFetch<MeetingDetailPayload>(
      `/api/meetings/${meeting.id}/transcript-segments`,
      {
        method: "PATCH",
        body: JSON.stringify({
          segmentId,
          text: draftSegmentText,
          speaker: draftSegmentSpeaker.trim() || null,
        }),
      }
    );
    setDetail(updated);
    setEditingSegmentId(null);
  };

  const handleToggleActionItem = async (actionId: string, currentStatus: string) => {
    const nextStatus = currentStatus === "completed" ? "open" : "completed";
    const updated = await apiFetch<MeetingDetailPayload>(
      `/api/meetings/${meeting.id}/action-items/${actionId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      }
    );
    setDetail(updated);
  };

  const handleDeleteActionItem = async (actionId: string) => {
    const updated = await apiFetch<MeetingDetailPayload>(
      `/api/meetings/${meeting.id}/action-items/${actionId}`,
      { method: "DELETE" }
    );
    setDetail(updated);
  };

  const handleAddActionItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newActionTitle.trim()) return;
    const updated = await apiFetch<MeetingDetailPayload>(
      `/api/meetings/${meeting.id}/action-items`,
      {
        method: "POST",
        body: JSON.stringify({
          title: newActionTitle.trim(),
          owner: newActionOwner.trim() || null,
          dueDate: null,
          language: selectedInsightsLang,
        }),
      }
    );
    setDetail(updated);
    setNewActionTitle("");
    setNewActionOwner("");
  };

  const handleCopySummary = async () => {
    if (!displayedSummary) return;
    const text = [
      displayedSummary.executiveSummary,
      "",
      ...displayedSummary.keyDiscussionPoints.map((p) => `- ${p}`),
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleShare = async () => {
    const updated = await apiFetch<MeetingDetailPayload>(`/api/meetings/${meeting.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isShared: !meeting.isShared }),
    });
    setDetail(updated);
  };

  const seekAudioToMs = (ms: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = ms / 1000;
      audioRef.current.play().catch(() => {});
    }
  };

  const filteredSegments = (transcript?.segments || []).filter((seg) => {
    if (!transcriptFilter.trim()) return true;
    const q = transcriptFilter.toLowerCase();
    return (
      seg.text.toLowerCase().includes(q) ||
      (seg.speaker && seg.speaker.toLowerCase().includes(q))
    );
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-8"
    >
      {/* Top Bar: Back + Export & Share Pills */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/meetings"
          className="inline-flex items-center gap-2 rounded-full border border-[#101626]/10 bg-white px-4 py-1.5 text-xs font-semibold text-[#101626] hover:border-[#5B5BF0] transition-colors dark:border-white/10 dark:bg-[#13192B] dark:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>{t("detail.backToMeetings")}</span>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/meetings/${meeting.id}/export?format=md`}
            download
            className="inline-flex items-center gap-1.5 rounded-full border border-[#101626]/10 bg-white px-3.5 py-1.5 text-xs font-semibold text-[#101626] hover:border-[#5B5BF0] dark:border-white/10 dark:bg-[#13192B] dark:text-zinc-200"
          >
            <Download className="h-3.5 w-3.5 text-[#5B5BF0]" />
            <span>Markdown</span>
          </a>

          <a
            href={`/api/meetings/${meeting.id}/export?format=json`}
            download
            className="inline-flex items-center gap-1.5 rounded-full border border-[#101626]/10 bg-white px-3.5 py-1.5 text-xs font-semibold text-[#101626] hover:border-[#5B5BF0] dark:border-white/10 dark:bg-[#13192B] dark:text-zinc-200"
          >
            <Download className="h-3.5 w-3.5 text-[#5B5BF0]" />
            <span>JSON</span>
          </a>

          <button
            type="button"
            onClick={handleToggleShare}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              meeting.isShared
                ? "bg-[#5B5BF0] text-white"
                : "border border-[#101626]/10 bg-white text-[#101626] hover:border-[#5B5BF0] dark:border-white/10 dark:bg-[#13192B] dark:text-zinc-200"
            }`}
          >
            <Share2 className="h-3.5 w-3.5" />
            <span>
              {meeting.isShared ? t("detail.unshareMeeting") : t("detail.shareMeeting")}
            </span>
          </button>
        </div>
      </div>

      {meeting.isShared && meeting.shareToken && (
        <div className="rounded-2xl border border-[#5B5BF0]/30 bg-[#5B5BF0]/10 px-4 py-2.5 text-xs font-medium text-[#101626] dark:text-indigo-200">
          Shared link active:{" "}
          <code className="font-mono font-bold underline">/api/shared/{meeting.shareToken}</code>
        </div>
      )}

      {/* Editorial Document Masthead */}
      <div className="rounded-[2rem] border border-[#101626]/10 bg-white p-7 sm:p-9 shadow-[0_10px_35px_rgba(16,22,38,0.04)] space-y-5 dark:border-white/10 dark:bg-[#13192B]">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-zinc-400">
          <div className="flex flex-wrap items-center gap-2.5">
            <span>{formatLocaleDateTime(meeting.recordedAt, i18n.language)}</span>
            <span>·</span>
            <span>{formatDurationSeconds(meeting.durationSeconds, i18n.language)}</span>
            {transcript?.isCodeSwitching && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#5B5BF0]/10 px-3 py-0.5 font-sans text-[11px] font-semibold text-[#5B5BF0] dark:text-[#22D3EE]">
                <Globe className="h-3 w-3" />
                {t("detail.codeSwitchingBadge")} (
                {transcript.detectedLanguages.map((l) => l.toUpperCase()).join(" + ")})
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 font-sans">
            <LanguageBadge tag={meeting.spokenLanguageConfig} prefix={t("detail.spokenLanguage")} />
            <div className="flex items-center gap-1.5 rounded-full border border-[#101626]/12 bg-[#F7F6F2] px-3 py-0.5 text-[11px] dark:border-white/15 dark:bg-[#0B0F1A]">
              <span className="text-zinc-500">{t("detail.detectedLanguage")}:</span>
              <select
                aria-label={t("detail.overrideLanguage")}
                value={meeting.detectedLanguage}
                onChange={(e) => handleOverrideDetectedLanguage(e.target.value)}
                className="bg-transparent font-semibold text-[#101626] focus:outline-none cursor-pointer dark:text-zinc-200"
              >
                <option value="und">{t("app.languageUndetermined")}</option>
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.tag} value={l.tag}>
                    {l.nativeName} ({l.tag.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div>
          <h1 className="font-serif-editorial text-4xl sm:text-5xl tracking-tight text-[#101626] dark:text-white leading-[1.08]">
            {meeting.title}
          </h1>
          {meeting.description && (
            <p className="mt-2 text-sm text-zinc-500 max-w-3xl leading-relaxed">
              {meeting.description}
            </p>
          )}
        </div>

        {/* Audio Studio Player Bar */}
        {audioAsset && (
          <div className="rounded-2xl bg-[#101626] p-4 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-xs font-medium">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#5B5BF0] text-white">
                <Volume2 className="h-4 w-4" />
              </div>
              <div>
                <div className="font-semibold">{audioAsset.fileName}</div>
                <div className="text-[11px] text-zinc-400">
                  {Math.round(audioAsset.sizeBytes / 1024)} KB · Click any transcript timestamp to jump
                </div>
              </div>
            </div>
            <audio
              ref={audioRef}
              controls
              preload="metadata"
              src={`/api/meetings/${meeting.id}/audio`}
              className="w-full sm:max-w-md h-9"
            />
          </div>
        )}

        {/* Error & Retry Banner */}
        {(meeting.status === "failed" || meeting.errorMessage) && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">{meeting.errorCode || "PROCESSING_ERROR"}</div>
                <div>{meeting.errorMessage}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRetryTranscription}
              disabled={regenerating}
              className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 shrink-0 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
              <span>{t("detail.retryTranscription")}</span>
            </button>
          </div>
        )}
      </div>

      {/* Two-Column Editorial Spread: Left = Distilled Memoir, Right = Verbatim Dialogue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left 7 Columns: Distilled Memoir, Decisions & Action Items */}
        <div className="lg:col-span-7 space-y-8">
          <div className="rounded-[2rem] border border-[#101626]/10 bg-white p-7 sm:p-8 shadow-[0_8px_30px_rgba(16,22,38,0.03)] space-y-6 dark:border-white/10 dark:bg-[#13192B]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#101626]/10 pb-5 dark:border-white/10">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#5B5BF0] dark:text-[#22D3EE]">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Distilled Briefing</span>
                </div>
                <h2 className="font-serif-editorial text-3xl text-[#101626] dark:text-white mt-0.5">
                  {t("detail.executiveSummary")}
                </h2>
              </div>

              {/* Translate / Switch Summary Language Bar */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={t("detail.summaryLanguage")}
                  value={selectedSummaryLang}
                  onChange={(e) => {
                    setSelectedSummaryLang(e.target.value);
                    setSelectedInsightsLang(e.target.value);
                  }}
                  className="rounded-full border border-[#101626]/15 bg-[#F7F6F2] px-3.5 py-1.5 text-xs font-semibold text-[#101626] dark:border-white/15 dark:bg-[#0B0F1A] dark:text-zinc-200"
                >
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l.tag} value={l.tag}>
                      {l.nativeName} ({l.tag.toUpperCase()})
                    </option>
                  ))}
                </select>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  disabled={regenerating || !transcript}
                  onClick={handleGenerateSummaryInLanguage}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#101626] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#5B5BF0] disabled:opacity-50 transition-colors cursor-pointer dark:bg-[#5B5BF0]"
                >
                  {regenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {regenerating ? t("detail.regenerating") : t("detail.regenerateButton")}
                  </span>
                </motion.button>
              </div>
            </div>

            {/* Saved Language Edition Pills */}
            {summaries.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-zinc-400 mr-1">Editions:</span>
                  {summaries.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSummaryLang(s.outputLanguage)}
                      className={`rounded-full px-3 py-0.5 text-xs font-semibold transition-colors cursor-pointer ${
                        selectedSummaryLang === s.outputLanguage
                          ? "bg-[#5B5BF0] text-white"
                          : "bg-[#F7F6F2] text-zinc-600 hover:bg-[#EFECE6] dark:bg-white/10 dark:text-zinc-300"
                      }`}
                    >
                      {s.outputLanguage.toUpperCase()}
                    </button>
                  ))}
                </div>

                {displayedSummary && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCopySummary}
                      className="inline-flex items-center gap-1 rounded-full border border-[#101626]/10 px-3 py-1 text-xs font-semibold text-zinc-600 hover:bg-[#F7F6F2] dark:border-white/10 dark:text-zinc-300 cursor-pointer"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span>{copied ? t("app.copied") : t("app.copy")}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => startEditSummary(displayedSummary)}
                      className="inline-flex items-center gap-1 rounded-full border border-[#101626]/10 px-3 py-1 text-xs font-semibold text-zinc-600 hover:bg-[#F7F6F2] dark:border-white/10 dark:text-zinc-300 cursor-pointer"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>{t("app.edit")}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {displayedSummary ? (
              <div className="space-y-6">
                {editingSummary ? (
                  <div className="space-y-4 rounded-2xl bg-[#F7F6F2] p-4 dark:bg-[#0B0F1A]">
                    <div>
                      <label className="block text-xs font-semibold mb-1">
                        {t("detail.executiveSummary")}
                      </label>
                      <textarea
                        rows={4}
                        value={draftExecSummary}
                        onChange={(e) => setDraftExecSummary(e.target.value)}
                        className="w-full rounded-xl border border-[#101626]/15 bg-white p-3 text-xs dark:border-white/15 dark:bg-[#13192B]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">
                        {t("detail.keyDiscussionPoints")} (1 per line)
                      </label>
                      <textarea
                        rows={4}
                        value={draftPoints}
                        onChange={(e) => setDraftPoints(e.target.value)}
                        className="w-full rounded-xl border border-[#101626]/15 bg-white p-3 text-xs dark:border-white/15 dark:bg-[#13192B]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">
                        {t("detail.unresolvedQuestions")} (1 per line)
                      </label>
                      <textarea
                        rows={3}
                        value={draftQuestions}
                        onChange={(e) => setDraftQuestions(e.target.value)}
                        className="w-full rounded-xl border border-[#101626]/15 bg-white p-3 text-xs dark:border-white/15 dark:bg-[#13192B]"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingSummary(false)}
                        className="rounded-full px-4 py-1.5 text-xs font-semibold cursor-pointer"
                      >
                        {t("app.cancel")}
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveSummaryEdits}
                        className="rounded-full bg-[#5B5BF0] px-5 py-1.5 text-xs font-semibold text-white cursor-pointer"
                      >
                        {t("app.save")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm sm:text-base leading-relaxed text-[#101626]/90 whitespace-pre-line dark:text-zinc-200">
                      {displayedSummary.executiveSummary}
                    </p>

                    {displayedSummary.keyDiscussionPoints.length > 0 && (
                      <div className="space-y-3 border-t border-[#101626]/10 pt-5 dark:border-white/10">
                        <h3 className="font-serif-editorial text-2xl text-[#101626] dark:text-white">
                          {t("detail.keyDiscussionPoints")}
                        </h3>
                        <ul className="space-y-2 text-xs sm:text-sm text-zinc-700 dark:text-zinc-300">
                          {displayedSummary.keyDiscussionPoints.map((pt, i) => (
                            <li key={i} className="flex items-start gap-2.5">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#5B5BF0] shrink-0" />
                              <span>{pt}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {displayedSummary.unresolvedQuestions.length > 0 && (
                      <div className="space-y-3 border-t border-[#101626]/10 pt-5 dark:border-white/10">
                        <h3 className="font-serif-editorial text-2xl text-amber-700 dark:text-amber-300">
                          {t("detail.unresolvedQuestions")}
                        </h3>
                        <ul className="space-y-2 text-xs sm:text-sm text-zinc-700 dark:text-zinc-300">
                          {displayedSummary.unresolvedQuestions.map((q, i) => (
                            <li key={i} className="flex items-start gap-2.5">
                              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                              <span>{q}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-zinc-500">
                Select a language above and click "{t("detail.regenerateButton")}" to distill this conversation.
              </div>
            )}
          </div>

          {/* Decisions & Action Items Spread */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Decisions */}
            <div className="rounded-[2rem] border border-[#101626]/10 bg-white p-6 space-y-4 dark:border-white/10 dark:bg-[#13192B]">
              <h2 className="font-serif-editorial text-2xl text-[#101626] dark:text-white">
                {t("detail.decisions")} ({decisions.length})
              </h2>
              {decisions.length === 0 ? (
                <p className="text-xs text-zinc-400">No explicit decisions recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {decisions.map((d) => (
                    <div
                      key={d.id}
                      className="rounded-2xl bg-[#F7F6F2] p-4 text-xs space-y-1.5 dark:bg-[#0B0F1A]"
                    >
                      <div className="font-medium text-[#101626] leading-relaxed dark:text-zinc-100">
                        {d.decisionText}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                        <LanguageBadge tag={d.language} />
                        {d.madeBy && <span>· {d.madeBy}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action Items */}
            <div className="rounded-[2rem] border border-[#101626]/10 bg-white p-6 space-y-4 dark:border-white/10 dark:bg-[#13192B]">
              <h2 className="font-serif-editorial text-2xl text-[#101626] dark:text-white">
                {t("detail.actionItems")} ({actionItems.length})
              </h2>

              <div className="space-y-2.5">
                {actionItems.map((act) => (
                  <div
                    key={act.id}
                    className="flex items-start justify-between gap-2.5 rounded-2xl bg-[#F7F6F2] p-3.5 text-xs dark:bg-[#0B0F1A]"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => handleToggleActionItem(act.id, act.status)}
                        className="mt-0.5 text-zinc-400 hover:text-[#5B5BF0] cursor-pointer"
                      >
                        {act.status === "completed" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Circle className="h-4 w-4" />
                        )}
                      </button>
                      <div className="space-y-1 min-w-0">
                        <div
                          className={`font-medium ${
                            act.status === "completed"
                              ? "line-through text-zinc-400"
                              : "text-[#101626] dark:text-zinc-100"
                          }`}
                        >
                          {act.title}
                        </div>
                        <div className="text-[11px] text-zinc-400">
                          {act.owner || t("detail.unassignedOwner")} ·{" "}
                          {act.dueDate || t("detail.unknownDeadline")}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteActionItem(act.id)}
                      aria-label={t("app.delete")}
                      className="text-zinc-400 hover:text-red-600 p-1 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <form onSubmit={handleAddActionItem} className="space-y-2 pt-2">
                <input
                  type="text"
                  value={newActionTitle}
                  onChange={(e) => setNewActionTitle(e.target.value)}
                  placeholder={t("detail.addActionItem")}
                  className="w-full rounded-xl border border-[#101626]/12 bg-[#F7F6F2] px-3 py-2 text-xs focus:bg-white focus:outline-none dark:border-white/15 dark:bg-[#0B0F1A]"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newActionOwner}
                    onChange={(e) => setNewActionOwner(e.target.value)}
                    placeholder={`${t("detail.owner")} (optional)`}
                    className="flex-1 rounded-xl border border-[#101626]/12 bg-[#F7F6F2] px-3 py-1.5 text-xs focus:bg-white focus:outline-none dark:border-white/15 dark:bg-[#0B0F1A]"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 rounded-full bg-[#101626] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#5B5BF0] cursor-pointer dark:bg-[#5B5BF0]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>

        {/* Right 5 Columns: Verbatim Source Dialogue Script */}
        <div className="lg:col-span-5">
          <div className="rounded-[2rem] border border-[#101626]/10 bg-white p-6 sm:p-7 shadow-[0_8px_30px_rgba(16,22,38,0.03)] space-y-4 dark:border-white/10 dark:bg-[#13192B]">
            <div className="flex items-center justify-between border-b border-[#101626]/10 pb-4 dark:border-white/10">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400">
                  Source Verbatim
                </span>
                <h2 className="font-serif-editorial text-2xl text-[#101626] dark:text-white">
                  {t("detail.transcriptTitle")}
                </h2>
              </div>
              {transcript && <LanguageBadge tag={transcript.detectedLanguage} />}
            </div>

            <p className="text-[11px] text-zinc-400 leading-relaxed">
              {t("detail.originalTranscriptPreserved")}
            </p>

            {transcript ? (
              <>
                <input
                  type="text"
                  value={transcriptFilter}
                  onChange={(e) => setTranscriptFilter(e.target.value)}
                  placeholder={t("detail.searchTranscript")}
                  className="w-full rounded-xl border border-[#101626]/10 bg-[#F7F6F2] px-3.5 py-2 text-xs focus:bg-white focus:outline-none dark:border-white/10 dark:bg-[#0B0F1A]"
                />

                <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
                  {filteredSegments.map((seg) => (
                    <div
                      key={seg.id}
                      className="group rounded-2xl bg-[#F7F6F2]/80 p-4 text-xs space-y-1.5 hover:bg-[#EFECE6]/70 transition-colors dark:bg-[#0B0F1A]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => seekAudioToMs(seg.startTimeMs)}
                            className="font-mono text-[11px] font-bold text-[#5B5BF0] hover:underline dark:text-[#22D3EE] cursor-pointer"
                          >
                            {formatTimestampMs(seg.startTimeMs)}
                          </button>
                          {seg.speaker && (
                            <span className="font-bold text-[#101626] dark:text-white">
                              {seg.speaker}
                            </span>
                          )}
                          <LanguageBadge tag={seg.language} />
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setEditingSegmentId(seg.id);
                            setDraftSegmentText(seg.text);
                            setDraftSegmentSpeaker(seg.speaker || "");
                          }}
                          className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-[#101626] transition-opacity cursor-pointer"
                          title={t("app.edit")}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {editingSegmentId === seg.id ? (
                        <div className="space-y-2 pt-1">
                          <input
                            type="text"
                            value={draftSegmentSpeaker}
                            onChange={(e) => setDraftSegmentSpeaker(e.target.value)}
                            placeholder="Speaker name"
                            className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs dark:bg-[#13192B]"
                          />
                          <textarea
                            rows={2}
                            value={draftSegmentText}
                            onChange={(e) => setDraftSegmentText(e.target.value)}
                            className="w-full rounded-lg border border-zinc-300 bg-white p-2 text-xs dark:bg-[#13192B]"
                          />
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditingSegmentId(null)}
                              className="rounded-full px-3 py-0.5 text-[11px] cursor-pointer"
                            >
                              {t("app.cancel")}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveSegmentEdit(seg.id)}
                              className="rounded-full bg-[#5B5BF0] px-3 py-0.5 text-[11px] font-semibold text-white cursor-pointer"
                            >
                              {t("app.save")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[#101626]/85 leading-relaxed dark:text-zinc-300">
                          {seg.text}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="py-12 text-center text-xs text-zinc-400">
                {t("detail.noTranscriptYet")}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

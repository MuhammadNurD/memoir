import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  X,
  Upload,
  Mic,
  FileText,
  AlertCircle,
  Loader2,
  Square,
  Pause,
  Play,
  Sparkles,
  CheckCircle2,
  SlidersHorizontal,
  ChevronDown,
  AudioLines,
  RefreshCw,
} from "lucide-react";
import {
  SUPPORTED_LANGUAGES,
  TRANSCRIPTION_PROVIDER_CAPABILITIES,
  getLanguageDefinition,
  isLanguageSupportedByProvider,
  type TranscriptionProviderId,
} from "../shared/languages";
import { useAuth } from "../client/AuthContext";
import { apiFetch } from "../client/api";
import { convertAudioBlobTo16kHzWavFile } from "../client/audioConverter";
import {
  createInputMeter,
  extensionForMimeType,
  getAudioInputStream,
  listAudioInputDevices,
  pickRecorderMimeType,
  readStoredAudioInputDeviceId,
  stopMediaStream,
  storeAudioInputDeviceId,
  type AudioInputDevice,
  type InputMeter,
} from "../client/audioCapture";
import { LivingWaveformBar } from "./BrandLogo";
import type { MeetingDetailPayload } from "../shared/types";

const SAMPLE_TRANSCRIPTS: Record<
  string,
  { title: string; spokenLang: string; summaryLang: string; text: string }
> = {
  af_en: {
    title: "Kaapstad Produkbeplanning & Q4 Launch",
    spokenLang: "auto",
    summaryLang: "en",
    text: `[00:00] Anke van der Merwe: Welkom almal by vandag se vergadering oor die Q4 produkvrystelling in Kaapstad.
[00:14] David Botha: Thanks Anke. We have decided to launch the multilingual search index on 15 November.
[00:29] Anke van der Merwe: Uitstekend. Ons het besluit dat die Afrikaans en Engels koppelvlak voor Vrydag gereed moet wees.
[00:45] David Botha: Action item for Anke: finalize the Safari audio recorder permissions test by Friday.
[01:02] Anke van der Merwe: Is daar nog onduidelikheid oor die Apple Sign In private relay e-pos konfigurasie?`,
  },
  fr: {
    title: "Réunion d'Architecture Équipe Montréal & Paris",
    spokenLang: "fr",
    summaryLang: "en",
    text: `[00:00] Claire Dubois: Bonjour à tous, commençons la réunion d'équipe sur la sécurité de l'authentification.
[00:18] Marc Tremblay: Nous avons décidé d'interdire la fusion automatique des comptes par adresse e-mail sans preuve de session.
[00:36] Claire Dubois: Action pour Marc: documenter les URL de rappel Google et Apple avant lundi.
[00:52] Marc Tremblay: Quelle est la politique de rétention pour les fichiers audio volumineux ?`,
  },
  ja: {
    title: "東京・ロンドン製品開発定例ミーティング",
    spokenLang: "ja",
    summaryLang: "en",
    text: `[00:00] 佐藤 健太: 本日の製品リリース会議を始めます。多言語文字起こしエンジンの検証結果を共有します。
[00:20] 鈴木 美咲: 元の文字起こしデータを保持したまま、英語と日本語の両方で要約を生成することに決定しました。
[00:42] 佐藤 健太: 佐藤が11月20日までにデータベースのインデックス性能テストを実施して作成します。
[01:05] 鈴木 美咲: アラビア語の右から左へのレイアウト検証スケジュールは未定ですか？`,
  },
};

export function NewMeetingModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (meetingId: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const shouldReduceMotion = useReducedMotion();

  const [mode, setMode] = useState<"record" | "audio" | "transcript">("record");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [spokenLanguage, setSpokenLanguage] = useState(
    user?.defaultSpokenLanguage || "auto"
  );
  const [summaryLanguage, setSummaryLanguage] = useState(
    user?.defaultSummaryLanguage || "en"
  );
  const [insightsLanguage, setInsightsLanguage] = useState(
    user?.defaultInsightsLanguage || "en"
  );
  const [provider, setProvider] = useState<TranscriptionProviderId | "auto">(
    user?.preferredTranscriptionProvider || "whisper-local"
  );
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);

  const [rawTranscript, setRawTranscript] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [processingStep, setProcessingStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live audio recording + live Web Speech API transcription state
  const [recordingState, setRecordingState] = useState<
    "idle" | "recording" | "paused" | "recorded"
  >("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [liveSpeechLines, setLiveSpeechLines] = useState<string[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speechRecRef = useRef<{ stop: () => void } | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startMsRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<InputMeter | null>(null);
  const rafRef = useRef<number | null>(null);

  const [audioDevices, setAudioDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(
    () => readStoredAudioInputDeviceId() || ""
  );
  const [liveBins, setLiveBins] = useState<number[]>(() => Array(28).fill(0));
  const [inputLevel, setInputLevel] = useState(0);
  const [micReady, setMicReady] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);

  const tearDownAudioGraph = async () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (meterRef.current) {
      await meterRef.current.close();
      meterRef.current = null;
    }
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    setMicReady(false);
    setInputLevel(0);
    setLiveBins(Array(28).fill(0));
  };

  const refreshDeviceList = async () => {
    const devices = await listAudioInputDevices();
    setAudioDevices(devices);
    setSelectedDeviceId((current) => {
      if (current && devices.some((device) => device.deviceId === current)) {
        return current;
      }
      const stored = readStoredAudioInputDeviceId();
      if (stored && devices.some((device) => device.deviceId === stored)) {
        return stored;
      }
      return devices[0]?.deviceId || "";
    });
    return devices;
  };

  const startPreviewStream = async (deviceId?: string) => {
    setLoadingDevices(true);
    try {
      const stream = await getAudioInputStream(deviceId || selectedDeviceId || null);
      stopMediaStream(streamRef.current);
      if (meterRef.current) {
        await meterRef.current.close();
      }
      streamRef.current = stream;
      const meter = createInputMeter(stream);
      meterRef.current = meter;
      setMicReady(true);
      await refreshDeviceList();

      const loop = () => {
        if (!meterRef.current) return;
        const rms = meterRef.current.sampleRms();
        setInputLevel(rms);
        setLiveBins(meterRef.current.sampleBins(28));
        rafRef.current = requestAnimationFrame(loop);
      };
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      setMicReady(false);
      setError(
        err instanceof Error
          ? `Microphone permission denied or unavailable: ${err.message}`
          : "Could not access microphone."
      );
    } finally {
      setLoadingDevices(false);
    }
  };

  useEffect(() => {
    if (open && user) {
      setSpokenLanguage(user.defaultSpokenLanguage || "auto");
      setSummaryLanguage(user.defaultSummaryLanguage || "en");
      setInsightsLanguage(user.defaultInsightsLanguage || "en");
      setProvider(
        user.preferredTranscriptionProvider && user.preferredTranscriptionProvider !== "auto"
          ? user.preferredTranscriptionProvider
          : "whisper-local"
      );
      setError(null);
      setProcessingStep(null);
    }
  }, [open, user]);

  useEffect(() => {
    if (!open || mode !== "record") {
      if (recordingState !== "recording" && recordingState !== "paused") {
        void tearDownAudioGraph();
      }
      return;
    }
    if (recordingState === "idle") {
      void startPreviewStream(selectedDeviceId || undefined);
    }

    const onDeviceChange = () => {
      void refreshDeviceList();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
    };
    // Preview is restarted explicitly when the selected device changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (speechRecRef.current) {
        try {
          speechRecRef.current.stop();
        } catch {
          // ignore
        }
      }
      void tearDownAudioGraph();
    };
  }, []);

  if (!open) return null;

  const activeProviderForCheck: TranscriptionProviderId =
    provider !== "auto"
      ? provider
      : mode === "transcript"
        ? "transcript-import"
        : "whisper-local";

  const isUnsupportedLanguage =
    spokenLanguage !== "auto" &&
    !isLanguageSupportedByProvider(spokenLanguage, activeProviderForCheck);

  const selectedProviderCap = TRANSCRIPTION_PROVIDER_CAPABILITIES[activeProviderForCheck];

  const startLiveRecording = async () => {
    setError(null);
    setLiveSpeechLines([]);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Live audio recording is not supported in this browser environment.");
      return;
    }
    try {
      let stream = streamRef.current;
      if (!stream || stream.getAudioTracks().every((track) => track.readyState !== "live")) {
        await startPreviewStream(selectedDeviceId || undefined);
        stream = streamRef.current;
      }
      if (!stream) {
        setError("Could not access microphone.");
        return;
      }

      const liveTrack = stream.getAudioTracks()[0];
      if (!liveTrack || liveTrack.readyState !== "live") {
        setError("The selected microphone is unavailable. Choose another input and try again.");
        return;
      }
      liveTrack.enabled = true;

      const mimeType = pickRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      startMsRef.current = Date.now();

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blobType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        const extension = extensionForMimeType(blobType);
        const file = new File([blob], `live-recording-${Date.now()}.${extension}`, {
          type: blobType,
        });
        setAudioFile(file);
        if (!title.trim()) {
          setTitle(`Recorded Session · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
        }
        setRecordingState("recorded");
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;

      const SpeechRecognitionCtor =
        (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: new () => unknown })
          .webkitSpeechRecognition;

      if (SpeechRecognitionCtor) {
        try {
          const recognition = new SpeechRecognitionCtor() as {
            continuous: boolean;
            interimResults: boolean;
            lang: string;
            onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
            start: () => void;
            stop: () => void;
          };
          recognition.continuous = true;
          recognition.interimResults = true;
          const langDef = getLanguageDefinition(spokenLanguage);
          recognition.lang = langDef ? langDef.bcp47 : "en-US";
          recognition.onresult = (event) => {
            const lines: string[] = [];
            for (let i = 0; i < event.results.length; i++) {
              const res = event.results[i];
              if (res[0]?.transcript?.trim()) {
                const elapsedSec = Math.max(
                  0,
                  Math.floor((Date.now() - startMsRef.current) / 1000)
                );
                const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
                const ss = String(elapsedSec % 60).padStart(2, "0");
                const prefix = res.isFinal ? "" : "… ";
                lines.push(`[${mm}:${ss}] Speaker 1: ${prefix}${res[0].transcript.trim()}`);
              }
            }
            if (lines.length > 0) setLiveSpeechLines(lines);
          };
          recognition.start();
          speechRecRef.current = recognition;
        } catch {
          // Web Speech API is optional; server Whisper ONNX will transcribe the audio file regardless
        }
      }

      setRecordingSeconds(0);
      setRecordingState("recording");
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Microphone permission denied or unavailable: ${err.message}`
          : "Could not access microphone."
      );
    }
  };

  const pauseOrResumeRecording = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (rec.state === "recording") {
      rec.pause();
      setRecordingState("paused");
      if (timerRef.current) window.clearInterval(timerRef.current);
    } else if (rec.state === "paused") {
      rec.resume();
      setRecordingState("recording");
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    }
  };

  const stopLiveRecording = () => {
    const rec = mediaRecorderRef.current;
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        // ignore
      }
      speechRecRef.current = null;
    }
    if (rec && rec.state !== "inactive") {
      try {
        if (rec.state === "recording") rec.requestData();
      } catch {
        // some browsers do not implement requestData
      }
      rec.stop();
    }
  };

  const handleDeviceChange = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    storeAudioInputDeviceId(deviceId);
    if (recordingState === "recording" || recordingState === "paused") {
      setError("Stop the current recording before switching microphones.");
      return;
    }
    setError(null);
    await startPreviewStream(deviceId);
  };

  const applySamplePreset = (key: string) => {
    const preset = SAMPLE_TRANSCRIPTS[key];
    if (!preset) return;
    setMode("transcript");
    setTitle(preset.title);
    setSpokenLanguage(preset.spokenLang);
    setSummaryLanguage(preset.summaryLang);
    setInsightsLanguage(preset.summaryLang);
    setRawTranscript(preset.text);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const finalTitle =
      title.trim() ||
      (audioFile
        ? audioFile.name.replace(/\.[^/.]+$/, "")
        : `Conversation · ${new Date().toLocaleDateString()}`);

    if (mode === "transcript" && !rawTranscript.trim()) {
      setError("Please paste or load a transcript to process.");
      return;
    }

    if ((mode === "audio" || mode === "record") && !audioFile) {
      setError("Please record or choose an audio file first.");
      return;
    }

    setSubmitting(true);
    try {
      setProcessingStep("Preparing your memoir entry...");
      const created = await apiFetch<MeetingDetailPayload>("/api/meetings", {
        method: "POST",
        body: JSON.stringify({
          title: finalTitle,
          description: description.trim() || null,
          spokenLanguageConfig: spokenLanguage,
          preferredSummaryLanguage: summaryLanguage,
          preferredInsightsLanguage: insightsLanguage,
          transcriptionProvider:
            mode === "transcript"
              ? "transcript-import"
              : provider === "auto"
                ? "whisper-local"
                : provider,
          rawTranscriptText: mode === "transcript" ? rawTranscript : undefined,
        }),
      });

      if ((mode === "audio" || mode === "record") && audioFile) {
        setProcessingStep("Optimizing audio for free Whisper transcription...");
        let uploadFile = audioFile;
        let detectedDuration = recordingSeconds;

        try {
          const converted = await convertAudioBlobTo16kHzWavFile(audioFile, audioFile.name);
          uploadFile = converted.wavFile;
          if (!detectedDuration && converted.durationSeconds > 0) {
            detectedDuration = converted.durationSeconds;
          }
        } catch {
          uploadFile = audioFile;
        }

        setProcessingStep("Transcribing & distilling multilingual insights...");
        const formData = new FormData();
        formData.append("audio", uploadFile);
        if (detectedDuration > 0) {
          formData.append("durationSeconds", String(detectedDuration));
        }
        if (liveSpeechLines.length > 0) {
          formData.append("clientTranscriptText", liveSpeechLines.join("\n"));
        }

        const uploadRes = await fetch(`/api/meetings/${created.meeting.id}/audio`, {
          method: "POST",
          body: formData,
          credentials: "same-origin",
        });

        if (!uploadRes.ok) {
          const errData = await uploadRes.json().catch(() => ({}));
          if (uploadRes.status === 400) {
            throw new Error(errData?.error?.message || "Invalid audio file.");
          }
        }
      }

      onClose();
      onCreated(created.meeting.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create meeting.");
    } finally {
      setSubmitting(false);
      setProcessingStep(null);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-[#101626]/60 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          initial={{
            opacity: 0,
            scale: shouldReduceMotion ? 1 : 0.94,
            y: shouldReduceMotion ? 0 : 16,
          }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.96 }}
          transition={{ type: "spring", stiffness: 360, damping: 28 }}
          className="relative z-10 w-full max-w-2xl rounded-[2rem] memoir-panel p-6 sm:p-8 shadow-[0_24px_70px_rgba(28,34,48,0.22)] max-h-[92vh] overflow-y-auto"
        >
          {/* Studio Modal Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-[#5B5BF0] dark:text-[#22D3EE]">
                Capture Studio
              </span>
              <h2 className="font-serif-editorial text-3xl tracking-tight text-[#101626] dark:text-white">
                {t("meetings.createModalTitle")}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("app.close")}
              className="rounded-full bg-[#E7DFD0] p-2 text-[#5A6274] hover:text-[#1C2230] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            {/* Tactile Pill Mode Switcher */}
            <div className="grid grid-cols-3 gap-1.5 rounded-full bg-[#E7DFD0] p-1.5 border border-[#1C2230]/8">
              {(
                [
                  { id: "record", icon: Mic, label: t("meetings.ingestionModeRecord") },
                  { id: "audio", icon: Upload, label: t("meetings.ingestionModeAudio") },
                  { id: "transcript", icon: FileText, label: t("meetings.ingestionModeTranscript") },
                ] as const
              ).map((tab) => {
                const active = mode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setMode(tab.id)}
                    className={`relative flex items-center justify-center gap-2 rounded-full py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                      active
                        ? "text-white"
                        : "text-zinc-600 hover:text-[#101626] dark:text-zinc-400 dark:hover:text-white"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="studio-mode-pill"
                        className="absolute inset-0 rounded-full bg-[#101626] dark:bg-[#5B5BF0]"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                    <tab.icon className="relative z-10 h-3.5 w-3.5" />
                    <span className="relative z-10">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* 1. Live Microphone Studio */}
            {mode === "record" && (
              <div className="relative overflow-hidden rounded-3xl border border-[#1C2230]/10 bg-[#E7DFD0] p-6 text-[#1C2230] space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5A6274]">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        recordingState === "recording"
                          ? "bg-red-500 animate-pulse"
                          : inputLevel > 0.012
                            ? "bg-emerald-500"
                            : "bg-[#C5BCAE]"
                      }`}
                    />
                    {recordingState === "recording"
                      ? "Listening to the selected microphone"
                      : recordingState === "paused"
                        ? "Recording paused"
                        : recordingState === "recorded"
                          ? "Audio captured and ready"
                          : micReady
                            ? "Speak to test the input, then start recording"
                            : "Allow microphone access to see input devices"}
                  </span>
                  <span className="font-mono text-[11px] text-[#5A6274]">
                    Level {Math.min(100, Math.round(inputLevel * 400))}%
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <AudioLines className="h-4 w-4 text-[#5B5BF0] shrink-0" />
                  <select
                    aria-label="Microphone input"
                    value={selectedDeviceId}
                    onChange={(e) => void handleDeviceChange(e.target.value)}
                    disabled={recordingState === "recording" || recordingState === "paused"}
                    className="memoir-field min-w-0 flex-1 rounded-xl px-3 py-2 text-xs font-medium"
                  >
                    {audioDevices.length === 0 && (
                      <option value="">
                        {loadingDevices ? "Looking for microphones..." : "No microphone found yet"}
                      </option>
                    )}
                    {audioDevices.map((device) => (
                      <option key={device.deviceId || device.label} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void startPreviewStream(selectedDeviceId || undefined)}
                    disabled={recordingState === "recording" || recordingState === "paused"}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#1C2230]/12 bg-[#F4EEE3] px-3 py-2 text-[11px] font-semibold text-[#1C2230] hover:border-[#5B5BF0] disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingDevices ? "animate-spin" : ""}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                <div className="py-1 space-y-3 text-center">
                  <div className="font-mono text-4xl font-bold tracking-wider text-[#1C2230]">
                    {String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:
                    {String(recordingSeconds % 60).padStart(2, "0")}
                  </div>
                  <LivingWaveformBar
                    active={micReady}
                    bars={28}
                    bins={liveBins}
                    className="h-12"
                  />
                  {micReady && inputLevel < 0.01 && recordingState !== "recorded" && (
                    <p className="text-[11px] text-amber-800">
                      No signal from this microphone. Try another input in the list, unmute the device, or check Windows sound settings.
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-center gap-3">
                  {(recordingState === "idle" || recordingState === "recorded") && (
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={startLiveRecording}
                      className="inline-flex items-center gap-2.5 rounded-full bg-[#5B5BF0] px-7 py-3 text-xs font-bold text-white shadow-[0_8px_20px_rgba(91,91,240,0.28)] cursor-pointer"
                    >
                      <Mic className="h-4 w-4" />
                      <span>
                        {recordingState === "recorded"
                          ? "Record again"
                          : t("meetings.startRecording")}
                      </span>
                    </motion.button>
                  )}

                  {(recordingState === "recording" || recordingState === "paused") && (
                    <>
                      <button
                        type="button"
                        onClick={pauseOrResumeRecording}
                        className="inline-flex items-center gap-2 rounded-full border border-[#1C2230]/15 bg-[#F4EEE3] px-5 py-2.5 text-xs font-semibold text-[#1C2230] hover:border-[#5B5BF0] cursor-pointer"
                      >
                        {recordingState === "recording" ? (
                          <>
                            <Pause className="h-3.5 w-3.5" />
                            <span>{t("meetings.pauseRecording")}</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5" />
                            <span>{t("meetings.resumeRecording")}</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={stopLiveRecording}
                        className="inline-flex items-center gap-2 rounded-full bg-[#C23B3B] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#A72F2F] cursor-pointer"
                      >
                        <Square className="h-3.5 w-3.5" />
                        <span>{t("meetings.stopRecording")}</span>
                      </button>
                    </>
                  )}
                </div>

                {liveSpeechLines.length > 0 && (
                  <div className="rounded-2xl border border-[#1C2230]/10 bg-[#F4EEE3] p-3 text-left font-mono text-[11px] text-[#1C2230] max-h-28 overflow-y-auto">
                    {liveSpeechLines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                )}

                {recordingState === "recorded" && audioFile && (
                  <div className="flex justify-center">
                    <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-1.5 text-xs font-semibold text-emerald-800">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>
                        Captured {audioFile.name} ({Math.round(audioFile.size / 1024)} KB)
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 2. Audio File Dropzone */}
            {mode === "audio" && (
              <label className="group relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-[#5B5BF0]/35 bg-white p-8 text-center transition-all hover:border-[#5B5BF0] hover:bg-[#5B5BF0]/[0.02] cursor-pointer dark:bg-[#0B0F1A]">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5B5BF0]/10 text-[#5B5BF0] group-hover:scale-110 transition-transform">
                  <Upload className="h-6 w-6" />
                </div>
                <p className="mt-3 font-serif-editorial text-2xl text-[#101626] dark:text-white">
                  Drop an audio recording or click to browse
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  WAV, MP3, M4A, WebM, or OGG up to 25 MB · Transcribed for free automatically
                </p>
                <input
                  type="file"
                  accept="audio/wav,audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/webm,audio/ogg"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setAudioFile(f);
                    if (f && !title.trim()) {
                      setTitle(f.name.replace(/\.[^/.]+$/, ""));
                    }
                  }}
                  className="sr-only"
                />
                {audioFile && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      {audioFile.name} ({Math.round(audioFile.size / 1024)} KB)
                    </span>
                  </div>
                )}
              </label>
            )}

            {/* 3. Paste / Preset Transcript */}
            {mode === "transcript" && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#101626] dark:text-zinc-300">
                    {t("meetings.transcriptPasteLabel")}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-[#5B5BF0]" /> Try sample:
                    </span>
                    <button
                      type="button"
                      onClick={() => applySamplePreset("af_en")}
                      className="rounded-full border border-[#101626]/12 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#101626] hover:border-[#5B5BF0] dark:bg-white/10 dark:text-white cursor-pointer"
                    >
                      Afrikaans + English
                    </button>
                    <button
                      type="button"
                      onClick={() => applySamplePreset("fr")}
                      className="rounded-full border border-[#101626]/12 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#101626] hover:border-[#5B5BF0] dark:bg-white/10 dark:text-white cursor-pointer"
                    >
                      Français
                    </button>
                    <button
                      type="button"
                      onClick={() => applySamplePreset("ja")}
                      className="rounded-full border border-[#101626]/12 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#101626] hover:border-[#5B5BF0] dark:bg-white/10 dark:text-white cursor-pointer"
                    >
                      日本語
                    </button>
                  </div>
                </div>
                <textarea
                  rows={5}
                  value={rawTranscript}
                  onChange={(e) => setRawTranscript(e.target.value)}
                  placeholder={t("meetings.transcriptPastePlaceholder")}
                  className="memoir-field w-full rounded-2xl p-4 font-mono text-xs"
                />
              </div>
            )}

            {/* Simple, Friendly Fields: Title + Primary Languages */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300 mb-1">
                  {t("meetings.meetingTitleLabel")}
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("meetings.meetingTitlePlaceholder")}
                  className="memoir-field w-full rounded-xl px-3.5 py-2 text-xs font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300 mb-1">
                  {t("meetings.spokenLanguageLabel")}
                </label>
                <select
                  value={spokenLanguage}
                  onChange={(e) => setSpokenLanguage(e.target.value)}
                  className="memoir-field w-full rounded-xl px-3 py-2 text-xs font-medium"
                >
                  <option value="auto">{t("app.autoDetect")}</option>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.tag} value={lang.tag}>
                      {lang.nativeName} ({lang.englishName})
                    </option>
                  ))}
                  <option value="tlh">tlh - Klingon (Unsupported test)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#101626] dark:text-zinc-300 mb-1">
                  {t("meetings.summaryLanguageLabel")}
                </label>
                <select
                  value={summaryLanguage}
                  onChange={(e) => {
                    setSummaryLanguage(e.target.value);
                    setInsightsLanguage(e.target.value);
                  }}
                  className="memoir-field w-full rounded-xl px-3 py-2 text-xs font-medium"
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.tag} value={lang.tag}>
                      {lang.nativeName} ({lang.englishName})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Progressive Disclosure: Optional Studio Details */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvancedOptions((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-[#101626] dark:hover:text-white cursor-pointer"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>More studio options (engine &amp; separate action-item language)</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${
                    showAdvancedOptions ? "rotate-180" : ""
                  }`}
                />
              </button>

              <AnimatePresence>
                {showAdvancedOptions && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border border-[#101626]/10 bg-white/70 p-4 dark:border-white/10 dark:bg-[#0B0F1A]/60">
                      <div>
                        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                          {t("meetings.insightsLanguageLabel")}
                        </label>
                        <select
                          value={insightsLanguage}
                          onChange={(e) => setInsightsLanguage(e.target.value)}
                          className="w-full rounded-xl border border-[#101626]/12 bg-white px-3 py-1.5 text-xs dark:border-white/15 dark:bg-[#13192B]"
                        >
                          {SUPPORTED_LANGUAGES.map((lang) => (
                            <option key={lang.tag} value={lang.tag}>
                              {lang.nativeName} ({lang.englishName})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                          {t("meetings.providerLabel")}
                        </label>
                        <select
                          value={provider}
                          onChange={(e) =>
                            setProvider(e.target.value as TranscriptionProviderId | "auto")
                          }
                          className="w-full rounded-xl border border-[#101626]/12 bg-white px-3 py-1.5 text-xs dark:border-white/15 dark:bg-[#13192B]"
                        >
                          <option value="whisper-local">
                            Free Built-in Whisper (No API key needed)
                          </option>
                          <option value="auto">Auto (Best available)</option>
                          <option value="gemini">Google Gemini Audio</option>
                          <option value="openai">OpenAI Whisper</option>
                          <option value="deepgram">Deepgram Nova-2</option>
                        </select>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {isUnsupportedLanguage && (
              <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {t("meetings.unsupportedLanguageWarning", {
                    provider: selectedProviderCap.name,
                    language: spokenLanguage,
                  })}
                </span>
              </div>
            )}

            {processingStep && (
              <div className="flex items-center gap-2.5 rounded-2xl bg-[#5B5BF0]/10 px-4 py-3 text-xs font-semibold text-[#5B5BF0] dark:text-[#22D3EE]">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>{processingStep}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-5 py-2.5 text-xs font-semibold text-zinc-600 hover:bg-black/5 dark:text-zinc-300 cursor-pointer"
              >
                {t("app.cancel")}
              </button>
              <motion.button
                type="submit"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-full bg-[#101626] px-6 py-2.5 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(16,22,38,0.2)] hover:bg-[#5B5BF0] disabled:opacity-50 transition-colors cursor-pointer dark:bg-[#5B5BF0]"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{t("meetings.createAndProcess")}</span>
              </motion.button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

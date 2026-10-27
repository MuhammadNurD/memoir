export type ScriptCategory = "latin" | "cjk" | "arabic" | "devanagari" | "cyrillic";

export type TranscriptionProviderId =
  | "whisper-local"
  | "openai"
  | "deepgram"
  | "gemini"
  | "transcript-import";

export interface LanguageDefinition {
  /** Standard BCP 47 primary tag (e.g. "en", "af", "ja") */
  tag: string;
  /** Full regional BCP 47 tag for Intl formatting */
  bcp47: string;
  /** Native name in the language itself */
  nativeName: string;
  /** English display name */
  englishName: string;
  /** Script type */
  script: ScriptCategory;
  /** Text direction */
  dir: "ltr" | "rtl";
  /** Whether the UI has a full localization bundle for this language */
  uiSupported: boolean;
  /** Providers that support transcribing spoken audio in this language */
  transcriptionProviders: TranscriptionProviderId[];
  /** Providers that support generating structured AI summaries in this language */
  summarySupported: boolean;
}

export const SUPPORTED_LANGUAGES: readonly LanguageDefinition[] = [
  {
    tag: "en",
    bcp47: "en-US",
    nativeName: "English",
    englishName: "English",
    script: "latin",
    dir: "ltr",
    uiSupported: true,
    transcriptionProviders: ["whisper-local", "openai", "deepgram", "gemini", "transcript-import"],
    summarySupported: true,
  },
  {
    tag: "af",
    bcp47: "af-ZA",
    nativeName: "Afrikaans",
    englishName: "Afrikaans",
    script: "latin",
    dir: "ltr",
    uiSupported: true,
    transcriptionProviders: ["whisper-local", "openai", "gemini", "transcript-import"],
    summarySupported: true,
  },
  {
    tag: "es",
    bcp47: "es-ES",
    nativeName: "Español",
    englishName: "Spanish",
    script: "latin",
    dir: "ltr",
    uiSupported: true,
    transcriptionProviders: ["whisper-local", "openai", "deepgram", "gemini", "transcript-import"],
    summarySupported: true,
  },
  {
    tag: "fr",
    bcp47: "fr-FR",
    nativeName: "Français",
    englishName: "French",
    script: "latin",
    dir: "ltr",
    uiSupported: true,
    transcriptionProviders: ["whisper-local", "openai", "deepgram", "gemini", "transcript-import"],
    summarySupported: true,
  },
  {
    tag: "de",
    bcp47: "de-DE",
    nativeName: "Deutsch",
    englishName: "German",
    script: "latin",
    dir: "ltr",
    uiSupported: false,
    transcriptionProviders: ["whisper-local", "openai", "deepgram", "gemini", "transcript-import"],
    summarySupported: true,
  },
  {
    tag: "pt",
    bcp47: "pt-BR",
    nativeName: "Português",
    englishName: "Portuguese",
    script: "latin",
    dir: "ltr",
    uiSupported: false,
    transcriptionProviders: ["whisper-local", "openai", "deepgram", "gemini", "transcript-import"],
    summarySupported: true,
  },
  {
    tag: "ja",
    bcp47: "ja-JP",
    nativeName: "日本語",
    englishName: "Japanese",
    script: "cjk",
    dir: "ltr",
    uiSupported: true,
    transcriptionProviders: ["whisper-local", "openai", "deepgram", "gemini", "transcript-import"],
    summarySupported: true,
  },
  {
    tag: "ar",
    bcp47: "ar-SA",
    nativeName: "العربية",
    englishName: "Arabic",
    script: "arabic",
    dir: "rtl",
    uiSupported: true,
    transcriptionProviders: ["whisper-local", "openai", "gemini", "transcript-import"],
    summarySupported: true,
  },
  {
    tag: "hi",
    bcp47: "hi-IN",
    nativeName: "हिन्दी",
    englishName: "Hindi",
    script: "devanagari",
    dir: "ltr",
    uiSupported: false,
    transcriptionProviders: ["whisper-local", "openai", "deepgram", "gemini", "transcript-import"],
    summarySupported: true,
  },
  {
    tag: "zh",
    bcp47: "zh-CN",
    nativeName: "中文 (简体)",
    englishName: "Chinese (Simplified)",
    script: "cjk",
    dir: "ltr",
    uiSupported: false,
    transcriptionProviders: ["whisper-local", "openai", "deepgram", "gemini", "transcript-import"],
    summarySupported: true,
  },
  {
    tag: "zu",
    bcp47: "zu-ZA",
    nativeName: "isiZulu",
    englishName: "Zulu",
    script: "latin",
    dir: "ltr",
    uiSupported: false,
    transcriptionProviders: ["gemini", "transcript-import"],
    summarySupported: true,
  },
] as const;

export interface ProviderCapabilitySpec {
  id: TranscriptionProviderId;
  name: string;
  supportsAutoDetection: boolean;
  supportsSpeakerDiarization: boolean;
  supportsTimestamps: boolean;
  supportsCodeSwitching: boolean;
  supportedLanguageTags: string[];
  notes: string;
}

export const TRANSCRIPTION_PROVIDER_CAPABILITIES: Record<
  TranscriptionProviderId,
  ProviderCapabilitySpec
> = {
  "whisper-local": {
    id: "whisper-local",
    name: "Free Built-in Whisper ONNX (Zero API Key)",
    supportsAutoDetection: true,
    supportsSpeakerDiarization: false,
    supportsTimestamps: true,
    supportsCodeSwitching: true,
    supportedLanguageTags: ["en", "af", "es", "fr", "de", "pt", "ja", "ar", "hi", "zh"],
    notes:
      "100% free built-in multilingual Whisper ONNX model (Xenova/whisper-tiny) + Browser Web Speech API. Requires zero paid API keys.",
  },
  openai: {
    id: "openai",
    name: "OpenAI Whisper / GPT-4o Audio",
    supportsAutoDetection: true,
    supportsSpeakerDiarization: false,
    supportsTimestamps: true,
    supportsCodeSwitching: true,
    supportedLanguageTags: ["en", "af", "es", "fr", "de", "pt", "ja", "ar", "hi", "zh"],
    notes:
      "Supports broad multilingual transcription and timestamped segments. Standard Whisper endpoint does not provide multi-speaker diarization IDs.",
  },
  deepgram: {
    id: "deepgram",
    name: "Deepgram Nova-2",
    supportsAutoDetection: true,
    supportsSpeakerDiarization: true,
    supportsTimestamps: true,
    supportsCodeSwitching: true,
    supportedLanguageTags: ["en", "es", "fr", "de", "pt", "ja", "hi", "zh"],
    notes:
      "Supports speaker diarization, word-level timestamps, and code-switching. Does not currently cover Afrikaans (af), Arabic (ar), or isiZulu (zu).",
  },
  gemini: {
    id: "gemini",
    name: "Google Gemini Multimodal Audio",
    supportsAutoDetection: true,
    supportsSpeakerDiarization: true,
    supportsTimestamps: true,
    supportsCodeSwitching: true,
    supportedLanguageTags: ["en", "af", "es", "fr", "de", "pt", "ja", "ar", "hi", "zh", "zu"],
    notes:
      "Supports multilingual transcription, code-switching across scripts, speaker attribution, and Afrikaans/Arabic/Japanese/isiZulu coverage.",
  },
  "transcript-import": {
    id: "transcript-import",
    name: "Structured Transcript Ingestion",
    supportsAutoDetection: true,
    supportsSpeakerDiarization: true,
    supportsTimestamps: true,
    supportsCodeSwitching: true,
    supportedLanguageTags: ["en", "af", "es", "fr", "de", "pt", "ja", "ar", "hi", "zh", "zu"],
    notes:
      "Parses timestamped and speaker-labeled transcripts in any Unicode script with heuristic language detection.",
  },
};

export const UI_LOCALES = SUPPORTED_LANGUAGES.filter((l) => l.uiSupported);

export function normalizeBcp47Tag(tag: string | null | undefined): string {
  if (!tag) return "und";
  const cleaned = tag.trim().replace("_", "-");
  if (!cleaned) return "und";
  if (cleaned.toLowerCase() === "auto") return "auto";
  if (cleaned.toLowerCase() === "und" || cleaned.toLowerCase() === "unknown") return "und";

  const primary = cleaned.split("-")[0].toLowerCase();
  const match = SUPPORTED_LANGUAGES.find(
    (l) => l.tag.toLowerCase() === primary || l.bcp47.toLowerCase() === cleaned.toLowerCase()
  );
  if (match) return match.tag;

  if (/^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(cleaned)) {
    return primary;
  }
  return "und";
}

export function getLanguageDefinition(tag: string | null | undefined): LanguageDefinition | undefined {
  if (!tag || tag === "auto" || tag === "und") return undefined;
  const primary = normalizeBcp47Tag(tag);
  return SUPPORTED_LANGUAGES.find((l) => l.tag === primary);
}

export function isLanguageSupportedByProvider(
  languageTag: string,
  providerId: TranscriptionProviderId
): boolean {
  if (languageTag === "auto") {
    return TRANSCRIPTION_PROVIDER_CAPABILITIES[providerId].supportsAutoDetection;
  }
  const normalized = normalizeBcp47Tag(languageTag);
  if (normalized === "und") return false;
  return TRANSCRIPTION_PROVIDER_CAPABILITIES[providerId].supportedLanguageTags.includes(normalized);
}

export function getBestUiLocale(preferredTag: string | null | undefined): string {
  if (!preferredTag) return "en";
  const normalized = normalizeBcp47Tag(preferredTag);
  const supported = UI_LOCALES.find((l) => l.tag === normalized);
  return supported ? supported.tag : "en";
}

/**
 * Heuristic language detector for text transcripts when automatic detection is requested.
 * Inspects Unicode script ranges and common lexical markers across supported languages.
 */
export function detectTextLanguage(text: string): {
  detectedLanguage: string;
  confidence: number;
  detectedLanguages: string[];
  isCodeSwitching: boolean;
} {
  const sample = text.trim();
  if (!sample || sample.length < 4) {
    return {
      detectedLanguage: "und",
      confidence: 0,
      detectedLanguages: [],
      isCodeSwitching: false,
    };
  }

  const scores: Record<string, number> = {};

  // Check non-Latin Unicode scripts first
  const japaneseMatches = sample.match(/[\u3040-\u309F\u30A0-\u30FF]/g)?.length ?? 0;
  const cjkMatches = sample.match(/[\u4E00-\u9FFF]/g)?.length ?? 0;
  const arabicMatches = sample.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  const devanagariMatches = sample.match(/[\u0900-\u097F]/g)?.length ?? 0;

  if (japaneseMatches > 2) scores.ja = (scores.ja ?? 0) + japaneseMatches * 3;
  if (cjkMatches > 2 && japaneseMatches === 0) scores.zh = (scores.zh ?? 0) + cjkMatches * 2.5;
  if (cjkMatches > 2 && japaneseMatches > 0) scores.ja = (scores.ja ?? 0) + cjkMatches * 1.5;
  if (arabicMatches > 2) scores.ar = (scores.ar ?? 0) + arabicMatches * 3;
  if (devanagariMatches > 2) scores.hi = (scores.hi ?? 0) + devanagariMatches * 3;

  // Lexical markers for Latin-script languages
  const lower = ` ${sample.toLowerCase()} `;
  const markers: Record<string, string[]> = {
    af: [
      " die ",
      " nie ",
      " ons ",
      " het ",
      " vir ",
      " met ",
      " vergadering ",
      " besluit ",
      " aksie ",
      " vandag ",
      " môre ",
      " projek ",
      " sal ",
      " moet ",
      " gaan ",
    ],
    en: [
      " the ",
      " and ",
      " meeting ",
      " action ",
      " decision ",
      " team ",
      " will ",
      " should ",
      " with ",
      " for ",
      " that ",
      " have ",
      " we ",
      " project ",
    ],
    es: [
      " el ",
      " la ",
      " los ",
      " las ",
      " para ",
      " con ",
      " reunión ",
      " equipo ",
      " decisión ",
      " acción ",
      " proyecto ",
      " gracias ",
      " vamos ",
      " está ",
    ],
    fr: [
      " le ",
      " la ",
      " les ",
      " des ",
      " pour ",
      " avec ",
      " réunion ",
      " équipe ",
      " décision ",
      " nous ",
      " vous ",
      " dans ",
      " est ",
      " projet ",
    ],
    de: [
      " der ",
      " die ",
      " das ",
      " und ",
      " für ",
      " mit ",
      " besprechung ",
      " wir ",
      " nicht ",
      " ist ",
      " projekt ",
    ],
    pt: [
      " o ",
      " a ",
      " os ",
      " para ",
      " com ",
      " reunião ",
      " equipe ",
      " decisão ",
      " não ",
      " está ",
      " projeto ",
    ],
    zu: [" ukuthi ", " lapha ", "ethu ", " umhlangano ", " sizokwenza ", " yebo ", " ngiyabonga "],
  };

  for (const [lang, words] of Object.entries(markers)) {
    for (const w of words) {
      let idx = lower.indexOf(w);
      while (idx !== -1) {
        scores[lang] = (scores[lang] ?? 0) + 2;
        idx = lower.indexOf(w, idx + w.length);
      }
    }
  }

  const ranked = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    return {
      detectedLanguage: "und",
      confidence: 0.2,
      detectedLanguages: [],
      isCodeSwitching: false,
    };
  }

  const topLang = ranked[0][0];
  const topScore = ranked[0][1];
  const totalScore = ranked.reduce((acc, [, s]) => acc + s, 0);
  const significantLangs = ranked
    .filter(([, s]) => s >= Math.max(4, topScore * 0.25))
    .map(([l]) => l);

  const confidence = Math.min(0.98, Math.max(0.45, topScore / Math.max(totalScore, 6)));

  return {
    detectedLanguage: topLang,
    confidence: Number(confidence.toFixed(2)),
    detectedLanguages: significantLangs,
    isCodeSwitching: significantLangs.length > 1,
  };
}

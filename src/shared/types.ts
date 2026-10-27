import type { TranscriptionProviderId } from "./languages";

export type AuthProviderType = "google" | "apple" | "email" | "magic_link";

export interface UserProfile {
  id: string;
  email: string | null;
  emailVerified: boolean;
  isPrivateRelayEmail: boolean;
  displayName: string;
  avatarUrl: string | null;
  uiLanguage: string;
  defaultSpokenLanguage: string;
  defaultSummaryLanguage: string;
  defaultInsightsLanguage: string;
  preferredTranscriptionProvider: TranscriptionProviderId | "auto";
  createdAt: string;
  updatedAt: string;
}

export interface LinkedIdentity {
  id: string;
  userId: string;
  provider: AuthProviderType;
  providerUserId: string;
  providerEmail: string | null;
  emailVerified: boolean;
  isPrivateRelay: boolean;
  createdAt: string;
  lastSignInAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
}

export type MeetingStatus =
  | "draft"
  | "uploading"
  | "transcribing"
  | "summarizing"
  | "ready"
  | "failed";

export interface MeetingRecord {
  id: string;
  workspaceId: string;
  ownerId: string;
  title: string;
  description: string | null;
  status: MeetingStatus;
  spokenLanguageConfig: string; // e.g. "auto", "en", "af", "ja"
  detectedLanguage: string; // e.g. "en", "af", "und"
  detectedLanguages: string[]; // e.g. ["en", "af"] for code-switching
  languageConfidence: number | null;
  languageOverridden: boolean;
  preferredSummaryLanguage: string;
  preferredInsightsLanguage: string;
  transcriptionProvider: string | null;
  durationSeconds: number | null;
  recordedAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  shareToken: string | null;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AudioAssetRecord {
  id: string;
  meetingId: string;
  ownerId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  storageKey: string;
  createdAt: string;
}

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  sequenceIndex: number;
  startTimeMs: number;
  endTimeMs: number;
  speaker: string | null;
  text: string;
  language: string; // BCP 47 tag for segment (supports code-switching)
  isUserEdited: boolean;
}

export interface TranscriptRecord {
  id: string;
  meetingId: string;
  sourceLanguage: string;
  detectedLanguage: string;
  detectedLanguages: string[];
  isCodeSwitching: boolean;
  provider: string;
  fullText: string;
  isUserEdited: boolean;
  segments: TranscriptSegment[];
  createdAt: string;
  updatedAt: string;
}

export interface MeetingSummaryRecord {
  id: string;
  meetingId: string;
  sourceLanguage: string;
  outputLanguage: string;
  insightsLanguage: string;
  provider: string;
  model: string;
  executiveSummary: string;
  keyDiscussionPoints: string[];
  unresolvedQuestions: string[];
  isUserEdited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActionItemRecord {
  id: string;
  meetingId: string;
  summaryId: string | null;
  language: string;
  title: string;
  owner: string | null; // null represents unknown owner
  dueDate: string | null; // null represents unknown deadline
  status: "open" | "in_progress" | "completed";
  confidence: "high" | "medium" | "uncertain";
  sourceQuote: string | null;
  isUserEdited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DecisionRecord {
  id: string;
  meetingId: string;
  summaryId: string | null;
  language: string;
  decisionText: string;
  context: string | null;
  madeBy: string | null;
  isUserEdited: boolean;
  createdAt: string;
}

export interface ProcessingJobRecord {
  id: string;
  meetingId: string;
  jobType: "transcribe" | "summarize";
  status: "queued" | "running" | "completed" | "failed";
  sourceLanguage: string;
  targetLanguage: string;
  insightsLanguage: string;
  provider: string;
  attemptCount: number;
  idempotencyKey: string;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface MeetingDetailPayload {
  meeting: MeetingRecord;
  audioAsset: AudioAssetRecord | null;
  transcript: TranscriptRecord | null;
  summaries: MeetingSummaryRecord[];
  activeSummary: MeetingSummaryRecord | null;
  actionItems: ActionItemRecord[];
  decisions: DecisionRecord[];
  jobs: ProcessingJobRecord[];
}

export interface SearchResultItem {
  meetingId: string;
  meetingTitle: string;
  recordedAt: string;
  detectedLanguage: string;
  matchSource: "title" | "transcript" | "summary" | "decision" | "action_item";
  matchLanguage: string;
  snippet: string;
  timestampMs: number | null;
  speaker: string | null;
}

import { z } from "zod";
import { normalizeBcp47Tag } from "./languages";

export const bcp47Schema = z
  .string()
  .min(2)
  .max(20)
  .transform((val) => normalizeBcp47Tag(val));

export const signUpInputSchema = z.object({
  email: z.string().email("Invalid email address").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  displayName: z.string().trim().min(1, "Name is required").max(100),
  uiLanguage: bcp47Schema.optional().default("en"),
});

export const signInInputSchema = z.object({
  email: z.string().email("Invalid email address").max(255),
  password: z.string().min(1, "Password is required").max(128),
});

export const magicLinkInputSchema = z.object({
  email: z.string().email("Invalid email address").max(255),
  uiLanguage: bcp47Schema.optional().default("en"),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email("Invalid email address").max(255),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(16),
  newPassword: z.string().min(8).max(128),
});

export const updateUserSettingsSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  uiLanguage: bcp47Schema.optional(),
  defaultSpokenLanguage: bcp47Schema.optional(),
  defaultSummaryLanguage: bcp47Schema.optional(),
  defaultInsightsLanguage: bcp47Schema.optional(),
  preferredTranscriptionProvider: z
    .enum(["auto", "whisper-local", "openai", "deepgram", "gemini", "transcript-import"])
    .optional(),
});

export const createMeetingInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  spokenLanguageConfig: bcp47Schema.default("auto"),
  preferredSummaryLanguage: bcp47Schema.default("en"),
  preferredInsightsLanguage: bcp47Schema.default("en"),
  transcriptionProvider: z
    .enum(["auto", "whisper-local", "openai", "deepgram", "gemini", "transcript-import"])
    .optional()
    .default("auto"),
  rawTranscriptText: z.string().max(500_000).optional(),
  recordedAt: z.string().datetime().optional(),
});

export const updateMeetingInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  spokenLanguageConfig: bcp47Schema.optional(),
  detectedLanguageOverride: bcp47Schema.optional(),
  preferredSummaryLanguage: bcp47Schema.optional(),
  preferredInsightsLanguage: bcp47Schema.optional(),
  isShared: z.boolean().optional(),
});

export const generateSummaryInputSchema = z.object({
  outputLanguage: bcp47Schema,
  insightsLanguage: bcp47Schema.optional(),
  idempotencyKey: z.string().max(120).optional(),
});

export const updateTranscriptSegmentSchema = z.object({
  segmentId: z.string().min(1),
  text: z.string().trim().min(1).max(10_000),
  speaker: z.string().trim().max(100).nullable().optional(),
  language: bcp47Schema.optional(),
});

export const updateSummaryContentSchema = z.object({
  summaryId: z.string().min(1),
  executiveSummary: z.string().trim().min(1).max(50_000),
  keyDiscussionPoints: z.array(z.string().trim().min(1).max(2000)).max(50),
  unresolvedQuestions: z.array(z.string().trim().min(1).max(2000)).max(50),
});

export const updateActionItemSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  owner: z.string().trim().max(120).nullable().optional(),
  dueDate: z.string().trim().max(64).nullable().optional(),
  status: z.enum(["open", "in_progress", "completed"]).optional(),
});

export const createActionItemSchema = z.object({
  title: z.string().trim().min(1).max(500),
  owner: z.string().trim().max(120).nullable().optional().default(null),
  dueDate: z.string().trim().max(64).nullable().optional().default(null),
  language: bcp47Schema.optional().default("en"),
});

/**
 * Schema for structured AI summary outputs.
 * Enforces structure across all output languages while preserving null/unknown owners and deadlines.
 */
export const structuredAiSummaryOutputSchema = z.object({
  executiveSummary: z.string().min(1),
  keyDiscussionPoints: z.array(z.string().min(1)).default([]),
  unresolvedQuestions: z.array(z.string().min(1)).default([]),
  decisions: z
    .array(
      z.object({
        decisionText: z.string().min(1),
        context: z.string().nullable().optional().default(null),
        madeBy: z.string().nullable().optional().default(null),
      })
    )
    .default([]),
  actionItems: z
    .array(
      z.object({
        title: z.string().min(1),
        owner: z.string().nullable().optional().default(null),
        dueDate: z.string().nullable().optional().default(null),
        confidence: z.enum(["high", "medium", "uncertain"]).optional().default("high"),
        sourceQuote: z.string().nullable().optional().default(null),
      })
    )
    .default([]),
});

export type StructuredAiSummaryOutput = z.infer<typeof structuredAiSummaryOutputSchema>;

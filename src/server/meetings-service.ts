import crypto from "node:crypto";
import { getDb, generateId, rebuildMeetingSearchIndex, stripDiacritics } from "./db";
import {
  generateMultilingualSummary,
  parseRawTranscriptIntoSegments,
  ProviderCapabilityError,
  transcribeAudioBuffer,
  type TranscriptionOutput,
} from "./ai-providers";
import { normalizeBcp47Tag, type TranscriptionProviderId } from "../shared/languages";
import type {
  ActionItemRecord,
  AudioAssetRecord,
  DecisionRecord,
  MeetingDetailPayload,
  MeetingRecord,
  MeetingSummaryRecord,
  ProcessingJobRecord,
  SearchResultItem,
  TranscriptRecord,
  TranscriptSegment,
} from "../shared/types";
import { readAudioBytes } from "./storage";

export class AccessDeniedError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message = "You do not have permission to access this meeting.", status = 403) {
    super(message);
    this.code = status === 404 ? "NOT_FOUND" : "FORBIDDEN";
    this.status = status;
  }
}

function mapMeetingRow(row: Record<string, unknown>): MeetingRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    ownerId: String(row.owner_id),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    status: row.status as MeetingRecord["status"],
    spokenLanguageConfig: String(row.spoken_language_config || "auto"),
    detectedLanguage: String(row.detected_language || "und"),
    detectedLanguages: JSON.parse(String(row.detected_languages_json || "[]")) as string[],
    languageConfidence:
      row.language_confidence !== null && row.language_confidence !== undefined
        ? Number(row.language_confidence)
        : null,
    languageOverridden: Boolean(row.language_overridden),
    preferredSummaryLanguage: String(row.preferred_summary_language || "en"),
    preferredInsightsLanguage: String(row.preferred_insights_language || "en"),
    transcriptionProvider: row.transcription_provider ? String(row.transcription_provider) : null,
    durationSeconds:
      row.duration_seconds !== null && row.duration_seconds !== undefined
        ? Number(row.duration_seconds)
        : null,
    recordedAt: String(row.recorded_at),
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    shareToken: row.share_token ? String(row.share_token) : null,
    isShared: Boolean(row.is_shared),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Enforces server-side authorization for any meeting resource.
 * Verifies the user is either the meeting owner or a member of the meeting's workspace.
 */
export function requireAuthorizedMeetingAccess(
  meetingId: string,
  userId: string
): MeetingRecord {
  const db = getDb();
  const row = db.prepare("SELECT * FROM meetings WHERE id = ?").get(meetingId) as
    | Record<string, unknown>
    | undefined;

  if (!row) {
    throw new AccessDeniedError("Meeting not found.", 404);
  }

  const meeting = mapMeetingRow(row);
  if (meeting.ownerId === userId) {
    return meeting;
  }

  const membership = db
    .prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .get(meeting.workspaceId, userId) as { role: string } | undefined;

  if (!membership) {
    throw new AccessDeniedError("You are not authorized to access this meeting.", 403);
  }

  return meeting;
}

export function listMeetingsForUser(
  userId: string,
  filters?: { status?: string; language?: string; query?: string }
): MeetingRecord[] {
  const db = getDb();
  let sql = `
    SELECT m.*
    FROM meetings m
    LEFT JOIN workspace_members wm ON wm.workspace_id = m.workspace_id AND wm.user_id = ?
    WHERE (m.owner_id = ? OR wm.user_id IS NOT NULL)
  `;
  const params: Array<string | number> = [userId, userId];

  if (filters?.status && filters.status !== "all") {
    sql += " AND m.status = ?";
    params.push(filters.status);
  }

  if (filters?.language && filters.language !== "all") {
    sql += " AND (m.detected_language = ? OR m.spoken_language_config = ?)";
    params.push(filters.language, filters.language);
  }

  if (filters?.query && filters.query.trim()) {
    sql += " AND lower(m.title) LIKE ?";
    params.push(`%${filters.query.trim().toLowerCase()}%`);
  }

  sql += " ORDER BY m.recorded_at DESC";

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapMeetingRow);
}

export function createMeeting(params: {
  userId: string;
  workspaceId: string;
  title: string;
  description?: string | null;
  spokenLanguageConfig?: string;
  preferredSummaryLanguage?: string;
  preferredInsightsLanguage?: string;
  transcriptionProvider?: string;
  recordedAt?: string;
}): MeetingRecord {
  const db = getDb();
  const now = new Date().toISOString();
  const meetingId = generateId("mtg");
  const spokenLang = normalizeBcp47Tag(params.spokenLanguageConfig || "auto");
  const summaryLang = normalizeBcp47Tag(params.preferredSummaryLanguage || "en");
  const insightsLang = normalizeBcp47Tag(params.preferredInsightsLanguage || summaryLang);

  db.prepare(
    `INSERT INTO meetings (
      id, workspace_id, owner_id, title, description, status,
      spoken_language_config, detected_language, detected_languages_json,
      preferred_summary_language, preferred_insights_language, transcription_provider,
      recorded_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'draft', ?, 'und', '[]', ?, ?, ?, ?, ?, ?)`
  ).run(
    meetingId,
    params.workspaceId,
    params.userId,
    params.title.trim(),
    params.description?.trim() || null,
    spokenLang,
    summaryLang === "auto" || summaryLang === "und" ? "en" : summaryLang,
    insightsLang === "auto" || insightsLang === "und" ? "en" : insightsLang,
    params.transcriptionProvider || "auto",
    params.recordedAt || now,
    now,
    now
  );

  rebuildMeetingSearchIndex(db, meetingId);
  return requireAuthorizedMeetingAccess(meetingId, params.userId);
}

export function saveTranscriptOutput(
  meetingId: string,
  output: TranscriptionOutput
): TranscriptRecord {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare("SELECT id FROM transcripts WHERE meeting_id = ?")
    .get(meetingId) as { id: string } | undefined;

  const transcriptId = existing?.id || generateId("tr");
  const maxEndMs = output.segments.reduce((max, s) => Math.max(max, s.endTimeMs), 0);
  const durationSec = maxEndMs > 0 ? Math.round(maxEndMs / 1000) : null;

  db.exec("BEGIN IMMEDIATE");
  try {
    if (existing) {
      db.prepare("DELETE FROM transcript_segments WHERE transcript_id = ?").run(transcriptId);
      db.prepare(
        `UPDATE transcripts
         SET source_language = ?, detected_language = ?, detected_languages_json = ?,
             is_code_switching = ?, provider = ?, full_text = ?, is_user_edited = 0, updated_at = ?
         WHERE id = ?`
      ).run(
        output.sourceLanguage,
        output.detectedLanguage,
        JSON.stringify(output.detectedLanguages),
        output.isCodeSwitching ? 1 : 0,
        output.provider,
        output.fullText,
        now,
        transcriptId
      );
    } else {
      db.prepare(
        `INSERT INTO transcripts (
          id, meeting_id, source_language, detected_language, detected_languages_json,
          is_code_switching, provider, full_text, is_user_edited, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        transcriptId,
        meetingId,
        output.sourceLanguage,
        output.detectedLanguage,
        JSON.stringify(output.detectedLanguages),
        output.isCodeSwitching ? 1 : 0,
        output.provider,
        output.fullText,
        now,
        now
      );
    }

    const insertSeg = db.prepare(
      `INSERT INTO transcript_segments (
        id, meeting_id, transcript_id, sequence_index, start_time_ms, end_time_ms,
        speaker, text, language, is_user_edited
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    );

    output.segments.forEach((seg, idx) => {
      insertSeg.run(
        generateId("seg"),
        meetingId,
        transcriptId,
        idx,
        seg.startTimeMs,
        seg.endTimeMs,
        seg.speaker,
        seg.text,
        seg.language
      );
    });

    db.prepare(
      `UPDATE meetings
       SET detected_language = CASE WHEN language_overridden = 1 THEN detected_language ELSE ? END,
           detected_languages_json = ?,
           language_confidence = ?,
           transcription_provider = ?,
           duration_seconds = COALESCE(duration_seconds, ?),
           error_code = NULL,
           error_message = NULL,
           updated_at = ?
       WHERE id = ?`
    ).run(
      output.detectedLanguage,
      JSON.stringify(output.detectedLanguages),
      output.languageConfidence,
      output.provider,
      durationSec,
      now,
      meetingId
    );

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  rebuildMeetingSearchIndex(db, meetingId);
  return getTranscriptForMeeting(meetingId)!;
}

export async function processMeetingTranscriptionAndSummary(params: {
  meetingId: string;
  userId: string;
  rawTranscriptText?: string;
  clientTranscriptText?: string;
  idempotencyKey?: string;
}): Promise<MeetingDetailPayload> {
  const meeting = requireAuthorizedMeetingAccess(params.meetingId, params.userId);
  const db = getDb();
  const now = new Date().toISOString();

  const idemKey =
    params.idempotencyKey ||
    `transcribe_${meeting.id}_${crypto
      .createHash("sha256")
      .update(params.rawTranscriptText || meeting.updatedAt)
      .digest("hex")
      .slice(0, 16)}`;

  const existingJob = db
    .prepare("SELECT * FROM processing_jobs WHERE idempotency_key = ?")
    .get(idemKey) as Record<string, unknown> | undefined;

  if (existingJob && existingJob.status === "running") {
    return getMeetingDetailForUser(meeting.id, params.userId);
  }

  const jobId = existingJob ? String(existingJob.id) : generateId("job");
  if (!existingJob) {
    db.prepare(
      `INSERT INTO processing_jobs (
        id, meeting_id, job_type, status, source_language, target_language,
        insights_language, provider, attempt_count, idempotency_key, started_at, created_at
      ) VALUES (?, ?, 'transcribe', 'running', ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      jobId,
      meeting.id,
      meeting.spokenLanguageConfig,
      meeting.preferredSummaryLanguage,
      meeting.preferredInsightsLanguage,
      meeting.transcriptionProvider || "auto",
      idemKey,
      now,
      now
    );
  } else {
    db.prepare(
      "UPDATE processing_jobs SET status = 'running', attempt_count = attempt_count + 1, error_message = NULL, started_at = ? WHERE id = ?"
    ).run(now, jobId);
  }

  db.prepare(
    "UPDATE meetings SET status = 'transcribing', error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ?"
  ).run(now, meeting.id);

  try {
    let transcriptionOutput: TranscriptionOutput;

    if (params.rawTranscriptText !== undefined) {
      // Check if user explicitly picked an audio provider that doesn't support the configured language
      const prefProv = (meeting.transcriptionProvider || "auto") as TranscriptionProviderId | "auto";
      if (prefProv !== "auto" && prefProv !== "transcript-import") {
        const { isLanguageSupportedByProvider, TRANSCRIPTION_PROVIDER_CAPABILITIES } = await import(
          "../shared/languages"
        );
        if (!isLanguageSupportedByProvider(meeting.spokenLanguageConfig, prefProv)) {
          throw new ProviderCapabilityError(
            "UNSUPPORTED_LANGUAGE",
            `Provider '${TRANSCRIPTION_PROVIDER_CAPABILITIES[prefProv].name}' does not support spoken language '${meeting.spokenLanguageConfig}'.`,
            422
          );
        }
      } else if (meeting.spokenLanguageConfig !== "auto") {
        const { SUPPORTED_LANGUAGES } = await import("../shared/languages");
        const isKnown = SUPPORTED_LANGUAGES.some((l) => l.tag === meeting.spokenLanguageConfig);
        if (!isKnown) {
          throw new ProviderCapabilityError(
            "UNSUPPORTED_LANGUAGE",
            `Spoken language '${meeting.spokenLanguageConfig}' is not supported by any configured transcription provider.`,
            422
          );
        }
      }

      transcriptionOutput = parseRawTranscriptIntoSegments(
        params.rawTranscriptText,
        meeting.spokenLanguageConfig
      );
    } else {
      const audioRow = db
        .prepare("SELECT * FROM audio_assets WHERE meeting_id = ?")
        .get(meeting.id) as Record<string, unknown> | undefined;

      if (!audioRow) {
        throw new ProviderCapabilityError(
          "MISSING_AUDIO_ASSET",
          "No audio recording or transcript was found for this meeting.",
          400
        );
      }

      const audioBytes = await readAudioBytes(String(audioRow.storage_key));
      if (!audioBytes) {
        throw new ProviderCapabilityError(
          "AUDIO_STORAGE_READ_ERROR",
          "Audio file could not be read from storage.",
          500
        );
      }

      transcriptionOutput = await transcribeAudioBuffer({
        audioBytes,
        fileName: String(audioRow.file_name),
        mimeType: String(audioRow.mime_type),
        spokenLanguageConfig: meeting.spokenLanguageConfig,
        preferredProvider:
          (meeting.transcriptionProvider as TranscriptionProviderId | "auto") || "auto",
        clientTranscriptText: params.clientTranscriptText,
      });
    }

    saveTranscriptOutput(meeting.id, transcriptionOutput);

    db.prepare(
      "UPDATE processing_jobs SET status = 'completed', provider = ?, completed_at = ? WHERE id = ?"
    ).run(transcriptionOutput.provider, new Date().toISOString(), jobId);

    // Automatically generate initial summary in preferredSummaryLanguage
    await generateOrRegenerateMeetingSummary({
      meetingId: meeting.id,
      userId: params.userId,
      outputLanguage: meeting.preferredSummaryLanguage,
      insightsLanguage: meeting.preferredInsightsLanguage,
    });

    return getMeetingDetailForUser(meeting.id, params.userId);
  } catch (err) {
    const code = err instanceof ProviderCapabilityError ? err.code : "PROCESSING_FAILED";
    const msg = err instanceof Error ? err.message : "Failed to process meeting.";
    const failTime = new Date().toISOString();

    db.prepare(
      "UPDATE processing_jobs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?"
    ).run(msg, failTime, jobId);

    db.prepare(
      "UPDATE meetings SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?"
    ).run(code, msg, failTime, meeting.id);

    throw err;
  }
}

/**
 * Generates or regenerates a meeting summary in `outputLanguage` without modifying or re-running
 * the original source-language transcript.
 */
export async function generateOrRegenerateMeetingSummary(params: {
  meetingId: string;
  userId: string;
  outputLanguage: string;
  insightsLanguage?: string;
  idempotencyKey?: string;
}): Promise<MeetingSummaryRecord> {
  const meeting = requireAuthorizedMeetingAccess(params.meetingId, params.userId);
  const transcript = getTranscriptForMeeting(meeting.id);
  if (!transcript) {
    throw new ProviderCapabilityError(
      "TRANSCRIPT_REQUIRED",
      "Cannot generate summary because this meeting does not have a transcript yet.",
      400
    );
  }

  const db = getDb();
  const now = new Date().toISOString();
  const outLang = normalizeBcp47Tag(params.outputLanguage || meeting.preferredSummaryLanguage);
  const insightsLang = normalizeBcp47Tag(
    params.insightsLanguage || outLang || meeting.preferredInsightsLanguage
  );
  const sourceLang =
    meeting.detectedLanguage !== "und"
      ? meeting.detectedLanguage
      : transcript.detectedLanguage !== "und"
        ? transcript.detectedLanguage
        : meeting.spokenLanguageConfig;

  const idemKey =
    params.idempotencyKey ||
    `summarize_${meeting.id}_${outLang}_${insightsLang}_${Date.now()}`;

  const jobId = generateId("job");
  db.prepare(
    `INSERT INTO processing_jobs (
      id, meeting_id, job_type, status, source_language, target_language,
      insights_language, provider, attempt_count, idempotency_key, started_at, created_at
    ) VALUES (?, ?, 'summarize', 'running', ?, ?, ?, 'auto', 1, ?, ?, ?)`
  ).run(jobId, meeting.id, sourceLang, outLang, insightsLang, idemKey, now, now);

  db.prepare("UPDATE meetings SET status = 'summarizing', updated_at = ? WHERE id = ?").run(
    now,
    meeting.id
  );

  try {
    const result = await generateMultilingualSummary({
      meetingTitle: meeting.title,
      transcriptText: transcript.fullText,
      segments: transcript.segments.map((s) => ({
        startTimeMs: s.startTimeMs,
        endTimeMs: s.endTimeMs,
        speaker: s.speaker,
        text: s.text,
        language: s.language,
      })),
      sourceLanguage: sourceLang,
      outputLanguage: outLang,
      insightsLanguage: insightsLang,
    });

    const existingSummary = db
      .prepare(
        "SELECT id FROM meeting_summaries WHERE meeting_id = ? AND output_language = ?"
      )
      .get(meeting.id, outLang) as { id: string } | undefined;

    const summaryId = existingSummary?.id || generateId("sum");
    const completedAt = new Date().toISOString();

    db.exec("BEGIN IMMEDIATE");
    try {
      if (existingSummary) {
        db.prepare(
          `UPDATE meeting_summaries
           SET source_language = ?, insights_language = ?, provider = ?, model = ?,
               executive_summary = ?, key_discussion_points_json = ?, unresolved_questions_json = ?,
               is_user_edited = 0, updated_at = ?
           WHERE id = ?`
        ).run(
          sourceLang,
          insightsLang,
          result.provider,
          result.model,
          result.structured.executiveSummary,
          JSON.stringify(result.structured.keyDiscussionPoints),
          JSON.stringify(result.structured.unresolvedQuestions),
          completedAt,
          summaryId
        );

        // Replace non-user-edited decisions and action items tied to this summary
        db.prepare(
          "DELETE FROM decisions WHERE meeting_id = ? AND summary_id = ? AND is_user_edited = 0"
        ).run(meeting.id, summaryId);
        db.prepare(
          "DELETE FROM action_items WHERE meeting_id = ? AND summary_id = ? AND is_user_edited = 0"
        ).run(meeting.id, summaryId);
      } else {
        db.prepare(
          `INSERT INTO meeting_summaries (
            id, meeting_id, source_language, output_language, insights_language,
            provider, model, executive_summary, key_discussion_points_json,
            unresolved_questions_json, is_user_edited, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(
          summaryId,
          meeting.id,
          sourceLang,
          outLang,
          insightsLang,
          result.provider,
          result.model,
          result.structured.executiveSummary,
          JSON.stringify(result.structured.keyDiscussionPoints),
          JSON.stringify(result.structured.unresolvedQuestions),
          completedAt,
          completedAt
        );
      }

      const insertDecision = db.prepare(
        `INSERT INTO decisions (
          id, meeting_id, summary_id, language, decision_text, context, made_by, is_user_edited, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
      );
      for (const dec of result.structured.decisions) {
        insertDecision.run(
          generateId("dec"),
          meeting.id,
          summaryId,
          insightsLang,
          dec.decisionText,
          dec.context ?? null,
          dec.madeBy ?? null,
          completedAt
        );
      }

      const insertAction = db.prepare(
        `INSERT INTO action_items (
          id, meeting_id, summary_id, language, title, owner, due_date,
          status, confidence, source_quote, is_user_edited, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, 0, ?, ?)`
      );
      for (const act of result.structured.actionItems) {
        insertAction.run(
          generateId("act"),
          meeting.id,
          summaryId,
          insightsLang,
          act.title,
          act.owner ?? null,
          act.dueDate ?? null,
          act.confidence || "high",
          act.sourceQuote ?? null,
          completedAt,
          completedAt
        );
      }

      db.prepare(
        `UPDATE meetings
         SET status = 'ready',
             preferred_summary_language = ?,
             preferred_insights_language = ?,
             error_code = NULL,
             error_message = NULL,
             updated_at = ?
         WHERE id = ?`
      ).run(outLang, insightsLang, completedAt, meeting.id);

      db.prepare(
        "UPDATE processing_jobs SET status = 'completed', provider = ?, completed_at = ? WHERE id = ?"
      ).run(result.provider, completedAt, jobId);

      db.exec("COMMIT");
    } catch (innerErr) {
      db.exec("ROLLBACK");
      throw innerErr;
    }

    rebuildMeetingSearchIndex(db, meeting.id);
    const summaries = getSummariesForMeeting(meeting.id);
    return summaries.find((s) => s.id === summaryId)!;
  } catch (err) {
    const code = err instanceof ProviderCapabilityError ? err.code : "SUMMARY_FAILED";
    const msg = err instanceof Error ? err.message : "Failed to generate summary.";
    const failTime = new Date().toISOString();

    db.prepare(
      "UPDATE processing_jobs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?"
    ).run(msg, failTime, jobId);

    db.prepare(
      "UPDATE meetings SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?"
    ).run(code, msg, failTime, meeting.id);

    throw err;
  }
}

export function getTranscriptForMeeting(meetingId: string): TranscriptRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM transcripts WHERE meeting_id = ?")
    .get(meetingId) as Record<string, unknown> | undefined;

  if (!row) return null;

  const segRows = db
    .prepare(
      "SELECT * FROM transcript_segments WHERE meeting_id = ? ORDER BY sequence_index ASC"
    )
    .all(meetingId) as Array<Record<string, unknown>>;

  const segments: TranscriptSegment[] = segRows.map((s) => ({
    id: String(s.id),
    meetingId: String(s.meeting_id),
    sequenceIndex: Number(s.sequence_index),
    startTimeMs: Number(s.start_time_ms),
    endTimeMs: Number(s.end_time_ms),
    speaker: s.speaker ? String(s.speaker) : null,
    text: String(s.text),
    language: String(s.language || "und"),
    isUserEdited: Boolean(s.is_user_edited),
  }));

  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    sourceLanguage: String(row.source_language),
    detectedLanguage: String(row.detected_language),
    detectedLanguages: JSON.parse(String(row.detected_languages_json || "[]")) as string[],
    isCodeSwitching: Boolean(row.is_code_switching),
    provider: String(row.provider),
    fullText: String(row.full_text),
    isUserEdited: Boolean(row.is_user_edited),
    segments,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getSummariesForMeeting(meetingId: string): MeetingSummaryRecord[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM meeting_summaries WHERE meeting_id = ? ORDER BY updated_at DESC")
    .all(meetingId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    meetingId: String(r.meeting_id),
    sourceLanguage: String(r.source_language),
    outputLanguage: String(r.output_language),
    insightsLanguage: String(r.insights_language),
    provider: String(r.provider),
    model: String(r.model),
    executiveSummary: String(r.executive_summary),
    keyDiscussionPoints: JSON.parse(String(r.key_discussion_points_json || "[]")) as string[],
    unresolvedQuestions: JSON.parse(String(r.unresolved_questions_json || "[]")) as string[],
    isUserEdited: Boolean(r.is_user_edited),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export function getMeetingDetailForUser(
  meetingId: string,
  userId: string
): MeetingDetailPayload {
  const meeting = requireAuthorizedMeetingAccess(meetingId, userId);
  return buildMeetingDetailPayload(meeting);
}

export function getSharedMeetingByToken(shareToken: string): MeetingDetailPayload | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM meetings WHERE share_token = ? AND is_shared = 1")
    .get(shareToken) as Record<string, unknown> | undefined;

  if (!row) return null;
  return buildMeetingDetailPayload(mapMeetingRow(row));
}

function buildMeetingDetailPayload(meeting: MeetingRecord): MeetingDetailPayload {
  const db = getDb();
  const audioRow = db
    .prepare("SELECT * FROM audio_assets WHERE meeting_id = ?")
    .get(meeting.id) as Record<string, unknown> | undefined;

  const audioAsset: AudioAssetRecord | null = audioRow
    ? {
        id: String(audioRow.id),
        meetingId: String(audioRow.meeting_id),
        ownerId: String(audioRow.owner_id),
        fileName: String(audioRow.file_name),
        mimeType: String(audioRow.mime_type),
        sizeBytes: Number(audioRow.size_bytes),
        durationSeconds:
          audioRow.duration_seconds !== null && audioRow.duration_seconds !== undefined
            ? Number(audioRow.duration_seconds)
            : null,
        storageKey: String(audioRow.storage_key),
        createdAt: String(audioRow.created_at),
      }
    : null;

  const transcript = getTranscriptForMeeting(meeting.id);
  const summaries = getSummariesForMeeting(meeting.id);
  const activeSummary =
    summaries.find((s) => s.outputLanguage === meeting.preferredSummaryLanguage) ||
    summaries[0] ||
    null;

  const actionRows = db
    .prepare("SELECT * FROM action_items WHERE meeting_id = ? ORDER BY created_at ASC")
    .all(meeting.id) as Array<Record<string, unknown>>;

  const actionItems: ActionItemRecord[] = actionRows.map((a) => ({
    id: String(a.id),
    meetingId: String(a.meeting_id),
    summaryId: a.summary_id ? String(a.summary_id) : null,
    language: String(a.language || "en"),
    title: String(a.title),
    owner: a.owner ? String(a.owner) : null,
    dueDate: a.due_date ? String(a.due_date) : null,
    status: (a.status as ActionItemRecord["status"]) || "open",
    confidence: (a.confidence as ActionItemRecord["confidence"]) || "high",
    sourceQuote: a.source_quote ? String(a.source_quote) : null,
    isUserEdited: Boolean(a.is_user_edited),
    createdAt: String(a.created_at),
    updatedAt: String(a.updated_at),
  }));

  const decisionRows = db
    .prepare("SELECT * FROM decisions WHERE meeting_id = ? ORDER BY created_at ASC")
    .all(meeting.id) as Array<Record<string, unknown>>;

  const decisions: DecisionRecord[] = decisionRows.map((d) => ({
    id: String(d.id),
    meetingId: String(d.meeting_id),
    summaryId: d.summary_id ? String(d.summary_id) : null,
    language: String(d.language || "en"),
    decisionText: String(d.decision_text),
    context: d.context ? String(d.context) : null,
    madeBy: d.made_by ? String(d.made_by) : null,
    isUserEdited: Boolean(d.is_user_edited),
    createdAt: String(d.created_at),
  }));

  const jobRows = db
    .prepare("SELECT * FROM processing_jobs WHERE meeting_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(meeting.id) as Array<Record<string, unknown>>;

  const jobs: ProcessingJobRecord[] = jobRows.map((j) => ({
    id: String(j.id),
    meetingId: String(j.meeting_id),
    jobType: j.job_type as ProcessingJobRecord["jobType"],
    status: j.status as ProcessingJobRecord["status"],
    sourceLanguage: String(j.source_language),
    targetLanguage: String(j.target_language),
    insightsLanguage: String(j.insights_language),
    provider: String(j.provider),
    attemptCount: Number(j.attempt_count),
    idempotencyKey: String(j.idempotency_key),
    errorMessage: j.error_message ? String(j.error_message) : null,
    startedAt: j.started_at ? String(j.started_at) : null,
    completedAt: j.completed_at ? String(j.completed_at) : null,
    createdAt: String(j.created_at),
  }));

  return {
    meeting,
    audioAsset,
    transcript,
    summaries,
    activeSummary,
    actionItems,
    decisions,
    jobs,
  };
}

/**
 * Searches across titles, transcripts, localized summaries, decisions, and action items.
 * Strictly filters by user ownership or workspace membership so search never leaks data across accounts.
 * Handles Unicode, diacritics/accents (e.g., "reunion" matches "Réunion"), and non-Latin CJK/Arabic substrings.
 */
export function searchMeetingsForUser(params: {
  userId: string;
  query: string;
  scope?: string;
  language?: string;
}): SearchResultItem[] {
  const rawQuery = params.query.trim();
  if (!rawQuery) return [];

  const db = getDb();
  const authorizedMeetingRows = db
    .prepare(
      `SELECT m.id, m.title, m.recorded_at, m.detected_language
       FROM meetings m
       LEFT JOIN workspace_members wm ON wm.workspace_id = m.workspace_id AND wm.user_id = ?
       WHERE (m.owner_id = ? OR wm.user_id IS NOT NULL)`
    )
    .all(params.userId, params.userId) as Array<{
    id: string;
    title: string;
    recorded_at: string;
    detected_language: string;
  }>;

  if (authorizedMeetingRows.length === 0) return [];

  const meetingMap = new Map(authorizedMeetingRows.map((m) => [m.id, m]));
  const results: SearchResultItem[] = [];
  const seenDocIds = new Set<string>();

  // 1. Try FTS5 query with unicode61 remove_diacritics
  const sanitizedTokens = rawQuery
    .replace(/["'*^():-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (sanitizedTokens.length > 0) {
    const ftsMatchExpr = sanitizedTokens.map((t) => `"${t}"*`).join(" AND ");
    try {
      const ftsRows = db
        .prepare(
          `SELECT doc_id, meeting_id, match_source, match_language, timestamp_ms, speaker, content
           FROM search_fts
           WHERE search_fts MATCH ?
           LIMIT 100`
        )
        .all(ftsMatchExpr) as Array<{
        doc_id: string;
        meeting_id: string;
        match_source: SearchResultItem["matchSource"];
        match_language: string;
        timestamp_ms: number | null;
        speaker: string | null;
        content: string;
      }>;

      for (const row of ftsRows) {
        const mtg = meetingMap.get(row.meeting_id);
        if (!mtg) continue; // Enforce authorization boundary
        if (params.scope && params.scope !== "all" && row.match_source !== params.scope) continue;
        if (
          params.language &&
          params.language !== "all" &&
          row.match_language !== params.language &&
          mtg.detected_language !== params.language
        ) {
          continue;
        }

        seenDocIds.add(row.doc_id);
        results.push({
          meetingId: mtg.id,
          meetingTitle: mtg.title,
          recordedAt: mtg.recorded_at,
          detectedLanguage: mtg.detected_language,
          matchSource: row.match_source,
          matchLanguage: row.match_language,
          snippet: row.content.slice(0, 260),
          timestampMs: row.timestamp_ms !== null ? Number(row.timestamp_ms) : null,
          speaker: row.speaker,
        });
      }
    } catch {
      // Fallback to Unicode normalized scan below
    }
  }

  // 2. Unicode & CJK/Arabic/diacritic-insensitive scan across authorized rows to guarantee CJK substring recall
  const normalizedNeedle = stripDiacritics(rawQuery.toLowerCase());
  const allAuthorizedDocs = db
    .prepare(
      `SELECT doc_id, meeting_id, match_source, match_language, timestamp_ms, speaker, content
       FROM search_fts`
    )
    .all() as Array<{
    doc_id: string;
    meeting_id: string;
    match_source: SearchResultItem["matchSource"];
    match_language: string;
    timestamp_ms: number | null;
    speaker: string | null;
    content: string;
  }>;

  for (const row of allAuthorizedDocs) {
    if (seenDocIds.has(row.doc_id)) continue;
    const mtg = meetingMap.get(row.meeting_id);
    if (!mtg) continue; // Enforce authorization boundary
    if (params.scope && params.scope !== "all" && row.match_source !== params.scope) continue;
    if (
      params.language &&
      params.language !== "all" &&
      row.match_language !== params.language &&
      mtg.detected_language !== params.language
    ) {
      continue;
    }

    const normalizedHaystack = stripDiacritics(row.content.toLowerCase());
    if (normalizedHaystack.includes(normalizedNeedle)) {
      seenDocIds.add(row.doc_id);
      results.push({
        meetingId: mtg.id,
        meetingTitle: mtg.title,
        recordedAt: mtg.recorded_at,
        detectedLanguage: mtg.detected_language,
        matchSource: row.match_source,
        matchLanguage: row.match_language,
        snippet: row.content.slice(0, 260),
        timestampMs: row.timestamp_ms !== null ? Number(row.timestamp_ms) : null,
        speaker: row.speaker,
      });
    }
  }

  return results;
}

export async function seedSampleMultilingualMeetingsForUser(
  userId: string,
  workspaceId: string
): Promise<MeetingRecord[]> {
  const samples = [
    {
      title: "Kaapstad Produkbeplanning & Q4 Launch Sync",
      description:
        "Multilingual product planning session in Afrikaans and English (code-switching).",
      spokenLanguageConfig: "auto",
      preferredSummaryLanguage: "en",
      preferredInsightsLanguage: "en",
      rawTranscript: `[00:00] Anke van der Merwe: Welkom almal by vandag se vergadering oor die Q4 produkvrystelling in Kaapstad.
[00:14] David Botha: Thanks Anke. We have decided to launch the multilingual search index on 15 November.
[00:29] Anke van der Merwe: Uitstekend. Ons het besluit dat die Afrikaans en Engels koppelvlak voor Vrydag gereed moet wees.
[00:45] David Botha: Action item for Anke: finalize the Safari audio recorder permissions test by Friday.
[01:02] Anke van der Merwe: Is daar nog onduidelikheid oor die Apple Sign In private relay e-pos konfigurasie?`,
    },
    {
      title: "Réunion d'Architecture Équipe Montréal & Paris",
      description: "Revue de sécurité OAuth et stockage Unicode des transcriptions.",
      spokenLanguageConfig: "fr",
      preferredSummaryLanguage: "fr",
      preferredInsightsLanguage: "fr",
      rawTranscript: `[00:00] Claire Dubois: Bonjour à tous, commençons la réunion d'équipe sur la sécurité de l'authentification.
[00:18] Marc Tremblay: Nous avons décidé d'interdire la fusion automatique des comptes par adresse e-mail sans preuve de session.
[00:36] Claire Dubois: Action pour Marc: documenter les URL de rappel Google et Apple avant lundi.
[00:52] Marc Tremblay: Quelle est la politique de rétention pour les fichiers audio volumineux ?`,
    },
    {
      title: "東京・ロンドン製品開発定例ミーティング",
      description: "多言語AI要約パイプラインと文字起こし精度の検証。",
      spokenLanguageConfig: "ja",
      preferredSummaryLanguage: "en",
      preferredInsightsLanguage: "ja",
      rawTranscript: `[00:00] 佐藤 健太: 本日の製品リリース会議を始めます。多言語文字起こしエンジンの検証結果を共有します。
[00:20] 鈴木 美咲: 元の文字起こしデータを保持したまま、英語と日本語の両方で要約を生成することに決定しました。
[00:42] 佐藤 健太: 佐藤が11月20日までにデータベースのインデックス性能テストを実施して作成します。
[01:05] 鈴木 美咲: アラビア語の右から左へのレイアウト検証スケジュールは未定ですか？`,
    },
  ];

  const created: MeetingRecord[] = [];
  for (const s of samples) {
    const mtg = createMeeting({
      userId,
      workspaceId,
      title: s.title,
      description: s.description,
      spokenLanguageConfig: s.spokenLanguageConfig,
      preferredSummaryLanguage: s.preferredSummaryLanguage,
      preferredInsightsLanguage: s.preferredInsightsLanguage,
      transcriptionProvider: "transcript-import",
    });

    await processMeetingTranscriptionAndSummary({
      meetingId: mtg.id,
      userId,
      rawTranscriptText: s.rawTranscript,
    });

    created.push(requireAuthorizedMeetingAccess(mtg.id, userId));
  }

  return created;
}

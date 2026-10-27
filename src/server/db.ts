import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getEnv } from "./env";

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;

export function getDbPath(): string {
  return getEnv("SQLITE_DB_PATH", "./data/memoir.db");
}

export function getDb(): DatabaseSync {
  const targetPath = getDbPath();
  if (dbInstance && currentDbPath === targetPath) {
    return dbInstance;
  }

  if (targetPath !== ":memory:") {
    const dir = path.dirname(path.resolve(targetPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(targetPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA synchronous = NORMAL;");

  initializeSchema(db);
  dbInstance = db;
  currentDbPath = targetPath;
  return db;
}

export function resetDbForTesting(customPath = ":memory:"): DatabaseSync {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore close errors
    }
  }
  process.env.SQLITE_DB_PATH = customPath;
  dbInstance = null;
  currentDbPath = null;
  return getDb();
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      is_private_relay_email INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      ui_language TEXT NOT NULL DEFAULT 'en',
      default_spoken_language TEXT NOT NULL DEFAULT 'auto',
      default_summary_language TEXT NOT NULL DEFAULT 'en',
      default_insights_language TEXT NOT NULL DEFAULT 'en',
      preferred_transcription_provider TEXT NOT NULL DEFAULT 'auto',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      provider_email TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      is_private_relay INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_sign_in_at TEXT NOT NULL,
      UNIQUE(provider, provider_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(user_id);

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      nonce TEXT NOT NULL,
      intent TEXT NOT NULL DEFAULT 'signin',
      linking_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      redirect_to TEXT NOT NULL DEFAULT '/',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verification_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      token_type TEXT NOT NULL,
      metadata_json TEXT,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      spoken_language_config TEXT NOT NULL DEFAULT 'auto',
      detected_language TEXT NOT NULL DEFAULT 'und',
      detected_languages_json TEXT NOT NULL DEFAULT '[]',
      language_confidence REAL,
      language_overridden INTEGER NOT NULL DEFAULT 0,
      preferred_summary_language TEXT NOT NULL DEFAULT 'en',
      preferred_insights_language TEXT NOT NULL DEFAULT 'en',
      transcription_provider TEXT,
      duration_seconds INTEGER,
      recorded_at TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      share_token TEXT UNIQUE,
      is_shared INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_meetings_workspace ON meetings(workspace_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_meetings_owner ON meetings(owner_id, recorded_at DESC);

    CREATE TABLE IF NOT EXISTS audio_assets (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      duration_seconds INTEGER,
      storage_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
      source_language TEXT NOT NULL DEFAULT 'auto',
      detected_language TEXT NOT NULL DEFAULT 'und',
      detected_languages_json TEXT NOT NULL DEFAULT '[]',
      is_code_switching INTEGER NOT NULL DEFAULT 0,
      provider TEXT NOT NULL,
      full_text TEXT NOT NULL,
      is_user_edited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transcript_segments (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
      sequence_index INTEGER NOT NULL,
      start_time_ms INTEGER NOT NULL DEFAULT 0,
      end_time_ms INTEGER NOT NULL DEFAULT 0,
      speaker TEXT,
      text TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'und',
      is_user_edited INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_transcript_segments_meeting ON transcript_segments(meeting_id, sequence_index ASC);

    CREATE TABLE IF NOT EXISTS meeting_summaries (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      source_language TEXT NOT NULL,
      output_language TEXT NOT NULL,
      insights_language TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      executive_summary TEXT NOT NULL,
      key_discussion_points_json TEXT NOT NULL DEFAULT '[]',
      unresolved_questions_json TEXT NOT NULL DEFAULT '[]',
      is_user_edited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(meeting_id, output_language)
    );

    CREATE INDEX IF NOT EXISTS idx_meeting_summaries_meeting ON meeting_summaries(meeting_id);

    CREATE TABLE IF NOT EXISTS action_items (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      summary_id TEXT REFERENCES meeting_summaries(id) ON DELETE SET NULL,
      language TEXT NOT NULL DEFAULT 'en',
      title TEXT NOT NULL,
      owner TEXT,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      confidence TEXT NOT NULL DEFAULT 'high',
      source_quote TEXT,
      is_user_edited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_action_items_meeting ON action_items(meeting_id);

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      summary_id TEXT REFERENCES meeting_summaries(id) ON DELETE SET NULL,
      language TEXT NOT NULL DEFAULT 'en',
      decision_text TEXT NOT NULL,
      context TEXT,
      made_by TEXT,
      is_user_edited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_decisions_meeting ON decisions(meeting_id);

    CREATE TABLE IF NOT EXISTS processing_jobs (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      source_language TEXT NOT NULL,
      target_language TEXT NOT NULL,
      insights_language TEXT NOT NULL,
      provider TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 1,
      idempotency_key TEXT NOT NULL UNIQUE,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_processing_jobs_meeting ON processing_jobs(meeting_id, created_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      doc_id UNINDEXED,
      meeting_id UNINDEXED,
      workspace_id UNINDEXED,
      owner_id UNINDEXED,
      match_source UNINDEXED,
      match_language UNINDEXED,
      timestamp_ms UNINDEXED,
      speaker UNINDEXED,
      content,
      tokenize="unicode61 remove_diacritics 2"
    );
  `);
}

export function generateId(prefix = "id"): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function rebuildMeetingSearchIndex(db: DatabaseSync, meetingId: string): void {
  db.prepare("DELETE FROM search_fts WHERE meeting_id = ?").run(meetingId);

  const meeting = db
    .prepare(
      "SELECT id, workspace_id, owner_id, title, description, detected_language FROM meetings WHERE id = ?"
    )
    .get(meetingId) as
    | {
        id: string;
        workspace_id: string;
        owner_id: string;
        title: string;
        description: string | null;
        detected_language: string;
      }
    | undefined;

  if (!meeting) return;

  const insertFts = db.prepare(`
    INSERT INTO search_fts (
      doc_id, meeting_id, workspace_id, owner_id, match_source, match_language, timestamp_ms, speaker, content
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Index title + description
  const titleContent = [meeting.title, meeting.description].filter(Boolean).join(" - ");
  insertFts.run(
    `title_${meeting.id}`,
    meeting.id,
    meeting.workspace_id,
    meeting.owner_id,
    "title",
    meeting.detected_language,
    null,
    null,
    titleContent
  );

  // Index transcript segments
  const segments = db
    .prepare(
      "SELECT id, start_time_ms, speaker, text, language FROM transcript_segments WHERE meeting_id = ? ORDER BY sequence_index ASC"
    )
    .all(meetingId) as Array<{
    id: string;
    start_time_ms: number;
    speaker: string | null;
    text: string;
    language: string;
  }>;

  for (const seg of segments) {
    insertFts.run(
      `seg_${seg.id}`,
      meeting.id,
      meeting.workspace_id,
      meeting.owner_id,
      "transcript",
      seg.language,
      seg.start_time_ms,
      seg.speaker,
      seg.text
    );
  }

  // Index all localized summaries
  const summaries = db
    .prepare(
      "SELECT id, output_language, executive_summary, key_discussion_points_json, unresolved_questions_json FROM meeting_summaries WHERE meeting_id = ?"
    )
    .all(meetingId) as Array<{
    id: string;
    output_language: string;
    executive_summary: string;
    key_discussion_points_json: string;
    unresolved_questions_json: string;
  }>;

  for (const sum of summaries) {
    const points = JSON.parse(sum.key_discussion_points_json || "[]") as string[];
    const questions = JSON.parse(sum.unresolved_questions_json || "[]") as string[];
    const combinedSummary = [sum.executive_summary, ...points, ...questions].join("\n");
    insertFts.run(
      `sum_${sum.id}`,
      meeting.id,
      meeting.workspace_id,
      meeting.owner_id,
      "summary",
      sum.output_language,
      null,
      null,
      combinedSummary
    );
  }

  // Index decisions
  const decisions = db
    .prepare("SELECT id, language, decision_text, context FROM decisions WHERE meeting_id = ?")
    .all(meetingId) as Array<{
    id: string;
    language: string;
    decision_text: string;
    context: string | null;
  }>;

  for (const dec of decisions) {
    insertFts.run(
      `dec_${dec.id}`,
      meeting.id,
      meeting.workspace_id,
      meeting.owner_id,
      "decision",
      dec.language,
      null,
      null,
      [dec.decision_text, dec.context].filter(Boolean).join(" ")
    );
  }

  // Index action items
  const actions = db
    .prepare("SELECT id, language, title, owner FROM action_items WHERE meeting_id = ?")
    .all(meetingId) as Array<{
    id: string;
    language: string;
    title: string;
    owner: string | null;
  }>;

  for (const act of actions) {
    insertFts.run(
      `act_${act.id}`,
      meeting.id,
      meeting.workspace_id,
      meeting.owner_id,
      "action_item",
      act.language,
      null,
      act.owner,
      [act.title, act.owner].filter(Boolean).join(" ")
    );
  }
}

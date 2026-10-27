import fs from "node:fs";
import path from "node:path";
import { getEnv } from "./env";

export const MAX_AUDIO_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/aac",
  "audio/webm",
  "audio/ogg",
]);

export function normalizeAudioMimeType(rawMime: string): string {
  const base = rawMime.split(";")[0].trim().toLowerCase();
  return base;
}

export function validateAudioUpload(params: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): { valid: boolean; error?: string; normalizedMime: string } {
  const normalizedMime = normalizeAudioMimeType(params.mimeType);

  if (params.sizeBytes <= 0) {
    return { valid: false, error: "Audio file is empty.", normalizedMime };
  }

  if (params.sizeBytes > MAX_AUDIO_SIZE_BYTES) {
    return {
      valid: false,
      error: `Audio file exceeds maximum size of 25 MB (${Math.round(params.sizeBytes / (1024 * 1024))} MB uploaded).`,
      normalizedMime,
    };
  }

  if (!ALLOWED_AUDIO_MIME_TYPES.has(normalizedMime)) {
    return {
      valid: false,
      error: `Unsupported audio format '${normalizedMime}'. Allowed formats: WAV, MP3, M4A, WebM, OGG.`,
      normalizedMime,
    };
  }

  return { valid: true, normalizedMime };
}

function getStorageDirectory(): string {
  const dir = getEnv("AUDIO_STORAGE_DIR", "./data/uploads");
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

export async function saveAudioBytes(storageKey: string, bytes: Uint8Array): Promise<void> {
  const safeKey = path.basename(storageKey);
  const fullPath = path.join(getStorageDirectory(), safeKey);
  await fs.promises.writeFile(fullPath, bytes);
}

export async function readAudioBytes(storageKey: string): Promise<Buffer | null> {
  const safeKey = path.basename(storageKey);
  const fullPath = path.join(getStorageDirectory(), safeKey);
  if (!fs.existsSync(fullPath)) return null;
  return fs.promises.readFile(fullPath);
}

export async function deleteAudioBytes(storageKey: string): Promise<void> {
  const safeKey = path.basename(storageKey);
  const fullPath = path.join(getStorageDirectory(), safeKey);
  if (fs.existsSync(fullPath)) {
    await fs.promises.unlink(fullPath);
  }
}

import { getLanguageDefinition, normalizeBcp47Tag } from "../shared/languages";

export function resolveLocaleTag(locale?: string | null): string {
  const def = getLanguageDefinition(locale);
  if (def) return def.bcp47;
  const normalized = normalizeBcp47Tag(locale);
  if (normalized && normalized !== "und" && normalized !== "auto") {
    return normalized;
  }
  return "en-US";
}

export function formatLocaleDate(
  isoDate: string | Date,
  locale?: string | null,
  options?: Intl.DateTimeFormatOptions
): string {
  try {
    const date = typeof isoDate === "string" ? new Date(isoDate) : isoDate;
    if (Number.isNaN(date.getTime())) return String(isoDate);
    const bcp47 = resolveLocaleTag(locale);
    return new Intl.DateTimeFormat(
      bcp47,
      options ?? {
        year: "numeric",
        month: "short",
        day: "numeric",
      }
    ).format(date);
  } catch {
    return String(isoDate);
  }
}

export function formatLocaleDateTime(isoDate: string | Date, locale?: string | null): string {
  return formatLocaleDate(isoDate, locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatLocaleNumber(value: number, locale?: string | null): string {
  try {
    const bcp47 = resolveLocaleTag(locale);
    return new Intl.NumberFormat(bcp47).format(value);
  } catch {
    return String(value);
  }
}

export function formatDurationSeconds(seconds: number | null | undefined, locale?: string | null): string {
  if (seconds === null || seconds === undefined || seconds < 0) {
    return "0:00";
  }
  const totalSec = Math.round(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const paddedSecs = String(secs).padStart(2, "0");
  if (hrs > 0) {
    const paddedMins = String(mins).padStart(2, "0");
    return `${formatLocaleNumber(hrs, locale)}:${paddedMins}:${paddedSecs}`;
  }
  return `${formatLocaleNumber(mins, locale)}:${paddedSecs}`;
}

export function formatTimestampMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return "00:00";
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

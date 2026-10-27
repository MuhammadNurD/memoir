import React from "react";
import { getLanguageDefinition } from "../shared/languages";
import { useTranslation } from "react-i18next";

export function LanguageBadge({
  tag,
  prefix,
  className = "",
}: {
  tag: string | null | undefined;
  prefix?: string;
  className?: string;
}) {
  const { t } = useTranslation();

  if (!tag || tag === "und") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border border-[#101626]/10 bg-[#101626]/[0.04] px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400 ${className}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
        {prefix ? <span className="opacity-65">{prefix}:</span> : null}
        <span>{t("app.languageUndetermined")}</span>
      </span>
    );
  }

  if (tag === "auto") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border border-[#5B5BF0]/25 bg-[#5B5BF0]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#5B5BF0] dark:border-[#22D3EE]/30 dark:bg-[#22D3EE]/10 dark:text-[#22D3EE] ${className}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[#22D3EE]" />
        {prefix ? <span className="opacity-75">{prefix}:</span> : null}
        <span>{t("app.autoDetect")}</span>
      </span>
    );
  }

  const def = getLanguageDefinition(tag);
  const label = def ? `${def.nativeName} · ${def.tag.toUpperCase()}` : tag.toUpperCase();

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-[#101626]/12 bg-white/80 px-2.5 py-0.5 text-[11px] font-medium text-[#101626] shadow-2xs dark:border-white/15 dark:bg-white/10 dark:text-zinc-200 ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[#5B5BF0]" />
      {prefix ? <span className="text-zinc-500 dark:text-zinc-400">{prefix}:</span> : null}
      <span>{label}</span>
    </span>
  );
}

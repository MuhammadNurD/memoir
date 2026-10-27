import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import af from "./locales/af.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import ar from "./locales/ar.json";
import { getBestUiLocale, getLanguageDefinition, UI_LOCALES } from "../shared/languages";

export const LOCAL_STORAGE_UI_LANGUAGE_KEY = "memoir_ui_language";

const resources = {
  en: { translation: en },
  af: { translation: af },
  es: { translation: es },
  fr: { translation: fr },
  ja: { translation: ja },
  ar: { translation: ar },
};

export function syncDocumentLocaleAttributes(langTag: string): void {
  if (typeof document === "undefined") return;
  const resolved = getBestUiLocale(langTag);
  const def = getLanguageDefinition(resolved);
  document.documentElement.lang = def?.bcp47 ?? resolved;
  document.documentElement.dir = def?.dir ?? "ltr";
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: UI_LOCALES.map((l) => l.tag),
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: LOCAL_STORAGE_UI_LANGUAGE_KEY,
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

i18n.on("languageChanged", (lng) => {
  syncDocumentLocaleAttributes(lng);
});

syncDocumentLocaleAttributes(i18n.language || "en");

export async function changeInterfaceLanguage(langTag: string): Promise<string> {
  const resolved = getBestUiLocale(langTag);
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.setItem(LOCAL_STORAGE_UI_LANGUAGE_KEY, resolved);
  }
  await i18n.changeLanguage(resolved);
  syncDocumentLocaleAttributes(resolved);
  return resolved;
}

export default i18n;

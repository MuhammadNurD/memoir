export interface BrandConfig {
  name: string;
  wordmark: string;
  slogan: string;
  taglineKey: string;
  poweredBy: string;
  copyrightYear: number;
  supportEmail: string;
  defaultLocale: string;
  palette: {
    midnightNavy: string;
    violet: string;
    softCyan: string;
  };
}

function resolveBrandName(): string {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_BRAND_NAME) {
    return String(import.meta.env.VITE_BRAND_NAME);
  }
  if (typeof process !== "undefined" && process.env?.VITE_BRAND_NAME) {
    return String(process.env.VITE_BRAND_NAME);
  }
  return "Memoir";
}

export const BRAND: BrandConfig = {
  name: resolveBrandName(),
  wordmark: "memoir",
  slogan: "Every conversation, remembered.",
  taglineKey: "app.tagline",
  poweredBy: "PHNX Codeworks",
  copyrightYear: new Date().getFullYear(),
  supportEmail: "support@memoir.workspace",
  defaultLocale: "en",
  palette: {
    midnightNavy: "#101626",
    violet: "#5B5BF0",
    softCyan: "#22D3EE",
  },
};

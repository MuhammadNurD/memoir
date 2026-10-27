declare global {
  var Netlify:
    | {
        env?: {
          get(key: string): string | undefined;
        };
      }
    | undefined;
}

export function getEnv(key: string, defaultValue = ""): string {
  if (typeof globalThis.Netlify !== "undefined" && globalThis.Netlify?.env?.get) {
    const val = globalThis.Netlify.env.get(key);
    if (val !== undefined && val !== "") {
      return val;
    }
  }
  if (typeof process !== "undefined" && process.env) {
    const val = process.env[key];
    if (val !== undefined && val !== "") {
      return val;
    }
  }
  return defaultValue;
}

export function getAppBaseUrl(reqUrl?: string): string {
  const configured = getEnv("APP_BASE_URL") || getEnv("URL");
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  if (reqUrl) {
    try {
      const parsed = new URL(reqUrl);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // ignore invalid URL
    }
  }
  return "http://localhost:5173";
}

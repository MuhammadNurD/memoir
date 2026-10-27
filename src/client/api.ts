export class ApiClientError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (
    options?.body &&
    typeof options.body === "string" &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await res.json();
    if (!res.ok) {
      const errObj = data?.error || {};
      throw new ApiClientError(
        errObj.code || "API_ERROR",
        errObj.message || `Request failed with HTTP ${res.status}`,
        res.status
      );
    }
    return data as T;
  }

  if (!res.ok) {
    throw new ApiClientError(
      "HTTP_ERROR",
      `Request failed with status ${res.status}`,
      res.status
    );
  }

  return (await res.text()) as unknown as T;
}

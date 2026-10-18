import { resolveDestination } from "./navigation";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/bridge/${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      cache: "no-store",
      signal: options.signal ?? AbortSignal.timeout(25000),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      0,
      "Connection interrupted. Your request may have completed; retry to reconcile it safely.",
      "UNKNOWN_OUTCOME",
    );
  }
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.error || "The request failed. Try again.",
      data.code,
    );
  return data as T;
}
export function mutation<T>(path: string, body: unknown, key: string) {
  return api<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": key },
  });
}
export function signInDestination() {
  const next = new URLSearchParams(location.search).get("next");
  return resolveDestination(next);
}

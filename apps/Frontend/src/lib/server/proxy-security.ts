import { isIP } from "node:net";
import { proxySignature } from "@orbitledger/shared/security";
export class RequestRejected extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function signedClientHeaders(request: Request): Record<string, string> {
  const secret = process.env.API_PROXY_SECRET;
  if (!secret) return {};
  // Vercel overwrites these headers at its edge; never trust them on a generic host.
  const ip =
    process.env.VERCEL === "1"
      ? (
          request.headers.get("x-vercel-forwarded-for") ||
          request.headers.get("x-forwarded-for") ||
          ""
        )
          .split(",")[0]!
          .trim()
      : process.env.NODE_ENV !== "production"
        ? "127.0.0.1"
        : "";
  if (!isIP(ip)) return {};
  const timestamp = String(Date.now());
  return {
    "X-Orbit-Client-IP": ip,
    "X-Orbit-Client-Time": timestamp,
    "X-Orbit-Client-Signature": proxySignature(ip, timestamp, secret),
  };
}
export async function limitedJson(
  request: Request,
  limit = 65536,
): Promise<Record<string, unknown>> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .includes("application/json")
  )
    throw new RequestRejected(415, "Use a JSON request body.");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit)
    throw new RequestRejected(413, "Request body is too large.");
  const reader = request.body?.getReader();
  if (!reader) return {};
  let size = 0,
    timedOut = false;
  const chunks: Uint8Array[] = [];
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, 5000);
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new RequestRejected(413, "Request body is too large.");
      }
      chunks.push(next.value);
    }
    if (timedOut) throw new RequestRejected(408, "Request body timed out.");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new RequestRejected(400, "Invalid JSON request.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new RequestRejected(400, "Use a JSON object.");
    return data as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

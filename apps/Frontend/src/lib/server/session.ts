import "server-only";
import { cookies } from "next/headers";
export async function hasSession() {
  const token = (await cookies()).get("orbit-session")?.value;
  if (!token) return false;
  try {
    const base =
      process.env.API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:5000/api/v2";
    const normalized = new URL(base);
    normalized.pathname = normalized.pathname.replace(/\/+$/, "") || "/api/v2";
    const response = await fetch(`${normalized.href}/user/profile`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

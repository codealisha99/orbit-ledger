import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const api =
  process.env.API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:5000/api/v2";
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.get("origin") !== request.nextUrl.origin
  )
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  if (path.join("/") === "session/logout") {
    const response = NextResponse.json({ ok: true });
    response.cookies.delete("orbit-session");
    return response;
  }
  const target = new URL(`${api}/${path.map(encodeURIComponent).join("/")}`);
  target.search = request.nextUrl.search;
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = request.cookies.get("orbit-session")?.value;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const key = request.headers.get("Idempotency-Key");
  if (key) headers.set("Idempotency-Key", key);
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const payload = await upstream.json();
    const authToken = payload.token;
    delete payload.token;
    const response = NextResponse.json(payload, { status: upstream.status });
    if (
      authToken &&
      upstream.ok &&
      ["user/signin", "user/signup", "auth/exchange"].includes(path.join("/"))
    )
      response.cookies.set("orbit-session", authToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 86400,
      });
    response.headers.set("Cache-Control", "private, no-store");
    if (upstream.status === 401 || upstream.status === 403)
      response.cookies.delete("orbit-session");
    const retry = upstream.headers.get("Retry-After");
    if (retry) response.headers.set("Retry-After", retry);
    return response;
  } catch {
    return NextResponse.json(
      {
        error:
          "The service could not be reached. Check your connection and try again.",
        code: "SERVICE_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH };

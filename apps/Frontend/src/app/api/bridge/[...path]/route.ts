import { NextRequest, NextResponse } from "next/server";
import { ApiUpstream, ServiceUnavailable } from "@/lib/server/upstream";
import {
  limitedJson,
  RequestRejected,
  signedClientHeaders,
} from "@/lib/server/proxy-security";
export const dynamic = "force-dynamic";
const api = new ApiUpstream(
  process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:5000/api/v2",
);
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const route = path.join("/");
  if (path.some((p) => p === "." || p === ".." || /[\\/\u0000-\u001f]/.test(p)))
    return NextResponse.json({ error: "Invalid route" }, { status: 400 });
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.get("origin") !== request.nextUrl.origin
  )
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  const logout = route === "session/logout" || route === "session/logout-all";
  if (logout && request.method !== "POST")
    return NextResponse.json(
      { error: "Use POST to sign out" },
      { status: 405, headers: { Allow: "POST" } },
    );
  const token = request.cookies.get("orbit-session")?.value;
  if (logout && !token) {
    const response = NextResponse.json({ ok: true });
    response.cookies.delete("orbit-session");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const target = api.target(
    logout
      ? ["user", route === "session/logout-all" ? "logout-all" : "logout"]
      : path,
    request.nextUrl.search,
  );
  const headers = new Headers({
    "Content-Type": "application/json",
    ...signedClientHeaders(request),
  });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const key = request.headers.get("Idempotency-Key");
  if (key) headers.set("Idempotency-Key", key);
  try {
    let body: Record<string, unknown> | undefined;
    if (!["GET", "HEAD"].includes(request.method))
      body = await limitedJson(request);
    if (route === "auth/exchange")
      body = {
        code: body?.code,
        verifier: request.cookies.get("orbit-oauth-verifier")?.value ?? "",
      };
    await api.assertCompatible();
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (logout && (upstream.ok || [401, 403].includes(upstream.status))) {
      const response = NextResponse.json({ ok: true });
      response.cookies.delete("orbit-session");
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    const payload = await upstream.json();
    if (
      upstream.status === 404 &&
      payload.error === "Route Not Found !! Undefined Route"
    )
      throw new ServiceUnavailable(
        "The trading service is being updated. Please try again shortly.",
      );
    const authToken = payload.token;
    delete payload.token;
    const response = NextResponse.json(payload, { status: upstream.status });
    if (
      authToken &&
      upstream.ok &&
      ["user/signin", "user/signup", "auth/exchange"].includes(route)
    ) {
      response.cookies.set("orbit-session", authToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 86400,
      });
      if (route === "auth/exchange")
        response.cookies.delete("orbit-oauth-verifier");
    }
    response.headers.set("Cache-Control", "private, no-store");
    if ([401, 403].includes(upstream.status))
      response.cookies.delete("orbit-session");
    const retry = upstream.headers.get("Retry-After");
    if (retry) response.headers.set("Retry-After", retry);
    return response;
  } catch (error) {
    const status = error instanceof RequestRejected ? error.status : 503;
    return NextResponse.json(
      {
        error:
          error instanceof RequestRejected ||
          error instanceof ServiceUnavailable
            ? error.message
            : "The service could not be reached. Please try again.",
        code: status === 503 ? "SERVICE_UNAVAILABLE" : "INVALID_REQUEST",
      },
      {
        status,
        headers: {
          "Cache-Control": "private, no-store",
          ...(status === 503 ? { "Retry-After": "15" } : {}),
        },
      },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH };

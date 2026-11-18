import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (!["google", "github"].includes(provider))
    return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  const verifier = randomBytes(32).toString("hex");
  const base =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v2";
  const url = new URL(`${base.replace(/\/+$/, "")}/auth/${provider}`);
  url.searchParams.set(
    "challenge",
    createHash("sha256").update(verifier).digest("hex"),
  );
  const isLink = _request.nextUrl.searchParams.get("link") === "1";
  const sessionToken = _request.cookies.get("papership-session")?.value;
  if (isLink && sessionToken) {
    url.searchParams.set("link_token", sessionToken);
  }
  const response = NextResponse.redirect(url);
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  response.cookies.set("papership-oauth-verifier", verifier, cookieOpts);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

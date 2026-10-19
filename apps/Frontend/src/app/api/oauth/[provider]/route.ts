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
  const response = NextResponse.redirect(url);
  response.cookies.set("orbit-oauth-verifier", verifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

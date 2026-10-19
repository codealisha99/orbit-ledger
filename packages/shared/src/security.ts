// Server-only helpers: import through the explicit /security subpath.
import jwt from "jsonwebtoken";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
export const TOKEN_ISSUER = "orbitledger";
export const SESSION_AUDIENCE = "orbitledger:api";
export const WS_AUDIENCE = "orbitledger:ws";
export const SESSION_TTL_SECONDS = 86400;
export interface SessionClaims {
  userId: string;
  jti: string;
  purpose: "session";
  exp: number;
  iat: number;
}
export interface TicketClaims {
  userId: string;
  sessionId: string;
  purpose: "websocket";
  exp: number;
  iat: number;
}
export function securitySecret() {
  const secret = process.env.JWT_SECRET;
  if (
    !secret ||
    (process.env.NODE_ENV === "production" && Buffer.byteLength(secret) < 32)
  )
    throw new Error(
      "A strong JWT_SECRET (at least 32 bytes in production) is required",
    );
  return secret;
}
function verify(token: string, purpose: "session" | "websocket"): any | null {
  try {
    const value = jwt.verify(token, securitySecret(), {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: purpose === "session" ? SESSION_AUDIENCE : WS_AUDIENCE,
      maxAge: purpose === "session" ? "24h" : "60s",
    });
    if (
      typeof value !== "object" ||
      value.purpose !== purpose ||
      typeof value.userId !== "string" ||
      !value.userId ||
      value.userId.length > 200 ||
      !Number.isSafeInteger(value.exp) ||
      !Number.isSafeInteger(value.iat)
    )
      return null;
    const id = purpose === "session" ? value.jti : value.sessionId;
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return value;
  } catch {
    return null;
  }
}
export const verifySessionToken = (token: string): SessionClaims | null =>
  verify(token, "session");
export const verifySocketToken = (token: string): TicketClaims | null =>
  verify(token, "websocket");
export function proxySignature(ip: string, timestamp: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`v1\n${timestamp}\n${ip}`)
    .digest("hex");
}
export function verifiedProxyIp(
  headers: { ip?: string; timestamp?: string; signature?: string },
  secret = process.env.API_PROXY_SECRET,
  now = Date.now(),
) {
  const { ip, timestamp, signature } = headers;
  if (
    !secret ||
    !ip ||
    !isIP(ip) ||
    !timestamp ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 30000 ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return null;
  const expected = proxySignature(ip, timestamp, secret);
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex"),
  )
    ? ip
    : null;
}

import { test, expect } from "bun:test";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import {
  verifySessionToken,
  verifySocketToken,
  proxySignature,
  verifiedProxyIp,
  TOKEN_ISSUER,
  SESSION_AUDIENCE,
  WS_AUDIENCE,
} from "../src/security";
process.env.JWT_SECRET = "local-security-test-secret-that-is-long";
const sign = (
  payload: object,
  audience = SESSION_AUDIENCE,
  algorithm: "HS256" | "HS384" = "HS256",
) =>
  jwt.sign(payload, process.env.JWT_SECRET!, {
    algorithm,
    issuer: TOKEN_ISSUER,
    audience,
    expiresIn: 60,
    jwtid: randomUUID(),
  });
test("session and socket credentials are purpose and algorithm restricted", () => {
  const session = sign({ userId: "test-user", purpose: "session" });
  expect(verifySessionToken(session)?.userId).toBe("test-user");
  expect(verifySocketToken(session)).toBeNull();
  expect(
    verifySessionToken(
      sign(
        { userId: "test-user", purpose: "session" },
        SESSION_AUDIENCE,
        "HS384",
      ),
    ),
  ).toBeNull();
  expect(
    verifySessionToken(sign({ userId: 12, purpose: "session" })),
  ).toBeNull();
  expect(
    verifySessionToken(
      sign({ userId: "test-user", purpose: "websocket" }, WS_AUDIENCE),
    ),
  ).toBeNull();
  expect(
    verifySessionToken(
      jwt.sign({ userId: "test-user" }, process.env.JWT_SECRET!),
    ),
  ).toBeNull();
});
test("proxy IP assertions require a fresh signature for the exact address", () => {
  const ip = "203.0.113.14",
    timestamp = String(Date.now()),
    secret = "test-proxy-secret";
  const signature = proxySignature(ip, timestamp, secret);
  expect(verifiedProxyIp({ ip, timestamp, signature }, secret)).toBe(ip);
  expect(
    verifiedProxyIp({ ip: "203.0.113.15", timestamp, signature }, secret),
  ).toBeNull();
  expect(
    verifiedProxyIp(
      { ip, timestamp, signature },
      secret,
      Number(timestamp) + 31000,
    ),
  ).toBeNull();
  expect(
    verifiedProxyIp({ ip, timestamp, signature: "0".repeat(64) }, secret),
  ).toBeNull();
});

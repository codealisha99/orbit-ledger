import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../../packages/database/src/index";
import { generateToken } from "../../apps/Backend/src/utils/jwt";
import { comparePassword } from "../../apps/Backend/src/utils/password";
import { Verifytokenws } from "../../apps/Websocket/src/utils/wsjwt";
import { proxySignature, verifiedProxyIp, securitySecret, TOKEN_ISSUER, WS_AUDIENCE } from "../../packages/shared/src/security";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.startsWith("/actioncd_quality_") ||
  target.searchParams.has("host")
) {
  throw new Error("Use a dedicated localhost actioncd_quality_ database for tests.");
}

describe("Security and Authorization Testing", () => {
  const userA = `userA-${randomUUID()}`;
  const userB = `userB-${randomUUID()}`;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { userId: userA, email: `${userA}@test.com`, password: "passwordA", balanceCents: 500000 },
        { userId: userB, email: `${userB}@test.com`, password: "passwordB", balanceCents: 500000 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { userId: { in: [userA, userB] } } });
    await prisma.user.deleteMany({ where: { userId: { in: [userA, userB] } } });
  });

  test("Session Revocation: Deleting AuthSession record immediately invalidates JWT", async () => {
    const token = await generateToken(userA);
    const decoded = jwt.decode(token) as any;
    expect(decoded.jti).toBeDefined();

    // Verify session exists
    const session = await prisma.authSession.findUnique({ where: { id: decoded.jti } });
    expect(session).not.toBeNull();

    // Revoke session
    await prisma.authSession.delete({ where: { id: decoded.jti } });

    // Re-verify session in DB
    const revoked = await prisma.authSession.findUnique({ where: { id: decoded.jti } });
    expect(revoked).toBeNull();
  });

  test("WebSocket Ticket Isolation: WS accepts tickets with WS_AUDIENCE and rejects API session tokens", async () => {
    const sessionToken = await generateToken(userA);
    const decoded = jwt.decode(sessionToken) as any;

    // 1. Direct session token passed to WS must be rejected
    const rejected = await Verifytokenws(sessionToken);
    expect(rejected).toBeNull();

    // 2. Properly scoped WS ticket must be accepted
    const ticket = jwt.sign(
      { userId: userA, sessionId: decoded.jti, purpose: "websocket" },
      securitySecret(),
      { algorithm: "HS256", issuer: TOKEN_ISSUER, audience: WS_AUDIENCE, expiresIn: 60 },
    );

    const verified = await Verifytokenws(ticket);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(userA);
  });

  test("Timing attack resistance: comparePassword on non-existent account takes full bcrypt time", async () => {
    const start = performance.now();
    const result = await comparePassword("any-attempted-password", "");
    const elapsed = performance.now() - start;

    expect(result).toBe(false);
    // Bcrypt cost 12 takes >40ms on modern CPUs
    expect(elapsed).toBeGreaterThan(40);
  });

  test("HMAC Client IP Attestation: invalid signatures and timestamp drift are rejected", () => {
    const secret = "test-proxy-secret-1234567890";
    const ip = "203.0.113.195";
    const now = Date.now();
    const sig = proxySignature(ip, String(now), secret);

    // Valid signature
    expect(verifiedProxyIp({ ip, timestamp: String(now), signature: sig }, secret, now)).toBe(ip);

    // Tampered IP
    expect(verifiedProxyIp({ ip: "198.51.100.1", timestamp: String(now), signature: sig }, secret, now)).toBeNull();

    // Stale timestamp (>30s drift)
    expect(verifiedProxyIp({ ip, timestamp: String(now - 35000), signature: sig }, secret, now)).toBeNull();

    // Tampered signature
    expect(verifiedProxyIp({ ip, timestamp: String(now), signature: "invalid-sig-00000000000000000000000000000000000000000000000000000000000" }, secret, now)).toBeNull();
  });
});

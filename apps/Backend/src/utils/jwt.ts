import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "@orbitledger/database";
import {
  securitySecret,
  verifySessionToken,
  TOKEN_ISSUER,
  SESSION_AUDIENCE,
  SESSION_TTL_SECONDS,
} from "@orbitledger/shared/security";
export async function generateToken(userId: string): Promise<string> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    await tx.authSession.deleteMany({
      where: { userId, expiresAt: { lte: new Date() } },
    });
    const old = await tx.authSession.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: 19,
      select: { id: true },
    });
    if (old.length)
      await tx.authSession.deleteMany({
        where: { id: { in: old.map((s) => s.id) } },
      });
    await tx.authSession.create({ data: { id, userId, expiresAt } });
  });
  return jwt.sign({ userId, purpose: "session" }, securitySecret(), {
    algorithm: "HS256",
    issuer: TOKEN_ISSUER,
    audience: SESSION_AUDIENCE,
    jwtid: id,
    expiresIn: SESSION_TTL_SECONDS,
  });
}
export const verifyToken = verifySessionToken;

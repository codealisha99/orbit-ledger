import { verifySocketToken } from "@papership/shared/security";
import { prisma } from "@papership/database";

export async function Verifytokenws(token: string) {
  const claims = typeof token === "string" ? verifySocketToken(token) : null;
  if (!claims) return null;
  const session = await prisma.authSession.findFirst({
    where: {
      id: claims.sessionId,
      userId: claims.userId,
      expiresAt: { gt: new Date() },
    },
  });
  return session
    ? {
        ...claims,
        authenticatedUntil: Math.min(
          claims.exp * 1000,
          session.expiresAt.getTime(),
        ),
      }
    : null;
}

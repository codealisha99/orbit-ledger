import type { Request, Response, NextFunction } from "express";
import { prisma } from "@orbitledger/database";
import { verifyToken } from "../utils/jwt";
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      sessionId?: string;
      sessionExpiresAt?: Date;
    }
  }
}
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const match = /^Bearer ([A-Za-z0-9._-]+)$/i.exec(
    req.headers.authorization ?? "",
  );
  if (!match) {
    res
      .status(401)
      .json({
        error: "Sign in to access your account.",
        code: "AUTH_REQUIRED",
      });
    return;
  }
  const claims = verifyToken(match[1]!);
  if (!claims) {
    res
      .status(403)
      .json({
        error: "Your session has expired. Sign in again.",
        code: "SESSION_EXPIRED",
      });
    return;
  }
  try {
    const session = await prisma.authSession.findFirst({
      where: {
        id: claims.jti,
        userId: claims.userId,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, expiresAt: true },
    });
    if (!session) {
      res
        .status(403)
        .json({
          error: "Your session has expired. Sign in again.",
          code: "SESSION_EXPIRED",
        });
      return;
    }
    req.userId = claims.userId;
    req.sessionId = session.id;
    req.sessionExpiresAt = session.expiresAt;
    next();
  } catch (error) {
    next(error);
  }
}

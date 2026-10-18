import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  const token = header?.split(" ")[1];
  if (!token) {
    res
      .status(401)
      .json({
        error: "Sign in to access your account.",
        code: "AUTH_REQUIRED",
      });
    return;
  }
  const newToken = verifyToken(token);
  if (!newToken || newToken.purpose === "websocket") {
    res
      .status(403)
      .json({
        error: "Your session has expired. Sign in again.",
        code: "SESSION_EXPIRED",
      });
    return;
  }
  const userId = newToken.userId;
  req.userId = newToken.userId;
  next();
}

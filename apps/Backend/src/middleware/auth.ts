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
    console.log("[AUTH] no token Is thier in Header");
    res.status(401).json({ error: "Acess Token Requires" });
    return;
  }
  const newToken = verifyToken(token);
  if (!newToken || newToken.purpose === "websocket") {
    console.log("[AUTH]  Invalid or Token Expired");
    res.status(403).json({ error: "Invalid or Expire token " });
    return;
  }
  const userId = newToken.userId;
  req.userId = newToken.userId;
  next();
}

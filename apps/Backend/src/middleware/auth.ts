import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";
import { findUSerId } from "../data/store";

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
  if (!newToken) {
    console.log("[AUTH]  Invalid or Token Expired");
    res.status(403).json({ error: "Invalid or Expire token " });
    return;
  }
  const userId = newToken.userId;
  const UserExisted = findUSerId(userId);
  if (!UserExisted) {
    console.log(`${userId} This User Is NOt Exsisted`);
    res.status(401).json({ error: "User Not Found" });
    return;
  }
  console.log("USer Authenticated !!!!!!!!!!");
  req.userId = newToken.userId;
  next();
}

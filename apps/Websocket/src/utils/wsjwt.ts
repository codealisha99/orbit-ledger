import jwt from "jsonwebtoken";
import type { JWTPayload } from "../types";


export function Verifytokenws(token: string): JWTPayload | null {
    try {
        if (!token || token.trim() === "") {
            console.error("[JWT WS] Token is empty or undefined");
            return null;
        }
        
        const secret = process.env.JWT_SECRET;
        if (!secret) {
            console.error("[JWT WS] JWT_SECRET is not defined in environment variables");
            return null;
        }

        const decoded = jwt.verify(token, secret) as JWTPayload;
        return decoded;
    } catch (err) {
        if (err instanceof jwt.TokenExpiredError) {
            console.error("[JWT WS] Token has expired:", err.message);
        } else if (err instanceof jwt.JsonWebTokenError) {
            console.error("[JWT WS] Invalid token - JWT verification failed:", err.message);
        } else {
            console.error("[JWT WS] Failed to verify the token:", err);
        }
        return null;
    }
}
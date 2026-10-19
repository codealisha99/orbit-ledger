import { createHash } from "node:crypto";
import { verifiedProxyIp } from "@orbitledger/shared/security";
import { verifyToken } from "../utils/jwt";
import { createClient } from "redis";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import type { Request } from "express";

const redisUrl = process.env.RATE_LIMIT_REDIS_URL || process.env.REDIS_URL;
const redisClient = redisUrl ? createClient({ url: redisUrl }) : null;
let redisConnectPromise: Promise<void> | null = null;

redisClient?.on("error", (error) => {
  console.error("[RATE_LIMIT] Redis connection error:", error.message);
});

/** Connect before listening so all production instances share rate limit counters. */
async function ensureRateLimitRedisConnected(): Promise<void> {
  if (!redisClient || redisClient.isReady) return;
  if (!redisConnectPromise) {
    redisConnectPromise = redisClient
      .connect()
      .then(() => undefined)
      .finally(() => {
        redisConnectPromise = null;
      });
  }
  await redisConnectPromise;
}

export async function connectRateLimitStore(): Promise<void> {
  if (!redisClient) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "RATE_LIMIT_REDIS_URL or REDIS_URL is required in production",
      );
    }
    console.warn(
      "[RATE_LIMIT] Redis is not configured; using per-process memory limits locally.",
    );
    return;
  }

  await ensureRateLimitRedisConnected();
  await redisClient.ping();
  console.log("[RATE_LIMIT] Shared Redis store connected");
}

export async function closeRateLimitStore(): Promise<void> {
  if (redisClient?.isOpen) await redisClient.quit();
}

function ipKey(req: Request) {
  const forwarded = verifiedProxyIp({
    ip: req.get("X-Orbit-Client-IP"),
    timestamp: req.get("X-Orbit-Client-Time"),
    signature: req.get("X-Orbit-Client-Signature"),
  });
  return ipKeyGenerator(
    forwarded || req.ip || req.socket.remoteAddress || "unknown",
  );
}
function clientKey(req: Request): string {
  const ip = ipKey(req);
  const token = req.headers.authorization?.split(" ")[1];
  const userId = req.userId ?? (token ? verifyToken(token)?.userId : undefined);
  return userId ? `user:${userId}` : ip;
}

function limiter(prefix: string, windowMs: number, max: number, error: string) {
  return rateLimit({
    windowMs,
    limit: max,
    message: { error },
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator:
      prefix === "auth-ip" || prefix === "oauth"
        ? ipKey
        : prefix === "auth-account"
          ? (req: Request) =>
              createHash("sha256")
                .update(
                  typeof req.body?.email === "string"
                    ? req.body.email.trim().toLowerCase().slice(0, 254)
                    : "invalid-input",
                )
                .digest("hex")
          : clientKey,
    skipSuccessfulRequests: prefix === "auth-account",
    ...(redisClient
      ? {
          store: new RedisStore({
            prefix: `orbitledger:ratelimit:${prefix}:`,
            sendCommand: async (...args: string[]) => {
              await ensureRateLimitRedisConnected();
              return redisClient.sendCommand(args);
            },
          }),
        }
      : {}),
  });
}

export const authRateLimit = limiter(
  "auth-ip",
  15 * 60 * 1000,
  30,
  "Too many authentication attempts. Please try again in 15 minutes.",
);

export const authAccountRateLimit = limiter(
  "auth-account",
  15 * 60 * 1000,
  5,
  "Too many attempts for this account. Please try again in 15 minutes.",
);

export const oauthRateLimit = limiter(
  "oauth",
  15 * 60 * 1000,
  10,
  "Too many OAuth attempts. Please try again in 15 minutes.",
);

export const globalRateLimit = limiter(
  "global",
  60 * 1000,
  900,
  "Too many requests from this client. Please try again later.",
);

export const tradeOpenRateLimit = limiter(
  "trade-open",
  60 * 1000,
  30,
  "Too many trade requests. Maximum 30 trades per minute allowed.",
);

export const tradeCloseRateLimit = limiter(
  "trade-close",
  60 * 1000,
  60,
  "Too many close requests. Maximum 60 closes per minute allowed.",
);

export const apiRateLimit = limiter(
  "api",
  60 * 1000,
  600,
  "Too many requests. Maximum 600 requests per minute allowed.",
);

export const chartDataRateLimit = limiter(
  "chart-data",
  60 * 1000,
  200,
  "Too many chart data requests. Please reduce refresh frequency.",
);

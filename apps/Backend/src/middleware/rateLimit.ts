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
    redisConnectPromise = redisClient.connect().then(() => undefined).finally(() => {
      redisConnectPromise = null;
    });
  }
  await redisConnectPromise;
}

export async function connectRateLimitStore(): Promise<void> {
  if (!redisClient) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RATE_LIMIT_REDIS_URL or REDIS_URL is required in production");
    }
    console.warn("[RATE_LIMIT] Redis is not configured; using per-process memory limits locally.");
    return;
  }

  await ensureRateLimitRedisConnected();
  await redisClient.ping();
  console.log("[RATE_LIMIT] Shared Redis store connected");
}

export async function closeRateLimitStore(): Promise<void> {
  if (redisClient?.isOpen) await redisClient.quit();
}

function clientKey(req: Request): string {
  const ipKey = ipKeyGenerator(req.ip || req.socket.remoteAddress || "unknown");
  return req.userId ? `${ipKey}:user:${req.userId}` : ipKey;
}

function limiter(prefix: string, windowMs: number, max: number, error: string) {
  return rateLimit({
    windowMs,
    limit: max,
    message: { error },
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: clientKey,
    skipSuccessfulRequests: prefix === "auth",
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
  "auth",
  15 * 60 * 1000,
  5,
  "Too many authentication attempts. Please try again in 15 minutes.",
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
  300,
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
  100,
  "Too many requests. Maximum 100 requests per minute allowed.",
);

export const chartDataRateLimit = limiter(
  "chart-data",
  60 * 1000,
  200,
  "Too many chart data requests. Please reduce refresh frequency.",
);

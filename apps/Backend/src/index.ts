import "../../../packages/database/src/env";
import { DomainError } from "./services/accountService";
import { ZodError } from "zod";
import { prisma } from "@orbitledger/database";
import { isFreshQuote, SUPPORTED_ASSETS } from "@orbitledger/shared";
import { PriceStorageMp } from "./data/store";
import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import { userRouter } from "./routes/user";
import { tradeRoutes } from "./routes/trades";
import { assetRouter } from "./routes/asset";
import { oauthRouter } from "./routes/oauth";
import {
  startOutbox,
  stopOutbox,
  initOrderBroadcast,
  stopOrderBroadcast,
} from "./services/orderBroadcast";
import { initPriceMonitor, stopPriceMonitor } from "./services/priceMonitor";
import {
  riskHealth,
  startPositionMonitor,
  stopPositionMonitor,
} from "./services/positionMonitor";
import {
  startSnapshotService,
  stopSnapshotService,
} from "./services/snapshotService";
import { restoreState } from "./services/stateRestoration";
import {
  startMarketCandleSync,
  stopMarketCandleSync,
} from "./services/marketCandleSync";
import { logOAuthStatus } from "./config/oauth";
import {
  closeRateLimitStore,
  connectRateLimitStore,
  globalRateLimit,
} from "./middleware/rateLimit";

const app: Express = express();
const port = Number(process.env.PORT) || 5000;

// Railway terminates TLS at one trusted proxy hop; use the forwarded client IP
// for rate limiting instead of grouping every request under the proxy address.
app.set("trust proxy", 1);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    apiContract: 2,
    revision:
      process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.APP_REVISION ?? "local",
  });
});

app.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const markets = Object.fromEntries(
      SUPPORTED_ASSETS.map((a) => [
        a,
        {
          fresh: isFreshQuote(PriceStorageMp.get(a)),
          time: PriceStorageMp.get(a)?.time ?? null,
        },
      ]),
    );
    const ready =
      Object.values(markets).every((m) => m.fresh) &&
      Date.now() - riskHealth.lastCompletedAt < 15000 &&
      riskHealth.errors === 0;
    res
      .status(ready ? 200 : 503)
      .json({ database: true, markets, risk: riskHealth, ready });
  } catch {
    res.status(503).json({ database: false, ready: false });
  }
});
const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const defaultOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
  "http://localhost:5177",
  "http://localhost:5178",
  "http://localhost:5179",
];

const effectiveOrigins =
  allowedOrigins.length > 0 ? allowedOrigins : defaultOrigins;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (effectiveOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
  }),
);
app.options(/.*/, cors());

app.use(globalRateLimit);
app.use(express.json({ limit: "64kb" }));

app.use("/api/v2/user", userRouter);
app.use("/api/v2/trade", tradeRoutes);
app.use("/api/v2/asset", assetRouter);
app.use("/api/v2/auth", oauthRouter);

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Route Not Found !! Undefined Route" });
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (error.message.includes("not allowed by CORS")) {
    return res.status(403).json({ error: error.message });
  }
  if (error instanceof DomainError)
    return res
      .status(error.status)
      .json({ error: error.message, code: error.code });
  if (error instanceof ZodError)
    return res
      .status(400)
      .json({ error: "Invalid request", details: error.issues });
  console.error(error);
  return res.status(500).json({ error: "Internal server error" });
});

async function main() {
  try {
    await connectRateLimitStore();
    logOAuthStatus();

    await restoreState();

    await initPriceMonitor();
    startMarketCandleSync();
    startPositionMonitor();
    await initOrderBroadcast();
    startOutbox();

    startSnapshotService();

    app.listen(port, () => {
      console.log(`
    Server running on port ${port}
    User API: http://localhost:${port}/api/v2/user
    Trade API: http://localhost:${port}/api/v2/trade
    Asset API: http://localhost:${port}/api/v2/asset`);
    });
  } catch (error) {
    console.error("[SERVER] Failed to start server:", error);
    process.exit(1);
  }
}

async function shutdown() {
  console.log("\n[SERVER] Shutting down gracefully...");
  try {
    stopSnapshotService();
    stopMarketCandleSync();
    stopPositionMonitor();
    await stopPriceMonitor();
    stopOutbox();
    await stopOrderBroadcast();
    await closeRateLimitStore();
    console.log("[SERVER] All services stopped successfully");
  } catch (error) {
    console.error("[SERVER] Error during shutdown:", error);
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main();

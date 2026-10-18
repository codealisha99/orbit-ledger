import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import { userRouter } from "./routes/user";
import { tradeRoutes } from "./routes/trades";
import { assetRouter } from "./routes/asset";
import { oauthRouter } from "./routes/oauth";
import { initOrderBroadcast, stopOrderBroadcast } from "./services/orderBroadcast";
import { initPriceMonitor, stopPriceMonitor } from "./services/priceMonitor";
import { startPositionMonitor, stopPositionMonitor } from "./services/positionMonitor";
import { startSnapshotService, stopSnapshotService } from "./services/snapshotService";
import { restoreState } from "./services/stateRestoration";
import { initPlatformProfit } from "./services/platformProfit";
import { startMarketCandleSync, stopMarketCandleSync } from "./services/marketCandleSync";
import { logOAuthStatus } from "./config/oauth";
import { closeRateLimitStore, connectRateLimitStore, globalRateLimit } from "./middleware/rateLimit";

const app: Express = express();
const port = Number(process.env.PORT) || 5000;

// Railway terminates TLS at one trusted proxy hop; use the forwarded client IP
// for rate limiting instead of grouping every request under the proxy address.
app.set("trust proxy", 1);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
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

const effectiveOrigins = allowedOrigins.length > 0 ? allowedOrigins : defaultOrigins;

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
    allowedHeaders: ["Content-Type", "Authorization"],
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
  return res.status(500).json({ error: "Internal server error" });
});

async function main() {
  try {
    await connectRateLimitStore();
    logOAuthStatus();

    await restoreState();

    await initPlatformProfit();

    await initPriceMonitor();
    startMarketCandleSync();
    startPositionMonitor();
    await initOrderBroadcast();

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

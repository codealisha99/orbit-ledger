import "../../../packages/database/src/env";
import {
  startBinance,
  stopBinance,
  restartBinance,
  binanceEmitter,
} from "./binance";
import { startRedis, stopRedis, publisherHealth, reconnectPublisher } from "./redish-publisher";
import { writeBatch, pruneOldTrades } from "./database";
import { enqueue, pendingBatch, acknowledge, spoolSize } from "./spool";
import {
  startKafkaProducer,
  publishBatch,
  stopKafkaProducer,
} from "./kafka-producer";
import { consumer_gr, shutdownConsumer } from "./kafka-consumer";
const kafkaEnabled = !!process.env.KAFKA_BROKERS?.trim();
let flushing = false;
let stopping = false;
let sourceHalted = false;
let lastTradeAt = 0;
let lastFlushAt = 0;
let lastError: string | null = null;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    const batch = pendingBatch();
    if (!batch.length) return;
    if (kafkaEnabled) await publishBatch(batch);
    else await writeBatch(batch);
    acknowledge(batch);
    lastFlushAt = Date.now();
    lastError = null;
  } catch (error) {
    lastError = String(error);
    console.error("[INGEST] Batch retained for retry", error);
  } finally {
    flushing = false;
  }
}
await startRedis();
if (kafkaEnabled) {
  await startKafkaProducer();
  void consumer_gr();
}
binanceEmitter.on("trade", (trade) => {
  lastTradeAt = trade.timestamp;
  try {
    enqueue(trade);
    if (spoolSize() >= 500) void flush();
  } catch (error) {
    sourceHalted = true;
    console.error("[INGEST] Source halted", error);
    stopBinance();
    process.exitCode = 1;
  }
});
const timer = setInterval(() => void flush(), 1000);
const pruneTimer = setInterval(() => void pruneOldTrades(), 30 * 60 * 1000);

const FEED_ALIVE_WINDOW = 30000;
const FEED_SILENCE_SOFT = 90000; // try reconnecting the socket
const FEED_SILENCE_HARD = 300000; // exit(1) so the platform restart policy recovers
const PUB_STALE_SOFT = 60000; // force Redis reconnect
const PUB_STALE_HARD = 180000; // exit(1) for a clean process restart
let lastFeedAttemptAt = 0;

const watchdogTimer = setInterval(() => {
  const now = Date.now();
  if (lastTradeAt <= 0) return;
  const feedAlive = now - lastTradeAt < FEED_ALIVE_WINDOW;

  const { lastPublishOkAt, publishFailures } = publisherHealth();
  if (feedAlive && now - lastPublishOkAt > PUB_STALE_SOFT) {
    console.warn(
      JSON.stringify({
        metric: "publisher_stale",
        lastPublishOkAt,
        publishFailures,
      }),
    );
    void reconnectPublisher();
  }
  if (feedAlive && lastPublishOkAt > 0 && now - lastPublishOkAt > PUB_STALE_HARD) {
    console.error("[WATCHDOG] No confirmed publishes in 3m. Restarting process.");
    process.exit(1);
  }

  if (!feedAlive && now - lastTradeAt > FEED_SILENCE_SOFT && now - lastFeedAttemptAt > 45000) {
    lastFeedAttemptAt = now;
    console.warn(JSON.stringify({ metric: "feed_silent_ms", value: now - lastTradeAt }));
    restartBinance();
  }
  if (!feedAlive && now - lastTradeAt > FEED_SILENCE_HARD) {
    console.error("[WATCHDOG] No trades for 5m. Restarting process.");
    process.exit(1);
  }
}, 15000);

const healthTimer = setInterval(() => {
  const pending = spoolSize();
  if (pending)
    console.log(JSON.stringify({ metric: "ingest_pending", value: pending }));
}, 30000);
startBinance();
setTimeout(() => void pruneOldTrades(), 45000);
async function shutdown() {
  if (stopping) return;
  stopping = true;
  stopBinance();
  clearInterval(timer);
  clearInterval(pruneTimer);
  clearInterval(watchdogTimer);
  clearInterval(healthTimer);
  if (!flushing) await flush();
  if (kafkaEnabled) {
    await shutdownConsumer();
    await stopKafkaProducer();
  }
  await stopRedis();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

const healthPort =
  process.env.POLLER_HEALTH_PORT ??
  (process.env.RAILWAY_SERVICE_ID ? process.env.PORT : undefined);
if (healthPort)
  Bun.serve({
    port: Number(healthPort),
    fetch(request) {
      const url = new URL(request.url);
      const ready =
        Date.now() - lastTradeAt < 30000 &&
        !lastError &&
        !sourceHalted &&
        lastFlushAt > 0;
      return Response.json(
        {
          status: "ok",
          ready,
          pending: spoolSize(),
          lastTradeAt,
          lastFlushAt,
          lastPublishOkAt: publisherHealth().lastPublishOkAt,
          publishFailures: publisherHealth().publishFailures,
          downstreamError: !!lastError,
          sourceHalted,
          revision:
            process.env.RAILWAY_GIT_COMMIT_SHA ??
            process.env.APP_REVISION ??
            "local",
        },
        { status: url.pathname === "/ready" && !ready ? 503 : 200 },
      );
    },
  });

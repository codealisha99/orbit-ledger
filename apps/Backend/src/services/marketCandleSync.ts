import {
  bucketStart,
  INTERVAL_SECONDS,
  toInternalPrice,
} from "@orbitledger/shared";
import { prisma } from "@orbitledger/database";

const BINANCE_KLINES_URL = "https://data-api.binance.vision/api/v3/klines";
const SYMBOLS = ["BTC", "ETH", "SOL"] as const;
const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"] as const;
const SYNC_EVERY_MS = 60 * 1000;

type Symbol = (typeof SYMBOLS)[number];
type Interval = (typeof INTERVALS)[number];
type Kline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

let syncTimer: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;

function activeCandleStart(interval: Interval, now: Date): Date {
  return new Date(
    (bucketStart(now.getTime() / 1000, interval) - INTERVAL_SECONDS[interval]) *
      1000,
  );
}
async function syncCurrentCandle(symbol: Symbol, interval: Interval) {
  const startTime = activeCandleStart(interval, new Date());
  const params = new URLSearchParams({
    symbol: `${symbol}USDT`,
    interval,
    startTime: String(startTime.getTime()),
    limit: "2",
  });
  const response = await fetch(`${BINANCE_KLINES_URL}?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Binance returned ${response.status}`);

  const rows = (await response.json()) as Kline[];
  for (const row of rows) {
    await prisma.marketCandle.upsert({
      where: {
        symbol_interval_timestamp: {
          symbol,
          interval,
          timestamp: new Date(row[0]),
        },
      },
      create: {
        symbol,
        interval,
        timestamp: new Date(row[0]),
        open: BigInt(toInternalPrice(Number(row[1]))),
        high: BigInt(toInternalPrice(Number(row[2]))),
        low: BigInt(toInternalPrice(Number(row[3]))),
        close: BigInt(toInternalPrice(Number(row[4]))),
        baseVolume: row[5],
        quoteVolume: row[7],
        tradeCount: row[8],
      },
      update: {
        high: BigInt(toInternalPrice(Number(row[2]))),
        low: BigInt(toInternalPrice(Number(row[3]))),
        close: BigInt(toInternalPrice(Number(row[4]))),
        baseVolume: row[5],
        quoteVolume: row[7],
        tradeCount: row[8],
      },
    });
  }
}

async function syncLatestCandles() {
  if (isSyncing) return;
  isSyncing = true;
  try {
    const results = await Promise.allSettled(
      SYMBOLS.flatMap((symbol) =>
        INTERVALS.map((interval) => syncCurrentCandle(symbol, interval)),
      ),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        console.warn(
          "[MARKET CANDLES] Could not refresh the current candle:",
          result.reason,
        );
      }
    }
  } finally {
    isSyncing = false;
  }
}

export function startMarketCandleSync() {
  if (syncTimer) return;
  void syncLatestCandles();
  syncTimer = setInterval(() => void syncLatestCandles(), SYNC_EVERY_MS);
  console.log(
    "[MARKET CANDLES] Repairing current and previous bars across all intervals every minute.",
  );
}

export function stopMarketCandleSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
}

import { prisma } from "@papership/database";
import {
  bucketStart,
  INTERVAL_SECONDS,
  fromInternalPrice,
} from "@papership/shared";
import type { TimeDurationCandel, Candle, ValidSymbol } from "../types";
const SQL_INTERVAL = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "15m": "15 minutes",
  "1h": "1 hour",
  "4h": "4 hours",
  "1d": "1 day",
  "1w": "1 week",
} as const;
export async function getCandelFromDb(
  symbol: ValidSymbol,
  interval: TimeDurationCandel,
  startTime: number,
  endTime: number,
): Promise<Candle[]> {
  if (!["BTC", "ETH", "SOL"].includes(symbol) || !(interval in SQL_INTERVAL))
    throw new Error("Invalid market or interval");
  const start = bucketStart(startTime, interval);
  const end = Math.min(endTime, Math.floor(Date.now() / 1000));
  if (start > end) return [];
  if ((end - start) / INTERVAL_SECONDS[interval] > 50000)
    throw new Error("Choose a coarser interval (maximum 50,000 bars).");
  const stored = await prisma.marketCandle.findMany({
    where: {
      symbol,
      interval,
      timestamp: { gte: new Date(start * 1000), lte: new Date(end * 1000) },
    },
    orderBy: { timestamp: "asc" },
    take: 50000,
  });
  const candles = new Map<number, Candle>(
    stored.map((c) => [
      c.timestamp.getTime() / 1000,
      {
        time: c.timestamp.getTime() / 1000,
        open: fromInternalPrice(Number(c.open)),
        high: fromInternalPrice(Number(c.high)),
        low: fromInternalPrice(Number(c.low)),
        close: fromInternalPrice(Number(c.close)),
        volume: String(c.baseVolume),
      },
    ]),
  );
  if (interval !== "1d" && interval !== "1w") {
    const raw = await prisma.$queryRawUnsafe<
      Array<{
        time: Date;
        open: bigint;
        high: bigint;
        low: bigint;
        close: bigint;
        volume: string;
      }>
    >(
      `
      SELECT date_bin(INTERVAL '${SQL_INTERVAL[interval]}', timestamp, TIMESTAMP '2001-01-01') AS time,
      (array_agg(price ORDER BY timestamp, "tradeId"))[1] AS open, max(price) AS high, min(price) AS low,
      (array_agg(price ORDER BY timestamp DESC, "tradeId" DESC))[1] AS close, sum(quantity) AS volume
      FROM "Trade" WHERE symbol=$1 AND timestamp >= $2 AND timestamp <= $3
      GROUP BY 1 ORDER BY 1 LIMIT 50000`,
      `${symbol}USDT`,
      new Date(start * 1000),
      new Date(end * 1000),
    );
    const current = bucketStart(Date.now() / 1000, interval);
    for (const row of raw) {
      const time = row.time.getTime() / 1000;
      const existing = candles.get(time);
      if (existing && time < current) continue;
      const c = {
        time,
        open: existing?.open ?? fromInternalPrice(Number(row.open)),
        high: Math.max(
          existing?.high ?? 0,
          fromInternalPrice(Number(row.high)),
        ),
        low: Math.min(
          existing?.low ?? Infinity,
          fromInternalPrice(Number(row.low)),
        ),
        close: fromInternalPrice(Number(row.close)),
        volume: existing?.volume ?? String(row.volume),
      };
      candles.set(time, c);
    }
  }

  if (candles.size === 0) {
    try {
      const params = new URLSearchParams({
        symbol: `${symbol}USDT`,
        interval,
        startTime: String(start * 1000),
        endTime: String(end * 1000),
        limit: "1000",
      });
      const response = await fetch(
        `https://data-api.binance.vision/api/v3/klines?${params}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (response.ok) {
        const rows = (await response.json()) as Array<
          [number, string, string, string, string, string, ...unknown[]]
        >;
        for (const row of rows) {
          const time = Math.floor(row[0] / 1000);
          candles.set(time, {
            time,
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: String(row[5]),
          });
        }
      }
    } catch {
      // Ignore on-demand fetch errors and return what we have
    }
  }

  return [...candles.values()].sort((a, b) => a.time - b.time);
}

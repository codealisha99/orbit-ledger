import { TimeDurationCandel, Candle, ValidSymbol } from "../types";
import { fromInternalPrice } from "@orbitledger/shared";
import { prisma, Prisma } from "@orbitledger/database";
import { number, string } from "zod";
import { closeOrder } from "../utils/tradeUtils";

const candleArr: Candle[] = [];
export async function getCandelFromDb(
  symbol: ValidSymbol,
  interval: TimeDurationCandel,
  startTime: number,
  endTime: number
): Promise<Candle[]> {
  const IntervalConfig = {
    "1m":  { minutes: 1,     pgInterval: "1 minute" },
    "5m":  { minutes: 5,     pgInterval: "5 minutes" },
    "15m": { minutes: 15,    pgInterval: "15 minutes" },
    "1h":  { minutes: 60,    pgInterval: "1 hour" },
    "4h":  { minutes: 240,   pgInterval: "4 hours" },
    "1d":  { minutes: 1440,  pgInterval: "1 day" },
    "1w":  { minutes: 10080, pgInterval: "1 week" },
  } as const;

  if (!symbol || symbol.trim() === "") {
    throw new Error("Symbol Parameter is not Thier !");
  }

  const now = Math.floor(Date.now() / 1000);

  if (startTime > now) {
    return [];
  }

  if (endTime > now) {
    endTime = now;
  }

  if (startTime > endTime) {
    console.error(`[CANDLES] Invalid time range: startTime (${startTime}) > endTime (${endTime})`);
    throw new Error("Invalid time range: startTime must be before or equal to endTime");
  }

  const SymbolMap = {
    BTC: "BTCUSDT",
    ETH: "ETHUSDT",
    SOL: "SOLUSDT",
  } as const;

  const dbSymbol = SymbolMap[symbol as keyof typeof SymbolMap]; // "BTC" → "BTCUSDT"
  if (!dbSymbol) { //Check that the symbolis correct or not agian 
    throw new Error(`Invalid symbol. Supported: BTC, ETH, SOL for Now`);
  }

  const rangeDuration = (endTime - startTime) / 60; // startTime/endTime are in seconds
  const expectedCandles = rangeDuration / IntervalConfig[interval].minutes;
  if (expectedCandles > 1000) {
    startTime = endTime - 1000 * IntervalConfig[interval].minutes * 60;
  }
  const startDate = new Date(startTime * 1000);
  const endDate = new Date(endTime * 1000);
  const pgInterval = IntervalConfig[interval].pgInterval;

  let results: unknown;
  try {
    results = await prisma.$queryRawUnsafe(`
      SELECT
        time_bucket(INTERVAL '${pgInterval}', timestamp) AS time,
        (array_agg(price ORDER BY timestamp))[1] AS open,
        MAX(price) AS high,
        MIN(price) AS low,
        (array_agg(price ORDER BY timestamp DESC))[1] AS close,
        SUM(CAST(quantity AS DECIMAL)) AS volume
      FROM "Trade"
      WHERE symbol = $1
        AND timestamp >= $2
        AND timestamp <= $3
      GROUP BY time_bucket(INTERVAL '${pgInterval}', timestamp)
      ORDER BY time ASC
      LIMIT 1000
    `, dbSymbol, startDate, endDate);
  } catch (error) {
    // Fallback for plain PostgreSQL (e.g., Neon) where time_bucket extension is unavailable.
    results = await prisma.$queryRawUnsafe(`
      SELECT
        date_bin(INTERVAL '${pgInterval}', timestamp, TIMESTAMP '2001-01-01') AS time,
        (array_agg(price ORDER BY timestamp))[1] AS open,
        MAX(price) AS high,
        MIN(price) AS low,
        (array_agg(price ORDER BY timestamp DESC))[1] AS close,
        SUM(CAST(quantity AS DECIMAL)) AS volume
      FROM "Trade"
      WHERE symbol = $1
        AND timestamp >= $2
        AND timestamp <= $3
      GROUP BY date_bin(INTERVAL '${pgInterval}', timestamp, TIMESTAMP '2001-01-01')
      ORDER BY time ASC
      LIMIT 1000
    `, dbSymbol, startDate, endDate);

    console.warn("[CANDLES] Using date_bin fallback query:", error instanceof Error ? error.message : error);
  }
    if (!results || (results as any[]).length === 0) {
    console.warn(`[CANDLES] No candles found for ${dbSymbol} from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.warn(`[CANDLES] This usually means:`);
    console.warn(`  1. Trade table is empty (Price_Poller not running)`);
    console.warn(`  2. No trades for this time range`);
    console.warn(`  3. Symbol mismatch (check database has ${dbSymbol})`);
    return [];
  }

  const candles: Candle[] = (results as any[]).map((row) => ({
    time: Math.floor(new Date(row.time).getTime() / 1000),
    open: fromInternalPrice(Number(row.open)),
    high: fromInternalPrice(Number(row.high)),
    low: fromInternalPrice(Number(row.low)),
    close: fromInternalPrice(Number(row.close)),
    volume: row.volume ? row.volume.toString() : "0",
  }));

  return candles;
}

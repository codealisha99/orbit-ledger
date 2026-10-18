import { prisma } from "../packages/database/src/index";
import {
  toInternalPrice,
  bucketStart,
  type CandleInterval,
} from "../packages/shared/src/index";

const BASE_URL = "https://data-api.binance.vision/api/v3/klines";
const START_TIME = process.env.HISTORY_START
  ? Date.parse(process.env.HISTORY_START)
  : Date.UTC(2019, 0, 1);
if (!Number.isFinite(START_TIME)) throw new Error("Invalid HISTORY_START");
const BATCH_LIMIT = 1000;
const SYMBOLS = ["BTC", "ETH", "SOL"] as const;
const INTERVALS = (process.env.HISTORY_INTERVALS?.split(",") ?? [
  "1d",
  "1w",
]) as CandleInterval[];
if (
  INTERVALS.some(
    (v) => !["1m", "5m", "15m", "1h", "4h", "1d", "1w"].includes(v),
  )
)
  throw new Error("Invalid HISTORY_INTERVALS");

type Symbol = (typeof SYMBOLS)[number];
type Interval = (typeof INTERVALS)[number];
type BinanceKline = [
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

function currentBucketStart(interval: Interval, now: Date): Date {
  return new Date(bucketStart(now.getTime() / 1000, interval) * 1000);
}

async function fetchKlines(
  pair: string,
  interval: Interval,
  startTime: number,
  endTime: number,
): Promise<BinanceKline[]> {
  const url = new URL(BASE_URL);
  url.search = new URLSearchParams({
    symbol: pair,
    interval,
    startTime: String(startTime),
    endTime: String(endTime),
    limit: String(BATCH_LIMIT),
  }).toString();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 4) {
          throw new Error(
            `Binance request failed after retries (${response.status}): ${await response.text()}`,
          );
        }
        const waitMs = Math.min(1000 * 2 ** attempt, 30_000);
        console.warn(
          `[history] Binance returned ${response.status}; retrying in ${waitMs / 1000}s`,
        );
        await Bun.sleep(waitMs);
        continue;
      }
      if (!response.ok) {
        throw new Error(
          `Binance request failed (${response.status}): ${await response.text()}`,
        );
      }
      return (await response.json()) as BinanceKline[];
    } catch (error) {
      if (attempt === 4) throw error;
      const waitMs = Math.min(1000 * 2 ** attempt, 30_000);
      console.warn(
        `[history] Request failed; retrying in ${waitMs / 1000}s:`,
        error,
      );
      await Bun.sleep(waitMs);
    }
  }
  return [];
}

function toCandleData(
  symbol: Symbol,
  interval: Interval,
  rows: BinanceKline[],
) {
  return rows.map((row) => ({
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
  }));
}

async function saveCandles(
  symbol: Symbol,
  interval: Interval,
  rows: BinanceKline[],
) {
  if (rows.length === 0) return 0;

  const candles = toCandleData(symbol, interval, rows);
  const currentStart = currentBucketStart(interval, new Date());
  const completed = candles.filter((candle) => candle.timestamp < currentStart);
  const current = candles.filter((candle) => candle.timestamp >= currentStart);

  let inserted = 0;
  for (let offset = 0; offset < completed.length; offset += BATCH_LIMIT) {
    const result = await prisma.marketCandle.createMany({
      data: completed.slice(offset, offset + BATCH_LIMIT),
      skipDuplicates: true,
    });
    inserted += result.count;
  }

  // The active daily/weekly bar changes throughout the period, so refresh it
  // on reruns instead of leaving the first fetched version frozen in storage.
  for (const candle of current) {
    await prisma.marketCandle.upsert({
      where: {
        symbol_interval_timestamp: {
          symbol,
          interval,
          timestamp: candle.timestamp,
        },
      },
      create: candle,
      update: candle,
    });
    inserted += 1;
  }
  return inserted;
}

async function backfill(symbol: Symbol, interval: Interval) {
  const pair = `${symbol}USDT`;
  let startTime = bucketStart(START_TIME / 1000, interval) * 1000;
  let totalSaved = 0;
  let pages = 0;
  const endTime = Date.now();

  while (startTime < endTime) {
    const rows = await fetchKlines(pair, interval, startTime, endTime);
    if (rows.length === 0) break;

    totalSaved += await saveCandles(symbol, interval, rows);
    pages += 1;
    const nextStart = rows[rows.length - 1][0] + 1;
    if (nextStart <= startTime)
      throw new Error(
        `Binance returned a non-advancing ${interval} page for ${pair}`,
      );
    startTime = nextStart;
    console.log(
      `[history] ${pair} ${interval}: page ${pages}, ${rows.length} candles (${totalSaved} new or refreshed)`,
    );
    if (rows.length < BATCH_LIMIT) break;
    await Bun.sleep(150);
  }

  console.log(
    `[history] Finished ${pair} ${interval}; saved ${totalSaved} candles`,
  );
}

async function main() {
  console.log(
    `Backfilling ${INTERVALS.join(", ")} bars since ${new Date(START_TIME).toISOString()}. Completed bars are deduplicated on reruns.`,
  );
  console.log(
    "SOL history begins when Binance first listed SOLUSDT; no earlier spot candles exist.",
  );
  for (const symbol of SYMBOLS) {
    for (const interval of INTERVALS) {
      await backfill(symbol, interval);
    }
  }

  const summary = await prisma.$queryRaw<
    Array<{
      symbol: string;
      interval: string;
      count: bigint;
      earliest: Date;
      latest: Date;
    }>
  >`
    SELECT symbol, interval, COUNT(*) AS count,
           MIN(timestamp) AS earliest, MAX(timestamp) AS latest
    FROM market_candles
    GROUP BY symbol, interval
    ORDER BY symbol, interval
  `;

  for (const row of summary) {
    console.log(
      `[history] ${row.symbol} ${row.interval}: ${row.count} bars, ${row.earliest.toISOString()} → ${row.latest.toISOString()}`,
    );
  }
}

main()
  .catch((error) => {
    console.error("Historical candle backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

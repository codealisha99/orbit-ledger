import { prisma } from "../packages/database/src/index";
import {
  SUPPORTED_ASSETS,
  INTERVAL_SECONDS,
  bucketStart,
} from "../packages/shared/src/index";
let missing = false;
for (const symbol of SUPPORTED_ASSETS) {
  for (const interval of Object.keys(
    INTERVAL_SECONDS,
  ) as (keyof typeof INTERVAL_SECONDS)[]) {
    const start = new Date(
      (bucketStart(Date.now() / 1000, interval) -
        INTERVAL_SECONDS[interval] * 100) *
        1000,
    );
    const [count, earliest, latest] = await Promise.all([
      prisma.marketCandle.count({
        where: { symbol, interval, timestamp: { gte: start } },
      }),
      prisma.marketCandle.findFirst({
        where: { symbol, interval },
        orderBy: { timestamp: "asc" },
      }),
      prisma.marketCandle.findFirst({
        where: { symbol, interval },
        orderBy: { timestamp: "desc" },
      }),
    ]);
    if (count < 100) missing = true;
    console.log(
      JSON.stringify({
        symbol,
        interval,
        recentBars: count,
        earliest: earliest?.timestamp ?? null,
        latest: latest?.timestamp ?? null,
        needsBackfill: count < 100,
      }),
    );
  }
}
await prisma.$disconnect();
process.exitCode = missing ? 1 : 0;

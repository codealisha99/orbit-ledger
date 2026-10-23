import { prisma } from "@orbitledger/database";
import type { Trades } from "./binance";

const RETENTION_DAYS = Math.min(7, Math.max(1, Number(process.env.TRADE_RETENTION_DAYS ?? 1)));
const PRUNE_CHUNK = 50000;

export async function writeBatch(batch: Trades[]) {
  if (batch.length === 0) {
    console.log("Empty Batch Skiping to push to Database");
    return;
  }
  try {
    const pushdata = batch.map((trade) => ({
      tradeId: BigInt(trade.tradeId),
      symbol: trade.symbol,
      price: BigInt(trade.price),
      quantity: trade.quantity,
      timestamp: new Date(trade.timestamp),
    }));
    const pushResult = await prisma.trade.createMany({
      data: pushdata,
      skipDuplicates: true,
    });
    console.log(`Inserted ${pushResult.count} trades into Database`);
  } catch (err) {
    console.error("Error writing batch to database:", err);
    throw err;
  }
}

export async function pruneOldTrades(maxPerRun = 500000): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
  let deleted = 0;
  try {
    while (deleted < maxPerRun) {
      const chunk = await prisma.$executeRaw`
        DELETE FROM "Trade"
        WHERE id IN (
          SELECT id FROM "Trade" WHERE timestamp < ${cutoff} LIMIT ${PRUNE_CHUNK}
        )`;
      if (!chunk) break;
      deleted += Number(chunk);
    }
    if (deleted) console.log(`[RETENTION] Pruned ${deleted} trades older than ${RETENTION_DAYS}d`);
    return deleted;
  } catch (err) {
    console.error("[RETENTION] Prune failed", err);
    return deleted;
  }
}


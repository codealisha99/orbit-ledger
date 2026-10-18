import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Trades } from "./binance";
const path = process.env.INGEST_SPOOL_PATH || ".data/market-spool.sqlite";
mkdirSync(dirname(path), { recursive: true });
const db = new Database(path, { create: true });
db.exec(
  "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS pending (symbol TEXT, id TEXT, payload TEXT NOT NULL, PRIMARY KEY(symbol,id));",
);
let pendingCount = (
  db.query("SELECT count(*) AS count FROM pending").get() as { count: number }
).count;
const insert = db.query(
  "INSERT OR IGNORE INTO pending (symbol,id,payload) VALUES (?,?,?)",
);
const remove = db.query("DELETE FROM pending WHERE symbol=? AND id=?");
export function enqueue(trade: Trades) {
  // Persist before any asynchronous publication. A bounded disk queue fails loudly at capacity.
  if (spoolSize() >= 250000)
    throw new Error(
      "Ingestion spool capacity exceeded. Restore downstream service and backfill the source gap.",
    );
  pendingCount += insert.run(
    trade.symbol,
    String(trade.tradeId),
    JSON.stringify(trade),
  ).changes;
}
export function spoolSize() {
  return pendingCount;
}
export function pendingBatch(): Trades[] {
  return (
    db.query("SELECT payload FROM pending ORDER BY rowid LIMIT 500").all() as {
      payload: string;
    }[]
  ).map((row) => JSON.parse(row.payload));
}
export function acknowledge(batch: Trades[]) {
  let removed = 0;
  db.transaction(() => {
    for (const trade of batch)
      removed += remove.run(trade.symbol, String(trade.tradeId)).changes;
  })();
  pendingCount -= removed;
}

import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
const dir = mkdtempSync(join(tmpdir(), "actioncd-spool-"));
process.env.INGEST_SPOOL_PATH = join(dir, "spool.sqlite");
const { enqueue, pendingBatch, acknowledge, spoolSize } =
  await import("../src/spool");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
test("unacknowledged writes survive durable reads and deduplicate by symbol plus ID", () => {
  const trade = {
    symbol: "BTCUSDT",
    tradeId: 7,
    price: 600000000,
    quantity: "0.5",
    timestamp: Date.now(),
  };
  enqueue(trade);
  enqueue(trade);
  enqueue({ ...trade, symbol: "ETHUSDT" });
  expect(spoolSize()).toBe(2);
  const anotherConnection = new Database(process.env.INGEST_SPOOL_PATH!);
  expect(
    (
      anotherConnection.query("SELECT count(*) AS n FROM pending").get() as {
        n: number;
      }
    ).n,
  ).toBe(2);
  anotherConnection.close();
  const batch = pendingBatch();
  expect(pendingBatch()).toEqual(batch);
  acknowledge(batch.slice(0, 1));
  expect(spoolSize()).toBe(1);
  acknowledge(batch);
  expect(spoolSize()).toBe(0);
});

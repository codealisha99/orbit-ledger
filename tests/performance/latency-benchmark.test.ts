import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../../packages/database/src/index";
import { mutateAccount, accountSummary } from "../../apps/Backend/src/services/accountService";
import { PriceStorageMp } from "../../apps/Backend/src/data/store";
import { randomUUID } from "node:crypto";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.startsWith("/actioncd_quality_") ||
  target.searchParams.has("host")
) {
  throw new Error("Use a dedicated localhost actioncd_quality_ database for tests.");
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

describe("Performance Benchmark & Latency Profiling", () => {
  const users: string[] = [];
  const USER_COUNT = 10;

  beforeAll(async () => {
    // Create pool of 10 test users with $100,000 each
    for (let i = 0; i < USER_COUNT; i++) {
      const u = `perf-user-${i}-${randomUUID()}`;
      users.push(u);
      await prisma.user.create({
        data: {
          userId: u,
          email: `${u}@perf.test`,
          password: "password",
          balanceCents: 10000000, // $100,000
        },
      });
    }

    PriceStorageMp.set("BTC", {
      bid: 600000000,
      ask: 600000000,
      time: Date.now(),
    });
  });

  afterAll(async () => {
    await prisma.activeOrder.deleteMany({ where: { userId: { in: users } } });
    await prisma.closedOrder.deleteMany({ where: { userId: { in: users } } });
    await prisma.accountEvent.deleteMany({ where: { userId: { in: users } } });
    await prisma.mutationReceipt.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { userId: { in: users } } });
  });

  test("Benchmark: Account Summary (Read/Evaluation) Latency across 50 calls", async () => {
    const latencies: number[] = [];

    for (let i = 0; i < 50; i++) {
      const u = users[i % users.length];
      const start = performance.now();
      await accountSummary(u);
      latencies.push(performance.now() - start);
    }

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);

    console.log(`[BENCHMARK] Account Summary (50 queries): p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, p99=${p99.toFixed(2)}ms`);

    expect(p50).toBeLessThan(50); // p50 well under 50ms
    expect(p95).toBeLessThan(150); // p95 under 150ms
  });

  test("Benchmark: Order Execution Latency with PostgreSQL Advisory Locking across 50 orders", async () => {
    const latencies: number[] = [];
    const startTime = performance.now();

    for (let i = 0; i < 50; i++) {
      const u = users[i % users.length];
      const start = performance.now();
      await mutateAccount(u, randomUUID(), {
        kind: "open",
        asset: "BTC",
        type: "buy",
        margin: 50,
        leverage: 5,
      });
      latencies.push(performance.now() - start);
    }

    const totalDuration = performance.now() - startTime;
    const throughput = (50 / (totalDuration / 1000)).toFixed(1);

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);

    console.log(`[BENCHMARK] Order Execution (50 writes across 10 users): Throughput=${throughput} orders/sec, p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, p99=${p99.toFixed(2)}ms`);

    expect(p50).toBeLessThan(100); // Meets p50 <= 100ms target
    expect(p95).toBeLessThan(200); // Meets p95 <= 200ms target
    expect(p99).toBeLessThan(500); // Meets p99 <= 500ms target
  });

  test("Benchmark: Concurrent Bursts (10 simultaneous order writes)", async () => {
    const burstStart = performance.now();
    const promises = users.map((u) =>
      mutateAccount(u, randomUUID(), {
        kind: "open",
        asset: "BTC",
        type: "buy",
        margin: 25,
        leverage: 2,
      }),
    );

    const results = await Promise.all(promises);
    const burstDuration = performance.now() - burstStart;

    console.log(`[BENCHMARK] 10 concurrent users burst execution completed in ${burstDuration.toFixed(2)}ms (${(10 / (burstDuration / 1000)).toFixed(1)} ops/sec)`);

    expect(results.length).toBe(10);
    expect(burstDuration).toBeLessThan(500); // Entire burst completed under 500ms
  });
});

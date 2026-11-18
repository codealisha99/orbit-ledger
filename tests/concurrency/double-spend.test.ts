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

describe("Concurrency and Race Condition Testing", () => {
  const userId = `concurrency-${randomUUID()}`;

  beforeAll(async () => {
    // Initialize user with exactly $10,000.00 (1,000,000 cents)
    await prisma.user.create({
      data: {
        userId,
        email: `${userId}@concurrency.test`,
        password: "hashed-test-password",
        balanceCents: 1000000,
      },
    });
    // Set fresh quote
    PriceStorageMp.set("BTC", {
      bid: 600000000,
      ask: 600000000,
      time: Date.now(),
    });
  });

  afterAll(async () => {
    await prisma.activeOrder.deleteMany({ where: { userId } });
    await prisma.closedOrder.deleteMany({ where: { userId } });
    await prisma.accountEvent.deleteMany({ where: { userId } });
    await prisma.mutationReceipt.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { userId } });
  });

  test("Scenario 1: Double Spending Prevention — two simultaneous $7,000 orders against $10,000 balance", async () => {
    // Both orders require $7,000 margin + $35 fee = $7,035 each.
    // Together they require $14,070, exceeding the $10,000 cash balance.
    const key1 = randomUUID();
    const key2 = randomUUID();

    const orderCmd1 = {
      kind: "open" as const,
      asset: "BTC" as const,
      type: "buy" as const,
      margin: 7000,
      leverage: 5,
    };
    const orderCmd2 = {
      kind: "open" as const,
      asset: "BTC" as const,
      type: "buy" as const,
      margin: 7000,
      leverage: 5,
    };

    const results = await Promise.allSettled([
      mutateAccount(userId, key1, orderCmd1),
      mutateAccount(userId, key2, orderCmd2),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one must succeed and one must fail with INSUFFICIENT_BALANCE
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const failureReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(failureReason.message).toContain("Available cash must cover collateral and the opening fee");

    // Verify database state: exactly 1 active order
    const orders = await prisma.activeOrder.findMany({ where: { userId } });
    expect(orders.length).toBe(1);

    // Verify balance: $10,000 - $7,000 margin - $35 fee = $2,965 (296,500 cents)
    const user = await prisma.user.findUniqueOrThrow({ where: { userId } });
    expect(user.balanceCents).toBe(296500);
    expect(user.balanceCents).toBeGreaterThan(0);
  });

  test("Scenario 2: Concurrent Selling / Closing — simultaneous close requests credit only once", async () => {
    const active = await prisma.activeOrder.findFirstOrThrow({ where: { userId } });
    const keyA = randomUUID();
    const keyB = randomUUID();

    const results = await Promise.allSettled([
      mutateAccount(userId, keyA, { kind: "close", orderId: active.orderId }),
      mutateAccount(userId, keyB, { kind: "close", orderId: active.orderId }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const failureReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(failureReason.message).toContain("This position is already closed or no longer available");

    // Active order is gone; exactly 1 closed order created
    expect(await prisma.activeOrder.count({ where: { userId } })).toBe(0);
    expect(await prisma.closedOrder.count({ where: { userId } })).toBe(1);
  });

  test("Scenario 3: 10 Identical Concurrent Requests with the same Idempotency Key", async () => {
    const key = randomUUID();
    const cmd = {
      kind: "open" as const,
      asset: "BTC" as const,
      type: "buy" as const,
      margin: 100,
      leverage: 10,
    };

    // Dispatch 10 parallel identical requests
    const promises = Array.from({ length: 10 }, () => mutateAccount(userId, key, cmd));
    const responses = (await Promise.all(promises)) as any[];

    // All 10 must succeed and return the exact same eventId and positionId
    const firstEventId = responses[0].eventId;
    const firstPosId = responses[0].positionId;

    for (const res of responses) {
      expect(res.eventId).toBe(firstEventId);
      expect(res.positionId).toBe(firstPosId);
    }

    // Database must contain only ONE active order and ONE mutation receipt for this key
    expect(await prisma.activeOrder.count({ where: { userId, orderId: firstPosId } })).toBe(1);
    expect(await prisma.mutationReceipt.count({ where: { userId, key } })).toBe(1);
  });

  test("Scenario 4: Concurrent Independent Trades Serialize Safely", async () => {
    // Dispatch 3 independent orders with distinct keys and margins
    const order1 = mutateAccount(userId, randomUUID(), { kind: "open", asset: "BTC", type: "buy", margin: 50, leverage: 5 });
    const order2 = mutateAccount(userId, randomUUID(), { kind: "open", asset: "BTC", type: "sell", margin: 50, leverage: 5 });
    const order3 = mutateAccount(userId, randomUUID(), { kind: "open", asset: "BTC", type: "buy", margin: 50, leverage: 10 });

    const results = await Promise.all([order1, order2, order3]);
    expect(results.length).toBe(3);

    // Total active orders should now be 1 (from scenario 3) + 3 = 4
    const totalOrders = await prisma.activeOrder.count({ where: { userId } });
    expect(totalOrders).toBe(4);

    // Summary must reconcile without negative values
    const summary = await accountSummary(userId);
    expect(summary.availableCents).toBeGreaterThan(0);
    expect(summary.reservedCents).toBe(25000); // 100 + 50 + 50 + 50 = $250 = 25,000 cents
  });
});

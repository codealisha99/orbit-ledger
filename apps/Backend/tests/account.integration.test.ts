import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@orbitledger/database";
import { mutateAccount, accountSummary } from "../src/services/accountService";
import { PriceStorageMp, StoreData, orderStorageMap } from "../src/data/store";
import { restoreState } from "../src/services/stateRestoration";
import { checkCycle } from "../src/services/positionMonitor";
import { shouldClosePosition } from "../src/utils/risk";
import { randomUUID } from "node:crypto";
// Refuse integration writes unless the caller explicitly provides a dedicated local test DB.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.startsWith("/actioncd_quality_") ||
  target.searchParams.has("host")
)
  throw new Error(
    "Use a dedicated localhost actioncd_quality_ database for integration tests.",
  );
const userId = `test-${randomUUID()}`;
const quote = (bid = 600000000, ask = 600000000, time = Date.now()) =>
  PriceStorageMp.set("BTC", { bid, ask, time });
const open = () =>
  mutateAccount(userId, randomUUID(), {
    kind: "open",
    asset: "BTC",
    type: "buy",
    margin: 100,
    leverage: 10,
  }) as Promise<any>;
beforeAll(async () => {
  await prisma.user.create({
    data: {
      userId,
      email: `${userId}@example.test`,
      password: "",
      balanceCents: 1000000,
    },
  });
  quote();
});
afterAll(async () => {
  await prisma.activeOrder.deleteMany({ where: { userId } });
  await prisma.closedOrder.deleteMany({ where: { userId } });
  await prisma.accountEvent.deleteMany({ where: { userId } });
  await prisma.mutationReceipt.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { userId } });
  await prisma.$disconnect();
});
describe("database account integrity", () => {
  test("retry receipts do not duplicate openings or collateral reservations", async () => {
    const key = randomUUID();
    const cmd = {
      kind: "open" as const,
      asset: "BTC" as const,
      type: "buy" as const,
      margin: 100,
      leverage: 10,
    };
    const [a, b] = (await Promise.all([
      mutateAccount(userId, key, cmd),
      mutateAccount(userId, key, cmd),
    ])) as any[];
    expect(a.eventId).toBe(b.eventId);
    expect(await prisma.activeOrder.count({ where: { userId } })).toBe(1);
    expect((await accountSummary(userId)).equityCents).toBe(999950);
  });
  test("added collateral preserves exposure and partial exits conserve cents", async () => {
    const order = await prisma.activeOrder.findFirstOrThrow({
      where: { userId },
    });
    const before = order.notionalCents;
    await mutateAccount(userId, randomUUID(), {
      kind: "add_margin",
      orderId: order.orderId,
      additionalMargin: 50,
    });
    let current = await prisma.activeOrder.findUniqueOrThrow({
      where: { orderId: order.orderId },
    });
    expect(current.notionalCents).toBe(before);
    expect(current.margin).toBe(15000);
    expect(current.liquidationPrice).toBe(510000000);
    quote(630000000, 630000000);
    const s = await accountSummary(userId);
    expect(s.openPnlCents).toBe(5000);
    await mutateAccount(userId, randomUUID(), {
      kind: "partial_close",
      orderId: order.orderId,
      percentage: 33,
    });
    current = await prisma.activeOrder.findUniqueOrThrow({
      where: { orderId: order.orderId },
    });
    expect(current.notionalCents).toBe(67000);
    expect(current.margin).toBe(10050);
    const closed = await prisma.closedOrder.findFirstOrThrow({
      where: { userId },
    });
    expect(current.notionalCents + closed.notionalCents).toBe(before);
    expect(current.entryFeeCents + closed.entryFeeCents).toBe(75);
  });
  test("simultaneous closes credit exactly once", async () => {
    quote();
    const order = await prisma.activeOrder.findFirstOrThrow({
      where: { userId },
    });
    const results = await Promise.allSettled([
      mutateAccount(userId, randomUUID(), {
        kind: "close",
        orderId: order.orderId,
      }),
      mutateAccount(userId, randomUUID(), {
        kind: "close",
        orderId: order.orderId,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.activeOrder.count({ where: { userId } })).toBe(0);
  });
  test("concurrent openings cannot overspend durable cash", async () => {
    await prisma.user.update({
      where: { userId },
      data: { balanceCents: 15000 },
    });
    quote();
    const results = await Promise.allSettled([open(), open()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await accountSummary(userId)).availableCents).toBe(4950);
  });
  test("restoration preserves active orders, balances and protection", async () => {
    const before = await prisma.activeOrder.findFirstOrThrow({
      where: { userId },
    });
    StoreData.clear();
    orderStorageMap.clear();
    await restoreState();
    expect(
      await prisma.activeOrder.findUnique({
        where: { orderId: before.orderId },
      }),
    ).not.toBeNull();
    expect(orderStorageMap.get(userId)?.has(before.orderId)).toBe(true);
    expect(StoreData.get(userId)?.balance.usd_balance).toBe(4950);
  });
  test("stale quotes cannot execute and suppress automatic liquidation", async () => {
    const order = await prisma.activeOrder.findFirstOrThrow({
      where: { userId },
    });
    quote(500000000, 500000000, Date.now() - 60000);
    await expect(
      mutateAccount(userId, randomUUID(), {
        kind: "close",
        orderId: order.orderId,
      }),
    ).rejects.toThrow("fresh market quote");
    expect((await accountSummary(userId)).equityCents).toBeNull();
    await checkCycle();
    expect(await prisma.activeOrder.count({ where: { userId } })).toBe(1);
    quote(500000000, 500000000);
    await checkCycle();
    expect(await prisma.activeOrder.count({ where: { userId } })).toBe(0);
    expect((await accountSummary(userId)).availableCents).toBe(4950);
  });
  test("short trailing protection ratchets and records the automatic exit", async () => {
    quote(1000000, 1000000);
    const opened = (await mutateAccount(userId, randomUUID(), {
      kind: "open",
      asset: "BTC",
      type: "sell",
      margin: 10,
      leverage: 5,
      trailingStopLoss: { enabled: true, trailingDistance: 5 },
    })) as any;
    expect(opened.order.stopLoss).toBe(1050000);
    quote(900000, 900000);
    await checkCycle();
    const position = await prisma.activeOrder.findUniqueOrThrow({
      where: { orderId: opened.order.orderId },
    });
    expect(position.stopLoss).toBe(950000);
    quote(960000, 960000);
    await checkCycle();
    expect(
      await prisma.activeOrder.findUnique({
        where: { orderId: position.orderId },
      }),
    ).toBeNull();
    const exit = await prisma.closedOrder.findFirstOrThrow({
      where: { positionId: position.orderId },
    });
    expect(exit.closeReason).toBe("stop_loss");
    expect(exit.pnl).toBe(200);
    expect(exit.netPnlCents).toBe(190);
    expect(
      await prisma.accountEvent.count({
        where: { userId, positionId: position.orderId },
      }),
    ).toBe(3);
  });
  test("protection revalidation prevents a superseded automatic close", async () => {
    quote();
    const opened = (await mutateAccount(userId, randomUUID(), {
      kind: "open",
      asset: "BTC",
      type: "buy",
      margin: 10,
      leverage: 10,
    })) as any;
    await mutateAccount(userId, randomUUID(), {
      kind: "add_margin",
      orderId: opened.order.orderId,
      additionalMargin: 10,
    });
    await expect(
      mutateAccount(userId, randomUUID(), {
        kind: "close",
        orderId: opened.order.orderId,
        reason: "liquidation",
      }),
    ).rejects.toThrow("no longer applies");
    await mutateAccount(userId, randomUUID(), {
      kind: "close",
      orderId: opened.order.orderId,
    });
  });
  test("reusing a receipt key with different input is rejected", async () => {
    quote();
    const key = randomUUID();
    const command = {
      kind: "open" as const,
      asset: "BTC" as const,
      type: "buy" as const,
      margin: 10,
      leverage: 1,
    };
    const result = (await mutateAccount(userId, key, command)) as any;
    await expect(
      mutateAccount(userId, key, { ...command, margin: 20 }),
    ).rejects.toThrow("different action");
    await mutateAccount(userId, randomUUID(), {
      kind: "close",
      orderId: result.order.orderId,
    });
    const replay = (await mutateAccount(userId, key, command)) as any;
    expect(replay.eventId).toBe(result.eventId);
    expect(
      await prisma.activeOrder.findUnique({
        where: { orderId: result.order.orderId },
      }),
    ).toBeNull();
  });
  test("TP, SL, and liquidation retain trigger priority", () => {
    const p = {
      type: "buy",
      liquidationPrice: 90,
      stopLoss: 95,
      takeProfit: 110,
    };
    expect(shouldClosePosition(p, 89)?.reason).toBe("liquidation");
    expect(shouldClosePosition(p, 94)?.reason).toBe("stop_loss");
    expect(shouldClosePosition(p, 111)?.reason).toBe("take_profit");
  });
});

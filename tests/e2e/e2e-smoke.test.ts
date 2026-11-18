import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../../packages/database/src/index";
import { generateToken } from "../../apps/Backend/src/utils/jwt";
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

describe("End-to-End Workflow & Integration Smoke Tests", () => {
  const userId = `e2e-${randomUUID()}`;
  let token: string;

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        userId,
        email: `${userId}@e2e.test`,
        password: "hashed-password",
        balanceCents: 500000, // $5,000.00
      },
    });

    token = await generateToken(userId);

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
    await prisma.authSession.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { userId } });
  });

  test("Full Trader Journey: balance inquiry -> open position -> price movement -> close position -> verify trade history", async () => {
    // 1. Balance Inquiry
    const user = await prisma.user.findUniqueOrThrow({ where: { userId } });
    expect(user.balanceCents).toBe(500000);

    // 2. Open Long Trade ($100 margin, 10x leverage)
    const openKey = randomUUID();
    const { mutateAccount } = await import("../../apps/Backend/src/services/accountService");

    const openResult = (await mutateAccount(userId, openKey, {
      kind: "open",
      asset: "BTC",
      type: "buy",
      margin: 100,
      leverage: 10,
    })) as any;

    expect(openResult.positionId).toBeDefined();
    expect(openResult.feeCents).toBe(50); // $0.50 entry fee
    expect(openResult.availableCents).toBe(500000 - 10000 - 50); // $4,899.50

    // 3. Verify Active Position Created
    const activeOrder = await prisma.activeOrder.findUniqueOrThrow({
      where: { orderId: openResult.positionId },
    });
    expect(activeOrder.notionalCents).toBe(100000); // $1,000.00 notional
    expect(activeOrder.liquidationPrice).toBe(540000000); // $54,000.00

    // 4. Simulate Price Increase: BTC rises to $66,000 (+10%)
    PriceStorageMp.set("BTC", {
      bid: 660000000,
      ask: 660000000,
      time: Date.now(),
    });

    // 5. Close Position
    const closeKey = randomUUID();
    const closeResult = (await mutateAccount(userId, closeKey, {
      kind: "close",
      orderId: activeOrder.orderId,
    })) as any;

    expect(closeResult.pnlCents).toBe(10000); // +$100.00 PnL
    expect(closeResult.feeCents).toBe(50); // $0.50 exit fee
    expect(closeResult.netPnlCents).toBe(10000 - 50 - 50); // +$99.00 net

    // 6. Verify Position Transition to ClosedOrder
    expect(await prisma.activeOrder.count({ where: { userId } })).toBe(0);
    const closedOrders = await prisma.closedOrder.findMany({ where: { userId } });
    expect(closedOrders.length).toBe(1);
    expect(closedOrders[0].closePrice).toBe(660000000);
    expect(closedOrders[0].pnl).toBe(10000);

    // 7. Verify Final Cash Balance: $5,000 + $99 net profit = $5,099.00 (509,900 cents)
    const finalUser = await prisma.user.findUniqueOrThrow({ where: { userId } });
    expect(finalUser.balanceCents).toBe(509900);
  });
});

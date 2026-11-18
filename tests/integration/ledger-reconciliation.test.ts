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

describe("Ledger Reconciliation & Financial Auditability", () => {
  const userId = `ledger-audit-${randomUUID()}`;
  const initialCash = 500000; // $5,000.00 (500,000 cents)

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        userId,
        email: `${userId}@ledger.test`,
        password: "hashed-password",
        balanceCents: initialCash,
      },
    });

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

  test("execute multiple trading lifecycle operations and independently reconstruct ledger balance", async () => {
    // Operation 1: Open a position ($200 margin, 10x leverage)
    // Margin: 20,000 cents, Fee: 100 cents. Deduction = 20,100 cents.
    const res1 = (await mutateAccount(userId, randomUUID(), {
      kind: "open",
      asset: "BTC",
      type: "buy",
      margin: 200,
      leverage: 10,
    })) as any;
    const orderId1 = res1.positionId;

    // Operation 2: Add margin ($50 = 5,000 cents, Fee: 25 cents). Deduction = 5,025 cents.
    await mutateAccount(userId, randomUUID(), {
      kind: "add_margin",
      orderId: orderId1,
      additionalMargin: 50,
    });

    // Operation 3: Open second position ($100 margin, 5x leverage)
    // Margin: 10,000 cents, Fee: 50 cents. Deduction = 10,050 cents.
    const res2 = (await mutateAccount(userId, randomUUID(), {
      kind: "open",
      asset: "BTC",
      type: "sell",
      margin: 100,
      leverage: 5,
    })) as any;
    const orderId2 = res2.positionId;

    // Move market quote up to $63,000 (+5%)
    PriceStorageMp.set("BTC", {
      bid: 630000000,
      ask: 630000000,
      time: Date.now(),
    });

    // Operation 4: Partial close 50% of Order 1
    await mutateAccount(userId, randomUUID(), {
      kind: "partial_close",
      orderId: orderId1,
      percentage: 50,
    });

    // Operation 5: Full close of Order 2 (Short closed at a loss)
    await mutateAccount(userId, randomUUID(), {
      kind: "close",
      orderId: orderId2,
    });

    // --- INDEPENDENT LEDGER RECONSTRUCTION ---
    // Fetch all AccountEvents in chronological version order
    const events = await prisma.accountEvent.findMany({
      where: { userId },
      orderBy: { version: "asc" },
    });

    expect(events.length).toBe(5);

    // Track simulated ledger balance step-by-step
    let reconstructedBalance = initialCash;
    let expectedVersion = 0;

    for (const event of events) {
      expectedVersion++;
      expect(event.version).toBe(expectedVersion);
      const payload = event.payload as any;

      // Verify balanceBefore matches current reconstructed balance
      expect(payload.balanceBeforeCents).toBe(reconstructedBalance);
      reconstructedBalance = payload.balanceAfterCents;
    }

    // Now verify against the actual User record in database
    const user = await prisma.user.findUniqueOrThrow({ where: { userId } });
    expect(user.balanceCents).toBe(reconstructedBalance);
    expect(user.version).toBe(5);

    // Verify Active Orders and Reserved Collateral
    const activeOrders = await prisma.activeOrder.findMany({ where: { userId } });
    expect(activeOrders.length).toBe(1); // Order 1 remaining half

    const summary = await accountSummary(userId);
    expect(summary.availableCents).toBe(user.balanceCents);
    expect(summary.reservedCents).toBe(activeOrders[0].margin);
    expect(summary.equityCents).toBe(summary.availableCents + summary.reservedCents + (summary.openPnlCents ?? 0));
  });
});

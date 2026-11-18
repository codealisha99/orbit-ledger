import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../../packages/database/src/index";
import { mutateAccount, DomainError } from "../../apps/Backend/src/services/accountService";
import { PriceStorageMp } from "../../apps/Backend/src/data/store";
import { checkCycle, riskHealth } from "../../apps/Backend/src/services/positionMonitor";
import { randomUUID } from "node:crypto";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.startsWith("/actioncd_quality_") ||
  target.searchParams.has("host")
) {
  throw new Error("Use a dedicated localhost actioncd_quality_ database for tests.");
}

describe("Fault Injection and Recovery Testing", () => {
  const userId = `fault-${randomUUID()}`;

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        userId,
        email: `${userId}@fault.test`,
        password: "hashed-password",
        balanceCents: 500000, // $5,000.00
      },
    });
  });

  afterAll(async () => {
    await prisma.activeOrder.deleteMany({ where: { userId } });
    await prisma.closedOrder.deleteMany({ where: { userId } });
    await prisma.accountEvent.deleteMany({ where: { userId } });
    await prisma.mutationReceipt.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { userId } });
  });

  test("Fault 1: Stale price feed (>30s old) blocks order execution with 503 QUOTE_UNAVAILABLE", async () => {
    // Inject stale quote: 35 seconds old
    PriceStorageMp.set("BTC", {
      bid: 600000000,
      ask: 600000000,
      time: Date.now() - 35000,
    });

    try {
      await mutateAccount(userId, randomUUID(), {
        kind: "open",
        asset: "BTC",
        type: "buy",
        margin: 100,
        leverage: 10,
      });
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).status).toBe(503);
      expect((error as DomainError).code).toBe("QUOTE_UNAVAILABLE");
    }
  });

  test("Fault 2: Stale price feed suppresses automated risk monitor liquidations", async () => {
    // First, set fresh quote to open a legitimate position
    PriceStorageMp.set("BTC", {
      bid: 600000000,
      ask: 600000000,
      time: Date.now(),
    });

    const res = (await mutateAccount(userId, randomUUID(), {
      kind: "open",
      asset: "BTC",
      type: "buy",
      margin: 100,
      leverage: 10, // Liquidation price: $54,000.00 (540,000,000 scaled)
    })) as any;

    expect(await prisma.activeOrder.count({ where: { userId } })).toBe(1);

    // Inject stale quote that has breached liquidation price ($50,000, but 60s old!)
    PriceStorageMp.set("BTC", {
      bid: 500000000,
      ask: 500000000,
      time: Date.now() - 60000, // Stale!
    });

    // Run risk cycle
    await checkCycle();

    // Verify order was NOT closed because the quote was stale!
    const order = await prisma.activeOrder.findUnique({ where: { orderId: res.positionId } });
    expect(order).not.toBeNull();
    expect(await prisma.closedOrder.count({ where: { userId } })).toBe(0);
  });

  test("Fault 3: Reusing an idempotency key with altered payload returns 409 KEY_REUSED", async () => {
    PriceStorageMp.set("BTC", { bid: 600000000, ask: 600000000, time: Date.now() });
    const key = randomUUID();

    // First request
    await mutateAccount(userId, key, {
      kind: "open",
      asset: "BTC",
      type: "buy",
      margin: 100,
      leverage: 5,
    });

    // Second request with SAME key but modified margin ($200)
    try {
      await mutateAccount(userId, key, {
        kind: "open",
        asset: "BTC",
        type: "buy",
        margin: 200,
        leverage: 5,
      });
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).status).toBe(409);
      expect((error as DomainError).code).toBe("KEY_REUSED");
    }
  });

  test("Fault 4: Closing an already closed order returns 409 POSITION_CHANGED", async () => {
    PriceStorageMp.set("BTC", { bid: 600000000, ask: 600000000, time: Date.now() });

    try {
      await mutateAccount(userId, randomUUID(), {
        kind: "close",
        orderId: "non-existent-order-id",
      });
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).status).toBe(409);
      expect((error as DomainError).code).toBe("POSITION_CHANGED");
    }
  });
});

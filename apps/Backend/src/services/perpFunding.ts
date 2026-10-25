import { randomUUID } from "node:crypto";
import { prisma } from "@orbitledger/database";
import { isFreshQuote, liquidationPrice } from "@orbitledger/shared";
import { PriceStorageMp } from "../data/store";

// Educational simulation: longs pay 1 bp every 8 hours; shorts receive it.
// This is a fixed, disclosed rate, not an exchange funding-rate feed.
export const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;
export const SIMULATED_FUNDING_RATE_BPS = 1;

export async function applyDueFunding(now = Date.now()) {
  const due = await prisma.activeOrder.findMany({
    where: { lastFundingAt: { lte: new Date(now - FUNDING_INTERVAL_MS) } },
  });
  for (const candidate of due) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.userId}))`;
      const order = await tx.activeOrder.findUnique({
        where: { orderId: candidate.orderId },
      });
      if (!order || order.lastFundingAt.getTime() > now - FUNDING_INTERVAL_MS)
        return;
      const quote = PriceStorageMp.get(order.asset as "BTC" | "ETH" | "SOL");
      if (order.needsReview || !isFreshQuote(quote, now)) return;
      const periods = Math.floor(
        (now - order.lastFundingAt.getTime()) / FUNDING_INTERVAL_MS,
      );
      const markPrice = Math.round((quote.bid + quote.ask) / 2);
      const rawAmount =
        Math.round(
          (order.notionalCents * SIMULATED_FUNDING_RATE_BPS * periods) / 10000,
        ) * (order.type === "buy" ? 1 : -1);
      const amountCents =
        rawAmount > 0 ? Math.min(rawAmount, order.margin) : rawAmount;
      const margin = order.margin - amountCents;
      const accrued = order.fundingAccruedCents + amountCents;
      const user = await tx.user.update({
        where: { userId: order.userId },
        data: { version: { increment: 1 } },
      });
      await tx.activeOrder.update({
        where: { orderId: order.orderId },
        data: {
          margin,
          fundingAccruedCents: accrued,
          liquidationPrice: liquidationPrice(
            order.openPrice,
            margin,
            order.notionalCents,
            order.type as "buy" | "sell",
          ),
          lastFundingAt: new Date(
            order.lastFundingAt.getTime() + periods * FUNDING_INTERVAL_MS,
          ),
        },
      });
      await tx.perpFundingPayment.create({
        data: {
          id: randomUUID(),
          userId: order.userId,
          positionId: order.orderId,
          asset: order.asset,
          side: order.type,
          notionalCents: order.notionalCents,
          rateBps: SIMULATED_FUNDING_RATE_BPS,
          amountCents,
          markPrice,
          appliedAt: new Date(now),
        },
      });
      await tx.accountEvent.create({
        data: {
          userId: order.userId,
          version: user.version,
          kind: "funding",
          positionId: order.orderId,
          payload: {
            amountCents,
            rateBps: SIMULATED_FUNDING_RATE_BPS,
            periods,
            markPrice,
          },
        },
      });
    });
  }
}

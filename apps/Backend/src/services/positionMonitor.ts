import { shouldClosePosition } from "../utils/risk";
export { shouldClosePosition } from "../utils/risk";
import { prisma } from "@orbitledger/database";
import { executableQuote, mutateAccount } from "./accountService";
import { type Side } from "@orbitledger/shared";
import { randomUUID } from "node:crypto";

export const riskHealth = {
  lastCompletedAt: 0,
  checked: 0,
  closed: 0,
  skipped: 0,
  errors: 0,
};
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;
export async function checkCycle() {
  const metrics = { checked: 0, closed: 0, skipped: 0, errors: 0 };
  try {
    const orders = await prisma.activeOrder.findMany();
    for (const order of orders) {
      metrics.checked++;
      try {
        const quote = executableQuote(order.asset);
        const price = order.type === "buy" ? quote.bid : quote.ask;
        const decision = shouldClosePosition(order, price);
        if (decision) {
          await mutateAccount(
            order.userId,
            `risk:${order.orderId}:${randomUUID()}`,
            { kind: "close", orderId: order.orderId, reason: decision.reason },
          );
          metrics.closed++;
        } else if (order.trailingStopLossEnabled) {
          await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${order.userId}))`;
            const current = await tx.activeOrder.findUnique({
              where: { orderId: order.orderId },
            });
            if (!current || !current.trailingStopLossDistance) return;
            const q = executableQuote(current.asset);
            const long = current.type === "buy";
            const mark = long ? q.bid : q.ask;
            const peak = long
              ? Math.max(current.trailingStopLossHighestPrice ?? mark, mark)
              : Math.min(current.trailingStopLossLowestPrice ?? mark, mark);
            const stop = long
              ? Math.max(
                  current.stopLoss ?? 0,
                  peak - current.trailingStopLossDistance,
                )
              : Math.min(
                  current.stopLoss ?? Number.MAX_SAFE_INTEGER,
                  peak + current.trailingStopLossDistance,
                );
            if (stop === current.stopLoss) return;
            await tx.activeOrder.update({
              where: { orderId: current.orderId },
              data: {
                stopLoss: stop,
                ...(long
                  ? { trailingStopLossHighestPrice: peak }
                  : { trailingStopLossLowestPrice: peak }),
              },
            });
            const user = await tx.user.update({
              where: { userId: order.userId },
              data: { version: { increment: 1 } },
            });
            await tx.accountEvent.create({
              data: {
                userId: order.userId,
                version: user.version,
                kind: "trailing_stop",
                positionId: order.orderId,
                payload: { stopLoss: stop },
              },
            });
          });
        }
      } catch (error) {
        metrics.skipped++;
        console.error(
          "[RISK] Position skipped",
          order.orderId,
          error instanceof Error ? error.message : error,
        );
      }
    }
  } catch (error) {
    metrics.errors++;
    console.error("[RISK] Cycle failed", error);
  } finally {
    Object.assign(riskHealth, metrics, { lastCompletedAt: Date.now() });
    if (running) timer = setTimeout(checkCycle, 5000);
  }
}
export function startPositionMonitor() {
  if (!running) {
    running = true;
    void checkCycle();
  }
}
export function stopPositionMonitor() {
  running = false;
  if (timer) clearTimeout(timer);
}

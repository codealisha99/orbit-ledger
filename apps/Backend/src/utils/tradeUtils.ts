import {getUserOrders,getUserCloseOrders, findUSerId,UserBalance,} from "../data/store";
import { reasonForClose, ClosedOrder, FEE_PERCENTAGE } from "../types";
import { calculatePnLCents } from "./PnL";
import { broadcastOrderClose } from "../services/orderBroadcast";
import { prisma } from "@orbitledger/database";
import { onOrderClosed } from "../services/platformProfit";


export  async function closeOrder(userId: string,orderId: string,closePrice: number,closeReason: reasonForClose): Promise<number> {
  const userOrders = getUserOrders(userId); // Getting all the user orders
  const order = userOrders.get(orderId);

  if (!order) {
    throw new Error(`Order ${orderId} not found for user ${userId}`);
  }

  console.log(`[CLOSE DEBUG] OrderId: ${orderId}, Open: ${order.openPrice}, Close: ${closePrice}, Margin: ${order.margin}, Lev: ${order.leverage}, Type: ${order.type}`);

  const pnl = calculatePnLCents(
    order.openPrice,
    closePrice,
    order.margin,
    order.leverage,
    order.type
  );

  const closeFee = Math.floor(order.margin * FEE_PERCENTAGE);

  const user = findUSerId(userId);
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  let newBalance = user.balance.usd_balance + order.margin + pnl - closeFee;

  if (newBalance < 0) {
    console.error(`[CLOSE] WARNING: Negative balance detected for user ${userId}: ${newBalance} cents`);
    console.error(`[CLOSE] Details: margin=${order.margin}, pnl=${pnl}, fee=${closeFee}, oldBalance=${user.balance.usd_balance}`);
    newBalance = 0; // Cap at zero to prevent database corruption
  }

  const closedOrder: ClosedOrder = {
    ...order,
    closePrice: closePrice,
    closeTimestamp: Date.now(),
    pnl: pnl,
    closeReason: closeReason,
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.closedOrder.create({
        data: {
          orderId: order.orderId,
          userId: order.userId,
          asset: order.asset,
          type: order.type,
          margin: order.margin,
          initialMargin: order.initialMargin,
          addedMargin: order.addedMargin,
          leverage: order.leverage,
          openPrice: order.openPrice,
          closePrice: closePrice,
          liquidationPrice: order.liquidationPrice,
          takeProfit: order.takeProfit,
          stopLoss: order.stopLoss,
          pnl: pnl,
          closeReason: closeReason.toUpperCase(),
          closeMessage: null,
          openedAt: new Date(order.openTimestamp),
          closedAt: new Date(),
          trailingStopLossEnabled: order.trailingStopLoss?.enabled || false,
          trailingStopLossDistance: order.trailingStopLoss?.trailingDistance || null,
          trailingStopLossHighestPrice: order.trailingStopLoss?.highestPrice || null,
          trailingStopLossLowestPrice: order.trailingStopLoss?.lowestPrice || null,
        }
      });

      await tx.user.update({
        where: { userId: userId },
        data: { balanceCents: newBalance }
      });

      await tx.activeOrder.delete({
        where: { orderId: orderId }
      });
    });

    const userClosedOrders = getUserCloseOrders(userId);
    userClosedOrders.set(orderId, closedOrder);
    userOrders.delete(orderId);
    UserBalance(userId, newBalance);

  } catch (error) {
    console.error("[CLOSE] Transaction failed:", error);
    throw new Error("Failed to close order. Database transaction failed.");
  }

  try {
    await broadcastOrderClose(closedOrder, closeReason);
  } catch (err) {
    console.error("Failed to broadcast order close, but order closed successfully:", err);
  }

  try {
    onOrderClosed(order);
  } catch (err) {
    console.error("Failed to update platform profit, but order closed successfully:", err);
  }

  console.log(
    `[CLOSE ORDER] User: ${userId} | Order: ${orderId} | Margin: $${(order.margin / 100).toFixed(2)} | PnL: $${(pnl / 100).toFixed(2)} | Fee: $${(closeFee / 100).toFixed(2)} (0.5%) | Reason: ${closeReason}`
  );

  return pnl
}

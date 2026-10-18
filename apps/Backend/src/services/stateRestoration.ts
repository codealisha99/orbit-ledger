import { prisma } from "@orbitledger/database";
import { StoreData, orderStorageMap, emailToUserId } from "../data/store";
import type { Asset } from "@orbitledger/shared";

export async function restoreState() {
  try {
    console.log("[RESTORE] Starting state restoration from database...");
    const startTime = Date.now();

    // Restoration is read-only. Legacy data repair belongs in an audited migration.

    const users = await prisma.user.findMany();

    users.forEach((user) => {
      StoreData.set(user.userId, {
        userId: user.userId,
        email: user.email,
        password: user.password || "", // Handle OAuth users with empty password
        balance: { usd_balance: user.balanceCents },
        assets: {} as Record<Asset, number>,
      });
      emailToUserId.set(user.email, user.userId);
    });

    console.log(`[RESTORE] Loaded ${users.length} users into memory`);

    const activeOrders = await prisma.activeOrder.findMany();

    activeOrders.forEach((order: any) => {
      let userOrders = orderStorageMap.get(order.userId);
      if (!userOrders) {
        userOrders = new Map();
        orderStorageMap.set(order.userId, userOrders);
      }

      userOrders.set(order.orderId, {
        orderId: order.orderId,
        userId: order.userId,
        asset: order.asset as Asset,
        type: order.type as "buy" | "sell",
        margin: order.margin,
        notionalCents: order.notionalCents,
        initialMargin: order.initialMargin,
        addedMargin: order.addedMargin,
        leverage: order.leverage as 1 | 5 | 10 | 20 | 100,
        openPrice: order.openPrice,
        liquidationPrice: order.liquidationPrice,
        takeProfit: order.takeProfit || undefined,
        stopLoss: order.stopLoss || undefined,
        openTimestamp: order.openedAt.getTime(),
        trailingStopLoss: order.trailingStopLossEnabled
          ? {
              enabled: true,
              trailingDistance: order.trailingStopLossDistance || 0,
              highestPrice: order.trailingStopLossHighestPrice || undefined,
              lowestPrice: order.trailingStopLossLowestPrice || undefined,
            }
          : undefined,
      });
    });

    console.log(
      `[RESTORE]  State restored: ${users.length} users, ${activeOrders.length} active orders in ${Date.now() - startTime}ms`,
    );
  } catch (error) {
    console.error("[RESTORE]  Error restoring state:", error);
    throw error;
  }
}

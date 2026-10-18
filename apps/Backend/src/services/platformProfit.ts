import { prisma } from "@orbitledger/database";
import { getUserOrders } from "../data/store";
import { Order } from "../types";

let cachedPlatformProfit = {
  totalProfit: 0, // In cents
  openTrades: 0,
  closedTrades: 0,
  totalTrades: 0,
  lastUpdated: Date.now(),
};

async function savePlatformProfitToDb() {
  try {
    await prisma.platformProfit.upsert({
      where: { id: 1 },
      update: {
        totalProfit: cachedPlatformProfit.totalProfit,
        openTrades: cachedPlatformProfit.openTrades,
        closedTrades: cachedPlatformProfit.closedTrades,
        totalTrades: cachedPlatformProfit.totalTrades,
      },
      create: {
        id: 1,
        totalProfit: cachedPlatformProfit.totalProfit,
        openTrades: cachedPlatformProfit.openTrades,
        closedTrades: cachedPlatformProfit.closedTrades,
        totalTrades: cachedPlatformProfit.totalTrades,
      },
    });
  } catch (error) {
    console.error("[PLATFORM_PROFIT] Error saving to database:", error);
  }
}

export async function initPlatformProfit() {
  try {
    console.log("[PLATFORM_PROFIT] Initializing platform profit cache...");
    const startTime = Date.now();

    const dbRecord = await prisma.platformProfit.findUnique({
      where: { id: 1 },
    });

    if (dbRecord) {
      cachedPlatformProfit = {
        totalProfit: dbRecord.totalProfit,
        openTrades: dbRecord.openTrades,
        closedTrades: dbRecord.closedTrades,
        totalTrades: dbRecord.totalTrades,
        lastUpdated: Date.now(),
      };

      const duration = Date.now() - startTime;
      console.log(
        `[PLATFORM_PROFIT] Loaded from database: $${(cachedPlatformProfit.totalProfit / 100).toFixed(2)} (${cachedPlatformProfit.totalTrades} trades) in ${duration}ms`
      );
    } else {
      console.log("[PLATFORM_PROFIT] No database record found, calculating from scratch...");

      const closedOrderCount = await prisma.closedOrder.count();

      const closedOrders = await prisma.closedOrder.findMany({
        select: {
          initialMargin: true,
          addedMargin: true,
        },
      });

      let closedProfit = 0;
      closedOrders.forEach((order) => {
        const totalMarginThroughPosition = order.initialMargin + order.addedMargin;
        const totalFee = Math.floor(totalMarginThroughPosition * 0.01); // 1% of total margin
        closedProfit += totalFee;
      });

      const allOpenOrders = getUserOrders("all");
      let openProfit = 0;
      let openTradeCount = 0;

      allOpenOrders.forEach((order) => {
        const totalMarginEntered = order.initialMargin + order.addedMargin;
        const entryFee = Math.floor(totalMarginEntered * 0.005); // 0.5% on entry
        openProfit += entryFee;
        openTradeCount++;
      });

      cachedPlatformProfit = {
        totalProfit: closedProfit + openProfit,
        openTrades: openTradeCount,
        closedTrades: closedOrderCount,
        totalTrades: openTradeCount + closedOrderCount,
        lastUpdated: Date.now(),
      };

      await savePlatformProfitToDb();

      const duration = Date.now() - startTime;
      console.log(
        `[PLATFORM_PROFIT] Initialized from scratch: $${(cachedPlatformProfit.totalProfit / 100).toFixed(2)} (${cachedPlatformProfit.totalTrades} trades) in ${duration}ms`
      );
    }
  } catch (error) {
    console.error("[PLATFORM_PROFIT] Error initializing:", error);
    throw error;
  }
}

export function onOrderOpened(order: Order) {
  const fee = Math.floor(order.initialMargin * 0.005); // 0.5% of initial margin

  cachedPlatformProfit.totalProfit += fee;
  cachedPlatformProfit.openTrades++;
  cachedPlatformProfit.totalTrades++;
  cachedPlatformProfit.lastUpdated = Date.now();

  console.log(
    `[PLATFORM_PROFIT] Order opened: +$${(fee / 100).toFixed(2)} (0.5% of $${(order.initialMargin / 100).toFixed(2)}) | Total: $${(cachedPlatformProfit.totalProfit / 100).toFixed(2)}`
  );

  savePlatformProfitToDb();
}

export function onOrderClosed(order: Order) {
  const fee = Math.floor(order.margin * 0.005); // 0.5% of remaining margin at close

  cachedPlatformProfit.totalProfit += fee;
  cachedPlatformProfit.openTrades--;
  cachedPlatformProfit.closedTrades++;
  cachedPlatformProfit.lastUpdated = Date.now();

  console.log(
    `[PLATFORM_PROFIT] Order closed: +$${(fee / 100).toFixed(2)} (0.5% of $${(order.margin / 100).toFixed(2)}) | Total: $${(cachedPlatformProfit.totalProfit / 100).toFixed(2)}`
  );

  savePlatformProfitToDb();
}

export function onOrderPartialClose(marginClosedInCents: number) {
  const fee = Math.floor(marginClosedInCents * 0.005); // 0.5% of closed amount

  cachedPlatformProfit.totalProfit += fee;
  cachedPlatformProfit.lastUpdated = Date.now();

  console.log(
    `[PLATFORM_PROFIT] Partial close: +$${(fee / 100).toFixed(2)} (0.5% of $${(marginClosedInCents / 100).toFixed(2)}) | Total: $${(cachedPlatformProfit.totalProfit / 100).toFixed(2)}`
  );

  savePlatformProfitToDb();
}

export function onMarginAdded(additionalMarginInCents: number) {
  const fee = Math.floor(additionalMarginInCents * 0.005); // 0.5% of added margin

  cachedPlatformProfit.totalProfit += fee;
  cachedPlatformProfit.lastUpdated = Date.now();

  console.log(
    `[PLATFORM_PROFIT] Margin added: +$${(fee / 100).toFixed(2)} (0.5% of $${(additionalMarginInCents / 100).toFixed(2)}) | Total: $${(cachedPlatformProfit.totalProfit / 100).toFixed(2)}`
  );

  savePlatformProfitToDb();
}

export function getPlatformProfit() {
  return {
    ...cachedPlatformProfit,
    profitInCents: cachedPlatformProfit.totalProfit,
  };
}

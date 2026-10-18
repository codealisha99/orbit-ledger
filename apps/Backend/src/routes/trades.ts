import { Router } from "express";
import { Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { tradeOpenRateLimit, tradeCloseRateLimit, apiRateLimit } from "../middleware/rateLimit";
import { openTradeSchema, FEE_PERCENTAGE } from "../types";
import { findUSerId } from "../data/store";
import { toInternalUSD, fromInternalUSD, fromInternalPrice, toInternalPrice } from "@orbitledger/shared";
import { PriceStorageMp } from "../data/store";
import { calculateLiquidation } from "../utils/PnL";
import { randomUUID } from "crypto";
import { Order } from "../types";
import { getUserOrders, getUserCloseOrders, UserBalance } from "../data/store";
import { closeOrder } from "../utils/tradeUtils";
import {
  broadcastOrderClose,
  broadcastOrderOpened,
} from "../services/orderBroadcast";
import { prisma } from "@orbitledger/database";
import {
  onOrderOpened,
  onOrderPartialClose,
  onMarginAdded,
  getPlatformProfit,
} from "../services/platformProfit";

export const tradeRoutes = Router();

tradeRoutes.post(
  "/open",
  tradeOpenRateLimit,
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const validation = openTradeSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        error: "Invalid Input",
        details: validation.error.issues,
      });
      return; //  Stop execution
    }

    const { asset, type, margin, leverage } = validation.data;

    const userId = req.userId;
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const user = findUSerId(userId);
      if (!user) {
        console.log(`[BALANCE] User not found: ${userId}`);
        res.status(404).json({ error: "User not found" });
        return;
      }
      const UserBalanceInCents = user.balance.usd_balance; //user balance is already in cents
      const marginInCents = toInternalUSD(margin);
      const openFee = Math.floor(marginInCents * FEE_PERCENTAGE);
      const totalCost = marginInCents + openFee;

      if (UserBalanceInCents < totalCost) {
        res.status(400).json({ error: "Insufficient balance (need margin + 0.5% fee)" });
        return; // Stop here, don't create the trade
      }
      const priceData = PriceStorageMp.get(asset);
      if (!priceData || priceData.ask === 0 || priceData.bid === 0) {
        res.status(503).json({
          error:
            "The Asset Price is not proplly updating still zero or Undefined",
        });
        return; // Stop here, don't create the trade
      }
      const entryPrice = type === "buy" ? priceData.ask : priceData.bid;
      const liquidationPrice = calculateLiquidation(entryPrice, leverage, type);
      if (req.body.takeProfit) {
        const takeProfitInScale = toInternalPrice(req.body.takeProfit);

        if (type === "buy") {
          if (takeProfitInScale <= entryPrice) {
            res.status(400).json({
              error: `Invalid Take Profit for BUY order. Take Profit ($${req.body.takeProfit}) must be higher than entry price ($${fromInternalPrice(entryPrice).toFixed(2)}) to make profit.`
            });
            return;
          }
        } else {
          if (takeProfitInScale >= entryPrice) {
            res.status(400).json({
              error: `Invalid Take Profit for SELL order. Take Profit ($${req.body.takeProfit}) must be lower than entry price ($${fromInternalPrice(entryPrice).toFixed(2)}) to make profit.`
            });
            return;
          }
        }
      }

      if (req.body.stopLoss) {
        const stopLossInScale = toInternalPrice(req.body.stopLoss);

        if (type === "buy") {
          if (stopLossInScale >= entryPrice) {
            res.status(400).json({
              error: `Invalid Stop Loss for BUY order. Stop Loss ($${req.body.stopLoss}) must be lower than entry price ($${fromInternalPrice(entryPrice).toFixed(2)}) to limit losses.`
            });
            return;
          }
        } else {
          if (stopLossInScale <= entryPrice) {
            res.status(400).json({
              error: `Invalid Stop Loss for SELL order. Stop Loss ($${req.body.stopLoss}) must be higher than entry price ($${fromInternalPrice(entryPrice).toFixed(2)}) to limit losses.`
            });
            return;
          }
        }
      }

      const orderId = randomUUID();

      let trailingStopLoss: Order["trailingStopLoss"] = undefined;
      if (req.body.trailingStopLoss?.enabled) {
        const tslDistance = req.body.trailingStopLoss.trailingDistance;
        
        if (!tslDistance || tslDistance <= 0) {
          res.status(400).json({
            error: `Invalid Trailing Stop Loss. Distance must be greater than $0. You provided: $${tslDistance || 0}`
          });
          return;
        }
        
        const minTslDistance = 10; // $10 minimum (matches Frontend validation)
        if (tslDistance < minTslDistance) {
          res.status(400).json({
            error: `Trailing Stop Loss distance too small. Minimum: $${minTslDistance.toFixed(2)}. You provided: $${tslDistance}`
          });
          return;
        }

        const distanceToLiquidation = Math.abs(fromInternalPrice(entryPrice) - fromInternalPrice(liquidationPrice));
        if (tslDistance >= distanceToLiquidation) {
          res.status(400).json({
            error: `Trailing Stop Loss distance ($${tslDistance.toFixed(2)}) must be less than distance to liquidation ($${distanceToLiquidation.toFixed(2)}). Otherwise TSL will never trigger before liquidation.`
          });
          return;
        }

        const trailingDistanceInPriceScale = toInternalPrice(tslDistance);
        trailingStopLoss = {
          enabled: true,
          trailingDistance: trailingDistanceInPriceScale,
          highestPrice: type === "buy" ? entryPrice : undefined,
          lowestPrice: type === "sell" ? entryPrice : undefined,
        };
      }

      const orderDetails: Order = {
        orderId: orderId,
        userId: userId,
        asset: asset,
        type: type,
        margin: marginInCents,
        initialMargin: marginInCents,
        addedMargin: 0,
        leverage: leverage,
        openPrice: entryPrice,
        openTimestamp: Date.now(),
        liquidationPrice: liquidationPrice,
        takeProfit: req.body.takeProfit ? toInternalPrice(req.body.takeProfit) : undefined,
        stopLoss: req.body.stopLoss ? toInternalPrice(req.body.stopLoss) : undefined,
        trailingStopLoss: trailingStopLoss,
      };

      const newBalance = user.balance.usd_balance - totalCost;

      try {
        const actualNewBalance = await prisma.$transaction(async (tx) => {
          const freshUser = await tx.user.findUnique({ where: { userId: userId } });
          if (!freshUser || freshUser.balanceCents < totalCost) {
            throw new Error("Insufficient balance");
          }

          const transactionNewBalance = freshUser.balanceCents - totalCost;

          await tx.user.update({
            where: { userId: userId },
            data: { balanceCents: transactionNewBalance }
          });

          await tx.activeOrder.create({
            data: {
              orderId: orderDetails.orderId,
              userId: orderDetails.userId,
              asset: orderDetails.asset,
              type: orderDetails.type,
              margin: orderDetails.margin,
              initialMargin: orderDetails.initialMargin,
              addedMargin: orderDetails.addedMargin,
              leverage: orderDetails.leverage,
              openPrice: orderDetails.openPrice,
              liquidationPrice: orderDetails.liquidationPrice,
              takeProfit: orderDetails.takeProfit || null,
              stopLoss: orderDetails.stopLoss || null,
              openedAt: new Date(orderDetails.openTimestamp),
              trailingStopLossEnabled: orderDetails.trailingStopLoss?.enabled || false,
              trailingStopLossDistance: orderDetails.trailingStopLoss?.trailingDistance || null,
              trailingStopLossHighestPrice: orderDetails.trailingStopLoss?.highestPrice || null,
              trailingStopLossLowestPrice: orderDetails.trailingStopLoss?.lowestPrice || null,
            }
          });

          return transactionNewBalance;
        });

        UserBalance(userId, actualNewBalance);
        const userOrders = getUserOrders(userId);
        userOrders.set(orderId, orderDetails);

      } catch (error) {
        console.error("[OPEN] Transaction failed:", error);
        res.status(500).json({
          error: "Failed to create order. Your balance has not been changed."
        });
        return;
      }

      try {
        await broadcastOrderOpened(orderDetails);
      } catch (err) {
        console.error("Failed to broadcast order, but trade succeeded:", err);
      }

      try {
        onOrderOpened(orderDetails);
      } catch (err) {
        console.error("Failed to update platform profit, but trade succeeded:", err);
      }

      console.log(`[OPEN] User ${userId}: Deducted $${(marginInCents / 100).toFixed(2)} margin + $${(openFee / 100).toFixed(2)} fee (0.5%)`);

    res.status(201).json({
      message: "Order created successfully",
      order: orderDetails,
      fee: openFee, // Raw cents
      feePercentage: 0.5,
    });
  }
);

tradeRoutes.post(
  "/close",
  tradeCloseRateLimit,
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const { orderId } = req.body;
    if (!orderId) {
      res.status(400).json({ error: "Invalid input: No order ID present" });
      return;
    }
    const userId = req.userId;
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const userOrders = getUserOrders(userId);
    const currentOrder = userOrders.get(orderId);
    if (!currentOrder) {
      res
        .status(404)
        .json({ error: "Order not found" });
      return;
    }
    const priceData = PriceStorageMp.get(currentOrder.asset); //getting the closing price of that assert
    if (!priceData || priceData.ask === 0 || priceData.bid === 0) {
      res.status(503).json({ error: "Price data not available" });
      return;
    }
    const closePrice =
      currentOrder.type === "buy" ? priceData.bid : priceData.ask; //chossing opposte of what was choose priviouslly

    try {
      const pnl = await closeOrder(userId, orderId, closePrice, "manual");

      const pnlInDollars = pnl / 100;

      res.status(200).json({
        message: "Order closed successfully",
        orderId,
        closePrice: closePrice,
        pnl: pnlInDollars, // In USD
      });
    } catch (error) {
      console.error("Error closing order:", error);
      res.status(500).json({ error: "Failed to close order" });
    }
  }
);
tradeRoutes.get(
  "/open",
  apiRateLimit,
  authMiddleware,
  (req: Request, res: Response): void => {
    const userId = req.userId;
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const userorder = getUserOrders(userId);
    const arrayofUserorder = Array.from(userorder.values());
    const transformedOrders = arrayofUserorder.map((order) => ({
      orderId: order.orderId,
      userId: order.userId,
      asset: order.asset,
      type: order.type,
      margin: order.margin, // Raw cents
      initialMargin: order.initialMargin, // Raw cents
      addedMargin: order.addedMargin, // Raw cents
      leverage: order.leverage, // Original leverage
      effectiveLeverage: order.addedMargin > 0
        ? Number(((order.initialMargin * order.leverage) / order.margin).toFixed(2))
        : order.leverage,
      openPrice: order.openPrice, // Raw scaled price
      openTimestamp: order.openTimestamp,
      liquidationPrice: order.liquidationPrice, // Raw scaled price
      takeProfit: order.takeProfit ? order.takeProfit : null, // Raw scaled price
      stopLoss: order.stopLoss ? order.stopLoss : null, // Raw scaled price
      trailingStopLoss: order.trailingStopLoss ? {
        enabled: order.trailingStopLoss.enabled,
        trailingDistance: order.trailingStopLoss.trailingDistance,
        highestPrice: order.trailingStopLoss.highestPrice ? order.trailingStopLoss.highestPrice : null,
        lowestPrice: order.trailingStopLoss.lowestPrice ? order.trailingStopLoss.lowestPrice : null,
      } : null,
    }));
    res.status(200).json({
      orders: transformedOrders,
    });
  }
);
tradeRoutes.get(
  "/history",
  apiRateLimit,
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId;
    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    
    try {
      const closedOrders = await prisma.closedOrder.findMany({
        where: { userId: userId },
        orderBy: { closedAt: 'desc' }
      });

      const transformedOrders = closedOrders.map((order) => ({
        orderId: order.orderId,
        userId: order.userId,
        asset: order.asset,
        type: order.type,
        margin: order.margin, // Raw cents
        leverage: order.leverage,
        openPrice: order.openPrice, // Raw scaled price
        openTimestamp: order.openedAt.getTime(),
        liquidationPrice: order.liquidationPrice, // Raw scaled price
        takeProfit: order.takeProfit ? order.takeProfit : null, // Raw scaled price
        stopLoss: order.stopLoss ? order.stopLoss : null, // Raw scaled price
        closePrice: order.closePrice, // Raw scaled price
        closeTimestamp: order.closedAt.getTime(),
        pnl: order.pnl, // Raw cents
        closeReason: order.closeReason,
      }));
      
      res.status(200).json({
        orders: transformedOrders,
      });
    } catch (error) {
      console.error("Error fetching trade history:", error);
      res.status(500).json({ error: "Failed to fetch trade history" });
    }
  }
);

tradeRoutes.post(
  "/partial-close",
  tradeCloseRateLimit,
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const { orderId, percentage } = req.body;
    const userId = req.userId;

    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const validation = { orderId: orderId, percentage: percentage };
    const partialCloseSchema = await import("../types").then(m => m.partialCloseSchema);
    const result = partialCloseSchema.safeParse(validation);
    if (!result.success) {
      res.status(400).json({ error: "Invalid input", details: result.error.issues });
      return;
    }

    if (percentage >= 100) {
      res.status(400).json({ 
        error: "Cannot partially close 100% of position. Use the full close endpoint instead." 
      });
      return;
    }

    const userOrders = getUserOrders(userId);
    const order = userOrders.get(orderId);

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    if (order.userId !== userId) {
      res.status(403).json({ error: "Not authorized to close this order" });
      return;
    }

    const priceData = PriceStorageMp.get(order.asset);
    if (!priceData || priceData.ask === 0 || priceData.bid === 0) {
      res.status(503).json({ error: "Price data not available" });
      return;
    }

    const closePrice = order.type === "buy" ? priceData.bid : priceData.ask;
    const percentageDecimal = percentage / 100;

    const marginToClose = Math.floor(order.margin * percentageDecimal);
    const remainingMargin = order.margin - marginToClose;

    const { calculatePnLCents } = await import("../utils/PnL");
    const pnl = calculatePnLCents(
      order.openPrice,
      closePrice,
      marginToClose,
      order.leverage,
      order.type
    );

    const closeFee = Math.floor(marginToClose * FEE_PERCENTAGE);

    const user = findUSerId(userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const newBalance = user.balance.usd_balance + marginToClose + pnl - closeFee;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { userId: userId },
          data: { balanceCents: newBalance }
        });

        await tx.activeOrder.update({
          where: { orderId: orderId },
          data: {
            margin: remainingMargin,
          }
        });

        await tx.closedOrder.create({
          data: {
            orderId: `${orderId}_partial_${Date.now()}`, // Unique ID for partial close
            userId: order.userId,
            asset: order.asset,
            type: order.type,
            margin: marginToClose, // Amount that was closed
            initialMargin: order.initialMargin,
            addedMargin: order.addedMargin,
            leverage: order.leverage,
            openPrice: order.openPrice,
            closePrice: closePrice,
            liquidationPrice: order.liquidationPrice,
            takeProfit: order.takeProfit,
            stopLoss: order.stopLoss,
            pnl: pnl,
            closeReason: "partial_close", // Mark as partial close
            closeMessage: `Closed ${percentage}% of position (${(marginToClose / 100).toFixed(2)} USD)`,
            openedAt: new Date(order.openTimestamp),
            closedAt: new Date(),
            trailingStopLossEnabled: order.trailingStopLoss?.enabled || false,
            trailingStopLossDistance: order.trailingStopLoss?.trailingDistance || null,
            trailingStopLossHighestPrice: order.trailingStopLoss?.highestPrice || null,
            trailingStopLossLowestPrice: order.trailingStopLoss?.lowestPrice || null,
          }
        });
      });

      user.balance.usd_balance = newBalance;
      order.margin = remainingMargin;

      if (remainingMargin <= 0) {
        userOrders.delete(orderId);
      }

    } catch (error) {
      console.error("[PARTIAL_CLOSE] Transaction failed:", error);
      res.status(500).json({
        error: "Failed to partially close order. Your balance has not been changed."
      });
      return;
    }

    try {
      onOrderPartialClose(marginToClose); // 0.5% of exact amount closed
    } catch (err) {
      console.error("Failed to update platform profit, but partial close succeeded:", err);
    }

    console.log(`[PARTIAL_CLOSE] Order ${orderId}: Closed ${percentage}% ($${(marginToClose / 100).toFixed(2)}), PnL: $${(pnl / 100).toFixed(2)}, Fee: $${(closeFee / 100).toFixed(2)} (0.5%)`);

    res.status(200).json({
      message: `Successfully closed ${percentage}% of position`,
      orderId: orderId,
      percentageClosed: percentage,
      marginClosed: marginToClose, // Raw cents
      remainingMargin: remainingMargin, // Raw cents
      pnl: pnl, // Raw cents
      closePrice: closePrice, // Raw scaled price
      fee: closeFee, // Raw cents
      feePercentage: 0.5,
      netReturn: marginToClose + pnl - closeFee, // What user actually receives
    });
  }
);

tradeRoutes.post(
  "/add-margin",
  apiRateLimit,
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    const { orderId, additionalMargin } = req.body;
    const userId = req.userId;

    if (!userId) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const addMarginSchema = await import("../types").then(m => m.addMarginSchema);
    const result = addMarginSchema.safeParse({ orderId, additionalMargin });
    if (!result.success) {
      res.status(400).json({ error: "Invalid input", details: result.error.issues });
      return;
    }

    const userOrders = getUserOrders(userId);
    const order = userOrders.get(orderId);

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    if (order.userId !== userId) {
      res.status(403).json({ error: "Not authorized to modify this order" });
      return;
    }

    const user = findUSerId(userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const additionalMarginCents = toInternalUSD(additionalMargin);
    const addMarginFee = Math.floor(additionalMarginCents * FEE_PERCENTAGE);
    const totalCost = additionalMarginCents + addMarginFee;

    if (user.balance.usd_balance < totalCost) {
      res.status(400).json({ error: "Insufficient balance to add margin (need margin + 0.5% fee)" });
      return;
    }

    const newBalance = user.balance.usd_balance - totalCost;
    const newAddedMargin = order.addedMargin + additionalMarginCents;
    const newTotalMargin = order.margin + additionalMarginCents;

    const positionSize = order.initialMargin * order.leverage; // Original position size
    const effectiveLeverage = positionSize / newTotalMargin; // New effective leverage
    const newLiquidationPrice = calculateLiquidation(order.openPrice, effectiveLeverage, order.type);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { userId: userId },
          data: { balanceCents: newBalance }
        });

        await tx.activeOrder.update({
          where: { orderId: orderId },
          data: {
            margin: newTotalMargin,
            addedMargin: newAddedMargin,
            liquidationPrice: newLiquidationPrice,
          }
        });
      });

      user.balance.usd_balance = newBalance;
      order.addedMargin = newAddedMargin;
      order.margin = newTotalMargin;
      order.liquidationPrice = newLiquidationPrice;

    } catch (error) {
      console.error("[ADD_MARGIN] Transaction failed:", error);
      res.status(500).json({
        error: "Failed to add margin. Your balance has not been changed."
      });
      return;
    }

    try {
      onMarginAdded(additionalMarginCents); // Add 0.5% of additional margin
    } catch (err) {
      console.error("Failed to update platform profit, but margin added successfully:", err);
    }

    console.log(`[ADD_MARGIN] Order ${orderId}: Added $${(additionalMarginCents / 100).toFixed(2)} margin + $${(addMarginFee / 100).toFixed(2)} fee (0.5%), new liq: ${newLiquidationPrice}`);

    res.status(200).json({
      message: "Margin added successfully",
      orderId: orderId,
      additionalMargin: additionalMargin,
      totalMargin: order.margin, // Raw cents
      initialMargin: order.initialMargin, // Raw cents
      addedMargin: order.addedMargin, // Raw cents
      originalLeverage: order.leverage,
      effectiveLeverage: Number(effectiveLeverage.toFixed(2)),
      newLiquidationPrice: newLiquidationPrice, // Raw scaled price
      fee: addMarginFee, // Raw cents
      feePercentage: 0.5,
    });
  }
);

tradeRoutes.get("/platform-profit", (req: Request, res: Response): void => {
  try {
    const platformProfit = getPlatformProfit();

    res.status(200).json(platformProfit);
  } catch (error) {
    console.error("Error getting platform profit:", error);
    res.status(500).json({ error: "Failed to get platform profit" });
  }
});

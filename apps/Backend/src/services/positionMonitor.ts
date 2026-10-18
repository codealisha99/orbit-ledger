import { calculateAllPnL } from "./pnlService";
import { getCurrentPrice } from "./priceMonitor";
import { closeOrder } from "../utils/tradeUtils";
import { getUserOrders } from "../data/store";
import { Order, reasonForClose, STALE_PRICE_THRESHOLD_MS } from "../types";
import { prisma } from "@orbitledger/database";
import type { CloseDecsion } from "../types";

let isRunning = false;
let timeoutId: NodeJS.Timeout | null = null;
const CHECK_INTERVAL = 5000;

export function shouldClosePosition(
    order: Order,
    currentPrice: number
): CloseDecsion | null {
    if (order.type === "buy") {
        if (currentPrice <= order.liquidationPrice) {
            const sendreason: CloseDecsion = {
                reason: "liquidation",
                price: currentPrice,
            };
            return sendreason;
        }
    } else {
        if (currentPrice >= order.liquidationPrice) {
            const sendreason: CloseDecsion = {
                reason: "liquidation",
                price: currentPrice,
            };
            return sendreason;
        }
    }

    if (order.stopLoss) {
        if (order.type === "buy") {
            if (currentPrice <= order.stopLoss) {
                return {
                    reason: "stop_loss",
                    price: currentPrice,
                };
            }
        } else {
            if (currentPrice >= order.stopLoss) {
                return {
                    reason: "stop_loss",
                    price: currentPrice,
                };
            }
        }
    }

    if (order.takeProfit) {
        if (order.type === "buy") {
            if (currentPrice >= order.takeProfit) {
                return {
                    reason: "take_profit",
                    price: currentPrice,
                };
            }
        } else {
            if (currentPrice <= order.takeProfit) {
                return {
                    reason: "take_profit",
                    price: currentPrice,
                };
            }
        }
    }

    
    return null;
}

async function updateTrailingStopLoss(order: Order, currentPrice: number): Promise<boolean> {
    if (!order.trailingStopLoss?.enabled) {
        return false; // No trailing stop loss enabled
    }

    const tsl = order.trailingStopLoss;
    let tslUpdated = false;

    if (order.type === "buy") {
        if (!tsl.highestPrice || currentPrice > tsl.highestPrice) {
            tsl.highestPrice = currentPrice;
            let newStopLoss = currentPrice - tsl.trailingDistance;

            if (newStopLoss <= 0) {
                console.warn(`[TSL] BUY order ${order.orderId}: Calculated negative SL (${newStopLoss}), capping at 100 ($0.01)`);
                newStopLoss = 100;
            }

            if (newStopLoss <= order.liquidationPrice) {
                newStopLoss = order.liquidationPrice + 100; // Slightly above (100 = $0.01 in PRICE_SCALE)
                console.warn(`[TSL] BUY order ${order.orderId}: Capping SL at liquidation + $0.01`);
            }

            if (order.stopLoss === undefined || order.stopLoss === null || newStopLoss > order.stopLoss) {
                order.stopLoss = newStopLoss;
                tslUpdated = true;
                console.log(`[TSL] BUY order ${order.orderId}: Updated SL to ${newStopLoss} (highest: ${currentPrice})`);
            }
        }
    } else {
        if (!tsl.lowestPrice || currentPrice < tsl.lowestPrice) {
            tsl.lowestPrice = currentPrice;
            let newStopLoss = currentPrice + tsl.trailingDistance;

            if (newStopLoss >= order.liquidationPrice) {
                newStopLoss = order.liquidationPrice - 100; // Slightly below (100 = $0.01 in PRICE_SCALE)
                console.warn(`[TSL] SELL order ${order.orderId}: Capping SL at liquidation - $0.01`);
            }

            if (order.stopLoss === undefined || order.stopLoss === null || newStopLoss < order.stopLoss) {
                order.stopLoss = newStopLoss;
                tslUpdated = true;
                console.log(`[TSL] SELL order ${order.orderId}: Updated SL to ${newStopLoss} (lowest: ${currentPrice})`);
            }
        }
    }

    if (tslUpdated) {
        try {
            await prisma.activeOrder.update({
                where: { orderId: order.orderId },
                data: {
                    stopLoss: order.stopLoss,
                    trailingStopLossHighestPrice: tsl.highestPrice || null,
                    trailingStopLossLowestPrice: tsl.lowestPrice || null,
                }
            });
        } catch (err) {
            console.error(`[TSL] Failed to persist TSL update for order ${order.orderId}:`, err);
        }
    }

    return tslUpdated;
}

export async function checkCycle():Promise<void>{
    try{
        console.log(`starting the monitoring cycle ${Date.now()}`);
        const alluser=getUserOrders("all");
        let postionChecked=0;
        let postionClsoed=0;
        let counterror=0;
        let trailingUpdates=0;
        let price:number;
        for (const [orderId, order] of alluser.entries()){
            postionChecked++;
            const UserAsset=await getCurrentPrice(order.asset);

            if(!UserAsset || UserAsset.bidPrice <= 0 || UserAsset.askPrice <= 0){
                console.error(`[checkcycle] Invalid or missing price data for ${order.asset}`);
                counterror++;
                continue;
            }

            if(order.type === 'buy'){
                price = UserAsset.bidPrice;
            } else if(order.type === "sell"){
                price = UserAsset.askPrice;
            } else {
                console.error(`[CRITICAL] Invalid order type: ${order.type} for order ${orderId}`);
                counterror++;
                continue; // Skip this order
            }

            if (!isFinite(price) || price <= 0) {
                console.error(`[CRITICAL] Invalid price for ${order.asset}: ${price} (order ${orderId})`);
                counterror++;
                continue;
            }

            const closePosition = shouldClosePosition(order, price);

            if(closePosition === null){
                const tslUpdated = await updateTrailingStopLoss(order, price);
                if (tslUpdated) {
                    trailingUpdates++;
                }
            } else {
                try{
                    console.log(`[POSITION MONITOR] Closing Order ${orderId} | Reason: ${closePosition.reason} | Trigger Price: ${closePosition.price} | Order Type: ${order.type} | LiqPrice: ${order.liquidationPrice} | SL: ${order.stopLoss} | TP: ${order.takeProfit}`);
                    await closeOrder(order.userId, orderId, closePosition.price, closePosition.reason);
                    postionClsoed++;
                } catch(err){
                    counterror++;
                    console.error('Error occurred while closing the order:', err);
                }
            }

        }

        console.log(`[CheckCycle] Completed: ${postionChecked} checked, ${trailingUpdates} TSL updates, ${postionClsoed} closed, ${counterror} errors`);

        if (isRunning) {
            timeoutId = setTimeout(checkCycle, CHECK_INTERVAL);
        }
    }catch(err){
        console.error("[CheckCycle] Error occurred while checking:",err);

        if (isRunning) {
            timeoutId = setTimeout(checkCycle, CHECK_INTERVAL);
        }
    }
}

export function startPositionMonitor():void{
    if(isRunning===true){
        console.log("The position monitor is Still Running");
        return;
    }
    isRunning=true;
    console.log("Starting position monitor (checking every 5000ms)");
    setTimeout(() => {
        checkCycle().catch(err => console.error("[MONITOR] Startup error:", err));
    }, 0);
}
export function stopPositionMonitor():void{
    if(isRunning===false){
        console.log("The position monitor is already stopped");
        return;
    }
    isRunning=false;
    
    if(timeoutId !== null){
        clearTimeout(timeoutId);
        timeoutId = null;
    }
    
    console.log("Position monitor stopped");
}
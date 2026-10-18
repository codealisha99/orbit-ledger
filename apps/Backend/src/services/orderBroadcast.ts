import { createClient } from "redis";
import type { Order, ClosedOrder } from "../types";
import { fromInternalUSD, fromInternalPrice } from "@orbitledger/shared";


const client = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

export async function initOrderBroadcast() {
  try {
    client.on("error", (err) => console.log("Redis Client Error", err));
    client.on("reconnecting", () => console.log("Reconnecting to Redis..."));
    if (!client.isOpen) {
      await client.connect();
    }
    console.log("Redis connected");
  } catch (err) {
    console.error("Redis connection failed, retrying in 3s", err);
    setTimeout(() => {
      initOrderBroadcast();
    }, 3000);
  }
}

export async function broadcastOrderOpened(order: Order) {
  try {
    if (!order) {
      throw Error("Dont have proper Order Details");
    }
    const neworder: Order = {
      ...order,
      margin: fromInternalUSD(order.margin),
      openPrice: fromInternalPrice(order.openPrice),
    };
    const OrderObj = {
      type: "ORDER_OPENED",
      data: neworder,
    };
    const redishOrder = `orders:${order.userId}`;
    await client.publish(redishOrder, JSON.stringify(OrderObj));
    console.log("Order published to Redis");
  } catch (err) {
    console.error("Error publishing trade:", err);
  }
}

export async function broadcastOrderClose(
  ClosedOrder: ClosedOrder,
  reasonForClose: ClosedOrder["closeReason"]
) {
  try {
    let reson;
    if (!ClosedOrder) {
      throw Error("Dont have proper Order Details");
    }
    if (reasonForClose === "liquidation") {
      reson = "ORDER_LIQUIDATED";
    } else {
      reson = "ORDER_CLOSED";
    }
    const neworder: ClosedOrder = {
      ...ClosedOrder,
      margin: fromInternalUSD(ClosedOrder.margin),
      openPrice: fromInternalPrice(ClosedOrder.openPrice),
      closePrice: fromInternalPrice(ClosedOrder.closePrice),
      pnl: fromInternalUSD(ClosedOrder.pnl),
    };
    const OrderObj = {
      type: reson,
      data: neworder,
    };
    const redishOrder = `orders:${ClosedOrder.userId}`;
    await client.publish(redishOrder, JSON.stringify(OrderObj));
    console.log(`Order closed broadcast sent, pnl: ${ClosedOrder.pnl}`);
  } catch (err) {
    console.error("Error publishing order close to Redis:", err);
  }
}

export async function stopOrderBroadcast() {
  try {
    if (client.isOpen) {
      await client.quit();
      console.log("Redis client disconnected successfully");
    }
  } catch (err) {
    console.error("Error disconnecting Redis client:", err);
  }
}

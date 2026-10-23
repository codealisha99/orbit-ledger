import { createClient } from "redis";
import { binanceEmitter } from "./binance";
import type { Trades } from "./binance";

const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
}); //connect to the docker redis

interface typeofredishPriceData {
  symbol: string;
  askPrice: number;
  bidPrice: number;
  decimals: number;
  time: number;
  tradeId: number;
  price: number;
  quantity: string;
  source: string;
}

redis.on("error", (error) => console.error("[REDIS]", error.message));
let tradeListener: ((tradeData: Trades) => Promise<void>) | null = null;
let isShuttingDown = false;
let lastPublishOkAt = 0;
let publishFailures = 0;

export function publisherHealth() {
  return { lastPublishOkAt, publishFailures };
}

export async function startRedis() {
  try {
    await redis.connect();
    console.log("Redis Connected Sucessfully !!!!!!!!!");

    tradeListener = async (tradeData: Trades) => {
      try {
        const midPrice = tradeData.price;
        const spreadAmount = Math.floor(midPrice * 0.005); // 0.5% spread

        const redisPriceData: typeofredishPriceData = {
          symbol: tradeData.symbol.replace("USDT", ""),
          askPrice: midPrice + spreadAmount, // Higher price for buying
          bidPrice: midPrice - spreadAmount, // Lower price for selling
          decimals: 4,
          time: tradeData.timestamp,
          tradeId: tradeData.tradeId,
          price: tradeData.price,
          quantity: tradeData.quantity,
          source: "Binance",
        };
        const channel = tradeData.symbol.replace("USDT", ""); // Something like "SOL " Btc"
        await redis.publish(channel, JSON.stringify(redisPriceData));
        lastPublishOkAt = Date.now();
        publishFailures = 0;
      } catch (err) {
        publishFailures++;
        if (publishFailures % 10 === 1)
          console.error("Error publishing trade:", err);
      }
    };

    binanceEmitter.on("trade", tradeListener);
  } catch (err) {
    console.error("Error Connecting to Redis ", err);

    if (tradeListener) {
      binanceEmitter.removeListener("trade", tradeListener);
    }

    if (!isShuttingDown) {
      setTimeout(() => {
        startRedis();
      }, 3000);
    }
  }
}

export async function stopRedis() {
  isShuttingDown = true;
  if (tradeListener) binanceEmitter.removeListener("trade", tradeListener);
  if (redis.isOpen) await redis.quit();
}

let reconnecting = false;
export async function reconnectPublisher() {
  if (reconnecting) return;
  reconnecting = true;
  try {
    if (tradeListener) binanceEmitter.removeListener("trade", tradeListener);
    const quit = redis.isOpen ? redis.quit() : Promise.resolve();
    await Promise.race([quit, new Promise((r) => setTimeout(r, 5000))]);
    await startRedis();
  } catch (err) {
    console.error("[REDIS] Reconnect attempt failed", err);
  } finally {
    reconnecting = false;
  }
}

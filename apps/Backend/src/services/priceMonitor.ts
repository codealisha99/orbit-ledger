import { createClient } from "redis";
import type { redisPriceData, IncomingredisPriceData } from "../types";
import { PriceDataSchema, STALE_PRICE_THRESHOLD_MS } from "../types";
import { isFreshQuote, SUPPORTED_ASSETS, Asset, toInternalPrice } from "@papership/shared";
const client = createClient({
  url: process.env.REDIS_URL,
});

import { PriceStorageMp } from "../data/store";

let redisRetryCount = 0;
let watchdogInterval: NodeJS.Timeout | null = null;

export async function refreshQuotesFromRest(targetAsset?: Asset): Promise<boolean> {
  try {
    const symbols = targetAsset ? [`${targetAsset}USDT`] : ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
    const symbolsParam = encodeURIComponent(JSON.stringify(symbols));

    const endpoints = [
      `https://data-api.binance.vision/api/v3/ticker/bookTicker?symbols=${symbolsParam}`,
      `https://api.binance.com/api/v3/ticker/bookTicker?symbols=${symbolsParam}`,
    ];

    let items: Array<{ symbol: string; bidPrice: string; askPrice: string }> | null = null;
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const parsed = await res.json();
          if (Array.isArray(parsed)) {
            items = parsed;
            break;
          }
        }
      } catch {
        // Fallback to next endpoint
      }
    }

    if (!items || !Array.isArray(items)) return false;

    const now = Date.now();
    for (const item of items) {
      const asset = item.symbol.replace("USDT", "") as Asset;
      if (!SUPPORTED_ASSETS.includes(asset)) continue;

      const rawBid = Number(item.bidPrice);
      const rawAsk = Number(item.askPrice);
      if (!Number.isFinite(rawBid) || !Number.isFinite(rawAsk) || rawBid <= 0) continue;

      const midPrice = toInternalPrice((rawBid + rawAsk) / 2);
      const spread = Math.floor(midPrice * 0.005); // 0.5% synthetic spread

      const quote: redisPriceData = {
        bid: midPrice - spread,
        ask: midPrice + spread,
        decimals: 4,
        time: now,
      };

      if (isFreshQuote(quote, now)) {
        const prev = PriceStorageMp.get(asset);
        if (!prev || !prev.time || now >= prev.time) {
          PriceStorageMp.set(asset, quote);
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function initPriceMonitor() {
  // Seed fresh quotes immediately on startup so cold start never fails with 503
  void refreshQuotesFromRest();

  // Watchdog: refresh from REST if any asset feed falls silent or stale
  if (!watchdogInterval) {
    watchdogInterval = setInterval(() => {
      const needsRefresh = SUPPORTED_ASSETS.some(
        (asset) => !isFreshQuote(PriceStorageMp.get(asset)),
      );
      if (needsRefresh) {
        void refreshQuotesFromRest();
      }
    }, 10000);
  }

  try {
    client.removeAllListeners("error");
    client.removeAllListeners("reconnecting");

    client.on("error", (err) => console.log("Redis Client Error", err));
    client.on("reconnecting", () => console.log("Reconnecting to Redis..."));
    if (!client.isOpen) {
      await client.connect();
      console.log("Redis Connected Successfully !!!!!!!!!");
      redisRetryCount = 0; // Reset retry count on successful connection
    }
    for (const asset of SUPPORTED_ASSETS) {
      client.subscribe(asset, (mssg) => {
        void handlePriceUpdate(asset, mssg);
      });
    }
  } catch (err) {
    redisRetryCount++;
    const backoffDelay = Math.min(
      1000 * Math.pow(2, Math.min(redisRetryCount - 1, 5)),
      30000,
    );
    console.warn(
      `[REDIS] Connection attempt ${redisRetryCount} failed, retrying in ${backoffDelay / 1000}s... (REST fallback active)`,
    );
    setTimeout(() => {
      initPriceMonitor();
    }, backoffDelay);
  }
}

export async function handlePriceUpdate(asset: Asset, message: string) {
  try {
    const messages: IncomingredisPriceData = JSON.parse(message);
    const validdate = PriceDataSchema.safeParse(messages);
    if (!validdate.success) {
      console.log("All the  values are not present");
      return;
    }
    const PriceData: redisPriceData = {
      bid: messages.bidPrice,
      ask: messages.askPrice, // Buy price in PRICE_SCALE
      decimals: 4,
      time: messages.time,
    };
    if (!isFreshQuote(PriceData)) return;
    const previous = PriceStorageMp.get(asset);
    if (previous?.time && previous.time > PriceData.time) return;
    PriceStorageMp.set(asset, PriceData);
  } catch (err) {
    console.error("Error In Updating the Price", err);
  }
}

export async function getCurrentPrice(asset: Asset) {
  const currentPrice = PriceStorageMp.get(asset);
  if (!isFreshQuote(currentPrice)) return null;
  const returnPrice: IncomingredisPriceData = {
    bidPrice: currentPrice.bid, // Sell price in PRICE_SCALE
    askPrice: currentPrice.ask, // Buy price in PRICE_SCALE
    time: currentPrice.time,
  };
  return returnPrice;
}

export async function stopPriceMonitor() {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  try {
    for (const asset of SUPPORTED_ASSETS) {
      await client.unsubscribe(asset);
    }
    console.log("Unsubscribed from all price channels");

    if (client.isOpen) {
      await client.quit();
      console.log("Redis connection closed successfully");
    }

    PriceStorageMp.clear();
    console.log("Price storage cleared");
  } catch (err) {
    console.error("Error stopping price monitor:", err);
    if (client.isOpen) {
      await client.disconnect();
    }
  }
}

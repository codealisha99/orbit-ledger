import { Router } from "express";
import type { Request, Response } from "express";
import { PriceStorageMp } from "../data/store";
import { fromInternalPrice } from "@orbitledger/shared";
import { prisma } from "@orbitledger/database";
import { z } from "zod";
import {
  isFreshQuote,
  INTERVAL_SECONDS,
  bucketStart,
  SUPPORTED_ASSETS,
} from "@orbitledger/shared";
import { getCandelFromDb } from "../services/services";
import { TimeDurationCandel, ValidSymbol } from "../types";
import { apiRateLimit, chartDataRateLimit } from "../middleware/rateLimit";

export const assetRouter = Router();

const ASSET_METADATA = {
  BTC: {
    name: "Bitcoin",
    imageUrl: "https://cryptologos.cc/logos/bitcoin-btc-logo.png",
  },
  ETH: {
    name: "Ethereum",
    imageUrl: "https://cryptologos.cc/logos/ethereum-eth-logo.png",
  },
  SOL: {
    name: "Solana",
    imageUrl: "https://cryptologos.cc/logos/solana-sol-logo.png",
  },
};

assetRouter.get("/", apiRateLimit, (req: Request, res: Response): void => {
  try {
    const assets = SUPPORTED_ASSETS.map((symbol) => {
      const priceData = PriceStorageMp.get(symbol);
      const metadata = ASSET_METADATA[symbol];
      const fresh = isFreshQuote(priceData);
      const buyPrice = fresh ? fromInternalPrice(priceData.ask) : null;
      const sellPrice = fresh ? fromInternalPrice(priceData.bid) : null;

      return {
        symbol: symbol,
        stale: !fresh,
        time: priceData?.time ?? null,
        pricing: "Simulated quotes: exchange trade ±0.5%",
        name: metadata.name,
        buyPrice: buyPrice, // Ask price for buying
        sellPrice: sellPrice, // Bid price for selling
        decimals: 4,
        imageUrl: metadata.imageUrl,
      };
    });

    res.status(200).json({
      assets: assets,
    });
  } catch (error) {
    console.error("[ASSET] Error fetching asset details:", error);
    res.status(500).json({ error: "Failed to fetch asset details" });
  }
});

assetRouter.get(
  "/candles",
  chartDataRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const query = z
        .object({
          asset: z.enum(["BTC", "ETH", "SOL"]),
          ts: z.enum(["1m", "5m", "15m", "1h", "4h", "1d", "1w"]),
          startTime: z.coerce.number().int().min(0),
          endTime: z.coerce.number().int().positive(),
        })
        .safeParse(req.query);
      if (!query.success) {
        res
          .status(400)
          .json({ error: "Invalid market, interval or date range." });
        return;
      }
      const { asset, ts, startTime, endTime } = query.data;
      if (
        startTime > endTime ||
        (endTime - startTime) / INTERVAL_SECONDS[ts] > 50000
      ) {
        res.status(400).json({
          error:
            "Choose a shorter range or coarser candle interval (maximum 50,000 candles).",
        });
        return;
      }
      const candles = await getCandelFromDb(
        asset as ValidSymbol,
        ts as TimeDurationCandel,
        Number(startTime),
        Number(endTime),
      );

      const earliestStored = await prisma.marketCandle.findFirst({
        where: { symbol: asset, interval: ts },
        orderBy: { timestamp: "asc" },
        select: { timestamp: true },
      });
      const earliestTrade =
        ts !== "1d" && ts !== "1w"
          ? await prisma.trade.findFirst({
              where: { symbol: `${asset}USDT` },
              orderBy: { timestamp: "asc" },
              select: { timestamp: true },
            })
          : null;
      const earliest = [
        earliestStored?.timestamp.getTime(),
        earliestTrade?.timestamp.getTime(),
      ].filter((v): v is number => v !== undefined);
      res.status(200).json({
        candles: candles,
        meta: {
          symbol: asset,
          interval: ts,
          count: candles.length,
          earliestAvailable: earliest.length
            ? Math.min(...earliest) / 1000
            : null,
          requestedStart: startTime,
          requestedEnd: endTime,
          actualStart: candles[0]?.time ?? null,
          actualEnd: candles.at(-1)?.time ?? null,
          complete:
            candles.length ===
            (bucketStart(Math.min(endTime, Date.now() / 1000), ts) -
              bucketStart(startTime, ts)) /
              INTERVAL_SECONDS[ts] +
              1,
          source:
            ts === "1d" || ts === "1w"
              ? "Binance historical bars"
              : "Binance bars and collected trades",
          updatedAt: Date.now(),
        },
      });
    } catch (error) {
      console.error("[CANDLES] Error fetching candle data:", error);
      res.status(500).json({
        error: "Failed to fetch candle data",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

assetRouter.get("/trades", apiRateLimit, async (req, res, next) => {
  try {
    const asset = z.enum(["BTC", "ETH", "SOL"]).parse(req.query.asset);
    const trades = await prisma.trade.findMany({
      where: { symbol: `${asset}USDT` },
      orderBy: { timestamp: "desc" },
      take: 100,
    });
    res.json({
      trades: trades.map((t) => ({
        tradeId: String(t.tradeId),
        symbol: asset,
        price: Number(t.price),
        quantity: String(t.quantity),
        time: t.timestamp.getTime(),
        source: "Binance",
      })),
    });
  } catch (error) {
    next(error);
  }
});
let statsCache: { at: number; rows: unknown } | undefined;
assetRouter.get("/stats", apiRateLimit, async (_req, res) => {
  try {
    if (!statsCache || Date.now() - statsCache.at > 30000) {
      const response = await fetch(
        "https://data-api.binance.vision/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22,%22SOLUSDT%22%5D",
        { signal: AbortSignal.timeout(5000) },
      );
      if (!response.ok) throw new Error("Market statistics unavailable");
      const rows = (await response.json()) as Array<Record<string, string>>;
      statsCache = {
        at: Date.now(),
        rows: rows.map((r) => ({
          symbol: r.symbol!.replace("USDT", ""),
          changePercent: Number(r.priceChangePercent),
          high: Number(r.highPrice),
          low: Number(r.lowPrice),
          volume: Number(r.quoteVolume),
          last: Number(r.lastPrice),
        })),
      };
    }
    res.json({ markets: statsCache.rows, updatedAt: statsCache.at });
  } catch {
    res.status(503).json({ error: "24h statistics unavailable" });
  }
});

import { Router } from "express";
import type { Request, Response } from "express";
import { PriceStorageMp } from "../data/store";
import { fromInternalPrice } from "@orbitledger/shared";
import { SUPPORTED_ASSETS } from "@orbitledger/shared";
import { getCandelFromDb } from '../services/services';
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
    const FALLBACK_PRICES: Record<string, { bid: number; ask: number }> = {
      BTC: { bid: 64500, ask: 65000 },
      ETH: { bid: 3475, ask: 3500 },
      SOL: { bid: 179, ask: 180 },
    };

    const assets = SUPPORTED_ASSETS.map((symbol) => {
      const priceData = PriceStorageMp.get(symbol);
      const metadata = ASSET_METADATA[symbol];
      const fallback = FALLBACK_PRICES[symbol];

      let buyPrice = fallback.ask;
      let sellPrice = fallback.bid;

      if (priceData && priceData.ask > 0 && priceData.bid > 0) {
        buyPrice = fromInternalPrice(priceData.ask);
        sellPrice = fromInternalPrice(priceData.bid);
      }

      return {
        symbol: symbol,
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


assetRouter.get("/candles", chartDataRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
      const { asset, ts, startTime, endTime } = req.query;

      if (!asset || !ts || !startTime || !endTime) {
        res.status(400).json({
          error: "Missing required parameters: asset, ts, startTime, endTime"
        });
        return;
      }

      const candles = await getCandelFromDb(
        asset as ValidSymbol,
        ts as TimeDurationCandel,
        Number(startTime),
        Number(endTime)
      );

      res.status(200).json({
        candles: candles,
        meta: {
          symbol: asset,
          interval: ts,
          count: candles.length,
        }
      });
    } catch (error) {
      console.error("[CANDLES] Error fetching candle data:", error);
      res.status(500).json({
        error: "Failed to fetch candle data",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
});

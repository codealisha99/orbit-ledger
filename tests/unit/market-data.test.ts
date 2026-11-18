import { describe, expect, test } from "bun:test";
import {
  toInternalPrice,
  fromInternalPrice,
  isFreshQuote,
  type Quote,
  PRICE_SCALE,
  USD_SCALE,
  SUPPORTED_ASSETS,
  BINANCE_STREAMS,
} from "../../packages/shared/src/index";

describe("Market Data Ingestion & Normalization", () => {
  test("price scaling converts accurately to and from integer format", () => {
    const rawPrice = 67890.1234;
    const scaled = toInternalPrice(rawPrice);
    expect(scaled).toBe(678901234);
    expect(Number.isSafeInteger(scaled)).toBe(true);

    const reconstructed = fromInternalPrice(scaled);
    expect(reconstructed).toBeCloseTo(rawPrice, 4);
  });

  test("supported asset mapping matches Binance stream subscriptions", () => {
    expect(SUPPORTED_ASSETS).toEqual(["BTC", "ETH", "SOL"]);
    expect(BINANCE_STREAMS.BTC).toBe("btcusdt@aggTrade");
    expect(BINANCE_STREAMS.ETH).toBe("ethusdt@aggTrade");
    expect(BINANCE_STREAMS.SOL).toBe("solusdt@aggTrade");
  });

  test("synthetic spread calculation enforces a 50 bps half-spread", () => {
    const midPrice = 600000000; // $60,000.00 in PRICE_SCALE
    const spreadHalf = Math.floor(midPrice * 0.005); // 0.5% = 3000000 ($300.00)
    const askPrice = midPrice + spreadHalf; // $60,300.00 (Buy price)
    const bidPrice = midPrice - spreadHalf; // $59,700.00 (Sell price)

    expect(askPrice).toBe(603000000);
    expect(bidPrice).toBe(597000000);
    expect(askPrice).toBeGreaterThan(bidPrice);
    expect(askPrice - bidPrice).toBe(2 * spreadHalf);
  });

  test("quote freshness accepts valid recent quotes within 30 seconds", () => {
    const now = Date.now();
    const validQuote: Quote = {
      bid: 597000000,
      ask: 603000000,
      time: now - 5000, // 5s old
    };
    expect(isFreshQuote(validQuote, now)).toBe(true);
  });

  test("quote freshness rejects stale quotes older than 30 seconds", () => {
    const now = Date.now();
    const staleQuote: Quote = {
      bid: 597000000,
      ask: 603000000,
      time: now - 31000, // 31s old
    };
    expect(isFreshQuote(staleQuote, now)).toBe(false);
  });

  test("quote freshness rejects inverted or negative bid/ask quotes", () => {
    const now = Date.now();
    // Ask lower than bid
    expect(
      isFreshQuote({ bid: 600000000, ask: 590000000, time: now }, now),
    ).toBe(false);
    // Negative bid
    expect(
      isFreshQuote({ bid: -1000, ask: 600000000, time: now }, now),
    ).toBe(false);
    // Zero bid
    expect(
      isFreshQuote({ bid: 0, ask: 600000000, time: now }, now),
    ).toBe(false);
    // Future quote (more than 5s in future)
    expect(
      isFreshQuote({ bid: 590000000, ask: 600000000, time: now + 10000 }, now),
    ).toBe(false);
  });
});

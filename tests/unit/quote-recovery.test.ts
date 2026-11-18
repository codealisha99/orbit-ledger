import { describe, expect, test } from "bun:test";
import { isFreshQuote, toInternalPrice, fromInternalPrice, SUPPORTED_ASSETS } from "../../packages/shared/src/index";
import { PriceStorageMp } from "../../apps/Backend/src/data/store";
import { refreshQuotesFromRest } from "../../apps/Backend/src/services/priceMonitor";

describe("Market Data & Quote Recovery Engine", () => {
  test("Quote Freshness Contract: Rejects expired, zero, negative, or inverted quotes", () => {
    const now = Date.now();
    // Valid quote
    expect(isFreshQuote({ bid: 500000000, ask: 505000000, time: now }, now)).toBe(true);

    // Expired quote (>30s)
    expect(isFreshQuote({ bid: 500000000, ask: 505000000, time: now - 35000 }, now)).toBe(false);

    // Future quote (>5s drift)
    expect(isFreshQuote({ bid: 500000000, ask: 505000000, time: now + 10000 }, now)).toBe(false);

    // Inverted quote (bid > ask)
    expect(isFreshQuote({ bid: 505000000, ask: 500000000, time: now }, now)).toBe(false);

    // Zero prices
    expect(isFreshQuote({ bid: 0, ask: 0, time: now }, now)).toBe(false);

    // Missing time
    expect(isFreshQuote({ bid: 500000000, ask: 505000000 }, now)).toBe(false);
  });

  test("Synthetic Spread Calculation: 50 bps (0.5%) spread symmetrically placed around midPrice", () => {
    const rawMid = 60000;
    const internalMid = toInternalPrice(rawMid);
    const spreadAmount = Math.floor(internalMid * 0.005);
    const bid = internalMid - spreadAmount;
    const ask = internalMid + spreadAmount;

    expect(internalMid).toBe(600000000);
    expect(spreadAmount).toBe(3000000); // $300 spread
    expect(bid).toBe(597000000); // $59,700
    expect(ask).toBe(603000000); // $60,300

    expect(fromInternalPrice(bid)).toBe(59700);
    expect(fromInternalPrice(ask)).toBe(60300);
    expect(ask - bid).toBe(spreadAmount * 2);
  });

  test("On-Demand REST Quote Fallback: Recovers fresh quotes directly into PriceStorageMp", async () => {
    // Intentionally clear PriceStorageMp for BTC
    PriceStorageMp.set("BTC", { bid: 0, ask: 0 });
    expect(isFreshQuote(PriceStorageMp.get("BTC"))).toBe(false);

    // Trigger REST recovery
    const recovered = await refreshQuotesFromRest("BTC");
    expect(recovered).toBe(true);

    const btcQuote = PriceStorageMp.get("BTC");
    expect(btcQuote).toBeDefined();
    expect(btcQuote?.bid).toBeGreaterThan(0);
    expect(btcQuote?.ask).toBeGreaterThan(btcQuote!.bid);
    expect(isFreshQuote(btcQuote)).toBe(true);
  });

  test("All supported assets receive fresh quotes on startup fallback", async () => {
    const success = await refreshQuotesFromRest();
    expect(success).toBe(true);

    for (const asset of SUPPORTED_ASSETS) {
      const q = PriceStorageMp.get(asset);
      expect(isFreshQuote(q)).toBe(true);
      expect(q!.bid).toBeGreaterThan(0);
      expect(q!.ask).toBeGreaterThan(q!.bid);
    }
  });
});

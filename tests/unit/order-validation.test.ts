import { describe, expect, test } from "bun:test";
import { openTradeSchema, closeTradeSchema, partialCloseSchema, addMarginSchema } from "../../apps/Backend/src/types";

describe("Order Parameter & Validation Schema Unit Tests", () => {
  test("open trade schema accepts valid order parameters", () => {
    const validOrder = {
      asset: "BTC",
      type: "buy",
      margin: 100, // $100
      leverage: 10,
      takeProfit: 70000,
      stopLoss: 55000,
    };
    const result = openTradeSchema.safeParse(validOrder);
    expect(result.success).toBe(true);
  });

  test("open trade schema rejects unsupported assets", () => {
    const invalidAsset = {
      asset: "DOGE",
      type: "buy",
      margin: 100,
      leverage: 10,
    };
    const result = openTradeSchema.safeParse(invalidAsset);
    expect(result.success).toBe(false);
  });

  test("open trade schema enforces leverage whitelist [1, 5, 10, 20, 100]", () => {
    for (const lev of [1, 5, 10, 20, 100]) {
      const res = openTradeSchema.safeParse({ asset: "BTC", type: "buy", margin: 100, leverage: lev });
      expect(res.success).toBe(true);
    }
    // Invalid leverages
    for (const invalidLev of [0, 2, 7, 50, 150, -10]) {
      const res = openTradeSchema.safeParse({ asset: "BTC", type: "buy", margin: 100, leverage: invalidLev });
      expect(res.success).toBe(false);
    }
  });

  test("open trade schema enforces collateral limits ($10 minimum, $1,000,000 maximum)", () => {
    // Under minimum ($9.99)
    expect(openTradeSchema.safeParse({ asset: "ETH", type: "sell", margin: 9.99, leverage: 5 }).success).toBe(false);
    // Exact minimum ($10.00)
    expect(openTradeSchema.safeParse({ asset: "ETH", type: "sell", margin: 10, leverage: 5 }).success).toBe(true);
    // Negative margin
    expect(openTradeSchema.safeParse({ asset: "ETH", type: "sell", margin: -100, leverage: 5 }).success).toBe(false);
    // Over maximum ($1,000,001)
    expect(openTradeSchema.safeParse({ asset: "ETH", type: "sell", margin: 1000001, leverage: 5 }).success).toBe(false);
  });

  test("partial close schema validates percentage strictly between 1% and 99%", () => {
    expect(partialCloseSchema.safeParse({ orderId: "123", percentage: 50 }).success).toBe(true);
    expect(partialCloseSchema.safeParse({ orderId: "123", percentage: 0 }).success).toBe(false);
    expect(partialCloseSchema.safeParse({ orderId: "123", percentage: 100 }).success).toBe(false);
    expect(partialCloseSchema.safeParse({ orderId: "123", percentage: -25 }).success).toBe(false);
    expect(partialCloseSchema.safeParse({ orderId: "123", percentage: 150 }).success).toBe(false);
  });

  test("add margin schema enforces positive additional collateral", () => {
    expect(addMarginSchema.safeParse({ orderId: "123", additionalMargin: 50 }).success).toBe(true);
    expect(addMarginSchema.safeParse({ orderId: "123", additionalMargin: 0 }).success).toBe(false);
    expect(addMarginSchema.safeParse({ orderId: "123", additionalMargin: -50 }).success).toBe(false);
  });
});

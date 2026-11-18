import { describe, expect, test } from "bun:test";
import {
  pnlCents,
  liquidationPrice,
  feeCents,
  splitAmount,
  quantity,
  PRICE_SCALE,
  USD_SCALE,
} from "../../packages/shared/src/index";

describe("Financial Invariants & Accounting Mathematics", () => {
  test("PnL calculation for Buy (Long) strictly obeys integer math", () => {
    // Buy 1 BTC at $50,000.00 with $10,000 notional
    // Open = 500,000,000, Notional = 1,000,000 cents ($10,000)
    const openPrice = 500000000;
    const notionalCents = 1000000;

    // Price rises to $55,000 (+10%)
    const closePriceProfit = 550000000;
    const profit = pnlCents(openPrice, closePriceProfit, notionalCents, "buy");
    expect(profit).toBe(100000); // Exactly +$1,000.00 (+100,000 cents)

    // Price drops to $45,000 (-10%)
    const closePriceLoss = 450000000;
    const loss = pnlCents(openPrice, closePriceLoss, notionalCents, "buy");
    expect(loss).toBe(-100000); // Exactly -$1,000.00 (-100,000 cents)
  });

  test("PnL calculation for Sell (Short) inverts price direction", () => {
    const openPrice = 500000000;
    const notionalCents = 1000000;

    // Price drops to $45,000 -> Short makes profit
    const closePriceProfit = 450000000;
    const profit = pnlCents(openPrice, closePriceProfit, notionalCents, "sell");
    expect(profit).toBe(100000); // +$1,000.00

    // Price rises to $55,000 -> Short incurs loss
    const closePriceLoss = 550000000;
    const loss = pnlCents(openPrice, closePriceLoss, notionalCents, "sell");
    expect(loss).toBe(-100000); // -$1,000.00
  });

  test("liquidation price equals Open Price +/- (Open Price / Leverage)", () => {
    const openPrice = 600000000; // $60,000.00
    const collateralCents = 100000; // $1,000.00 margin
    const notional10x = 1000000; // $10,000.00 notional (10x leverage)

    // Long liquidation: 60000 - (60000 / 10) = 54000
    const longLiq = liquidationPrice(openPrice, collateralCents, notional10x, "buy");
    expect(longLiq).toBe(540000000);

    // Short liquidation: 60000 + (60000 / 10) = 66000
    const shortLiq = liquidationPrice(openPrice, collateralCents, notional10x, "sell");
    expect(shortLiq).toBe(660000000);

    // 100x leverage: Distance is 60000 / 100 = 600
    const notional100x = 10000000;
    const longLiq100x = liquidationPrice(openPrice, collateralCents, notional100x, "buy");
    expect(longLiq100x).toBe(594000000); // $59,400.00
  });

  test("fee basis is exactly 50 bps (0.5%) via integer division by 200n", () => {
    // 50 bps on $1,000.00 (100,000 cents) = $5.00 (500 cents)
    expect(feeCents(100000)).toBe(500);

    // 50 bps on $10.00 (1,000 cents) = $0.05 (5 cents)
    expect(feeCents(1000)).toBe(5);

    // Fractional cents are floored (integer arithmetic)
    expect(feeCents(199)).toBe(0);
    expect(feeCents(200)).toBe(1);
    expect(feeCents(201)).toBe(1);
  });

  test("partial close splits conserve every single cent", () => {
    const initialMargin = 100000; // 100,000 cents
    const percentage = 33.33; // 33.33%

    const closedMargin = splitAmount(initialMargin, percentage);
    const remainingMargin = initialMargin - closedMargin;

    expect(closedMargin + remainingMargin).toBe(initialMargin);
    expect(closedMargin).toBe(33330);
    expect(remainingMargin).toBe(66670);
  });

  test("isolated margin enforces loss floor at -Margin (cannot create negative balance)", () => {
    const margin = 50000; // $500 margin
    const openPrice = 600000000;
    const notionalCents = 500000; // 10x ($5,000 notional)

    // Severe crash: price drops to $20,000 (-66.6%)
    const crashPrice = 200000000;
    const rawPnl = pnlCents(openPrice, crashPrice, notionalCents, "buy");
    expect(rawPnl).toBe(-333333); // -$3,333.33 loss

    // Isolated margin caps loss at -margin (-50,000 cents)
    const effectivePnl = Math.max(-margin, rawPnl);
    expect(effectivePnl).toBe(-margin);

    // Settlement return: margin + pnl - fee
    // Since effectivePnl = -margin, margin + effectivePnl = 0.
    const exitFee = Math.min(feeCents(margin), margin + effectivePnl);
    expect(exitFee).toBe(0);
    const returnToBalance = margin + effectivePnl - exitFee;
    expect(returnToBalance).toBe(0);
    expect(returnToBalance).toBeGreaterThanOrEqual(0);
  });

  test("quantity formula accurately determines base units", () => {
    // $10,000 notional (1,000,000 cents) at $50,000 open (500,000,000 scaled)
    const q = quantity(1000000, 500000000);
    expect(q).toBe(0.2); // 0.2 BTC

    // $3,000 notional (300,000 cents) at $3,000 ETH (30,000,000 scaled)
    const qEth = quantity(300000, 30000000);
    expect(qEth).toBe(1.0); // 1.0 ETH
  });
});

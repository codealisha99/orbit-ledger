import { describe, expect, test } from "bun:test";
import {
  pnlCents,
  liquidationPrice,
  isFreshQuote,
  bucketStart,
  feeCents,
  splitAmount,
} from "../src/domain";
describe("financial and time contracts", () => {
  test("scaled prices produce signed cents for both sides", () => {
    expect(pnlCents(600000000, 630000000, 1000000, "buy")).toBe(50000);
    expect(pnlCents(600000000, 630000000, 1000000, "sell")).toBe(-50000);
  });
  test("fractional effective leverage preserves collateral distance", () => {
    expect(liquidationPrice(600000000, 150000, 1000000, "buy")).toBe(510000000);
    expect(liquidationPrice(600000000, 150000, 1000000, "sell")).toBe(
      690000000,
    );
  });
  test("quote freshness uses source milliseconds and rejects future/zero/invalid quotes", () => {
    const now = 1800000000000;
    expect(isFreshQuote({ bid: 100, ask: 101, time: now - 100 }, now)).toBe(
      true,
    );
    for (const time of [now / 1000, now - 30000, now + 6000, NaN])
      expect(isFreshQuote({ bid: 100, ask: 101, time }, now)).toBe(false);
    expect(isFreshQuote({ bid: 0, ask: 101, time: now }, now)).toBe(false);
  });
  test("weekly bars intersect Monday UTC", () => {
    expect(
      new Date(
        bucketStart(Date.UTC(2026, 9, 18) / 1000, "1w") * 1000,
      ).toISOString(),
    ).toBe("2026-10-12T00:00:00.000Z");
  });
});

test("fees and fractional exits preserve integer cents at wide balances", () => {
  expect(feeCents(9007199254740991)).toBe(45035996273704);
  expect(splitAmount(100000, 33.33)).toBe(33330);
  expect(pnlCents(3000000000, 3300000000, 100000000, "buy")).toBe(10000000);
});

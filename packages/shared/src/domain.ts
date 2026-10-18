import { PRICE_SCALE, USD_SCALE } from "./constants";

export const QUOTE_MAX_AGE_MS = 30_000;
export const FEE_RATE = 0.005;
export const INTERVAL_SECONDS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400,
  "1w": 604800,
} as const;
export type CandleInterval = keyof typeof INTERVAL_SECONDS;
export type Side = "buy" | "sell";
export type ScaledPrice = number & { readonly __unit: "scaled-price" };
export type Cents = number & { readonly __unit: "cents" };
export type Milliseconds = number & { readonly __unit: "milliseconds" };
export interface Quote {
  bid: number;
  ask: number;
  time?: number;
}
export function isFreshQuote(
  quote: Quote | undefined | null,
  now = Date.now(),
): quote is Quote & { time: number } {
  return (
    !!quote &&
    Number.isSafeInteger(quote.bid) &&
    quote.bid > 0 &&
    Number.isSafeInteger(quote.ask) &&
    quote.ask >= quote.bid &&
    Number.isSafeInteger(quote.time) &&
    now - quote.time! >= -5000 &&
    now - quote.time! < QUOTE_MAX_AGE_MS
  );
}
export function pnlCents(
  open: number,
  close: number,
  notionalCents: number,
  side: Side,
): number {
  if (
    ![open, close, notionalCents].every(Number.isSafeInteger) ||
    open <= 0 ||
    close <= 0 ||
    notionalCents < 0
  )
    throw new Error("Invalid position valuation");
  const result = Number(
    (BigInt(side === "buy" ? close - open : open - close) *
      BigInt(notionalCents)) /
      BigInt(open),
  );
  if (!Number.isSafeInteger(result))
    throw new Error("Valuation exceeds safe integer cents");
  return result;
}
export function liquidationPrice(
  open: number,
  collateralCents: number,
  notionalCents: number,
  side: Side,
): number {
  if (notionalCents <= 0 || collateralCents < 0)
    throw new Error("Invalid position collateral");
  const distance = Number(
    (BigInt(open) * BigInt(collateralCents)) / BigInt(notionalCents),
  );
  return side === "buy" ? Math.max(0, open - distance) : open + distance;
}
export function feeCents(collateral: number) {
  if (!Number.isSafeInteger(collateral) || collateral < 0)
    throw new Error("Invalid fee basis");
  return Number(BigInt(collateral) / 200n);
}
export function quantity(notionalCents: number, openPrice: number) {
  return notionalCents / USD_SCALE / (openPrice / PRICE_SCALE);
}
export function bucketStart(seconds: number, interval: CandleInterval) {
  const origin = interval === "1w" ? 4 * 86400 : 0;
  return (
    Math.floor((seconds - origin) / INTERVAL_SECONDS[interval]) *
      INTERVAL_SECONDS[interval] +
    origin
  );
}
export function signedMoney(cents: number) {
  return `${cents < 0 ? "−" : cents > 0 ? "+" : ""}${money(Math.abs(cents))}`;
}
export function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / USD_SCALE);
}

export function splitAmount(total: number, percentage: number) {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100
  )
    throw new Error("Invalid partial amount");
  return Number(
    (BigInt(total) * BigInt(Math.round(percentage * 100))) / 10000n,
  );
}

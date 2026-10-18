"use client";
import { useEffect, useState } from "react";
import {
  feeCents,
  money,
  liquidationPrice,
  isFreshQuote,
} from "@orbitledger/shared";
import { useMarket, type Symbol } from "@/lib/market";
import { useAccount, useAccountMutation } from "@/lib/account";
import Protection, { type ProtectionValues } from "./ticket/Protection";
import TradePreview from "./ticket/TradePreview";
export default function BuySell({ symbol }: { symbol: Symbol }) {
  const account = useAccount();
  const market = useMarket();
  const mutation = useAccountMutation("ticket");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [margin, setMargin] = useState("");
  const [leverage, setLeverage] = useState(1);
  const [protection, setProtection] = useState<ProtectionValues>({
    tp: "",
    sl: "",
    trailing: "",
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(
    () => setProtection({ tp: "", sl: "", trailing: "" }),
    [symbol, side],
  );
  const quote = market.quotes[symbol];
  const fresh =
    market.connected &&
    isFreshQuote(
      quote && { bid: quote.bidPrice, ask: quote.askPrice, time: quote.time },
      now,
    );
  const price = quote ? (side === "buy" ? quote.askPrice : quote.bidPrice) : 0;
  const collateral = Math.round(Number(margin) * 100);
  const validAmount =
    margin !== "" &&
    Number.isFinite(collateral) &&
    collateral >= 1000 &&
    collateral <= 100000000;
  const fee = validAmount ? feeCents(collateral) : 0;
  const exposure = validAmount ? collateral * leverage : 0;
  const liq =
    price && exposure ? liquidationPrice(price, collateral, exposure, side) : 0;
  const available = account.summary?.availableCents ?? 0;
  let issue: string | null = !fresh
    ? "Waiting for a fresh market quote."
    : !validAmount
      ? "Enter collateral of at least $10 and at most $1,000,000."
      : collateral + fee > available
        ? "Collateral and opening fee exceed available cash."
        : null;
  for (const field of ["tp", "sl", "trailing"] as const) {
    const value = protection[field];
    if (!value) continue;
    const n = Number(value) * 10000;
    if (!Number.isFinite(n) || n <= 0)
      issue = "Protection prices and distances must be positive.";
    else if (field === "tp" && (side === "buy" ? n <= price : n >= price))
      issue = "Take profit must be in the profitable direction from entry.";
    else if (field === "sl" && (side === "buy" ? n >= price : n <= price))
      issue = "Stop loss must be in the loss direction from entry.";
    else if (field === "trailing" && n >= Math.abs(price - liq))
      issue = "Trailing distance must be inside the liquidation distance.";
  }
  const locked = mutation.busy || !!mutation.pending;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (issue || !account.summary) return;
    await mutation.execute("trade/open", {
      asset: symbol,
      type: side,
      margin: Number(margin),
      leverage,
      ...(protection.tp ? { takeProfit: Number(protection.tp) } : {}),
      ...(protection.sl ? { stopLoss: Number(protection.sl) } : {}),
      ...(protection.trailing
        ? {
            trailingStopLoss: {
              enabled: true,
              trailingDistance: Number(protection.trailing),
            },
          }
        : {}),
    });
  }
  return (
    <aside className="ticket surface">
      <div className="section-heading">
        <h2>Place a paper trade</h2>
        <span>Market</span>
      </div>
      <form onSubmit={submit}>
        <div className="ticket-fields">
          <fieldset disabled={locked}>
            <legend className="sr-only">Trade details</legend>
            <div className="side-tabs segmented">
              {(["buy", "sell"] as const).map((v) => (
                <button
                  type="button"
                  key={v}
                  aria-pressed={side === v}
                  onClick={() => setSide(v)}
                >
                  {v === "buy" ? "Buy / Long" : "Sell / Short"}
                </button>
              ))}
            </div>
            <div className="execution-price">
              <span>Estimated {side === "buy" ? "buy" : "sell"} price</span>
              <strong>{fresh ? money(price / 100) : "—"}</strong>
              <small>
                Simulated quote · exchange trade {side === "buy" ? "+" : "−"}
                0.5%
              </small>
            </div>
            <div className="available">
              <span>Available cash</span>
              <b>{account.summary ? money(available) : "—"}</b>
            </div>
            <label htmlFor="margin">Collateral (USD)</label>
            <input
              id="margin"
              type="number"
              inputMode="decimal"
              min="10"
              max="1000000"
              step="0.01"
              placeholder="0.00"
              value={margin}
              aria-describedby="ticket-validation"
              onChange={(e) => setMargin(e.target.value)}
            />
            <div className="shortcuts">
              {[25, 50, 75, 100].map((percent) => (
                <button
                  type="button"
                  key={percent}
                  onClick={() =>
                    setMargin(
                      (
                        Math.floor(((available / 1.005) * percent) / 100) / 100
                      ).toFixed(2),
                    )
                  }
                >
                  {percent === 100 ? "Max" : percent + "%"}
                </button>
              ))}
            </div>
            <label htmlFor="leverage">
              Leverage <b>{leverage}×</b>
            </label>
            <select
              id="leverage"
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
            >
              {[1, 5, 10, 20, 100].map((v) => (
                <option value={v} key={v}>
                  {v}×
                </option>
              ))}
            </select>
            <Protection
              values={protection}
              onChange={setProtection}
              side={side}
              exposure={exposure}
              collateral={validAmount ? collateral : 0}
              fee={fee}
              liquidation={liq}
              price={price / 10000}
            />
            <TradePreview
              margin={validAmount ? collateral : 0}
              fee={fee}
              exposure={exposure}
              price={price}
              liquidation={liq}
            />
          </fieldset>
        </div>
        <p id="ticket-validation" className={issue ? "field-error" : "muted"}>
          {issue ||
            "Isolated collateral. Gap losses are capped at reserved collateral."}
        </p>
        <button
          className="primary submit-trade"
          type="submit"
          disabled={!!issue || !account.summary || locked}
        >
          {mutation.busy
            ? "Submitting…"
            : `Place ${side === "buy" ? "long" : "short"} paper trade`}
        </button>
        {mutation.error && (
          <div className="notice error" role="alert">
            {mutation.error}
            {mutation.pending && (
              <button
                type="button"
                disabled={mutation.busy}
                onClick={() => void mutation.retry()}
              >
                Retry saved request
              </button>
            )}
          </div>
        )}
        {mutation.receipt && (
          <p className="notice success" role="status">
            Paper trade confirmed. Receipt{" "}
            <button
              type="button"
              className="receipt-link"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("orbit-open-receipt", {
                    detail: mutation.receipt?.positionId,
                  }),
                )
              }
            >
              {mutation.receipt.eventId.slice(0, 8)}
            </button>
          </p>
        )}
        <p className="ticket-disclosure">
          Virtual funds only. Quotes include a simulated spread. Opening, added
          collateral, and exits each incur a 0.5% collateral fee. Liquidation
          checks run every 5 seconds.
        </p>
      </form>
    </aside>
  );
}

"use client";
import { useEffect, useState } from "react";
import { money, signedMoney } from "@orbitledger/shared";
import {
  useAccount,
  useAccountMutation,
  type Execution,
  type AccountEvent,
} from "@/lib/account";
import { type Symbol } from "@/lib/market";
import History from "./orders/History";
import MarketTrades from "./orders/MarketTrades";
import ReceiptDialog from "./orders/ReceiptDialog";
import PositionDialog, { type PositionAction } from "./orders/PositionDialog";
import { price, date } from "./orders/format";
import { api } from "@/lib/client";
export default function OrdersPanel({ symbol }: { symbol: Symbol }) {
  const account = useAccount();
  const [tab, setTab] = useState("positions");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [action, setAction] = useState<PositionAction | null>(null);
  const mutation = useAccountMutation("positions");
  const [receipt, setReceipt] = useState<{
    id: string;
    events: AccountEvent[];
    executions: Execution[];
  } | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const positions =
    account.summary?.orders.filter(
      (p) => !selectedOnly || p.asset === symbol,
    ) ?? [];
  async function showReceipt(id: string) {
    setReceiptError(null);
    try {
      const data = await api<{
        events: AccountEvent[];
        executions: Execution[];
      }>(`trade/receipt/${encodeURIComponent(id)}`);
      setReceipt({ id, ...data });
    } catch (e) {
      setReceiptError((e as Error).message);
    }
  }
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id) void showReceipt(id);
    };
    window.addEventListener("orbit-open-receipt", open);
    return () => window.removeEventListener("orbit-open-receipt", open);
  }, []);
  return (
    <section className="account-panel surface" id="account-activity">
      <div
        className="panel-tabs"
        role="tablist"
        aria-label="Account and market activity"
      >
        {[
          ["positions", `Positions (${account.summary?.orders.length ?? "…"})`],
          ["history", "Trade history"],
          ["market", "Market trades"],
          ["activity", "Account activity"],
        ].map(([key, label]) => (
          <button
            key={key}
            id={`tab-${key}`}
            role="tab"
            aria-selected={tab === key}
            aria-controls="account-panel-content"
            tabIndex={tab === key ? 0 : -1}
            onKeyDown={(e) => {
              const keys = ["positions", "history", "market", "activity"];
              const index = keys.indexOf(key!);
              const next =
                e.key === "ArrowRight"
                  ? keys[(index + 1) % 4]
                  : e.key === "ArrowLeft"
                    ? keys[(index + 3) % 4]
                    : e.key === "Home"
                      ? keys[0]
                      : e.key === "End"
                        ? keys[3]
                        : null;
              if (next) {
                e.preventDefault();
                setTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
            onClick={() => setTab(key!)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="account-panel-content"
        aria-labelledby={`tab-${tab}`}
      >
        {tab === "positions" && (
          <>
            <div className="panel-tools">
              <label className="check">
                <input
                  type="checkbox"
                  checked={selectedOnly}
                  onChange={(e) => setSelectedOnly(e.target.checked)}
                />
                Only {symbol}
              </label>
              <span className="muted">
                {selectedOnly ? "Filtered positions" : "All account positions"}{" "}
                · USD valuation
              </span>
            </div>
            {!account.summary ? (
              <div className="empty">
                {account.loading
                  ? "Loading positions…"
                  : "Positions could not be loaded. Retry the account read above."}
              </div>
            ) : positions.length === 0 ? (
              <div className="empty">
                <h3>No open positions{selectedOnly ? ` in ${symbol}` : ""}</h3>
                <p>
                  Choose collateral and leverage in the ticket to place your
                  first paper trade.
                </p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Market / side</th>
                      <th>Remaining size</th>
                      <th>Collateral</th>
                      <th>Entry / mark</th>
                      <th>Open P&L</th>
                      <th>Manage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => (
                      <tr key={p.orderId}>
                        <td>
                          <b>{p.asset}</b>
                          <span>
                            {p.type === "buy" ? "Long" : "Short"} ·{" "}
                            {p.needsReview
                              ? "Exposure review"
                              : p.effectiveLeverage.toFixed(2) + "× effective"}
                          </span>
                        </td>
                        <td>
                          {p.needsReview
                            ? "Unavailable"
                            : p.quantity.toFixed(6) + " " + p.asset}
                          <span>
                            {p.needsReview
                              ? "Exposure awaits reconciliation"
                              : money(p.notionalCents) + " exposure"}
                          </span>
                        </td>
                        <td>
                          {money(p.margin)}
                          <span>{p.leverage}× original</span>
                        </td>
                        <td>
                          {price(p.openPrice)}
                          <span>
                            {price(p.markPrice)}
                            {p.needsReview
                              ? " · exposure review required"
                              : p.stale
                                ? " · stale"
                                : ""}
                          </span>
                        </td>
                        <td
                          className={
                            p.pnlCents === null
                              ? "muted"
                              : p.pnlCents < 0
                                ? "negative"
                                : "positive"
                          }
                        >
                          {p.pnlCents === null
                            ? "Unavailable"
                            : signedMoney(p.pnlCents)}
                          <span className="muted">Gross · before exit fee</span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              onClick={() => {
                                setAction({ kind: "close", position: p });
                              }}
                              disabled={p.stale}
                            >
                              Close
                            </button>
                            <details>
                              <summary>More</summary>
                              <div className="action-menu">
                                {(
                                  [
                                    "partial-close",
                                    "add-margin",
                                    "protection",
                                  ] as const
                                ).map((kind) => (
                                  <button
                                    key={kind}
                                    disabled={
                                      p.needsReview ||
                                      (kind !== "add-margin" && p.stale)
                                    }
                                    onClick={() => {
                                      setAction({ kind, position: p });
                                    }}
                                  >
                                    {kind === "partial-close"
                                      ? "Partial close"
                                      : kind === "add-margin"
                                        ? "Add collateral"
                                        : "Edit protection"}
                                  </button>
                                ))}
                                <button
                                  onClick={() => void showReceipt(p.orderId)}
                                >
                                  Position receipt
                                </button>
                                <p>
                                  TP {price(p.takeProfit)} · SL{" "}
                                  {price(p.stopLoss)}
                                  <br />
                                  Liquidation {price(p.liquidationPrice)}
                                  <br />
                                  Allocated costs{" "}
                                  {p.feesRecorded
                                    ? money(p.entryFeeCents)
                                    : "Unknown legacy fees"}
                                  <br />
                                  Opened {date(p.openedAt)} UTC
                                </p>
                              </div>
                            </details>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {tab === "history" && <History onReceipt={showReceipt} />}
        {tab === "market" && <MarketTrades symbol={symbol} />}
        {tab === "activity" && (
          <div className="activity-list">
            {account.events.length === 0 ? (
              <p className="empty">
                No recorded account activity yet. New trade receipts will appear
                here.
              </p>
            ) : (
              [...account.events].reverse().map((event) => (
                <button
                  key={event.id}
                  className="activity-row"
                  onClick={() => void showReceipt(event.positionId)}
                >
                  <span>
                    <b>{event.kind.replaceAll("_", " ")}</b>
                    <small>
                      {event.positionId?.slice(0, 8)} · Receipt{" "}
                      {event.id.slice(0, 8)}
                    </small>
                  </span>
                  <time>{date(event.createdAt)} UTC</time>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {receiptError && (
        <p className="notice error" role="alert">
          {receiptError}
        </p>
      )}
      {mutation.receipt && (
        <p className="notice success" role="status">
          Account updated. Receipt {mutation.receipt.eventId.slice(0, 8)}
        </p>
      )}
      <PositionDialog
        action={action}
        onClose={() => setAction(null)}
        mutation={mutation}
      />
      <ReceiptDialog receipt={receipt} onClose={() => setReceipt(null)} />
    </section>
  );
}

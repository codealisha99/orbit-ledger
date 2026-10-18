"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import EquityHistory from "@/components/EquityHistory";
import { useAccount, type Execution } from "@/lib/account";
import { api } from "@/lib/client";
import { money, signedMoney } from "@orbitledger/shared";
interface Performance {
  feesComplete: boolean;
  grossPnlCents: number;
  netPnlCents: number | null;
  entryCostsCents: number;
  exitFeesCents: number;
  completedPositions: number;
  winningPositions: number;
  executions: number;
}
export default function Dashboard() {
  const { summary, loading, error } = useAccount();
  const [recent, setRecent] = useState<Execution[]>([]);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      api<{ orders: Execution[] }>("trade/history?limit=5", {
        signal: abort.signal,
      }),
      api<Performance>("trade/performance", { signal: abort.signal }),
    ])
      .then(([history, stats]) => {
        setRecent(history.orders);
        setPerformance(stats);
        setHistoryError(null);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setHistoryError(e.message);
      });
    return () => abort.abort();
  }, [summary?.version, retry]);
  const exposure =
    summary?.orders.reduce(
      (n, p) => n + (p.needsReview ? 0 : p.notionalCents),
      0,
    ) ?? 0;
  return (
    <div className="workspace">
      <AppHeader />
      <main className="dashboard-main">
        <div className="page-heading">
          <div>
            <h1>Your paper account</h1>
            <p>Value, exposure, and the results of your decisions.</p>
          </div>
          <Link className="primary" href="/trading">
            Open trading workspace
          </Link>
        </div>
        {!summary ? (
          <div className="surface empty">
            {loading
              ? "Loading account overview…"
              : error || "Account overview is unavailable."}
          </div>
        ) : (
          <>
            <section className="account-metrics" aria-label="Account value">
              {[
                [
                  "Equity",
                  summary.equityCents,
                  "Available cash + reserved collateral + open P&L",
                ],
                [
                  "Available cash",
                  summary.availableCents,
                  "Ready to reserve for a new position",
                ],
                [
                  "Reserved collateral",
                  summary.reservedCents,
                  `${summary.orders.length} open position${summary.orders.length === 1 ? "" : "s"}`,
                ],
                [
                  "Open P&L",
                  summary.openPnlCents,
                  "Gross valuation before exit costs",
                ],
              ].map(([label, value, description]) => (
                <div className="metric" key={String(label)}>
                  <span>{label}</span>
                  <strong
                    className={
                      label === "Open P&L" && typeof value === "number"
                        ? value < 0
                          ? "negative"
                          : "positive"
                        : ""
                    }
                  >
                    {typeof value === "number"
                      ? label === "Open P&L"
                        ? signedMoney(value)
                        : money(value)
                      : "Unavailable"}
                  </strong>
                  <small>{description}</small>
                </div>
              ))}
            </section>
            <p className="valuation-note">
              {summary.orders.some((p) => p.needsReview)
                ? "Historical exposure needs reconciliation. Equity and aggregate open P&L are unavailable until reviewed."
                : summary.stale
                  ? "Some market quotes are stale. Equity and open P&L remain unavailable until every open position has a fresh quote."
                  : `Valued using simulated close quotes · ${new Date(summary.valuedAt).toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC`}
            </p>
            <EquityHistory />
            <div className="dashboard-columns">
              <section className="surface exposure-panel">
                <div className="section-heading">
                  <h2>Exposure & risk</h2>
                  <span>{money(exposure)} verified notional</span>
                </div>
                {summary.orders.length === 0 ? (
                  <p className="empty">
                    No market exposure. Your virtual cash is available for
                    practice.
                  </p>
                ) : (
                  <>
                    {summary.orders.some((p) => p.needsReview) && (
                      <p className="notice error">
                        Some historical exposure is unverified. Totals include
                        verified positions only.
                      </p>
                    )}
                    {["BTC", "ETH", "SOL"].map((asset) => {
                      const positions = summary.orders.filter(
                        (p) => p.asset === asset && !p.needsReview,
                      );
                      const total = positions.reduce(
                        (n, p) => n + p.notionalCents,
                        0,
                      );
                      return (
                        total > 0 && (
                          <div key={asset} className="exposure-row">
                            <div>
                              <b>{asset}</b>
                              <span>
                                {money(total)} ·{" "}
                                {((total / exposure) * 100).toFixed(1)}%
                              </span>
                            </div>
                            <meter
                              min="0"
                              max={exposure}
                              value={total}
                              aria-label={`${asset} notional exposure`}
                            />
                            <small>
                              {money(
                                positions.reduce((n, p) => n + p.margin, 0),
                              )}{" "}
                              collateral ·{" "}
                              {positions.filter((p) => p.type === "buy").length}{" "}
                              long /{" "}
                              {
                                positions.filter((p) => p.type === "sell")
                                  .length
                              }{" "}
                              short
                            </small>
                          </div>
                        )
                      );
                    })}
                    <div className="risk-notice">
                      {
                        summary.orders.filter(
                          (p) => !p.stopLoss && !p.trailingStopLossEnabled,
                        ).length
                      }{" "}
                      positions without a stop loss. Stops cannot guarantee an
                      execution price.
                    </div>
                    <h3>Distance to liquidation</h3>
                    {summary.orders.map((p) => (
                      <div className="risk-row" key={p.orderId}>
                        <span>
                          {p.asset} {p.type === "buy" ? "long" : "short"}
                        </span>
                        <b>
                          {p.markPrice
                            ? `${Math.max(0, ((p.type === "buy" ? p.markPrice - p.liquidationPrice : p.liquidationPrice - p.markPrice) / p.markPrice) * 100).toFixed(2)}%`
                            : "Quote unavailable"}
                        </b>
                      </div>
                    ))}
                  </>
                )}
              </section>
              <section className="surface performance-panel">
                <div className="section-heading">
                  <h2>Realised performance</h2>
                </div>
                {historyError ? (
                  <p className="notice error">
                    {historyError}
                    <button onClick={() => setRetry((n) => n + 1)}>
                      Retry performance
                    </button>
                  </p>
                ) : !performance ? (
                  <p className="empty">Loading completed trades…</p>
                ) : (
                  <>
                    <div
                      className={`performance-total ${performance.netPnlCents !== null && performance.netPnlCents < 0 ? "negative" : "positive"}`}
                    >
                      {performance.feesComplete &&
                      performance.netPnlCents !== null
                        ? signedMoney(performance.netPnlCents)
                        : "Legacy costs unavailable"}
                    </div>
                    <p className="muted">
                      Net realised P&L, including allocated entry costs and exit
                      fees. Net reporting is unavailable when legacy records
                      have unknown fees.
                    </p>
                    <dl className="trade-preview">
                      <div>
                        <dt>Gross realised P&L</dt>
                        <dd>{signedMoney(performance.grossPnlCents)}</dd>
                      </div>
                      <div>
                        <dt>Allocated entry costs</dt>
                        <dd>{money(performance.entryCostsCents)}</dd>
                      </div>
                      <div>
                        <dt>Exit fees</dt>
                        <dd>{money(performance.exitFeesCents)}</dd>
                      </div>
                      <div>
                        <dt>Completed positions</dt>
                        <dd>{performance.completedPositions}</dd>
                      </div>
                      <div>
                        <dt>Winning completed positions</dt>
                        <dd>
                          {performance.feesComplete &&
                          performance.completedPositions
                            ? `${((performance.winningPositions / performance.completedPositions) * 100).toFixed(1)}%`
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                    <p className="muted">
                      Win rate groups partial exits with their parent and
                      excludes positions still open.
                    </p>
                  </>
                )}
              </section>
            </div>
            <section className="surface">
              <div className="section-heading">
                <h2>Current positions</h2>
                <Link href="/trading">Manage positions</Link>
              </div>
              {summary.orders.length === 0 ? (
                <p className="empty">
                  No open positions. Choose a market in the trading workspace to
                  begin.
                </p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Market / side</th>
                        <th>Quantity</th>
                        <th>Collateral</th>
                        <th>Entry / current</th>
                        <th>Open P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.orders.map((p) => (
                        <tr key={p.orderId}>
                          <td>
                            <b>{p.asset}</b>
                            <span>
                              {p.type === "buy" ? "Long" : "Short"} ·{" "}
                              {p.needsReview
                                ? "Exposure review"
                                : p.effectiveLeverage.toFixed(2) +
                                  "× effective"}
                            </span>
                          </td>
                          <td>
                            {p.needsReview
                              ? "Unavailable"
                              : p.quantity.toFixed(6)}
                          </td>
                          <td>{money(p.margin)}</td>
                          <td>
                            {money(p.openPrice / 100)}
                            <span>
                              {p.markPrice
                                ? money(p.markPrice / 100)
                                : p.needsReview
                                  ? "Exposure review required"
                                  : "Stale quote"}
                            </span>
                          </td>
                          <td
                            className={
                              p.pnlCents !== null && p.pnlCents < 0
                                ? "negative"
                                : "positive"
                            }
                          >
                            {p.pnlCents === null
                              ? "Unavailable"
                              : signedMoney(p.pnlCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="surface">
              <div className="section-heading">
                <h2>Recent completed trades</h2>
                <Link href="/trading#account-activity">Full trade history</Link>
              </div>
              {historyError ? (
                <p className="notice error">
                  {historyError}
                  <button onClick={() => setRetry((n) => n + 1)}>
                    Retry trades
                  </button>
                </p>
              ) : recent.length === 0 ? (
                <p className="empty">
                  Completed exits and their receipts will appear here.
                </p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Market / side</th>
                        <th>Closed (UTC)</th>
                        <th>Reason</th>
                        <th>Gross / net P&L</th>
                        <th>Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((o) => (
                        <tr key={o.orderId}>
                          <td>
                            <b>{o.asset}</b>
                            <span>{o.type === "buy" ? "Long" : "Short"}</span>
                          </td>
                          <td>
                            {new Date(o.closedAt).toLocaleString("en-GB", {
                              timeZone: "UTC",
                            })}
                          </td>
                          <td>{o.closeReason.replaceAll("_", " ")}</td>
                          <td
                            className={
                              o.netPnlCents !== null && o.netPnlCents < 0
                                ? "negative"
                                : "positive"
                            }
                          >
                            {signedMoney(o.pnl)} /{" "}
                            {o.feesRecorded && o.netPnlCents !== null
                              ? signedMoney(o.netPnlCents)
                              : "Unknown fees"}
                          </td>
                          <td>{o.orderId.slice(0, 8)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
        <footer className="app-footer">
          Paper trading with virtual USD collateral. No deposits, withdrawals,
          or real exchange orders.
        </footer>
      </main>
    </div>
  );
}

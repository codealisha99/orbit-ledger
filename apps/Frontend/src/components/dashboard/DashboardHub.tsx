"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Star,
  Plus,
  ArrowUpRight,
  Bell,
  Check,
  RotateCcw,
  X,
} from "lucide-react";
import { money, isFreshQuote } from "@orbitledger/shared";
import { api } from "@/lib/client";
import { useWorkspace } from "@/lib/workspace";
import { useMarket, type Symbol } from "@/lib/market";
import EquityHistory from "../EquityHistory";
import AlertDialog from "./AlertDialog";
interface Stat {
  symbol: Symbol;
  last: number;
  changePercent: number;
  volume: number;
}
const names = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana" };
export default function DashboardHub({
  hasPosition,
  hasExit,
}: {
  hasPosition: boolean;
  hasExit: boolean;
}) {
  const workspace = useWorkspace();
  const market = useMarket();
  const [stats, setStats] = useState<Stat[]>([]);
  const [statsError, setStatsError] = useState(false);
  const [paths, setPaths] = useState<Partial<Record<Symbol, number[]>>>({});
  const [filter, setFilter] = useState<"all" | "saved">("all");
  const [dialog, setDialog] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const abort = new AbortController();
    const load = () =>
      api<{ markets: Stat[] }>("asset/stats", { signal: abort.signal })
        .then((v) => {
          setStats(v.markets);
          setStatsError(false);
        })
        .catch(() => {
          if (!abort.signal.aborted) setStatsError(true);
        });
    void load();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    const endTime = Math.floor(Date.now() / 1000);
    for (const symbol of ["BTC", "ETH", "SOL"] as const)
      void api<{ candles: { close: number }[] }>(
        `asset/candles?asset=${symbol}&ts=1h&startTime=${endTime - 7 * 86400}&endTime=${endTime}`,
        { signal: abort.signal },
      )
        .then((v) =>
          setPaths((p) => ({ ...p, [symbol]: v.candles.map((c) => c.close) })),
        )
        .catch(() => {});
    return () => {
      abort.abort();
      clearInterval(timer);
      clearInterval(clock);
    };
  }, []);
  function toggle(symbol: Symbol) {
    void workspace.save("user/workspace/watchlist", {
      asset: symbol,
      watching: !workspace.data?.watchlist.includes(symbol),
    });
  }
  const watched = workspace.data?.watchlist ?? [];
  const shown = (["BTC", "ETH", "SOL"] as const).filter(
    (s) => filter === "all" || watched.includes(s),
  );
  return (
    <>
      <section
        id="main-markets"
        className="market-overview"
        aria-label="Market overview"
      >
        <div className="hub-heading">
          <div>
            <h2>Make the market your own.</h2>
            <p>Three markets to explore. Save the ones you want to follow.</p>
          </div>
          <div className="segmented">
            <button
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All markets
            </button>
            <button
              aria-pressed={filter === "saved"}
              onClick={() => setFilter("saved")}
            >
              Saved ({watched.length})
            </button>
          </div>
        </div>
        {workspace.error && (
          <div className="notice error" role="alert">
            {workspace.error}{" "}
            <button onClick={workspace.retry}>Retry saved workspace</button>
          </div>
        )}
        <div className="market-cards">
          {shown.map((symbol) => {
            const quote = market.quotes[symbol];
            const fresh =
              market.connected &&
              isFreshQuote(
                quote && {
                  bid: quote.bidPrice,
                  ask: quote.askPrice,
                  time: quote.time,
                },
                now,
              );
            const stat = stats.find((s) => s.symbol === symbol);
            const samples = paths[symbol] ?? [];
            const low = Math.min(...samples),
              high = Math.max(...samples);
            const points = samples
              .map(
                (p, i) =>
                  `${(i / (samples.length - 1)) * 180},${44 - ((p - low) / Math.max(high - low, 0.00001)) * 40}`,
              )
              .join(" ");
            return (
              <article
                className={`market-card market-${symbol.toLowerCase()}`}
                key={symbol}
              >
                <div className="market-card-heading">
                  <span className="coin-symbol">
                    {symbol === "BTC" ? "₿" : symbol === "ETH" ? "Ξ" : "◎"}
                  </span>
                  <div>
                    <h3>{names[symbol]}</h3>
                    <span>{symbol} / USDT</span>
                  </div>
                  <button
                    className="icon-button watch-toggle"
                    aria-label={`${watched.includes(symbol) ? "Remove" : "Add"} ${names[symbol]} ${watched.includes(symbol) ? "from" : "to"} watchlist`}
                    aria-pressed={watched.includes(symbol)}
                    disabled={!workspace.data || workspace.busy}
                    onClick={() => toggle(symbol)}
                  >
                    <Star
                      size={17}
                      fill={watched.includes(symbol) ? "currentColor" : "none"}
                    />
                  </button>
                </div>
                <div className="market-card-price">
                  <strong>
                    {fresh
                      ? money(Math.round(quote!.price / 100))
                      : stat && !statsError
                        ? money(Math.round(stat.last * 100))
                        : "Unavailable"}
                  </strong>
                  <span
                    className={
                      stat && stat.changePercent < 0 ? "negative" : "positive"
                    }
                  >
                    {stat && !statsError
                      ? `${stat.changePercent >= 0 ? "+" : ""}${stat.changePercent.toFixed(2)}%`
                      : "—"}
                    <small>24h</small>
                  </span>
                </div>
                <div className="market-card-chart">
                  {samples.length > 1 ? (
                    <svg
                      viewBox="0 0 180 48"
                      role="img"
                      aria-label={`${names[symbol]} available hourly history over the past seven days`}
                    >
                      <polyline
                        points={points}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  ) : (
                    <span className="muted">Historical chart unavailable</span>
                  )}
                </div>
                <div className="market-card-foot">
                  <span className={fresh ? "source-fresh" : "muted"}>
                    {fresh
                      ? "Exchange connected"
                      : stat && !statsError
                        ? "24h price snapshot"
                        : "Waiting for market"}
                  </span>
                  <Link href={`/trading?market=${symbol}`}>
                    Trade {symbol}
                    <ArrowUpRight size={14} />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
        {shown.length === 0 && (
          <div className="surface empty">
            <Star size={22} />
            <h3>Your shortlist starts here</h3>
            <p>Save a market with its star to find it here across devices.</p>
            <button onClick={() => setFilter("all")}>Browse markets</button>
          </div>
        )}
      </section>
      <div className="dashboard-hub-grid">
        <EquityHistory />
        <aside className="surface watchlist-panel">
          <div className="section-heading">
            <div>
              <h2>Your watchlist</h2>
              <p>Saved to your account</p>
            </div>
            <Star size={17} />
          </div>
          {!workspace.data ? (
            <div className="empty">
              {workspace.error
                ? "Workspace unavailable"
                : "Loading your saved markets…"}
            </div>
          ) : watched.length === 0 ? (
            <div className="watchlist-empty">
              <h3>Keep a closer watch.</h3>
              <p>
                Choose a market below. Your shortlist follows you when you sign
                in again.
              </p>
              <div>
                {(["BTC", "ETH", "SOL"] as const).map((s) => (
                  <button
                    key={s}
                    disabled={workspace.busy}
                    onClick={() => toggle(s)}
                  >
                    <Plus size={13} />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            watched.map((s) => (
              <div className="saved-market" key={s}>
                <Link href={`/trading?market=${s}`}>
                  <b>{s}</b>
                  <span>{names[s]}</span>
                  <ArrowUpRight size={16} />
                </Link>
                <button
                  className="icon-button"
                  aria-label={`Remove ${names[s]} from watchlist`}
                  disabled={workspace.busy}
                  onClick={() => toggle(s)}
                >
                  <X size={14} />
                </button>
              </div>
            ))
          )}
          <div className="watch-alert-header">
            <h3>
              <Bell size={15} />
              Price alerts
            </h3>
            <button
              className="quiet"
              onClick={() => setDialog(true)}
              disabled={
                !workspace.data ||
                workspace.busy ||
                workspace.data.alerts.length >= 12
              }
            >
              <Plus size={14} />
              Add alert
            </button>
          </div>
          {workspace.data?.alerts.length === 0 && (
            <p className="alert-empty">
              Have a level in mind? Save an alert and we’ll flag it here when a
              fresh price meets it.
            </p>
          )}
          <div className="saved-alerts">
            {workspace.data?.alerts.map((a) => (
              <div
                className={`saved-alert ${a.triggeredAt ? "triggered" : ""}`}
                key={a.id}
              >
                <div>
                  <b>
                    {a.asset} {a.direction === "above" ? "≥" : "≤"} $
                    {a.targetPrice.toLocaleString("en-US", {
                      maximumFractionDigits: 4,
                    })}
                  </b>
                  <small>
                    {a.triggeredAt
                      ? `Reached ${new Date(a.triggeredAt).toLocaleString()}`
                      : "Watching your level"}
                  </small>
                </div>
                {a.triggeredAt && (
                  <button
                    className="icon-button"
                    aria-label={`Rearm ${a.asset} alert`}
                    disabled={workspace.busy}
                    onClick={() =>
                      void workspace.save(`user/workspace/alerts/${a.id}`, {
                        action: "rearm",
                      })
                    }
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Remove ${a.asset} alert`}
                  disabled={workspace.busy}
                  onClick={() =>
                    void workspace.save(`user/workspace/alerts/${a.id}`, {
                      action: "remove",
                    })
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <p className="alert-scope">
            Checked every 10s while Dashboard is open. In-app only; never places
            a trade.
          </p>
        </aside>
      </div>
      {!hasExit && (
        <section className="getting-started surface">
          <div>
            <span className="setup-icon">
              <Check size={20} />
            </span>
            <div>
              <h2>A good place to start.</h2>
              <p>Build your first complete paper trading journey.</p>
            </div>
          </div>
          <div className="setup-steps">
            {[
              {
                done: watched.length > 0,
                label: "Save a market",
                href: "#main-markets",
              },
              {
                done: hasPosition || hasExit,
                label: "Open a paper position",
                href: "/trading",
              },
              {
                done: hasExit,
                label: "Close and review your trade",
                href: "/trading?tab=history#account-activity",
              },
            ].map((s, i) => (
              <Link
                key={s.label}
                href={s.href}
                className={s.done ? "done" : ""}
              >
                <span>{s.done ? <Check size={13} /> : i + 1}</span>
                {s.label}
                <ArrowUpRight size={13} />
              </Link>
            ))}
          </div>
        </section>
      )}
      {dialog && (
        <AlertDialog
          onClose={() => setDialog(false)}
          onSave={(body) => workspace.save("user/workspace/alerts", body)}
          busy={workspace.busy}
          error={workspace.error}
        />
      )}
    </>
  );
}

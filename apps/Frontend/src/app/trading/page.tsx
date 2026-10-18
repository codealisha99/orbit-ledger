"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { isFreshQuote, money, type CandleInterval } from "@orbitledger/shared";
import AppHeader from "@/components/AppHeader";
import Chart, {
  defaultInterval,
  type Range,
  rangeDays,
} from "@/components/Chart";
import BuySell from "@/components/BuySell";
import OrdersPanel from "@/components/OrdersPanel";
import { useMarket, type Symbol } from "@/lib/market";
import { useAccount } from "@/lib/account";
import { api } from "@/lib/client";
interface Stat {
  symbol: Symbol;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
}
export default function TradingPage() {
  return (
    <Suspense
      fallback={<div className="empty">Loading trading workspace…</div>}
    >
      <Trading />
    </Suspense>
  );
}
function Trading() {
  const params = useSearchParams();
  const router = useRouter();
  const market = useMarket();
  const account = useAccount();
  const [stats, setStats] = useState<Stat[]>([]);
  const [now, setNow] = useState(Date.now());
  const rawSymbol = params.get("market");
  const symbol: Symbol =
    rawSymbol === "ETH" || rawSymbol === "SOL" ? rawSymbol : "BTC";
  const range = (
    params.get("range") &&
    Object.prototype.hasOwnProperty.call(rangeDays, params.get("range") ?? "")
      ? params.get("range")
      : "1D"
  ) as Range;
  const interval = (
    ["1m", "5m", "15m", "1h", "4h", "1d", "1w"].includes(
      params.get("interval") ?? "",
    )
      ? params.get("interval")
      : defaultInterval[range]
  ) as CandleInterval;
  const style = params.get("style") === "line" ? "line" : "candles";
  useEffect(() => {
    if (!location.search) {
      const saved = localStorage.getItem("orbit-chart-preferences");
      if (saved) router.replace(`/trading?${saved}`, { scroll: false });
    }
  }, [router]);
  useEffect(() => {
    localStorage.setItem("orbit-chart-preferences", params.toString());
  }, [params]);
  useEffect(() => {
    let active = true;
    const load = () =>
      api<{ markets: Stat[] }>("asset/stats")
        .then((data) => {
          if (active) setStats(data.markets);
        })
        .catch(() => {
          if (active) setStats([]);
        });
    void load();
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    const statTimer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
      clearInterval(statTimer);
    };
  }, []);
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    Object.entries(values).forEach(([key, value]) => next.set(key, value));
    router.push(`/trading?${next}`, { scroll: false });
  }
  const quote = market.quotes[symbol];
  const fresh =
    market.connected &&
    isFreshQuote(
      quote && { bid: quote.bidPrice, ask: quote.askPrice, time: quote.time },
      now,
    );
  const stat = stats.find((s) => s.symbol === symbol);
  return (
    <div className="workspace">
      <AppHeader />
      <main className="trade-main">
        <section className="market-summary" aria-label="Selected market">
          <label className="market-select">
            <span>Market</span>
            <select
              aria-label="Market"
              value={symbol}
              onChange={(e) => update({ market: e.target.value })}
            >
              {["BTC", "ETH", "SOL"].map((s) => (
                <option value={s} key={s}>
                  {s} / USDT
                </option>
              ))}
            </select>
          </label>
          <div className="market-last">
            <span>Last exchange trade</span>
            <strong>{fresh && quote ? money(quote.price / 100) : "—"}</strong>
            <small className={fresh ? "positive" : "muted"}>
              {fresh
                ? `Updated ${Math.max(0, Math.floor((now - quote!.time) / 1000))}s ago`
                : "Feed unavailable or stale"}
            </small>
          </div>
          <div>
            <span>24h change</span>
            <b
              className={
                stat && stat.changePercent < 0 ? "negative" : "positive"
              }
            >
              {stat
                ? `${stat.changePercent >= 0 ? "+" : ""}${stat.changePercent.toFixed(2)}%`
                : "—"}
            </b>
          </div>
          <div className="market-extra">
            <span>24h high / low</span>
            <b>
              {stat
                ? `${money(stat.high * 100)} / ${money(stat.low * 100)}`
                : "Unavailable"}
            </b>
          </div>
          <div className="market-extra">
            <span>24h volume (USDT)</span>
            <b>
              {stat
                ? Intl.NumberFormat("en-US", {
                    notation: "compact",
                    maximumFractionDigits: 2,
                  }).format(stat.volume)
                : "Unavailable"}
            </b>
          </div>
          <span className={`connection ${fresh ? "healthy" : ""}`}>
            <i />
            {fresh ? "Market connected" : "Waiting for market"}
          </span>
        </section>
        <div className="trading-grid">
          <div className="chart-and-positions">
            <Chart
              symbol={symbol}
              interval={interval}
              range={range}
              style={style}
              onInterval={(v) => update({ interval: v })}
              onRange={(v) =>
                update({ range: v, interval: defaultInterval[v] })
              }
              onStyle={(v) => update({ style: v })}
              positions={account.summary?.orders}
            />
            <OrdersPanel symbol={symbol} />
          </div>
          <BuySell symbol={symbol} />
        </div>
      </main>
    </div>
  );
}

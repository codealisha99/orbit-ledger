"use client";
import { useEffect, useState } from "react";
import { useMarket, type Symbol, type Print } from "@/lib/market";
import { api } from "@/lib/client";
import { price } from "./format";
export default function MarketTrades({ symbol }: { symbol: Symbol }) {
  const market = useMarket();
  const [snapshot, setSnapshot] = useState<Print[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<Print[]>([]);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setSnapshot([]);
    setPaused(false);
    setFrozen([]);
    api<{ trades: Print[] }>(`asset/trades?asset=${symbol}`, {
      signal: abort.signal,
    })
      .then((data) => {
        if (abort.signal.aborted) return;
        setSnapshot(data.trades);
        setError(null);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [symbol, market.reconnects, retry]);
  const all = [...(market.trades[symbol] ?? []), ...snapshot]
    .filter((t) => t.symbol === symbol)
    .filter((t, i, a) => a.findIndex((x) => x.tradeId === t.tradeId) === i)
    .sort((a, b) => b.time - a.time)
    .slice(0, 100);
  const rows = paused ? frozen : all;
  return (
    <>
      <div className="panel-tools">
        <span>Binance public executions · {symbol}/USDT</span>
        <button
          onClick={() => {
            if (!paused) setFrozen(all);
            setPaused(!paused);
          }}
        >
          {paused ? "Resume tape" : "Pause tape"}
        </button>
        <span className="muted">
          {!market.connected
            ? "Disconnected; a gap may exist."
            : market.reconnects > 1
              ? "Reconnected; recent prints restored. Older gaps may remain."
              : "Exchange timestamps · UTC"}
        </span>
      </div>
      {error && (
        <p className="notice error">
          {error}{" "}
          <button onClick={() => setRetry((n) => n + 1)}>Retry prints</button>
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Exchange time (UTC)</th>
              <th>Price</th>
              <th>Quantity ({symbol})</th>
              <th>Trade ID</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.tradeId}>
                <td>{new Date(t.time).toISOString().slice(11, 23)}</td>
                <td>{price(t.price)}</td>
                <td>{t.quantity}</td>
                <td>{t.tradeId}</td>
                <td>{t.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="empty">Waiting for genuine market executions.</p>
        )}
      </div>
    </>
  );
}

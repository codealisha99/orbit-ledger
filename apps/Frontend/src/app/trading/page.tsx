"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import ChartComponent from "@/components/Chart";
import { Channels, Duration } from "@/utils/constants";
import type { SYMBOL } from "@/utils/constants";
import { findUserAmount } from "@/api/trade";
import OrdersPanel from "@/components/OrdersPanel";
import BuySell from "@/components/BuySell";
import { toDisplayPrice } from "@/utils/utils";
import { subscribePrices, type LivePrices } from "@/utils/price_store";
import toast from "react-hot-toast";

export default function Trading() {
  const [duration, setDuration] = useState<Duration>(Duration.candles_1m);
  const [symbol, setSymbol] = useState<SYMBOL>(Channels.BTCUSDT);
  const [prices, setPrices] = useState({ askPrice: 0, bidPrice: 0 });
  const [priceChanges, setPriceChanges] = useState<Record<string, number>>({});
  const [marketPrices, setMarketPrices] = useState<LivePrices>({ BTC: { bid: 0, ask: 0 }, ETH: { bid: 0, ask: 0 }, SOL: { bid: 0, ask: 0 } });
  const openPricesRef = useRef<Record<string, number>>({});
  const refreshOrdersRef = useRef<(() => void) | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function checkdata() {
      try {
        const data = await findUserAmount();
        if (!data || !data.balance || data.error) {
          localStorage.removeItem("token");
          localStorage.removeItem("userID");
          router.push("/signin");
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
        localStorage.removeItem("token");
        localStorage.removeItem("userID");
        router.push("/signin");
      }
    }
    checkdata();
  }, [router]);

  useEffect(() => {
    return subscribePrices((livePrices: LivePrices) => {
      setMarketPrices(livePrices);
      const symbols: Array<keyof LivePrices> = ["BTC", "ETH", "SOL"];
      symbols.forEach((sym) => {
        const bid = livePrices[sym].bid;
        if (bid <= 0) return;
        if (!(sym in openPricesRef.current)) {
          openPricesRef.current = { ...openPricesRef.current, [sym]: bid };
        }
        const openBid = openPricesRef.current[sym];
        if (openBid > 0) {
          const pct = ((bid - openBid) / openBid) * 100;
          setPriceChanges((prev) => ({ ...prev, [sym]: pct }));
        }
      });
    });
  }, []);

  useEffect(() => {
    const WS_URL = process.env.NEXT_PUBLIC_WEBSOCKET_URL || "ws://localhost:8080";
    const wsRef: { current: WebSocket | null } = { current: null };
    const retryCountRef = { current: 0 };
    const MAX_RETRIES = 5;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;

    function connect() {
      const token = localStorage.getItem("token");
      if (!token || !isMounted) return;

      const websocket = new WebSocket(WS_URL);
      wsRef.current = websocket;

      websocket.onopen = () => {
        websocket.send(JSON.stringify({ type: "AUTH", token }));
      };

      websocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          switch (message.type) {
            case "AUTHENTICATED":
              retryCountRef.current = 0;
              toast("Connected to live updates", { duration: 1500, icon: "🔔" });
              break;

            case "ORDER_OPENED":
              const openedOrder = message.data;
              toast.success(
                `Order Opened: ${openedOrder.type.toUpperCase()} ${openedOrder.asset} at $${openedOrder.openPrice.toFixed(2)}`,
                { duration: 5000 }
              );
              findUserAmount().catch(console.error);
              if (refreshOrdersRef.current) refreshOrdersRef.current();
              break;

            case "ORDER_CLOSED":
              const closedOrder = message.data;
              const pnl = closedOrder.pnl || 0;
              const pnlColor = pnl >= 0 ? "text-green-400" : "text-red-400";

              toast.custom(
                (t) => (
                  <div className={`${t.visible ? "animate-enter" : "animate-leave"} max-w-md w-full bg-[var(--nt-surface2)] shadow-lg rounded-xl pointer-events-auto flex ring-1 ring-[var(--nt-border)]`}>
                    <div className="flex-1 w-0 p-4">
                      <div className="flex items-start">
                        <div className="ml-3 flex-1">
                          <p className="text-sm font-medium text-[var(--nt-text)]">Order Closed</p>
                          <p className="mt-1 text-sm text-[var(--nt-muted)]">
                            {closedOrder.asset} {closedOrder.type.toUpperCase()} closed at ${closedOrder.closePrice?.toFixed(2)}
                          </p>
                          <p className={`mt-1 text-sm font-bold ${pnlColor}`}>
                            PnL: {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex border-l border-[var(--nt-border)]">
                      <button
                        onClick={() => toast.dismiss(t.id)}
                        className="w-full border border-transparent rounded-none rounded-r-xl p-4 flex items-center justify-center text-sm font-medium text-[var(--nt-muted)] hover:text-[var(--nt-text)] focus:outline-none"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                ),
                { duration: 6000 }
              );
              findUserAmount().catch(console.error);
              if (refreshOrdersRef.current) refreshOrdersRef.current();
              break;

            case "ORDER_LIQUIDATED":
              const liquidatedOrder = message.data;
              toast.error(
                `Order Liquidated: ${liquidatedOrder.asset} ${liquidatedOrder.type.toUpperCase()} at $${liquidatedOrder.closePrice?.toFixed(2)}`,
                { duration: 6000 }
              );
              findUserAmount().catch(console.error);
              if (refreshOrdersRef.current) refreshOrdersRef.current();
              break;

            case "PRICE_UPDATE":
              break;

            case "UNAUTHENTICATED":
              toast.error("Live updates disconnected. Please sign in again.");
              break;

            default:
              break;
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      websocket.onerror = () => {
        // onclose will fire after onerror and handle reconnect
      };

      websocket.onclose = () => {
        if (!isMounted) return;
        if (retryCountRef.current < MAX_RETRIES) {
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
          retryCountRef.current += 1;
          reconnectTimer = setTimeout(connect, delay);
        } else {
          toast.error("Lost connection to live updates.", { duration: 5000 });
        }
      };
    }

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <main className="min-h-screen bg-[var(--nt-bg)] text-[var(--nt-text)]">
      <div className="mx-auto flex min-h-screen max-w-[1920px] flex-col gap-3 p-3 md:p-4">
        <header className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--nt-border)] bg-[var(--nt-surface)] py-3 pl-3 pr-14 md:pl-4 md:pr-14">
          <a href="/" className="flex min-h-10 items-center gap-2 pr-2 text-[var(--nt-text)]" aria-label="OrbitLedger home">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--nt-accent)] text-sm font-bold text-white">O</span>
            <span className="font-semibold tracking-tight">OrbitLedger</span>
          </a>

          <div className="grid w-full min-w-0 grid-cols-3 gap-2 sm:flex-1">
            {([
              { channel: Channels.BTCUSDT, base: "BTC" },
              { channel: Channels.ETHUSDT, base: "ETH" },
              { channel: Channels.SOLUSDT, base: "SOL" },
            ] as const).map(({ channel, base }) => {
              const pct = priceChanges[base];
              const change = pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—";
              const up = pct == null || pct >= 0;
              const quote = marketPrices[base];
              return (
                <button
                  key={channel}
                  type="button"
                  aria-pressed={symbol === channel}
                  onClick={() => setSymbol(channel)}
                  className={`min-w-0 rounded-lg border px-2.5 py-2 text-left transition-colors md:px-3 ${symbol === channel ? "border-[var(--nt-accent)] bg-[var(--nt-surface2)]" : "border-transparent hover:bg-[var(--nt-surface2)]"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold md:text-sm">{base}/USDT</span>
                    <span className={`hidden rounded px-1.5 py-0.5 text-[10px] sm:inline ${up ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>{change}</span>
                  </span>
                  <span className="mt-1 block truncate font-mono text-xs text-[var(--nt-muted)] md:text-sm">
                    {quote.bid > 0 ? `$${toDisplayPrice(quote.bid)}` : "Waiting for price"}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-[var(--nt-border)] pt-2 sm:w-auto sm:border-0 sm:pt-0">
            <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-[var(--nt-surface2)] p-1" role="group" aria-label="Chart interval">
              {([
                { d: Duration.candles_1m, label: "1m" }, { d: Duration.candles_5m, label: "5m" },
                { d: Duration.candles_15m, label: "15m" }, { d: Duration.candles_1h, label: "1h" },
                { d: Duration.candles_4h, label: "4h" }, { d: Duration.candles_1d, label: "1d" },
                { d: Duration.candles_1w, label: "1w" },
              ] as const).map(({ d, label }) => (
                <button key={d} type="button" aria-pressed={duration === d} onClick={() => setDuration(d)}
                  className={`min-h-9 rounded-md px-2 text-xs font-medium transition-colors ${duration === d ? "bg-[var(--nt-bg)] text-[var(--nt-text)] shadow-sm" : "text-[var(--nt-muted)] hover:text-[var(--nt-text)]"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => router.push("/dashboard")} className="min-h-10 rounded-lg px-3 text-sm text-[var(--nt-muted)] transition-colors hover:bg-[var(--nt-surface2)] hover:text-[var(--nt-text)]">Dashboard</button>
              <button type="button" onClick={() => { localStorage.removeItem("token"); localStorage.removeItem("userID"); router.push("/signin"); }} className="min-h-10 rounded-lg px-3 text-sm text-[var(--nt-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400">Log out</button>
            </div>
          </div>
        </header>

        <div className="grid min-h-[calc(100vh-112px)] flex-1 grid-cols-1 gap-3 lg:h-[calc(100vh-112px)] lg:min-h-[620px] lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="grid min-h-[620px] min-w-0 grid-rows-[minmax(340px,1.8fr)_minmax(240px,1fr)] gap-3 lg:min-h-0" aria-label="Market workspace">
            <ChartComponent symbol={symbol} duration={duration} onPriceUpdate={setPrices} />
            <OrdersPanel onRefreshReady={(fn) => { refreshOrdersRef.current = fn; }} />
          </section>

          <div className="min-h-[620px] min-w-0 lg:min-h-0">
            <BuySell
              symbol={symbol}
              askPrice={toDisplayPrice(prices.askPrice)}
              bidPrice={toDisplayPrice(prices.bidPrice)}
              onOrderPlaced={refreshOrdersRef.current || undefined}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

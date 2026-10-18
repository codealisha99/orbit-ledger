"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import ChartComponent from "@/components/Chart";
import { Channels, Duration } from "@/utils/constants";
import type { SYMBOL } from "@/utils/constants";
import AskBids from "@/components/AskBidsTable";
import { findUserAmount } from "@/api/trade";
import OrdersPanel from "@/components/OrdersPanel";
import BuySell from "@/components/BuySell";
import { toDisplayPrice } from "@/utils/utils";
import { fetchPlatformProfit, type PlatformProfitResponse } from "@/api/profit";
import { subscribePrices, type LivePrices } from "@/utils/price_store";
import toast from "react-hot-toast";

export default function Trading() {
  const [duration, setDuration] = useState<Duration>(Duration.candles_1m);
  const [symbol, setSymbol] = useState<SYMBOL>(Channels.BTCUSDT);
  const [prices, setPrices] = useState({ askPrice: 0, bidPrice: 0 });
  const [platformProfit, setPlatformProfit] = useState<PlatformProfitResponse | null>(null);
  const [priceChanges, setPriceChanges] = useState<Record<string, number>>({});
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
    const loadPlatformProfit = async () => {
      try {
        const data = await fetchPlatformProfit();
        setPlatformProfit(data);
      } catch (error) {
        console.error("Failed to load platform profit:", error);
      }
    };

    loadPlatformProfit();
    const interval = setInterval(loadPlatformProfit, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return subscribePrices((livePrices: LivePrices) => {
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
                  <div className={`${t.visible ? "animate-enter" : "animate-leave"} max-w-md w-full bg-[#0d2137] shadow-lg rounded-xl pointer-events-auto flex ring-1 ring-[#1e3a5f]`}>
                    <div className="flex-1 w-0 p-4">
                      <div className="flex items-start">
                        <div className="ml-3 flex-1">
                          <p className="text-sm font-medium text-[#e2e8f0]">Order Closed</p>
                          <p className="mt-1 text-sm text-[#94a3b8]">
                            {closedOrder.asset} {closedOrder.type.toUpperCase()} closed at ${closedOrder.closePrice?.toFixed(2)}
                          </p>
                          <p className={`mt-1 text-sm font-bold ${pnlColor}`}>
                            PnL: {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex border-l border-[#1e3a5f]">
                      <button
                        onClick={() => toast.dismiss(t.id)}
                        className="w-full border border-transparent rounded-none rounded-r-xl p-4 flex items-center justify-center text-sm font-medium text-[#94a3b8] hover:text-[#e2e8f0] focus:outline-none"
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
    <div className="min-h-screen bg-[#090909] overflow-hidden flex flex-col">
      <div className="fixed inset-0 bg-[#090909]">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-gradient-to-br from-white/5 via-white/0 to-transparent blur-3xl"></div>
        <div className="absolute top-1/3 right-1/4 w-80 h-80 bg-gradient-to-bl from-white/5 via-transparent to-transparent blur-3xl"></div>
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:40px_40px]"></div>
      </div>

      <div className="relative z-10 w-full h-full flex flex-col p-4">
        <div className="bg-[#101010]/90 backdrop-blur-xl border border-[#2a2a2a] p-3 rounded-xl mb-4 flex flex-col sm:flex-row gap-2">
          <div className="flex gap-2 overflow-x-auto flex-shrink-0">
            {([
              { channel: Channels.BTCUSDT, label: "BTC/USDT", base: "BTC" },
              { channel: Channels.ETHUSDT, label: "ETH/USDT", base: "ETH" },
              { channel: Channels.SOLUSDT, label: "SOL/USDT", base: "SOL" },
            ] as const).map(({ channel, label, base }) => {
              const pct = priceChanges[base];
              const change = pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—";
              const up = pct == null || pct >= 0;
              return (
              <button
                key={channel}
                className={`px-4 py-2 rounded-lg transition-all whitespace-nowrap flex-shrink-0 ${
                  symbol === channel
                    ? "bg-white/10 text-white border border-white/30"
                    : "text-[#d4d4d4] hover:bg-white/5 border border-[#2c2c2c]"
                }`}
                disabled={symbol === channel}
                onClick={() => setSymbol(channel)}
              >
                <div className="flex items-center">
                  <span className="font-medium text-sm">{label}</span>
                  <span className={`ml-2 text-xs px-2 py-1 rounded ${up ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                    {change}
                  </span>
                </div>
              </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
            <div className="flex items-center bg-[#171717] border border-[#333] px-3 py-2 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center bg-[#0EA5E9]/20 w-7 h-7 rounded-lg">
                  <div className="w-2.5 h-2.5 bg-[#0EA5E9] rounded-full"></div>
                </div>
                <div>
                  <div className="text-[9px] text-[#9ca3af] font-medium uppercase tracking-wider">Platform Profit</div>
                  <div className="text-sm font-bold text-white">
                    {platformProfit ? `$${(platformProfit.totalProfit / 100).toFixed(2)}` : "$0.00"}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#151515] rounded-lg p-1 flex border border-[#2f2f2f] overflow-x-auto max-w-full">
              {([
                { d: Duration.candles_1m,  label: "1m" },
                { d: Duration.candles_5m,  label: "5m" },
                { d: Duration.candles_15m, label: "15m" },
                { d: Duration.candles_1h,  label: "1h" },
                { d: Duration.candles_4h,  label: "4h" },
                { d: Duration.candles_1d,  label: "1d" },
                { d: Duration.candles_1w,  label: "1w" },
              ] as const).map(({ d, label }) => (
                <button
                  key={d}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition whitespace-nowrap ${
                    duration === d
                      ? "bg-white/15 text-white"
                      : "text-[#9ca3af] hover:text-white"
                  }`}
                  disabled={duration === d}
                  onClick={() => setDuration(d)}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={() => router.push("/dashboard")}
              className="bg-[#0EA5E9]/10 hover:bg-[#0EA5E9]/20 text-[#0EA5E9] border border-[#0EA5E9]/30 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Dashboard
            </button>

            <button
              onClick={() => {
                localStorage.removeItem("token");
                localStorage.removeItem("userID");
                router.push("/signin");
              }}
              className="bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="flex-grow grid grid-cols-12 gap-3 min-h-0 h-[calc(100vh-120px)]">
          <div className="col-span-12 md:col-span-2 order-2 md:order-1 overflow-auto min-h-0 h-full">
            <div className="bg-[#101010]/90 backdrop-blur-xl rounded-xl border border-[#2a2a2a] p-3 h-full">
              <h3 className="text-white text-sm font-medium mb-3 flex justify-between items-center">
                <span>Market Data</span>
                <span className="text-xs bg-white/10 text-[#d1d5db] px-2 py-1 rounded-md">Live</span>
              </h3>
              <AskBids symbol={symbol} />
            </div>
          </div>

          <div className="col-span-12 md:col-span-10 order-1 md:order-2 flex flex-col md:flex-row overflow-hidden min-h-0 h-[calc(100vh-130px)]">
            <div className="w-full h-[58vh] md:h-full md:w-3/4 flex flex-col gap-3 md:pr-3 min-h-0">
              <div className="h-[64%] flex flex-col min-h-[280px]">
                <ChartComponent symbol={symbol} duration={duration} onPriceUpdate={setPrices} />
              </div>
              <div className="h-[36%] min-h-[200px]">
                <OrdersPanel onRefreshReady={(fn) => { refreshOrdersRef.current = fn; }} />
              </div>
            </div>

            <div className="w-full md:w-1/4 min-h-[360px] md:h-full">
              <BuySell
                symbol={symbol}
                askPrice={toDisplayPrice(prices.askPrice)}
                bidPrice={toDisplayPrice(prices.bidPrice)}
                onOrderPlaced={refreshOrdersRef.current || undefined}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

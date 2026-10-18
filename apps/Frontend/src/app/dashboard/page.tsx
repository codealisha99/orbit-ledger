"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { findUserAmount, getopentrades, getclosedtrades } from "@/api/trade";
import { calculatePnlCents, toDisplayPrice, toDisplayPriceUSD } from "@/utils/utils";
import { subscribePrices, type LivePrices } from "@/utils/price_store";

interface OpenOrder {
  orderId: string;
  type: "buy" | "sell";
  margin: number;
  leverage: number;
  openPrice: number;
  asset?: string;
}

interface ClosedOrder extends OpenOrder {
  closePrice: number;
  pnl: number;
}

export default function Dashboard() {
  const router = useRouter();
  const [balance, setBalance] = useState<number>(0);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [closedOrders, setClosedOrders] = useState<ClosedOrder[]>([]);
  const [livePrices, setLivePrices] = useState<LivePrices>({ BTC: { bid: 0, ask: 0 }, ETH: { bid: 0, ask: 0 }, SOL: { bid: 0, ask: 0 } });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const userData = await findUserAmount();
        if (!userData || !userData.balance || userData.error) {
          localStorage.removeItem("token");
          localStorage.removeItem("userID");
          router.push("/signin");
          return;
        }
        setBalance(userData.balance.usd ?? 0);

        const token = localStorage.getItem("token") || "";
        const [openRes, closedRes] = await Promise.all([
          getopentrades(token),
          getclosedtrades(token),
        ]);

        setOpenOrders(openRes?.data?.orders ?? []);
        setClosedOrders(closedRes?.data?.orders ?? []);
      } catch {
        localStorage.removeItem("token");
        localStorage.removeItem("userID");
        router.push("/signin");
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, [router]);

  useEffect(() => {
    return subscribePrices(setLivePrices);
  }, []);

  const openPnlCents = openOrders.reduce((sum, order) => {
    const sym = (order.asset || "BTC").replace("USDT", "") as keyof LivePrices;
    const p = livePrices[sym] ?? { bid: 0, ask: 0 };
    if (p.bid <= 0 && p.ask <= 0) return sum;
    const closePrice = order.type === "buy" ? p.bid : p.ask;
    return sum + calculatePnlCents({
      side: order.type,
      openPrice: order.openPrice,
      closePrice: toDisplayPrice(closePrice),
      marginCents: order.margin,
      leverage: order.leverage,
    });
  }, 0);

  const openPnlUsd = toDisplayPriceUSD(Math.abs(openPnlCents)) * (openPnlCents >= 0 ? 1 : -1);
  const equity = balance + openPnlUsd;

  const realisedPnlCents = closedOrders.reduce((sum, o) => sum + (o.pnl ?? 0), 0);
  const realisedPnlUsd = toDisplayPriceUSD(Math.abs(realisedPnlCents)) * (realisedPnlCents >= 0 ? 1 : -1);

  const wins = closedOrders.filter((o) => (o.pnl ?? 0) > 0).length;
  const winRate = closedOrders.length > 0 ? ((wins / closedOrders.length) * 100).toFixed(1) : "—";

  const largestOpen = openOrders.reduce<OpenOrder | null>((best, o) => {
    if (!best) return o;
    return o.margin > best.margin ? o : best;
  }, null);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--nt-bg)] flex items-center justify-center">
        <div className="text-[var(--nt-muted)] text-sm">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--nt-bg)] text-[var(--nt-text)]">
      <div className="fixed inset-0 bg-[var(--nt-bg)]">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-gradient-to-br from-white/5 via-white/0 to-transparent blur-3xl"></div>
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:40px_40px]"></div>
      </div>

      <div className="relative z-10 max-w-5xl mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--nt-text)]">Dashboard</h1>
            <p className="text-sm text-[var(--nt-muted)] mt-1">Account overview</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => router.push("/trading")}
              className="bg-[color:color-mix(in_srgb,var(--nt-accent)_10%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--nt-accent)_20%,transparent)] text-[var(--nt-accent)] border border-[color:color-mix(in_srgb,var(--nt-accent)_30%,transparent)] px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Go to Trading
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-[color:color-mix(in_srgb,var(--nt-surface)_90%,transparent)] backdrop-blur-xl border border-[var(--nt-border)] rounded-xl p-5">
            <div className="text-xs text-[var(--nt-muted)] uppercase tracking-wider mb-2">Equity</div>
            <div className="text-2xl font-bold text-[var(--nt-text)]">${equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="text-xs text-[var(--nt-muted)] mt-1">Balance + Open P&L</div>
          </div>

          <div className="bg-[color:color-mix(in_srgb,var(--nt-surface)_90%,transparent)] backdrop-blur-xl border border-[var(--nt-border)] rounded-xl p-5">
            <div className="text-xs text-[var(--nt-muted)] uppercase tracking-wider mb-2">Available Balance</div>
            <div className="text-2xl font-bold text-[var(--nt-text)]">${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="text-xs text-[var(--nt-muted)] mt-1">USD</div>
          </div>

          <div className="bg-[color:color-mix(in_srgb,var(--nt-surface)_90%,transparent)] backdrop-blur-xl border border-[var(--nt-border)] rounded-xl p-5">
            <div className="text-xs text-[var(--nt-muted)] uppercase tracking-wider mb-2">Unrealised P&L</div>
            <div className={`text-2xl font-bold ${openPnlUsd >= 0 ? "text-green-400" : "text-red-400"}`}>
              {openPnlUsd >= 0 ? "+" : ""}${Math.abs(openPnlUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-[var(--nt-muted)] mt-1">{openOrders.length} open position{openOrders.length !== 1 ? "s" : ""}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="bg-[color:color-mix(in_srgb,var(--nt-surface)_90%,transparent)] backdrop-blur-xl border border-[var(--nt-border)] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[var(--nt-text)] mb-4 flex items-center justify-between">
              Open Positions
              <span className="text-xs bg-[color:color-mix(in_srgb,var(--nt-accent)_10%,transparent)] text-[var(--nt-accent)] px-2 py-1 rounded-md">{openOrders.length}</span>
            </h2>
            {openOrders.length === 0 ? (
              <p className="text-sm text-[var(--nt-muted)]">No open positions</p>
            ) : (
              <div className="space-y-2">
                {largestOpen && (
                  <div className="text-xs text-[var(--nt-muted)]">
                    Largest: <span className="text-[var(--nt-text)] font-medium">{largestOpen.asset || largestOpen.type.toUpperCase()}</span>
                    {" · "}margin ${toDisplayPriceUSD(largestOpen.margin).toFixed(2)}
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--nt-muted)]">Total unrealised P&L</span>
                  <span className={`font-semibold ${openPnlUsd >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {openPnlUsd >= 0 ? "+" : ""}${Math.abs(openPnlUsd).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-[color:color-mix(in_srgb,var(--nt-surface)_90%,transparent)] backdrop-blur-xl border border-[var(--nt-border)] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[var(--nt-text)] mb-4 flex items-center justify-between">
              Performance
              <span className="text-xs bg-[color:color-mix(in_srgb,var(--nt-surface2)_10%,transparent)] text-[var(--nt-text)] px-2 py-1 rounded-md">{closedOrders.length} closed</span>
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--nt-muted)]">Total Realised P&L</span>
                <span className={`font-semibold ${realisedPnlUsd >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {realisedPnlUsd >= 0 ? "+" : ""}${Math.abs(realisedPnlUsd).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--nt-muted)]">Win Rate</span>
                <span className="font-semibold text-[var(--nt-text)]">{winRate}{winRate !== "—" ? "%" : ""}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--nt-muted)]">Winning Trades</span>
                <span className="font-semibold text-green-400">{wins} / {closedOrders.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

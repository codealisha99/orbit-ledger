"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { fetchPlatformProfit, type PlatformProfitResponse } from "@/api/profit";

const TICKER_ITEMS = [
  { symbol: "BTC/USDT", price: "~$67,240", change: "+2.41%", up: true },
  { symbol: "ETH/USDT", price: "~$3,512", change: "+1.87%", up: true },
  { symbol: "SOL/USDT", price: "~$142.30", change: "-0.82%", up: false },
  { symbol: "BTC/USDT", price: "~$67,240", change: "+2.41%", up: true },
  { symbol: "ETH/USDT", price: "~$3,512", change: "+1.87%", up: true },
  { symbol: "SOL/USDT", price: "~$142.30", change: "-0.82%", up: false },
];

const FEATURES = [
  {
    icon: "⚡",
    title: "Lightning Execution",
    desc: "Sub-millisecond order routing with Kafka-powered price pipelines and real-time WebSocket delivery to every connected client.",
  },
  {
    icon: "📊",
    title: "Institutional Depth",
    desc: "Leverage up to 100x across BTC, ETH, and SOL with live candlestick charts aggregated from Binance market data.",
  },
  {
    icon: "🛡️",
    title: "Risk Intelligence",
    desc: "Automatic TP/SL, trailing stop-loss, partial close, and margin management — the full professional risk toolkit.",
  },
];

const INFRA_STACK = [
  { label: "Next.js 15", color: "bg-[color:color-mix(in_srgb,var(--nt-surface2)_10%,transparent)]" },
  { label: "Bun Runtime", color: "bg-[#f472b6]/10" },
  { label: "Kafka", color: "bg-[color:color-mix(in_srgb,var(--nt-accent)_10%,transparent)]" },
  { label: "Redis", color: "bg-red-500/10" },
  { label: "TimescaleDB", color: "bg-yellow-500/10" },
  { label: "WebSockets", color: "bg-green-500/10" },
  { label: "Prisma ORM", color: "bg-purple-500/10" },
  { label: "Binance WS", color: "bg-yellow-400/10" },
];

const WHY_ITEMS = [
  {
    n: "01",
    title: "Real-Time Price Engine",
    desc: "Binance WebSocket feeds flow through Kafka, get cached in Redis, and broadcast to every client in under 50ms via our custom Signaling Manager.",
  },
  {
    n: "02",
    title: "Full-Featured CFD Trading",
    desc: "Open long/short positions with configurable leverage. Set take-profit and stop-loss levels. Adjust or partially close positions at any time.",
  },
  {
    n: "03",
    title: "Automated Risk Management",
    desc: "Server-side position monitoring runs every 500ms. Trailing stop-loss re-prices automatically. Margin calls and liquidations fire before losses exceed margin.",
  },
  {
    n: "04",
    title: "OAuth + JWT Security",
    desc: "Sign in with Google or GitHub via OAuth 2.0. All sessions use short-lived JWTs. Rate limiting protects every API endpoint.",
  },
];

export default function OrbitLedgerLanding() {
  const [platformProfit, setPlatformProfit] = useState<PlatformProfitResponse | null>(null);
  const tickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchPlatformProfit();
        setPlatformProfit(data);
      } catch {
      }
    };
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-[var(--nt-bg)] text-[var(--nt-text)] overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-gradient-to-br from-[color:color-mix(in_srgb,var(--nt-accent)_6%,transparent)] to-transparent blur-3xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-gradient-to-bl from-[color:color-mix(in_srgb,var(--nt-accent)_4%,transparent)] to-transparent blur-3xl"></div>
        <div className="absolute inset-0 bg-[linear-gradient(rgba(14,165,233,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.025)_1px,transparent_1px)] bg-[size:50px_50px]"></div>
      </div>

      <nav className="relative z-20 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-[var(--nt-accent)] rounded-lg flex items-center justify-center shadow-[0_0_16px_rgba(14,165,233,0.5)]">
            <span className="text-[var(--nt-text)] font-bold text-base">N</span>
          </div>
          <span className="text-[var(--nt-text)] font-bold text-xl tracking-tight">OrbitLedger</span>
        </div>

        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-[var(--nt-muted)] hover:text-[var(--nt-text)] transition-colors text-sm">Features</a>
          <a href="#infrastructure" className="text-[var(--nt-muted)] hover:text-[var(--nt-text)] transition-colors text-sm">Infrastructure</a>
          <Link href="/trading" className="text-[var(--nt-muted)] hover:text-[var(--nt-text)] transition-colors text-sm">Trading</Link>
          <Link href="/signin" className="text-[var(--nt-muted)] hover:text-[var(--nt-text)] transition-colors text-sm">Sign In</Link>
        </div>

        <Link
          href="/signup"
          className="bg-[var(--nt-accent)] hover:bg-[#0284c7] text-[var(--nt-text)] px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-[0_0_16px_rgba(14,165,233,0.3)]"
        >
          GET STARTED →
        </Link>
      </nav>

      <section className="relative z-10 max-w-7xl mx-auto px-6 pt-16 pb-20">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-[color:color-mix(in_srgb,var(--nt-accent)_10%,transparent)] border border-[color:color-mix(in_srgb,var(--nt-accent)_20%,transparent)] rounded-full px-4 py-1.5 mb-8">
              <div className="w-2 h-2 bg-[var(--nt-accent)] rounded-full animate-pulse"></div>
              <span className="text-[var(--nt-accent)] text-xs font-medium tracking-wide">Live market data — powered by Binance</span>
            </div>

            <h1 className="text-5xl lg:text-6xl font-bold mb-6 leading-[1.1]">
              <span className="text-[var(--nt-text)]">Precision</span>
              <br />
              <span className="text-[var(--nt-text)]">Trading.</span>
              <br />
              <span className="text-[var(--nt-accent)]">Real-Time Edge.</span>
            </h1>

            <p className="text-[var(--nt-muted)] text-lg mb-10 max-w-lg leading-relaxed">
              OrbitLedger brings institutional-grade CFD trading to the browser. Kafka-backed price feeds, server-side risk management, and a full-featured order book — built from first principles.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-12">
              <Link
                href="/trading"
                className="bg-[var(--nt-accent)] hover:bg-[#0284c7] text-[var(--nt-text)] px-8 py-3.5 rounded-xl font-semibold transition-all shadow-[0_0_24px_rgba(14,165,233,0.4)] text-center"
              >
                Start Trading →
              </Link>
              <Link
                href="/signup"
                className="border border-[var(--nt-border)] text-[var(--nt-muted)] hover:border-[color:color-mix(in_srgb,var(--nt-accent)_40%,transparent)] hover:text-[var(--nt-text)] px-8 py-3.5 rounded-xl font-semibold transition-all text-center"
              >
                Create Free Account
              </Link>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {["var(--nt-accent)", "#22c55e", "#f59e0b"].map((c, i) => (
                  <div key={i} className="w-8 h-8 rounded-full border-2 border-[var(--nt-bg)]" style={{ backgroundColor: c + "33", borderColor: c + "66" }}></div>
                ))}
              </div>
              <span className="text-[var(--nt-dim)] text-sm">Trusted by traders worldwide</span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-br from-[color:color-mix(in_srgb,var(--nt-accent)_10%,transparent)] to-transparent rounded-3xl blur-xl"></div>
            <div className="relative bg-[color:color-mix(in_srgb,var(--nt-surface)_90%,transparent)] backdrop-blur-xl border border-[var(--nt-border)] rounded-2xl shadow-[0_0_40px_rgba(14,165,233,0.1)] overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-[color:color-mix(in_srgb,var(--nt-border)_60%,transparent)] bg-[color:color-mix(in_srgb,var(--nt-surface2)_50%,transparent)]">
                <div className="w-3 h-3 rounded-full bg-red-500/70"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/70"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/70"></div>
                <span className="ml-3 text-xs text-[var(--nt-dim)] font-mono">orbitledger — trading terminal</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-xs text-green-400">LIVE</span>
                </div>
              </div>

              <div className="p-5">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <div className="text-xs text-[var(--nt-dim)] mb-1 uppercase tracking-wider">Portfolio Value</div>
                    <div className="text-3xl font-bold text-[var(--nt-text)]">$12,450.00</div>
                    <div className="text-green-400 text-sm mt-0.5">▲ +$298.20 today</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-[var(--nt-dim)] mb-1 uppercase tracking-wider">Platform Profit</div>
                    <div className="text-xl font-bold text-[var(--nt-accent)]">
                      {platformProfit ? `$${(platformProfit.totalProfit / 100).toFixed(2)}` : "$0.00"}
                    </div>
                    <div className="text-xs text-[var(--nt-dim)] mt-0.5">
                      {platformProfit ? `${platformProfit.totalTrades} total trades` : "loading..."}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[
                    { sym: "BTC", color: "#f59e0b", price: "67,240", change: "+2.4%" },
                    { sym: "ETH", color: "#6366f1", price: "3,512", change: "+1.9%" },
                    { sym: "SOL", color: "#22c55e", price: "142.30", change: "-0.8%" },
                  ].map(({ sym, color, price, change }) => (
                    <div key={sym} className="bg-[color:color-mix(in_srgb,var(--nt-surface2)_80%,transparent)] rounded-xl p-3 border border-[color:color-mix(in_srgb,var(--nt-border)_50%,transparent)]">
                      <div className="flex items-center gap-1.5 mb-2">
                        <div className="w-5 h-5 rounded-full" style={{ backgroundColor: color + "40", border: `1px solid ${color}60` }}></div>
                        <span className="text-[var(--nt-muted)] text-xs">{sym}/USD</span>
                      </div>
                      <div className="text-[var(--nt-text)] font-semibold text-sm">${price}</div>
                      <div className={`text-xs mt-0.5 ${change.startsWith("+") ? "text-green-400" : "text-red-400"}`}>{change}</div>
                    </div>
                  ))}
                </div>

                <div className="bg-[color:color-mix(in_srgb,var(--nt-surface2)_60%,transparent)] rounded-xl p-4 mb-4 border border-[color:color-mix(in_srgb,var(--nt-border)_30%,transparent)]">
                  <div className="flex items-end gap-1 h-16">
                    {[40, 55, 35, 70, 45, 80, 60, 75, 50, 85, 65, 90].map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-sm"
                        style={{
                          height: `${h}%`,
                          backgroundColor: h > 60 ? "rgba(14,165,233,0.6)" : "rgba(14,165,233,0.25)",
                        }}
                      ></div>
                    ))}
                  </div>
                  <div className="flex justify-between text-xs text-[var(--nt-dim)] mt-2">
                    <span>1h ago</span><span>30m</span><span>now</span>
                  </div>
                </div>

                <Link
                  href="/trading"
                  className="w-full flex items-center justify-center gap-2 bg-[color:color-mix(in_srgb,var(--nt-accent)_20%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--nt-accent)_30%,transparent)] border border-[color:color-mix(in_srgb,var(--nt-accent)_30%,transparent)] text-[var(--nt-accent)] py-3 rounded-xl font-semibold transition-all text-sm"
                >
                  Open Trading Terminal →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="relative z-10 border-y border-[color:color-mix(in_srgb,var(--nt-border)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--nt-surface)_60%,transparent)] backdrop-blur-sm py-3 overflow-hidden">
        <div ref={tickerRef} className="flex gap-12 animate-[marquee_20s_linear_infinite] whitespace-nowrap">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <div key={i} className="inline-flex items-center gap-3 flex-shrink-0">
              <span className="text-[var(--nt-dim)] text-sm font-mono">{item.symbol}</span>
              <span className="text-[var(--nt-text)] text-sm font-semibold font-mono">{item.price}</span>
              <span className={`text-xs font-mono px-2 py-0.5 rounded ${item.up ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10"}`}>
                {item.change}
              </span>
              <span className="text-[var(--nt-border)]">•</span>
            </div>
          ))}
        </div>
      </div>

      <section id="features" className="relative z-10 max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-[color:color-mix(in_srgb,var(--nt-accent)_10%,transparent)] border border-[color:color-mix(in_srgb,var(--nt-accent)_20%,transparent)] rounded-full px-4 py-1.5 mb-6">
            <span className="text-[var(--nt-accent)] text-xs font-medium tracking-wide">Why OrbitLedger</span>
          </div>
          <h2 className="text-4xl lg:text-5xl font-bold text-[var(--nt-text)] mb-4">
            Everything you need to trade professionally
          </h2>
          <p className="text-[var(--nt-muted)] max-w-2xl mx-auto">
            Built on the same foundations as institutional desks, delivered as a modern web platform.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {FEATURES.map(({ icon, title, desc }) => (
            <div
              key={title}
              className="bg-[color:color-mix(in_srgb,var(--nt-surface)_80%,transparent)] border border-[var(--nt-border)] rounded-2xl p-8 hover:border-[color:color-mix(in_srgb,var(--nt-accent)_30%,transparent)] hover:shadow-[0_0_30px_rgba(14,165,233,0.08)] transition-all group"
            >
              <div className="w-12 h-12 bg-[color:color-mix(in_srgb,var(--nt-accent)_10%,transparent)] rounded-xl flex items-center justify-center mb-5 text-2xl group-hover:bg-[color:color-mix(in_srgb,var(--nt-accent)_20%,transparent)] transition-colors">
                {icon}
              </div>
              <h3 className="text-xl font-bold text-[var(--nt-text)] mb-3">{title}</h3>
              <p className="text-[var(--nt-muted)] leading-relaxed text-sm">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 max-w-7xl mx-auto px-6 py-16">
        <div className="bg-[color:color-mix(in_srgb,var(--nt-surface)_80%,transparent)] border border-[var(--nt-border)] rounded-2xl p-10 shadow-[0_0_50px_rgba(14,165,233,0.08)]">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-[var(--nt-text)] mb-2">Live Platform Stats</h2>
            <p className="text-[var(--nt-muted)] text-sm">Updated every 3 seconds</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-8 text-center">
            {[
              { val: "3", unit: "Assets", sub: "BTC · ETH · SOL" },
              { val: "24/7", unit: "Market Access", sub: "Always live" },
              { val: "50ms", unit: "Latency", sub: "Price delivery" },
              { val: "100x", unit: "Max Leverage", sub: "All pairs" },
              { val: "99.9%", unit: "Uptime", sub: "SLA target" },
              {
                val: platformProfit ? `$${(platformProfit.totalProfit / 100).toFixed(0)}` : "$0",
                unit: "Platform Profit",
                sub: platformProfit ? `${platformProfit.totalTrades} trades` : "0 trades",
                accent: true,
              },
            ].map(({ val, unit, sub, accent }) => (
              <div key={unit}>
                <div className={`text-3xl font-bold mb-1 ${accent ? "text-[var(--nt-accent)]" : "text-[var(--nt-text)]"}`} style={accent ? { textShadow: "0 0 20px rgba(14,165,233,0.5)" } : {}}>
                  {val}
                </div>
                <div className="text-[var(--nt-muted)] text-sm font-medium">{unit}</div>
                <div className="text-[var(--nt-dim)] text-xs mt-1">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="infrastructure" className="relative z-10 max-w-7xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <p className="text-[var(--nt-dim)] text-sm uppercase tracking-widest mb-3">Powered by</p>
          <h2 className="text-2xl font-bold text-[var(--nt-text)]">Institutional-grade infrastructure</h2>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          {INFRA_STACK.map(({ label, color }) => (
            <div key={label} className={`flex items-center gap-2 ${color} border border-[var(--nt-border)] px-5 py-2.5 rounded-xl`}>
              <span className="text-[var(--nt-text)] text-sm font-medium">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 max-w-7xl mx-auto px-6 py-20">
        <div className="mb-14">
          <h2 className="text-4xl font-bold text-[var(--nt-text)] mb-4">Why Choose OrbitLedger?</h2>
          <p className="text-[var(--nt-muted)] max-w-2xl">
            Every architectural decision was made with performance, safety, and trader experience in mind.
          </p>
        </div>

        <div className="space-y-10">
          {WHY_ITEMS.map(({ n, title, desc }) => (
            <div key={n} className="flex items-start gap-6 group">
              <div className="flex-shrink-0 w-12 h-12 bg-[color:color-mix(in_srgb,var(--nt-accent)_10%,transparent)] border border-[color:color-mix(in_srgb,var(--nt-accent)_20%,transparent)] rounded-xl flex items-center justify-center group-hover:bg-[color:color-mix(in_srgb,var(--nt-accent)_20%,transparent)] transition-colors">
                <span className="text-[var(--nt-accent)] font-bold text-sm">{n}</span>
              </div>
              <div>
                <h3 className="text-xl font-bold text-[var(--nt-text)] mb-3">{title}</h3>
                <p className="text-[var(--nt-muted)] max-w-2xl leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 max-w-7xl mx-auto px-6 py-20">
        <div className="bg-gradient-to-br from-[var(--nt-surface)] via-[var(--nt-bg)] to-[var(--nt-surface)] border border-[var(--nt-border)] rounded-2xl p-14 text-center shadow-[0_0_60px_rgba(14,165,233,0.1)]">
          <div className="w-16 h-16 bg-[var(--nt-accent)] rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(14,165,233,0.5)]">
            <span className="text-[var(--nt-text)] font-bold text-2xl">N</span>
          </div>
          <h2 className="text-4xl font-bold text-[var(--nt-text)] mb-4">Start Trading Now</h2>
          <p className="text-[var(--nt-muted)] mb-8 max-w-lg mx-auto">
            Join OrbitLedger. Open positions in seconds, manage risk with precision, and watch your trades execute in real time.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/signup"
              className="bg-[var(--nt-accent)] hover:bg-[#0284c7] text-[var(--nt-text)] px-10 py-4 rounded-xl font-bold transition-all shadow-[0_0_24px_rgba(14,165,233,0.4)]"
            >
              Create Free Account →
            </Link>
            <Link
              href="/signin"
              className="border border-[var(--nt-border)] text-[var(--nt-muted)] hover:border-[color:color-mix(in_srgb,var(--nt-accent)_40%,transparent)] hover:text-[var(--nt-text)] px-10 py-4 rounded-xl font-bold transition-all"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-[color:color-mix(in_srgb,var(--nt-border)_40%,transparent)] px-6 py-8 max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[var(--nt-accent)] rounded-md flex items-center justify-center">
            <span className="text-[var(--nt-text)] font-bold text-xs">N</span>
          </div>
          <span className="text-[var(--nt-dim)] text-sm">OrbitLedger — CFD Trading Platform</span>
        </div>
        <div className="text-[var(--nt-dim)] text-xs">
          Built with Next.js · Bun · Kafka · Redis
        </div>
      </footer>

      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

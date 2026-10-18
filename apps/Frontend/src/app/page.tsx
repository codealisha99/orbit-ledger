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
  { label: "Next.js 15", color: "bg-white/10" },
  { label: "Bun Runtime", color: "bg-[#f472b6]/10" },
  { label: "Kafka", color: "bg-[#0EA5E9]/10" },
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
    <div className="min-h-screen bg-[#050f1a] text-[#e2e8f0] overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-gradient-to-br from-[#0EA5E9]/6 to-transparent blur-3xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-gradient-to-bl from-[#0EA5E9]/4 to-transparent blur-3xl"></div>
        <div className="absolute inset-0 bg-[linear-gradient(rgba(14,165,233,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.025)_1px,transparent_1px)] bg-[size:50px_50px]"></div>
      </div>

      <nav className="relative z-20 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-[#0EA5E9] rounded-lg flex items-center justify-center shadow-[0_0_16px_rgba(14,165,233,0.5)]">
            <span className="text-white font-bold text-base">N</span>
          </div>
          <span className="text-[#e2e8f0] font-bold text-xl tracking-tight">OrbitLedger</span>
        </div>

        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-[#94a3b8] hover:text-[#e2e8f0] transition-colors text-sm">Features</a>
          <a href="#infrastructure" className="text-[#94a3b8] hover:text-[#e2e8f0] transition-colors text-sm">Infrastructure</a>
          <Link href="/trading" className="text-[#94a3b8] hover:text-[#e2e8f0] transition-colors text-sm">Trading</Link>
          <Link href="/signin" className="text-[#94a3b8] hover:text-[#e2e8f0] transition-colors text-sm">Sign In</Link>
        </div>

        <Link
          href="/signup"
          className="bg-[#0EA5E9] hover:bg-[#0284c7] text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-[0_0_16px_rgba(14,165,233,0.3)]"
        >
          GET STARTED →
        </Link>
      </nav>

      <section className="relative z-10 max-w-7xl mx-auto px-6 pt-16 pb-20">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-[#0EA5E9]/10 border border-[#0EA5E9]/20 rounded-full px-4 py-1.5 mb-8">
              <div className="w-2 h-2 bg-[#0EA5E9] rounded-full animate-pulse"></div>
              <span className="text-[#0EA5E9] text-xs font-medium tracking-wide">Live market data — powered by Binance</span>
            </div>

            <h1 className="text-5xl lg:text-6xl font-bold mb-6 leading-[1.1]">
              <span className="text-[#e2e8f0]">Precision</span>
              <br />
              <span className="text-[#e2e8f0]">Trading.</span>
              <br />
              <span className="text-[#0EA5E9]">Real-Time Edge.</span>
            </h1>

            <p className="text-[#94a3b8] text-lg mb-10 max-w-lg leading-relaxed">
              OrbitLedger brings institutional-grade CFD trading to the browser. Kafka-backed price feeds, server-side risk management, and a full-featured order book — built from first principles.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-12">
              <Link
                href="/trading"
                className="bg-[#0EA5E9] hover:bg-[#0284c7] text-white px-8 py-3.5 rounded-xl font-semibold transition-all shadow-[0_0_24px_rgba(14,165,233,0.4)] text-center"
              >
                Start Trading →
              </Link>
              <Link
                href="/signup"
                className="border border-[#1e3a5f] text-[#94a3b8] hover:border-[#0EA5E9]/40 hover:text-[#e2e8f0] px-8 py-3.5 rounded-xl font-semibold transition-all text-center"
              >
                Create Free Account
              </Link>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {["#0EA5E9", "#22c55e", "#f59e0b"].map((c, i) => (
                  <div key={i} className="w-8 h-8 rounded-full border-2 border-[#050f1a]" style={{ backgroundColor: c + "33", borderColor: c + "66" }}></div>
                ))}
              </div>
              <span className="text-[#64748b] text-sm">Trusted by traders worldwide</span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-br from-[#0EA5E9]/10 to-transparent rounded-3xl blur-xl"></div>
            <div className="relative bg-[#0a1929]/90 backdrop-blur-xl border border-[#1e3a5f] rounded-2xl shadow-[0_0_40px_rgba(14,165,233,0.1)] overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-[#1e3a5f]/60 bg-[#0d2137]/50">
                <div className="w-3 h-3 rounded-full bg-red-500/70"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/70"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/70"></div>
                <span className="ml-3 text-xs text-[#64748b] font-mono">orbitledger — trading terminal</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-xs text-green-400">LIVE</span>
                </div>
              </div>

              <div className="p-5">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <div className="text-xs text-[#64748b] mb-1 uppercase tracking-wider">Portfolio Value</div>
                    <div className="text-3xl font-bold text-[#e2e8f0]">$12,450.00</div>
                    <div className="text-green-400 text-sm mt-0.5">▲ +$298.20 today</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-[#64748b] mb-1 uppercase tracking-wider">Platform Profit</div>
                    <div className="text-xl font-bold text-[#0EA5E9]">
                      {platformProfit ? `$${(platformProfit.totalProfit / 100).toFixed(2)}` : "$0.00"}
                    </div>
                    <div className="text-xs text-[#64748b] mt-0.5">
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
                    <div key={sym} className="bg-[#0d2137]/80 rounded-xl p-3 border border-[#1e3a5f]/50">
                      <div className="flex items-center gap-1.5 mb-2">
                        <div className="w-5 h-5 rounded-full" style={{ backgroundColor: color + "40", border: `1px solid ${color}60` }}></div>
                        <span className="text-[#94a3b8] text-xs">{sym}/USD</span>
                      </div>
                      <div className="text-[#e2e8f0] font-semibold text-sm">${price}</div>
                      <div className={`text-xs mt-0.5 ${change.startsWith("+") ? "text-green-400" : "text-red-400"}`}>{change}</div>
                    </div>
                  ))}
                </div>

                <div className="bg-[#0d2137]/60 rounded-xl p-4 mb-4 border border-[#1e3a5f]/30">
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
                  <div className="flex justify-between text-xs text-[#64748b] mt-2">
                    <span>1h ago</span><span>30m</span><span>now</span>
                  </div>
                </div>

                <Link
                  href="/trading"
                  className="w-full flex items-center justify-center gap-2 bg-[#0EA5E9]/20 hover:bg-[#0EA5E9]/30 border border-[#0EA5E9]/30 text-[#0EA5E9] py-3 rounded-xl font-semibold transition-all text-sm"
                >
                  Open Trading Terminal →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="relative z-10 border-y border-[#1e3a5f]/40 bg-[#0a1929]/60 backdrop-blur-sm py-3 overflow-hidden">
        <div ref={tickerRef} className="flex gap-12 animate-[marquee_20s_linear_infinite] whitespace-nowrap">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
            <div key={i} className="inline-flex items-center gap-3 flex-shrink-0">
              <span className="text-[#64748b] text-sm font-mono">{item.symbol}</span>
              <span className="text-[#e2e8f0] text-sm font-semibold font-mono">{item.price}</span>
              <span className={`text-xs font-mono px-2 py-0.5 rounded ${item.up ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10"}`}>
                {item.change}
              </span>
              <span className="text-[#1e3a5f]">•</span>
            </div>
          ))}
        </div>
      </div>

      <section id="features" className="relative z-10 max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-[#0EA5E9]/10 border border-[#0EA5E9]/20 rounded-full px-4 py-1.5 mb-6">
            <span className="text-[#0EA5E9] text-xs font-medium tracking-wide">Why OrbitLedger</span>
          </div>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#e2e8f0] mb-4">
            Everything you need to trade professionally
          </h2>
          <p className="text-[#94a3b8] max-w-2xl mx-auto">
            Built on the same foundations as institutional desks, delivered as a modern web platform.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {FEATURES.map(({ icon, title, desc }) => (
            <div
              key={title}
              className="bg-[#0a1929]/80 border border-[#1e3a5f] rounded-2xl p-8 hover:border-[#0EA5E9]/30 hover:shadow-[0_0_30px_rgba(14,165,233,0.08)] transition-all group"
            >
              <div className="w-12 h-12 bg-[#0EA5E9]/10 rounded-xl flex items-center justify-center mb-5 text-2xl group-hover:bg-[#0EA5E9]/20 transition-colors">
                {icon}
              </div>
              <h3 className="text-xl font-bold text-[#e2e8f0] mb-3">{title}</h3>
              <p className="text-[#94a3b8] leading-relaxed text-sm">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 max-w-7xl mx-auto px-6 py-16">
        <div className="bg-[#0a1929]/80 border border-[#1e3a5f] rounded-2xl p-10 shadow-[0_0_50px_rgba(14,165,233,0.08)]">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold text-[#e2e8f0] mb-2">Live Platform Stats</h2>
            <p className="text-[#94a3b8] text-sm">Updated every 3 seconds</p>
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
                <div className={`text-3xl font-bold mb-1 ${accent ? "text-[#0EA5E9]" : "text-[#e2e8f0]"}`} style={accent ? { textShadow: "0 0 20px rgba(14,165,233,0.5)" } : {}}>
                  {val}
                </div>
                <div className="text-[#94a3b8] text-sm font-medium">{unit}</div>
                <div className="text-[#64748b] text-xs mt-1">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="infrastructure" className="relative z-10 max-w-7xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <p className="text-[#64748b] text-sm uppercase tracking-widest mb-3">Powered by</p>
          <h2 className="text-2xl font-bold text-[#e2e8f0]">Institutional-grade infrastructure</h2>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          {INFRA_STACK.map(({ label, color }) => (
            <div key={label} className={`flex items-center gap-2 ${color} border border-[#1e3a5f] px-5 py-2.5 rounded-xl`}>
              <span className="text-[#e2e8f0] text-sm font-medium">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 max-w-7xl mx-auto px-6 py-20">
        <div className="mb-14">
          <h2 className="text-4xl font-bold text-[#e2e8f0] mb-4">Why Choose OrbitLedger?</h2>
          <p className="text-[#94a3b8] max-w-2xl">
            Every architectural decision was made with performance, safety, and trader experience in mind.
          </p>
        </div>

        <div className="space-y-10">
          {WHY_ITEMS.map(({ n, title, desc }) => (
            <div key={n} className="flex items-start gap-6 group">
              <div className="flex-shrink-0 w-12 h-12 bg-[#0EA5E9]/10 border border-[#0EA5E9]/20 rounded-xl flex items-center justify-center group-hover:bg-[#0EA5E9]/20 transition-colors">
                <span className="text-[#0EA5E9] font-bold text-sm">{n}</span>
              </div>
              <div>
                <h3 className="text-xl font-bold text-[#e2e8f0] mb-3">{title}</h3>
                <p className="text-[#94a3b8] max-w-2xl leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 max-w-7xl mx-auto px-6 py-20">
        <div className="bg-gradient-to-br from-[#0a1929] via-[#071525] to-[#0a1929] border border-[#1e3a5f] rounded-2xl p-14 text-center shadow-[0_0_60px_rgba(14,165,233,0.1)]">
          <div className="w-16 h-16 bg-[#0EA5E9] rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(14,165,233,0.5)]">
            <span className="text-white font-bold text-2xl">N</span>
          </div>
          <h2 className="text-4xl font-bold text-[#e2e8f0] mb-4">Start Trading Now</h2>
          <p className="text-[#94a3b8] mb-8 max-w-lg mx-auto">
            Join OrbitLedger. Open positions in seconds, manage risk with precision, and watch your trades execute in real time.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/signup"
              className="bg-[#0EA5E9] hover:bg-[#0284c7] text-white px-10 py-4 rounded-xl font-bold transition-all shadow-[0_0_24px_rgba(14,165,233,0.4)]"
            >
              Create Free Account →
            </Link>
            <Link
              href="/signin"
              className="border border-[#1e3a5f] text-[#94a3b8] hover:border-[#0EA5E9]/40 hover:text-[#e2e8f0] px-10 py-4 rounded-xl font-bold transition-all"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-[#1e3a5f]/40 px-6 py-8 max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#0EA5E9] rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-xs">N</span>
          </div>
          <span className="text-[#64748b] text-sm">OrbitLedger — CFD Trading Platform</span>
        </div>
        <div className="text-[#64748b] text-xs">
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

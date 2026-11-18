# System Design Gap Analysis — Paper Ship

## 1. Executive Summary
This report analyzes the gap between Paper Ship's current system design and that of a production-grade cryptocurrency exchange and retail derivatives brokerage. Paper Ship is implemented as a **synthetic Contract-for-Difference (CFD) paper broker**, rather than a Central Limit Order Book (CLOB) exchange.

---

## 2. Core Architectural Gaps

### 2.1 Order Matching vs. Synthetic Price Execution
- **Current Implementation:** Orders are filled immediately against synthetic quotes derived from Binance `aggTrade` prices + a static 50 bps half-spread (`ask = mid * 1.005`, `bid = mid * 0.995`).
- **Production Standard:** Central Limit Order Book (CLOB) with Price-Time Priority matching engine (FIFO/LMM). Buyers match against sellers; unmatched orders rest in an order book as limit bids/asks.
- **Gap:**
  - Paper Ship has **no limit order book**, no order queue, and no resting orders.
  - The platform is the universal counterparty to every trade.
  - No simulation of market depth, book slippage, or bid/ask liquidity depletion.

### 2.2 Order Types
- **Current Implementation:** Immediate Market Buy, Market Sell, Take-Profit, Stop-Loss, and Trailing Stop-Loss.
- **Production Standard:** Limit, Post-Only, Immediate-or-Cancel (IOC), Fill-or-Kill (FOK), Stop-Limit, Trailing Stop with execution triggers, and OCO (One-Cancels-the-Other).
- **Gap:**
  - Users cannot place orders at prices away from the market to wait for execution.
  - No support for execution triggers with limit offsets.

### 2.3 Margin Modes
- **Current Implementation:** Strict **Isolated Margin**. Each position's collateral is quarantined. A position liquidation cannot consume the user's remaining cash balance.
- **Production Standard:** Dual-mode architecture supporting both **Isolated Margin** and **Cross-Margin** (where unrealized PnL across all open positions acts as shared collateral).
- **Gap:**
  - Cross-margin is absent. Users with profitable long positions cannot utilize unrealized profits to prevent liquidation of underwater positions.

### 2.4 Funding Rate Mechanism
- **Current Implementation:** Fixed simulated rate of 1 basis point (0.01%) applied every 8 hours. Longs always pay 1 bp; shorts always receive 1 bp.
- **Production Standard:** Dynamic 8-hour funding rate based on the premium index:
  $$\text{Funding Rate} = \text{Clamp}(\text{Premium Index} + \text{Clamp}(0.01\% - \text{Premium Index}, -0.05\%, +0.05\%), -0.75\%, +0.75\%)$$
- **Gap:**
  - Current funding rate is static and invariant to market sentiment. In strong bull or bear runs, funding does not adjust to incentivize market balance.

### 2.5 Risk Engine Scalability
- **Current Implementation:** Every 5 seconds, `positionMonitor.ts` queries all records from `prisma.activeOrder.findMany()` and iterates over them in Node.js memory.
- **Production Standard:** In-memory order trigger engines (e.g., using Redis `ZSET` or binary search trees) evaluated in $O(\log N + M)$ time on every market price update.
- **Gap:**
  - Scalability threshold is estimated at ~5,000 active positions. Beyond this, 5-second polling creates database latency spikes and delayed liquidations during fast market crashes.

---

## 3. Maturity Assessment

| Capability | Current State | Production Standard | Gap Classification |
|---|---|---|---|
| **Order Matching** | Immediate synthetic broker fill | Multithreaded CLOB matching engine | **Major Gap** |
| **Order Types** | Market orders + TP/SL/Trailing SL | Market, Limit, Stop-Limit, IOC, FOK | **Moderate Gap** |
| **Margin System** | Isolated margin only | Isolated + Cross-margin portfolio | **Moderate Gap** |
| **Funding Engine** | Fixed 1 bp / 8 hours | Dynamic premium index feed | **Minor Gap** |
| **Risk Execution** | 5s polled DB table scan | Event-driven in-memory trigger index | **Major Gap** |
| **Identity & Auth** | Revocable session JWTs + PKCE OAuth | WebAuthn, MFA/TOTP, Password Reset | **Moderate Gap** |
| **Audit Ledger** | Transactional outbox + audit events | Double-entry general ledger with balancing check | **Minor Gap** |

---

## 4. Remediation Roadmap

1. **Short-Term (Operational Stability):**
   - Implement self-service password recovery flow.
   - Index `active_orders` by `(asset, liquidationPrice)` to eliminate the full-table scan in `positionMonitor.ts`.
2. **Medium-Term (Financial Realism):**
   - Implement limit order capability with an in-memory resting order queue.
   - Ingest live Binance funding rate and mark price streams.
3. **Long-Term (Institutional Architecture):**
   - Implement a distributed Central Limit Order Book matching engine in Rust or Go.
   - Enable cross-margin portfolio accounting.

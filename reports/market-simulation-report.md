# Market Simulation Realism Report — Paper Ship

## 1. Executive Summary
This report evaluates the realism, mathematical credibility, and limitations of Paper Ship's paper trading simulation compared to institutional and retail cryptocurrency derivative exchanges.

---

## 2. Simulation Model Evaluation

### 2.1 Quotation and Spread Simulation
- **Mechanism:** Paper Ship takes real-world trade ticks (`aggTrade`) from Binance and applies a fixed 50 bps (0.5%) half-spread:
  $$\text{Ask} = \text{MidPrice} \times 1.005$$
  $$\text{Bid} = \text{MidPrice} \times 0.995$$
- **Realism Assessment:**
  - *Strengths:* Guarantees that buyers pay the spread and sellers sell at a discount, correctly educating traders that crossing the spread creates an immediate unrealized loss.
  - *Weaknesses:* In real crypto markets, the `BTC/USDT` top-of-book spread on Binance is typically 1 to 5 bps ($0.01\% - 0.05\%$). A 50 bps spread is artificially wide for major pairs (resembling high-spread retail CFD brokers like eToro or Plus500 rather than primary crypto exchanges).
  - *Volatility Invariance:* Real spreads expand dramatically during high-volatility news events. Paper Ship's spread remains strictly 50 bps regardless of volatility.

### 2.2 Liquidity and Slippage Model
- **Mechanism:** Market orders are filled immediately at the full synthetic ask or bid price up to $1,000,000 collateral, regardless of position size.
- **Realism Assessment:**
  - *Infinite Liquidity Assumption:* A trader buying $100 of BTC and a trader buying $1,000,000 of BTC receive the identical execution price.
  - *No Order Book Impact:* Trades do not consume liquidity levels from an order book, nor do they induce slippage.

### 2.3 Carrying Costs & Perpetual Funding
- **Mechanism:** Active positions accrue a simulated 1 bp (0.01%) funding fee every 8 hours. Longs pay 1 bp of notional; shorts receive 1 bp.
- **Realism Assessment:**
  - Accurately introduces retail traders to the concept of holding costs on perpetual derivatives.
  - In real markets, funding rates fluctuate between $-0.75\%$ and $+0.75\%$ based on spot/perpetual basis divergence. Paper Ship's fixed rate does not reflect bull/bear market regimes.

---

## 3. Comparison with Real-World Exchanges

| Feature | Real Exchange (Binance / Bybit) | Retail CFD Broker (eToro / Plus500) | Paper Ship Simulation |
|---|---|---|---|
| **Execution Model** | Central Limit Order Book (CLOB) | Synthetic Dealer / B-Book | **Synthetic Dealer** |
| **Typical BTC Spread** | 0.5 to 2 bps ($0.005\% - 0.02\%$) | 30 to 80 bps ($0.3\% - 0.8\%$) | **50 bps ($0.50\%$)** |
| **Market Slippage** | Depth-dependent volume slippage | Fixed dealer spread | **Fixed dealer spread** |
| **Margin Type** | Cross-margin + Isolated margin | Isolated margin per position | **Isolated margin only** |
| **Liquidation Engine** | Continuous mark price matching | Maintenance margin threshold | **5s polled threshold** |
| **Funding Frequency** | Variable 8-hour dynamic rate | Daily overnight holding fee | **Fixed 8-hour 1 bp rate** |

---

## 4. Conclusion
Paper Ship is accurately classified as a **high-fidelity retail CFD paper broker simulator**. It faithfully simulates leverage, margin reservation, spread costs, liquidation risk, and carrying fees, but does not simulate central order book matching, order queues, or market impact.

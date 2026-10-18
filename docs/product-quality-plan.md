# OrbitLedger: trading and dashboard improvement plan

Review date: 18 October 2026
Code baseline: `93d98bc`
Status: proposed implementation plan; no application changes made during this review.

## 1. Product direction

Build a calm, dependable crypto paper trading product. Preserve the existing black theme, blue accent, and light theme. Make every displayed number explainable, every action recoverable, and every screen serve a clear task.

The trading page should help someone understand a market, open a position, and manage it. The dashboard should explain account value, exposure, and performance. These are different jobs and need different information hierarchies.

Assumed audience: retail users practicing BTC, ETH, and SOL trading with virtual USD collateral. This follows the current README and implementation. The product must consistently identify itself as paper trading, including its simulated execution and pricing rules.

Success means a user can answer these questions within ten seconds:

- Which market am I viewing, what is its price, and how fresh is that price?
- What period does this chart cover, and how much time does each candle represent?
- How much collateral and exposure will this trade create, including costs?
- What is my equity, available balance, and current P&L?
- What happened to my last trade, and where can I find its receipt?

## 2. Review coverage and limits

Reviewed the trading and dashboard routes, their components and utilities, the landing/authentication journey, market ingestion, WebSocket delivery, trade endpoints, risk monitoring, persistence, shared financial utilities, historical backfill, and deployment configuration. The tables below map findings to the relevant source files and UI elements.

The live public landing and sign-in pages were inspected using the collaborative browser at 1280 × 800. Both protected routes redirected to sign-in because the available browser session had no valid authenticated session. Findings about their current behavior are therefore based on source inspection and the supplied screenshots, not a completed authenticated browser walkthrough. Existing browser diagnostics also contained older local-development errors; those were not treated as current production failures.

No production trades, restarts, database writes, or destructive reproduction were performed. No test suite was run for this planning task. Runtime impact, concurrency behavior, populated-account layouts, mobile behavior, and accessibility need the focused verification described in section 11.

Useful foundations already exist: persistent closed-trade history, transaction-wrapped trade writes, shared price subscriptions, daily/weekly historical storage, calendar-aligned weekly bars, line/candle choices, chart retry states, dark/light variables, rate limiting, and reduced-motion CSS. Improve these foundations incrementally.

## 3. Correctness issues that take priority

These issues affect the meaning and reliability of the interface. P0 means fix or resolve before the next normal feature release; P1 means required for the redesigned product. Findings are from source unless stated otherwise.

| ID | Priority | Evidence | User impact and required outcome |
|---|---|---|---|
| F01 | P0 | `apps/Backend/src/services/stateRestoration.ts:11` calls `activeOrder.deleteMany` with `initialMargin: undefined`; the schema does not enable strict undefined checks. | Startup can issue an unfiltered delete. Remove destructive cleanup from startup, investigate affected records against snapshots/backups, and prove restart preservation on a disposable database. This review does not establish whether production positions have already been deleted. |
| F02 | P0 | `apps/Price_Poller/src/redish-publisher.ts:35` publishes seconds; `apps/Backend/src/services/priceMonitor.ts:83` subtracts that value from `Date.now()` in milliseconds. | Fresh prices appear stale to the risk monitor, which can skip TP/SL/liquidation checks. Standardize timestamps and verify the entire path with controlled prices. Open/close routes also need the same freshness check; they currently check only nonzero prices. |
| F03 | P0 | `apps/Frontend/src/app/dashboard/page.tsx:74` converts a close price to display units before passing it to the integer-price P&L helper. OrdersPanel passes scaled prices instead. | Dashboard P&L can disagree dramatically with positions. Use one unit contract and shared calculation for all consumers. |
| F04 | P0 | Dashboard line 81 computes equity as available balance plus open P&L; trade opening already deducts collateral. Lines 151, 176, and 192 use absolute values without a negative sign. | Equity omits reserved margin; losses can display as unsigned positive amounts. Define equity as available cash + reserved collateral + unrealised P&L under the chosen valuation policy, and preserve signs everywhere. |
| F05 | P0 | Signup and OAuth create database balances of 500,000 cents but call `CreateUser` without that balance. The store defaults to $50,000 or an environment value. | Initial displayed balance can differ from durable funds and change after restart. One configured allocation must be used for creation, memory, database, and UI. |
| F06 | P0 | Add-margin preserves original exposure when deriving effective leverage, while P&L still uses current `margin × original leverage`. Partial close updates margin without consistently reducing original exposure fields. `calculateLiquidation` rounds leverage to an integer. | Adding collateral can change reported profit exposure; later partial closes and liquidation can be inconsistent. Persist remaining position quantity/notional separately from collateral, and base all calculations on it. Fractional effective leverage must not be rounded away. |
| F07 | P0 | Trade handlers read in-memory balances and orders around asynchronous transactions. There is no request idempotency key or explicit per-account serialization. | Concurrent tabs, retries, and manual/automatic closes can race. Reproduce safely, then use conditional database writes/locking or serializable transactions with bounded retries, and idempotent mutation receipts. |
| F08 | P1 | `Chart.tsx:418` divides already-display-unit OHLC values by 10,000 again; backend candle responses already convert their prices. | Header/crosshair prices can contradict the plotted axis. Format candle prices directly and keep conversion at defined boundaries. |
| F09 | P1 | `Chart.tsx:294` usually shows the latest 40–75 bars even after loading a larger selected range. Intraday sources only contain collected trades; daily/weekly history uses a separate backfill. | Choosing 1W/3W can appear ineffective or show incomplete coverage. Fit the selected visible period, choose appropriate resolution, and report actual coverage. A higher row cap does not create missing history. |
| F10 | P1 | Account activity is a React array capped at 25 entries, timestamped when received. Only opened/closed/liquidated events are recorded. Partial close and add-margin routes do not publish corresponding events. | Activity disappears on reload and misses important changes. Persist account events and reconcile/replay after reconnect. Provide a distinct public market-trades feed. |
| F11 | P1 | `api/trade.ts` converts Axios errors to generic `Error`; BuySell then expects Axios error details. Open-position loading/close failures often only log to the console. | Users cannot reliably understand whether an action failed or succeeded. Preserve structured errors, show local recovery, and reconcile ambiguous submissions before retry. |
| F12 | P1 | Redis quote publishing manufactures bid/ask at ±0.5% around trade price. Frontend/backend asset APIs contain fixed fallback prices. Market percentage changes use the page-session opening quote. | Quotes, spread, and change labels lack clear meaning. Label simulation quotes/costs explicitly, use actual 24h market statistics, and never present fallback values as executable live prices. |

Prisma's documented default drops `undefined` filters; its example specifically demonstrates the unfiltered-delete risk. This supports F01, but production effects still require investigation. [Prisma null and undefined documentation](https://www.prisma.io/docs/orm/v7/prisma-client/special-fields-and-types/null-and-undefined).

Additional financial requirements: record entry/exit fees explicitly, distinguish gross and net P&L, and show that added collateral currently also incurs a fee. Avoid counting partial-close records as entirely separate winning trades without an explicit metric definition. Evaluate migrating scaled prices and monetary amounts from 32-bit `Int` fields to appropriate wider representations; price fields scaled by 10,000 currently top out near $214,748.36, including liquidation prices.

## 4. Trading page: proposed experience

### Desktop arrangement

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ OrbitLedger   Trade   Dashboard       Paper account   Status   Settings │
├─────────────────────────────────────────────────────────────────────────┤
│ BTC/USDT ▾    Last price    24h change    High / Low    Volume           │
├──────────────────────────────────────────────┬──────────────────────────┤
│ Interval: 1h ▾   Candles / Line   Fullscreen  │ Buy / Long   Sell / Short│
│ O / H / L / C · selected timestamp            │ Market                   │
│                                              │ Available collateral     │
│                PRICE CHART                   │ Margin                   │
│                                              │ Leverage                 │
│              Volume (optional)               │ Protection ▾             │
│ Range: 1D  1W  3W  1M  3M  1Y  All   UTC    │ Exposure / fee / est. liq│
│                       Return to latest        │ Place paper trade        │
├──────────────────────────────────────────────┤                          │
│ Positions (2) | Trade history | Market trades│                          │
│ Filter / selected market / export            │                          │
│ Data rows; expand a row for receipt/activity  │                          │
└──────────────────────────────────────────────┴──────────────────────────┘
```

Use a stable ticket width of roughly 320–360px on wide screens. Give the chart most of the working area. Keep the core ticket and its submit action visible on an ordinary laptop. Allow the bottom panel to expand or collapse; start with a fixed useful default before adding drag resizing.

### Element-by-element changes

| Existing element | Proposed change | Acceptance |
|---|---|---|
| Logo and repeated navigation | One shared application header; consistent OrbitLedger mark; persistent Trade/Dashboard links. | Moving between pages preserves market preferences and visual orientation. |
| Three market tiles | One selected-market heading with a compact BTC/ETH/SOL selector; optional compact watchlist later. | Market, quote, chart, and ticket switch together; stale responses cannot overwrite the selected market. |
| Percentage badges | Real 24h change with an explicit label; show unavailable state until provided. | Refreshing the browser does not reset the market statistic to zero. |
| Interval buttons in global header | Move beside the chart and label “Candle interval.” Keep common choices visible, overflow in a menu. | Users distinguish “one candle per week” from “show the last week.” |
| Range buttons | Place under the plot; label the displayed period and offer a custom date range later. | 1W and 3W display the entire requested available period. |
| Candle/line toggle | Retain as a direct control with saved preference. | Switching style keeps symbol, range, and viewport; no unnecessary history reload. |
| OHLC header | Correct scaling; include selected timestamp; display values from the actual hovered bar. | Header and price axis agree; line hover never combines a historical close with the latest candle's other fields. |
| “Live / Paused” | Separate connection health from chart following. Show “Return to latest” only after panning away. | A disconnected feed can never remain labeled Live just because follow mode is on. |
| Zoom and home icons | Keep compact zoom/reset controls; replace home metaphor with fit/reset icon; add fullscreen. | All controls are named, keyboard accessible, and preserve context. |
| Price chart | Subtle grid, readable axes, correct dates, optional volume, position/TP/SL markers after data correctness. | Multi-day intraday views show dates as well as times; weekly buckets begin Monday UTC. |
| Buy/Sell tabs | Use “Buy / Long” and “Sell / Short” consistently with position rows. | Side meaning remains clear without color. |
| Price duplication | Show one estimated execution quote for the selected side and a concise spread disclosure. | Explain the difference between Binance trade price and simulated execution price. |
| Margin input and ± controls | One currency field; useful balance-percentage shortcuts; disclose fee-adjusted maximum. | Blank, nonfinite, below-minimum, and unaffordable values have persistent inline errors. |
| Leverage options | One authoritative selected value; retain 1x default; move uncommon values into a compact selector if necessary. | Exposure and estimated liquidation update consistently with the server calculation. |
| Position-size badge | Neutral summary showing notional exposure and base quantity, distinct from margin. | Adding collateral does not silently increase position quantity. |
| Risk controls | Keep progressive disclosure; show enabled values in the collapsed summary. Show fields only when enabled. | Switching side/asset revalidates saved levels; no hidden stale BTC target on a SOL trade. |
| TP/SL percentage shortcuts | Say whether percentages mean underlying price move or return on margin. | Estimated gross/net outcomes use the same assumptions as execution. |
| Trailing stop | Asset-aware distance and percentage inputs with useful limits; derive from shared rules. | Avoid universal $500 defaults and $10 bounds that behave very differently for BTC and SOL. |
| Fee/total footer | Separate collateral, opening fee, exposure, and estimated liquidation; disclose exit cost separately. | “Total” does not imply collateral is a purchase price or that all lifecycle costs are included. |
| Submit button | Explicit paper-trade action, disabled for unavailable/stale quote or invalid input. | In-flight side and amount are frozen; retries cannot duplicate a trade. |
| Submission result | One durable receipt link and one concise notification. | HTTP response and WebSocket event do not produce duplicate success messages. |
| Empty positions | Small, explanatory state with a useful action, leaving chart space available. | Initial loading or failed retrieval never looks like confirmed “no positions.” |
| Logout/theme | Put in shared header/account menu; remove floating positioning. | Neither overlaps chart tools, dialogs, or mobile navigation. |

### Positions, history, and market activity

**Positions:** Show symbol + side, remaining size, margin, entry, current valuation price, signed P&L, and close action. Put TP, SL, estimated liquidation, original/effective leverage, fees, and timestamps in row details. Keep Close visible; place partial close/add collateral in a clearly named menu. Group by market if the account becomes busy. Default to all account positions with an explicit selected-market filter, so switching charts never hides account risk silently.

**Trade history:** Add open/close timestamps, close reason, fees, gross/net P&L, receipt ID, and the relationship between partial closes and their original position. Provide date/symbol/side filters, sorting, cursor pagination, and CSV export. Preserve filters on navigation. Fetch errors must retain previously loaded rows and show retry. Add a drawer for the full trade lifecycle instead of filling the table with every field.

**Market trades:** Show actual public exchange executions for the selected symbol: exchange time, price, quantity, and source. Extend ingestion and WebSocket delivery to preserve trade identity and quantity; preserve source side information if buy/sell classification is shown. Add a recent-trades snapshot endpoint, then append/deduplicate streaming prints. Bound the visible list and offer pause/resume so rows remain readable. Mark reconnection gaps and restore recent prints.

**Account activity:** Persist opens, closes, partial closes, collateral additions, automatic risk closes, and protection updates. Make this available through trade details and an account-activity view. Keep it private to the authenticated account. Market trades must never expose other users' account positions.

A quote table is not an order book. Depth requires an actual order-book data source with snapshot/delta synchronization. Add depth only after market trades and charts are reliable, and place it behind an optional panel.

## 5. Chart behavior and historical data contract

### Range and resolution

Treat visible date range and candle interval as separate state. Start with these proposed automatic defaults, then tune to chart width:

| Visible history | Initial candle interval | Approximate density |
|---|---|---|
| 1 day | 15 minutes | 96 candles |
| 1 week | 1 hour | 168 candles |
| 3 weeks | 4 hours | 126 candles |
| 1 month | 4 hours | 180 candles |
| 3 months | 1 day | 90 candles |
| 1 year | 1 day | 365 candles |
| All | 1 week | Several hundred candles |

Let experienced users override the interval. If their choice produces three weekly candles in a three-week view, say “3 weeks · 1-week candles”; that is a legitimate sparse view. Do not manufacture more bars or silently truncate a period. If density is too high, offer a coarser interval with a clear explanation.

### Required chart engineering

1. Normalize financial values and timestamps at the API boundary. Give scaled prices, display prices, cents, and milliseconds distinct types.
2. Keep one chart instance per mount. Update series/data or chart options for style/theme changes, preserving the viewport where appropriate.
3. Scope requests and candle state to symbol + interval + range. Abort superseded fetches and ignore stale results. Remove reliance on a module-global mutable last candle for request coordination.
4. Fit the chosen time range on selection. Do not apply the same 75-bar viewport to every loaded period. Respect practical candle spacing at the actual canvas width.
5. Fetch the first intersecting candle at range boundaries, including the Monday-start weekly bar. Return requested and actual start/end, earliest available history, completeness, source, and update time.
6. Persist interval, range, chart type, and selected market in URL/preferences. Support browser Back/Forward and reload; scope account state separately and clear it on logout/account change.
7. Use event time from the source for live candle buckets. Handle duplicate/out-of-order ticks, visibility changes, and connection gaps. Re-fetch the overlapping active bars after reconnect.
8. Repair/finalize recent closed daily/weekly bars as well as the current bar. The current five-minute sync fetches only the active bucket, so rollover can leave the previous close incomplete.
9. Retain genuine BTC/ETH history from 2019 and SOL from its available listing history. Report actual per-symbol coverage. Backfill missing intraday OHLC where needed; recent raw trades alone cannot provide old 1h/4h bars.
10. Paginate/load older bars while panning. Validate bounded queries server-side. Detect PostgreSQL/Timescale capabilities once rather than deliberately failing a query on every request. Cache completed candle ranges.
11. Preserve data on recoverable error. Use local retry rather than “Reload Page.” Separate no trades in a period, missing ingestion, partial coverage, network failure, and rate limiting.
12. Throttle React-visible quote/header updates while allowing the chart to update smoothly. Prevent every market tick from rerendering unrelated ticket and history content.

## 6. Dashboard: proposed experience

```text
┌───────────────────────────────────────────────────────────────────────┐
│ Shared application header                         Paper account      │
├───────────────────────────────────────────────────────────────────────┤
│ Account overview                           Updated …   Open trading  │
│ Equity              Available cash       Reserved margin   Open P&L  │
├─────────────────────────────────────────┬─────────────────────────────┤
│ Equity over time                        │ Exposure and risk           │
│ 1W  1M  3M  All                         │ Positions by asset          │
│                                         │ Collateral / available cash │
│                                         │ Nearest liquidation risk    │
├─────────────────────────────────────────┴─────────────────────────────┤
│ Open positions: selected summary rows → manage in trading             │
├─────────────────────────────────────────┬─────────────────────────────┤
│ Recent completed trades                 │ Performance                 │
│ Date · market · result · receipt        │ Net realised P&L · fees     │
│ View all history                        │ Win rate · sample size      │
└─────────────────────────────────────────┴─────────────────────────────┘
```

| Current element / gap | Proposed change | Acceptance |
|---|---|---|
| Dashboard title + logout | Shared shell; one account-overview title and primary “Open trading” link. | Same account, theme, and status controls as trading. |
| Equity card | Correct inclusive valuation; strongest visual emphasis; help text explaining components. | Agrees with trading/account API to the smallest supported money unit under the same quote snapshot. |
| Available-balance card | Label cash available for new collateral; show USD clearly. | Fee-adjusted spendability is explained when relevant. |
| Missing reserved-margin metric | Add reserved collateral alongside available cash. | Opening a position moves cash into collateral without implying the whole margin was lost. |
| Open P&L | Preserve signs and show unavailable valuation when quotes are missing. | Unknown P&L is never rendered as confirmed zero. |
| Missing equity chart | Add persisted equity snapshots with cash, margin, P&L, timestamp, and valuation status. | Show truthful recorded history; current balance snapshots alone are not historical equity. |
| Existing user/order snapshots | Assess whether historical snapshots can reconstruct values with matching historical quotes. | Mark unavailable periods; do not synthesize a smooth account-performance line. |
| Largest-position-only summary | Show actual compact position rows with symbol, side, exposure, P&L, and a trading deep link. | User can identify and manage each exposure. |
| Missing risk overview | Show allocation by exposure and collateral, plus meaningful nearest-liquidation distance. | Label quantities clearly; never imply leverage exposure is cash holdings. |
| Realised P&L / win rate | Explicit net/gross definition, fees, period filter, trade-grouping policy, sample size. | Partial exits and breakeven trades follow documented rules. |
| Missing recent activity | Latest completed trades with time, outcome, and receipt; link to full history. | All figures update after trade events and after returning to the tab. |
| Initial one-shot loading | Shared cached account query, stream invalidation, reconnect/focus refresh, partial error handling. | Another tab's trade is reflected without reloading; failed history does not log the user out. |
| Full-page “Loading dashboard...” | Stable skeleton for each section, independent error/retry states. | First paint has a useful structure and no misleading zero financial values. |
| Grid and glow background | Plain surfaces and consistent spacing, with a single visual priority. | Information remains readable in both themes and at narrower widths. |

Start with equity, available cash, reserved collateral, P&L, real position rows, and recent history. Add the equity chart once its snapshot contract is trustworthy. Keep performance analysis compact until enough genuine history exists.

## 7. Shared interface and journey

### Design system

- Preserve black/charcoal surfaces and the existing blue accent. Preserve the light theme with separately checked contrast.
- Use a readable sans font for labels/navigation/body and tabular numerals or mono for financial data. The current Tailwind `sans` and `mono` both use JetBrains Mono.
- Use three surface levels and a consistent spacing scale. Replace nested card borders, glows, and gradients with spacing and a few clear dividers.
- Target 14px normal labels and 12px secondary text. Remove 9–11px critical financial labels. Define consistent price precision, currency grouping, plus/minus signs, percentages, zero, and unavailable values.
- Use blue for selected controls, semantic positive/negative colors for outcomes, and neutral styling for exposure. Pair direction/status with words and signs.
- Create shared Button, Field, Select, SegmentedControl, Tabs, Money, Status, EmptyState, DataTable, and Dialog primitives. One component should define focus, disabled, loading, error, and success behavior.
- Connect Tailwind colors to the CSS variables; remove the parallel old navy palette. Put the theme toggle in the shell. Record the existing palette in brand documentation during implementation without reopening brand selection.
- Use local or controlled asset icons with fallbacks; constrain external image hosts. Replace repeated inline SVG/emoji decoration with a consistent icon library where meaningful.

### Responsive behavior

Wide desktop: chart plus ticket, with bottom account data. Laptop: compact chart tools, expandable lower panel, no crushed chart area. Tablet: chart and positions with a clear trade drawer. Mobile: market summary, chart, positions/history tabs, and a persistent “Trade” action opening a full-height ticket sheet. Essential risk and financial summaries remain available.

Use content-driven breakpoints, safe-area padding, and 44px product touch targets. Remove the mobile layout that stacks a minimum 620px workspace above a separate minimum 620px ticket. Avoid horizontal page scrolling and nested scroll traps. Tables may have contained horizontal scrolling or purpose-built mobile rows.

### Accessibility and recovery

Target WCAG 2.2 AA: visible labels, keyboard-operable tabs/selectors, consistent focus, adequate contrast, reduced motion, and meaningful error/status announcements. Dialogs need a title, focus trap, Escape close, and focus return. Do not announce every market tick to screen readers; provide a readable selected-price summary and an optional data table. [W3C accessibility requirements](https://www.w3.org/WAI/WCAG22/quickref/).

Replace browser alerts and console-only failures with inline recovery. Keep validation messages until resolved. Show stale data with its timestamp and retain the user's trade draft. Only a confirmed authentication failure should end a session; network errors, rate limits, or a history-service failure must not be treated as invalid login.

### Landing, sign-in, and account identity

The landing currently presents fixed ticker prices, example portfolio values with a LIVE label, infrastructure-focused copy, and unverified speed claims. Position it around practicing with virtual funds, understanding costs, and reviewing trades. Clearly label demonstrations, or replace them with measured/live data. Its “500ms” risk-monitor claim disagrees with the implementation's 5000ms cycle. The old Navbar also still identifies itself as Exness; remove unused branding and normalize the current O/N marks.

Give sign-in/signup proper email/password labels, input types, autocomplete, persistent field errors, and clear provider availability. Preserve the intended destination after sign-in. Add account recovery and session management to the product backlog. Harden session handling: replace tokens in callback URLs/localStorage with an appropriate secure session flow, plan same-origin cookie/BFF integration carefully for Vercel/Railway, and require verified provider identity before linking accounts by email. Do this with authentication regression coverage.

## 8. Data and application architecture

| Area | Required change | Reason |
|---|---|---|
| Shared financial contract | Central typed domain module for price scale, cents, quantity, fees, exposure, liquidation, symbols, and time units. | UI and server must agree; current conversion code is duplicated. |
| Account state | One frontend account cache/store with balance, positions, history, and version/update time. | Eliminate independent fetches and delayed balance displays across BuySell, OrdersPanel, trading, and dashboard. |
| Account summary API | Return an authoritative versioned account snapshot, including valuation timestamp and stale status. | Prevent equity assembled from unrelated points in time. |
| HTTP client | Shared base URL/auth/error handling, timeouts, abort signals, structured domain errors, and safe retry policy. | Preserve the distinction between invalid input, unauthenticated, offline, rate-limited, and unknown submission outcome. |
| WebSocket client | One managed transport with public market and private account channels, heartbeat, backoff with jitter, current auth, cleanup, and reconnect reconciliation. | Current trading route opens a second socket while the singleton ignores order events. Logout leaves singleton/subscription state alive. |
| Event delivery | Persistent account event IDs, versions, server timestamps, and an outbox written in the same transaction as financial mutations. | Redis pub/sub alone cannot replay missed events or guarantee post-commit delivery. |
| Trade persistence | Database-authoritative writes, idempotency, conditional transitions, and immutable execution/fee/balance entries. | In-memory maps and snapshots must not determine correctness across replicas or crashes. |
| History model | Parent position + execution/partial-exit records with fees, reason, quantity, and net outcome. | Clear receipts, exports, win rate, and lifecycle auditability. |
| Equity snapshots | Persist genuine valuation snapshots with freshness metadata; aggregate for chart ranges and apply retention. | Balance-only snapshots cannot drive a trustworthy equity chart. |
| Historical candles | Persist required intraday OHLC, repair gaps/rollovers, report coverage, cache completed ranges. | The current daily/weekly seed does not fill old minute/hour gaps. |
| Ingestion durability | Retain/retry failed batches; bound queues and expose lag. Kafka consumer/direct writer currently drop a batch after failure. Fix trade deduplication identity to include symbol. | Charts and market tape require complete, correctly deduplicated data. |
| Snapshot storage | Retention/compaction, bounded writes, and a documented restore purpose. | Current snapshots append every user's balance and orders every ten seconds indefinitely. |
| Operational health | Separate liveness from readiness and market freshness; measure ingest lag, candle coverage, risk-cycle errors, and order-event delivery. | A 200 `/health` does not establish functional trading. |
| Release workflow | Verify the same revision for frontend/API/WebSocket/poller; validate migrations, effective deploy commands, and data coverage. | A successful frontend deploy alone does not make the complete product functional. |

Keep Next.js, Bun, PostgreSQL, Redis, and lightweight-charts. Keep Kafka optional unless measured throughput/replay requirements justify it. Prioritize reliable contracts and bounded workloads before introducing additional infrastructure.

## 9. Source ownership and implementation map

| Existing source area | Planned responsibility |
|---|---|
| `apps/Frontend/src/app/trading/page.tsx` | Compose shell, selected market, chart, ticket, and lower panel; remove transport/auth/calculation duplication. |
| `apps/Frontend/src/app/dashboard/page.tsx` | Account overview sections using shared account summary and valuation rules. |
| `apps/Frontend/src/components/Chart.tsx` | Chart rendering/controller; separate range controls, data query, viewport, crosshair, and connection state. |
| `apps/Frontend/src/components/BuySell.tsx` | Split the 990-line component into ticket fields, protection controls, preview, and mutation flow. |
| `apps/Frontend/src/components/OrdersPanel.tsx` | Split the 660-line component into positions, history, receipts, and accessible mutation dialogs. |
| `ThemeToggle.tsx`, `globals.css`, `layout.tsx`, `tailwind.config.ts` | Shared shell integration, typography, tokens, and accessible primitives. |
| `Navbar.tsx`, `AskBidsTable.tsx` | Remove/replace unused legacy UI; retain useful types in the domain layer rather than importing types from UI components. |
| `src/utils/price_store.ts`, `subscription_manager.ts` | Managed market/account subscriptions, freshness, auth lifecycle, efficient selectors. |
| `src/utils/chart_agg_ws_api.ts`, `chartviewmanager.ts` | Scoped candle updates, source event time, safe history handoff; remove unused viewport helper after checking references. |
| `src/utils/utils.ts`, `constants.ts`, `src/types/asset.ts` | Align with shared financial contracts; remove duplicate/misspelled conversion helpers. |
| `src/api/trade.ts`, `asset.ts`, `profit.ts` | Split market/account/auth/trade APIs, preserve structured failures, remove unused files only after reference checks. |
| `src/app/page.tsx`, `signin`, `signup`, `auth/callback`, `OAuthButtons.tsx` | Honest product framing, consistent brand, accessible entry flow, secure session handoff. |
| `apps/Backend/src/routes/trades.ts`, `utils/PnL.ts`, `utils/tradeUtils.ts` | Financial invariants, idempotent database mutations, receipts, fees, and concurrency control. |
| `services/stateRestoration.ts`, `snapshotService.ts`, `data/store.ts` | Safe startup, bounded snapshots, cache-only memory state, consistent initial balances. |
| `services/priceMonitor.ts`, `positionMonitor.ts`, `pnlService.ts` | Correct clock units/freshness, consistent valuation, tested risk transitions. |
| `routes/asset.ts`, `services/services.ts`, `marketCandleSync.ts` | Coverage-aware historical API, validated queries, rollover repair, no executable fallback prices. |
| `services/orderBroadcast.ts`, `apps/Websocket/src/*` | Typed events, scoped private delivery, replay, heartbeat, auth lifecycle, backpressure. |
| `apps/Price_Poller/src/*` | Quote provenance, public trade events, durable ingestion, timestamp and identity consistency. |
| `routes/user.ts`, `routes/oauth.ts`, `services/oauthService.ts`, `config/oauth.ts`, `middleware/auth.ts`, JWT/password utilities | Consistent identity/balance creation, verified account linking, recoverable and secure sessions. |
| `middleware/rateLimit.ts` | Retain shared limits; support Retry-After and distinguish polling/read traffic from trade actions. |
| `services/platformProfit.ts` | Keep operator metrics outside user account performance; derive consistent totals from ledger entries. |
| `packages/shared/src/*` | Authoritative domain types, constants, arithmetic, and conversion boundaries. |
| `packages/database/prisma/*`, `packages/database/src/index.ts` | Additive schema evolution, safe constraints/indexes, execution/event/valuation history, bounded connection setup. |
| `scripts/seed-historical-data.ts`, `check-seed-needed.ts`, `check-chart-data.*` | Resumable coverage backfill and read-only diagnostics for both raw trades and stored candles. Existing seed-needed check only counts raw Trade rows. |
| `railway.json`, workspace scripts/configs, `turbo.json`, README | Effective multi-service deployments, CI, staging, accurate operational instructions. Remove the root `fix-db` command's missing-file reference. |

## 10. Delivery sequence

Estimates below are provisional hands-on effort for one engineer familiar with this codebase. They include focused verification but exclude uncertain data recovery, large historical backfills, and external provider delays. Sequence by acceptance gates rather than promising a calendar date.

| Stage | Scope | Rough effort | Exit condition |
|---|---|---|---|
| 0. Stabilize account integrity | F01–F07; shared money/time rules; safe restart and controlled risk-price scenarios. | 3–5 days, investigation may expand | No unexplained balance/exposure changes; restart retains positions; fresh prices reach risk checks; concurrency cases reconcile. |
| 1. Repair chart and live data | F08–F12; full-period viewport, scoped requests, freshness, saved preferences, range coverage, ingestion retry. | 3–5 days plus backfill time | 1W/3W/All behave predictably across symbols, switches, refresh, and reconnect. |
| 2. Establish shared interface | Header, typography, tokens, accessible primitives, state/error conventions, honest paper-account language. | 2–3 days | Both themes and shared navigation work at desktop/tablet/mobile sizes. |
| 3. Rebuild trading composition | Focused ticket, chart controls, positions/history receipts, real market tape, private persisted events. | 4–7 days | End-to-end open/manage/close/history and reconnect journeys pass with no duplicate execution or notifications. |
| 4. Rebuild account dashboard | Authoritative account snapshot, live positions, risk overview, recent trades, clear performance metrics. Add equity chart after genuine snapshots exist. | 3–5 days | Dashboard and trading reconcile; unavailable history is explained; no fabricated historical equity. |
| 5. Release hardening | Session improvements, retention, operational readiness, CI, representative load, accessibility, staged rollout/rollback. | 4–7 days, partly concurrent with earlier work | Release gates in section 11 pass against the candidate service revisions. |

This is roughly four to seven engineer-weeks with the stated uncertainty. Stage 0 should ship as a small reviewed correction before the broader visual work. Break later work into independently reviewable changes, with migrations deployed compatibly before consumers.

Keep the first redesign focused. Defer custom drag-and-drop workspaces, dozens of indicators, social feeds, leaderboards, strategy recommendations, and order-book depth until the core flows are demonstrably dependable. They would compete for the clarity the user requested.

## 11. Definition of ready

### Financial and persistence scenarios

- [ ] Signup and OAuth allocate the same configured virtual balance in memory and durable storage.
- [ ] Opening a position changes available cash, reserved margin, and fees correctly; equity changes only according to declared costs and valuation.
- [ ] Dashboard, positions, receipts, and API agree on signed P&L for long/short, flat, winning, and losing positions.
- [ ] Added collateral leaves quantity unchanged; partial close reduces quantity and collateral consistently; subsequent liquidation and close remain correct.
- [ ] Controlled fresh/stale quote scenarios exercise TP, SL, trailing stop, and liquidation with documented timing and execution assumptions.
- [ ] Simultaneous submissions/closes and a lost HTTP response never produce duplicate executions or incorrect balances.
- [ ] A disposable-database restart preserves balances, positions, protection, events, and history without cleanup deletions.

### Chart and stream scenarios

- [ ] BTC/ETH/SOL × representative intervals × 1W/3W/All show correct actual coverage, OHLC, boundaries, and UTC dates; unavailable combinations explain why.
- [ ] Candle/line switch, theme switch, fast market/range switch, refresh, Back/Forward, and multiple tabs preserve expected context.
- [ ] Weekly/daily rollover finalizes completed bars and creates the next active bar correctly.
- [ ] Offline/reconnect recovers missed bars/account events without duplicates; background-tab resume reconciles authoritative state.
- [ ] Market tape contains genuine source prints with quantity and timestamp; account events remain private and survive refresh.
- [ ] No stale/fallback quote is executable or represented as a healthy live market.

### Interface and operational scenarios

- [ ] Populated and empty accounts, long tables, large/negative amounts, slow requests, 401/403, 429, server error, and partial service failure all have clear states.
- [ ] Desktop 1440×900 and laptop 1280×800 retain usable chart/ticket space; 768px tablet and 375/390px mobile flows are complete; keyboard and 200% zoom remain usable.
- [ ] Dark and light themes pass contrast and keyboard/dialog checks; screen-reader status is informative without continuous tick announcements.
- [ ] First account read, chart-range response, event delay, and ingestion lag are measured with representative data. Provisional goals: cached account/chart reads p95 under 500ms and committed account events reflected within one second under healthy staging conditions. These are targets, not current claims.
- [ ] Frontend and all backend services run type checks/builds and focused financial/stream integration checks in CI. Validate the frontend's existing lint command and configure ESLint explicitly rather than assuming it works.
- [ ] Record dependency health and data freshness separately from process liveness. Add alerts for dropped batches, risk-cycle skips, stale quotes, and candle gaps.
- [ ] Test migrations and backup restoration on staging; validate effective Railway predeploy settings instead of assuming repository configuration was applied. Run historical jobs separately/resumably rather than making every release depend on a full external backfill.
- [ ] Deploy a small release, verify the complete frontend/API/WebSocket/poller revision set, and retain a compatible rollback path. Observe fresh quotes, one controlled paper-trade lifecycle, and history retrieval before declaring it live.

## 12. Reference patterns and rationale

The recommended organization is our design judgment, informed by the following primary sources:

- [Coinbase Advanced dashboard overview](https://help.coinbase.com/en/coinbase/trading-and-funding/advanced-trade/dashboard-overview): separates price charts, order books, and live trade history. Apply the distinction between market activity and private account history.
- [Kraken Pro interface guide](https://support.kraken.com/articles/kraken-pro-trading-interface-guide): organizes trading into market chart, order entry, and account/order widgets. Apply clear task grouping with a compact default layout.
- [TradingView time-scale documentation](https://tradingview.com/charting-library-docs/latest/ui_elements/Time-Scale/): distinguishes the visible date range and describes fitting data through the time scale. Apply separate, clearly labeled range and interval controls.
- [Prisma undefined-query behavior](https://www.prisma.io/docs/orm/v7/prisma-client/special-fields-and-types/null-and-undefined): supports the startup-query finding and the need for safe filtering.
- [W3C WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/): use as the accessibility acceptance framework.

These references guide interaction patterns; they do not establish parity in execution quality, security, availability, or financial operations. Each of those requires the implementation and verification above.

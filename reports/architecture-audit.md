# Architecture Audit Report — Paper Ship

## 1. Executive Architecture Summary
Paper Ship is architected as a **hybrid modular service system** governed within a Turborepo monorepo running on Bun and Node.js. It separates operational concerns across:
1. **Ingestion & Spooling Service (`apps/Price_Poller`):** Autonomous daemon consuming Binance WebSocket `aggTrade` events, spooling to local disk via SQLite WAL mode, publishing synthetic CFD quotes (+50 bps spread) to Redis Pub/Sub, and batch-inserting trades into PostgreSQL/TimescaleDB.
2. **Real-time Gateway Service (`apps/Websocket`):** Stateful gateway managing public price subscriptions and authenticated private client order push notifications.
3. **Transactional Core (`apps/Backend`):** Express 5 REST API handling authentication, account state mutations, risk watchdog checks (5-second intervals), perpetual funding calculations (8-hour intervals), and historical candle synchronization.
4. **BFF Security Proxy & Web Client (`apps/Frontend`):** Next.js 15 App Router providing client UI and an API bridge (`/api/bridge/[...path]`) that terminates `httpOnly` session cookies, signs client IP headers via HMAC, and guards against CSRF/XSS.
5. **Shared Packages (`packages/*`):** `database` (Prisma 7 with `pg.Pool`), `shared` (financial formulas, scaled integer math, JWT claim contracts, security helpers).

---

## 2. Component Responsibility Matrix

| Component | Responsibility | Logic Classification | Runtime Criticality | Dependencies |
|---|---|---|---|---|
| **`packages/shared`** | Scaled price/USD arithmetic, liquidation equations, fee rates, quote freshness, HMAC signatures. | Domain & Security | **Critical** (All services) | `jsonwebtoken` |
| **`packages/database`** | Prisma schema, migration history, connection pooling (`pg.Pool`), raw SQL execution. | Infrastructure & Persistence | **Critical** | `pg`, `@prisma/adapter-pg` |
| **`apps/Backend`** | User registration, authentication, advisory locked mutations, background risk engine, outbox publisher. | Business & Transactional Logic | **Critical** | `packages/database`, `packages/shared`, Redis |
| **`apps/Frontend`** | UI rendering (Lightweight Charts), client state stores (`useAccount`, `useMarket`), BFF security proxy. | Presentation & Edge Security | **Critical** | `packages/shared`, Backend API, Websocket |
| **`apps/Price_Poller`** | Binance feed ingestion, crash-resilient disk spooling, Redis synthetic price publication, DB retention pruning. | Streaming & Ingest | **Critical** | `packages/database`, `packages/shared`, Redis, SQLite |
| **`apps/Websocket`** | Client subscription management, rate-limiting incoming WS messages, ephemeral ticket validation, event push. | Transport & Gateway | **Critical** | `packages/database`, `packages/shared`, Redis |

---

## 3. Data Flow Architecture

### 3.1 Market Data Flow
```
Binance (wss://data-stream.binance.vision:443/ws)
   │ [aggTrade events]
   ▼
apps/Price_Poller (binance.ts)
   ├──> Synchronous enqueue into local SQLite WAL (.data/market-spool.sqlite)
   ├──> Compute synthetic spread: ask = mid * 1.005, bid = mid * 0.995
   └──> Publish to Redis channels: "BTC", "ETH", "SOL"
           │
           ├──> apps/Backend (priceMonitor.ts) -> PriceStorageMp (In-Memory Mark Price Cache)
           └──> apps/Websocket (websocket-server.ts) -> Broadcast to subscribed browser clients
```

### 3.2 Transactional Order Flow
```
User Browser (BuySell.tsx)
   │ HTTP POST /api/bridge/trade/open (Cookie: papership-session)
   ▼
Next.js BFF Bridge (route.ts)
   │ Verify Origin === nextUrl.origin
   │ Extract JWT from papership-session cookie
   │ Generate HMAC signature: SHA256(secret, v1\ntimestamp\nip)
   ▼
Express Backend (/api/v2/trade/open)
   │ Middleware: authRateLimit, tradeOpenRateLimit
   │ Verify JWT claims & verify session active in database (auth_sessions)
   ▼
accountService.ts (mutateAccount)
   │ BEGIN TRANSACTION
   │ SELECT pg_advisory_xact_lock(hashtext(userId))
   │ Verify quote freshness (< 30s)
   │ Deduct Margin + Opening Fee (0.5%)
   │ INSERT INTO active_orders
   │ UPDATE users SET balanceCents, version = version + 1
   │ INSERT INTO AccountEvent (deliveredAt = null)
   │ INSERT INTO MutationReceipt (key, fingerprint, response)
   │ COMMIT TRANSACTION
   ▼
Transactional Outbox (orderBroadcast.ts)
   │ Poll AccountEvent where deliveredAt IS NULL (every 250ms)
   │ Publish to Redis channel: orders:userId
   │ UPDATE AccountEvent SET deliveredAt = NOW()
   ▼
WebSocket Gateway (websocket-server.ts)
   │ Pushes ACCOUNT_EVENT frame to user's active WebSocket connection
   ▼
Browser (useAccount hook)
   │ Dispatches window event 'papership-account-event' -> Triggers refreshAccount()
```

---

## 4. Architectural Weaknesses and Risks

1. **Unbounded Risk Scan ($O(N)$ Database Query):**
   - *Evidence:* `checkCycle` in `positionMonitor.ts` executes `prisma.activeOrder.findMany()` every 5 seconds.
   - *Impact:* Evaluates the entire platform's open positions in memory. As open orders grow into thousands, this will cause memory pressure, connection pool starvation, and delayed liquidations during market volatility.
2. **Dual State Drift (Memory Store vs Database):**
   - *Evidence:* `store.ts` in `apps/Backend` maintains `StoreData` and `orderStorageMap` in-memory alongside the relational database.
   - *Impact:* While `accountService` writes directly to Prisma, legacy utility functions reading from `store.ts` can read stale or desynchronized state if mutations occur across multiple processes.
3. **Single Process Ingestion Spool:**
   - *Evidence:* `Price_Poller` is a single instance bound to a single local SQLite database.
   - *Impact:* If the host server crashes, ingestion halts until process supervisor restarts it. Cannot be horizontally scaled without partition keys.
4. **Hardcoded Funding Rate:**
   - *Evidence:* `perpFunding.ts` applies a static 1 bp (0.01%) fee every 8 hours regardless of real market funding dynamics.
   - *Impact:* Educational only; diverges from genuine crypto perpetual contract economics.

---

## 5. Architectural Recommendations

1. **Implement Price-Indexed Trigger Queues:** Replace the 5-second `findMany()` database scan with Redis Sorted Sets (`ZSET`) keyed by `(asset:liquidation_price)`. When new quotes arrive, use `ZRANGEBYSCORE` to only fetch and close breached positions.
2. **Complete In-Memory Store Deprecation:** Remove `StoreData` and `orderStorageMap` in `store.ts`, migrating all reads to Prisma queries and Redis caching.
3. **Decouple Risk Engine into Dedicated Worker:** Split the background risk loop and funding processor from the Express HTTP API process into an independently scalable worker.

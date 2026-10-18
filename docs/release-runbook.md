# OrbitLedger release and recovery runbook

This change implements the trading/dashboard rebuild and the supporting financial, market, session, and persistence contracts. It has been tested locally against isolated PostgreSQL databases. It is **not a production rollout or a claim that historical account data has been recovered**.

## Before applying the migration

1. Take a verified database backup and rehearse restoring it to a disposable database. Preserve legacy user/order snapshots and database logs as evidence. Do not restart the old backend while investigating the startup deletion bug.
2. Compare active positions and balances with backups, order snapshots, and execution history. The old startup query may have deleted positions; this cannot be inferred from the current table alone. Do not recreate positions by guessing or credit a balance twice.
3. Pause trading and stop all old API/risk-monitor writers. This is a coordinated release: old clients lack idempotency keys and old writers do not maintain the new exposure fields. Mixed financial writers are unsupported. Keep the maintenance window until the new API, WebSocket service, poller, and frontend are verified at the same revision.
4. Run `bun install --frozen-lockfile`, then `bun run prisma generate` and `bun run prisma migrate deploy` from the repository root. Historical backfills are separate jobs; they are deliberately removed from every release's predeploy command.
5. Review the migration's inferred exposure. Positions with both historical partial exits and added collateral are marked `needsReview`; valuation and mutations are disabled for these positions until independently reconciled. A reviewed data repair must set verified remaining notional/collateral/allocated costs and clear the flag under the same account advisory lock. Retain the evidence and audit record. Do not clear the flag merely to make trading available.

Read-only audit examples:

```sql
SELECT "orderId", "userId", margin, "initialMargin", "addedMargin",
       "notionalCents", "needsReview", "feesRecorded"
FROM active_orders ORDER BY "openedAt";

SELECT "positionId", count(*) AS exits, sum(margin) AS collateral_exited,
       sum(pnl) AS gross_pnl, bool_and("feesRecorded") AS fees_complete
FROM closed_orders GROUP BY "positionId";

SELECT "userId", version, kind, "positionId", "createdAt", "deliveredAt"
FROM "AccountEvent" ORDER BY "createdAt" DESC LIMIT 100;
```

Legacy executions have unknown fees; the UI does not claim complete net results or win rates for these accounts. Existing user balances are preserved. New allocations use `INITIAL_BALANCE_USD` consistently (default $5,000). Legacy snapshot deletion is off by default; set `LEGACY_SNAPSHOT_RETENTION_DAYS` only after recovery review. New equity valuations have a 366-day retention policy. Immutable receipts/events are retained for replay and audit.

## Service configuration

- **API:** `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `PORT`, `CORS_ORIGINS`, and optionally `INITIAL_BALANCE_USD`, `DATABASE_POOL_SIZE`, OAuth provider settings, and `FRONTEND_URL`. `/health` reports liveness/revision; `/ready` reports database, market freshness, and risk-cycle health.
- **Frontend:** server-only `API_URL` must point to the API base ending `/api/v2`. `NEXT_PUBLIC_API_URL` is the public API base for provider redirects. `NEXT_PUBLIC_WEBSOCKET_URL` is the public `wss://` endpoint. Public variables are build-time values. Use HTTPS in production: the session cookie is Secure, HttpOnly, SameSite=Lax. Mutations pass a same-origin check in the frontend proxy.
- **WebSocket:** use its own Railway config at `apps/Websocket/railway.json`, with `REDIS_URL`, the same `JWT_SECRET`, and platform `PORT`. It provides `/health` and `/ready`, public market subscriptions, and authenticated account delivery. WebSocket tickets last 60 seconds, are refreshed in memory, and cannot authenticate API mutations. Backpressure closes slow connections; clients reconcile after reconnect.
- **Poller:** use `apps/Price_Poller/railway.json`, `DATABASE_URL`, `REDIS_URL`, platform `PORT`, and `INGEST_SPOOL_PATH` on a **persistent volume**. Default local path is `.data/market-spool.sqlite`. Unacknowledged writes survive restart; do not delete or share a spool across processes. At its 250,000-print capacity ingestion halts and reports failure; restore downstream capacity, drain/restart, and backfill the source gap. `/ready` exposes ingest freshness/backlog/failure independently from liveness.
- **Optional Kafka:** set `KAFKA_BROKERS`. The producer persists locally before broker publication and waits for all replicas; the consumer commits offsets after database writes. Retain the existing deployed consumer group deliberately when migrating (the new group is `orbitledger-durable-writer` and replays retained data with database deduplication). Configure broker retention, replication, and storage separately.

This project currently uses manual Railway uploads: a Git push updates Vercel but does not deploy the Railway API/workers. Complete the compatible service update before the frontend. Verify API contract/readiness and proxy routes with `bun scripts/verify-release.ts <site-origin> <api-origin> <websocket-http-origin>`. See the [18 October deployment correction](deployment-incident-20261018.md).

The root Railway config belongs to the API. Configure the other services' config paths explicitly in Railway. Never assume a repository file overrode dashboard settings. Record each service's deployed Git SHA and effective build, predeploy, start commands, and health checks.

## Historical coverage and snapshots

`bun run seed-data` repairs daily/weekly bars from 2019, including the first intersecting weekly bucket. It deduplicates completed bars on rerun. For intraday coverage, run a bounded job with explicit history settings, for example:

```sh
HISTORY_START=2026-09-18 HISTORY_INTERVALS=1m,5m,15m,1h,4h bun run seed-data
bun scripts/check-seed-needed.ts
```

Set the start date appropriate to the release; do not blindly request years of minute candles. Reruns are resumable through deduplication, but rescan the requested window to repair gaps. The API reports requested/actual/earliest coverage and incompleteness. Binance listing dates can constrain coverage. A 50,000-bar limit returns an actionable error instead of silently truncating the request. The API synchronizes the previous and current bucket every minute to repair rollovers. Older gaps require the bounded job.

Equity is **available cash + reserved collateral + gross close-quote P&L**. If any position lacks a fresh quote or verified exposure, equity and aggregate open P&L are unavailable. Five-minute genuine snapshots retain this stale status. Chart sampling preserves actual timestamps; it never reconstructs an equity curve from deposits or cash-only snapshots.

## Financial and delivery policy

- Prices use integer units of 1/10,000 USD; money uses integer cents; source timestamps use milliseconds. PostgreSQL double precision stores these integer amounts exactly within JavaScript's safe integer range. Financial calculations use BigInt for intermediate P&L and liquidation products and enforce safe integer outputs. Currency inputs accept at most two decimal places.
- Simulated execution quotes are the Binance trade price plus/minus 0.5%. Each opening, collateral addition, and exit charges 0.5% of the collateral involved, rounded down to cents. Net exit results allocate prior entry/addition fees proportionally; the final exit receives remaining fee rounding. Gross open P&L excludes exit fees.
- Remaining notional/quantity are separate from collateral. Added collateral preserves quantity; partial exits reduce exposure and collateral proportionally with integer conservation. Liquidation uses the actual collateral/notional ratio, including fractional leverage.
- Isolated gap losses are capped at the position's collateral. An exit fee cannot consume unrelated cash when a position has lost all collateral. Stops fill at fresh simulated quotes and can slip beyond the level. Risk checks run every five seconds and revalidate their trigger inside the account transaction.
- Every mutation locks its account before reading durable state. Its execution, balance change, versioned event, and idempotency receipt commit together. A retry uses the same request key and returns the stored result, including after a close or restart. Different payloads cannot reuse a key. Unknown outcomes remain frozen and recoverable in the browser's per-account saved request.
- The outbox delivers events at least once. Event IDs and account versions reconcile state; they do not generate duplicate success toasts. The authenticated events endpoint replays missed events. Visible accounts also reconcile by polling; background tabs pause and resume on visibility/online changes. Redis is never the durable execution ledger.

## Candidate checks and rollout

Run `bun run check-types`, `bun run lint`, `bun run test`, `bun run build`, then integration tests with a dedicated **local** database named `actioncd_quality_*`. The integration runner refuses other hosts/database names. Apply migrations to an empty disposable database and to a copy containing legacy positions; validate the review flags and preserve balances. Run `bun run prisma migrate diff --from-config-datasource --to-schema packages/database/prisma/schema.prisma --exit-code` against the candidate.

In staging verify signup/password login and **both actual OAuth providers** with configured credentials. OAuth requires verified email, refuses automatic linking by email, and exchanges an expiring one-use code through the frontend. No bearer token belongs in a redirect URL or browser storage. Account recovery and user-facing session revocation remain product backlog items from the plan; key rotation/revocation procedures must be tested operationally.

Exercise a controlled paper lifecycle, simultaneous tabs, a lost HTTP response, Redis outage/reconnect, stale quotes, rollover, worker restart, slow clients, rate limits, and expired sessions. Verify dark/light at 1440×900, 1280×800, 768px, 390px, 375px, keyboard navigation, and 200% zoom. Measure p95 reads and commit-to-visible event latency with representative staging load; local latency is not a production SLO.

Alert on stale source time, missed/failed risk cycles, spool backlog/capacity, old undelivered outbox events, incomplete candle ranges, and repeated HTTP failures. Alerts/backup schedules and the production dependency audit require deployment-platform configuration; repository code alone cannot establish them.

For rollback, stop financial writers first. Keep the expanded schema and immutable records; prefer a forward fix or the last verified compatible build. Do **not** roll back to the old destructive startup or old collateral/exposure logic. Restore a backup only through the rehearsed incident procedure with reconciliation of every execution since the backup. Do not run a destructive schema rollback against live accounts.

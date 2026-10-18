# OrbitLedger

OrbitLedger is a crypto paper trading workspace for BTC, ETH, and SOL. It uses virtual USD collateral and simulated execution quotes derived from Binance public trades. No real assets are bought or sold.

The Trading page separates market context, chart intervals/ranges, trade entry, positions, completed trades, public market prints, and private account activity. Dashboard reconciles available cash, reserved collateral, signed P&L, exposure, and genuine equity history.

## Local setup

Install Bun 1.3+ and PostgreSQL 14+ / Redis, or use Docker Compose:

```sh
cp .env.example .env
bun install
# Optional when PostgreSQL and Redis are not already running:
docker compose up -d
bun run prisma generate
bun run prisma migrate deploy
bun run dev
```

Configure local connection strings and a long random `JWT_SECRET` before starting. The frontend uses port 3000, API 5000, and WebSocket 8080. Set `PORT` for the API and `WEBSOCKET_PORT` for the local WebSocket process; keep production service variables separate. Kafka is optional and stays disabled when `KAFKA_BROKERS` is empty. The poller's optional local health port is `POLLER_HEALTH_PORT`.

Never commit environment files, database credentials, or provider secrets. `.env.example` contains local defaults only. `INITIAL_BALANCE_USD` defaults to $5,000 and configures the same durable and in-memory allocation for password and OAuth signup.

## Architecture

- `apps/Frontend`: Next.js 15 / React 19, lightweight-charts, shared account cache and one managed market/account WebSocket transport. A same-origin server proxy holds the API session in an HttpOnly cookie. Browser storage never contains a bearer token.
- `apps/Backend`: Express / Bun, Prisma / PostgreSQL, Redis quote subscription, a five-second risk cycle, five-minute genuine equity valuations, and a durable transactional event outbox. Account transactions lock their account before reading or changing balances and positions. Memory is a cache, not financial authority.
- `apps/Websocket`: public market subscriptions and private versioned account events. Short-lived in-memory tickets authenticate private delivery; event replay and account reads reconcile reconnect gaps.
- `apps/Price_Poller`: Binance aggregate trades, simulated quote publication, a durable SQLite spool, and direct PostgreSQL persistence. With Kafka configured, locally persisted batches are acknowledged by all broker replicas and consumer offsets advance only after database writes. Deduplication includes symbol and source trade identity.
- `packages/shared`: scaled-price/cents/time contracts, freshness, P&L, fees, liquidation, quantities, interval boundaries, and formatting.
- `packages/database`: account/execution/event/receipt/valuation models, public trade history, and stored candles. Plain PostgreSQL works; TimescaleDB is optional.

Equity equals **available cash + reserved collateral + gross open P&L**. Unknown/stale valuations remain unavailable. Added collateral does not increase quantity. Net execution results include allocated opening/addition costs and exit fees. Quotes include a simulated ±0.5% spread; opening, adding collateral, and closing each charge 0.5% of the collateral involved. Stops can slip, and isolated gap losses are capped at reserved collateral. See the [financial and release policy](docs/release-runbook.md).

## Historical data

Run history jobs separately from deployments:

```sh
# Daily and weekly history since 2019 (including intersecting weekly buckets):
bun run seed-data
# Explicit bounded intraday backfill; choose the window you need:
HISTORY_START=2026-09-18 HISTORY_INTERVALS=1m,5m,15m,1h,4h bun run seed-data
# Coverage diagnostics across markets and intervals:
bun scripts/check-seed-needed.ts
```

The jobs deduplicate completed bars on rerun and repair the requested window. The API refreshes previous/current candles across all intervals every minute. Actual coverage and missing history are reported; large requests require a coarser interval rather than silently truncating the period. Genuine equity snapshots begin after the new service runs; they cannot reconstruct earlier equity from old cash snapshots.

## Verification

```sh
bun run check-types
bun run lint
bun run test
bun run build
# Apply migrations to an isolated local DB named actioncd_quality_* first:
DATABASE_URL=postgresql://quality:quality@localhost:5432/actioncd_quality_local bun run test:integration
```

The integration runner refuses nonlocal databases or other database names. CI applies migrations to a disposable PostgreSQL database and runs checks, lint, tests, and builds. The [implementation report](docs/implementation-report.md) records local browser, financial, migration, and dependency-audit results and their limits.

## API

The API base is `/api/v2`. Browser clients use `/api/bridge/*` on the frontend, which forwards the server-held session. Direct service clients may use an API bearer token. All financial mutation requests require a stable `Idempotency-Key`; retries must preserve both key and input.

| Endpoint                                                                                                                 | Purpose                                                                        |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `POST /user/signup`, `/user/signin`                                                                                      | Password account/session creation                                              |
| `GET /auth/status`, `/auth/google`, `/auth/github`                                                                       | Provider availability and login                                                |
| `POST /auth/exchange`                                                                                                    | Exchange a verified, expiring one-use OAuth code                               |
| `GET /user/balance`, `/user/ws-ticket`                                                                                   | Durable cash and short-lived private stream ticket                             |
| `GET /user/profile`, `/user/workspace`                                                                                   | Private account details, saved markets, and alerts                             |
| `POST /user/workspace/watchlist`, `/user/workspace/alerts`, `/user/workspace/alerts/:id`, `/user/workspace/check-alerts` | Save/remove watched markets; create, remove, rearm, and check in-app alerts    |
| `GET /trade/summary`                                                                                                     | Versioned account snapshot and position valuations                             |
| `POST /trade/open`, `/trade/close`, `/trade/partial-close`, `/trade/add-margin`, `/trade/protection`                     | Idempotent position mutations                                                  |
| `GET /trade/history`                                                                                                     | Symbol/side/date/receipt filters, close-time sorting, cursor pagination        |
| `GET /trade/receipt/:positionId`, `/trade/events?after=version`                                                          | Private lifecycle receipts and replay                                          |
| `GET /trade/equity`, `/trade/performance`                                                                                | Genuine valuation history and grouped completed-position metrics               |
| `GET /asset`, `/asset/candles`, `/asset/trades`, `/asset/stats`                                                          | Fresh quotes, coverage-aware candles, public executions, actual 24h statistics |

`/health` reports API liveness/revision. `/ready` reports dependency/quote/risk health separately. WebSocket and poller services expose their own health/readiness endpoints. Rate limits and structured failures distinguish invalid requests, authentication, unavailable quotes, and ambiguous submissions.

## Presenting the MVP

See [the five-minute walkthrough](docs/mvp-guide.md) for the complete Home → Dashboard → saved market/alert → paper trade → receipt → account journey, verification, and clear feature boundaries. Signed-in users can always visit Home and return to Dashboard.

## Deployment

Vercel hosts `apps/Frontend`; set server-only `API_URL`, public `NEXT_PUBLIC_API_URL`, and `NEXT_PUBLIC_WEBSOCKET_URL`. Production sessions require HTTPS. Railway runs API, WebSocket, and poller separately. The root `railway.json` is the API config; set the other services' config paths to `apps/Websocket/railway.json` and `apps/Price_Poller/railway.json`. The poller needs a persistent volume for `INGEST_SPOOL_PATH`.

**Existing installations require a coordinated financial-writer migration and legacy data review.** Stop old writers, preserve backups/snapshots, apply the migration, then deploy and verify the matching service revisions. Do not mix the old and new financial writers or roll back to the old destructive startup logic. [The release and recovery runbook](docs/release-runbook.md) covers migration flags, unknown legacy fees, operational gates, monitoring, and rollback.

## License

This project is private and proprietary By Sanskar Shukla.

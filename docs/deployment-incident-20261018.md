# 18 October deployment correction

The production Vercel frontend had advanced to the new account/market contracts while the Railway API, WebSocket service, and poller remained on an older manually uploaded release. Railway services have no Git repository source configured, so pushing `main` updated Vercel but did not update those services. `/api/v2/trade/summary` returned the old generic route-not-found response for every account; old market payloads also failed the new freshness contract. Changing signup email could not resolve this.

## Correction and verification

- Stopped the old financial writer, backed up the actual Neon database used by the API/poller, and restored that backup to an isolated local database. The separate Railway Postgres service is not the application database.
- Deployed the tested integrity migration and API, current WebSocket service, and millisecond-source poller. Added a persistent `/data` poller volume and configured its SQLite spool there. Updated the WebSocket build command to generate the shared Prisma client.
- Compared the pre-release backup with the migrated application database: both original account cash balances and both original active positions (ID, collateral, entry price) were preserved. No historical deleted positions were invented or repaired.
- Production readiness confirmed all three source markets fresh and the risk cycle completing without errors. WebSocket readiness confirmed both Redis connections. Created one explicitly named release-check account with virtual funds to verify signup → session cookie → account summary → trading. No existing account credentials were used and no paper trades were placed in existing accounts.
- The frontend proxy now checks the API contract before forwarding requests, including signup. A mismatched release returns a recoverable 503, preserves existing sessions, and cannot silently create an account against an old API. Checks are deduplicated/cached for 15 seconds. Failed account polling backs off to 30 seconds instead of repeatedly requesting broken routes.
- Added automated compatibility tests for old/non-JSON/failed health responses, trailing slash normalization, and concurrent compatibility checks. Authentication messages now clearly request sign-in instead of exposing internal wording.

The database backup is stored outside the repository with restricted permissions under `~/.local/state/orbitledger/recovery/`. It contains private account data and must never be committed.

## Future releases

A Git push alone does **not** deploy the Railway services in this project. Deploy every affected service deliberately and record its deployment ID/revision. The API health response advertises `apiContract: 2`; CLI uploads should set `APP_REVISION` to the source revision, since `RAILWAY_GIT_COMMIT_SHA` is absent for uploads. Apply service-specific build/start settings; retain the poller volume. Complete compatible API/worker deployment before promoting the frontend.

Run the read-only routing/readiness checks after all services are updated:

```sh
bun scripts/verify-release.ts https://orbit-ledger-web.vercel.app https://backend-production-fd159.up.railway.app https://websocket-production-e7ca.up.railway.app
```

These checks complement an actual authenticated signup/signin browser journey; they do not establish full production load, provider OAuth, or historical-data recovery claims. The wider release gates and remaining dependency audit findings still apply; see [the release runbook](release-runbook.md).

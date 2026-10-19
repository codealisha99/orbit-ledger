# OrbitLedger MVP and demo guide

OrbitLedger is a crypto paper trading application for BTC, ETH, and SOL. It combines source exchange data with simulated execution, virtual USD collateral, recorded equity, and an account-owned workspace. There are no deposits, withdrawals, or real exchange orders.

## A five-minute project walkthrough

1. **Start at Home.** Show the interactive illustrative long/short example. The example is explicitly separate from real market data. Create an email/password account or sign in. A completed sign-in opens Dashboard; an explicit internal destination is preserved.
2. **Make Dashboard yours.** Star a market. Switch to Saved. Reload or sign in on another device to show that the watchlist belongs to the account, not the browser. An empty account has a short getting-started checklist.
3. **Save a price alert.** Pick a market, threshold, and at-or-above/below direction. A fresh exchange price meeting the condition records a trigger. Remove or rearm it. Alerts are in-app only, checked every ten seconds while Dashboard is visible; they never place trades or send email/push notifications.
4. **Place a paper trade.** Open the saved market. Choose collateral and leverage. Read the costs, exposure, quantity, and liquidation estimate before submitting. Use stop loss/take profit if desired. The submitted quote must be fresh.
5. **Manage and review it.** Add collateral without increasing exposure, partially exit, or fully close. Open the lifecycle receipt and inspect entry/exit costs and signed net results. History supports filters, sorting, pagination, and CSV export. Dashboard receipt links open the exact receipt in history.
6. **Return to Dashboard.** Compare available cash, reserved collateral, open P&L, equity, risk, and completed-position performance. Equity history uses actual recorded five-minute snapshots, so a new account honestly starts without a full curve.
7. **Show the account journey.** Open Account for profile details, a JSON workspace download, and the trading guide. Home remains accessible while signed in and links back to Dashboard. The brand returns to Dashboard. Opening sign-in/signup while already authenticated returns to the intended app destination. Sign out and sign in again to demonstrate persistence.

Use a dedicated account with virtual funds for demonstrations. Never display another person's credentials, private receipts, or database exports.

## Implemented MVP boundaries

- Email/password signup, sign-in, session-aware navigation, logout, and optional Google/GitHub OAuth when configured.
- Three supported markets, fresh exchange prices, source trades, coverage-aware history, and a responsive trading workspace.
- Account-owned persistent watchlists and up to twelve durable in-app price alerts, with fresh-quote checks and ownership enforcement.
- Idempotent account mutations, isolated loss caps, partial exits, collateral additions, protection, execution receipts, persisted account activity, and shared account reconciliation.
- Account overview, recorded equity, exposure/risk, performance, history export, account details, and a saved-workspace download.
- Black and light app themes, mobile navigation, accessible native dialogs, explicit empty/unavailable states, and reduced-motion support.

This is an educational simulation, not a brokerage. Simulated execution does not reproduce every condition on a real exchange. Password recovery, email ownership verification, email/push alerts, additional assets, and real-money trading are outside this MVP. Logout now revokes the current session server-side, and Account offers sign-out on all devices. See `security-review-20261019.md`. The wider dependency and operational gates in the release runbook remain relevant.

## Verification for this pass

- **34 tests / 136 assertions** passed: financial/time contracts, ingestion durability, HTTP authentication/privacy, idempotency, workspace persistence, alert retries/stale checks/ownership/capacity, and safe navigation destinations.
- All four applications pass types and builds; frontend ESLint passes.
- Migration deploy and schema diff verified against an isolated database. The new migration adds only `user_watchlist` and `price_alerts`; it does not alter cash, orders, or execution history. A pre-release production backup is stored outside the repository with restricted permissions.
- Browser checks covered signed-in Home, automatic return from sign-in to Dashboard, saved-market persistence, alert creation/trigger display, Account, receipt deep links, and 1280px/390px layouts without page overflow.
- An isolated local account completed a real API-backed flow: saved ETH → fresh alert → open $25 position → full close → receipt → completed-position metrics. It ended with zero reserved collateral and one completed position. No production user's position was used for the test.

Deploy the API/migration first, verify `capabilities.workspace` in `/health`, then publish the frontend. A Git push does not automatically update this project's manually uploaded Railway services. Run the release checks after every coordinated deploy; see [the runbook](release-runbook.md) and [the previous deployment incident](deployment-incident-20261018.md).

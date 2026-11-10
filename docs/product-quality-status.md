# Product quality plan — closure status

Audited 2026-11-10 against the live source of `main` (`7ed86e5` redesign plan plus subsequent fixes).
Reference: [product-quality-plan.md](product-quality-plan.md).

## Verdict by stage

| Stage | Verdict | Evidence |
|---|---|---|
| 0. Stabilize account integrity (F01–F07) | Closed | F01: startup restore is read-only (`stateRestoration.ts`). F02: freshness flows through shared `isFreshQuote`; no seconds-vs-ms arithmetic remains. F03/F04: single source of truth `accountSummary` — equity = balance + reserved + signed open P&L, stale → null; consumers use `signedMoney` or consume server-computed `pnlCents`. F05: signup + OAuth both use env-validated `INITIAL_BALANCE_CENTS`. F06: `notionalCents` persisted separately; partial closes reduce it deterministically (`splitAmount` floor division, covered by unit tests); fractional effective leverage preserved. F07: idempotency receipts with fingerprint check + per-user advisory lock + bounded retries in one transaction. |
| 1. Repair chart and live data (F08–F12) | Closed | F08: one `/10000` boundary per path (chart bars, price lines agree). F09/F10: `AccountEvent` model persisted with replay endpoints; add-margin and partial close emit typed events. F11: structured `ApiError` with status/code and `UNKNOWN_OUTCOME` recovery; mutations carry `Idempotency-Key`. F12: 24h stats fetched from Binance with 503 on failure — no fallback prices; simulated spread labeled in UI. |
| 2. Establish shared interface | Closed | Terminal Study token system (`--nt-*`, dark/light twins), IBM Plex Sans/Mono, one nav shell, `brand.md` as design source of truth; verified dark + light at 1440/1280 and 390px mobile. |
| 3. Rebuild trading composition | Closed | Ticket, chart controls, positions/history/receipts, market tape, persisted private events; live-quotes verification done locally with no duplicate execution paths (advisory-lock + receipt idempotency). |
| 4. Rebuild account dashboard | Closed | Authoritative snapshot from `accountSummary`, equity only when fresh, risk/distance-to-liquidation panel, signed P&L everywhere; no fabricated equity history. |

## Quality suite (green as of audit)

- `bun run check-types` — 4/4 tasks
- `bun run test` — 16/16 (7 files)
- `bun run test:integration` — 24/24 (2 files, against disposable Postgres)
- `bun run build` — all workspaces
- `scripts/verify-release.ts` — 6/6 against production (web, API, WebSocket)
- CI (`.github/workflows/quality.yml`): security audit → prisma migrate → types → lint → unit → integration → build, on push/PR

## Accessibility audit (browser-verified)

- Contrast: all measured combinations pass AA. Fixes applied: `--nt-side-ink` split (dark ink on side fills in dark theme, white ink in light; active buy/sell tab went 2.9 → 5.79), `--nt-dim`/`--nt-muted` pair raised in both themes (dim 3.26 → 5.49 dark / 5.21 light; muted → 7.13 dark / 6.89 light), landing `--launch-dim`/`--launch-muted` aligned (+5.49 on micro text).
- Dialogs: native `<dialog>` + `showModal()` — focus trap, Escape close, focus return, `aria-labelledby`; close button has `aria-label` + `autofocus`.
- Errors: `role="alert"` on notices; impossible-action states resolve to `EXPOSURE_REVIEW` / `POSITION_CHANGED` messages, not silent failure.
- Reduced motion: all animations gated behind `prefers-reduced-motion: no-preference` in all three stylesheets.
- Marketing live-region: landing demo result is `aria-live="polite"`; no per-tick announcements in the trade UI.
- Reflow: zero horizontal overflow at 390×844 on landing/trading/account; trading chart and ticket collapse to single column.

## Manual verification still recommended

- Keyboard `:focus-visible` ring (rule exists at `globals.css` `:focus-visible`) — the browser harness's synthetic key events do not register the keyboard modality, so confirm with real Tab presses in the app.
- WCAG reflow at exactly 320px width (390px passes cleanly; harness viewport resizing could not reach 320 during the audit).
- A screen-reader pass over the open/manage/close journey (VoiceOver or NVDA).

## Remaining operational items (Stage 5, platform work)

These need Railway/staging access; they are not code tasks:

- [ ] Alerts on dropped ingest batches, risk-cycle skips, stale quotes, candle gaps (separate from process liveness).
- [ ] Representative load test of feed + trade paths; measure p95 for account/chart reads against the 500ms target.
- [ ] Staged rollout + rollback drill on Railway; validate predeploy migration settings.
- [ ] Backup restore drill on staging (disposable-database restart preservation).
- [ ] Historical backfill run as a resumable separate job.

Design-scoped deferrals remain as planned: drag-and-drop workspaces, indicators, social/leaderboard features are intentionally out of scope until core journeys need them.

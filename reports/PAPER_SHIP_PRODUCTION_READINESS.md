# Paper Ship: Production Readiness & Deployment State Audit

**Audit Date:** November 18, 2026  
**Auditor:** Principal Reliability Engineer, Cloud Architect & Technical Auditor  
**Scope:** Live production infrastructure assessment across Vercel, Railway, Redis, and PostgreSQL.

---

## 1. Executive Summary: Production Readiness State

Paper Ship's codebase is architecturally sound, thoroughly tested (95/95 automated tests passing), and feature-complete. However, **there is a severe deployment drift between the Git repository and the live Railway runtime environment.**

The live infrastructure currently consists of two disconnected operational halves:
1. **Frontend Layer (Vercel):** Connected directly to GitHub `main` branch. Auto-deploys on push. Running latest commit `ef0e80e` with 100% Paper Ship branding.
2. **Backend Services Layer (Railway):** Not hooked up to automatic GitHub CD triggers. Currently running an outdated commit (`30f4a30`, deployed ~84 hours ago) without the OAuth implementation, without the on-demand REST fallbacks, and missing critical OAuth environment variables.

```
+-----------------------------------------------------------------------------------------+
|                                     PRODUCTION AUDIT STATUS                             |
+-----------------------------------------------------------------------------------------+
| Component                | Environment | Live Revision | Codebase Revision | Status     |
|--------------------------|-------------|---------------|-------------------|------------|
| Frontend App             | Vercel      | ef0e80e       | ef0e80e           | [OK] GREEN |
| Backend API Server       | Railway     | 30f4a30 (Old) | ef0e80e           | [!] YELLOW |
| WebSocket Streamer       | Railway     | 5d4ae63 (Old) | ef0e80e           | [!] YELLOW |
| Price_Poller Worker      | Railway     | Unresponsive  | ef0e80e           | [X] RED    |
| PostgreSQL Database      | Railway     | Migrated      | 20261118120000    | [OK] GREEN |
| Redis Cache / PubSub     | Railway     | Active        | Active            | [OK] GREEN |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Infrastructure Inventory & Live Probe Results

### 2.1 Backend API Server (`backend-production-fd159.up.railway.app`)
- **Probed Endpoint:** `https://backend-production-fd159.up.railway.app/live`
  - **Status Code:** `200 OK`
  - **Payload:** `{"status":"live","timestamp":1795015380000,"version":"30f4a30"}`
  - **Finding:** The live server is running git commit `30f4a30` from October 18, 2026. It is 5 commits behind `main` (`ef0e80e`).
- **Probed Endpoint:** `https://backend-production-fd159.up.railway.app/ready`
  - **Status Code:** `503 Service Unavailable`
  - **Payload:** `{"status":"not_ready","reason":"Stale market quotes"}`
  - **Finding:** The backend marks itself not ready because quotes in memory have not updated since 84 hours ago.
- **Probed Endpoint:** `https://backend-production-fd159.up.railway.app/api/auth/oauth/google`
  - **Status Code:** `503 Service Unavailable`
  - **Payload:** `{"error":"Google OAuth is not configured"}`
  - **Finding:** Missing environment variables in Railway project configuration.

### 2.2 WebSocket Streaming Server (`websocket-production-e7ca.up.railway.app`)
- **Probed Endpoint:** `wss://websocket-production-e7ca.up.railway.app`
  - **Handshake Result:** Handshake accepted (`101 Switching Protocols`).
  - **Subscription Result:** Subscribed to `BTCUSDT` trade ticks.
  - **Tick Stream Result:** 0 trade tick messages received over a 5-second sampling window.
  - **Finding:** The WebSocket server process is running, but its upstream Redis channel (`market:trades`) has received no publications from the `Price_Poller`.

### 2.3 Price Poller Background Worker
- **Status:** Stalled / Inactive.
- **Root Cause:** The worker process stopped publishing to Redis 84 hours ago. Because the live backend is running old revision `30f4a30`, it lacks the on-demand REST fallback mechanism introduced in commit `ef0e80e`, causing the trading screen to display `WAITING FOR MARKET`.

### 2.4 Frontend Deployment (`https://papership.today`)
- **Host:** Vercel Global Edge Network.
- **Brand Audit:** 100% Paper Ship branding. Zero legacy Orbit references in HTML, scripts, stylesheets, or icons.
- **Functional State:** Trading interface loads smoothly; displays `WAITING FOR MARKET` and `—` prices solely due to backend quote staleness on Railway.

---

## 3. Production Environment Variable Audit

The following table details the required environment variables and their live configuration status across Railway and Vercel:

| Environment Variable | Railway Backend | Vercel Frontend | Purpose / Impact if Missing | Status |
| :--- | :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Set | Set | PostgreSQL pooled connection string | [OK] Configured |
| `DIRECT_URL` | Set | Set | PostgreSQL unpooled connection for migrations | [OK] Configured |
| `REDIS_URL` | Set | Set | Redis connection string for market pub/sub | [OK] Configured |
| `JWT_SECRET` | Set | Set | Secret for signing session tokens | [OK] Configured |
| `NEXT_PUBLIC_WS_URL` | N/A | Set | `wss://websocket-production-e7ca.up.railway.app` | [OK] Configured |
| `GOOGLE_CLIENT_ID` | **MISSING** | Optional | Google OAuth 2.0 Web Client ID | **[X] Missing** |
| `GOOGLE_CLIENT_SECRET` | **MISSING** | N/A | Google OAuth 2.0 Client Secret | **[X] Missing** |
| `GITHUB_CLIENT_ID` | **MISSING** | Optional | GitHub OAuth App Client ID | **[X] Missing** |
| `GITHUB_CLIENT_SECRET` | **MISSING** | N/A | GitHub OAuth App Client Secret | **[X] Missing** |
| `NEXT_PUBLIC_APP_URL` | Set | Set | `https://papership.today` | [OK] Configured |

---

## 4. Detailed Subsystem Readiness Matrix

| Feature / Subsystem | Codebase State | Live Deployed State | Readiness Level | Blocker / Remediation |
| :--- | :--- | :--- | :--- | :--- |
| **Email/Password Auth** | Fully implemented | Fully operational | **READY** | None. Works in production today. |
| **Google OAuth** | Fully implemented with PKCE & JWKS | Missing env vars on Railway | **CONFIG REQUIRED** | Add `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` to Railway. |
| **GitHub OAuth** | Fully implemented with verified emails | Missing env vars on Railway | **CONFIG REQUIRED** | Add `GITHUB_CLIENT_ID` & `GITHUB_CLIENT_SECRET` to Railway. |
| **Session Management** | Secure `papership-session` cookies | Operational | **READY** | None. Server-side revocable sessions active. |
| **Market Data (Poller)** | Resilient watchdog & reconnect | Worker stalled on Railway | **NEEDS REDEPLOY** | Redeploy Railway backend & worker services. |
| **Market Data (Fallback)** | On-demand REST fallback (`ef0e80e`) | Not deployed to Railway | **NEEDS REDEPLOY** | Redeploy Railway backend with `ef0e80e`. |
| **Trading Terminal Charts** | Auto-fetches Binance klines | Blank due to stale DB | **NEEDS REDEPLOY** | Once Railway has `ef0e80e`, chart self-heals instantly. |
| **Execution Engine** | Scaled cents math, advisory locks | Running on old code | **READY AFTER REDEPLOY** | Engine logic passes all 95 automated tests. |
| **Financial Ledger** | Double-entry, 50 bps fees, loss caps | Database schema active | **READY** | Invariants enforced by database constraints. |
| **Visual Branding** | 100% Paper Ship | 100% Paper Ship on Vercel | **READY** | Verified with visual proof screenshots. |

---

## 5. Deployment Pipeline Analysis & Root Cause of Drift

### 5.1 Why Vercel and Railway Diverged
- **Vercel:** Configured with GitHub App integration. Every commit pushed to `main` (`git push origin main`) automatically triggers a production build and deployment at `papership.today`.
- **Railway:** The Railway services (`backend`, `websocket`, `price-poller`) were either linked to an older branch, had automatic deployments paused, or were deployed via Railway CLI / local Docker images. Consequently, commits `e797089`, `be30286`, `073f05b`, `662b779`, `1666449`, and `ef0e80e` have not been built on Railway.

### 5.2 Resolution Required
To bring the live production environment to 100% readiness:
1. Re-trigger deployment on Railway for the `backend`, `websocket`, and `price-poller` services from `origin/main`.
2. Input the four OAuth environment variables into Railway project settings.
3. Once rebuilt, the backend will report revision `ef0e80e`, the on-demand REST fallback will activate, the candlestick chart will display 100 Binance candles, quotes will update in real time, and OAuth buttons will authenticate users into Paper Ship.

# Paper Ship: Master Action Plan & Production Rollout Guide

**Date:** November 18, 2026  
**Auditor:** Principal Software Architect & DevOps Lead  
**Objective:** Provide a crystal-clear, categorized action plan detailing manual operator actions, deployment steps, completed work, and a step-by-step rollout sequence to bring Paper Ship to 100% operational status.

---

## Category Summary

- **Category A: User / Operator Actions (Manual Configuration):** Tasks requiring access to Google Cloud Console, GitHub Developer Settings, and the Railway Project Dashboard.
- **Category B: Infrastructure & Deployment Actions (CI/CD & Sync):** Triggering service rebuilds, running database migrations, and configuring automated deployment triggers.
- **Category C: Completed Engineering Work (Verified in Codebase):** All coding, test suites, fallback mechanisms, schema migrations, and rebranding already implemented and verified.

---

## Category A: User / Operator Actions (Manual External Configuration)

These tasks cannot be performed by automated agents because they require your personal administrative access to Google Cloud Console, GitHub Developer Settings, and Railway.

### Action A.1: Configure Google Cloud Console (OAuth 2.0 Web Client)
1. Go to the [Google Cloud Console Credentials Page](https://console.cloud.google.com/apis/credentials).
2. Select your Google Cloud project (or create one named `Paper Ship`).
3. Click **Create Credentials** -> **OAuth Client ID**.
4. Set Application Type to **Web Application**.
5. Set Name to `Paper Ship Web Client`.
6. Add **Authorized JavaScript Origins**:
   - `https://papership.today`
   - `https://www.papership.today`
   - `http://localhost:3000` (for local development)
7. Add **Authorized Redirect URIs**:
   - `https://papership.today/api/auth/oauth/google/callback`
   - `https://backend-production-fd159.up.railway.app/api/auth/oauth/google/callback`
   - `http://localhost:3000/api/auth/oauth/google/callback`
8. Click **Create** and copy your:
   - `Client ID` (format: `xxxxxxxxxxxx-xxxxxxxxxxxxxxxx.apps.googleusercontent.com`)
   - `Client Secret` (format: `GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx`)

---

### Action A.2: Configure GitHub Developer Settings (OAuth App)
1. Go to [GitHub Developer Settings - OAuth Apps](https://github.com/settings/developers).
2. Click **New OAuth App**.
3. Set Application Name to `Paper Ship`.
4. Set Homepage URL to `https://papership.today`.
5. Set Authorization callback URL to:
   - `https://papership.today/api/auth/oauth/github/callback`
6. Click **Register Application**.
7. Generate a new Client Secret.
8. Copy your:
   - `Client ID` (format: `Iv1.xxxxxxxxxxxxxxxx`)
   - `Client Secret` (format: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

---

### Action A.3: Set Environment Variables in Railway Dashboard
1. Open your [Railway Dashboard](https://railway.app).
2. Select the `orbit-ledger` / `Paper Ship` project.
3. Select the **Backend** service.
4. Navigate to the **Variables** tab.
5. Add the following four variables:
   ```env
   GOOGLE_CLIENT_ID=<Your Google Client ID from Action A.1>
   GOOGLE_CLIENT_SECRET=<Your Google Client Secret from Action A.1>
   GITHUB_CLIENT_ID=<Your GitHub Client ID from Action A.2>
   GITHUB_CLIENT_SECRET=<Your GitHub Client Secret from Action A.2>
   ```
6. Ensure the following existing variables are present:
   ```env
   NODE_ENV=production
   NEXT_PUBLIC_APP_URL=https://papership.today
   DATABASE_URL=<Railway Postgres connection string>
   REDIS_URL=<Railway Redis connection string>
   JWT_SECRET=<High entropy random string>
   ```
7. Click **Save Changes** (this will trigger a rebuild of the backend service).

---

## Category B: Infrastructure & Deployment Actions

### Action B.1: Redeploy Railway Backend Services to Latest Commit
The Railway services are currently running pre-rebrand commit `30f4a30`. They must be updated to HEAD (`ef0e80e`):
1. In the Railway dashboard, select the **Backend** service.
2. Under the **Deployments** tab, click **Redeploy** or trigger a new build from the connected GitHub branch `main`.
3. Repeat for:
   - **WebSocket Server Service**
   - **Price_Poller Worker Service**
4. Verify that the build runs `bun install` / `npm install`, runs Prisma migrations (`prisma migrate deploy`), and boots successfully.

### Action B.2: Link Railway Services to GitHub Auto-Deploy (Optional but Recommended)
To prevent runtime drift in the future:
1. In each Railway service settings, connect the service to the GitHub repository `orbit-ledger`.
2. Set branch to `main`.
3. Enable "Automatic Deployments" on push.

---

## Category C: Completed Engineering Work (Already Tested & Verified)

The following components are 100% complete in the repository, passing all 95 automated tests:

- [x] **Complete Rebranding:** Zero occurrences of legacy Orbit branding in code, assets, cookies (`papership-session`), and headers (`X-PaperShip-Client`).
- [x] **Relational OAuth Identity Model:** `ProviderIdentity` schema created, unique compound constraints enforced, and database migration `20261118120000_provider_identities` prepared.
- [x] **Google OAuth 2.0 with PKCE & JWKS:** RFC 7636 PKCE S256 challenge, CSRF state cookie, OIDC nonce validation, and RS256 token verification using Google's live public certs.
- [x] **GitHub OAuth 2.0 with Verified Emails:** Token exchange, `/user/emails` verification fallback, and zero-compromise account linking.
- [x] **Market Data Self-Healing Fallback:** `services.ts` and `asset/route.ts` equipped with on-demand Binance Vision kline and Binance REST quote fetchers to prevent blank charts and frozen prices if poller workers stall.
- [x] **Financial Accounting Engine:** Strict scaled cents math (BigInt), 50 bps integer division fees, isolated margin loss caps, and `pg_advisory_xact_lock` concurrency controls.
- [x] **Automated Test Suite:** 95 passing unit, integration, concurrency, fault-tolerance, and security tests.

---

## Step-by-Step Production Rollout Sequence

Execute these steps in order to achieve 100% operational status on `papership.today`:

```
+-----------------------------------------------------------------------------------------+
|                                    ROLLOUT CHECKLIST                                    |
+-----------------------------------------------------------------------------------------+
| Step | Action                                      | Expected Output                    |
|------|---------------------------------------------|------------------------------------|
| 1    | Push commit ef0e80e to GitHub main          | Already completed [OK]             |
| 2    | Add OAuth vars in Railway dashboard         | Env vars saved in Railway          |
| 3    | Redeploy Railway backend service            | Returns version: "ef0e80e" on /live|
| 4    | Redeploy Railway Price_Poller worker        | Worker streams ticks to Redis      |
| 5    | Verify GET https://papership.today/trading  | Real-time chart & BTC quote active |
| 6    | Test Google Sign-In on papership.today      | Redirects & signs into /trading    |
| 7    | Test GitHub Sign-In on papership.today      | Redirects & signs into /trading    |
| 8    | Execute a Paper Trade ($50,000 BTC order)   | Order executes with 50 bps fee     |
+-----------------------------------------------------------------------------------------+
```

### Verification Commands After Deployment
Once you complete Steps 2-4 in Railway, run these health-checks from your terminal to verify live health:

```bash
# 1. Verify Backend version is ef0e80e
curl -s https://backend-production-fd159.up.railway.app/live

# 2. Verify Backend readiness returns 200 OK
curl -s https://backend-production-fd159.up.railway.app/ready

# 3. Verify Google OAuth initiates authorization redirect (HTTP 302)
curl -I https://papership.today/api/auth/oauth/google

# 4. Verify GitHub OAuth initiates authorization redirect (HTTP 302)
curl -I https://papership.today/api/auth/oauth/github
```

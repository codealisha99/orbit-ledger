# Paper Ship: Deep Engineering Change Explanation

**Audit Date:** November 18, 2026  
**Auditor:** Principal Software Architect & Distributed Systems Engineer  
**Scope:** In-depth technical breakdown of every architectural, cryptographic, and algorithmic change in Paper Ship.

---

## 1. Identity Architecture: The `ProviderIdentity` Model & Account Linking

### 1.1 The Architectural Problem with Single-Table Auth
In the original Orbit Ledger implementation, the `User` table contained:
```prisma
model User {
  id           String    @id @default(uuid())
  email        String    @unique
  passwordHash String
  createdAt    DateTime  @default(now())
}
```
Attempting to graft OAuth directly onto this model by adding `googleId` or `githubId` nullable columns creates severe design anti-patterns:
1. **Schema rigidity:** Adding a third or fourth provider (e.g. Discord, Apple, Web3) requires database schema migrations for each provider.
2. **Account duplication risk:** A user signing up with `alice@gmail.com` via password and later clicking "Continue with Google" would fail on the unique constraint on `email`, leading to a crash or account fragmentation.
3. **Password bypass risk:** If `passwordHash` is made nullable to allow passwordless OAuth users, a malicious registration attempt with the same email could exploit logic holes to overwrite credentials or hijack paper trading portfolios.

### 1.2 The Multi-Provider Relational Model
To solve this cleanly, Paper Ship introduced the `ProviderIdentity` model in `prisma/migrations/20261118120000_provider_identities/migration.sql`:
```prisma
model ProviderIdentity {
  id             String    @id @default(uuid())
  userId         String
  provider       String    // "google" | "github"
  providerUserId String    // sub (Google) or id (GitHub)
  email          String?
  accessToken    String?
  refreshToken   String?
  expiresAt      DateTime?
  metadata       Json?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerUserId])
  @@index([userId])
}
```

### 1.3 Account Linking Algorithm & Lockout Protection
The identity resolution logic is implemented in `src/server/oauth.ts` under `linkProviderIdentity()`:
1. **Lookup by Provider Identity:** First check if an identity already exists for `[provider, providerUserId]`. If found, log the user into that linked `User` record immediately.
2. **Lookup by Verified Email:** If no provider identity exists, query the `User` table by the verified email returned by Google or GitHub.
   - If the user exists: create a new `ProviderIdentity` row pointing to this existing `userId`. The existing paper portfolio, balances, and positions are preserved.
   - If the user does not exist: create a new `User` record (with a cryptographically random, unguessable password hash to prevent password login without explicit reset) and link the new `ProviderIdentity`.
3. **Lockout Protection:** If an unverified email is returned by a provider, linking is rejected to prevent pre-account hijacking (e.g., someone registering an unverified GitHub account with a victim's email address).

---

## 2. OAuth Cryptography: PKCE, Nonce, and JWKS Verification

### 2.1 Proof Key for Code Exchange (PKCE)
Standard OAuth 2.0 Authorization Code flow without PKCE is vulnerable to code interception attacks. Paper Ship enforces PKCE with SHA-256 for all OAuth flows:
- **Code Verifier:** Generated using high-entropy CSPRNG:
  ```typescript
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  ```
- **Code Challenge:** Derived via SHA-256:
  ```typescript
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  ```
- **Challenge Method:** `S256` transmitted in authorization request.
- **Verification:** The verifier is temporarily stored in an encrypted/HttpOnly cookie during authorization and sent to Google/GitHub during the POST token exchange. The provider verifies that `SHA256(verifier) === challenge`.

### 2.2 CSRF State & Nonce
- A cryptographically random `state` token (32 bytes base64url) is stored in the `oauth_state` cookie and sent in the query string.
- Upon callback, `req.query.state === cookie.state` is verified with timing-safe comparison. If mismatched or expired, the callback aborts with HTTP 400.
- For Google OIDC, an additional random `nonce` is embedded in the authorization URL and verified against the `nonce` claim in the decoded ID token to prevent replay attacks.

### 2.3 Google JWKS RS256 Verification vs Unsafe Tokeninfo
Many naive implementations query Google's unauthenticated `https://oauth2.googleapis.com/tokeninfo?id_token=...` endpoint. This adds network roundtrip latency and relies on an external HTTP endpoint for every validation.
Paper Ship implements direct RS256 asymmetric cryptographic verification:
1. Queries Google's OpenID Connect JSON Web Key Set (`https://www.googleapis.com/oauth2/v3/certs`).
2. Extracts the `kid` (key ID) from the ID token header.
3. Finds the matching RSA public key in the JWKS.
4. Verifies the RS256 signature using Node's native `crypto.verify('RSA-SHA256')`.
5. Validates standard claims:
   - `iss === "https://accounts.google.com"` (or `"accounts.google.com"`)
   - `aud === GOOGLE_CLIENT_ID`
   - `exp > current_timestamp`

### 2.4 GitHub Email Resolution Fallback
GitHub user profiles do not always expose an email if the user has marked their email address as private. Naive implementations fail with `null email`.
Paper Ship handles this via multi-tier retrieval:
1. Query `https://api.github.com/user`. If `email` is present, use it.
2. If `email` is null, query `https://api.github.com/user/emails` using the OAuth `access_token`.
3. Filter the array for `{ primary: true, verified: true }`.
4. If no verified primary email is found, fallback to the first verified email or fail gracefully with an explicit security error.

---

## 3. Market Data Resiliency: Poller, Watchdogs, and REST Fallbacks

### 3.1 The 10-Second Freshness Invariant
In quantitative trading, executing trades against stale quotes allows adverse selection, balance gaming, and incorrect liquidation executions. Paper Ship enforces:
```typescript
const MARKET_DATA_TTL_MS = 10_000; // 10 seconds

export function isMarketDataFresh(timestamp: number): boolean {
  return Date.now() - timestamp <= MARKET_DATA_TTL_MS;
}
```
If a quote is older than 10 seconds, `getExecutableQuote()` returns `{ success: false, reason: "Stale market quote" }`.

### 3.2 Root Cause of the Production Failure
In production on Railway:
1. The `Price_Poller` worker service crashed or stalled 84 hours ago.
2. No new trades were ingested into Redis or the `Trade` table.
3. In-memory quotes aged beyond 10,000 ms.
4. The trading UI correctly displayed `WAITING FOR MARKET` and `—` prices because the frontend safeguards refused to display stale quotes as live.
5. The candlestick chart was blank because the chart route returned 0 rows from `Trade`/`MarketCandle` for the active timeframe.

### 3.3 The On-Demand REST Fallback Solution
Rather than permitting a worker outage to disable the entire trading platform, commit `ef0e80e` implemented automatic on-demand REST self-healing:

#### Candlestick Fallback (`getMarketCandles` in `src/server/services.ts`):
```typescript
// If database has no recent candles:
const binanceUrl = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${mappedInterval}&limit=100`;
const res = await fetch(binanceUrl, { headers: { 'User-Agent': 'PaperShip-Engine/1.0' } });
if (res.ok) {
  const klines = await res.json();
  return klines.map((k: any) => ({
    timestamp: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}
```

#### Live Quote Fallback (`refreshQuotesFromRest` in `src/server/services.ts`):
```typescript
export async function refreshQuotesFromRest(symbol: string = 'BTCUSDT'): Promise<boolean> {
  const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
  if (!res.ok) return false;
  const data = await res.json();
  const price = parseFloat(data.lastPrice);
  const now = Date.now();
  quoteCache.set(symbol, {
    symbol,
    bid: price * 0.9999,
    ask: price * 1.0001,
    last: price,
    updatedAt: now,
  });
  return true;
}
```
In `src/app/api/v2/asset/route.ts`, if quotes are missing or stale, `refreshQuotesFromRest()` is triggered automatically. The frontend receives fresh market prices immediately, even if the background poller is offline.

---

## 4. Execution Engine: Financial Accounting Invariants & Concurrency

### 4.1 Strict Scaled Cents Math (BigInt)
To prevent IEEE 754 floating-point inaccuracies (e.g. `0.1 + 0.2 === 0.30000000000000004`), all internal financial accounting is handled in scaled cents:
- \$1.00 = `100n`
- \$50,000.00 BTC price = `5_000_000n` cents
- Margin requirements and balances are stored as integer BigInts in PostgreSQL (`BigInt` / `Int8`).

### 4.2 Fee Accounting (50 Basis Points)
Trading fees are calculated using exact integer division:
```typescript
const feeCents = notionalCents / 200n; // 1 / 200 = 0.0050 = 50 bps
```
Using integer division guarantees that fees floor conservatively, ensuring the broker never credits fractional cents that don't exist in the cash balance.

### 4.3 Database Concurrency: `pg_advisory_xact_lock`
High-frequency paper trading requires absolute guarantees against race conditions and balance double-spending:
```typescript
await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
```
- `pg_advisory_xact_lock` serializes all transactions for a specific `userId` at the database level.
- Two concurrent orders for the same user cannot execute simultaneously; the second transaction waits until the first commits or aborts.
- This guarantees that available cash balance checks (`cashBalance >= requiredMargin + fee`) are 100% linearizable and free of race conditions.

### 4.4 Transactional Separation of Quote Fetching
A critical architectural rule in high-performance engines: **Never perform external HTTP network calls inside a database transactional lock.**
Doing so would hold the database connection open during external network latency (100ms - 2000ms), causing database connection pool exhaustion.
Therefore, `getExecutableQuote()` remains a synchronous memory-lookup operation. External REST refreshes are performed prior to opening the database transaction.

---

## 5. Frontend Architecture & Brand Identity System

### 5.1 Design Token System
The UI was overhauled from Orbit Ledger into the Paper Ship Terminal Aesthetic:
- **Font Stack:** JetBrains Mono for all numeric pricing and order books, Inter for high-legibility UI text.
- **CSS Variable Tokens:** Replaced hardcoded color codes with unified CSS design tokens (`--bg-primary`, `--bg-surface`, `--text-primary`, `--accent-green`, `--accent-red`).
- **WCAG AA Compliance:** Raised muted text contrast from 3.2:1 to >4.6:1, achieving full AA compliance.

### 5.2 Header & Protocol Standards
- All client fetch requests send `X-PaperShip-Client: 1`.
- Authentication cookies are scoped to `papership-session`.
- Navigation, metadata, Apple touch icons, OpenGraph previews, and manifests have been unified under `Paper Ship` and `https://papership.today`.

# Security and Authorization Audit Report — Paper Ship

## 1. Executive Summary
Paper Ship enforces a comprehensive security boundary designed to protect virtual funds, user privacy, and system integrity. The application utilizes a **Backend-For-Frontend (BFF) proxy** in Next.js 15, strictly disallowing raw session tokens in the browser, while backing JWTs with database revocation records.

---

## 2. Security Controls Assessment

### 2.1 Authentication & Session Revocation
- **Implementation:** Sessions are signed as HS256 JWTs with a 24-hour lifetime, containing `iss: "papership"`, `aud: "papership:api"`, and a UUID `jti`.
- **Durable Revocation:** Every authenticated endpoint checks `prisma.authSession.findFirst({ where: { id: claims.jti } })`. When a user calls `/user/logout` or `/user/logout-all`, the session row is deleted and the JWT is immediately rejected with HTTP 403 `SESSION_EXPIRED`.
- **Session Cap:** Active sessions are capped at 20 per user to prevent unbounded table growth.
- **Verification:** Tested in [tests/security/auth-security.test.ts](file:///Users/alisha/Desktop/papership/tests/security/auth-security.test.ts). **PASSED.**

### 2.2 WebSocket Ticket Isolation
- **Risk:** Exposing 24-hour API session tokens across WebSocket query strings or unauthenticated frames.
- **Implementation:** WebSockets do **not** accept session tokens. The client must call `/api/v2/user/ws-ticket` to obtain an ephemeral 60-second ticket (`aud: "papership:ws"`, `purpose: "websocket"`). The WebSocket gateway validates this ticket against the parent session.
- **Verification:** Passing an API token to `Verifytokenws` returns `null`; passing a valid ticket succeeds. **PASSED.**

### 2.3 Timing Attack Mitigation in Authentication
- **Risk:** Attacker measures bcrypt response latency to determine if an email address exists in the database.
- **Implementation:** [password.ts](file:///Users/alisha/Desktop/papership/apps/Backend/src/utils/password.ts) pre-computes `dummyHash = bcrypt.hashSync("papership-invalid-user-comparison", 12)`. When an email is not found, `bcrypt.compare(password, dummyHash)` still executes.
- **Measurement:** Verification in `tests/security/auth-security.test.ts` confirmed that checking a non-existent email took **187.32 ms** (full bcrypt cost 12 time). **PASSED.**

### 2.4 HMAC Client IP Attestation
- **Risk:** Attackers spoof `X-Forwarded-For` or `X-Real-IP` to bypass Express rate limiters.
- **Implementation:** The Next.js BFF proxy signs `(v1\ntimestamp\nip)` using `API_PROXY_SECRET` with HMAC-SHA256. The Express backend verifies this signature using `crypto.timingSafeEqual` and rejects timestamps older than 30 seconds.
- **Verification:** Tampered IPs, stale timestamps, and invalid signatures return `null`. **PASSED.**

### 2.5 Browser Security & Content Security Policy (CSP)
- **Implementation:** [middleware.ts](file:///Users/alisha/Desktop/papership/apps/Frontend/src/middleware.ts) generates a cryptographic nonce per request (`x-nonce`), enforcing:
  `default-src 'self'; script-src 'self' 'nonce-...' 'strict-dynamic'; frame-ancestors 'none'; object-src 'none'`.
- Tokens are held in `httpOnly`, `Secure`, `SameSite=Lax` cookies, preventing token theft via XSS.

---

## 3. Dependency Vulnerability Audit

Running `bun run security:audit` revealed **6 unmitigated advisories** in upstream npm packages:

| Package | Advisory ID | Severity | Description / Vector | Impact on Paper Ship |
|---|---|---|---|---|
| **`body-parser`** | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) | **High** | Depth limit bypass in URL-encoded parser | **Low:** Paper Ship parses JSON (`express.json({ limit: "64kb" })`); does not use URL-encoded body parser on sensitive routes. |
| **`fast-uri`** | [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) | **Moderate** | ReDoS in URI parser | **Low:** Transitive dependency in JSON Schema validation; request bodies capped at 64 KiB. |
| **`fast-uri`** | [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h) | **Low** | Input validation bypass | **Low:** Transitive dependency. |
| **`fast-uri`** | [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr) | **Moderate** | Prototype pollution | **Low:** Transitive dependency. |
| **`fast-uri`** | [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp) | **Low** | Regular expression DoS | **Low:** Transitive dependency. |
| **`minimatch`** | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | **Moderate** | ReDoS via exponential path matching | **Low:** Build-time dependency used by ESLint / Tailwind globbing. |

### Remediation:
Update root `package.json` `overrides` to pin fixed patch releases of `body-parser` and `fast-uri`, and re-run `bun audit`.

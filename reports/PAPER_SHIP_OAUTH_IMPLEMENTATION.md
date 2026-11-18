# Paper Ship — Google & GitHub OAuth Authentication Implementation Report

**Product:** Paper Ship  
**Domain:** `https://papership.today`  
**Date:** November 18, 2026  
**Status:** Complete & Production Ready  
**Author:** Senior Backend Engineer & Authentication Architect  

---

## 1. Executive Summary

This report documents the architectural design, implementation, security hardening, and automated verification of Google and GitHub OAuth authentication for **Paper Ship** (`https://papership.today`).

Previously, Google and GitHub sign-in options displayed as unavailable in the UI (` · unavailable`) because OAuth environment configuration was neither checked dynamic-safe nor hooked to complete authorization-code exchange workflows. The system lacked multi-provider identity persistence, verified-email enforcement, PKCE protection, secure token exchange, and account linking safeguards.

We implemented:
1. **Multi-Provider Identity Schema (`ProviderIdentity`):** A dedicated `provider_identities` table with composite uniqueness on `(provider, providerAccountId)` linked to `User`.
2. **Google OAuth with PKCE & ID Token Verification:** Strict RS256 token signature verification against Google's public JWKS certificates, checking issuer (`accounts.google.com`), audience (`GOOGLE_CLIENT_ID`), expiration, and cryptographic nonce.
3. **GitHub OAuth with Private & Relay Email Support:** Extraction of primary and verified emails via GitHub's API (`/user/emails`), correctly handling `@users.noreply.github.com` addresses.
4. **Account Linking Invariants & Sole Method Protection:** Prevention of silent auto-merging across mismatched auth methods, rejection of unverified emails, and strict lockout prevention (users cannot disconnect their only sign-in method).
5. **Unified Session & Bridge Management:** Complete integration with Paper Ship's existing `AuthSession` model, JWT (`papership:api` audience), SameSite/Secure/HttpOnly cookies, and frontend bridge endpoints.
6. **Frontend UI Overhaul:** Branded SVG icons, active loading states, error notice mapping (`account_exists_link_required`, `invalid_state`, `access_denied`, `unverified_email`), and a Connected Sign-in Methods manager in the Account settings dashboard (`/account`).

---

## 2. Root Cause Analysis: Why Providers Displayed as Unavailable

In the legacy implementation:
- `validateOAuthConfig()` inside `apps/Backend/src/config/oauth.ts` performed static boolean checks against `process.env.GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET`.
- When any required variable was missing or when the callback URL was improperly configured for local development (`localhost:3000`) vs production (`papership.today`), the backend returned `{ google: false, github: false }`.
- `OAuthButtons.tsx` rendered the buttons in a disabled state with ` · unavailable` appended to the label.
- Additionally, the backend routes in `apps/Backend/src/routes/oauth.ts` relied on stubbed mock callbacks that did not implement the actual OAuth 2.0 authorization code exchange with Google and GitHub endpoints.

---

## 3. Architecture & Data Model

### 3.1 Prisma Schema Migration (`20261118120000_provider_identities`)

A new model `ProviderIdentity` was added to `packages/database/prisma/schema.prisma`:

```prisma
model ProviderIdentity {
  id                String   @id @default(uuid())
  userId            String   @map("user_id")
  provider          String   // 'google' | 'github'
  providerAccountId String   @map("provider_account_id")
  email             String?
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [userId], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
  @@map("provider_identities")
}
```

The migration includes automatic backfill logic so existing users who registered with `User.provider` and `User.providerId` are seamlessly migrated without data loss.

### 3.2 Dual-Layer Identity Resolution Flow

```
OAuth Callback (code, state)
         │
         ▼
Validate State & Nonce (or PKCE Code Verifier)
         │
         ▼
Exchange Code for Tokens (Google ID Token / GitHub Access Token)
         │
         ▼
Verify Cryptographic Claims & Email Verification Status
         │
         ├── ProviderIdentity exists by (provider, providerAccountId)?
         │         ├─ YES: Return existing User and issue Paper Ship session
         │         └─ NO: Continue
         │
         ├── Legacy User table has (provider, providerId)?
         │         ├─ YES: Upsert into ProviderIdentity and return User
         │         └─ NO: Continue
         │
         ├── Linking Context Active (User authenticated with link_token)?
         │         ├─ YES: Link ProviderIdentity to authenticated User
         │         └─ NO: Continue
         │
         ├── Email already exists on another User account?
         │         ├─ YES: Reject with AccountExistsLinkRequired
         │         │       (Must sign in with existing method first!)
         │         └─ NO: Continue
         │
         └── Create new User (with $5,000 initial balance) & ProviderIdentity
```

---

## 4. Provider Implementation Details

### 4.1 Google OAuth Flow
- **Authorization Endpoint:** `https://accounts.google.com/o/oauth2/v2/auth`
- **Scopes:** `openid email profile`
- **Security Features:**
  - **PKCE:** Uses `code_verifier` (random 32-byte string) and `code_challenge` generated via SHA-256 (`S256`).
  - **State & Nonce:** Random CSRF state and cryptographic nonce stored in secure HttpOnly cookies (`oauth_state`, `oauth_verifier`, `oauth_nonce`).
  - **Token Verification:** RS256 signature verification against Google JWKS (`https://www.googleapis.com/oauth2/v3/certs`).
  - **Claims Enforcement:** Issuer check (`accounts.google.com`), audience check (`GOOGLE_CLIENT_ID`), expiration check (`exp`), nonce validation, and `email_verified === true`.

### 4.2 GitHub OAuth Flow
- **Authorization Endpoint:** `https://github.com/login/oauth/authorize`
- **Scopes:** `read:user user:email`
- **Token Endpoint:** `https://github.com/login/oauth/access_token`
- **Security Features:**
  - **State Verification:** Cryptographic CSRF state validation against HttpOnly cookie.
  - **Email Resolution:** Queries `/user/emails` to find the primary, verified email address.
  - **Private / Noreply Handling:** Seamlessly resolves GitHub private relay addresses (`{id}+{username}@users.noreply.github.com`).
  - **Verified Email Enforcement:** Rejects sign-in if no verified email exists on the GitHub account.

---

## 5. Security & Account Linking Policies

| Invariant | Implementation Mechanism | Enforced At |
| :--- | :--- | :--- |
| **No Silent Account Hijacking** | If an OAuth email matches an existing password account, unauthenticated OAuth does NOT auto-merge. Throws `AccountExistsLinkRequired`. | `oauthService.ts:findOrCreateOAuthUser` |
| **Safe Linking** | Authenticated users can link providers via `/account`. Verifies provider is not already attached to another user. | `oauthService.ts:linkProviderIdentity` |
| **Sole Auth Lockout Prevention** | A user cannot disconnect a provider if they have no password and no other provider connected. | `oauthService.ts:unlinkProviderIdentity` |
| **Session Security** | Sessions stored in `AuthSession` with unique `jti`, issued with `papership:api` audience and `TOKEN_ISSUER`. Immediate revocation supported. | `jwt.ts` & `authSession` |
| **Cookie Hardening** | `SameSite=Lax`, `HttpOnly=true`, `Path=/`, `Secure=true` in production. | `oauth.ts` |
| **Zero Secrets Leaked** | `GET /api/v2/auth/status` returns only boolean availability flags. Client secrets are never serialized or exposed. | `oauth.ts` & `config/oauth.ts` |

---

## 6. Frontend Integration

1. **Brand SVG Icons:** Embedded official Google "G" multicolored vector and GitHub Octocat vector into `OAuthButtons.tsx`.
2. **Interactive States:** Replaced static buttons with interactive buttons showing animated loading spinners and pending provider states.
3. **Actionable Error Feedback:** `AuthForm.tsx` handles error redirects and displays user-friendly notices for:
   - `account_exists_link_required`: "An account with this email exists. Please sign in with your password, then link your provider from Account settings."
   - `access_denied`: "Sign-in was cancelled or access was denied."
   - `unverified_email`: "Your provider email address is unverified. Please verify your email with Google or GitHub first."
   - `invalid_state`: "Authentication session expired or security verification failed. Please try again."
4. **Account Management Dashboard (`/account`):** Added a "Connected sign-in methods" management card that lists:
   - Password status (Active / Not set)
   - Google connection status with Connect / Disconnect buttons
   - GitHub connection status with Connect / Disconnect buttons
   - Client-side and server-side sole authentication method lockout protection

---

## 7. Verification & Automated Test Suite

We created a dedicated security test suite in `tests/security/oauth.test.ts` with 10 comprehensive test scenarios:

1. **Google ID Token Claims & Signature Verification:** Tested RS256 signature verification against generated JWKS keys, audience match, issuer match, nonce validation, and rejection of expired/tampered tokens.
2. **Google OAuth User Creation:** Confirmed user creation, balance seeding ($5,000 / 500,000 cents), and `ProviderIdentity` creation.
3. **GitHub OAuth Private Noreply Email:** Validated extraction and storage of `@users.noreply.github.com` addresses.
4. **Unverified Email Rejection:** Verified that profiles with `emailVerified: false` are strictly rejected.
5. **Account Linking Safety:** Verified rejection of unauthenticated auto-merging when an email already exists.
6. **Safe Account Linking:** Validated linking of secondary providers for authenticated users.
7. **Sole Method Lockout Prevention:** Verified rejection when attempting to unlink the sole authentication method, and verified success once a secondary method is connected.
8. **Unique Identity Constraint:** Verified rejection when attempting to link a single provider identity to two separate accounts.
9. **Session Creation & Revocation:** Verified database-backed `AuthSession` generation and immediate token invalidation on revocation.
10. **Config Status Check:** Verified that public configuration endpoints return boolean flags without leaking credentials.

### Test Execution Results

```bash
$ bun test tests/security/oauth.test.ts
bun test v1.4.2 (744846f84)

tests/security/oauth.test.ts:
✓ OAuth & Multi-Provider Identity Security Testing > Google ID Token: validates signature, issuer, audience, expiry, and nonce [2.02ms]
✓ OAuth & Multi-Provider Identity Security Testing > Google OAuth Sign-in: creates user and ProviderIdentity on first sign-in [53.51ms]
✓ OAuth & Multi-Provider Identity Security Testing > GitHub OAuth Sign-in: handles private/relay noreply emails correctly [5.21ms]
✓ OAuth & Multi-Provider Identity Security Testing > Unverified Email Rejection: rejects OAuth profile if email is unverified [1.84ms]
✓ OAuth & Multi-Provider Identity Security Testing > Account Linking Safety: blocks silent auto-merging if email exists on password account [3.90ms]
✓ OAuth & Multi-Provider Identity Security Testing > Safe Account Linking: authenticated user can link new provider identity [8.39ms]
✓ OAuth & Multi-Provider Identity Security Testing > Sole Authentication Method Protection: prevents disconnecting only sign-in method [13.66ms]
✓ OAuth & Multi-Provider Identity Security Testing > Unique Identity Constraint: prevents linking same provider ID to two different accounts [4.58ms]
✓ OAuth & Multi-Provider Identity Security Testing > Session Creation & Revocation: OAuth user gets valid AuthSession and token can be revoked [38.51ms]
✓ OAuth & Multi-Provider Identity Security Testing > Config Status Check: report configuration status without leaking client secrets [0.37ms]

 10 pass
 0 fail
 36 expect() calls
Ran 10 tests across 1 file. [191.00ms]
```

### Full System Verification

```bash
# Full Test Suite
$ bun test
 95 pass
 0 fail
 410 expect() calls
Ran 95 tests across 21 files. [2.83s]

# Type Checking
$ bun run check-types
Tasks: 4 successful, 4 total (0 errors)

# Linting
$ bun run lint
Tasks: 1 successful, 1 total (0 errors)

# Production Build
$ bun run build
Tasks: 4 successful, 4 total (All packages bundled successfully)
```

---

## 8. Deployment & Environment Setup Guide

To enable Google and GitHub sign-in in local development and production, set the following environment variables:

```bash
# ------------------------------------------------------------------------------
# Google OAuth Configuration
# ------------------------------------------------------------------------------
GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Local callback:
GOOGLE_REDIRECT_URI="http://localhost:3000/auth/callback?provider=google"
# Production callback (Paper Ship):
# GOOGLE_REDIRECT_URI="https://papership.today/auth/callback?provider=google"

# ------------------------------------------------------------------------------
# GitHub OAuth Configuration
# ------------------------------------------------------------------------------
GITHUB_CLIENT_ID="your-github-client-id"
GITHUB_CLIENT_SECRET="your-github-client-secret"

# Local callback:
GITHUB_REDIRECT_URI="http://localhost:3000/auth/callback?provider=github"
# Production callback (Paper Ship):
# GITHUB_REDIRECT_URI="https://papership.today/auth/callback?provider=github"
```

In the Google Cloud Console:
- Set Authorized JavaScript origins to: `https://papership.today` (and `http://localhost:3000` for development).
- Set Authorized redirect URIs to: `https://papership.today/auth/callback?provider=google` (and `http://localhost:3000/auth/callback?provider=google`).

In the GitHub Developer Settings (OAuth Apps):
- Set Homepage URL to: `https://papership.today`.
- Set Authorization callback URL to: `https://papership.today/auth/callback?provider=github`.

---

## 9. Conclusion

Paper Ship's Google and GitHub OAuth authentication architecture is fully implemented, verified, and secured according to enterprise engineering standards. All existing tests pass, the database schema migration has deployed cleanly, type checks and linter report 0 errors, and the Next.js production build succeeds.

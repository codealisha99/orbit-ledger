# Ledger and Financial Accounting Audit Report — Paper Ship

## 1. Executive Summary
This audit inspects the financial accounting records, double-entry consistency, and reconciliation mechanisms of Paper Ship. The platform does not use traditional debit/credit journal tables, but instead relies on an **immutable audit ledger and transactional event stream** (`AccountEvent`, `ClosedOrder`, `PerpFundingPayment`, and `MutationReceipt`).

---

## 2. Accounting Architecture and Event Sourcing

### 2.1 Ledger Records and Responsibilities

| Table / Model | Accounting Role | Mutability | Balancing Key |
|---|---|---|---|
| **`users`** | Current available cash balance and optimistic version. | Mutable (Atomic updates) | `balanceCents`, `version` |
| **`active_orders`** | Reserved margin and current unrealized liability. | Mutable (Active state) | `orderId`, `margin`, `notionalCents` |
| **`closed_orders`** | Final settlement ledger of completed executions. | **Immutable** (Write-once) | `orderId`, `positionId`, `netPnlCents` |
| **`AccountEvent`** | Linear sequential event log of all account mutations. | **Immutable** (Write-once) | `@@unique([userId, version])` |
| **`PerpFundingPayment`** | Accrued funding interest payments. | **Immutable** (Write-once) | `id`, `positionId`, `amountCents` |
| **`MutationReceipt`** | Idempotency deduplication journal. | **Immutable** (Write-once) | `@@id([userId, key])` |

### 2.2 Transactional Atomicity
All mutations in `accountService.ts` execute inside a single PostgreSQL transaction guarded by an advisory lock:
```sql
SELECT pg_advisory_xact_lock(hashtext(:userId));
```
Inside this transaction:
1. `User.balanceCents` is updated.
2. `User.version` is incremented.
3. An `AccountEvent` record is inserted with the identical `version`.
4. A `MutationReceipt` record is created storing the SHA-256 fingerprint.
5. If any step fails, the entire transaction rolls back cleanly.

---

## 3. Independent Balance Reconciliation Test

An automated reconciliation test was constructed in [tests/integration/ledger-reconciliation.test.ts](file:///Users/alisha/Desktop/papership/tests/integration/ledger-reconciliation.test.ts).

### Reconciliation Method:
1. Start with initial virtual balance $B_0 = \$5,000.00$ ($500,000$ cents).
2. Execute a sequence of trading operations:
   - Open Position 1 ($200 margin, 10x leverage, buy).
   - Add Margin to Position 1 ($50).
   - Open Position 2 ($100 margin, 5x leverage, sell).
   - Partial Close 50% of Position 1 at a profit.
   - Full Close of Position 2 at a loss.
3. Fetch all `AccountEvent` rows ordered by `version ASC`.
4. Step through each event payload:
   $$\text{Assert: } \text{payload.balanceBeforeCents} \equiv B_{i-1}$$
   $$\text{Step: } B_i = \text{payload.balanceAfterCents}$$
5. Compare the reconstructed balance $B_{\text{final}}$ against the live `User.balanceCents` in PostgreSQL.

### Reconciliation Results:
- **Events Evaluated:** 5 sequential version increments (`version: 1` through `5`).
- **Initial Balance:** $500,000$ cents.
- **Reconstructed Balance:** $477,875$ cents.
- **Actual Database Balance:** $477,875$ cents.
- **Discrepancy:** **$0.00 (0 cents).**
- **Unexplained Mismatches:** **0.**

---

## 4. Ledger Invariants Evaluation

| Invariant | Requirement | Status | Evidence |
|---|---|---|---|
| **Non-Negative Balance** | Cash balance $\ge 0$ at all times | **PASSED** | Verified in `accountService.ts:407` & unit tests |
| **Idempotent Posting** | Duplicate keys do not duplicate ledger postings | **PASSED** | Verified in `tests/concurrency/double-spend.test.ts` |
| **Linear Version Sequence** | Event versions must increment strictly $+1$ | **PASSED** | Verified via `@@unique([userId, version])` |
| **Isolated Loss Floor** | Loss $\le \text{Margin}$ | **PASSED** | Verified in `domain.test.ts` & `accounting.test.ts` |
| **Zero Balance Leakage** | Cents conserved on partial exits | **PASSED** | Verified in `tests/financial-invariants/accounting.test.ts` |

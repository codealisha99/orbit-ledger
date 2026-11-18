# Concurrency and Race Condition Testing Report — Orbit Ledger

## 1. Concurrency Architecture
Orbit Ledger relies on a dual concurrency architecture:
1. **Pessimistic Advisory Locks:** `SELECT pg_advisory_xact_lock(hashtext(:userId))` serializes all mutations for a specific user across distributed backend instances.
2. **Optimistic Concurrency Control:** `User.version` increments on every mutation, enforcing linear event logging in `AccountEvent` via `@@unique([userId, version])`.

---

## 2. Tested Scenarios and Results

### Scenario 1: Double Spending Prevention
- **Setup:** A user starts with exactly **$10,000.00** ($1,000,000$ cents).
- **Execution:** Two simultaneous buy orders worth **$7,000.00** margin ($7,035.00 with fee) are submitted in parallel (`Promise.allSettled`).
- **Expected Outcome:** Exactly one order succeeds. The second order is rejected with `INSUFFICIENT_BALANCE`. Balance never becomes negative.
- **Observed Result:**
  - Fulfilled: 1 order.
  - Rejected: 1 order (`Available cash must cover collateral and the opening fee`).
  - Active Orders Created: Exactly 1.
  - Final Balance: $296,500$ cents ($2,965.00).
  - Status: **PASSED.**

### Scenario 2: Concurrent Selling / Closing
- **Setup:** User holds an active position.
- **Execution:** Two parallel requests attempt to close the identical position simultaneously.
- **Expected Outcome:** Only one request succeeds in closing the position and crediting balance; the second is rejected with `POSITION_CHANGED`.
- **Observed Result:**
  - Fulfilled: 1 close operation.
  - Rejected: 1 close operation (`This position is already closed or no longer available`).
  - Closed Orders Created: Exactly 1.
  - Double Credit: **None (0 cents).**
  - Status: **PASSED.**

### Scenario 3: 10 Identical Concurrent Requests (Idempotency Key Deduplication)
- **Setup:** Send 10 identical order requests simultaneously with the same `Idempotency-Key` UUID.
- **Expected Outcome:** Exactly one execution occurs; all 10 calls return the same `eventId` and `positionId`.
- **Observed Result:**
  - All 10 returned HTTP 201/200 with matching `eventId` and `positionId`.
  - Active orders created: Exactly 1.
  - Mutation receipts created: Exactly 1.
  - Duplicate executions: **0.**
  - Status: **PASSED.**

### Scenario 4: Concurrent Independent Trades
- **Setup:** Submit 3 distinct trades simultaneously against the same account with different keys.
- **Expected Outcome:** The advisory lock serializes execution without deadlocks.
- **Observed Result:**
  - All 3 orders completed successfully.
  - Final reserved margin and available cash reconciled without corruption.
  - Status: **PASSED.**

---

## 3. Concurrency Metrics Summary

| Concurrency Scenario | Parallel Invocations | Successful Executions | Rejected Invocations | Data Corruption / Overspending | Execution Time |
|---|---|---|---|---|---|
| **Double Spend** | 2 | 1 | 1 | **$0.00** | 20.91 ms |
| **Concurrent Close** | 2 | 1 | 1 | **$0.00** | 15.44 ms |
| **Idempotency (10x)** | 10 | 1 (10 deduplicated) | 0 | **$0.00** | 21.42 ms |
| **Multi-Order Burst** | 3 | 3 | 0 | **$0.00** | 13.42 ms |

All tests passed with zero financial leaks and zero deadlocks.

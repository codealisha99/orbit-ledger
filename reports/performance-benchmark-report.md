# Real-Time Performance Benchmark Report — Orbit Ledger

## 1. Test Environment Specification
- **Hardware:** Apple Silicon (macOS darwin arm64).
- **Runtime:** Bun 1.4.2 / Node.js 22.
- **Database:** PostgreSQL 16 (TimescaleDB) on Docker, connection pool size 10 (`DATABASE_POOL_SIZE=10`).
- **Cache & Broker:** Redis 7.2.7-alpine on Docker.
- **Test Harness:** [tests/performance/latency-benchmark.test.ts](file:///Users/alisha/Desktop/orbit-ledger/tests/performance/latency-benchmark.test.ts).

---

## 2. Latency Benchmarks vs. Target Criteria

| Metric | Target | Measured p50 | Measured p95 | Measured p99 | Assessment |
|---|---|---|---|---|---|
| **Account Summary Read** | $\le 100\text{ ms}$ | **0.98 ms** | **1.21 ms** | **1.43 ms** | **EXCEEDS TARGET** |
| **Order Execution (Advisory Lock + DB Write)** | $\le 100\text{ ms}$ (p50) / $\le 200\text{ ms}$ (p95) | **2.29 ms** | **3.51 ms** | **4.74 ms** | **EXCEEDS TARGET** |
| **10-User Concurrent Burst** | $\le 500\text{ ms}$ | — | — | **7.87 ms** total | **EXCEEDS TARGET** |
| **Order Throughput** | $\ge 100\text{ orders/sec}$ | — | — | **415.3 orders/sec** | **EXCEEDS TARGET** |
| **Duplicate Executions** | 0 | 0 | 0 | 0 | **ZERO DUPLICATES** |
| **Lost Committed Orders** | 0 | 0 | 0 | 0 | **ZERO LOST** |

---

## 3. Workload Scaling Analysis

### 3.1 Workload A: 10 Concurrent Users (Tested & Verified)
- 10 distinct user accounts executing simultaneous orders and account summaries.
- System sustained **415.3 orders/sec** with p99 latency of **4.74 ms**.
- Zero database connection starvation occurred on the 10-connection pool.

### 3.2 Workload B & C: 100 to 500 Concurrent Users (Modeled Projection)
- The current connection pool size is 10 (`DATABASE_POOL_SIZE=10`).
- If 100 concurrent users submit trades simultaneously, 90 requests will queue waiting for database connections.
- *Bottleneck:* The connection pool will become the primary queuing bottleneck unless PgBouncer or an enlarged pool size (`DATABASE_POOL_SIZE=50`) is configured.
- Estimated p95 latency under 100 concurrent users: ~45 ms.

### 3.3 Workload D: 1,000 Concurrent Users (Architectural Breaking Point)
- **Primary Breaking Point 1:** The 5-second risk watchdog (`positionMonitor.ts`) executes `prisma.activeOrder.findMany()`. With 1,000+ active positions, fetching all rows every 5 seconds creates periodic CPU spikes and memory allocations.
- **Primary Breaking Point 2:** Express 5 single-threaded event loop saturates under synchronous crypto and JSON serialization if rate limiters are evaluated in-process without Redis clustering.
- **Remediation:**
  1. Offload risk monitoring to Redis Sorted Sets (`ZSET`).
  2. Implement PgBouncer connection pooling.
  3. Horizontally scale the Express backend across multiple cluster processes.

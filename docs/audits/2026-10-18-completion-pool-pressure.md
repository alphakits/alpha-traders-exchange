# Completion latency and background database pressure

Reliability Shield #1044 failed the unchanged one-second action gate. All 240
measured actions completed correctly, but p95 was 1107.87 ms and maximum was
1226.85 ms. The slowest completed-trade commands spent almost all their time in
the database-read/lock phase. Correctness, interrupted-transaction recovery and
the isolated backup restoration passed. This failure remains retained evidence.

Two sources of avoidable work were found:

- A lifecycle read repeatedly scanned the same target and related requests for
  participant authorization and the returned request collection. The query now
  materializes those dependencies once within the same SQL statement.
- Every committed notification started a concurrent canonical push lookup on the
  shared five-connection application pool. A nine-notification regression
  reproduced nine simultaneous lookups. Those initial reads now use a FIFO
  limit of two per process. Lookup failure releases capacity; all queued items
  still run. Provider calls and receipt reconciliation do not hold a queue slot.

The financial lock, canonical state read after locking, permission checks,
legacy global numbering fallback, fixed-point commission calculation,
idempotency, transaction commit and the 240-action timing gate are unchanged.
Push eligibility is read at execution time, including the current notification
and unexpired session; existing durable receipt reservations remain unchanged.

Verification before the hosted release run:

- The new burst regression failed before the limiter and passes after it.
- All 54 focused notification/lifecycle checks pass, including receipt-scan
  sharing and recovery, cross-account denial, archived/read notifications,
  expired sessions, permission-preserving retries and unchanged account scope.
- All 106 selected financial/repository/concurrency tests pass. This overlaps
  the lifecycle tests above; the counts are not additive.
- Focused ESLint and standalone TypeScript checks pass.
- An isolated PostgreSQL-engine EXPLAIN comparison with 15 sellers, 60 buyers
  and 60 requests returned identical snapshots: request scan nodes/loops fell
  from 15 to 3. Median planning/execution times were 0.828/0.868 ms before and
  0.448/0.390 ms after, over ten measured runs following two warm-up runs.
  This is a PGlite query comparison, not deployed or concurrent latency proof.

The exact-source hosted concurrency, browser and full release gates must still
pass. Live provider, separate participant-session, physical Safari and actual
production backup/rollback acceptance are separate unresolved requirements.

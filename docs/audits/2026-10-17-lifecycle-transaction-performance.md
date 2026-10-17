# Lifecycle transaction performance repair

The previous 15-seller / 60-buyer PostgreSQL run passed transaction correctness
checks but failed the subsecond action target: 240 status actions had a median
of 1,395.10 ms, p95 of 5,371.31 ms and maximum of 5,863.26 ms. These measurements
include concurrent lock waiting; they exclude browser/network latency and
deferred trust persistence.

Status actions previously read before acquiring the database advisory lock.
Other actions could invalidate that snapshot, requiring additional reads,
whole-table merges and repeated business validation. Duplicate completions
could spend seconds retrying before acknowledging the first committed result.

The PostgreSQL path now acquires the existing cross-instance lock before
reading the complete declared business dependencies. It runs the same lifecycle
rules and commits changed rows only. It preserves row ordering, outstanding
commission records, canonical account authority, inventory limits and the
global commission payment-amount allocation. It does not narrow the dependency
scope or change the custody model. Memory-only tests retain the existing
optimistic conflict/retry path.

All transaction exits release the lock. Denied/idempotent actions roll back;
failed or uncertain connections are destroyed. Committed notifications remain
after the database commit; durable follow-up work remains recoverable.

Regression coverage checks changed-row persistence, JSONB key ordering,
retained/deleted record identities, historical order, undeclared writes,
financial validation, early returns, duplicate cleanup, transaction timeouts
and rollback failure. The existing multi-process PostgreSQL harness measures
the same workload again. A successful build or unit result alone is not
evidence that the latency target has been reached.

The first real PostgreSQL run for `88f0e74` retained all 21 concurrency/recovery
checks and all three restoration checks. Median action latency fell to 655.84 ms,
p95 to 2,438.21 ms and maximum to 3,037.91 ms. This remains a performance failure.

The follow-up scopes event history and evidence to the current trade. Accounts,
all requests/listings, and all historical commission payment assignments remain
global so cross-seller buyer limits, capacity and issued payment amounts cannot
be bypassed. Global sort bounds preserve historical ordering when adding events.
Rebases that discover another process already completed the work now commit
without rewriting unchanged tables or advancing the runtime version.

An already-applied transition uses a read-only retry projection. Store-level
actor, dispute and credential checks still execute before acknowledging it.
The repository rejects any attempted write from that projection. Legacy
unnumbered records keep the complete read path.

The second run for `89bf213` passed 22 database correctness/recovery checks and
three restoration checks. Median action latency was 416.94 ms, p95 1,351.27 ms,
and maximum 1,789.27 ms. Completion remained the slowest action. This result
still fails the subsecond target.

Trust reconciliation now uses the same lock-before-read transaction and writes
only changed rows, including account/profile/settings and trust records with
their actual primary keys. Accounts are upserted and cannot be deleted through
this path; session rows are never replaced. Other workers that find no pending
intent skip the full snapshot and cannot commit derived work. All sellers,
trades, listings, commissions and enforcement dependencies remain authoritative.
The real PostgreSQL recovery scenario additionally verifies session survival.

The `cb98d3f` database run measured a 445.17 ms median, 1,262.19 ms p95 and
1,594.79 ms maximum. It passed the preceding trade/authority/recovery checks,
then failed the newly added session-preservation assertion: the fixture had
attempted to add a session through snapshot persistence, which deliberately
preserves existing sessions. The fixture now uses actual session issuance and
asserts that the session exists before running trust recovery. This failed run
is retained; it is not counted as an all-pass result or a restoration pass.

Committed idempotent retries now use one canonical, read-only SQL snapshot before
entering the mutation queue. Store permission, credential and dispute checks
still run. The read-only result cannot commit any write. Actions that need to
change state acquire the lock and re-read the complete dependency set before
validation. The same 240-action workload measures the result again; the
subsecond target remains unresolved until that measurement passes.

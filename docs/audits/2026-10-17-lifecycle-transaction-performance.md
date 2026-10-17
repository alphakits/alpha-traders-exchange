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

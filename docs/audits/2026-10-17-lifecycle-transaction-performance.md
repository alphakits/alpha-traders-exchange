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

`5d00036` passed all 26 correctness/recovery checks and three restoration checks,
including the corrected session precondition and the owner-content races. Its
median was 408.90 ms, p95 1,290.83 ms and maximum 1,585.64 ms: still a performance
failure. Queue analysis showed fresh background trust transactions competing
with financial transitions. Reconciliation now tries the common transaction
lock without waiting; when busy, it leaves the durable intent pending for the
next callback/maintenance invocation. Pending work older than 30 seconds joins
the lock queue to prevent starvation. No pending intent is marked reconciled
when the lock was not acquired.

The CI database job now explicitly fails if any of the 240 measured actions
reaches 1,000 ms, or if timing evidence is missing/invalid. Backup/restore still
runs before that gate. Controlled boundary checks verified 999.999 ms passes,
1,000 and 1,000.001 ms fail, and a missing measurement fails. This does not prove
provider-side branch protection or deployment gating is configured.

The request-scoped read passed one controlled run at p95 848.54 ms and maximum
975.68 ms. A later run of the same application code measured p95 866.42 ms and
maximum 1,007.09 ms, so the unchanged one-second gate correctly failed. A single
passing run did not establish enough performance margin.

The follow-up retains immutable row baselines only for tables the transaction
is allowed to write. Authority and evidence reads still happen under the same
lock and keep all existing guards; these read-only collections no longer incur
an unnecessary deep clone. Terminal transitions also omit derived trust history
from their read. The recoverable post-commit trust transaction still loads that
history from canonical records. The 330 focused financial, lifecycle and scoped
SQL checks pass locally; the real PostgreSQL measurement remains the acceptance
gate and its actual result is recorded separately.
## Priority during completion bursts

The 1a1660 application passed with a 966.66 ms maximum, but the unchanged
application in 22a8d80 reached 1,019.21 ms. Both runs passed all 27 functional
database checks and three restore checks. This variation means a single passing
timing was not enough margin. The threshold and 240-action workload are unchanged.

Fresh derived trust work now yields when another lifecycle request holds or waits
in the per-request advisory-lock namespace, including gaps between holders of
the global financial lock. It keeps the same canonical financial lock and durable
intent. Intents older than 30 seconds retain their existing queued recovery path
so continuous trading cannot starve recovery. The priority observation is scoped
to the current database and the two-integer lifecycle namespace.

An isolated PostgreSQL regression failed before this change: fresh trust work
started while a lifecycle request lock was active. The paired overdue-intent
case checks that recovery still proceeds. The real four-process harness also
holds an active lifecycle lock, verifies that all intents remain pending, then
releases it and verifies exact-once recovery with account/session preservation.
Fresh real-PostgreSQL timing results must still be read from the new CI run.

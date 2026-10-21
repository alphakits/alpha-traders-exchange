# Receipt storage and complete measured trade latency

PR420 candidate CI1110 passed all nine original gates. Its merged source,
a49da8c3, failed CI1111's unchanged 1000 ms status-action maximum: 14 of 240
successful status calls exceeded the limit, with max 1223.271608 ms. All 33
core database correctness checks, eight provider-history recovery checks and
three restoration checks passed. Production remains on 1dcbf633; PR420 has
not been promoted. A green candidate run does not erase the failed merge run.

## Close the receipt timing gap

The original performance script inspected only the 240 status actions.
Thirty receipt uploads were recorded but not enforced. The gate now derives
metrics from the raw timings and requires exactly 240 successful status
measurements plus 30 successful receipt measurements, all finite, nonnegative
and strictly below 1000 ms. Status timing continues to exclude explicitly
deferred trust work; awaited work and receipt persistence stay included.
This does not claim coverage of browser time, providers or every operation.

Re-evaluation uses copies of retained artifacts; originals are unchanged:

| Run | Status max ms | Slow status calls | Receipt max ms | Slow receipt calls |
| --- | ---: | ---: | ---: | ---: |
| CI1109 | 1024.966 | 4/240 | 1123.932 | 2/30 |
| CI1110 | 822.592 | 0/240 | 1411.666 | 14/30 |
| CI1111 | 1223.272 | 14/240 | 1530.076 | 8/30 |

All three fail the expanded check. Nine before/after regressions verify the
boundary, omitted/failed/invalid samples, raw status timings and deferred
work accounting. Neither sample workload nor the limit is relaxed.

## Reduce avoidable storage work

Receipt saves previously fetched all retained binary content, deleted the
receipt table and inserted every file individually. Keep retained bytes in
PostgreSQL with conditional upserts. Only explicit binary overrides cross
the connection. Preserve stable evidence, notification and audit sort keys
so unchanged history is not rewritten after a prepend. New evidence batches
are bounded to 64 rows and 8 MiB; one larger legacy record remains intact.
Explicit deletion, metadata edits, content replacement and requested
reordering keep their semantics. Financial locking, durability, permissions,
commission rules and fallback behavior are unchanged.

The initial storage repair was selectively extracted from the still-unmerged
PR417 work. The follow-ups below independently verify the canonical receipt
transaction and production fallback changes while preserving all subsequent
seller-limit, modal, navigation and SMS repairs.

Local checks: baseline batch regression failed (four individual inserts
instead of two bounded batches; 57 other repository checks passed). After
repair, 100 checks passed across five focused suites. An additional real-SQL
receipt preservation test then passed with the five existing SMS persistence
cases, for 101 unique focused checks. TypeScript and changed-file lint pass.
No real SMS, customer transaction or financial backfill is performed.

Eight added database-harness checks run after the existing timed workload.
They inspect PostgreSQL tuple identity, exact bytes, stale/current saves,
prepends, metadata edits, explicit replacement, deletion and reordering.
CI must verify these checks and the expanded 270-action gate on this source.
Previous timing results are diagnostic evidence, not proof this candidate
has solved the strict latency requirement.

## CI1112 and Expo patch follow-up

CI1112 on ee540407 passed all 41 database correctness checks, including all
eight new retention checks, and the recovery/restoration checks. The expanded
gate correctly failed: status maximum 1032.221 ms, receipt maximum 1250.408 ms,
270-action p95 985.573 ms. Receipt storage work is verified; strict latency
acceptance remains unresolved. This run is retained, not retried or waived.

The Expo doctor failure from CI1111 is addressed by updating root/mobile Expo
to ~57.0.31 and mobile Expo Router to ~57.0.29, with the generated integrity-
locked dependency tree. Official SDK57 changelogs dated 21 October list no
user-facing change for Expo itself and navigation fixes for Expo Router.
No package is excluded from validation. After a fresh npm ci, Expo doctor
passes 21/21, web/mobile type checks pass, and all 101 focused tests pass with
the new dependencies. The existing dependency advisory gate passes with its
17 explicitly reported guarded/moderate findings; this is not a clean npm
audit. Full application CI and native store acceptance remain separate.

## CI1113 and canonical receipt transactions

CI1113 on 60521593 passed 5,833 unit tests in 551 files, the production build,
Expo doctor (21/21), every browser suite, and all 41 database correctness
checks. The strict performance gate still failed: status maximum 831.333 ms,
receipt maximum 1388.133 ms, combined p95 998.761 ms. Thirteen of the 30
receipts exceeded one second. This is retained evidence, not a passing release.

The receipt path still used speculative full snapshots and a process write
queue. Under contention it reread full snapshots after acquiring the financial
lock and rewrote unrelated activity and delivery rows. The follow-up routes
uploads through the existing canonical lifecycle transaction: read after
acquiring the same financial lock, decide once, and persist only changed rows
with stable positions. Receipt bytes, status, audit, notification and seller
SMS intent remain atomic. Explicit binary-only changes are supported; bytes
without a declared matching evidence row are rejected before any write.

Receipt reads declare eleven tables and limit event/evidence history to the
target trade. Required account, listing, request and commission dependencies
remain canonical. This partial snapshot never populates the full store cache.
Compatibility repositories retain stale-state validation and bounded retry.
Neither the measured workload nor the 1000 ms gate changes.

The audit also reproduced premature receipt notification publication: both
commit-order and failed-SMS rollback checks failed before the repair. Receipt
notifications now publish only after commit acknowledgement. Rejected attempts
discard their publications. No external provider delivery is exercised.

Before/after evidence: three read-scope/history regressions failed on 60521593
while the six existing receipt checks passed. Both notification publication
checks then failed before that repair. The complete follow-up passes 485 tests
across ten affected suites, root TypeScript and changed-file lint. Full CI must
measure the revised transaction path; no speed improvement is claimed from
unit-test results alone.

## CI1114 and production fallback retention

CI1114 on bb9a42d2 passes 5,840 unit tests in 551 files, the production build,
Expo doctor (21/21), all 41 database correctness checks, eight history recovery
checks and three restoration checks. All 30 receipt uploads are below one
second (maximum 713.870 ms). The expanded gate still fails: six concurrent
acceptance actions exceed the strict limit, with status maximum 1071.799 ms.
These original failures remain release blockers.

Successful production snapshot reads, writes and session mutations also
constructed an unused full exchange fallback. Production reads already fail
closed when durable storage is unavailable and cannot consume this copy.
Skip this mirroring before loading, cloning or seeding fallback state. Local
repositories and explicit loopback test runtimes retain their existing
fallback behavior. Durable writes, session revocation and recovery remain
authoritative. This reduces avoidable CPU and memory use; it does not by
itself establish that the acceptance latency failure is resolved.

Four baseline checks fail before the change (durable reads, commits, session
mutations and recovery retaining fallback copies); a pre-existing-copy
fail-closed check passes. After the change, all 109 checks across five
repository, session-security, transaction and receipt-persistence suites pass.

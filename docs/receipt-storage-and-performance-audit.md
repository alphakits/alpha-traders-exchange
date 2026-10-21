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

This is a selected extraction from the still-unmerged PR417 work. It excludes
that draft's fallback changes and scoped initial receipt reads and preserves
all subsequent seller-limit, modal, navigation and SMS repairs.

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

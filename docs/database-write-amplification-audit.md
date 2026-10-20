# Database write amplification audit — 21 October 2026

The strict subsecond gate remains unresolved. Do not promote this candidate on the strength of a passing retry. Main 72b9ba06 failed CI1094, and the verified web release remains 19d50be9.

This change removes three avoidable costs without changing the global financial lock, permissions, commission rules, durability settings, action workload, or 1,000 ms threshold:

- Production no longer clones complete snapshots or session changes into the development fallback mirror. Durable storage remains authoritative; failures remain closed. Explicit local E2E and development fallback behavior stays available.
- Full snapshot saves retain notification and audit-history order keys. The existing conditional upserts can then leave unchanged records untouched instead of rewriting them solely because their position was reset to 0..N. Intentional reordering still uses the existing deterministic reindex logic.
- Evidence metadata and binary content use parameterized batches instead of one statement per retained receipt. Batches are bounded to 64 records and 8 MiB of content, except a single larger legacy record, which is preserved without truncation.

Regression coverage checks production reads, writes, session revocation, failure behavior, large binary batches, null content, overridden content and global evidence order. The isolated database harness additionally checks unchanged PostgreSQL tuple identities after identical saves and prepends, plus exact byte equality for all 30 retained receipt fixtures. These checks run after the timed actions; the performance sample remains the same 240 actions.

## Controlled investigation

Four vCPUs, 8 GiB memory, Node 24.14.1, PostgreSQL 17.10, four application worker processes, loopback only. No production database, external delivery, customer transactions or actual settlement was used. CI uses its own PostgreSQL 17 image; these timings are not representative hosted-page measurements.

| Source variant | Correctness | Median action ms | p95 ms | Maximum ms | Actions >= 1,000 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Main baseline | 33/33 | 436.398 | 1,165.916 | 1,312.467 | 33 |
| Unchanged source repeat after a failed file transfer | 33/33 | 443.854 | 1,221.566 | 1,407.750 | 28 |
| Fallback mirror removed | 33/33 | 468.740 | 1,210.145 | 1,388.697 | 36 |
| Mirror removal and stable history positions | 35/35 | 430.887 | 1,047.978 | 1,173.672 | 20 |
| Above plus batched evidence | 36/36 | 454.531 | 1,113.567 | 1,261.948 | 27 |

Every variant failed the unchanged latency gate. Variation between runs prevents attributing an overall speedup to these figures. The final binary batch bound was checked separately; the preceding measured workload used 30 tiny PNG fixtures and does not exercise that limit.

The first baseline generated 19,331,095 WAL bytes during the payment phase. The stable-history variant generated 15,551,148 bytes in its run. Record counts and scheduling vary, so this is diagnostic evidence, not a controlled percentage claim. The stronger invariant is that identical/prepending history saves leave every existing tuple unchanged. Evidence inserts in that phase fell from 525 statements to 32 in the batched run. This query-count reduction is not a claim that overall action latency passed.

A separate CPU profile identified full-snapshot cloning and JSON decoding as additional costs. A profiling attempt against an already-used fixture failed a fixture-count assertion; it was excluded and repeated against a newly created disposable database. Profiled timings are not acceptance measurements.

The broad local unit run exceeded the command's six-minute budget and was stopped; it is incomplete. A large-buffer assertion in the first focused run exceeded the default test timeout. The assertion was changed to check preserved buffer identity and null content directly, without walking millions of bytes in the assertion library. The failed logs are retained. Neither event relaxes a release gate.

Next work is to reduce the broad evidence snapshot read/merge/write path and its lock queue while proving all concurrent financial invariants. A passing CI retry alone does not resolve the reproduced timing failure.

Final focused verification: 106 tests across repository, transaction and scoped-privacy suites passed. The 8 MiB batch boundary is covered by two 5 MiB buffers plus a null-content record.

## First draft CI result

CI1095 on fd9af822 completed with five successful and four failed jobs. The exact candidate passed all 36 database correctness checks, but one of the 240 measured business actions exceeded the unchanged target: median 352.559 ms, p95 808.735 ms, maximum 1,094.201 ms. This confirms that the final bounded implementation still needs latency work.

The complete unit run passed 5,798 of 5,799 tests. Its sole failure was an older recovery test that expected the now-removed production fallback mirror. The follow-up corrects that assertion to require no snapshot or evidence mirror; the durable recovery, version and initialization-retry assertions remain intact. All 82 tests in the recovery, repository and scoped-privacy suites then passed, with changed-file lint and whitespace checks clean. The earlier 106-test result remains separate evidence.

WebKit shard 4 reported an intermittent focus failure in the action transition matrix: the visible #action-required section was inactive. The runner classifies the case as flaky and correctly fails the job. It remains unresolved; no focus assertion, retry policy or release gate is weakened. Browser source was unchanged in this database draft.

## Retain existing receipt bytes in PostgreSQL

The recovery-test correction was published as 4de10b0b. CI1096 passed all 5,799 unit tests, lint, type checking and the production build. Its database sample passed all 36 correctness checks and all 240 timed business actions (median 281.306 ms, p95 710.652 ms, maximum 833.433 ms). Separate receipt calls still included 10/30 over one second, with a maximum of 1,289.695 ms. The earlier timing failures remain evidence of variability; this passing run does not resolve them.

This follow-up removes the complete binary-content read from both current and stale snapshot saves. Evidence rows now use conditional upserts: absent binary overrides preserve the content already stored in PostgreSQL, while explicit overrides replace only their addressed content. Stable sort positions avoid rewriting retained receipts when a new receipt is prepended. Explicit deletion and intentional ordering changes retain their behavior. New binary parameters remain bounded to 64 rows and 8 MiB per batch; a single larger explicit write is preserved without truncation.

Five new checks run after the unchanged timed sample. They verify current and stale saves preserve every receipt's tuple identity and bytes; metadata-only prepends preserve existing rows; metadata edits retain content; explicit content overrides affect only their target; deletion preserves retained rows; and intentional reordering retains exact bytes. All 41 database correctness checks passed. The 109 focused tests across repository, durable recovery, transaction and scoped-identity privacy suites passed, along with TypeScript, changed-file lint and whitespace checks.

| Source on the same fresh environment | Correctness | Median action ms | p95 ms | Maximum ms | Actions >= 1,000 ms | Receipt-call maximum ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Published 4de10b0b baseline | 36/36 | 217.611 | 530.569 | 599.383 | 0/240 | 991.956 |
| Retain receipt bytes in PostgreSQL | 41/41 | 221.462 | 537.629 | 612.954 | 0/240 | 987.407 |

These two runs used separate fresh fixture databases on the same disposable four-vCPU / 8-GiB Ubuntu environment, Node 24.21.0 and PostgreSQL 17.10 built from the official source archive. fsync, synchronous_commit and full_page_writes stayed enabled. The initial default PostgreSQL 18.6 installation failed the unchanged PostgreSQL 17 catalog comparison before timing began; that environment failure was retained and the engine version corrected. No assertions or workload were weakened. The result demonstrates removed binary transfer and unchanged-row writes, not an overall action-latency speedup: this candidate's measured business-action maximum was slightly higher than its baseline.

The original WebKit focus failure also remains open. Three isolated diagnostic runs of the unmodified application passed the seven-state matrix (21 state checks, zero retries), without reproducing the failure or establishing its cause. Diagnostic browser instrumentation is not included in this change.

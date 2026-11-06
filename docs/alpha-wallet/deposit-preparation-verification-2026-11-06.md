# Deposit preparation and exact replay: verified development checkpoint

Verified **6 November 2026, 21:53:24 Asia/Jerusalem**. Live launch remains off.

## Source and decision

| Item | Verified value |
| --- | --- |
| Repository and branch | `alphakits/alpha-traders-exchange`, `feature/alpha-wallet-dev-20261104` |
| Implementation commit | [`68ee52017b18631bfbd44acb3c5afea44a3c8223`](https://github.com/alphakits/alpha-traders-exchange/commit/68ee52017b18631bfbd44acb3c5afea44a3c8223) |
| Tested source tree | `b16deed3ad860c77923d0d3d4780f37343812434` |
| CI run | [42280807815](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42280807815), attempt 1 |
| CI job | `128109103023` |
| Completed | `2026-11-06T19:53:24Z` |
| Result | All required CI steps passed |
| Machine-readable evidence | [deposit-preparation-verification-results.json](deposit-preparation-verification-results.json) |
| Report SHA-256 | `3e110a567129bcaf36c3d1a5df1e03114f1fce2217c5f2c8b4e1d378945b6bbb` |

The first preparation phase is implemented, saved and verified. It creates no persistent inbox, financial command or custody connection. The [launch-readiness decision](launch-readiness.md) remains **not ready for live funds or deployment**.

## Implemented behavior

The [preparation contract](deposit-observation-preparation.md) binds a candidate to an immutable synthetic manifest: exact chain and token, receiving assignment and beneficiary, declared source pair and policy, and trusted worker scope. Operational endpoint configuration must match normalized host and URL-hash commitments before any callback or read. Candidate data cannot substitute another recipient, asset, beneficiary, worker or policy.

Timed capture uses the unchanged BSC/TRON observers and native transport with explicit injected synthetic IO. It retains original raw requests/responses, semantic clock calls, per-read enclosing wall intervals and conservative monotonic microseconds. Exact historical replay checks the raw native formats, BSC session/ordinal/RPC response IDs, TRON integer literals, read order, arguments, source roles and every clock sample, then reruns the frozen observer and decoder semantics. Recomputed checksums alone cannot bypass those checks.

Prepared evidence additionally binds its manifest and record hashes, configured store-instance identifier, attempt, candidate and trusted synthetic context snapshot. Historical verification is independent of current time; genuinely new admission has a separate freshness check. The original pinned checkpoint remains distinct from the last fully validated advancing head. Native event identity excludes facts whose alteration must become a conflict, while event, transaction and block fact hashes retain those facts for the future recorder.

One preparation must finish in less than 30 seconds, including context lookup, reads, hashing and replay. The reader rejects overlapping/reentrant work, never reobserves a consumed attempt ID, bounds retained attempt IDs at 256, aborts pending IO and cancels unread late responses. Descriptor-based capture refuses executable or ambiguous data without invoking getters or Proxy traps. Provider/callback error text stays private. Runtime, timeout and closed-reader refusals remain identifiable across the underlying transport.

## Complete regression evidence

| Suite | Passed | Files | Retained previous cases | New cases |
| --- | ---: | ---: | ---: | ---: |
| Wallet, observation and local persistence | 3,417 | 78 | 2,943 | 474 |
| Platform authentication | 87 | 5 | 87 | 0 |
| Marketplace and storage regressions | 100 | 4 | 100 | 0 |
| **Total** | **3,604** | **87** | **3,130** | **474** |

There are zero failed, skipped, pending or todo cases. Retention compares repository-relative file paths and complete case names as a multiset, preserving all 11 inherited duplicate occurrences. The 474 additions are distinct. The complete inventory contains 3,593 unique case identities and is bound to the raw native CI reports by SHA-256. The 474-case local focused run is a verified subset of CI and is not counted again.

| New file | Passing distinct cases |
| --- | ---: |
| `deposit-inbox-admission.test.ts` | 172 |
| `deposit-inbox-data.test.ts` | 146 |
| `observation-transcript.test.ts` | 62 |
| `deposit-observation-preparation.test.ts` | 94 |

The focused suites cover both chains and advancing heads, immutable normalization and scope binding, endpoint substitutions, hostile data and capability objects, exact integer limits, rehashed transcript tampering, missing/extra/reordered reads and clocks, strict timing/resource bounds, synthetic context and finite-cursor identity checks, concurrent/reentrant refusal, callback deadlines and late-body cancellation. Independent review identified and corrected prototype-chain error sanitization, complete wall-budget enforcement, root error classification and late-response cleanup before final verification.

The full run also passed repository TypeScript, the existing offline demo, **18 native PostgreSQL drills with all 212 ordered checks retained**, and the standalone English desktop / Arabic RTL mobile Chromium rehearsal. The native drills exercise the existing financial/canonical concurrency and recovery contracts; this phase adds no SQL inbox. Browser evidence exercises the retained rehearsal, not future product routes or a native mobile application. All 75 frozen contracts and previous implementation source files remain byte exact. Focused ESLint and local repository TypeScript also completed successfully.

## Evidence custody and scope

The machine-readable report binds the exact source/tree, successful run/job/step metadata, downloaded artifact archive digest and byte size, extracted file digests, complete native test inventories, ordered PostgreSQL checks, browser assertions/screenshots, focused-subset comparison and frozen-source hashes. Independent case and native/browser auditors must both pass before the report is generated. A historical artifact is not accepted with a fresh job label.

Initial source `c3b4739d7fc537b8703420d0c9c76a22672735c4` / run `42280538624` was superseded after the independent case-inventory audit found ambiguous parameterized names and array-valued test-table rows. The corrected source above preserves 474 uniquely identified new cases. Only run 42280807815 supplies this milestone's full result. Documentation saved after verification does not change the tested implementation.

The existing non-failing PostgreSQL client deprecation warning in the payment coordinator observer harness remains separately recorded in the report. This phase does not change that harness or its result. A later client-version compatibility correction must retain the real database concurrency guarantees.

## Remaining engineering boundary

The synthetic preparation-context callback does not prove an actual retained database checkpoint or persisted candidate-job membership. The remaining [durable inbox contract](deposit-observation-ingestion-design.md) must implement an isolated store, immutable command receipts and first facts, event/transaction/block anchors, continuity and conflict handling, absorbing quarantine, finite candidate progress, unknown-COMMIT fencing, independent paused backups and quarantine-only restore. Persisted context verification and recovery belong to the same reviewed unit.

Copied evidence and hashes establish internal consistency, not authenticated provider truth, clock authenticity, organizational independence or custody ownership. No real provider, receiving address, key or signer is configured. No real funds were received, credited, signed or transferred. No production migration, main-branch merge, deployment or launch was performed. Existing V1–V5 history and financial authorities retain their meaning; trusted payment verification, actual seller release, dispute resolution, complete unpaid cancellation, product integration and controlled operational readiness remain unfinished.

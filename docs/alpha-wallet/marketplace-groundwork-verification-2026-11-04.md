# Alpha Wallet: marketplace transaction groundwork verification

Date: 4 November 2026 (UTC). Decision: **verified development checkpoint; not ready for live funds or deployment**.

The complete isolated pipeline passed for source commit [`44ac6c4d1b3158ddbfbc4d7dc2f312bb51a3d69f`](https://github.com/alphakits/alpha-traders-exchange/commit/44ac6c4d1b3158ddbfbc4d7dc2f312bb51a3d69f), tree `cda282583b521b0080ae1aa39755ce50bbdc470b`, on `feature/alpha-wallet-dev-20261104`. The user's no-live-launch restriction remains in force.

## Executed result

| Gate | Result on the saved source |
| --- | --- |
| Full wallet suite | **613 passed across 20 files** |
| Targeted platform authentication regressions | **87 passed across 5 files** |
| Targeted existing marketplace/storage/recovery regressions | **100 passed across 4 files** |
| Combined non-overlapping total | **800 passed, 0 failed, 0 pending, across 29 files** |
| Full-project TypeScript | Passed locally and in CI with `--noEmit --incremental false` |
| Existing native PostgreSQL process-concurrency harness | Six checks passed |
| Existing native PostgreSQL backup/paused restore harness | Six checks passed |
| New native marketplace/wallet shared-transaction harness | Six checks passed, including a real waiting-writer serialization retry |
| Existing offline financial demonstration | Passed; 500 principal delivered and 10 separately funded commission recognized |
| Actual Chromium English desktop / Arabic mobile rehearsal | Passed; response-loss recovery, no page/console errors and no horizontal overflow |

[CI run 41923229185](https://github.com/alphakits/alpha-traders-exchange/actions/runs/41923229185), job `126900812384`, completed successfully by **22:17:10 UTC**. It used Node 24.22.1, disposable PostgreSQL 17.11 and Chromium 149.0.7827.55. The three native drill results are additional executable evidence, not extra unit tests added to the 800 count. The two platform gates are targeted regression suites, not every test in the marketplace repository.

## Canonical accepted-amount planning

The new server-only development planner derives buyer acceptance of an existing seller amount correction from canonical request/listing data, competing reservations, stored evidence/disputes, verified wallet state and an explicit development binding. It returns immutable exact terms, source digests, stable request/proposal acceptance identity and a reservation effect. It writes nothing and returns `executionAuthority: false`.

| Canonical request | Planned financial effect |
| --- | --- |
| Ordinary pending request | No reservation; accepting corrected terms does not prematurely reserve principal. |
| Accepted request with larger principal | Increase the same existing reservation from its funded listing inventory. |
| Accepted request with smaller principal | Return only the delta from that reservation to its open listing. |
| Accepted request with unchanged principal | Retain the reservation without a zero-value transfer. |

The **105 planner tests** cover both simulation assets, exact amounts and fee rounding, locked price versus changed public listing price, different prices that round to the same fiat total, missing/stale bindings, wrong actors, two submitted proposals including retained history, pending demand/buyer-offer restrictions, evidence/dispute/payment/code locks, settled prior trades and funded inventory limits. Frozen payment instructions and both fee-policy/calculation versions remain bound. Unsupported fee/currency/payment mappings fail closed.

Independent review found and corrected a marketplace-specific issue: a listing's `lockedAt` is its normal acceptance inventory lock. It must not block a clean accepted correction. Request payment/disclosure/evidence locks still prohibit changes, including irreversible history retained after a status change. The final suite includes a normal matched/locked listing regression.

These inputs are a trusted internal contract. Their TypeScript shape does not authenticate a caller, prove complete canonical inventory or establish transaction freshness. A future coordinator must provide those guarantees and persist a durable acceptance receipt. The stable acceptance key and snapshot-specific input digest serve different purposes.

## Actual repository SQL in one owned transaction

`mutateDevelopmentFocusedTradeInTransaction` reuses the existing focused marketplace reader, request update, review cleanup, event encoders and runtime-version update. The old `mutateFocusedTrade` wrapper keeps its own transaction, normalization tolerance and event-upsert behavior. Existing callers are not routed through a wallet coordinator.

The new development participant verifies writable SERIALIZABLE isolation, the simulation setting and stable transaction identity. It acquires request/global financial locks, fences `runtime_meta` and reads the canonical focused context. It never discovers a connection, begins, commits, retries, releases or publishes independently.

Its write set preserves identity, asset/payment bindings and lifecycle evidence, rejects unrelated collections/requests, and scopes insert-only notification/audit identities to the target and participants. The callback result is cloned before further awaits so retained references cannot change validated rows or recipients during persistence. A failure after certification aborts the same transaction, even if the caller catches a semantic exception or disables the local simulation setting after a wallet write. Unknown or changed transaction identities are not aborted.

The **14 actual-SQL participant tests** cover these guards, commit/replay, rollback on either side, historical event collisions, review cleanup, lifetime/context rejection and preserved legacy normalization. The **100 existing regressions** cover repository behavior, targeted transaction recovery, encrypted Wise storage and owner completed-trade history.

### Native PostgreSQL proof

The new harness creates minimal disposable marketplace tables containing exactly the columns used by the actual repository statements. It deliberately pairs harmless trade-note updates with synthetic wallet commands. It does not apply the accepted-terms planner or represent production business acceptance.

| Executed fault or race | Observed result |
| --- | --- |
| Shared successful write | One backend committed the real focused row update and a 200-USDT reservation together. |
| Semantic failure after the wallet write, caught by the outer caller | Transaction still aborted; both domains retained their original footprint. |
| Real SQL error after the marketplace update | Marketplace row, wallet history and projections all rolled back. |
| Contender waiting behind an ordinary marketplace writer | Distinct backend and an ungranted advisory lock were observed. The stale row fence forced **two whole-transaction attempts**; the business callback ran once against fresh state. |
| Lost reply after a real shared commit | Injected response loss was reconciled with the original wallet command identity; no duplicate command or marketplace overwrite. |
| Close and reopen | Both domains reconstructed identically; 500 USDT remained conserved as 300 listing inventory plus one 200-USDT reservation. |

The lost-reply fault is a synthetic exception after a real commit, not a real network partition. Wallet-command reconciliation in this harness does not implement a proposal-acceptance receipt. Provider submissions were zero.

## Frozen v1 compatibility

The fixture contains **41 actually committed v1 commands**, their original timestamps/results/hashes, full tagged final state and provenance from verified source `f3422f9`. All ten captured engine/storage/schema source files remain byte-identical in this checkpoint.

The three compatibility tests verify the entire hash chain and final state, then restore/reopen original rows unchanged with one new quarantine pause. They preserve original business results while preventing replay of old dispatch authority. The retained unknown withdrawal still allows only original-reference lookup, with no replacement send after a missing lookup. The fixture includes 200 delivered plus 300 held, separately funded fees, BSC precision/rounding and a withdrawal beyond JavaScript's safe integer range.

These fixed expectations must not be regenerated to make a future engine pass. They protect the captured history; they are not exhaustive proof for every possible v1 state. The [proposed v2 continuation handoff](ledger-v2-continuation-design.md) describes a separate version boundary, migration and mixed-history backup contract. None of that v2 behavior is implemented here.

## Retained browser and recovery behavior

The existing native concurrency and backup harnesses passed again. Backup restore still adds its pause atomically, preserves original payout identity and submits nothing during lookup-only recovery.

Actual Chromium ran English at 1440 pixels and Arabic RTL at 390 pixels. The flow delivered the full 500 USDT principal, recognized 10 separately funded commission and ended with zero reserved principal and zero commission due. The server committed reservation/withdrawal operations before truncating their responses; reload/retry retained each original request and committed revision. Withdrawal recovery left one 25-USDT hold, 75 available and zero provider submissions.

The browser/server/rehearsal source files are byte-identical to the earlier verified checkpoint. Previously inspected [English/Arabic captures](phase3-verification-2026-11-04.md#browser-evidence) remain saved. New CI screenshots and their hashes are included in the current evidence. The role switcher is still a synthetic rehearsal control, not deployed account authentication.

## Exact evidence and launch boundary

[marketplace-groundwork-results.json](marketplace-groundwork-results.json) retains all test names/statuses, source hashes, CI steps, native outputs, browser outcomes and artifact metadata.

Artifact `13369305071`, `alpha-wallet-simulation-evidence-44ac6c4d1b3158ddbfbc4d7dc2f312bb51a3d69f`, contains 1,984,960 bytes. Its downloaded ZIP matched the published digest:

```text
sha256:c3131f6a904066a7dce5e84abcf834d50a03eacab7acf54305eab4bdf648ef3e
```

The temporary artifact expires on 18 November 2026; this report and the machine-readable outcomes remain saved with the development branch. CI uses read-only repository permissions, explicit disposable loopback databases, synthetic providers and no deployment steps or production secrets.

A read-only Vercel check after the successful source run still observed **zero deployments for the wallet branch**. Automatic deployment remains disabled. No main merge, production migration, real key creation, signing or transfer was performed.

Remaining integration includes the versioned resize/initial acceptance operations, durable bindings and acceptance receipts, lifecycle participants, all enrolled-writer guards, actual buyer eligibility/reviews, and exactly-once completion/benefits/ranks/receipts/publication. Custody/signing selection, trusted bank/cash verification, real chain observers, actual wallet HTTP/MFA boundaries, operational recovery/load/monitoring, production permissions and independent security review remain launch gates. See [launch-readiness.md](launch-readiness.md).

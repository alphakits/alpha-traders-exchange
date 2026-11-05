# Prepayment cancellation groundwork: exact-source verification

Date: **6 November 2026, Asia/Jerusalem**; the verification completed at **2026-11-05 22:12:41 UTC / 2026-11-06 00:12:41 IST**. Decision: **this development milestone passed. Alpha Wallet is not ready to accept live funds or deploy.**

Verified implementation: [`73970284b87fdce6d1daf97b6b3ebefa757825f3`](https://github.com/alphakits/alpha-traders-exchange/commit/73970284b87fdce6d1daf97b6b3ebefa757825f3), tree `b9534db09463b6050dee5d758bac62e565501c69`, on `feature/alpha-wallet-dev-20261104`. Its parent is saved checkpoint `6cf7ce9dc81a52ce355efb34a77e20973d8e25d2`. The previous verified implementation is `2c3e6a0b809f9bb34f84dcc82243593ba079ee1f`.

The [GitHub Actions run](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42117518227) and [verification job](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42117518227/job/127561004161) passed on the first attempt. The [machine-readable evidence](prepayment-cancellation-verification-results.json) binds the exact commit/tree, suite inventories, native results, workflow metadata, artifact and job-log hashes, and source-file digests. Later documentation commits do not change that tested implementation.

## Executed results

| Gate | Passed | Scope |
| --- | ---: | --- |
| Wallet tests | **2,045 / 54 files** | Retained financial, authority, storage and recovery contracts plus the new cancellation groundwork |
| Platform authentication | **87 / 5 files** | Retained web/mobile session-source, expiry and enforcement behavior |
| Marketplace/storage regressions | **100 / 4 files** | Repository, transaction recovery, PostgreSQL storage and completed-trade history |
| **Total** | **2,232 / 63 files** | **Zero failures and zero skips** |
| Root TypeScript | Passed | Existing root `tsconfig.json`; no emit |
| Native PostgreSQL | **13 drills / 139 checks** | PostgreSQL **17.11**; includes two new drills and 22 new checks |
| Chromium | Passed | Version **149.0.7827.55**, English desktop at 1,440 px and Arabic RTL mobile at 390 px; no console errors or horizontal mobile overflow |
| Offline simulation | Passed | Full principal delivery, separate fee accounting and retained uncertain payout identity |

The current and preceding CI artifacts were downloaded. The multiset of repository-relative file path plus full test name proves retention of **all 1,726 previous wallet cases**, alongside **319 new cases**. All 87 authentication and 100 marketplace/storage cases are also retained. These are executed case inventories, not an inference from aggregate totals. All 13 native stderr files and the root typecheck log are empty.

### New case inventory

| Test file | Cases | Material behavior |
| --- | ---: | --- |
| `v3-frozen-history.test.ts` | 9 | Original captured V3 history, state, backup and provenance remain exact |
| `v4-engine.test.ts` | 127 | Principal conservation, strict actor/terms/checkpoint assertions, immutable receipts, business retries and prepayment restrictions |
| `v4-history-compatibility.test.ts` | 15 | Original reducers, results, hashes, acceptance receipts and uncertain dispatch behavior survive the continuation |
| `v4-durable.test.ts` | 24 | Atomic migration, SQL projection guards, strict replay, transaction ownership and failure rollback |
| `v4-backup.test.ts` | 43 | Separate paused-source format, exact mixed-history restore, input capture, quarantine and same-transaction failure cleanup |
| `prepayment-cancellation.test.ts` | 64 | Ordinary buyer/seller policy, exact physical/canonical identity, disclosure/evidence/dispute checks and canonical effects |
| `prepayment-cancellation-transaction.test.ts` | 37 | Real canonical SQL writes, dependency fences, exact poststate, runtime/clone failure rollback and transaction identity |
| **Total added** | **319** | All included in the complete saved-source CI wallet suite |

A local full-suite run began while final review fixes were still being edited. Its cached module graph reported 14 failures among the newly edited canonical cases, so it is not exact-source evidence. A fresh run from the saved implementation passed all **101 canonical cases**. The clean CI checkout then passed all **2,045 wallet cases**. This report uses the clean CI result; it does not recast the earlier local run as a pass.

## Financial cancellation and original history

The [V4 design](prepayment-cancellation-design.md) adds exactly three command forms: `continueFromV3`, `cancelInitialTrade` and `pause`. It does not expand old reducers or reinterpret old receipts. The original V1/V2/V3 parser, reducer, SQL and recovery contracts remain unchanged. All **75 recorded original source/schema/manifest files** match the preceding verified source byte for byte.

The frozen V3 capture contains a 14-command unpaused prefix and a distinct 15-command paused backup. The accepted prefix has event hash `846e734f1ea118575af2ec1b7199005f9c0c3d1c1188338dc80ff4f056370223` and state hash `e9254bd9ba4e80879aab5641dead516a0076f8b5d951bbeab9ec7f35341bf2f5`. The fixture bytes were captured before applying V4; they were not regenerated to make the new implementation agree.

A V4 cancellation binds the original accepted terms, actual retained buyer/seller identity, acceptance receipt and initial binding digests, current wallet checkpoint, supplied canonical prepayment assertions and clock. The isolated command treats those assertions as synthetic input; a future authenticated coordinator must derive them from stored authority and locked canonical rows.

The principal return is one balanced two-entry journal. In the native example, **200 USDT moves from the trade reservation to the same listing**, changing listing/trade balances from **300/200 to 500/0**. The listing's 500 USDT is not the complete native fixture's custody balance: that fixture also retains a separate deposit and an uncertain withdrawal. No cancellation payout, withdrawal, commission or provider submission is created.

One original acceptance has one cancellation business identity and one immutable receipt. A fresh transport ID with identical actor and decision returns the original receipt; changed actor or evidence is refused. The original global transport identity tuple also remains unchanged across engine versions. A past dispatch retry returns `shouldDispatch: false`, preserving its current inherited payout state.

The new engine validates its original V3 source by reversing only its own validated journal, receipt, idempotency and pause suffix, then checking the unchanged V3 invariants and original state hash. This reconstructed source is used for validation, never to obtain new monetary authority from an older reducer.

An already paused source remains paused. Buyer-visible bank details block buyer cancellation; an unpaid seller can still cancel after disclosure. Listing expiry is refused. This contract includes no owner force-cancel, expiry sweep, automatic withdrawal, settlement or resume.

## Canonical transaction groundwork

The separate planner and transaction participant support a bounded ordinary Bank Transfer or Face-to-Face cancellation. They require initial-style acceptance with unchanged listing-price terms and the current fee policy on the two supported simulated asset mappings, the exact accepted request, physical trade projection and representative listing lock, consistent dispute linkage, no competing reservation, and an absent or future listing expiry. Current payment fields, embedded and stored evidence, open disputes and nine known payment/settlement/evidence timeline markers prevent a stale accepted status from supplying cancellation authority.

The cancellation preserves the parties, quote, original accepted creation time, disclosure and unrelated history. It cancels the request/trade, unlocks the listing, clears reminders, withdraws a pending terms proposal, retains trust-reconciliation intent, archives matching buyer action reminders, and appends deterministic cancellation notifications and a listing-reopened audit. Canonical `availableAmount` is preserved; it is not incremented with a wallet amount. Wise, Cardless, demand matches and adjusted terms are outside this bounded scope. The stored scalar role is event metadata, not proof of current account authority. New-sale `canSell`/`canBuy` eligibility is not the cancellation policy.

The participant certifies one caller-owned writable SERIALIZABLE physical transaction, captures inputs before awaited work, rechecks all relevant dependencies and validates the exact poststate. A swallowed failure aborts only the same certified original transaction. A replacement transaction is not poisoned.

**This is not yet the authenticated cancellation coordinator.** Its native atomicity companion is an independently authorized synthetic wallet pause. That drill commits zero financial returns and creates no immutable cross-system cancellation receipt. A direct read after a lost COMMIT reply proves committed canonical rows, not financial receipt recovery.

Both the standalone V4 writer and this canonical participant reject the existing correction and initial-coordinator namespaces, including empty initialized namespaces. Existing initial-cohort guards still require their original accepted poststate. A successor profile, explicit migration, current stored web/mobile authority, writer fences, complete combined recovery and safe publication contract must couple these two separately verified components.

## Native PostgreSQL evidence

Every previous native drill was rerun on this commit.

| Drill | Checks |
| --- | ---: |
| Independent-process concurrency | 6 |
| Standalone backup/restore | 6 |
| Canonical transaction groundwork | 6 |
| V2 continuation and recovery | 9 |
| Amount-correction coordinator and writer/authentication races | 16 |
| Correction-cohort combined recovery | 11 |
| Mobile authority and cross-transport recovery | 12 |
| Initial acceptance transaction groundwork | 9 |
| V3 initial reservation and isolated recovery | 11 |
| Authenticated initial coordinator | 15 |
| Initial combined recovery | 16 |
| **New isolated V4 cancellation and recovery** | **11** |
| **New canonical cancellation mechanics** | **11** |
| **Total** | **139** |

The new financial drill rolls back actual V4 DDL and a swallowed failure after receipt insertion. It observes distinct PostgreSQL backends waiting on the ledger head: the losing cancellation retries its whole decision and recovers the original receipt, with exactly **one committed principal return**. An injected lost reply follows an actual COMMIT; the next call recovers the same original result. Older writers/exporters and direct immutable-projection mutations are refused.

The new canonical drill rolls back failures after actual request/trade/listing/reminder/event writes and companion commands. A stale buyer decision waits behind bank disclosure, retries its complete transaction, and is refused. Competing seller cancellations after disclosure commit exactly one canonical cancellation and one synthetic pause; the loser retries and refuses the cancelled request. The test reports **zero financial returns, payouts and provider submissions**.

These are disposable PostgreSQL fixtures. Response-loss faults are injected after real commits; they are not real network partitions. Reopening a new native connection proves durable replay across a connection boundary, not a newly launched process or a production failover.

## Separate V4 recovery

The new format-4 `isolated-v4-ledger` backup retains all four command versions and all three continuations. Export requires a paused isolated source. Restore requires a fresh target, preserves every original command/result/hash and appends exactly one new V4 quarantine pause in the same transaction. The source and restored target remain paused. This format contains no canonical rows, credentials, signer or provider state; existing combined recovery formats remain separate.

The native source checkpoint is revision **17**; the restored target is revision **18**. Two distinct backends visibly contend for the original restore advisory gate. Exactly one restore commits. After a lost reply, inspection of that same target verifies the original prefix and quarantine checkpoint; a second restore cannot overwrite it. The original acceptance and cancellation receipts remain recoverable. The inherited uncertain withdrawal remains held and cannot be dispatched again.

Review also fixed backup preflight cleanup: restore options and the evaluated clock are captured before asynchronous work; captured validation failures are raised inside the certified transaction so that catching them cannot commit earlier companion writes. Tests verify this without granting authority to abort a different physical transaction.

## Browser and offline evidence

The retained rendered Chromium rehearsal exercises full funding, owner approval, partial 200/300 reservations, distinct buyer/verifier/seller/worker actions, uncertain provider response recovery and separate fees. Its final fixture delivers **500 USDT** of principal and recognizes **10 USDT** of independently funded commission. Interrupted reservation and withdrawal HTTP responses retain the same operation across reload and recover their original committed revision. The withdrawal remains held with zero provider submissions.

Six screenshots accompany the raw CI artifact. This rehearsal is still the standalone synthetic English/Arabic interface. It does not exercise the new cancellation coordinator, production marketplace routes or a native mobile build.

## Artifact provenance and reproduction

- Workflow run: `42117518227`, attempt `1`; job: `127561004161`.
- Artifact: `13458170698`, named `alpha-wallet-simulation-evidence-73970284b87fdce6d1daf97b6b3ebefa757825f3`.
- Downloaded ZIP: **2,077,226 bytes**, SHA-256 `b7547810fdd01d8dc7bc856482543e51d61a67bf1ec1847e481fd08e644b6b33`, matching GitHub's artifact digest.
- Extracted evidence: **44 files**, each byte count and SHA-256 recorded in the machine report.
- Downloaded decoded job log: **439,516 UTF-8 bytes**, SHA-256 `d9c8eeb1ecc9af97e039a04c0f43954aa3090c69f94626939707d2419114b2bc`.
- Runtime: Node **24.22.1**, locked dependencies, UTC sessions and disposable PostgreSQL **17.11**.

The frozen provenance's `captureScriptSha256` records the capture-time helper. Its later removal of an unused import does not change the captured artifacts or their source guards; the original provenance remains untouched.

Reproduce the complete gate using the development-branch workflow at the exact source commit. It clean-installs the lockfile, runs the wallet/authentication/marketplace suites and root TypeScript, executes all 13 native scripts against explicitly disposable loopback databases, and runs the retained Chromium rehearsal. Source hashes and original-case retention are included in the machine report. Root TypeScript excludes the native mobile workspace and existing excluded test paths; this gate does not include a full production or native mobile build.

## Readiness decision

**Trust Wallet is the selected receiving-wallet preference.** The [custody decision](custody-decision.md) and [chain adapter contract](chain-adapter-contract.md) record its reviewed automation options and the requirements an eventual signer must satisfy. No real wallet, receiving address, key, provider account or chain-connected signer/testnet environment was created or connected by this milestone.

The immediate next slice is a successor authenticated cancellation profile for the existing single mapped trade: current web/mobile authority, canonical effects, V4 principal return, one cross-system receipt and safe deduplicated publication must commit together, with matching SQL writer fences and complete combined recovery. Existing contracts remain frozen.

Live launch additionally requires the remaining payment/dispute/release lifecycle, actual web/mobile product integration, trusted bank/cash verification, exact network/token/address configuration, signer/testnet recovery evidence, production permissions and migrations, step-up and spend limits, delivery, monitoring, source fencing and authority re-entry, realistic load/recovery exercises and independent security review. The [launch checklist](launch-readiness.md) and [current checkpoint](development-checkpoint-2026-11-05.md) track these requirements. No main merge, production deployment/migration or real transfer occurred.

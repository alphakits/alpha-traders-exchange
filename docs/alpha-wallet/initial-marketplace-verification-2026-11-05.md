# Authenticated initial marketplace acceptance: verified development checkpoint

Verified **5 November 2026, 18:02:39 IST (Asia/Jerusalem)**.

The separate stored-seller coordinator, explicit owner activation, atomic canonical acceptance and v3 full-principal reservation passed the complete development gate. **Nothing was launched.** Main was not merged, production migrations were not applied, real funds/providers/signers were not used, and no message was sent to a person. The exact development branch remains excluded from automatic deployment; the final branch-filtered deployment lookup returned zero records.

## Exact saved source and evidence

| Item | Verified value |
| --- | --- |
| Repository | `alphakits/alpha-traders-exchange` |
| Development branch | `feature/alpha-wallet-dev-20261104` |
| Application source commit | `c11fe0e90dc96fad8e0b21901cd9093e9c2dc536` |
| Application source tree | `de86817fb494d57b71c900d751ce3d2659824afa` |
| Starting saved checkpoint | `54d629b51ccbee87086700e735f30bd7da232748` |
| Previous verified financial milestone | `f18e95e689462895aeed2a5dd5e1244b3bbd85a1` |
| CI run | [42059622746](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42059622746) |
| CI job | `127357335691` |
| CI result | Completed successfully on the exact source above |
| Downloaded artifact | `alpha-wallet-simulation-evidence-c11fe0e90dc96fad8e0b21901cd9093e9c2dc536` |
| Artifact ID | `13430767561` |
| Artifact size | 2,053,140 bytes |
| Archive SHA-256 | `cdb248225ec8b5ac4c856d8950c8acce683f6b203e3b61543e3ec087e5744e03` |
| Verified archive paths | 38 exact allowlisted files |

The [machine-readable report](initial-marketplace-verification-results.json) binds the tested source/tree, run/job, extracted evidence hashes, individual test inventory and native results. The archive's downloaded size and SHA-256 were checked against the provider metadata, every path was allowlisted, and each extracted file's size/hash was rechecked. A subsequent documentation-only checkpoint records these results; it does not change the tested application source.

## Complete automated verification

| Gate | Result |
| --- | --- |
| Wallet unit, storage, authority and integration tests | **1,592 passed across 43 files** |
| Retained platform authentication contracts | **87 passed across 5 files** |
| Retained marketplace/storage regressions | **100 passed across 4 files** |
| **Total Vitest cases** | **1,779 passed across 52 files; zero failed or skipped** |
| Root TypeScript | Passed, empty error log |
| Changed TypeScript ESLint | Passed locally, empty log |
| Native PostgreSQL | **10 drills / 101 checks passed** |
| Existing offline wallet simulation | Passed |
| Retained Chromium rehearsal | English desktop and Arabic mobile passed |

All **1,439 prior wallet cases** are retained. The report checks a multiset of `(repository path, full case name)`, preserving duplicate-name multiplicity. The new milestone adds **153 cases**:

| New test file | Passed cases |
| --- | ---: |
| `marketplace-seller-authority.test.ts` | 44 |
| `initial-marketplace-boundaries.test.ts` | 39 |
| `initial-marketplace-coordination-store.test.ts` | 24 |
| `initial-marketplace-coordinator.test.ts` | 46 |

The complete local wallet run also passed **1,592 / 43** with two workers in **612.15 seconds**. Its exact case inventory matches CI. Separate focused authority/storage/boundary and PGlite smoke runs are supporting evidence; they are not added again to the total.

Root `tsconfig.json` excludes `apps/mobile` and three preexisting test files. This is not a full production build, native iOS/Android build, production migration/role audit or independent security audit.

## What this source implements

The [initial coordinator design](initial-marketplace-coordinator-design.md) describes the new private API and its limits. Both fixed stored-session readers expose explicit `canSell`, derived from existing seller operational policy. An approved seller can accept without having buyer capability. Stale role labels cannot override suspended/rejected status, and buyer/owner/other-seller identity cannot impersonate the request's seller.

Owner activation selects one exact pending request and explicit platform/wallet identity mapping. It captures its clean canonical basis and verified wallet checkpoint but creates no reservation or seller consent. Acceptance separately authenticates the stored current seller, owns the complete fenced canonical read and verified v3 replay, and commits all of the following in one transaction:

- The pending request's accepted state and original preallocated platform trade identity.
- Its physical trade projection and the listing's representative lock.
- The full-principal v3 reservation, balanced journal, immutable initial binding and financial receipt.
- The exact canonical notification/audit events, coordinated original receipt and safe publication intent.

The existing three-active-trade policy remains unchanged: two other canonical commitments permit the proposed third; three existing commitments refuse another. Buyer history/reviews across sellers, both participants' unpaid seller commissions, current seller availability, bilateral blocks and enforcement are rechecked from stored canonical facts. The first wallet cohort still refuses competing target-listing reservations and unpaired active seller wallet trades.

Public receipt/inspection output excludes sessions, devices, raw account/request payloads, bank instructions, recipient destinations and private activation evidence. Web/mobile transport changes recover the same original receipt under fresh authority. A paused wallet can return an original receipt without adding a financial or canonical effect. Expired or revoked credentials are still denied.

All earlier financial reducers, envelopes, SQL contracts and frozen v1/v2 history remain byte-identical to the starting checkpoint. The original 41-command fixed v2 history, command/result/state/event hashes and historical dispatch suppression remain covered. The earlier mechanical initial participant retains its original 36 cases and pause-only native fixture; the new generic participant reuses its narrow write set and adds safe read-only retries, bounded lifetime and complete post-write dependency checks.

## Native PostgreSQL verification

Runtime: **PostgreSQL 17.11**, **Node v24.22.1**, **npm 11.19.1**. Every database is an explicitly named disposable loopback simulation fixture. No application database URL or production credential is discovered from the environment.

| Native drill | Checks | Result |
| --- | ---: | --- |
| Concurrent wallet commands | 6 | Passed |
| Standalone recovery | 6 | Passed |
| Canonical/wallet transaction groundwork | 6 | Passed |
| Versioned v2 ledger | 9 | Passed |
| Authenticated amount-correction coordination | 16 | Passed |
| Combined correction-cohort recovery | 11 | Passed |
| Stored mobile authority and correction recovery | 12 | Passed |
| Initial canonical mechanics (original pause-only fixture) | 9 | Passed |
| Isolated seller-native v3 reservation/recovery | 11 | Passed |
| Authenticated initial canonical coordination | 15 | Passed |

The new drill passed **15 checks**. Its atomic source preserves a **500-USDT** funded listing, reserves **200 USDT**, and leaves **300 USDT** available. The request retains **3.10 ILS** and its **626.20-ILS buyer-inclusive quote**, while the public and wallet listings remain at **3.20 ILS**. The recorded actor is the stored seller and the buyer remains the original distinct request identity. No payout is created.

### Observed contention and authentication ordering

| Scenario | Observed result |
| --- | --- |
| READ COMMITTED evidence writer before activation | Actual row wait; activation made **2 attempts**, re-read committed evidence, and refused with `LOCKED`. No activation or reservation committed. |
| Stale ordinary SERIALIZABLE writer | **2 attempts**; activation physically invalidated its stale snapshot and the fresh attempt encountered the protected writer guard. |
| Stored web seller versus stored mobile seller | Distinct backends and actual advisory wait; waiting acceptance made **2 attempts**; **one reservation**, one canonical acceptance and one original receipt committed. |
| Seller suspension after initial snapshot | **2 attempts**; the fresh decision refused with `ACTOR`, even with a stale approved-seller role label. |
| Mobile logout after initial snapshot | **2 attempts**; the fresh decision refused with `WALLET_SESSION_REQUIRED`. |
| Logout behind an already-held seller session lock | Actual row wait on another backend; authorized acceptance committed first, then logout. The revoked mobile retry was denied; valid current web authority recovered the original receipt. |

Revocation is ordered by actual stored authentication locks. It is not a promise that a later logout retroactively cancels an earlier transaction that already holds valid authority. Expiry is checked after awaited work and after actual canonical persistence; no guarantee is made about the wall-clock arrival of a COMMIT acknowledgment.

Actual SQL failures at late financial, canonical/coordinated-receipt and publication stages roll back the entire decision. The native unknown-COMMIT check performs a real database COMMIT, then synthetically drops its reply. Inspection and current web/mobile retry recover the original receipt and event hash; this is not a physical network-partition test.

All three new native sources finish paused, and a fresh connection reopens the exact paused state. The new drill reports **0 provider submissions, 0 external messages and 0 production writes**. Canonical notification rows and publication intents are stored in the disposable database; no delivery service is invoked.

The complete BSC integration is separately covered in the wallet suite and PGlite smoke: `200000000000000000000` principal reserved, `300000000000000000000` available, `2000000000000000000` fee per party and the same 626.20-ILS quote. The new native three-database drill uses the TRON simulation asset; it does not claim native BSC/provider execution.

## Retained browser rehearsal

Chromium **149.0.7827.55** passed the existing English 1440px desktop and Arabic 390px mobile rehearsal. Arabic direction remains RTL with no horizontal overflow. This is the retained standalone wallet rehearsal, not an initial-acceptance product screen, real account login or native mobile application build.

## Recovery boundary and next work

**Portable combined recovery for the new initial-acceptance namespace is not implemented.** Existing isolated v3 and amount-correction cohort exporters reject it. Reopening the same persisted database and recovering its original receipts are persistence/retry checks, not a combined disaster-recovery drill. No resume operation is added.

The next milestone must preserve the complete new activation/canonical/financial/receipt/publication state in a distinct combined recovery format, quarantine credentials, validate both sides, arbitrate a fresh target, handle unknown COMMIT without overwrite, and retain source fencing before future authority re-entry. The existing `canonical-cohort-v1` format continues to mean its original v2 amount-correction cohort.

Later payment/cancellation/dispute/release/settlement behavior, broader identity-bound cohorts, actual web/mobile screens, deduplicated delivery, custody/provider/signing choices, production roles/operations and explicit launch authorization remain open [launch-readiness gates](launch-readiness.md). This milestone closes authenticated initial coordination in development; it does not establish live-launch readiness.

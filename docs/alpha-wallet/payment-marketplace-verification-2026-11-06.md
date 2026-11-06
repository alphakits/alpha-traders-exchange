# Alpha Wallet: payment claims, dispute holds and recovery

Date: 6 November 2026. Scope: private simulation development, with synthetic
identities, attachments, assets and funds. Live launch remains off.

**Exact-source verification passed:** 2,786 tests across 80 files, with zero failures or skips; all 2,217 predecessor wallet cases remain, with 382 new cases. Full repository TypeScript, the offline simulation, **18 native PostgreSQL drills / 212 checks** and the retained English desktop/Arabic mobile Chromium rehearsal passed. [CI run 42195918584](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42195918584), attempt 1, completed successfully at `2026-11-06T09:51:29Z`. These are development and simulation results; live launch remains off.

## Exact source and evidence

| Evidence | Verified value |
| --- | --- |
| Implementation commit | `621beaad00715ea81c7eb48b07a63c6137599314` |
| Implementation tree | `0d7c97bd2998b0a51d2dbe7b5d126fb926a8249f` |
| Development branch | `feature/alpha-wallet-dev-20261104` |
| CI run / job / attempt | [CI run 42195918584](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42195918584); job `127819018187`; attempt 1 |
| CI start / completion | `2026-11-06T09:33:12Z` / `2026-11-06T09:51:29Z` |
| Runtime | Node 24.22.1; PostgreSQL 17.11; Chromium 149.0.7827.55 |
| Downloaded evidence | Artifact `13492542282`; 2,113,009 bytes; 54 extracted files |
| ZIP SHA-256 | `e997ba0232e7856fe579b89c6015f817a514091b21a515e276ed41989296f456`; matches GitHub's reported digest |
| Decoded UTF-8 job-log SHA-256 | `c40080bb99e597f3ecdca1fee11691af0704b8e679cdc06c914daa0871179d88` |
| Retention baseline | Verified cancellation source `3122fdbf38f5149fa4f85c73e9fd82ad4d603d2e`; artifact `13461137044` downloaded and rechecked against every recorded file hash |

The [machine-readable report](payment-marketplace-verification-results.json)
records the complete test inventories, native drill outputs, source hashes,
downloaded artifact metadata and extracted file hashes. The verification applies
to the implementation commit above. A later documentation-only commit does not
change that implementation.

## What this milestone adds

The new private web and mobile coordinators connect a retained buyer's payment
claim and subsequent dispute to the exact original marketplace acceptance and
wallet reservation. They use current stored session/account/device authority,
locked canonical rows and one physical SERIALIZABLE transaction. There is no new
public route or screen in this milestone.

The supported action scope is one original accepted ordinary Bank Transfer or
Face-to-Face mapping. Wise, Cardless, demand matches, adjusted terms and competing
reservations are outside this profile. A previously cancelled predecessor can be
retained only as an archival state.

| Operation | Authority | Canonical result | Financial result |
| --- | --- | --- | --- |
| Explicit V4-to-V5 enrollment | Current stored owner | Original accepted or archived cancelled target retained | One source-bound continuation; inherited pause remains |
| Bank Transfer payment claim | Current retained buyer | `payment_sent`, one exact attachment, timeline, seller notice and audit | `payment_reported`; full principal remains reserved |
| Face-to-Face payment claim | Current retained buyer | `payment_sent`, no attachment, timeline, seller notice and audit | Same full-principal hold |
| Open dispute after that claim | Current retained buyer | One open dispute linked to the original claim; request stays `payment_sent` | Disputed flag; same reservation, no payout |
| Inspection, pause and paused export | Current stored owner | Bounded inspection or complete private recovery bundle | Verified state or an explicit pause |

Bank evidence accepts strict base64 for PNG, JPEG or PDF, with the existing file
signature check and an 8 MiB bound. The server derives the evidence identity,
neutral metadata, exact size and SHA-256 from the bytes. A dispute must retain the
original financial claim's payment timestamp, attachment timestamp, evidence
identity and content commitment. File signature validation does not establish
that money arrived or certify that an attachment is harmless.

**A buyer claim is not independent payment verification.** Neither claim nor
dispute populates independent `PaymentEvidence`, `evidenceOwners`, release
authorization, payout intent or commission settlement. In the ordinary TRON
fixture, both actions retain **300 USDT available on the listing and 200 USDT
reserved on the trade**. The eighteen-decimal BSC fixture preserves the equivalent
exact allocation. The new financial transfer amount is always `"0"`, and account
and journal contents remain unchanged.

Accepted prices, full principal, fees, payment method, parties and receiving
destination are derived from retained terms. Listing expiry does not itself
return held money. An otherwise valid accepted request may report payment after
listing expiry while the exact original reservation still exists.

## Explicit scope of the successor

The closed V5 envelope contains `continueFromV4`, `claimInitialPayment`,
`freezeInitialDispute` and `pause`. The coordinated profile is
`canonical-initial-payment-cohort-v1` in
`alpha_wallet_payment_marketplace_simulation`.

Enrollment requires both `acknowledgeVersionUpgrade: true` and
`acknowledgePaymentClaimOnlyProfile: true`. This development profile has **no new
cancellation operation**. Original V4 cohorts retain their cancellation contract
until enrollment; a previously cancelled source remains archival and cannot
reacquire reserved principal. A dispute requires this profile's exact buyer
claim. It grants no seller dispute, prepayment dispute, resolution, owner
override, verification or release authority.

The existing product lifecycle and earlier private profiles remain unchanged.
The new private claim/dispute profile has its own bounded notices and publication
intent; external notification delivery and production dispute handling remain
separate integration work.

## Atomicity, authorization and retry evidence

The current buyer is resolved before original receipt recovery, and authority is
checked again after persistence. Seller identity or an unrelated owner role
cannot substitute for that buyer. A disabled or revoked account cannot recover a
receipt with invalid credentials. The same currently valid buyer can recover an
original receipt across web and mobile, including after pause. Transport operation
IDs do not create a second business outcome; changed proof or reason cannot reuse
the original receipt.

SQL independently derives and checks the canonical request, physical trade,
listing, attachment, dispute, timeline, reminder archives, audits, notices and
safe publication. Omitted claim/dispute publications are rejected at deferred
commit even when the application coherence query is suppressed. Late failures
roll back the financial and canonical operation together.

Every nested participant retains the earliest physical transaction certificate.
Two coordinator regressions actually replace transaction A with B and verify that
the rejected attempt neither adopts nor aborts B. Independent review also found
and fixed a narrower storage-helper handoff: its first probe now retains an
earlier fresh-target certificate. A focused certificate-substitution regression
covers that internal edge.

The independent review additionally found a SQL/JavaScript dispute-reason parity
gap. The payment-only SQL predicate now matches the existing application policy
for Unicode whitespace, NFKC contact detection, ASCII case/word semantics and the
500 UTF-16-unit limit. Eighty-four focused parity cases exercise that contract.

Public receipts, inspection and publication omit attachment bytes, filenames,
private dispute reasons, credentials, bank details and receiving destinations.
The safe publication record is an intent; this milestone sends no external
message.

## Frozen history and complete recovery

Before V5 implementation, an independent capture checked 101 transitive source,
schema and manifest files against saved predecessor `26ac3132`. It captured
accepted and cancelled V4 histories, states and separate paused backups. Both
retain the older uncertain 25 USDT withdrawal with one original dispatch. The
capture refuses existing output or changed pinned source; expectations were not
regenerated for the new engine. V5 validates its suffix and reconstructs the exact
old state using unchanged V4 invariants. Historical dispatch retries still return
`shouldDispatch: false`.

The new combined format retains all five financial histories, four continuations,
both predecessor coordination namespaces, new immutable receipts/publications and
the exact private canonical evidence bytes. Full private account dependency reads
are not embedded. Old backup formats retain their original meanings and reject
the new coordinated scope.

Export requires a current owner and a paused source. Fresh-target restore replays
the original records, appends exactly one quarantine pause, installs both
predecessors and the new profile, restores disabled identity stubs, excludes usable
sessions and mobile authentication relations, and seals the result. Its fresh
target fence also serializes with the retained standalone restore fence.

Same-target inspection confirms a matching completed restore after an uncertain
COMMIT reply without running restore again. Missing, incomplete or mismatched
receipt evidence remains unresolved; it never proves rollback or authorizes an
overwrite. A restored copy does not grant credentials, reenrollment, source
leadership, signing or resume. Checksums establish consistency, not source
authenticity.

## Verification results

| Suite | Passing cases | Files |
| --- | ---: | ---: |
| Wallet and local persistence | 2,599 | 71 |
| Retained platform authentication | 87 | 5 |
| Retained marketplace and storage regressions | 100 | 4 |
| **Total** | **2,786** | **80** |

All 2,217 previous wallet cases, 87 authentication cases and 100 marketplace/storage cases passed again. Retention was checked as an exact multiset of repository-relative file paths and full test names from both downloaded raw CI reports, so a matching total cannot hide a removed case. The 382 new cases comprise 145 financial V5 cases, 91 canonical/authentication cases, 23 coordinator/physical-transaction cases, 39 combined recovery cases and 84 SQL/JavaScript reason-parity cases.

The full repository TypeScript command passed with an empty error log. All 75 recorded frozen contracts remain byte-exact. The original standalone browser rehearsal again passed at 1440-pixel English desktop and 390-pixel Arabic RTL mobile widths, with no reported console errors or horizontal overflow. It does not exercise a new public payment route or native mobile build.

| Native PostgreSQL scope | Drills | Checks |
| --- | ---: | ---: |
| All retained predecessor scopes | 15 | 166 |
| V5 financial claims, holds and isolated recovery | 1 | 13 |
| Authenticated canonical claims/disputes and writer races | 1 | 15 |
| Complete private-evidence recovery and quarantine | 1 | 18 |
| **Total** | **18** | **212** |

Every predecessor drill retained its complete ordered check inventory. Seventeen native stderr logs were empty.
The coordinator drill emitted one 289-byte `pg` deprecation warning: its three lock-observer reads queue on one
standalone observer connection. That connection is outside the wallet transactions, which use separate clients;
all measured backend, lock-wait, retry and single-claim assertions passed. The exact warning is retained in the
machine report. Serializing those observer reads is a test-harness compatibility cleanup before a future `pg@9`
upgrade; the verified source remains unchanged.

The new recovery drill includes eight real SQL rollback stages, exact attachment recovery, disabled identities,
source/target pause preservation, committed-response loss and visibly competing fresh-target restores.

The native drills observe distinct PostgreSQL backends and actual lock waits.
They include competing same-proof and changed-proof claims, a legacy writer,
prior buyer revocation, direct SQL boundary checks, late rollback and competing
fresh restores. Response loss is injected **after actual COMMIT**; it is not a
physical network-partition test. Reopening a connection is not a process restart
or a production failover exercise.

## Readiness and next work

Trust Wallet remains the selected receiving interface. No real address, wallet
key, provider account or chain-connected signer is configured by this milestone.

The next lifecycle work must establish trusted fiat/cash verification, actual
seller release authorization, dispute resolution and complete unpaid
cancellation behavior in a later explicit contract. Product routes, web/native
screens and deduplicated external delivery need those complete private contracts.
Exact network/token/address configuration, signer/testnet recovery, production SQL
roles, step-up limits, source fencing, authenticated/encrypted backups, monitoring,
load exercises and independent security review remain launch gates. No production
build, deployment, migration, real signature or real transfer is implied by this
development verification.

See the [payment contract](payment-marketplace-coordinator-design.md),
[recovery runbook](recovery-runbook.md), [launch gates](launch-readiness.md) and
[active handoff](development-checkpoint-2026-11-05.md).

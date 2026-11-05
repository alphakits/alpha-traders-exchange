# Authenticated initial marketplace acceptance

Date: 5 November 2026 (Asia/Jerusalem).

**Implemented development scope: stored seller authority, explicit owner activation, and one atomic initial canonical acceptance with its seller-native v3 reservation, original receipt and safe publication intent.** All accounts, sessions, database contents and assets in verification are synthetic. No production migration, public route, account signup, provider submission, signing operation or external delivery is installed by this work.

This is a separate initial-acceptance cohort. The [existing amount-correction coordinator](marketplace-coordinator-design.md), its activation namespace and its combined recovery format retain their original contracts. The [v3 financial engine](ledger-v3-initial-acceptance-design.md) and historical v1/v2 reducers, schemas and frozen history remain unchanged.

## Private API and explicit activation

[`initial-marketplace-coordinator.ts`](../../src/lib/alpha-wallet/initial-marketplace-coordinator.ts) exports separate web and mobile constructors. Each selects one strict credential shape. There is no caller-provided actor, role, authorization callback, accepted flag, price, amount, financial descriptor or wallet snapshot.

| Operation | Required current account authority | Effect |
| --- | --- | --- |
| `activateRequest` | Stored authenticated owner | Binds one exact pending canonical request to explicit platform/wallet identities and its verified v3 checkpoint; freezes the supported listing cohort. |
| `acceptRequest` | Stored authenticated seller with current selling access, matching the request's seller ID | Commits the full-principal reservation and canonical acceptance once. A valid retry returns the original receipt. |
| `inspect` | Stored authenticated owner | Returns a limited canonical/wallet status and safe original receipts. |
| `pause` | Stored authenticated owner | Appends the closed v3 operator pause. It does not resume or complete a trade. |

The separate storage initializer requires explicit simulation acknowledgment, an already verified unpaused v3 wallet without standalone initial bindings/receipts, no unfinished payouts, and a fresh coordination namespace. It does not initialize the financial ledger or activate a request automatically. The coordinator never performs schema initialization or version upgrades. From initialization onward, even head-based v3 snapshot reads require a registered coordination context; ordinary standalone tools are not an alternative inspection path.

The first cohort has one owner-selected request, one mapped wallet listing and one unused wallet trade identity. Platform request, platform trade, platform listing, wallet trade and wallet listing identities remain distinct. A platform trade ID is not accepted as a request alias.

Owner activation verifies the retained plain pending request, clean target history, open approved listing, same-seller asset mapping and complete funding. It captures exact canonical request/listing/optional pending-trade/sibling rows and the original wallet checkpoint. It moves no funds and records no seller consent. Face-to-Face acceptance still requires the seller's explicit acknowledgment in the subsequent authenticated action.

The coordinator supports the existing narrow v3 cohort: ordinary listing-price requests with current ILS policy, complete retained Bank Transfer instructions or Face-to-Face consent, original buyer submission and preallocated trade identity. Offers, negotiations, demand matches, Wise/ATM credentials, prior progress and competing target-listing reservations remain outside this cohort. Activation does not broaden the financial engine's supported lifecycle.

## Stored seller authority

The fixed [web](../../src/lib/alpha-wallet/marketplace-auth.ts) and [mobile](../../src/lib/alpha-wallet/marketplace-mobile-auth.ts) readers now expose an additive `canSell` capability. They retain their existing `canBuy` and `isOwner` meanings. The [shared account policy](../../src/lib/alpha-wallet/marketplace-account-authority.ts) derives selling access from the existing `hasSellerOperationalAccess` helper: an approved stored seller status, or the established stored admin/owner role policy. A stale `approved_seller` role label cannot override a pending, rejected, suspended or buyer seller status. No new approval-certificate rule is invented.

Both transports still validate the actual stored credential, canonical scalar/payload identity, current account state, email/phone/adult prerequisites and exact expiry. Mobile additionally binds the stored session to its device, current access token, platform and metadata. A denied mobile credential cannot fall back to web authentication. A seller does not need to have the buyer capability to accept the buyer's request.

Request/global/runtime/listing fences precede authentication. Session/device/account `FOR SHARE` locks precede the wallet head. The fixed principal rechecks the same physical transaction, current authority, device/session binding, monotonic clock and expiry after awaited work and again after canonical persistence and coherence checks. This also applies to receipt recovery. A revoked or expired seller cannot use an old receipt as an authentication bypass.

Concurrent revocation is ordered by these locks. A transaction that obtained its valid authentication locks first may complete before a waiting revocation. A revocation that wins first must cause a fresh complete decision to refuse the action. The checks bind authorization at their explicit checkpoints; they do not claim that the database COMMIT reply must arrive before the expiry timestamp.

Failure cleanup checks the certified raw physical transaction ID independently of runtime checks. A swallowed runtime or semantic refusal therefore cannot leave earlier writes committable when a caller restores the environment. An unknown or replaced transaction is never poisoned.

## Complete canonical decision in one transaction

The new `withDevelopmentInitialAcceptanceInTransaction` participant in [the canonical repository](../../src/lib/alpha-exchange-repository.ts) reuses the original narrow persistence helper while adding a read-only path for activation, inspection and original receipt recovery. The older mechanical participant retains its original behavior and test cases.

The reader obtains all seller inventory, buyer history across sellers, both participants' seller commissions, enforcement, embedded review obligations, target evidence/disputes and physical trade identity candidates. Both normalized and payload links select candidate rows, so inconsistent aliases cannot hide a blocking record. Scalar identity, timestamps, ordering and lossless JSON are validated before the decision basis is exposed. SQL reviews are embedded in request payloads; the legacy in-memory review collection is explicitly empty, with no invented physical review table.

For a new acceptance, the coordinator:

1. Locks the complete canonical decision basis and authenticates the exact stored seller.
2. Registers one opaque same-transaction context and retrieves the explicit activation.
3. Verifies complete v3 history and projections, then checks for the original coordinated business receipt.
4. Plans from the complete current canonical facts, explicit mapping, exact wallet checkpoint and trusted acceptance clock.
5. Binds and executes the seller-native v3 command under the real seller actor.
6. Rechecks the canonical basis and persists only the pending-to-accepted request, physical trade, listing lock, canonical notification and audit event.
7. Appends the immutable coordinated receipt and publication intent, checks complete poststate and current authentication, then returns to the only transaction owner for COMMIT.

The participant permits at most one acceptance, copies the decision before awaiting, and rejects an unawaited or escaped acceptance call. It compares all eligibility/inventory dependencies again after persistence and callback completion. Only the exact accepted request/listing/trade changes are allowed; unrelated rows and canonical ordering remain exact. Any participant failure aborts the same certified transaction even if caught by its caller.

The `WalletStore` owner alone controls BEGIN, retry and COMMIT. A serialization failure or deadlock retries the entire canonical/authentication/planning/wallet decision. Attempt-local principals, plans and results never survive into a later attempt.

## Financial effect and policy preservation

The reservation uses the buyer's retained request price. A later public or wallet listing price does not reprice the request. For the standard fixture, the public and funded wallet listing remain at 3.20 ILS, while the original request remains at 3.10 ILS: 200 USDT principal with a 626.20-ILS buyer-inclusive quote. Acceptance transfers the whole 200 USDT from the 500-USDT funded listing into the trade, leaving 300 USDT available. Fee quotes do not reduce principal or create settlement/payout activity.

The initial bindings and financial receipt identify the seller action separately from the retained buyer request. No buyer actor is manufactured. The v3 financial command, balanced journal, immutable binding/receipt, canonical accepted state and coordinated receipt/publication must agree on the same original identities and checkpoint.

General marketplace rules remain intact. Two existing canonical seller commitments on other listings can precede the proposed third trade; three already-active commitments refuse a fourth. Target-buyer active history/reviews across other sellers, bilateral blocks, seller availability/visibility, enforcement and both participants' unpaid seller commissions are rechecked. Unrelated marketplace records remain writable; the cohort does not impose a new platform-wide one-trade limit.

The supported wallet cohort remains deliberately narrower: competing reservations on the activated listing and unpaired active seller wallet trades need complete bidirectional identity bindings before expansion. Equal aggregate balances are insufficient evidence of request/buyer/trade identity.

## SQL guards and stale writers

The new `alpha_wallet_initial_marketplace_simulation` namespace contains transaction contexts, activations, acceptances and publications. Its [preflight](initial-marketplace-schema.sql), [tables](initial-marketplace-tables.sql) and [guards](initial-marketplace-guards.sql) are development files, not registered application migrations. An existing `alpha_wallet_marketplace_simulation` namespace, even empty, prevents initialization and coordinated execution.

The SQL layer requires the exact registered command and same-transaction financial result. It independently derives the permitted canonical poststate from the immutable activation basis and original financial command. It protects the complete selected listing, sibling requests, related lifecycle/evidence/commission writes, physical trade and deterministic events. Unsupported standalone wallet tools cannot mutate the coordinated v3 wallet. Activation, acceptance and publication records are immutable; deferred checks tie together the final state and run again on late writes after an earlier constraint check.

Activation physically versions the listing, sibling requests and canonical runtime row. Development-only statement fences also version the runtime before canonical dependency writes, including permitted account and outside-listing changes. This orders legacy READ COMMITTED writers and stale SERIALIZABLE snapshots against the complete decision. It conservatively serializes this disposable database rather than changing marketplace eligibility rules. Session/device revocation remains governed by the original stored-authentication locks.

Participant account identities cannot be deleted or reassigned while the cohort is activated, which could otherwise strand inspection and pause. Consistent role, status, verification and disabled-state changes remain possible. The runtime singleton cannot be removed, reassigned or regressed. Destructive bulk truncation is outside this development contract.

Row-level security and revoked client grants remain additional storage protections. Protocol settings and registered transaction rows are compatibility/integrity checks, not authentication proofs or defenses against a database superuser. Production database roles and independent review remain open launch gates.

## Retries, unknown COMMIT and privacy

The business acceptance is stable for the original request and seller. A new transport operation ID, including a switch between valid stored web and mobile credentials, recovers the same original financial receipt, event hash and publication ID. The coordinator checks fresh authority and immutable public-input identity before considering current pause or acceptance status. Changed relevant consent or mapping cannot produce a second effect. Bank Transfer rejects an irrelevant cash-meeting acknowledgment rather than recording a public fingerprint that disagrees with the financial receipt.

A missing COMMIT reply is an unknown outcome. Inspect the same target and retry the original business operation with valid current credentials. Do not infer that the transaction failed, submit a replacement financial operation or overwrite state. A successful reply-loss recovery returns the original receipt; it does not append another command, reservation, event or publication.

Public receipt/inspection objects project only selected identities, quotes, principal, status, checkpoint and receipt/publication references. They omit raw credentials, token hashes, device records, canonical account/request payloads, bank instructions, recipient destinations and private activation evidence. Driver errors and causes are sanitized after outer transaction retry handling. The publication contains deterministic safe delivery facts; no sender/dispatcher is installed or invoked.

## Recovery and remaining work

The separate [initial marketplace recovery contract](initial-marketplace-recovery-design.md) is now implemented for one explicitly activated, paused source, either before seller acceptance or after its original coordinated acceptance. `exportInitialMarketplaceWalletBackup` and `exportMobileInitialMarketplaceWalletBackup` use actual current stored owner authority and produce `alpha-wallet-initial-marketplace-simulation-backup`, format version `1`, schema `canonical-initial-cohort-v1`. The nested wallet scope is `initial-marketplace-v3-ledger`. The isolated v3 exporter and older v2 amount-correction combined format keep their existing contracts and continue to refuse this namespace. An initialized-but-unactivated namespace and the older pause-only mechanics fixture remain outside the new format.

The unit retains complete original v1/v2/v3 command history, both continuations, the original activation checkpoint/basis, initial financial binding/receipt, supported canonical rows, exact coordinated receipt and deterministic events/publication. Physical timestamps preserve UTC microseconds; immutable basis JSON retains its exact PostgreSQL UTC representation. Binary evidence, bigint versions, JSON precision and original row ordering are checked and preserved. The source must already use a supported UTC activation basis; evidence is never rewritten to fit recovery.

`restoreInitialMarketplaceWalletBackup` requires the actual validated bytes, a separately retained checksum and an explicitly fresh target. One SERIALIZABLE transaction replays original history, adds exactly one new durable pause, installs the canonical/initial rows and guards, creates disabled credential-free identities and completes the immutable recovery receipt. No sessions or mobile authentication tables are restored. The original source's financial state stays unchanged and paused. The target is sealed for offline `inspectRestoredInitialMarketplaceWallet`; unknown COMMIT is resolved by inspecting that same target, without overwriting it or creating another financial effect.

The recovery implementation remains bounded to whole-history capture/replay and its fixed size limits. It checks exact canonical and initial-coordination table/column shapes, while the wallet uses its existing history/projection verification rather than an inventory of every arbitrary object under its namespace. Row and deferred guards do not provide a hostile-superuser guarantee against arbitrary DDL after all deferred events have been flushed. No account-authority re-entry, cross-instance source lease or resume is supplied. Keep the source fenced and both copies paused. The addition passed [exact-source verification at `2c3e6a0b`](initial-marketplace-recovery-verification-2026-11-05.md); the recorded coordinator evidence below predates it.

Subsequent proposal/payment/cancel/dispute/release/settlement participants, broader identity-bound cohorts, actual website/mobile screens, deduplicated external delivery, custody/provider/signing integration, operational roles/recovery and explicit launch authorization remain separate [launch-readiness gates](launch-readiness.md). A passing synthetic integration does not authorize live use.

## Verification

The exact application source `c11fe0e90dc96fad8e0b21901cd9093e9c2dc536` (tree `de86817fb494d57b71c900d751ce3d2659824afa`) passed [CI run 42059622746](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42059622746). The [verification report](initial-marketplace-verification-2026-11-05.md) and [machine-readable evidence](initial-marketplace-verification-results.json) bind that source to **1,779 passing tests across 52 files**, **10 native PostgreSQL drills / 101 checks**, and the retained English/Arabic Chromium rehearsal. All 1,439 prior wallet cases remain present; this milestone adds 153. The complete local wallet run matches CI at 1,592 cases across 43 files. TypeScript and changed-TypeScript lint passed within their documented scope.

The new [native PostgreSQL drill](../../scripts/alpha-wallet/postgres-initial-marketplace.ts) passed 15 checks across three explicitly named fresh loopback databases. It observed real row/advisory waits and complete retries for canonical evidence writers, stale snapshots, competing seller transports, seller suspension and mobile logout. Actual late SQL failures rolled back the complete decision; reply loss injected after a real COMMIT recovered one original receipt. All three sources ended paused, with zero provider submissions, external messages or production writes.

The downloaded CI archive matched its provider size and SHA-256, and all 38 allowlisted files were rechecked by size/hash. The browser gate remains the existing standalone wallet rehearsal; the BSC acceptance smoke remains PGlite coverage. Neither extends the native TRON coordinator drill into a production/provider claim. These are historical results for the recorded coordinator source. The subsequent initial combined recovery implementation and its separate native recovery drill passed their own [exact-source verification at `2c3e6a0b`](initial-marketplace-recovery-verification-2026-11-05.md).

# Alpha Wallet development checkpoint

Updated: **6 November 2026, Asia/Jerusalem** (verification completed 5 November at 22:12:41 UTC).

**Development continues. Live launch remains off.** The isolated V4 cancellation engine, its SQL/storage/recovery contract, and separate canonical cancellation groundwork are implemented and saved. Their exact-source CI gate passed: **2,232 tests across 63 files**, zero failures/skips; **13 native PostgreSQL drills / 139 checks**, root TypeScript, offline demo and retained English/Arabic Chromium rehearsal. See the [verification report](prepayment-cancellation-verification-2026-11-06.md) and [machine-readable evidence](prepayment-cancellation-verification-results.json).

## Authorization and exact source

The user authorized continued implementation, isolated testing and saving the wallet development branch, and selected Trust Wallet as the preferred receiving interface. Routine engineering choices do not require another technical questionnaire. This does not authorize a main merge, production migration/deployment, mainnet funding/signing, real transfers or external messages. The `PAUSED-*` documents are historical; they do not instruct development to wait.

Branch: `feature/alpha-wallet-dev-20261104` in `alphakits/alpha-traders-exchange`.

| Evidence | Source and status |
| --- | --- |
| Current saved implementation | `73970284b87fdce6d1daf97b6b3ebefa757825f3`; tree `b9534db09463b6050dee5d758bac62e565501c69` |
| Current exact-source gate | **Passed**, first attempt — [run 42117518227](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42117518227), job `127561004161`, completed `2026-11-05T22:12:41Z`. 2,045 wallet cases in 54 files, 87 auth cases in five files, 100 marketplace cases in four files; all 1,726 previous wallet cases retained plus 319 new. Artifact `13458170698`, ZIP SHA-256 `b7547810fdd01d8dc7bc856482543e51d61a67bf1ec1847e481fd08e644b6b33`, verified against GitHub. |
| Historical verified baseline | `2c3e6a0b809f9bb34f84dcc82243593ba079ee1f`; tree `bcafe92cea246f709987643d6213b2347ed73e41`. **1,913 tests across 56 files**, zero failures/skips; **eleven native PostgreSQL drills / 117 checks**, root TypeScript, offline demo and retained English/Arabic Chromium rehearsal passed. [Report](initial-marketplace-recovery-verification-2026-11-05.md) · [Machine-readable evidence](initial-marketplace-recovery-verification-results.json) |

The downloaded exact-source artifact contains 44 files. The report retains each file digest, all native results, test-file counts and case-inventory hashes. Historical reports remain evidence for their own commits; later documentation commits do not change the verified implementation.

## What is now implemented

- **Frozen original history.** V3 evidence was captured once from `2c3e6a0b…`, with 75 original source/schema/manifest guards. It retains an unpaused acceptance prefix and a distinct paused backup. Original V1/V2/V3 reducers, migration contracts, receipts and fixture bytes remain unchanged.
- **Isolated V4 cancellation.** The closed envelope permits `continueFromV3`, `cancelInitialTrade` and `pause`. One original acceptance has one cancellation business identity and immutable receipt. Cancellation returns the full reserved principal to its original listing, preserving asset, parties and terms. The fixture moves listing/trade balances from 300/200 to 500/0; it creates no payout, withdrawal or commission. A paused source stays paused; there is no resume command.
- **V4 durability and isolated recovery.** Explicit migration, SQL writer checks, projection/replay validation and storage commit together. Format-4 backup retains all four command versions and three continuations. It requires a paused isolated source and a fresh target, replays original APIs and appends quarantine atomically. Unknown submission identity and historical dispatch suppression survive recovery. Old formats continue refusing V4.
- **Canonical cancellation groundwork.** A pure planner and transaction participant implement bounded initial-style Bank Transfer/F2F cancellation at unchanged listing-price terms and the current fee policy on the supported simulated assets: exact accepted request/trade/listing linkage, current progress/evidence/dispute checks and nine contradictory payment/settlement/evidence history markers, buyer bank-disclosure restriction, unexpired listing, and no competing reservation. They preserve terms, withdraw pending proposals, archive relevant reminders, append cancellation/audit/notification records and retain trust intent. The native companion is explicitly a synthetic wallet pause; this is not an authenticated principal-return coordinator.

The [prepayment cancellation design](prepayment-cancellation-design.md) defines these scopes. Review fixes include dispute-alias rejection, contradictory retained-history refusal, exact timestamp checks, input capture and same-transaction cleanup, and caught backup-preflight failures. The clean CI checkout verified the saved source containing those fixes. The canonical native companion commits one synthetic pause and zero principal returns; financial receipt recovery is verified only in the separate isolated V4 drill.

## Frozen integration boundary

The existing amount-correction and initial-acceptance coordination profiles and combined recovery formats retain their original meanings. The initial profile still supports owner activation/inspection/pause and seller acceptance. **It does not support cancellation.** Both the new canonical participant and standalone V4 writer refuse existing coordinated namespaces.

Do not drop those guards, relabel old backup scopes, reinterpret an original receipt, or invoke an old reducer on a reconstructed state to obtain new authority. A canonical `cancelled` status alone never proves a wallet principal return. Development verification is not production readiness.

## Exact next implementation: authenticated cancellation successor

Keep the next slice to **the existing single mapped initial trade**. The financial reducer and canonical mechanics are available; the remaining work is their explicit integration and complete recovery:

1. **Define the successor profile and transition.** Specify its namespace/version, exact predecessor checkpoint and activation basis, supported pre/post-cancellation states, and migration ownership. Introduce reviewed successor SQL fences without weakening the frozen predecessor contract. Older writers and recovery formats must fail closed on successor state.
2. **Add the authenticated coordinator.** Resolve current stored web or mobile credentials, active account/device/session validity and the actual buyer/seller relationship in the same certified SERIALIZABLE transaction. Use cancellation-specific authority; new-sale `canSell`/`canBuy` eligibility is not a substitute. Derive decisions from locked canonical rows and the exact original wallet binding/acceptance receipt, then recheck authority after awaited work.
3. **Commit one complete cancellation.** Couple canonical effects, V4 principal return, immutable cross-system receipt and safe deduplicated publication intent in one transaction. Preserve all original acceptance evidence. A retry must recover the original receipt under current valid authority, including after pause; a changed input, revoked credential or manually cancelled row cannot create fresh monetary authority.
4. **Fence competing writers.** Order cancellation against payment claims, embedded/stored evidence, bank disclosure, disputes, listing expiry, revocation and another cancellation. Cover direct normalized-table writes and mapping integrity, not only the coordinator's API. Keep expired-listing handling outside this bounded policy until a separate inventory contract is implemented.
5. **Implement successor combined recovery before declaring integration complete.** Preserve the activation basis, complete V1–V4 financial history, canonical rows, original acceptance and cancellation receipts, deterministic events and publication together. Support paused-source owner export through current web/mobile authority, fresh atomic paused restore with credential quarantine, and same-target inspection after uncertain COMMIT. Existing combined formats stay distinct; successful restore grants no resume or second active copy.
6. **Prove the complete slice.** Retain the full historical case inventory. Add authenticated retry/revocation, late-failure rollback, native multi-backend writer races, unknown-COMMIT inspection and successor restore tests for accepted and cancelled source states. Bind the final report to the exact commit/tree and original artifacts.

Primary implementation points: `v4-commands.ts`, `v4-engine.ts`, `v4-durable.ts`, `v4-backup.ts`, `prepayment-cancellation.ts`, the repository's cancellation participant, and the existing initial coordinator/authentication/recovery patterns. Do not wire a public route before the successor's transaction, receipt, SQL and recovery contract is complete.

Afterward, buyer payment claims, dispute freezes, release and settlement need their own explicit participants. Competing reservations require complete bidirectional canonical/wallet identity coverage; matching totals alone cannot prove request, buyer, asset, destination or quote identity.

## Receiving direction and remaining launch gates

**Trust Wallet is selected as the preferred receiving interface.** No actual receiving address, wallet key, payout signer or chain-connected signer/testnet environment has been created or connected. TWAK is a candidate automation component; its escrow send-once/recovery suitability remains unverified. Continue read-only observation and deterministic accounting work independently of signing. See the [custody decision](custody-decision.md) and [chain adapter contract](chain-adapter-contract.md).

Live readiness still requires the integrated lifecycle and actual web/mobile boundary; trusted bank/cash verification and exception policy; exact real network/token/address configuration; isolated signer policies and testnet recovery drills; step-up, spend limits and deduplicated delivery; production SQL roles/migrations; authenticated encrypted retention, source fencing, external reconciliation and controlled authority re-entry; monitoring, realistic load/checkpoints and independent security review. The [launch-readiness checklist](launch-readiness.md) remains the gate record. Complete the concrete release and its evidence before requesting launch authorization.

## Reproduction limits

Use Node `24.22.1`, locked dependencies and disposable PostgreSQL 17 databases with fixed UTC sessions. Preserve every old fixture and profile. Branch auto-deployment remains disabled. Browser evidence covers the synthetic English desktop/Arabic mobile Chromium rehearsal; root TypeScript excludes the native mobile workspace and three pre-existing test paths. No production build, native mobile build, real chain operation or independent audit is implied by this development gate.

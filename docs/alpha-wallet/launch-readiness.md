# Alpha Wallet launch readiness

Date: 5 November 2026 (Asia/Jerusalem). Decision: **not ready to accept live funds or deploy**.

**Development paused at the user's request on 5 November 2026.** The [current saved checkpoint](PAUSED-2026-11-05.md) records the completed verification and next development step. Wait for the user to explicitly say to continue; the approximate one-to-two-hour break is not an automatic restart. Any later development resumption does not authorize a live launch. The [earlier checkpoint](PAUSED-2026-11-04.md) remains historical.

The user authorized continued development, isolated testing and saving the wallet development branch. Live launch remains withheld. A passing development suite does not change that instruction.

**Latest verified source: `c11fe0e90dc96fad8e0b21901cd9093e9c2dc536`.** The [initial-coordinator verification report](initial-marketplace-verification-2026-11-05.md) records **1,779 passing tests across 52 files, with zero failures or skips**: 1,592 wallet tests across 43 files, 87 platform authentication tests across five files and 100 marketplace/storage regressions across four files. All 1,439 prior wallet cases are retained, with 153 new cases. Root TypeScript, ten native PostgreSQL drills/**101 checks** including 15 new initial-coordinator checks, and the retained English/Arabic Chromium rehearsal passed on this exact source. CI completed successfully on 5 November 2026 at 18:02:39 IST; the [machine-readable evidence](initial-marketplace-verification-results.json) binds the source/tree, run/job and verified artifact hashes.

The [authenticated initial coordinator](initial-marketplace-coordinator-design.md) now couples current stored web/mobile seller authority and explicit owner activation to one atomic full-principal reservation, canonical acceptance, original receipt and safe publication intent. All three new native fixture sources finish paused. **Combined backup/restore for this initial cohort remains UNIMPLEMENTED.** Same-database reopen and receipt recovery do not provide a portable restore. Live launch remains withheld.

The [historical seller-native v3 baseline at `f18e95e6`](ledger-v3-verification-2026-11-05.md) records 1,626 passing tests, including 1,439 wallet tests across 39 files, plus root TypeScript, nine native PostgreSQL drills/86 checks and the retained English/Arabic Chromium rehearsal. It verifies the separate financial engine and isolated paused-wallet recovery; the later initial coordinator has its own evidence above.

The [historical recovery baseline at `09405da`](marketplace-recovery-verification-2026-11-05.md) retains 1,081 tests and six native drills/54 checks, including 83 recovery cases and 11 native recovery checks.

**Private mobile authority.** Both private cohorts accept current stored mobile access/device credentials in the financial transaction. Only the original amount-correction cohort supports mobile owner export of the unchanged combined recovery format; its restored targets omit both mobile authentication tables. The [mobile authority contract](marketplace-mobile-auth-design.md) distinguishes the current initial-seller extension from the [historical mobile verification](marketplace-mobile-verification-2026-11-05.md).

**Initial acceptance integration.** The [pure plan and canonical participant](initial-acceptance-design.md), frozen v2 history and [seller-native v3 financial contract](ledger-v3-initial-acceptance-design.md) retain their original scopes. The new [authenticated initial coordinator](initial-marketplace-coordinator-design.md) now adds same-transaction stored seller authority, explicit owner activation, canonical/wallet acceptance, original receipt/publication and SQL writer fences. Its combined recovery format remains UNIMPLEMENTED. Competing reservations still need complete canonical/wallet identity bindings before entering the supported financial cohort.

## Accepted behavior

- Full listing principal is required: a 500 USDT listing needs 500 USDT. Commission short-payment tolerance never reduces principal funding or delivery.
- Owner approval remains separate from funding. A deposit cannot bypass listing review.
- Partial reservations conserve inventory, with at most three active trades for a seller. The amount-correction coordinator's one-active-trade cohort and the initial coordinator's one selected mapping are separate development restrictions; neither changes that general policy.
- The buyer receives the full principal. The 1% buyer fee in fiat and the seller's combined 2% USDT commission remain separate.
- A buyer's paid claim is not release authority. Trusted independent payment evidence and seller authorization are both required.
- A payout timeout keeps funds reserved and preserves the original provider identity. A missing lookup does not permit a replacement send.
- Standalone wallet restoration starts paused because external transfers may have continued after its checkpoint. The v2 amount-correction cohort has a separate combined format from a paused source, with a paused credential-free target. The new initial cohort has no supported combined format: all existing exports/restores fail closed, and its complete source must be preserved. Same-database receipt recovery is not disaster recovery.

These rules are executable in the isolated development model. Two separate private coordinators couple actual canonical SQL and stored authentication to one existing amount-correction proposal or one ordinary initial seller acceptance. Their development scopes do not connect production marketplace behavior, remaining lifecycle transitions or public web/mobile interfaces. Those integrations must preserve consent, eligibility, reviews and completion rules.

## Current private amount-correction cohort

An owner can explicitly enroll, inspect and pause one already accepted canonical request with a clean existing wallet reservation and a valid pending `amount_correction` proposal. This correction cohort supports current ILS fee policies, Bank Transfer and Face-to-Face. It requires the only active canonical reservation on its listing, the only nonterminal wallet trade globally and no unfinished payout.

Buyer acceptance resolves the actual web or mobile session/account rows through the corresponding fixed reader inside the same `SERIALIZABLE` transaction as canonical reads, wallet replay and writes. The mobile reader also binds the token to its stored device/platform and enforces the current minimum app version. Fresh ownership/eligibility checks precede historical receipt lookup, and authority/expiry are rechecked after persistence. Both transports share the unchanged acceptance identity: a current valid session can recover the original receipt, including after pause, while revoked credentials are denied. Canonical terms, the principal adjustment, immutable receipt, deterministic system message/notification/audit and safe publication intent commit together. SQL guards fence unsupported enrolled-listing writers and standalone wallet access after activation.

This cohort has no public web/mobile route, account/trade screen integration, notification/realtime delivery, provider or signer. It cannot create a new proposal, perform initial trade acceptance, cancel, handle payment/dispute/release/settlement transitions or resume after pause. Owner `inspect` and `pause` remain supported through either private credential entry point. A current web or mobile owner can export the complete supported recovery unit after pausing the source. Fresh-target restore and offline same-target inspection preserve the financial records, add a new pause and exclude usable credentials; neither mobile authentication table is restored. Existing wallet-only formats still cannot recover an activated cohort; account-authority re-entry and resume remain unimplemented. The [coordinator design](marketplace-coordinator-design.md), [mobile authority contract](marketplace-mobile-auth-design.md), [combined recovery contract](marketplace-recovery-design.md) and [recovery runbook](recovery-runbook.md) define these boundaries.

## Current private initial-acceptance cohort

A current stored owner activates one clean ordinary pending request with distinct platform request/trade/listing and wallet trade/listing identities, the supported asset, full funding and a verified v3 checkpoint. Activation freezes the exact supported canonical listing/sibling basis; it does not accept the request or supply seller consent.

The actual stored seller must have current `canSell` and match the request's seller ID. Web/mobile authentication, complete canonical eligibility reads, verified wallet replay, seller-native full-principal reservation, canonical acceptance and immutable receipt/publication share one SERIALIZABLE transaction. Fresh authority is required for original receipt recovery across transports, including after pause. Statement fences order legacy canonical dependency writers, while exact cohort guards refuse unsupported target-listing and standalone financial changes. The general three-active-trade policy and both participants' commission/review obligations remain unchanged.

**Combined initial-cohort backup/restore is UNIMPLEMENTED.** The old isolated and v2 correction formats reject the new namespace. Owner inspection/pause and same-database receipt recovery preserve the current source; they do not provide a portable restore, source leadership or resume. Broader identity-bound reservations, subsequent proposals/payment/cancellation/dispute/release/settlement, product routes/screens and external delivery remain open. See the [initial coordinator contract](initial-marketplace-coordinator-design.md), [verification report](initial-marketplace-verification-2026-11-05.md) and [recovery runbook](recovery-runbook.md).

## Engineering gates

| Gate | Current evidence or implementation | Remaining before live launch |
| --- | --- | --- |
| Accounting and reservations | Exact raw units, balanced journals, conservation, full-principal allocation, partial trades and separate fee accounting | Production permissions, migrations, realistic load/checkpoint design and full platform consistency |
| Durable commands | Strict v1/v2/v3 replay, explicit atomic development continuations, immutable SQL projections, deduplicated commands/receipts and original historical retries | Reviewed production roles/migrations, checkpointing and ongoing integrity monitoring |
| Recovery | Standalone v1/mixed-v2 and isolated-v3 formats; v2 correction-cohort combined export/restore with credential quarantine; initial source inspection/pause and same-database receipts | A distinct initial-cohort combined recovery contract; production schema/role compatibility, authority re-entry, authenticated/encrypted retention, cross-instance fencing, external reconciliation, recovery exercise and controlled resume/adjudication |
| Access control | Development web/mobile session-source adapters; both private cohorts lock current session/account rows and recheck explicit buyer/seller/owner authority, expiry and mobile device/version policy | Production routes/configuration, real step-up issuer, rate limits and reviewed production identities/roles |
| Chain evidence | Strict pure BSC/TRON receipt validation against explicit fixture context and supplied canonical ancestry | Exact real/test asset registry, owned deposit addresses, authenticated independent RPC/finality sources, durable scan coverage and reorg handling |
| Custody and signing | Immutable payout contract and fake-provider acceptance/lookup/finality tests | Owner-selected custody/signing model, isolated provider test environment, tested keys/policies/recovery and account-specific asset availability |
| Seller/buyer interface | Persistent English/Arabic local rehearsal; actual Chromium desktop/mobile funding, approval, partial trades, fee and response-loss flows passed | Integration into actual website/mobile account, trade and receipt screens; user-facing accessibility and product acceptance |
| Marketplace integration | Separate correction and initial coordinators atomically couple actual canonical SQL, stored web/mobile authority, immutable receipts/publication and writer fences to unchanged v2/v3 financial contracts | Initial combined recovery and competing identity bindings; subsequent proposals/full lifecycle; actual web/mobile product, reviews/benefits/ranks and deduplicated delivery |
| Payment verification | Fixture evidence distinct from buyer claim and seller release | Owner-approved bank/cash evidence authority, audit trail and exception/dispute handling |
| Operations | Conservative standalone and combined recovery, explicit paused-source/target procedures and no-overwrite unknown-COMMIT handling | Production recovery objectives, monitoring/alerts, on-call ownership, asset/gas reconciliation, limits, incident/refund process and independent security review |
| Deployment | Exact wallet branch auto-deployment disabled; no main merge or production migration | Final review of a concrete release, explicit launch authorization and a separately reviewed rollout |

The current ledger rebuilds all historical commands and serializes the whole wallet. That is useful correctness evidence, but it is not a production throughput or availability design. The pure chain decoder validates supplied fixture consistency; it does not authenticate consensus or a blockchain node. The local role switcher is a rehearsal tool; it is not account login. These distinctions must remain visible in reviews and release notes.

## Next decisions and implementation sequence

1. **Choose the custody/signing direction and test environment.** The reviewable options and acceptance requirements are in [custody-decision.md](custody-decision.md). Account eligibility, commercial cost, key control and recovery ownership cannot be inferred from public API documentation.
2. **Approve a concrete fiat verification policy.** Bank and cash payments need a defined trusted authority and evidence. Neither the buyer's paid button nor a manual marketplace completion flag provides that evidence.
3. **Implement distinct combined recovery for the initial cohort, then extend recovery authority.** Preserve canonical activation/basis, original v1/v2/v3 history, initial binding, receipts, events and publication as one validated unit, with paused source/target rules, credential quarantine, competing fresh-target claims and same-target unknown-COMMIT inspection. Keep the original v2 correction format unchanged. Production work must also define account-authority re-entry, source leadership/fencing, authenticated encrypted retention, production roles and external reconciliation. A successful isolated restore never authorizes an active second copy or resume.
4. **Extend the integrated lifecycle and product boundary.** Build on the [initial coordinator](initial-marketplace-coordinator-design.md), [amount-correction coordinator](marketplace-coordinator-design.md) and shared [stored mobile authority](marketplace-mobile-auth-design.md). Add subsequent proposals and cancellation/dispute/payment/release/settlement participants, with complete bidirectional canonical/wallet identity bindings before widening the initial cohort. Preserve the general three-trade policy, two-proposal consent, payment-method constraints, eligibility/reviews, ranks, benefits and fee behavior. Connect durable publication intents to reviewed deduplicated delivery and actual web/mobile account/trade interfaces.
5. **Complete actual provider/testnet drills.** Confirm deposit attribution, wrong-token rejection, finality, duplicate webhooks, gas resources, payout policy, uncertain submission, worker restart, stale backup and signer recovery using the selected environment.
6. **Finish operations and independent review.** Review real permissions and signing policy, recovery and limits, user-facing acceptance and deployment plan. Record unresolved findings explicitly; this development review is not an independent security audit.
7. **Present the exact release for launch authorization.** No automatic threshold, green test result or broad development approval authorizes mainnet funding, signing, production migration, deployment or real transfers.

## Evidence locations

- [Initial offline verification](verification-2026-11-04.md)
- [Durable repository and native PostgreSQL verification](durable-verification-2026-11-04.md)
- [468-test access, recovery and actual browser verification](phase3-verification-2026-11-04.md)
- [578-test platform session and wallet verification](platform-verification-2026-11-04.md)
- [800-test marketplace transaction groundwork verification](marketplace-groundwork-verification-2026-11-04.md)
- [879-test versioned ledger and recovery verification](ledger-v2-verification-2026-11-05.md)
- [998-test canonical coordinator and writer/authentication race verification](marketplace-coordinator-verification-2026-11-05.md)
- [Access/platform integration contract](access-and-integration.md)
- [Atomic marketplace terms integration design](transaction-integration-design.md)
- [Versioned ledger continuation contract](ledger-v2-continuation-design.md)
- [Private canonical marketplace coordinator](marketplace-coordinator-design.md)
- [Transaction-owned mobile marketplace authority](marketplace-mobile-auth-design.md)
- [Authenticated initial coordinator contract](initial-marketplace-coordinator-design.md)
- [Initial-coordinator exact-source verification](initial-marketplace-verification-2026-11-05.md)
- [Initial-coordinator machine-readable evidence](initial-marketplace-verification-results.json)
- [Historical 1,626-test seller-native v3 and nine-drill verification](ledger-v3-verification-2026-11-05.md)
- [Seller-native v3 financial and isolated recovery contract](ledger-v3-initial-acceptance-design.md)
- [Historical 1,390-test initial acceptance groundwork and eight-drill verification](initial-acceptance-verification-2026-11-05.md)
- [Initial seller acceptance contract](initial-acceptance-design.md)
- [Historical 1,203-test mobile coordination and seven-drill verification](marketplace-mobile-verification-2026-11-05.md)
- [Historical 1,081-test combined recovery and six-drill verification](marketplace-recovery-verification-2026-11-05.md)
- [Combined marketplace/wallet recovery contract](marketplace-recovery-design.md)
- [Recovery runbook](recovery-runbook.md)
- [Chain adapter contract](chain-adapter-contract.md)
- [Rehearsal guide](rehearsal.md)

Each verification report identifies its exact tested commit and executed native PostgreSQL/Chromium results. Subsequent integration work requires separate evidence; a passing isolated simulation does not close the remaining live-launch gates.

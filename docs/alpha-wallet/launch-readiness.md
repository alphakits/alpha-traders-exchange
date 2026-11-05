# Alpha Wallet launch readiness

Date: 5 November 2026 (Asia/Jerusalem). Decision: **not ready to accept live funds or deploy**.

**Development resumed at the user's explicit request on 5 November 2026.** The [saved pause checkpoint](PAUSED-2026-11-05.md) and [earlier checkpoint](PAUSED-2026-11-04.md) remain historical. Continued development does not authorize a live launch.

The user authorized continued development, isolated testing and saving the wallet development branch. Live launch remains withheld. A passing development suite does not change that instruction.

**Latest verified source: `2c3e6a0b809f9bb34f84dcc82243593ba079ee1f`.** The [initial combined recovery verification report](initial-marketplace-recovery-verification-2026-11-05.md) records **1,913 passing tests across 56 files, with zero failures or skips**: 1,726 wallet tests across 47 files, 87 platform authentication tests across five files and 100 marketplace/storage regressions across four files. All 1,592 prior wallet cases remain, with 134 new cases. Root TypeScript, eleven native PostgreSQL drills/**117 checks** including sixteen new recovery checks, and the retained English/Arabic Chromium rehearsal passed on this exact source. [CI](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42108670720) completed successfully on 5 November 2026 at 23:10:25 IST; the [machine-readable evidence](initial-marketplace-recovery-verification-results.json) binds the source/tree, run/job, original case inventories and downloaded artifact hashes.

The [previous initial-coordinator evidence](initial-marketplace-verification-2026-11-05.md) remains separately recorded at `c11fe0e90dc96fad8e0b21901cd9093e9c2dc536`, with 1,779 tests and ten native drills/101 checks.

The [authenticated initial coordinator](initial-marketplace-coordinator-design.md) couples current stored web/mobile seller authority and explicit owner activation to one atomic full-principal reservation, canonical acceptance, original receipt and safe publication intent. The new [initial combined recovery contract](initial-marketplace-recovery-design.md) preserves the activation basis, complete v1/v2/v3 history, canonical rows and original receipts/events/publication together. It adds paused-source owner export through web/mobile, atomic fresh-target restore with credential quarantine and a new pause, and same-target inspection after an unknown COMMIT. Its exact-source verification is recorded above. Live launch remains withheld.

The [historical seller-native v3 baseline at `f18e95e6`](ledger-v3-verification-2026-11-05.md) records 1,626 passing tests, including 1,439 wallet tests across 39 files, plus root TypeScript, nine native PostgreSQL drills/86 checks and the retained English/Arabic Chromium rehearsal. It verifies the separate financial engine and isolated paused-wallet recovery; the later initial coordinator has its own evidence above.

The [historical recovery baseline at `09405da`](marketplace-recovery-verification-2026-11-05.md) retains 1,081 tests and six native drills/54 checks, including 83 recovery cases and 11 native recovery checks.

**Private mobile authority.** Both private cohorts accept current stored mobile access/device credentials in the financial transaction. Both cohorts support mobile owner export of their distinct combined recovery formats; both restored targets omit web sessions and both mobile authentication tables. The [mobile authority contract](marketplace-mobile-auth-design.md) distinguishes the current initial-seller extension from the [historical mobile verification](marketplace-mobile-verification-2026-11-05.md).

**Initial acceptance integration.** The [pure plan and canonical participant](initial-acceptance-design.md), frozen v2 history and [seller-native v3 financial contract](ledger-v3-initial-acceptance-design.md) retain their original scopes. The new [authenticated initial coordinator](initial-marketplace-coordinator-design.md) now adds same-transaction stored seller authority, explicit owner activation, canonical/wallet acceptance, original receipt/publication and SQL writer fences. Its distinct combined recovery format is implemented and verified on the current source. Competing reservations still need complete canonical/wallet identity bindings before entering the supported financial cohort.

## Accepted behavior

- Full listing principal is required: a 500 USDT listing needs 500 USDT. Commission short-payment tolerance never reduces principal funding or delivery.
- Owner approval remains separate from funding. A deposit cannot bypass listing review.
- Partial reservations conserve inventory, with at most three active trades for a seller. The amount-correction coordinator's one-active-trade cohort and the initial coordinator's one selected mapping are separate development restrictions; neither changes that general policy.
- The buyer receives the full principal. The 1% buyer fee in fiat and the seller's combined 2% USDT commission remain separate.
- A buyer's paid claim is not release authority. Trusted independent payment evidence and seller authorization are both required.
- A payout timeout keeps funds reserved and preserves the original provider identity. A missing lookup does not permit a replacement send.
- Standalone wallet restoration starts paused because external transfers may have continued after its checkpoint. The v2 amount-correction and v3 initial cohorts each have a distinct combined format requiring a paused source and a paused credential-free target. Their old standalone formats continue failing closed after canonical activation. Restored history is verified offline; it supplies no authority re-entry, source leadership or resume.

These rules are executable in the isolated development model. Two separate private coordinators couple actual canonical SQL and stored authentication to one existing amount-correction proposal or one ordinary initial seller acceptance. Their development scopes do not connect production marketplace behavior, remaining lifecycle transitions or public web/mobile interfaces. Those integrations must preserve consent, eligibility, reviews and completion rules.

## Current private amount-correction cohort

An owner can explicitly enroll, inspect and pause one already accepted canonical request with a clean existing wallet reservation and a valid pending `amount_correction` proposal. This correction cohort supports current ILS fee policies, Bank Transfer and Face-to-Face. It requires the only active canonical reservation on its listing, the only nonterminal wallet trade globally and no unfinished payout.

Buyer acceptance resolves the actual web or mobile session/account rows through the corresponding fixed reader inside the same `SERIALIZABLE` transaction as canonical reads, wallet replay and writes. The mobile reader also binds the token to its stored device/platform and enforces the current minimum app version. Fresh ownership/eligibility checks precede historical receipt lookup, and authority/expiry are rechecked after persistence. Both transports share the unchanged acceptance identity: a current valid session can recover the original receipt, including after pause, while revoked credentials are denied. Canonical terms, the principal adjustment, immutable receipt, deterministic system message/notification/audit and safe publication intent commit together. SQL guards fence unsupported enrolled-listing writers and standalone wallet access after activation.

This cohort has no public web/mobile route, account/trade screen integration, notification/realtime delivery, provider or signer. It cannot create a new proposal, perform initial trade acceptance, cancel, handle payment/dispute/release/settlement transitions or resume after pause. Owner `inspect` and `pause` remain supported through either private credential entry point. A current web or mobile owner can export the complete supported recovery unit after pausing the source. Fresh-target restore and offline same-target inspection preserve the financial records, add a new pause and exclude usable credentials; neither mobile authentication table is restored. Existing wallet-only formats still cannot recover an activated cohort; account-authority re-entry and resume remain unimplemented. The [coordinator design](marketplace-coordinator-design.md), [mobile authority contract](marketplace-mobile-auth-design.md), [combined recovery contract](marketplace-recovery-design.md) and [recovery runbook](recovery-runbook.md) define these boundaries.

## Current private initial-acceptance cohort

A current stored owner activates one clean ordinary pending request with distinct platform request/trade/listing and wallet trade/listing identities, the supported asset, full funding and a verified v3 checkpoint. Activation freezes the exact supported canonical listing/sibling basis; it does not accept the request or supply seller consent.

The actual stored seller must have current `canSell` and match the request's seller ID. Web/mobile authentication, complete canonical eligibility reads, verified wallet replay, seller-native full-principal reservation, canonical acceptance and immutable receipt/publication share one SERIALIZABLE transaction. Fresh authority is required for original receipt recovery across transports, including after pause. Statement fences order legacy canonical dependency writers, while exact cohort guards refuse unsupported target-listing and standalone financial changes. The general three-active-trade policy and both participants' commission/review obligations remain unchanged.

**Distinct combined initial-cohort backup/restore is implemented.** It preserves the explicitly activated pending or accepted source as one validated unit and requires exact UTC representations, a fresh isolated target, one extra quarantine pause and disabled account references. The old isolated and v2 correction formats continue rejecting the initial namespace. Current-owner web/mobile export and offline same-target inspection grant no source leadership, authority re-entry or resume. Broader identity-bound reservations, subsequent proposals/payment/cancellation/dispute/release/settlement, product routes/screens and external delivery remain open. See the [initial recovery contract](initial-marketplace-recovery-design.md), [initial coordinator contract](initial-marketplace-coordinator-design.md) and [recovery runbook](recovery-runbook.md).

## Engineering gates

| Gate | Current evidence or implementation | Remaining before live launch |
| --- | --- | --- |
| Accounting and reservations | Exact raw units, balanced journals, conservation, full-principal allocation, partial trades and separate fee accounting | Production permissions, migrations, realistic load/checkpoint design and full platform consistency |
| Durable commands | Strict v1/v2/v3 replay, explicit atomic development continuations, immutable SQL projections, deduplicated commands/receipts and original historical retries | Reviewed production roles/migrations, checkpointing and ongoing integrity monitoring |
| Recovery | Standalone v1/mixed-v2 and isolated-v3 formats; separate correction and initial combined formats with credential quarantine, exact original history, atomic pause and same-target outcome inspection | Production schema/role compatibility, authority re-entry, authenticated/encrypted retention, cross-instance fencing, external reconciliation, recovery exercise and controlled resume/adjudication |
| Access control | Development web/mobile session-source adapters; both private cohorts lock current session/account rows and recheck explicit buyer/seller/owner authority, expiry and mobile device/version policy | Production routes/configuration, real step-up issuer, rate limits and reviewed production identities/roles |
| Chain evidence | Strict pure BSC/TRON receipt validation against explicit fixture context and supplied canonical ancestry | Exact real/test asset registry, owned deposit addresses, authenticated independent RPC/finality sources, durable scan coverage and reorg handling |
| Custody and signing | Immutable payout contract and fake-provider acceptance/lookup/finality tests | Owner-selected custody/signing model, isolated provider test environment, tested keys/policies/recovery and account-specific asset availability |
| Seller/buyer interface | Persistent English/Arabic local rehearsal; actual Chromium desktop/mobile funding, approval, partial trades, fee and response-loss flows passed | Integration into actual website/mobile account, trade and receipt screens; user-facing accessibility and product acceptance |
| Marketplace integration | Separate correction and initial coordinators atomically couple actual canonical SQL, stored web/mobile authority, immutable receipts/publication and writer fences to unchanged v2/v3 financial contracts | Complete competing identity bindings; explicit next financial version and subsequent proposals/full lifecycle; actual web/mobile product, reviews/benefits/ranks and deduplicated delivery |
| Payment verification | Fixture evidence distinct from buyer claim and seller release | Owner-approved bank/cash evidence authority, audit trail and exception/dispute handling |
| Operations | Conservative standalone and combined recovery, explicit paused-source/target procedures and no-overwrite unknown-COMMIT handling | Production recovery objectives, monitoring/alerts, on-call ownership, asset/gas reconciliation, limits, incident/refund process and independent security review |
| Deployment | Exact wallet branch auto-deployment disabled; no main merge or production migration | Final review of a concrete release, explicit launch authorization and a separately reviewed rollout |

The current ledger rebuilds all historical commands and serializes the whole wallet. That is useful correctness evidence, but it is not a production throughput or availability design. The pure chain decoder validates supplied fixture consistency; it does not authenticate consensus or a blockchain node. The local role switcher is a rehearsal tool; it is not account login. These distinctions must remain visible in reviews and release notes.

## Next decisions and implementation sequence

1. **Choose the custody/signing direction and test environment.** The reviewable options and acceptance requirements are in [custody-decision.md](custody-decision.md). Account eligibility, commercial cost, key control and recovery ownership cannot be inferred from public API documentation.
2. **Approve a concrete fiat verification policy.** Bank and cash payments need a defined trusted authority and evidence. Neither the buyer's paid button nor a manual marketplace completion flag provides that evidence.
3. **Extend production recovery authority after the now-implemented initial combined format.** Keep both existing combined formats unchanged. Define account-authority re-entry, source leadership/fencing, authenticated encrypted retention, production roles and external reconciliation. The current guards enforce their application protocol, not hostile superuser DDL after every deferred event has been deliberately flushed. A successful isolated restore never authorizes an active second copy or resume.
4. **Extend the mapped lifecycle through an explicit next financial version, then widen identity coverage.** The current v3 contract permits only initial acceptance and pause and fixes initial trades at their original reservation. New payment/cancellation/dispute/release/settlement commands therefore require an explicit next continuation, preserving every original v1/v2/v3 result and hash; do not loosen the old reducer or SQL invariants. A bounded next slice is prepayment cancellation of the existing single mapped trade, with atomic canonical cancellation, full-principal return, immutable cancellation receipt and its complete recovery profile. Follow the actual canonical policy: current status alone is insufficient; retained payment/evidence/dispute history and buyer-visible bank details constrain the actor, pending proposals must close consistently, and expired listings cannot reopen. Use cancellation-specific current participant authority rather than assuming that new-sale eligibility is the same decision. Exclude the manual owner force-cancel override from automatic custody release. Add buyer claims/dispute freezes and subsequent proposals/full settlement through equally explicit participants. Before admitting competing commitments, implement complete bidirectional canonical/wallet coverage; matching totals alone cannot prove buyer, destination, quote or request identity. Persisted coverage requires migration/recovery compatibility. Preserve the general three-trade policy, eligibility/reviews, ranks, benefits and separate fees. Connect publication intents to reviewed deduplicated delivery and actual web/mobile interfaces. These simulation slices can proceed before a custody provider is selected.
5. **Complete actual provider/testnet drills.** Confirm deposit attribution, wrong-token rejection, finality, duplicate webhooks, gas resources, payout policy, uncertain submission, worker restart, stale backup and signer recovery using the selected environment.
6. **Finish operations and independent review.** Review real permissions and signing policy, recovery and limits, user-facing acceptance and deployment plan. Record unresolved findings explicitly; this development review is not an independent security audit.
7. **Present the exact release for launch authorization.** No automatic threshold, green test result or broad development approval authorizes mainnet funding, signing, production migration, deployment or real transfers.

## Evidence locations

- [Initial combined recovery contract](initial-marketplace-recovery-design.md)
- [Initial combined recovery exact-source verification](initial-marketplace-recovery-verification-2026-11-05.md)
- [Initial combined recovery machine-readable evidence](initial-marketplace-recovery-verification-results.json)
- [Current development checkpoint and next implementation](development-checkpoint-2026-11-05.md)
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

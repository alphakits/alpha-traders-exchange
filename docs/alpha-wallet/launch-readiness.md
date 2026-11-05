# Alpha Wallet launch readiness

Date: 5 November 2026 (Asia/Jerusalem). Decision: **not ready to accept live funds or deploy**.

**Development resumed at the user's request on 4 November 2026.** The [saved checkpoint](PAUSED-2026-11-04.md) records the prior pause and unfinished verification. Resumption authorizes development and isolated checks; it does not authorize a live launch.

The user authorized continued development, isolated testing and saving the wallet development branch. Live launch remains withheld. A passing development suite does not change that instruction.

**Latest verified source: `47f0fc18`.** The [mobile coordination verification](marketplace-mobile-verification-2026-11-05.md) records **1,203 passing tests**: 1,016 wallet tests across 32 files plus 187 targeted platform authentication/marketplace tests across nine files. Full-project TypeScript, all seven native PostgreSQL drills with 66 checks, and the existing English/Arabic Chromium rehearsal passed on this exact source. These results verify the fixed private mobile coordinator/recovery cohort; they do not close the remaining launch gates.

The [historical recovery baseline at `09405da`](marketplace-recovery-verification-2026-11-05.md) retains 1,081 tests and six native drills/54 checks, including 83 recovery cases and 11 native recovery checks.

**Verified private mobile implementation.** The same bounded coordinator has a separate mobile access/device credential entry point, plus mobile owner export of the unchanged paused-source recovery format. Source compatibility accepts the exact optional mobile authentication table pair while keeping credentials out of recovery. The [mobile authority contract](marketplace-mobile-auth-design.md) and [exact-source report](marketplace-mobile-verification-2026-11-05.md) define the supported behavior and its limits.

## Accepted behavior

- Full listing principal is required: a 500 USDT listing needs 500 USDT. Commission short-payment tolerance never reduces principal funding or delivery.
- Owner approval remains separate from funding. A deposit cannot bypass listing review.
- Partial reservations conserve inventory, with at most three active trades for a seller. The new private coordinator's one-active-trade cohort is a development activation restriction; it does not change that general policy.
- The buyer receives the full principal. The 1% buyer fee in fiat and the seller's combined 2% USDT commission remain separate.
- A buyer's paid claim is not release authority. Trusted independent payment evidence and seller authorization are both required.
- A payout timeout keeps funds reserved and preserves the original provider identity. A missing lookup does not permit a replacement send.
- Standalone wallet backup restoration starts paused because external transfers may have continued after the backup was taken. An activated canonical marketplace cohort uses the separate combined format from a paused source; its fresh restored copy also starts paused with disabled identities and no restored sessions. Wallet-only exports stay blocked for that cohort.

These rules are executable in the isolated development model. The private coordinator integrates actual canonical SQL and stored authentication for one existing amount-correction proposal on an already reserved trade. Both private credential paths now have [exact-source verification](marketplace-mobile-verification-2026-11-05.md) for this bounded development cohort. Production marketplace behavior, initial acceptance, the remaining lifecycle and public web/mobile interfaces still require integration without losing consent, eligibility, reviews or completion rules.

## Current private cohort

An owner can explicitly enroll, inspect and pause one already accepted canonical request with a clean existing wallet reservation and a valid pending `amount_correction` proposal. The initial cohort supports current ILS fee policies, Bank Transfer and Face-to-Face. It requires the only active canonical reservation on its listing, the only nonterminal wallet trade globally and no unfinished payout.

Buyer acceptance resolves the actual web or mobile session/account rows through the corresponding fixed reader inside the same `SERIALIZABLE` transaction as canonical reads, wallet replay and writes. The mobile reader also binds the token to its stored device/platform and enforces the current minimum app version. Fresh ownership/eligibility checks precede historical receipt lookup, and authority/expiry are rechecked after persistence. Both transports share the unchanged acceptance identity: a current valid session can recover the original receipt, including after pause, while revoked credentials are denied. Canonical terms, the principal adjustment, immutable receipt, deterministic system message/notification/audit and safe publication intent commit together. SQL guards fence unsupported enrolled-listing writers and standalone wallet access after activation.

This cohort has no public web/mobile route, account/trade screen integration, notification/realtime delivery, provider or signer. It cannot create a new proposal, perform initial trade acceptance, cancel, handle payment/dispute/release/settlement transitions or resume after pause. Owner `inspect` and `pause` remain supported through either private credential entry point. A current web or mobile owner can export the complete supported recovery unit after pausing the source. Fresh-target restore and offline same-target inspection preserve the financial records, add a new pause and exclude usable credentials; neither mobile authentication table is restored. Existing wallet-only formats still cannot recover an activated cohort; account-authority re-entry and resume remain unimplemented. The [coordinator design](marketplace-coordinator-design.md), [mobile authority contract](marketplace-mobile-auth-design.md), [combined recovery contract](marketplace-recovery-design.md) and [recovery runbook](recovery-runbook.md) define these boundaries.

## Engineering gates

| Gate | Current evidence or implementation | Remaining before live launch |
| --- | --- | --- |
| Accounting and reservations | Exact raw units, balanced journals, conservation, full-principal allocation, partial trades and separate fee accounting | Production permissions, migrations, realistic load/checkpoint design and full platform consistency |
| Durable commands | Strict v1/v2 replay, explicit atomic development continuation, immutable SQL projections, deduplicated commands and payouts, original historical retries and old-wallet-writer fencing | Reviewed production roles/migrations, checkpointing and ongoing integrity monitoring |
| Recovery | Verified standalone and combined formats with paused web/mobile owner export, atomic fresh restore, source-table compatibility and credential quarantine | Production schema/role compatibility, identity authority re-entry, authenticated/encrypted retention, cross-instance writer fencing, provider/chain reconciliation, signed-off recovery exercise and controlled resume/adjudication |
| Access control | Existing development web/mobile session-source adapters; both private coordinators lock actual session/account rows in the financial transaction, with native revocation/rotation/concurrent-transport evidence and mobile device/version checks | Production routes/configuration, real step-up issuer, rate limits and reviewed production identities/roles |
| Chain evidence | Strict pure BSC/TRON receipt validation against explicit fixture context and supplied canonical ancestry | Exact real/test asset registry, owned deposit addresses, authenticated independent RPC/finality sources, durable scan coverage and reorg handling |
| Custody and signing | Immutable payout contract and fake-provider acceptance/lookup/finality tests | Owner-selected custody/signing model, isolated provider test environment, tested keys/policies/recovery and account-specific asset availability |
| Seller/buyer interface | Persistent English/Arabic local rehearsal; actual Chromium desktop/mobile funding, approval, partial trades, fee and response-loss flows passed | Integration into actual website/mobile account, trade and receipt screens; user-facing accessibility and product acceptance |
| Marketplace integration | Pure planner and frozen v1 history; actual focused SQL plus private owner enrollment and authenticated buyer acceptance; atomic canonical/wallet receipts and publication intent; enrolled-listing writer guards | Initial acceptance, subsequent proposals and full payment/cancellation/dispute/release/settlement lifecycle; web/mobile product integration; buyer reviews, benefits/ranks and external publication exactly once |
| Payment verification | Fixture evidence distinct from buyer claim and seller release | Owner-approved bank/cash evidence authority, audit trail and exception/dispute handling |
| Operations | Conservative standalone and combined recovery, explicit paused-source/target procedures and no-overwrite unknown-COMMIT handling | Production recovery objectives, monitoring/alerts, on-call ownership, asset/gas reconciliation, limits, incident/refund process and independent security review |
| Deployment | Exact wallet branch auto-deployment disabled; no main merge or production migration | Final review of a concrete release, explicit launch authorization and a separately reviewed rollout |

The current ledger rebuilds all historical commands and serializes the whole wallet. That is useful correctness evidence, but it is not a production throughput or availability design. The pure chain decoder validates supplied fixture consistency; it does not authenticate consensus or a blockchain node. The local role switcher is a rehearsal tool; it is not account login. These distinctions must remain visible in reviews and release notes.

## Next decisions and implementation sequence

1. **Choose the custody/signing direction and test environment.** The reviewable options and acceptance requirements are in [custody-decision.md](custody-decision.md). Account eligibility, commercial cost, key control and recovery ownership cannot be inferred from public API documentation.
2. **Approve a concrete fiat verification policy.** Bank and cash payments need a defined trusted authority and evidence. Neither the buyer's paid button nor a manual marketplace completion flag provides that evidence.
3. **Extend recovery toward production and independent authority.** The bounded combined format now preserves canonical/wallet records and quarantines a fresh target without credentials. Define verified account-authority re-entry, source leadership/fencing, authenticated encrypted retention, production schema/roles and external reconciliation. A successful isolated restore never authorizes an active second copy or a resume. Existing wallet-only backups remain unsuitable for activated cohorts.
4. **Extend the integrated lifecycle and product boundary.** Build on the verified [private mobile authority](marketplace-mobile-auth-design.md), [private coordinator](marketplace-coordinator-design.md) and [versioned ledger](ledger-v2-continuation-design.md) to add initial acceptance, subsequent proposals and cancellation/dispute/payment/release/settlement participants. Preserve the general three-trade policy, two-proposal consent, payment-method constraints, eligibility/reviews, ranks, benefits and fee behavior. Connect durable publication intents to separately reviewed, deduplicated delivery and actual web/mobile account/trade interfaces.
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
- [Current 1,203-test mobile coordination and seven-drill verification](marketplace-mobile-verification-2026-11-05.md)
- [Historical 1,081-test combined recovery and six-drill verification](marketplace-recovery-verification-2026-11-05.md)
- [Combined marketplace/wallet recovery contract](marketplace-recovery-design.md)
- [Recovery runbook](recovery-runbook.md)
- [Chain adapter contract](chain-adapter-contract.md)
- [Rehearsal guide](rehearsal.md)

Each verification report identifies its exact tested commit and executed native PostgreSQL/Chromium results. Subsequent integration work requires separate evidence; a passing isolated simulation does not close the remaining live-launch gates.

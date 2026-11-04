# Alpha Wallet launch readiness

Date: 5 November 2026 (Asia/Jerusalem). Decision: **not ready to accept live funds or deploy**.

**Development resumed at the user's request on 4 November 2026.** The [saved checkpoint](PAUSED-2026-11-04.md) records the prior pause and unfinished verification. Resumption authorizes development and isolated checks; it does not authorize a live launch.

The user authorized continued development, isolated testing and saving the wallet development branch. Live launch remains withheld. A passing development suite does not change that instruction.

**Latest verified source: `ecc3752`**, with **998 passing tests across the wallet and targeted platform authentication/marketplace suites**, full-project TypeScript, five successful native PostgreSQL drills containing 43 checks and the Chromium rehearsal. [Exact evidence and limits](marketplace-coordinator-verification-2026-11-05.md) include the new private canonical coordinator's 16 native checks. This verifies its bounded development cohort; it does not close the remaining launch gates.

## Accepted behavior

- Full listing principal is required: a 500 USDT listing needs 500 USDT. Commission short-payment tolerance never reduces principal funding or delivery.
- Owner approval remains separate from funding. A deposit cannot bypass listing review.
- Partial reservations conserve inventory, with at most three active trades for a seller. The new private coordinator's one-active-trade cohort is a development activation restriction; it does not change that general policy.
- The buyer receives the full principal. The 1% buyer fee in fiat and the seller's combined 2% USDT commission remain separate.
- A buyer's paid claim is not release authority. Trusted independent payment evidence and seller authorization are both required.
- A payout timeout keeps funds reserved and preserves the original provider identity. A missing lookup does not permit a replacement send.
- Standalone wallet backup restoration starts paused because external transfers may have continued after the backup was taken. An activated canonical marketplace cohort requires a future combined recovery format; wallet-only exports are blocked for that cohort.

These rules are executable in the isolated development model. The private coordinator now integrates actual canonical SQL and stored web authentication for one existing amount-correction proposal on an already reserved trade. Production marketplace behavior, initial acceptance, the remaining lifecycle and mobile coordination still require integration without losing consent, eligibility, reviews or completion rules.

## Current private cohort

An owner can explicitly enroll, inspect and pause one already accepted canonical request with a clean existing wallet reservation and a valid pending `amount_correction` proposal. The initial cohort supports current ILS fee policies, Bank Transfer and Face-to-Face. It requires the only active canonical reservation on its listing, the only nonterminal wallet trade globally and no unfinished payout.

Buyer acceptance resolves the actual web session/account rows inside the same `SERIALIZABLE` transaction as canonical reads, wallet replay and writes. Fresh ownership/eligibility checks precede historical receipt lookup, and authority/expiry are rechecked after persistence. Canonical terms, the principal adjustment, immutable receipt, deterministic system message/notification/audit and safe publication intent commit together. SQL guards fence unsupported enrolled-listing writers and standalone wallet access after activation.

This cohort has no public route, mobile bridge, notification/realtime delivery, provider or signer. It cannot create a new proposal, perform initial trade acceptance, cancel, handle payment/dispute/release/settlement transitions or resume after pause. Owner `inspect` and `pause` remain its supported recovery controls. Preserve the complete isolated source; the existing wallet-only backup formats cannot recover it. The [coordinator design](marketplace-coordinator-design.md) and [recovery runbook](recovery-runbook.md) define these boundaries.

## Engineering gates

| Gate | Current evidence or implementation | Remaining before live launch |
| --- | --- | --- |
| Accounting and reservations | Exact raw units, balanced journals, conservation, full-principal allocation, partial trades and separate fee accounting | Production permissions, migrations, realistic load/checkpoint design and full platform consistency |
| Durable commands | Strict v1/v2 replay, explicit atomic development continuation, immutable SQL projections, deduplicated commands and payouts, original historical retries and old-wallet-writer fencing | Reviewed production roles/migrations, checkpointing and ongoing integrity monitoring |
| Recovery | Standalone lost-response lookup, provider evidence, pure-v1/mixed-v2 backup validation and atomic restore/pause; prior native restore drills passed at `08fb7fa`. Activated canonical cohorts expose owner inspection/pause and reject standalone wallet-only export | Combined canonical marketplace/wallet export, restore and quarantine first; production writer fencing, provider/chain reconciliation, signed-off recovery exercise and controlled resume/adjudication |
| Access control | Existing development web/mobile session-source adapters; private web coordinator locks actual session/account rows in its financial transaction, checks ownership and rechecks eligibility/expiry; native revocation/account races passed | Coordinated mobile authentication, production routes/configuration, real step-up issuer, rate limits and reviewed production identities/roles |
| Chain evidence | Strict pure BSC/TRON receipt validation against explicit fixture context and supplied canonical ancestry | Exact real/test asset registry, owned deposit addresses, authenticated independent RPC/finality sources, durable scan coverage and reorg handling |
| Custody and signing | Immutable payout contract and fake-provider acceptance/lookup/finality tests | Owner-selected custody/signing model, isolated provider test environment, tested keys/policies/recovery and account-specific asset availability |
| Seller/buyer interface | Persistent English/Arabic local rehearsal; actual Chromium desktop/mobile funding, approval, partial trades, fee and response-loss flows passed | Integration into actual website/mobile account, trade and receipt screens; user-facing accessibility and product acceptance |
| Marketplace integration | Pure planner and frozen v1 history; actual focused SQL plus private owner enrollment and authenticated buyer acceptance; atomic canonical/wallet receipts and publication intent; enrolled-listing writer guards | Initial acceptance, subsequent proposals and full payment/cancellation/dispute/release/settlement lifecycle; web/mobile product integration; buyer reviews, benefits/ranks and external publication exactly once |
| Payment verification | Fixture evidence distinct from buyer claim and seller release | Owner-approved bank/cash evidence authority, audit trail and exception/dispute handling |
| Operations | Conservative standalone recovery and private coordinator owner inspection/pause; runbooks distinguish activated cohorts from ledger-only backups | Combined cohort recovery, monitoring/alerts, on-call ownership, asset/gas reconciliation, limits, incident and refund process, independent security review |
| Deployment | Exact wallet branch auto-deployment disabled; no main merge or production migration | Final review of a concrete release, explicit launch authorization and a separately reviewed rollout |

The current ledger rebuilds all historical commands and serializes the whole wallet. That is useful correctness evidence, but it is not a production throughput or availability design. The pure chain decoder validates supplied fixture consistency; it does not authenticate consensus or a blockchain node. The local role switcher is a rehearsal tool; it is not account login. These distinctions must remain visible in reviews and release notes.

## Next decisions and implementation sequence

1. **Choose the custody/signing direction and test environment.** The reviewable options and acceptance requirements are in [custody-decision.md](custody-decision.md). Account eligibility, commercial cost, key control and recovery ownership cannot be inferred from public API documentation.
2. **Approve a concrete fiat verification policy.** Bank and cash payments need a defined trusted authority and evidence. Neither the buyer's paid button nor a manual marketplace completion flag provides that evidence.
3. **Implement combined recovery for the verified private coordinator.** The new exact-source PGlite, native PostgreSQL and retained regression results are recorded. Define and implement a combined canonical marketplace/wallet export, fresh-target restore, quarantine and reconciliation protocol. Existing wallet-only backups omit the new canonical records and cannot be used to restore the activated cohort.
4. **Extend the integrated lifecycle and product boundary.** Build on the [private coordinator](marketplace-coordinator-design.md) and [versioned ledger](ledger-v2-continuation-design.md) to add initial acceptance, subsequent proposals, cancellation/dispute/payment/release/settlement participants and coordinated mobile authentication. Preserve the general three-trade policy, two-proposal consent, payment-method constraints, eligibility/reviews, ranks, benefits and fee behavior. Connect durable publication intents to separately reviewed, deduplicated delivery and actual account/trade interfaces.
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
- [Recovery runbook](recovery-runbook.md)
- [Chain adapter contract](chain-adapter-contract.md)
- [Rehearsal guide](rehearsal.md)

Each verification report identifies its exact tested commit and executed native PostgreSQL/Chromium results. Subsequent integration work requires separate evidence; a passing isolated simulation does not close the remaining live-launch gates.

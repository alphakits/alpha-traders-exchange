# Alpha Wallet launch readiness

Date: 5 November 2026 (Asia/Jerusalem). Decision: **not ready to accept live funds or deploy**.

**Development resumed at the user's request on 4 November 2026.** The [saved checkpoint](PAUSED-2026-11-04.md) records the prior pause and unfinished verification. Resumption authorizes development and isolated checks; it does not authorize a live launch.

The user authorized continued development, isolated testing and saving the wallet development branch. Live launch remains withheld. A passing development suite does not change that instruction.

Latest verified source: `08fb7fa`, with **879 passing tests across the wallet and targeted platform authentication/marketplace suites**, full-project TypeScript, four successful native PostgreSQL drills and the Chromium rehearsal. [Exact evidence and limits](ledger-v2-verification-2026-11-05.md) are retained separately from this readiness decision.

## Accepted behavior

- Full listing principal is required: a 500 USDT listing needs 500 USDT. Commission short-payment tolerance never reduces principal funding or delivery.
- Owner approval remains separate from funding. A deposit cannot bypass listing review.
- Partial reservations conserve inventory, with at most three active trades for a seller.
- The buyer receives the full principal. The 1% buyer fee in fiat and the seller's combined 2% USDT commission remain separate.
- A buyer's paid claim is not release authority. Trusted independent payment evidence and seller authorization are both required.
- A payout timeout keeps funds reserved and preserves the original provider identity. A missing lookup does not permit a replacement send.
- Backup restoration starts paused because external transfers may have continued after the backup was taken.

These rules are executable in the isolated development model. Existing marketplace behavior is still separate and must be integrated without losing its consent, eligibility and completion rules.

## Engineering gates

| Gate | Current evidence or implementation | Remaining before live launch |
| --- | --- | --- |
| Accounting and reservations | Exact raw units, balanced journals, conservation, full-principal allocation, partial trades and separate fee accounting | Production permissions, migrations, realistic load/checkpoint design and full platform consistency |
| Durable commands | Strict v1/v2 replay, explicit atomic development continuation, immutable SQL projections, deduplicated commands and payouts, original historical retries and old-wallet-writer fencing | Reviewed production roles/migrations, checkpointing and ongoing integrity monitoring |
| Recovery | Lost-response lookup, separate provider state, pure-v1 and mixed-v2 backup validation, atomic migration/restore/pause, inherited payout recovery and explicit v1 backup CLI; both native restore drills passed | Fenced production writers, provider/chain reconciliation, signed-off recovery exercise and controlled resume/adjudication |
| Access control | Development web/mobile adapters use actual stored session metadata and strict canonical reads; gateway enforces participant privacy, canonical seller status and exact withdrawal-proof terms | Production wallet routes/configuration, real step-up issuer, atomic revocation/rate-limit contract and review of privileged identities |
| Chain evidence | Strict pure BSC/TRON receipt validation against explicit fixture context and supplied canonical ancestry | Exact real/test asset registry, owned deposit addresses, authenticated independent RPC/finality sources, durable scan coverage and reorg handling |
| Custody and signing | Immutable payout contract and fake-provider acceptance/lookup/finality tests | Owner-selected custody/signing model, isolated provider test environment, tested keys/policies/recovery and account-specific asset availability |
| Seller/buyer interface | Persistent English/Arabic local rehearsal; actual Chromium desktop/mobile funding, approval, partial trades, fee and response-loss flows passed | Integration into actual website/mobile account, trade and receipt screens; user-facing accessibility and product acceptance |
| Marketplace integration | Pure accepted-amount planner; frozen 41-command v1 compatibility evidence; focused shared-transaction SQL participant; separate v2 ledger with synthetic enrollment, delta-only resize and durable receipts | Actual canonical marketplace enrollment/coordinator, initial acceptance, lifecycle participants and all enrolled-writer guards; current buyer eligibility/reviews; benefits/ranks/receipts/notifications exactly once |
| Payment verification | Fixture evidence distinct from buyer claim and seller release | Owner-approved bank/cash evidence authority, audit trail and exception/dispute handling |
| Operations | Pause and conservative recovery behavior; draft runbooks and verified isolation | Monitoring/alerts, on-call ownership, asset/gas reconciliation, limits, incident and refund process, independent security review |
| Deployment | Exact wallet branch auto-deployment disabled; no main merge or production migration | Final review of a concrete release, explicit launch authorization and a separately reviewed rollout |

The current ledger rebuilds all historical commands and serializes the whole wallet. That is useful correctness evidence, but it is not a production throughput or availability design. The pure chain decoder validates supplied fixture consistency; it does not authenticate consensus or a blockchain node. The local role switcher is a rehearsal tool; it is not account login. These distinctions must remain visible in reviews and release notes.

## Next decisions and implementation sequence

1. **Choose the custody/signing direction and test environment.** The reviewable options and acceptance requirements are in [custody-decision.md](custody-decision.md). Account eligibility, commercial cost, key control and recovery ownership cannot be inferred from public API documentation.
2. **Approve a concrete fiat verification policy.** Bank and cash payments need a defined trusted authority and evidence. Neither the buyer's paid button nor a manual marketplace completion flag provides that evidence.
3. **Complete the private integrated transaction boundary.** The focused SQL participant, pure planner and separate [versioned ledger continuation](ledger-v2-continuation-design.md) are development components. Connect canonical enrollment and real buyer consent, initial acceptance, lifecycle participants and all enrolled-writer guards under one transaction/outbox design. The ledger's synthetic bindings/acceptance receipts do not authenticate marketplace consent. Preserve existing two-proposal consent, payment-method constraints, buyer eligibility/reviews, ranks, benefits and fee behavior.
4. **Complete actual provider/testnet drills.** Confirm deposit attribution, wrong-token rejection, finality, duplicate webhooks, gas resources, payout policy, uncertain submission, worker restart, stale backup and signer recovery using the selected environment.
5. **Finish operations and independent review.** Review real permissions and signing policy, recovery and limits, user-facing acceptance and deployment plan. Record unresolved findings explicitly; this development review is not an independent security audit.
6. **Present the exact release for launch authorization.** No automatic threshold, green test result or broad development approval authorizes mainnet funding, signing, production migration, deployment or real transfers.

## Evidence locations

- [Initial offline verification](verification-2026-11-04.md)
- [Durable repository and native PostgreSQL verification](durable-verification-2026-11-04.md)
- [468-test access, recovery and actual browser verification](phase3-verification-2026-11-04.md)
- [578-test platform session and wallet verification](platform-verification-2026-11-04.md)
- [800-test marketplace transaction groundwork verification](marketplace-groundwork-verification-2026-11-04.md)
- [879-test versioned ledger and recovery verification](ledger-v2-verification-2026-11-05.md)
- [Access/platform integration contract](access-and-integration.md)
- [Atomic marketplace terms integration design](transaction-integration-design.md)
- [Versioned ledger continuation contract](ledger-v2-continuation-design.md)
- [Recovery runbook](recovery-runbook.md)
- [Chain adapter contract](chain-adapter-contract.md)
- [Rehearsal guide](rehearsal.md)

Each verification report identifies its exact tested commit and executed native PostgreSQL/Chromium results. Subsequent integration work requires separate evidence; a passing isolated simulation does not close the remaining live-launch gates.

# Alpha Wallet — development and launch preparation

Date: 4 November 2026. Scope: architecture and **offline development only**.
Base: `0b11b21fc0de3d04e4325a748ea2de62ade4f317` (the existing marketplace main branch when this work began).
Working branch: `feature/alpha-wallet-dev-20261104`.

**Development resumed at the user's request on 4 November 2026.** The [saved pause checkpoint](PAUSED-2026-11-04.md) records the earlier handoff. The no-live-launch restriction remains in force; unfinished verification and integration are tracked in [launch-readiness.md](launch-readiness.md).

This is an executable specification connected to an isolated, durable simulation repository and an offline provider fixture. It is not a live wallet, a testnet deployment, a custody provider, or a production-ready financial service. There are no real deposit addresses, keys, signing functions, RPC requests, public routes, scheduled workers, or applied production migrations in this change.

## What the agreed experience means

1. A seller funds the USDT principal they want to sell. A 500 USDT listing requires the full 500, with no short-payment tolerance.
2. A valid finalized deposit credits that seller's account once. The listing becomes eligible to display automatically when fully funded and approved under the existing owner-review policy.
3. Each accepted purchase moves its precise principal from listing inventory to a trade reservation. The same units cannot back another trade or withdrawal.
4. A buyer saying they paid creates a payment claim. An independent trusted verification step and the seller's release authorization must both exist before the automated payout process starts.
5. The outgoing transfer is represented by one immutable intent. A timeout leaves the outcome uncertain and funds reserved. Completion requires a matching finalized successful transfer receipt.
6. The buyer receives the full agreed USDT principal. Current 1% buyer + 1% seller fees remain separate, and the trade records their exact amounts once.

“Automatic” applies to deterministic work after its evidence and policy conditions are satisfied. The blockchain does not itself prove that cash changed hands or a bank transfer reached the seller. Cash, face-to-face, and bank payment verification need a concrete authority model before production integration.

## Implemented in this milestone

| Component | Implemented behavior | Current boundary |
| --- | --- | --- |
| Exact amounts | Decimal-string inputs; integer raw units; bounds; per-asset precision; six-decimal marketplace fee rounding | Synthetic assets only |
| Deposits | Dedicated synthetic intent; chain/token/destination/amount validation; pending/finalized distinction; event deduplication | Evidence is supplied by a trusted test fixture, not a live observer |
| Listings | Full principal funding; separate owner approval; automatic allocation after credit; partial inventory | Existing marketplace remains disconnected |
| Trades | Partial reservations; three active trades per seller; self-trade rejection; cancellation before payment claim | Pure domain engine, serialized by the durable simulation repository |
| Payment/release | Exact inclusive fiat evidence; evidence reuse blocked; independent fixture verifier; seller authorization bound to principal and recipient | Real authentication, bank/cash evidence adapters, and policy review are still required |
| Payouts | Immutable intent; one dispatch claim; unknown/broadcast/failed/finalized outcomes; matching receipt; retained uncertain funds | No signer or real network submission |
| Withdrawals | Only unallocated seller funds; same-asset recipient; synthetic step-up marker; immutable intent | Marker is not a real MFA implementation |
| Fees | Full principal delivered; separate commission account; one post-completion due; auto-settlement when funded; unpaid dues block new seller commitments | Principal and commission tolerance are never mixed |
| Incident behavior | Dispute stops queued dispatch; account mismatch or changed finalized deposit evidence pauses new outgoing work | Resume, adjudication, and payout replacement require later controlled recovery commands |
| Accounting | Balanced journal; no negative custody allocations; conservation checks after every command; atomic durable command, journal, and outbox writes | Global serialization and replay are a correctness-oriented development bridge, not a production scaling design |
| Durable repository | Versioned strict commands; exact amounts; committed result/state hashes; append-only history; restart replay; immutable SQL projections; bounded SQL retries | File-backed PGlite or explicit loopback development PostgreSQL only; fixture identities remain synthetic |
| Recovery worker | Persist claim before submission; retain uncertain funds; look up original reference; exact final receipt; tolerate late matching reports | Explicit single offline step with file-backed fake provider; no registered service or cron |
| Backup and restore | Verified logical history; explicit local CLI; fresh-target restore; pause committed atomically with restored funds | Development stores only; old writers must be fenced and provider history reconciled before any later resumption |
| User access boundary | Trusted server-resolved identities; account/session gates; participant privacy; exact-terms withdrawal approvals; privileged service commands excluded | Real web/mobile identity and MFA issuers remain disconnected |
| Chain evidence | Strict BSC/TRON receipt decoding, event identity, exact units, execution status and supplied canonical ancestry | Pure fixture consistency; no live RPC, consensus proof, authoritative finality source or automatic credit |
| Interactive rehearsal | Persistent loopback app with English/Arabic flows, partial trades, fee accounting and fault recovery | Explicit synthetic role switcher; not real account authentication or a deployed product |
| SQL proof | Connected `durable-schema.sql` plus retained historical `schema-draft.sql` | Neither file is registered as an application migration |

## Durable development repository

`commands.ts` defines a strict versioned command envelope. No request can name arbitrary executable methods, provide extra authority fields, or introduce an unknown asset/engine version. The command actor is still a fixture identity; a future HTTP boundary must derive real authority from trusted authentication.

`durable.ts` rebuilds the domain engine from committed commands under their recorded timestamps. It verifies every command identity, result digest, state digest, previous-event hash, head revision, normalized journal entry, payout intent/state transition, and chain-event claim before processing more work. Unknown versions, missing history, altered projections, or mismatching evidence stop the operation. Hashes detect inconsistent storage; they are not signatures or protection against an administrator who can rewrite the complete database and application together.

Each new command updates one head row first, then commits its log entry, normalized accounting entries, payout projection, evidence claims, and new head in one `SERIALIZABLE` transaction. Updating the head forces a stale waiting transaction to fail and retry the complete command. Duplicate commands return their original revision/event hash. A duplicate dispatch claim returns `shouldDispatch: false` with the current payout, never a cached instruction to send again.

The repository has two explicit development transports:

- `createFileWalletStore`: a marked local container directory with persistent PGlite data, strict durability, exact string numeric parsers, and one open database instance per canonical path in the process. Concurrent processes must use native PostgreSQL rather than sharing an open PGlite directory.
- `createPostgresWalletStore`: an explicit URL using only `127.0.0.1` or `::1`, explicit fixture credentials, and a database named `alpha_wallet_dev_*`. Ambient application/database URLs are never read. Whole transactions retry bounded serialization/deadlock failures. An uncertain COMMIT reply discards the connection and raises `ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN`; it does not assume rollback or automatically resend.

The SQL namespace is private and uses forced RLS without client policies. Tests therefore need a superuser or `BYPASSRLS` fixture role; merely owning the database is insufficient. This is deliberately not a production authentication/role design.

The file-backed fake provider keeps immutable broadcasts separately from the wallet database. Its reference binds the asset, destination, amount, and payout ID. Atomic publication, exact comparison of duplicate requests, and separate finality records let tests reproduce acceptance with a lost response. The worker persists the dispatch claim before calling this provider. If a claim exists but lookup finds nothing, it keeps the reservation and requests resolution; an empty lookup never authorizes a second submission. A late report cannot downgrade a confirmed or failed transfer.

Replay is intentionally bounded to 100,000 commands and serializes the whole development wallet. It is not an authenticated append-only service or a production performance implementation. Logical development backups now use the same verified replay, with a stricter 1,000-command/16 MiB backup limit and atomic restore quarantine; production checkpointing, recovery and performance still require review. Never change the meaning of a recorded engine version to make old history pass.

## Financial policy preserved

The current shared contracts state that the buyer receives the full USDT quantity, pays a 1% fee within the fiat total to the seller, and the seller remits the combined 2% in USDT after completion. The wallet must not turn a 500 USDT sale into a 490 USDT delivery.

| Full 500 USDT sale | Amount |
| --- | ---: |
| Principal deposited for listing | 500 USDT |
| Principal delivered across buyers | 500 USDT |
| Buyer fee collected by seller in fiat | Equivalent of 5 USDT |
| Seller's own fee | 5 USDT |
| Combined post-completion commission | 10 USDT |

The demo adds 10 USDT to a separate commission account to demonstrate automatic settlement. That is a separate optional fee-funding fixture, **not a silent change requiring a 510 USDT principal deposit**. If no commission funds exist when a payout completes, the model records the due and blocks new commitments while allowing already accepted trades to finish. A later commission deposit automatically settles eligible dues. Production automatic fee funding, network-fee funding, legacy commission carry-forward integration, and fee-account withdrawals need explicit final implementation choices.

Existing rules referenced:

- `packages/contracts/src/marketplace-fees.ts`: versioned buyer/seller terms and inclusive fiat rounding.
- `packages/contracts/src/commission-amount.ts`: each 1% rounded half-up to six decimals, then summed.
- `src/lib/commission-shortfall-ledger.ts`: current commission-only shortfall behavior. Its tolerance must never apply to escrow principal.

## Architecture for the later integrated system

```mermaid
flowchart TD
  Observer["Finalized deposit observer"] --> Ledger["Transactional custody ledger"]
  Market["Marketplace commands"] --> Ledger
  Verification["Payment verification and authorization"] --> Ledger
  Ledger --> Outbox["Durable payout outbox"]
  Outbox --> Signer["Controlled custody signer"]
  Signer --> Confirmation["Independent payout confirmation"]
  Confirmation --> Ledger
  Reconcile["Asset and liability reconciliation"] --> Ledger
```

The ledger is the financial source of truth. Marketplace cards and trade statuses are projections of its committed state. All balance changes, reservation state changes, command idempotency records, and outbox events must commit in one database transaction. Do not call a marketplace write and a wallet write in separate transactions and assume they are atomic.

The signer must run behind a separate controlled boundary. It receives only an immutable, authorized transfer intent and must apply its own allowed asset, destination, amount, operational limits, and pause checks. It must not accept arbitrary client-supplied transaction bytes. Secrets never belong in the browser, source repository, public environment variables, logs, or this chat.

The provider is intentionally undecided. An Alpha-controlled signing system and a custody-provider integration have different operational requirements. This foundation does not create a wallet under either model or claim a provider has been selected.

### Ledger and conservation rules

The executable model uses distinct allocation accounts: seller available principal, listing principal, trade reservation, payout reservation, seller commission funds, and platform commission revenue. An external contra-account balances deposits and confirmed withdrawals. These are a balanced internal custody subledger, not a complete corporate general ledger.

For each asset, the sum of internal allocations equals expected on-chain custody. Customer principal and platform revenue are separately identifiable. No asset can make another network solvent. A reservation transfers ownership of existing allocated units; it never creates additional USDT. Every journal transaction is balanced, and every command either commits all of its effects or none.

The SQL schemas use integer-checked unrestricted `NUMERIC` domains with a uint256 upper bound. A scaled `NUMERIC(78,0)` alone can round fractional input before a check, so explicit integrality checks are used. The connected schema requires a changed serialization head, `SERIALIZABLE` writes, and deferred journal constraints. The adapter retries complete serialization failures; a row lock alone does not refresh a stale snapshot. Constraint checks run on entry insertions as well as journal creation so an early `SET CONSTRAINTS` cannot leave later entries unchecked. PGlite validation and native PostgreSQL process-concurrency validation are distinct evidence; see the milestone report for actual execution results.

### Chain identity and finality

The two simulation assets intentionally have different identities and precision:

| Simulation asset | Network | Precision | Real asset intended for later separate review |
| --- | --- | ---: | --- |
| `tron-sim-usdt` | `tron-simulation` | 6 | TRON USDT |
| `bsc-sim-binance-peg-usdt` | `bsc-simulation` | 18 | Binance-Peg USDT on BNB Smart Chain |

The existing manual marketplace permits some differing listing/receiving networks. The wallet prototype deliberately requires the funded asset and payout asset to match. A bridge or cross-chain liquidity service is not implied.

Future observers must validate environment, chain, exact allowlisted contract, transfer-event index, transaction identity, recipient, raw units, canonical block identity, successful execution, and finality. The event identity is `(network, token, transaction, event index)`, rather than amount, token symbol, or transaction hash alone. Indexers discover candidates; authoritative receipt checks determine creditability. Preserve completed scan coverage and checkpoints so outages cannot falsely become “no deposits.”

TRON's documentation distinguishes broadcast success, indexing, transaction inclusion, solidification, and execution success; the last two are both needed for a valid token deposit. BSC exposes finalized state through its JSON-RPC API. These are separate chain adapters, not one arbitrary elapsed-time delay. See the primary references below.

### Outgoing transfer rules

The simulator advances an intent through `queued → submitting → submission_unknown/broadcast → confirmed/failed_final`. `failed_final` deliberately retains its reserved funds until a future reviewed recovery command establishes the safe next action. A provider timeout is not a failed payment, and a single empty lookup does not justify replacement.

Before dispatch, require fresh matching reconciliation, separately funded native network fees, an undisputed trade, complete authorization, and an unconsumed dispatch claim. Replaying the same dispatch request returns `shouldDispatch: false` with the current intent. A new request cannot create a second dispatch for the same payout. The durable offline worker now exercises provider-side idempotency and original-reference lookup with the fake provider. A real custody adapter must independently establish these guarantees using its provider's documented contract and actual test evidence.

Disputes opened before dispatch stop the outgoing action. A dispute opened after a transaction has been submitted cannot undo a blockchain broadcast: the reservation remains, and independently observed settlement must still be accounted for. No owner override may bypass the asset, balance, authorization, or duplicate-transfer invariants.

## Existing platform integration findings

| Existing boundary | Required later change |
| --- | --- |
| `createMarketplaceListing` and owner review in `alpha-exchange-store.ts` | Add funded-principal eligibility while retaining owner approval |
| `createPurchaseRequest` / accepted trade transitions | Bind chain/token/recipient and reserve principal atomically |
| `updateTradeTerms` | Resize reservations atomically within current pre-payment adjustment rules; invalidate changed authorizations |
| Current `funds_received` | Do not use as wallet authority; face-to-face presently allows a buyer-originated transition |
| Current `usdt_sent` / owner completion | Do not infer a blockchain transfer from a manual status change |
| Cancellations and disputes | Preserve reservation until safely cancellable; freeze unsent intents; distinguish in-flight outcomes |
| Completion and receipts | Derive financial completion from payout confirmation; apply benefits/history/fees once |
| `alpha-exchange-repository.ts` | Use dedicated transactional wallet commands; avoid generic snapshot replacement for ledger state |
| Mobile auth route matching | Explicitly apply phone, age, session, and role checks to wallet routes; current route regex alone does not include them |

No production integration in this table has been performed in this milestone.

## Deployment boundary

The user approved continued development and saving this branch while explicitly withholding live deployment. `vercel.json` disables automatic Git deployments for the exact branch `feature/alpha-wallet-dev-20261104`. The guard is included in the first remote branch commit. An explicit deployment API/CLI call could bypass this Git trigger setting and is outside the authorized scope.

The connected Railway Discord worker was inspected read-only: both its current and staged source branch are `main`. Its existing pending changes were not applied or modified. Existing repository workflows do not match a push to the wallet branch. The added `alpha-wallet-development.yml` runs only synthetic tests, TypeScript, offline demos, disposable PostgreSQL 17 fixtures and local Chromium rehearsals on this exact branch, with read-only repository permissions and no deployment steps or production secrets. Manual dispatch has the same branch restriction.

The original marketplace checkout and its unrelated commission work are preserved. No merge, promotion, production database write, live transfer, signing enablement, scheduled wallet worker, or application route is part of this work.

## Verification and local execution

From the repository root, using its existing pinned dependencies:

```bash
node node_modules/vitest/vitest.mjs run src/lib/alpha-wallet
NODE_ENV=development node --import tsx scripts/alpha-wallet/demo.ts
```

For an actual separate-process recovery demonstration, use fresh absolute paths:

```bash
NODE_ENV=development node --import tsx scripts/alpha-wallet/recovery-demo.ts prepare /tmp/alpha-wallet-demo /tmp/alpha-provider-demo --abrupt-exit
NODE_ENV=development node --import tsx scripts/alpha-wallet/recovery-demo.ts recover /tmp/alpha-wallet-demo /tmp/alpha-provider-demo
```

The first process exits without closing the store after the fake provider has accepted a 200 USDT transfer and its response was lost. The second process finds that original transfer, confirms it once, and proves that 300 USDT remains in custody with a separate 4 USDT commission due. This test uses synthetic funds and no network.

For real multi-process SQL contention, create an empty disposable local PostgreSQL database and run the explicitly guarded harness (the workflow provisions this fixture automatically):

```bash
NODE_ENV=test node --import tsx scripts/alpha-wallet/postgres-concurrency.ts \
  --fresh-simulation-database \
  --connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_races'
```

The harness refuses existing application schemas and never drops data. It requires two independent worker processes/backend connections to establish overlapping snapshots, checks that a whole-transaction serialization retry occurred, and exercises duplicate credit, overselling, dispatch claims, receipt deduplication, and commit-acknowledgment recovery. Its fixed fixture credentials are not production credentials.

The test runner sets a test environment. The demo explicitly opts into local development. The factory rejects production and recognized hosted runtimes, refuses mainnet/signing flags, and rechecks those conditions for mutations. The SQL draft also requires an explicit simulation-only setting before it can create its isolated schema. These are development guards, not substitutes for production security design.

The demo simulates a pending deposit, final 500 USDT funding, 200 and 300 USDT purchases, verified payment, uncertain payout response, safe duplicate handling, and separate 10 USDT commissions. It asserts that the full 500 reaches buyers and the remaining 10 is platform revenue. Its native-fee readiness is a synthetic policy fixture, not a real gas purchase or cost model.

The test report records the actual checks run and their limits. Do not describe a local green suite as an independent security audit, real blockchain test, or guarantee of bug-free operation.

## Next development milestones and exit criteria

Current acceptance evidence, open gates and owner decisions are tracked in [launch-readiness.md](launch-readiness.md). This file is the implementation overview, not a declaration that the wallet may accept live funds.

| Milestone | Concrete work | Evidence needed before advancing |
| --- | --- | --- |
| 1. Offline foundation | Domain engine, historical SQL proof, adversarial tests, executable demo — implemented | Historical phase-one verification report |
| 2. Durable development repository | Connected transactional commands/journal/outbox, immutable evidence, replay, fake-provider recovery — implemented for simulation | Current durable verification report; native concurrency execution and backup/restore evidence tracked separately |
| 2a. Recovery, access and rehearsal | Quarantined logical restore, separate-process backup CLI, trusted-user gateway, fixture receipt decoders and local bilingual UI — implemented for simulation | [Phase-three verification](phase3-verification-2026-11-04.md): 468 tests, actual native restore and Chromium English/Arabic flows passed |
| 2b. Production repository design | Auth-derived identities, production role design, version migration, checkpointing/scaling, backup/restore and operational recovery | Reviewed permissions, fault-injection evidence, restore/reconciliation exercise, realistic load tests |
| 3. Testnet adapters | Exact chain allowlists; deposit address assignment; confirmed receipt observers; cursor recovery; chosen signer/custody sandbox; gas handling | Wrong-token, finality, provider outage, timeout, duplicate webhook, and ambiguous-broadcast recovery tests |
| 4. Private integrated flow | Seller deposit/withdraw screens; funded listings; existing trade UI; Arabic/English mobile behavior; payment-verification and dispute resolution interfaces | End-to-end tests using synthetic/testnet funds; existing marketplace/commission/review/receipt regressions |
| 5. Controlled production readiness | Custody model, key recovery, authorization limits, monitoring, operations runbook, independent review, reviewed rollout | Signed-off incident/recovery exercise and acceptance evidence; separate explicit production authorization |

Open decisions that do not block this development milestone: custody provider versus Alpha-controlled signing, supported first production rail, fee and gas funding mechanism, trusted fiat/cash verification workflow, withdrawal step-up/limits and address changes, dispute adjudication and refund rules. These must be settled before live signing is implemented or enabled.

Additional implementation contracts:

- [Executed recovery and browser evidence](phase3-verification-2026-11-04.md)
- [Recovery runbook](recovery-runbook.md)
- [Access and existing-platform integration](access-and-integration.md)
- [Chain evidence adapter contract](chain-adapter-contract.md)
- [Interactive rehearsal](rehearsal.md)
- [Custody and signing decision](custody-decision.md)

## Primary technical references

Reviewed 4 November 2026. These support adapter and database design; none is a claim that its service has been connected.

- [TRON confirmation semantics](https://developers.tron.network/docs/confirmation-semantics)
- [TRON broadcast errors and safe replacement](https://developers.tron.network/docs/broadcast-and-rpc-errors)
- [BNB Chain finality API](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/bsc-api-list/)
- [BNB Chain SDK asset matrix](https://github.com/bnb-chain/mpp-sdk)
- [TronScan TRC20 token fields](https://docs.tronscan.org/en/api/tokens/token-trc20)
- [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [AWS transactional outbox guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [Fireblocks transaction idempotency](https://developers.fireblocks.com/reference/api-idempotency) — an example of why each provider needs its own adapter contract, not a custody-provider selection.
- [PGlite persistent data directory and durability options](https://pglite.dev/docs/api)
- [Vercel branch-specific deployment configuration](https://vercel.com/docs/project-configuration/git-configuration)

# Alpha Wallet — development and launch preparation

Date: 5 November 2026 (Asia/Jerusalem). Scope: architecture and **offline development only**.
Base: `0b11b21fc0de3d04e4325a748ea2de62ade4f317` (the existing marketplace main branch when this work began).
Working branch: `feature/alpha-wallet-dev-20261104`.

**New work under verification:** [prepayment cancellation groundwork](prepayment-cancellation-design.md) adds a closed V4 financial continuation, exact principal return, immutable cancellation receipt and isolated paused recovery, plus a separate canonical transaction participant. Both existing coordinated namespaces remain closed to cancellation; authenticated coupling and a successor combined recovery profile remain next. The owner has selected **Trust Wallet as the receiving-wallet preference**; [custody-decision.md](custody-decision.md) records the current capabilities and integration requirements.

**Development resumed at the user's explicit request on 5 November 2026.** The [saved pause checkpoint](PAUSED-2026-11-05.md) and [earlier checkpoint](PAUSED-2026-11-04.md) remain historical. The no-live-launch restriction remains in force; remaining implementation and owner decisions are tracked in [launch-readiness.md](launch-readiness.md).

**Latest verified source: `2c3e6a0b809f9bb34f84dcc82243593ba079ee1f`.** The [initial combined recovery verification report](initial-marketplace-recovery-verification-2026-11-05.md) records **1,913 passing tests across 56 files, with zero failures or skips**: 1,726 wallet tests across 47 files, 87 platform authentication tests across five files and 100 marketplace/storage regressions across four files. All 1,592 prior wallet cases remain, with 134 new cases. Root TypeScript, eleven native PostgreSQL drills/**117 checks** including sixteen new recovery checks, and the retained English/Arabic Chromium rehearsal passed on this exact source. [CI](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42108670720) completed successfully on 5 November 2026 at 23:10:25 IST; the [machine-readable evidence](initial-marketplace-recovery-verification-results.json) binds the source/tree, run/job, original case inventories and downloaded artifact hashes.

The [previous initial-coordinator evidence](initial-marketplace-verification-2026-11-05.md) remains separately recorded at `c11fe0e90dc96fad8e0b21901cd9093e9c2dc536`, with 1,779 tests and ten native drills/101 checks.

The [authenticated initial coordinator](initial-marketplace-coordinator-design.md) couples current stored web/mobile seller authority and explicit owner activation to one atomic full-principal reservation, canonical acceptance, original receipt and safe publication intent. The new [initial combined recovery contract](initial-marketplace-recovery-design.md) preserves that complete unit, including its activation basis and all original v1/v2/v3 history. It supports current-owner web/mobile export from a paused source, atomic fresh-target restore with a new pause and disabled identities, and offline inspection of an uncertain restore on the same target. The source-bound verification above passed; live launch remains withheld.

The [historical seller-native v3 baseline at `f18e95e6`](ledger-v3-verification-2026-11-05.md) records 1,626 passing tests, including 1,439 wallet tests across 39 files, plus root TypeScript, nine native PostgreSQL drills/86 checks and the retained English/Arabic Chromium rehearsal. It verifies the separate financial engine and isolated paused-wallet recovery; the later initial coordinator has its own evidence above.

The [historical combined recovery baseline at `09405da`](marketplace-recovery-verification-2026-11-05.md) retains its 1,081-test, six-drill/54-check result, including 83 recovery cases and 11 native recovery checks. The [earlier canonical coordinator baseline](marketplace-coordinator-verification-2026-11-05.md) is retained separately.

**Private mobile authority:** both the amount-correction and initial-acceptance coordinators use current stored access/device credentials inside the financial transaction. Each cohort now has a mobile owner export of its separate paused-source combined recovery format. The [mobile authority contract](marketplace-mobile-auth-design.md) distinguishes these scopes and retains the [historical mobile evidence](marketplace-mobile-verification-2026-11-05.md). Neither coordinator adds a public mobile route, account/trade screen, provider, signer or live deployment.

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
| Listings | Full principal funding; separate owner approval; automatic allocation after credit; partial inventory | Live marketplace funding and listing creation remain disconnected |
| Trades | Partial reservations; three active trades per seller; self-trade rejection; cancellation before payment claim | General domain policy is unchanged; the correction cohort has one clean nonterminal wallet trade, while the separate initial cohort activates one pending request and preserves the general seller-capacity rules |
| Payment/release | Exact inclusive fiat evidence; evidence reuse blocked; independent fixture verifier; seller authorization bound to principal and recipient | Production authentication routes, bank/cash evidence adapters, and policy review are still required |
| Payouts | Immutable intent; one dispatch claim; unknown/broadcast/failed/finalized outcomes; matching receipt; retained uncertain funds | No signer or real network submission |
| Withdrawals | Only unallocated seller funds; same-asset recipient; synthetic step-up marker; immutable intent | Marker is not a real MFA implementation |
| Fees | Full principal delivered; separate commission account; one post-completion due; auto-settlement when funded; unpaid dues block new seller commitments | Principal and commission tolerance are never mixed |
| Incident behavior | Dispute stops queued dispatch; account mismatch or changed finalized deposit evidence pauses new outgoing work | Resume, adjudication, and payout replacement require later controlled recovery commands |
| Accounting | Balanced journal; no negative custody allocations; conservation checks after every command; atomic durable command, journal, and outbox writes | Global serialization and replay are a correctness-oriented development bridge, not a production scaling design |
| Durable repository | Versioned strict commands; exact amounts; committed result/state hashes; append-only history; restart replay; immutable SQL projections; bounded SQL retries | File-backed PGlite or explicit loopback development PostgreSQL only; fixture identities remain synthetic |
| Recovery worker | Persist claim before submission; retain uncertain funds; look up original reference; exact final receipt; tolerate late matching reports | Explicit offline fake-provider step; standalone workers are blocked after canonical cohort activation; no registered service or cron |
| Backup and restore | Standalone v1/mixed-v2 and isolated-v3 formats; distinct combined formats for correction and initial cohorts; original history and atomic quarantine pause | Fixed development schemas; both combined targets use disabled identities and no restored web/mobile credentials; authority re-entry, source fencing and resume remain separate |
| User access boundary | Development web/mobile session-source adapters and strict gateway; both private cohorts lock actual session/account rows, expose explicit stored seller capability and recheck authority/expiry in the financial transaction | Production routes, account/trade screens and a real withdrawal step-up issuer remain required |
| Marketplace groundwork | Pure correction/initial plans; frozen v1/v2 histories; separate canonical participants in caller-owned transactions; guarded runtime-failure rollback | The private coordinators couple their bounded transitions; broader identity bindings and later lifecycle remain unfinished |
| Private amount-correction coordinator | Owner enrollment/inspection/pause; stored-session buyer acceptance; atomic canonical terms, principal delta, immutable receipt and safe publication intent; complete enrolled-listing SQL fences | One already-reserved development trade with an existing pending amount proposal; Bank Transfer/Face-to-Face only; no public route or delivery |
| Initial canonical coordinator | Stored web/mobile seller acceptance after explicit owner mapping; full-principal v3 reservation, canonical transition, original receipt and safe publication commit once; SQL fences order legacy writers | One clean ordinary pending request; original business retries require current authority; separate combined recovery is implemented; later lifecycle, public routes and delivery remain open |
| Versioned ledger continuation | Explicit atomic v1-to-v2 migration; unchanged historical prefix; durable synthetic enrollment, principal-delta corrections and immutable proposal receipts; inherited standalone settlement/recovery and mixed-history backup | The private coordinator adds canonical SQL/auth coupling; its active cohort fences unsupported settlement, worker and standalone-backup paths |
| Chain evidence | Strict BSC/TRON receipt decoding, event identity, exact units, execution status and supplied canonical ancestry | Pure fixture consistency; no live RPC, consensus proof, authoritative finality source or automatic credit |
| Interactive rehearsal | Persistent loopback app with English/Arabic flows, partial trades, fee accounting and fault recovery | Explicit synthetic role switcher; not real account authentication or a deployed product |
| Seller-native ledger v3 | Explicit v2 continuation; seller-authored initial full-principal reservation at retained terms; immutable binding/receipt; strict SQL and isolated paused recovery | The financial contract is unchanged; the separate initial coordinator supplies stored authority and canonical coupling; later lifecycle remains unfinished and combined initial recovery has its own separate format |
| SQL proof | Connected durable/v2/v3 schemas, correction-coordination schema, and separate initial-cohort preflight/tables/guards; retained historical `schema-draft.sql` | Explicit isolated development initialization only; none is registered as a production application migration |

## Durable development repository

`commands.ts` defines a strict versioned command envelope. No request can name arbitrary executable methods, provide extra authority fields, or introduce an unknown asset/engine version. The durable harness uses fixture actors. The separate development access gateway derives actors through the platform session-source adapters. The private canonical coordinators derive web or mobile authority from the corresponding actual session/account rows in their own transaction; no production HTTP wallet boundary is connected.

`durable.ts` rebuilds the domain engine from committed commands under their recorded timestamps. It verifies every command identity, result digest, state digest, previous-event hash, head revision, normalized journal entry, payout intent/state transition, and chain-event claim before processing more work. Unknown versions, missing history, altered projections, or mismatching evidence stop the operation. Hashes detect inconsistent storage; they are not signatures or protection against an administrator who can rewrite the complete database and application together.

Each new command updates one head row first, then commits its log entry, normalized accounting entries, payout projection, evidence claims, and new head in one `SERIALIZABLE` transaction. Updating the head forces a stale waiting transaction to fail and retry the complete command. Duplicate commands return their original revision/event hash. A duplicate dispatch claim returns `shouldDispatch: false` with the current payout, never a cached instruction to send again.

The repository has two explicit development transports:

- `createFileWalletStore`: a marked local container directory with persistent PGlite data, strict durability, exact string numeric parsers, and one open database instance per canonical path in the process. Concurrent processes must use native PostgreSQL rather than sharing an open PGlite directory.
- `createPostgresWalletStore`: an explicit URL using only `127.0.0.1` or `::1`, explicit fixture credentials, and a database named `alpha_wallet_dev_*`. Ambient application/database URLs are never read. Whole transactions retry bounded serialization/deadlock failures. An uncertain COMMIT reply discards the connection and raises `ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN`; it does not assume rollback or automatically resend.

The SQL namespace is private and uses forced RLS without client policies. Tests therefore need a superuser or `BYPASSRLS` fixture role; merely owning the database is insufficient. This is deliberately not a production authentication/role design.

The file-backed fake provider keeps immutable broadcasts separately from the wallet database. Its reference binds the asset, destination, amount, and payout ID. Atomic publication, exact comparison of duplicate requests, and separate finality records let tests reproduce acceptance with a lost response. The worker persists the dispatch claim before calling this provider. If a claim exists but lookup finds nothing, it keeps the reservation and requests resolution; an empty lookup never authorizes a second submission. A late report cannot downgrade a confirmed or failed transfer.

Replay is intentionally bounded to 100,000 commands and serializes the whole development wallet. It is not an authenticated append-only service or a production performance implementation. Standalone logical backups use the same verified replay, with a stricter 1,000-command/16 MiB limit and atomic restore quarantine. They omit canonical coordination records and refuse coordinated sources. Separate combined formats cover the original v2 amount-correction cohort and the explicitly activated initial v3 cohort. Both require paused sources and fresh, paused targets with credential quarantine. The initial format reserves room for its new pause with a stricter 999-source-command limit and preserves the original activation basis, complete financial/canonical evidence and receipts together. Production identity recovery, provenance, checkpointing and performance remain open. Never change a recorded engine version to make old history pass.

### Explicit v2 continuation

The separate `versioned-durable.ts` repository reads the unchanged v1 prefix and permits one explicit `upgradeDurableWalletV2` operation. The upgrade checks the complete checkpoint and original SQL projections, applies the development migration, records its continuation and advances the storage format in one transaction. Ordinary initialization does not upgrade a database. After continuation, old v1 writers fail closed; exact historical commands remain recoverable through the versioned repository with their original revision and hash. A historical dispatch retry always returns `shouldDispatch: false`.

An operator fixture can enroll an existing clean reservation, then a buyer fixture can accept an amount correction derived from the canonical planner. Increasing or decreasing the amount moves only the difference between the same listing and trade accounts; a zero-delta acceptance records its receipt without moving money. Price, participants, asset, destination, payment instructions and fee policy stay bound. The original trade can then settle its corrected full principal, with commissions still funded separately. Proposal identity prevents different transport request IDs from applying the same acceptance twice.

This implements the ledger side of the [v2 continuation contract](ledger-v2-continuation-design.md). Its standalone fixtures supply synthetic marketplace evidence. The private canonical coordinator described below couples the actual focused marketplace SQL and stored-session checks to this ledger in an isolated development database. The existing web entry point and new mobile entry point share that financial implementation. The separate initial coordinator below supplies ordinary initial acceptance over v3. Broader lifecycle integration, product routes and external publication remain required before connecting these behaviors to real users. Installing the v2 ledger tables alone does not activate a canonical marketplace cohort.

For sources without canonical marketplace activation, `versioned-backup.ts` accepts pure v1 and mixed histories without rewriting them. A mixed restore replays the explicit upgrade and appends a v2 pause within the same transaction. `versioned-payout-worker.ts` adapts the existing conservative fake-provider worker for explicitly upgraded standalone stores; it registers no service and never automatically upgrades a wallet. Both standalone access paths are fenced after canonical activation. The original backup CLI and browser rehearsal continue to use v1.

### Private amount-correction marketplace coordinator

The [coordinator contract](marketplace-coordinator-design.md) describes the server-only development boundary. `createDevelopmentMarketplaceWalletCoordinator` retains its web-session API. The new `createDevelopmentMobileMarketplaceWalletCoordinator` supplies the same operations using an access token and strict device/platform/app-version/locale metadata. Each owns one guarded `WalletStore` transaction for canonical reads, its fixed authentication reader, wallet replay/commands and marketplace persistence. Strict inputs accept operation identities; the server derives the actor and all financial terms. No production `updateTradeTerms` wrapper, public route or mobile endpoint is connected.

Owner enrollment requires an already accepted canonical request, an existing clean funded/approved wallet reservation and a valid stored pending `amount_correction` proposal at the locked unit price. This correction cohort supports current ILS policies, Bank Transfer and Face-to-Face. The target must be the only active canonical reservation on its listing and the only nonterminal wallet trade globally, with no unfinished payout. This development activation restriction does not change the general three-active-trades-per-seller policy.

| Private operation | Authority and result |
| --- | --- |
| `enrollReservedTrade` | A freshly authenticated stored owner binds the existing canonical request to its existing wallet reservation; enrollment does not accept the proposal |
| `acceptAmountCorrection` | The freshly authenticated canonical buyer accepts the stored proposal; canonical terms, the exact principal delta, original receipt, system message, seller notification, dedicated audit and safe publication intent commit together |
| `inspect` | The stored owner reads a bounded verified view of current terms, balances, pause state and original ledger metadata |
| `pause` | The stored owner appends the typed pause command; there is no resume operation |

The web and mobile principal readers use the same transaction's actual session/account rows and hold `FOR SHARE` locks through commit or rollback. They share account eligibility rules for normalized/payload coherence, disabled state, email/phone/adult evidence and roles. The mobile reader additionally binds the access token to the stored device/session, platform, token family/generation and expiry, and enforces the current minimum app version. It neither issues nor refreshes tokens. Ownership is checked before historical receipt lookup, and authority/expiry are checked again after awaited persistence. Concurrent revocation is ordered by the locks; this is not a claim that a queued revocation cancels an already authorized transaction or that COMMIT acknowledgement precedes wall-clock expiry. The separate standalone session-source adapters keep their existing reread contract. See [transaction-owned mobile authority](marketplace-mobile-auth-design.md).

An acceptance retry with the same buyer, request, proposal and expected binding revision recovers the original receipt even with a different transport operation ID, a new valid session, a switch between web and mobile, or after owner pause. Current authority is still required; revoked credentials cannot recover receipts. Recovery verifies the stored receipt and original command/event hash against wallet history; public results omit session credentials/hashes, private profiles, receiving destinations and bank instructions. The publication record is a durable intent only: no realtime event, external notification, provider request or signer is invoked.

After enrollment, database guards freeze unsupported mutations across the enrolled listing and its related requests/evidence/disputes/trades/commissions/events. Standalone wallet commands, snapshots, workers and wallet-only exports fail closed. Use the coordinator's owner inspection/pause and preserve the complete isolated source. Use the separate [combined recovery protocol](marketplace-recovery-design.md) for a paused supported cohort; the [recovery runbook](recovery-runbook.md) separates it from standalone backup procedures. Its restored target always receives a new pause and disabled credential-free identity stubs. Sessions and old transaction registrations are excluded, and account-authority re-entry/resume remain unsupported.

Initial trade acceptance, subsequent proposals, payment/cancellation/dispute/release/settlement transitions, public web/mobile routes and delivery remain outside this cohort. The earlier web implementation retains its [historical verification](marketplace-coordinator-verification-2026-11-05.md). The private mobile addition passed [exact-source verification at `47f0fc18`](marketplace-mobile-verification-2026-11-05.md); the complete production wallet lifecycle remains unfinished.

### Combined recovery for the paused amount-correction cohort

`exportMarketplaceWalletBackup` authenticates the stored web owner inside the actual marketplace transaction and requires an existing pause. The new `exportMobileMarketplaceWalletBackup` uses the corresponding current mobile owner credentials and the same financial export implementation. For the same source state, owner and export clock, both produce the same bytes. They capture the supported canonical tables together with original mixed wallet history and enrollment/acceptance/publication records. Validation replays both engines, reconstructs the original acceptance preconditions, checks exact principal and event relationships, and rejects precision loss across the database boundary.

The new source compatibility accepts either neither mobile authentication table or the exact known `mobile_device_sessions` / `mobile_refresh_token_history` pair. Those tables and all their credentials, hashes, device identifiers and refresh history are excluded from the unchanged recovery format. Partial or malformed table pairs are refused.

`restoreMarketplaceWalletBackup` validates the complete bytes and separately retained checksum before opening a fresh target. One transaction replays the old history, appends a checksum-bound recovery pause, restores canonical and immutable coordination records, installs the common unchanged guards and seals an immutable recovery receipt. A deferred constraint refuses an incomplete restore. All sessions/passwords are excluded; account identities become disabled stubs. Neither mobile authentication table is created, and the new quarantine checks require both to remain absent, including at restore COMMIT. This preserves financial references without reviving old credentials.

If COMMIT acknowledgement is lost, `inspectRestoredMarketplaceWallet` verifies that same target against its retained checksum, complete history, final pause and record digests. It is an offline database-capability diagnostic, not a login override. The source stays paused, the target stays paused, and this implementation provides no authority re-entry, resume, provider call or notification delivery. See [the recovery contract](marketplace-recovery-design.md) for exact limits and [the runbook](recovery-runbook.md) for handling.

### Initial seller acceptance groundwork

The [initial-acceptance contract](initial-acceptance-design.md) separates the pure seller acceptance plan from canonical SQL persistence and from the separate [seller-native v3 financial command](ledger-v3-initial-acceptance-design.md). The plan retains the buyer request, preallocated trade ID, frozen price/payment instructions, exact full principal and policy dependencies. It checks buyer history across sellers, review/commission obligations, seller capacity/approval, blocks/enforcement and funding. Its immutable result has `executionAuthority: false`.

The new participant certifies one caller-owned SERIALIZABLE transaction, reads normalized and payload identity links, rejects precision/time mismatches and constructs a bounded target request/trade/listing/event write set. It handles either an absent physical trade projection or an exact pending projection left by a full snapshot. Canonical `availableAmount` stays unchanged. Both this participant and the retained focused participant now ensure a swallowed runtime-guard error cannot commit a prior wallet write.

The initial financial planner refuses competing target-listing reservations, noncancelled target wallet-listing history and other active seller wallet trades whose canonical relationships are unproved. Equal amounts cannot establish identity. Supporting these histories needs complete one-to-one bindings; the general three-active-trade policy remains unchanged.

[Exact-source verification at `3d119889`](initial-acceptance-verification-2026-11-05.md) includes actual native commit/rollback, stale cross-seller buyer history, competing acceptance, injected response loss and reopen checks. The companion wallet command is an independently authorized synthetic operator pause, leaving all 500 USDT in listing inventory and creating no reservation. This is transaction groundwork, not an authenticated wallet-backed sale or new recovery format. The successor v3 milestone supplies the separate financial reservation; the later initial coordinator below connects it to canonical acceptance with fresh stored seller authority. Neither successor changes the original pause-only fixture or its historical evidence.

### Seller-native v3 financial continuation

The [v3 contract](ledger-v3-initial-acceptance-design.md) explicitly continues a verified v2 wallet and adds only initial seller acceptance and operator pause. It preserves the old command/result/state/event hashes, uses the seller as the recorded actor, and retains the buyer request separately. New initial bindings and receipts do not become old v2 enrollments or corrections.

The financial command reserves full principal at the retained request price even when the current wallet listing price differs. Its business receipt recovers the original command and event under a different transport operation ID without a second reservation. SQL guards enforce command, journal, binding and receipt coherence and seal historical projections. No new funding, correction, payment, cancellation, dispute, release, payout, settlement or resume operation is available after v3 continuation.

The distinct format-3 backup requires a paused isolated source, preserves all three engine histories, and restores into a fresh target with another quarantine pause. It refuses canonical and coordination schemas, including the new initial namespace. [Verification at `f18e95e6`](ledger-v3-verification-2026-11-05.md) proves that financial/recovery boundary. The separate coordinator below adds stored seller authority, canonical acceptance and activation/writer fences; its new combined recovery format is separate from isolated format 3. The old initial canonical mechanics fixture still uses its synthetic companion pause.

### Authenticated initial marketplace coordinator

The [initial coordinator contract](initial-marketplace-coordinator-design.md) defines separate private web and mobile constructors with owner `activateRequest`, `inspect` and `pause`, and seller `acceptRequest`. Activation binds one exact pending request to explicit platform/wallet identities and verified v3 funding. It captures clean canonical history without moving principal or supplying seller consent. Actual acceptance requires current stored `canSell`, exact seller ownership and the seller's Face-to-Face acknowledgment when applicable.

One SERIALIZABLE transaction owns complete canonical policy reads, stored session/account locks, v3 replay, the full-principal reservation, pending-to-accepted request/trade/listing persistence, immutable original receipt and safe publication intent. Acceptance uses the retained buyer request price: the standard fixture reserves 200 USDT from 500, leaving 300 available, while the canonical listing's `availableAmount` remains unchanged. Fees remain separate. The stored seller authorizes the action; the retained buyer identity is never impersonated.

The new `alpha_wallet_initial_marketplace_simulation` namespace freezes the selected listing and pending siblings, rejects unsupported standalone wallet/lifecycle writers, and versions the canonical runtime before dependency writes so old snapshots must retry the complete decision. Current seller/buyer eligibility, commissions, reviews, blocks and the general three-active-trade policy remain intact. Valid retries across web/mobile recover one original receipt after fresh authority checks, including after pause or a missing COMMIT reply. Public projections omit credentials, private canonical payloads, destinations and bank instructions. No external dispatcher is installed.

### Initial combined recovery

The [separate recovery format](initial-marketplace-recovery-design.md) captures an explicitly activated and paused initial cohort, either awaiting acceptance or after its original seller acceptance. It preserves the original activation basis, all v1/v2/v3 commands, complete supported canonical records, original bindings/receipts and deterministic events/publication. Timestamps retain database microseconds, binary evidence retains exact bytes, and large integer metadata remains exact. Existing standalone and correction formats continue rejecting this namespace.

Current stored owners can export through either fixed web/mobile credential reader. Restore validates the bytes and separately retained checksum before opening the destination, refuses any existing target state, and installs the original records plus exactly one new pause in a single SERIALIZABLE transaction. Recovered accounts are disabled, web sessions are empty, and both mobile authentication tables remain absent. Same-target inspection verifies the immutable recovery receipt after a lost COMMIT reply. Neither operation authorizes resume or another active copy. The [runbook](recovery-runbook.md) records the concrete procedure and remaining production boundaries.

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
| `createPurchaseRequest` / accepted trade transitions | Private ordinary initial acceptance now atomically binds retained terms and reserves full principal; public request creation, wider cohorts and production transitions remain disconnected |
| `updateTradeTerms` | The private coordinator now atomically accepts an existing amount proposal through actual focused SQL; the production wrapper and other proposal/lifecycle operations remain separate |
| Current `funds_received` | Do not use as wallet authority; face-to-face presently allows a buyer-originated transition |
| Current `usdt_sent` / owner completion | Do not infer a blockchain transfer from a manual status change |
| Cancellations and disputes | Preserve reservation until safely cancellable; freeze unsent intents; distinguish in-flight outcomes |
| Completion and receipts | Derive financial completion from payout confirmation; apply benefits/history/fees once |
| `alpha-exchange-repository.ts` | Focused and initial participants share one transaction with their respective private coordinators and listing-wide SQL fences; broader lifecycle extraction and production cutover remain |
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

The focused marketplace participant has a separate native fixture using the actual repository read/write statements and a fresh database:

```bash
NODE_ENV=test node --conditions=react-server --import tsx scripts/alpha-wallet/postgres-marketplace-transaction.ts \
  --fresh-simulation-database \
  --connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_marketplace'
```

It pairs trade-note updates with synthetic wallet commands to check shared commit, rollback even after a swallowed callback error, stale-snapshot retry and original-identity recovery. It does not perform business acceptance or resize. The `react-server` condition permits the repository's existing server-only imports in this explicit Node fixture.

The amount-correction coordinator has its own native fixture using three distinct, already-created empty loopback databases:

```bash
NODE_ENV=test node --conditions=react-server --import tsx scripts/alpha-wallet/postgres-marketplace-coordinator.ts \
  --fresh-simulation-databases \
  --atomic-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_coordinator_atomic' \
  --race-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_coordinator_races' \
  --auth-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_coordinator_auth'
```

It exercises actual canonical enrollment/acceptance, cross-domain rollback, enrolled-writer fences, concurrent acceptance, stale session/account authority, visible authentication-row waits and original receipt recovery after a lost response. It neither creates/drops databases nor reads ambient application URLs. [All 16 checks passed at `ecc3752`](marketplace-coordinator-verification-2026-11-05.md), alongside the previous four native drills. The existing Chromium checks remain evidence for the standalone rehearsal, since this coordinator adds no UI.

The separate combined recovery drill requires three different, already-created empty loopback databases. It checks all three before writing, then exercises exact export/restore, late SQL rollback, same-target recovery after a lost acknowledgement, credential quarantine and two competing restores:

```bash
NODE_ENV=test node --conditions=react-server --import tsx scripts/alpha-wallet/postgres-marketplace-backup.ts \
  --fresh-simulation-databases \
  --source-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_combined_source' \
  --target-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_combined_restore' \
  --race-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_combined_races'
```

These are disposable fixture credentials. The drill does not create/drop databases or restore an existing application database; it is separate from the recovery API procedure in the [runbook](recovery-runbook.md).

The new [native mobile drill](../../scripts/alpha-wallet/postgres-marketplace-mobile.ts) uses three different, already-created empty loopback databases for mobile authority races, cross-transport receipt recovery and credential-free restore:

```bash
NODE_ENV=test node --conditions=react-server --import tsx scripts/alpha-wallet/postgres-marketplace-mobile.ts \
  --fresh-simulation-databases \
  --atomic-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_mobile_atomic' \
  --auth-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_mobile_auth' \
  --restore-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_mobile_restore'
```

It checks every database before fixture writes, uses the retained real mobile table shape and observes native backend row/advisory waits. Token changes use explicit fixture SQL; no production mobile service is contacted. [All 12 mobile checks passed at `47f0fc18`](marketplace-mobile-verification-2026-11-05.md), alongside all six retained native drills, for 66 checks in total. Response loss is injected after a real COMMIT; it is not a physical network partition.

The test runner sets a test environment. The demo explicitly opts into local development. The factory rejects production and recognized hosted runtimes, refuses mainnet/signing flags, and rechecks those conditions for mutations. The SQL draft also requires an explicit simulation-only setting before it can create its isolated schema. These are development guards, not substitutes for production security design.

The demo simulates a pending deposit, final 500 USDT funding, 200 and 300 USDT purchases, verified payment, uncertain payout response, safe duplicate handling, and separate 10 USDT commissions. It asserts that the full 500 reaches buyers and the remaining 10 is platform revenue. Its native-fee readiness is a synthetic policy fixture, not a real gas purchase or cost model.

The test report records the actual checks run and their limits. Do not describe a local green suite as an independent security audit, real blockchain test, or guarantee of bug-free operation.

The initial acceptance mechanics drill requires two additional fresh databases:

```bash
NODE_ENV=test node --conditions=react-server --import tsx scripts/alpha-wallet/postgres-initial-acceptance.ts \
  --fresh-simulation-databases \
  --atomic-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_initial_atomic' \
  --race-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_initial_races'
```

It checks database emptiness before setup, uses explicit synthetic identities and never reads an environment database URL. Both wallets finish paused. The [nine executed checks](initial-acceptance-verification-2026-11-05.md) prove bounded canonical/transaction mechanics; no seller reservation or initial-acceptance receipt recovery is claimed.

The separate seller-native financial drill requires three fresh databases:

```bash
NODE_ENV=test node --conditions=react-server --import tsx scripts/alpha-wallet/postgres-v3-ledger.ts \
  --fresh-simulation-databases \
  --source-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_v3_source' \
  --race-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_v3_races' \
  --target-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_v3_restore'
```

Its [eleven executed checks](ledger-v3-verification-2026-11-05.md) cover the explicit migration, exact seller reservation, native contention, rollback, immutable projections, original receipts and isolated paused recovery. It creates no canonical marketplace rows or authenticated seller sessions. All source/target wallets finish paused; there are no provider submissions.

The separate authenticated initial-coordinator drill requires three fresh databases:

```bash
NODE_ENV=test node --conditions=react-server --import tsx scripts/alpha-wallet/postgres-initial-marketplace.ts \
  --fresh-simulation-databases \
  --atomic-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_initial_marketplace_atomic' \
  --race-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_initial_marketplace_races' \
  --auth-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_initial_marketplace_auth'
```

It checks all three databases before fixture writes, using actual stored synthetic web/mobile credentials and canonical SQL. It exercises atomic initial reservation/acceptance, rollback, original cross-transport receipts after a lost reply, complete-decision retries behind acceptance/legacy writers, seller-status and mobile-session ordering, and reopened paused sources. The three native fixture sources end paused. This is a development verification harness, not a backup/restore procedure. [All 15 checks passed at `c11fe0e9`](initial-marketplace-verification-2026-11-05.md), alongside all nine retained native drills, for 101 checks in total. The report distinguishes actual backend waits/retries from the injected lost-COMMIT-reply scenario.

The initial combined recovery drill uses four distinct, already-created empty loopback databases and fixed UTC database sessions:

```bash
NODE_ENV=test TZ=UTC node --conditions=react-server --import tsx scripts/alpha-wallet/postgres-initial-marketplace-backup.ts \
  --fresh-simulation-databases \
  --source-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_initial_backup_source' \
  --activated-source-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_initial_backup_activated' \
  --target-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_initial_backup_target' \
  --race-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_initial_backup_races'
```

The harness checks all four databases before fixture writes. It exercises accepted and awaiting-acceptance sources, current web/mobile owner export, complete original records, three late SQL faults, credential quarantine, same-target inspection after a lost reply, and competing fresh-target claims. Database server/session timezone must also be UTC; the Node `TZ` setting alone does not configure a separate database server. See the [initial recovery design](initial-marketplace-recovery-design.md) for the contract and limits. [All sixteen native checks passed on the current source](initial-marketplace-recovery-verification-2026-11-05.md), alongside all ten retained drills, for 117 native checks in total.

## Next development milestones and exit criteria

Current acceptance evidence, open gates and owner decisions are tracked in [launch-readiness.md](launch-readiness.md). This file is the implementation overview, not a declaration that the wallet may accept live funds.

| Milestone | Concrete work | Evidence needed before advancing |
| --- | --- | --- |
| 1. Offline foundation | Domain engine, historical SQL proof, adversarial tests, executable demo — implemented | Historical phase-one verification report |
| 2. Durable development repository | Connected transactional commands/journal/outbox, immutable evidence, replay, fake-provider recovery — implemented for simulation | Current durable verification report; native concurrency execution and backup/restore evidence tracked separately |
| 2a. Recovery, access and rehearsal | Quarantined logical restore, separate-process backup CLI, trusted-user gateway, fixture receipt decoders and local bilingual UI — implemented for simulation | [Phase-three verification](phase3-verification-2026-11-04.md): 468 tests, actual native restore and Chromium English/Arabic flows passed |
| 2a extension. Marketplace transaction groundwork | Pure canonical acceptance planner, frozen v1 history and actual focused SQL participant — implemented for simulation | [Groundwork verification](marketplace-groundwork-verification-2026-11-04.md): 800 tests and all three native PostgreSQL drills passed |
| 2a extension. Versioned ledger | Explicit continuation/migration, synthetic enrollment, delta-only corrections, receipts, inherited recovery and mixed backup — implemented for simulation | [Previous versioned baseline](ledger-v2-verification-2026-11-05.md): `08fb7fa`, 879 tests, four native drills and the retained browser rehearsal |
| 2a extension. Private canonical coordinator | Same-transaction stored web auth, owner enrollment/inspection/pause, existing-proposal acceptance, canonical/wallet receipts and listing-wide fences — implemented for the bounded development cohort | [Verified at `ecc3752`](marketplace-coordinator-verification-2026-11-05.md): 998 tests, five native drills and the retained browser rehearsal; production recovery and the remaining lifecycle remain separate gates |
| 2a extension. Combined cohort recovery | Owner-authenticated paused export; original canonical/wallet history restored together; new quarantine, immutable recovery receipt and same-target outcome inspection | [Verified at `09405da`](marketplace-recovery-verification-2026-11-05.md): 1,081 tests and six native drills/54 checks; fixed development schema only, with authority re-entry, resume and production recovery still separate |
| 2a extension. Private mobile authority | Current mobile session/account locks inside the existing financial transaction; cross-transport original receipts; mobile owner export and credential-free recovery compatibility | [Verified at `47f0fc18`](marketplace-mobile-verification-2026-11-05.md): 1,203 tests, seven native drills/66 checks, full-project TypeScript and the retained browser rehearsal; no public mobile route or lifecycle expansion |
| 2a extension. Initial seller acceptance groundwork | Pure seller plan, dedicated canonical participant, frozen v2 history and swallowed-runtime-error rollback hardening | [Verified at `3d119889`](initial-acceptance-verification-2026-11-05.md): 1,390 tests, eight native drills/75 checks, root TypeScript and retained browser rehearsal; the financial and authenticated-coordinator successors are separate milestones below |
| 2a extension. Seller-native financial v3 | Explicit continuation, initial full-principal seller reservation, immutable business receipt, strict SQL and paused isolated format-3 recovery | [Verified at `f18e95e6`](ledger-v3-verification-2026-11-05.md): 1,626 tests, nine native drills/86 checks; the later coordinator and distinct combined recovery preserve this financial contract |
| 2a extension. Authenticated initial coordinator | Stored web/mobile seller authority, explicit owner mapping, atomic canonical acceptance/full-principal reservation, original receipts and complete listing/dependency fences | [Verified at `c11fe0e9`](initial-marketplace-verification-2026-11-05.md): 1,779 tests, ten native drills/101 checks, root TypeScript and retained browser rehearsal; the later combined recovery milestone is separate; broader bindings, later lifecycle and product routes remain open |
| 2a extension. Initial combined recovery | Distinct full v1/v2/v3 and canonical bundle; web/mobile owner export; fresh atomic paused restore; disabled identities; same-target unknown-COMMIT inspection | [Verified at `2c3e6a0b`](initial-marketplace-recovery-verification-2026-11-05.md): 1,913 tests, eleven native drills/117 checks, TypeScript and retained Chromium rehearsal. Current schemas and old formats remain distinct; no authority re-entry or resume |
| 2b. Production repository design | Auth-derived identities, production role design, version migration, checkpointing/scaling, backup/restore and operational recovery | Reviewed permissions, fault-injection evidence, restore/reconciliation exercise, realistic load tests |
| 3. Testnet adapters | Exact chain allowlists; deposit address assignment; confirmed receipt observers; cursor recovery; chosen signer/custody sandbox; gas handling | Wrong-token, finality, provider outage, timeout, duplicate webhook, and ambiguous-broadcast recovery tests |
| 4. Private integrated flow | Seller deposit/withdraw screens; funded listings; existing trade UI; Arabic/English mobile behavior; payment-verification and dispute resolution interfaces | End-to-end tests using synthetic/testnet funds; existing marketplace/commission/review/receipt regressions |
| 5. Controlled production readiness | Custody model, key recovery, authorization limits, monitoring, operations runbook, independent review, reviewed rollout | Signed-off incident/recovery exercise and acceptance evidence; separate explicit production authorization |

Open decisions that do not block this development milestone: custody provider versus Alpha-controlled signing, supported first production rail, fee and gas funding mechanism, trusted fiat/cash verification workflow, withdrawal step-up/limits and address changes, dispute adjudication and refund rules. These must be settled before live signing is implemented or enabled.

Additional implementation contracts:

- [Initial combined recovery contract](initial-marketplace-recovery-design.md)
- [Initial combined recovery exact-source verification](initial-marketplace-recovery-verification-2026-11-05.md)
- [Initial combined recovery machine-readable evidence](initial-marketplace-recovery-verification-results.json)
- [Current development checkpoint and next implementation](development-checkpoint-2026-11-05.md)
- [Executed recovery and browser evidence](phase3-verification-2026-11-04.md)
- [Platform session integration verification](platform-verification-2026-11-04.md)
- [Marketplace transaction groundwork verification](marketplace-groundwork-verification-2026-11-04.md)
- [Versioned ledger continuation and recovery verification](ledger-v2-verification-2026-11-05.md)
- [Authenticated initial coordinator contract](initial-marketplace-coordinator-design.md)
- [Initial-coordinator exact-source verification](initial-marketplace-verification-2026-11-05.md)
- [Initial-coordinator machine-readable evidence](initial-marketplace-verification-results.json)
- [Historical 1,626-test seller-native v3 and nine-drill verification](ledger-v3-verification-2026-11-05.md)
- [Seller-native v3 financial and isolated recovery contract](ledger-v3-initial-acceptance-design.md)
- [Historical 1,390-test initial acceptance groundwork and eight-drill verification](initial-acceptance-verification-2026-11-05.md)
- [Initial seller acceptance groundwork and successor boundaries](initial-acceptance-design.md)
- [Historical 1,203-test mobile coordination and seven-drill verification](marketplace-mobile-verification-2026-11-05.md)
- [Historical 1,081-test combined recovery and six-drill verification](marketplace-recovery-verification-2026-11-05.md)
- [Combined marketplace/wallet recovery contract](marketplace-recovery-design.md)
- [Recovery runbook](recovery-runbook.md)
- [Access and existing-platform integration](access-and-integration.md)
- [Atomic marketplace terms integration design](transaction-integration-design.md)
- [V2 ledger continuation and resize contract](ledger-v2-continuation-design.md)
- [Private canonical marketplace coordinator](marketplace-coordinator-design.md)
- [Transaction-owned mobile marketplace authority](marketplace-mobile-auth-design.md)
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

# Alpha Wallet: v2 continuation and reservation corrections

Status: **implemented for the isolated development ledger; production marketplace integration remains unfinished**. This extends the [shared-transaction groundwork](transaction-integration-design.md). It does not activate a marketplace cohort, register an application migration, connect a public route or authorize deployment.

The separate [private canonical coordinator](marketplace-coordinator-design.md) now connects a bounded Bank Transfer/Face-to-Face development cohort without changing these v1/v2 engine files. Once that cohort is explicitly enrolled, standalone wallet operations and wallet-only export are fenced; use its typed owner inspection/pause and preserve both domains together. Broader lifecycle, mobile, delivery and combined recovery integration remain unfinished.

[Coordinator verification at `ecc3752`](marketplace-coordinator-verification-2026-11-05.md) passed 998 tests, full-project TypeScript, five native PostgreSQL drills and the existing browser rehearsal. Its 16 new native checks supplement the original ledger/mixed-restore evidence below; they do not establish combined marketplace/wallet backup support.

The original design was reviewed against development commit `44ac6c4` and the frozen v1 fixtures. The implementation adds separate v2 files; it leaves the original v1 engine, command parser, durable repository, schema, backup and frozen history unchanged. [Exact-source verification at `08fb7fa`](ledger-v2-verification-2026-11-05.md) passed 879 tests, full-project TypeScript, four native PostgreSQL drills and the retained browser rehearsal. The new native v2 drill passed all nine checks; focused local tests alone are not the basis for that result.

## Explicit version boundary

`upgradeDurableWalletV2` in [versioned-durable.ts](../../src/lib/alpha-wallet/versioned-durable.ts) owns one transaction through the supplied guarded development store. It verifies the entire v1 history and all original SQL projections, validates the operator command and expected checkpoint, applies [durable-v2-migration.sql](durable-v2-migration.sql), appends one `continueFromV1` command and advances the head to storage format 2. The checkpoint binds revision, event hash, state hash and last command timestamp. A failed upgrade rolls back both schema and history. Ordinary v1 initialization never upgrades a store.

The continuation moves no money. V2 metadata is added only after cloning the verified v1 state at this boundary. The original prefix keeps every command, timestamp, result, journal, projection and hash. Replay reconstructs that prefix with the unchanged original engine, then applies the separate strict v2 reducer. It rejects unknown versions, a second continuation and new v1 commands after transition.

Inherited v1 operations must run against current balances and corrected terms. [v2-kernel.ts](../../src/lib/alpha-wallet/v2-kernel.ts) is a separately pinned copy of the original reducer with only its constructor/factory changed to hydrate a validated state. Tests compare the source transformation and replay every frozen v1 result/state hash. Replaying v1 from genesis after a correction would erase that correction; the hydrated kernel avoids that error while retaining the existing settlement rules.

## Historical and proposal retries

The durable command identity remains the version-independent tuple `[actor.kind, actor.id, type, requestId]`. A version change cannot create a fresh identity for an old financial operation. Exact historical retries through the versioned repository retain their original revision, event hash and result. Changed payload or engine version under the same key fails. Historical `beginDispatch` retries always return `shouldDispatch: false` and the current payout state.

Each accepted proposal also has an immutable business identity derived from `(platformRequestId, proposalId)`, independent of transport request ID. Its receipt binds the buyer and complete accepted input evidence. Different transport IDs carrying that same original evidence return the first receipt without another command, journal or revision. Reusing the proposal with changed actor or evidence fails. The lookup occurs before current eligibility checks so an earlier accepted correction remains recoverable after another proposal, payment progress or a pause.

This ledger API requires the original input evidence for an exact business retry. The separate private coordinator authenticates the stored web session, verifies current ownership and resolves its immutable historical receipt before rebuilding a plan from newer marketplace state. A future public/mobile boundary must preserve that contract. A client-supplied buyer ID or source digest is not authentication.

## Supported development correction

The first cohort is a clean, already-reserved, current-policy ILS trade on an open, funded, owner-approved listing. Explicit operator enrollment records canonical platform/wallet identities, participants, asset/network/destination, currency/payment method, a payment-instruction digest, both fee versions, exact principal/fees/fiat, and the original terms and reservation digests. Enrollment verifies those fields against the existing reservation and the immutable wallet listing price. Binding revision starts at zero and enrollment moves no funds.

`acceptAmountCorrection` requires the bound buyer, an unchanged full wallet checkpoint and binding, the canonical planner digest, advancing submitted-proposal count within the existing limit of two, and a still-clean reservation. Payment claims, verification evidence, release authorization, payouts, commissions and disputes lock that reservation. An increased commitment is also blocked by unpaid seller commissions.

| Correction | Committed ledger effect |
| --- | --- |
| Increased principal | Move only the increase from the same listing account to the same trade account; reject insufficient inventory. |
| Decreased principal | Move only the decrease from that trade back to its original open listing account. |
| Unchanged principal | Record the acceptance receipt and terms revision without adding a journal. |

All three paths retain price, participants, asset, receiving destination, currency, payment method, payment instructions and fee-policy versions. The same trade receives the new principal, exact 1% per-party fees and inclusive fiat quote. The receipt and append-only terms event commit with the financial effect. Settlement through inherited commands delivers the corrected full principal; the seller's combined 2% USDT commission is still funded separately.

The source request, listing, proposal, inventory, evidence and dispute digests are **trusted synthetic planner evidence** in this stage. The reducer verifies internal consistency; it cannot independently authenticate a bank record, buyer consent or a live marketplace snapshot. Prepared cardless-credential invalidation is bound in the command, but actual marketplace invalidation belongs to the future atomic coordinator.

## Storage integrity and wallet writer fencing

The reviewed development migration extends the format-1 head contract without rewriting old rows. The original deferred constraints are flushed before altering the head, then deferral is restored so the registry and matching continuation can be written together.

| Boundary | Implemented protection |
| --- | --- |
| Atomic transition | One immutable continuation registry row has a deferred foreign key to the exact continuation command. Deferred checks require the registry, command and format-2 head to agree before commit; migration DDL alone cannot commit. |
| Version sequence | New command guards require the v2 engine and strict command identity, with exactly one continuation extending the v1 prefix. |
| Old wallet writers | A transaction-local `simulation-v2` protocol is required at the head and command gate. The old repository and initializer fail closed after migration. The marker establishes compatibility, not authorization. |
| Terms and receipts | Append-only tables, original command links, unique enrollment/proposal identities, buyer/terms linkage, monotonic revisions and full replay comparison. |
| Principal delta | Deferred constraints require exactly the accepted signed difference between the same listing and trade, with no payout or chain-evidence side effects. Zero-delta corrections and enrollment/continuation cannot move funds. |
| Late writes | Deferred checks are attached to every relevant projection insertion, including entries written after an early constraint flush. |
| Database access | Forced RLS, no client policies, no grants to application client roles. Tests use an isolated privileged fixture role. This is not a production database-role design. |
| Shared transaction failure | The participant verifies a stable writable SERIALIZABLE simulation transaction. A failure poisons that same certified transaction so a bound caller cannot catch a semantic error after writes and then commit partial work. An unknown or changed transaction identity is not touched. |

Every load verifies reconstructed projections against SQL, including the continuation registry, historical terms events and receipts. A matching terminal hash alone is insufficient.

**Marketplace writer fencing is installed separately for the bounded private cohort.** Its explicit development initializer adds database-backed guards against unsupported financial, lifecycle, listing and generic snapshot writes for the whole enrolled listing, plus registered-context wallet guards. The v2 ledger tables alone do not install or confer those protections. A real production cutover still needs its own reviewed migration/permissions and complete lifecycle mapping; a shared advisory lock alone is insufficient.

## Mixed histories and inherited recovery

The backup/worker behavior in this section applies to a wallet with no canonical marketplace activation. The private coordinator's receipts, canonical rows and publication intents are absent from these formats. Its head guard rejects standalone export/worker access after enrollment; a combined recovery protocol is required before restoring an activated cohort.

[versioned-backup.ts](../../src/lib/alpha-wallet/versioned-backup.ts) delegates pure v1 files to the unchanged v1 inspector/exporter/restorer. A v1 restore remains v1. Format-2 files explicitly name the terminal v2 engine and continuation metadata; inspection verifies the checksum, semantic replay, exact boundary and terminal checkpoint before accessing a target. Existing 1,000-command and 16 MiB limits still apply.

A mixed restore replays the original v1 prefix, executes the recorded migration/continuation and v2 tail, then appends one v2 pause before the same outer transaction commits. Original commands and hashes stay identical. A failure at the final pause rolls back initialization, migration and all replayed history. If the commit reply is lost, inspect the same target through verified replay; never erase it or infer rollback from an error. The original backup CLI remains v1-only; mixed histories use the explicit versioned module and isolated native harness.

[versioned-payout-worker.ts](../../src/lib/alpha-wallet/versioned-payout-worker.ts) adapts the existing fake-provider recovery algorithm to a store that has already continued to v2. It does not upgrade a database or register a background worker. Inherited queued payouts retain current policy checks. Inherited submitting, unknown and broadcast payouts retain their original provider reference and lookup-only recovery. A missing lookup cannot authorize another send. Matching finality can resolve an already-submitted payout while the restored ledger remains paused.

## Verification and remaining integration

Focused tests cover immutable v1 compatibility, strict commands, both simulated assets, increase/decrease/zero-delta corrections, old and business retries, inherited settlement/uncertainty, explicit upgrade rollback, SQL projection guards and mixed-history restoration. [postgres-versioned-ledger.ts](../../scripts/alpha-wallet/postgres-versioned-ledger.ts) adds a separate disposable native PostgreSQL drill for upgrade DDL rollback, lost upgrade acknowledgement, old-writer fencing, concurrent acceptance on distinct connections, resized settlement, mixed restore and conservative recovery. Its marketplace inputs are synthetic; its concurrency proof does not establish that the actual marketplace coordinator exists.

Before actual marketplace activation, implement and verify canonical enrollment, current authenticated ownership, initial acceptance, lifecycle participants, every enrolled-writer guard, ATM invalidation, current buyer eligibility/reviews, and exactly-once publication of benefits/ranks/receipts/notifications. Then prove acceptance/payment/inventory races and unknown-commit recovery through that real coordinator. Closed-listing corrections, counter-price/initial reservation, unsupported currency/fee cohorts and resume/adjudication require explicit supported mappings.

Production roles, custody/signing, authoritative payment and chain evidence, realistic load/checkpointing, operations and separate launch authorization remain open in [launch-readiness.md](launch-readiness.md).

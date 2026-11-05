# Ledger v3: initial seller acceptance

Date: 5 November 2026 (Asia/Jerusalem).

**Financial scope: a separately versioned seller-native transition, guarded development storage, historical receipt recovery, and an isolated paused-wallet backup format.** The later [authenticated initial coordinator](initial-marketplace-coordinator-design.md) adds stored web/mobile seller authority and canonical coupling through a separate development namespace. The distinct [initial combined recovery contract](initial-marketplace-recovery-design.md) now implements owner web/mobile export and quarantined fresh-target restore for that canonical cohort; the recovery addition passed [exact-source verification at `2c3e6a0b`](initial-marketplace-recovery-verification-2026-11-05.md). The v3 command/replay/storage contracts and frozen v1/v2 fixtures remain unchanged. No public route or screen, production migration, deployment, live funds, provider or signing authority is supplied.

## Closed financial contract

The [v3 command schema](../../src/lib/alpha-wallet/v3-commands.ts) permits exactly three new operations:

| Operation | Recorded actor | Effect |
| --- | --- | --- |
| `continueFromV2` | Operator | Explicitly continues a verified v2 checkpoint without moving funds. Storage requires the dedicated upgrade API. |
| `acceptInitialSellerRequest` | Seller | Creates one initial trade reservation, immutable terms binding and original business receipt. |
| `pause` | Operator | Durably pauses the wallet without moving funds. |

There is no v3 resume, new funding, enrollment, amount correction, payment, cancellation, dispute, release, payout or settlement operation. Existing v1/v2 history remains readable and its recorded results recoverable. New commands under those older envelopes are fenced after continuation. The limited contract deliberately holds new initial trades in their original reserved state until further lifecycle versions are designed.

The [reducer](../../src/lib/alpha-wallet/v3-engine.ts) requires a seller actor whose identity matches the accepted terms and seller action. The buyer remains the distinct identity in the retained request. It never invokes the older buyer-only `reserveTrade` command under a manufactured buyer actor.

Actors and canonical digests supplied to this private simulation are recorded facts, **not authentication proofs, signatures or evidence of complete database reads**. The constructor and pure planner are not endpoints. The separate fixed initial coordinator now establishes their source and current stored authority; arbitrary financial-module callers still cannot establish it by constructing a descriptor.

## First supported cohort

The [planner](../../src/lib/alpha-wallet/initial-acceptance.ts) accepts an ordinary pending listing-price request with its preallocated platform trade identity and one retained buyer-submission timeline entry. Supported payment methods are Bank Transfer with complete frozen instructions, and Face-to-Face with explicit seller safety acknowledgment. Both require the original buyer acknowledgment, current ILS fee versions, and a same-asset simulated receiving destination.

The complete canonical planning basis checks enabled, email/phone/adult-evidenced participants; seller operational access, availability and listing approval; bilateral blocks; both participants' unpaid seller commissions; seller enforcement; buyer history and review obligations across sellers; and canonical inventory limits. These are checks on supplied evidence. Only a fenced authoritative reader can establish its completeness and freshness.

The wallet listing must be fully funded, approved and open. The first cohort excludes active competing canonical reservations on the target listing, noncancelled wallet trade history on that listing, and active seller wallet trades without complete canonical pairings. Equal aggregate balances cannot prove matching request, buyer and trade identities. Ordinary pending siblings remain possible. Canonical commitments on other listings still count toward the unchanged three-active-trade seller limit; two such commitments can precede the proposed third.

Demand matches, offers/counteroffers, prior proposals, missing legacy trade IDs, historical fee policies, Wise, ATM credentials, archived buyer-history exceptions, prior disclosure/reminder histories and progressed listings remain outside this cohort. A valid manual marketplace request can therefore be unsupported here without changing its existing product policy.

## Retained terms, principal and receipts

The accepted unit price comes from the buyer's retained request. A later public or wallet listing price does not silently reprice it. V3 records the current wallet price and whether the accepted request requires a different frozen price. Payment instructions remain represented by their digest; the financial descriptor contains no bank-account snapshot or account credentials.

The reducer validates the canonical quote and exact raw units. Marketplace quantities retain six-decimal precision; the BSC simulation scales those quantities to its eighteen-decimal asset units. Acceptance moves the **full principal** from the mapped listing account to the new trade account in one balanced journal. For a 200-USDT request funded from a 500-USDT listing, the result is 300 USDT available and 200 USDT reserved. The separately quoted fees do not reduce that principal, create commission settlement, or produce a payout. The accepted command clock must be strictly later than the retained request update.

New `initialBindings` and `initialAcceptanceReceipts` remain separate from v2 enrollment/correction metadata. Each binds the canonical request/trade, wallet listing/trade, participants, asset, destination, retained terms and source evidence to the original command key, revision and acceptance time. Initial bindings have revision zero and immutable reserved trade data. They cannot be enrolled into the old listing-priced correction contract.

Business identity is the stable initial-acceptance key derived from request and seller. A retry with the same actor and exact descriptor can use another transport operation ID, but returns the original command identity, event hash and receipt without another reservation. Changed evidence or actor under the same business identity is refused. Receipt recovery can succeed after pause because it creates no new financial effect. The initial coordinator enforces current stored seller authority for receipt recovery. This isolated financial library does not authenticate sessions itself.

## Explicit continuation and preserved history

[`upgradeDurableWalletV3`](../../src/lib/alpha-wallet/v3-durable.ts) requires an explicit upgrade acknowledgment and the verified source revision, event hash, state hash and last command time. Initialization and ordinary execution never perform that migration automatically. The source must already have its valid v2 continuation.

Replay evaluates each v1/v2 prefix under its original reducer and envelope, then applies the separate v3 continuation. Historical command keys, results, states, event construction and hashes retain their original meaning. V3 keeps the original continuation, bindings and correction receipts alongside its new metadata. An explicit v2-shaped view supports invariant/projection verification and historical receipt lookup; it is never used to execute an old command against v3 state.

The fixed [v2 history](../../src/lib/alpha-wallet/fixtures/v2/README.md) contains 41 commands, including its v1 prefix, amount increases/decreases, a separate zero-delta correction, completed payouts and an uncertain withdrawal. Compatibility tests consume those captured bytes rather than regenerating expectations. Historical dispatch recovery always returns `shouldDispatch: false`; an uncertain payout keeps its original reference and requires lookup, never a replacement submission.

## Storage and transaction ownership

The [development migration](durable-v3-migration.sql) introduces format 3 and three additive projections: `initial_engine_continuations`, `initial_trade_bindings`, and `initial_acceptance_receipts`. The [projection verifier](../../src/lib/alpha-wallet/v3-projections.ts) compares stored rows against complete command replay. Existing financial engine files and the earlier migration contracts remain unchanged.

The migration, exact continuation command and format change must commit together. New SQL guards permit only the closed v3 envelope, retain the original v1/v2 validation intervals, and require the initial command, full-principal journal, binding and receipt to agree. Initial actions cannot append payout/chain evidence or old terms projections. Historical projections are sealed even when their commands were restored earlier in the same transaction. Immutable-row triggers, deferred integrity checks on late projection writes, row-level security and restricted grants remain in place. Protocol settings provide compatibility checks, not authentication.

The wrapper requires an explicit writable `SERIALIZABLE` simulation transaction and certifies a stable physical transaction ID through repeated reads. One real store owner controls commit and complete-decision retries. After semantic failure, cleanup aborts only that certified current transaction. Checking physical identity independently of the runtime guard prevents a swallowed runtime refusal followed by environment restoration from permitting a partial commit; an unknown or replaced transaction is never poisoned.

Every v3 operation and migration refuses the existing `alpha_wallet_marketplace_simulation` namespace, including an empty namespace. An enrolled amount-correction cohort cannot silently become a v3 initial-acceptance cohort.

## Isolated format-3 recovery

The [backup module](../../src/lib/alpha-wallet/v3-backup.ts) uses format version 3, scope `isolated-v3-ledger`, both continuation records, all command rows and their verified checkpoint/checksum. Export requires an actually paused replay state and an isolated development database. Even empty canonical/coordination schemas, including `alpha_wallet_initial_marketplace_simulation`, and unrelated public relations are refused: this wallet-only file cannot preserve their state.

Restore validates the full bounded document before touching the target, checks an optional expected checksum, requires a fresh isolated target, and replays the original v1/v2/v3 commands at their original times. It verifies the exact source checkpoint before appending a deterministic v3 quarantine pause. Schema creation, both upgrades, complete history and quarantine share one transaction. There must be capacity for that final command. Source and restored target remain paused; this format supplies no resume or custody-transfer authority.

A lost COMMIT acknowledgment remains an unknown outcome. Inspect/reopen the same target and recover the original command/receipt; do not replace its history or infer failure from the missing reply. A repeated restore cannot overwrite a committed target. The old backup readers remain closed to format 3, and the existing combined canonical recovery format retains its original scope.

## Evidence and remaining integration

[Historical financial verification at `f18e95e6`](ledger-v3-verification-2026-11-05.md) passed **1,626 tests** across 48 files, root TypeScript, all nine native PostgreSQL drills/**86 checks**, the offline simulation and the retained English/Arabic Chromium rehearsal. The new tests comprise 143 engine, 42 durable-storage, 31 isolated-backup and 20 frozen-history cases; all 1,203 prior wallet cases are retained. The [machine-readable report](ledger-v3-verification-results.json) binds the commit/tree, CI job, downloaded artifact digest and every verified evidence file. The new [native drill](../../scripts/alpha-wallet/postgres-v3-ledger.ts) passed all eleven checks. Its synthetic source facts and isolated wallet-only scope do not establish authenticated canonical initial acceptance.

The [initial coordinator](initial-marketplace-coordinator-design.md) now resolves stored web/mobile seller authority in the same transaction, explicitly derives `canSell`, checks exact seller ownership and rechecks authority after awaited work. It owns complete fenced canonical reads and wallet replay, commits canonical acceptance, trade/listing projections, full reservation, original coordinated receipt and safe publication intent together, and fences unsupported writers. Its separate [verification at `c11fe0e9`](initial-marketplace-verification-2026-11-05.md) passed 1,779 tests and ten native drills/101 checks; the [machine-readable evidence](initial-marketplace-verification-results.json) binds this successor separately from the financial-only baseline above. Broader cohorts still need complete canonical/wallet identity coverage in both directions.

**Combined initial recovery is implemented as a separate development format.** Its [exact-source verification at `2c3e6a0b`](initial-marketplace-recovery-verification-2026-11-05.md) passed. Outer format `alpha-wallet-initial-marketplace-simulation-backup`, schema `canonical-initial-cohort-v1`, and embedded wallet scope `initial-marketplace-v3-ledger` retain canonical activation/basis, the complete original v1/v2/v3 history, bindings, receipts, events and publication together. Isolated format 3 and the old v2 `canonical-cohort-v1` format continue to refuse the initial namespace; their contracts are unchanged. The historical verification reports above do not establish results for this recovery addition.

`exportInitialMarketplaceWalletBackup` and `exportMobileInitialMarketplaceWalletBackup` require current stored owner authority and an activated, durably paused source, either before acceptance or after its one original coordinated acceptance. Restore validates the actual bundle and separately retained expected checksum before opening a fresh isolated target, preserves the original financial history, and appends a new v3 quarantine pause. Source financial history and pause remain unchanged. The target contains disabled, credential-free identity stubs, empty web sessions and neither mobile authentication table. Same-target receipt inspection resolves a retained or uncertain restore outcome without granting account authority or a resume. The [initial recovery design](initial-marketplace-recovery-design.md) and [runbook sequence](recovery-runbook.md#initial-canonical-cohort-inspect-pause-export-and-restore) define the exact format, schema, quarantine and operational limits; production authority re-entry and source leadership/fencing remain unfinished.

Subsequent trade lifecycle, product routes/screens, deduplicated delivery, real custody/provider/signing integration and the remaining [launch-readiness gates](launch-readiness.md) remain separate work.

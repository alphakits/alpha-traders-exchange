# Alpha Wallet: proposed v2 continuation and resize

Date: 4 November 2026 (UTC). **Design handoff only: v2, migration, enrollment and durable resize are not implemented.** Reviewed against development commit `44ac6c4` and the frozen v1 fixtures. This follows the [shared-transaction groundwork](transaction-integration-design.md); it does not authorize a production migration or deployment.

## Recommended version boundary

Record one explicit, one-way `continueFromV1` command in the existing command log. Preserve the entire original prefix: commands, timestamps, results, journals, projections and hashes. Keep the v1 parser/reducer behavior, `walletJson`, command identities and digest construction unchanged. Implement v2 as a separate strict envelope and reducer.

The continuation binds the expected verified v1 checkpoint: revision, event hash, state hash and last command timestamp. Replay must first reconstruct that exact prefix, then construct v2 state from a clone. Add terms and acceptance-receipt maps only at this boundary. The transition moves no money. Historical v1 states must not acquire default fields, empty maps or newly present `undefined` properties.

Replay accepts a v1 prefix followed by one valid continuation and then v2 commands. Reject unknown versions, repeated continuations and new v1 appends after transition. Link the continuation to the original last event hash using the retained hash-chain construction. The new engine must support settlement and recovery of inherited trades and payouts; introducing resize cannot strand existing obligations.

## Preserve retry identities

Keep the current version-independent command-key tuple. A version namespace must not create a fresh financial identity for an old operation. An exact historical retry retains its original revision, event hash and result shape; changed input under the same key fails. Historical `beginDispatch` replay still returns `shouldDispatch: false` with the current payout state.

Persist one acceptance receipt per `(platformRequestId, proposalId)`, independent of transport request IDs. Perform fresh actor and ownership checks, then look up an existing receipt before evaluating current-proposal eligibility. That lets a client recover an earlier accepted correction after another proposal or payment step without reapplying it. The planner's snapshot-specific `inputDigest` is not a replacement for this receipt contract.

## First supported resize cohort

Start with a clean, already-reserved current-policy ILS trade, an open funded listing and an unchanged locked unit price. Explicit enrollment records the canonical platform/wallet identities, participants, asset/network/destination, currency/payment method, payment-instruction digest, both fee versions, exact quantities/fees/fiat and terms revision/digests. Validate those against the verified existing reservation. Status and current wallet settings do not establish enrollment.

The later `acceptAmountCorrection` operation binds the stored proposal, previous terms/binding digests and authenticated buyer. Under one outer transaction, it rereads canonical marketplace context, checks all payment/evidence/dispute/inventory locks, moves only the principal delta between the existing listing and trade accounts, updates that same trade's terms and appends the immutable acceptance receipt. A zero-delta acceptance creates a receipt without a zero-value journal.

The marketplace update, wallet command/projections, binding, receipt and publication intent must commit together. The current focused participant supplies transaction mechanics; lifecycle participants, initial acceptance, buyer eligibility and completion publication remain separate implementation work.

## Explicit storage migration and writer fencing

The current schema requires `format_version = 1`, and `guard_head_update` prevents changing it. Introduce a separately reviewed development migration; the ordinary initializer must not silently upgrade an existing store.

| Boundary | Required change |
| --- | --- |
| Head and command guards | Permit formats 1 and 2, with one-way transition only when the matching continuation is committed atomically; enforce command-engine sequence. |
| New projections | Append-only terms events and acceptance receipts, command-revision foreign keys, unique acceptance identities and current-command protections. |
| Binding persistence | Explicit enrolled identity and guarded terms-revision advancement; reconstruct and verify it against history. |
| Projection replay | Extend delta generation, persistence and verification while retaining original command/journal/payout/claim rows unchanged. |
| Old wallet writers | Require a transaction-local v2 protocol marker at the format-2 head gate. The marker proves compatibility only; it is not authentication or a substitute for database roles. |
| Old marketplace writers | Install database-backed enrollment guards before activating any binding. Reject unsupported financial, lifecycle, listing and generic snapshot writes affecting enrolled records. A shared advisory lock alone is insufficient. |

## Mixed-history backup contract

Retain format-1 inspection/export/restore semantics for pure v1 histories. Add a strict format-2 manifest identifying the terminal engine and continuation checkpoint, validated against every command and the final state. Reject unknown combinations.

Restore retains every original row and hash, replays the recorded continuation, and appends the terminal engine's pause command before the same outer transaction commits. Restoring a v1 backup must not silently upgrade it. Existing writer fencing and provider reconciliation remain necessary before a restored environment could later resume.

## Deferred policy and acceptance evidence

Closed-listing resize, initial reservation/counter-price acceptance, unsupported currency/fee cohorts and resume/adjudication require their own explicit mappings. Do not infer those policies from this continuation design.

Before activation, require the frozen v1 fixture to pass unchanged; mixed-history reopen/backup/restore tests; old-binary rejection; original idempotent results; inherited settlement/recovery; concurrent acceptance/payment/inventory races; and rollback/unknown-commit recovery through the real coordinator. These are future gates, not results of the current groundwork verification.

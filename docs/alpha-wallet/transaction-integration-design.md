# Alpha Wallet: atomic marketplace terms integration

**Status: pure planners, frozen v1/v2 history, canonical participants, separate v2/v3 financial engines and two bounded private canonical coordinators are implemented for simulation. Initial combined recovery, broader lifecycle integration and production cutover remain unfinished.** Original source review: 4 November 2026, development baseline `23ee55f`. This document retains the wider design; the [amount-correction contract](marketplace-coordinator-design.md) and [initial-acceptance coordinator contract](initial-marketplace-coordinator-design.md) define the two implemented cohorts. None connects a production route, migrates a production database, authorizes a provider or establishes launch readiness.

The preliminary stage passed [exact-source verification at `44ac6c4`](marketplace-groundwork-verification-2026-11-04.md): 800 tests, full-project TypeScript, three native PostgreSQL drills and the browser rehearsal. The separate [v2 continuation contract](ledger-v2-continuation-design.md) is now [verified at `08fb7fa`](ledger-v2-verification-2026-11-05.md): 879 tests and four native drills, including explicit ledger migration, correction and mixed restore. Its new commands consume trusted synthetic planner evidence; they do not implement the marketplace transaction described below.

The subsequent [bounded canonical coordinator at `ecc3752`](marketplace-coordinator-verification-2026-11-05.md) passed 998 tests and five native drills, including 16 new canonical/authentication/writer-fence checks. It connects the already-reserved Bank Transfer/Face-to-Face amount-correction path. The later [combined recovery contract](marketplace-recovery-design.md) describes separately implemented backup and quarantined restore for its fixed development schema. [Transaction-owned mobile authority](marketplace-mobile-auth-design.md) is also implemented and has its own [exact-source evidence](marketplace-mobile-verification-2026-11-05.md). This wider design includes initial acceptance variants beyond the supported ordinary request, further lifecycle, product delivery and production recovery work beyond that correction cohort; earlier verification counts do not cover later additions.

The separately scoped [initial seller acceptance groundwork](initial-acceptance-design.md) passed [historical verification at `3d119889`](initial-acceptance-verification-2026-11-05.md): 1,390 tests and eight native drills/75 checks. Its successor [v3 financial milestone](ledger-v3-initial-acceptance-design.md) supplies the seller-native reservation, immutable wallet receipt and isolated paused recovery. The later [initial coordinator](initial-marketplace-coordinator-design.md) now supplies same-transaction stored seller authority, explicit owner activation, canonical acceptance, publication and SQL writer fences. [Exact-source verification at `c11fe0e9`](initial-marketplace-verification-2026-11-05.md) passed 1,779 tests across 52 files, root TypeScript and ten native drills/101 checks; the [machine-readable results](initial-marketplace-verification-results.json) bind the successor source and evidence. Initial combined recovery remains UNIMPLEMENTED; historical reports do not prove later additions.

## Decision and smallest next stage

Use one database transaction to accept marketplace terms and adjust the corresponding wallet reservation. Two independently committed calls, including a wallet call inside today's marketplace callback, cannot provide that guarantee.

The preliminary stage contains a pure accepted-terms planner, immutable v1 replay fixtures and one transaction-scoped focused repository participant. It reuses existing quote, proposal and payment-lock rules. The v2 ledger adds its explicit command/version extension, simulation terms bindings and immutable acceptance receipts. The private coordinator connects owner enrollment, fixed same-transaction web/mobile authentication, buyer acceptance and database writer fences for one clean, already-reserved development trade with an existing amount proposal. Bank Transfer and Face-to-Face are its only supported payment flows. The new [initial seller acceptance groundwork](initial-acceptance-design.md) supplies a separate pure plan, narrow canonical lifecycle participant and frozen v2 history; the separate seller-native v3 financial command and isolated paused recovery are implemented, and the new initial coordinator couples actual stored seller authority and canonical acceptance to that financial contract. Initial combined recovery, subsequent proposals, the remaining lifecycle, external delivery and production recovery remain separate requirements. The sections below define that broader target, not a claim that every path is connected.

Combined development recovery for the original v2 amount-correction cohort requires an owner-paused source and fresh stored owner authority before exporting the mixed wallet history and supported canonical/coordination rows together. Restore validates the complete bundle and separately retained checksum, refuses any existing application target, then commits original records, common guards, a new durable pause and immutable recovery receipt atomically. Restored users are disabled identity stubs with no original credentials or sessions. The separate offline diagnostic verifies an uncertain restore on that same target. This implementation does not add account-authority re-entry, resume, external reconciliation or cross-instance source fencing. Existing wallet-only export and worker paths remain blocked after canonical enrollment; see [marketplace-recovery-design.md](marketplace-recovery-design.md). The separate initial namespace has no supported combined format: all old formats fail closed. Preserve its complete source and use current-owner initial inspection/pause; same-database receipt recovery does not provide a portable restore.

## Implemented preliminary stage

`src/lib/alpha-wallet/accepted-terms.ts` derives buyer acceptance of a stored seller amount correction from canonical request/listing/evidence/dispute data, verified wallet state and an explicit development binding. It returns immutable prior/accepted terms, exact principal and fee units, stable proposal identity, source digests and one of no reservation, increase, decrease or unchanged reservation. It has `executionAuthority: false`, writes nothing and does not create an enrollment or acceptance receipt. Its structural inputs do not prove authentication, source completeness or transaction freshness; those remain coordinator duties.

The supported cohort is current-policy ILS with exact synthetic asset/destination mapping and unchanged locked request price. Ordinary pending requests stay unreserved; accepted requests require the exact clean existing reservation. Pending demand/buyer-offer quantities stay fixed. Payment/evidence/dispute/disclosure locks, submitted-proposal limits, exact frozen payment instructions and inventory consistency are enforced. A listing's normal acceptance inventory lock is permitted; it is distinct from irreversible request progress. Existing v1 reservations must also match the immutable wallet listing price, since v1 does not store a separate trade unit price.

`src/lib/alpha-wallet/fixtures/v1` freezes 41 committed commands from verified source `f3422f9`, their original results and hashes, the complete encoded final state and provenance. The compatibility tests replay every original hash, restore/reopen the rows unchanged with a new pause command, retain original business results and reject renewed dispatch authority. A future engine change must preserve these fixtures instead of regenerating expectations.

`mutateDevelopmentFocusedTradeInTransaction` in `alpha-exchange-repository.ts` reuses the actual focused reader, encoders and persistence statements. It accepts one already-owned writable SERIALIZABLE simulation transaction, checks a stable transaction ID, acquires request/global locks, fences `runtime_meta` and reads the canonical context. It rejects unrelated collection changes and identity/lifecycle edits, scopes new events to the trade, and uses insert-only new notification/audit identities. It never connects, begins, commits, retries, releases or publishes. A semantic failure after wallet writes explicitly aborts the certified transaction, so a caller swallowing the error cannot commit only the wallet side. Existing `mutateFocusedTrade` continues to own its original transaction and retains its normalization/upsert behavior.

The disposable PostgreSQL harness `scripts/alpha-wallet/postgres-marketplace-transaction.ts` invokes these actual repository statements, deliberately pairing harmless trade-note changes with synthetic wallet commands. It tests joint commit/rollback, an actual waiting-writer stale-snapshot retry, injected lost-commit-reply reconciliation and reopen/conservation. This proves transaction mechanics; it does not apply the planner, resize a reservation, enroll a real trade or prove the unfinished business races below. The minimal fixture tables reproduce the columns used by those real statements and are created only in a fresh local simulation database.

## Current source boundaries

| Source | Observed behavior and implication |
| --- | --- |
| `src/lib/alpha-exchange-store.ts`: `updateTradeTerms`, `commitFocusedTradeMutation` | Amount corrections use seller proposal → buyer acceptance. The preferred write path calls `repository.mutateFocusedTrade`; the fallback uses `writeDb` with canonical rebasing. Neither supplies a shared wallet transaction. |
| `src/lib/alpha-exchange-repository.ts`: `mutateFocusedTrade` | Still owns its original client and plain `BEGIN`, financial advisory lock `61422917`, focused delta, version increment and commit. Its actual read/persist statements now also serve the guarded development participant; existing callers retain their behavior. |
| `src/lib/alpha-exchange-store.ts`: `updatePurchaseRequestStatus`, `acceptedCounterQuote` | Counter-price acceptance uses the lifecycle path and `acceptCounterOfferId`, not `accept_amount`. |
| `src/lib/alpha-exchange-repository.ts`: `beginCanonicalTradeTransaction`, `TradeLifecycleTransaction` | Lifecycle persistence also owns its commit. Some status commands take request lock `(61422919, hashtext(requestId))` before `61422917`. Focused correction and lifetime-bound initial participants now couple their supported acceptances to the separate private coordinators; remaining lifecycle transitions still need dedicated participants and financial contracts. |
| `src/lib/alpha-wallet/durable.ts`, `durable-store.ts` | Wallet execution owns a SERIALIZABLE transaction, updates the wallet head before reading history, verifies semantic replay and immutable projections, then appends a command and its projections. |
| `src/lib/alpha-wallet/backup.ts`: `transactionBoundStore` | Existing example of invoking wallet repository operations inside one already-owned transaction, without nested BEGIN/COMMIT. This is an internal ownership pattern, not a public SQL API. |
| `src/lib/alpha-wallet/sandbox.ts`, `types.ts` | `reserveTrade` creates a new trade and quotes from `listing.price`. There is no resize command; `Trade` does not retain an explicit unit price, fee-policy version or proposal revision. |

## Acceptance is not always a reservation change

`isDemandReservedTrade` in `src/lib/usdt-demand-policy.ts` reserves accepted/payment/release requests and pending demand matches. An ordinary pending request does not reserve inventory.

| Action or canonical state | Required behavior |
| --- | --- |
| Seller submits a proposal | Keep existing agreed terms and reservation unchanged. |
| Buyer declines or seller withdraws | Resolve the proposal without moving principal. |
| Buyer accepts an amount correction on an ordinary pending request | Update agreed marketplace terms; do not invent a wallet reservation. Initial reservation occurs at subsequent trade acceptance. |
| Buyer accepts an amount correction on an accepted, wallet-backed request | Resize the existing reservation in the same commit as proposal acceptance. A missing reservation is an integrity failure, not permission to create a replacement. |
| Pending demand match or pending buyer-offer negotiation | Preserve `isNegotiatingQuantityFixed`; do not introduce a quantity-adjustment bypass. |
| Seller accepts an ordinary request | The separate initial coordinator atomically creates the full-principal reservation with the supported canonical acceptance at retained terms. |
| Buyer accepts a counter-price | A future supported transition must retain quantity and atomically reserve at the accepted price; this remains outside the initial cohort. |
| Payment, evidence, usable credential disclosure, dispute or terminal progress exists | Preserve the existing adjustment prohibition and original reservation. |

Legacy manual trades and wallet-backed trades require an explicit enrollment/binding record. Current status or an account's current wallet setting does not identify the cohort.

## Reuse consent and exact monetary rules

Reuse `packages/contracts/src/trade-terms.ts`, `marketplace-fees.ts` and `TradeTermsProposal` in `mobile-v1.ts`. Preserve the two submitted-proposal limit, including declined/withdrawn proposals; current proposal identity; creation-time `expectedUpdatedAt`; buyer-only acceptance; current inventory/minimum/maximum checks; counter-price constraints; and ATM amount/code rules.

Use `areTradeAmountsLocked` in `src/lib/trade-amount-lock.ts`, `hasIrreversibleRequestProgress` in `trade-cancellation.ts`, and transaction-loaded evidence/disputes. A rolled-back status must not erase historical payment or disclosure locks. If an ATM total changes, invalidate prepared credentials as the current acceptance path does.

Bind the accepted request's locked `pricePerUsdt`, not the listing's current public price. Retain `listingPriceAtRequest` for its existing audit purpose. Preserve asset/network, receiving destination, participants, listing, currency, payment method, frozen payment instructions and both fee-policy/calculation versions. A private instruction reference/digest can bind payment data without copying bank details into the wallet.

The existing wallet supports current-policy ILS trades only. Its exact arithmetic matches six-decimal trade quantities, 1% per-party fees and the buyer-inclusive fiat total. A first planner may explicitly support this cohort and reject legacy-fee or USD/Wise mappings; it must not reinterpret their terms. Closed-listing corrections also need an explicit supported mapping before activation, including where released principal belongs.

## Internal acceptance contract

The trusted coordinator derives a plan from canonical stored data. A browser cannot authorize it by supplying an `accepted` flag, computed fees or an actor role.

The plan needs:

- Platform request/listing IDs, proposal ID and a stable acceptance identity.
- Canonical buyer/seller IDs and wallet trade/listing IDs where a reservation exists.
- Expected platform terms digest, wallet trade digest and binding revision.
- Unchanged asset/destination, currency/payment method, payment-instruction digest and policy versions.
- Previous and accepted canonical quantity/unit-price strings plus exact integer principal, per-party fees and fiat total.
- Explicit effect: no reservation yet, initial reservation, increase, decrease, or accepted terms with zero principal delta.

Persist a **trade-wallet binding** with identities, terms revision/digest and wallet command revision/hash. Persist a separate **acceptance receipt**, unique for `(platformRequestId, proposalId)`, containing the authenticated actor, immutable input digest, old/new terms and wallet command result reference. A new HTTP request ID must not create a second acceptance. Changed input under a consumed identity must fail.

The latest `termsProposal` field is insufficient recovery evidence: a later proposal replaces it. After fresh authorization/ownership checks, a retry must be able to resolve an earlier acceptance receipt even if payment has since advanced or another proposal now exists. This lookup must not reapply the old transition.

## One transaction owner

The focused amount-correction and separate initial-acceptance participants have been extracted; the remaining lifecycle transitions still need their own participants and financial coordination contracts. Existing production entry points retain their transaction ownership. These operations receive a trusted, lifetime-bound SQL context and never connect, begin, commit, retry or release independently. Existing repository entry points retain their present behavior. Both private coordinators supply that same context to their supported wallet participant. Initial activation, inspection and original receipt recovery use the new read-only canonical participant path; acceptance is at most once within that lifetime.

For an enrolled financial action:

1. Begin **one SERIALIZABLE transaction on one client/database**. No external provider call belongs inside it.
2. Acquire locks in consistent order: request lock when used, then `61422917`.
3. Fence on `alpha_exchange.runtime_meta` before business reads, for example by locking its singleton row with `SELECT ... FOR UPDATE`. Acquire the wallet's existing head write gate before reading wallet history. Do not read authoritative financial state before these fences.
4. Load the current request/proposal, listing, competing reservations, participants, evidence/disputes, binding, acceptance receipt and verified wallet state.
5. Resolve an exact existing acceptance or re-evaluate all guards and build the new plan. Initial acceptance preserves existing buyer eligibility, pending-review, seller-capacity and commission rules.
6. Persist marketplace deltas, wallet command/history/projections, binding, acceptance receipt, audit and durable publication intent together. Increment the platform version consistently with the committed mutation.
7. Commit once. Invalidate caches and publish from committed intents only after confirmed commit.

**Snapshot timing:** the advisory-lock SELECT can establish a SERIALIZABLE snapshot before it waits. Acquiring that lock does not itself make later reads fresh. Existing marketplace writers update `runtime_meta` under the common lock; the row fence must cause a stale snapshot to fail rather than accept outdated terms. The initial cohort additionally installs development-only BEFORE STATEMENT runtime versioning for canonical dependency writes, including permitted outside-listing account/history changes. This orders legacy READ COMMITTED writers before row locks without changing eligibility rules. The wallet head update supplies the corresponding wallet fence. Prove the waiting-writer case with actual PostgreSQL transactions.

Retry the entire transaction/decision on a known serialization or deadlock rollback; do not retry only the wallet portion or use a savepoint as a substitute. Lost COMMIT confirmation is an unknown outcome: discard the uncertain connection and reconcile the same acceptance identity. It is not permission to create a new operation.

## Every enrolled writer must respect the binding

The inspected focused, lifecycle, snapshot and listing/request creation writers use the common financial lock/version protocol. That serialization does not make a legacy marketplace writer update custody.

For wallet-backed requests/listings, route these changes through the coordinator or reject them until supported:

- Initial acceptance and demand matching; accepted amount/price changes.
- Cancellation, expiration, force-close and listing inventory/closure changes.
- Payment claims, evidence and credential disclosure that lock terms; disputes.
- Custody-related release/completion and resulting financial records.

Allow unrelated narrow communication updates only when they preserve the binding and all financial/progress fields relevant to eligibility. Generic snapshot persistence also needs an enrolled-record guard: `mergeMatchingPurchaseRequest` currently uses lifecycle rank/timestamps, and `mergeMarketplaceListings` uses timestamp merging, with no custody binding. A newer timestamp cannot authorize restoration of old financial terms.

An explicit binding table plus centralized guarded persistence and appropriate database enforcement is required. Audit all writer paths; adding a guard to `updateTradeTerms` alone is insufficient. This can preserve existing marketplace tables, but it is a real storage/write-boundary migration for the enrolled cohort.

## Immutable v1 replay and backup compatibility

`commands.ts` accepts the fixed `alpha-wallet-simulation-v1` engine. `durable.ts` replays every recorded command and verifies its result, full state and hash chain. `backup.ts` also accepts one fixed engine version. Preserve that evidence.

- Preserve the captured fixed v1 command history and expected hashes. Regenerating both history and expectations with a changed implementation does not establish compatibility.
- Do not add default fields or empty maps to historical v1 state/results, change rounding, or rewrite stored commands/hashes. Even present `undefined` fields differ from absent fields in `walletJson`.
- Choose an explicit versioned resize/continuation design, retaining the v1 parser and semantics. Preserve the original prefix and old idempotency results. Any new state shape needs a verifiable transition boundary.
- Update backup manifest/read/restore rules deliberately for new or mixed histories while retaining v1 backup support. Reject unknown versions. SQL storage `format_version` and command engine version are distinct; changing a constant is not a migration.

Cancel-and-reserve changes trade identity and uses listing price; it cannot substitute for resize. Direct SQL balance edits would contradict verified command projections. A true resize moves only the delta between existing reserves, retains trade identity and rechecks ledger invariants. Zero delta must not generate an invalid zero-value transfer, while the acceptance still retains its durable receipt.

## Required business and failure races

| Test | Required result |
| --- | --- |
| Same proposal accepted concurrently from web/mobile, including different request IDs | One receipt, one financial effect and identical acceptance identity. |
| Consumed identity with changed amount, price, proposal or destination | Reject without replacing the original result. |
| Accept versus withdraw/decline | One canonical proposal resolution; loser changes neither domain. |
| Increase versus another reservation; two simultaneous increases | Funded inventory cannot be oversold. |
| Shrink versus cancellation/listing closure | No double release; released funds follow the explicitly supported mapping. |
| Accept versus payment claim, evidence upload, usable ATM-code disclosure or dispute | Canonical winner determines eligibility; no stale resize after progress locks terms. |
| Proposal creation/decline/withdrawal; ordinary pending correction acceptance | No premature principal movement. |
| Counter-price acceptance or later initial acceptance after correction | Initial reservation uses accepted price/quantity and current eligibility. |
| Unsupported legacy fee/USD mapping; mismatched reservation/binding | Fail closed without reinterpretation or opportunistic repair. |
| Failure after either domain's SQL, before the other write or before commit | Both domains and all intents roll back. |
| COMMIT reply lost, then restart/retry | Reconcile one original acceptance; never create a replacement operation. |
| SERIALIZABLE action waits behind a platform-only or wallet writer | Stale snapshot fails; whole decision retries from current state. |
| Legacy snapshot/maintenance writer follows an acceptance | Cannot overwrite/delete its binding or restore old financial terms. |
| Retry after later proposal or payment progress | Historical receipt is discoverable without reapplication. |
| Reopen old v1 history/backup after introducing new code | Every original v1 result, state and event hash remains identical. |

## Groundwork and current integration boundary

The original groundwork milestone implemented a pure planner and shared-transaction harness offline with synthetic data. That harness exercised the extracted real focused repository statements against minimal disposable marketplace tables. Connecting the planner, versioned transitions, durable bindings/receipts and enrolled-writer guards was a separate integration milestone.

The bounded amount-correction cohort implements those pieces together, with [historical canonical verification](marketplace-coordinator-verification-2026-11-05.md), the separately verified [combined recovery protocol](marketplace-recovery-verification-2026-11-05.md) and [mobile extension](marketplace-mobile-verification-2026-11-05.md). The [initial groundwork](initial-acceptance-design.md) and unchanged [v3 financial reservation](ledger-v3-initial-acceptance-design.md) are now coupled by the [authenticated initial coordinator](initial-marketplace-coordinator-design.md), with its own [exact-source evidence](initial-marketplace-verification-2026-11-05.md). Its combined recovery is UNIMPLEMENTED; existing formats retain their original meanings and refuse that namespace. Subsequent proposals and payment/cancellation/dispute/release/completion, broader identity-bound cohorts, product routes, external delivery and production recovery remain unfinished. Deployments and real funds remain outside this stage.

## Primary database references

Original source review: 4 November 2026. The snapshot and locking implications above apply these documented rules to the inspected repository. The later implementation reports linked above provide separate evidence for the bounded coordinator and recovery/mobile additions; the broader lifecycle design is not a claim of completed implementation.

- [PostgreSQL 17 transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html): fixed transaction snapshots, conflicts and whole-transaction retries.
- [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html): changed-row rejection under SERIALIZABLE, consistent lock ordering and application-defined advisory locks.

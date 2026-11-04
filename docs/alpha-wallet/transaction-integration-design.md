# Alpha Wallet: atomic marketplace terms integration

**Status: design for review, not implemented.** Source review: 4 November 2026, development baseline `23ee55f`. The current wallet remains an isolated simulation. This document does not connect a production route, migrate a database, authorize a provider, or establish launch readiness.

## Decision and smallest next stage

Use one database transaction to accept marketplace terms and adjust the corresponding wallet reservation. Two independently committed calls, including a wallet call inside today's marketplace callback, cannot provide that guarantee.

The next bounded stage can implement a pure accepted-terms planner, immutable v1 replay fixtures, and transaction-scoped repository participants. It can reuse existing quote, proposal and payment-lock rules. A working durable resize additionally requires a reviewed command/version extension, explicit marketplace-to-wallet bindings and protection against independent legacy financial writes. Do not present the preliminary stage as completed integration.

## Current source boundaries

| Source | Observed behavior and implication |
| --- | --- |
| `src/lib/alpha-exchange-store.ts`: `updateTradeTerms`, `commitFocusedTradeMutation` | Amount corrections use seller proposal → buyer acceptance. The preferred write path calls `repository.mutateFocusedTrade`; the fallback uses `writeDb` with canonical rebasing. Neither supplies a shared wallet transaction. |
| `src/lib/alpha-exchange-repository.ts`: `mutateFocusedTrade` | Opens its own client and plain `BEGIN`, takes financial advisory lock `61422917`, loads canonical dependencies, writes a focused delta, increments `runtime_meta.version` and commits. Its callback receives a snapshot, not the client. It forbids lifecycle/participant/listing-ID changes. |
| `src/lib/alpha-exchange-store.ts`: `updatePurchaseRequestStatus`, `acceptedCounterQuote` | Counter-price acceptance uses the lifecycle path and `acceptCounterOfferId`, not `accept_amount`. |
| `src/lib/alpha-exchange-repository.ts`: `beginCanonicalTradeTransaction`, `TradeLifecycleTransaction` | Lifecycle persistence also owns its commit. Some status commands take request lock `(61422919, hashtext(requestId))` before `61422917`. Both persistence paths need shared transaction participants. |
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
| Seller accepts an ordinary request, or buyer accepts a counter-price | Atomically create the initial reservation with lifecycle acceptance. Counter-price acceptance retains quantity and captures the accepted price. |
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

Extract internal transaction-scoped marketplace operations to read focused/lifecycle contexts and persist their deltas. They receive a trusted, lifetime-bound SQL context and never connect, begin, commit, retry or release independently. Existing repository entry points can wrap those operations to retain their present behavior. The financial coordinator supplies the same context to the wallet participant.

For an enrolled financial action:

1. Begin **one SERIALIZABLE transaction on one client/database**. No external provider call belongs inside it.
2. Acquire locks in consistent order: request lock when used, then `61422917`.
3. Fence on `alpha_exchange.runtime_meta` before business reads, for example by locking its singleton row with `SELECT ... FOR UPDATE`. Acquire the wallet's existing head write gate before reading wallet history. Do not read authoritative financial state before these fences.
4. Load the current request/proposal, listing, competing reservations, participants, evidence/disputes, binding, acceptance receipt and verified wallet state.
5. Resolve an exact existing acceptance or re-evaluate all guards and build the new plan. Initial acceptance preserves existing buyer eligibility, pending-review, seller-capacity and commission rules.
6. Persist marketplace deltas, wallet command/history/projections, binding, acceptance receipt, audit and durable publication intent together. Increment the platform version consistently with the committed mutation.
7. Commit once. Invalidate caches and publish from committed intents only after confirmed commit.

**Snapshot timing:** the advisory-lock SELECT can establish a SERIALIZABLE snapshot before it waits. Acquiring that lock does not itself make later reads fresh. Existing marketplace writers update `runtime_meta` under the common lock; the row fence must cause a stale snapshot to fail rather than accept outdated terms. The wallet head update supplies the corresponding wallet fence. Prove the waiting-writer case with actual PostgreSQL transactions.

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

- Capture fixed command histories and expected hashes from the current engine before changing it. Regenerating both history and expectations with the new implementation does not establish compatibility.
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

## Implementation boundary

A pure planner and shared-transaction groundwork are provider-independent work that can proceed offline with synthetic data. An isolated test using a substitute marketplace table proves only that fixture's SQL atomicity. To claim actual integration, exercise the extracted real repository participants and the enrolled-writer guards, with native PostgreSQL concurrency and failure injection.

Durable resizing remains incomplete until the command/version/backup decision, binding migration and all enrolled financial writers are implemented and verified. Production routes, deployments and real funds remain outside this stage.

## Primary database references

Reviewed 4 November 2026. The snapshot and locking implications above apply these documented rules to the inspected repository; the proposed coordinator itself has not been implemented or proven by this source review.

- [PostgreSQL 17 transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html): fixed transaction snapshots, conflicts and whole-transaction retries.
- [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html): changed-row rejection under SERIALIZABLE, consistent lock ordering and application-defined advisory locks.

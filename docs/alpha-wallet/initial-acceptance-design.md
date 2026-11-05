# Initial seller acceptance: development groundwork

Date: 5 November 2026 (Asia/Jerusalem). [Exact-source verification at `3d119889`](initial-acceptance-verification-2026-11-05.md): 1,390 tests, eight native PostgreSQL drills/75 checks, root TypeScript and the retained English/Arabic Chromium rehearsal passed. The [machine-readable evidence](initial-acceptance-verification-results.json) binds the run, artifact and file hashes.

**Implemented scope: a pure initial-acceptance plan, a separate caller-owned canonical SQL participant, and frozen v2 history evidence. The authenticated seller-to-reservation coordinator is not implemented. Nothing in this milestone connects a route, activates a new cohort, changes an old engine contract or authorizes live use.**

The established private coordinator accepts a buyer's stored amount correction on an already accepted and reserved trade. Initial seller acceptance has different authority and write requirements: the seller accepts an existing buyer request, the canonical request becomes accepted, a physical trade projection is created or advanced, and the listing's representative lock is updated. The focused correction participant correctly forbids those lifecycle changes. Its write allowlist and financial contract stay unchanged; this milestone also hardens its failure cleanup against swallowed runtime-guard errors.

The successor [v3 financial milestone](ledger-v3-initial-acceptance-design.md) now implements the separate seller-native reservation, immutable financial receipt and isolated paused recovery. The canonical participant and its original pause-only drill below retain their scope; no authenticated end-to-end initial coordinator is implied.

## Why initial acceptance needs a new financial contract

The retained `reserveTrade` command in the v1 sandbox and the pinned v2 kernel requires a buyer actor and uses that actor's ID as the trade buyer. Its quote comes from the wallet listing price. Replacing its actor with the seller would misidentify the buyer, while manufacturing a buyer actor during a seller request would misstate who authorized the action.

The new planner records two separate facts: the seller action being planned and the buyer request retained in canonical storage. Neither is an authentication proof, a signature or an execution capability. The plan always has `executionAuthority: false`. Original v1/v2 snapshots retain `requiredExecutionContract: "seller-initial-acceptance-not-implemented"`; explicitly validated v3 snapshots return `"seller-initial-acceptance-v3"`. This version selection does not grant session authority. It never invokes `reserveTrade`.

The existing v2 command union, replay engine, continuation metadata, SQL guards and recovery format are closed contracts. This stage does not add an operation to them or change the meaning of their recorded history. The separate v3 command now supplies its own explicit continuation and compatible isolated storage/recovery design. The current `canonical-cohort-v1` format continues to describe its original enrolled amount-correction cohort only.

## Pure plan

`src/lib/alpha-wallet/initial-acceptance.ts` exports `planDevelopmentInitialAcceptance`. The caller supplies the exact request identity, seller action, operation ID, chosen acceptance clock, explicit asset/listing/trade mapping, canonical dependencies and a verified wallet snapshot/checkpoint. The function reads no database, obtains no session, writes no row and sends no event.

Its explicit canonical inputs are:

| Collection | Required completeness |
| --- | --- |
| Users | Target participants and the identities associated with the supplied canonical histories |
| Listings | Target seller inventory and listings linked by the canonical request set |
| Purchase requests | All seller reservations, all target-listing inventory, target trade-identity links, and the buyer's history across every seller |
| Commissions | Unpaid seller obligations of either participant and any existing target-request commission progress |
| Seller reviews | Explicit legacy in-memory review evidence; current SQL reviews are embedded in request payloads |
| Enforcement records | The seller's current marketplace enforcement context |
| Evidence and disputes | Target request/trade evidence and dispute history, including historical progress that a status rollback must not erase |

The legacy `sellerReviews` collection is not a physical `seller_reviews` table. The new SQL reader does not invent such a table. An arbitrary caller can omit rows even if an input object has the correct shape; structural validation alone cannot establish authoritative completeness or freshness. The future coordinator must own the complete fenced read.

### Supported first cohort

This stage targets an ordinary pending listing-price request, with its preallocated platform trade ID and retained buyer submission. It supports current ILS fee/calculation versions, Bank Transfer with complete frozen payment instructions, and Face-to-Face with the required seller safety acknowledgment. The wallet asset and simulated receiving destination must match the canonical network and mapped listing. Owner approval and full funding are separate prerequisites.

The planner preserves the seller's three-active-trade limit, available inventory after existing reservations, the buyer's active-trade and review obligations, seller approval and availability, both parties' unpaid seller commissions, bilateral account blocks, enforcement and payment/progress locks. Its explicit wallet cohort also requires canonical email/phone/adult evidence for both participants. These wallet eligibility prerequisites do not rewrite the existing production acceptance helper.

Demand matches, buyer price offers, counteroffers, prior amount proposals, missing legacy trade identities, historical fee policies, Wise, cash-withdrawal credentials, cross-network mappings, archived buyer confirmation histories, and progressed/closed listing histories need their own supported transitions. The target timeline is limited to the original buyer submission; prior bank-detail disclosure or reminder entries are outside this first cohort even when the manual marketplace permits them. A valid manual marketplace request can therefore be outside this first wallet cohort. Unsupported does not mean that the underlying marketplace request is corrupt or that its product policy has changed.

The accepted unit price comes from the retained request. A later public listing price cannot silently reprice it. The plan records whether the current wallet listing price differs; the separate v3 transition now executes the exact retained quote. The old listing-priced reservation command remains unsuitable for this seller action.

The first financial plan requires an unreserved target listing and refuses noncancelled wallet trade history on that listing. It also refuses prior active seller wallet trades on other listings whose canonical relationship is unproved. Equal aggregate amounts cannot prove that existing canonical and wallet reservations belong to the same request and buyer. Competing reservations therefore need explicit, verified one-to-one bindings before this planner can include them. Ordinary pending sibling requests remain possible because they reserve no principal. Canonical commitments on other listings still count toward the seller's general three-trade limit; this limited implementation does not lower that product policy.

### Plan identity and exact principal

The immutable result contains the canonical decision, retained terms description, seller action and buyer-request provenance, stable business acceptance key, precondition digests, wallet checkpoint and exact raw-unit listing-to-trade reservation intent. It binds participants, request/listing/trade mapping, asset, receiving destination, locked price, frozen payment instructions and the existing fee versions.

The operation ID and chosen plan clock are not new business acceptance identities. Repeating the same request under a different transport operation ID must not become a second sale. Current input/state digests still change when the underlying canonical or wallet evidence changes. The v3 financial receipt retains the first committed command and event identities; the future canonical coordinator must preserve those identities while rechecking current authority.

Principal is the full requested USDT amount. A 200-USDT acceptance plans a 200-USDT reservation. The buyer's fiat-inclusive fee and the seller's separate commission obligation never reduce that principal. Amounts are parsed as exact integer units; the BSC fixture asset retains its eighteen-decimal representation of the marketplace's six-decimal quantity.

## Separate canonical SQL participant

`mutateDevelopmentInitialAcceptanceInTransaction` in `src/lib/alpha-exchange-repository.ts` accepts an already-owned writable `SERIALIZABLE` simulation transaction. It certifies a stable transaction ID, obtains the request/global locks, fences the runtime version and locks the target listing before reading the authoritative basis. It neither opens a connection nor begins, commits, retries, releases or publishes a transaction.

The query selects candidates through both normalized columns and payload links. It includes the buyer's requests at other sellers, every request linked to the target listing, and requests linked to the preallocated trade identity. It checks normalized/payload identities, states, timestamps and precision before exposing the cloned basis. A JSON round trip is compared inside PostgreSQL so a large JSON number cannot be silently rounded and persisted by JavaScript.

The callback returns only `{ requestId, actorUserId, tradeId, acceptedAtMs, safetyAcknowledged? }`. It cannot return an arbitrary replacement snapshot or choose arbitrary notification/audit payloads. The participant clones that decision, rereads the canonical basis, checks the narrow supported transition and constructs bounded deterministic effects itself.

A canonical pending request can have either no physical trade projection or an exact pending projection created by a prior full snapshot save. Acceptance preserves its preallocated identity. An existing projection must agree with the original request and normalized fields; a collision or prior accepted history is refused. The transition uses the established repository encoding while keeping unrelated rows and ordering intact.

The resulting write set is limited to the target pending-to-accepted request, its physical trade projection, the listing's representative lock/status, deterministic request timeline and bounded notification/audit records, and the runtime version. **The canonical listing's `availableAmount` is not decremented at acceptance.** Existing active requests reserve against that amount; the separate v3 command moves principal between its own listing and trade accounts. Atomic coordination of these two domains still requires the authenticated initial coordinator.

If a semantic callback or validation failure occurs after companion wallet writes, the participant aborts only the certified still-current transaction. Swallowing that error cannot permit a one-sided commit. A replaced or unowned transaction is never poisoned. Both the new and retained focused participant use physical transaction identity for failure cleanup; a failed runtime check cannot prevent them from reporting failure to the transaction owner. The transport also records a query/exec runtime-guard rejection as a transaction failure: restoring the environment after swallowing that rejection cannot permit an earlier write to commit. This strengthens the owner boundary without changing a historical ledger command. The owning store remains responsible for retrying the entire decision after a genuine serialization failure.

This participant rejects the existing coordination/recovery namespace before and after work. It cannot be used to bypass the enrolled amount-correction writer guards or append unsupported lifecycle mutations to a restored cohort. It provides persistence mechanics, not seller authentication, a reservation capability, initial-acceptance idempotency or activation.

## Native transaction evidence

`scripts/alpha-wallet/postgres-initial-acceptance.ts` uses two explicitly named fresh loopback PostgreSQL databases. It installs only disposable synthetic schemas, accounts, requests and funded wallet fixtures. It does not discover an environment database URL or create/drop a database itself.

The drill calls the real planner from inside the real participant. Its companion wallet operation is an independently authorized synthetic operator pause. That tests shared commit and rollback without impersonating the buyer or claiming that the seller reservation exists.

The checks cover:

- A swallowed callback error after a wallet write, a swallowed runtime-guard rejection followed by environment restoration, and an actual SQL error after canonical writes, all requiring complete rollback.
- A joint canonical acceptance/physical projection/listing-lock/event commit with the operator pause.
- Preserved full listing inventory, zero wallet reservations and zero payouts in this deliberately limited mechanics fixture.
- A synthetically lost acknowledgment after a real commit, direct same-target inspection, duplicate acceptance refusal and reopen with identical hashes.
- A visibly waiting old snapshot behind a canonical writer that changes the buyer's active history at another seller; the complete transaction must retry and refuse the newly ineligible acceptance.
- Two native backends competing for one request; one transition commits and the retried loser refuses the already accepted request.

These accepted canonical rows are **not a valid coordinated wallet-backed sale**, because the planned reservation has not been executed. The wallets finish paused. The drill is not an initial-acceptance receipt-recovery protocol or a supported new backup cohort. The exact executed results belong in the separate verification report; source code alone is not proof of a passed native check.

## Frozen v2 history

`src/lib/alpha-wallet/fixtures/v2` retains an actual exported history and full tagged state produced by the unchanged verified ledger source `47f0fc18` at documentation successor `6dc63a89`. Capture compared 33 retained source files byte-for-byte with that verified Git commit before writing a fresh temporary wallet.

The 41 committed commands include the original v1 prefix, a held uncertain withdrawal, explicit v1-to-v2 continuation, operator enrollment of existing reservations, buyer amount increases/decreases, a separate zero-delta acceptance, full corrected payouts and separately funded commission settlement. The TRON trade uses two proposals; the zero-delta acceptance belongs to a separate BSC trade.

`v2-history-compatibility.test.ts` reads the fixed files and compares original command, result, state and event hashes. It exercises restore/reopen, original receipt recovery, preserved unknown payout identity and suppression of historical dispatch authority. It rejects seller/operator reinterpretation of the old buyer command and unimplemented future command envelopes. Tests never regenerate their expected fixtures. The retained capture utility refuses changed pinned source and existing fixture files.

## Financial requirements and remaining coordination

The v3 milestone completes the separate financial continuation, first-cohort binding/receipt and isolated paused-wallet recovery requirements below. Before this groundwork can become an authenticated initial wallet acceptance, the coordinator and complete canonical recovery must satisfy the remaining requirements:

1. **Explicit version continuation.** Preserve the complete v1/v2 prefix and hashes; add a separate command envelope, engine identity, metadata and SQL guard/migration contract. Ordinary initialization must never silently upgrade an existing store.
2. **Honest seller authority.** Authenticate the actual stored web/mobile seller in the same transaction, retain the existing buyer request/consent provenance, and use a seller-native reducer branch. Do not invoke the buyer reducer under a manufactured actor.
3. **Frozen accepted terms and identity bindings.** Bind the request's price and payment instructions, exact asset/destination and full principal independently of the current public listing price. Define immutable initial terms/binding metadata and its relationship to later buyer-approved corrections. Before admitting competing reservations, prove complete one-to-one canonical/wallet trade identity and terms coverage; matching quantities alone is insufficient.
4. **One coordinated commit.** Derive the plan from fenced canonical reads and verified replay; commit the new financial transition, narrow canonical acceptance, immutable business receipt and safe publication intent together. Recheck current authority after awaited work.
5. **Retries and writer fences.** Deduplicate by the business acceptance, recover the original receipt only after fresh authorization, distinguish unknown COMMIT from failure, and fence every unsupported legacy/canonical writer after explicit activation.
6. **A distinct recovery contract.** Export and restore the new cohort/version as one validated unit with original hashes and receipts, paused source/target rules, credential quarantine and unknown-COMMIT inspection. The existing amount-correction bundle must retain its original meaning.
7. **Further lifecycle and product work.** Subsequent proposals, payment/cancellation/dispute/release/settlement transitions, real web/mobile screens and routes, and deduplicated external delivery still need their own integration. Preserve review, rank/benefit, privacy and fee behavior throughout.

The original groundwork introduced no financial version. Its separate successor adds only explicit development v3 storage and simulation commands; no production migration, real provider, signer, live account or deployment is introduced. The existing [launch readiness gates](launch-readiness.md), [private coordinator](marketplace-coordinator-design.md), [mobile authority contract](marketplace-mobile-auth-design.md) and [combined recovery boundary](marketplace-recovery-design.md) continue to apply.

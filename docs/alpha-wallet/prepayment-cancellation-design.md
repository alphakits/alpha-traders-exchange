# Prepayment cancellation: financial and canonical groundwork

**Later integration:** the separate [authenticated cancellation successor and complete combined recovery](cancellation-marketplace-coordinator-design.md) is implemented and [verified](cancellation-marketplace-verification-2026-11-06.md). The original isolated APIs described here retain their original scope.

Development scope, 5 November 2026. All funds, addresses and assertions in the verification fixtures are synthetic. This work adds a closed isolated V4 ledger and a separate canonical transaction participant. **It does not expose an authenticated cancellation route or upgrade an activated marketplace cohort.** The existing initial coordinator and its recovery profile remain unchanged and closed to cancellation.

## Supported outcome

An initial trade accepted under V3 has one immutable acceptance, frozen terms and a full-principal reservation. The isolated V4 transition returns that exact principal from the trade account to the same wallet listing. In the standard fixture, the listing has 300 USDT and the trade has 200 USDT before cancellation; afterward the listing has 500 USDT and the trade has zero. No seller withdrawal, buyer payout, commission, chain observation or provider submission is created.

Only the retained seller or buyer may be the financial command actor. Those are strict identity assertions within the isolated simulation, not proof of a stored authenticated session. The separate successor derives them from current stored authority and locked canonical rows. An operator can continue or pause the ledger; an operator cannot cancel on a party's behalf.

The canonical groundwork accepts an already accepted initial-style Bank Transfer or Face-to-Face trade with unchanged listing-price terms, the current fee policy, one of the two supported simulated asset mappings, an exact existing physical trade projection, an exact representative listing lock, no competing reserved sibling, and an absent or future listing expiry. Expired or malformed expiry is refused. Canonical expiry does not establish a withdrawal entitlement, so this version cannot infer a sweep to seller-available balance or reopen an expired listing.

## Original history remains original

The V1, V2 and V3 command parsers, reducers, SQL migration files and historical recovery formats are unchanged. The frozen V3 fixtures were captured from the verified source `2c3e6a0b809f9bb34f84dcc82243593ba079ee1f`, before the new engine was used. Their provenance records source guards, hashes and both the original unpaused prefix and paused backup.

V4 admits only `continueFromV3`, `cancelInitialTrade` and `pause`. Its continuation records the exact V3 revision, event hash, state hash, last command clock and source halt reason. An already paused source remains paused. There is no resume command.

Every historical prefix replays through its original reducer and strict envelope. A command's global transport key retains the existing actor/kind/type/request tuple; changing the engine never creates a second identity namespace. An exact historical retry returns its original revision, result and event hash. A historical dispatch retry always reports `shouldDispatch: false` and returns the current retained payout state.

V3 invariants correctly require its initial trades to remain reserved. V4 therefore validates its original source by reversing only its own exact receipt/journal/idempotency suffix, restoring those initial trade statuses, and checking both the unchanged V3 invariants and the original source state hash. Each cancellation's recorded prior wallet-state digest is also checked during reversal. That source view is for validation and immutable receipt recovery; it is never passed to an older reducer to authorize new activity.

## Cancellation identity and retained terms

The business key is the digest of the fixed initial-cancellation namespace, platform request ID and original acceptance key. One original acceptance can have only one cancellation receipt, independently of transport retries. The receipt also binds the actor kind and ID, original acceptance revision/key/digest, initial binding digest, exact terms digest, canonical assertion digests, full principal return, original wallet checkpoint and cancellation clock.

The input supplies no free-form reason, alternate price, substituted destination, fee waiver or changed principal. It must retain the original accepted terms. The principal moves in one journal with exactly two entries: a debit of the entire reserved principal from the original trade and an equal credit to its original listing. Existing payouts, commissions, chain claims, V2 bindings and all original V3 acceptance records remain unchanged.

A new transport operation with identical actor and input recovers the original business receipt. Changed actor or evidence under the same business identity is refused. A current already-cancelled canonical row, by itself, is not financial retry authority; the separate successor coordinator establishes the original immutable cancellation receipt under current authority.

## Canonical policy and effects

The pure planner follows ordinary marketplace cancellation rather than the owner force-close path. It reads the retained buyer/seller identities and applies the shared lifecycle-field and embedded-evidence predicate, stored evidence checks for either party, and the open-dispute rule. The new bounded groundwork additionally refuses nine known payment, settlement or evidence timeline events when an accepted row otherwise claims to be unpaid; this is a consistency restriction in the new planner, not a change to production cancellation policy. Buyer-visible bank details separately block buyer cancellation. The seller can still cancel an unpaid Bank Transfer trade after disclosure. Resolved dispute history is retained. Wise, Cardless, demand matches and adjusted terms are outside this initial scope.

New-sale `canSell`/`canBuy` eligibility is not substituted for cancellation policy. The separate successor's stored authentication establishes an active valid session/account and the actual party relationship.

The exact canonical effects are:

- Set the request and physical trade to cancelled and append one deterministic cancellation timeline event using the stored actor role as metadata.
- Preserve identities, retained quote, original accepted creation time, messages, disclosure history and unrelated normalized fields.
- Clear action-reminder and inactivity-warning state, withdraw a pending terms proposal, and record trust-reconciliation intent.
- Unlock the exact representative listing and return its status to active; its canonical `availableAmount` is preserved, not incremented by a wallet amount.
- Append the listing-reopened audit and two deterministic party cancellation notifications. Archive only matching live buyer action reminders while retaining their IDs and order.
- Create no manual close fields, system close chat, commission, SMS or external delivery.

The supplied cancellation clock is used consistently; the planner does not obtain an independent wall clock. Transaction checks preserve normalized and JSON agreement, physical projection identity and row ordering.

## Transaction ownership and SQL fences

`withDevelopmentPrepaymentCancellationInTransaction` is a development mechanical participant. One outer owner supplies explicit writable SERIALIZABLE `BEGIN`, whole-decision retry and `COMMIT`. The participant certifies the physical transaction, captures input before asynchronous work, reads and rechecks its canonical dependencies, permits one awaited cancellation and verifies the exact resulting rows. A caught failure after certification marks only that original transaction failed. It does not start, commit, or abort a replacement transaction.

Both this canonical participant and the standalone V4 financial writer refuse either existing coordination namespace. This is deliberate compatibility protection: the current initial profile allows only activation, acceptance, inspection and pause, and its coherent canonical poststate is fixed at acceptance. Changing that profile requires a separately reviewed successor migration, authenticated coordinator, publication contract and combined recovery format.

The explicit `durable-v4-migration.sql` runs only after verified complete V3 replay and a source-bound continuation command. DDL, continuation registry, command and format-4 head share one physical transaction. The retained V2 and V3 SQL checks continue to cover their original historical intervals. New SQL checks enforce the V4 envelope, original party/acceptance/terms linkage, prepayment assertion shape, unpaused/unexpired condition, one full-principal return and one immutable receipt. No new payouts or historical projection inserts are allowed. The original projection tables and migration source files are preserved.

SQL protocol settings are compatibility gates, not account authentication. Hash consistency and supplied canonical booleans do not authenticate external facts. Production grants and protection against privileged hostile DDL are separate launch requirements.

## Isolated V4 recovery

The separate format-4 `isolated-v4-ledger` backup retains all four command versions and all three explicit continuations. Export requires a durably paused source and refuses canonical/coordination schemas and application tables. Original formats continue refusing V4.

Inspection checks the strict envelope, size and command limits, checksum, original per-version semantic replay and exact final checkpoint. Fresh-target restore replays each prefix through its original wallet/upgrade API, verifies every recorded revision and event hash, and appends one V4 quarantine pause in the same outer transaction. Both source and target remain paused. No credential, signer, real receiving address or provider state is included.

Two fresh-target restores share the existing advisory gate. An already committed target is never overwritten. After an uncertain COMMIT response, inspect that same target and compare its original prefix and quarantine checkpoint; an error response is not proof that a restore failed. Likewise, an inherited `submission_unknown` payout stays reserved for lookup of its original reference and cannot be dispatched again.

## Verification and remaining integration

The focused suites cover principal conservation, buyer/seller scope, both synthetic assets, strict envelopes and checkpoints, immutable original evidence, expired/disclosed-bank refusals, raw SQL attempts to change the return, input capture, transaction poisoning, restart and response-loss retry. The native scripts separately exercise isolated financial races/recovery and canonical transaction mechanics with an explicitly synthetic wallet pause companion. The companion proves common transaction ownership; it does not claim that an authenticated cancellation coordinator exists.

The [exact-source verification report](prepayment-cancellation-verification-2026-11-06.md) records **2,232 passing tests across 63 files**, zero failures/skips, **13 native PostgreSQL drills / 139 checks**, root TypeScript and the retained English/Arabic Chromium rehearsal at `73970284b87fdce6d1daf97b6b3ebefa757825f3`. The [machine-readable evidence](prepayment-cancellation-verification-results.json) retains original case inventories, PostgreSQL outcomes, workflow metadata and verified artifact hashes. Passing these checks completes this groundwork only. The later [authenticated successor](cancellation-marketplace-coordinator-design.md) now atomically couples current web/mobile authority, canonical cancellation, V4 principal return, original cancellation receipt and deduplicated publication through a successor profile, with full combined recovery. Its independent fences order cancellation against payment/evidence/disclosure/dispute/expiry and revocation writers and preserve valid original receipt recovery after pause.

The receiving-wallet preference is now Trust Wallet, as recorded in [custody-decision.md](custody-decision.md). No actual wallet or key has been created or connected. That preference does not change accounting, finality, uncertain-submission or production launch gates.

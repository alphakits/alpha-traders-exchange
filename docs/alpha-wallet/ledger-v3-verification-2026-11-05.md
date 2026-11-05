# Seller-native v3 ledger: exact-source verification

Date: 5 November 2026 (Asia/Jerusalem). Completed at **16:51:13 IST**.

**This development checkpoint passed. Alpha Wallet is not authorized for live launch.** The new v3 ledger can record the seller's initial acceptance and reserve the full principal under a separate financial contract, preserve all prior command history, and export/restore a paused isolated wallet. Same-transaction seller authentication, canonical marketplace coordination and combined initial-cohort recovery remain unfinished.

## Verified checkpoint

| Item | Evidence |
| --- | --- |
| Branch | `feature/alpha-wallet-dev-20261104` |
| Verified source commit | `f18e95e689462895aeed2a5dd5e1244b3bbd85a1` |
| Verified Git tree | `1f25a49d747cab6a13da63eaf4dd7cd2d58a588d` |
| Previous verified application source | `3d119889ca4c3632a04cecdfd11c88d39f2d96da` |
| Starting documentation checkpoint | `90e1710d29ede37ae564458789a2cfcbc9ff2ab9` |
| CI run | [42047051651](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42047051651) |
| CI job | `127312748139`; completed successfully |
| Artifact | `13425668474` — `alpha-wallet-simulation-evidence-f18e95e689462895aeed2a5dd5e1244b3bbd85a1` |
| Archive bytes | 2,035,750 |
| Artifact SHA-256 | `06e53b9fceb4c470d584f8e29835e0973071763a49b7aeb8b3901e72399b6803` |
| Extracted evidence | 36 exact allowlisted archive paths; archive size/digest and every extracted file rechecked |
| Runtime | Node v24.22.1; npm 11.19.1; PostgreSQL 17.11; Chromium 149.0.7827.55 |

The [machine-readable verification](ledger-v3-verification-results.json) binds these identities to complete case inventories, native results, preserved source/fixture hashes and artifact-file checksums. Later documentation-only commits do not claim a different application source passed this run. The [design contract](ledger-v3-initial-acceptance-design.md) describes the implemented scope.

## What changed

The strict v3 command envelope permits only explicit `continueFromV2`, seller-native `acceptInitialSellerRequest`, and operator `pause`. Old v1/v2 envelopes retain their recorded meaning and cannot append new actions after continuation. Initialization never silently upgrades an existing wallet.

Initial acceptance records the seller as the actor and retains the buyer and request provenance separately. The descriptor binds the preallocated platform trade, mapped wallet trade/listing, network, destination, frozen terms/instructions digest, policy versions and verified wallet checkpoint. It is recorded evidence supplied by a trusted fixture or future coordinator; it is not a session, signature or proof of complete canonical reads.

The new initial binding and receipt are immutable and separate from the old v2 enrollment/correction contract. Business retries with the same actor and exact evidence return the original command key, revision and event hash, including under another transport operation ID or after pause. Changed actor/evidence is refused.

The concrete native case preserves a wallet listing price of **3.20 ILS** while accepting the buyer's retained **3.10 ILS** request. From a **500-USDT** funded listing, it reserves the full **200 USDT** and leaves **300 USDT** available. Its buyer-inclusive fiat quote is **626.20 ILS**. Quoted fees never reduce the reserved principal, and acceptance creates no payout or commission settlement.

Storage format 3 adds its own continuation, binding and receipt projections. The migration and continuation commit together; complete replay checks every original and new command/result/state/event hash and stored projection. SQL independently checks full-principal journals, receipt/binding coherence, immutable rows, old writer/version rejection and late projection writes. Historical projections are sealed even when an earlier engine's history was restored in the same transaction.

The separate backup format requires an actually paused source and an isolated wallet database. It refuses canonical/coordination schemas and unrelated public relations. Restore preserves the complete v1/v2/v3 history at its original times, verifies the source checkpoint, then appends a deterministic quarantine in the same transaction. Failure cannot leave a partially restored active wallet.

## Automated results

| Suite | Passing tests | Files |
| --- | ---: | ---: |
| Wallet, ledger, persistence, recovery and private coordination | 1,439 | 39 |
| Retained platform authentication contracts | 87 | 5 |
| Retained marketplace/storage contracts | 100 | 4 |
| **Total** | **1,626** | **48** |

There were **zero failures and zero skipped tests**. All **1,203** prior wallet cases were retained, checked as a multiset of repository path and full case name so repeated parameterized titles remain counted. The **236** additions are:

| New test file | Passing cases |
| --- | ---: |
| `src/lib/alpha-wallet/v3-engine.test.ts` | 143 |
| `src/lib/alpha-wallet/v3-durable.test.ts` | 42 |
| `src/lib/alpha-wallet/v3-backup.test.ts` | 31 |
| `src/lib/alpha-wallet/v3-history-compatibility.test.ts` | 20 |

The complete local wallet run also passed **1,439/39**, using two workers. Its case inventory matches CI. Root TypeScript and changed TypeScript ESLint passed with empty logs. Root TypeScript uses the repository's existing exclusions: `apps/mobile` and three pre-existing test paths are outside that gate. This report does not claim a native iOS/Android build or a full production build.

The frozen-history tests verify every one of the original **41 v2-fixture command checkpoints**, and exercise actual restore, explicit v3 continuation and reopen. Original v2 business receipts recover under new operation IDs; another buyer is refused. All historical dispatch lookups return `shouldDispatch: false`, preserving the original uncertain withdrawal and preventing renewed dispatch authority. Original financial source, SQL contracts and fixture bytes were compared with the starting checkpoint and remain unchanged; the initial planner alone gains explicit v3 recognition.

During local development, SQL parsing/argument qualification issues were found and corrected before this verified source was saved. Independent review also found and fixed acceptance at the exact request-update timestamp and a missing bound-listing invariant; targeted regressions cover both. No integrity requirement was removed to obtain a passing result.

## Native PostgreSQL evidence

All **nine drills and 86 checks** passed against disposable PostgreSQL 17.11 databases.

| Drill | Checks | Result |
| --- | ---: | --- |
| `postgres-concurrency` | 6 | Passed |
| `postgres-backup` | 6 | Passed |
| `postgres-marketplace-transaction` | 6 | Passed |
| `postgres-versioned-ledger` | 9 | Passed |
| `postgres-marketplace-coordinator` | 16 | Passed |
| `postgres-marketplace-backup` | 11 | Passed |
| `postgres-marketplace-mobile` | 12 | Passed |
| `postgres-initial-acceptance` | 9 | Passed |
| `postgres-v3-ledger` | 11 | Passed |

The new financial drill passed these eleven checks:

1. Explicit source-bound v3 continuation preserves all original v1/v2 command rows, hashes and balances
2. A real SQL failure after v3 migration DDL rolls back its schema and continuation, leaving a readable intact v2 store
3. Buyer and operator actors cannot impersonate the seller or alter the pending financial state
4. A real SQL failure after the command, journal and initial binding rolls back the full reservation and every projection
5. A swallowed runtime transport refusal after reservation cannot become committable after restoring the environment
6. A real seller acceptance reserves the full 200 USDT at retained 3.10 ILS terms; a lost COMMIT reply recovers its original identity once
7. Old writers/exporters, changed business-retry evidence and updates/deletes/truncates of immutable initial projections fail without changing history
8. Two visibly competing PostgreSQL backends retry the complete decision and return one original seller receipt with exactly one reservation
9. The paused v3 wallet exports a distinct wallet-only format and preserves original history without reauthorizing an uncertain payout
10. Two fresh-target restores visibly contend; one commits the exact three-engine history plus quarantine, and a lost reply is resolved by inspecting that same target
11. A new native connection reopens the exact quarantined state and recovers the original acceptance under a new transport operation

The acceptance race observed a real lock wait on distinct backends, then **2 attempts** for the waiting transaction. Both callers received one original receipt, with one new reservation. The fresh-target restore race also observed distinct backends and a real advisory-lock wait; one restore committed, the competing caller was refused, and inspection established the committed quarantined state.

The lost-acknowledgment cases inject a missing reply **after an actual database commit**. This tests unknown-outcome recovery without claiming a physical network partition. The financial fixture performs **zero canonical marketplace writes, zero authenticated seller sessions, zero provider submissions and zero production writes**. Its older uncertain payout exists only as retained synthetic command history.

The original initial-acceptance mechanics drill remains separate: it uses a synthetic operator pause beside canonical acceptance and creates no financial reservation. Its passing result is not combined initial-cohort activation or recovery evidence.

## Browser and offline verification

The retained standalone Chromium rehearsal passed at **1440-pixel English desktop** and **390-pixel Arabic mobile** widths. Arabic remained right-to-left with no horizontal overflow. The existing offline simulation also passed.

Those browser results verify the existing synthetic rehearsal. This milestone adds no v3 product screen, public route or actual platform sign-in flow.

## Boundaries and next implementation

The first financial cohort supports ordinary pending listing-price requests, current ILS fee policy, Bank Transfer with frozen instructions, and Face-to-Face with explicit seller acknowledgment. It refuses competing target-listing reservations, noncancelled target-wallet-listing history and unpaired active seller wallet trades. Equal amounts are insufficient to prove that canonical and wallet trades belong to the same request and buyer. The general three-active-trade policy remains unchanged.

V3 currently holds initial trades in their reserved state. It has no resume, new funding, enrollment/correction, payment, cancellation, dispute, release, payout or settlement command after continuation. Each broader lifecycle requires its own reviewed financial and canonical contract.

The next integration must derive current stored web/mobile seller authority and selling eligibility in the same transaction, own complete fenced canonical reads and wallet replay, then atomically commit canonical request/trade/listing effects, the financial reservation, original receipt and safe publication intent. It must recheck authority after awaited work, preserve authenticated business retries, fence unsupported writers and supply a distinct combined initial-cohort recovery format. Existing `canBuy` or owner fields alone do not establish selling permission.

Automatic deployment remains disabled for the development branch. The branch-filtered deployment lookup returned **zero deployments**. This work performed no main merge, production migration/write, real account signup, external message, real provider/key/signing operation or live-funds action. Broader product, custody, operational and independent review gates remain open in [launch-readiness.md](launch-readiness.md).

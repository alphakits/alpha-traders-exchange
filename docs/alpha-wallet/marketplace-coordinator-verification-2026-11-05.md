# Alpha Wallet canonical coordinator verification

Date: **5 November 2026, Asia/Jerusalem**. CI completed by **4 November 2026 at 23:47:57 UTC**.

**Result: the private development coordinator milestone passed. Live launch remains withheld.** The actual focused marketplace SQL participant now commits an authenticated buyer's accepted amount correction together with the matching v2 wallet reservation change, immutable receipt and safe publication intent. This is a deliberately bounded synthetic cohort, without a public route, provider integration, production migration or deployment.

## Exact source and evidence

| Item | Verified value |
| --- | --- |
| Source commit | `ecc3752252e1ecb1860735136211c03a15ceb959` |
| Source tree | `e5ae6bb99d9c0a359f53a1f2dc9c745b8fa18573` |
| Development branch | `feature/alpha-wallet-dev-20261104` |
| CI run | [41935370927](https://github.com/alphakits/alpha-traders-exchange/actions/runs/41935370927) — completed, success |
| CI job | `126942372851` |
| Downloaded evidence artifact | `13372664780`, 2,004,118 bytes, 28 expected files |
| Artifact SHA-256 | `f37f0dd0980790ae2666e6a68d5c79faa9219ea136886cdc6d2a192046f05929` |
| Runtime | Node 24.22.1; npm 11.19.1; PostgreSQL 17.11; Chromium 149.0.7827.55 |

The downloaded ZIP's actual byte count and SHA-256 matched GitHub's published artifact metadata. Extraction accepted only the 28 expected report/log/screenshot paths. The complete retained [verification results](marketplace-coordinator-verification-results.json) include every test name/status, native drill results, browser assertions, exact CI metadata, deployment evidence and source hashes. GitHub's uploaded artifact expires on 18 November 2026; the results document is retained with the development branch.

The final evidence/readiness save changes documentation only. The commit above is the implementation that ran through the complete pipeline; later documentation does not imply that a different application source was tested.

## Executed verification

| Check | Result |
| --- | --- |
| Wallet unit, persistence and integration suite | **811 passed**, 27 files, zero failed or pending |
| Retained platform authentication regressions | **87 passed**, 5 files, zero failed or pending |
| Retained marketplace/storage regressions | **100 passed**, 4 files, zero failed or pending |
| Total automated tests | **998 passed**, 36 files |
| Full-project TypeScript | Passed with `--noEmit --incremental false --pretty false` |
| Native PostgreSQL drills | **5 passed**, containing **43 checks** |
| Existing Chromium rehearsal | English desktop at 1440 px; Arabic mobile at 390 px with RTL; no console errors or horizontal overflow |
| Frozen v1 compatibility | All 10 recorded source hashes remain unchanged; existing frozen replay/restore tests pass |

The 119 added wallet cases comprise 57 fixed web-authentication cases, 47 canonical coordinator cases and 15 SQL coordination/fence cases. They exercise real isolated PGlite databases and actual focused marketplace SQL, rather than replacing that repository with a fabricated marketplace adapter.

The first local four-worker wallet run stopped without a final result under the workspace's 8-GiB memory limit. Completed files had passed, but that incomplete run was not counted as a success. The complete suite then passed at two workers, and the saved CI workflow uses the same limit. The final local TypeScript run also passed. No assertions or financial guards were weakened to resolve the resource interruption.

The retained platform suites are targeted regressions, not the entire application's test inventory. The browser run checks the existing synthetic rehearsal; this milestone does not expose the new coordinator in that UI.

## What now commits together

Owner enrollment binds an existing accepted canonical request to its clean, funded and approved wallet reservation. Buyer acceptance derives identity from the stored web session and amounts from the stored seller proposal. The caller cannot supply an actor, computed fee, accepted amount or arbitrary wallet command.

One owned SERIALIZABLE transaction checks canonical inventory and physical row consistency, authenticates and locks the session/account, verifies wallet history/projections, applies the exact principal difference, resolves the canonical proposal and appends its receipt and deterministic events. Authentication is rechecked after awaited work and after the actual marketplace persistence, before the transaction owner returns to commit.

The native example starts with a fully funded 500-USDT listing and one accepted 200-USDT reservation. Accepting the stored 300-USDT proposal changes the allocations as follows:

| Allocation | Before | After |
| --- | ---: | ---: |
| Trade principal reserved | 200 USDT | 300 USDT |
| Listing principal available | 300 USDT | 200 USDT |
| Total principal accounted for | **500 USDT** | **500 USDT** |

Exactly 100 USDT moves between the same listing and trade accounts. At the locked ILS 3.20 price, the new canonical fiat quote is ILS 969.60, with 3 USDT buyer fee and 3 USDT seller fee recorded separately. The buyer's principal is not reduced. The native coordinator makes **zero provider submissions**; later payment verification and settlement are outside this cohort.

The accepted operation stores exactly one wallet/application receipt, publication intent, seller notification record, dedicated audit record and system message. These are durable records only: no email, SMS, push, realtime message or live cache publication is delivered. The system message is persisted in the canonical request's existing message array.

## Native database findings

The new [native coordinator drill](../../scripts/alpha-wallet/postgres-marketplace-coordinator.ts) passed all **16 checks** on three empty, disposable, loopback PostgreSQL databases. It records actual backend/lock observations and whole-transaction retry counts.

| Boundary | Observed result |
| --- | --- |
| Cross-domain rollback | A semantic rejection after the wallet write, a real SQL error after the canonical request update, and expiry detected after persistence each roll back financial and canonical acceptance effects together. |
| Older writers after activation | Changes to the enrolled request, its sibling request, listing inventory, evidence and truncation are rejected. Standalone wallet commands, reads, recovery workers and incomplete wallet-only export are also rejected. |
| Older writer before activation | A READ COMMITTED evidence writer that omits the global advisory lock physically versions the listing. Enrollment visibly waits on the row, retries its entire old snapshot, sees the committed evidence and rejects the now-ineligible trade. **2 attempts**, no enrollment or wallet command committed. |
| Pre-enrollment legacy snapshot | A SERIALIZABLE writer whose snapshot predates enrollment retries after the physical fence and is then refused by the active cohort guard. **2 attempts**. |
| Concurrent buyer acceptances | Two PostgreSQL backends with different transport operation IDs visibly serialize. The contender retries the whole decision and receives the original receipt. **2 contender attempts**, one financial command and principal transfer. |
| Revocation before authentication | Session deletion or account disable committed after the canonical snapshot but before the locked auth read each forces a complete retry, then returns the expected authorization denial. **2 attempts for each case**, no business changes. |
| Revocation after authentication | A concurrent session deletion visibly waits behind the accepted operation's session lock, then commits. That revoked credential cannot retrieve the receipt. A new valid stored session for the same buyer recovers it. |
| Lost reply and pause | A real acceptance commits before a synthetic lost response is injected. Owner pause remains available. An authorized buyer recovers the original revision/hash under a new transport ID while paused, without repeating the transfer or events. |
| Reopen | A fresh connection reconstructs the paused coordinated state with 300 USDT reserved, 200 available and no unfinished payout. |

The earlier four native drills were rerun on this source: independent wallet processes (6 checks), backup/paused restore (6), the actual focused SQL participant (6), and v2 continuation/correction/inherited recovery/mixed restore (9). Together with the new 16 checks, they account for all 43 native checks.

The SQL test suite additionally verifies that deferred commit checks reject deliberately omitted canonical updates, notifications or publication rows even when the explicit coherence call is skipped. It covers aliases such as notifications linked only by trade ID, inconsistent physical listing/trade/commission records, and deliberately corrupted retained hashes or public fingerprints. Such corruption tests use an isolated privileged fixture role; they are not evidence that an administrator capable of rewriting the whole schema/history is constrained by its own triggers.

## Authentication, privacy and historical recovery

The new web reader uses the same supplied transaction to lock actual session and account rows. It checks the application's SHA-256 session convention, normalized/payload agreement, stored timestamps, expiry, disabled state, verified email, existing phone-evidence/exemption rules, recorded adult confirmation and roles. Adult confirmation remains self-attestation.

Buyer ownership is checked before any historical acceptance lookup. Retained receipts and bindings are compared to their original wallet commands/projections; public fingerprints are re-derived from verified receipt fields. Historical recovery precedes fresh proposal/payment/pause eligibility, so a committed proposal can be recovered after it becomes accepted or the wallet is paused. Changed business input or a different actor is rejected.

Public results omit bank snapshots, account numbers, destinations, session tokens/hashes and private profiles. Unknown storage errors remove driver parameters and private causes; the unknown-commit class/code is preserved with a sanitized cause. Internal transaction registration and wallet lock-version rows may advance during authenticated inspection/recovery. The deduplication guarantee concerns financial commands, principal movement and canonical acceptance events.

The locking contract orders revocation against the accepted operation. A revocation queued behind an already acquired session lock does not retroactively cancel that operation. Expiry is checked at defined authorization checkpoints; there is no claim that PostgreSQL's eventual COMMIT acknowledgement must arrive before the wall-clock deadline. Coordinated mobile authentication remains unfinished.

## Isolation and launch decision

This checkpoint has no main merge, applied production migration, public wallet route, registered live worker, real key, signer, real provider or transfer. The exact development branch remains disabled for Vercel auto-deployment. The connected deployment query returned **zero deployments for this branch**, as recorded in the retained results.

The explicit initial cohort supports only one clean, already-reserved nonterminal wallet trade globally, the only active canonical reservation on its listing, an existing pending amount-correction proposal, Bank Transfer/Face-to-Face and current ILS policy. This does not alter the separate domain rule permitting three active trades per seller. Unsupported enrolled lifecycle writers are frozen until their corresponding wallet transitions are implemented.

**A combined marketplace/wallet backup and restore protocol remains a launch gate.** Existing wallet-only formats omit canonical rows and application receipts/publication intents, so their export is blocked after activation. Owner inspection/pause and preservation of the complete isolated source are the supported incident controls for this cohort. There is no resume operation.

Other remaining gates include initial trade acceptance and subsequent proposals, payment/dispute/cancellation/release/completion participants, coordinated mobile access, external delivery, real payment-evidence authority, selected custody/signing and provider test environment, production permissions/monitoring and independent review. The global serialized full-history replay design is development correctness evidence, not production capacity evidence. The native response-loss case is an injection after real commit, not a physical network partition.

See [the coordinator contract](marketplace-coordinator-design.md), [recovery procedures](recovery-runbook.md) and [launch readiness](launch-readiness.md) for the exact supported behavior and remaining work.

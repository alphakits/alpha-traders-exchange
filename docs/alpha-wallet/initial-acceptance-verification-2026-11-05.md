# Alpha Wallet initial acceptance groundwork verification

**Result: all gates passed for development source `3d119889ca4c3632a04cecdfd11c88d39f2d96da`.** Verification completed 5 November 2026 at 15:27:56 IST (Asia/Jerusalem). This milestone adds initial seller acceptance planning and canonical transaction mechanics, preserves historical v2 evidence, and closes a swallowed-runtime-error rollback gap. It does not implement an authenticated seller reservation or authorize a live launch.

The complete machine-readable record is [initial-acceptance-verification-results.json](initial-acceptance-verification-results.json). The implementation and supported cohort are defined in [initial-acceptance-design.md](initial-acceptance-design.md).

## Exact source and evidence

| Item | Verified value |
| --- | --- |
| Branch | `feature/alpha-wallet-dev-20261104` |
| Tested commit | `3d119889ca4c3632a04cecdfd11c88d39f2d96da` |
| Tested tree | `61e01e1602cb5ec1b964787373600a7f4671c517` |
| Previous saved checkpoint | `6dc63a8997532759727bd8b6691a780d373b6276` |
| Previous verified implementation | `47f0fc18f33c0f307da53726281db18055a76855` |
| CI run | [42034756783](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42034756783) |
| Job | `127269889379` — successful |
| Artifact | `13418890751` — `alpha-wallet-simulation-evidence-3d119889ca4c3632a04cecdfd11c88d39f2d96da` |
| Archive size | 2,025,665 bytes |
| Archive SHA-256 | `6b9ad600dd5921d51795df43aad153d72fe216221da17f89c877da621d494c84` |
| Archive contents | 34 exact allowlisted paths; each extracted file's size and SHA-256 rechecked |
| Runtime | Node v24.22.1, npm 11.19.1, PostgreSQL 17.11, Chromium 149.0.7827.55 |

The archive was downloaded, matched against CI's recorded byte count and digest, and extracted only after validating its complete path set, sizes and file types. Its JSON results and logs were checked against the successful run/job and exact source SHA. Subsequent verification-document edits are a separate documentation-only checkpoint; the commit above is the application source tested here.

## Verification correction retained in the record

The first CI attempt, [42033153323](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42033153323), passed all 1,390 tests, TypeScript and the seven retained native drills, then failed the new stale-buyer-history fixture. The fixture reused a PostgreSQL `timestamptz` parameter as text, changing the canonical payload timestamp format. The strict normalized/payload reader correctly refused it before reaching the intended business conflict.

The correction binds the canonical JSON independently from the SQL timestamp parameter. A local PostgreSQL-compatible reproduction confirmed the conversion, and the corrected data passed the actual canonical reader. No integrity guard or financial policy was relaxed. The successful exact-source run recorded above reran all gates, including the corrected native drill and browser rehearsal. The first attempt, diagnosis and archive digest remain in the machine-readable evidence.

## Executed gates

| Gate | Result |
| --- | --- |
| Wallet unit and isolated persistence suite | **1,203 passed**, 35 files |
| Retained platform authentication contracts | **87 passed**, 5 files |
| Retained marketplace/storage contracts | **100 passed**, 4 files |
| Total | **1,390 passed**, 44 files; zero failures or skips |
| Root TypeScript | Passed, empty diagnostic log |
| Changed TypeScript ESLint | Passed locally, empty diagnostic log |
| Native PostgreSQL drills | **8 passed**, **75 checks** |
| Offline wallet simulation | Passed |
| English desktop Chromium rehearsal | Passed at 1440-pixel width |
| Arabic mobile Chromium rehearsal | Passed at 390-pixel width, RTL, no horizontal overflow |

The complete wallet suite also passed locally with two workers. Its test identity inventory matches CI. All 1,016 prior wallet cases remain, including repeated parameterized titles; this milestone adds 187 cases: 129 planner cases, 36 new canonical participant cases, 17 frozen-v2 compatibility cases, four transaction-transport regressions and one retained focused-participant regression.

The TypeScript gate uses the root `tsconfig.json`, which already excludes `apps/mobile` and three existing test paths. It is not a native iOS/Android app typecheck/build or a full production build. Browser evidence remains the existing standalone synthetic rehearsal; no new initial-acceptance screen or production login is claimed.

## What changed and why

### Initial seller acceptance is a separate action

The new pure planner reads explicit canonical dependencies and a verified wallet checkpoint, preserves the retained request's price, principal, destination, fee policy and payment instructions, and produces an immutable plan with `executionAuthority: false`. It retains the preallocated canonical trade ID and records the requested seller action separately from buyer-request provenance. Neither record authenticates a user or authorizes a wallet command.

It checks the seller's operational eligibility and capacity, both participants' account evidence and commission debt, bilateral blocks and enforcement, owner listing approval, full funding, buyer history across other sellers, pending reviews and payment/progress locks. Bank Transfer uses the frozen request instructions; Face-to-Face requires the seller's safety acknowledgment. Public repricing cannot silently change the retained quote.

The first cohort is deliberately narrow. Target-listing competing reservations, noncancelled wallet trade history on that listing, and other active seller wallet trades with no proven canonical relationship are refused. The review identified why this matters: a reservation for the wrong buyer can have the same quantity and leave the same aggregate listing balance. Full one-to-one identity/terms bindings are required before those histories can be admitted. The general three-active-trade policy is unchanged; canonical commitments on other listings still count.

### Canonical acceptance uses a dedicated transaction participant

The new participant accepts only a caller-owned writable SERIALIZABLE simulation transaction and a narrow decision. It certifies physical transaction identity, acquires request/global/runtime/listing fences, and reads all relevant seller reservations, buyer history, commissions, enforcement, evidence/disputes and target trade references. Candidate selection follows both normalized and payload links, so an inconsistent row cannot hide a listing reservation or a reused trade ID.

It checks JSON number precision and normalized/payload identity, status and time coherence, including sub-millisecond mismatches. It clones the callback result and rereads the decision basis before writing. Only the target request, target trade projection, listing lock, bounded deterministic events and runtime version change. A pending projection already materialized by an ordinary full snapshot is checked and advanced in place; an absent projection is inserted using the existing encoder. Conflicts fail closed.

Canonical `availableAmount` stays unchanged at acceptance. The participant creates one timeline entry, one buyer notification and one audit record. These are stored development records; there is no SMS, external notification, realtime delivery, admin broadcast or product payment prompt. It refuses the existing coordination/recovery namespace and cannot extend the current activated amount-correction cohort.

### Runtime-guard failures cannot be swallowed into a partial commit

Review found that a caller could change the runtime after a companion wallet write, catch a guard failure, restore the environment and potentially commit the earlier write. Query/exec guards now mark that transaction as failed. Both the new participant and the retained focused participant use the certified physical transaction identity during failure cleanup, so a runtime failure cannot suppress rollback. Their write allowlists and financial policies are unchanged.

Real PGlite regressions verify complete rollback and reopening; adapter tests verify PostgreSQL sends rollback, performs no refused driver statement or commit, and does not retry a runtime rejection. The native initial-acceptance drill verifies the swallowed-runtime case against actual PostgreSQL as well.

### Historical v2 behavior remains fixed

The new immutable fixture contains 41 commands actually generated by the unchanged verified ledger source `47f0fc18f33c0f307da53726281db18055a76855`. It includes a v1 prefix and uncertain withdrawal, explicit v2 continuation, operator enrollment of existing reservations, buyer-approved increase/decrease/zero-delta corrections, full principal payouts and separately funded fees. It records the original command/result/state/event hashes, full tagged state and provenance.

Tests read the saved files; they never regenerate expectations. They verify replay, restore/reopen, original receipts and payout identities, suppress historical dispatch authority, and reject seller/operator reinterpretation of the old buyer command. All 33 original capture-source hashes remain recorded; 32 still match the tested source byte-for-byte. The sole change among those capture sources is the separately tested transaction transport hardening. Financial command/engine and SQL recovery contracts retain their original bytes and meaning, and the older frozen v1 fixtures remain unchanged.

## Native PostgreSQL coverage

| Drill | Checks | Result |
| --- | ---: | --- |
| postgres-concurrency | 6 | Passed |
| postgres-backup | 6 | Passed |
| postgres-marketplace-transaction | 6 | Passed |
| postgres-versioned-ledger | 9 | Passed |
| postgres-marketplace-coordinator | 16 | Passed |
| postgres-marketplace-backup | 11 | Passed |
| postgres-marketplace-mobile | 12 | Passed |
| postgres-initial-acceptance | 9 | Passed |

The new initial-acceptance drill passed these nine checks:

1. A swallowed callback rejection after an independently authorized synthetic pause still aborts the whole certified transaction.
2. Restoring the simulation environment after swallowing a runtime-guard error cannot commit an earlier wallet write.
3. A real SQL error after request, physical trade and listing persistence rolls back those rows, events and the companion wallet command.
4. One actual SERIALIZABLE backend commits exact pending-to-accepted canonical SQL, retained trade identity, bounded events and a synthetic operator pause together.
5. Canonical availableAmount remains 500 USDT; all 500 wallet USDT remain listing inventory, with zero fabricated reservations or payouts.
6. After a lost COMMIT reply, direct read verifies the original rows and a second initial-acceptance attempt is refused without additional writes; no acceptance receipt recovery is claimed.
7. Reopening a new native connection reconstructs the same canonical rows and original wallet command hashes with the wallet paused.
8. A visibly waiting stale transaction retries at runtime_meta and refuses acceptance after seeing the buyer's new active trade with a different seller.
9. Two competing native backends produce one Face-to-Face canonical acceptance and one pause; the waiting loser retries and refuses the already accepted request.

The two race cases observed actual advisory waits on distinct PostgreSQL backends. The stale-history case retried the complete SERIALIZABLE transaction and then rejected the buyer's newly active trade at a different seller. The competing-acceptance case committed one canonical acceptance, retained the pending physical projection's sort order, and refused the retried contender.

**The companion wallet command in this drill is an independently authorized synthetic operator pause.** It does not impersonate the buyer or create a seller reservation. Each isolated fixture retains all 500 USDT in wallet listing inventory, with zero wallet reservations, zero payouts and zero provider submissions. Its accepted canonical rows do not represent a completed coordinated wallet-backed sale or a supported new backup cohort.

The lost-COMMIT check injects a missing acknowledgment after a real commit, then verifies the same target through direct reads, duplicate refusal and reopening. It is not a real network partition or an authenticated initial-acceptance receipt-recovery protocol.

## Preserved boundaries and remaining implementation

No v1/v2 financial command was redefined. The existing amount-correction coordinator, web/mobile authentication readers and `canonical-cohort-v1` recovery semantics remain in place and were rerun. The current coordination and recovery SQL files remain unchanged. No `src/app` route, mobile product source or deployment configuration changed.

The next financial implementation requires an explicit seller-native ledger version/continuation, frozen initial terms and identity bindings, same-transaction web/mobile seller authority, a durable initial acceptance receipt and publication intent, activation/writer fences, and a distinct recovery contract. The seller action must not be recorded as a manufactured buyer `reserveTrade` command.

Subsequent proposals, payment/cancellation/dispute/release/settlement transitions, actual web/mobile product integration and deduplicated external delivery remain separate work. Production custody/signing, independent payment evidence, provider/finality checks, production recovery/roles, monitoring, controlled rollout and independent review remain open in [launch-readiness.md](launch-readiness.md).

The branch's automatic deployment setting remains disabled. A final read returned **zero deployment records for this branch**. No main merge, production migration/write, real provider or signing action, account signup, live transfer or outbound message was performed. The user's explicit hold on live launch remains in force.

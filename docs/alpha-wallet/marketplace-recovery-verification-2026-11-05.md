# Alpha Wallet combined marketplace recovery verification

Date: **5 November 2026, Asia/Jerusalem**. **Verification status: passed on the corrected source. Live launch remains withheld.**

This record concerns the private development recovery unit containing canonical marketplace records, the mixed v1/v2 wallet history, immutable application receipts and publication intents. It does not establish production recovery readiness. **The complete corrected-source pipeline passed, and its downloaded evidence artifact matched the published size and SHA-256.**

## Exact source and evidence

| Item | Value |
| --- | --- |
| Corrected source commit | `09405da202f9f0064bf54850a219d7a571901618` |
| Source tree | `d9a40a21a9b0b2d352dda423660181df40d0dbde` |
| Development branch | `feature/alpha-wallet-dev-20261104` |
| CI run | [42014911089](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42014911089) — **completed, success** |
| CI job | `127202905039` |
| Completed | **5 November 2026 at 11:05:28 UTC**, equivalent to **5 November 2026 at 13:05:28 Asia/Jerusalem** |
| Evidence artifact | **13409426450 — `alpha-wallet-simulation-evidence-09405da202f9f0064bf54850a219d7a571901618`** |
| Downloaded bytes / accepted archive paths | **2,013,924 / 30** |
| Artifact SHA-256 | **`cc4009a1212f48fb5358945dc1dec64675fda7cec0f536c1db93f3f76d385ced`** |
| Download verification | **Actual downloaded bytes and SHA-256 matched GitHub metadata; only the 30 expected paths were extracted** |
| Runtime | Node **24.22.1**; npm **11.19.1**; PostgreSQL **17.11**; Chromium **149.0.7827.55** |

The downloaded archive contained exactly 30 allowlisted report, log and screenshot paths. Its actual byte count and SHA-256 matched GitHub's artifact metadata before extraction. The hosted artifact expires on 2026-11-19; the results document is retained with this branch. The retained [verification results](marketplace-recovery-verification-results.json) record individual test outcomes, native/browser reports, CI metadata and hashes of the verified source files. A subsequent documentation-only save is distinct from the application source that executed this pipeline.

## Verification results

| Group | Executed inventory on this source | Executed result |
| --- | --- | --- |
| Wallet unit, persistence and integration | 894 tests / 29 files | **894 passed; zero failed or pending** |
| Targeted platform authentication regressions | 87 tests / 5 files | **87 passed; zero failed or pending** |
| Targeted marketplace/storage regressions | 100 tests / 4 files | **100 passed; zero failed or pending** |
| Total automated tests | **1,081 tests / 38 files** | **1,081 passed; zero failed or pending** |
| Full-project TypeScript | `--noEmit --incremental false --pretty false` | **Passed** |
| Native PostgreSQL | Six drills / 54 checks | **Six passed, containing 54 checks** |
| Existing Chromium rehearsal | English desktop 1440 px; Arabic mobile 390 px, RTL | **Passed; no console errors or mobile horizontal overflow** |

The new recovery inventory comprises **83 tests: 61 manifest cases and 22 database integration cases**. These exercise strict format/semantic validation, exact original history and records, privacy, real SQL rollback, receipt omission at deferred COMMIT, reopen, unknown outcomes, target freshness and source-export authorization. A regression rejects a retained JSONB integer that JavaScript would round, while preserving the exact source value.

The retained platform suites are targeted regressions, not the whole platform test inventory. Browser evidence covers the existing standalone synthetic rehearsal; this change adds no combined-recovery customer screen. Executed browser assertions include response-loss/reload recovery, separate principal/fees, no console errors and no horizontal overflow. **The retained browser report records these assertions on this exact source.**

### Initial launcher failure and corrected rerun

The first run, [42013463376](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42013463376), tested `f9006efc8c3d3dc05ed8675482e887757ee87f06`. It completed all 1,081 tests, full-project TypeScript and the five earlier native drills, then failed before the new native drill's database logic ran: `tsx` treated its launcher as CommonJS and rejected top-level `await`. The browser step was not reached in that run. It is not counted as a successful pipeline.

The correction uses an asynchronous entry function and updates one obsolete coordinator-report limitation string. It changes no financial engine or recovery operation. Its no-database smoke check reached the expected argument validation. That check is launcher evidence only; the full corrected-source rerun supplies the native/browser outcomes above.

Local verification at `f9006ef` passed **894 wallet tests across 29 files**, full-project TypeScript and lint for the changed TypeScript. The complete local wallet run used two workers. Those results retain their original source scope; final exact-source claims depend on the corrected CI run.

## Verified recovery behavior

Export requires the actual stored owner web session, canonical request identity and an already paused enrolled source. Canonical locks, session/account locks, verified wallet replay, row capture and final authority checks share one transaction. A caller supplies neither actor authority nor replacement financial values.

The supported state is one clean, already reserved nonterminal wallet trade, the only active canonical reservation on its listing, current ILS policies and Bank Transfer or Face-to-Face. Its existing amount correction may be pending or accepted; no unfinished payout is allowed. This temporary integration restriction leaves the general three-active-trades-per-seller policy unchanged.

The exporter requires the exact development fixture's canonical and coordination table/column shapes. It captures supported canonical financial/application rows, the original mixed wallet backup, and immutable enrollment/acceptance/publication records. Only user IDs, roles and seller status are retained. Sessions, original profiles, passwords and historical transaction registrations are excluded. Canonical financial payloads remain private plaintext, including payment instructions and trade history.

Physical SQL timestamps retain six-digit microseconds; bigint counters and monetary raw units remain strings. Text rows have deterministic ordering across database collations. A database-side JSONB equality check rejects lossy JavaScript numeric conversion before export. The limits are **16 MiB UTF-8 JSON, 1,000 wallet commands, 1,000 rows per captured table and 10,000 captured rows total**. The implementation refuses overflow rather than truncating a recovery unit.

Restore validates the actual bytes and mandatory independently retained checksum before opening a destination transaction. It requires a genuinely fresh target, rejecting even an empty initialized application schema. It executes fixed repository SQL, never SQL from the file, and never clears or overwrites an existing target.

One outer SERIALIZABLE transaction replays every original command at its recorded time, preserves the explicit v2 continuation and source checkpoint, appends one new pause, restores canonical/coordination rows, installs common guards and completes an immutable recovery receipt. The added command uses operator `marketplace-backup-recovery` and request ID `restore-<combined checksum>`. Original N commands become N+1; the source and quarantine checkpoints remain separately identifiable.

An incomplete bootstrap receipt cannot commit. Deferred database checks require its completion in the same original transaction and verify the exact quarantine command, checkpoints, context and credential quarantine. Common coordination table/guard definitions are factored for reuse; their original definitions are unchanged. **All 10 frozen v1 source hashes and nine additional engine/authentication/repository source files remain unchanged. The 514 executable SQL lines from the original coordination schema remain unchanged after factoring; only blank lines and full-line comments were omitted from that comparison.**

## Native combined-recovery evidence

**New native drill execution: passed all 11 checks on PostgreSQL 17.11.** Its 11 checks require three pre-created, empty, explicitly named loopback development databases. The harness checks all three before fixture writes, and supplies no provider, signer or production connection.

| Boundary exercised | Observed assertion |
| --- | --- |
| Source and manifest | Owner export retains the original financial snapshot while excluding credentials; recomputed-but-inconsistent canonical terms are rejected before a target transaction opens |
| Atomic failures | Real SQL errors at the new pause, after canonical insertion and after receipt completion each roll back all wallet/canonical records and DDL |
| Lost acknowledgement | A real restore commits before a synthetic response loss; reopening that same target verifies its original receipt and pause |
| Original history and financial records | Original command hashes/timestamps and canonical/coordination rows match the source; no second acceptance or publication is created |
| Principal conservation | The example remains **500 USDT = 300 reserved + 200 available**; there is no payout or provider submission |
| Credential and writer boundaries | Original sessions do not authenticate; standalone wallet tools and older writers to the target and sibling requests remain blocked |
| Retry and receipt integrity | Nonempty-target retry, wrong checksum and receipt mutation are refused; the original source remains paused |
| Competing restores | Two observed PostgreSQL backends contend for one target; exactly one restore commits, and the winning history is not overwritten |

**Both source and restored target remained paused. The two actual PostgreSQL backends produced one successful restore and one rejection, with exactly the same verified winning history. No credentials or historical transaction registrations were restored; provider submissions remained zero.** The initial committed restore created one fresh transaction registration, rather than importing old transaction IDs. Subsequent diagnostics may add their own registrations without changing financial history.

The earlier native drills cover concurrency (6 checks), standalone backup/paused restore (6), actual shared marketplace SQL (6), v2 continuation/recovery (9), and canonical coordination/authentication races (16). Together with the new 11, the executed total is 54. The response-loss experiment injects a lost reply after real COMMIT; it is not a physical network partition.

## Quarantine and unknown outcomes

Restored users are exact disabled, credential-free identity stubs with no restored sessions. Historical role labels preserve references; they grant no restored login authority. No account-authority re-entry or resume operation is provided.

`inspectRestoredMarketplaceWallet` is an offline diagnostic requiring the explicit guarded database capability and separately retained checksum. It verifies the immutable receipt, original history, exact additional pause, record digests, coherent marketplace state, empty sessions and disabled identities before returning safe metadata. It grants no web/mobile authority.

An unknown COMMIT acknowledgement is not rollback. Preserve and reopen the same target. A committed target rejects another restore; a missing receipt alone does not prove emptiness. Partial, inconsistent, unpaused or credential-bearing state remains isolated for investigation. No target is erased to bypass a refusal.

## Launch decision and remaining work

**No live launch, main merge, production migration, real provider or signer activation, or live funds movement forms part of this checkpoint. The exact development branch remains disabled for Vercel auto-deployment; the connected deployment query returned zero branch deployments, recorded with its check time in the retained results.**

This is bounded development recovery, not a production backup system or an independent security audit. Checksums prove consistency, not provenance, freshness or source leadership across databases. A paused source does not itself discover or fence another active copy.

Remaining gates include authenticated/encrypted retention, production schema and permissions, independent identity re-entry, cross-instance fencing, external provider/chain reconciliation, realistic capacity and recovery objectives, controlled resume and independent review. Initial acceptance, later proposals, payment/dispute/cancellation/release/completion transitions, actual web/mobile interfaces and custody/signing also remain unfinished.

See the [combined recovery contract](marketplace-recovery-design.md), [recovery runbook](recovery-runbook.md) and [launch readiness](launch-readiness.md) for the supported procedures and remaining requirements.

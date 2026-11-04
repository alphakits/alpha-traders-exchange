# Alpha Wallet: versioned ledger verification

Date: 5 November 2026 (Asia/Jerusalem); CI timestamps below are UTC. Decision: **verified development checkpoint; live launch remains on hold**.

The complete isolated pipeline passed for source commit [08fb7fa](https://github.com/alphakits/alpha-traders-exchange/commit/08fb7fa9d10bd63c12b05b0de46d91ee1e4cfb8e), tree `09961a7af47a66598b3b8a0c3b7caca49ae17735`, on `feature/alpha-wallet-dev-20261104`. This milestone implements the versioned development ledger and its recovery path. It does not activate an actual marketplace cohort or authorize a production migration or deployment.

## Executed result

| Gate | Result on the saved source |
| --- | --- |
| Full wallet suite | **692 passed across 24 files** |
| Targeted platform authentication regressions | **87 passed across 5 files** |
| Targeted existing marketplace/storage/recovery regressions | **100 passed across 4 files** |
| Combined non-overlapping total | **879 passed, 0 failed, 0 pending, across 33 files** |
| Full-project TypeScript | Passed in CI on the exact source |
| Existing native PostgreSQL process-concurrency drill | Six checks passed |
| Existing native PostgreSQL backup/paused restore drill | Six checks passed |
| Existing actual marketplace/wallet shared-transaction drill | Six checks passed |
| New native v2 continuation/correction/mixed-restore drill | Nine checks passed |
| Existing offline financial demonstration | Passed; full 500 principal delivered and 10 separately funded commission recognized |
| Chromium English desktop / Arabic mobile rehearsal | Passed; response-loss recovery, no page/console errors and no horizontal overflow |

[CI run 41929403218](https://github.com/alphakits/alpha-traders-exchange/actions/runs/41929403218), job `126922152835`, completed successfully by **2026-11-04 23:00:55 UTC**. It used Node 24.22.1, disposable PostgreSQL 17.11 and Chromium 149.0.7827.55. The four native drills provide 27 additional checks; they are not unit tests added to the 879 total. The two platform gates are targeted regression suites, not every test in the application repository.

A frozen-source local run also passed all 692 wallet tests with four workers. An earlier overlapping local run was discarded after final migration edits and a test-worker resource failure; the complete rerun passed, and the CI wallet suite now uses the same bounded worker count.

## Explicit continuation without rewriting history

The new versioned repository reconstructs the original v1 prefix with the unchanged v1 reducer. One explicit operator continuation binds that verified revision, event hash, state hash and last command timestamp. The development migration, immutable continuation registry, new command and format-2 head commit in one transaction. Ordinary initialization never upgrades an existing store.

The transition adds metadata without moving funds or rewriting prior commands, results, timestamps, accounting records or hashes. Exact historical retries retain their original revision and event hash. A historical dispatch retry returns `shouldDispatch: false` with current payout state, preserving recovery without granting another send.

The original v1 engine/parser/repository/schema/backup/storage files remain byte-identical to the ten source hashes captured with the frozen fixture. All **41 original commands** still replay with their original result and state hashes. A separately pinned hydrated kernel applies inherited operations to current corrected balances; source-equivalence tests permit only its constructor/factory changes.

## Durable reservation corrections

A fixture operator can enroll a clean existing reservation, binding its marketplace/wallet identities, participants, asset, recipient, price, payment-instruction digest and fee policy. A buyer fixture can then accept a canonical amount correction. The command rechecks the full wallet checkpoint, original binding, clean reservation, exact quote and submitted-proposal limit.

| Accepted correction | Financial effect |
| --- | --- |
| Increase | Move only the increase from the original funded listing into the same trade. |
| Decrease | Return only the decrease to that same open listing. |
| Zero delta | Record the acceptance and new terms revision without a journal. |

Payment claims, verification evidence, release authorization, payouts, commission or dispute progress prevent a new correction. Unpaid seller commissions also block increases in commitments. The buyer still receives the corrected full principal; the seller's combined 2% USDT commission remains separate.

An immutable receipt uses request/proposal identity independently of web/mobile transport request IDs. An exact original acceptance can be recovered after another correction, later settlement or pause without adding another command or financial effect. Changed evidence or actor under the same identity fails.

The command's marketplace inputs are **trusted synthetic planner evidence**. Their digests do not authenticate live buyer consent or complete canonical marketplace state. Actual marketplace enrollment, the authenticated transaction coordinator, cardless-credential invalidation, lifecycle participants, every enrolled legacy-writer guard and publication of benefits/ranks/receipts/notifications remain separate integration work.

## Native PostgreSQL result

The new drill uses two empty disposable databases and distinct native connections. Its acceptance race runs in one process on two separate PostgreSQL backends; the retained earlier concurrency drill separately exercises independent processes.

| Executed case | Observed result |
| --- | --- |
| SQL failure after migration DDL | Complete rollback of namespace/layout/functions/constraints, command history and balances to the original v1 footprint. |
| Lost acknowledgement after a real upgrade commit | Exact continuation retry found the one committed transition and original identity. |
| Old wallet writer / old initializer / fresh v1 envelope | Rejected after upgrade without changing the v2 ledger. |
| Concurrent acceptance with different transport IDs | Overlapping snapshots produced one accepted proposal and receipt. A stale writer retried its whole transaction and recovered the original revision/hash. |
| Increase followed by decrease and settlement | The inherited reservation changed from 200 to 300, then 150. Only each delta moved; the buyer received all 150 and 3 USDT commission was funded separately. |
| Zero delta and retries after progress | A second trade's 50-USDT acceptance created no journal. Earlier proposal and original v1 reservation/dispatch retries retained their original identities. |
| Failure at final restore pause | All restored history, both schema stages and migration DDL rolled back. |
| Successful mixed restore and reconnect | Original 12 v1 rows and the complete mixed history stayed identical; one terminal v2 pause was appended. |
| Inherited uncertain payout after restore | Lookup used only its original reference. Empty lookup made zero submissions and retained the 25-USDT hold. |

The native source finished at revision 30; the restored copy reopened paused at revision 31. It retained **three acceptance receipts and two terms bindings**.

### Money conserved by the v2 drill

| Allocation after settlement and paused restore | USDT |
| --- | ---: |
| Remaining listing principal | 300 |
| Second trade reservation | 50 |
| Seller's available principal | 75 |
| Inherited uncertain withdrawal hold | 25 |
| Remaining principal subtotal | **450** |
| Separately funded commission revenue | **3** |
| Recorded custody total | **453** |

The fixture began with 600 principal and delivered 150, leaving 450 principal. The separate 3 fee deposit accounts for the remainder of custody. No customer principal was used as a fee.

## Recovery and database protections

Mixed-history backups use an explicit format-2 continuation manifest. Inspection validates both engines, exact history and terminal checkpoint before target access. Restore replays the original prefix, recorded migration/continuation and v2 tail, then commits one v2 pause with the restored history. Pure v1 files still use the unchanged v1 format and do not upgrade automatically. The existing 1,000-command/16 MiB limits remain.

The versioned worker reuses the existing fake-provider recovery algorithm for stores already upgraded to v2. It registers no service or schedule. Old uncertain transfers remain lookup-only, original dispatch authority cannot be replayed, and missing provider history never permits a replacement send. Paused queued transfers remain held.

The SQL layer supplements reducer verification with append-only continuation/terms/receipt tables, default-deny client access, old-wallet protocol fencing, exact principal-delta constraints and checks on late projection writes. A semantic failure after a participant certifies its transaction forces that same transaction to abort even if an outer caller catches the error. Unknown or changed transaction identities are not touched.

The **79 new wallet tests** comprise 52 engine tests, 14 storage/migration tests, eight mixed-backup tests and five versioned-worker tests. Review also tightened SQL checks for nested immutable terms and coherent receipt identity/terms/time/delta, plus the native race timeout handling and schema rollback comparisons.

The first native v2 run correctly rejected a malformed synthetic payment-reference prefix in the new fixture. The fixture was corrected to the required `sim-evidence-` form; the payment guard and ledger rules were retained. The complete pipeline then passed on the source identified above. The earlier run and correction are recorded in the machine-readable evidence.

## Retained browser behavior and exact evidence

The original v1 browser rehearsal ran again in actual Chromium, English at 1440 pixels and Arabic RTL at 390 pixels. It delivered the full 500 principal, recognized 10 separately funded commission, and preserved original operations after committed responses were lost. The browser/rehearsal sources remain unchanged from the preceding verified checkpoint. New v2 commands are tested through module, storage and native fixtures; they are not exposed through this role-switching rehearsal or a production wallet route.

[ledger-v2-verification-results.json](ledger-v2-verification-results.json) retains every test name/status, exact source hashes, CI steps, all native outputs, browser outcomes, the superseded fixture failure and artifact metadata.

Artifact `13370539401`, `alpha-wallet-simulation-evidence-08fb7fa9d10bd63c12b05b0de46d91ee1e4cfb8e`, contains 1,999,850 bytes. The downloaded ZIP matched its published digest:

```text
sha256:8c520dcf22a1cb095a1253a0f2e7a42b3b515e98033ea6be5f8fa497b7ebbeee
```

The temporary CI artifact expires at 2026-11-18T23:00:50Z. This report and the complete machine-readable outcomes are saved with the development branch. CI has read-only repository permissions, explicit disposable loopback databases, synthetic evidence/providers and no deployment step or production secrets.

A read-only deployment check after the successful run observed **zero deployments for the wallet branch**. Branch auto-deployment remains disabled. No main merge, production migration, real key creation, signing or transfer was performed.

Production marketplace coordination and writer protection, custody/signing selection, authoritative bank/cash and chain evidence, actual wallet HTTP/MFA boundaries, realistic load/checkpointing, operational recovery/monitoring, production permissions and independent security review remain open in [launch-readiness.md](launch-readiness.md). Passing this development checkpoint does not authorize a live launch.

# Initial marketplace combined recovery verification

Date: **5 November 2026, Asia/Jerusalem**. Decision: **this development recovery milestone passed; Alpha Wallet is not ready to accept live funds or deploy**.

Verified source: [`2c3e6a0b809f9bb34f84dcc82243593ba079ee1f`](https://github.com/alphakits/alpha-traders-exchange/commit/2c3e6a0b809f9bb34f84dcc82243593ba079ee1f), tree `bcafe92cea246f709987643d6213b2347ed73e41`, on `feature/alpha-wallet-dev-20261104`. The source follows saved checkpoint `3fb41a85985107eca23cfd70d0e104177561c027`. The previous verified application source was `c11fe0e90dc96fad8e0b21901cd9093e9c2dc536`.

The [GitHub Actions run](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42108670720) passed on its first attempt. Its [verification job](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42108670720/job/127530153893) completed at **23:10:24 IST**; the workflow's completed status was recorded at **23:10:25 IST**. The [machine-readable report](initial-marketplace-recovery-verification-results.json) binds the source, tree, workflow/job, complete test inventory, native results and downloaded evidence hashes.

## Executed results

| Gate | Passed | Scope |
| --- | ---: | --- |
| Wallet tests | **1,726 / 47 files** | Existing financial, storage, authority and recovery contracts plus this addition |
| Platform authentication | **87 / 5 files** | Retained web/mobile session-source, expiry and enforcement behavior |
| Marketplace/storage regressions | **100 / 4 files** | Repository, transaction recovery, PostgreSQL storage and completed-trade history |
| **Total** | **1,913 / 56 files** | **Zero failures and zero skips** |
| Root TypeScript | Passed | Existing root `tsconfig.json`; no emit |
| Native PostgreSQL | **11 drills / 117 checks** | PostgreSQL **17.11**, including **16 new initial recovery checks** |
| Chromium | Passed | English desktop at 1,440 px; Arabic RTL mobile at 390 px; no console errors or horizontal mobile overflow |
| Offline simulation | Passed | Full principal and separate commission accounting, retained uncertain payout identity |

The current and previous CI artifacts were both downloaded and their ZIP digests verified. Comparing the multiset of repository path plus full test name proves that **all 1,592 previous wallet cases remain**, alongside **134 new cases**. All 87 authentication and 100 marketplace/storage cases are retained as well. This is case-level retention, not merely a comparison of totals.

The complete local wallet gate independently passed the same 1,726 cases across 47 files. Root TypeScript and ESLint on all twelve changed or new TypeScript files passed. Native PostgreSQL and browser execution came from CI; this workspace did not supply a native PostgreSQL server.

### New coverage

| Test file | Cases | Material behavior verified |
| --- | ---: | --- |
| `initial-marketplace-backup-manifest.test.ts` | 79 | Strict distinct format, complete replay, exact activation basis, original seller/buyer evidence, canonical effects, publication and rehashed corruption refusal |
| `initial-marketplace-backup.test.ts` | 33 | Actual web/mobile export, fresh restore, paused pending/accepted cases, both simulated rails, failure rollback, authority expiry, credential quarantine and same-target unknown-COMMIT inspection |
| `initial-marketplace-recovery-preservation.test.ts` | 8 | Exact binary/null evidence, microseconds, large integers, multi-role owner identity and incompatible timezone/schema refusal |
| `recovery-transaction-cleanup.test.ts` | 14 | Raw physical transaction abortion after swallowed runtime/clone failures, immutable argument capture and refusal to poison a replacement transaction |
| **Total new cases** | **134** | All executed in the full CI wallet gate |

## What changed

The [new recovery contract](initial-marketplace-recovery-design.md) adds a distinct `canonical-initial-cohort-v1` bundle for an explicitly activated initial marketplace source. It supports a source paused before seller acceptance or after the one original coordinated acceptance. The existing isolated-v3 and v2 amount-correction formats remain separate and continue rejecting this namespace.

Current stored owners can export through either the fixed web-session reader or the fixed mobile/device reader. The export retains the original activation basis, full ordered v1/v2/v3 history, canonical financial rows, initial binding and acceptance receipt, canonical events and publication intent. It excludes usable account credentials and old transaction registrations. Export rechecks authority and expiry after awaited work; it leaves source financial records and the source pause unchanged.

Restore validates the actual bytes, complete semantic history and separately retained checksum before opening its destination. One certified SERIALIZABLE transaction claims a fresh target, replays the original commands at their original clocks, installs the matching canonical records and guards, adds exactly one new v3 pause, and completes an immutable recovery receipt. Every original command, result and hash remains unchanged. Recovered identities are disabled stubs; web sessions are empty; neither mobile authentication table is created.

The recovery-only guards seal canonical financial records and further wallet commands while permitting offline inspection. `inspectRestoredInitialMarketplaceWallet` reopens the exact target, checks its original prefix, checksum-bound pause, current checkpoint, record digests and credential quarantine. It provides no login, source-leadership or resume authority.

### Preservation evidence

The preservation suite restores **257 bytes of binary evidence**, including non-UTF8 bytes, and separately retains null content. It verifies exact six-digit database microseconds and runtime metadata version **`9007199254741993`**, beyond JavaScript's safe integer range. Database-side JSONB roundtrip checks reject lossy payload parsing.

Original activation-basis timestamps retain PostgreSQL's exact UTC JSON spelling; physical timestamp columns retain six fractional digits. Nonzero source and target timezones are refused instead of rewriting evidence. Both simulated TRON and BSC Face-to-Face cases preserve full principal and consent.

A stored owner can have a scalar buyer role with an additional owner role in its private account record. Export verifies that actual current authority; restore retains only historical identity labels and disabled profiles. It does not recreate the omitted role array or login authority.

### Transaction cleanup fixes

Review found that older recovery failure handlers could rerun runtime guards before aborting an already-certified transaction. If the runtime guard itself caused the failure and a caller caught it, that cleanup path could be skipped. Cleanup now compares only the raw physical transaction ID and deliberately aborts the same original transaction. It does not poison an unknown or replaced transaction.

The amount-correction context also now captures and parses mutable inputs inside its certified failure boundary. Both correction and initial context registration capture the transaction handle and scalar identity before the first await. Raw PGlite tests establish actual aborted SQL transaction state and rollback, independently of WalletStore failure tracking or financial guard triggers. The existing coordinator/storage suites and all native gates passed with these fixes.

## Native recovery evidence

The new [native drill](../../scripts/alpha-wallet/postgres-initial-marketplace-backup.ts) uses four explicitly named, already-created empty loopback databases. It checks all four before fixture writes and does not create or drop a database or read an application connection URL. Its sixteen reported checks are backed by assertions and all native stderr files are empty.

| Restored source | Source revision | Restored revision | Listing principal | Trade principal | Original acceptance receipts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Accepted | 8 | 9 | 300 USDT | 200 USDT | 1 |
| Activated, awaiting acceptance | 7 | 8 | 500 USDT | 0 USDT | 0 |

The accepted case retains the original activation, acceptance and publication rows, original canonical notification/audit effects and financial receipt. The awaiting-acceptance case does not fabricate seller consent or a trade receipt. **Both source histories remain unchanged and paused; both restored targets are paused. No credentials or historical transaction contexts are restored. Provider submissions: zero.**

Three injected native SQL faults cover quarantine append, canonical insertion and completion of the recovery receipt/guards. Each leaves the target empty, including rolling back schema creation. A caught late runtime refusal also cannot leave prior recovery writes committed.

An immediate canonical statement fence rejects a late sibling write even after earlier deferred checks were explicitly flushed. At ordinary deferred COMMIT, newly created mobile authentication relations are detected and the whole restore rolls back. These checks are distinct from hostile privileged DDL after deliberately draining every deferred event, which is outside the protocol.

The uncertain-commit case performs a real PostgreSQL COMMIT and then injects loss of its acknowledgement. Closing and reopening **that same target** verifies its original history and new pause; another restore cannot overwrite it. This is not a physical network-partition test.

The fresh-target race uses **two actual PostgreSQL backends**. Exactly **one restore succeeds and one is rejected**. The winner preserves the awaiting-acceptance state and all 500 USDT of listing principal. It never creates another active financial copy.

## Retained financial and browser evidence

All ten prior native drills were rerun on the same source, including independent processes, old standalone/combined recovery, v2/v3 continuations, canonical writer races and stored web/mobile authority. Their 101 checks remain alongside the new sixteen, giving 117 total.

The retained Chromium rehearsal again exercises 500 USDT funding, separate owner approval, 200 + 300 principal reservations, independent buyer/verifier/seller/worker stages, an uncertain provider response and exact original request recovery after interrupted HTTP replies. Its final ledger records **500 USDT delivered and 10 USDT of separately funded fee revenue**. Provider finality alone does not settle the ledger.

The [English desktop viewport](previews/english-desktop-final-viewport.png) and [Arabic mobile viewport](previews/arabic-mobile-final-viewport.png) were visually reviewed from this run. These two images are byte-identical to the retained previews. The UI is the existing standalone synthetic rehearsal; this recovery milestone adds no integrated product screen or actual platform login flow.

## Evidence integrity and source preservation

- CI artifact: `13453307386`, `alpha-wallet-simulation-evidence-2c3e6a0b809f9bb34f84dcc82243593ba079ee1f`.
- Downloaded ZIP SHA-256: `e61d4329b6510f1596ffd416d7b12470f44880870ddcf41da69d0b49aadf5d28`, verified against GitHub's artifact digest.
- Forty extracted evidence files have individual byte counts and SHA-256 digests in the machine-readable report, including three complete test inventories, eleven native JSON results, logs and six browser images.
- The report also hashes the exact tested implementation/SQL/workflow files and records that twenty-three frozen financial/schema/fixture files are unchanged from the saved baseline.
- The wallet branch remains excluded from automatic Vercel deployment, and this workflow has no deployment step. No main merge, production migration, provider account signup, key generation, external message or real transfer was performed.

The subsequent documentation commit records this result without changing the tested application, SQL or workflow source. Historical verification reports and pause checkpoints retain their original evidence.

## Remaining readiness work

The [launch-readiness checklist](launch-readiness.md) remains **not ready for live funds**. The integrated initial flow still supports activation, seller acceptance, inspection and pause. Later payment claims, cancellation, disputes, release and settlement need an explicit next financial continuation and corresponding canonical participants; the original v3 reducer cannot be relaxed in place. Broader reservations also require complete bidirectional identity bindings, not just matching totals.

Actual web/mobile account and trade integration, deduplicated delivery, real step-up, provider/testnet drills, custody/key control, trusted bank/cash evidence, production roles, encrypted/authenticated retention, cross-instance recovery/fencing, controlled resume, scaling/monitoring and independent review remain open. Simulation work can advance while owner/provider decisions are resolved; those decisions cannot be inferred from green tests.

Backups contain private financial history in plaintext. Checksums establish consistency with a separately retained value, not authenticated provenance or freshness. Exact canonical/coordination schema checks do not inventory every arbitrary wallet-schema object. The whole-history implementation and its bounds are development correctness controls, not production performance or recovery-objective evidence. Root TypeScript excludes the native mobile workspace and three existing test paths; neither a native application build nor a full production build or independent security audit was part of this gate.

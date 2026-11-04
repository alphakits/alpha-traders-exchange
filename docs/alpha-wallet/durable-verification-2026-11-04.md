# Alpha Wallet durable development verification

Date: 4 November 2026. Authorization: continued development and development-branch upload only; live deployment remains withheld.

Verified implementation commit: [`b83e7a5245871fb985084a954e923e35c6514b4f`](https://github.com/alphakits/alpha-traders-exchange/commit/b83e7a5245871fb985084a954e923e35c6514b4f). Source tree: `3cf54469de61cf3680e4ae1724cc28246dbf9716`.

**Result: 263 tests passed, zero failures, across 11 files in the complete CI run. Project-wide TypeScript checking, the lifecycle demo, separate-process recovery, and native PostgreSQL concurrency verification all passed.**

The [simulation-only CI run 41891927526](https://github.com/alphakits/alpha-traders-exchange/actions/runs/41891927526) completed successfully at **2026-11-04 18:58:03 UTC**, on the implementation commit above. Every job step passed, including disposal of the database container. No deployment job was run.

The [machine-readable report](durable-verification-results.json) records every test, source hashes, implementation identity, financial outcomes, deployment boundary, and verification limits. The earlier [146-case report](verification-2026-11-04.md) is historical evidence for the foundation in commit `ce200c678246928d424a6d6020ac10078ced30f5`; the current report covers the durable milestone.

## What is now implemented

The simulation ledger now has a durable repository. Each accepted command commits its idempotency identity, command history, accounting entries, payout intent/state, chain-event claims, and new state head in one transaction. Reopening reconstructs and checks the entire state before accepting new work. Financial amounts remain integer units throughout storage and recovery.

An explicit offline payout worker commits a dispatch claim before contacting the file-backed fake provider. It recovers uncertain outcomes using the original immutable reference. A missing lookup result leaves the principal reserved and never authorizes a second send. A matching finalized successful receipt settles the original payout exactly once. A final failed transfer retains its reservation for a separately reviewed recovery operation.

The new PostgreSQL transport accepts only explicitly supplied loopback fixture URLs and dedicated `alpha_wallet_dev_*` database names. It retries complete serialization/deadlock failures a bounded number of times. An uncertain database COMMIT acknowledgment is surfaced as an unknown result, without automatic retry or an assumption that the transaction rolled back.

The domain engine, fixture payment authority, synthetic destinations, and fake provider remain disconnected from the marketplace application and all real financial systems.

## Local test evidence

| Test file | Passed | Failed |
| --- | ---: | ---: |
| `amounts.test.ts` | 22 | 0 |
| `runtime.test.ts` | 12 | 0 |
| `sandbox.test.ts` | 78 | 0 |
| `schema-draft.test.ts` | 34 | 0 |
| `commands.test.ts` | 4 | 0 |
| `durable-schema.test.ts` | 28 | 0 |
| `durable-store.test.ts` | 46 | 0 |
| `durable.test.ts` | 15 | 0 |
| `fake-provider.test.ts` | 10 | 0 |
| `payout-worker.test.ts` | 13 | 0 |
| `process-recovery.test.ts` | 1 | 0 |
| **Total at final local source** | **263** | **0** |

The complete local run passed 262 cases across all 11 files in 59.15 seconds. A final worker-race regression and TypeScript-compatible test expressions were then added; all four affected test files were rerun, passing 28 cases in 28.25 seconds. The machine report combines the latest result for each file, rather than incorrectly adding both runs together. The full project TypeScript check then exited successfully.

CI subsequently ran the complete final suite in **64.00 seconds: 263 passed, zero failed, across all 11 files**. CI also passed the full-project TypeScript check against the same exact source commit.

Commands:

```bash
node node_modules/vitest/vitest.mjs run src/lib/alpha-wallet --reporter=default --reporter=json --outputFile=/tmp/alpha-wallet-phase2-tests-20261104.json
node node_modules/vitest/vitest.mjs run src/lib/alpha-wallet/commands.test.ts src/lib/alpha-wallet/process-recovery.test.ts src/lib/alpha-wallet/fake-provider.test.ts src/lib/alpha-wallet/payout-worker.test.ts --reporter=default --reporter=json --outputFile=/tmp/alpha-wallet-phase2-final-targeted-20261104.json
node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
NODE_ENV=development node --import tsx scripts/alpha-wallet/demo.ts
```

Tests use isolated temporary PGlite databases, synthetic actor identities, exact raw integer values, and offline provider records. No application `.env` or production connection URL is loaded.

## Native PostgreSQL concurrency evidence

The CI job provisioned an empty disposable PostgreSQL 17 database. The harness started **two independent Node processes using distinct PostgreSQL backend connections**. Before each race it forced both first-attempt transactions to establish a `SERIALIZABLE` snapshot, then released them together. Each race asserted that an actual whole-transaction serialization retry occurred.

All six reported checks passed:

1. Concurrent observations credited the same finalized 500 USDT deposit once.
2. Two competing 300 USDT reservations produced one accepted trade, leaving exactly 200 available for the remaining reservation.
3. Two copies of the same dispatch command produced one send authorization and one idempotent replay. An unknown submission retained the original provider reference and rejected a fresh dispatch key.
4. Competing finalized receipts debited the 300 USDT payout once, retained the remaining 200 reservation, and recorded a separate 6 USDT commission due.
5. A synthetically lost client acknowledgment after a real database commit was resolved by retrying the same command identity, with only one added command.
6. A newly opened store connection rebuilt the same revision, event hash, and complete state from committed history.

Final native fixture: revision **18**; **500 USDT funded = 300 delivered + 200 reserved**, with **6 USDT separately due**. The harness does not claim that its injected acknowledgment loss is a real network partition; the storage transport's unknown-COMMIT branch has separate controlled tests.

GitHub artifact ID: `13353562470`, digest `sha256:862c6a217e89703a55fa0716761ad8f303398ed64d611f84db5175a3938be01a`. The run retains raw logs/results for 14 days; the committed machine-readable report preserves the outcomes, native report, step statuses, and source hashes beyond that artifact retention period.

## Financial outcomes demonstrated

| Scenario | Principal outcome | Separate fee outcome |
| --- | --- | --- |
| Full lifecycle | 500 USDT funded; buyers receive 200 + 300 = full 500 | 10 USDT funded separately and recognized once |
| Durable full payout | A 500 USDT payout and all journal/state evidence survive reopening | A later separate 10 USDT commission deposit settles the due |
| Abrupt process exit after provider acceptance | Recovered original 200 USDT payout completes once; 300 remains in custody | 4 USDT remains separately due; no deduction from buyer principal |
| Native PostgreSQL races | 500 USDT funded; 300 delivered once; remaining 200 stays reserved | 6 USDT separately due |
| Final failed payout | All payout principal remains reserved | No false trade completion or commission settlement |
| Unknown database COMMIT during dispatch | Provider is never called by that failed execution | Recovery must establish the original command outcome first |

The actual separate-process test runs `recovery-demo.ts prepare ... --abrupt-exit`, which deliberately exits without closing the store after the fake provider accepts the transfer and its response is lost. A second Node process opens the committed data and provider records, resolves the original transaction, confirms it once, and proves that another recovery step adds no settlement. This is a process-exit test, not a claim to simulate every filesystem, host-power, or cloud-storage failure.

## Adversarial conditions covered

- One finalized deposit cannot create two credits, including after reopening or under different request identities.
- Two 300 USDT reservations cannot consume a 500 USDT listing.
- Replaying a committed dispatch command returns `shouldDispatch: false` after restart.
- A submitted transfer with no observable provider record stays reserved; repeated recovery never resubmits it.
- Committed accounting and payout projections cannot be appended later, altered silently, or separated from their command transaction.
- An actual SQL failure after a command, journal header, and first entry have been written rolls back the complete operation.
- Wrong assets, destinations, quantities, finality, transaction IDs, role fixtures, command versions, and changed idempotency payloads are rejected.
- Integer storage preserves 18-decimal asset values beyond JavaScript's safe integer range without float conversion.
- Missing/mutated history, inconsistent result/state digests, and extra balanced journals fail replay verification.
- A dispute or pause blocks queued dispatch while allowing truthful accounting of a previously submitted transfer's final settlement.
- Late broadcast/unknown reports cannot replace a known outcome, misreport a terminal outcome, or accept a different transaction identity.
- Concurrent fake-provider startup and duplicate immutable submissions produce one durable reference and broadcast record.

## Review findings corrected

Three specific issues were reproduced and fixed before this milestone was saved:

1. An idempotent response paired an old command revision with the current head hash. It now retains and returns the original command's event hash.
2. Simultaneous initialization of a fresh fake-provider directory could fail with `EEXIST`. The marker is now published atomically and an identical concurrent initializer is accepted.
3. A late broadcast result could throw or report stale state after another worker had already confirmed the payout. Recovery now accepts only a verified current outcome matching the same immutable intent and transaction, then returns that outcome. A late unknown response preserves an already known result.

The review and tests were performed by collaborating development agents. They are not an independent third-party security audit.

## Deployment and integration evidence

- Branch: [`feature/alpha-wallet-dev-20261104`](https://github.com/alphakits/alpha-traders-exchange/tree/feature/alpha-wallet-dev-20261104).
- The first remote branch commit already included the exact Vercel branch rule setting automatic Git deployment to `false`.
- Vercel reported zero deployments for this branch after the foundation and durable implementation uploads.
- The connected Railway worker's live and staged source branch were both `main`; pending Railway changes were not applied or modified.
- The added GitHub workflow is restricted to the wallet branch, including manual dispatch. It uses read-only repository permissions, no persisted checkout credential, no production secrets, and a disposable PostgreSQL 17 service. It contains no deployment or application-start step.
- Production API routes, pages, cron registration, mainnet/token configuration, signing code, and application migrations remain unchanged. There is no import of this wallet subsystem into production application code.
- No merge, promotion, live deployment, production migration, real deposit address, key creation, or real transfer occurred.

The local source tree hash was compared with the GitHub-created tree before each branch update; they matched. The GitHub integration was used because the local checkout lacked a GitHub write credential. Branch updates used the expected previous SHA and did not force-push.

## Readiness boundary and remaining work

This completes a durable **development simulation** milestone. It does not make Alpha Wallet ready to handle live money.

The next substantive work is a selected custody/signing sandbox, independently verified chain observers, deposit address assignment, and production authorization design. The bank/cash verification authority, withdrawal approval/limits, dispute/refund resolution, fee/gas funding, and recovery after final failure must be concretely specified before integration.

The current repository serializes the whole simulation and replays its history with a development limit of 100,000 commands. Production needs reviewed partitioning/checkpointing, version migration, application roles, load evidence, backup/restore and reconciliation exercises, and monitoring. Hash-chain comparisons detect inconsistent history but cannot protect against an administrator rewriting all evidence and the application together.

Network-level PostgreSQL COMMIT failure tests use injected client acknowledgment loss; they do not prove behavior under every real network partition. The real chain, custody provider, payment provider, key recovery, and incident operations still need their own fault tests. UI integration, existing marketplace regressions, an independent security review, acceptance evidence, and the user's separate go-live instruction remain ahead.

# Alpha Wallet development verification — 4 November 2026

Verified at 2026-11-04T20:20:30+02:00 (Asia/Jerusalem).

**Result: 146 tests passed, 0 failed, across 4 files. Project-wide TypeScript check passed. Offline lifecycle demo passed.**

## Test results

| Test file | Passed | Failed |
| --- | ---: | ---: |
| `amounts.test.ts` | 22 | 0 |
| `runtime.test.ts` | 12 | 0 |
| `sandbox.test.ts` | 78 | 0 |
| `schema-draft.test.ts` | 34 | 0 |
| **Total** | **146** | **0** |

Commands executed from the isolated development checkout:

```bash
node node_modules/vitest/vitest.mjs run src/lib/alpha-wallet --reporter=default --reporter=json --outputFile=/tmp/alpha-wallet-tests-20261104.json
node node_modules/typescript/bin/tsc --noEmit --incremental false
NODE_ENV=development node --import tsx scripts/alpha-wallet/demo.ts
```

The [machine-readable results](verification-results.json) include every test name, outcome, demo checkpoints, and SHA-256 hashes for the verified source and SQL. The database suite uses fresh in-memory PGlite instances, no connection URL, and SERIALIZABLE write transactions.

## Demonstrated financial outcome

| Item | Simulated amount |
| --- | ---: |
| Listing principal funded | 500 USDT |
| First buyer delivery | 200 USDT |
| Second buyer delivery | 300 USDT |
| Separate commission funding | 10 USDT |
| Commission recognized once | 10 USDT |
| Customer principal left after both deliveries | 0 USDT |

The deposit stays unavailable until finalized; duplicate callbacks do not add credit. A buyer's payment claim cannot authorize release. A lost submission response preserves the original payout reservation; repeating the dispatch command does not issue another send instruction. Full principal is delivered, and fees come from their separate account.

## Concrete defects caught and corrected during review

- Dispatch replay returned an old instruction that could be misread as permission to send again; it now returns `shouldDispatch: false` with current state.
- Tiny trades could round to zero fiat; quotes now reject zero and out-of-range fiat totals.
- Incoming and outgoing evidence could reuse one chain-event identity; cross-direction reuse is now rejected.
- Repeated terminal failure receipts were not idempotent; exact repeats are now accepted with funds still held.
- Missing cached account balances could evade journal reconstruction checks; both directions of journal/balance equality are checked.
- An unfinalized observation could not replace a changed execution outcome in a different block; replacement is now allowed before credit, with same-block conflicts rejected.
- Dispute responses could describe already delivered funds as frozen/in flight; response state now distinguishes queued, submitted, failed, and settled payouts.
- A duplicate credited deposit could misreport an existing pause; callbacks now report actual pause state.
- A journal-only SQL constraint could miss entries appended after an early constraint flush; entry insertions now trigger validation too.
- Aggregate balance checks relied on an unstated isolation assumption; SQL writes now require SERIALIZABLE and tests reject weaker isolation levels.

## Scope preserved

All implementation changes are additions under `src/lib/alpha-wallet`, `scripts/alpha-wallet`, and `docs/alpha-wallet`. This milestone adds no production API, page, cron, migration, package dependency, mainnet address, or signing facility. The existing marketplace code and separately ongoing commission fixes were not edited by this work.

## What this verification does not establish

The simulator's atomicity is local to one process. PGlite tests validate storage constraints, not real distributed worker races. The SQL draft is not connected to the simulator. No real chain, testnet, custody service, bank verification, wallet secret, or production database was used. Real authentication, a durable worker, recovery after crashes, actual finality adapters, signing controls, private UI integration, and independent security review remain later milestones. This is not a claim of production readiness or zero risk.

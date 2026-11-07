# Alpha Wallet continuation verification — 7 November 2026

**Decision: this development checkpoint passed its complete simulation gate.
Alpha Wallet is not ready to accept live funds or deploy.**

Development continued on `feature/alpha-wallet-dev-20261104` from saved checkpoint
`fcd5982e52d354c86f031c77286a556f656f9add`. The implementation adds independent
synthetic fiat evidence preparation, an isolated immutable evidence journal with
stopped recovery, and bounded synthetic deposit range coverage. It grants no new
financial authority and preserves the existing marketplace and V1–V5 contracts.

## Exact verified source

| Evidence | Recorded value |
| --- | --- |
| Implementation commit | `6c06159b12c6c23fd51cdd8eb4dba7745aff54cb` |
| Implementation tree | `23c6ca3b1bc4d381766af79fe00940531c8239af` |
| Workflow | [Run 42327193683](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42327193683) |
| Job | `128265095861` |
| Attempt and outcome | Attempt 1, completed / success |
| Job completion, UTC | `2026-11-07T02:24:20Z` |
| Evidence review, Asia/Jerusalem | `2026-11-07T04:25:07.011902+02:00` |
| Prior independently verified implementation | `ae7cd2735032e0b85c1087d16941a4bda3c7fc71` |

The [machine-readable report](development-verification-results-2026-11-07.json)
retains the workflow/job metadata, artifact identity and digest, every test-case
occurrence, every native check string, all frozen source hashes, retained test
source blob identities, changed-source hashes and downloaded artifact-file
hashes. The documentation checkpoint that adds these results is a descendant of
the tested implementation; it does not change executable source.

## Test and retained-source evidence

| Suite | Passed | Files | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Wallet and local persistence | 3,917 | 86 | 0 | 0 |
| Platform authentication | 87 | 5 | 0 | 0 |
| Marketplace/storage regressions | 100 | 4 | 0 | 0 |
| **Total** | **4,104** | **95** | **0** | **0** |

All **3,853 predecessor test occurrences** are retained with their original
multiplicities. All **91 predecessor test files** retain their exact Git blobs,
and all **75 frozen contracts** retain their recorded SHA-256 hashes in the
tested commit. The four new files contribute **251 distinct new test identities**:

| New test file | Passed |
| --- | ---: |
| `deposit-range-coverage.test.ts` | 105 |
| `trusted-payment-evidence.test.ts` | 75 |
| `trusted-payment-journal-model.test.ts` | 34 |
| `trusted-payment-journal-store.test.ts` | 37 |

There are **4,093 distinct test identities** across the 4,104 passing occurrences.
The 11 duplicate occurrences were already present in the predecessor; this
checkpoint adds none. Counts use the actual file and assertion inventories,
rather than Vitest's describe-group count.

## Native PostgreSQL evidence

**21 drills / 277 ordered checks passed** against
disposable PostgreSQL 17 databases. Every one of the predecessor's 20 drills and
250 ordered check strings is retained exactly. The new fiat-journal drill adds
27 checks, including physical transaction ownership, independent
SQL refusal, complete rollback, stopped export, fresh-target restoration and
uncertain-COMMIT recovery.

The actual contention evidence includes:

| Race | Distinct backend PIDs | Lock wait observed | Follower transaction attempts |
| --- | --- | --- | ---: |
| Exact operation retry | 135 / 136 | Yes | 2 |
| Different-operation corroboration | 135 / 136 | Yes | 2 |
| Revocation against stale settlement | 135 / 136 | Yes | 2 |

The follower retries its complete SERIALIZABLE decision after the competing
commit. Duplicate operations return one original receipt. Different operation
keys retain one exclusive native-payment attribution. A committed revocation
causes a new stale-settlement operation to be refused, while an exact historical
retry still returns its original receipt without erasing the quarantine.

The drill also loses replies **after actual source and restoration COMMITs** and
reconciles each on its exact physical target. Failures after command insertion,
head update and final sealing roll back the entire append. Failures after schema
creation, head insertion, imported-command insertion and final sealing leave the
fresh restore target empty. A restored copy preserves original record bytes and
receipts, adds permanent quarantine and cannot resume, re-export or establish
the absence of later source operations.

All 21 native PostgreSQL stderr files are empty. The previously recorded `pg.Client` concurrent-query deprecation is absent after serializing the three observer reads; competing writer transactions remain independent.

## Other completed gates

- Repository TypeScript passed on the same implementation commit.
- The retained offline simulation passed with the full 500 USDT principal
  delivered and 10 USDT of seller commission separately funded and recognized.
- The retained standalone English desktop and Arabic mobile rehearsal passed in
  Chromium, with no console errors or horizontal mobile overflow. Interrupted
  reservation and withdrawal responses recovered the same request after reload;
  the withdrawal retained one payout intent and no provider submission.
- Focused local ESLint for the new modules passed. The touched legacy PostgreSQL
  harness retains two pre-existing unused-variable warnings; this report does
  not claim a repository-wide zero-warning lint result.

The browser result covers the **existing standalone synthetic rehearsal**. It
does not verify a new payment-journal product screen, range-scanner interface,
actual account/trade route, native mobile build or V6 lifecycle.

### Preliminary local environment correction

The initial local broad sweep began while the new files were still being added
and discovered 84 wallet files. It finished with 3,736 passing cases and one
suite setup refusal that skipped its 39 cases: the workspace's
`TZ=Asia/Jerusalem` conflicted with the existing payment-recovery requirement for
exact UTC timestamp representations. This preliminary run exited 1 and is not
counted as final verification. The unchanged affected suite then passed all
39 cases with `TZ=UTC` and `NODE_ENV=test`. The complete exact-commit CI run
independently used UTC throughout and passed every final suite without skips.
The result hashes and correction are retained in the machine-readable evidence.

Use the repository's pinned Node version and explicit UTC for local reproduction:

```sh
TZ=UTC NODE_ENV=test node ./node_modules/vitest/vitest.mjs run src/lib/alpha-wallet --maxWorkers=2
TZ=UTC NODE_ENV=test node ./node_modules/typescript/bin/tsc --noEmit
```

The complete gate is defined in the
[development workflow](../../.github/workflows/alpha-wallet-development.yml),
including authentication/marketplace suites, disposable native PostgreSQL
databases and the retained Chromium rehearsal. A wallet-only local command is
not the full gate.

## Implemented behavior and boundaries

### Trusted synthetic fiat preparation

The [evidence reader](trusted-payment-evidence.md) independently replays the
original V1–V5 acceptance and buyer claim, exact amount/currency, fiat recipient
instructions, full principal reservation and immutable admitted source mapping.
It captures the wallet checkpoint before and after source IO and refuses a
changed checkpoint. The source lookup receives the native transaction identity,
not an amount or recipient to echo back. Buyer, seller and recorded operator
identities cannot serve as the independent source authority.

Pending, settled and adverse observations remain evidence. Prepared artifacts
preserve original history, source bytes, revisions, timing and exact facts.
Synthetic admission does not prove actual provider independence or receipt of
money. Every artifact has `executionAuthority: false` and
`releaseAuthority: false`.

### Immutable journal and stopped recovery

The [journal contract](trusted-payment-journal.md) records the original prepared
evidence, first native payment facts and contiguous source revisions. Exact
operation retries return the historical receipt. Changed immutable facts,
contradictory revisions, invalid revision/status ordering and source reversals
are retained and permanently quarantine recording. The journal cannot silently
reassign the same admitted native payment to another claim.

Physical transaction certification, immutable SQL records, complete head checks,
semantic replay and response-substitution checks protect the private persistence
contract. A stopped original source can export its entire history. A distinct
fresh target restores that history and appends permanent quarantine. Capacity
bounds reserve space for terminal pause and restoration records.

Native identity is scoped to the fixed admission and source. Production-wide
uniqueness across admission rotation or source aliasing is still open. A past
positive receipt is historical evidence; it cannot certify current
non-revocation inside a separate wallet database transaction.

### Bounded synthetic deposit range coverage

The [range reader](deposit-range-coverage.md) reads every transaction receipt and
classifies every log for each explicitly requested block from both admitted
synthetic sources, including empty blocks. Checkpoint bridge blocks provide
linked header/membership evidence but **do not receive receipt coverage**.
Exact replay reconstructs the original native reads and projections; adjacent
certificate comparison enforces compatible continuous ranges.

Coverage applies only to the bounded supported synthetic response profile.
TRON receipts without an explicit supported execution result or log array refuse
the entire certificate, including ordinary non-contract/protobuf-omitted shapes.
A changing finality checkpoint causes a complete retry. Real-provider latency,
continuously advancing heads and busy-block partitioning remain unverified.
The current bounds include eight covered blocks and sixteen covered receipts.

Range evidence has no durable coverage cursor, consumption or recovery contract.
It grants `creditAuthority: false` and `cursorAuthority: false`. Consistent
responses from two synthetic sources do not authenticate consensus or custody.
These results do not establish a general-purpose real blockchain scanner.

## Remaining launch gates

1. Complete the later lifecycle profile: seller-authorized release, dispute
   resolution, settlement/refund and supported unpaid cancellation, preserving
   all original financial history and receipts.
2. Couple current independent payment evidence and one-time consumption to the
   financial transaction, with current stored web/mobile authority. Establish
   real bank/cash-source admission, recipient ownership and identity across
   source/admission rotation. Ordinary face-to-face cash has no connected
   independently observable bank event.
3. Complete durable range consumption and recovery, actual native-provider
   compatibility and operational scan liveness, then reviewed deposit-to-ledger
   consumption and reconciliation.
4. Integrate the finished lifecycle into actual website/mobile account, trade,
   evidence and receipt screens, preserving marketplace policy and reviewed
   deduplicated notification delivery.
5. Configure the selected Trust Wallet receiving direction and an eligible
   chain-connected testnet signer/provider environment. Verify real asset and
   address ownership, gas/resources, uncertain submission and signer recovery.
6. Complete production recovery authority, monitoring, limits, incident/refund
   ownership, product acceptance and independent security review. Present the
   concrete release for the separately required launch authorization.

No real provider, account, receiving address, private key or signer was connected.
No funds were accepted or sent. No production migration, deployment or merge to
the production branch was performed. Automatic deployment remains disabled for
the wallet development branch. Passing this gate does not authorize live launch.

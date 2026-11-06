# Alpha Wallet isolated deposit inbox verification

Date: **6 November 2026, 22:56:02 Asia/Jerusalem**.
Scope: development and synthetic fixtures only. **Live launch remains off.**

The bounded deposit inbox and its independent complete recovery unit passed exact-source development CI. The implementation records prepared synthetic BSC/TRON evidence without creating wallet credit, a transfer or release authority. It includes durable first facts, exact immutable receipts, absorbing conflict quarantine, finite known-candidate jobs, same-target outcome recovery and paused export/fresh-target quarantine restore.

## Exact source and evidence

| Evidence | Verified identity |
| --- | --- |
| Implementation commit | [`ae7cd2735032e0b85c1087d16941a4bda3c7fc71`](https://github.com/alphakits/alpha-traders-exchange/commit/ae7cd2735032e0b85c1087d16941a4bda3c7fc71) |
| Tested source tree | `76ecea834a15ad7b1ef34fcce394564012f3f4c2` |
| Branch | `feature/alpha-wallet-dev-20261104` |
| Previous verified preparation source | `68ee52017b18631bfbd44acb3c5afea44a3c8223`; tree `b16deed3ad860c77923d0d3d4780f37343812434`; [CI 42280807815](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42280807815) |
| Complete CI | [Run 42289843052](https://github.com/alphakits/alpha-traders-exchange/actions/runs/42289843052), attempt 1, job `128140074306`; **completed / success** |
| Job completion | `2026-11-06T20:53:59Z` — **6 November 2026, 22:53:59 Asia/Jerusalem** |
| Downloaded artifact | ID `13539448229`; `alpha-wallet-simulation-evidence-ae7cd2735032e0b85c1087d16941a4bda3c7fc71` |
| Archive size | 2,148,928 bytes |
| Archive SHA-256 | `66769ed45d52133bc0c4e87823a8b3570f39e8ed2d58b1069abf09e42568c020`; matches the GitHub artifact digest |
| Extracted-file metadata | 58 file hashes and byte sizes recorded |

The [machine-readable evidence](deposit-inbox-verification-results.json) retains complete case inventories, ordered native-drill payloads, CI metadata, artifact hashes and frozen-contract comparisons. Its predecessor retention baseline is the saved [preparation evidence](deposit-preparation-verification-results.json). This report binds the implementation commit above; a later documentation-only save does not replace that tested source identity.

## Complete regression gate

| Suite | Passing cases | Files | Retention |
| --- | ---: | ---: | --- |
| Wallet and inbox | 3,666 | 82 | All 3,417 predecessor cases plus 249 distinct additions |
| Authentication | 87 | 5 | All predecessor cases retained |
| Marketplace/storage | 100 | 4 | All predecessor cases retained |
| **Total** | **3,853** | **91** | **Zero failures or skips** |
| Native PostgreSQL | 250 ordered checks | 20 drills | All 18 predecessor drills / 212 ordered checks retained; 2 new drills / 38 checks |
| Frozen source contracts | 75 unchanged hashes | — | No frozen contract changes |

Retention compares exact repository-relative file paths and full test names as a multiset. All 3,604 predecessor occurrences and their 11 inherited duplicate occurrences remain. The additions introduce 249 distinct identities without new duplicate occurrences.

### Focused additions

| File | Passing cases |
| --- | ---: |
| `deposit-inbox-model.test.ts` | 92 |
| `deposit-inbox-probe.test.ts` | 57 |
| `deposit-inbox-store.test.ts` | 45 |
| `deposit-inbox-backup.test.ts` | 55 |
| **Total** | **249** |

These 249 focused cases are a subset of the full 3,853-case CI inventory, not extra tests. Earlier preparation and observer totals remain historical milestones and are already included in the retained inventory.

### Native and retained development evidence

| New native drill | Ordered checks |
| --- | ---: |
| `postgres-deposit-inbox-backup.json` | 20 |
| `postgres-deposit-inbox.json` | 18 |
| **Added native checks** | **38** |

The persistence drill exercises independent PostgreSQL writers, physical transaction ownership, immutable SQL facts/receipts, candidate ordering, conflicts and outcome recovery. The separate recovery drill exercises stopped-source export, strict replay, atomic fresh restoration, quarantine and restoration receipt inspection. The machine-readable payloads preserve the precise executed check strings; the drill totals are separate from Vitest cases.

Repository TypeScript, the offline simulation demo and retained English desktop / Arabic mobile Chromium rehearsal passed in the same completed job. The browser evidence covers the existing standalone rehearsal. It does not establish a new inbox product route, native-mobile build or complete production wallet.

## Implemented development contract

The [persistence guide](deposit-inbox-persistence.md) is the module/API reference; the [ingestion contract](deposit-observation-ingestion-design.md) records the invariants and separate future coverage gate.

### Durable evidence, receipts and progress

The recorder binds an immutable admitted manifest, worker/operator capability and physical isolated store. It supplies preparation context from retained history; native IO and transcript verification occur before a recording transaction. Exact request/fingerprint retries recover the original receipt without a new command, evidence blob, corroboration link or ordinal advance, including after expiry or terminal stop.

First event, transaction and block facts remain immutable. A later consistent observation retains its own evidence/provenance; a validated contradiction preserves the first facts and quarantines the inbox. A transaction anchor catches BSC re-inclusion even when its block-wide log index changes. Historical stale-preparation and missing-continuity holds do not invent a bridge or retreat an accepted head.

Trusted probe failures before a complete observation produce bounded, process-branded attempts. Caller-provided exceptions cannot become admitted chain-failure evidence. An unsealed source conflict can quarantine without pretending complete conflicting raw observations were captured. A resource quarantine retains the rejected input fingerprint and attempted scope, without claiming the rejected evidence was retained.

Finite jobs are immutable ordered lists of known candidates. Accepted recording, exact-evidence deduplication or corroboration can advance one ordinal when the captured precondition still matches. Holds, conflicts, exhausted limits and failed transactions cannot skip or fast-forward progress. These jobs do not prove exhaustive scanning, empty-block coverage or complete transfer classification.

### SQL, replay and outcome recovery

Operations use one certified writable SERIALIZABLE transaction with fixed UTC, explicit simulation markers, physical bootstrap/write fences and an owner that expires at completion. A swallowed participant failure poisons the same transaction. Deferred completeness checks bind command receipts and effects; sealed commands cannot acquire later effects. SQL enforces its implemented canonical commitments, while repository replay separately checks full native transcript semantics and reconstructed history.

Unknown COMMIT preserves the original request, input fingerprint, physical source identity and pre-command checkpoint. Same-target reconciliation can recover an existing receipt or report the bounded absence/uncertainty result. A restored or different store cannot establish absence on the original source. An acknowledged commit whose response is unavailable is a distinct result-delivery failure; exact receipt lookup recovers the original outcome without another observation.

### Portable capacity and complete recovery

| Resource | Development bound |
| --- | --- |
| Logical commands | 1,000; ordinary capacity ends at 998, preserving terminal and restoration controls |
| Distinct retained observations | 256 |
| Raw request/response evidence | 16 MiB aggregate |
| Block / transaction anchors | 4,096 / 256 |
| Native events | 256 |
| Candidate jobs / candidates per job | 16 / 256 |
| Complete portable envelope | 64 MiB UTF-8 and 100,000 data nodes |
| Each reserved terminal/restore control | 65,536 bytes and 2,048 nodes |

Full envelope accounting includes repeated projections, timing provenance, immutable results and the checksum. Structural capacity may stop a job before its nominal command or raw-byte limit. No old evidence is removed to make a later backup fit.

The separate `alpha-wallet-development-deposit-inbox` format, version 1, exports only a durably paused or quarantined source. It retains complete admission, original commands/receipts, raw evidence, first facts, source-head history and candidate bookmarks. Strict parsing and semantic replay reject altered history even if an outer checksum was recomputed.

Fresh restoration requires an independently retained expected checksum, explicit acknowledgment and a new isolated target. Installation, complete original replay, a newly allocated physical target identity, one appended restoration quarantine and its immutable receipt commit together. Lost responses are inspected on that same target. Restored cursors remain historical bookmarks; no resume or source-leadership authority is supplied.

## Compatibility and remaining gates

All 75 frozen contract hashes, 3,604 predecessor case occurrences and 18 predecessor native drills / 212 ordered checks remain intact. Existing financial reducers, receipt meanings and wallet/marketplace recovery formats retain their previous contracts. The inbox occupies a separate store and does not widen an older recovery format. The current V5 profile admits no new deposit or reconciliation command. Any financial consumption requires an explicit reviewed successor; the earlier simulation deposit command retains its original encodings and deposit/commission/listing effects.

Every observation, command, receipt, snapshot and backup remains `simulation-only` and `creditAuthority: false`. Synthetic source commitments and reproducible transcripts establish consistency within the development profile, not real provider authentication, operator independence, clock authenticity or receiving-address ownership.

Complete native range scanning and historical coverage, real provider/custody admission, observation-to-ledger credit, direction exclusions and reconciliation remain separate contracts. Trusted fiat verification, seller release, dispute resolution, unpaid cancellation and actual web/mobile product integration remain separate lifecycle gates. Production SQL roles/migrations, authenticated encrypted retention, source leadership/fencing, controlled authority re-entry, signer/testnet recovery and independent review are not established by this run.

The user authorizes continued development, isolated testing and saving `feature/alpha-wallet-dev-20261104`. This result does not authorize a main merge, production migration/deployment, keys, real signing, funding, transfers or live launch.

# Isolated development deposit inbox

This module persists the synthetic BSC/TRON observations produced by the [admitted preparation layer](deposit-observation-preparation.md). It implements the bounded inbox and finite candidate jobs described in the [ingestion design](deposit-observation-ingestion-design.md), with a separate portable recovery format. All observations, commands, receipts, snapshots and backups retain `mode: "simulation-only"` and `creditAuthority: false`.

The inbox has no balance, ledger-credit, listing-approval, payment-verification, release, custody, signing or broadcast operation. Its receiving assignments remain synthetic fixture attribution. A configured source commitment and reproducible transcript establish consistency within this development profile; they do not authenticate an external provider or establish ownership of a real receiving address.

## Modules and ownership

| Module | Responsibility |
| --- | --- |
| `deposit-inbox-protocol.ts` | Closed command, immutable receipt, projection, archive and capacity contracts |
| `deposit-inbox-model.ts` | Admitted commands, deterministic state transitions, complete historical replay and restore planning |
| `deposit-inbox-probe.ts` | Trusted reader capability for sanitized unresolved attempts when native IO fails before a complete observation exists |
| `deposit-inbox-store.ts` | Isolated SQL installation, certified transaction owner, recorder, preparation context and same-target receipt recovery |
| `deposit-inbox-portable.ts` | Shared canonical envelope encoding and reserved byte/node capacity |
| `deposit-inbox-backup.ts` | Paused export, strict offline parsing, fresh-target restore and restoration receipt inspection |
| `deposit-inbox-schema.sql` | Immutable SQL records, physical writer fences, numeric domains and deferred completeness checks |

The existing preparation, transcript, observer, transfer decoder and financial/recovery versions retain their previous contracts. No inbox operation translates an observation into an existing financial command.

## Start and prepare

Use an explicitly isolated local development `WalletStore`. Its database may contain only the inbox namespace `alpha_wallet_deposit_inbox_simulation` and the permitted PostgreSQL system objects. Even an empty companion application namespace is refused. The original wallet schemas, marketplace tables and account/session tables are not installed alongside it.

`initializeDevelopmentDepositInbox` takes the synthetic manifest, a bootstrap request ID, optional physical store ID and an optional trusted clock. It captures the initial manifest and clock before the store's transaction retry loop. A bootstrap fence orders competing initializations. Repeating the exact bootstrap identity recovers its original store; a different admission or bootstrap request is refused.

`createDevelopmentDepositInboxRecorder` binds one admitted worker, explicit `worker` or `operator` capability, immutable manifest, physical store instance and trusted clock. The constructor exposes:

| Operation | Result |
| --- | --- |
| `inspect` / `snapshot` | Complete verified current state and checkpoint, separate from any historical receipt |
| `preparationContext` | The actual retained checkpoint, source head and optional finite job bookmark for the requested candidate |
| `registerCandidateJob` | Immutable ordered candidates and an initial ordinal of zero |
| `record` | An original immutable observation receipt, or exact receipt recovery |
| `recordAttemptHold` | A sanitized trusted-probe hold or unsealed source-conflict quarantine |
| `pause` | An irreversible operator pause |
| `lookupReceipt` | An exact request/fingerprint receipt, including after pause or quarantine |
| `reconcileUnknown` | Same-target resolution after an uncertain COMMIT, without another observation |

Pass `recorder.preparationContext` to `createAdmittedDevelopmentObservationReader` or `createDevelopmentDepositInboxProbe`, with the same admitted worker, physical store ID, exact endpoint commitments and explicit synthetic fetch function. Native IO and complete transcript verification occur before a recording transaction begins. The recorder does not fetch from a provider.

The probe returns either a complete prepared observation or a process-branded unsealed attempt. Only failures after the admitted reader has validated its context and begun native IO can produce that attempt. Invalid constructor data, executable thenables, runtime refusal and closed/reentrant readers cannot manufacture a chain failure record. Serializing and copying an attempt loses the capability needed for a new live submission; already-retained historical attempts remain replayable as closed archived data.

## Durable outcomes

The recorder first matches immutable request identity and input fingerprint. An exact retry returns the original receipt without another command, evidence blob, corroboration link or ordinal advance. It remains recoverable after current freshness has expired and after terminal stop. The caller can inspect the separate current state to see a quarantine that occurred after that receipt.

| Situation | Durable behavior |
| --- | --- |
| Same admitted evidence under a new request | `duplicate-evidence`; retain the new request provenance, reuse the evidence blob and original event |
| New consistent observation of the same native event | `corroborating-observation`; retain its original raw evidence and link it to the original event |
| New native event | `recorded`; retain first event facts, transaction placement, block anchors and accepted source head |
| Validated event, transaction, overlapping block or preparation-base regression | `conflict-quarantined`; retain the offending observation when capacity permits, preserve first facts and stop the entire inbox |
| Same request key with a different valid input | A separately keyed `request-conflict-quarantined` receipt; preserve the original request and receipt unchanged |
| Compatible observation prepared before a newer accepted head | `stale-preparation-held`; retain the diagnostic observation without changing the newer head or candidate bookmark |
| Missing linked history between a retained head and the candidate's validated head | `continuity-unproved-held`; retain the observation without inventing a bridge or advancing progress |
| Trusted native failure before a complete observation | `attempt-held`; retain the admitted attempt and closed failure classification, without inventing raw evidence |
| Trusted unsealed `SOURCE_CONFLICT` | `source-conflict-unsealed`; retain the diagnostic attempt and quarantine |
| Insufficient retained-evidence or portable capacity | `resource-quarantined`; retain only the rejected input fingerprint and attempted scope, leave progress unchanged and stop |

Native event identity excludes token, recipient, amount, assignment and block placement. A change to those facts therefore cannot evade detection by becoming another credited-looking identity. A separate transaction anchor catches BSC re-inclusion even if its block-wide log index changes. Genuine identical transfer payloads at separate positions in one unchanged complete receipt remain separate events.

Continuity requires every linked successor from the retained head to the new validated head, with exact parent hashes and strictly increasing native timestamps. A separately observed genesis identity does not supply missing intermediate blocks. The recorder compares the incoming head with its captured preparation base separately from a head committed later by another worker.

Validated contradictions and the two historical continuity holds take precedence over an ordinary stale candidate-cursor refusal. A remaining cursor compare-and-swap miss refuses the entire new command without inserts. Freshness is rechecked on each transaction attempt before accepted progress; historical replay and exact receipt recovery do not use today's clock.

## Finite jobs and limits

A candidate job is a bounded, immutable ordered list of already-known transaction/event coordinates. Every candidate must fit its creator's immutable worker scope. Repeating coordinates with different expectations is refused. An accepted `recorded`, `duplicate-evidence` or `corroborating-observation` command can advance exactly one ordinal when its captured job identity and previous revision/ordinal still match. Holds, conflicts, failed transactions and exhausted bounds cannot advance it. There is no skip or fast-forward operation.

These jobs do not establish exhaustive chain scanning, empty-block coverage or a complete transfer classification. A future range reader must provide that separate proof before the product can claim a complete block cursor.

| Bound | Limit |
| --- | --- |
| Logical commands | 1,000, with ordinary capacity ending at 998 and reserved terminal/restore slots |
| Distinct retained observations | 256 |
| Raw request and response bytes | 16 MiB in aggregate; evidence is retained once per admitted evidence identity |
| Block anchors | 4,096 |
| Transaction anchors / native events | 256 each |
| Candidate jobs / candidates per job | 16 / 256 |
| Full portable envelope | 64 MiB UTF-8 and 100,000 data nodes |
| Reserved control capacity | 65,536 bytes and 2,048 nodes per terminal/restore control |

All bounds apply together. Full evidence, request timing provenance, immutable results and repeated projection representations count toward the actual portable envelope. The structural limit can stop a job well before the nominal command or byte limit. The model reserves capacity while recording rather than deleting older evidence to make a later backup fit. A large valid conflict can use remaining ordinary capacity; a terminal control that spends the final reserved slot must fit its bounded control allowance.

## Transaction and SQL contract

Every operation uses the same physical writable `SERIALIZABLE` transaction, the explicit simulation marker and a fixed UTC session. Bootstrap and fresh restore share a database bootstrap fence. Existing stores use a singleton write fence so recording, export, inspection and unknown-outcome reconciliation are ordered with competing writers. The owner is process-branded, expires at transaction completion and refuses concurrent/reentrant participants. A swallowed participant error poisons the same transaction rather than permitting a partial commit.

The database stores immutable admission, command journal, raw evidence, accepted facts, diagnostic observations, source-head versions, candidate jobs/bookmarks, quarantines and recovery records. The logical hash chain excludes physical transaction metadata so restore preserves every original command and receipt. A separate physical target identity distinguishes restored databases.

Append-only projections belong to the command that created them. An already sealed command cannot acquire later effects. Exact effect arrays, complete receipts, one-ordinal progress and required quarantine/recovery effects must agree at the SQL seal. Repository replay independently reconstructs the whole logical history from original native transcripts and rejects altered, missing, extra or reordered projections even when an outer backup checksum has been recomputed.

An uncertain COMMIT retains the original request, fingerprint, physical store ID and pre-command checkpoint. Same-target fenced reconciliation distinguishes an existing receipt, proven absence at the same checkpoint, absence after later history, and an unresolved target. A different or restored database cannot prove absence on the original source. Recovery never observes again or creates a replacement request. A failure to deliver a usable response after an acknowledged completion is handled separately from an unknown COMMIT; exact receipt lookup supplies the original result.

## Complete recovery unit

Export requires a durably paused or quarantined source. `exportDevelopmentDepositInboxBackup` takes one certified snapshot and checks original history, complete retained raw evidence, first facts, progress and hashes. It preserves the whole supported unit without a current-freshness requirement.

The independent format is `alpha-wallet-development-deposit-inbox`, `formatVersion: 1`. Its canonical envelope contains the profile, stopped-source assertion, export time, complete archive and `deposit-inbox-backup` checksum. The strict parser rejects ambiguous duplicate JSON keys, unsafe or fractional integer literals, invalid Unicode and excessive size/depth/node count. The archive includes neither operational endpoints/credentials nor account sessions, signing keys or wallet balances.

`restoreDevelopmentDepositInboxBackup` requires a separately retained expected checksum, explicit fresh-target acknowledgment and a new isolated target. It allocates a new physical target ID once before transaction retries. Installation, original semantic replay, one appended restoration quarantine and its complete immutable recovery receipt share one owner transaction. The original bootstrap, commands, evidence and receipts remain unchanged. The target ends quarantined, with retained cursors serving only as historical bookmarks. There is no resume operation.

`inspectRestoredDevelopmentDepositInbox` recovers the exact target restoration result after a lost response. It binds the expected checksum, restore request, new physical identity, source checkpoint and appended terminal receipt. It does not claim source leadership or that nothing happened on the source after the backup.

## Development verification and remaining scope

Focused model/probe tests use complete synthetic native BSC/TRON responses. Durable tests use isolated local stores. The development workflow retains the previous wallet, authentication, marketplace, recovery and browser checks, and adds independent PostgreSQL persistence/race and paused-export/fresh-restore drills. Source-bound test counts and artifact hashes belong in the accompanying verification record; they are not a claim of complete product readiness.

Live provider admission, real receiving-address ownership, custody/key handling, signer/testnet exercises, a reviewed observation-to-ledger-credit boundary, complete chain scanning, remaining trade lifecycle operations and actual product-route/mobile integration remain separate work. The user's live-launch restriction continues to apply.

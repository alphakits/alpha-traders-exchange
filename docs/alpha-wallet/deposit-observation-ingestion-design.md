# Durable deposit-observation inbox: development contract

Date: **6 November 2026, Asia/Jerusalem**. Status: **immutable admission, timed native capture, exact offline replay, isolated durable evidence recording, finite candidate progress and complete independent paused recovery are implemented for synthetic development.** The [preparation contract](deposit-observation-preparation.md) and [persistence contract](deposit-inbox-persistence.md) specify their respective APIs and limits. The [inbox verification report](deposit-inbox-verification-2026-11-06.md) binds the tested source separately. Complete chain coverage, financial credit, actual custody/provider authority and live launch remain outside this contract.

## 1. Scope and existing boundaries

The isolated, bounded **evidence inbox** records observations of known native transfer events. It retains immutable attribution, admitted source configuration, exact observations, repeated evidence, conflicts and restart progress through explicitly supplied candidate jobs. Prepared observations, inbox commands, durable receipts, snapshots and backups carry `mode: "simulation-only"` and `creditAuthority: false`. Candidate progress is not complete blockchain coverage.

An inbox record must never call `observeDeposit`, increment a wallet balance, fund or approve a listing, settle commission, reserve principal, verify fiat, authorize release, clear a dispute, create a payout or contact a signer. The existing simulation `observeDeposit` actually credits on successful finalized fixture evidence; converting a native observation into that command would therefore cross the boundary of this slice. Its simulation destinations and event encodings remain unchanged. See [`sandbox.ts`](../../src/lib/alpha-wallet/sandbox.ts), [`types.ts`](../../src/lib/alpha-wallet/types.ts) and [`commands.ts`](../../src/lib/alpha-wallet/commands.ts).

| Retained implementation | Consequence for the isolated inbox |
| --- | --- |
| [`chain-evidence.ts`](../../src/lib/alpha-wallet/chain-evidence.ts) validates supplied complete receipts/proofs and returns no credit authority. | Reuse its frozen decoders unchanged. A checksum and a successful decoder call establish consistency, not provider authentication or custody ownership. |
| [`chain-observer-common.ts`](../../src/lib/alpha-wallet/chain-observer-common.ts), the [BSC observer](../../src/lib/alpha-wallet/bsc-node-observer.ts) and [TRON observer](../../src/lib/alpha-wallet/tron-node-observer.ts) verify one expected event, with at most 64 connecting successors. | The current result is neither a complete deposit scanner nor a durable ingestion receipt. It does not carry an admission manifest or custody assignment. |
| [`durable-store.ts`](../../src/lib/alpha-wallet/durable-store.ts) supplies SERIALIZABLE transactions, bounded retry of actual serialization/deadlock failures, and `CommitOutcomeUnknownError`. | Reuse the local store drivers. Keep all node IO outside transaction callbacks, which the driver can execute again. |
| [`v5-backup.ts`](../../src/lib/alpha-wallet/v5-backup.ts) rejects even empty companion schemas for isolated wallet recovery. Combined recovery has separate exact schema/receipt contracts. | Put the inbox in a separate database/store and give it a separate backup format. Adding an inbox schema beside a V5 ledger would break the existing recovery boundary. |
| [`runtime.ts`](../../src/lib/alpha-wallet/runtime.ts) refuses production/hosted, mainnet-enabled and signing-enabled runtimes. | Apply the same guard at entry, transaction work and completion. No environment-discovered endpoint, database or credential is introduced. |

The [custody decision](custody-decision.md) records Trust Wallet as the receiving-interface preference. No real receiving address or key is established by that preference. This inbox version uses explicitly admitted synthetic identities and injected responses only. Future custody proof, credit authorization, direction exclusion, reconciliation and signing remain separate contracts.

## 2. Immutable admission and attribution

Bootstrap one `DepositInboxManifestV1` in a fresh isolated target. Its canonical hash, schema/profile version, logical `inboxId` and physical `storeInstanceId` become immutable. Only a trusted development fixture loader may install it; an HTTP request, event notification or observation object cannot install or change admission. There is no add-address, reassign-address or provider-rotation operation in version 1.

The manifest contains these exact record types:

| Record | Required immutable fields and constraints |
| --- | --- |
| Chain | `chainKey`, family, exact genesis identity, and BSC chain ID or TRON network label. Reject aliases that assign two registry identities to the same native chain fingerprint. Preserve the frozen decoder's normalized chain key. |
| Asset | `assetRef`, `chainKey`, exact token contract, explicit decimals, and supported fungible-Transfer profile. Decimals are descriptive here; all ingestion compares raw integer units. A ticker or wallet brand cannot select the asset. |
| Source | `sourceId`, declared `independenceGroup`, normalized host, endpoint commitment and response-profile version. The endpoint commitment is SHA-256 of the exact normalized endpoint used by the existing transport. Operational configuration supplies that endpoint separately and must match before IO. No credentials or operational URL are stored in evidence or portable backups. |
| Source pair | `sourceSetId`, chain, execution source, finality source and exact observation policy. Distinct IDs, hosts and declared groups are mandatory. These declarations do not prove real organizational independence. |
| Custody assignment | `assignmentId`, `custodyDomainId`, `assetRef`, exact recipient, fixture beneficiary reference, `purpose: "principal" | "commission"`, and `admissionKind: "synthetic-fixture"`. One `(chainKey, recipient)` has one assignment for the lifetime of this version. Shared-address attribution, amount matching, address recycling and overlapping owners/purposes are unsupported. |
| Worker admission | `workerId`, permitted source sets and assignments. This comes from the trusted constructor, never from an ingest body. It is a development capability, not a production authentication mechanism. |

The immutable assignment determines chain, token, recipient, beneficiary and purpose. A candidate supplies only a known transaction ID, native event index and expected raw amount; it cannot supply another recipient, seller, purpose, asset mapping or boolean custody claim. An amount expectation may make a candidate fail; it cannot select its beneficiary. Do not resolve an unknown assignment through current marketplace ownership or infer it from receipt `from`/`to` fields.

Retain the assignment hash on every event and every ingestion command. No foreign key, mutation or automatic synchronization to frozen wallet deposit intents or canonical marketplace rows is added. An eventual financial adapter will require an explicit new admission/continuation contract with its own cross-direction consumption and recovery checks.

## 3. Preparation outside SQL and evidence admission

The implemented `createAdmittedDevelopmentObservationReader` constructs the existing transport from the admitted source pair and matching separately supplied endpoint configuration. Before native IO, `recorder.preparationContext` supplies a snapshot from actual retained development-store history, binding the physical store-instance identifier, manifest, assignment, source set, captured source-head revision/identity and optional candidate bookmark. The reader captures that snapshot, policy, candidate and trusted worker identity. It uses an explicitly injected fetch function and optional clock; an arbitrary caller-supplied `DevelopmentNodeTransport` is not an admission credential. The callback interface still permits isolated synthetic fixtures, whose hashes alone do not establish persisted history. Before accepting a new record, the recorder verifies the captured base against its actual retained historical head and candidate job inside the same certified physical store.

`prepare({ attemptId, candidate, jobId? })` returns a serializable `PreparedDepositObservationV1` containing:

- Format/profile identifiers, manifest hash, source-set hash, assignment hash and worker ID.
- The captured preparation-base source-head revision/number/hash, or an explicit first-observation base, and the physical store-instance identifier. The recorder verifies that base against an actual retained historical head and checks any candidate bookmark against its immutable job and cursor; a caller-selected checkpoint or a valid synthetic callback value alone cannot establish that history.
- A stable attempt ID and the exact captured fixture context and policy.
- The complete `DevelopmentChainObservation`, including raw request/response transcripts and their digests.
- A **versioned timing trace** captured by the admitted reader's session wrapper: every semantic `session.now()` value and its read ordinal, per-read wall start/return times and conservative monotonic elapsed microseconds, plus whole-session elapsed microseconds. This trace belongs to the new prepared-inbox profile; the legacy observer result remains unchanged.
- A preparation digest over the complete canonical envelope. The request ID and prepared bytes must be retained by the caller before recording; an uncertain database reply is resolved using those same bytes.

The recorder validates the closed envelope and reproduces its semantic result before opening its write transaction. A plain object with `creditAuthority: false` and a recomputed observation checksum is insufficient. The implemented versioned transcript replay validator parses each original request/response, checks source/operation/argument order and BSC request/response IDs, consumes every required read exactly once, and reruns the unchanged observer/decoder semantics using a transcript-backed transport and the new semantic clock trace. It rejects missing, reordered, extra or unconsumed reads/clock samples. Captured wall and elapsed values must satisfy the profile's sequence/bounds; freshness is checked at the recorded semantic check instants and, through a separate new-admission check, against the current time. The reader wrapper enforces conservative whole-read/session elapsed bounds while capturing them.

**Legacy timing evidence remains narrower.** The original observer result retains session start/completion and each read's `completedAtMs`; it does not retain semantic clock calls, per-read starts or elapsed monotonic samples. Its capture enforces real monotonic deadlines, but copied legacy transcripts cannot retrospectively prove all those deadlines. The new prepared profile therefore requires its captured trace before clock-faithful replay; it does not backfill invented timing samples into old observations. Even the new trace proves internal consistency only when read from a file: hashes do not authenticate a clock or prove that the claimed real-time interval occurred.

The replay validator returns the selected transfer, containing-block and complete receipt semantics, all checked block identities, the **original pinned proof checkpoint**, and the **last captured, fully validated head**. These are different when an observer validated an advancing head while retaining its original proof. Cross-observation head regression uses the latter, preventing a later head from slipping backwards merely because the earlier result retained an older pinned checkpoint.

Existing transcripts do not prove HTTP origin, endpoint authentication or organizational independence when copied into a file. The trusted reader/recorder boundary and immutable admission records are therefore part of this development contract. Transcript replay and hashes cannot convert third-party JSON into authenticated chain truth. Imported backups restore into quarantine, never into an active reader.

## 4. Identities and equality

Use canonical decimal strings for native indices, block heights and raw units. Never convert BSC uint64 indices/heights or uint256 amounts through JavaScript `Number`. TRON's present native observer profile still rejects unsafe numeric payloads; storage must not relax it. Normalize native hex case exactly as the frozen decoder does. All new digest inputs are domain-tagged, versioned UTF-8 JSON with explicit field order/encoding; do not use ambiguous string concatenation or PostgreSQL's incidental JSON text layout.

| Identity | Exact definition | Meaning |
| --- | --- | --- |
| Request key | JSON tuple `["deposit-inbox-request-v1", inboxId, workerId, requestId]` | One immutable command and original response. Command type is in the fingerprint, so the same request ID cannot switch operation. |
| Input fingerprint | Hash of command type, manifest/profile hashes and the complete captured command payload, including prepared evidence and optional cursor precondition. | Same request key plus same fingerprint is an exact retry. A later node read is a different payload. |
| Admitted evidence ID | Hash of `["admitted-observation-v1", manifestHash, sourceSetHash, assignmentHash, comparisonProfile, observationSha256]`. Excludes attempt ID, worker ID and request ID; those remain in preparation/command provenance. | Detects reuse of the same admitted exact observation. Raw RPC IDs, times or metadata may make a later observation differ without changing the event. Giving unchanged evidence another attempt ID does not make it corroboration. |
| Native event locator | JSON tuple `["native-event-v1", chainKey, transactionId, indexKind, eventIndex]`, where index kind is `bsc-block-log-index` or `tron-receipt-log-offset`. | Unique event position. Deliberately excludes token, recipient, amount, source, request ID, assignment and block hash: changing those facts must not create another event. |
| Transaction anchor | `(chainKey, transactionId)` bound to containing number/hash, native transaction index and complete receipt-semantics digest. | Detects changed placement or receipt evidence across all events in a transaction. |
| Block anchor | `(chainKey, blockNumber)` bound to the validated native block identity and profile's normalized header/ordered-membership semantics. | Detects contradictory finalized/solidified history even across unrelated selected events. |

Persist the frozen decoder's existing `eventKey` as evidence and recompute it, but do not use that token-containing string as the sole uniqueness constraint. A different emitter at an occupied native position is a conflict.

**BSC re-inclusion needs the transaction anchor.** Its block-wide `logIndex` can differ when a transaction is placed in another block. Checking only `(transactionId, logIndex)` could therefore admit the re-included transaction as a new event. Check the transaction anchor before inserting any new event locator. A changed block, native transaction index or complete log sequence quarantines the transaction and inbox, even if the proposed event locator is new. Identical payloads at two genuine positions in one unchanged receipt remain separate events.

The event facts fingerprint includes chain, exact token, sender, recipient, amount, native event/index kind, assignment hash, and transaction anchor. Checkpoint height, observation time, request ID and source read bytes are not event facts. Compare receipt semantics under a fixed profile: BSC retains the current observer's supported normalized native receipt semantics; TRON compares explicit successful execution and every ordered log, with recognized resource-accounting metadata retained as raw evidence but not promoted into transfer facts. Preserve all raw bytes regardless of whether a field affects semantic equality.

New accepted evidence must agree with every retained overlapping block anchor. A head below the retained **preparation base** is a demonstrated regression for that attempt and quarantines the inbox. An older observation prepared before another worker committed a newer head is different: if no hashes/receipt facts conflict, classify it as `stale-preparation-held`, keep the newer head and leave its candidate cursor unchanged. Arrival order alone must not manufacture a finality regression.

A higher head requires complete linked continuity from the preparation base and, at commit, from the then-current retained source head. Accept when the observed path contains that head with the same identity, or when the containing block is its exact immediate successor, naming its full hash with a profile-valid timestamp. A gap such as retained head 102 followed by a candidate proof only covering 110→112 is `continuity-unproved-held`, not contradiction and not permission to advance. Inbox v1 adds no supplemental bridge reader. A later reviewed range/bridge implementation must supply missing intermediate evidence outside SQL. The current 64-successor profile can also hold older work; no hold permits truncating ancestry, clearing old anchors or pretending a job is complete.

## 5. Implemented isolated storage and invariants

Use schema **`alpha_wallet_deposit_inbox_simulation`** in a separate marked PGlite directory or dedicated loopback database such as `alpha_wallet_dev_inbox_<fixture>`. Reuse `WalletStore`, but bootstrap and every reopen must reject wallet/marketplace/other application schemas and public relations. Existing wallet stores must never be initialized or upgraded as an inbox target.

The table below describes logical record/projection roles. The [implemented schema](deposit-inbox-schema.sql) also separates normalized `admission_records` and immutable `command_seals`; the [persistence guide](deposit-inbox-persistence.md) records module ownership.

| Logical record/projection | Contract |
| --- | --- |
| `head` | One logical inbox ID, physical store-instance ID, manifest/profile/schema fingerprints, journal revision/hash, lock version and recording/paused/quarantined state. Only a complete command may advance it. |
| `admission` | Exactly the immutable admitted manifest and its normalized chain/asset/source/assignment/worker projections. No updates or deletes. |
| `commands` | Append-only revision, request key, input fingerprint, canonical command/result, original recorded time, previous/event/state hashes and owner transaction binding. |
| `evidence_blobs` / `observations` | Immutable exact transcript/preparation bytes and hashes, original clocks, source/assignment bindings and observation-to-command references. Deduplicate exact bytes without discarding provenance. |
| `block_anchors` / `transaction_anchors` | Immutable first facts with references to the supporting observation. Later agreement adds provenance; it cannot replace the first binding. |
| `events` / `event_observations` | One native locator and original facts, plus append-only observation links. Status derives from retained commands: observed, corroborated or quarantined. No credited/balance column or credit-ready boolean. |
| `source_heads` | Monotonic validated-head projection per admitted source set/chain, coupled to supporting accepted evidence. A contradictory proposed head becomes quarantine evidence, not a new authoritative head. |
| `candidate_jobs` / `candidate_cursors` | Immutable ordered candidate manifest and atomic next-ordinal/revision projection. This is not blockchain coverage. |
| `quarantines` | Append-only reason, deterministic fault identity, affected requests/locators/anchors, both evidence references when available, original command revision and timestamp. No delete, resolve or resume operation in v1. |
| `recovery_receipts` | Complete immutable fresh-target restore receipt, including source checkpoint, backup checksum, target instance and final quarantine checkpoint. |

Use decimal-text validation or an unconstrained numeric domain that checks integral value and range **before any scale coercion**. `numeric(78,0)` alone would round fractional inputs before a check and is unsuitable as the raw-input guard. SQL timestamps are stored as exact integer milliseconds; normalized JSON does not depend on a session's timestamp rendering. Verification commands use UTC, and the new transaction owner explicitly requires a fixed UTC session without altering any frozen recovery guard.

SQL must independently enforce unique locators/requests, immutable rows, admission and command foreign keys, cursor compare-and-swap, one owner transaction, row counts/bounds and a deferred completeness seal. No committed command may lack its exact receipt, observation links, required anchors, quarantine effect or cursor effect. No projection may be appended to an already sealed command. Direct cursor updates or quarantine clearing must fail at COMMIT even if application coherence checks are suppressed.

SQL independently enforces the closed structural contract and its implemented cryptographic commitments, including canonical admission/bootstrap/state/journal/result/input commitments and the observer-specific observation/response commitments. Repository replay separately verifies complete native transcript semantics and reconstructs historical projections. Neither layer authenticates a provider, clock, real custody assignment or external worker identity. The schema revokes object privileges from `PUBLIC`; the recorder exposes no generic SQL or DDL surface.

## 6. Implemented APIs and outcomes

The [persistence contract](deposit-inbox-persistence.md) describes the current internal development exports. Inputs are captured as bounded plain data without executing getters or `toJSON`; effectful entry points apply the runtime guard first. The worker/operator capability belongs to the constructor, not request JSON. This outline uses explicit synthetic dependencies and separately isolated source and fresh-target stores.

```ts
await initializeDevelopmentDepositInbox({
  mode: "simulation-only", store, manifest, storeInstanceId,
  requestId: bootstrapRequestId, clock: syntheticClock,
});
const recorder = createDevelopmentDepositInboxRecorder({
  mode: "simulation-only", store, manifest, storeInstanceId,
  worker: { workerId, role: "operator" }, clock: syntheticClock,
});
const probe = createDevelopmentDepositInboxProbe({
  mode: "simulation-only", manifest, workerId, storeInstanceId,
  endpointConfig, fetch: syntheticFetch, clock: syntheticClock,
  preparationContext: recorder.preparationContext,
});
const result = await probe.prepare({
  attemptId,
  candidate: { assignmentId, sourceSetId, transactionId, eventIndex, amountRaw },
});
const receipt = result.kind === "prepared"
  ? await recorder.record({ requestId, prepared: result.prepared })
  : await recorder.recordAttemptHold({ requestId, attempt: result.attempt });
// Finite jobs additionally bind the captured candidate cursor precondition.
// Other methods: registerCandidateJob, preparationContext, inspect, snapshot,
// lookupReceipt, reconcileUnknown, and irreversible operator pause.
if ((await recorder.inspect()).state.status === "recording") {
  await recorder.pause({ requestId: pauseRequestId, reason });
}

const backup = await exportDevelopmentDepositInboxBackup({
  mode: "simulation-only", store, expectedStoreInstanceId: storeInstanceId,
  clock: syntheticClock,
});
await inspectDevelopmentDepositInboxBackup(backup, { expectedChecksum });
await restoreDevelopmentDepositInboxBackup({
  mode: "simulation-only", store: freshTarget, backup, expectedChecksum,
  acknowledgeFreshTarget: true, requestId: restoreRequestId, clock: syntheticClock,
});
await inspectRestoredDevelopmentDepositInbox({
  mode: "simulation-only", store: freshTarget,
  requestId: restoreRequestId, expectedChecksum,
});
```

The expected checksum is retained separately from the restore input. Export requires the source to be durably paused or quarantined. The probe classifies an unresolved native attempt inside its trusted capability; callers cannot supply an arbitrary exception or `classifiedFailure` as authority. `DepositInboxReceipt` fixes request key/fingerprint, journal revision/hash, original disposition, evidence/locator references, cursor effects, quarantine reference and `creditAuthority: false`. Exact lookup returns that original receipt unchanged. Current inbox state is a separate inspection, so recovery of an earlier accepted receipt cannot disguise a later quarantine.

| Condition after admission validation | Durable outcome |
| --- | --- |
| Existing request key, identical input fingerprint | Return original receipt; no new journal revision, evidence, corroboration count or cursor movement. This works after pause/quarantine and after evidence freshness expires. |
| New request key, same admitted exact observation already stored | `duplicate-evidence`: link the new command to the same immutable evidence; do not count another independent observation. A valid candidate cursor may advance once. |
| New locator, consistent transaction/block anchors and assignment | `recorded`: create one event and its original facts. |
| Existing locator, different valid observation bytes, identical facts and compatible nonregressing finality history | `corroborating-observation`: retain another observation link. This describes repeated configured-source evidence, not increased credit authority or proof of another independent operator. |
| Compatible evidence prepared against an earlier head/cursor, now behind an independently committed newer head | `stale-preparation-held`: preserve the diagnostic without retreating the current source head or advancing the candidate; prepare a new attempt from the current base. |
| Valid candidate evidence lacks a complete connection from the retained source head | `continuity-unproved-held`: do not invent a bridge, advance the head/cursor or quarantine merely for missing history. |
| Valid evidence contradicts assignment, event facts, transaction placement, a retained block anchor or validated source head | `conflict-quarantined`: persist the contradiction and seal the entire inbox in the same transaction. The accepted facts stay unchanged. No candidate cursor advances. |
| Same request key with a different valid payload | Preserve the original command/receipt. Atomically append a fault keyed by the old request key plus old/new fingerprints and quarantine the inbox; return that separate fault receipt. Repeating the same fault recovers it exactly. Never overwrite the original receipt. |
| New malformed input, unknown admission or unsupported profile | Typed refusal before node IO/write; no invented event or chain-failure conclusion. |
| Trusted reader reports timeout, missing receipt, stale checkpoint or required evidence outside bounds | Persist a bounded `attempt-held` diagnostic under its stable request identity; cursor unchanged. A genuinely new read uses a new attempt/request after the held outcome is known. It is not a failed transfer. |
| Trusted reader reports `SOURCE_CONFLICT` before a sealed observation exists | Persist a `source-conflict-unsealed` quarantine with admitted attempt identity and sanitized error classification. Do not fabricate a complete observation or claim raw conflicting receipts were retained. |

`INVALID_EVIDENCE` from a new probe is an unresolved hold, not definitive chain failure. The supported transfer decoder intentionally rejects many unrelated or malformed receipts. A changed *validated* observation is handled by the conflict rows above. Raw caller exceptions/provider error strings are not accepted as a worker's classified failure record.

New observations and new jobs are refused once paused/quarantined. Exact receipt/fault recovery, inspection and export remain available. `pause` is irreversible in this version. Quarantine is also irreversible; no owner override, successful later probe, fresh checkpoint or restore silently clears it.

## 7. One write transaction

The implemented transaction owner follows this order:

1. Capture and validate the complete command, admission envelope and semantic transcript outside SQL. Capture a stable command clock once. Do not issue node calls inside `store.transaction`.
2. Start one SERIALIZABLE owner, verify the original physical transaction ID, runtime, UTC, schema fingerprint and physical store-instance ID, and lock/increment the singleton head's fencing version. Certify the same transaction before and after subordinate readers/writers, following the existing combined-recovery ownership pattern.
3. Verify retained history/projections. Resolve an exact request or exact prior fault first. An exact retry does not require a fresh chain observation or a still-open recording gate.
4. For a new command, verify worker/manifest identity, the retained historical preparation base and recording state. Evaluate validated contradictions against request/event/transaction/block/head history **before** an ordinary stale-cursor refusal, so a stale worker cannot silently discard a demonstrated finality conflict. Compare the attempt's head to its preparation base separately from later commits; older compatible work is held, not quarantined solely by arrival order.
5. If contradictory, append the immutable conflict/fault record and terminal global quarantine. Return a quarantine receipt from the transaction; do not throw it away through rollback. Next classify and durably record `stale-preparation-held` or `continuity-unproved-held` without source-head/candidate-cursor movement, even if that attempt's candidate cursor is also stale. A durable hold still advances the command journal revision. Only a remaining ordinary cursor compare-and-swap miss, with neither contradiction nor one of those hold conditions, refuses the whole command without inserts.
6. Otherwise recheck new-evidence age, proven continuity to the current retained head, exact cursor precondition and size budgets. Append one command, full evidence/provenance and required anchors/projections, or its explicit nonadvancing hold receipt. Advance an eligible candidate ordinal only on the accepted dispositions. Write the complete result and new journal/state hashes. Live-clock checks may reject a delayed/retried callback; they must not trigger node IO, change the captured input or mint a replacement command identity.
7. Recheck runtime/physical identity and run deferred SQL completeness at COMMIT. Return the stored receipt only after acknowledged COMMIT. Any earlier database failure rolls back evidence and progress together.

The global quarantine is deliberate: a bounded development inbox has no safe automated exposure analysis or partial-resume policy. Its purpose is to retain the contradiction and stop progression. Store the offending evidence separately from the first accepted facts; replacing the first block/amount to make later data fit is forbidden.

## 8. Uncertain COMMIT and restart

The existing driver may retry real `40001`/`40P01` failures up to its bound; the entire callback must therefore be deterministic from captured input. A lost COMMIT reply is different: [`CommitOutcomeUnknownError`](../../src/lib/alpha-wallet/durable-store.ts) must propagate with the stable request identity/fingerprint. PGlite's poisoned store must close and reopen; PostgreSQL discards the uncertain connection. Stop the local ingestion loop while resolving the outcome.

`reconcileUnknown` opens the **same physical store instance**, acquires the same singleton fence and verifies its complete history. That fence must wait for any still-running prior writer; serialization retries must obtain a fresh snapshot. It returns exactly one of:

- `committed`: the original complete command or deterministic fault receipt exists with the expected fingerprint and verified projections. Return it; never reobserve or append again.
- `not-recorded`: the verified same target, after the fence, has no matching command/fault or orphaned effects and still has the expected pre-command checkpoint. The exact prepared command may be retried if current new-admission gates still permit it.
- `not-recorded-stale`: the same verified target proves no matching effect, but another complete command advanced the head/cursor. Replan explicitly from the current checkpoint; do not substitute another request ID merely because the initial COMMIT was uncertain.
- `unresolved`: wrong/missing store identity, unreadable history, partial receipt, inconsistent projections or unavailable locking. Remain stopped. A missing row in an arbitrary new/restored database is never evidence of rollback.

A restored target has a new physical instance ID even when it carries the same logical inbox/history. It cannot resolve an unknown later command from the original source. If COMMIT was acknowledged but response serialization/delivery subsequently fails, report a distinct `committed-response-unavailable` result with the request/checkpoint; its recovery is receipt lookup, not another command.

## 9. Candidate backfill and eventual chain coverage

### First slice: fixed candidate jobs

Register a bounded immutable ordered candidate manifest with `jobId`, admission hash and `candidateManifestSha256`. Each ordinal fixes assignment/source set, transaction ID, native event index and expected amount. Reject ambiguous duplicate locators with different expectations. The job cursor stores `{ nextOrdinal, revision, candidateManifestSha256 }`; it is explicitly named **candidate progress**, never `lastScannedBlock`.

`record` may include `{ jobId, expectedCursorRevision, expectedNextOrdinal, candidateManifestSha256 }`. It must match the prepared observation's exact candidate. On `recorded`, `duplicate-evidence` or `corroborating-observation`, one command stores the evidence/result and advances exactly one ordinal. SQL compares and swaps the old cursor and independently binds the new ordinal to that command. A network hold, invalid candidate, contradiction, incomplete receipt, exhausted bound or failed transaction cannot advance it. No skip/fast-forward API is provided.

On restart, inspect the committed cursor and reconcile any uncertain request before selecting the next ordinal. Two workers may prepare the same ordinal outside SQL; one fenced commit advances it, an exact duplicate request recovers the original receipt, and a different stale request produces no partial progress. A crash after evidence writes but before COMMIT leaves neither evidence nor advancement; a crash after COMMIT leaves both.

This supports a bounded replay/backfill of **known candidates only**. Current observers cannot freshly verify a candidate whose containing block is more than the configured ancestry bound behind the current head. Such a job remains held. Relabeling its cursor as complete chain history or quietly omitting the old candidate is forbidden.

### Separate future gate: block coverage

A chain-height cursor is **not implemented or exposed by the first slice**. It may be introduced only with a new exhaustive native range reader and a `CoverageWindowV1` certificate containing chain/scope/admission hashes, previous cursor height/hash, every consecutive block in the window, complete ordered transaction membership, both required source receipt views, all matched native event locators, complete ancestry to the captured head and explicit outcomes for every enumerated transaction. Empty blocks require validated headers and empty membership from the required sources; absence from an indexer/address-history listing is not coverage.

The future reader must define validation for transactions that are not supported successful token transfers, including failed/native/system transactions. The current frozen transfer decoders do not provide that exhaustive classification. Unsupported or missing receipt evidence holds the window. This is an actual implementation prerequisite, not an instruction to treat decoder rejection as an empty block.

For the first proposed coverage profile, cap a window at four blocks, 32 transactions and 64 matched events, while retaining the transport's total read/byte/time bounds. A complete read plan that cannot fit must fail before cursor advancement; no required receipt or ancestor is truncated. A valid `commitCoverageWindow` would atomically store every event/diagnostic and update `{ lastCompleteHeight, lastCompleteHash, scopeHash, revision }` from an exact compare-and-swap precondition. Any conflict seals quarantine and leaves the height cursor unchanged. Scope/source changes require a reviewed new stream/continuation, never reuse of an old coverage label.

## 10. Independent backup and restoration

The independent logical format is **`alpha-wallet-development-deposit-inbox`**, `formatVersion: 1`, with no wallet engine version or ledger command vocabulary. It contains the complete admission manifest/commitments, logical and physical source identities, journal/checkpoint, exact evidence blobs, anchors, event links, candidate jobs/cursors, quarantine records and a checksum. Hashes detect consistency; backup authenticity and encrypted external retention are separate future requirements.

Export only a durably paused/quarantined source. Recompute hashes, transcript semantics at their original recorded times, immutable projections, cursor completeness and bounds in one certified snapshot. Do not apply today's freshness clock to historical observations. Do not strip source conflicts, raw receipts or old evidence to fit a size bound. Reserve room for the mandatory restore quarantine.

Restore requires a separately retained expected checksum, explicit fresh-target acknowledgment, a new isolated target, and one owner transaction shared by installation, semantic replay, target-instance creation and final quarantine. Reproduce original history/receipts first, then append exactly one restoration quarantine and complete immutable recovery receipt before COMMIT. Concurrent fresh-target restores share a bootstrap fence. Failure at any install/replay/seal stage rolls back the entire target operation.

Preserve source-instance lineage, but allocate a new physical target ID. Restored candidate cursors are historical bookmarks in a quarantined inbox; they do not authorize active scanning or show that no post-backup observation occurred. There is no v1 resume operation. Operational endpoints, credentials, account sessions, delivery state, signing keys and wallet balances are not restored.

No change is permitted to `backup.ts`, `versioned-backup.ts`, `v3-backup.ts`, `v4-backup.ts`, `v5-backup.ts`, the marketplace backup manifests, existing SQL migrations, frozen engine/command/projection modules or fixture hashes. Existing recovery formats continue to reject an inbox companion schema. Any later coordinated financial backup requires its own explicit successor format; this document does not reserve a V6 authority or grant it implicitly.

## 11. Initial bounds and failure behavior

| Resource | Implemented inbox-v1 limit |
| --- | --- |
| Manifest | At most 2 chains, 4 exact assets, 8 sources, 4 source pairs, 64 custody assignments and 16 worker/job scopes |
| Candidate jobs | At most 16 immutable jobs, each with at most 256 explicit candidates; one ordinal advance per accepted record command |
| Retained observations | At most 256 distinct complete observations; no evidence eviction |
| Retained anchors/events | At most 4,096 block anchors, 256 transaction anchors and 256 native events |
| Raw evidence bytes | Existing per-observation transport bounds; at most 16 MiB aggregate retained raw request/response bytes in this bounded inbox |
| Additional timing trace | At most one start/return/elapsed tuple per retained read and eight semantic clock samples; exact call order is fixed by the prepared observation profile |
| Journal | At most 1,000 records; ordinary mutations stop at 998, reserving capacity for one terminal pause/quarantine and one restoration quarantine |
| Full portable envelope | At most 64 MiB of exact UTF-8 serialization and 100,000 data nodes, including repeated projections, timing provenance, immutable results and the checksum |
| Reserved control capacity | 65,536 bytes and 2,048 nodes per terminal/restore control; ordinary recording reserves two controls, terminal state reserves one restore control, and completed restoration uses the full bound |
| New admission delay | At most 30 seconds after observation completion, with checkpoint freshness still checked under the pinned policy; exact receipt retries use original evidence and are exempt |

If evidence cannot fit, persist a terminal resource quarantine using reserved control/receipt capacity. Retain only the rejected input fingerprint and attempted scope; do not claim that the rejected raw observation was retained or accepted. Leave candidate progress unchanged and stop. A valid conflict can retain its evidence when ordinary capacity permits. A terminal control using its final reserved slot must itself fit the bounded byte/node allowance. Do not truncate observations or delete prior evidence to make space. Exact retries and reads remain possible after terminal stop; export/restore refuse if the complete supported recovery unit cannot fit.

These are deliberately small development bounds, not production throughput targets. They keep full replay and failure testing concrete. Changes require a new reviewed profile, not an environment variable that silently widens admission.

## 12. Development acceptance contract and source-bound evidence

The implemented files are `deposit-inbox-protocol.ts`, `deposit-inbox-model.ts`, `deposit-inbox-probe.ts`, `deposit-inbox-store.ts`, `deposit-inbox-portable.ts` and `deposit-inbox-backup.ts`, with focused model/probe/store/backup suites. SQL lives in `docs/alpha-wallet/deposit-inbox-schema.sql`. Synthetic fixtures are in `scripts/alpha-wallet/deposit-inbox-fixtures.ts`; disposable native drills are `scripts/alpha-wallet/postgres-deposit-inbox.ts` and `postgres-deposit-inbox-backup.ts`. The [verification report](deposit-inbox-verification-2026-11-06.md) and [machine-readable evidence](deposit-inbox-verification-results.json) record the actual source and executed gate. The table below remains an acceptance contract; total test counts alone do not establish every conceivable production failure mode. Frozen source contracts retain their original meanings.

| Test layer | Required evidence and invariant |
| --- | --- |
| Pure admission/transcript tests | Reject endpoint commitment changes under an existing source ID, assignment substitution, wrong family/genesis/token/recipient, executable objects, malformed/duplicate-key JSON, false observation digests, missing/reordered/extra reads, forged completion times and unproved advancing heads. Retain exact uint256/uint64 values. |
| Identity/equality tests | Separate exact retry, repeated identical evidence, new corroborating observation and conflict. Preserve genuine identical events at different offsets. Reject changed emitter/recipient/amount, reassignment and BSC re-inclusion with a changed block-wide index through the transaction anchor. Check cross-observation block/head conflicts even across different selected events. Prove an out-of-order older observation holds without false quarantine, a true regression below its captured base quarantines, and an unbridged later candidate holds without inventing continuity. |
| Recorder/restart tests | Reopen PGlite on a real temporary path and replay every projection. Exact retry remains read-only after pause and expired freshness. A held attempt never advances a candidate. Mutating caller data after capture cannot change a command or admission. |
| SQL direct-writer tests | Refuse update/delete of evidence, anchors, manifest or receipts; partial commands; missing quarantine effects; direct cursor movement; orphaned links; fractional/overflow values; effects appended to a previously sealed command; and clearing a terminal gate. Suppress application coherence checks to prove deferred structural enforcement. Hash/semantic tampering must also fail repository replay even where SQL only checks structure. |
| Actual PostgreSQL concurrency | Use distinct backend PIDs and explicit barriers/observed lock waits. Same-key competitors yield one command/receipt; same-event different-key writers add provenance without another event; conflicting writers preserve the first facts and durably quarantine; competing ordinal commits advance once. Never model concurrency by overlapping queries on one client. |
| Rollback boundaries | Inject failures after blob insertion, anchor insertion, event link, cursor update, result write and deferred seal. Assert no partial evidence/cursor state commits. A deliberate conflict receipt must commit its quarantine rather than being lost through an exception. |
| Lost replies | Lose the reply after actual COMMIT and, separately, fail before COMMIT. Reopen/fence the same target, recover one original receipt or prove absence as specified. Test wrong target, missing/partial receipt, another worker advancing the cursor, poisoned PGlite, and acknowledged commit with failed response delivery. No second node read is used as commit recovery. |
| Backup/native recovery | Reject omitted conflicts, changed attribution, reordered history, altered raw bytes, forged cursors and recomputed-but-semantically-invalid envelopes. Restore an empty and a nonempty inbox, fail each stage, race two fresh-target restores and lose a committed restore reply. Source remains paused and target is quarantined. |
| Compatibility and money gates | Compare frozen V1–V5 source/fixture hashes and retained test identities; run their existing recovery checks unchanged. Spy/deny every financial command and signer/provider-send surface during all inbox paths. Reject hosted/mainnet/signing flags before store or node IO. Prove no ledger/marketplace schema appears in the inbox store and no inbox schema appears in an existing wallet target. |
| Coverage, when separately implemented | Complete/empty windows, missing transactions/receipts, two conflicting sources, intermediate ancestry forks, budget overflow, crash before/after cursor CAS, overlapping workers and changed scope. Until this passes, there is no chain-height coverage cursor claim. |

Use locked dependencies, `TZ=UTC` and disposable loopback PostgreSQL 17 fixtures for the native development gate. Preserve native Vitest inventories, native-drill results, source hashes and the exact implementation commit. The new inbox evidence is separate from retained observer, financial and browser regression coverage. Production/native-mobile builds, independent audits, live balances and real transfers remain outside this acceptance statement.

## 13. Delivered development slices and explicit remaining gates

1. Delivered the deterministic inbox reducer around the implemented closed manifest and envelope/transcript validators. It retains transaction/block anchors and absorbing quarantine, with semantic retry/conflict coverage and no money calls.
2. Delivered the isolated schema/recorder and fixed-candidate cursor in one owner transaction. The exact-source gate includes direct-writer, native concurrency and uncertain-COMMIT evidence.
3. Delivered independent paused export/fresh-target quarantine restore and frozen-history compatibility evidence. The recorder and complete recovery unit are verified together, including retained history and evidence replay.
4. Only then design/implement the exhaustive native range reader and its separate coverage certificate gate. Old-transfer backfill beyond 64 successors remains held until a reviewed historical ancestry/proof strategy exists.

The [preparation layer](deposit-observation-preparation.md) supplies immutable source/assignment admission, semantic/per-read timing, exact transcript replay and validated last-head extraction around the unchanged legacy observation object. The [implemented recorder](deposit-inbox-persistence.md) supplies its preparation context from actual retained history and compares the captured base and candidate bookmark inside the same physical store. Admission and provider IO remain synthetic. No real custody proof, provider authentication/independence, arbitrary-range scanner or cross-ledger consumption protocol is established. V5 admits no fresh deposit/reconciliation command; financial consumption requires an explicit reviewed successor that preserves all original meanings and recovery. Actual deposit credit, sweeps/self-transfers, issuer mint exclusions, asset/liability reconciliation, later seller release, dispute resolution, unpaid cancellation and live product integration retain their separate gates.

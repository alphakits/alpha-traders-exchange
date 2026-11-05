# Alpha Wallet development recovery

This runbook applies only to local **simulation-only** development stores. It does not authorize live deployment, live chain access, signing keys or real funds.

**Latest verified source: `f18e95e6`.** The [seller-native v3 verification](ledger-v3-verification-2026-11-05.md) records **1,626 passing tests**: 1,439 wallet tests across 39 files plus 187 targeted platform authentication/marketplace tests across nine files. Root TypeScript, nine native PostgreSQL drills with 86 checks, and the retained English/Arabic Chromium rehearsal passed on this exact source. All 1,203 prior wallet cases remain, with 236 added cases and eleven new native checks. The isolated v3 financial reservation and paused-wallet recovery are implemented; authenticated initial marketplace coordination and combined initial-cohort recovery remain unfinished. Live launch remains withheld.

The [historical combined recovery report at `09405da`](marketplace-recovery-verification-2026-11-05.md) retains its 1,081-test and six-drill/54-check result, including 83 recovery cases and 11 native combined-recovery checks. The [prior canonical coordinator report](marketplace-coordinator-verification-2026-11-05.md) and [versioned-ledger report](ledger-v2-verification-2026-11-05.md) retain their historical evidence and scope.

**Verified private mobile recovery path:** the private mobile coordinator supports the same owner inspection/pause and original buyer receipt recovery, and `exportMobileMarketplaceWalletBackup` supplies mobile owner export. Sources may contain the exact known mobile authentication table pair; restored targets contain neither table. The [mobile authority contract](marketplace-mobile-auth-design.md) and [exact-source report](marketplace-mobile-verification-2026-11-05.md) describe the supported behavior and executed evidence. This remains an isolated development procedure with no account-authority re-entry, resume or live launch.

## First identify whether the canonical cohort is active

**An enrolled canonical marketplace cohort uses the combined recovery APIs below. Wallet-only export, standalone `snapshot()`/`recoverPayouts()` and worker entry points remain blocked after activation.** The [combined recovery contract](marketplace-recovery-design.md) applies only to its exact isolated development fixture schema, not an arbitrary or production marketplace database.

| Source or target state | Supported procedure |
| --- | --- |
| Paused isolated v3 financial wallet, with no canonical/coordination schema | `exportV3WalletBackup`, `inspectV3WalletBackup`, and fresh-target `restoreV3WalletBackup`; format 3 preserves both continuations and original history, then adds quarantine. No combined canonical recovery or resume |
| Initial-acceptance mechanics fixture with canonical acceptance and only a companion wallet pause | Preserve the complete disposable fixture for inspection. This is not a coordinated financial cohort; wallet-only backup does not capture its canonical rows, and no initial-acceptance combined recovery format exists |
| Canonical marketplace enrollment exists and the source matches the supported fixture | Inspect and pause through the owner coordinator, then export and restore the complete combined recovery unit below |
| Activation status is uncertain, integrity checks fail, or the schema/cohort is unsupported | Preserve the complete isolated source and investigate. Do not select a wallet-only procedure to bypass the refusal |
| A target was created by combined recovery, including an uncertain COMMIT outcome | Reopen that same target and use the offline recovery diagnostic with the separately retained checksum |
| Standalone v1/v2 source is confirmed to have no active canonical marketplace enrollment | Use the standalone v1/mixed-v2 backup and paused-restore procedure later in this runbook |

The distinction concerns activation by the [private canonical coordinator](marketplace-coordinator-design.md). Standalone v2 ledger fixtures may contain their own synthetic terms bindings; they do not establish a canonical marketplace cohort. A ledger-only backup also cannot prove that the source remained unenrolled after its checkpoint. Establish the active source and its enrollment state before choosing a recovery procedure.

The [initial seller acceptance groundwork](initial-acceptance-design.md) does not change either existing recovery format. Its frozen v2 history verifies original restore/receipt/payout behavior; its canonical mechanics drill is deliberately separate from recovery-compatible activation. The separate v3 milestone now has an isolated paused-wallet format. An authenticated seller-native canonical flow still needs its own combined recovery contract before activation.

## Isolated v3 financial wallet

Use the [v3 recovery contract](ledger-v3-initial-acceptance-design.md) only for an explicitly continued v3 financial ledger without canonical or coordination schemas. Pause its source through the v3 operator command first. `exportV3WalletBackup` requires the actual paused replay state; `inspectV3WalletBackup` validates the complete original command history, both continuations, source checkpoint and checksum. These checks establish consistency, not authentication.

`restoreV3WalletBackup` takes a guarded fresh isolated store and explicit fresh-target acknowledgment. It reconstructs the v1/v2/v3 history and both migrations at their recorded clocks, verifies the exact source checkpoint, and adds a deterministic v3 quarantine pause in the same owned SERIALIZABLE transaction. Source and target remain paused. Known failure rolls back schema, projections and all restored commands. A lost COMMIT reply requires inspection of the same target; repeated restore cannot replace committed history.

Reopen through `createV3DurableWallet`. Exact historical command/business receipts retain their original event identity; historic dispatch recovery always returns `shouldDispatch: false`. New initial reservation retries require the exact original actor/evidence and have no new financial effect. Current authenticated seller authority is not part of this isolated library and must be supplied by the future canonical coordinator.

The v3 envelope permits only continuation, initial reservation and pause. It supplies no resume or subsequent lifecycle operation, no provider reauthorization, and no source/target custody ownership transfer. Old readers/exporters reject format 3. Existing canonical coordination namespaces are refused even when empty; wallet-only export also refuses canonical schemas and unrelated public relations. The old canonical mechanics fixture cannot be recovered using this wallet-only format.

[Exact-source evidence at `f18e95e6`](ledger-v3-verification-2026-11-05.md) includes real PostgreSQL receipt contention, migration and financial rollback, a competing fresh-target restore, injected reply loss after actual commit, and close/reopen. These results do not establish a combined initial-acceptance recovery unit or production recovery readiness.

## Enrolled canonical cohort: inspect, pause, export and restore

The supported recovery cohort contains one already accepted canonical request with a clean wallet reservation. Its existing amount-correction proposal may still be pending or may already have been accepted. It supports current ILS Bank Transfer and Face-to-Face terms, the only active canonical reservation on its listing, the only nonterminal wallet trade globally and no unfinished payout. This narrow development rule leaves the general three-active-trades-per-seller policy unchanged.

Export requires the exact supported canonical and coordination tables, columns, types and nullability. The new source compatibility accepts either neither mobile authentication table or the exact known `mobile_device_sessions` / `mobile_refresh_token_history` pair, including their relation kinds and complete column shapes. Partial pairs, malformed tables, other additional or missing schema elements and unrelated namespaces are refused. The combined bundle retains all supported canonical financial/application rows, mixed wallet history and immutable enrollment/acceptance/publication records. It retains only user IDs, role labels and seller status, excluding web/mobile sessions, device credentials, refresh history, original profiles and authentication material. Old transaction registrations are never imported as authority in another database.

1. **Stop new coordinator work and preserve the source.** Identify the complete isolated database that owns `alpha_exchange`, `alpha_wallet_simulation` and `alpha_wallet_marketplace_simulation`. Stop other callers while retaining a controlled owner recovery path. Keep relevant incident evidence. Do not start a second active copy, remove guards, clear a pause or create an ad hoc context to bypass blocked standalone tools.
2. **Inspect and pause through the typed owner boundary.** Select the web coordinator with a valid stored owner `sessionToken`, or the new mobile coordinator with a current stored owner `accessToken` and `metadata: { deviceId, platform, appVersion, locale }`. Supply the canonical request ID to `inspect`, then use `pause` with a retained incident operation ID. Record safe revisions, event hashes, current terms, balances and pause status. If authentication or integrity validation fails, preserve the source and investigate; both export APIs require actual owner authority and an already paused source.
3. **Resolve an unknown acceptance outcome on the original source by its original business identity.** The same canonical buyer must authenticate again and call `acceptAmountCorrection` with the original request/proposal IDs and expected prior binding revision. A new transport operation ID, renewed valid session or switch between authenticated web/mobile entry points may recover the original receipt after acceptance or owner pause without another principal transfer. Revoked or replaced credentials cannot recover it. Owner inspection does not override buyer receipt authorization. Retry an uncertain owner enrollment or pause with its original input/operation identity. Never infer rollback from a missing response or replace/delete an acceptance.
4. **Export the complete recovery unit.** Call `exportMarketplaceWalletBackup` with the paused source, enrolled request ID and valid web owner session, or `exportMobileMarketplaceWalletBackup` with the corresponding mobile owner credentials. Canonical locks, the selected fixed authentication reader, wallet replay/projection verification, row capture and coherence checks share one transaction. Export rechecks authority/expiry after awaited work. For the same source state, owner and export clock, both exports produce the same financial bytes. Preserve the original source; neither API initializes it, clears its pause, delivers events or contacts a provider.
5. **Retain and inspect the recovery copy.** Save the returned private JSON under restricted access, using a new file rather than overwriting evidence. Record its canonical checksum, source checkpoint, export time and source identity separately. `inspectMarketplaceWalletBackup` validates the bytes without opening a database transaction. Compare with the independently retained checksum when selecting a copy. A hash of raw file bytes is not the canonical checksum expected by the API. A checksum establishes consistency, not the creator, recency or absence of activity in another source.
6. **Prepare a genuinely fresh isolated target.** Select a new marked local file-store directory or explicitly isolated loopback PostgreSQL development database using the guarded store factory. Do not pre-initialize a wallet or canonical schema: combined restore refuses even an empty existing application namespace, as well as unrelated public, temporary or extension objects. Use no application/production connection string or environment-derived URL. The native fixture role requires deliberate superuser or `BYPASSRLS` capability; this is not a production permissions design.
7. **Restore and retain both checkpoints.** Call `restoreMarketplaceWalletBackup` with the actual selected bytes, `acknowledgeFreshTarget: true` and the mandatory separately retained `expectedChecksum`. All original wallet commands, canonical rows, common writer guards, a new durable pause and the immutable recovery receipt commit together. The target has the original N commands followed by exactly one new quarantine command. Record the original source checkpoint separately from the restored N+1 checkpoint. Restore never drops, overwrites or repairs an existing target.
8. **Reopen the same target and verify its quarantine.** Use `inspectRestoredMarketplaceWallet` with that target and the same independently retained checksum. It verifies the receipt, original history, exact added pause, current canonical/coordination digests, common coherence checks, empty web sessions, absence of both mobile authentication tables and exact disabled identity stubs. Keep the source fenced and the target paused. This offline diagnostic grants no web/mobile account authority and does not activate the recovered copy.

The JSON is **private plaintext**: canonical financial payloads still contain payment instructions, destinations, user names and trade history. Do not attach it to public issues or paste it into logs. The library returns a string; it does not choose a backup destination, implement encryption/retention or configure a scheduled service. It refuses more than 16 MiB of UTF-8 JSON, 1,000 wallet commands, 1,000 rows per table or 10,000 captured rows in total rather than truncating the recovery unit. Physical SQL timestamps retain microseconds, bigint counters remain strings, and capture refuses values that would lose JSON numeric precision across the database boundary.

### Combined recovery API in an isolated fixture

```ts
import { createDevelopmentMarketplaceWalletCoordinator } from "./src/lib/alpha-wallet/marketplace-coordinator";
import {
  exportMarketplaceWalletBackup,
  inspectMarketplaceWalletBackup,
  restoreMarketplaceWalletBackup,
  inspectRestoredMarketplaceWallet,
} from "./src/lib/alpha-wallet/marketplace-backup";

// `source` is the existing guarded simulation WalletStore.
// Use an already issued valid stored owner session and trusted fixture clocks.
const ownerInput = { sessionToken: ownerSessionToken, requestId: canonicalRequestId };
const coordinator = createDevelopmentMarketplaceWalletCoordinator({
  mode: "simulation-only", store: source, clock: fixtureClock,
});
const current = await coordinator.inspect(ownerInput);
const paused = await coordinator.pause({
  ...ownerInput, operationId: incidentPauseOperationId,
});
// Preserve the operation identity if the pause's response is uncertain.

const serialized = await exportMarketplaceWalletBackup({
  mode: "simulation-only", store: source, ...ownerInput, clock: fixtureClock,
});
const inspected = inspectMarketplaceWalletBackup(serialized);
// Save the private bytes and record inspected.checksum/checkpoint separately.
// `separatelyRetainedChecksum` below comes from that independent record.

const restored = await restoreMarketplaceWalletBackup({
  mode: "simulation-only", store: freshTarget, backup: serialized,
  acknowledgeFreshTarget: true, expectedChecksum: separatelyRetainedChecksum,
  clock: restoreFixtureClock,
});
// restored.quarantined is true only after the outer transaction commits.
// restored.backup.checkpoint is the source; restored.restored includes the new pause.

// Close/reopen the SAME target before checking a retained or uncertain outcome.
const verifiedOutcome = await inspectRestoredMarketplaceWallet({
  mode: "simulation-only", store: reopenedSameTarget,
  expectedChecksum: separatelyRetainedChecksum,
});
// Safe metadata only. Do not print session tokens or the serialized private bundle.
```

The new mobile owner entry point is an alternative to the web inspection/pause/export portion above. Use an already issued valid stored mobile session in the isolated source; the recovery APIs never issue or refresh one:

```ts
import { createDevelopmentMobileMarketplaceWalletCoordinator } from "./src/lib/alpha-wallet/marketplace-coordinator";
import { exportMobileMarketplaceWalletBackup } from "./src/lib/alpha-wallet/marketplace-backup";

const mobileOwnerInput = {
  accessToken: ownerAccessToken,
  metadata: {
    deviceId: ownerDeviceId, platform: "android" as const,
    appVersion: currentAppVersion, locale: "ar" as const,
  },
  requestId: canonicalRequestId,
};
const mobileCoordinator = createDevelopmentMobileMarketplaceWalletCoordinator({
  mode: "simulation-only", store: source, clock: fixtureClock,
});
const mobileCurrent = await mobileCoordinator.inspect(mobileOwnerInput);
const mobilePaused = await mobileCoordinator.pause({
  ...mobileOwnerInput, operationId: incidentPauseOperationId,
});
const mobileSerialized = await exportMobileMarketplaceWalletBackup({
  mode: "simulation-only", store: source, ...mobileOwnerInput, clock: fixtureClock,
});
// Retain, inspect and restore these bytes with the same combined APIs above.
// Never print the access token, metadata or private backup into logs.
```

Each fixed reader locks its actual session/account rows in the same transaction as canonical reads and export work. It rechecks authority and expiry after awaited capture and persistence. The mobile path also enforces stored device/platform binding and the current minimum app version. A revocation committed before the locked read invalidates the attempt, including through whole-transaction retry; a revocation queued behind an already acquired lock is ordered afterward. Expiry checks do not promise that the eventual COMMIT acknowledgement arrives before a wall-clock deadline. The separate standalone mobile wallet resolver retains its earlier reread contract; it does not supply authority to this coordinator.

### Identity quarantine is not restored login authority

Recovered users are disabled, credential-free identity stubs. Their original profiles, phone evidence, passwords, web/mobile sessions, device credentials and refresh history are not restored. Neither mobile authentication table is created. The diagnostic refuses either relation even if it is empty, and the deferred recovery-receipt constraint rechecks their absence at restore COMMIT so late same-transaction table/credential insertion cannot bypass quarantine. The source's owner/buyer credentials therefore cannot authenticate against the recovered target. Do not copy sessions, enable a stub or fabricate fresh authority from its retained role label to make a login work.

Use the offline diagnostic for recovery verification. It requires the explicit guarded database capability and separately retained checksum; it is not a public route or an owner/buyer authentication bypass. There is no account-authority re-entry or resume API. Requiring the source pause prevents new financial work through this cohort's supported operations, but does not implement a cross-instance leader lease or discover another independently active copy.

A recovered cohort cannot create new proposals, initial acceptances, cancellation/dispute/payment transitions, release, payout or settlement. Its stored publication intent is not delivered externally. Combined provider/chain reconciliation, authenticated provenance, encryption/retention, production schema/role compatibility, identity recovery, source fencing, recovery objectives, controlled resume and independent review remain separate launch requirements.

### If a combined restore's COMMIT result is unknown

`ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN` means the acknowledgement is uncertain; it does not establish rollback. Preserve the selected bundle, independently retained checksum, source checkpoint and exact target identity. Close the failed connection and reopen **that same target** with the guarded development store.

Call `inspectRestoredMarketplaceWallet`. A successful result verifies the immutable receipt and complete source history followed by the checksum-bound pause: operator `marketplace-backup-recovery`, request ID `restore-<combined checksum>`. Its original source and restored checkpoints remain distinct. Do not append a replacement acceptance, erase a receipt, restore only the ledger or activate another copy to compensate for a missing reply.

A committed target rejects another restore as nonempty. Preserve that target and inspect it; a nonempty refusal is not permission to clear it. A missing receipt alone also does not prove the destination is empty. Partial, inconsistent, unpaused, credential-bearing or differently checksummed state must remain isolated for investigation. A fresh restore may be retried only after the same destination is confirmed genuinely empty and the earlier writers are stopped. Neither a generic error nor an isolated row count establishes those facts.

Implementation references: [combined API and same-target diagnostic](../../src/lib/alpha-wallet/marketplace-backup.ts), [strict manifest verification](../../src/lib/alpha-wallet/marketplace-backup-manifest.ts), [fresh-target storage and identity quarantine](../../src/lib/alpha-wallet/marketplace-recovery-store.ts), [immutable recovery receipt checks](marketplace-recovery-receipts.sql), [common SQL fences](marketplace-coordination-guards.sql), [private coordinator](../../src/lib/alpha-wallet/marketplace-coordinator.ts), and the [full combined recovery contract](marketplace-recovery-design.md).

## Standalone recovery always starts paused

**All backup formats, export/restore APIs, CLI commands and payout-recovery instructions below apply only to a source confirmed to have no active canonical marketplace enrollment. They do not recover an enrolled cohort.**

**Every restored wallet receives a new, durable operator pause in the same database transaction as its restored history.** A restored wallet cannot issue a new dispatch claim, create a listing, reserve a new trade, or request a withdrawal. Matching reconciliation and native-fee readiness do not remove that pause. This implementation has no resume command.

Restoring a ledger does not undo a provider's acceptance of a transfer or a chain settlement. In particular, a backup may show a payout as `queued` even though the original wallet submitted it after the backup. Treat every restored payout as potentially newer outside the backup until independent evidence resolves its status. Never use an old backup to justify another send.

Implementation references: [backup and restore](../../src/lib/alpha-wallet/backup.ts), [verified durable replay](../../src/lib/alpha-wallet/durable.ts), [storage boundaries](../../src/lib/alpha-wallet/durable-store.ts), [payout worker](../../src/lib/alpha-wallet/payout-worker.ts), and [recovery tests](../../src/lib/alpha-wallet/backup.test.ts).

## What a standalone wallet backup contains

The exported JSON uses format `alpha-wallet-simulation-command-backup`. Pure v1 histories retain format version `1`; mixed histories use format version `2`, the terminal v2 engine and an explicit verified continuation boundary. Both contain the immutable commands in their original order, original timestamps, command identities, input/result/state hashes and event hash chain. A checkpoint records the final revision, event hash, state hash and last command timestamp. Amounts retain their original decimal strings or tagged integer representations; they never pass through floating-point currency arithmetic.

Export runs inside one storage transaction. The repository first replays the source history and verifies its SQL journal, entries, payout intents, payout events, and chain-event claims. An inconsistent source cannot produce a backup through this API. The file contains logical command history; it does not contain arbitrary SQL, provider records, credentials, private keys, physical PostgreSQL files or a complete copy of the surrounding marketplace. It also omits canonical coordination registrations, application enrollment/acceptance records and publication intents, which is why the active cohort rejects wallet-only export.

Restore replays that history into a fresh development store using the original command timestamps. Before adding quarantine, it checks that the revision, event hash, and complete state digest match the original checkpoint. The original command rows and event hashes remain unchanged. The final operator-pause command adds one revision and a new state/event hash, which is reported separately from the original checkpoint.

The development format accepts at most **1,000 backed-up commands** and **16 MiB of UTF-8 JSON**. It rejects unsupported engine/format versions and oversized files. It never truncates history to fit. Restore currently reuses the repository command path, which replays earlier commands again as it progresses; these limits do not establish production-scale performance. A history at the command limit may exceed the export limit after its extra quarantine command; reviewed checkpointing/version work is required before exporting such a restored history again.

## Checksums, provenance, and file handling

The SHA-256 checksum and hash chain establish internal consistency. The checksum uses the project's canonical JSON encoding of the parsed document without its `checksum` field. Record the value returned by `inspectWalletBackup`; a separate hash of raw file bytes will have a different meaning and value. These checks do **not** prove who created the backup, whether it is the latest backup, or whether external activity happened after its checkpoint. Someone able to replace the entire file can create another internally consistent history and recompute its checksums. A valid earlier prefix with a rewritten checkpoint is also a different, potentially stale history.

Retain the checksum, checkpoint revision, checkpoint event hash, export timestamp, engine version, and source identification separately from the backup file. Supply `expectedChecksum` during inspection/restore when that separately retained value is available. This comparison is useful only to the extent that the separate record itself is trusted. The module does not implement digital signatures, encryption, independent audit, or a trusted timestamp service.

The JSON is plaintext. Synthetic user identifiers, payment-evidence references, destinations, and command results are included. Keep copies under restricted access and do not attach them to a public issue or paste them into chat logs. The library returns a JSON string and does not choose a filesystem destination, overwrite a file, upload data, or implement a retention policy. A caller that saves a backup should use a new file with restrictive permissions and retain the independently recorded checksum.

Provider fixture records are separate evidence. Preserve their existing directory and identities during an incident. Replacing it with an empty provider fixture would discard the information needed to distinguish accepted transfers from unknown outcomes.

## Incident procedure without canonical marketplace enrollment

1. **Stop new wallet work and fence the original writers.** Stop the explicit simulation worker processes and callers that can write the affected wallet. Record which copy was the active source and which processes were stopped. Restoring a second database does not stop the first one, and this backup module does not implement a cross-instance leader lease or fencing service.
2. **Preserve evidence before making changes.** Record the observed failure, affected payout IDs, provider references, transaction IDs, latest verified revision/event hash, and time. Preserve provider responses/fixture records and relevant application logs. Do not reset dispatch counts, delete payout rows, clear pauses, edit receipt identities, or overwrite the old database.
3. **Inspect the original state if it remains readable.** For this confirmed unenrolled source, use the durable repository's `snapshot()` and `recoverPayouts()`. If a canonical-coordination guard rejects access, stop this procedure and use the enrolled-cohort procedure above. An integrity failure is a reason to preserve the source for investigation. Do not bypass failed replay, projection or enrollment checks to make an export succeed.
4. **Select and inspect the recovery copy.** Check its provenance and compare its checksum/checkpoint with the separately retained record. Record the gap between that checkpoint and the incident. Include every potentially submitted payout during that gap in reconciliation, even if the backup reports it as queued or contains no corresponding payout yet.
5. **Prepare a separate fresh development target.** Use a new marked local file-store directory or an explicitly isolated loopback PostgreSQL development database. Use the guarded store factory. Do not use application/production connection strings or environment-derived database URLs. Native fixtures need the deliberately privileged fixture role required by the schema's forced RLS; granting ordinary client roles access is not a restore procedure.
6. **Restore and verify quarantine.** Restore must commit all original commands and the additional pause together. Record both the source checkpoint and the restored checkpoint. Close/reopen the target and verify its state through the repository. Keep the original source fenced and the restored target paused.
7. **Reconcile external evidence while remaining paused.** Apply the payout and balance procedures below. Recording an already accepted transfer's final receipt is accounting for an existing outcome; it is not permission for a new submission.
8. **Document unresolved items and stop.** This development engine has no release-from-quarantine operation. Do not invent an SQL repair or clear `haltReason` manually. A reviewed recovery procedure, production authentication/authorization design, chain/provider verification and appropriate authorization must exist before any future implementation can release a restored wallet.

## Standalone backup API usage in an offline fixture

The caller creates a guarded `WalletStore` and initializes a source wallet using the existing development APIs. Export does not initialize an unknown source. Restore can initialize a previously absent wallet schema or accept an already initialized store with zero committed commands and no projections. It rejects existing wallet history and unrelated application schemas/public relations; it never drops or replaces them.

```ts
import { exportWalletBackup, inspectWalletBackup, restoreWalletBackup } from "./src/lib/alpha-wallet/backup";

// `source` and `freshTarget` are explicitly created simulation WalletStores.
// The source has no active canonical marketplace enrollment.
const serialized = await exportWalletBackup({
  mode: "simulation-only",
  store: source,
});
const inspected = inspectWalletBackup(serialized);
// Retain inspected.checksum and inspected.checkpoint separately from the JSON.

const restored = await restoreWalletBackup({
  mode: "simulation-only",
  store: freshTarget,
  backup: serialized,
  acknowledgeFreshTarget: true,
  expectedChecksum: separatelyRetainedChecksum,
});
// restored.quarantined is true only after the transaction has committed.
// restored.backup.checkpoint is the original state before quarantine.
// restored.restored is the state after the extra durable pause command.
```

No provider is supplied to these APIs, and neither export nor restore calls one. `inspectWalletBackup` validates the entire document and semantic replay without opening a target transaction. Restore repeats that validation itself. Passing a prior inspection result cannot bypass validation of the actual supplied JSON.

The optional `clock` is for explicit synthetic fixtures. Original command timestamps are preserved exactly, while the quarantine command uses the restore timestamp. Export/restore reject invalid clocks or timestamps earlier than the backed-up history. Fixtures whose logical time is intentionally ahead of wall-clock time must explicitly supply their fixture clock; changing stored timestamps to make a file pass validation is not supported.

All writes, including schema initialization and the pause, share one `SERIALIZABLE` transaction. A known failure rolls back the whole restore. If the final pause cannot be recorded, the preceding restored commands must not become an active wallet.

### Mixed v1/v2 history without canonical marketplace activation

Use [versioned-backup.ts](../../src/lib/alpha-wallet/versioned-backup.ts) for a standalone source that has explicitly continued to v2 and has no active canonical marketplace enrollment: `exportVersionedWalletBackup`, `inspectVersionedWalletBackup` and `restoreVersionedWalletBackup` take the corresponding options shown above. These functions also delegate pure v1 files to the original implementation without upgrading them. They are not a combined marketplace/wallet backup implementation, and an enrolled source rejects their standalone export. The versioned modules use the server-only canonical planner; standalone Node fixtures run with `NODE_ENV=test` and `--conditions=react-server`.

Mixed inspection validates both engines, all original results/hashes, the exact continuation and final checkpoint before opening a target transaction. Restore replays the v1 prefix, the recorded development migration/continuation and v2 tail, then adds a v2 pause in that same transaction. A final-pause failure rolls back the v1 initialization, v2 migration and all commands together. Reopen through `createVersionedDurableWallet`; the original v1 repository deliberately cannot write or inspect an upgraded store.

Use `createVersionedSimulationPayoutWorker` only for an already-upgraded standalone fake-provider fixture without canonical activation. It retains the original recovery policy, including lookup of inherited uncertain payouts while paused and no resubmission after an empty lookup. It never upgrades a store or registers a worker. Active canonical cohorts reject this worker path. The migration's old-wallet-writer fence does not stop another source database, fence production marketplace writers or reconcile an external provider; the applicable incident procedure still applies.

The separately executable [native v2 drill](../../scripts/alpha-wallet/postgres-versioned-ledger.ts) checks migration rollback, inherited settlement, concurrent proposal retries, mixed restore and lookup-only recovery on fresh disposable PostgreSQL databases. [Exact-source verification at `08fb7fa`](ledger-v2-verification-2026-11-05.md) passed all nine native checks, preserving 450 remaining principal plus 3 separate fee revenue after paused restore and making zero submissions during uncertain-payout recovery. See the [v2 continuation contract](ledger-v2-continuation-design.md) for the command and compatibility boundaries.

## Guarded local backup CLI

[backup-cli.ts](../../scripts/alpha-wallet/backup-cli.ts) remains a **v1-only** executable local file-store wrapper; it rejects an upgraded source or mixed-history file. Use the explicit versioned module for standalone v2 without canonical activation. Neither path restores an activated cohort, including from an older pre-enrollment file. Run this CLI from the development checkout with a development/test runtime. All paths must be absolute, their existing directory ancestors must be real directories, and backup reads reject symlinks, nonregular files, invalid UTF-8, and files larger than 16 MiB. A restore requires both the fresh-target flag and a separately retained canonical checksum.

**Close the existing PGlite writer before using this separate-process CLI.** The file transport prevents duplicate opens within one process; it does not fence independent processes. The in-process export API can use an already open store's transaction, while this CLI opens its own store. Keep the original writer stopped throughout recovery and follow the incident fencing procedure above.

Use an existing marked source directory and a new output path inside an existing directory:

```bash
NODE_ENV=test node --import tsx scripts/alpha-wallet/backup-cli.ts export \
  /absolute/path/to/existing-wallet \
  /absolute/path/to/backups/wallet-recovery.json
```

Export verifies the source without initializing a missing/unmarked wallet. It creates a private file with permissions `0600`, syncs the file contents, and publishes it under the new output name without replacing existing files. It also syncs the output directory before reporting success. The JSON printed to the terminal contains checkpoint/checksum metadata, not the full history or token/provider references. Retain the returned `checksum` separately.

Inspect a saved file, optionally comparing that trusted checksum:

```bash
NODE_ENV=test node --import tsx scripts/alpha-wallet/backup-cli.ts inspect \
  /absolute/path/to/backups/wallet-recovery.json \
  --expected-checksum '<64 lowercase hexadecimal characters from export>'
```

The optional `--expected-checksum` argument may be omitted for inspection when provenance has not yet been established. It is mandatory for restore. Use the canonical checksum returned by this CLI; a `sha256sum` of the raw file bytes does not provide the expected value for this argument.

Restore into an absent or empty directory whose parent already exists:

```bash
NODE_ENV=test node --import tsx scripts/alpha-wallet/backup-cli.ts restore \
  /absolute/path/to/backups/wallet-recovery.json \
  /absolute/path/to/fresh-restored-wallet \
  --fresh-target \
  --expected-checksum '<64 lowercase hexadecimal characters from export>'
```

The CLI validates the complete backup, semantic replay, and supplied checksum before creating/opening the target. Existing target contents are refused. Successful output reports `quarantined: true`, the original checkpoint, and the additional pause checkpoint. It never starts a worker or supplies a provider. If an interrupted command leaves an output or target behind, follow the inspection/unknown-commit procedure instead of deleting it to bypass the no-overwrite guard.

The CLI does not accept database URLs, environment-derived connection settings, cloud operations, production mode, hosted runtime flags, or signing/mainnet flags. Current wall-clock time is used; synthetic histories dated in the future require the explicit-clock library fixture API instead.

Separate-process smoke tests, including reopen/no-dispatch and filesystem/runtime refusals:

```bash
node node_modules/vitest/vitest.mjs run src/lib/alpha-wallet/backup-cli.test.ts
```

## If a standalone restore's commit result is unknown

A connection failure while acknowledging commit does not establish whether the transaction committed. Do not interpret an exception as an empty destination, switch immediately to a second active copy, or bypass the fresh-target guard.

The backup CLI reports `ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN` explicitly when the storage adapter detects this condition. It exits unsuccessfully without claiming rollback and instructs the operator to preserve and inspect the same wallet directory. A generic nonzero exit code alone is never evidence that a restore target is empty.

Close the failed store, reopen that **same target**, and inspect it through the verified repository. If the target is still empty, a fresh restore can be retried after confirming that no prior writers remain. If history exists, verify that it consists of the expected original checkpoint followed by the quarantine pause and that the wallet remains halted. The pause identity is deterministic: operator `backup-recovery`, request ID `restore-<backup checksum>`. Preserve the original backup and expected checkpoint while checking this outcome.

Calling restore again against a committed target rejects it as nonempty. That rejection is not a reason to erase the target. If the observed state is partial, unpaused, inconsistent, or different from the expected backup plus pause, keep the target isolated and investigate. Do not treat a manually observed row count alone as verification; use replay, hashes, and projection checks.

## Reconcile each standalone payout by its original identity

| State in the unenrolled wallet backup/restored copy | Required recovery handling |
| --- | --- |
| `queued` | Keep held. Investigate whether the original wallet claimed or submitted it after the checkpoint. The restored worker returns `held_by_policy` without submitting it. A queued backup is not evidence that no external transfer exists. |
| `submitting` / `submission_unknown` | Look up the original immutable provider reference. Keep the reserved amount and original dispatch count. A missing/late lookup result does not permit another submission or a refund. |
| `broadcast` | Follow the recorded transaction and original provider reference. Validate exact asset, destination, amount, execution result, and finality. Do not choose a replacement transaction merely because observation is delayed. |
| `confirmed` | Recheck the existing immutable receipt against trusted external evidence and retain the original identity. Do not pay it again. |
| `failed_final` | Keep reserved funds held for a reviewed recovery decision. The current engine does not automatically refund, retry, or replace a failed payout. |
| Payout absent from the backup | Search the original command/provider evidence for work after the checkpoint. Its absence from this backup cannot establish that no transfer occurred. |

For any receipt, match the exact synthetic asset/network/token, destination, amount, provider reference, transaction identity, event index, execution outcome, and finality. Preserve the uniqueness of incoming and outgoing event claims. An amount match or aggregate balance match alone is insufficient to identify a specific transfer.

The existing offline worker can look up and record outcomes for an original `submitting`, `submission_unknown`, or `broadcast` payout while the wallet remains paused. It cannot issue another submission for those states. This is an explicit test step, not an automatically started recovery service.

If a stale copy says `queued` but independent evidence proves that the old source submitted it later, the current engine cannot invent the missing dispatch history or confirm that queued payout directly. Prefer a later verified backup/history containing the original claim and restore it into another fresh quarantined target. If that history is unavailable, preserve the evidence and escalate for a reviewed recovery design. **Do not unpause the stale copy to recreate the dispatch.**

## Reconcile custody and commissions separately

Reconstruct custody separately for each allowed asset/network/token. Account for all verified deposits, outstanding reservations, external transfers, and relevant post-checkpoint activity. Compare complete observed custody with the ledger's expected custody. Resolve discrepancies and changed deposit evidence while retaining the pause; incomplete provider history is not a successful reconciliation.

Preserve the agreed fee model during recovery. A 500 USDT principal payout delivers the full 500 USDT to the buyer. The buyer and seller commission portions total 2% and are funded separately. Do not reduce principal by commission, silently require a 510 USDT principal deposit, consume another seller's balance, or use principal as the native network-fee reserve. Existing commission debt and its effect on new commitments remain part of the replayed state.

Even a matching reconciliation leaves a restored wallet quarantined. The current engine deliberately provides no automatic or manual-in-API resume path.

## Verification evidence and limits

The earlier standalone recovery suite applies to stores without canonical activation. Run it from the development checkout:

```bash
node node_modules/vitest/vitest.mjs run src/lib/alpha-wallet/backup.test.ts
```

The tests use real local PGlite files and separate source/target directories. They cover exact integer/hash/timestamp preservation; close/reopen quarantine; a stale queued backup whose original provider accepted and finalized a transfer; submitting/unknown/broadcast lookup-only recovery; tamper, truncation, version, checksum, and clock rejection before target writes; existing-target refusal; atomic rollback when the pause write fails; source-projection verification; and permanent pause after matching reconciliation. An acknowledgement-loss regression lets a real restore transaction commit, then injects a synthetic lost response and verifies the same reopened target remains paused and cannot be restored over or dispatched. This does not simulate an actual network partition.

These tests do not establish production backup retention, encryption, authenticated provenance, point-in-time recovery, real chain completeness, power-loss durability, production RPO/RTO, or an independent audit. Native PostgreSQL integration and process-failure tests are separate evidence. Keep those boundaries explicit when reporting recovery readiness.

The coordinator suites and [native coordinator drill](../../scripts/alpha-wallet/postgres-marketplace-coordinator.ts) separately cover shared canonical/wallet transactions, current web authority, typed owner controls, original receipt recovery and rejection of standalone bypasses. The native drill requires three fresh disposable databases; it is not a repair or restore command for an existing enrolled source. [Its 16 native checks passed at `ecc3752`](marketplace-coordinator-verification-2026-11-05.md), alongside the four prior native drills. Those historical results predate combined backup/restore; the [historical combined recovery report](marketplace-recovery-verification-2026-11-05.md) records that protocol and all six rerun drills at `09405da`. The [combined recovery contract](marketplace-recovery-design.md), [manifest tests](../../src/lib/alpha-wallet/marketplace-backup-manifest.test.ts), [database recovery tests](../../src/lib/alpha-wallet/marketplace-backup.test.ts) and [native combined recovery drill](../../scripts/alpha-wallet/postgres-marketplace-backup.ts) cover the separate protocol described above. Its 83 added cases and 11 native checks passed on the exact source recorded in that historical report.

The mobile reader, coordinator/export and source-table recovery suites, together with the [native mobile drill](../../scripts/alpha-wallet/postgres-marketplace-mobile.ts), extend those boundaries to actual stored device sessions and cross-transport recovery. [Exact-source verification at `47f0fc18`](marketplace-mobile-verification-2026-11-05.md) passed 1,203 tests and all seven native drills/66 checks, including 122 added mobile cases and 12 native mobile checks. The drill uses disposable mobile-schema SQL fixtures and contacts no production mobile service. Its successful execution does not authorize live recovery, restored login authority or a resume.

### Native PostgreSQL recovery fixture

`scripts/alpha-wallet/postgres-backup.ts` accepts two explicit, already-created, empty local development databases. The development-branch workflow provisions them inside its disposable PostgreSQL service. The harness itself never creates or drops a database and never reads an application/environment database URL. It checks both targets for freshness before initializing either; the forced-RLS simulation schema requires a superuser or `BYPASSRLS` fixture role.

```bash
NODE_ENV=test node --import tsx scripts/alpha-wallet/postgres-backup.ts \
  --fresh-simulation-databases \
  --source-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_backup_source' \
  --target-connection-string 'postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_restore_target'
```

Those credentials are disposable fixture values. Both database names must start with `alpha_wallet_dev_`, and routing is restricted to exact loopback addresses. A nonempty source or target is refused without dropping data.

The fixture exports a 500-USDT history containing an uncertain 200-USDT withdrawal. It rejects a recomputed-but-inconsistent backup before touching the target, injects an actual SQL error at the quarantine insert and verifies complete rollback, then restores successfully. A new connection verifies the original history and the pause, conservation as 300 available plus 200 held, and original-reference lookup with zero provider submissions. The provider in this harness is an explicit no-network stub; other tests exercise file-provider persistence. Running this script is a separate acceptance gate: record its actual result and source commit rather than inferring a native pass from PGlite tests.

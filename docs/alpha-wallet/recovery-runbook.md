# Alpha Wallet development backup and recovery

## Recovery always starts paused

This runbook applies only to the local **simulation-only** wallet. It does not authorize live deployment, live chain access, signing keys, or real funds.

**Every restored wallet receives a new, durable operator pause in the same database transaction as its restored history.** A restored wallet cannot issue a new dispatch claim, create a listing, reserve a new trade, or request a withdrawal. Matching reconciliation and native-fee readiness do not remove that pause. This implementation has no resume command.

Restoring a ledger does not undo a provider's acceptance of a transfer or a chain settlement. In particular, a backup may show a payout as `queued` even though the original wallet submitted it after the backup. Treat every restored payout as potentially newer outside the backup until independent evidence resolves its status. Never use an old backup to justify another send.

Implementation references: [backup and restore](../../src/lib/alpha-wallet/backup.ts), [verified durable replay](../../src/lib/alpha-wallet/durable.ts), [storage boundaries](../../src/lib/alpha-wallet/durable-store.ts), [payout worker](../../src/lib/alpha-wallet/payout-worker.ts), and [recovery tests](../../src/lib/alpha-wallet/backup.test.ts).

## What the backup contains

The exported JSON uses format `alpha-wallet-simulation-command-backup`, format version `1`, and the recorded wallet engine version. It contains the immutable commands in their original order, their original timestamps, command identities, input/result/state hashes, and the event hash chain. A checkpoint records the final revision, event hash, state hash, and last command timestamp. Amounts retain their original decimal strings or tagged integer representations; they never pass through floating-point currency arithmetic.

Export runs inside one storage transaction. The repository first replays the source history and verifies its SQL journal, entries, payout intents, payout events, and chain-event claims. An inconsistent source cannot produce a backup through this API. The file contains logical command history; it does not contain arbitrary SQL, provider records, credentials, private keys, physical PostgreSQL files, or a complete copy of the surrounding marketplace.

Restore replays that history into a fresh development store using the original command timestamps. Before adding quarantine, it checks that the revision, event hash, and complete state digest match the original checkpoint. The original command rows and event hashes remain unchanged. The final operator-pause command adds one revision and a new state/event hash, which is reported separately from the original checkpoint.

The development format accepts at most **1,000 backed-up commands** and **16 MiB of UTF-8 JSON**. It rejects unsupported engine/format versions and oversized files. It never truncates history to fit. Restore currently reuses the repository command path, which replays earlier commands again as it progresses; these limits do not establish production-scale performance. A history at the command limit may exceed the export limit after its extra quarantine command; reviewed checkpointing/version work is required before exporting such a restored history again.

## Checksums, provenance, and file handling

The SHA-256 checksum and hash chain establish internal consistency. The checksum uses the project's canonical JSON encoding of the parsed document without its `checksum` field. Record the value returned by `inspectWalletBackup`; a separate hash of raw file bytes will have a different meaning and value. These checks do **not** prove who created the backup, whether it is the latest backup, or whether external activity happened after its checkpoint. Someone able to replace the entire file can create another internally consistent history and recompute its checksums. A valid earlier prefix with a rewritten checkpoint is also a different, potentially stale history.

Retain the checksum, checkpoint revision, checkpoint event hash, export timestamp, engine version, and source identification separately from the backup file. Supply `expectedChecksum` during inspection/restore when that separately retained value is available. This comparison is useful only to the extent that the separate record itself is trusted. The module does not implement digital signatures, encryption, independent audit, or a trusted timestamp service.

The JSON is plaintext. Synthetic user identifiers, payment-evidence references, destinations, and command results are included. Keep copies under restricted access and do not attach them to a public issue or paste them into chat logs. The library returns a JSON string and does not choose a filesystem destination, overwrite a file, upload data, or implement a retention policy. A caller that saves a backup should use a new file with restrictive permissions and retain the independently recorded checksum.

Provider fixture records are separate evidence. Preserve their existing directory and identities during an incident. Replacing it with an empty provider fixture would discard the information needed to distinguish accepted transfers from unknown outcomes.

## Incident procedure

1. **Stop new wallet work and fence the original writers.** Stop the explicit simulation worker processes and callers that can write the affected wallet. Record which copy was the active source and which processes were stopped. Restoring a second database does not stop the first one, and this backup module does not implement a cross-instance leader lease or fencing service.
2. **Preserve evidence before making changes.** Record the observed failure, affected payout IDs, provider references, transaction IDs, latest verified revision/event hash, and time. Preserve provider responses/fixture records and relevant application logs. Do not reset dispatch counts, delete payout rows, clear pauses, edit receipt identities, or overwrite the old database.
3. **Inspect the original state if it remains readable.** Use the durable repository's `snapshot()` and `recoverPayouts()`. An integrity failure is a reason to preserve the source for investigation. Do not bypass failed replay or projection checks to make an export succeed.
4. **Select and inspect the recovery copy.** Check its provenance and compare its checksum/checkpoint with the separately retained record. Record the gap between that checkpoint and the incident. Include every potentially submitted payout during that gap in reconciliation, even if the backup reports it as queued or contains no corresponding payout yet.
5. **Prepare a separate fresh development target.** Use a new marked local file-store directory or an explicitly isolated loopback PostgreSQL development database. Use the guarded store factory. Do not use application/production connection strings or environment-derived database URLs. Native fixtures need the deliberately privileged fixture role required by the schema's forced RLS; granting ordinary client roles access is not a restore procedure.
6. **Restore and verify quarantine.** Restore must commit all original commands and the additional pause together. Record both the source checkpoint and the restored checkpoint. Close/reopen the target and verify its state through the repository. Keep the original source fenced and the restored target paused.
7. **Reconcile external evidence while remaining paused.** Apply the payout and balance procedures below. Recording an already accepted transfer's final receipt is accounting for an existing outcome; it is not permission for a new submission.
8. **Document unresolved items and stop.** This development engine has no release-from-quarantine operation. Do not invent an SQL repair or clear `haltReason` manually. A reviewed recovery procedure, genuine authentication boundary, chain/provider verification, and appropriate authorization must exist before any future implementation can release a restored wallet.

## API usage in an offline fixture

The caller creates a guarded `WalletStore` and initializes a source wallet using the existing development APIs. Export does not initialize an unknown source. Restore can initialize a previously absent wallet schema or accept an already initialized store with zero committed commands and no projections. It rejects existing wallet history and unrelated application schemas/public relations; it never drops or replaces them.

```ts
import { exportWalletBackup, inspectWalletBackup, restoreWalletBackup } from "./src/lib/alpha-wallet/backup";

// `source` and `freshTarget` are explicitly created simulation WalletStores.
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

## Guarded local backup CLI

[backup-cli.ts](../../scripts/alpha-wallet/backup-cli.ts) provides an executable local file-store wrapper. Run it from the development checkout with a development/test runtime. All paths must be absolute, their existing directory ancestors must be real directories, and backup reads reject symlinks, nonregular files, invalid UTF-8, and files larger than 16 MiB. A restore requires both the fresh-target flag and a separately retained canonical checksum.

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

## If the commit result is unknown

A connection failure while acknowledging commit does not establish whether the transaction committed. Do not interpret an exception as an empty destination, switch immediately to a second active copy, or bypass the fresh-target guard.

The backup CLI reports `ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN` explicitly when the storage adapter detects this condition. It exits unsuccessfully without claiming rollback and instructs the operator to preserve and inspect the same wallet directory. A generic nonzero exit code alone is never evidence that a restore target is empty.

Close the failed store, reopen that **same target**, and inspect it through the verified repository. If the target is still empty, a fresh restore can be retried after confirming that no prior writers remain. If history exists, verify that it consists of the expected original checkpoint followed by the quarantine pause and that the wallet remains halted. The pause identity is deterministic: operator `backup-recovery`, request ID `restore-<backup checksum>`. Preserve the original backup and expected checkpoint while checking this outcome.

Calling restore again against a committed target rejects it as nonempty. That rejection is not a reason to erase the target. If the observed state is partial, unpaused, inconsistent, or different from the expected backup plus pause, keep the target isolated and investigate. Do not treat a manually observed row count alone as verification; use replay, hashes, and projection checks.

## Reconcile each payout by its original identity

| State in the backup/restored copy | Required recovery handling |
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

Run the bounded recovery suite from the development checkout:

```bash
node node_modules/vitest/vitest.mjs run src/lib/alpha-wallet/backup.test.ts
```

The tests use real local PGlite files and separate source/target directories. They cover exact integer/hash/timestamp preservation; close/reopen quarantine; a stale queued backup whose original provider accepted and finalized a transfer; submitting/unknown/broadcast lookup-only recovery; tamper, truncation, version, checksum, and clock rejection before target writes; existing-target refusal; atomic rollback when the pause write fails; source-projection verification; and permanent pause after matching reconciliation. An acknowledgement-loss regression lets a real restore transaction commit, then injects a synthetic lost response and verifies the same reopened target remains paused and cannot be restored over or dispatched. This does not simulate an actual network partition.

These tests do not establish production backup retention, encryption, authenticated provenance, point-in-time recovery, real chain completeness, power-loss durability, production RPO/RTO, or an independent audit. Native PostgreSQL integration and process-failure tests are separate evidence. Keep those boundaries explicit when reporting recovery readiness.

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

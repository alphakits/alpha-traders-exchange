# Combined marketplace and wallet recovery

Date: 5 November 2026 (Asia/Jerusalem). Scope: the private **simulation-only canonical cohort**. No live launch, production migration, provider, signer, account signup or external delivery is authorized by this implementation.

## Recovery unit and supported state

An enrolled marketplace trade cannot be recovered from the earlier wallet-only JSON formats. Its canonical request/listing, wallet reservation, original acceptance receipt, system message, notification/audit records and publication intent describe one financial event. Restoring only the ledger would leave the application and its evidence behind.

The combined format recovers the existing bounded cohort: one clean, already reserved nonterminal trade globally, its only active canonical listing reservation, current ILS policies, and Bank Transfer or Face-to-Face. The stored amount correction may still be pending or may already have been accepted. The source must have an owner pause and no unfinished payout. The complete mixed v1/v2 wallet history remains part of the bundle; no old engine semantics, command identities, event hashes or timestamps are rewritten.

This is an explicit fixed development schema. It is not a dump/import utility for a production marketplace database. Additional or missing canonical/coordination tables and columns, unsupported types/nullability and unrelated namespaces are refused. The general marketplace's three-active-trades-per-seller policy remains separate from this deliberately narrow recovery cohort.

## What is included

| Component | Treatment |
| --- | --- |
| Mixed wallet history | Original strict v2 backup envelope, including the unchanged v1 prefix, explicit continuation, command/result/state/event hashes and source checkpoint |
| Canonical financial/application rows | All rows from the supported runtime metadata, requests, listings, trades, commissions, trust snapshots, evidence, disputes, notifications, audit logs and activity logs tables |
| Identity references | Only each user's ID, role and seller status; original user profile and authentication material are excluded |
| Coordination history | Exact immutable enrollment, acceptance and safe publication records |
| Operational transaction registrations | Excluded; transaction IDs from a different database must never become current transaction authority |
| Sessions and passwords | Excluded; restore creates no session and never restores an original password hash |
| SQL and provider state | No SQL supplied by the file is executed. No provider/custody records, network credentials or signing material are included |

Canonical financial payloads can contain private payment instructions, destinations, user names and trade history. The bundle is **private plaintext**, even though credentials are excluded. Public inspection results contain only IDs, checksums, checkpoints and counts; errors omit driver parameters and private causes. The library returns bytes as a string and does not choose a path, overwrite files, upload data or implement retention/encryption.

All PostgreSQL `timestamptz` values are serialized as UTC strings with six fractional digits. This preserves native microseconds, including runtime metadata written using `now()`. Original JSON payload timestamps remain unchanged. A database-side JSONB roundtrip comparison rejects retained values that would lose numeric precision in JavaScript. Bigint runtime versions and monetary raw units remain decimal strings, never floating-point currency values. Row ordering is deterministic across database collations.

The development limit is 16 MiB of UTF-8 JSON, 1,000 backed-up wallet commands, at most 1,000 rows per supported table and 10,000 captured rows in total. Oversized histories are refused, never truncated. These bounds do not establish production throughput, recovery time or recovery-point objectives.

## Export: actual owner authority and a paused source

`exportMarketplaceWalletBackup` takes an explicit guarded `WalletStore`, a stored owner web-session credential, the enrolled canonical request ID and an optional trusted fixture clock. It does not accept caller-supplied roles, an authentication callback or a fabricated financial snapshot.

The existing focused marketplace participant acquires its request/global/runtime locks in the same order as the coordinator. The fixed reader then locks and verifies the actual session/account rows. A fresh inspect context permits verified wallet replay inside that transaction. Export requires the wallet to be paused, checks SQL coherence, captures the complete supported canonical and coordination state, constructs the nested wallet backup and revalidates the exact serialized bundle. Owner authority/expiry are checked after awaited work and after focused persistence.

Source export does not clear a pause, append another financial command or deliver a notification. Internal head lock versions and transaction registrations can advance. Account revocation is ordered by the existing row locks, with the same documented checkpoint/COMMIT timing limits as the private coordinator.

Requiring the source pause prevents this cohort from accepting new financial work after the checkpoint through its supported APIs. It is not a cross-database leader lease. The operator must still identify and fence every source/caller; a checksum cannot discover an independently active copy.

## Validation before touching a destination

The envelope has a dedicated format/version/schema identifier and a canonical SHA-256 checksum. Strict schemas reject unknown fields, unsupported versions, malformed timestamps, duplicate identities and oversized content. The nested wallet history is replayed and its original checkpoint/continuation checked. Validation compares canonical identities/current terms and principal inventory with the verified wallet, enrollment and acceptance commands, retained fingerprints, original event hashes, deterministic messages/events and publication intents.

Inspection is pure: it opens no database transaction. Restore repeats validation of the actual supplied bytes and requires a separately retained expected checksum before accessing the target. A previously obtained inspection object cannot authorize different bytes.

Checksums and hash chains establish internal consistency, not origin, recency or a trusted timestamp. An attacker who can replace an entire bundle and the independently retained checksum can construct another internally consistent history. Signed provenance, encrypted retention, independent custody evidence and production permissions remain separate work.

## Atomic fresh-target restore

`restoreMarketplaceWalletBackup` requires `acknowledgeFreshTarget: true`, the expected checksum, an explicit guarded development target and a valid restore clock at or after export. It refuses any existing application namespace, even an empty initialized wallet, as well as unrelated public/temporary/extension objects. It does not drop, overwrite, clear or repair an existing database.

One outer writable SERIALIZABLE transaction owns every step:

1. Certify that the target is fresh and retain a same-transaction capability; a remembered boolean is insufficient.
2. Initialize the original v1 schema, replay every original command at its recorded time, perform the exact stored v2 continuation and replay the v2 tail.
3. Verify the original source checkpoint, then append a new v2 pause with operator `marketplace-backup-recovery` and request ID `restore-<combined checksum>`.
4. Create the fixed canonical schema, restore its financial rows and disabled identity stubs, then load immutable coordination records. No old transaction registration is imported.
5. Install the same coordination guard definitions used by ordinary enrollment. No existing source trigger is disabled or bypassed; the target was previously empty.
6. Register one fresh inspect context, verify full wallet projections and marketplace coherence, compare restored row digests and verify credential quarantine.
7. Complete the immutable recovery receipt, then commit all schemas, records and the new pause together.

The original source checkpoint is returned separately from the new target checkpoint. If the source contains N commands, the successful recovered target contains N+1. Recovery does not accept a proposal again or append a second trade acceptance, message, notification, audit or publication.

A recovery-only bootstrap row starts with an incomplete receipt. A deferred database constraint prevents COMMIT until the receipt is completed in that same original transaction. Omitting the final receipt, swallowing a participant rejection or failing after late canonical writes must abort the whole operation. Once completed, the receipt cannot be replaced, deleted, truncated or completed again through the supported schema.

## Identity quarantine and supported target access

Restored users are exact disabled, credential-free identity stubs that preserve references and historical role labels. Their email is a synthetic recovery placeholder, email verification is false, and no original profile, phone evidence, password or session is copied. This deliberately prevents a backup from reviving a revoked login. It is not a restoration of platform accounts or a permission to recreate authority from old role labels.

The recovered target remains paused and its enrolled-listing/wallet guards remain active. Source owner/buyer credentials cannot log in to it. Standalone snapshots, wallet-only export, payout workers and unsupported lifecycle writers stay blocked. No resume or account-authority re-entry function is provided. A future reviewed identity recovery protocol is required before reconnecting actual accounts.

`inspectRestoredMarketplaceWallet` is an **offline recovery diagnostic** that requires the explicit guarded database capability and separately retained checksum. It grants no web/mobile account authority. It returns safe metadata only after verifying the immutable receipt, complete original history, exact final pause, current canonical/coordination digests, SQL coherence, empty sessions and exact disabled identity stubs. Operational inspect registrations may advance; financial history and acceptance records do not.

## Unknown COMMIT outcomes

A lost COMMIT response is not evidence of rollback. The storage adapter preserves `ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN`; the public boundary sanitizes its private underlying cause without changing that classification.

Preserve and close the failed connection, reopen **the same target**, and use the recovery diagnostic with the separately retained checksum. A matching verified receipt proves the target contains the expected source history plus its quarantine. Re-running restore against that committed target is refused as nonempty. Never delete a target or choose a new active copy merely because a response was lost.

If the target is genuinely empty, a fresh restore may be retried after confirming the failed writers are stopped. Missing, partial, unpaused, credential-bearing or inconsistent state remains an investigation, not an automatic resume decision. A successful diagnostic does not establish external provider/chain state.

## Explicit development API

```ts
const serialized = await exportMarketplaceWalletBackup({
  mode: "simulation-only", store: pausedSource,
  requestId: enrolledRequestId, sessionToken: validOwnerSession,
  clock: trustedFixtureClock,
});
const inspected = inspectMarketplaceWalletBackup(serialized);
// Save the private bytes with restricted access and retain this checksum separately.

const result = await restoreMarketplaceWalletBackup({
  mode: "simulation-only", store: freshTarget, backup: serialized,
  acknowledgeFreshTarget: true, expectedChecksum: separatelyRetainedChecksum,
  clock: trustedRestoreClock,
});
// result.quarantined is true only after the outer transaction commits.

const verifiedOutcome = await inspectRestoredMarketplaceWallet({
  mode: "simulation-only", store: reopenedSameTarget,
  expectedChecksum: separatelyRetainedChecksum,
});
```

The existing standalone CLI remains v1-only. It is not automatically extended by this module. No production route, scheduled service or backup destination is configured.

## Verification and remaining work

The implementation has pure manifest tests, real local database fault/reopen tests, and a separately executable native PostgreSQL drill at [postgres-marketplace-backup.ts](../../scripts/alpha-wallet/postgres-marketplace-backup.ts). The native harness requires three pre-created, empty, explicitly named loopback development databases and checks all three before writing to any. It covers late SQL failures, real commit with a synthetic lost response, unchanged canonical/ledger records, credential and writer refusals, and competing restores.

Executed results must be recorded against the exact source commit. A synthetic acknowledgement-loss injection after a real COMMIT is not a physical network partition; local file tests are not evidence of native PostgreSQL interleavings. No passing test proves absence of every bug.

This milestone does not close production recovery. Combined external provider/chain reconciliation, authenticated provenance, encryption/retention, production role/schema compatibility, identity re-entry, cross-instance source fencing, capacity/recovery objectives, controlled resume and independent review remain required. Initial trade acceptance, the remaining marketplace lifecycle, actual UI/mobile integration and live custody/signing remain outside this recovery change.

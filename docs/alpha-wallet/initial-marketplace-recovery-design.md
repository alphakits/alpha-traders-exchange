# Initial marketplace and v3 wallet recovery

Date: 5 November 2026. Scope: the private **simulation-only initial marketplace cohort**.

**Implemented development contract:** authenticated export of an activated, paused initial cohort; pure validation of its complete recovery unit; atomic restore into a fresh isolated target; and offline inspection of a retained or uncertain restore outcome. This addition passed [exact-source verification at `2c3e6a0b`](initial-marketplace-recovery-verification-2026-11-05.md). The [earlier coordinator evidence](initial-marketplace-verification-2026-11-05.md) remains evidence for its recorded source, not a verification result for this recovery implementation.

No production migration, public web/mobile route, account signup, provider operation, signing operation or external delivery is installed. This contract supplies no account-authority re-entry or resume. Follow the [recovery runbook](recovery-runbook.md#initial-canonical-cohort-inspect-pause-export-and-restore) for the operational sequence.

## Separate format and supported source

The [initial coordinator](initial-marketplace-coordinator-design.md) binds a canonical request, listing and preallocated trade identity to a seller-native v3 reservation. Its immutable activation basis, original buyer evidence, financial receipt, canonical acceptance events and publication intent must survive together. A wallet-only file cannot represent that recovery unit.

| Field | Required value |
| --- | --- |
| Outer `format` | `alpha-wallet-initial-marketplace-simulation-backup` |
| Outer `formatVersion` | `1` |
| Outer `schemaVersion` | `canonical-initial-cohort-v1` |
| `mode` | `simulation-only` |
| Nested wallet `format` / `formatVersion` | `alpha-wallet-simulation-command-backup` / `3` |
| Nested wallet `scope` | `initial-marketplace-v3-ledger` |
| Nested wallet `engineVersion` | `alpha-wallet-simulation-v3` |
| Nested wallet `sourcePaused` | `true`, verified against replay |

The outer envelope also retains the canonical request ID, authenticated exporting owner ID, export timestamp, canonical and coordination rows, and its checksum. The nested wallet retains its own checksum, source checkpoint, original v2 continuation, original v3 initial continuation and complete ordered command history.

Supported sources have exactly one explicit initial activation and are paused either before seller acceptance or after the one original coordinated seller acceptance. The original canonical physical trade may have been absent or present as the matching pending projection. The same supported listing-price ILS Bank Transfer or Face-to-Face cohort applies; the manifest does not broaden the initial coordinator's eligibility or financial lifecycle. Prior target payment, commission, dispute or later settlement progress, competing target-listing reservations and unfinished payouts are refused.

An initialized initial namespace without an activation has no supported bundle. The earlier pause-only initial mechanics fixture is also outside this contract. The isolated-v3 format and [original v2 amount-correction combined format](marketplace-recovery-design.md) retain their existing scope and continue to reject this initial-cohort namespace. None of their formats, historical command schemas, reducers or event hashes is reinterpreted.

## Complete retained recovery unit

| Component | Retained representation |
| --- | --- |
| Financial history | Every original v1, v2 and v3 command in order, including command identity, recorded clock, original result, input/result/state hashes, previous event hash and event hash. Both explicit continuations and the exact source checkpoint are retained. |
| Canonical rows | Every supported row from `runtime_meta`, `listings`, `purchase_requests`, `trades`, `commissions`, `marketplace_enforcement_records`, `evidence`, `disputes`, `notifications` and `audit_logs`, including normalized columns, original JSON payloads and ordering scalars. |
| Identity references | `users` retains only `id`, `role`, `seller_status`, `created_at`, `updated_at` and `sort_index`. Original account profiles, email, availability, online state and authentication material are excluded. |
| Initial coordination | Exact `activations`, `acceptances` and `publications` rows, including the original activation checkpoint/basis, full seller acceptance descriptor and receipt, canonical result, event linkage and publication identity. |
| Binary evidence | Original nullable `bytea` content as canonical unwrapped base64, with retained metadata and byte length. |
| Operational context | Old transaction registrations and any previous recovery receipt are excluded. A transaction ID from another database never becomes authority on the target. |
| Credentials and external state | No web/mobile sessions, device credentials, refresh history, passwords, external provider database/custody state or signing material. Historical provider references/results already recorded in original v1/v2 command history remain retained for replay. No SQL from the file is executed. |

The initial canonical shape includes enforcement records and binary evidence. It is distinct from the older correction fixture's trust/activity tables. Supported unrelated canonical records are captured as well as the selected request, so the bundle does not silently reduce the database to one trade.

The source allows either neither mobile authentication relation or the exact known pair, `mobile_device_sessions` and `mobile_refresh_token_history`. Their relation kinds, columns, PostgreSQL types and nullability are checked; their rows are never selected for the bundle. Partial or malformed pairs are refused. The storage layer checks exact canonical and initial-coordination table sets and column shapes, including required source authentication tables. It also refuses unrelated namespaces and unsupported public, temporary, extension and event-trigger objects. Wallet verification uses the existing complete history/projection checks; it does **not** inventory every arbitrary relation, function or other object that could be added under `alpha_wallet_simulation`. This is a fixed application recovery contract, not a general omission-free database dump.

### Lossless timestamps, integers and JSON

Physical `timestamptz` columns use UTC strings with exactly six fractional digits, preserving native microseconds. The immutable activation basis retains the original PostgreSQL JSON spelling: `+00:00`, no fraction for whole seconds, and a nonzero fraction with trailing zeros removed. For example, physical `2027-01-15T08:00:00.100000Z` corresponds to retained basis text `2027-01-15T08:00:00.1+00:00`. The parser requires those representations and compares their full microsecond values; it never rewrites the original basis or JSON payload timestamps.

Export, restore and restored-target inspection require a UTC transaction timezone. The accepted fixed-zero names are `UTC`, `Etc/UTC`, `GMT`, `Etc/GMT` and `Etc/GMT0`. Configure the source connection before its activation is created and configure the recovery target likewise. Changing the current timezone does not convert a previously retained non-UTC activation basis into supported evidence. Do not edit that basis to make it fit the format.

Runtime `bigint` versions and raw monetary units remain decimal strings. A database-side JSONB roundtrip comparison rejects captured values that JavaScript parsing would round, including values inside unrelated financial payloads and immutable coordination evidence. Capture orders identities using the database's `C` collation and retains each original `sort_index`. Base64 decoding restores the exact original evidence bytes; it is not a text conversion.

The fixed limit is **16 MiB of UTF-8 JSON, at most 999 source wallet commands, at most 1,000 rows per captured table and 10,000 captured rows in total**. The source-command limit reserves the thousandth slot for the mandatory new recovery pause. Oversized recovery units are refused without truncation.

## Authenticated export from a paused source

The [private API](../../src/lib/alpha-wallet/initial-marketplace-backup.ts) exposes two fixed owner entry points:

| API | Required inputs and result |
| --- | --- |
| `exportInitialMarketplaceWalletBackup` | Explicit guarded source `WalletStore`, `mode`, canonical `requestId`, current stored owner `sessionToken`, optional trusted fixture `clock`; returns private JSON. |
| `exportMobileInitialMarketplaceWalletBackup` | The same source/request/clock with current stored owner `accessToken` and strict `metadata: { deviceId, platform, appVersion, locale }`; returns the same format. |
| `inspectInitialMarketplaceWalletBackup` | Supplied JSON and optional separately retained `expectedChecksum`; returns safe metadata after pure validation. |
| `restoreInitialMarketplaceWalletBackup` | Explicit fresh guarded target, actual JSON, `acknowledgeFreshTarget: true`, mandatory separately retained `expectedChecksum`, optional trusted restore `clock`; returns distinct source/restored checkpoints and `quarantined: true` after COMMIT. |
| `inspectRestoredInitialMarketplaceWallet` | Explicit guarded target and mandatory separately retained `expectedChecksum`; verifies the retained outcome and returns safe receipt/checkpoint metadata. |

Export first takes the initial participant's canonical locks, then resolves the selected actual stored owner credential. Web and mobile use their fixed session/account readers. Mobile also verifies device/platform binding, current access token and minimum app version; a refused mobile credential never falls back to web. Caller-provided roles or authorization callbacks are not accepted.

A fresh same-transaction inspect registration permits verified v3 replay. Export checks the paused state, original initial coherence, complete supported row capture and the newly serialized manifest. It rechecks current owner authority and expiry after awaited work and after the canonical participant returns. Stored role arrays may establish current owner authority even when the preserved scalar role label is different; the backup retains identity labels without turning them into target account authority.

For the same source state, authenticated owner and export clock, the web/mobile paths select the same financial bytes. Export leaves the canonical financial records, original command history and source pause unchanged. Internal wallet lock versions and operational inspection registrations can advance. No acceptance, notification, audit event or publication is added or delivered by export.

Authentication locks order revocation in the same way as the initial coordinator. The transaction owner retries the complete operation after a serialization failure or deadlock, deriving fresh authority on each attempt. Expiry is checked at the documented boundaries; no claim is made that a COMMIT acknowledgement must arrive before the expiry timestamp.

## Pure validation before destination access

The [manifest parser](../../src/lib/alpha-wallet/initial-marketplace-backup-manifest.ts) bounds bytes, rows, commands and JSON nesting, rejects unknown envelope/row fields and credential material, verifies outer and nested checksums, and replays the complete original history using the unchanged engines. It checks both continuations, paused replay state and exact checkpoint.

Validation independently links the activation fingerprint and original checkpoint to its pending request/listing/trade/sibling basis. For an accepted source it links the seller actor, acceptance command at the next revision, original buyer submission evidence, retained financial terms and principal, command result/event hash, immutable binding/receipt and public-input fingerprint. It reconstructs the permitted canonical acceptance and its deterministic timeline, notification, audit and publication, then compares the actual retained rows. An activated-only source must still match its complete original basis. The final post-activation history is restricted to the supported acceptance and operator pause commands.

Inspection opens no database. Restore validates the actual supplied bytes and mandatory expected checksum before opening its target transaction; passing a previous inspection result cannot substitute different bytes. Public metadata contains IDs, checksums, checkpoints and counts, not private canonical snapshots or payment instructions. Unknown parser, replay and driver failures are sanitized at their public boundaries.

Checksums establish internal consistency and agreement with a separately retained value. They do not authenticate the creator, prove freshness, or discover activity in another copy. A party able to replace a whole bundle and its trusted checksum can construct another internally consistent history. The JSON remains private plaintext because retained financial payloads contain payment instructions, destinations and trade history. File selection, encryption, restricted storage and retention are caller responsibilities; no backup destination or scheduled service is configured.

## One atomic fresh-target restore

The [recovery store](../../src/lib/alpha-wallet/initial-marketplace-recovery-store.ts) requires one writable SERIALIZABLE simulation transaction with a certified physical transaction ID. Its advisory restore claim orders competing attempts. A fresh target must have no application namespace, including an empty initialized wallet, and must pass the public/temporary/extension object restrictions. Restore never drops, clears or overwrites an existing target.

The outer `WalletStore` alone owns BEGIN, full retry and COMMIT:

1. Certify the empty target inside that physical transaction and retain the private bootstrap capability.
2. Initialize v1, replay every original v1 command, execute the exact stored v2 continuation and v2 history, then execute the exact stored v3 continuation and v3 history at their original clocks.
3. Verify the original source checkpoint and append exactly one new v3 operator pause. Its actor is `initial-marketplace-backup-recovery`; its request identity is `restore-<outer checksum>`.
4. Install the fixed canonical schema and exact original financial rows, replacing only excluded user profiles with disabled identity stubs. Install original initial activation, acceptance and publication rows. Do not import old transaction contexts.
5. Attach the unchanged initial-coordination guards and the recovery-only quarantine fences from the checked-in SQL. The target was empty; no source guard is removed or bypassed.
6. Register a new inspect context, verify wallet projections and canonical/initial coherence, verify credential quarantine, and compare recaptured row digests with the selected bundle.
7. Complete the recovery receipt once in the original bootstrap transaction, binding both checkpoints, the checksum, row digests, restore clock and quarantine command key. Commit the entire unit together.

The original N commands remain exact; the target has N+1 commands. The original acceptance and its canonical events/publication are restored without creating a second financial effect. The result reports the N-command source checkpoint separately from the N+1 recovered checkpoint. The original source remains unchanged and paused throughout target recovery.

A deferred receipt constraint refuses an incomplete bootstrap and validates the original paused prefix, exact new pause, required inspection context and identity quarantine. Canonical statement fences reject subsequent insert/update/delete/truncate operations, even no-row writes, and the wallet rejects further commands. A later bootstrap head update requeues its deferred receipt check after an earlier explicit constraint check. Cleanup uses only the certified raw transaction identity, so a swallowed runtime or semantic refusal cannot leave prior writes committable; an unknown or replaced transaction is never deliberately poisoned. Known failure rolls back schema installation, replay, canonical rows, guards, receipt and pause together.

These row/statement/deferred guards are not a defense against a hostile database superuser. In particular, arbitrary privileged DDL after deliberately flushing all deferred events is outside the guarantee. They do not promise to detect every late schema change after `SET CONSTRAINTS ALL IMMEDIATE` when no guarded event remains. Production DDL roles and independently owned final validation are separate work.

## Disabled identities and offline inspection

Recovered users preserve their six selected identity/chronology/order scalars and receive exact synthetic profiles: disabled, unverified email, an `example.invalid` placeholder, availability `away` and online state `offline`. Original password hashes, phones, user role arrays, verification evidence and profiles are absent. The web sessions table remains empty, and neither mobile authentication relation is created. Ordinary deferred completion checks their absence again, including empty mobile relations added after application validation while checks remain pending.

Recovered canonical rows are sealed, and only fresh unbound inspect contexts are allowed. Source credentials cannot log in. Historical role labels cannot grant account authority. Standalone wallet reads/writers, payout workers, new seller acceptance and later marketplace lifecycle operations are not recovery access paths. Even an additional owner pause is outside the sealed target contract; the mandatory recovery pause is already durable.

`inspectRestoredInitialMarketplaceWallet` is an offline diagnostic for the explicit guarded database capability and checksum, not a web/mobile route. It verifies the complete original prefix, exactly one checksum-bound pause, current halted checkpoint, immutable recovery receipt, canonical/coordination digests, common coherence and exact identity quarantine. It returns safe metadata. Operational inspect registrations and lock versions may advance; financial history and canonical records remain unchanged.

## Unknown COMMIT and source fencing

`ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN` preserves uncertainty while hiding the private underlying driver cause. A missing acknowledgement does not establish rollback. Retain the bundle, independently recorded checksum, source checkpoint and exact target identity; close the failed connection and reopen **that same target** for `inspectRestoredInitialMarketplaceWallet`.

A matching diagnostic verifies the expected source history plus its single quarantine. Another restore against that committed target is refused as nonempty. A missing receipt alone does not prove emptiness, and a nonempty refusal is not permission to delete state. Partial, inconsistent, unpaused, credential-bearing or differently checksummed targets remain isolated for investigation. Retry a fresh restore only after confirming the same target is genuinely empty and prior writers have stopped.

Keep the source fenced and both copies paused. The protocol does not supply a cross-instance lease, stop another process/database, transfer custody ownership or discover a newer independent source. Account-authority recovery and a reviewed source-fencing/resume design remain prerequisites for any future active re-entry.

## Verification and remaining boundaries

The added [manifest tests](../../src/lib/alpha-wallet/initial-marketplace-backup-manifest.test.ts), [API/recovery tests](../../src/lib/alpha-wallet/initial-marketplace-backup.test.ts), [preservation tests](../../src/lib/alpha-wallet/initial-marketplace-recovery-preservation.test.ts) and [transaction-cleanup regressions](../../src/lib/alpha-wallet/recovery-transaction-cleanup.test.ts) cover the new contract. The separate [native PostgreSQL drill](../../scripts/alpha-wallet/postgres-initial-marketplace-backup.ts) requires four already-created, empty, explicitly named loopback development databases: accepted source, activated-only source, restore target and competing-restore target. It validates all four before initializing fixtures. It never creates/drops databases or reads an application connection URL.

The harness exercises both source states, current web/mobile owner export, retained evidence, atomic failure, late quarantine refusal, competing fresh-target claims, actual COMMIT followed by injected reply loss, and same-target reopen. Record actual executed results against the exact source commit. The recovery addition passed [exact-source verification at `2c3e6a0b`](initial-marketplace-recovery-verification-2026-11-05.md), including the full retained suite and its own native drill; older reports remain evidence for their original source. A synthetic acknowledgement failure after a real COMMIT is not a physical network partition, and PGlite coverage is not native PostgreSQL concurrency evidence.

This implementation captures and verifies the whole retained history. Restore uses the normal command path, which repeats earlier history/projection work as replay proceeds. The fixed bounds do not establish production-scale throughput, memory use, RPO or RTO. Reviewed checkpointing and explicit version evolution are required before expanding beyond them.

External chain/provider reconciliation, custody/signing, authenticated backup provenance, encrypted retention, production schema/role compatibility, independent review, authority re-entry, source fencing and controlled resume remain open. The remaining payment/release/dispute/settlement participants, website/mobile product integration and explicit live-launch authorization remain separate [readiness gates](launch-readiness.md).

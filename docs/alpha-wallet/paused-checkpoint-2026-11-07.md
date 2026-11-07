# Alpha Wallet — paused development checkpoint, 2026-11-07

## Status

The user explicitly requested: **“stop and save for now.”** Development stopped immediately. This is an **unfinished work-in-progress checkpoint**, not a verified release or a production-readiness claim. No live deployment, migration, signer/provider activation, real-funds operation or main-branch change was performed. The development branch remains deployment-disabled.

Branch: `feature/alpha-wallet-dev-20261104` in `alphakits/alpha-traders-exchange`.

This checkpoint follows `343cb147a0e6c64423dd00fed1cfe6d148fa86e8` (tree `37e6244dc7a5af42304ffdc356e9ec95dfa6112d`). The last fully verified implementation remains `6c06159b12c6c23fd51cdd8eb4dba7745aff54cb` (tree `23c6ca3b1bc4d381766af79fe00940531c8239af`), with the reports saved in the parent checkpoint. Its successful CI run was `42327193683`, job `128265095861`: 4,104 passing occurrences in 95 files, 21 native PostgreSQL drills and 277 ordered native checks. **Those results do not certify this new unfinished work.**

The WIP save intentionally uses `[skip ci]`; the requested pause does not initiate a fresh long-running CI cycle. A new full verification run is required after resuming and completing the implementation.

## Scope of the work in progress

A same-database, nonauthoritative **V5 release-consent overlay** is being added. It retains the original V1–V5 financial and canonical behavior. No V6 transition is introduced. A seller may record or revoke consent tied to the exact original trade, accepted terms, buyer claim, current synthetic payment-source revision, wallet checkpoint, canonical decision basis and seller account commitment.

Current matching is derived, never stored as a reusable `ready: true`. A source reversal/conflict quarantines; a new source revision invalidates earlier consent. The unchanged V5 buyer dispute and owner pause advance the wallet basis and invalidate matching. Every inspection and receipt carries `executionAuthority: false` and `releaseAuthority: false`. There is no payout intent, transfer, dispatch, settlement or irreversible evidence consumption.

The fixed current stored web/mobile readers authenticate the real seller or current owner. Owner authority cannot substitute for the retained seller's consent. Source ingestion is owner-only and takes server-owned prepared synthetic-reader evidence. Source authority IDs must be independent from all current platform accounts. Consent expiration is bounded by the source's admission/freshness deadlines and the original seller session expiry. An exact retry retains its original expiry even if authenticated using a newer session.

All new files remain private development components; they are not connected to a public product route.

## Files preserved

### Independently frozen V5 predecessor

- `scripts/alpha-wallet/capture-v5-history-fixture.ts`
- `src/lib/alpha-wallet/fixtures/v5/`: twenty fixed history/state/stopped-backup/retry artifacts plus provenance.
- `src/lib/alpha-wallet/v5-frozen-predecessor.test.ts`

Five variants: accepted without a claim, claimed, disputed, cancelled archival and inherited-paused. Each retains the original unknown withdrawal with a single dispatch and retries that suppress another dispatch. The provenance pins **197 predecessor source/dependency files**, including the original 75-file contract, V4/V5 and combined recovery dependency closure, SQL, old fixtures, source-evidence/range modules and runtime scripts. Provenance SHA-256: `c935cfe894fde1c8cdaac88aaf6efc9d2937dc9dcd96f1d95f16bf7b3d4b93ae`.

### New model and fixed authority

- `src/lib/alpha-wallet/release-consent-model.ts` and `.test.ts`
- `src/lib/alpha-wallet/release-consent-auth.ts` and `.test.ts`
- `docs/alpha-wallet/release-consent-model.md`

The model replays immutable source observations and consent records, preserves negative evidence, reserves terminal capacity and supports stopped-source backup/permanent restored quarantine. It reuses the old pure source-journal semantics without modifying those files.

### Integration and recovery drafts

- `src/lib/alpha-wallet/release-consent-coordinator.ts`
- `src/lib/alpha-wallet/release-consent-transaction.ts`
- `src/lib/alpha-wallet/release-consent-store.ts`
- `docs/alpha-wallet/release-consent-schema.sql`
- `src/lib/alpha-wallet/release-consent-recovery-rows.ts`
- `src/lib/alpha-wallet/release-consent-backup-manifest.ts`
- `scripts/alpha-wallet/release-consent-fixtures.ts`
- `scripts/alpha-wallet/postgres-release-consent.ts`

**Not written yet:** `release-consent-backup.ts`, storage/coordinator/complete-backup integration tests, storage documentation, and native CI workflow wiring. The native proof imports the missing backup module, so this is not expected to be a clean whole-tree TypeScript checkpoint.

## Verification actually completed

| Area | Result at the pause |
| --- | --- |
| Fixed V5 compatibility | **24/24 passed**, including stopped backup restore/reopen and historical retry preservation. Owned-file ESLint passed. |
| Fixed release-consent authority | **39/39 passed** in UTC, including web/mobile roles, account gates, identity checks, inert credential capture, late expiry, transaction replacement and swallowed-failure rollback. |
| Pure model, first complete run | **58 passed / 3 failed of 61**. Failures exposed a lost private derived-source cache after inert backup capture. |
| Pure model, after cache fix | Targeted run: **2 passed / 1 timeout / 58 skipped**. The capacity case hit its default 5-second limit after approximately 75 seconds; no failed assertion was reported. |
| Pure model after timeout adjustment | An explicit 180-second timeout was added. The fresh full rerun was **cancelled on the stop instruction**, exit 130. No clean complete result is claimed. |
| Pure-model TS-file ESLint | Passed. |
| Whole-tree TypeScript | Earlier checks passed before the integration files existed; later checks encountered the still-missing integration/backup module. The last in-flight check was cancelled. **No final clean integrated result.** |
| Scratch PGlite core lifecycle smoke | Provisionally passed: 8 overlay records, 2 consents, source revision 2 retained after stale revision 1, exact mobile retry/reconciliation, original V5 dispute and pause only, accounts/journal/payouts unchanged. This ran before SQL guards were complete and is not storage-readiness evidence. |
| Storage/SQL enforcement tests | **None completed; test file not yet written.** |
| New native PostgreSQL proof | **Not run.** No local native server binaries were available. |
| New full regression / exact-commit CI | **Not run.** |

## Known blockers to resolve first on resumption

1. **Finish SQL enforcement before treating integration success as meaningful.** The schema currently has canonical/review digest reconstruction, tables, immutable transaction-context triggers, prepared-history checks and an independent `replay_state` function. It is still missing head and record insert/update/delete/truncate guards, deferred completeness triggers, and independent SQL enforcement of recovery metadata. `replay_state` is not yet connected to enforcement triggers. Add actual adversarial storage tests and review the replay function against the model's history-extension behavior.
2. **Fix the final awaited freshness boundary.** The coordinator currently invokes `finalize()` before `withReleaseConsentTransaction()` performs its final awaited `assertOwner()` query. A session/source deadline could pass across that final await. Defer the synchronous finalizer until after all awaited transaction checks, validate `clock() < principal.sessionExpiresAtMs` for every result, and recompute inspection/new-consent matching there without another await. Add a delayed-final-certificate regression case.
3. **Complete whole-bundle recovery.** The manifest and exact extended-scope canonical row reader are drafts. Implement `release-consent-backup.ts` and the coordinator's authenticated export path. Both original V5 and overlay must be durably stopped. Preserve complete canonical/financial/source/consent history and credential-free quarantine. Do not hide/filter the new namespace to make the frozen old exporter accept it.
4. **Handle large serialized backup results deliberately.** The generic transaction result capture currently uses `captureInboxData`, whose single-string ceiling is 1 MiB. Complete backup JSON can exceed that. Keep bounded inert validation while avoiding an accidental smaller single-string export limit.
5. **Complete and run focused tests, native PostgreSQL races/recovery, then full exact-commit CI.** Only then update development-verification results/readiness claims.

## Integration contracts to resume

The factories are `createDevelopmentReleaseConsentCoordinator` and `createDevelopmentMobileReleaseConsentCoordinator`, with `{mode: "simulation-only", store, sourceStoreId, manifest, clock}`. Methods currently implemented: `enroll`, `observe`, `consent`, `revoke`, `pause`, `inspect`, `receipt`, `reconcile`. All public transport input is closed inert data; the fixed server resolves actor authority. Mutation results include the original model receipt, replay flag, logical source label and generated persistent physical installation ID. A missing receipt is unresolved, never proof of nonexecution.

The canonical basis digest is exactly:

```ts
walletDigest({
  kind: "alpha-wallet-release-consent-canonical-basis-v1",
  basis: participant.basis,
  sellerAccount: sellerAccountRow,
})
```

The account row comes from `SELECT to_jsonb(account) AS seller_account FROM alpha_exchange.users account JOIN alpha_exchange.purchase_requests request ON request.seller_id=account.id WHERE request.id=$1 FOR SHARE OF account`. The SQL independently reconstructs this basis. Raw credential/account data is not retained in consent evidence; only its commitment is retained.

Lock order remains canonical request/global/runtime/listing fences, fixed stored authentication, unchanged opaque V5 `inspect` context using the actual actor, V5 wallet head, then overlay singleton. No V5 command is bound to that inspect context. Every child operates in the same certified writable SERIALIZABLE transaction in UTC, with same-owner rollback on failure and full-decision retries for serialization/deadlock errors.

Store exports are `loadReleaseConsentOverlay`, `enrollReleaseConsentOverlay`, `appendReleaseConsentOverlay`, `restoreReleaseConsentOverlayInTransaction`, `assertReleaseConsentOverlaySchema`, `readReleaseConsentRestoredOverlay`, plus the earlier narrower `readRestoredReleaseConsentOverlayInTransaction`. Restore accepts the stopped model backup, operation ID, distinct target label, timestamp, legacy payment backup checksum, source physical ID and combined backup checksum. It must run **after the frozen legacy base restore in the same fresh-target physical transaction**. Physical installation IDs are generated as `release_` plus UUID hex; logical labels are separate. This distinguishes separate installations using the same label, not an externally unauthenticated bitwise database clone.

Planned public recovery module: `release-consent-backup.ts`.

- `exportReleaseConsentMarketplaceWalletBackup({mode,store,sourceStoreId,manifest,requestId,sessionToken,clock})` returns JSON; mobile counterpart uses stored mobile credentials.
- `inspectReleaseConsentMarketplaceWalletBackup(serialized,{expectedChecksum?})` is already implemented in the new manifest and should be re-exported.
- `restoreReleaseConsentMarketplaceWalletBackup({mode,store,backup,acknowledgeFreshTarget:true,expectedChecksum,operationId,targetStoreId,clock})` must atomically restore old base plus overlay quarantine.
- `inspectRestoredReleaseConsentMarketplaceWallet({mode,store,expectedChecksum,targetStoreId,expectedPhysicalStoreId?})` must reconstruct/check the entire immutable bundle and recovery receipt, without granting authentication or resume authority.

The old complete exporter intentionally rejects any extra namespace and stays unchanged. The new extended reader explicitly allows only the known overlay namespace and checks its shape. Restore can call the frozen old base restore through a bound store on the original transaction, then install the overlay before the outer COMMIT. Post-restore inspection must use the new extended scope and verify exact disabled identities, original prefixes plus quarantine records, both checksums and physical metadata.

The draft native proof expects seven explicit empty loopback PostgreSQL 17 databases: atomic, source race, dispute race, pause race, auth, target, restore race. It includes observed independent-backend lock waits, three append rollback points, eleven combined restore rollback points, lost COMMIT reply reconciliation, close/reopen and competing fresh-target restore. These are intended checks, **not completed evidence**.

## Resume environment

Use Node `24.22.1` from `.nvmrc`, `npm ci --ignore-scripts --no-audit --no-fund` then `npm run postinstall`. Run tests with **`TZ=UTC NODE_ENV=test`**. The scratch checkout may expire; all source and these notes are committed remotely. Do not regenerate the independently captured predecessor artifacts or modify the 197 frozen predecessor files to accommodate the new overlay. Preserve existing development isolation and keep deployment disabled.

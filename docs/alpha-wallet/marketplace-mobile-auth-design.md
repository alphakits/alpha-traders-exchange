# Transaction-owned mobile marketplace authority

Date: 5 November 2026 (Asia/Jerusalem). Scope: the existing private **simulation-only canonical wallet cohort**. This change introduces no production route, mobile release, account signup, provider, signer, external notification or deployment.

**Verified source: `47f0fc18`.** The [exact-source report](marketplace-mobile-verification-2026-11-05.md) records 1,203 passing tests, including 1,016 wallet tests across 32 files, full-project TypeScript, seven native PostgreSQL drills with 66 checks and the retained English/Arabic Chromium rehearsal. The mobile addition contributes 122 test cases and 12 native checks; all earlier native drills were rerun on the same source. The [historical recovery baseline at `09405da`](marketplace-recovery-verification-2026-11-05.md) remains separately recorded. These results cover the private development cohort and do not establish live-launch readiness.

## Purpose and public development contract

The private web coordinator already resolves the actual session and account inside its financial transaction. The earlier standalone mobile wallet resolver validates and rereads the bearer/device session through separate application stores. Those rereads do not place token/account revocation in the same transaction as canonical marketplace and wallet writes.

`createDevelopmentMobileMarketplaceWalletCoordinator` supplies a separate mobile entry point for the same four existing operations: owner enrollment of an already reserved trade, buyer acceptance of its existing amount correction, owner inspection and owner pause. `exportMobileMarketplaceWalletBackup` supplies the corresponding paused-source owner export. Neither accepts a caller-created actor, role, financial snapshot or authentication callback.

Each operation uses strict credentials:

```ts
const credentials = {
  accessToken: currentOpaqueMobileAccessToken,
  metadata: {
    deviceId: currentInstallationId,
    platform: "android" as const,
    appVersion: currentAppVersion,
    locale: "ar" as const,
  },
};

const mobile = createDevelopmentMobileMarketplaceWalletCoordinator({
  mode: "simulation-only", store: explicitlySelectedDevelopmentStore,
});
const receipt = await mobile.acceptAmountCorrection({
  ...credentials, requestId, proposalId, expectedBindingRevision,
  operationId: retainedTransportOperationId,
});
```

The web constructor and its `sessionToken` inputs remain supported. The mobile constructor accepts only its own credential schema; a failed mobile credential never falls back to an accompanying web session or an account ID. Both constructors use the same financial transaction implementation. The immutable business identity and receipts depend on the authenticated account and accepted business input, not the client transport or token.

## Fixed mobile session reader

The mobile reader uses only the supplied `WalletSql`. It does not call the global mobile session service, acquire an ambient pool, read a cache, issue/refresh/revoke a token or perform HTTP work. It certifies a writable SERIALIZABLE simulation transaction with a stable transaction identity before reading authority. Failed semantic checks poison only that same certified transaction so a caller cannot swallow an authorization error and commit earlier financial work.

It uses the application's existing opaque access-token convention and hashing helpers: the stored access-token hash is SHA-256 of the supplied token, and the stored device hash is SHA-256 of `device:` followed by the exact installation ID. Refresh tokens cannot authorize a financial operation. The query joins `alpha_exchange.mobile_device_sessions` to the actual account and takes `FOR SHARE` locks on both rows.

The reader checks current access expiry, revocation, device matching, session identities, token family/generation, stored timestamp precision and account-column/payload consistency. The submitted platform must match the stored platform. An upgraded app may keep its current access session, so its new version need not equal the stored issuance version. The current minimum-version policy is checked around awaited reads and on every authority recheck. Device-ID matching follows the existing installation-binding policy; it is not hardware attestation.

Access expiry remains distinct from refresh expiry. A final valid refresh may issue an access token that lasts beyond the refresh-family deadline. The reader validates the retained refresh deadline's structure without treating it as an additional access-token deadline.

Web and mobile share the same pure account-policy implementation: normalized identity/email/role/seller status must agree with the stored payload; disabled or unverified accounts are denied; existing verified-phone evidence or the exact account-specific exemption is required; adult self-attestation and role rules remain unchanged. This helper is not a user-authority injection point.

Public principals contain only the account ID, buyer/owner capability, access deadline and an internal `assertFresh` method. Stored token/device hashes, family identifiers, profiles and private payment instructions are not receipt fields. The completed coordinator/export boundary sanitizes storage failures while preserving whole-transaction retry and unknown-COMMIT classification.

## Transaction ordering and rechecks

The lock order remains: canonical request advisory lock, the existing platform financial advisory lock, runtime snapshot fence, mobile session/account locks, then wallet history/head work. The account and device-session locks remain held until the only outer owner commits or rolls back.

This produces two distinct outcomes:

| Concurrent change | Required behavior |
| --- | --- |
| Logout or account change commits after the financial snapshot but before its locked authentication read | A stale locked row forces a complete SERIALIZABLE retry; the fresh attempt sees the changed authority and denies the operation |
| Rotation or replacement wins the existing platform global lock before the coordinator acquires it | The old access token cannot survive the refreshed locked read; the complete operation retries rather than relying on its earlier snapshot |
| Logout queues after the operation holds the session/account locks | Logout waits; the earlier authorized operation may commit, then logout commits and the revoked token is denied afterward |
| Session expires or authority changes during awaited work or persistence | The final authority check fails and wallet/canonical/receipt/event writes roll back together |
| Web and mobile accept the same proposal concurrently | The canonical lock and snapshot fence serialize the business decision; a retry returns the original receipt without another principal movement |

The reader binds its initial session ID, account, hashes, device, family, generation, platform and retained timestamps, so replacing credentials in the same physical row does not preserve the earlier authority. It repeats these checks after awaited business work and after the actual focused marketplace persistence. It also checks current account eligibility again.

Expiry checks occur at defined authorization checkpoints. They do not promise that the eventual COMMIT acknowledgement arrives before a wall-clock deadline. A logout queued behind an already acquired lock does not retroactively cancel that earlier transaction.

## Original receipt recovery across app and web

The authenticated account must still own the canonical buyer role for the request before a historical receipt is looked up. A new transport operation ID, new valid session or switch between app and web does not create a new acceptance identity. Changed business input or a different account is denied.

If the original acceptance committed but its reply was lost, either currently authenticated transport can recover that original receipt. This remains possible after owner pause, because historical recovery precedes new financial eligibility checks. A revoked token cannot retrieve it; using the other transport requires that transport's own valid session and the same account authority.

The financial receipt, original command revision/hash, deterministic system message, notification/audit records and publication intent keep their previous contracts. This change does not add delivery of those durable intents. Initial acceptance, new proposals and later payment/dispute/cancellation/release/completion transitions remain separate work.

## Recovery compatibility and credential quarantine

The combined backup format remains `canonical-cohort-v1` with the same exact financial contents and replay rules. An original source may contain either neither mobile authentication table or the exact known pair, `mobile_device_sessions` and `mobile_refresh_token_history`. Both names, table kinds, columns, PostgreSQL types and nullability are checked. Partial pairs, unexpected tables and malformed shapes are refused.

The optional mobile tables remain outside the captured canonical row map. Their credentials, device identifiers and refresh history are never copied into a backup. For the same source state, owner and export clock, web and mobile export produce the same financial bytes. Ordinary web-only backups stay compatible.

Fresh restore creates neither mobile authentication table. It retains no web sessions and creates only the existing disabled, credential-free account-reference stubs. The same-target recovery diagnostic refuses mobile authentication relations on a restored target even if they are empty. The deferred recovery-receipt constraint checks their absence again at COMMIT, so late table/credential insertion cannot slip past the final application check.

This does not recreate account authority or add a resume operation. The source and restored copy remain paused. Encryption, authenticated retention, production schema/role compatibility, account-authority re-entry, source leadership/fencing and external provider reconciliation remain production recovery requirements.

## Verification contract and limits

The added suites exercise the fixed mobile reader, shared web account-policy compatibility, canonical coordinator/export integration and source-only recovery-table compatibility on isolated local databases. The native drill at [postgres-marketplace-mobile.ts](../../scripts/alpha-wallet/postgres-marketplace-mobile.ts) uses three explicitly named, already-created empty loopback databases and checks all three before any fixture write.

Its mobile-session fixtures use the retained real table shape and the current hashing, token replacement/rotation and global-lock SQL contracts. Native checks observe actual backend identities and row/advisory waits. Token issuance/rotation fixtures do not contact the production mobile service. The lost-response case injects a missing reply after a real COMMIT; it is not a physical network partition.

The [verification report](marketplace-mobile-verification-2026-11-05.md) identifies the exact tested source, complete CI results and verified artifact digest. Existing browser checks cover the standalone synthetic English/Arabic rehearsal; this change adds no customer-facing mobile wallet screen. Later route integration must retain the platform's network, version, rate-limit, privacy and account gates. This private reader does not retrofit those routes or establish production capacity, independent security review or live-launch readiness.
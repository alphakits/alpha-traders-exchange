# Transaction-owned mobile marketplace authority

Date: 5 November 2026 (Asia/Jerusalem). Scope: fixed transaction-owned authority for the separate private **simulation-only amount-correction and initial-acceptance cohorts**. This work introduces no production route, mobile release, account signup, provider, signer, external notification or deployment.

**Historical mobile source: `47f0fc18`.** The [exact-source report](marketplace-mobile-verification-2026-11-05.md) records 1,203 passing tests, including 1,016 wallet tests across 32 files, full-project TypeScript, seven native PostgreSQL drills with 66 checks and the retained English/Arabic Chromium rehearsal. The mobile addition contributes 122 test cases and 12 native checks; all earlier native drills were rerun on the same source. The [historical recovery baseline at `09405da`](marketplace-recovery-verification-2026-11-05.md) remains separately recorded. These results cover the private development cohort and do not establish live-launch readiness.

The later [initial coordinator](initial-marketplace-coordinator-design.md) reuses the same stored mobile reader and adds explicit seller capability, owner activation and atomic initial canonical/v3 acceptance. [Exact-source verification at `c11fe0e9`](initial-marketplace-verification-2026-11-05.md) passed 1,779 tests across 52 files and ten native drills/101 checks, with source-bound [machine-readable evidence](initial-marketplace-verification-results.json). The historical mobile results above retain their earlier scope. Initial-cohort combined recovery is UNIMPLEMENTED.

## Purpose and public development contract

The private web coordinator already resolves the actual session and account inside its financial transaction. The earlier standalone mobile wallet resolver validates and rereads the bearer/device session through separate application stores. Those rereads do not place token/account revocation in the same transaction as canonical marketplace and wallet writes.

`createDevelopmentMobileMarketplaceWalletCoordinator` supplies a separate mobile entry point for the same four existing operations: owner enrollment of an already reserved trade, buyer acceptance of its existing amount correction, owner inspection and owner pause. `exportMobileMarketplaceWalletBackup` supplies the corresponding paused-source owner export. Neither accepts a caller-created actor, role, financial snapshot or authentication callback.

`createDevelopmentMobileInitialMarketplaceWalletCoordinator` is a distinct constructor for owner `activateRequest`, `inspect` and `pause`, plus the exact stored seller's `acceptRequest`. It uses the same strict credential shape. There is no corresponding initial-cohort backup export. Owner activation binds retained identities/funding and does not substitute for the seller's later consent or eligibility check.

| Private cohort | Acting account and financial effect | Recovery boundary |
| --- | --- | --- |
| Existing amount correction | Actual canonical buyer accepts an existing proposal; only the principal difference moves | Paused owner export and credential-free combined restore under original v2 `canonical-cohort-v1` |
| Initial acceptance | Actual canonical seller with current `canSell` accepts a pending request; full principal moves | Same-database original receipt recovery and current-owner inspection/pause; combined backup/restore UNIMPLEMENTED |

Each operation uses strict credentials. This example retains the original amount-correction API:

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

The web constructor and its `sessionToken` inputs remain supported. The mobile constructor accepts only its own credential schema; a failed mobile credential never falls back to an accompanying web session or an account ID. Within each cohort, its web and mobile constructors share the same financial transaction implementation. The immutable business identity and receipts depend on the authenticated account and accepted business input, not the client transport or token.

## Fixed mobile session reader

The mobile reader uses only the supplied `WalletSql`. It does not call the global mobile session service, acquire an ambient pool, read a cache, issue/refresh/revoke a token or perform HTTP work. It certifies a writable SERIALIZABLE simulation transaction with a stable transaction identity before reading authority. Failed semantic checks abort only that same certified transaction so a caller cannot swallow an authorization error and commit earlier financial work. Failure cleanup uses a raw physical transaction-ID check independent of runtime guards, preventing environment restoration after a swallowed runtime refusal from making earlier writes committable; an unknown or replaced transaction is never poisoned.

It uses the application's existing opaque access-token convention and hashing helpers: the stored access-token hash is SHA-256 of the supplied token, and the stored device hash is SHA-256 of `device:` followed by the exact installation ID. Refresh tokens cannot authorize a financial operation. The query joins `alpha_exchange.mobile_device_sessions` to the actual account and takes `FOR SHARE` locks on both rows.

The reader checks current access expiry, revocation, device matching, session identities, token family/generation, stored timestamp precision and account-column/payload consistency. The submitted platform must match the stored platform. An upgraded app may keep its current access session, so its new version need not equal the stored issuance version. The current minimum-version policy is checked around awaited reads and on every authority recheck. Device-ID matching follows the existing installation-binding policy; it is not hardware attestation.

Access expiry remains distinct from refresh expiry. A final valid refresh may issue an access token that lasts beyond the refresh-family deadline. The reader validates the retained refresh deadline's structure without treating it as an additional access-token deadline.

Web and mobile share the same pure account-policy implementation: normalized identity/email/role/seller status must agree with the stored payload; disabled or unverified accounts are denied; existing verified-phone evidence or the exact account-specific exemption is required; adult self-attestation and role rules remain unchanged. The additive `canSell` field derives from the established `hasSellerOperationalAccess` rule: approved stored seller status or stored admin/owner role policy. A stale `approved_seller` role cannot override a pending, rejected, suspended or buyer seller status. No approval-certificate requirement is added. Existing `canBuy` and `isOwner` meanings are unchanged. This helper is not a user-authority injection point.

Internal principals contain only the account ID, buyer/seller/owner capabilities, access deadline and `assertFresh`. Public receipts do not expose this internal authority object. Stored token/device hashes, family identifiers, profiles and private payment instructions are not receipt fields. The completed coordinator/export boundary sanitizes storage failures while preserving whole-transaction retry and unknown-COMMIT classification.

## Transaction ordering and rechecks

The lock order remains: canonical request advisory lock, the existing platform financial advisory lock, runtime snapshot fence, the initial participant's target-listing fence where applicable, mobile session/account locks, then wallet history/head work. The account and device-session locks remain held until the only outer owner commits or rolls back.

This produces two distinct outcomes:

| Concurrent change | Required behavior |
| --- | --- |
| Logout or account change commits after the financial snapshot but before its locked authentication read | A stale locked row forces a complete SERIALIZABLE retry; the fresh attempt sees the changed authority and denies the operation |
| Rotation or replacement wins the existing platform global lock before the coordinator acquires it | The old access token cannot survive the refreshed locked read; the complete operation retries rather than relying on its earlier snapshot |
| Logout queues after the operation holds the session/account locks | Logout waits; the earlier authorized operation may commit, then logout commits and the revoked token is denied afterward |
| Session expires or authority changes during awaited work or persistence | The final authority check fails and wallet/canonical/receipt/event writes roll back together |
| Web and mobile accept the same correction proposal or initial request concurrently | The canonical lock and snapshot fence serialize the business decision; a retry returns the original receipt without another principal movement |

The reader binds its initial session ID, account, hashes, device, family, generation, platform and retained timestamps, so replacing credentials in the same physical row does not preserve the earlier authority. It repeats these checks after awaited business work and after the actual canonical marketplace persistence. It also checks current account eligibility, including unchanged seller capability where applicable.

Expiry checks occur at defined authorization checkpoints. They do not promise that the eventual COMMIT acknowledgement arrives before a wall-clock deadline. A logout queued behind an already acquired lock does not retroactively cancel that earlier transaction.

## Original receipt recovery across app and web

Before looking up a historical receipt, the authenticated account must still be the canonical buyer for amount correction, or the canonical seller with current `canSell` for initial acceptance. A new transport operation ID, new valid session or switch between app and web does not create a new business acceptance. Changed relevant business input or a different account is denied.

If the original acceptance committed but its reply was lost, either currently authenticated transport can recover that original receipt. This remains possible after owner pause, because historical recovery precedes new financial eligibility checks. A revoked token cannot retrieve it; using the other transport requires that transport's own valid session and the same account authority.

Each cohort preserves its original financial receipt, command revision/hash, deterministic canonical notification/audit and publication identities; the amount-correction cohort also retains its system message. Initial acceptance is implemented through its separate coordinator and unchanged v3 financial contract. Neither constructor delivers stored intents. New proposals and later payment/dispute/cancellation/release/completion transitions remain separate work.

## Recovery compatibility and credential quarantine

The combined backup format remains `canonical-cohort-v1` for the original v2 amount-correction cohort only, with unchanged financial contents and replay rules. It refuses the separate initial namespace; initial combined recovery remains UNIMPLEMENTED. The source-table compatibility and quarantine rules below apply only to the original correction format. An original source may contain either neither mobile authentication table or the exact known pair, `mobile_device_sessions` and `mobile_refresh_token_history`. Both names, table kinds, columns, PostgreSQL types and nullability are checked. Partial pairs, unexpected tables and malformed shapes are refused.

The optional mobile tables remain outside the captured canonical row map. Their credentials, device identifiers and refresh history are never copied into a backup. For the same source state, owner and export clock, web and mobile export produce the same financial bytes. Ordinary web-only backups stay compatible.

Fresh restore creates neither mobile authentication table. It retains no web sessions and creates only the existing disabled, credential-free account-reference stubs. The same-target recovery diagnostic refuses mobile authentication relations on a restored target even if they are empty. The deferred recovery-receipt constraint checks their absence again at COMMIT, so late table/credential insertion cannot slip past the final application check.

This does not recreate account authority or add a resume operation. The source and restored copy remain paused. Encryption, authenticated retention, production schema/role compatibility, account-authority re-entry, source leadership/fencing and external provider reconciliation remain production recovery requirements.

## Verification contract and limits

The initial-coordinator extension adds focused stored-seller authority and transaction-boundary regressions, plus initial atomic/policy/storage coverage. Its separate [native drill](../../scripts/alpha-wallet/postgres-initial-marketplace.ts) checks fresh seller decisions, mobile revocation/expiry ordering and original cross-transport receipts on three disposable databases. Use its [exact-source report](initial-marketplace-verification-2026-11-05.md) for executed results; these additions do not change the historical mobile drill or imply initial combined recovery.

The original mobile suites exercise the fixed mobile reader, shared web account-policy compatibility, canonical coordinator/export integration and source-only recovery-table compatibility on isolated local databases. The native drill at [postgres-marketplace-mobile.ts](../../scripts/alpha-wallet/postgres-marketplace-mobile.ts) uses three explicitly named, already-created empty loopback databases and checks all three before any fixture write.

Its mobile-session fixtures use the retained real table shape and the current hashing, token replacement/rotation and global-lock SQL contracts. Native checks observe actual backend identities and row/advisory waits. Token issuance/rotation fixtures do not contact the production mobile service. The lost-response case injects a missing reply after a real COMMIT; it is not a physical network partition.

The [historical mobile verification report](marketplace-mobile-verification-2026-11-05.md) identifies the exact tested source, complete CI results and verified artifact digest. Existing browser checks cover the standalone synthetic English/Arabic rehearsal; this change adds no customer-facing mobile wallet screen. Later route integration must retain the platform's network, version, rate-limit, privacy and account gates. This private reader does not retrofit those routes or establish production capacity, independent security review or live-launch readiness.

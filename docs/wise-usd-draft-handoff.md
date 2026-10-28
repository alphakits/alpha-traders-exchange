# Wise USD bank-transfer draft

Status: integration candidate, updated 28 October 2026. Hosted capability is implemented behind a separate default-off server flag. No production flag, encryption key, database or deployment has been changed. This is not a live-release approval.

## Source and integration

The original Wise draft started from Buy Requests `c8de3de6d6b1adf3d5c81aa03e254a961e941465`. This isolated candidate integrates that work onto released tree `645c8f4e02dcff11877e279ae4ec91ed400ef683` (the same tree as production merge `e7a6b8f5978fea1aca70eccbd9580eb0d7e6168b`). Original repositories were preserved. A stale test-only telemetry assertion was replaced by the newer, stricter released assertion.

On 28 October the candidate was synchronized with all changes through released main `a9fc0f9beb1a546127ce0f3b68cb1e7b8bd1b293`. Before adding the Wise changes, the local index matched the released tree `8ae1e5dde08b1e86986fe5bbb760e18388066109` exactly. The original working copy remains preserved.

## User flow

1. Buyer and seller save their own personal Wise USD details in account settings: legal account-holder name, bank name, ACH routing number, account number, checking/savings type and optional bank address. USD ACH uses routing/account details, not an IBAN. Leading zeroes are preserved.
2. An authorized administrator reviews account ownership evidence and identity through the private review screen. The status is explicitly **ownership manually reviewed**. A routing checksum or an entered name is not proof of an account, and this is not verification by Wise. Evidence upload/verification by Wise is not integrated; the reviewer records a private evidence reference after inspecting the evidence through an approved private channel.
3. Seller selects Bank Transfer → Wise, USD and their reviewed receiving account when creating a listing. A Wise listing accepts only this bank-transfer rail. Existing listing moderation still applies.
4. Buyer selects Wise USD in a Buy Request, or buys a Wise listing directly. Prices and totals are explicitly USD, with no automatic ILS conversion and no invented USDT/USD quote. Matching requires the same currency and provider. Buyer must select their own reviewed sending account before opening a trade.
5. The trade captures immutable sender and receiver instructions. Ordinary feeds, session objects, mutation responses and browser caches do not include full account details. Participants reveal the instructions through the private bank-details route. Existing cancellation restrictions apply to revealing payment details.
6. Buyer payment evidence marks payment sent. Seller must confirm actual funds received before proceeding to USDT delivery. Existing evidence, confirmation, dispute, cancellation, inventory and commission handling is reused. Repeated completion must not charge fees or deduct stock again.

There is no transaction-reason/purpose field, suggested reason, or generated Wise answer. Selecting a purpose outside this application does not establish that Wise permits the underlying transaction.

## Important invariants

- Server capability, not a client toggle, enables new Wise commitments.
- Both accounts belong to their corresponding participant and have current manual review. Normalized legal names must match the platform identity.
- Editing account details clears the review. Active listing/trade usage prevents editing or deleting the linked account. Self-review is forbidden. Review approval binds to the precise account version opened by the reviewer.
- Listing approval, offer matching, trade creation, seller acceptance and pending payment-detail reveal recheck current ownership/terms at the relevant commit boundary.
- Accepted/paid trades retain their fixed instructions and can resolve after new Wise activity is disabled.
- Fiat payments/gross amounts are USD; commission amounts remain USDT. New commission records retain `grossCurrency`. Buyer averages are separated by currency, seller volume is USDT, and large-trade thresholds use USDT.
- Native mobile Wise creation and payment actions are unavailable; native listing feeds do not advertise the unsupported rail.

## Local-only runtime

Use Node `>=24.22.1 <25` and the existing lockfile. From a clean checkout with installed dependencies and no `.env` files:

```text
node scripts/usdt-request-offline.mjs --wise-draft --port 3227
```

The existing offline launcher binds to loopback, blocks external server networking, creates synthetic users/data, omits service credentials, disables delivery and forces the in-memory repository. It sets the additional Wise draft flags itself. Do not use real account details or send money in this preview.

To validate a compiled local bundle:

```text
node scripts/usdt-request-offline.mjs --build --wise-draft --port 3227
node node_modules/@playwright/test/cli.js test --config=playwright.wise-draft.config.ts
```

Set `WISE_OFFLINE_PRODUCTION=1` in the test process environment for the compiled bundle. The Playwright configuration now starts and stops its own isolated server, refuses to reuse another server, and preserves the exact Node executable. Omit that variable to test the development server. `WISE_OFFLINE_BROWSER=chromium` or `webkit` selects one engine; the default tests both. `WISE_OFFLINE_PORT` defaults to 3227. CI uses bundled Chromium, while a local run defaults to installed Chrome.

Stop a running development server before building. The browser test checks the offline-health marker before resetting synthetic data. The test uses only localhost and synthetic payment evidence.

The local draft gate still requires `ALPHA_WISE_DRAFT_ENABLED=1`, `ALPHA_EXCHANGE_DATA_BACKEND=json`, and `ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY=1`; it rejects database connection URLs, an existing database pool, hosted Vercel/Railway environments and browser-side execution. The offline launcher supplies a synthetic encryption key and blocks external networking.

The separate server-only hosted capability requires `ALPHA_WISE_PAYMENTS_ENABLED=1`, production runtime, explicit PostgreSQL backend, configured PostgreSQL URL and a dedicated `ALPHA_EXCHANGE_WISE_DATA_SECRET` of at least 32 characters. It rejects in-memory/offline markers. It does not assert approval by Wise. Repository authentication, TLS, role and schema checks remain required before mutations. This configuration has not been enabled on a hosted service.

Private account arrays (including ownership-review evidence references and fingerprints) and buyer/seller trade snapshots are encrypted in the existing JSONB payloads with AES-256-GCM, random nonces and row/field-bound authenticated data. The repository decrypts selected/full/account/session/trade reads, focused mutations and local fallback snapshots. Hosted plaintext, malformed ciphertext, wrong keys and cross-row ciphertext fail closed. No schema migration is required for this payload envelope; that is not a substitute for hosted database verification.

`ALPHA_EXCHANGE_WISE_DATA_PREVIOUS_SECRET` permits reads during key rotation. New writes use the current key. Retain the previous key until every retained account/trade/audit envelope using it has been rewritten and backup recovery requirements are addressed; setting a new key does not perform a bulk migration. Never use the shipped synthetic offline/test key for hosted data.

Disabling the feature flag stops new commitments but does not remove encrypted data. Keep the encryption keys available for account/session reads and accepted-trade resolution. Once encrypted Wise rows exist, rollback must retain a codec-compatible release and the required keys; rolling back to the previous plaintext-only source is not a safe recovery plan.

## Release limitations

- Wise's published cryptocurrency policy prohibits using Wise for P2P cryptocurrency trades. Personal accounts and user-selected reasons do not resolve that provider restriction. Resolve provider eligibility before considering any live implementation: https://wise.com/help/articles/2v3OMcg97Z7gObSifJbjsu/understanding-wises-position-on-cryptocurrency
- Encrypted JSONB persistence and default-off hosted configuration are implemented and covered by local PostgreSQL-compatible tests. Full hosted staging, cross-instance concurrency, recovery and deployment checks remain required before activation. PGlite tests are not hosted PostgreSQL certification.
- Private evidence upload/storage, retention/deletion rules and the operational ownership-review process remain incomplete. The current reviewer records an external private evidence reference; no document upload or verification by Wise is integrated.
- Native mobile support is outside this draft.
- Legacy internal fiat aggregate fields (`revenueGenerated` and seller-insight earnings estimates) are not suitable for future mixed-currency financial reporting. The affected visible cards use USDT or per-currency values; do not introduce a new combined-fiat display using those legacy fields.
- Successful synthetic tests are evidence for the tested paths, not a guarantee of zero defects or real-world bank settlement.

## Continuation on 2026-10-28

- Fixed safe listing wind-down: existing active/paused Wise listings may be paused or have inventory reduced after Wise is disabled or manual review is revoked. Resume, increases, changed payment terms and other new commitments still fail closed. Quantity reductions preserve required audit reasons and recheck stock during concurrent retries.
- Fixed account-load failures silently removing Wise settings. English and Arabic now show a retry action without displaying private controls from a failed load. Out-of-order ownership-review responses cannot replace a newer selected account.
- Added the dedicated Reliability Shield job for the compiled Wise lifecycle and English/Arabic phone layouts in Chromium and WebKit. The test configuration rejects focused/flaky CI tests and uses synthetic fixtures only.
- Packaged portable staging helpers under `scripts/wise-staging`. The Docker overlay accepts current reviewed public ARG defaults while rejecting ambiguous declarations. All 50 offline staging guard tests pass. See its README for the exact staging-only contract.
- Focused verification: 135 account/capability/encryption/storage checks; 20 Wise store checks; 111 related listing/bank checks; 18 account UI checks; TypeScript and full ESLint pass. These selections overlap and must not be added to the regression count below.
- The full unit run initially recorded 6,974 passes and 43 failures from 7,017 collected cases. Restoring the omitted nested mobile dependencies and setting the installed npm CLI path resolved local setup errors. Serial reruns passed all 44 infrastructure cases and 36 mobile cases, including 30 mobile cases that had not been collected previously. The navigation suite passed all 76 cases after synchronizing its cold lazy-import boundary; click/focus assertions were preserved. Across that full run and those targeted reruns, 7,036 cases pass and 11 remain environment-blocked: one Docker shell-guard case requires `/bin/sh`, and ten HTTP cases encounter restricted loopback access. This is not a fully green release gate or a claim that all tests passed in one run.
- The current Windows runner failed three compiled-build attempts with `EPERM` while creating API route output directories, including after preparing the generated directories. This is a build-environment blocker, not a passing build. Browser acceptance for this candidate remains pending a successful compiled build.
- Both recorded staging resources returned not found via the connected Vercel and Supabase APIs. Hosted acceptance has not run. Restore access or separately review replacement staging targets before using the bounded helpers; do not substitute production.
- Full regression and remote CI results must be checked on the final candidate before merge. Wise remains disabled by default and must not be enabled for the prohibited P2P cryptocurrency use case.
- The local branch is `draft/wise-usd-readiness-20261028`, based on current released main. Automatic approval review rejected the attempted GitHub source upload because it requires explicit authorization for this payload/destination. No source blobs were confirmed uploaded, no pull request was created, and no production deployment was made. Obtain that authorization before publishing the draft; do not bypass the rejection through another upload route.

## Verification on 2026-10-25

- Optimized offline Next.js build completed successfully with Node 24.22.1. Standalone TypeScript checking and scoped ESLint also passed.
- Final complete Buy Requests regression selection: 350/350 passed across 15 files.
- Request form/response/workspace UI: 106/106 passed. Additional account, listing, purchase, trade-room and reporting UI checks: 89 distinct checks passed.
- Final local-gate/domain/request/email selection: 136/136 passed. Currency, localization, mobile profile and trust selection: 187/187 passed. Latest public-availability/lifecycle backend selection: 17/17 passed. These selections overlap; do not add them together as a unique test total.
- Chromium against the compiled local server passed the complete synthetic scenario: buyer account entry through Settings; both ownership reviews; moderated USD listing; browser request publication; seller response; browser match and account selection; outsider denial; premature release denial; private instructions; buyer evidence; seller funds confirmation; USDT evidence; completion; idempotent repeated completion; exact stock, gross currency and fee record assertions. No page JavaScript errors were recorded.
- Example checked: 1,000 USDT at USD 1.00, USD 10 buyer fee, USD 1,010 payment total, one 20 USDT combined commission record, and one 1,000 USDT stock deduction.

An initial Windows sandbox build permission failure was resolved by running the same offline build outside the restrictive process sandbox. Earlier development-browser attempts were interrupted by compilation/HMR; the final browser check uses the successfully compiled bundle. Test-selector issues found during browser setup were corrected without changing application behavior. No production data, real bank accounts, emails or SMS were used.

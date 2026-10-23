# USDT request draft — laptop handoff

Updated 24 October 2026 (Asia/Jerusalem). This feature remains separate from the Alpha platform audit and live platform.

## Scope and isolation

- User authorized implementation and offline review. No push, merge, deployment, production database mutation, or real message delivery has been performed.
- Repository baseline: `alphakits/alpha-traders-exchange` at `71d9d61015a622a96d9cdd9f59548da6c2c0a95d`.
- Local branch: `draft/usdt-requests-offline`. Push remote is `DISABLED-OFFLINE-DRAFT`.
- The previous cloud checkpoint was recovered from recorded patches and edits. The truncated end of the request review form was reconstructed and subsequently typechecked and tested; this is not a byte-exact copy of the old checkpoint.
- `ALPHA_USDT_REQUESTS_ENABLED` and the independent `ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED` flag default off.

## Implemented behavior

- Verified adult buyers and approved sellers acting as buyers can post one open request; expiry is 24 hours, publication cooldown five minutes, and limit five publications/renewals per day.
- Request and response prices use the existing fresh USD/ILS reference ±₪0.35, rounded inward to cents. Bank Transfer, Cardless ATM Withdrawal, Face-to-Face, existing networks and fee calculations are reused.
- Sellers respond through compatible approved listings. Face-to-Face city is normalized and rechecked. Creating a listing prefills the existing form and retains owner approval and the return link.
- Canonical acceptance rechecks identity, permissions, request revision, quote age, response/listing version, amount, inventory, buyer eligibility and seller capacity inside persistence. Only one request match persists.
- Pending demand trades reserve inventory and atomically lock the listing. Decline/cancel releases only that reservation; other active reservations remain locked. Ordinary trades retain existing behavior.
- Creation/response retries are idempotent. Original create terms survive renewal; accepted responses and trade references remain in history when explicitly reopening after a cancelled trade.
- Renewal forms retain the revision originally opened. A changed request clears a seller's selected listing and response price, requiring explicit review before responding; polling cannot silently adopt a newer revision for either form.
- In-app notifications link to the exact request/response. Every durable email attempt rechecks eligibility, blocks, preferences, current request/response and feature flags. Email stays disabled in the offline preview.
- English/Arabic request workspace, responsive forms, stale response handling, fee review, private account identifiers, server API validation and feature-gated entry points are included.
- The private `usdt_demands` SQL table has uniqueness and payload constraints, RLS and revoked public/anon/authenticated access. PGlite verifies these locally. No production migration has been applied.

## Offline use

Run `node scripts/usdt-request-offline.mjs --port 3210` from the checkout. Wait for readiness, then open `http://localhost:3210/en/login?redirectTo=/en/usdt-exchange/requests`.

The verified local bundle is also available: add `--production` for a faster preview start. The output-folder launcher automatically uses that bundle when present. This remains a local preview, with the same isolated runtime and network guard.

Synthetic accounts: `buyer@offline.example.test` and `seller@offline.example.test`; both use `OfflineDemo!2026`. Use separate browser sessions. Restart for a clean fixture.

The launcher binds loopback, refuses .env files, scrubs credentials from its child environment, creates fresh local persistence, blocks external server connections, restricts browser connections and disables email/SMS. A guarded health marker is required before fixture reset. Only the harness supplies the fixed ₪3.30 quote and local font substitute. Production source security settings are unchanged.

## Verification

- 198 targeted Vitest tests passed across 14 suites: demand rules/canonical matching (37), PostgreSQL schema/rollback/RLS (6), email/reservations and existing outbox/price-offer flows (58), API/UI (20), existing transaction/concurrency/runtime-safety flows (73), and PostgreSQL runtime security (4).
- Integrated source TypeScript check passed, including application, contracts, scripts and E2E source. The final Next production build also passed its full TypeScript and lint checks with no source lint warnings.
- Existing database timeout guard (25 checks), discovery, owner analytics and news-calendar prerequisites passed. Windows CRLF in two unchanged baseline files was normalized to their exact Git blob bytes for the existing hash assertions.
- Isolated production build passed: optimized bundle, 207 generated static pages, page data and build tracing. Live credentials were deliberately absent and external networking blocked; the expected missing-production-credential notices are not a live deployment validation.
- Five end-to-end scenarios passed against the final isolated production bundle in 34.3 seconds: API price bounds/replay/ownership/privacy; desktop buyer plus mobile seller Bank Transfer, listing prefill, review, canonical Trade Room and seller acceptance; Face-to-Face match/replay/cancellation; Cardless ATM exact totals/encrypted credentials/match/replay/cancellation; and Arabic mobile publishing with RTL/no horizontal overflow.
- Successful desktop, mobile and review screenshots are saved with the output guide. Preview servers were stopped after verification. No payment, live database write, actual provider email/SMS/push delivery or deployment was performed.

## Before a later live release

1. Review the offline flow with the user; preserve draft-only status until launch is authorized.
2. Reconcile with the then-current main branch in an isolated checkout and rerun affected tests.
3. Prepare/review the production migration and schema rollout, including existing-row compatibility and production grants. Runtime schema support is present; a standalone migration has not been generated or applied. Repository schema initialization runs independently of the request feature flag, so leaving the feature off does not replace this rollout review.
4. Verify actual market-provider behavior, production database transaction behavior and notification provider delivery in the appropriate approved environment. Offline tests do not establish live provider receipt or guarantee 100% reliability.
5. Enable the request feature and email delivery separately only as part of an authorized release.

# USDT request feature — offline draft checkpoint

**Historical cloud checkpoint. Superseded by [the laptop handoff](usdt-request-laptop-handoff.md).** The verification and remaining-work lists below describe the earlier checkpoint only.

Date: 24 October 2026 (Bucharest). This is separate from the existing Alpha platform audit.

## Authorization and isolation

- User approved implementation and offline testing only. Do not deploy, push, merge, run production migrations, change live settings/data, or send real messages.
- Repository: `alphakits/alpha-traders-exchange`, baseline `71d9d61015a622a96d9cdd9f59548da6c2c0a95d`.
- Local branch: `draft/usdt-requests-offline`.
- Checkout: `/workspace/scratch/2ab6ed288f14/alpha-usdt-requests`.
- Remote push URL is deliberately `DISABLED-OFFLINE-DRAFT`.
- Both `ALPHA_USDT_REQUESTS_ENABLED` and `ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED` default off. No production credentials/configuration were copied into this checkout.
- The earlier uncommitted checkout disappeared during an environment interruption. This checkpoint rebuilds the feature from the same source baseline; do not confuse it with the earlier implementation described in conversation summaries.

## Current implementation

- Verified adult buyers and approved sellers acting as buyers can publish requests. One open request per account, 24-hour expiry, five-minute publication cooldown and five publications/renewals per day.
- Amount, ILS price, network, payment method and meeting city when applicable. Price bounds use the existing reference freshness rules and actual reference ±₪0.35, rounded inward to cents. Existing fee-inclusive ATM cash calculations are reused.
- Seller response uses an existing compatible approved/active listing. The form offers a prefilled listing-creation link with a return link after existing owner approval.
- Request revisions, response withdrawal, expiry, cancellation, renewal and idempotent create/respond keys. Account identities exposed to counterparties use public AT IDs.
- Canonical purchase creation checks request/response ownership, revision, full amount, price, quote freshness, listing version, inventory and capacity again during persistence. A match and purchase are written together. Pending demand trades reserve inventory and count toward existing seller capacity and active-buyer limits.
- In-app notification intents and a separately disabled email recovery path. No new SMS or WhatsApp demand notifications.
- English/Arabic UI, request/detail API routes, feature-gated navigation and pages.
- A single new `usdt_demands` collection/table contains each request's responses and history. It uses the existing repository transaction lock; SQL includes uniqueness, RLS and revoked public/anon/authenticated access. No standalone migration generated or applied yet.

## Verification at checkpoint

- `node node_modules/vitest/vitest.mjs run src/__tests__/usdt-demand.test.ts`: **31 passed** (one file).
- Covers pricing boundaries, fractional reference ceiling, stale quotes, user eligibility, request retries, blocks/suspension, expiry/renewal, ownership, ATM totals, response privacy/withdrawal, changed listing terms, stock/capacity, canonical purchase persistence, repeated accept taps and feature-disabled writes.
- `git diff --check`: passed before checkpoint documentation.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: **passed**, exit 0.
- Browser, PostgreSQL/PGlite transaction/rollback/RLS, endpoint authorization tests, existing trade regressions and production build have **not** been completed.
- Offline test UI/harness has **not** been implemented yet. Test fixtures exist at `src/test-utils/usdt-demand-fixtures.ts`; these must never become a production auth bypass.

## Next work

1. Collect the TypeScript check and fix any remaining integration errors. Review UI with the React checklist, including stale async responses, session changes, loading errors and accessibility.
2. Build an offline-only sandbox using synthetic accounts and fixtures. It should run the actual request engine and canonical purchase logic, block external network delivery, and provide buyer/seller roles and quote scenarios. Do not deploy it. Use Sites managed preview + CUA only when available; read the managed preview reference first.
3. Verify all three payment methods, full matching and ordinary trade lifecycle regression tests. Add PGlite transaction rollback/constraint/RLS tests and API access/origin/body/rate-limit tests.
4. Review remaining edge cases: request idempotency after match, normalized city comparison, precise ATM renewal select value, late quote movement, buyer eligibility changing after publication, pending demand reservations during listing/trade edits, concurrent renew/cancel vs match, accepted response history on manual reopening, and maximum daily renewed requests.
5. Explicitly verify new listing approval + return-to-request navigation, notification exact-response deep links, no sensitive data in request responses, email recovery and preference rechecks. Email provider receipt cannot be established by offline tests.
6. Finish an evidence report and a user-reviewable offline preview. Generate a migration with the Supabase CLI when available; keep it unapplied. Reconcile with the then-current main branch only in an isolated checkout before a later authorized launch.

## Resume

The user is switching devices. When they say **Continue the new USDT request task**, resume this feature in draft. Preserve its separation from the platform audit and live website. Do not claim 100% reliability or release readiness from the targeted tests above.

# Buy Requests: launch audit and rollout review

Audit date: 24 October 2026. Scope: the offline Alpha Exchange Buy Requests feature and its entry into the existing Trade Room. This document supersedes the verification status in the older laptop handoff. The final run results belong in the task's packaged audit report.

**Release decision: offline review may continue; live enablement requires the checks below.** No deployment, migration, production write, payment, or real notification delivery was performed. Tests establish observed behavior, not a guarantee of zero defects.

## User story and boundaries

A verified buyer opens Buy Requests, publishes an amount and price, receives a compatible approved seller response, reviews the complete payment and receiving wallet, and opens the existing Trade Room. The seller's listing inventory is reserved at match time. Existing payment, evidence, completion and commission rules then apply. English and Arabic share the same API and persisted state.

| Boundary | Evidence and required check |
| --- | --- |
| Entry and role | Blue mobile Buy Requests link immediately follows Alpha Exchange; buyer opens their requests and approved seller opens available buyer requests. Scope survives refresh and detail navigation. |
| Price | Current usable USD/ILS reference plus or minus ₪0.35, rounded inward to cents. At ₪3.10, inclusive limits are ₪2.75 and ₪3.45. Fresh quote enforcement covers publish, renew, respond and final canonical match. |
| Client to API | Validated grouped decimal inputs submit canonical decimal strings; fees use the existing exact money calculations. Native and server validation reject malformed or out-of-range amounts. |
| Quantity display | Summary quantities use grouped whole USDT with an approximation mark for fractional values (for example, `≈661`). Editable amounts and persisted trade arithmetic retain the exact decimal; review exposes the exact fractional quantity. ILS totals retain two decimals. |
| API to data | Authenticated verified eligible account; origin checks; bounded body; rate limit; revision/ownership/idempotency checks. Private views omit counterpart private identifiers and unrelated responses. |
| Public identity | Cards use the existing public profile identity and opaque profile link, approved seller status/rank, and visible completed-purchase count. Private names/contact data, hidden profiles and disabled statistics are not republished. |
| Data to trade | Canonical matching validates request, response, listing version, stock, capacity and quote before one atomic match/purchase commit. Failed persistence rolls back request, purchase and notices. |
| Completed trade | Payment proof, received funds, release proof and seller completion use existing Trade Room handlers. Fulfilled request history retains its trade link; inventory and commission are verified. |
| Recovery | Failed reads disable quote-dependent actions while keeping drafts; changed revisions clear stale selections; unavailable quotes pause matching; cancellation/withdrawal require confirmation. |

## Reproducible offline verification

The user preview on port 3210 and the destructive synthetic test server on port 3211 must remain separate. Do not seed or reset a server containing the user's manual test work. The test configuration refuses reuse of an existing server. Synthetic quote scenarios are available only through the explicitly opted-in offline network guard; application routes and normal preview sessions do not expose that control.

Run the isolated build only when no preview is serving the same `.next` directory. Preserve the existing `run-*` directory and resume it afterward. Use:

```text
node scripts/usdt-request-offline.mjs --build
USDT_OFFLINE_PRODUCTION=1 node node_modules/playwright/cli.js test --config=playwright.usdt-requests-offline.config.ts
node node_modules/vitest/vitest.mjs run src/__tests__/usdt-demand-postgres.test.ts --maxWorkers=1
```

In PowerShell, set `$env:USDT_OFFLINE_PRODUCTION='1'` before the Playwright command. Keep source frozen between final build and end-to-end verification. The final packaged report must record actual successful commands, counts and any exceptions; the matrix below describes coverage, not a claim that an unrun test passed.

| End-to-end case | Assertions |
| --- | --- |
| API boundary and privacy | Signed-out rejection; exact upper/lower bounds; create replay; ownership; response privacy; no sensitive data; in-app notification intents. |
| Bank Transfer browser journey | Desktop buyer and mobile seller; grouped 5,000; counterprice and full fees; wallet validation; canonical Trade Room; seller acceptance. |
| Public profile links | Buyer and seller card links open the actual public profile in a new tab; public AT IDs, approved seller/rank badges and completed-purchase statistics; private account data absent. |
| Face-to-Face / ATM | Request, response, match, retry and cancellation; normalized city; exact fee-inclusive ATM total; credentials not stored as plaintext. ATM selection and review show approximately 300 USDT, with the exact fractional amount available and 990.10 + 9.90 = 1,000.00 ILS unchanged. |
| Arabic mobile | RTL layout, Arabic numeral paste to an exact canonical value, rounded summary with approximation mark, successful publication and no horizontal overflow. |
| Invalid inputs and recovery | Malformed grouping, out-of-range price and unavailable quote cannot publish; fresh quote restores the retained draft. |
| Seller response lifecycle | Update, reload, withdrawal confirmation, history and buyer availability. |
| Missing listing | Clear guidance and prefilled existing listing form. Owner approval remains required. |
| Changed request | Seller selection clears, old revision cannot submit, reviewed new revision succeeds. |
| Reference ₪3.10 | Reject ₪2.74 and ₪3.46 on create, renew and respond; accept ₪2.75 and ₪3.45; matching persists exact fee-inclusive amount. |
| Quote changes | Out-of-range request pauses; old response cannot match; stale/unavailable provider cannot match; renewed response succeeds after recovery. |
| Role navigation | Buyer and seller mobile entry at widths 320, 390, 768 and 1024; menu reachability at 568×320 landscape; correct scope and no horizontal overflow. |
| Responsive request form | Widths 320, 375, 390, 768, 1024, 1440 and 1920; grouped amount, fee readability and usable action. At 320px, maximum exact amount 999,999,999.999999 and an 80-character unbroken city fit the buyer and seller cards, checked with text bounds rather than document overflow alone. |
| Money presentation | Browser-computed green currency in reference, inputs, listing selector, request/response cards, fee subtotal, fee and total, Arabic form and price-limit errors; at least 4.5:1 contrast against their composited solid backgrounds. |
| Buyer request lifecycle | Keep cancellation, confirm cancellation, reload, update and renew after cooldown. |
| Bank Transfer completion | Premature completion rejected; buyer payment evidence; seller funds/release stages; seller evidence; buyer completion rejected; seller completion; fulfilled request and stock. A 1,000 USDT trade records a 10 USDT seller share plus 10 USDT collected buyer share, totaling 20 USDT pending commission with the agreed policy/calculation versions. Completion retry cannot create a second commission or debit stock again. |

Browser automation uses installed Chromium/Chrome on Windows. The final isolated harness disables GPU acceleration for software-rendered screenshots after a shared-host run stalled with high test-GPU CPU usage and repeated image tiles; color sampling is also CPU-backed. This changes only the test process, not the user preview. It does not establish behavior on actual iOS Safari, Android WebView, assistive technology, every desktop browser or every device pixel ratio. Validate representative real devices before broad rollout. Screenshots are review evidence for the tested viewports.

## Database review artifact

[sql/usdt-demand-schema-review.sql](sql/usdt-demand-schema-review.sql) is a local, unapplied SQL review artifact. Its body is checked against `USDT_DEMAND_SCHEMA_SQL`, and the PGlite suite executes it and tests uniqueness, default-deny RLS, revoked client privileges, identity constraints and transaction rollback. The CLI is not installed in this workspace, so this file has **not** been adopted as a timestamped Supabase migration. A release operator must create that migration using the installed CLI's `migration new` command after inspecting its help and reviewing the target migration history.

The new table lives in `alpha_exchange`, contains request/response/history payloads and is accessed through the trusted server repository. It is not a public Data API table. `PUBLIC`, `anon` and `authenticated` have no table privileges, and RLS has no client access policy. Do not add broad client grants or a permissive policy to work around a runtime role mismatch. Grants and RLS are distinct controls; both must be reviewed in the target environment. See [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Data API security](https://supabase.com/docs/guides/api/securing-your-api).

The current application initializes repository schema independently of the feature flag. Merely keeping `ALPHA_USDT_REQUESTS_ENABLED=0` does not prevent schema initialization when this application version first connects. The table/index sentinel also does not prove every existing constraint and privilege matches. Apply and verify the reviewed schema before this version handles real traffic, and inspect any pre-existing `usdt_demands` table rather than trusting `CREATE TABLE IF NOT EXISTS` to repair it.

### Target-environment preflight (read-only)

Run with the actual release database connection after approval, never by copying live credentials into the offline fixture. Keep catalog output in the release record; do not export user payloads.

```sql
select current_user, session_user, current_database(), version();
select to_regclass('alpha_exchange.users') as runtime_users,
       to_regclass('alpha_exchange.usdt_demands') as demand_table;
select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user;
select n.nspname, c.relname, pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'alpha_exchange' and c.relname = 'usdt_demands';
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = to_regclass('alpha_exchange.usdt_demands');
select indexname, indexdef from pg_indexes
where schemaname = 'alpha_exchange' and tablename = 'usdt_demands';
select policyname, roles, cmd, qual, with_check from pg_policies
where schemaname = 'alpha_exchange' and tablename = 'usdt_demands';
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'alpha_exchange' and table_name = 'usdt_demands';
```

Before adopting the SQL, compare any existing table columns/types/defaults, all constraints and both indexes to the review artifact. Confirm `alpha_exchange` is not unintentionally exposed through the Data API. Confirm the server connection role can access the table through the intended trusted-server ownership/privilege model; PGlite uses an owner connection and does not prove the production role is configured correctly. Review recent migration history, backups and restore procedure, connection pool mode, lock/statement timeout behavior and concurrent writer behavior in an approved PostgreSQL staging environment.

### Authorized rollout order

1. Reconcile this branch with current main in an isolated checkout. Review changes to the canonical trade, market provider, session, repository and notification subsystems; rerun affected tests and build the exact release commit.
2. Confirm a restorable database backup and an approved rollback owner. Adopt the reviewed SQL through the normal migration mechanism. Run it first against staging with real PostgreSQL roles and the current baseline schema. Retain the SQL lock and statement timeouts. An unexpected existing-table mismatch or timeout is a stop condition requiring review.
3. Verify expected columns/constraints/indexes, default-deny client access and server repository read/write/rollback in staging. Run concurrent publish/respond/match/retry scenarios against multiple app instances. The shared repository transaction lock is a correctness mechanism; test lock wait and statement timeout behavior under expected load.
4. Deploy the reviewed application with `ALPHA_USDT_REQUESTS_ENABLED=0` and `ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED=0`. Confirm no test runtime flags, test credentials or synthetic provider URL exist in the deployed environment; `/api/testing/alpha-exchange-state` and `/__usdt-offline-quote` must not expose fixtures.
5. Verify the actual market provider: authenticated configuration where applicable, recent quote timestamp, market-open and market-closed validity, timeout/unavailability behavior and exact current ±₪0.35 bounds. Do not treat the offline fixed quote as evidence of live provider health.
6. After approval, enable Buy Requests for the intended rollout audience. Smoke-test buyer and seller menus, one publish/response/canonical match/cancel path, history, private responses and invalid prices with designated test accounts and amounts according to the release policy. Never send a real payment merely to prove navigation.
7. Keep email delivery off until preference/eligibility checks, exact deep links, provider receipt, retries and deduplication have been verified in the approved environment. Enable it separately. In-app notifications can be tested independently.
8. Monitor quote failures, mutation error rates, rate-limit responses, request/response/match counts, database lock/transaction timeouts, pending trades, inventory consistency and notification delivery. Establish expected thresholds from staging and the rollout audience instead of inventing unsupported numeric thresholds.

### Rollback and data preservation

Disable request creation/response entry via `ALPHA_USDT_REQUESTS_ENABLED=0` and keep email delivery disabled. Existing canonical Trade Room purchases must remain operable through their existing routes; verify that with a matched demand-origin trade in staging before rollout. Do not drop `usdt_demands`, delete its history or reset the snapshot. Keep request-to-trade pointers and audit evidence. If application rollback is required, verify that the older build preserves this new table/collection and pending demand reservations; do not assume an old whole-snapshot writer understands new data. Prefer a forward fix or reviewed compatibility rollback. A destructive table rollback requires a separate approved data recovery plan.

## Remaining release evidence

These are known unverified environment boundaries, not claims of defects: current-main compatibility; adopted migration history and production-role grants; PostgreSQL multi-instance contention at expected scale; actual provider behavior; real notification receipt when enabled; representative mobile Safari/Android and accessibility checks; production monitoring and rollback rehearsal. Offline fallback storage is intentionally isolated and cannot substitute for those checks. Live enablement is not complete until its owner records this evidence and authorizes release.

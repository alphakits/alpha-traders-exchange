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

## Release controls added during readiness review

The dedicated Buy Requests suite is now a required dependency of the existing `Release acceptance` workflow job, in both Chromium and WebKit. Normal Playwright projects intentionally skip the destructive Buy Requests fixture, so their success alone never establishes this feature's browser coverage. `verify:release:full` also invokes the dedicated production configuration. CI forbids focused tests and permits no browser retries in this suite. These source changes require a successful CI run after adoption; local source inspection does not establish remote branch protection or CI success.

The dedicated configuration accepts `USDT_OFFLINE_BROWSER=webkit`; Chromium remains the default. Two added English/Arabic 320px accessibility cases exercise keyboard form entry and scan buyer details, seller response and trade review against axe WCAG A/AA rules, including contrast. Reports preserve violations and checks requiring manual review. Automated scans and Playwright WebKit supplement, but do not replace, real mobile Safari, screen-reader and keyboard usability checks. The packaged report must record their actual run outcomes.

Run the read-only configuration preflight in the intended release environment without exporting its secrets to a developer fixture:

```text
node --conditions=react-server --import tsx scripts/usdt-release-preflight.ts --feature=off
node --conditions=react-server --import tsx scripts/usdt-release-preflight.ts --feature=on
```

Use the first command for the initial disabled deployment or rollback and the second only to validate an already authorized enabled configuration. The script reads existing environment variables, prints only fixed validation messages, and does not load an env file, change flags, open a database, fetch quotes, or send notifications. It requires Node.js >=24.22.1 <25, invokes the normal environment validator and additionally rejects local test markers even if they would qualify for the private production-mode test exemption. Verify the actual hosting runtime patch version; a dependency lockfile update alone cannot replace Node's bundled fetch implementation. The `on` preflight requires a dedicated stable Cardless ATM encryption key; preserve that key, any previous key and the intended activation time through rollback. A passing configuration check is not deployment authorization or proof of staging readiness.

Production validation rejects the synthetic preview flags, both published offline encryption keys and local/test quote endpoints. Persistent database or service-role credentials prevent the two local E2E markers from downgrading runtime security. The credential-free, loopback-bound offline launcher remains separate from deployed Vercel environments. Fixture GET and PUT routes reject deployed production before parsing or persistence, including a request with a loopback Host and all test headers/markers.

The feature-off regression closes discovery, publishing, responses and new matching, then continues a previously matched ATM trade through prepared credentials, acceptance, payment, funds received, USDT sent and completion. It checks one commission and one stock deduction, with request-to-trade history preserved. Record the test result before relying on this rollback contract. The actual staged application rollback to an older version still requires independent compatibility verification.

### Monitoring and incident review

Buy Requests API responses include a server-generated `X-Request-Id`. The structured `usdt_demand_request` event records that correlation ID, read/write operation, status, fixed reason and duration in milliseconds. It does not log account identifiers, URLs, request bodies, wallet/bank information or raw exception text. Expected quote/revision/eligibility failures are `denied`; unexpected failures are generic 503 responses and `failed` events. A logging outage cannot turn a committed mutation into a failed response. `usdt_demand_email_queue` with `PREPARATION_FAILED` identifies background preparation failures without exposing delivery details.

Before enabling the feature, verify these events reach the approved log destination and configure queries for unexpected 5xx rates, `QUOTE_UNAVAILABLE`, `PRICE_OUTSIDE_BAND`, revision conflicts, 429 responses and request latency. Review canonical `exchange_purchase_request_create` events and existing database timings for the match phase, plus durable email/outbox events for notification delivery. Establish warning thresholds using a staged baseline and the planned rollout volume; do not page on every expected user validation error. Record an accountable operator, log retention/access policy, and correlation-ID lookup procedure. No alert subscription or production logging integration was changed by this audit.

For an incident: stop new demand entry with the feature flag and demand-email gate disabled, confirm new demand APIs return unavailable, and verify existing Trade Rooms remain readable and actionable. Preserve pending purchases, reservations, commissions, encryption keys and demand history. Investigate quote freshness and transaction/outbox errors by correlation ID. Resume only after the fault is understood and the same staged scenario passes. Do not use snapshot resets, fixture routes or table deletion as rollback steps.

## Database review artifact

[sql/usdt-demand-schema-review.sql](sql/usdt-demand-schema-review.sql) and [the prepared migration](../supabase/migrations/20261024024258_usdt_buy_requests.sql) have the same SQL body as `USDT_DEMAND_SCHEMA_SQL`; tests enforce parity. The migration filename was generated with pinned Supabase CLI 2.122.0 after inspecting its help. The official CLI ZIP was verified against GitHub release SHA256 metadata and the published checksums. The migration remains **unapplied to every hosted database**. It retains `BEGIN`, a 5-second lock timeout and a 30-second statement timeout. Target migration history, baseline compatibility and actual runtime role still require release review.

The schema rejects non-finite numbers, exponent notation, numeric JSON and excess decimal precision, while retaining exact valid amount strings. The focused schema/repository suite passed 89 tests. A portable PostgreSQL 17.11 cluster, isolated at `127.0.0.1:55432` with synthetic records, also passed 13 checks covering concurrent cold bootstrap, migration repeatability, cross-process publication and responses, single-winner matching, durable replay, feature-off Trade Room reads, atomic failure rollback, actual advisory-lock waiting, client role/RLS denial, and `pg_dump`/`pg_restore` record equality. Durability settings remained enabled. Reproduce using `scripts/check-usdt-demand-postgres.mjs`, `ALPHA_AUDIT_DATABASE_URL` pointing to the dedicated loopback `alpha_exchange_ci` database, and `ALPHA_AUDIT_PG_BIN` pointing to PostgreSQL binaries. The harness also requires an empty dedicated `alpha_exchange_restore_ci`; `--reset-fixtures` explicitly resets only those guarded test schemas. These local checks do not establish hosted staging or production backup readiness.

The new table lives in `alpha_exchange`, contains request/response/history payloads and is accessed through the trusted server repository. It is not a public Data API table. `PUBLIC`, `anon` and `authenticated` have no table privileges, and RLS has no client access policy. Do not add broad client grants or a permissive policy to work around a runtime role mismatch. Grants and RLS are distinct controls; both must be reviewed in the target environment. See [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Data API security](https://supabase.com/docs/guides/api/securing-your-api).

The current application initializes repository schema independently of the feature flag. Merely keeping `ALPHA_USDT_REQUESTS_ENABLED=0` does not prevent schema initialization when this application version first connects. Missing-schema bootstrap now runs atomically under a transaction advisory lock, rechecking the sentinel after acquiring that lock. If the demand table already exists, bootstrap skips its DDL and preserves its current grants, RLS and indexes for explicit review; a missing sentinel never authorizes silent repair. Enabling Buy Requests additionally verifies the actual catalog, including a warm process first initialized while OFF. This check fails closed for unsafe drift and retries after a reviewed repair; the only automatic contract upgrade is the known absent decimal check on an otherwise valid table. Feature OFF skips demand contract enforcement so existing Trade Rooms remain available. Apply and verify the reviewed schema before this version handles real traffic.

### Target-environment preflight (read-only)

Run with the actual release database connection after approval, never by copying live credentials into the offline fixture. Keep catalog output in the release record; do not export user payloads.

```sh
NODE_ENV=production node --conditions=react-server --import tsx scripts/usdt-database-preflight.ts
```

Use the release environment's configured PostgreSQL connection and verified TLS settings. The command opens a read-only transaction, queries catalogs with a 10-second statement timeout, rolls back and closes its pool. It never calls repository initialization or applies SQL. It checks actual columns/defaults, validated constraints, valid uniqueness/indexes, unexpected unique indexes/triggers/rules, default-deny RLS, effective client table/column grants and the current server role's CRUD access without active RLS filtering. A trusted owner/BYPASSRLS server role is required by this repository model; adding client policies is not a repair. Fixed issue codes contain no connection URL, credentials or row payloads. A passing catalog report is not a launch approval or proof of hosted provider, load, recovery or staging behavior. Missing configuration fails with a redacted error.

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

Before applying the prepared SQL, compare any existing table to the catalog contract and confirm `alpha_exchange` is not unintentionally exposed through the Data API. The local owner and restricted-role tests do not prove the production server role is configured correctly. Review recent migration history, backups and restore procedure, connection pool mode, lock/statement timeout behavior and concurrent writer behavior in an approved PostgreSQL staging environment. The connected recovery audit database contains copied real user data and is not an authorized fixture target.

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

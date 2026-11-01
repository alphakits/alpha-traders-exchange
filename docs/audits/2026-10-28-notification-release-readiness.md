# Notification release readiness — 28 October 2026

**Decision: NO-GO for production notification activation.** Read-only infrastructure inspection is complete for the items below. It does not prove provider delivery, device display, or complete notification acceptance. This document supplements PR #447's source and event audits; its source/CI evidence must be refreshed for the final candidate commit.

No configuration, schema, permission, notification, payment, or production release changes were made by this inspection. Environment values were not decrypted. SMS verification remains available and WhatsApp remains intentionally unavailable.

## Current release evidence

| Area | Observed evidence | Conclusion |
| --- | --- | --- |
| Vercel target | Team `alpha-kits` (`team_RI4GCZrJfs5fCWqQKl06DYGS`), project `alpha-traders-exchange` (`prj_LW6qHJPjr4Ih9SGthgytKEliH8EH`). | Target identity is established. |
| Production | Deployment `dpl_JBH8LpUVU9U4J32kRL25NwdQJpXj` is READY from `main` commit `a9fc0f9beb1a546127ce0f3b68cb1e7b8bd1b293` (PR #449). Deployment aliases include `www.alphatraders.co.il` and `alphatraders.co.il`; the latter redirects to `www`. | The public-build-input repair is live. PR #447's notification changes are not part of this deployment. |
| Previous notification preview | `dpl_Bte8DjmqwwHNryyb3nhoA2CBD2pP`, commit `d1a4ff20da04569a12a009d1074fa7dd92297bf5`, is ERROR. | Historical preview failure is retained; it cannot count as release acceptance. |
| Integrated preview checkpoint | `dpl_wWq41Q2uhLfFYf8LdedjZV6S3EqV`, commit `e3fb336986d6f1775b877a37da1528c93081aac7`, was BUILDING at inspection. URL: `https://alpha-traders-exchange-gxu8slxfc-alpha-kits.vercel.app`. | This is a transient checkpoint, not a passed deployment. Recheck the final candidate after all audit repairs. |
| Browser sender configuration | Project environment metadata contains zero keys beginning `WEB_PUSH_`; no production environment entries were hidden by the API. | Stable matching `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`, and explicit `WEB_PUSH_ENABLED=true` are not configured through project environment entries. No secret values were inspected. |
| Notification schedulers | The deployed commit's `vercel.json` contains none of `/api/cron/browser-push`, `/api/cron/mobile-push-delivery`, or `/api/cron/buy-request-notifications`. PR #447 adds the first two every minute and Buy Request expiry at `2-59/5 * * * *`. | Required schedules are absent from the deployed source. Provider scheduler registration and actual authenticated invocations still need independent verification after release. A source configuration alone is insufficient. |
| Cron authentication | A production `CRON_SECRET` environment entry exists. No general-preview entry exists; the preview override belongs only to another branch. | Presence is not proof of correct scheduler authentication or successful execution. No cron was invoked by this inspection. |
| Runtime observation | A three-hour production runtime-log query for `push`, grouped by request path, returned no groups. | Bounded absence of matching logs, not proof of scheduler health or zero failures. |

## Preview isolation is currently a blocker

The project has one global `SUPABASE_DB_URL` environment entry targeting both production and preview. The only branch-specific database override observed belongs to `feature/private-trading-journal`, not `fix/buyer-seller-push-audit-20261027`. `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` also have shared production/preview entries. Provider credentials, including email and SMS credentials, are likewise shared at the project environment level.

This establishes shared configuration inheritance for PR #447. It does **not** independently establish the effective runtime database hostname: credential-bearing values were not decrypted, and no deployed runtime identity query was performed. Confirm the effective database project/host and runtime role through a secure operator-side check that emits identifiers only, before applying any migration or running authenticated preview mutations.

**Do not perform authenticated preview setup, reminder claims, push subscription registration, notification mutations, or delivery tests while this shared binding remains.** In the inspected source, `ensureNotificationEngagementSchema` executes `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, and `REVOKE` on first use by a pool. Thus a preview operation can create or modify schema even before a notification is sent. Separate migrations alone do not remove this runtime initialization behavior.

Preferred staging choice: an isolated database/branch with synthetic buyer and seller accounts, branch-specific database/API settings, independent VAPID configuration, and provider credentials or allowlists limited to consenting test recipients. Override all applicable settings as a consistent set; changing only the public Supabase URL does not isolate the direct PostgreSQL pool. Rebuild after configuration changes and verify the effective target from that running build.

The existing recovery-audit project must not be assumed disposable or suitable for delivery tests. Its data contents and current purpose were not inspected. Use it only after its owner confirms isolation and acceptable test data; otherwise use a dedicated staging target. Isolated local fixtures remain suitable for software regressions but cannot prove hosted scheduler or physical-device delivery.

## Database readiness and private access

Read-only metadata was inspected in both connected projects:

| Project | State | Notification schema result |
| --- | --- | --- |
| `alpha-traders` / `pihtougaocftqvcfcdhj` | ACTIVE_HEALTHY | Neither Oct 27 notification migration is recorded. Browser push tables and `notification_reminder_state` are absent. `mobile_push_deliveries.expo_push_token_hash` is absent. `idx_alpha_exchange_mobile_push_recovery` is absent. |
| `alpha-traders-recovery-audit-20261018` / `yepfxqntsjeavpplwqwt` | ACTIVE_HEALTHY | Neither Oct 27 notification migration is recorded. Browser push tables are absent. `mobile_push_deliveries.expo_push_token_hash` is absent. The recovery index was not separately inspected in this project. |

Required migration files:

- `supabase/migrations/20261027081740_notification_engagement_web_push.sql`
- `supabase/migrations/20261027084511_mobile_push_token_receipt_fencing.sql`

Both projects' existing mobile push tables are owned by `postgres`, with RLS disabled. Metadata shows no `alpha_exchange` schema USAGE for `anon`, `authenticated`, or `service_role`, and no notification/mobile-push table grants to those roles or `PUBLIC`. This is evidence of private API-role access restrictions, not evidence that the application's actual database role has been verified. The SQL-session `pgrst.db_schemas` setting was null, so the Data API exposed-schema configuration was not established by that check.

The browser migration enables RLS and revokes access from `PUBLIC`, `anon`, and `authenticated`. Preserve that boundary. These server-only tables need **no new grants to browser/API client roles**. If the deployed pool uses the existing table owner, it already has owner privileges. If it uses a restricted server role, do not guess a blanket grant: verify its identity and ownership first. The current initializer requires ownership for its ALTER/REVOKE operations, so SELECT/INSERT/UPDATE grants alone are insufficient. A migration-only initializer and deliberately scoped server-role policy would be a separate reviewed change. Do not grant schema CREATE, broad table privileges, or RLS bypass to public clients to make setup succeed.

After a reviewed migration on the confirmed target, verify all three new tables, RLS, private grants, foreign keys, the native token-hash column, and the recovery index. Check idempotency in isolated staging and exercise the actual runtime role. Existing primary-project security advisors reported only INFO-level `rls_enabled_no_policy` findings, including existing private tables; this does not establish complete security readiness or justify adding public policies. Reference: [Supabase database linter](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Continuation verification checkpoint

The notification branch incorporated the already-reviewed PR #449 build inputs in `e3fb336`. Its first fresh Reliability Shield run [40681531694](https://github.com/alphakits/alpha-traders-exchange/actions/runs/40681531694) passed database correctness, recovery and restore, but failed the unchanged <1000 ms performance gate: 270 successful actions, median 402.53 ms, p95 1537.56 ms, maximum 1852.86 ms. The comparison from prior head `d1a4ff2` changes only the Dockerfile and its regression test. Prior same-source runs also varied from a 1322.50 ms failure to an 857.95 ms pass; variability does not erase the current failure. Exact dominant waits were not retrieved.

A further source review found and repaired two cases: background refresh resurrecting provider-retired browser subscriptions, and overlapping native registration retries restoring obsolete token/locale state. The candidate adds nine browser and three native regressions. Five direct browser-client scenarios and native source syntax validation passed locally; full database/route/component and release verification belongs to the new CI run on this candidate. The current PR check results are authoritative for its final head; earlier run counts are historical and not added together.

The native repair orders requests within one document and suppresses superseded retries/results. It does not assert distributed ordering after an ambiguous network disconnect, or that a provider receipt means a device displayed an alert.

## Go/no-go checklist

- [ ] Final reviewed source includes the notification fixes and current main integration; all required CI and build checks pass on the exact final candidate.
- [ ] Final preview is READY; its effective database/API/provider configuration is independently isolated before authenticated or mutating acceptance tests.
- [ ] Production database project/host and runtime role are confirmed through a secret-safe check; the two reviewed migrations are applied to that exact target and verified.
- [ ] Browser sender has a stable matching VAPID pair, valid subject, and deliberate enable flag. No private key is placed in client code, output, artifacts, or logs.
- [ ] Released scheduler configuration includes browser recovery, native recovery, and Buy Request expiry. Authenticated executions are observed at their intended cadence, with unauthorized calls rejected and no raw secrets logged.
- [ ] Consenting buyer and seller test accounts exercise new requests, responses, withdrawal, cancellation, expiry, trade actions, chat, and commission alerts. Verify persisted event, correct recipient, provider result, and destination separately.
- [ ] Real browser devices verify foreground, background and closed-tab delivery, opt-out, logout/account switching, stale subscriptions, reconnect recovery, privacy-safe lock-screen copy, and duplicate suppression. Mocked PushManager/UI tests do not satisfy this row.
- [ ] Applicable supported Chrome/Edge, Firefox/Safari and installed iPhone web-app cases are tested on actual supported devices. Released signed native iOS/Android builds are tested separately when native delivery is in scope.
- [ ] Device evidence records the tested build/OS/browser, account role, permission/Focus state, event identifier, timestamps, observed display and click destination without exposing tokens, endpoints or private content. Provider acceptance/receipt alone is not evidence of OS display.
- [ ] Representative traffic observation shows bounded backlog, retries and receipt lag, and actionable handling of provider rejection/exhaustion. Current recovery intentionally considers only recent revisions; retention/cleanup ownership is explicitly recorded.
- [ ] SMS verification remains available, WhatsApp remains unavailable, and no unrelated trading/financial decision behavior is changed.

## Scope and completion limits

The prior source audit is buyer/seller transaction-focused. Economic-news direct realtime publication was explicitly outside that change. Native signed-build distribution and availability of consenting physical test devices are not established by this inspection. This continuation covers that existing buyer/seller notification scope; it does not represent universal coverage of every platform notification family.

All unchecked release/device rows remain open. Completing code tests or obtaining a READY preview does not close them, and no percentage of end-to-end production completion is inferred from automated test counts.

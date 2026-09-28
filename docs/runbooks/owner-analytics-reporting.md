# Owner analytics reporting boundaries

## Unique section visitors

The section table defaults to **Since the new start**, with **Today** available
using the existing Israel-local reporting boundary. Its primary count is
distinct visitors per section; **Total visits** is a separate repeat-inclusive
number. The daily summary also identifies its visit total as repeat-inclusive.
Arabic/English routes, subpages, query strings and fragments share the same
top-level section. Returning to Alpha Exchange or Prop Firms does not increase
that section's unique count. All-time counts do not reset at midnight.

Identity is computed by the server from events in the new period: verified account ID
first, saved browser identity for guests. Guest history is linked to an account
only when exactly one account has been observed on that browser. Signed-in
accounts remain separate on shared browsers, and the same signed-in account
counts once across devices. Ambiguous shared-browser guest visits remain guests.
Cleared browser storage and guests on different devices cannot reliably be
deduplicated. Counts cover the observed tracking history, not earlier activity.

Deduplication happens in the reporting query. Only aggregate counts reach the
owner endpoint. Old responses without explicit unique counts and a reporting
start fail validation instead of being mislabeled as the new statistics.

## Owner-requested fresh start

The new reporting period is explicit and durable. Neither loading the panel,
reloading a server nor redeploying creates or resets it. The period table is
private, RLS-enabled and unavailable to anon/authenticated database roles.

Apply the schema-only migration
`supabase/migrations/20260928203450_owner_analytics_fresh_start.sql` as part of the
approved release. It does not delete records or start collection. Once the new
application is ready, execute `scripts/sql/start-owner-analytics-period.sql`
under the owner's explicit approval. In one transaction it briefly locks traffic
inserts, records the database clock as the fixed start, and deletes traffic rows
older than that start. Retrying it retains the same boundary and new visits.

Before activation, the live endpoint deliberately reports unavailable instead
of displaying old history as fresh data. Once activated, all traffic reports
(daily and all-time sections, visitors, sessions, platforms, devices, referrers)
and presence reports (online, today, 7 and 30 days) exclude activity before the
boundary. Raw SQL timestamp precision is retained for these filters. The panel
shows the start time so the owner can see which period the numbers describe.

The deletion is scoped to `traffic_events`; accounts, sessions, trades, payments,
commissions and public presence are not deleted. Presence rows support live
application behavior, so their pre-start activity is excluded by report filters
instead of erasing operational state. New real activity immediately increments
the zero-based report and remains deduplicated by account/section.

`src/lib/owner-analytics-fresh-start.test.ts` exercises the actual activation SQL,
deletion, zero counters, new visits, retries, late old records, unchanged public
presence/business fixtures and storage permissions in an isolated database.
These tests do not execute the production reset. Production activation and
publication remain pending the final owner approval requested for this release.

Focused checks: `src/lib/traffic-analytics-store.test.ts` executes the actual
report queries in PGlite, including the 90 → 91 → 91 example, multiple devices,
guest/sign-in transitions, shared browsers, language changes and midnight.
`src/components/admin/owner-live-analytics-panel.test.tsx` checks both languages,
period selection, column meanings and rejection of malformed/old responses.

## Daily reporting boundary

- Daily traffic visitors, tab sessions, page views, top pages and sources use midnight in `Asia/Jerusalem`, limited to the new reporting period.
- Presence `activeToday` and `activeTodayUserIds` use the same named-zone cutoff. The development memory path uses the same Israel-local date, not the machine's timezone.
- The owner-only online count and its ID list require a current matching session and an enabled account, in addition to the existing 90-second lease and five-minute activity window.
- Reporting uses the new start in addition to the day boundary. Database timezone, session validation, public presence, trades, payments and commissions are unchanged.

`date_trunc('day', now(), 'Asia/Jerusalem')` handles named-zone boundaries without hardcoded +02/+03 offsets. The fresh-start migration above stores the separate fixed period boundary.

## Validation

Run `node scripts/check-owner-analytics-reporting.mjs`. The focused offline checks exercise the actual date helper and mock-backed reporting functions, preserve protected implementation prefixes byte-for-byte, and check query predicates. These are not a full-project test run or actual browser/device acceptance.

Read-only PostgreSQL verification used CTE VALUES fixtures for six winter/summer/year-boundary cases and a distinct-user online predicate including duplicate tabs, expired/revoked sessions, a disabled user and an idle user. All fixtures are statement-local; no fake production records are created.

## Verified data layer, remaining UI acceptance

Authorized read-only inspection confirmed saved traffic records, the expected hashed identifier shape, and RLS-enabled traffic/presence tables without anon/authenticated SELECT grants. Live business counts and user identifiers are intentionally not published in this repository.

Signed-in owner-screen acceptance and real installed iOS/Android attribution are not established by these local checks. The live panel displays the reporting timezone and source-specific unavailable/stale indicators. Production database errors propagate rather than return successful zero data; missing-database production configuration is rejected by `getRuntimePostgresPool`.

Guest visitor IDs represent browser storage, not verified people; known accounts are deduplicated as described above. Presence history and traffic collection began at different times; seven/thirty-day labels do not prove a full period of collection. A zero native count is not evidence that installed-app attribution has passed.

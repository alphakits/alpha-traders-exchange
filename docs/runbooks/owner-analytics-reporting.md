# Owner analytics reporting boundaries

## This correction

- Traffic visitors, tab sessions, page views, top pages and sources use midnight in `Asia/Jerusalem`.
- Presence `activeToday` and `activeTodayUserIds` use the same named-zone cutoff. The development memory path uses the same Israel-local date, not the machine's timezone.
- The owner-only online count and its ID list require a current matching session and an enabled account, in addition to the existing 90-second lease and five-minute activity window.
- This is reporting logic only. Database timezone/settings/schema, stored timestamps, session validation, public presence, trades, payments and commissions are unchanged.

`date_trunc('day', now(), 'Asia/Jerusalem')` handles named-zone boundaries without hardcoded +02/+03 offsets. No database migration is needed.

## Validation

Run `node scripts/check-owner-analytics-reporting.mjs`. The focused offline checks exercise the actual date helper and mock-backed reporting functions, preserve protected implementation prefixes byte-for-byte, and check query predicates. These are not a full-project test run or actual browser/device acceptance.

Read-only PostgreSQL verification used CTE VALUES fixtures for six winter/summer/year-boundary cases and a distinct-user online predicate including duplicate tabs, expired/revoked sessions, a disabled user and an idle user. All fixtures are statement-local; no fake production records are created.

## Verified data layer, remaining UI acceptance

Authorized read-only inspection confirmed saved traffic records, the expected hashed identifier shape, and RLS-enabled traffic/presence tables without anon/authenticated SELECT grants. Live business counts and user identifiers are intentionally not published in this repository.

Still open: signed-in owner-screen reconciliation, real installed iOS/Android attribution, explicit visible reporting-timezone labels, individual analytics unavailable/stale indicators, and source-by-source historical coverage. Existing dashboard optional fields still default to zero; this PR does not claim that display behavior is repaired. Production database errors already propagate rather than return successful zero data; missing-database production configuration is rejected by `getRuntimePostgresPool`.

Traffic visitor IDs represent browser storage, not verified people. Presence history and traffic collection began at different times; seven/thirty-day labels do not prove a full period of collection. A zero native count is not evidence that installed-app attribution has passed.

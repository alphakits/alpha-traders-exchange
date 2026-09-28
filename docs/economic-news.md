# USD News delivery

The Home tab opens the public locale homepage. News replaces the bottom
Notifications tab; the notification bell and its View all link remain intact.
News requires an active signed-in account on both the website and the active
iOS/Android website shell. Both use the same first-party page and session.
Middleware and the server page reject guest/invalid sessions before feed reads.
The API uses the canonical session guard and private, no-store responses; News
is excluded from search indexing. Expired client sessions clear displayed events
and return to sign-in with the original event destination.

## Activation dependency

The News page, normalized data API, scheduler, and opt-in in-app/email delivery
are implemented. API ingestion and alerts are **disabled by default**. No provider
account, purchase, data agreement, or API key is supplied by this change. While
unconfigured, the page shows an honest preparation state inside Alpha Traders;
it never seeds production with demonstration events or fabricated results.

The existing `docs/mobile/economic-calendar-post-release-plan.md` data-source
rule remains applicable: do not scrape Forex Factory. Its weekly JSON export
does not include actual results and does not establish redistribution rights.

The implemented candidate adapter uses Trading Economics' documented calendar
API, stable CalendarId, UTC timestamps, Importance=3, and US/USD filtering.
Its impact classification is **not guaranteed to match Forex Factory exactly**.
For an exact Forex Factory red-folder calendar, obtain a permitted API/data
agreement and verify stable event IDs, timestamps, result availability, units,
and redistribution/notification rights before adding that provider adapter.
Do not activate the candidate as though it were Forex Factory.

After the owner selects an acceptable licensed feed and confirms rights to
cache/display data in the website and app and send result emails, configure:

```
ECONOMIC_NEWS_PROVIDER=trading-economics
TRADING_ECONOMICS_API_KEY=<server-side licensed key>
ECONOMIC_NEWS_DATA_LICENSE_CONFIRMED=true
```

Existing CRON_SECRET, Postgres, and Resend configuration is reused. Never place
provider keys in NEXT_PUBLIC variables, clients, logs, PRs, or email messages.
The scheduler is `/api/cron/economic-news`, authenticated with the same
constant-time Bearer-secret check as the existing cron routes. It performs no
database, feed, or delivery work while unconfigured. It creates only isolated
News tables when activated. It never changes exchange schemas or trade rows.

## Timing and behavior

- Cron reads a bounded past/next seven-day window once per minute. Visible News
  pages refresh every 30 seconds; hidden pages stop polling. Delivery is not
  advertised as instantaneous: provider delay plus polling/caching applies.
- UI defaults to Asia/Jerusalem; device timezone is selectable. DST comes from
  IANA timezone rules. Zero is a valid actual; empty values stay blank. A passed
  scheduled time alone never establishes that a result was released.
- A first sync establishes a baseline without sending historical alerts.
  Fresh result transitions queue alerts. Late releases can alert when an
  observed pending event gets a fresh source result. Stale catch-up and revisions
  do not generate a second release alert. Old queued deliveries expire in an hour.
- Stable event/user/channel delivery keys, transaction locks, leased delivery
  claims, and Resend idempotency prevent repeated processing from duplicating
  release emails. Notification retries retain existing read state.
- Separate News opt-ins default off and are available in News and Account.
  The existing global in-app/email preferences also apply. Unsubscribed,
  disabled, or unverified users are checked again before delivery.
- Delivery uses bounded concurrency and retries in the new cron. News reads
  and syncs do not execute in trade actions, chat, payments, or seller workflows.
- Event source revisions are retained in the News table and labeled in the UI.
  Speeches have no invented numerical result. Publisher names remain plain
  text; News never requires an external navigation. The current numeric
  calendar adapter does not supply speech transcripts/summaries.
- News links include `?event=<stable id>` and show that event first. Emails and
  notifications use bilingual factual comparisons, without market direction
  recommendations or predictions.
- A feed older than three minutes is labeled delayed. Feed failures preserve
  cached data and stop result delivery until a successful sync.

## Verification before activation

Confirm the approved provider's real payload and release latency with the
licensed key. Run a preview sync against isolated data, verify a pending-to-
actual update and a revision, and send a test email only to an authorized
test recipient. Verify device navigation, Arabic layout, source attribution,
rate limits, and any required App Review/privacy disclosure updates. Production
activation and real provider delivery cannot be certified without that key.

Official API reference:
https://docs.tradingeconomics.com/economic_calendar/country/
## First-party display and outstanding provider access

The owner rejected the TradingView widget and external-browser fallback on
2026-09-29. They have been removed from News. There is no iframe, TradingView
branding, outbound source link, or native-app-specific alternate screen. The
existing installed app receives this change through its website shell, with no
native permission expansion or replacement binary needed.

A licensed feed must explicitly permit website/mobile display, translation,
cache and result notification use, plus the requested presentation without
provider branding or mandatory outbound links. TradingView Premium does not
supply those API rights. Do not hide widget attribution or scrape a calendar to
work around the missing feed. Trading Economics remains unconfigured pending
its quote and licensed credentials. FXStreet offers a documented calendar API
and B2B white-label products, but no license, quote, credentials or purchase has
been obtained. No subscription or trial may be purchased without the owner's
explicit written price approval.

The interface, access gate and provider activation are distinct release states.
Do not describe a preparation screen or successful UI/auth tests as live news
or active alerts. Complete the licensed payload/release tests above before
claiming full launch.

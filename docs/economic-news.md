# USD News delivery

## Published results correction — 9 October 2026

The three-week UI alone did not fix the missing results: the underlying free
calendar was still the Sunday 4 October snapshot. The correction adds the
already-published 6 October trade balance and 8 October initial claims, plus
sourced English/Arabic summaries for the four retained Fed speeches/minutes.
All five listed events from 5–11 October now have a numeric result or a verified
text outcome. Closed numeric cards show the actual; opening shows comparisons.
Speech/statement cards open a factual “What happened” summary without a numeric
grid. The next-release banner stays inside the current week, so the 14 October
CPI is never presented as this week's release.

Next week has verified previous readings for its eight listed releases and
short explanatory context. Context and previous values are not forecasts.
Official sources do not publish a market consensus forecast, so no forecast
number is fabricated. All dates remain in the selected timezone. The same
components serve desktop, mobile browser and the installed website shell.

`resultsVerifiedAt` records a separate results check; `verifiedAt` remains the
schedule verification. Midweek result maintenance must not relabel an old
schedule as newly checked. Optional bilingual `outcome` is allowed only for
speeches/statements, with an official publication URL and `publishedAt`.
Results and summaries stay hidden until both schedule and publication time
have passed. A timestamp without a result or outcome is rejected.

Sunday calendar preparation is supplemented by an hourly weekday Codex result
check using the same connected GitHub/Vercel publication flow. It changes only
the JSON, skips publication when nothing changed, preserves all three weeks,
and honours existing release gates. This is verified periodic publishing, not
an instantaneous licensed feed; source availability and build/deploy time can
delay results. Only report publication after the production domain serves the
commit or a verified newer descendant containing it.

Sources checked for this correction:

- Trade balance: https://www.bea.gov/news/2026/us-international-trade-goods-and-services-august-2026
- Original previous trade balance: https://www.bea.gov/news/2026/us-international-trade-goods-and-services-july-2026
- Initial claims: https://www.dol.gov/ui/data.pdf (8 October release).
- Employment results: https://www.bls.gov/news.release/empsit.nr0.htm (2 October release).
- CPI comparisons: https://www.bls.gov/news.release/cpi.nr0.htm (11 September release).
- PPI comparisons: https://www.bls.gov/news.release/ppi.t01.htm (August; core excludes foods and energy, not trade services).
- Retail comparisons: https://www.census.gov/retail/marts/www/marts_current.pdf (16 September release, table 2).
- Each Fed summary stores its exact speech/minutes publication URL in the JSON.

The historical review notes below describe earlier releases; this section
supersedes their Sunday-only result and no-summary behaviour.

## News readability review — 8 October 2026

The News screen groups events by calendar day in the selected timezone. Gold
event titles, blue dates/times, teal confirmed actuals, neutral previous values,
and lavender forecasts have explicit text labels. Missing
values say Pending, Not added, or Not available; they never imply zero. Speeches
and statements are labelled separately and do not show empty numerical grids.
Each card is a native disclosure: tap its title/date area to open results,
forecasts, previous values, revisions, reporting period, and source. Cards
start closed; a direct event link opens the selected event. Speeches use the
same interaction without an invented numeric result. Missing consensus values
are explicitly unavailable in the free weekly calendar.

The weekly notice is concise and still explicitly says results are not live.
Exactly three views are available in both feed modes: This week (default),
Next week, and Previous week. Each uses a complete Monday–Sunday range in the
selected timezone. This week includes both passed and upcoming events; next
and previous weeks never overlap it or include more distant weeks. Events
are ordered before grouping; Next release switches to the correct week before
scrolling and focusing its card. The shortcut appears only in This week.
Motion respects reduced-motion preferences.
The screen is shared by the browser and the installed website shell.

Verification for the review branch: 90 focused News model/provider/API/access
and component tests, TypeScript, and targeted ESLint. The actual before/after
components were rendered with the existing weekly snapshot in a separate
preview harness. 163 Chromium assertions covered English/Arabic at 320, 390,
430, 768, and 1440 CSS pixels, filters, timezone conversion, focus/scrolling,
disclosures, reduced motion, refresh failure, and session expiration. This
is component and contract verification; production sessions, physical iPhone
Safari, and production deployment were not exercised by the preview harness.
The readability update was released in PR #360. The follow-up replaces its
four filters with the owner-requested three week views and collapsed cards.
The follow-up passes 96 focused tests, TypeScript and ESLint. A saved-snapshot
component harness passes 244 browser assertions across the same five widths
and both languages, including native click/keyboard disclosures and complete
previous/next week partitions. These are simulated API checks, not a licensed
provider activation or physical-device certification.

The Home tab opens the public locale homepage. News replaces the bottom
Notifications tab; the notification bell and its View all link remain intact.
News requires an active signed-in account on both the website and the active
iOS/Android website shell. Both use the same first-party page and session.
Middleware and the server page reject guest/invalid sessions before feed reads.
The API uses the canonical session guard and private, no-store responses; News
is excluded from search indexing. Expired client sessions clear displayed events
and return to sign-in with the original event destination.

## Free weekly calendar — 2 October 2026

The owner rejected recurring provider fees and authorized a free weekly
calendar refreshed every Sunday for the complete coming Monday–Sunday week. Without licensed-feed configuration, News now
serves a curated snapshot from `src/lib/economic-news/weekly-calendar.json`.
It uses public release schedules and confirmed figures from BLS, BEA, the U.S.
Department of Labor, the Federal Reserve and the Census Bureau. This path
requires no provider subscription, API key, database migration or native app
release. Sources remain visible as plain text inside Alpha Traders.

The calendar covers selected major USD releases, rather than promising every
event or reproducing a supplier's impact ratings. The weekly update checks
recent results and upcoming dates; weekday checks add newly verified results
between Sundays. Consensus forecasts and instantaneous result alerts are not
included; an expanded card labels unavailable forecasts explicitly. The UI identifies this mode and the last verification time in both
English and Arabic, polls its private API every five minutes while visible,
and retains Israel/device timezone selection. Expired sessions still clear
the data and redirect to sign-in. The existing app displays the same screen.

Sunday maintenance is performed by the owner's scheduled Codex automation,
using official public sources and the connected GitHub repository. Update only
the JSON on current `main` after reading its file SHA; the existing Git/Vercel
integration builds the update. Retain all events from the Monday of the previous calendar week and about
four weeks of verified upcoming dates (within the 45-day coverage cap), with stable IDs and actual UTC instants
converted from `America/New_York` using IANA DST rules. Do not infer dates from
last month's weekday, fabricate release times, forecasts or actuals, or mark
old values as newly released. Exclude an unconfirmed exact time or use
`timing: tentative`; uncertain numeric values stay null. Do not advance
`verifiedAt` unless the source dates/results were actually checked. Set `weekStart` to the coming Monday calendar date and `weekEnd` to the following Monday (exclusive), as YYYY-MM-DD. These fields record the verified prepared week. The default This week tab uses
the current Monday–Sunday calendar week in the selected timezone, including
already-passed events and confirmed results. Next week shows only the following
Monday–Sunday, and Previous week shows only the preceding Monday–Sunday.
The server retains a bounded 15-day lookback so earlier days of Previous week
do not disappear during the current week.
The displayed date range changes at local Monday without waiting for a new
snapshot. The Next release shortcut opens whichever tab contains its event.

Each actual or speech outcome needs a confirmed `publishedAt` no later than
`resultsVerifiedAt` (or `verifiedAt` for older snapshots) and no
earlier than its release. An unknown actual stays null. Prior/revised values
must use the same series, units and adjustment as the current value. The
schema rejects duplicate IDs, non-UTC instants, extra forecast fields,
unapproved source hosts and out-of-coverage records. `npm run test:news-calendar`
runs before every production build. A snapshot older than eight days is
clearly marked possibly outdated; expired coverage is unavailable. These
snapshots never queue live release emails or in-app alerts.

Reference sources:

- https://www.bls.gov/schedule/
- https://www.bea.gov/news/schedule
- https://www.dol.gov/ui/data.pdf
- https://www.federalreserve.gov/newsevents/calendar.htm
- https://www.census.gov/economic-indicators/calendar-listview.html

## Optional licensed feed

The News page, normalized data API, scheduler, and opt-in in-app/email delivery
are implemented. Paid API ingestion and alerts remain **disabled by default**.
No provider account, purchase, data agreement, or API key is supplied by this
change. The free weekly snapshot works independently; configured licensed
feeds retain their existing ingestion and alert behavior.

The existing `docs/mobile/economic-calendar-post-release-plan.md` data-source
rule remains applicable: do not scrape Forex Factory. Its weekly JSON export
does not include actual results and does not establish redistribution rights.

The candidate adapters use Trading Economics' documented calendar API (stable
CalendarId, UTC timestamps, Importance=3) or FXStreet's current Calendar API
(stable occurrence UUID, UTC timestamps, volatility=HIGH). Both restrict events
to US/USD. Their impact classifications are **not guaranteed to match Forex
Factory or TradingView exactly**.
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
ECONOMIC_NEWS_WHITE_LABEL_CONFIRMED=true
```

Alternatively, after an acceptable FXStreet quote and explicit rights approval:

```
ECONOMIC_NEWS_PROVIDER=fxstreet
FXSTREET_CLIENT_ID=<server-side public/client key>
FXSTREET_CLIENT_SECRET=<server-side private/client key>
ECONOMIC_NEWS_DATA_LICENSE_CONFIRMED=true
ECONOMIC_NEWS_WHITE_LABEL_CONFIRMED=true
```

`ECONOMIC_NEWS_WHITE_LABEL_CONFIRMED` specifically confirms permission to present
the feed in the Alpha Traders interface without supplier branding or outbound
links. Do not set either confirmation because a quote was requested, a demo is
accessible, or credentials alone were received. The written licence must also
cover caching, translations, website/app redistribution and result alerts.

Existing CRON_SECRET, Postgres, and Resend configuration is reused. Never place
provider keys in NEXT_PUBLIC variables, clients, logs, PRs, or email messages.
The scheduler is `/api/cron/economic-news`, authenticated with the same
constant-time Bearer-secret check as the existing cron routes. It performs no
database, feed, or delivery work while unconfigured. It creates only isolated
News tables when activated. It never changes exchange schemas or trade rows.

## Licensed-feed timing and behavior

- Cron reads a bounded past/next 15-day window once per minute. Visible News
  pages refresh every 30 seconds; hidden pages stop polling. Delivery is not
  advertised as instantaneous: provider delay plus polling/caching applies.
- Before activation, visible pages check the private News API every five minutes
  and immediately on returning to the page or reconnecting. Manual refresh gives
  an explicit result. Once data becomes available, the same open page switches
  to live polling and reloads alert preferences without a document reload.
- UI defaults to Asia/Jerusalem; device timezone is selectable. DST comes from
  IANA timezone rules. Zero is a valid actual; empty values stay blank. A passed
  scheduled time alone never establishes that a result was released.
- A first sync establishes a baseline without sending historical alerts.
  Each provider has its own sync baseline; reads and delivery claims select
  only that provider's event prefix. Switching providers is explicit, never an
  automatic failover to a different impact classification or licence.
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
- FXStreet uses server-only OAuth client credentials and the `calendar` scope.
  Access tokens stay in server memory, renew before expiry and are refreshed
  once on 401. Authentication and feed requests reject redirects, have bounded
  timeouts and return sanitized failures. Units and potency are retained;
  absent actuals stay blank. Missing `lastUpdated` never becomes the local sync
  time: such events can display but cannot trigger a release alert.
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
The free weekly calendar is available independently of provider access. Do not
describe a weekly snapshot or successful UI/auth tests as a live provider feed
or active release alerts. Complete the licensed payload/release tests above
before claiming those optional capabilities.

## FXStreet preparation and contact status — 29 September 2026

Mark approved a nonbinding pricing/licensing enquiry. It was sent from his
iCloud account at 01:02 Europe/Bucharest to `contact@financialmarkets.media`,
the contact published by the FXStreet white-label business provider. Sent-mail
verification succeeded. The request asks for launch on 29 September after
written price/rights approval, and expressly authorizes no trial, purchase or
contract. No credential or paid subscription has been obtained.

The dormant FXStreet adapter and synthetic contract tests are based on:

- https://docs.fxstreet.com/api/calendar/
- https://calendar-api.fxstreet.com/swagger/v1/openapi.json
- https://docs.fxstreet.com/api/authentication/oauth2/v2/

Before enabling cron in production, use an isolated preview with server-only
credentials and the approved flags, then run:

```
node --conditions=react-server --import tsx scripts/verify-economic-news-provider.ts
```

This is a read-only connectivity/schema check; it prints counts only, never
credentials or licensed event payloads, and does not write storage or send
messages. A successful check does not certify release latency or notification
delivery. Inspect a real upcoming-to-actual transition and a revision using
isolated News storage and an authorized test recipient. Only then enable the
selected provider for production. Do not fabricate production events to make
the preparation screen appear live.

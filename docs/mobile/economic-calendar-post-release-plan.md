# High-impact economic calendar — post-release plan

This is the controlled plan for the requested market-events feature after the
core Alpha Traders app, full Exchange, push delivery, and real-device flows are
approved and stable. It is deliberately not part of the first release
candidate.

## Product outcome

Users should be able to replace a separate check of an external “red folder”
calendar with one clear Alpha Traders experience:

- today, tomorrow, and weekly views in Israel/local device time;
- country and currency filters;
- a clearly labelled **High Impact** red state rather than copying another
  provider's branding;
- event time, country, currency, title, previous, forecast, actual, revised
  state, source, and last-updated time;
- Arabic and English layouts with correct RTL behavior; and
- optional reminders for the events and currencies a user chooses.

The calendar is informational. It must not present a prediction, personalized
trade signal, guaranteed market reaction, or instruction to enter a trade.

## Data-source rule

Do not scrape Forex Factory or copy its presentation. Use a commercial data
provider whose contract explicitly permits API use, caching, display inside a
consumer mobile app, push notifications, and the intended territories.

Trading Economics is a candidate because its official calendar API documents
event timestamps, source, actual/previous/forecast values, update timestamps,
and numeric importance levels where `3` represents high importance. Provider
selection remains blocked until pricing, redistribution, attribution, caching,
notification, and Arabic-display rights are accepted in writing.

Keep the API key server-side. Mobile and browser clients must call an Alpha
Traders endpoint and must never receive the provider credential.

## Proposed architecture

1. A scheduled server job fetches a bounded UTC window from the licensed
   provider and validates every record.
2. The service upserts events by provider and stable provider event ID. It
   stores source timestamps so schedule changes and revisions are auditable.
3. A public read endpoint returns cached, normalized events with a short cache
   lifetime and a visible `lastUpdatedAt` value.
4. The bilingual website page becomes available inside the exact-parity app.
5. Signed mobile installations may opt in to high-impact reminders. The server
   sends a privacy-safe notification and deep-links to the event detail.
6. A delayed reconciliation job updates actual and revised values without
   producing duplicate reminders.

## Minimal data contract

| Field | Requirement |
| --- | --- |
| `id` | Alpha Traders stable identifier |
| `provider` / `providerEventId` | Provenance and idempotency |
| `scheduledAtUtc` | Canonical time; never persist only a formatted local time |
| `country` / `currency` | Filter and notification preference |
| `titleEn` / `titleAr` | Reviewed bilingual label; safe fallback policy required |
| `importance` | `low`, `medium`, or `high`; only licensed provider value |
| `previous` / `forecast` / `actual` / `revised` | Nullable source values, never invented |
| `unit` | Displayed with its value |
| `sourceName` / `sourceUrl` | Attribution where contract requires it |
| `providerUpdatedAt` / `syncedAt` | Staleness and audit evidence |
| `status` | `scheduled`, `released`, `revised`, `cancelled`, or `delayed` |

## Notification behavior

- Market-event notifications are optional and separately switchable from trade
  and security notifications.
- Default reminder selection is off until the user knowingly enables it.
- Proposed choices: at event time, 5 minutes before, or 15 minutes before. Do
  not send all three unless the user explicitly chooses multiple reminders.
- Rescheduled, delayed, and cancelled events must update or cancel pending
  reminders.
- The lock-screen copy contains only event title, currency/country, impact, and
  time. No account, trade, wallet, bank, or private-message data is included.
- Rate limits, quiet-hours behavior, opt-out, delivery receipts, idempotency,
  and stale-data suppression are required before launch.

## Accuracy and safety controls

- Show the provider/source and last update time on every event detail.
- If the feed is stale or unavailable, show a visible stale/unavailable state;
  never keep an old event labelled live.
- Normalize and test daylight-saving transitions for Israel, Europe, the US,
  and the device timezone.
- Translate a curated event taxonomy. Do not machine-invent Arabic financial
  terms or translate numeric values.
- Preserve provider corrections and revised values instead of silently
  overwriting history.
- Add an educational disclaimer that scheduled events can change and market
  reactions are unpredictable.

## Release sequence

1. Complete first-release App Review and stabilize the full Exchange.
2. Select the provider and archive the executed data-use rights.
3. Build storage, sync, normalization, public API, and admin diagnostics.
4. Build the bilingual calendar UI on phone and desktop.
5. Add explicit market-event notification preferences and native routing.
6. Test timezones, revisions, duplicate suppression, provider outage, push
   states, Arabic RTL, accessibility, and load behavior.
7. Update the privacy policy, App Store metadata, screenshots, and Review Notes
   if the live data provider or notification behavior changes disclosures.
8. Submit the feature as a reviewed app update; do not activate a material
   hidden feature after an unrelated approval.

This plan keeps the first launch stable while making the economic calendar the
next meaningful activity and retention feature instead of unfinished code in
the initial release.

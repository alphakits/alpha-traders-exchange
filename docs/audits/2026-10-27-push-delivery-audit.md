# Buyer and seller push notification audit

Date: 27 October 2026. Base: `e7a6b8f5978fea1aca70eccbd9580eb0d7e6168b`.

This change recovers the unfinished browser-push/reminder draft and fixes important buyer/seller delivery gaps. It contains no Wise feature changes or financial decision changes. Software checks do not establish that a device displayed a notification.

Status: implementation and local verification complete. The review patch contains 57 notification implementation, migration, test and audit files. Remote CI and preview results are tracked in the associated pull request. Production deployment, configuration and physical-device acceptance remain separate release requirements; no real notifications were sent during this audit.

## Findings fixed

- Buy Requests, seller responses, and automatic/combined commission confirmations now publish their canonical notifications after successful persistence. Failed writes, replay and rebases cannot publish speculative alerts.
- Buyers receive seller-withdrawal alerts; eligible sellers with open responses receive buyer-cancellation alerts. A five-minute authenticated sweep notifies buyers of recent request expiry, once per revision even after inbox deletion/pruning. It observes the existing expiry policy without changing trade or financial decisions and never backfills requests that expired more than 24 hours ago.
- Native recovery scans recent committed notification revisions, including new messages on old chat rows, and retries eligible missed/failed sends. Critical/high-priority actions precede listing broadcasts.
- Native delivery rechecks the recipient, active session, token, read/archive state and exact claim before provider calls and retries. Due devices are selected before the 20-device batch limit, avoiding starvation of older registrations.
- Delayed native provider responses cannot overwrite newer attempts or deactivate replacement tokens. Missing receipts rotate out of the bounded scan; expired receipts are not treated as proof of display and do not trigger duplicate resends.
- Browser push uses private database subscriptions, authenticated registration, a notification-only service worker, trusted provider endpoints, safe internal destinations and privacy-safe lock-screen copy.
- Browser recovery is idempotent per subscription and notification revision, prioritizes urgent actions, rechecks consent/session/state immediately before sending, limits retries, and invalidates only the expired subscription version.
- Chat preferences cover owner messages and conversation events; feedback and admin preferences cover alerts whose broad category is `trade`.
- Personal Buy Request responses/status changes follow the transaction preference; new-request discovery broadcasts follow the separate listing preference. Five fixed bilingual lock-screen messages explain request events without exposing amounts, names or response content.
- Sender configuration rejects mismatched VAPID key pairs. Device health detects stale VAPID subscriptions; explicit Enable replaces them.
- Browser and native setup discard stale account/document results. Registration, reminder writes and notification preference operations bind to the expected account. Settings save only changed fields so stale forms cannot undo a channel enabled elsewhere.
- Setup reminders are limited by an atomic account-wide 12-hour claim, with a seven-day snooze. Permission prompts require a user action. Blocked, unsupported and install-required states have separate guidance.
- Notification click handling recovers from closed tabs, validates the destination, and never intercepts/caches authenticated page requests.

The event-by-event coverage table is in [the buyer/seller event audit](2026-10-27-buyer-seller-push-event-audit.md).

## Verification

All sends in automated tests use isolated mocks; database behavior uses disposable PGlite fixtures. No real messages or payments were sent.

| Check | Evidence |
| --- | --- |
| Final expanded regression | 51 files, 746 unique tests passed across the main run and targeted recovery run. Two PGlite fixture-start timeouts under concurrent build load were resolved by rerunning those unchanged suites with one worker and a 60-second hook timeout: 72/72 passed. No remaining failed/skipped tests in the combined results. |
| Browser sender, service worker, registration, reminder database and route security | 7 files, 74 tests passed, including overlaps with the wider run |
| Native delivery, recovery, registration, concurrency and cron | 5 files, 60 tests passed; included in the wider run |
| Browser setup, settings, native bridge and contracts | 6 files, 38 tests passed; overlaps with the wider run |
| Buy Request and commission publication | 4 files, 56 tests passed; included in the wider run |
| Final Buy Request cancellation, withdrawal, expiry and existing request journeys | 5 files, 116 tests passed, including 36 terminal-event tests; overlaps earlier runs |
| Buy Request expiry scheduler | 9 tests passed: authentication, disabled feature, safe errors and successful sweep |
| Native migration | Applied twice to a legacy fixture; existing ticket preserved, nullable token hash and recovery index verified |
| Code quality | Targeted ESLint passed with zero warnings; web/native TypeScript checks passed |
| Production build | Final-source `npm run build` passed on Node 24.22.1, including preflight checks, lint, types and 207 generated pages; the new expiry cron route is present in generated output |
| Production dependencies | Advisory gate passed after checking source backports. Raw npm audit still reports four existing entries in two guarded advisory chains; this is not a clean npm audit. No new browser-push-chain advisory was reported. |

Focused Chrome UI acceptance: **5 tests passed, no retries**, covering English buyer setup, Arabic seller setup, blocked permission, unsupported Arabic 320px layout and signed-out configuration rejection. Four screenshots were visually inspected. Tests use real local authentication/pages/service-worker registration, with explicit mocks for PushManager subscription and provider persistence; they cannot prove OS delivery.

## Release and device acceptance still required

The production project had no `WEB_PUSH_*` configuration at inspection. This audit does not enable production delivery or claim a completed rollout.

1. Apply both notification migrations through the normal reviewed deployment process. Confirm private table grants/RLS and the revision recovery index in the target database.
2. Configure a stable matching VAPID key pair and subject server-side, then enable `WEB_PUSH_ENABLED=true`. Never expose the private key or rotate it casually. The public key is returned through the authenticated setup endpoint.
3. Confirm authenticated minute schedulers for browser/native recovery and the five-minute Buy Request expiry scheduler are actually running in the deployed environment. A scheduler configuration file alone is insufficient evidence.
4. Use consenting test buyer/seller accounts to check foreground/background/closed-app delivery, lock-screen privacy, exact notification clicks, opt-out, logout/account switching, expired tokens, reconnect recovery and duplicate suppression.
5. Test real Chrome/Edge, supported Firefox/Safari, an installed iPhone web app and released native iOS/Android builds as applicable. OS settings, notification permission and Focus modes can suppress display even after provider acceptance.
6. Observe delivery backlog, retry exhaustion, provider rejections and receipt lag under representative buyer/seller traffic before claiming production readiness. Browser receipt/subscription retention remains an operational follow-up; current recovery is bounded to 24-hour revisions.

Retained semantics: browser push requires in-app notifications enabled; native critical transactional alerts retain the existing forced-in-app behavior. This audit does not redesign channel storage or send unsolicited reminders through a disabled channel.

Reference checks: [MDN PushManager subscription and user gestures](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe), [Apple web push requirements](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [Supabase grants and RLS](https://supabase.com/docs/guides/api/securing-your-api).

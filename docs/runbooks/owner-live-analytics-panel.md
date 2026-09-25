# Owner live analytics panel

## Scope and entry point

The existing owner dashboard page now has a collapsible **Live User Analytics** panel above the existing marketplace dashboard. It is rendered only for owners after the original page guards succeed. It is closed by default and makes no requests until opened.

The existing marketplace dashboard and its legacy Analytics tab are deliberately unchanged. Their snapshot fields have NOT been migrated to this new per-source status presentation. This release does not claim that legacy zero fallbacks or whole-dashboard refresh behavior were repaired.

## Data and status contract

- `/api/admin/live-analytics` delegates access to the existing `requireApiOwner`. Unauthorized and temporarily unavailable authorization responses are preserved. Every response is private/no-store and noindex.
- Reuse the existing Israel-local traffic/presence reporting functions. No schema changes, new migrations, authentication changes, native-binary changes or trade/payment/commission/wallet implementation changes.
- Each source reports ready with an as-of timestamp, or unavailable with null data. The adapter requires a durable database and never presents the development in-memory fallback as live data.
- Only aggregate presence counts cross the new endpoint; no online user IDs/session keys. The new endpoint does not call the trading dashboard snapshot.
- The client distinguishes unavailable, stale and genuine zero. Invalid/missing counts are not converted to zero. Numbers use grouping separators.
- Poll every 30 seconds while open/visible, with one request at a time and a 15-second abort timeout. Hidden/closed/unmounted views stop work. Explicit logout or 401/403 clears the snapshot and stops automatic retries. Network errors do not log out the account.
- Hide counts after a failed refresh, at 90 seconds of age, or across Israel midnight. Timestamps are anchored before querying to avoid displaying yesterday's result as today's when a request spans midnight. Freshness means successful reads, not fresh visitor events.
- Arabic/English labels show the named reporting timezone, per-source read times, coverage caveats and top pages/referrers. Referrer groups can overlap; Direct includes absent referrers. These are not marketing-attribution or unique-person guarantees.

## Validation

Run `node scripts/check-owner-live-analytics.mjs` using the existing TypeScript dependency. The 48 focused offline tests cover the actual contract, polling controller, adapter, route and JSX text output using fixtures. They include malformed values, zero/unavailable/stale, summer/winter midnight, authorization delegation, partial failures, logout, timeout, visibility, teardown, nonoverlap and the original owner-page guard/destination hash.

Strict TypeScript checking was run for the pure contract/poller and their existing timezone helper. JSX tests use a lightweight runtime fixture, NOT a real React DOM/browser/device session. Full project lint/types/build must be assessed separately from these local checks and the Vercel preview.

## Release acceptance still required

1. Exact candidate Vercel preview/build and review before merge; exact production commit/aliases after merge.
2. Signed-in owner-screen totals against a timestamped read-only Supabase snapshot. No borrowing session tokens or creating fake production users/events.
3. Real iPhone/Android app and mobile/desktop viewport acceptance. An observed platform label is not a hands-on device test.
4. Full hosted suite when runners become available. A job that executed no steps is not a test pass.
5. Migration of the legacy Analytics-tab snapshots to explicit status handling remains a separate UI task.

Live business counts, identifiers and credentials must not be published in this public repository. Keep verification snapshots private.

# Owner analytics consolidation and release gate

## Authoritative user/traffic display

Use **Live User Analytics** above the owner dashboard. It is the only user/traffic display after this consolidation. Open it to view Israel-local activity, recorded visitors/tab sessions/page views, platform/device counts, top pages and referrers. The panel remains collapsed by default and reads independently while open and visible.

The old Analytics tab retains marketplace/business snapshots and management controls, not duplicate user/traffic counters with missing-to-zero fallbacks. No claims of complete measurement, guaranteed uptime, historical backfill or search ranking are implied.

## Failure isolation

The legacy `getAdminPrepDashboardData` loader no longer calls the optional presence/traffic aggregators or returns their obsolete fields. The existing owner-only live endpoint remains the reporting entry point, retaining its per-source unavailable states, freshness timestamps and valid-session checks. Thus an analytics-specific query failure does not reject the marketplace dashboard's combined load. A general database outage can still affect both; this is not an availability guarantee.

The cleanup in `alpha-exchange-store.ts` removes only owner-reporting imports, calls and result fields added in #283/#286. No trade mutation, payment, commission, wallet, authentication or database-schema implementation changes. Full candidate diff review is required to confirm this narrow scope.

## Build-time verification

`npm run build` now runs `npm run test:owner-analytics` before the existing production compiler. That command runs the live-panel fixture suite, reporting-boundary fixture suite and source-boundary consolidation checks. It uses existing dependencies and no network, production credentials, synthetic production rows or additional paid agent tasks. Any failed check stops the build.

This adds a focused hosted gate on Vercel while GitHub runner access is unavailable. It does not disable or replace GitHub Reliability Shield or establish that its full unit/browser suite passed.

## Release acceptance

- Verify the exact PR head's focused test output, production build and review.
- Confirm the final merge contains only this batch, then check the production commit and official domain aliases.
- Check unauthenticated requests to the private endpoint are rejected, separately from positive owner-session acceptance.
- Compare a signed-in owner's live panel with an authorized read-only database snapshot at compatible timestamps. Do not scrape session tokens or change user roles to manufacture access.
- Test actual installed iOS/Android apps separately; a recorded platform label is not a real-device test.
- Keep public SEO discovery intact and preserve existing lesson/trade login, verified-email and seller-approval controls.

Outstanding environmental/device checks must stay explicit in the private release report. Do not publish private business counts, visitor identifiers, contacts or credentials in this repository.

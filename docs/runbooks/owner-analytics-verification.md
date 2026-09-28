# Owner analytics release verification

## Scope of this batch

- Classify recognized iOS/Android React Native WebView visits separately from mobile browser visits. This is descriptive analytics, never an authentication or authorization signal.
- Keep existing visitor and tab-session identifiers. A visitor is a browser/storage identifier, not a verified unique person. Sessions remain tab-scoped; this batch does not introduce a new inactivity definition.
- Skip collection when storage or secure random generation is unavailable, or Do Not Track / Global Privacy Control is enabled. No fingerprinting or alternative tracking is used to bypass a preference.
- Avoid duplicate collector effects for a single route while counting navigation back to an earlier route.
- Strip query strings/fragments from client page paths; store only external referrer hostnames. This batch does not change the server event schema or add location tracking.
- Return HTTP 200 from the event endpoint only after an insert affects one row. A missing database or failed insert returns a generic, non-cacheable 503. No raw database error is exposed.

No schema migration, trade/commission/wallet logic, login implementation, native binary or owner authorization rule is changed.

## Reproducible focused checks

Run `node scripts/check-traffic-analytics.mjs` after installing the repository's existing dependencies.

The script compiles the actual helper/store into an isolated context and exercises their behavior with browser and Postgres fixtures. It also checks parser-level validity of the React collector and API handler. These are focused offline regression checks, NOT an actual React rendering test, live database query, full-project typecheck, full test suite, or real-device certification.

## Release acceptance (mark only from evidence)

1. Confirm the exact PR head and Vercel preview deployment agree; inspect the full diff and any review findings.
2. Confirm the merge commit is READY in production and assigned to both official domains.
3. Check production serverless POST `/api/analytics/event` responses, separately from middleware logs. A 200 after this change means the handler observed one inserted row, but does not prove dashboard aggregation accuracy.
4. With authorized read-only database access, reconcile genuine recent `traffic_events` rows with owner-dashboard counts. Do not manufacture ordinary production page views, fake users or fake trades as proof.
5. Check the signed-in owner dashboard and verify non-owner accounts cannot read `/api/alpha-exchange/admin-prep`. Source currently uses `requireApiOwner`; browser/API acceptance is separate.
6. Use actual installed iOS and Android apps and ordinary Safari/Chrome to confirm native-vs-web attribution. The existing shell supplies ReactNativeWebView through `onMessage`; old installed builds and other native screens still require verification.
7. Test browser storage restrictions and navigation on real mobile/desktop browsers. Analytics failure must not interrupt login, page navigation or a trade.

## Remaining gaps to review explicitly

- Dashboard unavailability: the existing read helper still returns an empty numeric summary when no pool is configured. A visible availability indicator must be assessed before calling every zero count verified.
- Day boundaries currently follow the database session timezone via `date_trunc('day', now())`; verify and label the business reporting timezone before claiming Israel-local daily totals.
- Network failures, privacy preferences, script blockers and unknown native platforms can prevent collection. Existing historical web-attributed events cannot be reliably relabeled as native after the fact.
- Do not infer end-to-end correctness from a green build, no review suggestions or no recorded runtime errors. GitHub jobs that never start or are skipped are not passing tests.

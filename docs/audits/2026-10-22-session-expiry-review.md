# Session expiry validation — 22 October 2026

Base: `473ae054bb0b0e7c4be68733320300ec692d3831`.

Both session readers compared `new Date(session.expiresAt)` with the current
time. A malformed or missing date produces an invalid date, whose comparison
is false. The direct session reader and combined principal reader therefore
accepted a matching retained session with an unusable expiry. The old check
also accepted a session at its exact deadline and could coerce non-string
payload values into dates.

This requires an existing matching session record and token; the finding is
not evidence of unauthenticated account access. A read-only production check
of 156 session rows found zero malformed expiry payloads and zero discrepancies
between the JSON expiry and the typed database column. The 117 expired rows
are retained records, not evidence that those sessions can authenticate.

The shared guard now requires a string expiry that parses to a finite future
time. Invalid or expired sessions follow the existing deletion and local cache
invalidation path. Valid sessions keep their original deadline. No session
duration, account-role, cookie, or database schema policy changes.

Verification:

- The unchanged source failed 14 of 20 new session-reader cases.
- All 20 cases pass after the change, including both readers, malformed/missing
  and non-string expiry values, exact-deadline rejection, ordinary expiry,
  valid future sessions, and isolation of another account's session.
- Eight focused authentication/session suites passed 54 tests.
- Root TypeScript and lint for both changed TypeScript files passed.
- Full candidate CI, merged-source CI and production verification remain
  separate release requirements. No production session data was changed.

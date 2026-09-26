# Owner dashboard action recovery — 27 September 2026

Continuation of owner controls issue #299 after production commit `250391a9edbaa42408f57ca519e852d8375254eb`.

## Fixed gap

The shared dashboard helper received an already-started fetch, so a guard inside the helper could not prevent duplicate writes. It treated HTTP success with missing JSON as success and had no persistent recovery for an ambiguous result. Manual commission and emergency broadcast handlers had separate versions of the same lifecycle problem.

The dashboard now prepares request descriptors without sending them. The executor persists an opaque pending marker before one request, bounds both transport and response-body parsing, checks each endpoint's acknowledgment, and blocks a second shared dashboard action until the first result is resolved. No request body, wallet address, reason, name, broadcast content or credentials are stored in the marker. Existing API authorization and financial logic remain authoritative.

A confirmed write and a failed dashboard refresh are reported separately. Unknown outcomes survive remount and are not replayed. Recovery reads current data; unknown results require explicit audit acknowledgment. A response arriving after the deadline cannot recreate a cleared marker. Successful payment checks are distinguished from completed checks that have not verified payment.

## Scope inventory

| Action family | Coverage in this change |
| --- | --- |
| Seller availability / vacation | Shared single-attempt executor |
| Recovery-wallet settings | Shared single-attempt executor |
| Listing approval, rejection, changes requested, renew, extend, close and force close | Shared single-attempt executor |
| Listing deletion / designated smoke-test purge | Shared executor; no live deletion performed |
| Applications approve/reject and approval-email resubmission | Shared executor; email accepted-for-delivery contract preserved |
| Beta invites, feedback status and announcements | Shared executor |
| Commission rejection/reset, manual issue, manual mark-paid and reverification | Shared executor; no live payment mutation performed |
| Force-expire listings, trust recalculation and emergency broadcast | Shared executor; no live broadcast performed |
| Account roles, disable, suspension/revocation and ranks | Previous dedicated recovery retained |
| Reviews and store submission | Excluded as requested |
| Nested owner panels and installed-device acceptance | Not claimed fully accepted by this change |

## Validation

- Nine focused suites: 88 tests passed, including real dashboard component handlers, pending-operation recovery and owner/non-owner privacy projections.
- Type checking and focused lint passed before final build; the build also checks application types and lint.
- Original full build gates passed; final production compilation is checked separately for the final source tree.
- No real customer account, listing, trade, payment or notification was mutated for verification.

## Remaining evidence and external dependencies

- Authenticated browser and installed iOS/Android acceptance remain unverified; the available browser has no Alpha session.
- No new real commission payment has been observed completing automatic verification after the preceding release. Empty successful cron scans are not payment acceptance evidence.
- VPN/proxy/Tor blocking still needs its provider account/key and acceptance checks. TradingEconomics and Twilio retain their previously documented provider status/approval dependencies; no new provider message was sent.
- Requested Expo patch ranges are present in the current manifest. This does not prove installed-device acceptance.
- GitHub Reliability Shield run `36273373701` for the preceding release reports a failed quality job with no recorded steps and skipped critical-browser job. Detailed job/annotation endpoints are not available through the connected GitHub fetch tool. The underlying cause remains unverified; this report does not label that CI run green.
- Issue #299 is not closed on the strength of a build or these focused tests.

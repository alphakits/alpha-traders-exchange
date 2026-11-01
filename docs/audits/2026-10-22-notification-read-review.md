# Notification read correctness and response formatting — 22 October 2026

Base: `9c609ad594abd8bd3973bc1641f8ed67c03a6668`.

The notification list route converted a missing or blank `limit` into zero.
The store then clamped it to one, silently returning only one item instead of
its established default page. Missing and blank pagination inputs now retain
the store defaults; explicit values retain the existing clamping behavior.
Authenticated notification lists also declare private, non-stored responses.

Notification enrichment previously rebuilt identity matchers for every item.
This change reuses those matchers within one response, keyed by the exact
trade and listing objects. Historical buyer and seller aliases retain their
original context and ordering. Owner projection stays separate from member
masking. Nothing is retained across responses or account changes.

## Verification

- The unchanged route failed three missing/blank limit cases and the explicit
  no-cache-header check. Four other route cases passed.
- The repaired route passes all eight cases, including explicit pagination,
  forged recipient input and unauthenticated denial.
- Three batch privacy cases pass: large-history pagination and masking,
  different historical aliases on different trades/listings, and renamed
  identities on the next response.
- Eight related suites pass 55 tests; together with batch privacy, 58 tests pass.
- Root TypeScript and changed-file ESLint pass.
- The first local optimization attempt exposed a removed variable still used
  by trade snapshot projection. The regression caught it before publication;
  restoring the existing recipient binding resolved it.

The controlled local profile used 502 synthetic identities and 600 account notifications sharing one no-trade context,
with a 200-item response and five runs before and after. Median time fell from
319.833 ms to 38.820 ms (about 8.2 times faster). The complete response retained
the same SHA-256:
`3700086fddc35e543f1eb0e1736d489cc92225b2620d50a6c27dbb60493d2d7e`.

This profile includes the in-memory snapshot/read and response construction.
It is not a production HTTP benchmark and does not close the live-latency
finding D105. Full candidate and merged-source release gates must pass before
production promotion. The historical WebKit focus issue and accounting
provenance gaps remain separate open findings.

## Bounded fresh-advisory recovery

The original candidate's CI1122 attempts 1 and 2 stopped before unit tests:
the fresh npm advisory subprocess reached its 90-second deadline. The seven
functional database/browser/phone jobs passed; release acceptance correctly
failed. A separate full unit run passed 5,881 tests across 555 files, but did
not replace the required CI gate.

The installed npm CLI allows a request to wait 300 seconds by default. Its
advisory POST could therefore remain stalled beyond the wrapper's entire
90-second budget. The wrapper now allows at most three fresh processes,
each limited to 30 seconds and the remaining shared deadline. Requests are
limited to 10 seconds with npm's own retries disabled. Only process timeouts
without report output or recognized transport-only errors can trigger a retry.

A complete report is assessed immediately. Malformed/incomplete reports,
authentication or certificate failures, partial report data, changed advisory
severity and new moderate/high/critical advisories still block release.
The exact three guarded backports and their source-integrity checks are
unchanged. Logs include fixed error classifications without registry response
bodies or credential-bearing URLs. No cached report or registry substitution
is used by the release gate.

Nine of 18 transport tests failed against the original wrapper; all 18 pass
afterward. The 12 existing advisory-policy cases also pass. Root TypeScript,
changed-file lint and an actual fresh advisory check pass. That fresh check
retains 17 explicitly reported guarded findings (14 high, 3 moderate, no
critical), and has zero unreviewed blockers; it is not a clean npm audit.
New candidate and merged-source CI must still pass before promotion.

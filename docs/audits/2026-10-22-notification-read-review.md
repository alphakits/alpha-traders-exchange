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

The controlled local profile used 502 synthetic identities and 600 notifications,
with a 200-item response and five runs before and after. Median time fell from
319.833 ms to 38.820 ms (about 8.2 times faster). The complete response retained
the same SHA-256:
`3700086fddc35e543f1eb0e1736d489cc92225b2620d50a6c27dbb60493d2d7e`.

This profile includes the in-memory snapshot/read and response construction.
It is not a production HTTP benchmark and does not close the live-latency
finding D105. Full candidate and merged-source release gates must pass before
production promotion. The historical WebKit focus issue and accounting
provenance gaps remain separate open findings.

# Alpha Wallet: platform session integration verification

Date: 4 November 2026. Decision: **verified development checkpoint; not ready for live funds or deployment**.

The complete isolated CI pipeline passed for commit [`f3422f9267562522da93285193d21dc604f8f40e`](https://github.com/alphakits/alpha-traders-exchange/commit/f3422f9267562522da93285193d21dc604f8f40e), tree `488e5c2dd1b431ca516cabe8a86a7f92eea0f0a7`, on `feature/alpha-wallet-dev-20261104`. The user's no-live-launch restriction remains in force.

## Result

| Executed gate | Result |
| --- | --- |
| Complete wallet suite, including new platform resolver tests | **491 passed across 17 files** |
| Targeted existing/new platform authentication regressions | **87 passed across 5 files** |
| Combined non-overlapping test total | **578 passed, 0 failed, 0 pending, across 22 files** |
| Full-project TypeScript | Passed locally and in CI, with `--noEmit --incremental false` |
| Native PostgreSQL concurrency harness | All six checks passed again on this commit |
| Native PostgreSQL backup/paused restore harness | All six checks passed again on this commit |
| Offline wallet demonstration | Passed: 500 principal delivered; 10 separately funded commission recognized |
| Chromium English desktop / Arabic mobile rehearsal | Passed again, including reservation and withdrawal response-loss recovery; zero page/console errors |

The [successful CI run](https://github.com/alphakits/alpha-traders-exchange/actions/runs/41913708420), job `126867684375`, completed by **21:15:42 UTC / 23:15:42 Jerusalem time**. It used Node 24.22.1, disposable PostgreSQL 17.11 and Chromium 149.0.7827.55. The 87-test gate is targeted authentication regression coverage, not a claim that every marketplace test in the repository was run.

## What the new integration does

### Web authentication retains actual metadata

The new `getAuthenticatedSessionByToken` returns the canonical account and stored session expiry from the repository's existing combined session/account/application query. It does not manufacture an expiry or combine separately fetched account/session values. The new `getCurrentSessionForAuthorization` re-reads the server cookie and uncached metadata without renewing cookies or using React's request memoizer.

Strict reads refuse both configured-database initialization fallback and query failure. A retained active account in the development cache cannot authorize the wallet during an unavailable durable read. Existing user-only callers retain their prior compatibility and fallback behavior. Explicit in-memory repositories are still available for isolated fixtures; those results are not durable authentication evidence.

### Mobile authentication retains and rechecks the access session

The new `requireMobileApiSession` exposes the validated device-bound session's ID, subject and access expiry, plus its canonical account. It supports a trusted account loader so tests can use an isolated store. The existing `requireMobileApiUser` retains its original gates, account loader and exact route-facing result shape.

The development wallet resolver validates the bearer/device session again after the asynchronous account read. It requires the same session identity, subject and access expiry. Revocation, replacement or expiry during that wait refuses authorization. An unavailable account/session read propagates failure without revoking otherwise valid credentials. Refresh expiry and client-provided TTLs are never substituted for access expiry.

### The wallet receives canonical, minimal evidence

Server-only development resolver factories connect these actual platform sources to `createWalletAccess`. They map canonical account identity and seller status, strict email verification, actual phone evidence or the existing exact-account exemption, adult confirmation and real session expiry. They exclude email, phone, password/session hashes and tokens from the wallet identity object.

The factories check simulation-only runtime restrictions before and after asynchronous work. No production wallet route was installed. A source scan found no `src/app` references to the new metadata/resolver APIs. The existing mobile route helper still strips the new metadata from its result.

## Tests that establish this boundary

The 23 new wallet resolver tests exercise actual web store/cookie helpers, actual mobile token issue/validate/revoke/replace methods with an isolated session store, canonical account lookup and the real wallet access gateway. They cover exact stored expiry, canonical suspension and verification gates, minimal projections, device/subject mismatch, post-await token changes, fresh private-response denial and runtime restrictions.

Five new repository tests run the actual combined/account SQL through isolated PGlite. They preserve an active fallback while deleting or disabling durable evidence, and inject query and initialization failures. Strict readers reject that fallback. Legacy user-only behavior remains tested separately. The existing expiry matrix now also exercises the new metadata API, including invalid and exact-deadline expiry. The unchanged web API, mobile token and phone-enforcement tests passed too.

The implementing agent's focused 110-test run passed; its final test-fixture typing adjustment was followed by another 23/23 resolver run and TypeScript verification. The complete CI result above verifies the final saved source. A separate agent reviewed the implementation and found no remaining material issue. That review is not an independent professional security audit.

## Recovery and browser regression evidence

The new commit reran the actual native concurrency and backup drills described in the [earlier recovery/browser report](phase3-verification-2026-11-04.md). The concurrency fixture again conserved 500 principal as 300 delivered plus 200 reserved, with 6 separate commission due. The restored wallet again reopened paused with 300 available plus 200 held, retained its original payout identity and submitted nothing during lookup-only recovery.

The browser again let the real loopback server commit before truncating a reservation or withdrawal response. Reload/retry retained the original request and wallet identity and did not advance the committed revision again. The withdrawal still had one 25-USDT hold, 75 available and zero provider submissions. The full trading flow delivered 500 USDT and recognized the separately funded 10-USDT commission, leaving zero reserved principal and zero commission due.

The [preserved English/Arabic captures](phase3-verification-2026-11-04.md#browser-evidence) were rendered and inspected at commit `23ee55f`. The server, page and browser-check sources are byte-identical in this later commit. New screenshots were also generated by this CI run; their hashes and artifact location are in the machine-readable record. The rehearsal's role switcher remains a synthetic fixture control, separate from the new session adapters.

## Exact retained evidence

[platform-verification-results.json](platform-verification-results.json) contains the final test names/statuses, source hashes, run/job steps, native outputs, browser recovery results and artifact metadata.

CI artifact `13363218797`, `alpha-wallet-simulation-evidence-f3422f9267562522da93285193d21dc604f8f40e`, contains 1,979,523 bytes. The downloaded ZIP matched GitHub's published digest:

```text
sha256:1235c0a209d290be231efa317bcca575613cb0d5d2142437b7b49f4a3ff89de7
```

The temporary artifact expires on 18 November 2026; this report and its machine-readable outcomes remain saved with the development branch. The workflow uses read-only repository permissions, explicit disposable loopback databases, synthetic providers and no deployment steps or production secrets.

## Launch boundary and remaining work

The wallet branch's Vercel automatic deployment remains disabled; a read-only check after saving the source observed **zero branch deployments**. No main merge, production migration, real key creation, signing or transfer was performed.

This checkpoint establishes the development session-source boundary, not deployed login configuration or atomic revocation across authentication storage and a financial commit. Mobile token/account reads remain separate. A configured repository already in initialization fallback continues to reject strict reads until reinitialized. Production HTTP gates, real withdrawal step-up issuance and deployed wallet screens remain unfinished.

The [atomic marketplace terms design](transaction-integration-design.md) documents the next storage integration: initial reservations versus corrections to existing reservations, shared transaction ownership, durable acceptance receipts, legacy-writer protection and immutable v1 replay/backup compatibility. It is a design for review; no durable resize or marketplace cutover is claimed.

Custody/signing and test-account selection, a concrete bank/cash verification authority, real chain observers, platform completion/outbox integration, operational recovery/monitoring, production permissions and independent security review remain launch gates. See [launch-readiness.md](launch-readiness.md). No passing test automatically authorizes deployment or live funds.

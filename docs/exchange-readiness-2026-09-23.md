# Exchange readiness after the 23 September changes

Baseline: production commit `1590e5d49eaf6a3d1df9d1832feabbde72002a10`.

## Fixes from this audit

- Authenticated website actions and native seller/admin API actions now use the verified account ID for their existing rate limit. Sellers, buyers and owners sharing a carrier or Wi-Fi address no longer consume each other's action budgets. Limit counts, windows, authentication, authorization and shared database enforcement are unchanged. Public authentication limits remain separate.
- Trade rooms pause background reads and scheduled stream retries while the browser reports it is offline. Returning online renews the stream and refreshes the authoritative trade once; it does not replay a payment, message or completion. The current trade and unsent draft remain visible.
- The release rehearsal now covers 15 sellers and 75 competing buyers, including all three payment methods and amount corrections.

## Verification

| Area | Evidence |
| --- | --- |
| Regression suite | 361 test files, 2,802 tests passed. |
| Additional native route check | 12 seller-workspace and commission route tests passed after native rate-limit scoping. |
| Website and native types | Both TypeScript checks passed. |
| Code quality and build | Full ESLint, patch integrity and local production build passed. The isolated build has no production credentials; hosted deployment validation remains separate. |
| Source readiness | 238 mobile source checks passed; this is distinct from store approval or physical-device acceptance. |
| Shared-network regression | Before the fix, 5 of 15 seller listing submissions returned 429. After the fix all 15 succeeded, while one account still reached its limit after 10 attempts even when changing IP addresses. |
| Offline recovery regression | Before the fix, a 30-second offline interval caused 7 extra room reads. The regression now passes for bank transfer, cardless ATM and face-to-face, retaining the draft and reopening one stream on recovery. |
| Concurrent marketplace integrity | 15 independent bank-transfer lifecycles; 75 buyers competing for one listing; and 75 buyers competing across 15 mixed-method listings passed. |
| Mixed-method settlement | One accepted request per listing; 60 declined competitors; seller amount proposals and buyer approval; cardless recalculation from the locked rate; wallet visibility; duplicate message/completion submissions; both participants' reviews; stock deduction and one commission per trade all passed. |
| Existing trade-room coverage | Action feedback, repeated taps, failed request recovery, cancellation races, pending terms, evidence, commission destinations, review navigation and suspended-stream recovery are included in the regression suite. |
| Today's existing changes | Saved contact persistence across repeated logins, remembered app login, session language, public identity privacy, ranks/profiles, seller completion, owner history/actions and commission processing are included in the suite. |

The scale rehearsal uses the actual store services with fictional accounts and an isolated in-memory repository. It verifies business-state integrity under concurrent calls. It does **not** measure production PostgreSQL throughput, multiple Vercel instances, sustained authenticated traffic, delivery providers, or physical iPhone/Android rendering.

## Live measurements

Only read-only unauthenticated diagnostics were run against production. No customer trade, payment, review, notification or account was created or changed.

- 15 simultaneous public listing reads all returned HTTP 200. Their response payload was an empty listing collection, so this is not representative of a populated, authenticated marketplace.
- Fresh connections from the execution environment took approximately 10.9–11.8 seconds in that batch, including approximately 8.6 seconds establishing TLS.
- A follow-up reused connection returned health in 303 ms and listings in 315 ms and 288 ms. The health route reported database processing of 30 ms initially and 3 ms on the repeated request.
- These figures separate observed connection cost from warm request performance. They do not establish a universal sub-second user experience or an uptime guarantee.

## Security and remaining validation limits

- The production dependency audit reported 0 high, 0 critical and 3 moderate package findings. The moderate chain is Expo Router → query-string → legacy decode-uri-component. The existing installation script backports the fixed 0.5.0 decoder; the malformed-URI bounded-runtime and compatibility tests passed. The dependency metadata findings remain visible and are not represented as cleared.
- The existing production deployment was healthy and rejected unauthenticated owner actions in the preceding owner-controls verification. Release health/access checks must also be performed after these new fixes deploy.
- Signed-in production browser verification could not be completed: the available browser timed out retrieving the live page. No physical-device acceptance or sustained authenticated production load test was completed during this audit.
- GitHub Actions was already blocked by the account billing lock. Local tests/build verification and deployment status must not be described as a successful hosted browser workflow.
- The repository's LFS budget blocked downloading course videos into the isolated checkout. This audit used tracked LFS pointers; it did not establish whether live course media are affected.
- News-provider activation, Twilio approval and app-store approval are external gates. This exchange audit does not activate those services or certify those approvals.

Readiness conclusion: the checked application flows and concurrent state invariants pass the automated evidence above. Production capacity at 15 active sellers with sustained buyer traffic remains a separate validation requirement; zero defects or uninterrupted availability cannot be certified from this run.

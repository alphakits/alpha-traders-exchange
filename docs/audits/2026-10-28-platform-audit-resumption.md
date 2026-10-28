# Platform audit resumption — 28 October 2026

Status: OPEN. This is a continuation checkpoint, not full acceptance or a new application release.

## Scope and baseline

Resume the original platform audit; do not develop or change the separate USDT request project.
The saved 24 October report (update 139) recorded 116 requirements: 22 PASS, 12 FAIL, 82 NOT TESTED, and 136 findings. These are historical counts. This continuation does not silently promote them or claim to have revalidated the entire requirement matrix.

Repository and hosting inspection shows subsequent releases already occurred. Preserve them. The production web now runs commit `81a1143025c5162bedb6676a1b77f8793a7e7232` from PR450, rather than the PR442 baseline in the saved audit. Wise remains subject to the separately documented activation blockers; this audit performs no feature activation.

## Fresh evidence

Observed on 28 October, approximately 16:40–16:56 UTC (18:40–18:56 Asia/Jerusalem).

| Check | Evidence | Limit |
| --- | --- | --- |
| Production identity | Domain lookup for www.alphatraders.co.il identifies READY production deployment dpl_Dab8NV6tq8Fj67QiGmuvzC1Fj1FV at 81a1143 | Hosting identity, not authenticated journey acceptance |
| Exact tested tree | Git commit API returns tree 9f804d76ea68657287c493403a2c0be5695f3ca9 for both production commit and CI candidate 52c401152e1352c56891560bbd7d9d2cc6175489 | Verified source equivalence |
| CI | All 12 jobs of [Reliability Shield 1202](https://github.com/alphakits/alpha-traders-exchange/actions/runs/40711114142) completed successfully | Existing isolated run, not a newly executed production suite; skipped cases remain unverified |
| Worker packaging in CI | Quality job explicitly passed release safety gate, monitor contracts, and packaged continuous monitor worker | Does not prove deployed runtime |
| Live health | /api/health HTTP 200, database ok, responseTimeMs 28; Server-Timing health 29 ms and db 28 ms at 16:43:59 UTC | One server measurement; not user-perceived latency |
| Anonymous session | /api/auth/me HTTP 200 with user:null and no-store at 16:53:09 UTC | Signed-out path only |
| Public pages | /en, /ar, /en/login, /ar/login, /en/register, /en/forgot-password return HTTP 200 with expected titles and nonempty content | Server response only except English login |
| Exchange access | Anonymous /en/usdt-exchange fetch ends with Login page content | Redirect-following connector; initial redirect status not recorded |
| Market endpoint | /api/market/center returns HTTP 200 with no-store | Payload freshness and timing not asserted |
| Browser | Live English login displays email/password fields, Remember Me, recovery/registration links and enabled Login | No credentials entered; browser control was very slow, not attributed to the application |
| Runtime errors | Current deployment error/fatal scan covering 15:53:01–16:53:01 UTC returns no records | Bounded scan, not uptime guarantee |
| Worker | Latest reported deployment remains d153a7ed-57f0-4667-b4af-ea6606791d40, SUCCESS, created 21 October | New source has not run |
| Discord observation | Bounded worker logs show member_not_in_guild role-sync retries | Do not interpret provider/member absence as a general outage |

The role-sync source has bounded exponential retry, an eight-attempt dead state, and periodic reconciliation. Missing-member failures are persisted as degraded and logged through the warning path in current source. No account identifier or raw private log is included here. No financial, identity or outbox records were edited.

## Prepared worker release

The old staged target cb64276a was replaced with the **current tested and already-live web commit** 81a1143025c5162bedb6676a1b77f8793a7e7232.

Read-back of the production staged patch confirms:
- Exactly one existing discord-worker service and four source fields (repo, branch, commitSha, image).
- No service creation/deletion, volume change, shared-variable change or private-network change.
- Destructive flag false.
- No deployment triggered. The running service remains unchanged.

The worker Dockerfile pins Node 22.23.4 and uses its standalone dependency lock and consumer checks. The web's Node 24 runtime is a separate image and must not be used to infer the worker version.

The previous worker deployment confirmation was cancelled. The new exact candidate needs explicit deployment confirmation before committing the staged patch. After deployment, require terminal SUCCESS, actual source/image/runtime verification, health and monitoring continuity, and bounded provider-error review. The existing successful worker deployment is the rollback reference. Never use READY web status as worker rollout evidence.

## Remaining acceptance gates

| Workstream | Required next evidence |
| --- | --- |
| Worker rollout | Confirm prepared deployment, verify terminal result and actual runtime; investigate sustained role-sync degradation without changing user membership or fabricating success |
| Buyer/seller/owner sessions | Consenting test identities in an isolated environment; exercise complete listing, acceptance, cancellation, expiry, receipt, dispute, completion, and owner paths; include concurrent sessions and permissions |
| Provider delivery | Explicitly authorized SMS/email/push tests with real destination consent and delivery evidence; provider acceptance alone is insufficient |
| Notification PR447 | Remains a separate draft: production binding/runtime-role confirmation, isolated staging, reviewed migrations/private grants, scheduler execution and real-device delivery evidence before activation |
| Performance | Representative login, notification and exchange end-to-end samples under concurrency; preserve strict database threshold and earlier failures |
| Market diagnostics PR446 | Draft instrumentation requires current-source integration and locked-dependency CI before release; no speed improvement is established |
| Recovery | Hosted isolated crash recovery, backup/restore and replay checks with rollback verification |
| Historical reconciliation | D98 historical commission provenance (ten previously recorded gaps); preserve records and require evidence before any correction |
| Intermittent browser issues | D95/D110 original causation remains unresolved; passing later suites does not establish root cause |
| Physical devices | Actual supported iPhone/Android/desktop journeys and display/delivery checks; browser emulation is separate evidence |
| Full requirement matrix | Reconcile all 116 historical rows against current release and explicit acceptance evidence before reporting new counts |

## Environment limitations in this continuation

- Local git/archive downloads failed due DNS/network availability; no clean local dependency install or fresh local test execution is claimed.
- The connected remote MARKPC device is offline.
- Browser session starts signed out; no authenticated acceptance or real messages/payments were performed.
- The large saved audit can be read, but targeted find requests failed; retain the original rather than replacing it with this abbreviated checkpoint.

Application code, production database/schema, credentials, financial records and live service deployment were not changed by this checkpoint. The only hosting mutation is the reviewed, reversible staged worker source update. This document is intentionally a draft until the open acceptance evidence is supplied.

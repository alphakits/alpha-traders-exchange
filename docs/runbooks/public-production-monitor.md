# Public production monitoring and release enforcement

This change is prepared for review. Creating these files does not activate a
service, change branch protection, or modify production. The public monitor
does not deploy, restart, log in, or submit transactions.

## What the monitor measures

`python3 scripts/production_health.py --output /tmp/alpha-health.json`

Pass `--previous /path/to/previous-report.json` to identify new and resolved
incidents and suppress unchanged incident notifications. JSON is checkpointed
after each completed response, using an atomic replace. Incomplete runs remain
explicitly incomplete; they cannot resolve earlier production incidents.

The monitor uses the existing network path, proxy environment and certificate
validation. It checks health/database readiness, public listings, all three
live market prices, bilingual home/login pages, localized exchange-entry
redirects, and deduplicated JavaScript URLs from the returned HTML. Assets use
HEAD, with a bounded GET fallback only for 405/501.

Fresh health/listings requests and subsequent requests in a single curl process
separate connection setup from response latency. Each observation records UTC,
HTTP status, redirect headers, curl DNS/connect/TLS/TTFB/total timings, connection
reuse and health-route timing headers. Request start is estimated from observed
completion minus curl duration. DNS/connect measurements can describe a local
proxy, not the origin. `responseTimeMs` remains database-probe duration only.

No response bodies, cookies, credentials or public listing identities are saved
in the artifact. Only allowlisted response headers and contract results remain.

The default diagnostic thresholds are 3 seconds for setup, 2 seconds for repeated
network-inclusive responses after setup, and 1,000 ms for repeated database probes.
Health and market timestamps allow at most 180 seconds of age or 60 seconds ahead.
These are operational thresholds, not promised customer SLAs. A changed threshold
must be reviewed against collected evidence; never raise it to hide a regression.

Two matching recent component failures confirm degradation. A healthy retry
can resolve a transient content error, but repeated slow reused-connection
responses still report degradation. A proxy rejection stops expansion of that
run and records a monitoring gap. Actual website HTTP 401/403/5xx responses remain
component errors. A failed control makes the connection comparison inconclusive.

## Activate after review

1. Review and merge this change through the normal release process.
2. Manually run **Public Production Health** on `main`. Verify its public JSON
   contract results, connection reuse and evidence artifact before enabling it.
3. Confirm the GitHub Actions budget, then set the repository Actions variable
   `PUBLIC_HEALTH_MONITOR_ENABLED=true`. The prepared interval is five minutes,
   offset from the start of the hour. It consumes runner minutes and artifact
   storage; no new paid service is provisioned by this change.
4. Confirm the owner receives the intended GitHub Actions notification. Scheduled
   workflow notifications depend on the account that enabled/edited the schedule
   and that account's notification preferences. Test delivery; do not assume it.
5. Keep the existing broader Website Health Watch. It adds browser inspection and
   exchange regression coverage that this HTTP-only workflow does not provide.

The workflow conclusion represents **new incident notification state**. An
unchanged ongoing incident does not fail the notification step again; the job
summary and artifact continue to state the degraded/limited health explicitly.
A recovered observation is recorded in the summary. GitHub does not guarantee
delivery of a recovery notification when an account subscribes only to failures.
Unavailable historical artifacts mean deduplication is unavailable, not that a
previous incident was resolved.

GitHub schedules may be delayed or dropped, and public repositories can have
schedules disabled after inactivity. They are a useful independent check, not a
continuous uptime service. Before calling monitoring round-the-clock coverage,
configure an authorized external monitor with at least two independent probe
locations and an alert for a missing monitor heartbeat. Account/billing failures
and a blocked chat runtime must not silence every monitoring path. That service,
its cost, destinations and alert delivery still require activation and validation.

## Enforce the release gates

On 2026-10-07 the `main` branch API reported protection enabled but no required
status checks, with enforcement off; the repository ruleset list was empty.
Reliability Shield runs alone do not prove merge enforcement.

Before changing protection, confirm exact check names from a successful PR run:

- `Unit, lint, and production build`
- `Mobile and desktop critical flows`
- `Mandatory phone gates and owner exceptions`

Require these checks for `main` and require an up-to-date tested revision. Add the
public monitor's offline contract test where its path filter actually triggers;
do not globally require a path-filtered workflow, which would block unrelated PRs.
Use the normal owner-reviewed protection change. Do not bypass a failing check.

Git-triggered production deployment also needs Vercel Deployment Checks or a
staged, tested promotion flow; branch checks alone do not establish that the
production alias waits for all CI. Verify the active team's deployment policy
before asserting that untested releases are blocked. No deployment policy or
security setting is changed by this patch.

## Respond and recover

- Confirmed health/database failure: inspect production errors and connection
  saturation with authorized read-only diagnostics. Retain request IDs and UTC.
- Market-only degradation: inspect market freshness and upstream availability;
  retain other passing components instead of announcing a whole-site outage.
- Shared setup delay with healthy reused responses: investigate the monitor path.
  Do not restart production or roll it back based on that evidence.
- New application failure tied to a release: prepare rollback to the last known
  good production revision, verify database compatibility and request the normal
  release approval. Do not automatically replay payments or trade writes.
- Recovery requires fresh contracts and normal reused response times, followed
  by guest navigation and the relevant isolated transaction regression tests.

Backups, restore rehearsals, regional failover, authenticated two-party trade
journeys, payment/notification delivery, native builds and real devices are
separate reliability controls. This monitor does not claim to verify them.
No finite test suite or hosting arrangement can guarantee 100% uptime or no bugs.

References:
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
- https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs
- https://vercel.com/docs/deployment-checks

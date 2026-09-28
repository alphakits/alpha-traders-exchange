# Production health-latency release runbook

## What failed

Production health probes intermittently took 11–20 seconds or timed out. The
successful responses still reported `status: "ok"` and `checks.database: "ok"`,
usually with low process uptime. That pattern points to serverless cold-start
work rather than a persistent database outage.

The old `/api/health` handler imported the full Alpha Exchange repository. On a
new serverless process the repository executed every schema bootstrap statement
sequentially before running its database check. This put migrations, indexes,
seed checks, and a large repository module on a public readiness hot path.

## Fix in this release

- `/api/health` performs only `select 1`, without loading the marketplace
  repository.
- The database probe has a four-second upper bound and returns HTTP 503 with a
  sanitized degraded response if PostgreSQL is unavailable.
- The endpoint is explicitly dynamic and non-cacheable.
- Repository startup checks one schema sentinel before deciding whether legacy
  runtime bootstrap is required. An initialized cold process now avoids dozens
  of redundant DDL queries.
- `20260905223000_alpha_exchange_runtime_schema_parity.sql` moves the runtime-only
  tables and indexes into a forward-only deploy migration.

## Release order

1. Apply `supabase/migrations/20260905223000_alpha_exchange_runtime_schema_parity.sql`.
2. Deploy the reviewed application revision.
3. Probe `https://www.alphatraders.co.il/api/health` repeatedly from outside the
   deployment network.
4. Exercise login, marketplace listing load, one buyer workspace read, and one
   seller workspace read.
5. Keep the existing health watcher enabled.

The migration is idempotent and safe to retain if the application revision is
rolled back.

## Acceptance checks

Every successful health response must satisfy all of the following:

- HTTP status is 200.
- `status` is `ok`.
- `checks.database` is `ok`.
- `timestamp` is a valid current ISO timestamp.
- `responseTimeMs` is present and below the four-second readiness ceiling.

Example probe:

```bash
curl --fail-with-body --max-time 6 \
  --write-out '\nHTTP %{http_code} total=%{time_total}s\n' \
  https://www.alphatraders.co.il/api/health
```

Run at least ten probes, including after an idle period likely to produce a cold
start. A timeout, non-200 response, non-`ok` application status, or non-`ok`
database status blocks release.

## Expected response contract

```json
{
  "status": "ok",
  "uptime": 12,
  "checks": { "database": "ok" },
  "responseTimeMs": 42,
  "timestamp": "2026-09-05T22:17:14.474Z"
}
```

Do not expose connection strings, driver messages, hostnames, SQL, or stack
traces in the public response.

## Rollback and escalation

- Roll back the application revision if health latency regresses or marketplace
  reads fail. Do not reverse the parity migration.
- Treat repeated HTTP 503 responses as a database/pooler incident. Verify that
  `SUPABASE_DB_URL` uses the Supabase transaction-mode pooler and that verified
  TLS remains enabled.
- Treat HTTP 200 responses with slow overall request time but low
  `responseTimeMs` as platform/network latency rather than database latency.
- Preserve request timestamps and platform logs when escalating; do not include
  secrets or customer data.

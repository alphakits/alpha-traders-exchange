# Provider history across process crashes

The retained receiving-history tests verified pagination and database compare-
and-swap behavior, but the pagination test reused the same Node process. It did
not demonstrate that the complete scanner-to-database flow survives a process
crash. The release gate now includes that missing acceptance boundary.

`scripts/check-commission-history-recovery.mjs` runs the real TRON, BEP20 and
Binance scanner adapters in separate Node processes against the existing
disposable PostgreSQL service. HTTP requests are redirected inside the test
worker to a loopback fixture that validates the expected request shape, bounds,
API-key headers and Binance HMAC signature. All credentials and deposits are
synthetic. Both the controller and child reject hosted databases, and unknown
provider origins are rejected before any HTTP request. No application source
or live financial behavior is changed.

The combined scenarios cover:

- Fifteen initial pages across three providers, with each continuation saved
  durably before the process exits.
- A real HTTP 503 after restart, retaining the interrupted TRON cursor and
  independently completed BEP20/Binance observations.
- Resumption at the saved TRON fingerprint, BEP20 page and fixed end block,
  and Binance offset; a fresh catch-up window is required before publication.
- A full new observation cycle after completion to include late indexing.
- `SIGKILL` immediately before persistence, with no saved progress or result.
- `SIGKILL` after committing progress but before publishing the result, followed
  by a fresh process reobserving the same receipts.
- Two independent workers waiting at the persistence boundary, then competing
  for one compare-and-swap publication; the loser releases no receipts.
- Exact cleanup of the disposable progress fixture.

Run after initializing the existing isolated concurrency database:

```sh
node scripts/check-postgres-concurrency.mjs
node scripts/check-commission-history-recovery.mjs
```

The workflow retains `test-results/postgres-concurrency/history-recovery.json`
with the exact commit, process count, checks and nonsensitive request fields.
The existing financial correctness, backup/restore and one-second performance
gates remain unchanged. The history test does not add new timing samples to
the financial action benchmark or change its threshold.

## Connection isolation repair

Review found that the previous audit guards checked `URL.hostname`, while the
installed PostgreSQL driver gives a `?host=...` connection option precedence.
An offline reproduction constructed a driver client without connecting: the
guard saw `127.0.0.1`, but the driver selected `external.invalid`. Query options
could also replace the checked user or port. No external connection was made.

The concurrency controller, its child runtime, restoration tool and both new
history tools now share one validator. It accepts only the two named loopback
fixture databases, the PostgreSQL schemes and the expected role; it rejects
query overrides and fragments before the driver sees them. Malformed input
returns a fixed error without exposing the original connection string. The
restoration target is validated again after changing its database name.

Three offline regression tests reproduce the driver's override, reject routing,
credential and TLS-file options, and preserve valid escaped fixture passwords.
The first two tests failed with the old guard and pass with the repair. They
run before the database acceptance steps in the release workflow.

These checks prove controlled process recovery when the gate passes. They do
not establish live-provider credentials or account behavior, actual deposits,
settlement, hosted Railway restart, or physical-device acceptance. Receipt
discovery remains separate from independent verification and reservation; the
fixture does not turn synthetic observations into payment proof. Those broader
acceptance requirements remain explicit in the current HTML audit.

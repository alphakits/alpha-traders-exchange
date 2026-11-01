# Lifecycle commit and publication audit

The isolated PostgreSQL run for `1a625fa811b8b9133bff2a4e7b04bb696f727565`
accepted 45 trades across 15 sellers and rejected the fourth trade for every
seller. Its burst of 90 duplicate completion calls exposed 15 exhausted
concurrency responses. Completion is now followed by one final authorized,
canonical read after the three bounded write attempts. This read acknowledges
an already committed completion; it never starts a fourth write. A real
uncommitted action still returns a conflict.

A separate regression test observed 18 notification/reputation publications
from three rejected completion attempts, with no committed completion. Trade
status mutations now collect publications on their isolated snapshot, including
notifications from nested listing-expiry helpers. Failed attempts discard the
collection. Trade notifications publish after the core commit. Trust events,
trust notifications and prestige email wait for the deferred trust write to
succeed. Repeated invocation of the returned deferred task shares one promise.
Existing direct callers outside lifecycle status mutation are not covered by
this scoped change and must be assessed separately.

The regressions exercise a successful competing completion, exhausted real
conflicts, a core database failure, a deferred trust write failure, successful
publication and a repeated completion/deferred-task invocation. Email is mocked
and no real customer message is sent. The in-memory repository does not emulate
PostgreSQL's selected-table writes; these unit cases prove publication ordering,
not isolated-table persistence or cross-process recovery.

The concurrency harness now records action time separately from deferred trust
work and preserves each request's error code, details and final database state
on failure. A successful functional check does not establish the requested
subsecond response target. The exact candidate's PostgreSQL run, restoration
check and complete release workflow remain the release gates.

The owner-dashboard form test now requires the UUID-v4 retry key added to
manual commission creation. The prior CI failure was an obsolete expected
request body; the required seller, amount and reason assertions are retained.

No production release or database migration is authorized by this document.

# Preferred locale mutation scope

Changing the interface language previously loaded the complete exchange snapshot
before updating the account. A concurrent write could also trigger a complete
snapshot rebase. The operation only needs users and seller applications for
existing account normalization.

The update now uses those canonical read dependencies on both paths, writes the
same users table, and invalidates the full store cache after committing a partial
snapshot. Repository transaction locks, concurrent change handling, session
preservation, route authentication and rate limiting remain in place.

Two regressions reproduce failure when unrelated full-snapshot reads are
unavailable, for English and Arabic. Additional tests cover concurrent password
and preference changes, preserved sessions, account removal, failed commits, and
unchanged timestamps. The isolated PostgreSQL harness also runs simultaneous
locale, password and session writes across four processes.

Local verification: 60 focused tests pass across seven files, with TypeScript
and targeted lint passing. The new database scenario must pass the existing CI
database gate. This change does not by itself establish hosted latency or
complete platform acceptance.

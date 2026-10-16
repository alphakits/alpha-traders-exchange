# Runtime schema baseline and controlled restoration

Read-only inspection of the live PostgreSQL catalog identified eleven tables
absent from the reconstructed migration chain. Their columns, defaults,
constraints, indexes, RLS settings and grants were inspected before writing
`20261017003000_runtime_table_baseline.sql`. The table definitions used for the
CI comparison are recorded in `scripts/integration/runtime-table-baseline.json`.

Four tables have current exact-name runtime references: `evidence_blobs`,
`marketplace_email_gate`, `marketplace_email_outbox`, and `rate_limit_windows`.
Seven tables are retained as legacy or dynamically used structures whose current
consumers have not yet been established: `notification_analytics`,
`notification_deliveries`, `notification_events`, `notification_queue`,
`notification_reminders`, `performance_telemetry`, and `trade_turn_states`.
Absence of a source match is not evidence that deleting a live table is safe.

The baseline creates missing tables without deleting records or altering
existing definitions. It preserves the observed server-only access and email
outbox RLS configuration, revokes PUBLIC access, and uses bounded lock/statement
timeouts. It does not rewrite production migration metadata or resolve every
historical difference between the two existing migration directories.

CI applies the baseline to an isolated PostgreSQL database, seeds 75 synthetic
accounts, replays it, and compares all eleven definitions against the inspected
catalog. After the concurrent business-engine tests, CI creates a `pg_dump`
backup, restores into a separate database, compares every runtime table's row
count and content fingerprint plus constraints, then verifies detection and
rollback of an induced corruption inside the restored database.

These procedures contain no production records or credentials. Their logs and
JSON reports establish executed results; this source document alone is not
evidence that a test passed. No production migration or recovery operation has
been performed as part of this change.

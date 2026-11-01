# Stable trade rows during snapshot writes

The successful PostgreSQL concurrency run on `d51e10e` measured direct action
median 1412.69 ms, p95 7491.44 ms and maximum 8344.83 ms across 240 successful
status calls. These measurements exclude deferred trust persistence and HTTP;
they do not satisfy the requested subsecond target.

Inspection found that snapshot persistence deleted and reinserted every
purchase request, notification, commission and audit row, including unchanged
rows. Besides unnecessary database work, this transient deletion could cascade
referencing records even when the parent was immediately re-created.

The repository now removes only missing IDs in those four tables and uses an
upsert for retained rows. It updates a row only when its stored columns actually
differ. The existing canonical lock, stale-snapshot merge and financial guards
remain in force. An intentional removal still deletes the record.

The embedded PostgreSQL regression creates synthetic cascading references to
all four record types, changes a request and notification, and checks that all
references survive and an unchanged audit row retains its physical identity.
It also verifies intentional deletion. The cross-process PostgreSQL harness
additionally retains 45 request references throughout all payment stages,
duplicate completions and process restarts.

This change does not claim that the subsecond target is met. The next exact
candidate run records fresh timing and acceptance results. No production row,
payment or customer notification is modified by these tests.

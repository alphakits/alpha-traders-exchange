# Durable trade trust reconciliation

Status: candidate change; production remains unchanged.

The delayed completion callback previously saved the entire users collection from
the trade's earlier snapshot. A regression completed a trade, committed a newer
account restriction and password hash, then invoked that callback. The newer
security settings were overwritten. A lost callback also had no durable record
for the scheduled maintenance process to recover.

Terminal trade transitions now commit a server-owned reconciliation intent with
the trade, financial state, notifications and activity records. Trust calculation
runs after commit using current records. If any database version changes while
it waits, calculation repeats against canonical records under the existing
transaction lock. It never replays the previous account collection. Derived
state and the intent's completion marker commit together; publications follow
that commit. Concurrent calls in one process share a bounded drain, while
cross-process calls recheck canonical markers. Stale and older writers preserve
completed markers instead of reopening or discarding work.

The existing five-minute maintenance endpoint processes pending intents even
when the response callback never ran. It exposes a warning when an intent is
still pending after ten minutes, using the existing owner follow-up and dashboard
paths with English/Arabic labels. Repeated observations deduplicate; a recovered
intent archives its alert. The cron endpoint attempts owner follow-up after a
maintenance failure and still returns HTTP 500 for the failed sweep.

Executed local evidence before commit: the security regression failed against
the previous code. The initial corrected lifecycle suite passed 293 tests. The
expanded six-suite run passed 385 tests, including failed/lost callback recovery,
an account change during the locked write, coalescing and alert recovery. A later
legacy-writer marker regression and the full release checks are recorded in the
exact-commit CI evidence; these overlapping counts are not additive.

The isolated PostgreSQL harness additionally exercises lost callback recovery
after killing all four application processes, preservation of a newer account
restriction/password change, one settlement, and final inventory. Its actual
result must be read from that commit's CI artifact. Query timing aggregates
contain operation categories and durations only, with no SQL or bound values.

No production scheduler, real provider delivery or physical device acceptance is
certified by these synthetic checks. Post-commit realtime/email delivery still
has its existing channel-specific recovery boundaries; this change durably
recovers derived trust state. Historical trades without the new marker are not
silently reprocessed. Commission amounts remain one percent for each side.

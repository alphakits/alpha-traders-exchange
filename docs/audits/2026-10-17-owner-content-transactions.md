# Owner content transactions

Six controlled regressions reproduced lost concurrent lesson/media edits,
lesson writes without their version audit, partial publication audits, and
colliding duplicate-lesson identities created during the same millisecond.
All six pass after the repair, alongside the existing bilingual publishing
validation checks.

Each lesson creation, update, deletion, duplication, reorder or status change
now reads, validates, writes and appends its version records inside one database
transaction under the existing owner-content advisory lock. Nested operations
share the transaction. Concurrent patches read current content after acquiring
the lock. Media additions and lesson associations use the same protection.
New lesson IDs use UUIDs. Memory-only tests emulate commit/rollback and serialized
mutations; they are not substitutes for the PostgreSQL concurrency run.

Initialization now acquires the same lock before schema/seed checks, rolls back
on failure and permits a later retry. Lock failure no longer allows a content
write to proceed. The PostgreSQL harness additionally exercises 12 creations
across four independent processes, simultaneous field changes, an induced audit
failure followed by recovery, and simultaneous media associations.

The shared uncertain-connection cleanup also protects owner content, push
registration, marketplace email schema/claim transactions and news schema/sync
transactions. Failure-injection tests produced 14 failures and 6 passes before
repair; all 20 pass after repair. Existing isolated SQL email/news behavior and
push route checks also pass. External providers are not contacted by these tests.

Storage-backed media deletion remains outside this transaction change: a remote
storage deletion cannot be rolled back by a database transaction. The complete
storage/delete/import recovery journey remains an explicit unverified scope
item, including failures between upload, content creation and media association.

The actual lesson editor sends a full lesson including its status. The update
API previously interpreted any valid status as a status-only action, returning
success while ignoring edited titles, descriptions and other fields. API-to-
repository tests reproduced this, an editable body-ID override and silent
publication for an unsupported status (four failures, two passes before repair).
The API now saves the complete patch, enforces the path ID, rejects unsupported
statuses and records the matching publication audit in the same transaction.
All six API checks and ten content/localization checks pass after repair.

Three additional API regressions reproduced stale full-form overwrites, duplicate
audits after retrying a lost response, and unchanged revisions after edits. Saves
now compare the supplied revision under the content transaction lock. Conflicts
return 409 with the saved lesson; identical retries return that lesson without a
second audit. Successful changes advance the revision even within a millisecond.
Legacy lessons have a stable initial revision. Reordering advances affected
lesson revisions so an older editor cannot silently undo a reorder.

The editor now retains a queue of drafts by lesson ID, serializes writes, keeps
newer edits when an older response arrives, and retains failed or timed-out
drafts with an explicit retry. Publication uses that same queue. A conflict
shows the saved title and lets the owner explicitly choose the saved version or
save their current version against the newly observed revision. A later
concurrent edit still conflicts. Seven queue tests and 19 API/content/localization
checks pass locally. Desktop English and mobile Arabic browser tests cover
selection changes, publishing the current draft, temporary save failures and
stale-tab conflict recovery; their actual results belong to the run evidence.

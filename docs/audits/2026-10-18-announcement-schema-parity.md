# Announcement request-key parity

The live `admin_announcement_runs.request_key` column was nullable, while the
fresh migration chain and runtime table definition require a key. Read-only
preflight found 12 records, zero null/empty keys and zero mismatches with their
canonical payload keys. The existing owner/request-key unique index is present.

Migration `20261017214355_announcement_request_key_required.sql` now requires the
key without generating identifiers or changing rows. It uses a two-second lock
timeout and a ten-second statement timeout. An unexpected historical null fails
the transaction rather than being silently backfilled. The file was created with
the Supabase CLI and aligned to the returned applied version.

Two isolated PostgreSQL-engine tests pass: repeat application preserves records,
RLS and unique-key enforcement, and a legacy null rejects the migration while
retaining the original rows and nullable definition. Focused ESLint passes.

Production application and readback succeeded. The 12-row content fingerprint
remained `dff8e15ba3e78e1d4dc86286e91a5207`; nullability is now `NO`. The migration
does not alter policies or grants. Security advisors remain 38 informational
no-policy findings and zero warnings/errors. This closes the specific nullability
drift, not the separate foundational migration-history and actual backup/restore
acceptance gaps.

The preceding 7da265c candidate preview is READY. Its health endpoint returned
HTTP 200 with database `ok` and a 48-ms route/database duration. English login
returned HTTP 200; Arabic login returned HTTP 200 with `lang=ar`, `dir=rtl` and
private/no-store caching. The protected admin fetch could not expose deployment
content through the connector and is not counted as an application authorization
pass.

CI #1043 uses merge commit `1d7aacd5088dd1dfe62c9548c4463657ec5a0e05`, whose tree
matches 7da265c exactly. Database correctness/recovery and restoration passed;
240 timed status actions measured median 342.37 ms, p95 781.71 ms and maximum
899.48 ms. The preceding #1042 failure (maximum 1718.85 ms) is retained: application
code is unchanged between these two candidates, so timing variability and deployed
latency remain open acceptance items. No gate or workload was weakened.

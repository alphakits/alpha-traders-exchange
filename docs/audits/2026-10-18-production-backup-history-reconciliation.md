# Production backup recovery and migration history

The owner approved deployment of worker commit
`d954d5799c22d91951704fad108587f05a4bde1f` despite Railway's retained failed-check
warning, and the separate Supabase restore project quoted at $9.68/month.

The worker deployment `d66d4a86-4898-418d-b7e9-9a0040cd2262` succeeded. All startup
phases completed, including Discord gateway, commands, notifications, roles,
resources, onboarding, listings and operator reconciliation. The public-site
monitor completed its first observation with healthy status and no coverage gaps.

## Actual backup recovery

The production physical backup from 2026-10-17 04:57:22 UTC was restored into the
separate `alpha-traders-recovery-audit-20261018` project in eu-west-1. Production
was not restored or replaced. The restored application initially contained 81
tables, 139,118 rows, 15 migration records, 188 Supabase Auth users and 18 Storage
object metadata records. No application index was invalid and no application
constraint was unvalidated. Neither database had pg_cron, pg_net or foreign
servers configured. No worker or website was connected to the restored copy.

The four migrations applied after the backup were then applied to the copy:
journal statement context, same-seller closed commission references, durable
deposit scan progress, and required announcement request keys. Supabase's
migration API assigned the same second-based timestamp to two rapid calls; the
second call failed on its history primary key. Its idempotent migration was
successfully reapplied with a distinct timestamp. That tooling failure is retained
in the audit evidence.

After the four migrations, the restored catalog exactly matched production:
82 tables, 669 columns, 182 indexes, 266 constraints, 5 policies, 16 triggers,
24 functions and 44 grants. All 81 pre-existing application tables retained
identical row counts and sorted per-row content fingerprints. The new progress
table was empty. No customer settlement or historical data transformation was
executed during this verification.

This proves database recovery and schema roll-forward. It does not prove recovery
of Storage object bytes, Auth/provider configuration, Edge Functions or live
payment services. The clone uses the provider's current PostgreSQL 17.11 build;
the source uses 17.6. The restored default Auth configuration also reports two
warnings (leaked-password protection and MFA options) which require service
configuration before any application is connected. Production advisors remain
38 informational private-table findings and zero warnings/errors.

## History repair

The default migration chain now uses one directory and the actual recorded
production timestamps. Nine files were renamed, including two moved from
`db/migrations`. Their SQL bodies are unchanged. The unenabled WhatsApp migration
is explicitly opt-in under `supabase/optional-migrations`; its feature tests and
runbook use that location. The default chain therefore has 39 unique versions.

All 19 recorded production migration bodies were compared with source. Seventeen
match after whitespace/comment normalization; the other two differ only in
transaction/timeout wrappers. Existing production statements and versions were
preserved exactly.

Twenty foundational migrations were missing from history because their existing
end states had been created outside that history. In addition to full catalog
comparison, read-only checks verified all historical data effects: runtime meta
seed, preferred locales, resource provisioning tokens, three market-content
seeds, admin-media bucket configuration and legacy trust-notification cleanup.
No outstanding locale, token or notification repair was found.

`scripts/build-migration-history-repair.py` only generates SQL; it never connects
to a database. Its manifest pins all 39 file hashes and the inspected catalog
fingerprint. The generated transaction checks exact existing history digests,
schema, data invariants and expected row count before inserting 20 explicit
adoption records. Each adoption statement says its existing end state was
verified on October 18 and its historical SQL was not replayed. It does not imply
that those migrations originally ran on their filename dates.

The repair was applied twice to the recovery copy to verify idempotence. Its 81
original table fingerprints and complete catalog remained unchanged. Production
application then succeeded, and readback found all 39 versions with the same
catalog fingerprint `92457b4d68824f657a9ecd284b2389d3`.

Generate the bounded, reviewable repair artifact with:

```sh
python scripts/build-migration-history-repair.py --target production --output /tmp/alpha-history-repair.sql
```

The generator intentionally rejects later file changes. Do not weaken its guards
to reuse this dated repair against a changed database.

## Source verification

Eight affected suites passed: 116 tests covering ordered schema reconstruction,
commission reservations, private function paths, journal privacy and optional
WhatsApp behavior. The reconstruction test submits individual top-level SQL
statements, checks unique migration versions, and verifies optional provider
tables are absent from the default schema. Required CI for the source change is
tracked separately; these focused results are not a substitute for that gate.

Remaining audit acceptance includes controlled buyer/seller/provider journeys,
physical-device coverage, response-time consistency, external alert delivery,
Storage object recovery and deployment rollback.

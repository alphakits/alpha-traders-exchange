# Reconstructed row-security baseline

A read-only catalog inspection of production covered 80 application tables,
654 columns, 178 indexes, 261 primary/foreign/unique/check constraints and five
RLS policies. Replaying all tracked migrations reconstructed all live table
names, but omitted production's enabled RLS setting on 26 existing tables and
the notification trust-reconciliation index.

Migration `20261017010000_persist_deployed_row_security.sql` preserves those
observed settings on clean databases. It is idempotent on production, uses
bounded lock/statement timeouts, adds no permissive policy or role grant, and
does not rewrite rows. The regression failed before the migration because all
26 tables had RLS disabled. After reconstruction it checks every listed table,
then uses a synthetic user and an ordinary authenticated role with explicit
test-only SELECT/UPDATE grants: the role cannot read the row or promote it to
owner. The database owner still reads the unchanged buyer record.

The catalog comparison excludes PostgreSQL 18's duplicate NOT NULL constraint
records when comparing with PostgreSQL 17; column nullability is checked
separately. Remaining known differences include the proposed journal policy
optimization, four tracked WhatsApp tables absent from production, and a
stricter NOT NULL request key on newly reconstructed announcement history.
Production migration metadata, grants, function/trigger definitions and actual
production backup restoration still require separate acceptance.

Production was inspected only. This migration has not been applied or released.

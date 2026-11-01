-- Match the fresh-schema/runtime definition without rewriting announcement history.
-- Existing null keys deliberately fail the migration for explicit investigation.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
ALTER TABLE alpha_exchange.admin_announcement_runs
  ALTER COLUMN request_key SET NOT NULL;
COMMIT;

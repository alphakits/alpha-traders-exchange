-- DEVELOPMENT ONLY: the explicit successor of one accepted initial mapping.
-- Recovery installs these exact rows before the separate guard bundle. No normal
-- activation, authenticated authority, or financial command is created by DDL.
CREATE SCHEMA alpha_wallet_cancellation_marketplace_simulation;
REVOKE ALL ON SCHEMA alpha_wallet_cancellation_marketplace_simulation FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_cancellation_marketplace_simulation REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_cancellation_marketplace_simulation REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE alpha_wallet_cancellation_marketplace_simulation.transaction_contexts (
  transaction_id text PRIMARY KEY CHECK (transaction_id ~ '^[1-9][0-9]*$'),
  request_id text NOT NULL CHECK (request_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  operation text NOT NULL CHECK (operation IN ('upgrade','cancel','inspect','pause','export')),
  actor_user_id text NOT NULL CHECK (actor_user_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  planned_command jsonb,
  planned_command_key text,
  canonical_basis jsonb,
  CHECK ((planned_command IS NULL) = (planned_command_key IS NULL)),
  CHECK (planned_command IS NULL OR jsonb_typeof(planned_command)='object'),
  CHECK (canonical_basis IS NULL OR (operation='cancel' AND planned_command IS NOT NULL AND jsonb_typeof(canonical_basis)='object'))
);
CREATE TABLE alpha_wallet_cancellation_marketplace_simulation.transitions (
  request_id text PRIMARY KEY REFERENCES alpha_wallet_initial_marketplace_simulation.activations(request_id),
  profile text NOT NULL UNIQUE CHECK (profile='canonical-initial-cancellation-cohort-v1'),
  actor_user_id text NOT NULL CHECK (actor_user_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  input_digest text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  wallet_checkpoint jsonb NOT NULL CHECK (jsonb_typeof(wallet_checkpoint)='object'),
  wallet_command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision),
  wallet_command_key text NOT NULL UNIQUE,
  wallet_event_hash text NOT NULL CHECK (wallet_event_hash ~ '^[a-f0-9]{64}$'),
  continuation jsonb NOT NULL CHECK (jsonb_typeof(continuation)='object'),
  predecessor jsonb NOT NULL CHECK (jsonb_typeof(predecessor)='object')
);
CREATE TABLE alpha_wallet_cancellation_marketplace_simulation.cancellations (
  -- The financial V4 table is installed by the atomic normal migration, or by
  -- isolated recovery replay. Its FK is added by the shared guard bundle.
  cancellation_key text PRIMARY KEY CHECK (cancellation_key ~ '^[a-f0-9]{64}$'),
  request_id text NOT NULL UNIQUE REFERENCES alpha_wallet_cancellation_marketplace_simulation.transitions(request_id),
  actor_user_id text NOT NULL CHECK (actor_user_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  actor_kind text NOT NULL CHECK (actor_kind IN ('buyer','seller')),
  input_digest text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  wallet_command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision),
  wallet_command_key text NOT NULL UNIQUE,
  wallet_event_hash text NOT NULL CHECK (wallet_event_hash ~ '^[a-f0-9]{64}$'),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
  publication_id text NOT NULL UNIQUE,
  canonical_basis jsonb NOT NULL CHECK (jsonb_typeof(canonical_basis)='object'),
  canonical_result jsonb NOT NULL CHECK (jsonb_typeof(canonical_result)='object')
);
CREATE TABLE alpha_wallet_cancellation_marketplace_simulation.publications (
  id text PRIMARY KEY,
  cancellation_key text NOT NULL UNIQUE REFERENCES alpha_wallet_cancellation_marketplace_simulation.cancellations(cancellation_key),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object')
);

-- Needed by the source-bound financial migration before the complete guards
-- exist. The full bundle installs the stricter context trigger and final seal.
CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.require_context()
RETURNS alpha_wallet_cancellation_marketplace_simulation.transaction_contexts
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
DECLARE context alpha_wallet_cancellation_marketplace_simulation.transaction_contexts%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  IF current_setting('transaction_read_only')<>'off'
    OR to_regnamespace('alpha_wallet_marketplace_simulation') IS NOT NULL
    OR to_regnamespace('alpha_wallet_initial_marketplace_simulation') IS NULL THEN
    RAISE EXCEPTION 'Cancellation marketplace requires its separate writable successor cohort';
  END IF;
  SELECT * INTO context FROM alpha_wallet_cancellation_marketplace_simulation.transaction_contexts
    WHERE transaction_id=txid_current()::text;
  IF context.transaction_id IS NULL THEN
    RAISE EXCEPTION 'A registered same-transaction cancellation marketplace context is required';
  END IF;
  RETURN context;
END;
$fn$;

-- Install RLS before the first bootstrap context row can queue a deferred event.
-- The later guard switch never ALTERs a table with pending bootstrap triggers.
DO $table_security$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['transaction_contexts','transitions','cancellations','publications'] LOOP
    EXECUTE format('ALTER TABLE alpha_wallet_cancellation_marketplace_simulation.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE alpha_wallet_cancellation_marketplace_simulation.%I FORCE ROW LEVEL SECURITY',name);
  END LOOP;
END;
$table_security$;

-- A preparation-only caller cannot publish an empty half-profile. This trigger
-- is queued by the first context INSERT, before any financial DDL or full guard
-- installation. Resolution of assert_coherence is deliberately deferred until
-- COMMIT; a missing guard bundle, transition, continuation or format4 head fails.
CREATE FUNCTION alpha_wallet_cancellation_marketplace_simulation.require_complete_bootstrap() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $fn$
BEGIN
  IF to_regprocedure('alpha_wallet_cancellation_marketplace_simulation.assert_coherence()') IS NULL THEN
    RAISE EXCEPTION 'Cancellation profile bootstrap must install its complete guards and atomic continuation';
  END IF;
  PERFORM alpha_wallet_cancellation_marketplace_simulation.assert_coherence();
  RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER complete_cancellation_profile_bootstrap
  AFTER INSERT ON alpha_wallet_cancellation_marketplace_simulation.transaction_contexts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION alpha_wallet_cancellation_marketplace_simulation.require_complete_bootstrap();

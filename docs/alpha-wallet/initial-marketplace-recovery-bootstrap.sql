-- DEVELOPMENT ONLY: installed after original initial-cohort rows and unchanged
-- initial guards in the certified fresh-target transaction. No existing source
-- guard is disabled. A NULL receipt is an unfinished bootstrap, never recovery.
-- Recovery has no authority re-entry or resume: canonical records and further
-- financial commands are sealed; inspection registrations/head locks are allowed.
CREATE TABLE alpha_wallet_initial_marketplace_simulation.recovery_receipts (
  singleton boolean PRIMARY KEY CHECK (singleton),
  bootstrap_transaction_id text NOT NULL CHECK (bootstrap_transaction_id ~ '^[1-9][0-9]*$'),
  receipt jsonb CHECK (receipt IS NULL OR jsonb_typeof(receipt)='object')
);
ALTER TABLE alpha_wallet_initial_marketplace_simulation.recovery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_wallet_initial_marketplace_simulation.recovery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON alpha_wallet_initial_marketplace_simulation.recovery_receipts FROM PUBLIC;

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.reject_recovered_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  RAISE EXCEPTION 'Recovered initial marketplace remains quarantined; financial and canonical writes require an unimplemented authority re-entry';
END;
$fn$;
CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_recovered_context() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  IF TG_OP IS DISTINCT FROM 'INSERT' OR NEW.operation IS DISTINCT FROM 'inspect'
    OR NEW.planned_command IS NOT NULL OR NEW.planned_command_key IS NOT NULL THEN
    RAISE EXCEPTION 'Recovered initial marketplace permits new unbound inspection contexts only';
  END IF;
  RETURN NEW;
END;
$fn$;

DO $quarantine$
DECLARE name text;
BEGIN
  -- Statement fences also reject no-row mutations and TRUNCATE. They attach
  -- only after exact originals have been loaded in this fresh target. Source
  -- coordinator behavior and its allowance for unrelated writes are unchanged.
  FOREACH name IN ARRAY ARRAY['runtime_meta','users','listings','trades','purchase_requests','commissions',
    'marketplace_enforcement_records','evidence','disputes','notifications','audit_logs','sessions'] LOOP
    EXECUTE format('CREATE TRIGGER initial_recovery_no_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON alpha_exchange.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.reject_recovered_write()',name);
  END LOOP;
  CREATE TRIGGER initial_recovery_no_new_command BEFORE INSERT ON alpha_wallet_simulation.commands
    FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.reject_recovered_write();
  CREATE TRIGGER initial_recovery_inspection_only BEFORE INSERT OR UPDATE
    ON alpha_wallet_initial_marketplace_simulation.transaction_contexts
    FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_recovered_context();
END;
$quarantine$;

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_recovery_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  IF TG_OP='INSERT' THEN
    IF NEW.singleton IS DISTINCT FROM true OR NEW.bootstrap_transaction_id IS DISTINCT FROM txid_current()::text
      OR NEW.receipt IS NOT NULL OR EXISTS (SELECT 1 FROM alpha_wallet_initial_marketplace_simulation.recovery_receipts) THEN
      RAISE EXCEPTION 'Initial combined recovery must start one unfinished same-transaction receipt';
    END IF;
  ELSIF TG_OP='UPDATE' THEN
    IF OLD.singleton IS DISTINCT FROM true OR NEW.singleton IS DISTINCT FROM true
      OR OLD.bootstrap_transaction_id IS DISTINCT FROM txid_current()::text
      OR NEW.bootstrap_transaction_id IS DISTINCT FROM OLD.bootstrap_transaction_id
      OR OLD.receipt IS NOT NULL OR NEW.receipt IS NULL THEN
      RAISE EXCEPTION 'Initial combined recovery receipt can complete once in its original bootstrap transaction only';
    END IF;
  ELSE
    RAISE EXCEPTION 'Initial combined recovery receipts cannot be removed or replaced';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER initial_recovery_receipt_shape BEFORE INSERT OR UPDATE
  ON alpha_wallet_initial_marketplace_simulation.recovery_receipts
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.guard_recovery_receipt();
CREATE TRIGGER initial_recovery_receipt_no_delete BEFORE DELETE OR TRUNCATE
  ON alpha_wallet_initial_marketplace_simulation.recovery_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.reject_change();

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.assert_recovery_receipt() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
  registration alpha_wallet_initial_marketplace_simulation.recovery_receipts%ROWTYPE;
  context alpha_wallet_initial_marketplace_simulation.transaction_contexts%ROWTYPE;
  source alpha_wallet_simulation.commands%ROWTYPE;
  target alpha_wallet_simulation.commands%ROWTYPE;
  head alpha_wallet_simulation.head%ROWTYPE;
  r jsonb; expected_pause jsonb;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  SELECT * INTO registration FROM alpha_wallet_initial_marketplace_simulation.recovery_receipts WHERE singleton;
  r := registration.receipt;
  IF registration.bootstrap_transaction_id IS DISTINCT FROM txid_current()::text OR r IS NULL
    OR jsonb_typeof(r->'checksum') IS DISTINCT FROM 'string' OR NOT coalesce(r->>'checksum' ~ '^[a-f0-9]{64}$',false)
    OR jsonb_typeof(r->'canonicalDigest') IS DISTINCT FROM 'string' OR NOT coalesce(r->>'canonicalDigest' ~ '^[a-f0-9]{64}$',false)
    OR jsonb_typeof(r->'coordinationDigest') IS DISTINCT FROM 'string' OR NOT coalesce(r->>'coordinationDigest' ~ '^[a-f0-9]{64}$',false)
    OR jsonb_typeof(r->'requestId') IS DISTINCT FROM 'string' OR NOT coalesce(r->>'requestId' ~ '^[A-Za-z0-9_-]{1,80}$',false)
    OR jsonb_typeof(r->'ownerId') IS DISTINCT FROM 'string' OR NOT coalesce(r->>'ownerId' ~ '^[A-Za-z0-9_-]{1,80}$',false)
    OR jsonb_typeof(r->'source') IS DISTINCT FROM 'object' OR jsonb_typeof(r->'restored') IS DISTINCT FROM 'object'
    OR jsonb_typeof(r->'restoredAtMs') IS DISTINCT FROM 'number'
    OR NOT coalesce(r->>'restoredAtMs' ~ '^(0|[1-9][0-9]{0,15})$',false)
    OR jsonb_typeof(r->'quarantineCommandKey') IS DISTINCT FROM 'string'
    OR r IS DISTINCT FROM jsonb_build_object('checksum',r->'checksum','source',r->'source','restored',r->'restored',
      'requestId',r->'requestId','ownerId',r->'ownerId','restoredAtMs',r->'restoredAtMs',
      'canonicalDigest',r->'canonicalDigest','coordinationDigest',r->'coordinationDigest','quarantineCommandKey',r->'quarantineCommandKey') THEN
    RAISE EXCEPTION 'Initial combined recovery cannot commit without its complete exact receipt';
  END IF;
  context := alpha_wallet_initial_marketplace_simulation.require_context();
  IF context.operation IS DISTINCT FROM 'inspect' OR context.planned_command IS NOT NULL
    OR context.request_id IS DISTINCT FROM r->>'requestId' OR context.actor_user_id IS DISTINCT FROM r->>'ownerId'
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_initial_marketplace_simulation.activations WHERE request_id=r->>'requestId')
    -- Actual current multi-role owner authority was checked during export.
    -- Recovery intentionally retains identity labels, not credential authority.
    OR NOT EXISTS (SELECT 1 FROM alpha_exchange.users WHERE id=r->>'ownerId') THEN
    RAISE EXCEPTION 'Initial combined recovery completion requires its exact new inspection context';
  END IF;
  SELECT * INTO source FROM alpha_wallet_simulation.commands WHERE revision=(r#>>'{source,revision}')::integer;
  SELECT * INTO target FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1;
  SELECT * INTO head FROM alpha_wallet_simulation.head WHERE singleton;
  expected_pause := jsonb_build_object('version',3,'engineVersion','alpha-wallet-simulation-v3','type','pause',
    'actor',jsonb_build_object('kind','operator','id','initial-marketplace-backup-recovery'),
    'requestId','restore-' || (r->>'checksum'),'input',NULL);
  IF source.revision IS NULL OR source.revision < 1 OR source.revision >= 1000 OR target.revision IS DISTINCT FROM source.revision+1
    OR source.command_type IS DISTINCT FROM 'pause' OR source.command_json->'version' IS DISTINCT FROM to_jsonb(3)
    OR source.command_json->>'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v3'
    OR head.format_version IS DISTINCT FROM 3 OR head.revision IS DISTINCT FROM target.revision
    OR head.last_event_hash IS DISTINCT FROM target.event_hash OR target.command_type IS DISTINCT FROM 'pause'
    OR target.command_json IS DISTINCT FROM expected_pause
    OR target.command_key::jsonb IS DISTINCT FROM jsonb_build_array('operator','initial-marketplace-backup-recovery','pause','restore-' || (r->>'checksum'))
    OR target.command_key IS DISTINCT FROM r->>'quarantineCommandKey'
    OR target.occurred_at_ms IS DISTINCT FROM (r->>'restoredAtMs')::bigint
    OR target.occurred_at_ms < source.occurred_at_ms
    OR (SELECT count(*) FROM alpha_wallet_simulation.commands) IS DISTINCT FROM target.revision::bigint
    OR r->'source' IS DISTINCT FROM jsonb_build_object('revision',source.revision,'eventHash',source.event_hash,
      'stateHash',source.state_hash,'lastCommandAtMs',source.occurred_at_ms)
    OR r->'restored' IS DISTINCT FROM jsonb_build_object('revision',target.revision,'eventHash',target.event_hash,
      'stateHash',target.state_hash,'lastCommandAtMs',target.occurred_at_ms) THEN
    RAISE EXCEPTION 'Initial combined recovery receipt must bind original paused history and exactly one new quarantine pause';
  END IF;
  -- Check relation absence at ordinary deferred completion too: adding even
  -- EMPTY native auth tables after application validation must not create a
  -- recovered login. Arbitrary privileged DDL after deliberately draining all
  -- deferred checks is outside this row-guard protocol; production DDL roles
  -- and independently owned pre-COMMIT validation remain separate requirements.
  IF to_regclass('alpha_exchange.mobile_device_sessions') IS NOT NULL
    OR to_regclass('alpha_exchange.mobile_refresh_token_history') IS NOT NULL
    OR EXISTS (SELECT 1 FROM alpha_exchange.sessions)
    OR NOT EXISTS (SELECT 1 FROM alpha_exchange.users)
    OR EXISTS (SELECT 1 FROM alpha_exchange.users u WHERE u.email IS DISTINCT FROM 'recovery-' || u.id || '@example.invalid'
      OR u.availability_status IS DISTINCT FROM 'away' OR u.online_status IS DISTINCT FROM 'offline'
      OR u.payload IS DISTINCT FROM jsonb_build_object('id',u.id,'role',u.role,'sellerStatus',u.seller_status,
        'email','recovery-' || u.id || '@example.invalid','disabled',true,'emailVerified',false,
        'availabilityStatus','away','onlineStatus','offline',
        'createdAt',to_char(u.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'updatedAt',to_char(u.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'fullName','Disabled development recovery identity','recoveryIdentityOnly',true)) THEN
    RAISE EXCEPTION 'Initial combined recovery must not restore sessions, credentials or enabled accounts';
  END IF;
  PERFORM alpha_wallet_initial_marketplace_simulation.assert_coherence();
END;
$fn$;

CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.check_recovery_deferred() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  PERFORM alpha_wallet_initial_marketplace_simulation.assert_recovery_receipt();
  RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER complete_initial_combined_recovery AFTER INSERT OR UPDATE
  ON alpha_wallet_initial_marketplace_simulation.recovery_receipts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.check_recovery_deferred();

-- A later head lock in this same bootstrap requeues final receipt verification
-- even if a caller forced constraints earlier. Reopened inspection transactions
-- do not gain authority to complete or mutate the immutable historical receipt.
CREATE FUNCTION alpha_wallet_initial_marketplace_simulation.check_recovery_bootstrap_head() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM alpha_wallet_initial_marketplace_simulation.recovery_receipts
    WHERE singleton AND bootstrap_transaction_id=txid_current()::text) THEN
    PERFORM alpha_wallet_initial_marketplace_simulation.assert_recovery_receipt();
  END IF;
  RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER complete_initial_recovery_head AFTER UPDATE ON alpha_wallet_simulation.head
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION alpha_wallet_initial_marketplace_simulation.check_recovery_bootstrap_head();

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_initial_marketplace_simulation FROM PUBLIC;
DO $client_grants$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE alpha_wallet_initial_marketplace_simulation.recovery_receipts FROM %I',client_role);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_initial_marketplace_simulation FROM %I',client_role);
    END IF;
  END LOOP;
END;
$client_grants$;

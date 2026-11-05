-- DEVELOPMENT ONLY: installed once inside a certified empty-target restore.
-- The initial NULL receipt is an unfinished bootstrap, not a valid recovery.
-- A deferred constraint refuses COMMIT until that SAME transaction completes it.
CREATE TABLE alpha_wallet_marketplace_simulation.recovery_receipts (
  singleton boolean PRIMARY KEY CHECK (singleton),
  bootstrap_transaction_id text NOT NULL CHECK (bootstrap_transaction_id ~ '^[1-9][0-9]*$'),
  receipt jsonb CHECK (receipt IS NULL OR jsonb_typeof(receipt)='object')
);
ALTER TABLE alpha_wallet_marketplace_simulation.recovery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_wallet_marketplace_simulation.recovery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON alpha_wallet_marketplace_simulation.recovery_receipts FROM PUBLIC;

CREATE FUNCTION alpha_wallet_marketplace_simulation.guard_recovery_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  IF TG_OP='INSERT' THEN
    IF NEW.singleton IS DISTINCT FROM true OR NEW.bootstrap_transaction_id IS DISTINCT FROM txid_current()::text
      OR NEW.receipt IS NOT NULL OR EXISTS (SELECT 1 FROM alpha_wallet_marketplace_simulation.recovery_receipts) THEN
      RAISE EXCEPTION 'Combined recovery must start one unfinished same-transaction receipt';
    END IF;
  ELSIF TG_OP='UPDATE' THEN
    IF OLD.singleton IS DISTINCT FROM true OR NEW.singleton IS DISTINCT FROM true
      OR OLD.bootstrap_transaction_id IS DISTINCT FROM txid_current()::text
      OR NEW.bootstrap_transaction_id IS DISTINCT FROM OLD.bootstrap_transaction_id
      OR OLD.receipt IS NOT NULL OR NEW.receipt IS NULL THEN
      RAISE EXCEPTION 'Combined recovery receipt can complete once in its original bootstrap transaction only';
    END IF;
  ELSE
    RAISE EXCEPTION 'Combined recovery receipts cannot be removed or replaced';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER recovery_receipt_shape BEFORE INSERT OR UPDATE ON alpha_wallet_marketplace_simulation.recovery_receipts
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_marketplace_simulation.guard_recovery_receipt();
CREATE TRIGGER recovery_receipt_no_delete BEFORE DELETE OR TRUNCATE ON alpha_wallet_marketplace_simulation.recovery_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_marketplace_simulation.reject_change();

CREATE FUNCTION alpha_wallet_marketplace_simulation.assert_recovery_receipt() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE
  registration alpha_wallet_marketplace_simulation.recovery_receipts%ROWTYPE;
  context alpha_wallet_marketplace_simulation.transaction_contexts%ROWTYPE;
  source alpha_wallet_simulation.commands%ROWTYPE;
  target alpha_wallet_simulation.commands%ROWTYPE;
  head alpha_wallet_simulation.head%ROWTYPE;
  r jsonb; expected_pause jsonb;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  SELECT * INTO registration FROM alpha_wallet_marketplace_simulation.recovery_receipts WHERE singleton;
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
    RAISE EXCEPTION 'Combined recovery cannot commit without its complete exact receipt';
  END IF;
  context := alpha_wallet_marketplace_simulation.require_context();
  IF context.operation IS DISTINCT FROM 'inspect' OR context.planned_command IS NOT NULL
    OR context.request_id IS DISTINCT FROM r->>'requestId' OR context.actor_user_id IS DISTINCT FROM r->>'ownerId'
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_marketplace_simulation.enrollments WHERE request_id=r->>'requestId')
    OR NOT EXISTS (SELECT 1 FROM alpha_exchange.users WHERE id=r->>'ownerId' AND role='owner') THEN
    RAISE EXCEPTION 'Combined recovery completion requires its exact new inspection context';
  END IF;
  SELECT * INTO source FROM alpha_wallet_simulation.commands WHERE revision=(r#>>'{source,revision}')::integer;
  SELECT * INTO target FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1;
  SELECT * INTO head FROM alpha_wallet_simulation.head WHERE singleton;
  expected_pause := jsonb_build_object('version',2,'engineVersion','alpha-wallet-simulation-v2','type','pause',
    'actor',jsonb_build_object('kind','operator','id','marketplace-backup-recovery'),
    'requestId','restore-' || (r->>'checksum'),'input',NULL);
  IF source.revision IS NULL OR source.revision < 1 OR source.revision > 1000 OR target.revision IS DISTINCT FROM source.revision+1
    OR head.format_version IS DISTINCT FROM 2 OR head.revision IS DISTINCT FROM target.revision
    OR head.last_event_hash IS DISTINCT FROM target.event_hash OR target.command_type IS DISTINCT FROM 'pause'
    OR target.command_json IS DISTINCT FROM expected_pause
    OR target.command_key::jsonb IS DISTINCT FROM jsonb_build_array('operator','marketplace-backup-recovery','pause','restore-' || (r->>'checksum'))
    OR target.command_key IS DISTINCT FROM r->>'quarantineCommandKey'
    OR target.occurred_at_ms IS DISTINCT FROM (r->>'restoredAtMs')::bigint
    OR target.occurred_at_ms < source.occurred_at_ms
    OR (SELECT count(*) FROM alpha_wallet_simulation.commands) IS DISTINCT FROM target.revision::bigint
    OR r->'source' IS DISTINCT FROM jsonb_build_object('revision',source.revision,'eventHash',source.event_hash,
      'stateHash',source.state_hash,'lastCommandAtMs',source.occurred_at_ms)
    OR r->'restored' IS DISTINCT FROM jsonb_build_object('revision',target.revision,'eventHash',target.event_hash,
      'stateHash',target.state_hash,'lastCommandAtMs',target.occurred_at_ms) THEN
    RAISE EXCEPTION 'Combined recovery receipt must bind the original history and exactly one new quarantine pause';
  END IF;
  -- Native authentication is never installed by recovery. Check relation
  -- absence again at deferred COMMIT so a late participant cannot add device
  -- credentials or refresh history after the final application quarantine read.
  IF to_regclass('alpha_exchange.mobile_device_sessions') IS NOT NULL
    OR to_regclass('alpha_exchange.mobile_refresh_token_history') IS NOT NULL
    OR EXISTS (SELECT 1 FROM alpha_exchange.sessions)
    OR EXISTS (SELECT 1 FROM alpha_exchange.users u WHERE u.email IS DISTINCT FROM 'recovery-' || u.id || '@example.invalid'
      OR u.payload IS DISTINCT FROM jsonb_build_object('id',u.id,'role',u.role,'sellerStatus',u.seller_status,
        'email','recovery-' || u.id || '@example.invalid','disabled',true,'emailVerified',false,
        'fullName','Disabled development recovery identity','recoveryIdentityOnly',true)) THEN
    RAISE EXCEPTION 'Combined recovery must not restore sessions, credentials or enabled accounts';
  END IF;
  PERFORM alpha_wallet_marketplace_simulation.assert_coherence();
END;
$fn$;

CREATE FUNCTION alpha_wallet_marketplace_simulation.check_recovery_deferred() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
  PERFORM alpha_wallet_marketplace_simulation.assert_recovery_receipt();
  RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER complete_combined_recovery AFTER INSERT OR UPDATE
  ON alpha_wallet_marketplace_simulation.recovery_receipts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_marketplace_simulation.check_recovery_deferred();
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_marketplace_simulation FROM PUBLIC;

-- EXPLICIT DEVELOPMENT-ONLY v1 -> v2 storage continuation.
-- Called only by upgradeDurableWalletV2 after verified v1 replay/projections and
-- after flushing old deferred constraints. The same transaction must append the
-- exact continuation command and advance format_version to 2 before commit.
-- This file is not registered as an application/production migration.
-- Protocol settings establish compatibility, not authentication. No grants,
-- provider/signing activity, automatic upgrade, or marketplace writer cutover.

DO $guard$
DECLARE
  operation jsonb;
  expected jsonb;
  saved_head alpha_wallet_simulation.head%ROWTYPE;
  saved_command alpha_wallet_simulation.commands%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_writer();
  IF current_setting('alpha_wallet.writer_protocol', true) IS DISTINCT FROM 'simulation-v2'
    OR current_setting('alpha_wallet.schema_upgrade', true) IS DISTINCT FROM 'v1-to-v2' THEN
    RAISE EXCEPTION 'Explicit simulation-v2 upgrade protocol required';
  END IF;
  SELECT * INTO saved_head FROM alpha_wallet_simulation.head WHERE singleton;
  IF saved_head.format_version IS DISTINCT FROM 1
    OR to_regclass('alpha_wallet_simulation.engine_continuations') IS NOT NULL
    OR to_regclass('alpha_wallet_simulation.trade_terms_events') IS NOT NULL
    OR to_regclass('alpha_wallet_simulation.acceptance_receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'Upgrade requires intact v1 storage without a previous migration';
  END IF;
  operation := current_setting('alpha_wallet.v2_upgrade_command', true)::jsonb;
  expected := operation -> 'input' -> 'checkpoint';
  IF operation IS NULL OR operation <> jsonb_build_object(
      'version', 2, 'engineVersion', 'alpha-wallet-simulation-v2', 'type', 'continueFromV1',
      'actor', jsonb_build_object('kind', 'operator', 'id', operation -> 'actor' -> 'id'),
      'requestId', operation -> 'requestId',
      'input', jsonb_build_object('checkpoint', jsonb_build_object(
        'revision', expected -> 'revision', 'eventHash', expected -> 'eventHash',
        'stateHash', expected -> 'stateHash', 'lastCommandAtMs', expected -> 'lastCommandAtMs')))
    OR NOT coalesce(operation -> 'actor' ->> 'id' ~ '^[A-Za-z0-9_-]{1,80}$', false)
    OR NOT coalesce(operation ->> 'requestId' ~ '^[A-Za-z0-9_-]{1,80}$', false)
    OR jsonb_typeof(operation -> 'actor' -> 'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(operation -> 'requestId') IS DISTINCT FROM 'string'
    OR current_setting('alpha_wallet.v2_upgrade_key', true)::jsonb IS DISTINCT FROM
      jsonb_build_array('operator', operation -> 'actor' ->> 'id', 'continueFromV1', operation ->> 'requestId')
    OR expected -> 'revision' IS DISTINCT FROM to_jsonb(saved_head.revision)
    OR expected ->> 'eventHash' IS DISTINCT FROM saved_head.last_event_hash::text
    OR NOT coalesce(expected ->> 'stateHash' ~ '^[0-9a-f]{64}$', false) THEN
    RAISE EXCEPTION 'Upgrade command and verified source checkpoint disagree';
  END IF;
  SELECT * INTO saved_command FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1;
  IF saved_head.revision = 0 THEN
    IF saved_command.revision IS NOT NULL OR saved_head.last_event_hash::text <> repeat('0',64)
      OR expected -> 'lastCommandAtMs' IS DISTINCT FROM to_jsonb(0) THEN
      RAISE EXCEPTION 'Invalid empty v1 upgrade checkpoint';
    END IF;
  ELSIF saved_command.revision IS DISTINCT FROM saved_head.revision
    OR saved_command.event_hash IS DISTINCT FROM saved_head.last_event_hash::text
    OR saved_command.state_hash IS DISTINCT FROM expected ->> 'stateHash'
    OR to_jsonb(saved_command.occurred_at_ms) IS DISTINCT FROM expected -> 'lastCommandAtMs' THEN
    RAISE EXCEPTION 'Upgrade checkpoint does not match the immutable v1 prefix';
  END IF;
END;
$guard$;

-- The original check is replaced with an explicit two-format contract. The
-- new update/command guards and deferred registry validation enforce the one-way
-- atomic transition; no historical row or hash is rewritten.
ALTER TABLE alpha_wallet_simulation.head DROP CONSTRAINT head_format_version_check;
ALTER TABLE alpha_wallet_simulation.head ADD CONSTRAINT head_format_version_check CHECK (format_version IN (1,2));

CREATE TABLE alpha_wallet_simulation.engine_continuations (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision) DEFERRABLE INITIALLY DEFERRED,
  command_key text NOT NULL CHECK (length(command_key) BETWEEN 1 AND 1024),
  source_revision integer NOT NULL CHECK (source_revision >= 0 AND command_revision = source_revision + 1),
  source_event_hash text NOT NULL CHECK (source_event_hash ~ '^[0-9a-f]{64}$'),
  source_state_hash text NOT NULL CHECK (source_state_hash ~ '^[0-9a-f]{64}$'),
  source_occurred_at_ms bigint NOT NULL CHECK (source_occurred_at_ms BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE alpha_wallet_simulation.trade_terms_events (
  platform_request_id text NOT NULL CHECK (platform_request_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  wallet_trade_id text NOT NULL CHECK (wallet_trade_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  binding_revision integer NOT NULL CHECK (binding_revision BETWEEN 0 AND 2),
  command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (platform_request_id, binding_revision),
  UNIQUE (wallet_trade_id, binding_revision)
);
CREATE TABLE alpha_wallet_simulation.acceptance_receipts (
  acceptance_key text PRIMARY KEY CHECK (acceptance_key ~ '^[0-9a-f]{64}$'),
  platform_request_id text NOT NULL,
  proposal_id text NOT NULL CHECK (proposal_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  binding_revision integer NOT NULL CHECK (binding_revision BETWEEN 1 AND 2),
  command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  UNIQUE (platform_request_id, proposal_id),
  FOREIGN KEY (platform_request_id,binding_revision) REFERENCES alpha_wallet_simulation.trade_terms_events(platform_request_id,binding_revision)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE FUNCTION alpha_wallet_simulation.require_v2_protocol() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  IF current_setting('alpha_wallet.writer_protocol', true) IS DISTINCT FROM 'simulation-v2' THEN
    RAISE EXCEPTION 'Versioned wallet requires simulation-v2 writer protocol';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION alpha_wallet_simulation.require_writer() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_v2_protocol();
  IF NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND lock_version > 0
    AND xmin::text::numeric = mod(pg_current_xact_id()::text::numeric,4294967296)) THEN
    RAISE EXCEPTION 'Increment head.lock_version before appending a wallet command';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION alpha_wallet_simulation.guard_head_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE transition alpha_wallet_simulation.engine_continuations%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_v2_protocol();
  IF NEW.singleton IS DISTINCT FROM OLD.singleton OR NEW.mode IS DISTINCT FROM OLD.mode THEN
    RAISE EXCEPTION 'Wallet storage identity is immutable';
  END IF;
  IF NEW.format_version IS DISTINCT FROM OLD.format_version THEN
    IF OLD.format_version <> 1 OR NEW.format_version <> 2 OR NEW.lock_version <> OLD.lock_version THEN
      RAISE EXCEPTION 'Wallet storage version may advance only with its exact continuation';
    END IF;
    PERFORM alpha_wallet_simulation.require_writer();
    SELECT * INTO transition FROM alpha_wallet_simulation.engine_continuations WHERE singleton;
    IF transition.source_revision IS DISTINCT FROM OLD.revision
      OR transition.source_event_hash IS DISTINCT FROM OLD.last_event_hash::text
      OR transition.command_revision IS DISTINCT FROM NEW.revision
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.engine_continuations WHERE singleton
        AND xmin::text::numeric = mod(pg_current_xact_id()::text::numeric,4294967296))
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision=transition.command_revision
        AND command_type='continueFromV1' AND command_key=transition.command_key AND event_hash=NEW.last_event_hash::text) THEN
      RAISE EXCEPTION 'Wallet format and continuation must advance in one transaction';
    END IF;
    PERFORM alpha_wallet_simulation.require_current_command(transition.command_revision);
  END IF;
  IF NEW.lock_version = OLD.lock_version + 1 THEN
    IF NEW.revision <> OLD.revision OR NEW.last_event_hash <> OLD.last_event_hash OR NEW.format_version <> OLD.format_version THEN
      RAISE EXCEPTION 'Acquire the command write gate before advancing the log head';
    END IF;
  ELSIF NEW.lock_version = OLD.lock_version THEN
    PERFORM alpha_wallet_simulation.require_writer();
    IF NEW.revision < OLD.revision OR (NEW.revision=OLD.revision AND NEW.last_event_hash<>OLD.last_event_hash) THEN
      RAISE EXCEPTION 'Wallet log head cannot move backwards or replace its hash';
    END IF;
  ELSE RAISE EXCEPTION 'Wallet write-gate version must increment by exactly one';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION alpha_wallet_simulation.guard_command() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE prior alpha_wallet_simulation.commands%ROWTYPE;
  transition alpha_wallet_simulation.engine_continuations%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_writer();
  SELECT * INTO prior FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1;
  IF NEW.revision <> coalesce(prior.revision,0)+1 OR NEW.previous_event_hash <> coalesce(prior.event_hash,repeat('0',64))
    OR NEW.occurred_at_ms < coalesce(prior.occurred_at_ms,0) THEN
    RAISE EXCEPTION 'Command revision, time and hash must extend the existing log';
  END IF;
  IF NEW.command_json -> 'version' IS DISTINCT FROM to_jsonb(2)
    OR NEW.command_json ->> 'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v2'
    OR NEW.command_json ->> 'type' IS DISTINCT FROM NEW.command_type
    OR NEW.command_json IS DISTINCT FROM jsonb_build_object(
      'version',2,'engineVersion','alpha-wallet-simulation-v2','type',NEW.command_type,
      'actor',jsonb_build_object('kind',NEW.command_json -> 'actor' -> 'kind','id',NEW.command_json -> 'actor' -> 'id'),
      'requestId',NEW.command_json -> 'requestId','input',NEW.command_json -> 'input')
    OR NOT coalesce(NEW.command_json -> 'actor' ->> 'kind' IN ('seller','buyer','operator','verifier','dispatcher'),false)
    OR jsonb_typeof(NEW.command_json -> 'actor' -> 'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(NEW.command_json -> 'requestId') IS DISTINCT FROM 'string'
    OR NOT coalesce(NEW.command_json -> 'actor' ->> 'id' ~ '^[A-Za-z0-9_-]{1,80}$',false)
    OR NOT coalesce(NEW.command_json ->> 'requestId' ~ '^[A-Za-z0-9_-]{1,80}$',false)
    OR NEW.command_key::jsonb IS DISTINCT FROM jsonb_build_array(NEW.command_json -> 'actor' ->> 'kind',
      NEW.command_json -> 'actor' ->> 'id',NEW.command_type,NEW.command_json ->> 'requestId')
    OR NEW.command_type NOT IN ('continueFromV1','enrollReservedTrade','acceptAmountCorrection',
      'createDepositIntent','observeDeposit','createListing','approveListing','closeListing','reserveTrade','markBuyerPaid',
      'verifyPayment','authorizeRelease','queueRelease','cancelTrade','openDispute','requestWithdrawal','beginDispatch',
      'recordSubmission','confirmPayout','reconcileAsset','setNativeFeeReadiness','pause') THEN
    RAISE EXCEPTION 'Versioned storage rejects unknown engines and legacy appends';
  END IF;
  IF prior.command_json ->> 'engineVersion' = 'alpha-wallet-simulation-v2' THEN
    IF NEW.command_type='continueFromV1' OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=2) THEN
      RAISE EXCEPTION 'A v2 continuation cannot repeat or precede its storage transition';
    END IF;
  ELSE
    SELECT * INTO transition FROM alpha_wallet_simulation.engine_continuations WHERE singleton;
    IF NEW.command_type<>'continueFromV1' OR NEW.command_json -> 'actor' ->> 'kind' IS DISTINCT FROM 'operator'
      OR transition.command_revision IS DISTINCT FROM NEW.revision OR transition.command_key IS DISTINCT FROM NEW.command_key
      OR NEW.command_json -> 'input' IS DISTINCT FROM jsonb_build_object('checkpoint',jsonb_build_object(
        'revision',transition.source_revision,'eventHash',transition.source_event_hash,
        'stateHash',transition.source_state_hash,'lastCommandAtMs',transition.source_occurred_at_ms))
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=1) THEN
      RAISE EXCEPTION 'The first v2 command must be the explicit source-bound continuation';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.guard_continuation_registry() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  PERFORM alpha_wallet_simulation.require_writer();
  IF current_setting('alpha_wallet.schema_upgrade',true) IS DISTINCT FROM 'v1-to-v2'
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=1
      AND revision=NEW.source_revision AND last_event_hash::text=NEW.source_event_hash)
    OR NEW.command_key IS DISTINCT FROM current_setting('alpha_wallet.v2_upgrade_key',true) THEN
    RAISE EXCEPTION 'Continuation registry requires the explicit v1 migration transaction';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.guard_terms_event() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE operation alpha_wallet_simulation.commands%ROWTYPE;
  prior alpha_wallet_simulation.trade_terms_events%ROWTYPE;
  mutable_fields text[] := ARRAY['revision','terms','termsDigest','walletTradeDigest','lastCommandRevision','lastCommandKey','lastSubmittedAdjustmentCount'];
  amount_fields text[] := ARRAY['usdtAmount','fiatAmount','principalRaw','buyerFeeRaw','sellerFeeRaw','totalFeeRaw','fiatTotalMinor'];
BEGIN
  PERFORM alpha_wallet_simulation.require_current_command(NEW.command_revision);
  SELECT * INTO operation FROM alpha_wallet_simulation.commands WHERE revision=NEW.command_revision;
  IF NEW.payload ->> 'platformRequestId' IS DISTINCT FROM NEW.platform_request_id
    OR NEW.payload ->> 'walletTradeId' IS DISTINCT FROM NEW.wallet_trade_id
    OR NEW.payload -> 'revision' IS DISTINCT FROM to_jsonb(NEW.binding_revision)
    OR NEW.payload -> 'lastCommandRevision' IS DISTINCT FROM to_jsonb(NEW.command_revision)
    OR NEW.payload ->> 'lastCommandKey' IS DISTINCT FROM operation.command_key
    OR NEW.payload -> 'terms' ->> 'platformRequestId' IS DISTINCT FROM NEW.platform_request_id
    OR NEW.payload -> 'terms' ->> 'platformListingId' IS DISTINCT FROM NEW.payload ->> 'platformListingId'
    OR NEW.payload -> 'terms' ->> 'walletListingId' IS DISTINCT FROM NEW.payload ->> 'walletListingId'
    OR NEW.payload -> 'terms' ->> 'assetId' IS DISTINCT FROM NEW.payload ->> 'assetId'
    OR NOT coalesce(NEW.payload -> 'terms' ->> 'principalRaw' ~ '^[1-9][0-9]{0,77}$',false)
    OR NOT coalesce(NEW.payload ->> 'termsDigest' ~ '^[0-9a-f]{64}$',false)
    OR NOT coalesce(NEW.payload ->> 'walletTradeDigest' ~ '^[0-9a-f]{64}$',false) THEN
    RAISE EXCEPTION 'Terms projection must retain its canonical binding and command identity';
  END IF;
  SELECT * INTO prior FROM alpha_wallet_simulation.trade_terms_events
    WHERE platform_request_id=NEW.platform_request_id ORDER BY binding_revision DESC LIMIT 1;
  IF prior.platform_request_id IS NULL THEN
    IF NEW.binding_revision<>0 OR operation.command_type<>'enrollReservedTrade'
      OR operation.result_json IS DISTINCT FROM NEW.payload
      OR operation.command_json -> 'actor' ->> 'kind' IS DISTINCT FROM 'operator'
      OR operation.command_json -> 'input' ->> 'walletTradeId' IS DISTINCT FROM NEW.wallet_trade_id
      OR operation.command_json -> 'input' -> 'terms' IS DISTINCT FROM NEW.payload -> 'terms'
      OR operation.command_json -> 'input' ->> 'termsDigest' IS DISTINCT FROM NEW.payload ->> 'termsDigest'
      OR NEW.payload -> 'enrollmentCommandRevision' IS DISTINCT FROM to_jsonb(NEW.command_revision)
      OR NEW.payload ->> 'enrollmentCommandKey' IS DISTINCT FROM operation.command_key
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.trade_terms_events WHERE wallet_trade_id=NEW.wallet_trade_id) THEN
      RAISE EXCEPTION 'A terms binding must begin with one explicit enrollment';
    END IF;
  ELSE
    IF NEW.binding_revision<>prior.binding_revision+1 OR NEW.wallet_trade_id<>prior.wallet_trade_id
      OR operation.command_type<>'acceptAmountCorrection'
      OR operation.command_json -> 'actor' ->> 'kind' IS DISTINCT FROM 'buyer'
      OR operation.command_json -> 'actor' ->> 'id' IS DISTINCT FROM NEW.payload -> 'terms' ->> 'buyerId'
      OR operation.command_json -> 'input' ->> 'platformRequestId' IS DISTINCT FROM NEW.platform_request_id
      OR operation.command_json -> 'input' ->> 'walletTradeId' IS DISTINCT FROM NEW.wallet_trade_id
      OR operation.command_json -> 'input' ->> 'priorTermsDigest' IS DISTINCT FROM prior.payload ->> 'termsDigest'
      OR operation.command_json -> 'input' -> 'preconditions' -> 'bindingRevision' IS DISTINCT FROM to_jsonb(prior.binding_revision)
      OR operation.command_json -> 'input' -> 'acceptedTerms' IS DISTINCT FROM NEW.payload -> 'terms'
      OR operation.result_json ->> 'acceptedTermsDigest' IS DISTINCT FROM NEW.payload ->> 'termsDigest'
      OR operation.command_json -> 'input' -> 'submittedAdjustmentCount' IS DISTINCT FROM NEW.payload -> 'lastSubmittedAdjustmentCount'
      OR (NEW.payload -> 'terms') - amount_fields IS DISTINCT FROM (prior.payload -> 'terms') - amount_fields
      OR NEW.payload - mutable_fields IS DISTINCT FROM prior.payload - mutable_fields THEN
      RAISE EXCEPTION 'A terms revision must extend the same enrolled trade through its buyer acceptance';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.guard_acceptance_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE operation alpha_wallet_simulation.commands%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_current_command(NEW.command_revision);
  SELECT * INTO operation FROM alpha_wallet_simulation.commands WHERE revision=NEW.command_revision;
  IF operation.command_type<>'acceptAmountCorrection' OR operation.result_json IS DISTINCT FROM NEW.payload
    OR NEW.payload ->> 'acceptanceKey' IS DISTINCT FROM NEW.acceptance_key
    OR NEW.payload ->> 'platformRequestId' IS DISTINCT FROM NEW.platform_request_id
    OR NEW.payload ->> 'proposalId' IS DISTINCT FROM NEW.proposal_id
    OR NEW.payload -> 'bindingRevision' IS DISTINCT FROM to_jsonb(NEW.binding_revision)
    OR NEW.payload -> 'commandRevision' IS DISTINCT FROM to_jsonb(NEW.command_revision)
    OR NEW.payload ->> 'commandKey' IS DISTINCT FROM operation.command_key
    OR NEW.payload ->> 'actorUserId' IS DISTINCT FROM operation.command_json -> 'actor' ->> 'id'
    OR NEW.payload -> 'terms' IS DISTINCT FROM operation.command_json -> 'input' -> 'acceptedTerms'
    OR NEW.payload ->> 'walletTradeId' IS DISTINCT FROM operation.command_json -> 'input' ->> 'walletTradeId'
    OR NEW.payload ->> 'priorTermsDigest' IS DISTINCT FROM operation.command_json -> 'input' ->> 'priorTermsDigest'
    OR NEW.payload ->> 'plannerInputDigest' IS DISTINCT FROM operation.command_json -> 'input' ->> 'plannerInputDigest'
    OR NEW.payload -> 'acceptedAtMs' IS DISTINCT FROM to_jsonb(operation.occurred_at_ms)
    OR NEW.platform_request_id IS DISTINCT FROM operation.command_json -> 'input' ->> 'platformRequestId'
    OR NEW.proposal_id IS DISTINCT FROM operation.command_json -> 'input' ->> 'proposalId' THEN
    RAISE EXCEPTION 'Acceptance receipt must be the immutable result of its exact command';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.validate_versioned_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE transition alpha_wallet_simulation.engine_continuations%ROWTYPE;
  operation alpha_wallet_simulation.commands%ROWTYPE;
  terms alpha_wallet_simulation.trade_terms_events%ROWTYPE;
  prior_terms alpha_wallet_simulation.trade_terms_events%ROWTYPE;
  receipt alpha_wallet_simulation.acceptance_receipts%ROWTYPE;
  delta numeric;
  journal_row alpha_wallet_simulation.journals%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_v2_protocol();
  SELECT * INTO transition FROM alpha_wallet_simulation.engine_continuations WHERE singleton;
  IF transition.command_revision IS NULL
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=2 AND revision>=transition.command_revision)
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision=transition.command_revision
      AND command_key=transition.command_key AND command_type='continueFromV1'
      AND previous_event_hash=transition.source_event_hash AND occurred_at_ms>=transition.source_occurred_at_ms
      AND command_json -> 'input' = jsonb_build_object('checkpoint',jsonb_build_object(
        'revision',transition.source_revision,'eventHash',transition.source_event_hash,
        'stateHash',transition.source_state_hash,'lastCommandAtMs',transition.source_occurred_at_ms)))
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision<transition.command_revision
      AND (command_json -> 'version' IS DISTINCT FROM to_jsonb(1)
        OR command_json ->> 'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v1'))
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision>=transition.command_revision
      AND (command_json -> 'version' IS DISTINCT FROM to_jsonb(2)
        OR command_json ->> 'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v2'))
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE command_type='continueFromV1' AND revision<>transition.command_revision) THEN
    RAISE EXCEPTION 'Migration and one versioned continuation must commit atomically';
  END IF;
  IF transition.source_revision>0 AND NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands
    WHERE revision=transition.source_revision AND event_hash=transition.source_event_hash
      AND state_hash=transition.source_state_hash AND occurred_at_ms=transition.source_occurred_at_ms) THEN
    RAISE EXCEPTION 'Continuation no longer matches its immutable v1 checkpoint';
  END IF;
  FOR operation IN SELECT * FROM alpha_wallet_simulation.commands
    WHERE revision>=transition.command_revision AND command_type IN ('continueFromV1','enrollReservedTrade','acceptAmountCorrection') LOOP
    IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.payout_intents WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.payout_events WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.chain_event_claims WHERE command_revision=operation.revision) THEN
      RAISE EXCEPTION 'Continuation and terms changes cannot create payout or chain evidence';
    END IF;
    IF operation.command_type='continueFromV1' THEN
      IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.trade_terms_events WHERE command_revision=operation.revision)
        OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.acceptance_receipts WHERE command_revision=operation.revision) THEN
        RAISE EXCEPTION 'Continuation cannot enroll or accept terms';
      END IF;
    ELSE
      SELECT * INTO terms FROM alpha_wallet_simulation.trade_terms_events WHERE command_revision=operation.revision;
      IF terms.platform_request_id IS NULL THEN RAISE EXCEPTION 'Terms command is missing its immutable terms projection'; END IF;
      IF operation.command_type='acceptAmountCorrection' THEN
        IF NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.acceptance_receipts WHERE command_revision=operation.revision
          AND platform_request_id=terms.platform_request_id AND binding_revision=terms.binding_revision) THEN
          RAISE EXCEPTION 'Accepted terms and their durable receipt must commit together';
        END IF;
        SELECT * INTO prior_terms FROM alpha_wallet_simulation.trade_terms_events
          WHERE platform_request_id=terms.platform_request_id AND binding_revision=terms.binding_revision-1;
        IF prior_terms.platform_request_id IS NULL THEN RAISE EXCEPTION 'Accepted terms have no preceding binding'; END IF;
        delta := (terms.payload -> 'terms' ->> 'principalRaw')::numeric - (prior_terms.payload -> 'terms' ->> 'principalRaw')::numeric;
        SELECT * INTO receipt FROM alpha_wallet_simulation.acceptance_receipts WHERE command_revision=operation.revision;
        IF receipt.payload -> 'principalDeltaRaw' IS DISTINCT FROM to_jsonb(delta::text)
          OR receipt.payload -> 'transferAmountRaw' IS DISTINCT FROM to_jsonb(abs(delta)::text) THEN
          RAISE EXCEPTION 'Acceptance receipt must record its exact signed and absolute principal delta';
        END IF;
        IF delta<>0 THEN
          IF (SELECT count(*) FROM alpha_wallet_simulation.journals WHERE command_revision=operation.revision)<>1 THEN
            RAISE EXCEPTION 'Resize must write exactly its one principal-delta journal';
          END IF;
          SELECT * INTO journal_row FROM alpha_wallet_simulation.journals WHERE command_revision=operation.revision;
          IF journal_row.asset_id IS DISTINCT FROM terms.payload ->> 'assetId'
            OR (SELECT count(*) FROM alpha_wallet_simulation.entries WHERE journal_id=journal_row.journal_id)<>2
            OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.entries WHERE journal_id=journal_row.journal_id
              AND account='listing:' || (terms.payload ->> 'walletListingId') AND delta_units=-delta)
            OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.entries WHERE journal_id=journal_row.journal_id
              AND account='trade:' || terms.wallet_trade_id AND delta_units=delta) THEN
            RAISE EXCEPTION 'Resize journal must move only the agreed delta between the same listing and trade';
          END IF;
        ELSIF EXISTS (SELECT 1 FROM alpha_wallet_simulation.journals WHERE command_revision=operation.revision) THEN
          RAISE EXCEPTION 'Zero-delta acceptance cannot create a journal';
        END IF;
      ELSIF EXISTS (SELECT 1 FROM alpha_wallet_simulation.acceptance_receipts WHERE command_revision=operation.revision) THEN
        RAISE EXCEPTION 'Enrollment cannot create an acceptance receipt';
      END IF;
    END IF;
    IF operation.command_type IN ('continueFromV1','enrollReservedTrade')
      AND EXISTS (SELECT 1 FROM alpha_wallet_simulation.journals WHERE command_revision=operation.revision) THEN
      RAISE EXCEPTION 'Continuation and enrollment cannot move funds';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER continuation_registry_append BEFORE INSERT ON alpha_wallet_simulation.engine_continuations
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.guard_continuation_registry();
CREATE TRIGGER terms_event_append BEFORE INSERT ON alpha_wallet_simulation.trade_terms_events
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.guard_terms_event();
CREATE TRIGGER acceptance_receipt_append BEFORE INSERT ON alpha_wallet_simulation.acceptance_receipts
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.guard_acceptance_receipt();

DO $table_guards$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['engine_continuations','trade_terms_events','acceptance_receipts'] LOOP
    EXECUTE format('ALTER TABLE alpha_wallet_simulation.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE alpha_wallet_simulation.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE TRIGGER immutable_records BEFORE UPDATE OR DELETE OR TRUNCATE ON alpha_wallet_simulation.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_simulation.reject_change()',table_name);
  END LOOP;
  -- Recheck after every possible late projection append, including an entry
  -- added after a caller has already flushed deferred command/header checks.
  FOREACH table_name IN ARRAY ARRAY['head','commands','journals','entries','payout_intents','payout_events','chain_event_claims',
    'engine_continuations','trade_terms_events','acceptance_receipts'] LOOP
    IF table_name='head' THEN
      EXECUTE format('CREATE CONSTRAINT TRIGGER versioned_integrity AFTER UPDATE ON alpha_wallet_simulation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.validate_versioned_integrity()',table_name);
    ELSE
      EXECUTE format('CREATE CONSTRAINT TRIGGER versioned_integrity AFTER INSERT ON alpha_wallet_simulation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.validate_versioned_integrity()',table_name);
    END IF;
  END LOOP;
END;
$table_guards$;

INSERT INTO alpha_wallet_simulation.engine_continuations
  (command_revision,command_key,source_revision,source_event_hash,source_state_hash,source_occurred_at_ms)
SELECT revision+1,current_setting('alpha_wallet.v2_upgrade_key',true),revision,last_event_hash::text,
  current_setting('alpha_wallet.v2_upgrade_command',true)::jsonb -> 'input' -> 'checkpoint' ->> 'stateHash',
  (current_setting('alpha_wallet.v2_upgrade_command',true)::jsonb -> 'input' -> 'checkpoint' ->> 'lastCommandAtMs')::bigint
FROM alpha_wallet_simulation.head WHERE singleton;

REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_simulation FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA alpha_wallet_simulation FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_simulation FROM PUBLIC;
DO $client_grants$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA alpha_wallet_simulation FROM %I',client_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_simulation FROM %I',client_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA alpha_wallet_simulation FROM %I',client_role);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_simulation FROM %I',client_role);
    END IF;
  END LOOP;
END;
$client_grants$;

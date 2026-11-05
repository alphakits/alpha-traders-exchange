-- EXPLICIT DEVELOPMENT-ONLY v3 -> v4 financial continuation.
-- The sole owner first verifies the complete v1/v2/v3 history and projections and
-- flushes historical deferred constraints. This DDL, exact continuation command and
-- format 4 head must commit together. No application migration is registered.
-- Protocol settings establish compatibility, not authentication. There are no
-- provider calls, signing keys, public grants or canonical marketplace cutovers.

DO $guard$
DECLARE
  operation jsonb;
  expected jsonb;
  saved_head alpha_wallet_simulation.head%ROWTYPE;
  saved_command alpha_wallet_simulation.commands%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_writer();
  IF current_setting('alpha_wallet.writer_protocol', true) IS DISTINCT FROM 'simulation-v3'
    OR current_setting('alpha_wallet.schema_upgrade', true) IS DISTINCT FROM 'v3-to-v4'
    OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('alpha_wallet_marketplace_simulation','alpha_wallet_initial_marketplace_simulation')) THEN
    RAISE EXCEPTION 'Explicit isolated simulation-v3 to v4 upgrade protocol required';
  END IF;
  SELECT * INTO saved_head FROM alpha_wallet_simulation.head WHERE singleton;
  IF saved_head.format_version IS DISTINCT FROM 3
    OR to_regclass('alpha_wallet_simulation.initial_engine_continuations') IS NULL
    OR to_regclass('alpha_wallet_simulation.initial_trade_bindings') IS NULL
    OR to_regclass('alpha_wallet_simulation.initial_acceptance_receipts') IS NULL
    OR to_regclass('alpha_wallet_simulation.cancellation_engine_continuations') IS NOT NULL
    OR to_regclass('alpha_wallet_simulation.initial_cancellation_receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'Upgrade requires intact v3 storage without a previous v4 migration';
  END IF;
  operation := current_setting('alpha_wallet.v4_upgrade_command', true)::jsonb;
  expected := operation -> 'input' -> 'checkpoint';
  IF operation IS NULL OR operation <> jsonb_build_object(
      'version',4,'engineVersion','alpha-wallet-simulation-v4','type','continueFromV3',
      'actor',jsonb_build_object('kind','operator','id',operation -> 'actor' -> 'id'),
      'requestId',operation -> 'requestId',
      'input',jsonb_build_object('checkpoint',jsonb_build_object(
        'revision',expected -> 'revision','eventHash',expected -> 'eventHash',
        'stateHash',expected -> 'stateHash','lastCommandAtMs',expected -> 'lastCommandAtMs')))
    OR NOT coalesce(operation -> 'actor' ->> 'id' ~ '^[A-Za-z0-9_-]{1,80}$',false)
    OR NOT coalesce(operation ->> 'requestId' ~ '^[A-Za-z0-9_-]{1,80}$',false)
    OR jsonb_typeof(operation -> 'actor' -> 'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(operation -> 'requestId') IS DISTINCT FROM 'string'
    OR current_setting('alpha_wallet.v4_upgrade_key',true)::jsonb IS DISTINCT FROM
      jsonb_build_array('operator',operation -> 'actor' ->> 'id','continueFromV3',operation ->> 'requestId')
    OR expected -> 'revision' IS DISTINCT FROM to_jsonb(saved_head.revision)
    OR expected ->> 'eventHash' IS DISTINCT FROM saved_head.last_event_hash::text
    OR NOT coalesce(expected ->> 'stateHash' ~ '^[0-9a-f]{64}$',false) THEN
    RAISE EXCEPTION 'V4 upgrade command and verified source checkpoint disagree';
  END IF;
  SELECT * INTO saved_command FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1;
  IF saved_command.revision IS NULL OR saved_command.revision IS DISTINCT FROM saved_head.revision
    OR saved_command.event_hash IS DISTINCT FROM saved_head.last_event_hash::text
    OR saved_command.state_hash IS DISTINCT FROM expected ->> 'stateHash'
    OR to_jsonb(saved_command.occurred_at_ms) IS DISTINCT FROM expected -> 'lastCommandAtMs'
    OR saved_command.command_json -> 'version' IS DISTINCT FROM to_jsonb(3)
    OR saved_command.command_json ->> 'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v3' THEN
    RAISE EXCEPTION 'V4 continuation must match the immutable v3 prefix';
  END IF;
END;
$guard$;

ALTER TABLE alpha_wallet_simulation.head DROP CONSTRAINT head_format_version_check;
ALTER TABLE alpha_wallet_simulation.head ADD CONSTRAINT head_format_version_check CHECK (format_version IN (1,2,3,4));

CREATE TABLE alpha_wallet_simulation.cancellation_engine_continuations (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision) DEFERRABLE INITIALLY DEFERRED,
  command_key text NOT NULL CHECK (length(command_key) BETWEEN 1 AND 1024),
  source_revision integer NOT NULL CHECK (source_revision > 0 AND command_revision = source_revision + 1),
  source_event_hash text NOT NULL CHECK (source_event_hash ~ '^[0-9a-f]{64}$'),
  source_state_hash text NOT NULL CHECK (source_state_hash ~ '^[0-9a-f]{64}$'),
  source_occurred_at_ms bigint NOT NULL CHECK (source_occurred_at_ms BETWEEN 0 AND 9007199254740991),
  source_halt_reason text CHECK (source_halt_reason IS NULL OR length(source_halt_reason)>0)
);
CREATE TABLE alpha_wallet_simulation.initial_cancellation_receipts (
  cancellation_key text PRIMARY KEY CHECK (cancellation_key ~ '^[0-9a-f]{64}$'),
  platform_request_id text NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.initial_trade_bindings(platform_request_id),
  wallet_trade_id text NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.initial_trade_bindings(wallet_trade_id),
  command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object')
);

CREATE FUNCTION alpha_wallet_simulation.require_v4_protocol() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  IF current_setting('alpha_wallet.writer_protocol',true) IS DISTINCT FROM 'simulation-v4'
    OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('alpha_wallet_marketplace_simulation','alpha_wallet_initial_marketplace_simulation')) THEN
    RAISE EXCEPTION 'V4 financial storage requires its isolated simulation-v4 protocol';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION alpha_wallet_simulation.require_writer() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_v4_protocol();
  IF NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND lock_version>0
    AND xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296)) THEN
    RAISE EXCEPTION 'Increment head.lock_version before appending a wallet command';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION alpha_wallet_simulation.require_current_command(command_revision integer) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  PERFORM alpha_wallet_simulation.require_writer();
  IF NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands operation
    JOIN alpha_wallet_simulation.cancellation_engine_continuations continuation ON continuation.singleton
    WHERE operation.revision=$1 AND operation.revision>=continuation.command_revision
      AND operation.command_json -> 'version'=to_jsonb(4)
      AND operation.command_json ->> 'engineVersion'='alpha-wallet-simulation-v4'
      AND operation.xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296)) THEN
    RAISE EXCEPTION 'V4 command and projections must be appended together; historical projections are sealed';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION alpha_wallet_simulation.guard_head_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE transition alpha_wallet_simulation.cancellation_engine_continuations%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_v4_protocol();
  IF NEW.singleton IS DISTINCT FROM OLD.singleton OR NEW.mode IS DISTINCT FROM OLD.mode THEN
    RAISE EXCEPTION 'Wallet storage identity is immutable';
  END IF;
  IF NEW.format_version IS DISTINCT FROM OLD.format_version THEN
    IF OLD.format_version<>3 OR NEW.format_version<>4 OR NEW.lock_version<>OLD.lock_version THEN
      RAISE EXCEPTION 'Wallet storage version may advance only with its exact v4 continuation';
    END IF;
    PERFORM alpha_wallet_simulation.require_writer();
    SELECT * INTO transition FROM alpha_wallet_simulation.cancellation_engine_continuations WHERE singleton;
    IF transition.source_revision IS DISTINCT FROM OLD.revision
      OR transition.source_event_hash IS DISTINCT FROM OLD.last_event_hash::text
      OR transition.command_revision IS DISTINCT FROM NEW.revision
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.cancellation_engine_continuations WHERE singleton
        AND xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296))
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision=transition.command_revision
        AND command_type='continueFromV3' AND command_key=transition.command_key AND event_hash=NEW.last_event_hash::text) THEN
      RAISE EXCEPTION 'V4 storage and continuation must advance in one transaction';
    END IF;
    PERFORM alpha_wallet_simulation.require_current_command(transition.command_revision);
  END IF;
  IF NEW.lock_version=OLD.lock_version+1 THEN
    IF NEW.revision<>OLD.revision OR NEW.last_event_hash<>OLD.last_event_hash OR NEW.format_version<>OLD.format_version THEN
      RAISE EXCEPTION 'Acquire the command write gate before advancing the log head';
    END IF;
  ELSIF NEW.lock_version=OLD.lock_version THEN
    PERFORM alpha_wallet_simulation.require_writer();
    IF NEW.revision<OLD.revision OR (NEW.revision=OLD.revision AND NEW.last_event_hash<>OLD.last_event_hash) THEN
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
  transition alpha_wallet_simulation.cancellation_engine_continuations%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_writer();
  SELECT * INTO prior FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1;
  IF NEW.revision<>coalesce(prior.revision,0)+1 OR NEW.previous_event_hash<>coalesce(prior.event_hash,repeat('0',64))
    OR NEW.occurred_at_ms<coalesce(prior.occurred_at_ms,0) THEN
    RAISE EXCEPTION 'Command revision, time and hash must extend the existing log';
  END IF;
  IF NEW.command_json -> 'version' IS DISTINCT FROM to_jsonb(4)
    OR NEW.command_json ->> 'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v4'
    OR NEW.command_json ->> 'type' IS DISTINCT FROM NEW.command_type
    OR NEW.command_json IS DISTINCT FROM jsonb_build_object(
      'version',4,'engineVersion','alpha-wallet-simulation-v4','type',NEW.command_type,
      'actor',jsonb_build_object('kind',NEW.command_json -> 'actor' -> 'kind','id',NEW.command_json -> 'actor' -> 'id'),
      'requestId',NEW.command_json -> 'requestId','input',NEW.command_json -> 'input')
    OR NOT coalesce(CASE WHEN NEW.command_type='cancelInitialTrade' THEN NEW.command_json -> 'actor' ->> 'kind' IN ('seller','buyer')
      ELSE NEW.command_json -> 'actor' ->> 'kind'='operator' END,false)
    OR jsonb_typeof(NEW.command_json -> 'actor' -> 'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(NEW.command_json -> 'requestId') IS DISTINCT FROM 'string'
    OR NOT coalesce(NEW.command_json -> 'actor' ->> 'id' ~ '^[A-Za-z0-9_-]{1,80}$',false)
    OR NOT coalesce(NEW.command_json ->> 'requestId' ~ '^[A-Za-z0-9_-]{1,80}$',false)
    OR NEW.command_key::jsonb IS DISTINCT FROM jsonb_build_array(NEW.command_json -> 'actor' ->> 'kind',
      NEW.command_json -> 'actor' ->> 'id',NEW.command_type,NEW.command_json ->> 'requestId')
    OR NEW.command_type NOT IN ('continueFromV3','cancelInitialTrade','pause') THEN
    RAISE EXCEPTION 'V4 storage rejects unknown engines, unsupported actions and legacy appends';
  END IF;
  IF NEW.command_type='pause' AND (NEW.command_json -> 'input' IS DISTINCT FROM 'null'::jsonb
    OR NEW.result_json IS DISTINCT FROM jsonb_build_object('halted',true)) THEN
    RAISE EXCEPTION 'V4 pause must retain its exact closed contract';
  END IF;
  IF prior.command_json ->> 'engineVersion'='alpha-wallet-simulation-v4' THEN
    IF NEW.command_type='continueFromV3' OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=4) THEN
      RAISE EXCEPTION 'A v4 continuation cannot repeat or precede its storage transition';
    END IF;
  ELSE
    SELECT * INTO transition FROM alpha_wallet_simulation.cancellation_engine_continuations WHERE singleton;
    IF prior.command_json ->> 'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v3'
      OR NEW.command_type<>'continueFromV3'
      OR transition.command_revision IS DISTINCT FROM NEW.revision OR transition.command_key IS DISTINCT FROM NEW.command_key
      OR NEW.command_json -> 'input' IS DISTINCT FROM jsonb_build_object('checkpoint',jsonb_build_object(
        'revision',transition.source_revision,'eventHash',transition.source_event_hash,
        'stateHash',transition.source_state_hash,'lastCommandAtMs',transition.source_occurred_at_ms))
      OR NEW.result_json IS DISTINCT FROM jsonb_build_object('checkpoint',NEW.command_json -> 'input' -> 'checkpoint',
        'commandRevision',NEW.revision,'commandKey',NEW.command_key,'sourceHaltReason',transition.source_halt_reason)
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=3) THEN
      RAISE EXCEPTION 'The first v4 command must be the explicit source-bound continuation';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.guard_cancellation_continuation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  PERFORM alpha_wallet_simulation.require_writer();
  IF current_setting('alpha_wallet.schema_upgrade',true) IS DISTINCT FROM 'v3-to-v4'
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=3
      AND revision=NEW.source_revision AND last_event_hash::text=NEW.source_event_hash)
    OR NEW.command_key IS DISTINCT FROM current_setting('alpha_wallet.v4_upgrade_key',true)
    OR to_jsonb(NEW.source_halt_reason) IS DISTINCT FROM nullif(current_setting('alpha_wallet.v4_source_halt_reason',true)::jsonb,'null'::jsonb) THEN
    RAISE EXCEPTION 'Initial continuation registry requires the explicit v3 migration transaction';
  END IF;
  -- V3 has no resume command. Its own pause is authoritative regardless of a
  -- caller's session setting; acceptance also proves the source was live until
  -- any later V3 pause. Other inherited halt reasons remain replay-verified.
  IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE command_type='pause'
      AND revision>=(SELECT command_revision FROM alpha_wallet_simulation.initial_engine_continuations WHERE singleton)) THEN
    IF NEW.source_halt_reason IS DISTINCT FROM 'Operator emergency pause' THEN
      RAISE EXCEPTION 'V4 continuation must preserve the immutable V3 pause';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_acceptance_receipts)
    AND NEW.source_halt_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Unpaused accepted V3 source cannot acquire an invented continuation halt';
  END IF;
  RETURN NEW;
END;
$fn$;

-- The following retained checks are copied from the verified V3 migration.
-- Only the protocol/head and V3 upper interval change; historical rows do not.
CREATE OR REPLACE FUNCTION alpha_wallet_simulation.assert_initial_financial_integrity() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE transition alpha_wallet_simulation.initial_engine_continuations%ROWTYPE;
  operation alpha_wallet_simulation.commands%ROWTYPE;
  binding alpha_wallet_simulation.initial_trade_bindings%ROWTYPE;
  receipt alpha_wallet_simulation.initial_acceptance_receipts%ROWTYPE;
  journal_row alpha_wallet_simulation.journals%ROWTYPE;
  descriptor jsonb;
  terms jsonb;
  principal numeric;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_v4_protocol();
  SELECT * INTO transition FROM alpha_wallet_simulation.initial_engine_continuations WHERE singleton;
  IF transition.command_revision IS NULL
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=4 AND revision>=transition.command_revision)
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision=transition.source_revision
      AND event_hash=transition.source_event_hash AND state_hash=transition.source_state_hash
      AND occurred_at_ms=transition.source_occurred_at_ms AND command_json -> 'version'=to_jsonb(2)
      AND command_json ->> 'engineVersion'='alpha-wallet-simulation-v2')
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision=transition.command_revision
      AND command_key=transition.command_key AND command_type='continueFromV2'
      AND previous_event_hash=transition.source_event_hash AND occurred_at_ms>=transition.source_occurred_at_ms
      AND command_json -> 'input'=jsonb_build_object('checkpoint',jsonb_build_object(
        'revision',transition.source_revision,'eventHash',transition.source_event_hash,
        'stateHash',transition.source_state_hash,'lastCommandAtMs',transition.source_occurred_at_ms)))
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE command_type='continueFromV2' AND revision<>transition.command_revision)
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision>=transition.command_revision
      AND revision<(SELECT command_revision FROM alpha_wallet_simulation.cancellation_engine_continuations WHERE singleton)
      AND (command_json -> 'version' IS DISTINCT FROM to_jsonb(3)
        OR command_json ->> 'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v3'
        OR command_type NOT IN ('continueFromV2','acceptInitialSellerRequest','pause'))) THEN
    RAISE EXCEPTION 'V3 migration and its exact continuation must commit atomically';
  END IF;
  FOR operation IN SELECT * FROM alpha_wallet_simulation.commands WHERE revision>=transition.command_revision
    AND revision<(SELECT command_revision FROM alpha_wallet_simulation.cancellation_engine_continuations WHERE singleton) LOOP
    IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.payout_intents WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.payout_events WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.chain_event_claims WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.trade_terms_events WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.acceptance_receipts WHERE command_revision=operation.revision) THEN
      RAISE EXCEPTION 'V3 initial acceptance cannot append payouts, chain claims or historical terms projections';
    END IF;
    IF operation.command_type IN ('continueFromV2','pause') THEN
      IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.journals WHERE command_revision=operation.revision)
        OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_trade_bindings WHERE command_revision=operation.revision)
        OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_acceptance_receipts WHERE command_revision=operation.revision) THEN
        RAISE EXCEPTION 'V3 continuation and pause cannot create financial effects or initial acceptance history';
      END IF;
    ELSE
      SELECT * INTO binding FROM alpha_wallet_simulation.initial_trade_bindings WHERE command_revision=operation.revision;
      SELECT * INTO receipt FROM alpha_wallet_simulation.initial_acceptance_receipts WHERE command_revision=operation.revision;
      descriptor := operation.command_json -> 'input';
      terms := descriptor -> 'terms';
      IF binding.platform_request_id IS NULL OR receipt.acceptance_key IS NULL
        OR binding.platform_request_id IS DISTINCT FROM receipt.platform_request_id
        OR binding.wallet_trade_id IS DISTINCT FROM receipt.wallet_trade_id
        OR binding.platform_trade_id IS DISTINCT FROM receipt.payload ->> 'platformTradeId'
        OR binding.payload ->> 'acceptanceKey' IS DISTINCT FROM receipt.acceptance_key
        OR binding.payload ->> 'inputDigest' IS DISTINCT FROM receipt.payload ->> 'inputDigest'
        OR binding.payload ->> 'termsDigest' IS DISTINCT FROM receipt.payload ->> 'termsDigest' THEN
        RAISE EXCEPTION 'Initial reservation, binding and original business receipt must commit together';
      END IF;
      IF descriptor IS DISTINCT FROM jsonb_build_object(
          'acceptanceKey',descriptor -> 'acceptanceKey','terms',terms,'termsDigest',descriptor -> 'termsDigest',
          'sellerAction',descriptor -> 'sellerAction','buyerRequestEvidence',descriptor -> 'buyerRequestEvidence',
          'pricing',descriptor -> 'pricing','preconditions',descriptor -> 'preconditions',
          'reservation',descriptor -> 'reservation','plannerInputDigest',descriptor -> 'plannerInputDigest')
        OR descriptor -> 'preconditions' -> 'walletRevision' IS DISTINCT FROM to_jsonb(operation.revision-1)
        OR descriptor -> 'preconditions' ->> 'walletEventHash' IS DISTINCT FROM operation.previous_event_hash
        OR descriptor -> 'preconditions' ->> 'walletStateDigest' IS DISTINCT FROM
          (SELECT state_hash FROM alpha_wallet_simulation.commands WHERE revision=operation.revision-1)
        OR descriptor -> 'preconditions' -> 'walletSellerActiveTradeCount' IS DISTINCT FROM to_jsonb(0)
        OR NOT coalesce(descriptor -> 'preconditions' -> 'sellerActiveTradeCount' IN (to_jsonb(0),to_jsonb(1),to_jsonb(2)),false)
        OR descriptor -> 'sellerAction' ->> 'kind' IS DISTINCT FROM 'initial_seller_acceptance'
        OR descriptor -> 'sellerAction' ->> 'requestedByUserId' IS DISTINCT FROM operation.command_json -> 'actor' ->> 'id'
        OR descriptor -> 'sellerAction' ->> 'requestId' IS DISTINCT FROM binding.platform_request_id
        OR descriptor -> 'buyerRequestEvidence' ->> 'kind' IS DISTINCT FROM 'retained_canonical_request'
        OR descriptor -> 'buyerRequestEvidence' ->> 'requestId' IS DISTINCT FROM binding.platform_request_id
        OR descriptor -> 'buyerRequestEvidence' ->> 'tradeId' IS DISTINCT FROM binding.platform_trade_id
        OR descriptor -> 'buyerRequestEvidence' ->> 'buyerId' IS DISTINCT FROM terms ->> 'buyerId'
        OR descriptor -> 'buyerRequestEvidence' ->> 'requestDigest' IS DISTINCT FROM descriptor -> 'preconditions' ->> 'requestDigest'
        OR descriptor -> 'buyerRequestEvidence' ->> 'termsDigest' IS DISTINCT FROM descriptor ->> 'termsDigest'
        OR descriptor -> 'buyerRequestEvidence' ->> 'feePolicyVersion' IS DISTINCT FROM terms ->> 'feePolicyVersion'
        OR descriptor -> 'buyerRequestEvidence' ->> 'commissionCalculationVersion' IS DISTINCT FROM terms ->> 'commissionCalculationVersion'
        OR descriptor -> 'buyerRequestEvidence' -> 'buyerSafetyAcknowledged' IS DISTINCT FROM to_jsonb(true)
        OR descriptor -> 'pricing' ->> 'source' IS DISTINCT FROM 'retained_request'
        OR terms ->> 'priceMode' IS DISTINCT FROM 'listing_price'
        OR terms ->> 'pricePerUsdt' IS DISTINCT FROM terms ->> 'listingPriceAtRequest'
        OR NOT coalesce(terms ->> 'paymentMethod' IN ('Bank Transfer','Face-to-Face (Meet in Person)'),false)
        OR descriptor -> 'sellerAction' -> 'faceToFaceSafetyAcknowledged' IS DISTINCT FROM
          to_jsonb(terms ->> 'paymentMethod'='Face-to-Face (Meet in Person)')
        OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision<operation.revision
          AND revision>=transition.command_revision AND command_type='pause') THEN
        RAISE EXCEPTION 'Initial acceptance must retain its exact wallet checkpoint, seller action and buyer request evidence';
      END IF;
      IF descriptor -> 'reservation' IS DISTINCT FROM jsonb_build_object(
          'action','reserve','assetId',terms -> 'assetId','walletListingId',terms -> 'walletListingId',
          'walletTradeId',binding.wallet_trade_id,'principalRaw',terms -> 'principalRaw','transferAmountRaw',terms -> 'principalRaw',
          'fromAccount','listing:' || (terms ->> 'walletListingId'),'toAccount','trade:' || binding.wallet_trade_id,
          'expectedListingAvailableRaw',descriptor -> 'reservation' -> 'expectedListingAvailableRaw',
          'expectedTradeReservedRaw','0','availableForRequestRaw',descriptor -> 'reservation' -> 'expectedListingAvailableRaw')
        OR NOT coalesce(terms ->> 'principalRaw' ~ '^[1-9][0-9]{0,77}$',false)
        OR NOT coalesce(descriptor -> 'reservation' ->> 'expectedListingAvailableRaw' ~ '^[1-9][0-9]{0,77}$',false)
        OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_trade_bindings prior
          WHERE prior.command_revision<operation.revision AND
            (prior.payload -> 'terms' ->> 'sellerId'=terms ->> 'sellerId' OR prior.payload -> 'terms' ->> 'buyerId'=terms ->> 'buyerId')) THEN
        RAISE EXCEPTION 'Initial reservation must preserve full principal and its unreserved first-cohort identities';
      END IF;
      principal := (terms ->> 'principalRaw')::numeric;
      IF principal>(descriptor -> 'reservation' ->> 'expectedListingAvailableRaw')::numeric
        OR (SELECT coalesce(sum(entry.delta_units),0) FROM alpha_wallet_simulation.entries entry
          JOIN alpha_wallet_simulation.journals journal USING(journal_id)
          WHERE journal.command_revision<operation.revision AND entry.asset_id=terms ->> 'assetId'
            AND entry.account='listing:' || (terms ->> 'walletListingId'))
          IS DISTINCT FROM (descriptor -> 'reservation' ->> 'expectedListingAvailableRaw')::numeric
        OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.entries entry
          JOIN alpha_wallet_simulation.journals journal USING(journal_id)
          WHERE journal.command_revision<operation.revision AND entry.account='trade:' || binding.wallet_trade_id
          GROUP BY entry.asset_id HAVING sum(entry.delta_units)<>0)
        OR (SELECT count(*) FROM alpha_wallet_simulation.journals WHERE command_revision=operation.revision)<>1 THEN
        RAISE EXCEPTION 'Initial reservation must consume the recorded listing balance and create exactly one full-principal journal';
      END IF;
      SELECT * INTO journal_row FROM alpha_wallet_simulation.journals WHERE command_revision=operation.revision;
      IF journal_row.asset_id IS DISTINCT FROM terms ->> 'assetId' OR journal_row.operation IS DISTINCT FROM 'v3:' || operation.command_key
        OR (SELECT count(*) FROM alpha_wallet_simulation.entries WHERE journal_id=journal_row.journal_id)<>2
        OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.entries WHERE journal_id=journal_row.journal_id
          AND account='listing:' || (terms ->> 'walletListingId') AND delta_units=-principal)
        OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.entries WHERE journal_id=journal_row.journal_id
          AND account='trade:' || binding.wallet_trade_id AND delta_units=principal) THEN
        RAISE EXCEPTION 'Initial journal must move only full principal between the exact listing and trade accounts';
      END IF;
    END IF;
  END LOOP;
END;
$fn$;

-- Retain the original v2 terms/receipt checks and bound its version interval.
-- The original migration file and every historical row remain unchanged.
CREATE OR REPLACE FUNCTION alpha_wallet_simulation.validate_versioned_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE transition alpha_wallet_simulation.engine_continuations%ROWTYPE;
  initial_transition alpha_wallet_simulation.initial_engine_continuations%ROWTYPE;
  operation alpha_wallet_simulation.commands%ROWTYPE;
  terms alpha_wallet_simulation.trade_terms_events%ROWTYPE;
  prior_terms alpha_wallet_simulation.trade_terms_events%ROWTYPE;
  receipt alpha_wallet_simulation.acceptance_receipts%ROWTYPE;
  delta numeric;
  journal_row alpha_wallet_simulation.journals%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_v4_protocol();
  SELECT * INTO transition FROM alpha_wallet_simulation.engine_continuations WHERE singleton;
  SELECT * INTO initial_transition FROM alpha_wallet_simulation.initial_engine_continuations WHERE singleton;
  IF transition.command_revision IS NULL OR initial_transition.command_revision IS NULL
    OR initial_transition.source_revision<transition.command_revision
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=4 AND revision>=initial_transition.command_revision)
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision=transition.command_revision
      AND command_key=transition.command_key AND command_type='continueFromV1'
      AND previous_event_hash=transition.source_event_hash AND occurred_at_ms>=transition.source_occurred_at_ms
      AND command_json -> 'input' = jsonb_build_object('checkpoint',jsonb_build_object(
        'revision',transition.source_revision,'eventHash',transition.source_event_hash,
        'stateHash',transition.source_state_hash,'lastCommandAtMs',transition.source_occurred_at_ms)))
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision<transition.command_revision
      AND (command_json -> 'version' IS DISTINCT FROM to_jsonb(1)
        OR command_json ->> 'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v1'))
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision>=transition.command_revision AND revision<initial_transition.command_revision
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
    WHERE revision>=transition.command_revision AND revision<initial_transition.command_revision
      AND command_type IN ('continueFromV1','enrollReservedTrade','acceptAmountCorrection') LOOP
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
  PERFORM alpha_wallet_simulation.assert_initial_financial_integrity();
  PERFORM alpha_wallet_simulation.assert_cancellation_financial_integrity();
  RETURN NEW;
END;
$fn$;

-- These checks enforce a closed financial transition. Canonical booleans and
-- digests remain assertions; this isolated module supplies no authenticated
-- marketplace authority and cannot activate an existing canonical cohort.
CREATE FUNCTION alpha_wallet_simulation.guard_initial_cancellation_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE operation alpha_wallet_simulation.commands%ROWTYPE;
  binding alpha_wallet_simulation.initial_trade_bindings%ROWTYPE;
  accepted alpha_wallet_simulation.initial_acceptance_receipts%ROWTYPE;
  descriptor jsonb; terms jsonb; original jsonb; conditions jsonb;
  principal numeric; available numeric;
BEGIN
  PERFORM alpha_wallet_simulation.require_current_command(NEW.command_revision);
  SELECT * INTO operation FROM alpha_wallet_simulation.commands WHERE revision=NEW.command_revision;
  descriptor := operation.command_json -> 'input';
  terms := descriptor -> 'terms';
  original := descriptor -> 'originalAcceptance';
  conditions := descriptor -> 'preconditions';
  SELECT * INTO binding FROM alpha_wallet_simulation.initial_trade_bindings WHERE platform_request_id=NEW.platform_request_id;
  SELECT * INTO accepted FROM alpha_wallet_simulation.initial_acceptance_receipts WHERE platform_request_id=NEW.platform_request_id;
  IF operation.command_type<>'cancelInitialTrade' OR operation.result_json IS DISTINCT FROM NEW.payload
    OR binding.platform_request_id IS NULL OR accepted.acceptance_key IS NULL
    OR NEW.cancellation_key IS DISTINCT FROM descriptor ->> 'cancellationKey'
    OR jsonb_typeof(descriptor -> 'cancellationKey') IS DISTINCT FROM 'string'
    OR NEW.platform_request_id IS DISTINCT FROM terms ->> 'platformRequestId'
    OR NEW.wallet_trade_id IS DISTINCT FROM binding.wallet_trade_id
    OR terms IS DISTINCT FROM binding.payload -> 'terms'
    OR descriptor -> 'termsDigest' IS DISTINCT FROM binding.payload -> 'termsDigest'
    OR original IS DISTINCT FROM jsonb_build_object('acceptanceKey',accepted.acceptance_key,
      'commandRevision',accepted.command_revision,'commandKey',accepted.payload -> 'commandKey',
      'receiptDigest',original -> 'receiptDigest','bindingDigest',original -> 'bindingDigest')
    OR NOT coalesce(original ->> 'receiptDigest' ~ '^[0-9a-f]{64}$',false)
    OR NOT coalesce(original ->> 'bindingDigest' ~ '^[0-9a-f]{64}$',false)
    OR jsonb_typeof(original -> 'receiptDigest') IS DISTINCT FROM 'string'
    OR jsonb_typeof(original -> 'bindingDigest') IS DISTINCT FROM 'string'
    OR operation.command_json -> 'actor' ->> 'id' IS DISTINCT FROM
      (CASE operation.command_json -> 'actor' ->> 'kind' WHEN 'buyer' THEN terms ->> 'buyerId' ELSE terms ->> 'sellerId' END)
    OR descriptor -> 'cancelledAtMs' IS DISTINCT FROM to_jsonb(operation.occurred_at_ms)
    OR operation.occurred_at_ms<=(accepted.payload ->> 'acceptedAtMs')::bigint THEN
    RAISE EXCEPTION 'Cancellation must retain its original initial acceptance, terms and party identity';
  END IF;
  IF descriptor IS DISTINCT FROM jsonb_build_object('cancellationKey',descriptor -> 'cancellationKey',
      'terms',terms,'termsDigest',descriptor -> 'termsDigest','originalAcceptance',original,
      'cancelledAtMs',descriptor -> 'cancelledAtMs','preconditions',conditions,
      'principalReturn',descriptor -> 'principalReturn','plannerInputDigest',descriptor -> 'plannerInputDigest')
    OR conditions IS DISTINCT FROM jsonb_build_object('requestUpdatedAt',conditions -> 'requestUpdatedAt',
      'requestDigest',conditions -> 'requestDigest','listingDigest',conditions -> 'listingDigest',
      'tradeDigest',conditions -> 'tradeDigest','marketplaceDigest',conditions -> 'marketplaceDigest',
      'listingExpiresAt',conditions -> 'listingExpiresAt','canonicalPrepayment',true,'canonicalTermsUnchanged',true,
      'buyerBankDetailsDisclosed',conditions -> 'buyerBankDetailsDisclosed',
      'walletRevision',operation.revision-1,'walletEventHash',operation.previous_event_hash,
      'walletStateDigest',(SELECT state_hash FROM alpha_wallet_simulation.commands WHERE revision=operation.revision-1),
      'walletTradeDigest',binding.payload -> 'walletTradeDigest',
      'walletListingDigest',accepted.payload -> 'input' -> 'preconditions' -> 'walletListingDigest')
    OR jsonb_typeof(conditions -> 'buyerBankDetailsDisclosed') IS DISTINCT FROM 'boolean'
    OR (operation.command_json -> 'actor' ->> 'kind'='buyer' AND conditions -> 'buyerBankDetailsDisclosed'='true'::jsonb)
    OR (conditions -> 'buyerBankDetailsDisclosed'='true'::jsonb AND terms ->> 'paymentMethod'<>'Bank Transfer')
    OR NOT coalesce(conditions ->> 'requestDigest' ~ '^[0-9a-f]{64}$',false)
    OR NOT coalesce(conditions ->> 'listingDigest' ~ '^[0-9a-f]{64}$',false)
    OR NOT coalesce(conditions ->> 'tradeDigest' ~ '^[0-9a-f]{64}$',false)
    OR NOT coalesce(conditions ->> 'marketplaceDigest' ~ '^[0-9a-f]{64}$',false)
    OR jsonb_typeof(conditions -> 'requestDigest') IS DISTINCT FROM 'string'
    OR jsonb_typeof(conditions -> 'listingDigest') IS DISTINCT FROM 'string'
    OR jsonb_typeof(conditions -> 'tradeDigest') IS DISTINCT FROM 'string'
    OR jsonb_typeof(conditions -> 'marketplaceDigest') IS DISTINCT FROM 'string'
    OR NOT coalesce(conditions ->> 'requestUpdatedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$',false)
    OR extract(epoch FROM (conditions ->> 'requestUpdatedAt')::timestamptz)*1000>=operation.occurred_at_ms
    OR extract(epoch FROM (conditions ->> 'requestUpdatedAt')::timestamptz)*1000<(accepted.payload ->> 'acceptedAtMs')::bigint
    OR conditions -> 'listingExpiresAt' IS NULL
    OR (conditions -> 'listingExpiresAt'<>'null'::jsonb AND
      (NOT coalesce(conditions ->> 'listingExpiresAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$',false)
       OR extract(epoch FROM (conditions ->> 'listingExpiresAt')::timestamptz)*1000<=operation.occurred_at_ms))
    OR NOT coalesce(descriptor ->> 'plannerInputDigest' ~ '^[0-9a-f]{64}$',false)
    OR jsonb_typeof(descriptor -> 'plannerInputDigest') IS DISTINCT FROM 'string'
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.cancellation_engine_continuations WHERE singleton AND source_halt_reason IS NOT NULL)
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE command_type='pause' AND revision<operation.revision
      AND revision>accepted.command_revision) THEN
    RAISE EXCEPTION 'Cancellation requires the exact unpaused wallet checkpoint and unexpired prepayment assertions';
  END IF;
  principal := (terms ->> 'principalRaw')::numeric;
  SELECT coalesce(sum(entry.delta_units),0) INTO available FROM alpha_wallet_simulation.entries entry
    JOIN alpha_wallet_simulation.journals journal USING(journal_id)
    WHERE journal.command_revision<operation.revision AND entry.asset_id=terms ->> 'assetId'
      AND entry.account='listing:' || (terms ->> 'walletListingId');
  IF descriptor -> 'principalReturn' IS DISTINCT FROM jsonb_build_object('action','return_to_listing',
      'assetId',terms -> 'assetId','walletListingId',terms -> 'walletListingId','walletTradeId',NEW.wallet_trade_id,
      'principalRaw',principal::text,'transferAmountRaw',principal::text,
      'fromAccount','trade:' || NEW.wallet_trade_id,'toAccount','listing:' || (terms ->> 'walletListingId'),
      'expectedListingAvailableRaw',available::text,'expectedTradeReservedRaw',principal::text)
    OR principal<=0 OR available<0
    OR NEW.payload IS DISTINCT FROM jsonb_build_object('cancellationKey',NEW.cancellation_key,
      'platformRequestId',NEW.platform_request_id,'platformTradeId',binding.platform_trade_id,
      'platformListingId',terms -> 'platformListingId','walletTradeId',NEW.wallet_trade_id,'walletListingId',terms -> 'walletListingId',
      'acceptanceKey',accepted.acceptance_key,'actorUserId',operation.command_json -> 'actor' -> 'id',
      'actorKind',operation.command_json -> 'actor' -> 'kind','commandRevision',NEW.command_revision,'commandKey',operation.command_key,
      'inputDigest',NEW.payload -> 'inputDigest','plannerInputDigest',descriptor -> 'plannerInputDigest',
      'termsDigest',descriptor -> 'termsDigest','principalRaw',principal::text,'transferAmountRaw',principal::text,
      'listingAvailableBeforeRaw',available::text,'listingAvailableAfterRaw',(available+principal)::text,
      'cancelledAtMs',operation.occurred_at_ms,'input',descriptor)
    OR NOT coalesce(NEW.payload ->> 'inputDigest' ~ '^[0-9a-f]{64}$',false)
    OR jsonb_typeof(NEW.payload -> 'inputDigest') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Cancellation receipt must record the exact full-principal return to its original listing';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.assert_cancellation_financial_integrity() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE transition alpha_wallet_simulation.cancellation_engine_continuations%ROWTYPE;
  operation alpha_wallet_simulation.commands%ROWTYPE;
  receipt alpha_wallet_simulation.initial_cancellation_receipts%ROWTYPE;
  journal_row alpha_wallet_simulation.journals%ROWTYPE;
  terms jsonb; principal numeric;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_v4_protocol();
  SELECT * INTO transition FROM alpha_wallet_simulation.cancellation_engine_continuations WHERE singleton;
  IF transition.command_revision IS NULL
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=4 AND revision>=transition.command_revision)
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision=transition.source_revision
      AND event_hash=transition.source_event_hash AND state_hash=transition.source_state_hash
      AND occurred_at_ms=transition.source_occurred_at_ms AND command_json -> 'version'=to_jsonb(3)
      AND command_json ->> 'engineVersion'='alpha-wallet-simulation-v3')
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision=transition.command_revision
      AND command_key=transition.command_key AND command_type='continueFromV3'
      AND previous_event_hash=transition.source_event_hash AND occurred_at_ms>=transition.source_occurred_at_ms
      AND command_json -> 'input'=jsonb_build_object('checkpoint',jsonb_build_object(
        'revision',transition.source_revision,'eventHash',transition.source_event_hash,
        'stateHash',transition.source_state_hash,'lastCommandAtMs',transition.source_occurred_at_ms))
      AND result_json=jsonb_build_object('checkpoint',command_json -> 'input' -> 'checkpoint',
        'commandRevision',transition.command_revision,'commandKey',transition.command_key,'sourceHaltReason',transition.source_halt_reason))
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE command_type='continueFromV3' AND revision<>transition.command_revision)
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision>=transition.command_revision
      AND (command_json -> 'version' IS DISTINCT FROM to_jsonb(4)
        OR command_json ->> 'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v4'
        OR command_type NOT IN ('continueFromV3','cancelInitialTrade','pause'))) THEN
    RAISE EXCEPTION 'V4 migration and its exact continuation must commit atomically';
  END IF;
  FOR operation IN SELECT * FROM alpha_wallet_simulation.commands WHERE revision>=transition.command_revision LOOP
    IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.payout_intents WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.payout_events WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.chain_event_claims WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.trade_terms_events WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.acceptance_receipts WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_trade_bindings WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_acceptance_receipts WHERE command_revision=operation.revision) THEN
      RAISE EXCEPTION 'V4 cannot append payouts, chain claims or historical terms and acceptance projections';
    END IF;
    IF operation.command_type IN ('continueFromV3','pause') THEN
      IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.journals WHERE command_revision=operation.revision)
        OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_cancellation_receipts WHERE command_revision=operation.revision) THEN
        RAISE EXCEPTION 'V4 continuation and pause cannot create financial effects or cancellation receipts';
      END IF;
    ELSE
      SELECT * INTO receipt FROM alpha_wallet_simulation.initial_cancellation_receipts WHERE command_revision=operation.revision;
      IF receipt.cancellation_key IS NULL OR receipt.payload IS DISTINCT FROM operation.result_json THEN
        RAISE EXCEPTION 'Cancellation and immutable business receipt must commit together';
      END IF;
      terms := operation.command_json -> 'input' -> 'terms';
      principal := (terms ->> 'principalRaw')::numeric;
      IF (SELECT coalesce(sum(entry.delta_units),0) FROM alpha_wallet_simulation.entries entry
          JOIN alpha_wallet_simulation.journals journal USING(journal_id)
          WHERE journal.command_revision<operation.revision AND entry.asset_id=terms ->> 'assetId'
            AND entry.account='trade:' || receipt.wallet_trade_id) IS DISTINCT FROM principal
        OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.entries entry
          JOIN alpha_wallet_simulation.journals journal USING(journal_id)
          WHERE journal.command_revision<operation.revision AND entry.account='trade:' || receipt.wallet_trade_id
            AND entry.asset_id<>terms ->> 'assetId' GROUP BY entry.asset_id HAVING sum(entry.delta_units)<>0)
        OR (SELECT count(*) FROM alpha_wallet_simulation.journals WHERE command_revision=operation.revision)<>1 THEN
        RAISE EXCEPTION 'Cancellation must consume its exact existing full-principal reservation';
      END IF;
      SELECT * INTO journal_row FROM alpha_wallet_simulation.journals WHERE command_revision=operation.revision;
      IF journal_row.asset_id IS DISTINCT FROM terms ->> 'assetId' OR journal_row.operation IS DISTINCT FROM 'v4:' || operation.command_key
        OR (SELECT count(*) FROM alpha_wallet_simulation.entries WHERE journal_id=journal_row.journal_id)<>2
        OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.entries WHERE journal_id=journal_row.journal_id
          AND account='trade:' || receipt.wallet_trade_id AND delta_units=-principal)
        OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.entries WHERE journal_id=journal_row.journal_id
          AND account='listing:' || (terms ->> 'walletListingId') AND delta_units=principal) THEN
        RAISE EXCEPTION 'Cancellation journal must return only full principal between the exact trade and listing accounts';
      END IF;
    END IF;
  END LOOP;
END;
$fn$;

CREATE TRIGGER cancellation_continuation_append BEFORE INSERT ON alpha_wallet_simulation.cancellation_engine_continuations
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.guard_cancellation_continuation();
CREATE TRIGGER initial_cancellation_append BEFORE INSERT ON alpha_wallet_simulation.initial_cancellation_receipts
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.guard_initial_cancellation_receipt();
DO $table_guards$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['cancellation_engine_continuations','initial_cancellation_receipts'] LOOP
    EXECUTE format('ALTER TABLE alpha_wallet_simulation.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE alpha_wallet_simulation.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE TRIGGER immutable_records BEFORE UPDATE OR DELETE OR TRUNCATE ON alpha_wallet_simulation.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_simulation.reject_change()',table_name);
    EXECUTE format('CREATE CONSTRAINT TRIGGER versioned_integrity AFTER INSERT ON alpha_wallet_simulation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.validate_versioned_integrity()',table_name);
  END LOOP;
END;
$table_guards$;
SELECT set_config('alpha_wallet.writer_protocol','simulation-v4',true);
INSERT INTO alpha_wallet_simulation.cancellation_engine_continuations
  (command_revision,command_key,source_revision,source_event_hash,source_state_hash,source_occurred_at_ms,source_halt_reason)
SELECT revision+1,current_setting('alpha_wallet.v4_upgrade_key',true),revision,last_event_hash::text,
  current_setting('alpha_wallet.v4_upgrade_command',true)::jsonb -> 'input' -> 'checkpoint' ->> 'stateHash',
  (current_setting('alpha_wallet.v4_upgrade_command',true)::jsonb -> 'input' -> 'checkpoint' ->> 'lastCommandAtMs')::bigint,
  current_setting('alpha_wallet.v4_source_halt_reason',true)::jsonb #>> '{}'
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

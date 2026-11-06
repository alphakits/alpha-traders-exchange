-- EXPLICIT DEVELOPMENT-ONLY V4 -> V5 claim-only continuation.
-- Existing V1-V4 rows and their meaning stay immutable. New claims/disputes move
-- zero principal and create no verified fiat evidence, release or provider work.
-- The caller explicitly acknowledges that NEW cancellation is outside this
-- one-way profile. DDL, exact continuation, and format 5 head commit together.
DO $guard$
DECLARE operation jsonb; expected jsonb; saved_head alpha_wallet_simulation.head%ROWTYPE;
  saved_command alpha_wallet_simulation.commands%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_writer();
  IF current_setting('alpha_wallet.writer_protocol',true) IS DISTINCT FROM 'simulation-v4'
    OR current_setting('alpha_wallet.schema_upgrade',true) IS DISTINCT FROM 'v4-to-v5'
    OR current_setting('alpha_wallet.v5_claim_only_acknowledged',true) IS DISTINCT FROM 'true'
    OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('alpha_wallet_marketplace_simulation',
      'alpha_wallet_initial_marketplace_simulation','alpha_wallet_cancellation_marketplace_simulation','alpha_wallet_payment_marketplace_simulation')) THEN
    RAISE EXCEPTION 'Explicit isolated V4 to V5 claim-only enrollment acknowledgment required';
  END IF;
  SELECT * INTO saved_head FROM alpha_wallet_simulation.head WHERE singleton;
  IF saved_head.format_version IS DISTINCT FROM 4
    OR to_regclass('alpha_wallet_simulation.cancellation_engine_continuations') IS NULL
    OR to_regclass('alpha_wallet_simulation.initial_cancellation_receipts') IS NULL
    OR to_regclass('alpha_wallet_simulation.payment_engine_continuations') IS NOT NULL
    OR to_regclass('alpha_wallet_simulation.initial_payment_claim_receipts') IS NOT NULL
    OR to_regclass('alpha_wallet_simulation.initial_dispute_freeze_receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'Upgrade requires intact V4 storage without any previous V5 preparation';
  END IF;
  operation:=current_setting('alpha_wallet.v5_upgrade_command',true)::jsonb;
  expected:=operation->'input'->'checkpoint';
  IF operation IS NULL OR operation IS DISTINCT FROM jsonb_build_object('version',5,'engineVersion','alpha-wallet-simulation-v5',
      'type','continueFromV4','actor',jsonb_build_object('kind','operator','id',operation->'actor'->'id'),
      'requestId',operation->'requestId','input',jsonb_build_object('checkpoint',jsonb_build_object(
        'revision',saved_head.revision,'eventHash',saved_head.last_event_hash::text,'stateHash',expected->'stateHash',
        'lastCommandAtMs',expected->'lastCommandAtMs')))
    OR NOT coalesce(operation->'actor'->>'id' ~ '^[A-Za-z0-9_-]{1,80}$',false)
    OR NOT coalesce(operation->>'requestId' ~ '^[A-Za-z0-9_-]{1,80}$',false)
    OR jsonb_typeof(operation->'actor'->'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(operation->'requestId') IS DISTINCT FROM 'string'
    OR current_setting('alpha_wallet.v5_upgrade_key',true)::jsonb IS DISTINCT FROM
      jsonb_build_array('operator',operation->'actor'->>'id','continueFromV4',operation->>'requestId')
    OR NOT coalesce(expected->>'stateHash' ~ '^[0-9a-f]{64}$',false) THEN
    RAISE EXCEPTION 'V5 upgrade command and verified source checkpoint disagree';
  END IF;
  SELECT * INTO saved_command FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1;
  IF saved_command.revision IS NULL OR saved_command.revision IS DISTINCT FROM saved_head.revision
    OR saved_command.event_hash IS DISTINCT FROM saved_head.last_event_hash::text
    OR saved_command.state_hash IS DISTINCT FROM expected->>'stateHash'
    OR to_jsonb(saved_command.occurred_at_ms) IS DISTINCT FROM expected->'lastCommandAtMs'
    OR saved_command.command_json->'version' IS DISTINCT FROM to_jsonb(4)
    OR saved_command.command_json->>'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v4' THEN
    RAISE EXCEPTION 'V5 continuation must match the immutable V4 prefix';
  END IF;
END;
$guard$;
ALTER TABLE alpha_wallet_simulation.head DROP CONSTRAINT head_format_version_check;
ALTER TABLE alpha_wallet_simulation.head ADD CONSTRAINT head_format_version_check CHECK(format_version IN (1,2,3,4,5));
CREATE TABLE alpha_wallet_simulation.payment_engine_continuations (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision) DEFERRABLE INITIALLY DEFERRED,
  command_key text NOT NULL CHECK(length(command_key) BETWEEN 1 AND 1024),
  source_revision integer NOT NULL CHECK(source_revision>0 AND command_revision=source_revision+1),
  source_event_hash text NOT NULL CHECK(source_event_hash ~ '^[0-9a-f]{64}$'),
  source_state_hash text NOT NULL CHECK(source_state_hash ~ '^[0-9a-f]{64}$'),
  source_occurred_at_ms bigint NOT NULL CHECK(source_occurred_at_ms BETWEEN 0 AND 9007199254740991),
  source_halt_reason text CHECK(source_halt_reason IS NULL OR length(source_halt_reason)>0)
);
CREATE TABLE alpha_wallet_simulation.initial_payment_claim_receipts (
  claim_key text PRIMARY KEY CHECK(claim_key ~ '^[0-9a-f]{64}$'),
  platform_request_id text NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.initial_trade_bindings(platform_request_id),
  wallet_trade_id text NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.initial_trade_bindings(wallet_trade_id),
  command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object')
);
CREATE TABLE alpha_wallet_simulation.initial_dispute_freeze_receipts (
  dispute_key text PRIMARY KEY CHECK(dispute_key ~ '^[0-9a-f]{64}$'),
  platform_request_id text NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.initial_payment_claim_receipts(platform_request_id),
  wallet_trade_id text NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.initial_payment_claim_receipts(wallet_trade_id),
  command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object')
);
CREATE UNIQUE INDEX initial_claim_proof_identity ON alpha_wallet_simulation.initial_payment_claim_receipts
  ((payload#>>'{input,claim,proof,evidenceId}')) WHERE payload#>>'{input,claim,proof,evidenceId}' IS NOT NULL;
CREATE UNIQUE INDEX initial_claim_proof_content ON alpha_wallet_simulation.initial_payment_claim_receipts
  ((payload#>>'{input,claim,proof,contentSha256}')) WHERE payload#>>'{input,claim,proof,contentSha256}' IS NOT NULL;
CREATE FUNCTION alpha_wallet_simulation.require_v5_protocol() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,alpha_wallet_simulation AS $fn$
BEGIN
  IF current_setting('alpha_wallet.writer_protocol',true) IS DISTINCT FROM 'simulation-v5'
    OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('alpha_wallet_marketplace_simulation',
      'alpha_wallet_initial_marketplace_simulation','alpha_wallet_cancellation_marketplace_simulation','alpha_wallet_payment_marketplace_simulation')) THEN
    RAISE EXCEPTION 'V5 financial storage requires its isolated simulation-v5 protocol';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION alpha_wallet_simulation.require_writer() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_v5_protocol();
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
    JOIN alpha_wallet_simulation.payment_engine_continuations continuation ON continuation.singleton
    WHERE operation.revision=$1 AND operation.revision>=continuation.command_revision
      AND operation.command_json -> 'version'=to_jsonb(5)
      AND operation.command_json ->> 'engineVersion'='alpha-wallet-simulation-v5'
      AND operation.xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296)) THEN
    RAISE EXCEPTION 'V5 command and projections must be appended together; historical projections are sealed';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION alpha_wallet_simulation.guard_head_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE transition alpha_wallet_simulation.payment_engine_continuations%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_v5_protocol();
  IF NEW.singleton IS DISTINCT FROM OLD.singleton OR NEW.mode IS DISTINCT FROM OLD.mode THEN
    RAISE EXCEPTION 'Wallet storage identity is immutable';
  END IF;
  IF NEW.format_version IS DISTINCT FROM OLD.format_version THEN
    IF OLD.format_version<>4 OR NEW.format_version<>5 OR NEW.lock_version<>OLD.lock_version THEN
      RAISE EXCEPTION 'Wallet storage version may advance only with its exact v5 continuation';
    END IF;
    PERFORM alpha_wallet_simulation.require_writer();
    SELECT * INTO transition FROM alpha_wallet_simulation.payment_engine_continuations WHERE singleton;
    IF transition.source_revision IS DISTINCT FROM OLD.revision
      OR transition.source_event_hash IS DISTINCT FROM OLD.last_event_hash::text
      OR transition.command_revision IS DISTINCT FROM NEW.revision
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.payment_engine_continuations WHERE singleton
        AND xmin::text::numeric=mod(pg_current_xact_id()::text::numeric,4294967296))
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision=transition.command_revision
        AND command_type='continueFromV4' AND command_key=transition.command_key AND event_hash=NEW.last_event_hash::text) THEN
      RAISE EXCEPTION 'V5 storage and continuation must advance in one transaction';
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
  transition alpha_wallet_simulation.payment_engine_continuations%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_writer();
  SELECT * INTO prior FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1;
  IF NEW.revision<>coalesce(prior.revision,0)+1 OR NEW.previous_event_hash<>coalesce(prior.event_hash,repeat('0',64))
    OR NEW.occurred_at_ms<coalesce(prior.occurred_at_ms,0) THEN
    RAISE EXCEPTION 'Command revision, time and hash must extend the existing log';
  END IF;
  IF NEW.command_json -> 'version' IS DISTINCT FROM to_jsonb(5)
    OR NEW.command_json ->> 'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v5'
    OR NEW.command_json ->> 'type' IS DISTINCT FROM NEW.command_type
    OR NEW.command_json IS DISTINCT FROM jsonb_build_object(
      'version',5,'engineVersion','alpha-wallet-simulation-v5','type',NEW.command_type,
      'actor',jsonb_build_object('kind',NEW.command_json -> 'actor' -> 'kind','id',NEW.command_json -> 'actor' -> 'id'),
      'requestId',NEW.command_json -> 'requestId','input',NEW.command_json -> 'input')
    OR NOT coalesce(CASE WHEN NEW.command_type IN ('claimInitialPayment','freezeInitialDispute') THEN NEW.command_json -> 'actor' ->> 'kind'='buyer'
      ELSE NEW.command_json -> 'actor' ->> 'kind'='operator' END,false)
    OR jsonb_typeof(NEW.command_json -> 'actor' -> 'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(NEW.command_json -> 'requestId') IS DISTINCT FROM 'string'
    OR NOT coalesce(NEW.command_json -> 'actor' ->> 'id' ~ '^[A-Za-z0-9_-]{1,80}$',false)
    OR NOT coalesce(NEW.command_json ->> 'requestId' ~ '^[A-Za-z0-9_-]{1,80}$',false)
    OR NEW.command_key::jsonb IS DISTINCT FROM jsonb_build_array(NEW.command_json -> 'actor' ->> 'kind',
      NEW.command_json -> 'actor' ->> 'id',NEW.command_type,NEW.command_json ->> 'requestId')
    OR NEW.command_type NOT IN ('continueFromV4','claimInitialPayment','freezeInitialDispute','pause') THEN
    RAISE EXCEPTION 'V5 storage rejects unknown engines, unsupported actions and legacy appends';
  END IF;
  IF NEW.input_hash IS DISTINCT FROM alpha_wallet_simulation.v5_digest(NEW.command_json)
    OR NEW.result_hash IS DISTINCT FROM alpha_wallet_simulation.v5_digest(NEW.result_json)
    OR NEW.event_hash IS DISTINCT FROM alpha_wallet_simulation.v5_digest(jsonb_build_object(
      'revision',NEW.revision,'commandKey',NEW.command_key,'at',NEW.occurred_at_ms,
      'inputHash',NEW.input_hash,'resultHash',NEW.result_hash,'stateHash',NEW.state_hash,'previousHash',NEW.previous_event_hash)) THEN
    RAISE EXCEPTION 'V5 command, result and hash-chain commitments must match their exact JSON';
  END IF;
  IF NEW.command_type='pause' AND (NEW.command_json -> 'input' IS DISTINCT FROM 'null'::jsonb
    OR NEW.result_json IS DISTINCT FROM jsonb_build_object('halted',true)) THEN
    RAISE EXCEPTION 'V5 pause must retain its exact closed contract';
  END IF;
  IF prior.command_json ->> 'engineVersion'='alpha-wallet-simulation-v5' THEN
    IF NEW.command_type='continueFromV4' OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=5) THEN
      RAISE EXCEPTION 'A v5 continuation cannot repeat or precede its storage transition';
    END IF;
  ELSE
    SELECT * INTO transition FROM alpha_wallet_simulation.payment_engine_continuations WHERE singleton;
    IF prior.command_json ->> 'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v4'
      OR NEW.command_type<>'continueFromV4'
      OR transition.command_revision IS DISTINCT FROM NEW.revision OR transition.command_key IS DISTINCT FROM NEW.command_key
      OR NEW.command_json -> 'input' IS DISTINCT FROM jsonb_build_object('checkpoint',jsonb_build_object(
        'revision',transition.source_revision,'eventHash',transition.source_event_hash,
        'stateHash',transition.source_state_hash,'lastCommandAtMs',transition.source_occurred_at_ms))
      OR NEW.result_json IS DISTINCT FROM jsonb_build_object('checkpoint',NEW.command_json -> 'input' -> 'checkpoint',
        'commandRevision',NEW.revision,'commandKey',NEW.command_key,'sourceHaltReason',transition.source_halt_reason)
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=4) THEN
      RAISE EXCEPTION 'The first v5 command must be the explicit source-bound continuation';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

-- Retained V1-V4 checks: only protocol/head and the V4 upper bound change.
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
  PERFORM alpha_wallet_simulation.require_v5_protocol();
  SELECT * INTO transition FROM alpha_wallet_simulation.initial_engine_continuations WHERE singleton;
  IF transition.command_revision IS NULL
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=5 AND revision>=transition.command_revision)
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

CREATE OR REPLACE FUNCTION alpha_wallet_simulation.assert_cancellation_financial_integrity() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE transition alpha_wallet_simulation.cancellation_engine_continuations%ROWTYPE;
  operation alpha_wallet_simulation.commands%ROWTYPE;
  receipt alpha_wallet_simulation.initial_cancellation_receipts%ROWTYPE;
  journal_row alpha_wallet_simulation.journals%ROWTYPE;
  terms jsonb; principal numeric;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_v5_protocol();
  SELECT * INTO transition FROM alpha_wallet_simulation.cancellation_engine_continuations WHERE singleton;
  IF transition.command_revision IS NULL
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=5 AND revision>=transition.command_revision)
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
      AND revision<(SELECT command_revision FROM alpha_wallet_simulation.payment_engine_continuations WHERE singleton)
      AND (command_json -> 'version' IS DISTINCT FROM to_jsonb(4)
        OR command_json ->> 'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v4'
        OR command_type NOT IN ('continueFromV3','cancelInitialTrade','pause'))) THEN
    RAISE EXCEPTION 'V4 migration and its exact continuation must commit atomically';
  END IF;
  FOR operation IN SELECT * FROM alpha_wallet_simulation.commands WHERE revision>=transition.command_revision
    AND revision<(SELECT command_revision FROM alpha_wallet_simulation.payment_engine_continuations WHERE singleton) LOOP
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
  PERFORM alpha_wallet_simulation.require_v5_protocol();
  SELECT * INTO transition FROM alpha_wallet_simulation.engine_continuations WHERE singleton;
  SELECT * INTO initial_transition FROM alpha_wallet_simulation.initial_engine_continuations WHERE singleton;
  IF transition.command_revision IS NULL OR initial_transition.command_revision IS NULL
    OR initial_transition.source_revision<transition.command_revision
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=5 AND revision>=initial_transition.command_revision)
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
  PERFORM alpha_wallet_simulation.assert_payment_financial_integrity();
  RETURN NEW;
END;
$fn$;

-- V5_CLOSED_CONTRACT
CREATE FUNCTION alpha_wallet_simulation.v5_canonical_json(value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE result text; number numeric;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'object' THEN
      SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||alpha_wallet_simulation.v5_canonical_json(item),',' ORDER BY key COLLATE "C"),'')||'}'
        INTO result FROM jsonb_each(value) AS pair(key,item);
    WHEN 'array' THEN
      SELECT '['||coalesce(string_agg(alpha_wallet_simulation.v5_canonical_json(item),',' ORDER BY ordinal),'')||']'
        INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(item,ordinal);
    WHEN 'number' THEN
      number:=(value#>>'{}')::numeric;
      IF abs(number)>=1000000000000000000000 OR (number<>0 AND abs(number)<0.000001) THEN
        RAISE EXCEPTION 'V5 numeric magnitude is outside its fixed JSON contract';
      END IF;
      result:=trim_scale(number)::text;
    ELSE result:=value::text;
  END CASE;
  RETURN result;
END;
$fn$;
CREATE FUNCTION alpha_wallet_simulation.v5_digest(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
  SELECT encode(sha256(convert_to(alpha_wallet_simulation.v5_canonical_json(value),'UTF8')),'hex');
$fn$;
CREATE FUNCTION alpha_wallet_simulation.v5_initial_trade_digest(terms jsonb,trade_id text,trade_status text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $fn$
  SELECT alpha_wallet_simulation.v5_digest(jsonb_build_object('id',$2,'listingId',$1->'walletListingId',
    'sellerId',$1->'sellerId','buyerId',$1->'buyerId','assetId',$1->'assetId','destination',$1->'destination',
    'amountRaw',jsonb_build_object('$walletType','bigint','value',$1->'principalRaw'),
    'buyerFeeRaw',jsonb_build_object('$walletType','bigint','value',$1->'buyerFeeRaw'),
    'sellerFeeRaw',jsonb_build_object('$walletType','bigint','value',$1->'sellerFeeRaw'),
    'totalFeeRaw',jsonb_build_object('$walletType','bigint','value',$1->'totalFeeRaw'),
    'fiatTotalMinor',jsonb_build_object('$walletType','bigint','value',$1->'fiatTotalMinor'),
    'currency','ILS','status',$3,'disputed',false));
$fn$;
CREATE FUNCTION alpha_wallet_simulation.guard_payment_continuation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,alpha_wallet_simulation AS $fn$
DECLARE expected_halt text;
BEGIN
  PERFORM alpha_wallet_simulation.require_writer();
  IF current_setting('alpha_wallet.schema_upgrade',true) IS DISTINCT FROM 'v4-to-v5'
    OR current_setting('alpha_wallet.v5_claim_only_acknowledged',true) IS DISTINCT FROM 'true'
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=4
      AND revision=NEW.source_revision AND last_event_hash::text=NEW.source_event_hash)
    OR NEW.command_key IS DISTINCT FROM current_setting('alpha_wallet.v5_upgrade_key',true)
    OR to_jsonb(NEW.source_halt_reason) IS DISTINCT FROM nullif(current_setting('alpha_wallet.v5_source_halt_reason',true)::jsonb,'null'::jsonb) THEN
    RAISE EXCEPTION 'V5 continuation requires its exact acknowledged V4 migration transaction';
  END IF;
  SELECT source_halt_reason INTO expected_halt FROM alpha_wallet_simulation.cancellation_engine_continuations WHERE singleton;
  IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE command_type='pause'
    AND revision>=(SELECT command_revision FROM alpha_wallet_simulation.cancellation_engine_continuations WHERE singleton)) THEN
    expected_halt:='Operator emergency pause';
  END IF;
  IF NEW.source_halt_reason IS DISTINCT FROM expected_halt THEN
    RAISE EXCEPTION 'V5 must preserve the exact immutable V4 pause state';
  END IF;
  RETURN NEW;
END;
$fn$;

-- These are financial commitments to bounded canonical facts. This isolated
-- layer does not authenticate a buyer or prove possession of uploaded bytes.
CREATE FUNCTION alpha_wallet_simulation.guard_initial_payment_lifecycle_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,alpha_wallet_simulation AS $fn$
DECLARE operation alpha_wallet_simulation.commands%ROWTYPE;
  binding alpha_wallet_simulation.initial_trade_bindings%ROWTYPE;
  accepted alpha_wallet_simulation.initial_acceptance_receipts%ROWTYPE;
  claimed alpha_wallet_simulation.initial_payment_claim_receipts%ROWTYPE;
  descriptor jsonb; terms jsonb; original jsonb; conditions jsonb; proof jsonb;
  receipt jsonb; expected_input jsonb; expected_receipt jsonb; business_key text; action_type text; at_name text;
  expected_status text; principal numeric; available numeric; reserved numeric; digest_field text;
BEGIN
  PERFORM alpha_wallet_simulation.require_current_command(NEW.command_revision);
  SELECT * INTO operation FROM alpha_wallet_simulation.commands WHERE revision=NEW.command_revision;
  descriptor:=operation.command_json->'input'; terms:=descriptor->'terms'; original:=descriptor->'originalAcceptance'; conditions:=descriptor->'preconditions';
  receipt:=to_jsonb(NEW); business_key:=coalesce(receipt->>'claim_key',receipt->>'dispute_key');
  action_type:=CASE WHEN TG_TABLE_NAME='initial_payment_claim_receipts' THEN 'claimInitialPayment' ELSE 'freezeInitialDispute' END;
  at_name:=CASE WHEN action_type='claimInitialPayment' THEN 'claimedAtMs' ELSE 'disputedAtMs' END;
  expected_status:=CASE WHEN action_type='claimInitialPayment' THEN 'accepted' ELSE 'payment_sent' END;
  SELECT * INTO binding FROM alpha_wallet_simulation.initial_trade_bindings WHERE platform_request_id=NEW.platform_request_id;
  SELECT * INTO accepted FROM alpha_wallet_simulation.initial_acceptance_receipts WHERE platform_request_id=NEW.platform_request_id;
  IF operation.command_type IS DISTINCT FROM action_type OR operation.result_json IS DISTINCT FROM NEW.payload
    OR operation.command_json->'actor'->>'kind' IS DISTINCT FROM 'buyer'
    OR operation.command_json->'actor'->'id' IS DISTINCT FROM terms->'buyerId'
    OR binding.platform_request_id IS NULL OR accepted.acceptance_key IS NULL
    OR NEW.platform_request_id IS DISTINCT FROM terms->>'platformRequestId' OR NEW.wallet_trade_id IS DISTINCT FROM binding.wallet_trade_id
    OR terms IS DISTINCT FROM binding.payload->'terms' OR descriptor->'termsDigest' IS DISTINCT FROM binding.payload->'termsDigest'
    OR descriptor->> 'termsDigest' IS DISTINCT FROM alpha_wallet_simulation.v5_digest(terms)
    OR original IS DISTINCT FROM jsonb_build_object('acceptanceKey',accepted.acceptance_key,'commandRevision',accepted.command_revision,
      'commandKey',accepted.payload->'commandKey','receiptDigest',alpha_wallet_simulation.v5_digest(accepted.payload),
      'bindingDigest',alpha_wallet_simulation.v5_digest(binding.payload))
    OR descriptor->at_name IS DISTINCT FROM to_jsonb(operation.occurred_at_ms)
    OR operation.occurred_at_ms<=(accepted.payload->>'acceptedAtMs')::bigint
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_cancellation_receipts WHERE platform_request_id=NEW.platform_request_id)
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.payout_intents WHERE trade_id=NEW.wallet_trade_id) THEN
    RAISE EXCEPTION 'Payment lifecycle must bind its unchanged original acceptance and original buyer';
  END IF;
  expected_input:=jsonb_build_object('terms',terms,'termsDigest',descriptor->'termsDigest','originalAcceptance',original,
    'preconditions',conditions,'principalHold',descriptor->'principalHold','plannerInputDigest',descriptor->'plannerInputDigest');
  IF action_type='claimInitialPayment' THEN
    expected_input:=expected_input||jsonb_build_object('claimKey',business_key,'claimedAtMs',operation.occurred_at_ms,'claim',descriptor->'claim');
    IF business_key IS DISTINCT FROM alpha_wallet_simulation.v5_digest(jsonb_build_array('alpha-wallet-initial-payment-claim-v1',NEW.platform_request_id,accepted.acceptance_key))
      OR descriptor->'claim' IS DISTINCT FROM jsonb_build_object('kind','buyer_payment_claim','buyerId',terms->'buyerId',
        'amountMinor',terms->'fiatTotalMinor','currency','ILS','proof',descriptor->'claim'->'proof') THEN
      RAISE EXCEPTION 'Buyer claim must acknowledge the full original fiat amount';
    END IF;
    proof:=descriptor->'claim'->'proof';
    IF terms->>'paymentMethod'='Bank Transfer' THEN
      IF proof IS NULL OR jsonb_typeof(proof) IS DISTINCT FROM 'object'
        OR proof IS DISTINCT FROM jsonb_build_object('evidenceId',proof->'evidenceId','contentSha256',proof->'contentSha256',
          'mimeType',proof->'mimeType','sizeBytes',proof->'sizeBytes')
        OR jsonb_typeof(proof->'evidenceId') IS DISTINCT FROM 'string' OR NOT coalesce(proof->>'evidenceId' ~ '^[A-Za-z0-9_-]{1,80}$',false)
        OR jsonb_typeof(proof->'contentSha256') IS DISTINCT FROM 'string' OR NOT coalesce(proof->>'contentSha256' ~ '^[0-9a-f]{64}$',false)
        OR jsonb_typeof(proof->'mimeType') IS DISTINCT FROM 'string' OR proof->>'mimeType' NOT IN ('image/jpeg','image/png','application/pdf')
        OR jsonb_typeof(proof->'sizeBytes') IS DISTINCT FROM 'number' OR NOT coalesce(proof->>'sizeBytes' ~ '^[1-9][0-9]{0,6}$',false)
        OR (proof->>'sizeBytes')::numeric>8388608 THEN
        RAISE EXCEPTION 'Bank claim requires its exact bounded safe buyer upload reference';
      END IF;
    ELSIF terms->>'paymentMethod' IS DISTINCT FROM 'Face-to-Face (Meet in Person)' OR proof IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'In-person cash claims cannot carry uploaded proof';
    END IF;
  ELSE
    SELECT * INTO claimed FROM alpha_wallet_simulation.initial_payment_claim_receipts WHERE platform_request_id=NEW.platform_request_id;
    expected_input:=expected_input||jsonb_build_object('disputeKey',business_key,'disputedAtMs',operation.occurred_at_ms,
      'reasonDigest',descriptor->'reasonDigest','priorClaim',descriptor->'priorClaim');
    IF business_key IS DISTINCT FROM alpha_wallet_simulation.v5_digest(jsonb_build_array('alpha-wallet-initial-dispute-freeze-v1',NEW.platform_request_id,accepted.acceptance_key))
      OR claimed.claim_key IS NULL OR claimed.command_revision>=operation.revision OR claimed.wallet_trade_id<>NEW.wallet_trade_id
      OR claimed.payload->'actorUserId' IS DISTINCT FROM operation.command_json->'actor'->'id'
      OR descriptor->'priorClaim' IS DISTINCT FROM jsonb_build_object('claimKey',claimed.claim_key,
        'commandRevision',claimed.command_revision,'receiptDigest',alpha_wallet_simulation.v5_digest(claimed.payload))
      OR operation.occurred_at_ms<=(claimed.payload->>'claimedAtMs')::bigint
      OR extract(epoch FROM (conditions->>'requestUpdatedAt')::timestamptz)*1000<(claimed.payload->>'claimedAtMs')::bigint
      OR jsonb_typeof(descriptor->'reasonDigest') IS DISTINCT FROM 'string'
      OR NOT coalesce(descriptor->>'reasonDigest' ~ '^[0-9a-f]{64}$',false) THEN
      RAISE EXCEPTION 'Buyer dispute requires the exact preceding V5 claim and bounded reason digest';
    END IF;
  END IF;
  IF descriptor IS DISTINCT FROM expected_input
    OR descriptor->>'plannerInputDigest' IS DISTINCT FROM alpha_wallet_simulation.v5_digest(jsonb_build_object(
      'actorUserId',operation.command_json->'actor'->'id','input',descriptor-'plannerInputDigest'))
    OR conditions IS DISTINCT FROM jsonb_build_object('requestUpdatedAt',conditions->'requestUpdatedAt',
      'requestDigest',conditions->'requestDigest','listingDigest',conditions->'listingDigest','tradeDigest',conditions->'tradeDigest',
      'marketplaceDigest',conditions->'marketplaceDigest','canonicalStatus',expected_status,'canonicalTermsUnchanged',true,'canonicalOpenDispute',false,
      'walletRevision',operation.revision-1,'walletEventHash',operation.previous_event_hash,
      'walletStateDigest',(SELECT state_hash FROM alpha_wallet_simulation.commands WHERE revision=operation.revision-1),
      'walletTradeDigest',alpha_wallet_simulation.v5_initial_trade_digest(terms,NEW.wallet_trade_id,
        CASE WHEN action_type='claimInitialPayment' THEN 'reserved' ELSE 'payment_reported' END),
      'walletListingDigest',accepted.payload->'input'->'preconditions'->'walletListingDigest')
    OR jsonb_typeof(conditions->'requestUpdatedAt') IS DISTINCT FROM 'string'
    OR NOT coalesce(conditions->>'requestUpdatedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$',false)
    OR extract(epoch FROM (conditions->>'requestUpdatedAt')::timestamptz)*1000>=operation.occurred_at_ms
    OR extract(epoch FROM (conditions->>'requestUpdatedAt')::timestamptz)*1000<(accepted.payload->>'acceptedAtMs')::bigint
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.payment_engine_continuations WHERE singleton AND source_halt_reason IS NOT NULL)
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE command_type='pause' AND revision<operation.revision
      AND revision>=(SELECT command_revision FROM alpha_wallet_simulation.payment_engine_continuations WHERE singleton)) THEN
    RAISE EXCEPTION 'Payment lifecycle requires its exact current unpaused checkpoint and closed canonical assertions';
  END IF;
  FOREACH digest_field IN ARRAY ARRAY['requestDigest','listingDigest','tradeDigest','marketplaceDigest'] LOOP
    IF jsonb_typeof(conditions->digest_field) IS DISTINCT FROM 'string' OR NOT coalesce(conditions->>digest_field ~ '^[0-9a-f]{64}$',false) THEN
      RAISE EXCEPTION 'Invalid canonical lifecycle digest';
    END IF;
  END LOOP;
  principal:=(terms->>'principalRaw')::numeric;
  SELECT coalesce(sum(entry.delta_units),0) INTO available FROM alpha_wallet_simulation.entries entry
    JOIN alpha_wallet_simulation.journals journal USING(journal_id) WHERE journal.command_revision<operation.revision
      AND entry.asset_id=terms->>'assetId' AND entry.account='listing:'||(terms->>'walletListingId');
  SELECT coalesce(sum(entry.delta_units),0) INTO reserved FROM alpha_wallet_simulation.entries entry
    JOIN alpha_wallet_simulation.journals journal USING(journal_id) WHERE journal.command_revision<operation.revision
      AND entry.asset_id=terms->>'assetId' AND entry.account='trade:'||NEW.wallet_trade_id;
  IF principal<=0 OR available<0 OR reserved<>principal
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.entries entry JOIN alpha_wallet_simulation.journals journal USING(journal_id)
      WHERE journal.command_revision<operation.revision AND entry.account='trade:'||NEW.wallet_trade_id AND entry.asset_id<>terms->>'assetId'
      GROUP BY entry.asset_id HAVING sum(entry.delta_units)<>0)
    OR descriptor->'principalHold' IS DISTINCT FROM jsonb_build_object('action','retain_reserved','assetId',terms->'assetId',
      'walletListingId',terms->'walletListingId','walletTradeId',NEW.wallet_trade_id,'principalRaw',principal::text,'transferAmountRaw','0',
      'expectedTradeReservedRaw',principal::text,'expectedListingAvailableRaw',available::text) THEN
    RAISE EXCEPTION 'Payment lifecycle must retain its exact full principal without a transfer';
  END IF;
  expected_receipt:=jsonb_build_object('platformRequestId',NEW.platform_request_id,'platformTradeId',binding.platform_trade_id,
    'platformListingId',terms->'platformListingId','walletTradeId',NEW.wallet_trade_id,'walletListingId',terms->'walletListingId',
    'acceptanceKey',accepted.acceptance_key,'actorUserId',operation.command_json->'actor'->'id','actorKind','buyer',
    'commandRevision',NEW.command_revision,'commandKey',operation.command_key,
    'inputDigest',alpha_wallet_simulation.v5_digest(jsonb_build_object('actor',operation.command_json->'actor','input',descriptor)),
    'plannerInputDigest',descriptor->'plannerInputDigest','termsDigest',descriptor->'termsDigest','principalRaw',principal::text,'transferAmountRaw','0','input',descriptor);
  expected_receipt:=expected_receipt||CASE WHEN action_type='claimInitialPayment' THEN jsonb_build_object('claimKey',business_key,'claimedAtMs',operation.occurred_at_ms)
    ELSE jsonb_build_object('disputeKey',business_key,'claimKey',claimed.claim_key,'disputedAtMs',operation.occurred_at_ms) END;
  IF NEW.payload IS DISTINCT FROM expected_receipt THEN RAISE EXCEPTION 'Immutable payment lifecycle receipt differs from its exact buyer command'; END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.assert_payment_financial_integrity() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,alpha_wallet_simulation AS $fn$
DECLARE transition alpha_wallet_simulation.payment_engine_continuations%ROWTYPE; operation alpha_wallet_simulation.commands%ROWTYPE;
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime(); PERFORM alpha_wallet_simulation.require_v5_protocol();
  SELECT * INTO transition FROM alpha_wallet_simulation.payment_engine_continuations WHERE singleton;
  IF transition.command_revision IS NULL
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=5 AND revision>=transition.command_revision)
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision=transition.source_revision
      AND event_hash=transition.source_event_hash AND state_hash=transition.source_state_hash AND occurred_at_ms=transition.source_occurred_at_ms
      AND command_json->'version'=to_jsonb(4) AND command_json->>'engineVersion'='alpha-wallet-simulation-v4')
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision=transition.command_revision
      AND command_key=transition.command_key AND command_type='continueFromV4' AND previous_event_hash=transition.source_event_hash
      AND occurred_at_ms>=transition.source_occurred_at_ms
      AND command_json->'input'=jsonb_build_object('checkpoint',jsonb_build_object('revision',transition.source_revision,
        'eventHash',transition.source_event_hash,'stateHash',transition.source_state_hash,'lastCommandAtMs',transition.source_occurred_at_ms))
      AND result_json=jsonb_build_object('checkpoint',command_json->'input'->'checkpoint','commandRevision',transition.command_revision,
        'commandKey',transition.command_key,'sourceHaltReason',transition.source_halt_reason))
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE command_type='continueFromV4' AND revision<>transition.command_revision)
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands WHERE revision>=transition.command_revision
      AND (command_json->'version' IS DISTINCT FROM to_jsonb(5) OR command_json->>'engineVersion' IS DISTINCT FROM 'alpha-wallet-simulation-v5'
        OR command_type NOT IN ('continueFromV4','claimInitialPayment','freezeInitialDispute','pause'))) THEN
    RAISE EXCEPTION 'V5 DDL, exact continuation and new head must commit atomically';
  END IF;
  FOR operation IN SELECT * FROM alpha_wallet_simulation.commands WHERE revision>=transition.command_revision LOOP
    IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.journals WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.payout_intents WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.payout_events WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.chain_event_claims WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.trade_terms_events WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.acceptance_receipts WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_trade_bindings WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_acceptance_receipts WHERE command_revision=operation.revision)
      OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_cancellation_receipts WHERE command_revision=operation.revision) THEN
      RAISE EXCEPTION 'V5 cannot move principal or append payouts, chain claims, cancellation or old acceptance projections';
    END IF;
    IF (SELECT count(*) FROM alpha_wallet_simulation.initial_payment_claim_receipts WHERE command_revision=operation.revision)
        <>(CASE WHEN operation.command_type='claimInitialPayment' THEN 1 ELSE 0 END)
      OR (SELECT count(*) FROM alpha_wallet_simulation.initial_dispute_freeze_receipts WHERE command_revision=operation.revision)
        <>(CASE WHEN operation.command_type='freezeInitialDispute' THEN 1 ELSE 0 END) THEN
      RAISE EXCEPTION 'Each V5 claim or freeze must commit with exactly its immutable receipt';
    END IF;
  END LOOP;
END;
$fn$;
CREATE TRIGGER payment_continuation_append BEFORE INSERT ON alpha_wallet_simulation.payment_engine_continuations
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.guard_payment_continuation();
CREATE TRIGGER initial_payment_claim_append BEFORE INSERT ON alpha_wallet_simulation.initial_payment_claim_receipts
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.guard_initial_payment_lifecycle_receipt();
CREATE TRIGGER initial_dispute_freeze_append BEFORE INSERT ON alpha_wallet_simulation.initial_dispute_freeze_receipts
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.guard_initial_payment_lifecycle_receipt();
DO $table_guards$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['payment_engine_continuations','initial_payment_claim_receipts','initial_dispute_freeze_receipts'] LOOP
    EXECUTE format('ALTER TABLE alpha_wallet_simulation.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE alpha_wallet_simulation.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE TRIGGER immutable_records BEFORE UPDATE OR DELETE OR TRUNCATE ON alpha_wallet_simulation.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_simulation.reject_change()',table_name);
    EXECUTE format('CREATE CONSTRAINT TRIGGER versioned_integrity AFTER INSERT ON alpha_wallet_simulation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.validate_versioned_integrity()',table_name);
  END LOOP;
END;
$table_guards$;
SELECT set_config('alpha_wallet.writer_protocol','simulation-v5',true);
INSERT INTO alpha_wallet_simulation.payment_engine_continuations
  (command_revision,command_key,source_revision,source_event_hash,source_state_hash,source_occurred_at_ms,source_halt_reason)
SELECT revision+1,current_setting('alpha_wallet.v5_upgrade_key',true),revision,last_event_hash::text,
  current_setting('alpha_wallet.v5_upgrade_command',true)::jsonb->'input'->'checkpoint'->>'stateHash',
  (current_setting('alpha_wallet.v5_upgrade_command',true)::jsonb->'input'->'checkpoint'->>'lastCommandAtMs')::bigint,
  current_setting('alpha_wallet.v5_source_halt_reason',true)::jsonb#>>'{}'
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

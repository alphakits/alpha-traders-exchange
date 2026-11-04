-- Alpha Wallet connected development storage. SYNTHETIC FUNDS ONLY.
-- Fresh database initialization only; reopening must validate the persisted head.
-- Caller: BEGIN ISOLATION LEVEL SERIALIZABLE;
--         SET LOCAL alpha_wallet.development_schema = 'simulation-only';
-- Every command transaction first increments head.lock_version, then appends its
-- command and projections, and finally updates head.revision/last_event_hash.
-- Retry the entire transaction on serialization/deadlock failure. No signer or
-- network side effect is performed inside this transaction or by this schema.
-- SQL enforces storage integrity, not user authentication, truthful fiat/chain
-- evidence, or cryptographic hashes of JSON. The replay repository verifies the
-- canonical hashes and all projections against trusted simulation commands.
-- No production migration, live asset, provider credentials, or API grants.

DO $guard$
BEGIN
  IF current_setting('alpha_wallet.development_schema', true) IS DISTINCT FROM 'simulation-only' THEN
    RAISE EXCEPTION 'Alpha Wallet durable schema requires simulation-only opt-in';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'serializable' THEN
    RAISE EXCEPTION 'Alpha Wallet durable schema requires SERIALIZABLE isolation';
  END IF;
END;
$guard$;

CREATE SCHEMA alpha_wallet_simulation;
REVOKE ALL ON SCHEMA alpha_wallet_simulation FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_simulation REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_simulation REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Preserve the supplied scale before checking: NUMERIC(78,0) would round it.
CREATE DOMAIN alpha_wallet_simulation.integer_units AS numeric
  CHECK (VALUE = trunc(VALUE) AND VALUE BETWEEN
    -115792089237316195423570985008687907853269984665640564039457584007913129639935
    AND 115792089237316195423570985008687907853269984665640564039457584007913129639935);

CREATE TABLE alpha_wallet_simulation.head (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  format_version integer NOT NULL DEFAULT 1 CHECK (format_version = 1),
  mode text NOT NULL DEFAULT 'simulation-only' CHECK (mode = 'simulation-only'),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_event_hash char(64) NOT NULL CHECK (last_event_hash ~ '^[0-9a-f]{64}$'),
  lock_version bigint NOT NULL DEFAULT 0 CHECK (lock_version >= 0)
);
INSERT INTO alpha_wallet_simulation.head (last_event_hash) VALUES (repeat('0', 64));

CREATE TABLE alpha_wallet_simulation.commands (
  revision integer PRIMARY KEY CHECK (revision > 0),
  command_key text NOT NULL UNIQUE CHECK (length(command_key) BETWEEN 1 AND 1024),
  command_type text NOT NULL CHECK (length(command_type) BETWEEN 1 AND 160),
  occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms BETWEEN 0 AND 9007199254740991),
  command_json jsonb NOT NULL CHECK (jsonb_typeof(command_json) = 'object'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  result_json jsonb NOT NULL,
  result_hash text NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  state_hash text NOT NULL CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  previous_event_hash text NOT NULL CHECK (previous_event_hash ~ '^[0-9a-f]{64}$'),
  event_hash text NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE alpha_wallet_simulation.journals (
  journal_id text PRIMARY KEY CHECK (length(journal_id) BETWEEN 1 AND 160),
  command_revision integer NOT NULL REFERENCES alpha_wallet_simulation.commands(revision),
  asset_id text NOT NULL CHECK (asset_id IN ('tron-sim-usdt', 'bsc-sim-binance-peg-usdt')),
  operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 1024),
  UNIQUE (journal_id, asset_id)
);
CREATE INDEX journals_command_revision ON alpha_wallet_simulation.journals(command_revision);

CREATE TABLE alpha_wallet_simulation.entries (
  journal_id text NOT NULL,
  asset_id text NOT NULL,
  account text NOT NULL CHECK (account IN ('external', 'platform-revenue')
    OR account ~ '^(available|listing|trade|payout|commission):[A-Za-z0-9_-]{1,160}$'),
  delta_units alpha_wallet_simulation.integer_units NOT NULL CHECK (delta_units <> 0),
  PRIMARY KEY (journal_id, account),
  FOREIGN KEY (journal_id, asset_id) REFERENCES alpha_wallet_simulation.journals(journal_id, asset_id)
);
CREATE INDEX entries_asset_account ON alpha_wallet_simulation.entries(asset_id, account);

CREATE TABLE alpha_wallet_simulation.payout_intents (
  payout_id text PRIMARY KEY CHECK (payout_id ~ '^[A-Za-z0-9_-]{1,160}$'),
  command_revision integer NOT NULL REFERENCES alpha_wallet_simulation.commands(revision),
  asset_id text NOT NULL CHECK (asset_id IN ('tron-sim-usdt', 'bsc-sim-binance-peg-usdt')),
  seller_id text NOT NULL CHECK (seller_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  kind text NOT NULL CHECK (kind IN ('trade', 'withdrawal')),
  trade_id text CHECK (trade_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  amount_raw alpha_wallet_simulation.integer_units NOT NULL CHECK (amount_raw > 0),
  destination text NOT NULL,
  provider_reference text NOT NULL UNIQUE CHECK (provider_reference ~ '^sim-payout-[A-Za-z0-9_-]{1,160}$'),
  CHECK ((kind = 'trade' AND trade_id IS NOT NULL) OR (kind = 'withdrawal' AND trade_id IS NULL)),
  CHECK (destination ~ ('^sim://' || asset_id || '/recipient/[A-Za-z0-9_-]{1,80}$'))
);
CREATE UNIQUE INDEX one_payout_per_trade ON alpha_wallet_simulation.payout_intents(trade_id)
  WHERE kind = 'trade';
CREATE INDEX payout_intents_command_revision ON alpha_wallet_simulation.payout_intents(command_revision);

CREATE TABLE alpha_wallet_simulation.payout_events (
  payout_id text NOT NULL REFERENCES alpha_wallet_simulation.payout_intents(payout_id),
  command_revision integer NOT NULL REFERENCES alpha_wallet_simulation.commands(revision),
  state text NOT NULL CHECK (state IN ('queued', 'submitting', 'submission_unknown', 'broadcast', 'confirmed', 'failed_final')),
  transaction_id text CHECK (transaction_id ~ '^sim-tx-[A-Za-z0-9_-]{1,80}$'),
  dispatch_count integer NOT NULL CHECK (dispatch_count IN (0, 1)),
  PRIMARY KEY (payout_id, command_revision),
  CHECK ((state = 'queued' AND dispatch_count = 0) OR (state <> 'queued' AND dispatch_count = 1)),
  CHECK ((state IN ('queued', 'submitting', 'submission_unknown') AND transaction_id IS NULL)
    OR (state IN ('broadcast', 'confirmed', 'failed_final') AND transaction_id IS NOT NULL))
);
CREATE INDEX payout_events_command_revision ON alpha_wallet_simulation.payout_events(command_revision);

CREATE TABLE alpha_wallet_simulation.chain_event_claims (
  event_key text PRIMARY KEY,
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  command_revision integer NOT NULL REFERENCES alpha_wallet_simulation.commands(revision),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (coalesce(
    jsonb_typeof(event_key::jsonb) = 'array' AND jsonb_array_length(event_key::jsonb) = 4
    AND jsonb_typeof(event_key::jsonb -> 0) = 'string'
    AND jsonb_typeof(event_key::jsonb -> 1) = 'string'
    AND jsonb_typeof(event_key::jsonb -> 2) = 'string'
    AND jsonb_typeof(event_key::jsonb -> 3) = 'number'
    AND ((event_key::jsonb ->> 0 = 'tron-simulation' AND event_key::jsonb ->> 1 = 'sim-token-tron-usdt')
      OR (event_key::jsonb ->> 0 = 'bsc-simulation' AND event_key::jsonb ->> 1 = 'sim-token-bsc-binance-peg-usdt'))
    AND event_key::jsonb ->> 2 ~ '^sim-tx-[A-Za-z0-9_-]{1,80}$'
    AND event_key::jsonb ->> 3 ~ '^(0|[1-9][0-9]*)$'
    AND (event_key::jsonb ->> 3)::numeric <= 9007199254740991, false))
);
-- Equivalent JSON encodings of an identity cannot claim an event twice.
CREATE UNIQUE INDEX chain_event_claims_identity ON alpha_wallet_simulation.chain_event_claims ((event_key::jsonb));
CREATE UNIQUE INDEX one_outgoing_receipt_per_payout
  ON alpha_wallet_simulation.chain_event_claims ((payload ->> 'payoutId')) WHERE direction = 'outgoing';
CREATE INDEX chain_event_claims_command_revision ON alpha_wallet_simulation.chain_event_claims(command_revision);

CREATE FUNCTION alpha_wallet_simulation.require_runtime() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  IF current_setting('alpha_wallet.development_schema', true) IS DISTINCT FROM 'simulation-only' THEN
    RAISE EXCEPTION 'Alpha Wallet durable writes require simulation-only opt-in';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'serializable' THEN
    RAISE EXCEPTION 'Alpha Wallet durable writes require SERIALIZABLE isolation';
  END IF;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.require_writer() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  -- xmin is a 32-bit XID; pg_current_xact_id includes its epoch. A changed head
  -- tuple proves this transaction acquired the write gate, not just a row lock.
  -- Commands use top-level transactions; savepoint-based partial retries are not supported.
  IF NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND lock_version > 0
    AND xmin::text::numeric = mod(pg_current_xact_id()::text::numeric, 4294967296)) THEN
    RAISE EXCEPTION 'Increment head.lock_version before appending a wallet command';
  END IF;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.require_current_command(command_revision integer) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  PERFORM alpha_wallet_simulation.require_writer();
  IF NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.commands command WHERE command.revision = command_revision
    AND command.xmin::text::numeric = mod(pg_current_xact_id()::text::numeric, 4294967296)) THEN
    RAISE EXCEPTION 'Command and all its projections must be appended in the same transaction';
  END IF;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.reject_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  RAISE EXCEPTION 'Alpha Wallet command and projection records are immutable';
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.guard_head_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  IF NEW.singleton IS DISTINCT FROM OLD.singleton OR NEW.mode IS DISTINCT FROM OLD.mode
    OR NEW.format_version IS DISTINCT FROM OLD.format_version THEN
    RAISE EXCEPTION 'Wallet storage identity is immutable';
  END IF;
  IF NEW.lock_version = OLD.lock_version + 1 THEN
    IF NEW.revision <> OLD.revision OR NEW.last_event_hash <> OLD.last_event_hash THEN
      RAISE EXCEPTION 'Acquire the command write gate before advancing the log head';
    END IF;
  ELSIF NEW.lock_version = OLD.lock_version THEN
    PERFORM alpha_wallet_simulation.require_writer();
    IF NEW.revision < OLD.revision OR (NEW.revision = OLD.revision AND NEW.last_event_hash <> OLD.last_event_hash) THEN
      RAISE EXCEPTION 'Wallet log head cannot move backwards or replace its hash';
    END IF;
  ELSE RAISE EXCEPTION 'Wallet write-gate version must increment by exactly one';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.guard_command() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE
  prior_revision integer;
  prior_hash text;
BEGIN
  PERFORM alpha_wallet_simulation.require_writer();
  SELECT revision, event_hash INTO prior_revision, prior_hash
    FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1;
  IF NEW.revision <> coalesce(prior_revision, 0) + 1
    OR NEW.previous_event_hash <> coalesce(prior_hash, repeat('0', 64)) THEN
    RAISE EXCEPTION 'Command revision/hash must extend the existing log without gaps';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.guard_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE
  revision_to_check integer;
BEGIN
  IF TG_TABLE_NAME = 'entries' THEN
    SELECT command_revision INTO revision_to_check FROM alpha_wallet_simulation.journals WHERE journal_id = NEW.journal_id;
  ELSE revision_to_check := NEW.command_revision;
  END IF;
  PERFORM alpha_wallet_simulation.require_current_command(revision_to_check);
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.guard_payout_event() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE
  prior alpha_wallet_simulation.payout_events%ROWTYPE;
  intent_revision integer;
BEGIN
  PERFORM alpha_wallet_simulation.require_current_command(NEW.command_revision);
  SELECT * INTO prior FROM alpha_wallet_simulation.payout_events
    WHERE payout_id = NEW.payout_id ORDER BY command_revision DESC LIMIT 1;
  IF prior.payout_id IS NULL THEN
    SELECT command_revision INTO intent_revision FROM alpha_wallet_simulation.payout_intents WHERE payout_id = NEW.payout_id;
    IF intent_revision IS DISTINCT FROM NEW.command_revision OR NEW.state <> 'queued' OR NEW.dispatch_count <> 0 THEN
      RAISE EXCEPTION 'A payout must start queued in its intent creation command';
    END IF;
  ELSE
    IF NEW.command_revision <= prior.command_revision THEN RAISE EXCEPTION 'Payout events cannot be backdated'; END IF;
    IF prior.transaction_id IS NOT NULL AND NEW.transaction_id IS DISTINCT FROM prior.transaction_id THEN
      RAISE EXCEPTION 'A known payout transaction identity cannot change';
    END IF;
    IF NEW.dispatch_count < prior.dispatch_count THEN RAISE EXCEPTION 'A payout dispatch claim cannot be reset'; END IF;
    IF NOT ((NEW.state = prior.state AND NEW.transaction_id IS NOT DISTINCT FROM prior.transaction_id
        AND NEW.dispatch_count = prior.dispatch_count)
      OR (prior.state = 'queued' AND NEW.state = 'submitting')
      OR (prior.state IN ('submitting', 'submission_unknown')
        AND NEW.state IN ('submission_unknown', 'broadcast', 'confirmed', 'failed_final'))
      OR (prior.state = 'broadcast' AND NEW.state IN ('confirmed', 'failed_final'))) THEN
      RAISE EXCEPTION 'Invalid payout state progression';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.validate_head() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE
  last_revision integer;
  last_hash text;
BEGIN
  SELECT revision, event_hash INTO last_revision, last_hash FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head
    WHERE singleton AND revision = coalesce(last_revision, 0) AND last_event_hash = coalesce(last_hash, repeat('0', 64))) THEN
    RAISE EXCEPTION 'Wallet head must match the complete committed command log';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.validate_financial_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
BEGIN
  -- These global checks are intentionally simple for the bounded development
  -- store. A later sharded repository needs separately proven scoped checks.
  IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.journals journal
    LEFT JOIN alpha_wallet_simulation.entries entry USING (journal_id)
    GROUP BY journal.journal_id HAVING count(entry.account) < 2 OR coalesce(sum(entry.delta_units), 0) <> 0) THEN
    RAISE EXCEPTION 'Every wallet journal must have at least two entries and sum to zero';
  END IF;
  IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.entries GROUP BY asset_id, account
    HAVING (account <> 'external' AND sum(delta_units) < 0)
      OR abs(sum(delta_units)) > 115792089237316195423570985008687907853269984665640564039457584007913129639935) THEN
    RAISE EXCEPTION 'Wallet allocation balance is negative or exceeds uint256 bounds';
  END IF;
  IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.entries entry
    LEFT JOIN alpha_wallet_simulation.payout_intents intent
      ON entry.account = 'payout:' || intent.payout_id AND entry.asset_id = intent.asset_id
    WHERE entry.account LIKE 'payout:%' AND intent.payout_id IS NULL) THEN
    RAISE EXCEPTION 'Payout allocation requires a matching immutable intent';
  END IF;
  IF EXISTS (
    SELECT 1 FROM alpha_wallet_simulation.payout_intents intent
    LEFT JOIN LATERAL (SELECT state FROM alpha_wallet_simulation.payout_events
      WHERE payout_id = intent.payout_id ORDER BY command_revision DESC LIMIT 1) latest ON true
    LEFT JOIN LATERAL (SELECT coalesce(sum(delta_units), 0) AS units FROM alpha_wallet_simulation.entries
      WHERE asset_id = intent.asset_id AND account = 'payout:' || intent.payout_id) allocation ON true
    WHERE latest.state IS NULL OR allocation.units <> CASE WHEN latest.state = 'confirmed' THEN 0 ELSE intent.amount_raw END
  ) THEN RAISE EXCEPTION 'Payout state and reserved principal must commit together'; END IF;
  IF EXISTS (
    SELECT 1 FROM alpha_wallet_simulation.payout_intents intent
    JOIN LATERAL (SELECT state, transaction_id FROM alpha_wallet_simulation.payout_events
      WHERE payout_id = intent.payout_id ORDER BY command_revision DESC LIMIT 1) latest ON true
    WHERE latest.state IN ('confirmed', 'failed_final') AND NOT EXISTS (
      SELECT 1 FROM alpha_wallet_simulation.chain_event_claims claim
      WHERE claim.direction = 'outgoing' AND claim.payload ->> 'payoutId' = intent.payout_id
        AND claim.payload ->> 'assetId' = intent.asset_id
        AND claim.payload ->> 'destination' = intent.destination
        AND claim.payload ->> 'amountRaw' = intent.amount_raw::text
        AND claim.event_key::jsonb ->> 2 = latest.transaction_id)
  ) THEN RAISE EXCEPTION 'Terminal payout requires its matching consumed outgoing receipt'; END IF;
  RETURN NEW;
END;
$fn$;

CREATE FUNCTION alpha_wallet_simulation.validate_claims() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_simulation AS $fn$
DECLARE
  expected_asset text;
BEGIN
  expected_asset := CASE NEW.event_key::jsonb ->> 0 WHEN 'tron-simulation' THEN 'tron-sim-usdt'
    WHEN 'bsc-simulation' THEN 'bsc-sim-binance-peg-usdt' END;
  IF NOT coalesce(NEW.payload ->> 'assetId' = expected_asset
    AND jsonb_typeof(NEW.payload -> 'amountRaw') = 'string'
    AND NEW.payload ->> 'amountRaw' ~ '^[1-9][0-9]*$'
    AND (NEW.payload ->> 'amountRaw')::numeric <=
      115792089237316195423570985008687907853269984665640564039457584007913129639935, false) THEN
    RAISE EXCEPTION 'Chain claim asset and exact raw amount are invalid';
  END IF;
  IF NEW.direction = 'incoming' THEN
    IF NOT coalesce(NEW.payload ->> 'intentId' ~ '^[A-Za-z0-9_-]{1,80}$'
      AND NEW.payload ->> 'destination' = 'sim://' || expected_asset || '/deposit/' || (NEW.payload ->> 'intentId'), false) THEN
      RAISE EXCEPTION 'Incoming claim must retain its assigned simulation deposit identity';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM alpha_wallet_simulation.payout_intents intent
      JOIN LATERAL (SELECT state, transaction_id FROM alpha_wallet_simulation.payout_events
        WHERE payout_id = intent.payout_id ORDER BY command_revision DESC LIMIT 1) latest ON true
      WHERE intent.payout_id = NEW.payload ->> 'payoutId' AND intent.asset_id = expected_asset
        AND intent.destination = NEW.payload ->> 'destination' AND intent.amount_raw::text = NEW.payload ->> 'amountRaw'
        AND latest.state IN ('confirmed', 'failed_final') AND latest.transaction_id = NEW.event_key::jsonb ->> 2
    ) THEN RAISE EXCEPTION 'Outgoing claim must match its terminal payout identity and amount'; END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER head_update BEFORE UPDATE ON alpha_wallet_simulation.head
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.guard_head_update();
CREATE TRIGGER head_no_replace BEFORE INSERT OR DELETE OR TRUNCATE ON alpha_wallet_simulation.head
  FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_simulation.reject_change();
CREATE TRIGGER command_append BEFORE INSERT ON alpha_wallet_simulation.commands
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.guard_command();
CREATE TRIGGER payout_event_append BEFORE INSERT ON alpha_wallet_simulation.payout_events
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.guard_payout_event();
CREATE CONSTRAINT TRIGGER coherent_head AFTER UPDATE ON alpha_wallet_simulation.head
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.validate_head();
CREATE CONSTRAINT TRIGGER command_head AFTER INSERT ON alpha_wallet_simulation.commands
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.validate_head();
CREATE CONSTRAINT TRIGGER claim_identity AFTER INSERT ON alpha_wallet_simulation.chain_event_claims
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.validate_claims();

DO $table_guards$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['head', 'commands', 'journals', 'entries', 'payout_intents', 'payout_events', 'chain_event_claims'] LOOP
    EXECUTE format('ALTER TABLE alpha_wallet_simulation.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE alpha_wallet_simulation.%I FORCE ROW LEVEL SECURITY', table_name);
    IF table_name <> 'head' THEN
      EXECUTE format('CREATE TRIGGER immutable_records BEFORE UPDATE OR DELETE OR TRUNCATE ON alpha_wallet_simulation.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_simulation.reject_change()', table_name);
    END IF;
    IF table_name IN ('journals', 'entries', 'payout_intents', 'chain_event_claims') THEN
      EXECUTE format('CREATE TRIGGER projection_append BEFORE INSERT ON alpha_wallet_simulation.%I FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.guard_projection()', table_name);
    END IF;
    IF table_name IN ('journals', 'entries', 'payout_intents', 'payout_events') THEN
      -- Entry checks also catch writes after SET CONSTRAINTS flushes a header check.
      EXECUTE format('CREATE CONSTRAINT TRIGGER financial_integrity AFTER INSERT ON alpha_wallet_simulation.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_simulation.validate_financial_integrity()', table_name);
    END IF;
  END LOOP;
END;
$table_guards$;

CREATE VIEW alpha_wallet_simulation.account_balances WITH (security_invoker = true) AS
  SELECT asset_id, account, sum(delta_units) AS balance_units
  FROM alpha_wallet_simulation.entries GROUP BY asset_id, account;

REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_simulation FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA alpha_wallet_simulation FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_simulation FROM PUBLIC;
REVOKE USAGE ON DOMAIN alpha_wallet_simulation.integer_units FROM PUBLIC;
DO $client_grants$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA alpha_wallet_simulation FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_simulation FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA alpha_wallet_simulation FROM %I', client_role);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_simulation FROM %I', client_role);
      EXECUTE format('REVOKE USAGE ON DOMAIN alpha_wallet_simulation.integer_units FROM %I', client_role);
    END IF;
  END LOOP;
END;
$client_grants$;
-- Tests use a dedicated isolated superuser/BYPASSRLS fixture role. An ordinary
-- database owner is still blocked by FORCE RLS. This is not an application
-- auth policy; no browser/client role is granted wallet access by this file.

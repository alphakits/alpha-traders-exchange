-- ALPHA WALLET: SIMULATION STORAGE CONSTRAINT DRAFT. NOT A MIGRATION.
-- Execute only in a disposable database inside an explicit transaction after:
--   SET LOCAL alpha_wallet.development_schema = 'simulation-only';
-- Every later write requires this opt-in and SERIALIZABLE isolation.
-- This setting is an accidental-use guard, not proof that a database is isolated.
-- The application has no adapter to this schema. No production grants, auth
-- integration, custody signer, worker, or production migration are provided.
-- PGlite tests prove these storage constraints, not multiprocess concurrency,
-- RPC finality, recovery after a real database crash, or authorization policy.
-- Production workers must lock all affected accounts in stable ID order and
-- retry whole aborted transactions; no signing/network call belongs in a DB tx.
-- Buyer principal is preserved. Fee funds occupy separate accounts; existing
-- 1% buyer + 1% seller post-completion dues are NOT taken from principal here.
-- Reference: https://www.postgresql.org/docs/current/datatype-numeric.html
-- Reference: https://www.postgresql.org/docs/current/sql-createtrigger.html
-- Reference: https://www.postgresql.org/docs/current/explicit-locking.html
-- Reference: https://supabase.com/docs/guides/database/postgres/row-level-security

DO $development_guard$
BEGIN
  IF current_setting('alpha_wallet.development_schema', true) IS DISTINCT FROM 'simulation-only' THEN
    RAISE EXCEPTION 'Alpha Wallet schema draft requires simulation-only opt-in';
  END IF;
END;
$development_guard$;

CREATE SCHEMA alpha_wallet_dev;
REVOKE ALL ON SCHEMA alpha_wallet_dev FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_dev REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_dev REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_dev REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- A fixed NUMERIC(78,0) would round fractional input before a CHECK executes.
-- Unconstrained NUMERIC preserves input, then this domain rejects fractions,
-- NaN/infinities, and values outside the signed magnitude of uint256.
CREATE DOMAIN alpha_wallet_dev.integer_units AS numeric
  CHECK (VALUE = trunc(VALUE)
    AND VALUE BETWEEN
      -115792089237316195423570985008687907853269984665640564039457584007913129639935
      AND 115792089237316195423570985008687907853269984665640564039457584007913129639935);

CREATE TABLE alpha_wallet_dev.assets (
  asset_id text PRIMARY KEY,
  network text NOT NULL,
  token_contract text NOT NULL,
  decimals smallint NOT NULL,
  UNIQUE (network, token_contract),
  UNIQUE (asset_id, network, token_contract),
  CHECK (
    (asset_id = 'tron-sim-usdt' AND network = 'tron-simulation'
      AND token_contract = 'sim-token-tron-usdt' AND decimals = 6)
    OR
    (asset_id = 'bsc-sim-binance-peg-usdt' AND network = 'bsc-simulation'
      AND token_contract = 'sim-token-bsc-binance-peg-usdt' AND decimals = 18)
  )
);

INSERT INTO alpha_wallet_dev.assets VALUES
  ('tron-sim-usdt', 'tron-simulation', 'sim-token-tron-usdt', 6),
  ('bsc-sim-binance-peg-usdt', 'bsc-simulation', 'sim-token-bsc-binance-peg-usdt', 18);

CREATE TABLE alpha_wallet_dev.accounts (
  account_id text PRIMARY KEY CHECK (account_id LIKE 'sim:%' AND length(account_id) > 4),
  asset_id text NOT NULL REFERENCES alpha_wallet_dev.assets(asset_id),
  owner_ref text NOT NULL CHECK (owner_ref LIKE 'sim:%' AND length(owner_ref) > 4),
  kind text NOT NULL CHECK (kind IN ('external_chain', 'user_available', 'listing_reserved',
    'trade_reserved', 'payout_pending', 'fee_funds', 'platform_fees')),
  scope_ref text NOT NULL CHECK (scope_ref LIKE 'sim:%' AND length(scope_ref) > 4),
  UNIQUE (asset_id, owner_ref, kind, scope_ref),
  UNIQUE (account_id, asset_id),
  UNIQUE (account_id, asset_id, owner_ref)
);
CREATE UNIQUE INDEX one_external_chain_account_per_asset
  ON alpha_wallet_dev.accounts(asset_id) WHERE kind = 'external_chain';

CREATE TABLE alpha_wallet_dev.deposit_routes (
  route_id text PRIMARY KEY CHECK (route_id LIKE 'sim:%'),
  asset_id text NOT NULL REFERENCES alpha_wallet_dev.assets(asset_id),
  recipient text NOT NULL CHECK (recipient LIKE 'sim:address:%'),
  owner_ref text NOT NULL,
  credit_account_id text NOT NULL,
  UNIQUE (asset_id, recipient),
  UNIQUE (route_id, asset_id, recipient, credit_account_id),
  FOREIGN KEY (credit_account_id, asset_id, owner_ref)
    REFERENCES alpha_wallet_dev.accounts(account_id, asset_id, owner_ref)
);

CREATE TABLE alpha_wallet_dev.journals (
  journal_id text PRIMARY KEY CHECK (journal_id LIKE 'sim:%'),
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key LIKE 'sim:%'),
  asset_id text NOT NULL REFERENCES alpha_wallet_dev.assets(asset_id),
  kind text NOT NULL CHECK (kind IN ('deposit', 'allocation', 'fee_collection', 'payout_reservation')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_in_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  UNIQUE (journal_id, asset_id)
);

CREATE TABLE alpha_wallet_dev.entries (
  journal_id text NOT NULL,
  account_id text NOT NULL,
  asset_id text NOT NULL,
  delta_units alpha_wallet_dev.integer_units NOT NULL CHECK (delta_units <> 0),
  PRIMARY KEY (journal_id, account_id),
  FOREIGN KEY (journal_id, asset_id) REFERENCES alpha_wallet_dev.journals(journal_id, asset_id),
  FOREIGN KEY (account_id, asset_id) REFERENCES alpha_wallet_dev.accounts(account_id, asset_id)
);
CREATE INDEX entries_account_id ON alpha_wallet_dev.entries(account_id);

CREATE TABLE alpha_wallet_dev.deposit_events (
  event_id text PRIMARY KEY CHECK (event_id LIKE 'sim:%'),
  asset_id text NOT NULL,
  network text NOT NULL,
  token_contract text NOT NULL,
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^[0-9a-f]{64}$'),
  event_index integer NOT NULL CHECK (event_index >= 0),
  block_hash text NOT NULL CHECK (block_hash ~ '^[0-9a-f]{64}$'),
  block_height bigint NOT NULL CHECK (block_height >= 0),
  route_id text NOT NULL,
  recipient text NOT NULL,
  credit_account_id text NOT NULL,
  amount_units alpha_wallet_dev.integer_units NOT NULL CHECK (amount_units > 0),
  finality text NOT NULL CHECK (finality = 'simulated_finalized'),
  execution_succeeded boolean NOT NULL CHECK (execution_succeeded),
  journal_id text NOT NULL UNIQUE,
  UNIQUE (network, token_contract, transaction_hash, event_index),
  FOREIGN KEY (asset_id, network, token_contract)
    REFERENCES alpha_wallet_dev.assets(asset_id, network, token_contract),
  FOREIGN KEY (route_id, asset_id, recipient, credit_account_id)
    REFERENCES alpha_wallet_dev.deposit_routes(route_id, asset_id, recipient, credit_account_id),
  FOREIGN KEY (journal_id, asset_id) REFERENCES alpha_wallet_dev.journals(journal_id, asset_id)
);
CREATE INDEX deposit_events_route_id ON alpha_wallet_dev.deposit_events(route_id);

-- An immutable simulated delivery instruction, NOT a signing authorization.
-- A future repository must bind authenticated authorizations, expiry, dispute
-- state, payment evidence, and destination ownership to the exact instruction.
-- Worker attempts/leases and on-chain confirmations are deliberately absent.
CREATE TABLE alpha_wallet_dev.payout_intents (
  intent_id text PRIMARY KEY CHECK (intent_id LIKE 'sim:%'),
  logical_payout_id text NOT NULL UNIQUE CHECK (logical_payout_id LIKE 'sim:%'),
  purpose text NOT NULL CHECK (purpose IN ('trade_release', 'seller_withdrawal')),
  subject_ref text NOT NULL CHECK (subject_ref LIKE 'sim:%'),
  asset_id text NOT NULL REFERENCES alpha_wallet_dev.assets(asset_id),
  source_account_id text NOT NULL,
  reserved_account_id text NOT NULL UNIQUE,
  amount_units alpha_wallet_dev.integer_units NOT NULL CHECK (amount_units > 0),
  destination text NOT NULL CHECK (destination LIKE 'sim:address:%'),
  reservation_journal_id text NOT NULL UNIQUE,
  policy_marker text NOT NULL DEFAULT 'simulation-only-unapproved'
    CHECK (policy_marker = 'simulation-only-unapproved'),
  UNIQUE (purpose, subject_ref),
  CHECK (source_account_id <> reserved_account_id),
  FOREIGN KEY (source_account_id, asset_id) REFERENCES alpha_wallet_dev.accounts(account_id, asset_id),
  FOREIGN KEY (reserved_account_id, asset_id) REFERENCES alpha_wallet_dev.accounts(account_id, asset_id),
  FOREIGN KEY (reservation_journal_id, asset_id) REFERENCES alpha_wallet_dev.journals(journal_id, asset_id)
);
CREATE INDEX payout_intents_source_account_id ON alpha_wallet_dev.payout_intents(source_account_id);

CREATE FUNCTION alpha_wallet_dev.require_simulation() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_dev AS $function$
BEGIN
  IF current_setting('alpha_wallet.development_schema', true) IS DISTINCT FROM 'simulation-only' THEN
    RAISE EXCEPTION 'Alpha Wallet writes require simulation-only opt-in';
  END IF;
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'serializable' THEN
    RAISE EXCEPTION 'Alpha Wallet writes require SERIALIZABLE isolation and whole-transaction retries';
  END IF;
END;
$function$;

CREATE FUNCTION alpha_wallet_dev.guard_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_dev AS $function$
BEGIN
  PERFORM alpha_wallet_dev.require_simulation();
  RETURN NEW;
END;
$function$;

CREATE FUNCTION alpha_wallet_dev.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_dev AS $function$
BEGIN
  RAISE EXCEPTION 'Alpha Wallet records are immutable; append a new journal';
END;
$function$;

CREATE FUNCTION alpha_wallet_dev.prepare_journal() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_dev AS $function$
BEGIN
  PERFORM alpha_wallet_dev.require_simulation();
  NEW.created_in_xid := pg_current_xact_id();
  RETURN NEW;
END;
$function$;

CREATE FUNCTION alpha_wallet_dev.prepare_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_dev AS $function$
DECLARE
  journal_xid xid8;
BEGIN
  PERFORM alpha_wallet_dev.require_simulation();
  SELECT created_in_xid INTO journal_xid FROM alpha_wallet_dev.journals
    WHERE journal_id = NEW.journal_id FOR UPDATE;
  IF journal_xid IS DISTINCT FROM pg_current_xact_id() THEN
    RAISE EXCEPTION 'A journal and all its entries must be created in the same transaction';
  END IF;
  -- Serializes contenders on each allocation. Callers should pre-lock every
  -- affected account in stable ID order to avoid deadlocks across many accounts.
  PERFORM 1 FROM alpha_wallet_dev.accounts WHERE account_id = NEW.account_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM alpha_wallet_dev.payout_intents
    WHERE source_account_id = NEW.account_id AND purpose = 'trade_release'
      AND reservation_journal_id <> NEW.journal_id) THEN
    RAISE EXCEPTION 'Trade account is closed by its payout reservation';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION alpha_wallet_dev.validate_route() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_dev AS $function$
BEGIN
  PERFORM alpha_wallet_dev.require_simulation();
  IF NOT EXISTS (SELECT 1 FROM alpha_wallet_dev.accounts
    WHERE account_id = NEW.credit_account_id AND kind IN ('user_available', 'fee_funds')) THEN
    RAISE EXCEPTION 'Deposit route must credit available principal or separate fee funds';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION alpha_wallet_dev.validate_linked_journal() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_dev AS $function$
DECLARE
  journal_id_to_check text;
  expected_kind text;
BEGIN
  PERFORM alpha_wallet_dev.require_simulation();
  IF TG_TABLE_NAME = 'deposit_events' THEN
    journal_id_to_check := NEW.journal_id;
    expected_kind := 'deposit';
  ELSE
    journal_id_to_check := NEW.reservation_journal_id;
    expected_kind := 'payout_reservation';
    IF NOT EXISTS (
      SELECT 1 FROM alpha_wallet_dev.accounts source
      JOIN alpha_wallet_dev.accounts reserved ON reserved.account_id = NEW.reserved_account_id
      WHERE source.account_id = NEW.source_account_id
        AND source.owner_ref = reserved.owner_ref
        AND reserved.kind = 'payout_pending' AND reserved.scope_ref = NEW.logical_payout_id
        AND ((NEW.purpose = 'trade_release' AND source.kind = 'trade_reserved'
            AND source.scope_ref = NEW.subject_ref)
          OR (NEW.purpose = 'seller_withdrawal' AND source.kind = 'user_available'))
    ) THEN RAISE EXCEPTION 'Invalid payout allocation or subject'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM alpha_wallet_dev.journals WHERE journal_id = journal_id_to_check
      AND kind = expected_kind AND created_in_xid = pg_current_xact_id()) THEN
    RAISE EXCEPTION 'Deposit/payout and its journal must share one transaction and kind';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION alpha_wallet_dev.validate_journal() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, alpha_wallet_dev AS $function$
DECLARE
  entry_count bigint;
  net numeric;
  journal_kind text;
  deposit alpha_wallet_dev.deposit_events%ROWTYPE;
  payout alpha_wallet_dev.payout_intents%ROWTYPE;
BEGIN
  SELECT kind INTO journal_kind FROM alpha_wallet_dev.journals WHERE journal_id = NEW.journal_id;
  SELECT count(*), coalesce(sum(delta_units), 0) INTO entry_count, net
    FROM alpha_wallet_dev.entries WHERE journal_id = NEW.journal_id;
  IF entry_count < 2 OR net <> 0 THEN
    RAISE EXCEPTION 'Journal must contain at least two entries and sum to zero';
  END IF;
  IF EXISTS (
    SELECT 1 FROM alpha_wallet_dev.accounts account
    JOIN alpha_wallet_dev.entries affected ON affected.account_id = account.account_id
    WHERE affected.journal_id = NEW.journal_id AND account.kind <> 'external_chain'
      AND (SELECT sum(all_entries.delta_units) FROM alpha_wallet_dev.entries all_entries
        WHERE all_entries.account_id = account.account_id) < 0
  ) THEN RAISE EXCEPTION 'Insufficient allocated funds: a wallet account cannot be negative'; END IF;
  IF EXISTS (
    SELECT 1 FROM alpha_wallet_dev.entries affected
    WHERE affected.journal_id = NEW.journal_id
      AND abs((SELECT sum(all_entries.delta_units) FROM alpha_wallet_dev.entries all_entries
        WHERE all_entries.account_id = affected.account_id)) >
        115792089237316195423570985008687907853269984665640564039457584007913129639935
  ) THEN RAISE EXCEPTION 'Wallet account balance exceeds uint256 bounds'; END IF;

  IF journal_kind = 'deposit' THEN
    SELECT * INTO deposit FROM alpha_wallet_dev.deposit_events WHERE journal_id = NEW.journal_id;
    IF deposit.event_id IS NULL OR entry_count <> 2
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_dev.entries WHERE journal_id = NEW.journal_id
        AND account_id = deposit.credit_account_id AND delta_units = deposit.amount_units)
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_dev.entries entry
        JOIN alpha_wallet_dev.accounts account USING (account_id)
        WHERE entry.journal_id = NEW.journal_id AND account.kind = 'external_chain'
          AND entry.delta_units = -deposit.amount_units)
    THEN RAISE EXCEPTION 'Deposit journal must match exactly one finalized routed event'; END IF;
  ELSIF journal_kind = 'payout_reservation' THEN
    SELECT * INTO payout FROM alpha_wallet_dev.payout_intents WHERE reservation_journal_id = NEW.journal_id;
    IF payout.intent_id IS NULL OR entry_count <> 2
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_dev.entries WHERE journal_id = NEW.journal_id
        AND account_id = payout.source_account_id AND delta_units = -payout.amount_units)
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_dev.entries WHERE journal_id = NEW.journal_id
        AND account_id = payout.reserved_account_id AND delta_units = payout.amount_units)
    THEN RAISE EXCEPTION 'Payout intent and full reservation must commit together'; END IF;
    IF payout.purpose = 'trade_release'
      AND ((SELECT sum(delta_units) FROM alpha_wallet_dev.entries
        WHERE account_id = payout.source_account_id AND delta_units > 0) <> payout.amount_units
        OR EXISTS (SELECT 1 FROM alpha_wallet_dev.entries
          WHERE account_id = payout.source_account_id AND delta_units < 0
            AND journal_id <> NEW.journal_id))
    THEN RAISE EXCEPTION 'A trade release must reserve the full allocated trade principal'; END IF;
  ELSIF journal_kind = 'fee_collection' THEN
    IF entry_count <> 2
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_dev.entries entry
        JOIN alpha_wallet_dev.accounts account USING (account_id)
        WHERE entry.journal_id = NEW.journal_id AND account.kind = 'fee_funds' AND entry.delta_units < 0)
      OR NOT EXISTS (SELECT 1 FROM alpha_wallet_dev.entries entry
        JOIN alpha_wallet_dev.accounts account USING (account_id)
        WHERE entry.journal_id = NEW.journal_id AND account.kind = 'platform_fees' AND entry.delta_units > 0)
    THEN RAISE EXCEPTION 'Fees must use separate fee funds, never trade principal'; END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM alpha_wallet_dev.entries entry
      JOIN alpha_wallet_dev.accounts account USING (account_id)
      WHERE entry.journal_id = NEW.journal_id
        AND account.kind NOT IN ('user_available', 'listing_reserved', 'trade_reserved'))
      OR (SELECT count(DISTINCT account.owner_ref) FROM alpha_wallet_dev.entries entry
        JOIN alpha_wallet_dev.accounts account USING (account_id)
        WHERE entry.journal_id = NEW.journal_id) <> 1
    THEN RAISE EXCEPTION 'Principal allocations must stay within one owner and principal buckets'; END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER prepare_journal BEFORE INSERT ON alpha_wallet_dev.journals
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_dev.prepare_journal();
CREATE TRIGGER prepare_entry BEFORE INSERT ON alpha_wallet_dev.entries
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_dev.prepare_entry();
CREATE TRIGGER validate_route BEFORE INSERT ON alpha_wallet_dev.deposit_routes
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_dev.validate_route();
CREATE TRIGGER validate_deposit_journal BEFORE INSERT ON alpha_wallet_dev.deposit_events
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_dev.validate_linked_journal();
CREATE TRIGGER validate_payout_journal BEFORE INSERT ON alpha_wallet_dev.payout_intents
  FOR EACH ROW EXECUTE FUNCTION alpha_wallet_dev.validate_linked_journal();
CREATE CONSTRAINT TRIGGER balanced_journal AFTER INSERT ON alpha_wallet_dev.journals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_dev.validate_journal();
-- Entries also schedule validation: SET CONSTRAINTS can flush the header's
-- deferred check before the caller finishes inserting entries in this same tx.
CREATE CONSTRAINT TRIGGER balanced_entries AFTER INSERT ON alpha_wallet_dev.entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alpha_wallet_dev.validate_journal();

-- Synthetic-only read model. No mutable balance field can drift from entries.
CREATE VIEW alpha_wallet_dev.account_balances WITH (security_invoker = true) AS
  SELECT account.account_id, account.asset_id, account.owner_ref, account.kind, account.scope_ref,
    coalesce(sum(entry.delta_units), 0) AS balance_units
  FROM alpha_wallet_dev.accounts account
  LEFT JOIN alpha_wallet_dev.entries entry USING (account_id)
  GROUP BY account.account_id, account.asset_id, account.owner_ref, account.kind, account.scope_ref;

DO $protect_tables$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['assets', 'accounts', 'deposit_routes', 'journals', 'entries', 'deposit_events', 'payout_intents'] LOOP
    EXECUTE format('ALTER TABLE alpha_wallet_dev.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE alpha_wallet_dev.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE TRIGGER require_simulation BEFORE INSERT ON alpha_wallet_dev.%I FOR EACH ROW EXECUTE FUNCTION alpha_wallet_dev.guard_insert()', table_name);
    EXECUTE format('CREATE TRIGGER reject_mutation BEFORE UPDATE OR DELETE OR TRUNCATE ON alpha_wallet_dev.%I FOR EACH STATEMENT EXECUTE FUNCTION alpha_wallet_dev.reject_mutation()', table_name);
  END LOOP;
END;
$protect_tables$;

REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_dev FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA alpha_wallet_dev FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_dev FROM PUBLIC;
REVOKE USAGE ON DOMAIN alpha_wallet_dev.integer_units FROM PUBLIC;
-- Existing global default grants must not leak into this private draft schema.
DO $revoke_client_roles$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA alpha_wallet_dev FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA alpha_wallet_dev FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA alpha_wallet_dev FROM %I', client_role);
      EXECUTE format('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA alpha_wallet_dev FROM %I', client_role);
      EXECUTE format('REVOKE USAGE ON DOMAIN alpha_wallet_dev.integer_units FROM %I', client_role);
    END IF;
  END LOOP;
END;
$revoke_client_roles$;
-- No policies/grants are created. Unprivileged roles have no wallet access.
-- The disposable PGlite test owner is privileged; production application roles
-- require a separately reviewed design before this draft can become a migration.

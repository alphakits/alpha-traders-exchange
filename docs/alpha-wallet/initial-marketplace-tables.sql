-- DEVELOPMENT ONLY: a separately activated seller-initial-acceptance cohort.
-- Transaction rows and SQL protocol checks are storage proofs, not login.
CREATE SCHEMA alpha_wallet_initial_marketplace_simulation;
REVOKE ALL ON SCHEMA alpha_wallet_initial_marketplace_simulation FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_initial_marketplace_simulation REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_initial_marketplace_simulation REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE alpha_wallet_initial_marketplace_simulation.transaction_contexts (
  transaction_id text PRIMARY KEY CHECK (transaction_id ~ '^[1-9][0-9]*$'),
  request_id text NOT NULL CHECK (request_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  operation text NOT NULL CHECK (operation IN ('activate','accept','inspect','pause')),
  actor_user_id text NOT NULL CHECK (actor_user_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  planned_command jsonb,
  planned_command_key text,
  CHECK ((planned_command IS NULL) = (planned_command_key IS NULL)),
  CHECK (planned_command IS NULL OR jsonb_typeof(planned_command) = 'object')
);
CREATE TABLE alpha_wallet_initial_marketplace_simulation.activations (
  request_id text PRIMARY KEY,
  cohort boolean NOT NULL DEFAULT true UNIQUE CHECK (cohort),
  platform_listing_id text NOT NULL,
  platform_trade_id text NOT NULL UNIQUE,
  wallet_listing_id text NOT NULL UNIQUE,
  wallet_trade_id text NOT NULL UNIQUE,
  buyer_id text NOT NULL,
  seller_id text NOT NULL CHECK (seller_id <> buyer_id),
  asset_id text NOT NULL CHECK (asset_id IN ('tron-sim-usdt','bsc-sim-binance-peg-usdt')),
  actor_user_id text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  wallet_checkpoint jsonb NOT NULL CHECK (jsonb_typeof(wallet_checkpoint) = 'object'),
  -- Private exact canonical provenance; never a public receipt or credential file.
  canonical_basis jsonb NOT NULL CHECK (jsonb_typeof(canonical_basis) = 'object')
);
CREATE TABLE alpha_wallet_initial_marketplace_simulation.acceptances (
  acceptance_key text PRIMARY KEY REFERENCES alpha_wallet_simulation.initial_acceptance_receipts(acceptance_key),
  request_id text NOT NULL UNIQUE REFERENCES alpha_wallet_initial_marketplace_simulation.activations(request_id),
  actor_user_id text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  wallet_command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision),
  wallet_command_key text NOT NULL UNIQUE,
  wallet_event_hash text NOT NULL CHECK (wallet_event_hash ~ '^[a-f0-9]{64}$'),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  publication_id text NOT NULL UNIQUE,
  canonical_result jsonb NOT NULL CHECK (jsonb_typeof(canonical_result) = 'object')
);
CREATE TABLE alpha_wallet_initial_marketplace_simulation.publications (
  id text PRIMARY KEY,
  acceptance_key text NOT NULL UNIQUE REFERENCES alpha_wallet_initial_marketplace_simulation.acceptances(acceptance_key),
  -- An immutable delivery intent only. No publisher or external delivery exists.
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);

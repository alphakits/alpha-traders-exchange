-- DEVELOPMENT ONLY: common private coordination tables.
-- Run only from the explicit normal initializer or certified fresh-target restore.
-- Guard attachment is mandatory before their outer transaction may commit.

CREATE SCHEMA alpha_wallet_marketplace_simulation;
REVOKE ALL ON SCHEMA alpha_wallet_marketplace_simulation FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_marketplace_simulation REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_wallet_marketplace_simulation REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE alpha_wallet_marketplace_simulation.transaction_contexts (
  transaction_id text PRIMARY KEY CHECK (transaction_id ~ '^[1-9][0-9]*$'),
  request_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('inspect','enroll','accept','pause')),
  actor_user_id text NOT NULL,
  planned_command jsonb,
  planned_command_key text,
  CHECK ((planned_command IS NULL) = (planned_command_key IS NULL)),
  CHECK (planned_command IS NULL OR jsonb_typeof(planned_command) = 'object')
);

CREATE TABLE alpha_wallet_marketplace_simulation.enrollments (
  request_id text PRIMARY KEY,
  -- One cohort is deliberately supported at this stage; widening is a migration.
  cohort boolean NOT NULL DEFAULT true UNIQUE CHECK (cohort),
  platform_listing_id text NOT NULL,
  platform_trade_id text,
  wallet_listing_id text NOT NULL,
  wallet_trade_id text NOT NULL UNIQUE,
  buyer_id text NOT NULL,
  seller_id text NOT NULL,
  asset_id text NOT NULL,
  actor_user_id text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  wallet_command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision),
  wallet_command_key text NOT NULL UNIQUE,
  wallet_event_hash text NOT NULL CHECK (wallet_event_hash ~ '^[a-f0-9]{64}$'),
  binding jsonb NOT NULL CHECK (jsonb_typeof(binding) = 'object')
);

CREATE TABLE alpha_wallet_marketplace_simulation.acceptances (
  acceptance_key text PRIMARY KEY REFERENCES alpha_wallet_simulation.acceptance_receipts(acceptance_key),
  request_id text NOT NULL REFERENCES alpha_wallet_marketplace_simulation.enrollments(request_id),
  proposal_id text NOT NULL,
  actor_user_id text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  wallet_command_revision integer NOT NULL UNIQUE REFERENCES alpha_wallet_simulation.commands(revision),
  wallet_command_key text NOT NULL UNIQUE,
  wallet_event_hash text NOT NULL CHECK (wallet_event_hash ~ '^[a-f0-9]{64}$'),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  publication_id text NOT NULL UNIQUE,
  UNIQUE (request_id,proposal_id)
);

CREATE TABLE alpha_wallet_marketplace_simulation.publications (
  id text PRIMARY KEY,
  acceptance_key text NOT NULL UNIQUE REFERENCES alpha_wallet_marketplace_simulation.acceptances(acceptance_key),
  -- A durable intent only. Nothing in this schema sends an external message.
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);

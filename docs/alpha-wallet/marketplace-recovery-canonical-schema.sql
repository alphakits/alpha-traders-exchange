-- DEVELOPMENT ONLY: empty canonical fixture shape for a certified fresh target.
-- It does not run on an existing marketplace or create usable accounts/sessions.
-- All financial rows are restored verbatim. Users become disabled identity stubs.
CREATE SCHEMA alpha_exchange;
REVOKE ALL ON SCHEMA alpha_exchange FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_exchange REVOKE ALL ON TABLES FROM PUBLIC;

CREATE TABLE alpha_exchange.runtime_meta (
  singleton boolean PRIMARY KEY CHECK (singleton), version bigint NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE alpha_exchange.purchase_requests (
  id text PRIMARY KEY, trade_id text UNIQUE, listing_id text NOT NULL, buyer_id text NOT NULL,
  seller_id text NOT NULL, status text NOT NULL, updated_at timestamptz NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.users (
  id text PRIMARY KEY, payload jsonb NOT NULL, email text NOT NULL UNIQUE, role text NOT NULL, seller_status text NOT NULL
);
CREATE TABLE alpha_exchange.listings (
  id text PRIMARY KEY, seller_id text NOT NULL, payload jsonb NOT NULL, status text NOT NULL, active_trade_request_id text
);
CREATE TABLE alpha_exchange.commissions (
  id text PRIMARY KEY, seller_id text NOT NULL, payload jsonb NOT NULL,
  purchase_request_id text, listing_id text, buyer_id text
);
CREATE TABLE alpha_exchange.trust_snapshots (seller_id text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE alpha_exchange.evidence (id text PRIMARY KEY, purchase_request_id text NOT NULL, payload jsonb NOT NULL);
CREATE TABLE alpha_exchange.disputes (id text PRIMARY KEY, purchase_request_id text NOT NULL, payload jsonb NOT NULL);
CREATE TABLE alpha_exchange.notifications (
  id text PRIMARY KEY, user_id text NOT NULL, category text NOT NULL, is_read boolean NOT NULL,
  created_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.audit_logs (
  id text PRIMARY KEY, action text NOT NULL, actor_user_id text NOT NULL, target_user_id text,
  listing_id text, purchase_request_id text, created_at timestamptz NOT NULL,
  sort_index integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.activity_logs (
  id text PRIMARY KEY, user_id text NOT NULL, category text NOT NULL, created_at timestamptz NOT NULL,
  sort_index integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL,
  sort_index integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.trades (
  id text PRIMARY KEY, purchase_request_id text UNIQUE NOT NULL, listing_id text NOT NULL,
  seller_id text NOT NULL, buyer_id text NOT NULL, status text NOT NULL, payload jsonb NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA alpha_exchange FROM PUBLIC;

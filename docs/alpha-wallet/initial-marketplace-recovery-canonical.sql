-- DEVELOPMENT ONLY: original initial-acceptance canonical table definitions.
-- Called only by the same-transaction certified fresh-target recovery bootstrap.
-- Financial rows retain every original column, timestamp, ordering, and byte.
-- User profiles and credentials are replaced by exact disabled identity stubs.
DO $guard$
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_v3_protocol();
  IF current_setting('transaction_read_only') <> 'off'
    OR to_regnamespace('alpha_exchange') IS NOT NULL
    OR to_regnamespace('alpha_wallet_marketplace_simulation') IS NOT NULL
    OR to_regnamespace('alpha_wallet_initial_marketplace_simulation') IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=3) THEN
    RAISE EXCEPTION 'Initial recovery canonical schema requires an isolated fresh v3 target';
  END IF;
END;
$guard$;

CREATE SCHEMA alpha_exchange;
REVOKE ALL ON SCHEMA alpha_exchange FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_exchange REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA alpha_exchange REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE alpha_exchange.runtime_meta (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE alpha_exchange.users (
  id text PRIMARY KEY, email text NOT NULL UNIQUE, role text NOT NULL, seller_status text NOT NULL,
  availability_status text NOT NULL, online_status text NOT NULL, created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.listings (
  id text PRIMARY KEY, seller_id text NOT NULL REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
  status text NOT NULL, active_trade_request_id text, expires_at timestamptz, created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.trades (
  id text PRIMARY KEY, purchase_request_id text NOT NULL UNIQUE, listing_id text NOT NULL, seller_id text NOT NULL,
  buyer_id text NOT NULL, status text NOT NULL, completed_at timestamptz, created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.purchase_requests (
  id text PRIMARY KEY, trade_id text, listing_id text NOT NULL, seller_id text NOT NULL, buyer_id text NOT NULL,
  status text NOT NULL, timed_out_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.commissions (
  id text PRIMARY KEY, purchase_request_id text, listing_id text, seller_id text NOT NULL, buyer_id text,
  payment_status text NOT NULL, due_at timestamptz, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  sort_index integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.marketplace_enforcement_records (
  id text PRIMARY KEY, seller_id text NOT NULL REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
  status text NOT NULL, violation_number integer NOT NULL, issued_at timestamptz NOT NULL, due_at timestamptz,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.evidence (
  id text PRIMARY KEY, purchase_request_id text NOT NULL, side text NOT NULL, uploaded_by_user_id text NOT NULL,
  mime_type text NOT NULL, file_name text NOT NULL, size_bytes integer NOT NULL, uploaded_at timestamptz NOT NULL,
  sort_index integer NOT NULL, payload jsonb NOT NULL, content bytea
);
CREATE TABLE alpha_exchange.disputes (
  id text PRIMARY KEY, trade_id text NOT NULL, purchase_request_id text NOT NULL, seller_id text NOT NULL,
  buyer_id text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  sort_index integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.notifications (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
  category text NOT NULL, is_read boolean NOT NULL, created_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.audit_logs (
  id text PRIMARY KEY, action text NOT NULL, actor_user_id text NOT NULL, target_user_id text, listing_id text,
  purchase_request_id text, created_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE alpha_exchange.sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL, sort_index integer NOT NULL, payload jsonb NOT NULL
);

-- An isolated recovery target grants no application-client access. These
-- protections supplement, and do not replace, the private transaction owner.
DO $security$
DECLARE name text; client_role text;
BEGIN
  FOREACH name IN ARRAY ARRAY['runtime_meta','users','listings','trades','purchase_requests','commissions',
    'marketplace_enforcement_records','evidence','disputes','notifications','audit_logs','sessions'] LOOP
    EXECUTE format('ALTER TABLE alpha_exchange.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE alpha_exchange.%I FORCE ROW LEVEL SECURITY',name);
  END LOOP;
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA alpha_exchange FROM %I',client_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA alpha_exchange FROM %I',client_role);
    END IF;
  END LOOP;
END;
$security$;
REVOKE ALL ON ALL TABLES IN SCHEMA alpha_exchange FROM PUBLIC;

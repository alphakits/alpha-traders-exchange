BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
CREATE TABLE IF NOT EXISTS alpha_exchange.commission_deposit_scan_progress (
  scope text PRIMARY KEY CHECK (scope IN ('checkout', 'legacy')),
  version bigint NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload->>'schema' = '1'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE alpha_exchange.commission_deposit_scan_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON alpha_exchange.commission_deposit_scan_progress FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON alpha_exchange.commission_deposit_scan_progress FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON alpha_exchange.commission_deposit_scan_progress FROM authenticated;
  END IF;
END $$;
COMMENT ON TABLE alpha_exchange.commission_deposit_scan_progress IS
  'Private receiving-history cursor and observations; never payment proof. Compare-and-swap publication prevents stale workers advancing the scan.';
COMMIT;

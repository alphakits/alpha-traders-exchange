/** Draft schema. No production migration has been executed. */
export const USDT_DEMAND_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS alpha_exchange.usdt_demands (
    id text PRIMARY KEY,
    requester_id text NOT NULL REFERENCES alpha_exchange.users(id),
    operation_id text NOT NULL,
    state text NOT NULL CHECK (state IN ('open','matched','cancelled','expired')),
    revision integer NOT NULL CHECK (revision > 0),
    purchase_request_id text UNIQUE,
    expires_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    sort_index integer NOT NULL DEFAULT 0,
    payload jsonb NOT NULL,
    UNIQUE (requester_id, operation_id),
    CHECK ((state = 'matched') = (purchase_request_id IS NOT NULL)),
    CHECK (coalesce(payload->>'id' = id AND payload->>'requesterId' = requester_id
      AND payload->>'operationId' = operation_id AND payload->>'state' = state
      AND (payload->>'revision')::integer = revision
      AND (payload->>'amount')::numeric > 0 AND (payload->>'price')::numeric > 0, false)),
    CHECK ((payload->>'purchaseRequestId') IS NOT DISTINCT FROM purchase_request_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_usdt_demands_one_open ON alpha_exchange.usdt_demands(requester_id) WHERE state='open'`,
  `ALTER TABLE alpha_exchange.usdt_demands ENABLE ROW LEVEL SECURITY`,
  `REVOKE ALL ON alpha_exchange.usdt_demands FROM PUBLIC`,
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON alpha_exchange.usdt_demands FROM anon; END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON alpha_exchange.usdt_demands FROM authenticated; END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS idx_usdt_demands_owner ON alpha_exchange.usdt_demands(requester_id, updated_at DESC)`,
];

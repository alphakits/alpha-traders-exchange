// Serialize additive schema upgrades across application processes. The lock is
// transaction scoped, including when this statement runs on its own.
export const USDT_DEMAND_DECIMAL_UPGRADE_SQL = `DO $$ BEGIN
    PERFORM pg_advisory_xact_lock(61422920);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'alpha_exchange.usdt_demands'::regclass
        AND conname = 'usdt_demands_decimal_terms') THEN
      ALTER TABLE alpha_exchange.usdt_demands ADD CONSTRAINT usdt_demands_decimal_terms CHECK (
        coalesce(jsonb_typeof(payload->'amount') = 'string'
          AND payload->>'amount' ~ '^[0-9]{1,9}([.][0-9]{1,6})?$'
          AND jsonb_typeof(payload->'price') = 'string'
          AND payload->>'price' ~ '^[0-9]{1,4}([.][0-9]{1,2})?$', false)
      );
    END IF;
  END $$`;

/** The release migration is prepared locally; no production migration has been executed. */
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
  // numeric accepts NaN/Infinity and exponent notation. Match the bounded
  // decimal strings accepted by the API before trusting a persisted amount.
  USDT_DEMAND_DECIMAL_UPGRADE_SQL,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_usdt_demands_one_open ON alpha_exchange.usdt_demands(requester_id) WHERE state='open'`,
  `ALTER TABLE alpha_exchange.usdt_demands ENABLE ROW LEVEL SECURITY`,
  `REVOKE ALL ON alpha_exchange.usdt_demands FROM PUBLIC`,
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON alpha_exchange.usdt_demands FROM anon; END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON alpha_exchange.usdt_demands FROM authenticated; END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS idx_usdt_demands_owner ON alpha_exchange.usdt_demands(requester_id, updated_at DESC)`,
];

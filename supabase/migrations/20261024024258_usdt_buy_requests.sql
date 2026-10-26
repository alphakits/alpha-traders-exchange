-- USDT Buy Requests: prepared migration; NOT APPLIED to any hosted database.
-- Filename generated with pinned Supabase CLI 2.122.0 migration new.
-- Feature and email flags remain OFF until the release gates are satisfied.
-- Generated from src/lib/usdt-demand-schema.ts. No production database was used.
-- Prerequisite: existing alpha_exchange.users table and reviewed runtime role.
-- Read ../usdt-request-launch-readiness.md before any authorized rollout.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF to_regclass('alpha_exchange.users') IS NULL THEN
    RAISE EXCEPTION 'Missing Alpha Exchange runtime baseline';
  END IF;
END $$;

-- BEGIN REVIEWED DEMAND SCHEMA
CREATE TABLE IF NOT EXISTS alpha_exchange.usdt_demands (
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
  );

DO $$ BEGIN
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
  END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usdt_demands_one_open ON alpha_exchange.usdt_demands(requester_id) WHERE state='open';

ALTER TABLE alpha_exchange.usdt_demands ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON alpha_exchange.usdt_demands FROM PUBLIC;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON alpha_exchange.usdt_demands FROM anon; END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON alpha_exchange.usdt_demands FROM authenticated; END IF;
  END $$;

CREATE INDEX IF NOT EXISTS idx_usdt_demands_owner ON alpha_exchange.usdt_demands(requester_id, updated_at DESC);
-- END REVIEWED DEMAND SCHEMA

COMMIT;

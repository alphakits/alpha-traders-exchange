-- Apply only after preview/release verification. No customer commission is settled by this migration.
BEGIN;
SELECT pg_advisory_xact_lock(61422917);
CREATE TABLE IF NOT EXISTS alpha_exchange.commission_batch_receipt_reservations (
  signature_key text PRIMARY KEY,
  batch_id text NOT NULL UNIQUE,
  seller_id text NOT NULL,
  commission_ids text[] NOT NULL CHECK (cardinality(commission_ids) BETWEEN 1 AND 100),
  approved_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (signature_key ~ '^([a-f0-9]{64}|binance-deposit:[0-9]{1,64})$')
);
ALTER TABLE alpha_exchange.commission_batch_receipt_reservations ENABLE ROW LEVEL SECURITY;
-- No browser/anonymous/authenticated policies: the existing server DB role performs settlement.
CREATE OR REPLACE FUNCTION alpha_exchange.commission_batch_receipt_key(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE
    WHEN btrim(value) ~ '^binance-deposit:[0-9]{1,64}$' THEN btrim(value)
    WHEN btrim(value) ~* '^(0x)?[a-f0-9]{64}$' THEN lower(regexp_replace(btrim(value), '^0x', '', 'i'))
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION alpha_exchange.reserve_approved_commission_batch_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  approved jsonb;
  receipt_key text;
  ids text[];
  existing alpha_exchange.commission_batch_receipt_reservations%ROWTYPE;
BEGIN
  IF NEW.payload->'newValue'->>'kind' IS DISTINCT FROM 'commission_batch_receipt_approval_v1' THEN
    RETURN NEW;
  END IF;
  approved := NEW.payload->'newValue'->'batch';
  receipt_key := alpha_exchange.commission_batch_receipt_key(approved->>'signature');
  IF receipt_key IS NULL OR approved->>'kind' IS DISTINCT FROM 'owner_confirmed_receipt'
    OR approved->>'approvedByUserId' IS DISTINCT FROM NEW.actor_user_id
    OR NEW.id IS DISTINCT FROM ((approved->>'id') || ':approved')
    OR jsonb_typeof(approved->'commissionIds') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid commission batch receipt approval' USING ERRCODE = '23514';
  END IF;
  SELECT array_agg(value ORDER BY value) INTO ids FROM jsonb_array_elements_text(approved->'commissionIds');
  IF cardinality(ids) NOT BETWEEN 1 AND 100 OR cardinality(ids) <> (SELECT count(DISTINCT id) FROM unnest(ids) AS id) THEN
    RAISE EXCEPTION 'Invalid commission batch membership' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO existing FROM alpha_exchange.commission_batch_receipt_reservations WHERE signature_key = receipt_key;
  IF FOUND THEN
    -- Whole-snapshot saves insert the same immutable approval again. They may
    -- preserve it, but cannot transfer its receipt to a different seller/group.
    IF existing.batch_id IS DISTINCT FROM approved->>'id'
      OR existing.seller_id IS DISTINCT FROM approved->>'sellerId'
      OR existing.commission_ids IS DISTINCT FROM ids
      OR existing.approved_by_user_id IS DISTINCT FROM NEW.actor_user_id THEN
      RAISE EXCEPTION 'Commission receipt already reserved' USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM alpha_exchange.commissions AS commission
    WHERE alpha_exchange.commission_batch_receipt_key(commission.payload->>'paymentSignature') = receipt_key
      AND (commission.seller_id IS DISTINCT FROM approved->>'sellerId' OR NOT (commission.id = ANY(ids)))
  ) THEN
    RAISE EXCEPTION 'Commission receipt already assigned' USING ERRCODE = '23505';
  END IF;
  INSERT INTO alpha_exchange.commission_batch_receipt_reservations
    (signature_key, batch_id, seller_id, commission_ids, approved_by_user_id, created_at)
  VALUES (receipt_key, approved->>'id', approved->>'sellerId', ids, NEW.actor_user_id, NEW.created_at);
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION alpha_exchange.enforce_commission_batch_receipt_reservation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  receipt_key text;
  reservation alpha_exchange.commission_batch_receipt_reservations%ROWTYPE;
BEGIN
  receipt_key := alpha_exchange.commission_batch_receipt_key(NEW.payload->>'paymentSignature');
  IF receipt_key IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO reservation FROM alpha_exchange.commission_batch_receipt_reservations WHERE signature_key = receipt_key;
  IF FOUND AND (NEW.seller_id IS DISTINCT FROM reservation.seller_id OR NOT (NEW.id = ANY(reservation.commission_ids))) THEN
    RAISE EXCEPTION 'Commission receipt belongs to another authorized payment group' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS reserve_approved_commission_batch_receipt ON alpha_exchange.audit_logs;
CREATE TRIGGER reserve_approved_commission_batch_receipt BEFORE INSERT OR UPDATE ON alpha_exchange.audit_logs
FOR EACH ROW EXECUTE FUNCTION alpha_exchange.reserve_approved_commission_batch_receipt();
DROP TRIGGER IF EXISTS enforce_commission_batch_receipt_reservation ON alpha_exchange.commissions;
CREATE TRIGGER enforce_commission_batch_receipt_reservation BEFORE INSERT OR UPDATE ON alpha_exchange.commissions
FOR EACH ROW EXECUTE FUNCTION alpha_exchange.enforce_commission_batch_receipt_reservation();
-- Idempotent backfill of previously prepared approvals. A conflict fails the
-- migration rather than guessing ownership. No fee, payment status or balance changes.
UPDATE alpha_exchange.audit_logs SET payload = payload
WHERE payload->'newValue'->>'kind' = 'commission_batch_receipt_approval_v1';
COMMIT;

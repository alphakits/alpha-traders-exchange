-- Reserve both exact and optional rounded payment instructions before receipt discovery.
-- Historical checkouts retain their original instructions. No payment is credited here.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
SELECT pg_advisory_xact_lock(61422917);
CREATE TABLE IF NOT EXISTS alpha_exchange.commission_checkout_amount_reservations (
  amount_micros bigint PRIMARY KEY CHECK(amount_micros BETWEEN 1 AND 9007199254740991),
  checkout_id text NOT NULL REFERENCES alpha_exchange.commission_checkouts(checkout_id),
  created_at timestamptz NOT NULL
);
ALTER TABLE alpha_exchange.commission_checkout_amount_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON alpha_exchange.commission_checkout_amount_reservations FROM PUBLIC;
INSERT INTO alpha_exchange.commission_checkout_amount_reservations(amount_micros,checkout_id,created_at)
SELECT expected_micros,checkout_id,created_at FROM alpha_exchange.commission_checkouts
ON CONFLICT(amount_micros) DO NOTHING;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM alpha_exchange.commission_checkouts c
    JOIN alpha_exchange.commission_checkout_amount_reservations r ON r.amount_micros=c.expected_micros
    WHERE r.checkout_id<>c.checkout_id) THEN RAISE EXCEPTION 'Conflicting checkout amount backfill'; END IF;
END $$;
-- Retain owner recovery attribution independently of whole-snapshot audit replacement.
CREATE TABLE IF NOT EXISTS alpha_exchange.commission_checkout_receipt_recoveries (
  checkout_id text PRIMARY KEY REFERENCES alpha_exchange.commission_checkouts(checkout_id),
  approved_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
ALTER TABLE alpha_exchange.commission_checkout_receipt_recoveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON alpha_exchange.commission_checkout_receipt_recoveries FROM PUBLIC;

CREATE OR REPLACE FUNCTION alpha_exchange.reserve_commission_checkout()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, alpha_exchange AS $$
DECLARE
  data jsonb; checkout jsonb; existing jsonb; ids text[]; key text;
  reservation alpha_exchange.commission_batch_receipt_reservations%ROWTYPE;
  expected_count integer; found_count integer; amounts bigint[];
BEGIN
  data := NEW.payload->'newValue';
  IF data->>'kind'='commission_checkout_receipt_recovery_v1' THEN
    PERFORM pg_advisory_xact_lock(61422917);
    SELECT payload INTO checkout FROM alpha_exchange.commission_checkouts WHERE checkout_id=data->>'checkoutId';
    IF checkout IS NULL OR NEW.id IS DISTINCT FROM ((data->>'checkoutId') || ':receipt-recovery')
      OR NEW.target_user_id IS DISTINCT FROM checkout->>'sellerId' THEN
      RAISE EXCEPTION 'Invalid checkout recovery target' USING ERRCODE='23514';
    END IF;
    SELECT payload INTO existing FROM alpha_exchange.commission_checkout_receipt_recoveries WHERE checkout_id=data->>'checkoutId';
    IF existing IS NOT NULL THEN
      IF existing IS DISTINCT FROM data OR NOT EXISTS(SELECT 1 FROM alpha_exchange.commission_checkout_receipt_recoveries
        WHERE checkout_id=data->>'checkoutId' AND approved_by_user_id=NEW.actor_user_id) THEN
        RAISE EXCEPTION 'Immutable checkout recovery changed' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM alpha_exchange.users WHERE id=NEW.actor_user_id
      AND (payload->>'role'='owner' OR payload->'roles' @> '["owner"]'::jsonb)
      AND coalesce(payload->>'disabled','false')<>'true')
      OR data->>'network' IS DISTINCT FROM checkout->>'network'
      OR jsonb_typeof(data->'amountMicros') IS DISTINCT FROM 'number'
      OR (data->>'amountMicros')::numeric<>trunc((data->>'amountMicros')::numeric)
      OR (data->>'amountMicros')::numeric NOT BETWEEN (checkout->>'dueMicros')::numeric AND (checkout->>'dueMicros')::numeric+1000000
      OR jsonb_typeof(data->'timestamp') IS DISTINCT FROM 'number'
      OR (data->>'timestamp')::numeric<>trunc((data->>'timestamp')::numeric)
      OR (data->>'timestamp')::numeric < extract(epoch FROM (checkout->>'createdAt')::timestamptz)*1000
      OR jsonb_typeof(data->'timestampToleranceMs') IS DISTINCT FROM 'number'
      OR (data->>'timestampToleranceMs')::numeric<>trunc((data->>'timestampToleranceMs')::numeric)
      OR (data->>'timestampToleranceMs')::numeric NOT BETWEEN 0 AND 60000 THEN
      RAISE EXCEPTION 'Owner deposit recovery required' USING ERRCODE='23514';
    END IF;
    INSERT INTO alpha_exchange.commission_checkout_receipt_recoveries(checkout_id,approved_by_user_id,created_at,payload)
    VALUES(data->>'checkoutId',NEW.actor_user_id,NEW.created_at,data);
    RETURN NEW;
  END IF;
  IF data->>'kind' NOT IN ('commission_checkout_issued_v1', 'commission_checkout_settled_v1') OR data->>'kind' IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(61422917);
  checkout := data->'checkout';
  IF jsonb_typeof(checkout) IS DISTINCT FROM 'object' OR checkout->>'id' IS NULL
    OR checkout->>'sellerId' IS DISTINCT FROM NEW.actor_user_id OR checkout->>'sellerId' IS DISTINCT FROM NEW.target_user_id
    OR coalesce(checkout->>'network','') NOT IN ('TRC20', 'BEP20')
    OR jsonb_typeof(checkout->'commissions') IS DISTINCT FROM 'array'
    OR jsonb_typeof(checkout->'expectedMicros') IS DISTINCT FROM 'number'
    OR jsonb_typeof(checkout->'dueMicros') IS DISTINCT FROM 'number'
    OR (checkout->>'expectedMicros')::numeric <> trunc((checkout->>'expectedMicros')::numeric)
    OR (checkout->>'dueMicros')::numeric <> trunc((checkout->>'dueMicros')::numeric)
    OR (checkout->>'expectedMicros')::numeric NOT BETWEEN 1 AND 9007199254740991
    OR (checkout->>'dueMicros')::numeric NOT BETWEEN 1 AND 9007199254740991
    OR abs((checkout->>'expectedMicros')::numeric - (checkout->>'dueMicros')::numeric) > 1000000 THEN
    RAISE EXCEPTION 'Invalid automatic checkout' USING ERRCODE='23514';
  END IF;
  IF checkout ? 'roundedMicros' AND (
    jsonb_typeof(checkout->'roundedMicros') IS DISTINCT FROM 'number'
    OR (checkout->>'roundedMicros')::numeric <> trunc((checkout->>'roundedMicros')::numeric)
    OR (checkout->>'roundedMicros')::numeric <> ceil((checkout->>'expectedMicros')::numeric/1000000)*1000000
    OR (checkout->>'roundedMicros')::numeric <= (checkout->>'expectedMicros')::numeric
    OR (checkout->>'roundedMicros')::numeric < (checkout->>'dueMicros')::numeric
    OR (checkout->>'roundedMicros')::numeric - (checkout->>'dueMicros')::numeric > 1000000
    OR checkout->>'expectedMicros' IS DISTINCT FROM checkout->>'requestedMicros') THEN
    RAISE EXCEPTION 'Invalid rounded checkout reference' USING ERRCODE='23514';
  END IF;
  amounts := ARRAY[(checkout->>'expectedMicros')::bigint];
  IF checkout ? 'roundedMicros' THEN amounts := array_append(amounts,(checkout->>'roundedMicros')::bigint); END IF;
  SELECT array_agg(value->>'id' ORDER BY value->>'id'), count(*) INTO ids, expected_count
  FROM jsonb_array_elements(checkout->'commissions');
  IF expected_count NOT BETWEEN 1 AND 100 OR expected_count <> (SELECT count(DISTINCT id) FROM unnest(ids) AS id)
    OR (SELECT sum((value->>'dueMicros')::numeric) FROM jsonb_array_elements(checkout->'commissions')) IS DISTINCT FROM (checkout->>'dueMicros')::numeric THEN
    RAISE EXCEPTION 'Invalid automatic checkout membership' USING ERRCODE='23514';
  END IF;
  SELECT payload INTO existing FROM alpha_exchange.commission_checkouts WHERE checkout_id=checkout->>'id';
  IF data->>'kind'='commission_checkout_issued_v1' THEN
    IF NEW.id IS DISTINCT FROM ((checkout->>'id') || ':issued') OR NEW.created_at IS DISTINCT FROM (checkout->>'createdAt')::timestamptz THEN
      RAISE EXCEPTION 'Invalid automatic checkout issuance' USING ERRCODE='23514';
    END IF;
    IF existing IS NOT NULL THEN
      IF existing IS DISTINCT FROM checkout THEN RAISE EXCEPTION 'Immutable checkout changed' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END IF;
    SELECT count(*) INTO found_count FROM jsonb_array_elements(checkout->'commissions') AS wanted
    JOIN alpha_exchange.commissions AS commission ON commission.id=wanted->>'id'
    WHERE commission.seller_id=checkout->>'sellerId' AND commission.payment_status IN ('pending','overdue')
      AND commission.payload->>'paymentVerificationStatus' IS DISTINCT FROM 'verified'
      AND commission.payload->>'paymentVerificationStatus' IS DISTINCT FROM 'pending_verification'
      AND coalesce(commission.payload->>'paymentSignature','')=''
      AND (commission.payload->>'commissionAmount')::numeric*1000000=(wanted->>'dueMicros')::numeric
      AND commission.payload->>'createdAt'=wanted->>'createdAt';
    IF found_count<>expected_count THEN RAISE EXCEPTION 'Checkout commissions changed' USING ERRCODE='23514'; END IF;
    IF EXISTS (SELECT 1 FROM alpha_exchange.commissions WHERE
      round((payload->>'paymentExpectedAmount')::numeric*1000000)=ANY(amounts)) THEN
      RAISE EXCEPTION 'Checkout amount already issued to legacy payment' USING ERRCODE='23505';
    END IF;
    INSERT INTO alpha_exchange.commission_checkouts(checkout_id,seller_id,expected_micros,created_at,payload)
    VALUES(checkout->>'id',checkout->>'sellerId',(checkout->>'expectedMicros')::bigint,NEW.created_at,checkout);
    INSERT INTO alpha_exchange.commission_checkout_amount_reservations(amount_micros,checkout_id,created_at)
    SELECT amount,checkout->>'id',NEW.created_at FROM unnest(amounts) AS amount;
    RETURN NEW;
  END IF;
  IF existing IS NULL OR existing IS DISTINCT FROM checkout OR data->>'checkoutId' IS DISTINCT FROM checkout->>'id'
    OR NEW.id IS DISTINCT FROM ((checkout->>'id') || ':settled') THEN
    RAISE EXCEPTION 'Unissued automatic checkout settlement' USING ERRCODE='23514';
  END IF;
  key := alpha_exchange.commission_batch_receipt_key(data->'receipt'->>'signature');
  IF key IS NULL OR data->'receipt'->>'network' IS DISTINCT FROM checkout->>'network'
    OR ((data->'receipt'->>'amountMicros')::numeric <> ALL(amounts) AND NOT EXISTS (
      SELECT 1 FROM alpha_exchange.commission_checkout_receipt_recoveries AS approval
      JOIN alpha_exchange.users AS owner ON owner.id=approval.approved_by_user_id
      WHERE approval.checkout_id=checkout->>'id'
        AND (((owner.payload->>'role'='owner' OR owner.payload->'roles' @> '["owner"]'::jsonb)
          AND coalesce(owner.payload->>'disabled','false')<>'true')
          OR EXISTS(SELECT 1 FROM alpha_exchange.commission_batch_receipt_reservations
            WHERE signature_key=key AND batch_id=checkout->>'id' AND seller_id=checkout->>'sellerId'))
        AND approval.payload->>'kind'='commission_checkout_receipt_recovery_v1'
        AND approval.payload->>'checkoutId'=checkout->>'id'
        AND approval.payload->>'network'=checkout->>'network'
        AND (approval.payload->>'amountMicros')::numeric=(data->'receipt'->>'amountMicros')::numeric
        AND (approval.payload->>'amountMicros')::numeric BETWEEN
          (checkout->>'dueMicros')::numeric AND (checkout->>'dueMicros')::numeric+1000000
        AND (approval.payload->>'timestampToleranceMs')::numeric BETWEEN 0 AND 60000
        AND abs((approval.payload->>'timestamp')::numeric-(data->'receipt'->>'timestamp')::numeric)
          <= (approval.payload->>'timestampToleranceMs')::numeric
    ))
    OR (data->'receipt'->>'timestamp')::numeric < extract(epoch FROM (checkout->>'createdAt')::timestamptz)*1000 THEN
    RAISE EXCEPTION 'Checkout receipt does not match issued instructions' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM alpha_exchange.commission_checkout_amount_reservations
    WHERE amount_micros=(data->'receipt'->>'amountMicros')::bigint AND checkout_id<>checkout->>'id') THEN
    RAISE EXCEPTION 'Receipt amount reserved for another checkout' USING ERRCODE='23505';
  END IF;
  SELECT * INTO reservation FROM alpha_exchange.commission_batch_receipt_reservations WHERE signature_key=key;
  IF FOUND THEN
    IF reservation.batch_id IS DISTINCT FROM checkout->>'id' OR reservation.seller_id IS DISTINCT FROM checkout->>'sellerId'
      OR reservation.commission_ids IS DISTINCT FROM ids THEN
      RAISE EXCEPTION 'Automatic checkout receipt already reserved' USING ERRCODE='23505';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM alpha_exchange.commissions WHERE alpha_exchange.commission_batch_receipt_key(payload->>'paymentSignature')=key
    AND (seller_id IS DISTINCT FROM checkout->>'sellerId' OR NOT(id=ANY(ids)))) THEN
    RAISE EXCEPTION 'Checkout receipt already assigned' USING ERRCODE='23505';
  END IF;
  SELECT count(*) INTO found_count FROM jsonb_array_elements(checkout->'commissions') AS wanted
  JOIN alpha_exchange.commissions AS commission ON commission.id=wanted->>'id'
  WHERE commission.seller_id=checkout->>'sellerId' AND commission.payment_status='paid'
    AND commission.payload->>'paymentVerificationStatus'='verified'
    AND alpha_exchange.commission_batch_receipt_key(commission.payload->>'paymentSignature')=key
    AND commission.payload->'paymentBatchSettlement'->>'batchId'=checkout->>'id'
    AND (commission.payload->>'commissionAmount')::numeric*1000000=(wanted->>'dueMicros')::numeric;
  IF found_count<>expected_count THEN RAISE EXCEPTION 'Checkout settlement must include all commissions' USING ERRCODE='23514'; END IF;
  INSERT INTO alpha_exchange.commission_batch_receipt_reservations(signature_key,batch_id,seller_id,commission_ids,approved_by_user_id,created_at)
  VALUES(key,checkout->>'id',checkout->>'sellerId',ids,checkout->>'sellerId',NEW.created_at);
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION alpha_exchange.protect_commission_checkout_amount()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, alpha_exchange AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(61422917);
  -- Existing allocation already reads paymentReservedExpectedAmounts. This
  -- final guard also prevents old/stale writers from issuing a colliding code.
  IF NEW.payload->>'paymentExpectedAmount' IS NOT NULL AND EXISTS(
    SELECT 1 FROM alpha_exchange.commission_checkout_amount_reservations WHERE amount_micros=round((NEW.payload->>'paymentExpectedAmount')::numeric*1000000)
  ) THEN RAISE EXCEPTION 'Amount reserved for automatic checkout' USING ERRCODE='23505'; END IF;
  RETURN NEW;
END
$$;
COMMIT;

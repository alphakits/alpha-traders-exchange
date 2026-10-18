-- Owner-approved +/-2 USDT, once per combined commission payment.
-- Preserve all invoice, amount and transaction history. No payment is credited here.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
SELECT pg_advisory_xact_lock(61422917);

CREATE OR REPLACE FUNCTION alpha_exchange.commission_checkout_tolerance_micros()
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT 2000000::bigint $$;
REVOKE ALL ON FUNCTION alpha_exchange.commission_checkout_tolerance_micros() FROM PUBLIC;

CREATE OR REPLACE FUNCTION alpha_exchange.is_closed_checkout_rounded_reference(
  previous_id text, amount bigint, new_checkout_time numeric)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = pg_catalog, alpha_exchange AS $$
DECLARE previous jsonb;
BEGIN
  SELECT payload INTO previous FROM alpha_exchange.commission_checkouts WHERE checkout_id=previous_id;
  IF previous IS NULL OR amount IS NULL OR new_checkout_time IS NULL
    OR (previous->>'roundedMicros')::bigint IS DISTINCT FROM amount
    OR (previous->>'expectedMicros')::bigint=amount
    OR extract(epoch FROM (previous->>'createdAt')::timestamptz)*1000>=new_checkout_time
    OR jsonb_array_length(previous->'commissions')=0 THEN RETURN false; END IF;
  RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(previous->'commissions') AS member
    LEFT JOIN alpha_exchange.commissions AS paid ON paid.id=member->>'id'
    WHERE paid.id IS NULL OR paid.seller_id IS DISTINCT FROM previous->>'sellerId'
      OR paid.payload->>'createdAt' IS DISTINCT FROM member->>'createdAt'
      OR (paid.payload->>'commissionAmount')::numeric*1000000 IS DISTINCT FROM (member->>'dueMicros')::numeric
      OR paid.payment_status IS DISTINCT FROM 'paid'
      OR paid.payload->>'paymentVerificationStatus' IS DISTINCT FROM 'verified'
      OR nullif(paid.payload->>'paidAt','') IS NULL
      OR extract(epoch FROM (paid.payload->>'paidAt')::timestamptz)*1000>=new_checkout_time);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION alpha_exchange.is_closed_checkout_rounded_reference(text,bigint,numeric) FROM PUBLIC;

CREATE OR REPLACE FUNCTION alpha_exchange.commission_checkout_tolerance_matches(checkout jsonb, receipt jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = pg_catalog, alpha_exchange AS $$
DECLARE amount numeric; receipt_time numeric;
BEGIN
  IF jsonb_typeof(receipt->'amountMicros') IS DISTINCT FROM 'number'
    OR jsonb_typeof(receipt->'timestamp') IS DISTINCT FROM 'number'
    OR receipt->>'network' IS DISTINCT FROM checkout->>'network' THEN RETURN false; END IF;
  amount := (receipt->>'amountMicros')::numeric;
  receipt_time := (receipt->>'timestamp')::numeric;
  IF amount<>trunc(amount) OR amount NOT BETWEEN 1 AND 9007199254740991
    OR abs(amount-(checkout->>'dueMicros')::numeric)>alpha_exchange.commission_checkout_tolerance_micros()
    OR receipt_time<>trunc(receipt_time)
    OR receipt_time<extract(epoch FROM (checkout->>'createdAt')::timestamptz)*1000 THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM alpha_exchange.commission_checkout_receipt_recoveries
      WHERE checkout_id=checkout->>'id') THEN RETURN false; END IF;

  IF EXISTS(SELECT 1 FROM alpha_exchange.commission_checkouts AS other
      WHERE other.checkout_id<>checkout->>'id' AND other.payload->>'network'=checkout->>'network'
      AND extract(epoch FROM other.created_at)*1000<=receipt_time
      AND (
        amount=(other.payload->>'expectedMicros')::numeric
        OR amount=(other.payload->>'roundedMicros')::numeric
        OR (abs((other.payload->>'dueMicros')::numeric-amount)<=alpha_exchange.commission_checkout_tolerance_micros() AND (
          NOT EXISTS(SELECT 1 FROM alpha_exchange.commission_checkout_receipt_recoveries AS recovery
              WHERE recovery.checkout_id=other.checkout_id)
          OR EXISTS(SELECT 1 FROM alpha_exchange.commission_checkout_receipt_recoveries AS recovery
            JOIN alpha_exchange.users AS owner ON owner.id=recovery.approved_by_user_id
            WHERE recovery.checkout_id=other.checkout_id
              AND (owner.payload->>'role'='owner' OR owner.payload->'roles' @> '["owner"]'::jsonb)
              AND coalesce(owner.payload->>'disabled','false')<>'true'
              AND recovery.payload->>'network'=receipt->>'network'
              AND (recovery.payload->>'amountMicros')::numeric=amount
              AND abs((recovery.payload->>'timestamp')::numeric-receipt_time)
                <= (recovery.payload->>'timestampToleranceMs')::numeric
          )
        ))
      )
      -- A later/manual settlement cannot retroactively remove a contender.
      -- Missing members or missing paidAt retain the contender conservatively.
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(other.payload->'commissions') AS expected
        LEFT JOIN alpha_exchange.commissions AS commission
          ON commission.id=expected->>'id' AND commission.seller_id=other.seller_id
          AND commission.payload->>'createdAt'=expected->>'createdAt'
        WHERE commission.id IS NULL OR commission.payment_status<>'paid'
          OR nullif(commission.payload->>'paidAt','') IS NULL
          OR extract(epoch FROM (commission.payload->>'paidAt')::timestamptz)*1000>=receipt_time)
    ) THEN RETURN false; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION alpha_exchange.commission_checkout_tolerance_matches(jsonb,jsonb) FROM PUBLIC;

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
      OR (data->>'amountMicros')::numeric NOT BETWEEN greatest(1,(checkout->>'dueMicros')::numeric-alpha_exchange.commission_checkout_tolerance_micros()) AND (checkout->>'dueMicros')::numeric+alpha_exchange.commission_checkout_tolerance_micros()
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
    OR abs((checkout->>'expectedMicros')::numeric - (checkout->>'dueMicros')::numeric) > alpha_exchange.commission_checkout_tolerance_micros() THEN
    RAISE EXCEPTION 'Invalid automatic checkout' USING ERRCODE='23514';
  END IF;
  IF checkout ? 'roundedMicros' AND (
    jsonb_typeof(checkout->'roundedMicros') IS DISTINCT FROM 'number'
    OR (checkout->>'roundedMicros')::numeric <> trunc((checkout->>'roundedMicros')::numeric)
    OR (checkout->>'roundedMicros')::numeric <> ceil((checkout->>'expectedMicros')::numeric/1000000)*1000000
    OR (checkout->>'roundedMicros')::numeric <= (checkout->>'expectedMicros')::numeric
    OR (checkout->>'roundedMicros')::numeric < (checkout->>'dueMicros')::numeric
    OR (checkout->>'roundedMicros')::numeric - (checkout->>'dueMicros')::numeric > alpha_exchange.commission_checkout_tolerance_micros()
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
  SELECT * INTO reservation FROM alpha_exchange.commission_batch_receipt_reservations WHERE signature_key=key;
  IF FOUND THEN
    IF reservation.batch_id IS DISTINCT FROM checkout->>'id' OR reservation.seller_id IS DISTINCT FROM checkout->>'sellerId'
      OR reservation.commission_ids IS DISTINCT FROM ids THEN
      RAISE EXCEPTION 'Automatic checkout receipt already reserved' USING ERRCODE='23505';
    END IF;
    IF reservation.checkout_settlement IS NOT NULL THEN
      IF reservation.checkout_settlement IS DISTINCT FROM data THEN
        RAISE EXCEPTION 'Immutable checkout settlement changed' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF key IS NULL OR data->'receipt'->>'network' IS DISTINCT FROM checkout->>'network'
    OR jsonb_typeof(data->'receipt'->'amountMicros') IS DISTINCT FROM 'number'
    OR (data->'receipt'->>'amountMicros')::numeric <> trunc((data->'receipt'->>'amountMicros')::numeric)
    OR (data->'receipt'->>'amountMicros')::numeric NOT BETWEEN 1 AND 9007199254740991
    OR abs((data->'receipt'->>'amountMicros')::numeric-(checkout->>'dueMicros')::numeric)>alpha_exchange.commission_checkout_tolerance_micros()
    OR jsonb_typeof(data->'receipt'->'timestamp') IS DISTINCT FROM 'number'
    OR (data->'receipt'->>'timestamp')::numeric <> trunc((data->'receipt'->>'timestamp')::numeric)
    OR ((data->'receipt'->>'amountMicros')::numeric <> ALL(amounts)
      AND NOT (coalesce(data->>'attribution','')='unambiguous_checkout_tolerance_v1'
        AND alpha_exchange.commission_checkout_tolerance_matches(checkout,data->'receipt'))
      AND NOT EXISTS (
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
          greatest(1,(checkout->>'dueMicros')::numeric-alpha_exchange.commission_checkout_tolerance_micros()) AND (checkout->>'dueMicros')::numeric+alpha_exchange.commission_checkout_tolerance_micros()
        AND (approval.payload->>'timestampToleranceMs')::numeric BETWEEN 0 AND 60000
        AND abs((approval.payload->>'timestamp')::numeric-(data->'receipt'->>'timestamp')::numeric)
          <= (approval.payload->>'timestampToleranceMs')::numeric
    ))
    OR (data->'receipt'->>'timestamp')::numeric < extract(epoch FROM (checkout->>'createdAt')::timestamptz)*1000 THEN
    RAISE EXCEPTION 'Checkout receipt does not match issued instructions' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM alpha_exchange.commission_checkout_amount_reservations AS prior
    WHERE prior.amount_micros=(data->'receipt'->>'amountMicros')::bigint AND prior.checkout_id<>checkout->>'id'
      AND NOT alpha_exchange.is_earlier_checkout_received_amount(prior.checkout_id,
        (data->'receipt'->>'amountMicros')::bigint,(data->'receipt'->>'timestamp')::numeric)
      AND NOT alpha_exchange.is_closed_checkout_rounded_reference(prior.checkout_id,
        (data->'receipt'->>'amountMicros')::bigint,extract(epoch FROM (checkout->>'createdAt')::timestamptz)*1000)) THEN
    RAISE EXCEPTION 'Receipt amount reserved for another checkout' USING ERRCODE='23505';
  END IF;
  IF EXISTS(SELECT 1 FROM alpha_exchange.commissions AS other WHERE NOT(other.id=ANY(ids)) AND (
    round((other.payload->>'paymentExpectedAmount')::numeric*1000000)=(data->'receipt'->>'amountMicros')::numeric
    OR ((other.payload->>'paymentExpectedAmountMode'='legacy_base' OR other.payload->>'paymentExpectedAmount' IS NULL)
      AND round((other.payload->>'commissionAmount')::numeric*1000000)=(data->'receipt'->>'amountMicros')::numeric)
    OR (EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(other.payload->'paymentReservedExpectedAmounts','[]'::jsonb)) AS amount
      WHERE round(amount::numeric*1000000)=(data->'receipt'->>'amountMicros')::numeric)
      AND NOT (alpha_exchange.is_earlier_checkout_received_amount(other.payload->'paymentBatchSettlement'->>'batchId',
        (data->'receipt'->>'amountMicros')::bigint,(data->'receipt'->>'timestamp')::numeric)
        AND EXISTS(SELECT 1 FROM alpha_exchange.commission_checkouts AS prior,
          jsonb_array_elements(prior.payload->'commissions') AS member
          WHERE prior.checkout_id=other.payload->'paymentBatchSettlement'->>'batchId'
            AND prior.seller_id=other.seller_id AND member->>'id'=other.id))
      AND NOT EXISTS(SELECT 1 FROM alpha_exchange.commission_checkouts AS prior,
        jsonb_array_elements(prior.payload->'commissions') AS member
        WHERE prior.seller_id=other.seller_id AND member->>'id'=other.id
          AND alpha_exchange.is_closed_checkout_rounded_reference(prior.checkout_id,
            (data->'receipt'->>'amountMicros')::bigint,extract(epoch FROM (checkout->>'createdAt')::timestamptz)*1000)))
  )) THEN RAISE EXCEPTION 'Receipt amount belongs to another commission' USING ERRCODE='23505'; END IF;
  SELECT * INTO reservation FROM alpha_exchange.commission_batch_receipt_reservations WHERE signature_key=key;
  IF FOUND THEN
    IF reservation.batch_id IS DISTINCT FROM checkout->>'id' OR reservation.seller_id IS DISTINCT FROM checkout->>'sellerId'
      OR reservation.commission_ids IS DISTINCT FROM ids THEN
      RAISE EXCEPTION 'Automatic checkout receipt already reserved' USING ERRCODE='23505';
    END IF;
    UPDATE alpha_exchange.commission_batch_receipt_reservations SET checkout_settlement=data WHERE signature_key=key;
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
  INSERT INTO alpha_exchange.commission_checkout_amount_reservations(amount_micros,checkout_id,created_at)
  VALUES((data->'receipt'->>'amountMicros')::bigint,checkout->>'id',NEW.created_at)
  ON CONFLICT(amount_micros) DO NOTHING;
  INSERT INTO alpha_exchange.commission_batch_receipt_reservations(signature_key,batch_id,seller_id,commission_ids,approved_by_user_id,created_at,checkout_settlement)
  VALUES(key,checkout->>'id',checkout->>'sellerId',ids,checkout->>'sellerId',NEW.created_at,data);
  RETURN NEW;
END
$$;


COMMIT;

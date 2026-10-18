-- Match the payment contracts that were open when a receipt arrived.
-- Exact-only legacy references remain protected by reserve_commission_checkout;
-- they do not reserve an entire tolerance band around an unpaid invoice.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
SELECT pg_advisory_xact_lock(61422917);

CREATE OR REPLACE FUNCTION alpha_exchange.commission_checkout_tolerance_matches(checkout jsonb, receipt jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = pg_catalog, alpha_exchange AS $$
DECLARE amount numeric; receipt_time numeric;
BEGIN
  IF jsonb_typeof(receipt->'amountMicros') IS DISTINCT FROM 'number'
    OR jsonb_typeof(receipt->'timestamp') IS DISTINCT FROM 'number'
    OR checkout->>'expectedMicros' IS DISTINCT FROM checkout->>'requestedMicros'
    OR receipt->>'network' IS DISTINCT FROM checkout->>'network' THEN RETURN false; END IF;
  amount := (receipt->>'amountMicros')::numeric;
  receipt_time := (receipt->>'timestamp')::numeric;
  IF amount<>trunc(amount) OR amount NOT BETWEEN 1 AND 9007199254740991
    OR abs(amount-(checkout->>'dueMicros')::numeric)>1000000
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
        OR (abs((other.payload->>'dueMicros')::numeric-amount)<=1000000 AND (
          (other.payload->>'expectedMicros'=other.payload->>'requestedMicros'
            AND NOT EXISTS(SELECT 1 FROM alpha_exchange.commission_checkout_receipt_recoveries AS recovery
              WHERE recovery.checkout_id=other.checkout_id))
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
COMMIT;

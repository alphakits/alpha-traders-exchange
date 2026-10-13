-- Repair old owner resets that claimed verification was running without a
-- submitted payment. This does not settle, waive, or alter any commission.
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(61422917);
WITH candidates AS MATERIALIZED (
  SELECT id, payload,
    greatest(clock_timestamp(), updated_at + interval '1 millisecond') AS repaired_at
  FROM alpha_exchange.commissions
  WHERE payment_status IN ('pending', 'overdue')
    AND payload->>'paymentVerificationStatus' = 'pending_verification'
    AND coalesce(btrim(payload->>'paymentSignature'), '') = ''
    AND coalesce(btrim(payload->>'paymentSubmittedAt'), '') = ''
  FOR UPDATE
), repaired AS (
  UPDATE alpha_exchange.commissions c
  SET payload = (c.payload - 'paymentVerificationStatus') || jsonb_build_object(
        'updatedAt', to_char(candidate.repaired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      updated_at = candidate.repaired_at
  FROM candidates candidate WHERE candidate.id = c.id
  RETURNING c.id, c.seller_id, c.payload, c.updated_at
), audited AS (
  INSERT INTO alpha_exchange.audit_logs(id, action, actor_user_id, target_user_id, created_at, sort_index, payload)
  SELECT 'commission-unsubmitted-verification-repair-v1:' || id,
    'commission_recorded', 'system:marketplace', seller_id, updated_at, 0,
    jsonb_build_object(
      'id', 'commission-unsubmitted-verification-repair-v1:' || id,
      'action', 'commission_recorded', 'actorUserId', 'system:marketplace', 'targetUserId', seller_id,
      'createdAt', payload->>'updatedAt',
      'details', 'Removed an unsubmitted verification flag. The commission remains unpaid and payable.',
      'oldValue', jsonb_build_object('commissionId', id, 'paymentVerificationStatus', 'pending_verification'),
      'newValue', jsonb_build_object('kind', 'commission_unsubmitted_verification_repair_v1', 'commissionId', id))
  FROM repaired
  ON CONFLICT (id) DO NOTHING
  RETURNING id
), versioned AS (
  UPDATE alpha_exchange.runtime_meta SET version = version + 1, updated_at = clock_timestamp()
  WHERE singleton = true AND EXISTS(SELECT 1 FROM repaired)
  RETURNING version
)
SELECT (SELECT count(*) FROM repaired) AS repaired_count,
       (SELECT count(*) FROM audited) AS audit_count,
       (SELECT version FROM versioned) AS runtime_version;
COMMIT;

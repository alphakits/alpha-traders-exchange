-- DEVELOPMENT ONLY. Explicit normal initialization, never a live migration.
-- This namespace has no supported combined backup/restore format yet. Existing
-- standalone and correction-cohort recovery tools must refuse it completely.
DO $guard$
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  PERFORM alpha_wallet_simulation.require_v3_protocol();
  IF current_setting('transaction_read_only') <> 'off'
    OR to_regnamespace('alpha_wallet_marketplace_simulation') IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version=3)
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_trade_bindings)
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.initial_acceptance_receipts) THEN
    RAISE EXCEPTION 'Initial marketplace requires a writable unactivated verified v3 simulation';
  END IF;
END;
$guard$;

-- DEVELOPMENT ONLY: one already-reserved synthetic trade, no live migration.
-- The trusted coordinator owns authentication and one SERIALIZABLE transaction.
-- Registered transaction rows and exact wallet receipts are storage proofs, not
-- authentication. A simulation GUC alone never permits a protected mutation.
-- This deliberately freezes the whole canonical listing and unsupported wallet
-- commands. Only amount acceptance, historical inspection, and owner pause are
-- implemented. Ledger-only exports remain blocked after activation.
-- This file is the NORMAL INITIALIZATION PREFLIGHT. The explicit initializer
-- runs it before marketplace-coordination-tables.sql and the common unchanged
-- marketplace-coordination-guards.sql. The fresh-target recovery bootstrap uses
-- those same tables and guards under its separate verified restore contract.

DO $guard$
BEGIN
  PERFORM alpha_wallet_simulation.require_runtime();
  IF current_setting('transaction_read_only') <> 'off' OR NOT EXISTS
    (SELECT 1 FROM alpha_wallet_simulation.head WHERE singleton AND format_version = 2) THEN
    RAISE EXCEPTION 'Marketplace coordination requires a writable verified v2 simulation';
  END IF;
  IF EXISTS (SELECT 1 FROM alpha_wallet_simulation.trade_terms_events)
    OR EXISTS (SELECT 1 FROM alpha_wallet_simulation.acceptance_receipts) THEN
    RAISE EXCEPTION 'Marketplace coordination requires a fresh, unenrolled v2 cohort';
  END IF;
END;
$guard$;

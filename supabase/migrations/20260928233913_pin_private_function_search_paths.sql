-- Keep private Exchange and Discord functions independent of the caller's
-- search_path. All application relations and function calls in these bodies
-- are schema-qualified; PostgreSQL built-ins resolve through pg_catalog.
-- Function bodies, callers, privileges, triggers and customer rows are retained.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

ALTER FUNCTION alpha_exchange.commission_batch_receipt_key(text) SET search_path = '';
ALTER FUNCTION alpha_exchange.reserve_approved_commission_batch_receipt() SET search_path = '';
ALTER FUNCTION alpha_exchange.enforce_commission_batch_receipt_reservation() SET search_path = '';
ALTER FUNCTION alpha_exchange.discord_desired_seller_status(text) SET search_path = '';
ALTER FUNCTION alpha_exchange.enqueue_discord_seller_status_change() SET search_path = '';
ALTER FUNCTION alpha_exchange.enqueue_discord_identity_revocation() SET search_path = '';
ALTER FUNCTION alpha_exchange.enqueue_discord_listing_mapping(uuid, text) SET search_path = '';
ALTER FUNCTION alpha_exchange.enqueue_discord_listing_row_change() SET search_path = '';
ALTER FUNCTION alpha_exchange.enqueue_discord_listing_seller_change() SET search_path = '';
ALTER FUNCTION alpha_exchange.enqueue_discord_listing_trust_change() SET search_path = '';
ALTER FUNCTION alpha_exchange.enqueue_discord_listing_identity_revocation() SET search_path = '';
ALTER FUNCTION alpha_exchange.schedule_discord_market_content() SET search_path = '';
ALTER FUNCTION alpha_exchange.cleanup_discord_community_state() SET search_path = '';
ALTER FUNCTION alpha_exchange.cleanup_discord_management_state() SET search_path = '';

COMMIT;

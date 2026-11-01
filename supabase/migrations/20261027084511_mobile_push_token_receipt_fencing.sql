-- A delayed receipt belongs to the token used when the send was claimed.
-- Null legacy hashes intentionally cannot deactivate a replacement token.
alter table if exists alpha_exchange.mobile_push_deliveries
  add column if not exists expo_push_token_hash text;

create index if not exists idx_alpha_exchange_mobile_push_recovery
  on alpha_exchange.notifications
    ((coalesce(nullif(btrim(payload->>'updatedAt'), ''), payload->>'createdAt')), user_id, id)
  where is_read = false;

-- Persist the interface locale independently from the user's spoken languages.
-- Existing payloads are backfilled once while preserving every unrelated key.
update alpha_exchange.users as u
set payload = jsonb_set(
  u.payload,
  '{preferredLocale}',
  to_jsonb('ar'::text),
  true
)
where u.payload->>'preferredLocale' is null
  or u.payload->>'preferredLocale' not in ('ar', 'en');

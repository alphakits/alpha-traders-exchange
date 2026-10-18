# Optional provider migrations

These files are outside the default Supabase migration chain because the
corresponding provider integration has not been enabled in production.

`20260912023000_alpha_exchange_whatsapp_notifications.sql` remains the opt-in
WhatsApp schema. Follow `docs/runbooks/whatsapp-cloud-notifications.md` before
applying it. Its absence from production migration history is intentional.

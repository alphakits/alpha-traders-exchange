-- Optional, allowlisted link code; existing submissions remain unattributed.
-- Expand-only migration: older application versions continue to work.
SET lock_timeout = '5s';
ALTER TABLE public.contact_submissions ADD COLUMN IF NOT EXISTS campaign_link_id text;
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.contact_submissions.campaign_link_id IS
  'Optional non-personal campaign link code for learning enquiries. Owner-only, self-reported attribution; no URL or query text.';

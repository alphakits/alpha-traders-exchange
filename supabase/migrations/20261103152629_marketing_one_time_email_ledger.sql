-- Private, normalized campaign records. Deliberately excluded from runtime snapshots.
-- No recipient rows, consent changes, or email sends are part of this migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table alpha_exchange.marketing_email_requests (
  id uuid primary key,
  campaign_id text not null check (campaign_id ~ '^[a-z0-9][a-z0-9_-]{2,99}$'),
  user_id text references alpha_exchange.users(id) on delete set null,
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  locale text not null default 'en' check (locale in ('ar','en')),
  consent_status text not null default 'none' check (consent_status in ('none','requested','declined','withdrawn','legacy_newsletter','owner_preview')),
  consent_source text,
  consent_version text,
  consent_text text,
  consent_hash text check (consent_hash is null or consent_hash ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  delivery_status text not null default 'pending' check (delivery_status in ('pending','queued','sending','sent','delivered','failed','uncertain','held','expired','cancelled')),
  hold_codes text[] not null default '{}',
  idempotency_key text not null unique,
  request_body jsonb,
  request_body_hash text check (request_body_hash is null or request_body_hash ~ '^[0-9a-f]{64}$'),
  unsubscribe_token text,
  unsubscribe_token_hash text unique check (unsubscribe_token_hash is null or unsubscribe_token_hash ~ '^[0-9a-f]{64}$'),
  provider_email_id text unique,
  provider_campaign_id text,
  provider_outcome_unknown boolean not null default false,
  attempts integer not null default 0 check (attempts >= 0),
  first_attempt_at timestamptz,
  retry_until timestamptz,
  available_at timestamptz not null default now(),
  offer_expires_at timestamptz not null,
  lease_token uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  suppressed_at timestamptz,
  complained_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  last_reconciled_at timestamptz,
  last_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id,user_id),
  unique (campaign_id,email),
  constraint marketing_requested_consent_evidence check (
    consent_status <> 'requested' or
    (consent_source is not null and consent_source='website_invitation' and consent_version is not null and consent_text is not null
      and consent_hash is not null and accepted_at is not null and request_body is not null
      and request_body_hash is not null and unsubscribe_token is not null and unsubscribe_token_hash is not null)
  )
);

create table alpha_exchange.marketing_email_events (
  id uuid primary key,
  request_id uuid not null references alpha_exchange.marketing_email_requests(id) on delete cascade,
  event_type text not null,
  source text not null,
  dedupe_key text not null unique,
  provider_event_id text unique,
  occurred_at timestamptz,
  observed_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  reason text
);

alter table alpha_exchange.marketing_email_requests enable row level security;
alter table alpha_exchange.marketing_email_events enable row level security;
revoke all on alpha_exchange.marketing_email_requests, alpha_exchange.marketing_email_events from public;
-- Matches the existing private-schema server pattern. Custom application sessions
-- are not Supabase Auth JWTs, so no misleading auth.uid() policy is introduced.
-- No anon/authenticated/service_role grants or policies are added.

create index idx_marketing_email_due on alpha_exchange.marketing_email_requests (available_at,created_at)
  where delivery_status in ('queued','sending');
create index idx_marketing_email_withdrawn on alpha_exchange.marketing_email_requests (email)
  where consent_status='withdrawn';
create index idx_marketing_email_reconciliation on alpha_exchange.marketing_email_requests (campaign_id,last_reconciled_at)
  where provider_email_id is not null and delivery_status in ('sent','delivered');
create index idx_marketing_email_user on alpha_exchange.marketing_email_requests (user_id);
create index idx_marketing_email_events_request on alpha_exchange.marketing_email_events (request_id,occurred_at desc);

create function alpha_exchange.preserve_accepted_marketing_email()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if old.accepted_at is not null and (
    new.campaign_id is distinct from old.campaign_id or new.email is distinct from old.email or
    new.locale is distinct from old.locale or new.idempotency_key is distinct from old.idempotency_key or
    new.request_body is distinct from old.request_body or new.request_body_hash is distinct from old.request_body_hash or
    new.unsubscribe_token is distinct from old.unsubscribe_token or new.unsubscribe_token_hash is distinct from old.unsubscribe_token_hash or
    new.consent_source is distinct from old.consent_source or new.consent_version is distinct from old.consent_version or new.consent_text is distinct from old.consent_text or
    new.consent_hash is distinct from old.consent_hash or new.accepted_at is distinct from old.accepted_at
  ) then raise exception 'Accepted marketing email content and evidence are immutable'; end if;
  if old.first_attempt_at is not null and (
    new.first_attempt_at is distinct from old.first_attempt_at or new.retry_until is distinct from old.retry_until
  ) then raise exception 'Marketing email retry window cannot be reset'; end if;
  return new;
end;
$$;
revoke all on function alpha_exchange.preserve_accepted_marketing_email() from public;
do $$
declare api_role text;
begin
  for api_role in select rolname from pg_roles where rolname in ('anon','authenticated','service_role') loop
    execute format('revoke all on alpha_exchange.marketing_email_requests, alpha_exchange.marketing_email_events from %I',api_role);
    execute format('revoke all on function alpha_exchange.preserve_accepted_marketing_email() from %I',api_role);
  end loop;
end;
$$;
create trigger preserve_accepted_marketing_email before update on alpha_exchange.marketing_email_requests
  for each row execute function alpha_exchange.preserve_accepted_marketing_email();

commit;

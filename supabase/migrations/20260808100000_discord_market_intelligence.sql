create table if not exists alpha_exchange.discord_market_content (
  content_key text primary key check (content_key in (
    'live_market_pulse',
    'market_activity_digest',
    'weekly_top_sellers'
  )),
  channel_resource_key text not null check (channel_resource_key in (
    'live_market_pulse',
    'market_activity'
  )),
  channel_id text check (channel_id is null or channel_id ~ '^[0-9]{17,20}$'),
  message_id text check (message_id is null or message_id ~ '^[0-9]{17,20}$'),
  state text not null default 'scheduled' check (state in (
    'scheduled',
    'processing',
    'active',
    'dead'
  )),
  content_version bigint not null default 0 check (content_version >= 0),
  lease_fence bigint not null default 0 check (lease_fence >= 0),
  lease_token uuid,
  leased_until timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 8),
  snapshot jsonb,
  snapshot_hash text check (snapshot_hash is null or snapshot_hash ~ '^[0-9a-f]{64}$'),
  refresh_after timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, message_id),
  check (
    (state = 'processing' and lease_token is not null and leased_until is not null)
    or (state <> 'processing' and lease_token is null and leased_until is null)
  ),
  check (
    (content_key = 'live_market_pulse' and channel_resource_key = 'live_market_pulse')
    or (
      content_key in ('market_activity_digest', 'weekly_top_sellers')
      and channel_resource_key = 'market_activity'
    )
  )
);

create index if not exists idx_discord_market_content_due
  on alpha_exchange.discord_market_content (state, refresh_after);

create table if not exists alpha_exchange.discord_market_content_audit (
  id uuid primary key default gen_random_uuid(),
  content_key text not null check (content_key in (
    'live_market_pulse',
    'market_activity_digest',
    'weekly_top_sellers'
  )),
  content_version bigint not null check (content_version > 0),
  lease_fence bigint not null check (lease_fence > 0),
  outcome text not null check (outcome in ('success', 'degraded', 'failed')),
  detail_code text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_discord_market_content_audit_created
  on alpha_exchange.discord_market_content_audit (created_at desc);

insert into alpha_exchange.discord_market_content (
  content_key,
  channel_resource_key
)
values
  ('live_market_pulse', 'live_market_pulse'),
  ('market_activity_digest', 'market_activity'),
  ('weekly_top_sellers', 'market_activity')
on conflict (content_key) do nothing;

create or replace function alpha_exchange.schedule_discord_market_content()
returns trigger
language plpgsql
as $$
begin
  update alpha_exchange.discord_market_content
     set refresh_after = least(refresh_after, now() + interval '30 seconds'),
         updated_at = now()
   where state <> 'dead'
     and refresh_after > now() + interval '30 seconds';
  return null;
end
$$;

drop trigger if exists schedule_discord_market_content_from_users on alpha_exchange.users;
create trigger schedule_discord_market_content_from_users
after insert or delete or update of seller_status, availability_status, online_status, payload
on alpha_exchange.users
for each statement execute function alpha_exchange.schedule_discord_market_content();

drop trigger if exists schedule_discord_market_content_from_listings on alpha_exchange.listings;
create trigger schedule_discord_market_content_from_listings
after insert or delete or update of status, expires_at, payload
on alpha_exchange.listings
for each statement execute function alpha_exchange.schedule_discord_market_content();

drop trigger if exists schedule_discord_market_content_from_purchase_requests on alpha_exchange.purchase_requests;
create trigger schedule_discord_market_content_from_purchase_requests
after insert or delete or update of status, completed_at, payload
on alpha_exchange.purchase_requests
for each statement execute function alpha_exchange.schedule_discord_market_content();

drop trigger if exists schedule_discord_market_content_from_trust on alpha_exchange.trust_snapshots;
create trigger schedule_discord_market_content_from_trust
after insert or delete or update of payload
on alpha_exchange.trust_snapshots
for each statement execute function alpha_exchange.schedule_discord_market_content();

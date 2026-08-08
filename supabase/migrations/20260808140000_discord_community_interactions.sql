create table if not exists alpha_exchange.discord_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null check (notification_type in ('welcome', 'approved_seller')),
  discord_user_id text not null check (discord_user_id ~ '^[0-9]{17,20}$'),
  source_key text not null unique check (char_length(source_key) between 24 and 200),
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'delivered', 'suppressed', 'dead'
  )),
  attempts integer not null default 0 check (attempts between 0 and 5),
  available_at timestamptz not null default now(),
  lease_token uuid,
  leased_until timestamptz,
  last_error_code text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'processing' and lease_token is not null and leased_until is not null)
    or (status <> 'processing' and lease_token is null and leased_until is null)
  )
);

create index if not exists idx_discord_notification_delivery_claim
  on alpha_exchange.discord_notification_deliveries (status, available_at, created_at);

create table if not exists alpha_exchange.discord_notification_audit (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null check (notification_type in ('welcome', 'approved_seller')),
  outcome text not null check (outcome in ('delivered', 'suppressed', 'retry', 'dead')),
  detail_code text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_discord_notification_audit_created
  on alpha_exchange.discord_notification_audit (created_at desc);

create table if not exists alpha_exchange.discord_interaction_claims (
  interaction_id text primary key check (interaction_id ~ '^[0-9]{17,20}$'),
  discord_user_id text not null check (discord_user_id ~ '^[0-9]{17,20}$'),
  command_name text not null check (command_name in (
    'market', 'profile', 'listing', 'share', 'website', 'help', 'pulse'
  )),
  outcome text not null default 'accepted' check (outcome in ('accepted', 'rate_limited')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create index if not exists idx_discord_interaction_claim_expiry
  on alpha_exchange.discord_interaction_claims (expires_at);

create table if not exists alpha_exchange.discord_command_rate_limits (
  discord_user_id text not null check (discord_user_id ~ '^[0-9]{17,20}$'),
  command_name text not null check (command_name in (
    'market', 'profile', 'listing', 'share', 'website', 'help', 'pulse'
  )),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (discord_user_id, command_name)
);

create index if not exists idx_discord_command_rate_limit_retention
  on alpha_exchange.discord_command_rate_limits (updated_at);

create table if not exists alpha_exchange.discord_command_registry (
  command_name text primary key check (char_length(command_name) between 1 and 32),
  discord_command_id text check (
    discord_command_id is null or discord_command_id ~ '^[0-9]{17,20}$'
  ),
  definition_hash text not null check (definition_hash ~ '^[0-9a-f]{64}$'),
  reconciled_at timestamptz not null default now()
);

create or replace function alpha_exchange.cleanup_discord_community_state()
returns table (
  interaction_claims_deleted bigint,
  rate_limits_deleted bigint,
  notification_audits_deleted bigint
)
language plpgsql
as $$
begin
  delete from alpha_exchange.discord_interaction_claims
   where expires_at < now();
  get diagnostics interaction_claims_deleted = row_count;

  delete from alpha_exchange.discord_command_rate_limits
   where updated_at < now() - interval '7 days';
  get diagnostics rate_limits_deleted = row_count;

  delete from alpha_exchange.discord_notification_audit
   where created_at < now() - interval '90 days';
  get diagnostics notification_audits_deleted = row_count;

  return next;
end
$$;

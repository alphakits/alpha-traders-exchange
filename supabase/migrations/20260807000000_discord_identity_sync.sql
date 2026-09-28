create extension if not exists pgcrypto;

create table if not exists alpha_exchange.discord_identities (
  platform_user_id text primary key references alpha_exchange.users(id) on delete cascade,
  discord_user_id text not null unique check (discord_user_id ~ '^[0-9]{17,20}$'),
  username text not null check (char_length(username) between 1 and 80),
  global_name text check (global_name is null or char_length(global_name) <= 100),
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz
);

create table if not exists alpha_exchange.discord_oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  platform_user_id text not null references alpha_exchange.users(id) on delete cascade,
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  locale text not null check (locale in ('ar', 'en')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists alpha_exchange.discord_managed_roles (
  role_key text primary key check (role_key in ('approved_seller', 'pending_seller', 'suspended_seller')),
  discord_role_id text not null unique check (discord_role_id ~ '^[0-9]{17,20}$'),
  role_name text not null,
  provisioned_at timestamptz not null default now(),
  verified_at timestamptz not null default now()
);

create table if not exists alpha_exchange.discord_role_sync_outbox (
  id uuid primary key default gen_random_uuid(),
  platform_user_id text not null,
  discord_user_id text not null check (discord_user_id ~ '^[0-9]{17,20}$'),
  desired_status text not null check (desired_status in ('approved', 'pending', 'suspended', 'none')),
  reason text not null,
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'dead')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists alpha_exchange.discord_sync_audit (
  id uuid primary key default gen_random_uuid(),
  platform_user_id text,
  discord_user_id text,
  event_type text not null,
  outcome text not null check (outcome in ('success', 'failed', 'degraded')),
  outbox_id uuid references alpha_exchange.discord_role_sync_outbox(id) on delete set null,
  detail_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_discord_oauth_states_expiry
  on alpha_exchange.discord_oauth_states (expires_at);
create index if not exists idx_discord_role_sync_claim
  on alpha_exchange.discord_role_sync_outbox (status, available_at, created_at);
create index if not exists idx_discord_sync_audit_user_created
  on alpha_exchange.discord_sync_audit (platform_user_id, created_at desc);
create index if not exists idx_discord_identities_reconcile
  on alpha_exchange.discord_identities (last_synced_at nulls first, updated_at);

create or replace function alpha_exchange.discord_desired_seller_status(value text)
returns text
language sql
immutable
as $$
  select case value
    when 'approved_seller' then 'approved'
    when 'pending_seller_approval' then 'pending'
    when 'suspended' then 'suspended'
    else 'none'
  end
$$;

create or replace function alpha_exchange.enqueue_discord_seller_status_change()
returns trigger
language plpgsql
as $$
declare
  linked_discord_user_id text;
  desired text;
begin
  if old.seller_status is not distinct from new.seller_status then
    return new;
  end if;

  select discord_user_id
    into linked_discord_user_id
    from alpha_exchange.discord_identities
   where platform_user_id = new.id;

  if linked_discord_user_id is null then
    return new;
  end if;

  desired := alpha_exchange.discord_desired_seller_status(new.seller_status);
  insert into alpha_exchange.discord_role_sync_outbox (
    platform_user_id,
    discord_user_id,
    desired_status,
    reason,
    dedupe_key
  )
  values (
    new.id,
    linked_discord_user_id,
    desired,
    'seller_status_changed',
    'seller-status:' || new.id || ':' || desired || ':' || new.updated_at::text
  )
  on conflict (dedupe_key) do nothing;

  return new;
end
$$;

drop trigger if exists enqueue_discord_seller_status_change on alpha_exchange.users;
create trigger enqueue_discord_seller_status_change
after update of seller_status on alpha_exchange.users
for each row
execute function alpha_exchange.enqueue_discord_seller_status_change();

create or replace function alpha_exchange.enqueue_discord_identity_revocation()
returns trigger
language plpgsql
as $$
begin
  insert into alpha_exchange.discord_role_sync_outbox (
    platform_user_id,
    discord_user_id,
    desired_status,
    reason,
    dedupe_key
  )
  values (
    old.platform_user_id,
    old.discord_user_id,
    'none',
    'identity_deleted',
    'identity-delete:' || old.platform_user_id || ':' || old.discord_user_id || ':' || gen_random_uuid()::text
  );
  return old;
end
$$;

drop trigger if exists enqueue_discord_identity_revocation on alpha_exchange.discord_identities;
create trigger enqueue_discord_identity_revocation
before delete on alpha_exchange.discord_identities
for each row
execute function alpha_exchange.enqueue_discord_identity_revocation();

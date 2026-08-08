create table if not exists alpha_exchange.discord_listing_messages (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null,
  seller_id text not null,
  generation integer not null check (generation > 0),
  guild_id text not null check (guild_id ~ '^[0-9]{17,20}$'),
  channel_id text not null check (channel_id ~ '^[0-9]{17,20}$'),
  message_id text check (message_id is null or message_id ~ '^[0-9]{17,20}$'),
  state text not null default 'queued' check (state in (
    'queued',
    'publishing',
    'active',
    'update_pending',
    'delete_pending',
    'sold',
    'deleted',
    'failed'
  )),
  event_version bigint not null default 1 check (event_version > 0),
  snapshot jsonb,
  snapshot_hash text check (snapshot_hash is null or snapshot_hash ~ '^[0-9a-f]{64}$'),
  last_error_code text,
  last_attempt_at timestamptz,
  published_at timestamptz,
  sold_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, generation),
  unique (channel_id, message_id)
);

create unique index if not exists idx_discord_listing_one_current_per_seller
  on alpha_exchange.discord_listing_messages (seller_id)
  where state in ('queued', 'publishing', 'active', 'update_pending');

create unique index if not exists idx_discord_listing_one_current_per_listing
  on alpha_exchange.discord_listing_messages (listing_id)
  where state in ('queued', 'publishing', 'active', 'update_pending');

create index if not exists idx_discord_listing_messages_reconcile
  on alpha_exchange.discord_listing_messages (state, updated_at);

create table if not exists alpha_exchange.discord_listing_share_cooldowns (
  seller_id text primary key,
  listing_id text not null,
  claim_token uuid not null,
  request_key text not null unique check (char_length(request_key) between 16 and 160),
  last_claimed_at timestamptz not null,
  next_eligible_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (next_eligible_at = last_claimed_at + interval '12 hours')
);

create table if not exists alpha_exchange.discord_listing_outbox (
  id uuid primary key default gen_random_uuid(),
  mapping_id uuid not null references alpha_exchange.discord_listing_messages(id) on delete cascade,
  listing_id text not null,
  seller_id text not null,
  event_type text not null check (event_type in ('publish', 'reconcile')),
  event_version bigint not null check (event_version > 0),
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_discord_listing_outbox_claim
  on alpha_exchange.discord_listing_outbox (status, available_at, created_at);

create table if not exists alpha_exchange.discord_listing_audit (
  id uuid primary key default gen_random_uuid(),
  mapping_id uuid references alpha_exchange.discord_listing_messages(id) on delete set null,
  listing_id text,
  seller_id text,
  event_type text not null,
  outcome text not null check (outcome in ('accepted', 'success', 'failed', 'degraded', 'denied')),
  detail_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_discord_listing_audit_created
  on alpha_exchange.discord_listing_audit (created_at desc);

create or replace function alpha_exchange.enqueue_discord_listing_mapping(
  target_mapping_id uuid,
  target_event_type text
)
returns void
language plpgsql
as $$
declare
  next_mapping_version bigint;
  target_listing_id text;
  target_seller_id text;
begin
  update alpha_exchange.discord_listing_messages
     set event_version = event_version + 1,
         state = case
           when state = 'active' then 'update_pending'
           else state
         end,
         updated_at = now()
   where id = target_mapping_id
     and state in ('queued', 'publishing', 'active', 'update_pending', 'delete_pending')
  returning event_version, listing_id, seller_id
       into next_mapping_version, target_listing_id, target_seller_id;

  if next_mapping_version is null then
    return;
  end if;

  insert into alpha_exchange.discord_listing_outbox (
    mapping_id,
    listing_id,
    seller_id,
    event_type,
    event_version,
    dedupe_key
  )
  values (
    target_mapping_id,
    target_listing_id,
    target_seller_id,
    target_event_type,
    next_mapping_version,
    target_mapping_id::text || ':' || next_mapping_version::text
  )
  on conflict (dedupe_key) do nothing;
end
$$;

create or replace function alpha_exchange.enqueue_discord_listing_row_change()
returns trigger
language plpgsql
as $$
declare
  mapping_id uuid;
  target_listing_id text;
begin
  if tg_op = 'UPDATE'
     and old.status is not distinct from new.status
     and old.payload is not distinct from new.payload
     and old.expires_at is not distinct from new.expires_at then
    return new;
  end if;

  target_listing_id := case when tg_op = 'DELETE' then old.id else new.id end;
  for mapping_id in
    select id
      from alpha_exchange.discord_listing_messages
     where listing_id = target_listing_id
       and state in ('queued', 'publishing', 'active', 'update_pending', 'delete_pending')
  loop
    perform alpha_exchange.enqueue_discord_listing_mapping(mapping_id, 'reconcile');
  end loop;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

drop trigger if exists enqueue_discord_listing_row_change on alpha_exchange.listings;
create trigger enqueue_discord_listing_row_change
after insert or delete or update of status, expires_at, payload on alpha_exchange.listings
for each row
execute function alpha_exchange.enqueue_discord_listing_row_change();

create or replace function alpha_exchange.enqueue_discord_listing_seller_change()
returns trigger
language plpgsql
as $$
declare
  mapping_id uuid;
begin
  if old.seller_status is not distinct from new.seller_status
     and old.payload is not distinct from new.payload then
    return new;
  end if;

  for mapping_id in
    select id
      from alpha_exchange.discord_listing_messages
     where seller_id = new.id
       and state in ('queued', 'publishing', 'active', 'update_pending', 'delete_pending')
  loop
    perform alpha_exchange.enqueue_discord_listing_mapping(mapping_id, 'reconcile');
  end loop;
  return new;
end
$$;

drop trigger if exists enqueue_discord_listing_seller_change on alpha_exchange.users;
create trigger enqueue_discord_listing_seller_change
after update of seller_status, payload on alpha_exchange.users
for each row
execute function alpha_exchange.enqueue_discord_listing_seller_change();

create or replace function alpha_exchange.enqueue_discord_listing_trust_change()
returns trigger
language plpgsql
as $$
declare
  mapping_id uuid;
  target_seller_id text;
begin
  if tg_op = 'UPDATE' and old.payload is not distinct from new.payload then
    return new;
  end if;

  target_seller_id := case when tg_op = 'DELETE' then old.seller_id else new.seller_id end;
  for mapping_id in
    select id
      from alpha_exchange.discord_listing_messages
     where seller_id = target_seller_id
       and state in ('queued', 'publishing', 'active', 'update_pending', 'delete_pending')
  loop
    perform alpha_exchange.enqueue_discord_listing_mapping(mapping_id, 'reconcile');
  end loop;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

drop trigger if exists enqueue_discord_listing_trust_change on alpha_exchange.trust_snapshots;
create trigger enqueue_discord_listing_trust_change
after insert or delete or update of payload on alpha_exchange.trust_snapshots
for each row
execute function alpha_exchange.enqueue_discord_listing_trust_change();

create or replace function alpha_exchange.enqueue_discord_listing_identity_revocation()
returns trigger
language plpgsql
as $$
declare
  mapping_id uuid;
begin
  for mapping_id in
    select id
      from alpha_exchange.discord_listing_messages
     where seller_id = old.platform_user_id
       and state in ('queued', 'publishing', 'active', 'update_pending', 'delete_pending')
  loop
    perform alpha_exchange.enqueue_discord_listing_mapping(mapping_id, 'reconcile');
  end loop;
  return old;
end
$$;

drop trigger if exists enqueue_discord_listing_identity_revocation on alpha_exchange.discord_identities;
create trigger enqueue_discord_listing_identity_revocation
before delete on alpha_exchange.discord_identities
for each row
execute function alpha_exchange.enqueue_discord_listing_identity_revocation();

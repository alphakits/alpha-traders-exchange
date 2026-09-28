create table if not exists alpha_exchange.discord_managed_resources (
  resource_key text primary key check (resource_key in (
    'seller_category',
    'seller_lounge',
    'seller_announcements',
    'seller_updates',
    'seller_guides',
    'seller_support',
    'marketplace_listings'
  )),
  discord_resource_id text unique check (
    discord_resource_id is null
    or discord_resource_id ~ '^[0-9]{17,20}$'
  ),
  resource_type text not null check (resource_type in ('category', 'text_channel')),
  guild_id text not null check (guild_id ~ '^[0-9]{17,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 100),
  reconciliation_state text not null default 'pending' check (
    reconciliation_state in ('pending', 'ready', 'degraded')
  ),
  last_error_code text,
  provisioned_at timestamptz,
  verified_at timestamptz,
  last_audit_fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_discord_managed_resources_readiness
  on alpha_exchange.discord_managed_resources (guild_id, reconciliation_state);

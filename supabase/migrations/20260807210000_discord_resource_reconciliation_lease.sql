alter table alpha_exchange.discord_managed_resources
  add column if not exists provisioning_token uuid;

update alpha_exchange.discord_managed_resources
   set provisioning_token = gen_random_uuid()
 where provisioning_token is null;

alter table alpha_exchange.discord_managed_resources
  alter column provisioning_token set default gen_random_uuid(),
  alter column provisioning_token set not null;

create table if not exists alpha_exchange.discord_resource_reconciliation_leases (
  lease_key text primary key check (lease_key = 'seller_resources'),
  guild_id text not null check (guild_id ~ '^[0-9]{17,20}$'),
  lease_token uuid not null,
  lease_until timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_discord_resource_reconciliation_lease_expiry
  on alpha_exchange.discord_resource_reconciliation_leases (lease_until);

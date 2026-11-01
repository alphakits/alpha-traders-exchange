-- Schema only: deployment/migration must never reset reporting automatically.
create table if not exists alpha_exchange.owner_analytics_periods (
  id text primary key check (id = 'unique-visitors-v1'),
  started_at timestamptz not null
);
alter table alpha_exchange.owner_analytics_periods enable row level security;
revoke all on table alpha_exchange.owner_analytics_periods from public, anon, authenticated;

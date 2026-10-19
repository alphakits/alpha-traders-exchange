-- Public, allowlisted monitoring summaries only; runtime access remains private.
create table if not exists alpha_exchange.public_production_health_history (
  started_at timestamptz primary key,
  observation jsonb not null check (jsonb_typeof(observation) = 'object')
);
alter table alpha_exchange.public_production_health_history enable row level security;
revoke all on alpha_exchange.public_production_health_history from public, anon, authenticated;
grant select, insert, delete on alpha_exchange.public_production_health_history to service_role;

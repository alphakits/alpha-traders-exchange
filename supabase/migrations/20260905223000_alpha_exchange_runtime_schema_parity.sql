-- Keep the deploy-time database schema aligned with the runtime repository.
-- All statements are idempotent because existing environments may already
-- have these objects from the legacy runtime bootstrap.

insert into alpha_exchange.runtime_meta (singleton, version, updated_at)
values (true, 0, now())
on conflict (singleton) do nothing;

create table if not exists alpha_exchange.admin_announcement_runs (
  id text primary key,
  request_key text not null,
  audience text not null,
  status text not null,
  created_by_user_id text not null references alpha_exchange.users(id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

alter table alpha_exchange.admin_announcement_runs
  add column if not exists request_key text;

create table if not exists alpha_exchange.sms_deliveries (
  id text primary key,
  event_key text not null unique,
  event_type text not null,
  recipient_user_id text not null references alpha_exchange.users(id) on delete cascade,
  status text not null,
  retry_count integer not null default 0,
  twilio_message_sid text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.marketplace_enforcement_records (
  id text primary key,
  seller_id text not null references alpha_exchange.users(id) on delete cascade,
  status text not null,
  violation_number integer not null,
  issued_at timestamptz not null,
  due_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.marketplace_enforcement_audit_log (
  id text primary key,
  seller_id text not null references alpha_exchange.users(id) on delete cascade,
  action text not null,
  actor_user_id text not null references alpha_exchange.users(id) on delete cascade,
  created_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create index if not exists idx_alpha_exchange_announcement_runs_created_at
  on alpha_exchange.admin_announcement_runs (created_at desc);
create unique index if not exists idx_alpha_exchange_announcement_runs_request_key
  on alpha_exchange.admin_announcement_runs (created_by_user_id, request_key);
create index if not exists idx_alpha_exchange_sms_deliveries_status
  on alpha_exchange.sms_deliveries (status, updated_at desc);
create index if not exists idx_alpha_exchange_marketplace_enforcement_records_seller_status
  on alpha_exchange.marketplace_enforcement_records (seller_id, status, updated_at desc);
create index if not exists idx_alpha_exchange_marketplace_enforcement_audit_seller_created
  on alpha_exchange.marketplace_enforcement_audit_log (seller_id, created_at desc);

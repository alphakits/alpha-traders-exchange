-- Notification reminder timing and private browser-push delivery records.

create table if not exists alpha_exchange.notification_reminder_state (
  user_id text primary key references alpha_exchange.users(id) on delete cascade,
  next_prompt_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create table if not exists alpha_exchange.browser_push_subscriptions (
  endpoint_hash text primary key,
  user_id text not null references alpha_exchange.users(id) on delete cascade,
  session_token_hash text not null,
  subscription jsonb not null,
  locale text not null check (locale in ('en','ar')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists browser_push_user_active on alpha_exchange.browser_push_subscriptions(user_id, updated_at desc) where active;
create table if not exists alpha_exchange.browser_push_deliveries (
  delivery_key text not null,
  endpoint_hash text not null references alpha_exchange.browser_push_subscriptions(endpoint_hash) on delete cascade,
  status text not null check (status in ('processing','sent','failed','skipped')),
  attempts integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (delivery_key, endpoint_hash)
);
alter table alpha_exchange.notification_reminder_state enable row level security;
alter table alpha_exchange.browser_push_subscriptions enable row level security;
alter table alpha_exchange.browser_push_deliveries enable row level security;
revoke all on alpha_exchange.notification_reminder_state, alpha_exchange.browser_push_subscriptions, alpha_exchange.browser_push_deliveries from public;

do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on alpha_exchange.notification_reminder_state, alpha_exchange.browser_push_subscriptions, alpha_exchange.browser_push_deliveries from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on alpha_exchange.notification_reminder_state, alpha_exchange.browser_push_subscriptions, alpha_exchange.browser_push_deliveries from authenticated;
  end if;
end $$;

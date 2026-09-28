-- Native lock-screen notification registrations for the website-parity app.
-- Push tokens are scoped to the exact authenticated browser session that
-- registered them. Delivery joins against the live session table, so logout or
-- expiry immediately prevents further pushes without trusting client state.

create table if not exists alpha_exchange.mobile_push_subscriptions (
  id text primary key,
  user_id text not null,
  session_token_hash text not null,
  installation_id_hash text not null,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  locale text not null check (locale in ('ar', 'en')),
  app_version text not null,
  active boolean not null default true,
  disabled_reason text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, installation_id_hash)
);

create table if not exists alpha_exchange.mobile_push_deliveries (
  notification_id text not null,
  subscription_id text not null references alpha_exchange.mobile_push_subscriptions(id) on delete cascade,
  status text not null check (status in ('processing', 'sent', 'delivered', 'failed')),
  ticket_id text,
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_error_code text,
  receipt_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (notification_id, subscription_id)
);

create index if not exists idx_alpha_exchange_mobile_push_user_active
  on alpha_exchange.mobile_push_subscriptions (user_id, active, updated_at desc);

create index if not exists idx_alpha_exchange_mobile_push_session
  on alpha_exchange.mobile_push_subscriptions (session_token_hash);

create index if not exists idx_alpha_exchange_mobile_push_receipts
  on alpha_exchange.mobile_push_deliveries (status, updated_at)
  where status = 'sent' and ticket_id is not null;

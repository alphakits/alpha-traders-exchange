-- Native iOS/Android sessions are deliberately separate from browser-cookie
-- sessions. Only SHA-256 hashes of high-entropy opaque tokens and installation
-- identifiers are persisted.

create table if not exists alpha_exchange.mobile_device_sessions (
  id text primary key,
  user_id text not null references alpha_exchange.users(id) on delete cascade,
  device_id_hash text not null,
  access_token_hash text not null unique,
  refresh_token_hash text not null unique,
  token_family_id text not null,
  refresh_generation integer not null default 0 check (refresh_generation >= 0),
  platform text not null check (platform in ('ios', 'android')),
  app_version text not null,
  locale text not null check (locale in ('ar', 'en')),
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  last_seen_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (user_id, device_id_hash)
);

create table if not exists alpha_exchange.mobile_refresh_token_history (
  token_hash text primary key,
  session_id text not null references alpha_exchange.mobile_device_sessions(id) on delete cascade,
  generation integer not null check (generation >= 0),
  used_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists idx_alpha_exchange_mobile_sessions_user_active
  on alpha_exchange.mobile_device_sessions (user_id, updated_at desc)
  where revoked_at is null;

create index if not exists idx_alpha_exchange_mobile_sessions_access_expiry
  on alpha_exchange.mobile_device_sessions (access_expires_at)
  where revoked_at is null;

create index if not exists idx_alpha_exchange_mobile_sessions_refresh_expiry
  on alpha_exchange.mobile_device_sessions (refresh_expires_at)
  where revoked_at is null;

create index if not exists idx_alpha_exchange_mobile_refresh_history_session
  on alpha_exchange.mobile_refresh_token_history (session_id, used_at desc);

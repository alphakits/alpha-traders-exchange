create schema if not exists alpha_exchange;

-- WhatsApp consent is intentionally separate from general notification
-- preferences. No phone number or message content is retained in these tables.
create table if not exists alpha_exchange.whatsapp_subscriptions (
  -- Snapshot-managed marketplace tables are periodically delete/reinserted.
  -- Keep durable consent/outbox identifiers deliberately free of cascading FKs.
  user_id text primary key,
  phone_fingerprint text not null,
  locale text not null check (locale in ('ar', 'en')),
  trade_updates_enabled boolean not null default true,
  chat_messages_enabled boolean not null default true,
  active boolean not null default false,
  consent_version text not null,
  consent_copy_hash text not null,
  consented_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists alpha_exchange.whatsapp_consent_events (
  id text primary key,
  user_id text not null,
  event_type text not null check (event_type in ('granted', 'updated', 'revoked')),
  source text not null check (source in ('settings', 'inbound_stop', 'phone_changed')),
  phone_fingerprint text not null,
  locale text not null check (locale in ('ar', 'en')),
  consent_version text not null,
  consent_copy_hash text not null,
  trade_updates_enabled boolean not null,
  chat_messages_enabled boolean not null,
  occurred_at timestamptz not null default now()
);

create table if not exists alpha_exchange.whatsapp_deliveries (
  id text primary key,
  notification_id text not null,
  notification_revision text not null,
  recipient_user_id text not null,
  request_id text not null,
  event_type text not null check (event_type in (
    'new_request',
    'request_accepted',
    'request_declined',
    'trade_update',
    'trade_room_message',
    'trade_room_reminder',
    'trade_completed',
    'trade_cancelled'
  )),
  status text not null check (status in (
    'processing',
    'retry_scheduled',
    'accepted',
    'sent',
    'delivered',
    'read',
    'failed',
    'suppressed'
  )),
  provider_message_id text unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_token text,
  lease_expires_at timestamptz,
  last_error_code text,
  accepted_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, notification_revision, recipient_user_id)
);

-- Meta retries webhooks. Recording the provider message ID prevents an old
-- STOP delivery from revoking a newer consent after the user opts in again.
create table if not exists alpha_exchange.whatsapp_inbound_commands (
  message_id text primary key,
  phone_fingerprint text not null,
  command_type text not null check (command_type in ('stop')),
  occurred_at timestamptz not null,
  processed_at timestamptz not null default now(),
  revoked_count integer not null default 0 check (revoked_count >= 0)
);

create index if not exists idx_alpha_exchange_whatsapp_subscription_phone
  on alpha_exchange.whatsapp_subscriptions (phone_fingerprint)
  where active = true;

create index if not exists idx_alpha_exchange_whatsapp_consent_user_time
  on alpha_exchange.whatsapp_consent_events (user_id, occurred_at desc);

create index if not exists idx_alpha_exchange_whatsapp_delivery_retry
  on alpha_exchange.whatsapp_deliveries (next_attempt_at, created_at)
  where status = 'retry_scheduled';

create index if not exists idx_alpha_exchange_whatsapp_delivery_receipt
  on alpha_exchange.whatsapp_deliveries (provider_message_id)
  where provider_message_id is not null;

create index if not exists idx_alpha_exchange_whatsapp_inbound_phone_time
  on alpha_exchange.whatsapp_inbound_commands (phone_fingerprint, occurred_at desc);

-- Baseline of existing server-only runtime/legacy tables inspected on 2026-10-16.
-- Does not remove rows, change business rules, or delete unreferenced legacy tables.
-- Runtime-created tables must also be reproducible from ordered migrations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists alpha_exchange."evidence_blobs" (
  "storage_key" text not null,
  "content" bytea not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "evidence_blobs_pkey" PRIMARY KEY (storage_key)
);
CREATE INDEX IF NOT EXISTS idx_alpha_exchange_evidence_blobs_updated ON alpha_exchange.evidence_blobs USING btree (updated_at DESC);
revoke all on alpha_exchange."evidence_blobs" from public;

create table if not exists alpha_exchange."marketplace_email_gate" (
  "singleton" boolean default true not null,
  "available_at" timestamp with time zone default now() not null,
  constraint "marketplace_email_gate_pkey" PRIMARY KEY (singleton),
  constraint "marketplace_email_gate_singleton_check" CHECK (singleton)
);
alter table alpha_exchange."marketplace_email_gate" enable row level security;
revoke all on alpha_exchange."marketplace_email_gate" from public;

create table if not exists alpha_exchange."marketplace_email_outbox" (
  "id" text not null,
  "recipient_id" text not null,
  "event" text not null,
  "recipient_email" text,
  "request_body" text,
  "idempotency_key" text not null,
  "request_id" text,
  "required_trade_statuses" text[],
  "status" text default 'pending'::text not null,
  "attempts" integer default 0 not null,
  "available_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone default (now() + '23:00:00'::interval) not null,
  "lease_token" text,
  "lease_until" timestamp with time zone,
  "last_reason" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "marketplace_email_outbox_idempotency_key_key" UNIQUE (idempotency_key),
  constraint "marketplace_email_outbox_pkey" PRIMARY KEY (id),
  constraint "marketplace_email_outbox_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES alpha_exchange.users(id) ON DELETE CASCADE,
  constraint "marketplace_email_outbox_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'suppressed'::text])))
);
CREATE INDEX IF NOT EXISTS idx_marketplace_email_due ON alpha_exchange.marketplace_email_outbox USING btree (available_at, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));
alter table alpha_exchange."marketplace_email_outbox" enable row level security;
revoke all on alpha_exchange."marketplace_email_outbox" from public;

create table if not exists alpha_exchange."notification_analytics" (
  "id" text not null,
  "metric" text not null,
  "value" double precision not null,
  "recorded_at" timestamp with time zone not null,
  "sort_index" integer not null,
  "payload" jsonb not null,
  constraint "notification_analytics_pkey" PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_alpha_exchange_notification_analytics_metric_recorded ON alpha_exchange.notification_analytics USING btree (metric, recorded_at DESC);
revoke all on alpha_exchange."notification_analytics" from public;

create table if not exists alpha_exchange."notification_events" (
  "id" text not null,
  "dedupe_key" text not null,
  "domain" text not null,
  "event_name" text not null,
  "status" text not null,
  "priority" text not null,
  "created_at" timestamp with time zone not null,
  "updated_at" timestamp with time zone not null,
  "scheduled_for" timestamp with time zone,
  "sort_index" integer not null,
  "payload" jsonb not null,
  constraint "notification_events_dedupe_key_key" UNIQUE (dedupe_key),
  constraint "notification_events_pkey" PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_alpha_exchange_notification_events_status_created ON alpha_exchange.notification_events USING btree (status, created_at DESC);
revoke all on alpha_exchange."notification_events" from public;

create table if not exists alpha_exchange."notification_queue" (
  "id" text not null,
  "event_id" text not null,
  "dedupe_key" text not null,
  "recipient_user_id" text not null,
  "channel" text not null,
  "status" text not null,
  "priority" text not null,
  "scheduled_for" timestamp with time zone not null,
  "created_at" timestamp with time zone not null,
  "updated_at" timestamp with time zone not null,
  "sort_index" integer not null,
  "payload" jsonb not null,
  constraint "notification_queue_dedupe_key_key" UNIQUE (dedupe_key),
  constraint "notification_queue_event_id_fkey" FOREIGN KEY (event_id) REFERENCES alpha_exchange.notification_events(id) ON DELETE CASCADE,
  constraint "notification_queue_pkey" PRIMARY KEY (id),
  constraint "notification_queue_recipient_user_id_fkey" FOREIGN KEY (recipient_user_id) REFERENCES alpha_exchange.users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_alpha_exchange_notification_queue_status_scheduled ON alpha_exchange.notification_queue USING btree (status, scheduled_for);
revoke all on alpha_exchange."notification_queue" from public;

create table if not exists alpha_exchange."notification_deliveries" (
  "id" text not null,
  "queue_job_id" text not null,
  "event_id" text not null,
  "recipient_user_id" text not null,
  "channel" text not null,
  "status" text not null,
  "attempt_number" integer not null,
  "created_at" timestamp with time zone not null,
  "sort_index" integer not null,
  "payload" jsonb not null,
  constraint "notification_deliveries_event_id_fkey" FOREIGN KEY (event_id) REFERENCES alpha_exchange.notification_events(id) ON DELETE CASCADE,
  constraint "notification_deliveries_pkey" PRIMARY KEY (id),
  constraint "notification_deliveries_queue_job_id_fkey" FOREIGN KEY (queue_job_id) REFERENCES alpha_exchange.notification_queue(id) ON DELETE CASCADE,
  constraint "notification_deliveries_recipient_user_id_fkey" FOREIGN KEY (recipient_user_id) REFERENCES alpha_exchange.users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_alpha_exchange_notification_deliveries_queue_created ON alpha_exchange.notification_deliveries USING btree (queue_job_id, created_at DESC);
revoke all on alpha_exchange."notification_deliveries" from public;

create table if not exists alpha_exchange."notification_reminders" (
  "id" text not null,
  "event_id" text not null,
  "recipient_user_id" text not null,
  "policy_key" text not null,
  "step_id" text not null,
  "status" text not null,
  "due_at" timestamp with time zone not null,
  "created_at" timestamp with time zone not null,
  "updated_at" timestamp with time zone not null,
  "sort_index" integer not null,
  "payload" jsonb not null,
  constraint "notification_reminders_event_id_fkey" FOREIGN KEY (event_id) REFERENCES alpha_exchange.notification_events(id) ON DELETE CASCADE,
  constraint "notification_reminders_pkey" PRIMARY KEY (id),
  constraint "notification_reminders_recipient_user_id_fkey" FOREIGN KEY (recipient_user_id) REFERENCES alpha_exchange.users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_alpha_exchange_notification_reminders_status_due ON alpha_exchange.notification_reminders USING btree (status, due_at);
revoke all on alpha_exchange."notification_reminders" from public;

create table if not exists alpha_exchange."performance_telemetry" (
  "id" text not null,
  "domain" text not null,
  "action" text not null,
  "route" text not null,
  "method" text,
  "status_code" integer,
  "created_at" timestamp with time zone not null,
  "sort_index" integer not null,
  "payload" jsonb not null,
  constraint "performance_telemetry_pkey" PRIMARY KEY (id)
);
revoke all on alpha_exchange."performance_telemetry" from public;

create table if not exists alpha_exchange."rate_limit_windows" (
  "bucket_key" text not null,
  "window_started_at" timestamp with time zone not null,
  "request_count" integer not null,
  constraint "rate_limit_windows_pkey" PRIMARY KEY (bucket_key),
  constraint "rate_limit_windows_request_count_check" CHECK ((request_count >= 0))
);
revoke all on alpha_exchange."rate_limit_windows" from public;

create table if not exists alpha_exchange."trade_turn_states" (
  "request_id" text not null,
  "trade_id" text,
  "status" text not null,
  "owner" text not null,
  "expected_action" text not null,
  "action_required" boolean not null,
  "updated_at" timestamp with time zone not null,
  "sort_index" integer not null,
  "payload" jsonb not null,
  constraint "trade_turn_states_pkey" PRIMARY KEY (request_id)
);
revoke all on alpha_exchange."trade_turn_states" from public;

commit;

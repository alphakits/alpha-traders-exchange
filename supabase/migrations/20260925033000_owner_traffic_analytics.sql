create table if not exists alpha_exchange.traffic_events (
  id text primary key,
  occurred_at timestamptz not null default now(),
  visitor_key text not null,
  session_key text not null,
  user_id text,
  event_name text not null,
  path text not null,
  platform text not null,
  device_type text not null,
  referrer_host text
);
alter table alpha_exchange.traffic_events enable row level security;
create index if not exists traffic_events_occurred_idx on alpha_exchange.traffic_events(occurred_at desc);
create index if not exists traffic_events_visitor_idx on alpha_exchange.traffic_events(visitor_key, occurred_at desc);

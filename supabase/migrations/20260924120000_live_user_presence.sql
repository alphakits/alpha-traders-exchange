-- Real observed activity, independent of the financial snapshot. Server access only.
create table if not exists alpha_exchange.user_presence (
  user_id text not null references alpha_exchange.users(id) on delete cascade,
  session_key text not null,
  client_id text not null,
  sequence bigint not null,
  active boolean not null,
  last_seen_at timestamptz,
  last_active_at timestamptz,
  primary key (user_id, session_key, client_id)
);
alter table alpha_exchange.user_presence enable row level security;
create index if not exists user_presence_session_key_idx on alpha_exchange.user_presence(session_key);

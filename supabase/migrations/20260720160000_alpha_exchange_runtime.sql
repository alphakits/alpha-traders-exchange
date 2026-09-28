create schema if not exists alpha_exchange;

create table if not exists alpha_exchange.runtime_meta (
  singleton boolean primary key default true,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into alpha_exchange.runtime_meta (singleton, version, updated_at)
values (true, 0, now())
on conflict (singleton) do nothing;

create table if not exists alpha_exchange.users (
  id text primary key,
  email text not null unique,
  role text not null,
  seller_status text not null,
  availability_status text not null,
  online_status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.seller_profiles (
  user_id text primary key references alpha_exchange.users(id) on delete cascade,
  seller_status text not null,
  availability_status text not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.seller_settings (
  user_id text primary key references alpha_exchange.users(id) on delete cascade,
  availability_status text not null,
  notification_preferences jsonb not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.listings (
  id text primary key,
  seller_id text not null references alpha_exchange.users(id) on delete cascade,
  status text not null,
  active_trade_request_id text,
  expires_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.trades (
  id text primary key,
  purchase_request_id text not null unique,
  listing_id text not null,
  seller_id text not null,
  buyer_id text not null,
  status text not null,
  completed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.purchase_requests (
  id text primary key,
  trade_id text,
  listing_id text not null,
  seller_id text not null,
  buyer_id text not null,
  status text not null,
  timed_out_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.notifications (
  id text primary key,
  user_id text not null references alpha_exchange.users(id) on delete cascade,
  category text not null,
  is_read boolean not null,
  created_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.commissions (
  id text primary key,
  purchase_request_id text not null,
  listing_id text not null,
  seller_id text not null,
  buyer_id text not null,
  payment_status text not null,
  due_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.audit_logs (
  id text primary key,
  action text not null,
  actor_user_id text not null,
  target_user_id text,
  listing_id text,
  purchase_request_id text,
  created_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.evidence (
  id text primary key,
  purchase_request_id text not null,
  side text not null,
  uploaded_by_user_id text not null,
  mime_type text not null,
  file_name text not null,
  size_bytes integer not null,
  uploaded_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null,
  content bytea
);

create table if not exists alpha_exchange.sessions (
  token_hash text primary key,
  user_id text not null references alpha_exchange.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.password_reset_tokens (
  id text primary key,
  user_id text not null references alpha_exchange.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.seller_applications (
  id text primary key,
  user_id text not null references alpha_exchange.users(id) on delete cascade,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.activity_logs (
  id text primary key,
  user_id text not null references alpha_exchange.users(id) on delete cascade,
  category text not null,
  created_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.disputes (
  id text primary key,
  trade_id text not null,
  purchase_request_id text not null,
  seller_id text not null,
  buyer_id text not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.seller_reports (
  id text primary key,
  reporter_user_id text not null,
  seller_id text not null,
  purchase_request_id text,
  created_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.trust_snapshots (
  seller_id text primary key references alpha_exchange.users(id) on delete cascade,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.trust_score_history (
  id text primary key,
  seller_id text not null references alpha_exchange.users(id) on delete cascade,
  created_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.private_beta_invites (
  id text primary key,
  code text not null unique,
  status text not null,
  created_by_user_id text not null,
  expires_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.private_beta_invite_uses (
  id text primary key,
  invite_code_id text not null references alpha_exchange.private_beta_invites(id) on delete cascade,
  used_by_user_id text not null references alpha_exchange.users(id) on delete cascade,
  used_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.beta_feedback (
  id text primary key,
  user_id text not null references alpha_exchange.users(id) on delete cascade,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists alpha_exchange.beta_announcements (
  id text primary key,
  type text not null,
  is_active boolean not null,
  created_by_user_id text not null references alpha_exchange.users(id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create index if not exists idx_alpha_exchange_users_email on alpha_exchange.users (email);
create index if not exists idx_alpha_exchange_users_role on alpha_exchange.users (role);
create index if not exists idx_alpha_exchange_listings_seller_status on alpha_exchange.listings (seller_id, status);
create index if not exists idx_alpha_exchange_listings_expires_at on alpha_exchange.listings (expires_at);
create index if not exists idx_alpha_exchange_purchase_requests_seller_status on alpha_exchange.purchase_requests (seller_id, status);
create index if not exists idx_alpha_exchange_purchase_requests_buyer_status on alpha_exchange.purchase_requests (buyer_id, status);
create index if not exists idx_alpha_exchange_purchase_requests_listing on alpha_exchange.purchase_requests (listing_id);
create index if not exists idx_alpha_exchange_notifications_user_read on alpha_exchange.notifications (user_id, is_read, created_at desc);
create index if not exists idx_alpha_exchange_commissions_payment_status on alpha_exchange.commissions (payment_status, due_at);
create index if not exists idx_alpha_exchange_audit_logs_created_at on alpha_exchange.audit_logs (created_at desc);
create index if not exists idx_alpha_exchange_evidence_request_side on alpha_exchange.evidence (purchase_request_id, side);
create index if not exists idx_alpha_exchange_sessions_user_expires on alpha_exchange.sessions (user_id, expires_at);
create index if not exists idx_alpha_exchange_seller_applications_status on alpha_exchange.seller_applications (status, created_at);
create index if not exists idx_alpha_exchange_trades_status on alpha_exchange.trades (status, created_at desc);

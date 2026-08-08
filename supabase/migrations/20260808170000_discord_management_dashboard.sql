create table if not exists alpha_exchange.discord_operator_requests (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action = 'reconcile_managed_integration'),
  request_reason text not null check (request_reason = 'operator_dashboard'),
  requested_by_user_id text not null,
  idempotency_key uuid not null unique,
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'completed', 'dead'
  )),
  attempts integer not null default 0 check (attempts between 0 and 3),
  lease_fence bigint not null default 0 check (lease_fence >= 0),
  lease_token uuid,
  leased_until timestamptz,
  result_code text,
  last_error_code text,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (status = 'processing' and lease_token is not null and leased_until is not null)
    or (status <> 'processing' and lease_token is null and leased_until is null)
  )
);

create unique index if not exists idx_discord_operator_one_active_action
  on alpha_exchange.discord_operator_requests (action)
  where status in ('pending', 'processing');

create index if not exists idx_discord_operator_request_claim
  on alpha_exchange.discord_operator_requests (status, available_at, created_at);

create table if not exists alpha_exchange.discord_operator_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references alpha_exchange.discord_operator_requests(id) on delete cascade,
  action text not null check (action = 'reconcile_managed_integration'),
  actor_user_id text,
  event_type text not null check (event_type in (
    'accepted', 'coalesced', 'processing', 'completed', 'retry_scheduled', 'dead'
  )),
  detail_code text not null check (detail_code ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default now()
);

create index if not exists idx_discord_operator_audit_created
  on alpha_exchange.discord_operator_audit (created_at desc);

create table if not exists alpha_exchange.discord_interaction_audit (
  id bigint generated always as identity primary key,
  command_name text not null check (command_name in (
    'market', 'profile', 'listing', 'share', 'website', 'help', 'pulse'
  )),
  outcome text not null check (outcome in ('accepted', 'rate_limited', 'replayed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_discord_interaction_audit_created
  on alpha_exchange.discord_interaction_audit (created_at desc);

create or replace function alpha_exchange.cleanup_discord_management_state()
returns table (
  operator_requests_deleted bigint,
  interaction_audits_deleted bigint
)
language plpgsql
as $$
begin
  delete from alpha_exchange.discord_operator_requests
   where status in ('completed', 'dead')
     and updated_at < now() - interval '90 days';
  get diagnostics operator_requests_deleted = row_count;

  delete from alpha_exchange.discord_interaction_audit
   where created_at < now() - interval '30 days';
  get diagnostics interaction_audits_deleted = row_count;

  return next;
end
$$;

-- Run once before enabling ALPHA_JOURNAL_ENABLED. Uses Alpha's existing custom
-- account IDs/session verification, not Supabase Auth JWT IDs.
begin;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'alpha_journal_runtime') then
    create role alpha_journal_runtime nologin noinherit nobypassrls;
  end if;
end $$;
grant alpha_journal_runtime to current_user;
grant usage on schema alpha_exchange to alpha_journal_runtime;

create table alpha_exchange.journal_trades (
  user_id text not null references alpha_exchange.users(id) on delete cascade,
  id uuid not null,
  trade_date date not null,
  version integer not null default 1 check (version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index journal_trades_date_idx on alpha_exchange.journal_trades(user_id, trade_date desc, id desc);

create table alpha_exchange.journal_reviews (
  user_id text not null references alpha_exchange.users(id) on delete cascade,
  review_date date not null,
  period text not null check (period in ('day','week')),
  version integer not null default 1 check (version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  primary key(user_id, review_date, period)
);
create table alpha_exchange.journal_settings (
  user_id text primary key references alpha_exchange.users(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);
create table alpha_exchange.journal_files (
  user_id text not null,
  id uuid not null,
  trade_id uuid not null,
  storage_key text not null unique,
  display_name text not null,
  status text not null check(status in ('pending','ready')),
  created_at timestamptz not null default now(),
  primary key(user_id,id),
  foreign key(user_id,trade_id) references alpha_exchange.journal_trades(user_id,id) on delete cascade
);
create index journal_files_trade_idx on alpha_exchange.journal_files(user_id,trade_id);
create table alpha_exchange.journal_file_cleanup (
  storage_key text primary key,
  user_id text not null,
  created_at timestamptz not null default now()
);

-- Force the limited runtime role through RLS; the browser roles get no grants.
do $$ declare t text; begin
  foreach t in array array['journal_trades','journal_reviews','journal_settings','journal_files','journal_file_cleanup'] loop
    execute format('alter table alpha_exchange.%I enable row level security',t);
    execute format('alter table alpha_exchange.%I force row level security',t);
    execute format('revoke all on alpha_exchange.%I from public, anon, authenticated',t);
    execute format('grant select, insert, update, delete on alpha_exchange.%I to alpha_journal_runtime',t);
    execute format('create policy journal_owner on alpha_exchange.%I for all to alpha_journal_runtime using (user_id = nullif(current_setting(''alpha_journal.user_id'',true),'''')) with check (user_id = nullif(current_setting(''alpha_journal.user_id'',true),''''))',t);
  end loop;
end $$;

-- Queue storage cleanup transactionally, including cascading account deletion.
create function alpha_exchange.journal_queue_file_cleanup() returns trigger
language plpgsql security invoker set search_path = pg_catalog, alpha_exchange as $$
begin
  insert into alpha_exchange.journal_file_cleanup(storage_key,user_id)
  values(old.storage_key,old.user_id) on conflict(storage_key) do nothing;
  return old;
end $$;
revoke all on function alpha_exchange.journal_queue_file_cleanup() from public, anon, authenticated;
grant execute on function alpha_exchange.journal_queue_file_cleanup() to alpha_journal_runtime;
create trigger journal_file_cleanup_after_delete after delete on alpha_exchange.journal_files
for each row execute function alpha_exchange.journal_queue_file_cleanup();

-- No public/signed URLs: images are served by an authenticated, owner-scoped API.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('journal-charts','journal-charts',false,3145728,array['image/webp'])
on conflict(id) do update set public=false, file_size_limit=excluded.file_size_limit,
allowed_mime_types=excluded.allowed_mime_types;
commit;

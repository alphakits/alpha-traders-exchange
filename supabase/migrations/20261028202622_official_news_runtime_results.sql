-- Server-only official News results. No client policies or notification writes.
create table if not exists alpha_exchange.economic_news_official_results (
 id text primary key, payload jsonb not null, checked_at timestamptz not null,
 source_hash text not null, revisions jsonb not null default '[]'::jsonb
);
create table if not exists alpha_exchange.economic_news_official_sync (
 id boolean primary key default true check(id), lease_token text, lease_until timestamptz,
 checked_at timestamptz, diagnostics jsonb not null default '{}'::jsonb
);
alter table alpha_exchange.economic_news_official_results enable row level security;
alter table alpha_exchange.economic_news_official_sync enable row level security;

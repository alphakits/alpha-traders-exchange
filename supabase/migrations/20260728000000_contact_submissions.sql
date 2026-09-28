create table if not exists public.contact_submissions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  subject     text not null,
  message     text not null,
  locale      text not null default 'en',
  ip_hash     text,
  status      text not null default 'new',   -- new | read | replied | spam
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists contact_submissions_created_idx on public.contact_submissions (created_at desc);
create index if not exists contact_submissions_status_idx  on public.contact_submissions (status);

-- Restrict direct client access — only service role can insert/read
alter table public.contact_submissions enable row level security;

-- No public policies: all access is via the service role key in API routes

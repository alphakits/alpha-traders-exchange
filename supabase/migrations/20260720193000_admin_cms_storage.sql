create schema if not exists admin_cms;

create table if not exists admin_cms.lessons (
  id text primary key,
  slug text not null unique,
  course_id text not null,
  category text not null,
  status text not null,
  lesson_order integer not null,
  updated_at timestamptz,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists admin_cms.lesson_versions (
  id text primary key,
  lesson_id text not null,
  action text not null,
  role text not null,
  version_timestamp timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create table if not exists admin_cms.media_items (
  id text primary key,
  type text not null,
  provider text not null,
  name text not null,
  url text not null,
  storage_bucket text,
  storage_key text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  sort_index integer not null,
  payload jsonb not null
);

create index if not exists idx_admin_cms_lessons_course_order on admin_cms.lessons (course_id, lesson_order);
create index if not exists idx_admin_cms_lessons_status on admin_cms.lessons (status);
create index if not exists idx_admin_cms_lesson_versions_lesson_ts on admin_cms.lesson_versions (lesson_id, version_timestamp desc);
create index if not exists idx_admin_cms_media_updated_at on admin_cms.media_items (updated_at desc);
create index if not exists idx_admin_cms_media_storage on admin_cms.media_items (storage_bucket, storage_key);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'admin-media',
  'admin-media',
  true,
  157286400,
  array[
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-matroska',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'application/json',
    'text/csv'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

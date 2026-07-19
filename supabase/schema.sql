create table if not exists users (
  id uuid primary key,
  full_name text,
  role text not null default 'student',
  locale text not null default 'ar',
  created_at timestamptz not null default now()
);

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  level text not null,
  title text not null,
  title_ar text not null,
  summary text not null,
  summary_ar text not null,
  thumbnail_url text,
  created_at timestamptz not null default now()
);

create table if not exists modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  slug text not null,
  title text not null,
  title_ar text not null,
  display_order int not null default 0,
  unique (course_id, slug)
);

create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  module_id uuid references modules(id) on delete set null,
  slug text unique not null,
  title text not null,
  title_ar text not null,
  description text not null,
  description_ar text not null,
  summary text not null default '',
  summary_ar text not null default '',
  objectives jsonb not null default '[]',
  objectives_ar jsonb not null default '[]',
  keywords jsonb not null default '[]',
  keywords_ar jsonb not null default '[]',
  duration_minutes int not null default 0,
  display_order int not null default 0,
  status text not null default 'published',
  created_at timestamptz not null default now()
);

create table if not exists videos (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  storage_path text not null,
  public_url text not null
);

create table if not exists pdfs (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  storage_path text not null,
  public_url text not null
);

create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  question text not null,
  question_ar text not null,
  options jsonb not null,
  options_ar jsonb not null,
  correct_index int not null
);

create table if not exists lesson_resources (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  label text not null,
  label_ar text not null,
  url text not null,
  resource_type text not null default 'link'
);

create table if not exists progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  completed boolean not null default false,
  progress_percent int not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

create table if not exists lesson_progress_events (
  id uuid primary key default gen_random_uuid(),
  learner_key text not null,
  lesson_id text not null,
  course_id text not null,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists lesson_progress_state (
  learner_key text not null,
  lesson_id text not null,
  course_id text not null,
  video_watched boolean not null default false,
  pdf_opened boolean not null default false,
  quiz_completed boolean not null default false,
  lesson_completed boolean not null default false,
  bookmarked boolean not null default false,
  quiz_score int,
  updated_at timestamptz not null default now(),
  primary key (learner_key, lesson_id)
);

create table if not exists bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  lesson_id uuid not null references lessons(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

create table if not exists market_analysis (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  title_ar text not null,
  summary text not null,
  summary_ar text not null,
  body_md text,
  body_md_ar text,
  published_at timestamptz not null default now()
);

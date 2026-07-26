-- MyTutor core schema (Phase 1)
-- Tables: profiles, learning_style_profiles, courses, materials, material_chunks,
--         sessions, session_events, messages, notes, creations, user_connectors
-- Plus: signup trigger, session-counter trigger, updated_at triggers, FTS search
--       function, RLS on everything, private storage buckets with per-user policies.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  grade_level text,
  program text,
  timezone text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- learning_style_profiles
-- ---------------------------------------------------------------------------

create table public.learning_style_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  preferences jsonb not null default '{
    "analogies": true,
    "step_by_step": true,
    "real_world_examples": true,
    "visual": false,
    "socratic": false,
    "pace": "moderate"
  }'::jsonb,
  style_notes text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- courses
-- ---------------------------------------------------------------------------

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  subject text,
  grade_level text,
  instructor text,
  term text,
  curriculum text,
  context_summary text,
  created_at timestamptz not null default now()
);

create index courses_user_idx on public.courses (user_id);

-- ---------------------------------------------------------------------------
-- materials
-- ---------------------------------------------------------------------------

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('pdf', 'docx', 'image', 'video', 'other')),
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'failed')),
  error text,
  summary text,
  topics text[],
  page_count int,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index materials_course_idx on public.materials (course_id);
create index materials_user_idx on public.materials (user_id);

-- ---------------------------------------------------------------------------
-- material_chunks (full-text search over extracted content)
-- ---------------------------------------------------------------------------

create table public.material_chunks (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seq int not null,
  page_start int,
  page_end int,
  content text not null,
  token_estimate int,
  tsv tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  unique (material_id, seq)
);

create index material_chunks_tsv_idx on public.material_chunks using gin (tsv);
create index material_chunks_user_idx on public.material_chunks (user_id);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  subject text,
  mode text not null default 'teaching'
    check (mode in ('teaching', 'answering', 'creation')),
  planned_minutes int,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'completed', 'abandoned')),
  summary text,
  questions_answered int not null default 0,
  hints_given int not null default 0,
  answers_revealed int not null default 0,
  breaks_taken int not null default 0,
  creations_made int not null default 0,
  points_awarded int not null default 0,
  created_at timestamptz not null default now()
);

create index sessions_user_started_idx on public.sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- session_events (source of truth for metrics; trigger maintains rollups)
-- ---------------------------------------------------------------------------

create table public.session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in (
    'hint_given', 'answer_revealed', 'question_answered', 'break_suggested',
    'break_taken', 'note_created', 'creation_saved', 'mode_switched'
  )),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index session_events_session_idx on public.session_events (session_id);
create index session_events_user_type_idx on public.session_events (user_id, type, created_at);

create or replace function public.apply_session_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type in ('question_answered', 'hint_given', 'answer_revealed',
                  'break_taken', 'creation_saved') then
    update public.sessions
    set questions_answered = questions_answered + (new.type = 'question_answered')::int,
        hints_given        = hints_given        + (new.type = 'hint_given')::int,
        answers_revealed   = answers_revealed   + (new.type = 'answer_revealed')::int,
        breaks_taken       = breaks_taken       + (new.type = 'break_taken')::int,
        creations_made     = creations_made     + (new.type = 'creation_saved')::int
    where id = new.session_id;
  end if;
  return new;
end;
$$;

create trigger session_events_apply
  after insert on public.session_events
  for each row execute function public.apply_session_event();

-- ---------------------------------------------------------------------------
-- messages (content = exact Anthropic content-block array, replayed verbatim)
-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seq int not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content jsonb not null,
  display_text text,
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);

-- ---------------------------------------------------------------------------
-- notes (the Obsidian-compatible vault; DB is the source of truth)
-- Vault convention: path = {Course}/{Subject}/{Lessons|Created Materials|Question Summaries}/Title.md
-- ---------------------------------------------------------------------------

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  subject text,
  path text not null,
  title text not null,
  frontmatter jsonb not null default '{}'::jsonb,
  content text not null default '',
  tags text[] not null default '{}',
  links text[] not null default '{}',
  source_session_id uuid references public.sessions (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, path)
);

create index notes_user_course_idx on public.notes (user_id, course_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notes_touch_updated_at
  before update on public.notes
  for each row execute function public.touch_updated_at();

create trigger learning_style_touch_updated_at
  before update on public.learning_style_profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- creations (Creation-mode outputs: practice tests, flashcards, study guides)
-- ---------------------------------------------------------------------------

create table public.creations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete set null,
  subject text,
  kind text not null check (kind in (
    'practice_test', 'flashcards', 'study_guide', 'summary', 'other'
  )),
  title text not null,
  description text,
  content jsonb not null,
  note_path text,
  created_at timestamptz not null default now()
);

create index creations_user_course_idx on public.creations (user_id, course_id);

-- ---------------------------------------------------------------------------
-- user_connectors (MCP connectors: Google Drive, Gmail, Calendar, MyBib, ...)
-- Tokens are server-side only; the app never reads authorization_token.
-- ---------------------------------------------------------------------------

create table public.user_connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  service text not null,
  server_url text not null,
  authorization_token text,
  status text not null default 'connected'
    check (status in ('connected', 'disconnected', 'error')),
  created_at timestamptz not null default now(),
  unique (user_id, service)
);

-- ---------------------------------------------------------------------------
-- signup trigger: create profile + style profile rows for every new user
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  insert into public.learning_style_profiles (user_id)
  values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Full-text search over material chunks (used by the search_materials tool).
-- SECURITY INVOKER (default): RLS on the underlying tables applies.
-- ---------------------------------------------------------------------------

create or replace function public.search_material_chunks(
  p_course_id uuid,
  p_query text,
  p_limit int default 8
)
returns table (
  material_id uuid,
  material_title text,
  seq int,
  page_start int,
  page_end int,
  content text,
  rank real
)
language sql
stable
as $$
  select mc.material_id,
         m.title,
         mc.seq,
         mc.page_start,
         mc.page_end,
         mc.content,
         ts_rank(mc.tsv, websearch_to_tsquery('english', p_query)) as rank
  from public.material_chunks mc
  join public.materials m on m.id = mc.material_id
  where m.course_id = p_course_id
    and mc.tsv @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit least(greatest(p_limit, 1), 20);
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security: every table locked to its owner
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.learning_style_profiles enable row level security;
alter table public.courses enable row level security;
alter table public.materials enable row level security;
alter table public.material_chunks enable row level security;
alter table public.sessions enable row level security;
alter table public.session_events enable row level security;
alter table public.messages enable row level security;
alter table public.notes enable row level security;
alter table public.creations enable row level security;
alter table public.user_connectors enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "own style profile" on public.learning_style_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own courses" on public.courses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own materials" on public.materials
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own material chunks" on public.material_chunks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own sessions" on public.sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own session events" on public.session_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own messages" on public.messages
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own notes" on public.notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own creations" on public.creations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The app may list connector status but tokens are written/read only by
-- edge functions using the service role (which bypasses RLS).
create policy "own connectors read" on public.user_connectors
  for select using (user_id = auth.uid());
create policy "own connectors delete" on public.user_connectors
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage: private buckets, objects keyed {user_id}/...
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('materials', 'materials', false), ('exports', 'exports', false)
on conflict (id) do nothing;

-- Stream material status changes to the app (processing → ready/failed).
alter publication supabase_realtime add table public.materials;

create policy "users manage own objects"
  on storage.objects
  for all
  using (
    bucket_id in ('materials', 'exports')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('materials', 'exports')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

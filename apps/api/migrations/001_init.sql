-- MyTutor schema for plain Postgres (Render or any managed PG).
-- Authorization lives in the API layer: every query is scoped by the
-- authenticated user id from the JWT — there is no RLS here.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- auth + profile
-- ---------------------------------------------------------------------------

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references users (id) on delete cascade,
  display_name text,
  handle text unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  grade_level text,
  program text,
  timezone text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now()
);

create table learning_style_profiles (
  user_id uuid primary key references users (id) on delete cascade,
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
-- courses + materials
-- ---------------------------------------------------------------------------

create table courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null,
  subject text,
  grade_level text,
  instructor text,
  term text,
  curriculum text,
  context_summary text,
  created_at timestamptz not null default now()
);
create index courses_user_idx on courses (user_id);

create table materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,
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
create index materials_course_idx on materials (course_id);
create index materials_user_idx on materials (user_id);

create table material_chunks (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  seq int not null,
  page_start int,
  page_end int,
  content text not null,
  token_estimate int,
  tsv tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  unique (material_id, seq)
);
create index material_chunks_tsv_idx on material_chunks using gin (tsv);
create index material_chunks_user_idx on material_chunks (user_id);

-- ---------------------------------------------------------------------------
-- sessions + event-sourced metrics + messages
-- ---------------------------------------------------------------------------

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  course_id uuid references courses (id) on delete set null,
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
create index sessions_user_started_idx on sessions (user_id, started_at desc);

create table session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  type text not null check (type in (
    'hint_given', 'answer_revealed', 'question_answered', 'break_suggested',
    'break_taken', 'note_created', 'creation_saved', 'mode_switched'
  )),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index session_events_session_idx on session_events (session_id);
create index session_events_user_type_idx on session_events (user_id, type, created_at);

create or replace function apply_session_event()
returns trigger
language plpgsql
as $$
begin
  if new.type in ('question_answered', 'hint_given', 'answer_revealed',
                  'break_taken', 'creation_saved') then
    update sessions
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
  after insert on session_events
  for each row execute function apply_session_event();

create table messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  seq int not null,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content jsonb not null,
  display_text text,
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);

-- ---------------------------------------------------------------------------
-- notes (Obsidian-compatible vault) + creations
-- ---------------------------------------------------------------------------

create table notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  course_id uuid references courses (id) on delete set null,
  subject text,
  path text not null,
  title text not null,
  frontmatter jsonb not null default '{}'::jsonb,
  content text not null default '',
  tags text[] not null default '{}',
  links text[] not null default '{}',
  source_session_id uuid references sessions (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, path)
);
create index notes_user_course_idx on notes (user_id, course_id);

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notes_touch_updated_at
  before update on notes
  for each row execute function touch_updated_at();

create trigger learning_style_touch_updated_at
  before update on learning_style_profiles
  for each row execute function touch_updated_at();

create table creations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,
  session_id uuid references sessions (id) on delete set null,
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
create index creations_user_course_idx on creations (user_id, course_id);

-- ---------------------------------------------------------------------------
-- planner + grades
-- ---------------------------------------------------------------------------

create table assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,
  title text not null,
  description text,
  due_at timestamptz,
  estimated_minutes int,
  complexity text check (complexity in ('low', 'medium', 'high')),
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'done')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index assignments_user_due_idx on assignments (user_id, due_at);

create table grades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  course_id uuid not null references courses (id) on delete cascade,
  assignment_id uuid references assignments (id) on delete set null,
  title text not null,
  score numeric not null,
  max_score numeric not null check (max_score > 0),
  weight numeric,
  feedback text,
  topics text[] not null default '{}',
  graded_at date not null default current_date,
  created_at timestamptz not null default now()
);
create index grades_user_course_idx on grades (user_id, course_id, graded_at desc);

-- ---------------------------------------------------------------------------
-- social + gamification
-- ---------------------------------------------------------------------------

create table friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references users (id) on delete cascade,
  addressee_id uuid not null references users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create table points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  delta int not null,
  reason text not null,
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index points_ledger_user_idx on points_ledger (user_id, created_at desc);

create table tree_items (
  id text primary key,
  name text not null,
  cost int not null check (cost > 0)
);

insert into tree_items (id, name, cost) values
  ('birdhouse', 'Birdhouse', 40),
  ('lanterns', 'Lanterns', 60),
  ('flowers', 'Flower bed', 30),
  ('bench', 'Study bench', 80),
  ('pond', 'Koi pond', 120),
  ('swing', 'Tire swing', 100),
  ('owl', 'Wise owl', 200),
  ('treehouse', 'Treehouse', 300);

create table tree_states (
  user_id uuid primary key references users (id) on delete cascade,
  owned_items text[] not null default '{}',
  equipped_items text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create trigger tree_states_touch_updated_at
  before update on tree_states
  for each row execute function touch_updated_at();

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  token text not null unique,
  platform text,
  created_at timestamptz not null default now()
);

create table user_connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  service text not null,
  server_url text not null,
  authorization_token text,
  status text not null default 'connected'
    check (status in ('connected', 'disconnected', 'error')),
  created_at timestamptz not null default now(),
  unique (user_id, service)
);

-- ---------------------------------------------------------------------------
-- Functions the API calls with an explicit authenticated user id.
-- (No auth.uid() here — the API layer is the trust boundary.)
-- ---------------------------------------------------------------------------

create or replace function search_material_chunks(
  p_user_id uuid,
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
  from material_chunks mc
  join materials m on m.id = mc.material_id
  where m.user_id = p_user_id
    and m.course_id = p_course_id
    and mc.tsv @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit least(greatest(p_limit, 1), 20);
$$;

create or replace function get_daily_study_stats(p_user_id uuid, p_days int default 14)
returns table (
  day date,
  minutes int,
  sessions int,
  questions int,
  correct int,
  hints int
)
language sql
stable
as $$
  with days as (
    select generate_series(
      current_date - (least(greatest(p_days, 1), 90) - 1),
      current_date,
      interval '1 day'
    )::date as day
  ),
  session_stats as (
    select date(s.started_at) as day,
           sum(
             greatest(
               1,
               round(
                 extract(
                   epoch from (coalesce(s.ended_at, now()) - s.started_at)
                 ) / 60
               )::int
             )
           ) as minutes,
           count(*) as sessions
    from sessions s
    where s.user_id = p_user_id
      and s.started_at >= current_date - least(greatest(p_days, 1), 90)
    group by 1
  ),
  event_stats as (
    select date(e.created_at) as day,
           count(*) filter (where e.type = 'question_answered') as questions,
           count(*) filter (
             where e.type = 'question_answered'
               and (e.payload ->> 'correct')::boolean
           ) as correct,
           count(*) filter (where e.type = 'hint_given') as hints
    from session_events e
    where e.user_id = p_user_id
      and e.created_at >= current_date - least(greatest(p_days, 1), 90)
    group by 1
  )
  select d.day,
         coalesce(ss.minutes, 0)::int,
         coalesce(ss.sessions, 0)::int,
         coalesce(es.questions, 0)::int,
         coalesce(es.correct, 0)::int,
         coalesce(es.hints, 0)::int
  from days d
  left join session_stats ss on ss.day = d.day
  left join event_stats es on es.day = d.day
  order by d.day;
$$;

-- KEEP THE FORMULA IN SYNC with packages/shared/src/points.ts.
create or replace function award_session_points(p_user_id uuid, p_session_id uuid)
returns int
language plpgsql
as $$
declare
  s record;
  pts int;
  streak_bonus int := 0;
begin
  select * into s
  from sessions
  where id = p_session_id and user_id = p_user_id
  for update;

  if s is null then
    raise exception 'session not found';
  end if;
  if s.status <> 'completed' or s.points_awarded > 0 or s.ended_at is null then
    return 0;
  end if;

  pts := greatest(
    0,
    least(
      greatest(round(extract(epoch from (s.ended_at - s.started_at)) / 60)::int, 0),
      120
    )
    + 5 * s.questions_answered
    - 2 * s.answers_revealed
    + 3 * s.creations_made
  );

  if not exists (
    select 1 from sessions
    where user_id = p_user_id and status = 'completed'
      and id <> s.id and date(ended_at) = current_date
  ) and exists (
    select 1 from sessions
    where user_id = p_user_id and status = 'completed'
      and date(ended_at) = current_date - 1
  ) then
    streak_bonus := 15;
  end if;

  pts := pts + streak_bonus;
  if pts <= 0 then
    return 0;
  end if;

  insert into points_ledger (user_id, delta, reason, ref_id)
  values (p_user_id, pts, 'session', s.id);

  update sessions set points_awarded = pts where id = s.id;

  insert into tree_states (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  return pts;
end;
$$;

create or replace function purchase_tree_item(p_user_id uuid, p_item_id text)
returns int
language plpgsql
as $$
declare
  item record;
  bal int;
begin
  select * into item from tree_items where id = p_item_id;
  if item is null then
    raise exception 'unknown item';
  end if;

  insert into tree_states (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  perform 1 from tree_states where user_id = p_user_id for update;

  if exists (
    select 1 from tree_states
    where user_id = p_user_id and p_item_id = any (owned_items)
  ) then
    raise exception 'already owned';
  end if;

  select coalesce(sum(delta), 0)::int into bal
  from points_ledger
  where user_id = p_user_id;

  if bal < item.cost then
    raise exception 'not enough points';
  end if;

  insert into points_ledger (user_id, delta, reason)
  values (p_user_id, -item.cost, 'tree_purchase: ' || item.id);

  update tree_states
  set owned_items = array_append(owned_items, p_item_id),
      equipped_items = array_append(equipped_items, p_item_id)
  where user_id = p_user_id;

  return bal - item.cost;
end;
$$;

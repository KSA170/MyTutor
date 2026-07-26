-- MyTutor Phase 2: assignments, grades, study-stats RPC.

-- ---------------------------------------------------------------------------
-- assignments
-- ---------------------------------------------------------------------------

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
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

create index assignments_user_due_idx on public.assignments (user_id, due_at);

-- ---------------------------------------------------------------------------
-- grades
-- ---------------------------------------------------------------------------

create table public.grades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete set null,
  title text not null,
  score numeric not null,
  max_score numeric not null check (max_score > 0),
  weight numeric,
  feedback text,
  topics text[] not null default '{}',
  graded_at date not null default current_date,
  created_at timestamptz not null default now()
);

create index grades_user_course_idx on public.grades (user_id, course_id, graded_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.assignments enable row level security;
alter table public.grades enable row level security;

create policy "own assignments" on public.assignments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own grades" on public.grades
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Daily study stats (SECURITY INVOKER — RLS applies)
-- ---------------------------------------------------------------------------

create or replace function public.get_daily_study_stats(p_days int default 14)
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
    from public.sessions s
    where s.user_id = auth.uid()
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
    from public.session_events e
    where e.user_id = auth.uid()
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

-- ---------------------------------------------------------------------------
-- Weekly recap cron (OPTIONAL — requires pg_cron + pg_net, and your project
-- URL/service key; run this block manually in the SQL editor after deploy):
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--   select cron.schedule(
--     'weekly-recap', '0 18 * * 0',   -- Sundays 18:00 UTC
--     $cron$
--     select net.http_post(
--       url    := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/weekly-recap',
--       headers:= '{"Content-Type":"application/json","Authorization":"Bearer YOUR-SERVICE-ROLE-KEY"}'::jsonb,
--       body   := '{"all_users": true}'::jsonb
--     );
--     $cron$
--   );
--
-- The app can also trigger a recap on demand from the Stats screen.
-- ---------------------------------------------------------------------------

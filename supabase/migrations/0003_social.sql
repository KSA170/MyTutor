-- MyTutor Phase 3: friends, leaderboard, study points, brain tree, push tokens.
--
-- Security model: points_ledger and tree ownership are written ONLY through
-- SECURITY DEFINER functions (no insert/update policies), so clients cannot
-- mint points or items through PostgREST. Friend operations go through
-- definer functions because profiles are RLS'd to their owner.

-- ---------------------------------------------------------------------------
-- profiles.handle — public identity for friend requests
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column handle text unique
  check (handle ~ '^[a-z0-9_]{3,20}$');

-- ---------------------------------------------------------------------------
-- friendships
-- ---------------------------------------------------------------------------

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

alter table public.friendships enable row level security;

create policy "friendships visible to both sides" on public.friendships
  for select using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "unfriend from either side" on public.friendships
  for delete using (requester_id = auth.uid() or addressee_id = auth.uid());

-- ---------------------------------------------------------------------------
-- points_ledger (append-only, definer-written)
-- ---------------------------------------------------------------------------

create table public.points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  delta int not null,
  reason text not null,
  ref_id uuid,
  created_at timestamptz not null default now()
);

create index points_ledger_user_idx on public.points_ledger (user_id, created_at desc);

alter table public.points_ledger enable row level security;

create policy "read own ledger" on public.points_ledger
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- tree catalog + per-user tree state
-- ---------------------------------------------------------------------------

-- Authoritative item prices (mirrored for display in packages/shared/src/points.ts).
create table public.tree_items (
  id text primary key,
  name text not null,
  cost int not null check (cost > 0)
);

insert into public.tree_items (id, name, cost) values
  ('birdhouse', 'Birdhouse', 40),
  ('lanterns', 'Lanterns', 60),
  ('flowers', 'Flower bed', 30),
  ('bench', 'Study bench', 80),
  ('pond', 'Koi pond', 120),
  ('swing', 'Tire swing', 100),
  ('owl', 'Wise owl', 200),
  ('treehouse', 'Treehouse', 300);

alter table public.tree_items enable row level security;
create policy "catalog is public" on public.tree_items for select using (true);

create table public.tree_states (
  user_id uuid primary key references auth.users (id) on delete cascade,
  owned_items text[] not null default '{}',
  equipped_items text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.tree_states enable row level security;

create policy "read own tree" on public.tree_states
  for select using (user_id = auth.uid());

create trigger tree_states_touch_updated_at
  before update on public.tree_states
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- push_tokens (Expo push — sending infra comes later; storage now)
-- ---------------------------------------------------------------------------

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  platform text,
  created_at timestamptz not null default now()
);

alter table public.push_tokens enable row level security;

create policy "own push tokens" on public.push_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- award_session_points — KEEP THE FORMULA IN SYNC with
-- packages/shared/src/points.ts (sessionPoints + streak bonus note).
-- Idempotent: awards once per completed session.
-- ---------------------------------------------------------------------------

create or replace function public.award_session_points(p_session_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  pts int;
  streak_bonus int := 0;
begin
  select * into s
  from public.sessions
  where id = p_session_id and user_id = auth.uid()
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

  -- Streak bonus: first completed session today, with one yesterday too.
  if not exists (
    select 1 from public.sessions
    where user_id = auth.uid() and status = 'completed'
      and id <> s.id and date(ended_at) = current_date
  ) and exists (
    select 1 from public.sessions
    where user_id = auth.uid() and status = 'completed'
      and date(ended_at) = current_date - 1
  ) then
    streak_bonus := 15;
  end if;

  pts := pts + streak_bonus;
  if pts <= 0 then
    return 0;
  end if;

  insert into public.points_ledger (user_id, delta, reason, ref_id)
  values (auth.uid(), pts, 'session', s.id);

  update public.sessions set points_awarded = pts where id = s.id;

  insert into public.tree_states (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  return pts;
end;
$$;

-- ---------------------------------------------------------------------------
-- points_balance / lifetime points helpers
-- ---------------------------------------------------------------------------

create or replace function public.get_points_summary()
returns table (balance int, lifetime int, week int)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(delta), 0)::int as balance,
         coalesce(sum(delta) filter (where delta > 0), 0)::int as lifetime,
         coalesce(
           sum(delta) filter (
             where delta > 0 and created_at >= now() - interval '7 days'
           ),
           0
         )::int as week
  from public.points_ledger
  where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- purchase_tree_item / set_equipped_items
-- ---------------------------------------------------------------------------

create or replace function public.purchase_tree_item(p_item_id text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  bal int;
begin
  select * into item from public.tree_items where id = p_item_id;
  if item is null then
    raise exception 'unknown item';
  end if;

  insert into public.tree_states (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  perform 1 from public.tree_states
  where user_id = auth.uid() for update;

  if exists (
    select 1 from public.tree_states
    where user_id = auth.uid() and p_item_id = any (owned_items)
  ) then
    raise exception 'already owned';
  end if;

  select coalesce(sum(delta), 0)::int into bal
  from public.points_ledger
  where user_id = auth.uid();

  if bal < item.cost then
    raise exception 'not enough points';
  end if;

  insert into public.points_ledger (user_id, delta, reason)
  values (auth.uid(), -item.cost, 'tree_purchase: ' || item.id);

  update public.tree_states
  set owned_items = array_append(owned_items, p_item_id),
      equipped_items = array_append(equipped_items, p_item_id)
  where user_id = auth.uid();

  return bal - item.cost;
end;
$$;

create or replace function public.set_equipped_items(p_items text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tree_states
  set equipped_items = (
    select coalesce(array_agg(i), '{}')
    from unnest(p_items) as i
    where i = any (owned_items)
  )
  where user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Friend operations (definer — profiles are RLS'd to their owner)
-- ---------------------------------------------------------------------------

create or replace function public.request_friend(p_handle text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  fid uuid;
begin
  select id into target from public.profiles where handle = lower(p_handle);
  if target is null then
    raise exception 'no user with that handle';
  end if;
  if target = auth.uid() then
    raise exception 'that is you';
  end if;
  if exists (
    select 1 from public.friendships
    where (requester_id = auth.uid() and addressee_id = target)
       or (requester_id = target and addressee_id = auth.uid())
  ) then
    raise exception 'friendship already exists or is pending';
  end if;

  insert into public.friendships (requester_id, addressee_id)
  values (auth.uid(), target)
  returning id into fid;
  return fid;
end;
$$;

create or replace function public.respond_friend(p_friendship_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_accept then
    update public.friendships
    set status = 'accepted'
    where id = p_friendship_id and addressee_id = auth.uid()
      and status = 'pending';
  else
    delete from public.friendships
    where id = p_friendship_id and addressee_id = auth.uid()
      and status = 'pending';
  end if;
end;
$$;

/** Pending requests addressed to me + my outgoing pending, with display info. */
create or replace function public.get_friend_requests()
returns table (
  friendship_id uuid,
  direction text,
  display_name text,
  handle text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id,
         case when f.addressee_id = auth.uid() then 'incoming' else 'outgoing' end,
         coalesce(p.display_name, 'Student'),
         p.handle,
         f.created_at
  from public.friendships f
  join public.profiles p
    on p.id = case
      when f.addressee_id = auth.uid() then f.requester_id
      else f.addressee_id
    end
  where f.status = 'pending'
    and (f.addressee_id = auth.uid() or f.requester_id = auth.uid())
  order by f.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Leaderboard: accepted friends + self, weekly points/minutes + lifetime
-- ---------------------------------------------------------------------------

create or replace function public.get_leaderboard()
returns table (
  user_id uuid,
  display_name text,
  handle text,
  points_week int,
  minutes_week int,
  points_total int
)
language sql
stable
security definer
set search_path = public
as $$
  with circle as (
    select auth.uid() as uid
    union
    select case
      when requester_id = auth.uid() then addressee_id
      else requester_id
    end
    from public.friendships
    where status = 'accepted'
      and (requester_id = auth.uid() or addressee_id = auth.uid())
  )
  select p.id,
         coalesce(p.display_name, 'Student'),
         p.handle,
         coalesce((
           select sum(delta) filter (where delta > 0)
           from public.points_ledger l
           where l.user_id = p.id
             and l.created_at >= now() - interval '7 days'
         ), 0)::int,
         coalesce((
           select sum(
             round(extract(epoch from (s.ended_at - s.started_at)) / 60)
           )
           from public.sessions s
           where s.user_id = p.id and s.status = 'completed'
             and s.ended_at >= now() - interval '7 days'
         ), 0)::int,
         coalesce((
           select sum(delta) filter (where delta > 0)
           from public.points_ledger l
           where l.user_id = p.id
         ), 0)::int
  from circle c
  join public.profiles p on p.id = c.uid
  order by 4 desc, 6 desc;
$$;

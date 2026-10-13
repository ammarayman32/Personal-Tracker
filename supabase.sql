-- QuestLog schema. Paste into Supabase > SQL Editor > New query > Run.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  description text not null default '',
  category text not null check (category in ('Main Quest','Daily Quest','College','Personal')),
  date date not null,
  xp int not null default 10 check (xp between 0 and 1000),
  done boolean not null default false,
  xp_awarded int not null default 0,   -- XP actually earned; total XP = sum of this column
  completed_on date,
  position double precision not null default 0,
  created_at timestamptz not null default now()
);
create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position double precision not null default 0,
  created_at timestamptz not null default now()
);
create table public.habit_log (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  date date not null,
  primary key (habit_id, date)
);
create table public.quran_log (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  pages int not null default 0 check (pages between 0 and 20),
  done boolean not null default false,
  primary key (user_id, date)
);

-- Row Level Security: each signed-in user can only touch their own rows.
alter table public.tasks enable row level security;
create policy "own rows" on public.tasks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.habits enable row level security;
create policy "own rows" on public.habits for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.habit_log enable row level security;
create policy "own rows" on public.habit_log for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.quran_log enable row level security;
create policy "own rows" on public.quran_log for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create index on public.tasks (user_id, date);

-- RTU Todo v3 schema
-- Можно запускать поверх предыдущей версии.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  task_date date not null,
  done boolean not null default false,
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_id text not null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default '',
  description text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, external_id)
);

create table if not exists public.study_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_id text not null,
  course_id text not null default '',
  course_name text not null default '',
  title text not null,
  task_url text not null default '',
  due_at timestamptz not null,
  component text not null default '',
  event_type text not null default '',
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, external_id)
);

create index if not exists tasks_user_date_idx on public.tasks(user_id, task_date);
create index if not exists calendar_events_user_start_idx on public.calendar_events(user_id, starts_at);
create index if not exists study_tasks_user_due_idx on public.study_tasks(user_id, due_at);

alter table public.tasks enable row level security;
alter table public.calendar_events enable row level security;
alter table public.study_tasks enable row level security;

revoke all on table public.tasks from anon, authenticated;
revoke all on table public.calendar_events from anon, authenticated;
revoke all on table public.study_tasks from anon, authenticated;

grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update, delete on table public.calendar_events to authenticated;
grant select, insert, update, delete on table public.study_tasks to authenticated;

drop policy if exists "tasks_select_own" on public.tasks;
drop policy if exists "tasks_insert_own" on public.tasks;
drop policy if exists "tasks_update_own" on public.tasks;
drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_select_own" on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy "tasks_insert_own" on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "tasks_update_own" on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tasks_delete_own" on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "events_select_own" on public.calendar_events;
drop policy if exists "events_insert_own" on public.calendar_events;
drop policy if exists "events_update_own" on public.calendar_events;
drop policy if exists "events_delete_own" on public.calendar_events;
create policy "events_select_own" on public.calendar_events for select to authenticated using ((select auth.uid()) = user_id);
create policy "events_insert_own" on public.calendar_events for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "events_update_own" on public.calendar_events for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "events_delete_own" on public.calendar_events for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "study_tasks_select_own" on public.study_tasks;
drop policy if exists "study_tasks_insert_own" on public.study_tasks;
drop policy if exists "study_tasks_update_own" on public.study_tasks;
drop policy if exists "study_tasks_delete_own" on public.study_tasks;
create policy "study_tasks_select_own" on public.study_tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy "study_tasks_insert_own" on public.study_tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "study_tasks_update_own" on public.study_tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "study_tasks_delete_own" on public.study_tasks for delete to authenticated using ((select auth.uid()) = user_id);

-- Optional task time; existing tasks keep their dates and have no time.
alter table public.tasks add column if not exists task_time time;

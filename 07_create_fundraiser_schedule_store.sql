
-- v0.10.0 fundraiser schedule store
create table if not exists public.pledge_fundraiser_schedules (
  id text primary key,
  title text not null,
  start_date date not null,
  end_date date not null,
  day_start_hour integer not null default 6,
  day_end_hour integer not null default 24,
  schedule_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pledge_fundraiser_schedules_start_date
  on public.pledge_fundraiser_schedules (start_date, end_date);

alter table public.pledge_fundraiser_schedules enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pledge_fundraiser_schedules'
      and policyname = 'pledge_fundraiser_schedules_anon_all'
  ) then
    create policy pledge_fundraiser_schedules_anon_all
      on public.pledge_fundraiser_schedules
      for all
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end $$;

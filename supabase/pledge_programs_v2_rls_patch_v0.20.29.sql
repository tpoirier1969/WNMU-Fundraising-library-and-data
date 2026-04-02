-- WNMU Pledge Program Library v0.20.29
-- Fix add-program inserts blocked by RLS on public.pledge_programs_v2

alter table if exists public.pledge_programs_v2 enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pledge_programs_v2'
      and policyname = 'pledge_programs_v2_public_read'
  ) then
    create policy pledge_programs_v2_public_read
      on public.pledge_programs_v2
      for select
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pledge_programs_v2'
      and policyname = 'pledge_programs_v2_authenticated_insert'
  ) then
    create policy pledge_programs_v2_authenticated_insert
      on public.pledge_programs_v2
      for insert
      to authenticated
      with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pledge_programs_v2'
      and policyname = 'pledge_programs_v2_authenticated_update'
  ) then
    create policy pledge_programs_v2_authenticated_update
      on public.pledge_programs_v2
      for update
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

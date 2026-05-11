-- WNMU Pledge Program Library v0.21.43
-- Allow signed-in admin users to save timing rows in pledge_program_timings_v2.
-- This fixes: new row violates row-level security policy for table "pledge_program_timings_v2"
-- Run this in Supabase SQL Editor.

begin;

-- The browser app reads timing rows for viewers and writes timing rows only after sign-in.
grant usage on schema public to anon, authenticated;
grant select on public.pledge_program_timings_v2 to anon, authenticated;
grant insert, update, delete on public.pledge_program_timings_v2 to authenticated;

-- If the timing table uses a serial/bigserial identity sequence, authenticated users need this too.
grant usage, select on all sequences in schema public to authenticated;

alter table public.pledge_program_timings_v2 enable row level security;

drop policy if exists pledge_program_timings_v2_read_all on public.pledge_program_timings_v2;
create policy pledge_program_timings_v2_read_all
  on public.pledge_program_timings_v2
  for select
  to anon, authenticated
  using (true);

drop policy if exists pledge_program_timings_v2_authenticated_insert on public.pledge_program_timings_v2;
create policy pledge_program_timings_v2_authenticated_insert
  on public.pledge_program_timings_v2
  for insert
  to authenticated
  with check (true);

drop policy if exists pledge_program_timings_v2_authenticated_update on public.pledge_program_timings_v2;
create policy pledge_program_timings_v2_authenticated_update
  on public.pledge_program_timings_v2
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists pledge_program_timings_v2_authenticated_delete on public.pledge_program_timings_v2;
create policy pledge_program_timings_v2_authenticated_delete
  on public.pledge_program_timings_v2
  for delete
  to authenticated
  using (true);

commit;

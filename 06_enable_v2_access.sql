-- Pledge Library v2 access patch for v0.8.1
-- Run this after the v2 migration if the app loads no data.

begin;

-- Make sure the app roles can see the public schema objects.
grant usage on schema public to anon, authenticated;

-- Expose the summary view to both viewers and signed-in users.
grant select on public.pledge_program_library_summary_v2 to anon, authenticated;

-- Base table + detail tables are used directly by the app.
grant select on public.pledge_programs_v2 to anon, authenticated;
grant select on public.pledge_program_timings_v2 to anon, authenticated;
grant select on public.pledge_program_drive_results_v2 to anon, authenticated;
grant select on public.pledge_program_airings_v2 to anon, authenticated;

-- Admin edit mode writes back to the core program table when signed in.
grant update on public.pledge_programs_v2 to authenticated;

-- Enable RLS explicitly and add simple app-facing policies.
alter table public.pledge_programs_v2 enable row level security;
alter table public.pledge_program_timings_v2 enable row level security;
alter table public.pledge_program_drive_results_v2 enable row level security;
alter table public.pledge_program_airings_v2 enable row level security;

drop policy if exists pledge_programs_v2_read_all on public.pledge_programs_v2;
create policy pledge_programs_v2_read_all on public.pledge_programs_v2
  for select to anon, authenticated
  using (true);

drop policy if exists pledge_programs_v2_update_authenticated on public.pledge_programs_v2;
create policy pledge_programs_v2_update_authenticated on public.pledge_programs_v2
  for update to authenticated
  using (true)
  with check (true);

drop policy if exists pledge_program_timings_v2_read_all on public.pledge_program_timings_v2;
create policy pledge_program_timings_v2_read_all on public.pledge_program_timings_v2
  for select to anon, authenticated
  using (true);

drop policy if exists pledge_program_drive_results_v2_read_all on public.pledge_program_drive_results_v2;
create policy pledge_program_drive_results_v2_read_all on public.pledge_program_drive_results_v2
  for select to anon, authenticated
  using (true);

drop policy if exists pledge_program_airings_v2_read_all on public.pledge_program_airings_v2;
create policy pledge_program_airings_v2_read_all on public.pledge_program_airings_v2
  for select to anon, authenticated
  using (true);

commit;


-- v0.8.1 note: the app can fall back to pledge_programs_v2 for the main list if the
-- summary view is unavailable, but granting the view is still recommended so the richer
-- summary data remains available when the view is healthy.

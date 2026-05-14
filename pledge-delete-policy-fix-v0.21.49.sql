-- Focused fix for Pledge Program Library admin deletes.
-- Run only if the app says: found row before delete, but Supabase returned/deleted 0 rows.
-- This targets the Pledge app base table used by the current app: public.pledge_programs_v2.

begin;

grant select, delete on table public.pledge_programs_v2 to authenticated;

alter table public.pledge_programs_v2 enable row level security;

drop policy if exists "pledge_programs_v2 authenticated can delete" on public.pledge_programs_v2;
create policy "pledge_programs_v2 authenticated can delete"
on public.pledge_programs_v2
for delete
to authenticated
using (true);

commit;

-- Optional verification:
-- select has_table_privilege('authenticated', 'public.pledge_programs_v2', 'DELETE') as authenticated_can_delete;
-- select * from pg_policies where schemaname = 'public' and tablename = 'pledge_programs_v2' order by cmd, policyname;

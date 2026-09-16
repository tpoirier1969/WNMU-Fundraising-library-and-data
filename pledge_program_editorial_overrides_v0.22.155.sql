create table if not exists public.pledge_program_editorial_overrides (
  program_id bigint primary key references public.pledge_programs_v2(id) on delete cascade,
  rating text not null check (rating in ('high','medium','low')),
  note text,
  rated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_email text
);

alter table public.pledge_program_editorial_overrides enable row level security;

grant select on public.pledge_program_editorial_overrides to anon, authenticated;
grant insert, update, delete on public.pledge_program_editorial_overrides to authenticated;

drop policy if exists pledge_program_editorial_overrides_read_all on public.pledge_program_editorial_overrides;
create policy pledge_program_editorial_overrides_read_all
  on public.pledge_program_editorial_overrides
  for select
  to anon, authenticated
  using (true);

drop policy if exists pledge_program_editorial_overrides_authenticated_insert on public.pledge_program_editorial_overrides;
create policy pledge_program_editorial_overrides_authenticated_insert
  on public.pledge_program_editorial_overrides
  for insert
  to authenticated
  with check (true);

drop policy if exists pledge_program_editorial_overrides_authenticated_update on public.pledge_program_editorial_overrides;
create policy pledge_program_editorial_overrides_authenticated_update
  on public.pledge_program_editorial_overrides
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists pledge_program_editorial_overrides_authenticated_delete on public.pledge_program_editorial_overrides;
create policy pledge_program_editorial_overrides_authenticated_delete
  on public.pledge_program_editorial_overrides
  for delete
  to authenticated
  using (true);

-- v0.21.44 timing insert fix
-- Fixes: null value in column "source_row_number" of relation "pledge_program_timings_v2" violates not-null constraint
-- Safe to run more than once.

begin;

create sequence if not exists public.pledge_program_timings_v2_source_row_number_seq
  as integer
  increment by -1
  minvalue -2147483647
  maxvalue -1
  start with -1
  cache 1;

do $$
declare
  next_negative integer;
begin
  select coalesce(least(-1, min(source_row_number) - 1), -1)
    into next_negative
    from public.pledge_program_timings_v2
   where source_row_number is not null;

  perform setval('public.pledge_program_timings_v2_source_row_number_seq', next_negative, false);
exception when undefined_column then
  raise notice 'source_row_number column not found on public.pledge_program_timings_v2';
end $$;

alter table public.pledge_program_timings_v2
  alter column source_row_number set default nextval('public.pledge_program_timings_v2_source_row_number_seq');

update public.pledge_program_timings_v2
   set source_row_number = nextval('public.pledge_program_timings_v2_source_row_number_seq')
 where source_row_number is null;

commit;

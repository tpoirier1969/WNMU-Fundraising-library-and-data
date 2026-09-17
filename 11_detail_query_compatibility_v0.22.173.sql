-- v0.22.173 Program Library detail-query compatibility
--
-- The browser detail loader historically accepts both segment_number/slot_number
-- and expects drive_order on the fundraiser rollup view. The live schema had only
-- slot_number and no drive_order, so every detail batch paid for failed REST
-- requests before falling back. Keep the compatibility fields explicit so fresh
-- installs match production and do not generate avoidable PostgREST 400s.

begin;

alter table public.pledge_program_timings_v2
  add column if not exists segment_number integer;

update public.pledge_program_timings_v2
set segment_number = slot_number
where segment_number is null
  and slot_number is not null;

create or replace function public.sync_pledge_timing_segment_slot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.segment_number is null then new.segment_number := new.slot_number; end if;
    if new.slot_number is null then new.slot_number := new.segment_number; end if;
    if new.segment_number is distinct from new.slot_number then new.slot_number := new.segment_number; end if;
  else
    if new.segment_number is distinct from old.segment_number
       and new.slot_number is not distinct from old.slot_number then
      new.slot_number := new.segment_number;
    elsif new.slot_number is distinct from old.slot_number
       and new.segment_number is not distinct from old.segment_number then
      new.segment_number := new.slot_number;
    elsif new.segment_number is null then
      new.segment_number := new.slot_number;
    elsif new.slot_number is null then
      new.slot_number := new.segment_number;
    elsif new.segment_number is distinct from new.slot_number then
      new.slot_number := new.segment_number;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pledge_program_timings_v2_sync_segment_slot
  on public.pledge_program_timings_v2;

create trigger pledge_program_timings_v2_sync_segment_slot
before insert or update of segment_number, slot_number
on public.pledge_program_timings_v2
for each row
execute function public.sync_pledge_timing_segment_slot();

create or replace view public.pledge_program_drive_rollups_v2 as
with normalized as (
  select
    coalesce(nullif(a.nola_code, ''), '__missing_nola__') as nola_code_key,
    nullif(a.nola_code, '') as nola_code,
    coalesce(nullif(trim(a.pledge_program_id), ''), nullif(trim(a.program_id::text), '')) as program_id,
    coalesce(nullif(a.title, ''), nullif(a.program_title, ''), nullif(a.matched_library_title, ''), nullif(a.imported_program_title, '')) as title,
    coalesce(nullif(a.fundraiser_label, ''), nullif(a.source_file_name, ''), a.import_batch_id, 'Imported pledge batch') as fundraiser_label,
    a.drive_start_date,
    a.drive_end_date,
    coalesce(a.dollars, 0::numeric)::numeric(12,2) as dollars,
    coalesce(a.pledge_count, 0) as pledge_count,
    coalesce(a.sustainer_count, 0) as sustainer_count,
    coalesce(a.program_minutes, 0) as program_minutes,
    a.air_date,
    a.aired_at
  from public.pledge_program_airings_v2 a
), aggregated as (
  select
    gen_random_uuid() as id,
    normalized.program_id,
    normalized.program_id as pledge_program_id,
    normalized.title,
    normalized.title as program_title,
    normalized.nola_code,
    normalized.fundraiser_label,
    normalized.drive_start_date,
    normalized.drive_end_date,
    min(normalized.air_date) as drive_date,
    min(normalized.aired_at) as aired_at,
    sum(normalized.dollars)::numeric(12,2) as contribution_total,
    sum(normalized.pledge_count)::integer as pledge_count,
    sum(normalized.sustainer_count)::integer as sustainer_count,
    count(*)::integer as airing_count,
    sum(normalized.program_minutes)::integer as total_program_minutes
  from normalized
  group by
    normalized.program_id,
    normalized.title,
    normalized.nola_code,
    normalized.fundraiser_label,
    normalized.drive_start_date,
    normalized.drive_end_date
)
select
  id,
  program_id,
  pledge_program_id,
  title,
  program_title,
  nola_code,
  fundraiser_label,
  drive_start_date,
  drive_end_date,
  drive_date,
  aired_at,
  contribution_total,
  pledge_count,
  sustainer_count,
  airing_count,
  total_program_minutes,
  row_number() over (
    partition by program_id
    order by coalesce(drive_start_date, drive_date, aired_at::date), fundraiser_label
  )::integer as drive_order
from aggregated;

commit;

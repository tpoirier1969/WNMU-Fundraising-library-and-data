-- v0.22.231
-- Add an explicit Drama Doc cycle override to the pledge program library.
-- null = infer automatically; current = current series/season; older = older cycle.

alter table public.pledge_programs_v2
  add column if not exists drama_cycle_status text null;

alter table public.pledge_programs_v2
  drop constraint if exists pledge_programs_v2_drama_cycle_status_check;

alter table public.pledge_programs_v2
  add constraint pledge_programs_v2_drama_cycle_status_check
  check (drama_cycle_status is null or drama_cycle_status in ('current','older'));

comment on column public.pledge_programs_v2.drama_cycle_status is
  'Optional explicit Drama Doc cycle override. current = repeat allowed while series/season is current; older = do not recommend repeat; null = infer from series/season and rights metadata.';

create or replace view public.pledge_program_library_summary_v2
with (security_invoker = true)
as
with airing_rollups as (
  select
    a.nola_code,
    sum(coalesce(a.dollars,0::numeric))::numeric(12,2) as total_contributions,
    count(*)::integer as total_airings,
    count(distinct coalesce(
      nullif(btrim(a.fundraiser_label),''),
      nullif(btrim(a.import_batch_id),''),
      nullif(btrim(a.source_file_name),''),
      '__single_batch__'
    ))::integer as fundraiser_count,
    max(a.aired_at) as last_aired_at
  from public.pledge_program_airings_v2 a
  where nullif(btrim(a.nola_code),'') is not null
  group by a.nola_code
)
select
  p.id,
  p.source_row_number,
  p.title,
  p.program_notes,
  p.length_bucket_minutes,
  p.nola_code,
  p.topic_primary,
  p.topic_secondary,
  p.aired_flag,
  p.rights_start,
  p.rights_end,
  p.rights_notes,
  p.package_type,
  p.source_format,
  p.distributor,
  p.premium_summary,
  p.actual_runtime_seconds,
  p.legacy_break_count_raw,
  p.legacy_has_local_cutins_raw,
  p.created_at,
  p.updated_at,
  coalesce(ar.total_contributions,0::numeric)::numeric(12,2) as total_contributions,
  case
    when coalesce(ar.fundraiser_count,0) > 0
      then round(coalesce(ar.total_contributions,0::numeric) / ar.fundraiser_count::numeric, 2)
    else null::numeric
  end as avg_contribution_per_drive,
  coalesce(ar.total_airings,0) as total_airings,
  coalesce(ar.fundraiser_count,0) as fundraiser_count,
  ar.last_aired_at,
  p.drama_cycle_status
from public.pledge_programs_v2 p
left join airing_rollups ar
  on lower(btrim(p.nola_code)) = lower(btrim(ar.nola_code));

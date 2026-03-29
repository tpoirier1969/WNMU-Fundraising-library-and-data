-- WNMU Pledge Program Library v0.14.0
-- Revision: NOLA-first imports, no duplicate money storage.
-- Safe to run more than once.

create extension if not exists pgcrypto;

create table if not exists public.pledge_program_airings_v2 (
  id uuid primary key default gen_random_uuid()
);

alter table public.pledge_program_airings_v2
  add column if not exists program_id text,
  add column if not exists pledge_program_id text,
  add column if not exists title text,
  add column if not exists program_title text,
  add column if not exists imported_program_title text,
  add column if not exists matched_library_title text,
  add column if not exists nola_code text,
  add column if not exists station text,
  add column if not exists aired_at timestamptz,
  add column if not exists air_date date,
  add column if not exists air_time text,
  add column if not exists dollars numeric(12,2),
  add column if not exists pledge_count integer,
  add column if not exists program_minutes integer,
  add column if not exists sustainer_count integer,
  add column if not exists fundraiser_label text,
  add column if not exists drive_start_date date,
  add column if not exists drive_end_date date,
  add column if not exists match_method text,
  add column if not exists title_mismatch_flag boolean default false,
  add column if not exists source_file_name text,
  add column if not exists source_report_type text,
  add column if not exists source_delimiter text,
  add column if not exists import_batch_id text,
  add column if not exists imported_by_email text,
  add column if not exists row_hash text,
  add column if not exists raw_payload jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists pledge_program_airings_v2_row_hash_idx
  on public.pledge_program_airings_v2 (row_hash);

create index if not exists pledge_program_airings_v2_nola_idx
  on public.pledge_program_airings_v2 (nola_code);

create index if not exists pledge_program_airings_v2_air_date_idx
  on public.pledge_program_airings_v2 (air_date desc);

create index if not exists pledge_program_airings_v2_drive_window_idx
  on public.pledge_program_airings_v2 (drive_start_date, drive_end_date);

alter table public.pledge_program_airings_v2 enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pledge_program_airings_v2'
      and policyname = 'airings_public_read'
  ) then
    create policy airings_public_read
      on public.pledge_program_airings_v2
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pledge_program_airings_v2'
      and policyname = 'airings_authenticated_write'
  ) then
    create policy airings_authenticated_write
      on public.pledge_program_airings_v2
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

create or replace view public.pledge_program_drive_rollups_v2 as
with normalized as (
  select
    coalesce(nullif(a.nola_code, ''), '__missing_nola__') as nola_code_key,
    nullif(a.nola_code, '') as nola_code,
    coalesce(nullif(a.pledge_program_id, ''), nullif(a.program_id, '')) as program_id,
    coalesce(nullif(a.title, ''), nullif(a.program_title, ''), nullif(a.matched_library_title, ''), nullif(a.imported_program_title, '')) as title,
    coalesce(nullif(a.fundraiser_label, ''), nullif(a.source_file_name, ''), a.import_batch_id, 'Imported pledge batch') as fundraiser_label,
    a.drive_start_date,
    a.drive_end_date,
    coalesce(a.dollars, 0)::numeric(12,2) as dollars,
    coalesce(a.pledge_count, 0) as pledge_count,
    coalesce(a.sustainer_count, 0) as sustainer_count,
    coalesce(a.program_minutes, 0) as program_minutes,
    a.air_date,
    a.aired_at
  from public.pledge_program_airings_v2 a
)
select
  gen_random_uuid() as id,
  program_id,
  program_id as pledge_program_id,
  title,
  title as program_title,
  nola_code,
  fundraiser_label,
  drive_start_date,
  drive_end_date,
  min(air_date) as drive_date,
  min(aired_at) as aired_at,
  sum(dollars)::numeric(12,2) as contribution_total,
  sum(pledge_count)::integer as pledge_count,
  sum(sustainer_count)::integer as sustainer_count,
  count(*)::integer as airing_count,
  sum(program_minutes)::integer as total_program_minutes
from normalized
group by program_id, title, nola_code, fundraiser_label, drive_start_date, drive_end_date;

create or replace view public.pledge_program_library_summary_v2 as
with airing_rollups as (
  select
    nola_code,
    sum(coalesce(dollars, 0))::numeric(12,2) as total_contributions,
    count(*)::integer as total_airings,
    count(distinct coalesce(nullif(fundraiser_label, ''), import_batch_id, source_file_name, '__single_batch__'))::integer as fundraiser_count,
    max(aired_at) as last_aired_at
  from public.pledge_program_airings_v2
  where nullif(nola_code, '') is not null
  group by nola_code
)
select
  p.*,
  ar.total_contributions,
  case
    when coalesce(ar.fundraiser_count, 0) > 0 then round(ar.total_contributions / ar.fundraiser_count, 2)
    else null
  end as avg_contribution_per_drive,
  ar.total_airings,
  ar.fundraiser_count,
  ar.last_aired_at
from public.pledge_programs_v2 p
left join airing_rollups ar
  on lower(trim(p.nola_code)) = lower(trim(ar.nola_code));

comment on view public.pledge_program_drive_rollups_v2 is
  'Derived fundraiser/program rollups from pledge_program_airings_v2. Do not write summary money here separately.';

comment on view public.pledge_program_library_summary_v2 is
  'Library summary augmented with totals derived from imported airings rows by NOLA.';

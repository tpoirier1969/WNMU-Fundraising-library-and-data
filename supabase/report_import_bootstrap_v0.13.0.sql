-- WNMU Pledge Program Library v0.13.0
-- Starter bootstrap for report imports.
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
  add column if not exists nola_code text,
  add column if not exists aired_at timestamptz,
  add column if not exists air_date date,
  add column if not exists air_time text,
  add column if not exists local_break_count integer,
  add column if not exists live_break_flag boolean,
  add column if not exists premium_summary text,
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

create index if not exists pledge_program_airings_v2_aired_at_idx
  on public.pledge_program_airings_v2 (aired_at desc);

create index if not exists pledge_program_airings_v2_nola_idx
  on public.pledge_program_airings_v2 (nola_code);

create table if not exists public.pledge_program_drive_results_v2 (
  id uuid primary key default gen_random_uuid()
);

alter table public.pledge_program_drive_results_v2
  add column if not exists program_id text,
  add column if not exists pledge_program_id text,
  add column if not exists title text,
  add column if not exists program_title text,
  add column if not exists nola_code text,
  add column if not exists drive_date date,
  add column if not exists aired_at timestamptz,
  add column if not exists contribution_total numeric(12,2),
  add column if not exists local_break_count integer,
  add column if not exists live_break_flag boolean,
  add column if not exists premium_summary text,
  add column if not exists source_file_name text,
  add column if not exists source_report_type text,
  add column if not exists source_delimiter text,
  add column if not exists import_batch_id text,
  add column if not exists imported_by_email text,
  add column if not exists row_hash text,
  add column if not exists raw_payload jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists pledge_program_drive_results_v2_row_hash_idx
  on public.pledge_program_drive_results_v2 (row_hash);

create index if not exists pledge_program_drive_results_v2_drive_date_idx
  on public.pledge_program_drive_results_v2 (drive_date desc);

create index if not exists pledge_program_drive_results_v2_nola_idx
  on public.pledge_program_drive_results_v2 (nola_code);

alter table public.pledge_program_airings_v2 enable row level security;
alter table public.pledge_program_drive_results_v2 enable row level security;

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

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pledge_program_drive_results_v2'
      and policyname = 'drive_results_public_read'
  ) then
    create policy drive_results_public_read
      on public.pledge_program_drive_results_v2
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pledge_program_drive_results_v2'
      and policyname = 'drive_results_authenticated_write'
  ) then
    create policy drive_results_authenticated_write
      on public.pledge_program_drive_results_v2
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

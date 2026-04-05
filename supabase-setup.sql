-- Fishing Logbook shared database starter
-- Run this in your Supabase SQL Editor.

create table if not exists public.fishing_catch_logs (
  id text primary key,
  app_id text not null default 'fishing_logbook_shared',
  owner_name text,
  owner_is_anonymous boolean not null default false,
  angler_key text,
  water_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  log_date date not null,
  time_of_day text not null,
  water_name text not null,
  waypoint_name text,
  bait_type text not null,
  bait_subtype text,
  bait_name text not null,
  main_color text,
  additional_color text,
  bait_size text,
  species text not null,
  size_inches numeric,
  weight text,
  quantity integer,
  air_temp numeric,
  water_temp numeric,
  water_depth_ft numeric,
  wind text,
  wind_direction text,
  sky_condition text,
  water_condition text,
  water_clarity text,
  surface_condition text,
  current_speed text,
  depth_zone text,
  retrieve_speed text,
  presentation_style text,
  presentation_depth_ft numeric,
  structure_type text,
  bottom_type text,
  hatches text,
  notes text,
  location_source text,
  marker_accuracy numeric,
  marker_lat double precision,
  marker_lng double precision,
  share_to_cloud boolean not null default true,
  share_location_level text not null default 'Water Type Only',
  share_angler_name boolean not null default true,
  share_bait_details boolean not null default true,
  share_size_details boolean not null default true,
  share_notes boolean not null default true,
  county_name text,
  state_name text
);

alter table public.fishing_catch_logs alter column size_inches drop not null;
alter table public.fishing_catch_logs alter column quantity drop not null;
alter table public.fishing_catch_logs alter column marker_lat drop not null;
alter table public.fishing_catch_logs alter column marker_lng drop not null;
alter table public.fishing_catch_logs add column if not exists share_to_cloud boolean not null default true;
alter table public.fishing_catch_logs add column if not exists share_location_level text not null default 'Exact Spot';
alter table public.fishing_catch_logs add column if not exists share_bait_details boolean not null default true;
alter table public.fishing_catch_logs add column if not exists share_size_details boolean not null default true;
alter table public.fishing_catch_logs add column if not exists share_notes boolean not null default true;
alter table public.fishing_catch_logs add column if not exists county_name text;
alter table public.fishing_catch_logs add column if not exists state_name text;

create index if not exists fishing_catch_logs_app_id_created_at_idx on public.fishing_catch_logs (app_id, created_at desc);

alter table public.fishing_catch_logs enable row level security;

drop policy if exists fishing_catch_logs_public_read on public.fishing_catch_logs;
create policy fishing_catch_logs_public_read
  on public.fishing_catch_logs
  for select
  using (true);

drop policy if exists fishing_catch_logs_public_insert on public.fishing_catch_logs;
create policy fishing_catch_logs_public_insert
  on public.fishing_catch_logs
  for insert
  with check (true);

drop policy if exists fishing_catch_logs_public_update on public.fishing_catch_logs;
create policy fishing_catch_logs_public_update
  on public.fishing_catch_logs
  for update
  using (true)
  with check (true);

drop policy if exists fishing_catch_logs_public_delete on public.fishing_catch_logs;
create policy fishing_catch_logs_public_delete
  on public.fishing_catch_logs
  for delete
  using (true);

create or replace function public.fishing_set_catch_logs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fishing_catch_logs_set_updated_at on public.fishing_catch_logs;
create trigger fishing_catch_logs_set_updated_at
before update on public.fishing_catch_logs
for each row
execute function public.fishing_set_catch_logs_updated_at();

alter table public.fishing_catch_logs add column if not exists owner_is_anonymous boolean not null default false;
alter table public.fishing_catch_logs add column if not exists angler_key text;
alter table public.fishing_catch_logs add column if not exists water_type text;
alter table public.fishing_catch_logs add column if not exists share_angler_name boolean not null default true;

alter table public.fishing_catch_logs add column if not exists exact_marker_lat double precision;
alter table public.fishing_catch_logs add column if not exists exact_marker_lng double precision;

alter table public.fishing_catch_logs add column if not exists water_depth_ft numeric;
alter table public.fishing_catch_logs add column if not exists wind text;
alter table public.fishing_catch_logs add column if not exists wind_direction text;

alter table public.fishing_catch_logs add column if not exists surface_condition text;
alter table public.fishing_catch_logs add column if not exists current_speed text;

alter table public.fishing_catch_logs add column if not exists presentation_depth_ft numeric;
alter table public.fishing_catch_logs add column if not exists bottom_type text;

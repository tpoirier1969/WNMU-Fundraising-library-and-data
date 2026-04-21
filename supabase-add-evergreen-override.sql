-- Add evergreen override support for the WNMU Program Library.
-- Run this once in the Supabase SQL editor.

alter table if exists public.programs
add column if not exists can_be_used_as_evergreen boolean not null default false;

comment on column public.programs.can_be_used_as_evergreen is
'Allows a program to appear in the Evergreens quick filter even when package_type is not HDEVER.';

-- If your programs_enriched view does not expose this new column, either refresh or recreate that view.
-- This app reads the override directly from public.programs, so the checkbox will still work after the table column exists.

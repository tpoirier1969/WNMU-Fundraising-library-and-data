-- v0.21.45 timing slot_number backfill / repair
-- Run in Supabase SQL Editor. Safe to run more than once.

begin;

-- First, keep segment_number and slot_number in sync where one already exists.
update public.pledge_program_timings_v2
set slot_number = segment_number
where slot_number is null
  and segment_number is not null;

update public.pledge_program_timings_v2
set segment_number = slot_number
where segment_number is null
  and slot_number is not null;

-- For any remaining rows where both are null, assign a stable per-program sequence.
with numbered as (
  select
    id,
    row_number() over (
      partition by coalesce(program_id::text, pledge_program_id::text, 'no-program')
      order by coalesce(source_row_number, 2147483647), coalesce(id, 2147483647)
    ) as seq
  from public.pledge_program_timings_v2
  where slot_number is null
     or segment_number is null
)
update public.pledge_program_timings_v2 t
set
  slot_number = coalesce(t.slot_number, numbered.seq),
  segment_number = coalesce(t.segment_number, numbered.seq)
from numbered
where t.id = numbered.id;

commit;

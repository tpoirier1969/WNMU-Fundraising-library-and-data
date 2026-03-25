# Notes for v0.6.6

- App rewired to the v2 pledge schema.
- Program details now use `program_notes`, `rights_start`, and `rights_end` from `pledge_programs_v2`.
- Timing rows come from `pledge_program_timings_v2`.
- Edit saves write back to `pledge_programs_v2`.


- Added `06_enable_v2_access.sql` to unlock the v2 tables/view for the app roles and allow authenticated edits on `pledge_programs_v2`.

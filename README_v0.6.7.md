# WNMU Pledge Program Library v0.6.7

This revision rewires the Pledge Program Library to the new v2 schema so the app reads from the rebuilt data model instead of the old truncated structure.

## What changed in v0.6.7

- Reads from the v2 summary/data tables:
  - `pledge_program_library_summary_v2`
  - `pledge_programs_v2`
  - `pledge_program_timings_v2`
  - `pledge_program_drive_results_v2`
  - `pledge_program_airings_v2`
- Rights Begin and Rights End now come from the real v2 columns:
  - `rights_start`
  - `rights_end`
- Description now comes from:
  - `program_notes`
- Detailed timing now comes from the rebuilt timing table and shows:
  - program segment
  - pledge break
  - local cut-in
- Edit mode in the detail window writes back to `pledge_programs_v2`
- If `ADMIN_EMAILS` is empty, a signed-in user is treated as admin so editing can still work
- Default library state remains Active only
- Program list still sorts Topic first, then Title

## Notes

- This build assumes the v2 migration pack has already been run successfully.
- If timing or drive-result data is missing for a title, the detail window will still show the main program record instead of opening blank.


## Required v2 access patch
If the library shows no data after the v2 migration, run `06_enable_v2_access.sql` in Supabase SQL Editor to grant read access to the new v2 tables/view and update access to `pledge_programs_v2` for authenticated users.

- Version labels, asset cache-busters, and packaged filenames are now aligned to the same release number.
- The library no longer depends on the summary view exposing `is_active`; Active/Archived filtering now falls back to client-side logic using `rights_end` when needed.
- Status messaging now reports whether rows actually loaded from `pledge_program_library_summary_v2`, so a silent "Waiting on data…" state is less likely to hide the real problem.
- Interface spacing was tightened to fit more titles on screen without cramping the table.

# WNMU Pledge Program Library v0.14.0

This build adds a larger scheduler/performance pass while keeping the existing library and detail workflows intact.


## Added in v0.14.0

- New **Report Imports** workspace for CSV/TSV pledge-report intake.
- Auto-detection for airings vs drive-result style reports.
- Normalized preview tables before import.
- Export of normalized airings and drive-result CSVs.
- Optional Supabase import path for `pledge_program_airings_v2` and `pledge_program_drive_results_v2`.
- Bootstrap SQL script in `supabase/report_import_bootstrap_v0.14.0.sql`.

# Notes for v0.13.0

- Scheduler rights windows now appear directly in the slot picker.
- Topic browse is available in the scheduling popup.
- Scheduling edits are admin-only; viewing remains open.
- Performance now exposes a visible analysis frame with date/month/topic criteria and normalized event comparisons.


- Added a new Report Imports workspace with CSV/TSV parsing, target detection, preview tables, and export/import actions.
- Added Supabase table probing plus starter import writes into `pledge_program_airings_v2` and `pledge_program_drive_results_v2`.
- Added bootstrap SQL so those report tables can exist before the first import batch.

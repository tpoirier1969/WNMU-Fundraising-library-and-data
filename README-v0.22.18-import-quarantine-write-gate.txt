WNMU Pledge Program Library v0.22.18

Purpose:
Fixes direct import so quarantined/unmatched report rows are not written to pledge_program_airings_v2.

Changed:
- Direct Supabase import now writes only matched/library-linked rows and rows explicitly recognized as non-specific pledge revenue.
- Unmatched/quarantined rows remain in the import review UI and are held out of Supabase until linked or explicitly marked non-specific.
- Scheduler creation from the current import batch now uses only matched/importable rows.
- Import preview/status text now says how many rows are importable and how many are quarantined.

Why:
v0.22.17 still passed all parsed rows to App.data.importNormalizedRows(). That meant rows left in quarantine could be written to pledge_program_airings_v2 as unlinked imported airings. Day-total/report-total rows from legacy reports should not be imported as program airings.

Install:
Copy the changed files over the current app, preserving folder paths.

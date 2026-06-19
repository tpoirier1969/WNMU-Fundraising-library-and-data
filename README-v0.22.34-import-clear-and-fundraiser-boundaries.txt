WNMU Pledge Program Library v0.22.34

Changed files patch.

Changes:
- Restores post-import/reimport clear-batch prompt after a successful Supabase write/update.
  The browser confirmation defaults to OK/Enter for clearing the current batch.
- Restores visible Importing state on Import / reimport buttons while Supabase import is running.
- Imported fundraiser grouping now splits at calendar-year boundaries.
- Auto-created imported fundraiser schedules are not allowed to span calendar years.
- Imported schedule duplicate merging now refuses to merge imported schedules across calendar years.
- Suspicious imported fundraiser clusters spanning more than 45 days are not silently auto-created as calendar schedules; those rows remain imported for analytics but need manual schedule review.

Not changed:
- No Supabase schema changes.
- No report parser/money calculation changes.
- No manual schedule/fundraiser title rewrites.

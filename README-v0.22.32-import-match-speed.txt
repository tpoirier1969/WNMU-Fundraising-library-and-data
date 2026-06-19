WNMU Pledge Program Library v0.22.32

Purpose:
- Speed up Rows Needing Match Approval interactions in the Import Pledge Report workflow.

Changed:
- Manual match dropdown changes no longer force a full import-page rerender.
- "Remember this match" checkbox changes no longer force a full import-page rerender.
- Library title dropdown option lists are cached instead of rebuilt and resorted from the full program library for every visible review row.
- Applying one manual match now performs a lightweight immediate refresh, then defers the heavier full import refresh until the browser is idle.
- Apply All now batches its manual-match updates and refreshes the interface once instead of once per title group.

Not changed:
- No Supabase schema changes.
- No schedule/fundraiser repair changes.
- No import parser or money accounting logic changes.

WNMU Pledge Program Library v0.22.31

Changed-files patch.

Includes the earlier v0.22.31 fixes:
- Moved Rows needing match approval directly under the pledge-report file drop/import card.
- Made import-report sections collapsible by default.
- Fixed malformed Advanced / fallback tools disclosure markup.
- Improved import matching order so exact normalized title matches happen before the broad-title guard.
- Added reusable title-level remembered import matches so changing report/NOLA numbers do not force the same title correction every time.
- Added cleaned-title matching for report-only numeric suffixes.
- Changed Add/Edit Program Primary Topic and Secondary Topic to dropdowns.
- Filters Secondary Topic choices by selected Primary Topic.
- Allows adding new Primary Topic / Secondary Topic values from the Add/Edit Program form.
- Closes the Add Program popup after a successful new-program save.

Additional v0.22.31 import layout pass:
- Reordered Import Pledge Report sections:
  1. Start importing pledge reports
  2. Rows needing match approval
  3. Quarantined / unlinked imported rows
  4. Excluded suspect rows
  5. Parsed airings preview
  6. Money accounting ledger
  7. Batch file audit
- Merged Import summary and Table readiness into the Start importing pledge reports card as compact notes instead of separate large cards.
- Fixed the top import layout so Import type and Import / reimport buttons no longer overlap.
- Import / reimport buttons now switch to an “Importing…” working state with a visible spinner/color change while the Supabase write is running.
- After a successful import/reimport, the app asks whether to clear the current batch. The Yes / clear option is first and auto-focused, so Enter accepts it.

Fundraiser grouping audit note:
- No fundraiser/schedule grouping behavior was changed in this patch.
- The current code clusters imported pledge activity with a 14-day gap threshold and will not attach a Jan. 3–4 off-cycle block to March or the previous December unless the dates overlap or are within that threshold.
- I did find that the existing imported-schedule duplicate merge logic is still overlap-based for auto-imported schedules. It is guarded against manual/user-authored schedule content, but it is still broader than a pure exact-range-only merge. I left it unchanged because schedule repair/merge behavior is risky and should be tightened only as a deliberate separate change.

Validation performed:
- node --check passed for all assets/js/*.js files.
- pledge-performance-lab.html inline scripts were extracted and passed node --check.
- ZIP integrity was tested.
- config.js is not included.

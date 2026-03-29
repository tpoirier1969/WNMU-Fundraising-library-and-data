# WNMU Pledge Program Library v0.16.0

## Included in this revision
- Scheduler right-click menu now supports copy, paste, delete, and open details/edit
- Scheduler calendar now lightly shades Saturdays and Sundays
- Calendar block text reduced so titles fit better
- Schedule grid header/day column alignment tightened with explicit column widths
- Sticky time column strengthened so event blocks stop covering time labels as easily
- Scheduler search results now show length more clearly
- Day export now includes a second line for local cutins:
  - count and lengths when present
  - `Local cutins: none` when timing rows exist but no local cutins do
  - `Local cutins: no break timings yet` when break timing rows are absent
- Non-pledge markers can optionally come from the WNMU Program Library when `Not pledge program` is checked
  - rendered light green in the calendar
  - excluded from the pledge detail list below the calendar
- Live break / special local break checkbox replaces the old freeform note behavior
  - flagged entries render red in the calendar
- Version strings and cache-buster references updated to v0.16.0

## Notes
- No SQL migration is included in this build
- Non-pledge lookup depends on a readable Program Library view/table. Configure `NON_PLEDGE_SOURCE_CANDIDATES` in `config.js` if needed.

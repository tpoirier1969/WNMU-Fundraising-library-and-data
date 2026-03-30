WNMU Pledge Program Library v0.20.6

Fixes in this build:
- Reduced scheduling page freeze risk when opening or rebuilding larger pledge schedules by indexing rendered schedule placements instead of scanning every placement for every visible cell.
- Throttled scheduled-program detail loading so break-detail fetches load in a small queue and rerender in batches instead of stampeding the page.
- Renaming a fundraiser now avoids a full schedule-grid redraw unless the date range or visible schedule window actually changed.

Focus: scheduler responsiveness when renaming a fundraiser and when creating/opening imported pledge schedules.

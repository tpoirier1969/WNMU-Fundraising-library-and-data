WNMU Pledge Program Library v0.22.28

What changed
- Removed the visible Advanced rebuild options button from Pledge Scheduling.
- Kept the advanced rebuild behavior inside Schedule Repair Options as the Optional Cleanup / Rebuild imported placements checkbox.
- Added a separate Fundraiser Graph button where Advanced rebuild options used to be.
- Fundraiser Graph opens a one-fundraiser modal for the currently selected fundraiser with dollars-by-day or pledges-by-day views and daily/program summary tables.
- Fixed the Never aired library filter so rows with all-air-date history are treated as aired.
- Never aired now also excludes programs already placed on a schedule, so future scheduled-but-not-yet-aired programs do not stay in the candidate list.

Files to replace
- index.html
- pledge-performance-lab.html
- version.json
- assets/styles.css
- assets/js/core.js
- assets/js/dom.js
- assets/js/app.js
- assets/js/data.js
- assets/js/program-filters.js
- assets/js/ui-list.js
- assets/js/ui-scheduling.js
- assets/js/ui-detail.js

Notes
- Drive Comparison remains unchanged and separate.
- Schedule Repair Options is still the only schedule repair entry point.
- No SQL/schema changes.

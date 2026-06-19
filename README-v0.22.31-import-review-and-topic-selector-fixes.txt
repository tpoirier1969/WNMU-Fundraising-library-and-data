WNMU Pledge Program Library v0.22.31

Changed files patch.

What changed:
- Moved Rows needing match approval directly under the report file drop/import card.
- Converted the Import Pledge Report review/diagnostic sections into collapsed disclosure cards by default.
- Fixed the malformed Advanced / fallback tools disclosure markup in the import panel.
- Improved import title matching so exact normalized titles are checked before the broad-title fuzzy-match guard.
- Saved remembered import matches as title-level rules as well as exact title/NOLA rules, so the same imported title can auto-match across future reports with different numeric NOLA/report codes.
- Added cleaned-title matching for report-only suffix/code noise.
- Changed Add/Edit Program Primary Topic and Secondary Topic fields from free-text-only inputs to dropdowns based on existing library topics.
- Secondary Topic options now filter against the selected Primary Topic.
- Added Add new primary topic / Add new secondary topic options when a new topic is needed.
- Add Program now closes the detail popup after a successful create instead of reopening the newly-created program detail.

No scheduling repair, fundraiser graph, or performance analytics logic was intentionally changed.

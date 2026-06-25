v0.22.44 — Program Detail pledge-period graph aggregation

Changed:
- Updated the Program Detail "Income over time" graph so exact imported airing history is aggregated before charting.
- The chart now produces one actual-dollar point per pledge period/fundraiser instead of one point per individual broadcast.
- When saved fundraiser schedules are loaded, airing rows are mapped to the matching schedule by direct schedule/fundraiser id or by air-date containment inside the schedule window.
- When no saved schedule match is available, rows are grouped by fundraiser/drive labels and date ranges where possible, with off-cycle rows kept separate by date.
- Tooltip details now show period label/date range, period total dollars, pledge total, number of airings used, average per airing, and summed topic-expected period total when available.
- Topic-expected comparison values are now summed across the airings in the pledge period instead of comparing a fundraiser total to one single-airing expectation.
- Updated visible app/version labels to v0.22.44.

Files changed:
- assets/js/ui-detail.js
- assets/js/core.js
- index.html
- pledge-performance-lab.html
- version.json

No database/schema changes.

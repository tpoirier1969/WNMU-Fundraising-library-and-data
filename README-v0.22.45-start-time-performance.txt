WNMU Pledge Program Library v0.22.45
Start Time Performance analytics

Changed files patch.

What changed:
- Adds Start Time Performance to the in-app Pledge Performance page.
- Makes the default Pledge Performance view compare 30-minute start-time buckets using Median dollars / airing.
- Adds Median dollars / airing as a selectable metric.
- Replaces the old month selector with a March / June / August / December fundraiser-season selector.
- Uses saved fundraiser schedule labels/date windows when available so drives that start a day or two in the previous month still land in the right pledge season.
- Removes the Broadcast Rights filter from the analytics controls because it is irrelevant for this scheduling question.
- Keeps Main topic and Secondary topic filters.
- Adds a Daypart filter to the in-app analytics controls for questions like afternoon programming at 1:00 vs 3:00.
- Adds a Start Time Performance question to pledge-performance-lab.html, with median default and table columns for median, average, total dollars, pledges, broadcasts, and season mix.

Notes:
- Start times are grouped in exact 30-minute buckets. 9:30 stays 9:30. It is not rounded down to 9:00.
- No database changes are included.
- This is display/analytics logic only.

Verification performed:
- node --check passed for all assets/js/*.js.
- Inline script syntax check passed for pledge-performance-lab.html.
- ZIP integrity should be tested after packaging.
- config.js is intentionally not included in the changed-files ZIP.

Not verified:
- No live browser/Supabase test was performed in this environment.

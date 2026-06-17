WNMU Pledge Program Library v0.22.27

What changed
- Library list column renamed from Last Aired to Air Dates.
- Library rows now try to show all imported air dates for each pledge title by grouping history from pledge_program_airings_v2.
- New library filter: Airing history, with choices for All airing history, Never aired, and Aired at least once.
- Sort label updated to Air Dates, while date sorting still follows the most recent airing.
- Detail income-over-time graph cleaned up: larger canvas, more bottom margin, vertical x-axis labels, and point labels pushed farther away from the line for readability.

Files to replace
- index.html
- pledge-performance-lab.html
- assets/js/core.js
- assets/js/dom.js
- assets/js/app.js
- assets/js/data.js
- assets/js/ui-list.js
- assets/js/ui-detail.js
- assets/styles.css
- version.json

Notes
- Air-date history depends on readable rows in pledge_program_airings_v2. If a title has never been imported into that table, the list falls back to the previous single-date behavior.
- The Never aired filter uses the same logic as the scheduler: no stored air date, no positive airing/fundraiser count, and no revenue history.

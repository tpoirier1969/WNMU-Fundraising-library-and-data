# v0.22.49 — Version Flag / Schedule Row Highlight Repair

This patch repackages the v0.22.47 placeholder work and v0.22.48 schedule row highlight as a cumulative repair.

Why:
- Tod reported that v0.22.48 opened and then dropped back to v0.22.47.
- That symptom indicates mixed installed files: index.html may have been updated, while one or more nested assets such as assets/js/core.js, assets/js/ui-scheduling.js, or assets/styles.css remained on the older version.
- When an older core.js loads after the page shell, it can reset the visible version flag back to the older build.
- If ui-scheduling.js or styles.css did not update, the row-highlight feature would not appear.

Included:
- index.html
- pledge-performance-lab.html
- version.json
- assets/styles.css
- assets/js/core.js
- assets/js/dom.js
- assets/js/ui-detail.js
- assets/js/ui-performance.js
- assets/js/ui-imports.js
- assets/js/ui-scheduling.js

Behavior preserved / included:
- Program Detail fundraiser-period income chart aggregation from v0.22.44.
- Start Time Performance analytics work and fixes from v0.22.45/v0.22.46.
- Schedule placeholders from v0.22.47.
- Click-left-time-label schedule row highlighting from v0.22.48.

No database changes.
No config.js.

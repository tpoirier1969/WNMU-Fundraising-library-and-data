WNMU Pledge Program Library v0.22.30
Secondary topic performance filters and comparisons

Changed files in this patch:
- index.html
- pledge-performance-lab.html
- version.json
- assets/styles.css
- assets/js/core.js
- assets/js/dom.js
- assets/js/ui-performance.js

What changed:
1. Main app: Pledge Performance
   - Added a Secondary topic filter in Advanced filters and chart controls.
   - Added Secondary topic as a Compare by option.
   - Added a Secondary topic winners quick filter.
   - Secondary topic filter options narrow to the selected Main topic when one is selected.
   - Secondary-topic comparisons exclude rows that do not have a secondary topic.

2. Pledge Performance Analytics page
   - Added a Secondary topic dropdown beside the Primary topic filter.
   - Added a new question card: What secondary topics work best?
   - Selecting Primary topic = Music and leaving Secondary topic = All compares Music subtopics against one another.
   - The Secondary topic dropdown narrows to the selected primary topic(s).

3. Layout/versioning
   - Bumped app and analytics page to v0.22.30.
   - Widened the Pledge Performance advanced filter grid to hold the added Secondary topic control on wide screens.

No database schema changes are included.
No config.js is included.

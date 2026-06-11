WNMU Pledge Program Library v0.22.01
Performance Analytics logic audit pass

Changes made after auditing the current quick-filter logic:

1. Fundraiser schedule dedupe for analytics
- Performance Analytics now deduplicates pledge_fundraiser_schedules rows by identical start/end date before building Season Overview, Live Break, and saved-schedule analytics.
- It uses the same preference idea as Pledge Scheduling: keep the row with manual money fields / curated schedule data / non-imported title ahead of auto-imported duplicate rows.
- The load status now reports raw schedules, active schedules, and duplicate date-range rows ignored.

2. Safer library matching
- Imported pledge airings no longer use broad NOLA matches blindly.
- If a NOLA code maps to more than one library row, Analytics only accepts the NOLA match when the title also matches. Otherwise it falls through to exact normalized title.
- This protects broad series codes like NOVA/GPER from incorrectly pulling the wrong title/topic.

3. Season Overview source of truth clarified
- With no content filters active, Season Overview uses saved fundraiser totals: broadcast + Online + Mail.
- With content filters active, it switches to content-level airing rows because Online and Mail cannot be attributed to specific programs/topics.

4. Live Break guardrail kept
- Live Break comparison remains saved-scheduling-placement only.
- The live-break filter is disabled for that view so the comparison cannot filter out its own live rows.

No real config.js is included.

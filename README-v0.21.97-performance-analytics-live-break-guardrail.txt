WNMU Pledge Program Library v0.21.97

Built from v0.21.96.

Changes:
- Fixed Performance Analytics live-break results so they use saved Scheduling placements only.
- Removed imported-airing live-break columns from the analytics page query.
- Added robust schedule-placement-to-pledge-airing dollar matching by source hash, date/program, date/NOLA, date/title, and start time.
- Added a live-break guardrail: if saved live-break placements exist but cannot be matched to pledge dollars, the page shows a warning instead of silently reporting an imported fallback result.
- Kept legacy schedule JSON field support inside the single placementLive() helper only.

Install:
- Upload/replace these files on the site.
- Keep your deployed config.js in place; it is not included.

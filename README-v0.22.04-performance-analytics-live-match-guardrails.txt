WNMU Pledge Program Library v0.22.04

Performance Analytics live-break matched comparison guardrails.

Changes:
- Matched 1:1 comparison no longer uses the same source airing or same calendar night as a non-live comparison.
- Matching now requires a stronger title/secondary-topic similarity instead of accepting broad topic-only performer mismatches.
- Matched $ heading renamed to Matched non-live $.
- Unmatched live airings are shown instead of hidden.
- Reused imported-airing dollar matches are guarded so one imported row is not silently counted under both live and non-live schedule placements.

Install:
- Upload/replace all files from this package.
- Keep your deployed config.js in place. This package does not include config.js.

WNMU Pledge Program Library v0.22.10

Purpose:
- Fix live-break classification regression from v0.22.09.
- Keep Scheduling LIVE badges visible when saved live notes/flags exist.
- Keep 1:1 live comparison apples-to-apples by comparing saved live placements to saved non-live placements only.

Changes:
- Saved live-break truth now treats any true saved live-break field or saved live-break notes as LIVE.
- Stale false alias fields no longer suppress live-break notes/badges.
- 1:1 live vs non-live comparison no longer pulls import-only historical non-live rows into the headline comparison.
- The comparison text now states it uses saved scheduled airings only.

Install:
- Upload all files over the current deployment.
- Keep your existing config.js; this ZIP does not include it.

WNMU Pledge Program Library v0.22.25

Changes:
- Replaced the dangerous one-click imported schedule rebuild behavior with Schedule Repair Options.
- Schedule Repair Options previews imported schedule repairs before changing anything.
- Repairs are checkbox-controlled: merge duplicate imported fundraisers, create missing schedules, refresh placements/totals, rebuild imported placements, or rename imported schedules.
- Existing imported schedule titles are preserved unless Rename imported schedules is explicitly checked.
- Added detail-editor safeguards for stale modal/program state.
- Program detail loads now clear the previous panel immediately and fetch fresh detail data.
- The editor now tracks unsaved changes and asks before discarding them by opening another program or cancelling.
- Saves now fail loudly if no database row was actually updated, instead of pretending success.
- Saves block if the detail form and selected program ID get out of sync.

Install:
Copy the files in this changed-files ZIP over the existing app, preserving folders.
Do not copy a real config.js from any build package.

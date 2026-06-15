WNMU Pledge Program Library v0.22.24

Fixes imported fundraiser grouping so source spreadsheet tabs/files do not create separate fundraiser calendars when the actual airing dates are part of the same pledge period.

Changed behavior:
- Imported pledge schedules are grouped by actual airing-date continuity rather than source filename.
- Duplicate auto-imported fundraiser calendars with overlapping date ranges are merged when building from imported reports.
- Auto cleanup only removes duplicate imported-only calendars; calendars with manual/user-authored content are protected.
- Imported placements now store the unified fundraiser cluster key.

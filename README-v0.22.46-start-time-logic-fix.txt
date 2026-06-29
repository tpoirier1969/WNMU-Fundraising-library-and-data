WNMU Pledge Program Library v0.22.46
Start Time Performance logic fix

Changes:
- Corrects Start Time Performance time parsing in the main app analytics.
- Corrects Start Time Performance time parsing in pledge-performance-lab.html.
- Excludes Non-Specific Pledges from standalone lab Start Time Performance because those rows are not programs with meaningful start times.
- Reads raw_payload for the standalone lab when available, with fallback when the column is not present.
- Recovers Excel fractional time cells from raw_payload when an imported row was stored as 00:00:00 / midnight by older import logic.
- Uses saved schedule placement start time as a conservative correction when an imported airing appears to be a 12-hour AM/PM artifact and exactly one saved schedule placement matches the same date/program.
- Fixes future import parsing of Excel fractional time cells so new report imports should not turn real times into 00:00:00.

Notes:
- This does not mutate existing Supabase rows.
- Existing rows that were imported with bad air_time values can only be corrected in analytics when raw_payload or a saved schedule placement gives enough evidence.
- If an old row has only a bad stored air_time and no raw_payload/schedule evidence, the app will not guess.

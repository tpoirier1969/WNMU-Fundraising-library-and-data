WNMU Pledge Program Library v0.21.86

Built from Tod-provided v0.21.82 package plus the v0.21.83 Performance Lab changes, then updated with Performance Lab fixes.

Install notes:
- Upload the contents of this ZIP over the existing app files.
- Do not replace your live config.js. This ZIP intentionally does not include config.js.
- Hard refresh after upload so the v0.21.86 cache-busters load.

Included Performance Lab fixes:
- Added “Which titles need topics?” uncategorized-title audit.
- Long-pause comeback threshold changed to 2+ years and the table shows all matching rows.
- Old-favorite fading now shows first fundraiser total and latest fundraiser total.
- Added small trend sparklines and a click-to-open full trend graph.
- Added M/J/A/D season mix badges such as [M-3, J-1, A-0, D-5].
- Disabled season/year filters on views that intentionally use full history.
- Live Breaks now loads saved fundraiser schedules and uses schedule live-break flags before imported row flags.

Additional v0.21.86 fix:
- Removed nonexistent pledge_program_airings_v2.live_break_count from the Performance Lab Supabase select.
- Performance Lab now requests valid imported live-break columns only: live_break_flag and local_break_count.

Additional v0.21.86 fix:
- Removed nonexistent program_id from pledge_programs_v2 / library summary select lists in the Performance Lab.
- The lab now treats pledge_programs_v2.id as the library key and only uses program_id on imported airing rows where that column actually exists.

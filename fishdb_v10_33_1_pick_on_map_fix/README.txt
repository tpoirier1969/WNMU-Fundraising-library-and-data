Fishing Logbook v10.33.1

What changed
- colors now load alphabetically in the log form and filter sheet
- Lure Name is now optional; lure type still drives the record when the lure has no obvious brand/model name
- whitefish now appears as Whitefish (Lake Whitefish) and sorts with the W species
- body-of-water lookup suggestions now appear in the Body of Water field itself via inline suggestions instead of a second chooser field
- added per-log sharing controls for cloud sync
- cloud sync can now share exact spot, body of water only, county only, or hide location entirely
- size/quantity, bait details, and notes can each be withheld from the shared cloud copy
- county/state are looked up when saving so county-only sharing has something useful to publish
- shared cloud rows can now omit coordinates when the user does not want to expose a spot

Important Supabase note
- rerun supabase-setup.sql in Supabase for this build
- this update adds privacy columns and drops NOT NULL on marker_lat / marker_lng / size_inches / quantity so hidden/coarse shared entries can sync cleanly

Shared database setup
1. Create a Supabase project.
2. In Supabase, open SQL Editor and run supabase-setup.sql.
3. In Project Settings > API, copy your project URL and publishable key (or legacy anon key).
4. Open supabase-config.js and paste those two values.
5. Upload the site.
6. Tap Cloud Sync once to push local logs and pull shared logs.

Notes
- logs still save locally first, so poor signal or offline use does not kill the app
- private-only logs stay on the device and are not pushed to the shared cloud table
- shared logs downloaded from cloud may intentionally omit exact coordinates depending on the sharing choices made when they were saved
- this starter still uses open RLS policies so every app user can read and write shared logs


Hotfix
- preserves local marker coordinates when cloud-shared rows omit exact coordinates for privacy
- fixes map pins disappearing after cloud sync on the device that created the log


v10.21 notes:
- Shared cloud logs now sync an approximate display point for map rendering on other devices.
- The exact spot stays on the device that logged it when available.
- Added fishing-icon.svg for favicon / app icon styling.


Patch notes for v10.33.1
- Reworked Pick on Map to bind directly to the Leaflet map container instead of relying on a transparent overlay layer.
- Added a direct DOM fallback for tap/click capture on the live map container.
- Added extra map invalidate calls after closing the Add Log sheet so the map is ready to accept the pick immediately.

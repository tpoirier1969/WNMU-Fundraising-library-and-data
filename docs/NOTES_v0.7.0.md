# Notes for v0.7.0

## Architecture split

The old monolithic `assets/app.js` was replaced with smaller files so one fix is less likely to destabilize unrelated behavior:

- `core.js` — config, constants, shared state, formatting helpers, derived-field logic
- `dom.js` — element lookup and lightweight DOM helpers
- `data.js` — Supabase client setup, source probing, row loading, detail reads, updates
- `ui-list.js` — list rendering, client-side search/filter logic, filter options
- `auth.js` — session handling, admin role logic, sign-in UI behavior
- `ui-detail.js` — detail modal rendering, edit form, save flow
- `app.js` — app boot, event wiring, refresh orchestration

## Behavior changes

- Visible build version comes from the shipped code, not from `config.js`.
- A config-version mismatch is displayed so stale config files do not mislead you.
- Startup probes both the v2 summary view and the v2 base table.
- The list can render from the base table if the summary view is unavailable.
- Search/filter logic is now client-side after load, reducing schema-fragile queries.

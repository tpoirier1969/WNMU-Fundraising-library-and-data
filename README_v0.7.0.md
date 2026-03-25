# WNMU Pledge Program Library v0.7.0

This revision stops treating the summary view as a fragile single point of failure.

## What changed in v0.7.0

- The front end was split into isolated files:
  - `assets/js/core.js`
  - `assets/js/dom.js`
  - `assets/js/data.js`
  - `assets/js/ui-list.js`
  - `assets/js/auth.js`
  - `assets/js/ui-detail.js`
  - `assets/js/app.js`
- Library loading now probes both:
  - `pledge_program_library_summary_v2`
  - `pledge_programs_v2`
- If the summary view is unreadable, empty, missing columns, or otherwise not usable, the app falls back to the base table instead of hanging on “Waiting on data…”
- List filtering and search now run client-side after load, which avoids brittle server-side queries against optional columns.
- Build/version labels are hardwired to the shipped build and no longer trust `config.js` for the visible version.
- If `config.js` still reports an old version, the app shows that mismatch in the header so stale config does not masquerade as a stale build.
- Interface spacing was tightened again for a denser list view.

## Data-source behavior

The app now prefers the summary view when it is readable and populated. If that fails, it automatically falls back to the base table.

This means the library can still open even if:

- the summary view grant is missing
- the summary view is empty while the base table has rows
- the summary view shape is not exactly what the app hoped for

## Required SQL patch

Run `06_enable_v2_access.sql` if you have not already granted app-facing read access to the v2 objects.

## Packaging notes

- `config.js` is intentionally **not** included.
- The build version in this package is `v0.7.0`.

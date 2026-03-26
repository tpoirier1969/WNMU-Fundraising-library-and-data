# WNMU Pledge Program Library v0.8.1

This revision extends the working library and adds a scaffold for the rest of the pledge-database project.

## What changed in v0.8.1

- Added a **workspace shell** so the project has clean homes for:
  - `Library`
  - `Versions & Timing`
  - `Performance`
  - `Import Tools`
  - `Reports`
  - `Admin`
- Kept only the **Library** workspace live. The others are intentionally scaffold-only for now, with buttons and placeholder launch points.
- Strengthened library supplementation logic so summary rows can reconcile against the base table by:
  - program id
  - NOLA
  - normalized title
- Added a lightweight metadata audit so the app can report how many rows still lack Topic or Distributor values after supplementation.
- Preserved the modular file split and added another isolated UI module:
  - `assets/js/ui-workspace.js`

## Data-source behavior

The app still prefers the summary view when available, but it now has a broader match strategy when it supplements from the base table. That reduces silent misses when the summary view and base table do not use the same key shape.

## Packaging notes

- `config.js` is intentionally **not** included.
- The build version in this package is `v0.8.1`.
- If your live `config.js` still says `v0.4.0`, the app will continue to warn about that mismatch.


Note: Workspace scaffold was narrowed to Library, Scheduling, and Performance in v0.8.1. Timing/break detail stays with the program record instead of living in a separate workspace.

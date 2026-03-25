# WNMU Pledge Program Library v0.5.0

This revision shifts program details out of the fixed side panel and into a popup window so it behaves more like the regular Program Library.

## What changed in v0.5.0

- Program detail now opens in a centered popup/modal instead of a static side panel.
- Detail opens from the title area so you are not constantly tripping the window by clicking random cells.
- Added the WNMU-TV/PBS logo to the header and favicon.
- Kept the library list, Supabase reads, and read-only admin placeholders intact.

## What it still does

- Connects to your existing Supabase project
- Reads from `pledge_program_library_summary`
- Loads detail from:
  - `pledge_programs`
  - `pledge_program_versions`
  - `pledge_program_segments`
  - `pledge_premiums`
- Defaults to **active titles** only
- Lets you include archived titles from the same view
- Shows a visible version flag in the header and footer

## What it still does not do yet

- Add/edit/archive records
- Create fundraisers
- Schedule programs
- Export the rundown document
- Import revenue reports from the UI

## Files to publish

Upload the **contents** of this folder to your GitHub Pages repo root:

- `index.html`
- `config.js`
- `assets/`
- `docs/`

Do **not** upload the enclosing folder as a subfolder unless your GitHub Pages site is set up for that path.

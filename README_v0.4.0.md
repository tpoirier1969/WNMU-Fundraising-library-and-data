# WNMU Pledge Program Library v0.4.0

This is the first live data-facing library page for the pledge project.

## What it does

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
- Uses a WNMU-style maroon / gold / cream visual treatment instead of generic dark-app filler

## What it does not do yet

- Add/edit/archive records
- Create fundraisers
- Schedule programs
- Export the rundown document
- Import revenue reports from the UI

This build is for validating the imported library data with a real front end before moving on.

## Files to publish

Upload the **contents** of this folder to your GitHub Pages repo root:

- `index.html`
- `config.js`
- `assets/`
- `docs/`

Do **not** upload the enclosing folder as a subfolder unless your GitHub Pages site is set up for that path.

## Config

Edit `config.js` and put in your real values:

```js
window.PLEDGE_MANAGER_CONFIG = {
  APP_NAME: 'WNMU Pledge Program Library',
  APP_VERSION: 'v0.4.0',
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_PUBLIC_ANON_KEY',
  ADMIN_EMAILS: ['you@example.com'],
  DEFAULT_PAGE_SIZE: 100
};
```

## Admin note

This build only **recognizes** admin users by comparing the signed-in Supabase user email against `ADMIN_EMAILS`. That is useful for the UI, but it is **not** the same thing as real security. Real edit protection still belongs in Supabase policies / RLS.

Because this build is read-only, coworkers can safely view the page as-is.

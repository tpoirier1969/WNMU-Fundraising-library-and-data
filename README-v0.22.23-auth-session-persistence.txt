WNMU Pledge Program Library v0.22.23

Auth/session persistence hardening.

Changes:
- Explicitly enables Supabase auth session persistence on page refresh.
- Explicitly enables token auto-refresh and OAuth redirect session detection.
- Uses browser localStorage for Supabase session storage when available.
- Does not add any automatic sign-out behavior; sign-out remains tied to the Sign out button only.

Notes:
- If the browser blocks localStorage, private/incognito mode clears site data, or the app is opened under a different origin/path behavior, the user may still need to sign in again.

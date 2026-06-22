WNMU Pledge Program Library v0.22.35

Changed-files patch.

Changes:
- Adds a Broadcast rights filter to the current/old Pledge Performance page.
  - Current rights only hides expired, inactive, not-yet-in-rights, non-specific, and unverified program rows.
  - When comparing by Program with Current rights only enabled, the title shows the rights end date after the title.
- Adds a Broadcast rights filter to the Pledge Performance Analytics lab page.
  - All rights statuses remains the default.
  - Current rights only filters to matched library titles still inside their broadcast rights window.
  - Program ranking now includes a sortable Rights end column.
  - When Current rights only is on, program title cells also show the rights end date after the title.
- Bumps visible app/version flags to v0.22.35.

Not changed:
- No import parser changes.
- No schedule/fundraiser merge or repair logic changes.
- No Supabase schema changes.

Verification performed:
- node --check passed for assets/js/*.js.
- pledge-performance-lab.html inline scripts passed syntax check after extraction.
- ZIP integrity checked.
- config.js not included.

v0.22.43 — Date-only archive state

Changes:
- Program Library archive/active state is now controlled only by Rights End date.
- All Titles shows active/current, expired/archived, and blank-rights titles.
- Active Only shows titles with blank Rights End or Rights End today/future.
- Archived Only shows titles with Rights End before today.
- Legacy archive/status fields no longer control Program Library visibility.
- Detail status now reports Active or Archived by rights-end date.
- Analytics current-rights logic no longer treats legacy archive/status fields as archive state.

No SQL required.

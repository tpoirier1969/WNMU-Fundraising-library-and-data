WNMU Pledge Program Library v0.22.21

Changed:
- Import/Reimport matched rows to Supabase button no longer goes silently inactive after a report is loaded.
- The button remains clickable once parsed rows exist, while the import function still blocks non-admin sessions, reconciliation mismatches, and zero importable rows with clear messages.
- Apply All now enables only when one or more manual matches are actually staged.
- Manual-match dropdown and Remember-this-match checkbox changes immediately refresh action-button state/tooltips.

Notes:
- This does not loosen the quarantine write gate. Supabase writes still use only matched/library-linked rows plus explicit non-specific rows.

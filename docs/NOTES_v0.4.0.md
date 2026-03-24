# Notes for v0.4.0

- Built against the imported pledge library tables already loaded into Supabase.
- The list view reads from `pledge_program_library_summary`.
- The detail panel reads directly from the base tables so you can inspect the import quality.
- Edit buttons are intentionally placeholders until the imported library is visually validated.
- The UI defaults to active titles and lets archived titles be included from the same view.

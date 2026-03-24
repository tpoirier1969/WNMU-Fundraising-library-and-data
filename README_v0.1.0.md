# Pledge Manager Starter Bundle v0.1.0

This bundle is the starting-point spec and database design for a sister app to the WNMU Program Library, focused on pledge programs, fundraiser scheduling, and post-drive revenue imports.

## What this bundle includes

- `supabase_schema_v0.1.0.sql`
  - Supabase/Postgres schema for pledge titles, versions, segment maps, fundraisers, schedule airings, results, and report imports.
- `build_spec_v0.1.0.md`
  - Screen-by-screen functional spec for the first real build.
- `import_spec_v0.1.0.md`
  - Import workflow and matching rules for PBS/break-report workbooks.
- `report_probe_from_sample_v0.1.0.md`
  - Notes extracted from the uploaded sample report to ground the import design.
- `ui_wireframe_v0.1.0.html`
  - Static wireframe showing the intended layout and interaction model.
- `VERSION_v0.1.0.txt`
  - Version marker.

## Core design decisions captured here

1. This is a **sister app**, not a bolt-on to the current Program Library.
2. It shares the same Supabase project, but uses separate pledge-specific tables.
3. The scheduler uses **type-ahead placement** as the primary entry flow:
   - click a start slot
   - type a title
   - choose a matching program/version
   - block appears automatically
4. The board uses **rounded board runtime buckets**, not exact file runtimes:
   - 1:26:05 => 90
   - 0:28:00 => 30
   - 2:03:20 => 120
5. Exact runtime is still stored for reference and reporting.
6. Break structure is modeled as reusable **segment rows**, not fixed spreadsheet columns.
7. End-of-drive result workbooks are imported into raw rows first, then matched against scheduled airings.
8. High-confidence matches post automatically. Ambiguous matches go to review.

## Intended next use

- Use the SQL file as the starting schema in Supabase.
- Use the build spec as the implementation checklist.
- Use the import spec to guide the report uploader/parser.
- Adjust any fields/rules that shift as your workflow evolves.


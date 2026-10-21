# Database Schema Provenance

This document records what can be proven about the database used by the current Pledge Program Library and, equally important, what cannot yet be proven.

No SQL in this directory is approved for execution against WNMU production. Productization database work must first be validated against an empty disposable database.

## Current application contract

The v0.22.141 application expects these pledge-side objects:

- `pledge_programs_v2`
- `pledge_program_library_summary_v2`
- `pledge_program_timings_v2`
- `pledge_program_drive_rollups_v2`
- `pledge_program_airings_v2`
- `pledge_fundraiser_schedules`

The current application also optionally reads a separate non-pledge Program Library source. That source is an integration dependency, not part of the pledge database installer unless a station explicitly enables that integration.

## What the repository proves

### Original starter schema

`docs/supabase_schema_v0.1.0.sql` is the original non-v2 pledge schema. It created objects such as:

- `pledge_programs`
- `pledge_program_aliases`
- `pledge_program_versions`
- `pledge_program_segments`
- `pledge_premiums`
- `pledge_fundraisers`
- `pledge_scheduled_airings`
- `pledge_airing_results`
- report-import tracking tables and summary views

This file is useful historical design evidence, but it is not the schema used by the current application and must not be repackaged as a current installer.

### Transition to v2

Repository history shows that the application was switched to the v2 object names during the v0.6.5-era code change. That change introduced direct reads from:

- `pledge_program_library_summary_v2`
- `pledge_programs_v2`
- `pledge_program_timings_v2`
- `pledge_program_drive_results_v2`
- `pledge_program_airings_v2`

The immediately following v0.6.6 documentation states that the build assumes a separate "v2 migration pack" had already been run successfully.

### Missing creation migrations

`06_enable_v2_access.sql` was committed after the application had already switched to v2. It grants access and creates RLS policies for v2 objects, but it does not create those objects.

The historical repository tree at that point contains `06_enable_v2_access.sql` but does not contain migrations numbered 01 through 05 or another complete v2 schema-creation script.

Therefore, the creation source for the original v2 schema is currently **missing from repository history examined so far**. It may have been executed manually from a chat-generated or local SQL file and never committed.

This is a blocker for claiming that the repository already contains a trustworthy blank-database installer.

## Later SQL that helps reconstruct the current contract

The following files are useful evidence but are not, by themselves, a complete installer:

### `supabase/report_import_bootstrap_v0.13.0.sql`

Creates or extends:

- `pledge_program_airings_v2`
- `pledge_program_drive_results_v2`

It also adds import metadata, indexes, and read/write policies.

### `supabase/report_import_revision_v0.14.0.sql`

Further defines `pledge_program_airings_v2` fields and creates:

- `pledge_program_drive_rollups_v2`
- a revised `pledge_program_library_summary_v2`

The summary view selects from `pledge_programs_v2`, confirming that the base program table must already exist before this revision is applied.

### Later patches

The current tree also contains later access, scheduling, timing, deletion-policy, and evergreen-override patches. These document schema evolution but cannot safely substitute for the missing base v2 creation migration.

## Reconstruction policy

A generic installer must not be assembled by blindly concatenating historical SQL files.

The reconstruction process will instead use three independent sources of truth:

1. **Current application contract**: every table/view and field the v0.22.141 code reads or writes.
2. **Verified SQL history**: every field, type, constraint, index, view, policy, trigger, and default that is explicitly present in committed SQL.
3. **Disposable database validation**: the reconstructed blank schema must support the application and all regression fixtures without using or copying WNMU production data.

Where the repository does not establish a field's exact SQL type or constraint, that uncertainty must be documented rather than guessed silently.

## Production-data rule

Reconstructing the schema does **not** require copying WNMU rows. If production metadata is ever needed to verify column definitions, the preferred method is schema-only introspection that returns object/column definitions and no record contents. That step is not authorized merely by this document and should not be performed until there is a safe, read-only plan.

## Current status

- Current object names: identified.
- Original starter schema: identified.
- v2 application transition: identified in Git history.
- v2 access patch: identified.
- later import/scheduling/timing patches: identified.
- original v2 creation migration: **not present in the repository history examined so far**.
- WNMU production database: **not touched by productization work**.
- Generic blank-database installer: **not yet safe to generate or run**.

The next safe database step is to build a field-level schema contract from the current code and committed SQL, then compare that contract against a disposable blank database implementation. Only after that passes should SQL migrations be promoted into a generic installer.

# Current Database Contract

This is a reconstruction contract for the current v0.22.141 application. It describes what the application demonstrably expects from a blank database without claiming SQL details that the repository does not prove.

It is **not executable SQL** and does not change WNMU's database.

## Contract vocabulary

- **Canonical**: the current application directly uses this object or field name.
- **Compatibility candidate**: current code can read one of several historical/alternate names.
- **SQL-proven**: a committed SQL file establishes at least part of the database definition.
- **Type unresolved**: the current repository does not yet provide enough evidence to lock the generic installer to an exact type/constraint.

## 1. `pledge_programs_v2`

Purpose: canonical program-library record used for list/detail display and signed-in editing.

### Canonical application fields

Current code directly searches/edits or uses these canonical names:

- `id`
- `title`
- `nola_code`
- `distributor`
- `length_bucket_minutes`
- `topic_primary`
- `topic_secondary`
- `rights_start`
- `rights_end`
- `package_type`
- `source_format`
- `rights_notes`
- `premium_summary`
- `program_notes`

Runtime handling also recognizes actual-runtime information, primarily through:

- `actual_runtime_seconds`
- `actual_runtime_minutes`
- `runtime_seconds`
- `runtime_minutes`
- `actual_runtime`
- `length_minutes`

The exact canonical storage representation for actual runtime must be confirmed before the blank-schema migration is finalized.

### Identity / compatibility fields

Current lookup logic can encounter:

- `program_id`
- `pledge_program_id`
- `program_uuid`
- `uuid`

New generic schema work should prefer one canonical primary key and retain compatibility only where imports/integrations actually require it.

### Archive/status compatibility

Current code can encounter historical fields such as:

- `status`
- `library_state`
- `is_archived`
- `archived`
- `inactive_flag`

However, current Program Library visibility logic is intentionally driven by rights dates rather than those older archive flags. The generic schema should not resurrect obsolete status behavior merely because old rows/views may expose those columns.

### SQL status

The original creation migration for this v2 table has not been found in repository history examined so far. Exact SQL types, defaults, required columns, and constraints are therefore unresolved until reconstructed and tested.

## 2. `pledge_program_library_summary_v2`

Purpose: enrichment/summary view layered over the base program table.

Current application behavior:

- probes the base table and summary view independently;
- can run from the base table if the summary view is unavailable;
- merges summary values back onto base rows by ID, NOLA/title, or title;
- expects aggregate performance values when available.

A committed v0.14 SQL revision proves that this view selects `p.*` from `pledge_programs_v2` and augments it with airing-derived values including:

- `total_contributions`
- `avg_contribution_per_drive`
- `total_airings`
- `fundraiser_count`
- `last_aired_at`

The generic installer should create the base table first and views afterward.

## 3. `pledge_program_timings_v2`

Purpose: ordered per-program timing rows for program segments, pledge breaks, and local cut-ins.

### Canonical/actively written fields established by current code

- `id`
- `program_id`
- `pledge_program_id` (compatibility lookup)
- `segment_number`
- `slot_number`
- `source_row_number`
- `act_seconds`
- `break_seconds`
- `local_cutin_seconds`
- `break_offset_seconds`

Current code also recognizes older/alternate duration field names such as:

- `program_segment_length_seconds`
- `segment_seconds`
- `pledge_break_seconds`
- `break_length_seconds`
- `local_cutin`
- `local_cutin_length_seconds`

and descriptive candidates including `notes`, `description`, `segment_title`, `segment_name`, `timing_note`, and `timing_notes`.

### SQL-proven behavior

Committed patches prove that:

- anonymous and authenticated users are granted read access;
- authenticated users need insert/update/delete access;
- RLS is enabled;
- `source_row_number` is non-null in the deployed schema and later received a negative-sequence default for manually added rows;
- `segment_number` and `slot_number` are expected to remain synchronized;
- existing data may identify a program by either `program_id` or `pledge_program_id`.

The original table-creation SQL and exact types for several columns remain unresolved.

## 4. `pledge_program_airings_v2`

Purpose: imported pledge-airing records and program-specific fundraising performance.

Committed v0.14 SQL establishes these fields or later additions:

- `id` UUID primary key
- `program_id` text
- `pledge_program_id` text
- `title` text
- `program_title` text
- `imported_program_title` text
- `matched_library_title` text
- `nola_code` text
- `station` text
- `aired_at` timestamptz
- `air_date` date
- `air_time` text
- `dollars` numeric(12,2)
- `pledge_count` integer
- `program_minutes` integer
- `sustainer_count` integer
- `fundraiser_label` text
- `drive_start_date` date
- `drive_end_date` date
- `match_method` text
- `title_mismatch_flag` boolean
- `source_file_name` text
- `source_report_type` text
- `source_delimiter` text
- `import_batch_id` text
- `imported_by_email` text
- `row_hash` text
- `raw_payload` jsonb
- `created_at` timestamptz
- `updated_at` timestamptz

Current code requires `row_hash` for duplicate detection and supports manual matching/update/delete of imported rows.

### Access model

Committed SQL establishes public read and authenticated write policies for imported airing rows. That is a reasonable starting model for the generic installer, subject to final role design.

## 5. `pledge_program_drive_rollups_v2`

Purpose: derived per-program/per-fundraiser performance rollup.

Committed v0.14 SQL proves this can be a view derived from `pledge_program_airings_v2`, producing fields including:

- `id`
- `program_id`
- `pledge_program_id`
- `title`
- `program_title`
- `nola_code`
- `fundraiser_label`
- `drive_start_date`
- `drive_end_date`
- `drive_date`
- `aired_at`
- `contribution_total`
- `pledge_count`
- `sustainer_count`
- `airing_count`
- `total_program_minutes`

Current code queries this object as a read-side performance source and sorts by date/order fields when available.

## 6. `pledge_fundraiser_schedules`

Purpose: persisted fundraiser schedule documents.

This object has complete committed creation SQL and is therefore currently the best-defined portion of the generic schema.

SQL-proven columns:

- `id` text primary key
- `title` text not null
- `start_date` date not null
- `end_date` date not null
- `day_start_hour` integer not null
- `day_end_hour` integer not null
- `schedule_data` jsonb not null
- `created_at` timestamptz not null
- `updated_at` timestamptz not null

The current application also carries newer in-document schedule settings such as minute-level broadcast-day boundaries, online/mail dollars, goal dollars, and placements inside `schedule_data`, so the generic installer does not need to turn every scheduler property into a top-level SQL column.

### Security divergence for the generic installer

The historical creation script grants an `anon, authenticated` policy `for all`, which permits anonymous writes as well as reads.

**Do not copy that policy unchanged into the generic installer.**

Generic default should be:

- anonymous: read only, if the station enables public/viewer access;
- authenticated: read/write;
- administrative authorization enforced consistently with the application auth model.

This is a generic-installer requirement only. Productization work must not silently alter the current WNMU production policy.

## 7. Optional non-pledge Program Library integration

The pledge app can optionally probe configured external Program Library sources. Current fallback names include:

- `program_library_summary_v2`
- `wnmu_program_library_summary_v2`
- `program_library_v2`
- `programs_v2`

This is **not** part of the required blank pledge schema.

A generic station should be able to install Pledge Library without any non-pledge Program Library. If the station also installs/enables Program Library integration, its source object names should be supplied by configuration rather than inferred from WNMU naming.

## 8. Access contract for a generic installation

Initial safe default, subject to disposable-database testing:

| Object | Anonymous | Authenticated |
| --- | --- | --- |
| Program base | read | read/write as authorized |
| Program summary view | read | read |
| Timing rows | read | read/write as authorized |
| Airing/import rows | read | read/write as authorized |
| Drive rollup view | read | read |
| Fundraiser schedules | read if station permits | read/write as authorized |

The installer must not use “empty admin list means every authenticated account is an administrator” as an accidental default. An installation must establish an explicit administrator policy.

## 9. What still blocks executable migrations

Before creating `001_base_schema.sql`, the following need to be resolved:

1. exact `pledge_programs_v2` SQL types/defaults/constraints;
2. exact `pledge_program_timings_v2` base definition;
3. whether any current production-only columns are actually required by v0.22.141 rather than merely tolerated by compatibility code;
4. final generic RLS/auth policy;
5. clean dependency order for base tables, views, indexes, sequences, and policies.

None of those requires WNMU production row data. The next implementation should be based on schema definitions and disposable test data only.

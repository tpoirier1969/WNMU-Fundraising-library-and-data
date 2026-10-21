# Genericization Inventory

This inventory records station-specific assumptions found in the current v0.22.141 application. It is intentionally descriptive. No runtime behavior is changed by this document.

## Risk classes

- **Identity**: branding, display names, logos, titles.
- **Namespace**: browser storage keys, realtime channel names, database object names.
- **Business rule**: station-specific pledge calendar, fiscal calendar, reporting assumptions, or workflow.
- **Infrastructure**: Supabase/auth/hosting assumptions.
- **Distribution**: files that must never enter a generic package.

## Identity assumptions

### `index.html`

- Page title is hard-coded as `WNMU Pledge Program Library`.

### `app-shell.html`

- Page title is hard-coded for WNMU.
- Header and authentication shell use `assets/WNMU-TV-logo-head2019.png`.
- Header and authentication shell use `WNMU-TV PBS` display text.
- Footer identifies the installation as WNMU-TV PBS.

### `assets/js/core.js`

- `APP_NAME` is hard-coded as `WNMU Pledge Program Library` even though `config.example.js` already contains an `APP_NAME` value.
- A non-pledge source fallback explicitly references `wnmu_program_library_summary_v2`.

### `assets/js/auth.js`

- Browser document title is built as `WNMU Pledge Program Library <version>`.

### `assets/js/ui-scheduling.js`

- Non-pledge scheduling status/error copy refers specifically to the WNMU Program Library.

### `assets/js/one-sheet-reports.js`

- Several report titles, kickers, and access-gate assets are WNMU-specific.
- Report code refers to the WNMU logo directly.
- The analysis API is currently exposed as `window.WNMUOneSheetAnalysis`.

## Namespace assumptions

### `assets/js/core.js`

The following browser-storage namespaces are station-specific:

- `wnmuPledgeSchedulesV2`
- `wnmuPledgeImportMatchRulesV1`
- `wnmuPledgeImportReportTotalsV1`
- `wnmuPledgeAnalyticsCohortV1`

These must eventually derive from a configured installation namespace. WNMU's existing values should remain its defaults during migration so saved browser state is not lost.

### `assets/js/auth.js`

Realtime/local storage identifiers are station-specific:

- presence topic `wnmu-pledge-active-v1`
- visitor storage key `wnmuPledgePresenceVisitorV1`
- tab storage key `wnmuPledgePresenceTabV1`

These need the same compatibility treatment as the other storage keys.

### Database object names

The application currently expects several database object names directly from constants, including:

- `pledge_programs_v2`
- `pledge_program_library_summary_v2`
- `pledge_program_timings_v2`
- `pledge_program_drive_rollups_v2`
- `pledge_program_airings_v2`
- `pledge_fundraiser_schedules`

For the first generic release, keeping these as the standard schema names is preferable to renaming them per station. Configuration should still define them so later schema evolution is possible without forking the application.

## Business-rule assumptions

### Pledge seasons

`assets/js/one-sheet-analysis.js` defines the principal fundraiser seasons as March, June, August, and December and maps nearby months into those labels. That is a WNMU pledge-history convention, not a safe universal station assumption.

Generic direction: make fundraiser season labels/rules configurable, with automatic date-range grouping as a fallback for stations that do not use WNMU's four-season model.

### Fiscal calendar

`assets/js/one-sheet-reports.js` describes fiscal YTD using WNMU's July 1 through June 30 fiscal calendar.

Generic direction: move fiscal-year start month/day into station configuration and generate the end boundary from it.

### Regional weather

`assets/js/one-sheet-reports.js` hard-codes Upper Peninsula weather reference locations:

- Ironwood
- Houghton
- Marquette
- Escanaba
- Sault Ste. Marie

Generic direction: weather comparison should be an optional module whose locations come from station configuration. A station that supplies no locations should simply omit weather analysis rather than fail.

### Historical annotations

`assets/js/one-sheet-reports.js` contains station/history-specific annotations, including WNMU Passport in February 2019, in addition to broader national events.

Generic direction: split annotations into a generic optional baseline and station-provided annotations. WNMU keeps its local events in its own station profile.

### Scheduler day boundary

The application currently defaults the pledge scheduling day to 7:00 AM through 7:00 AM-plus of the next broadcast day. This may be a useful default but must be configurable for stations using another broadcast-day boundary.

## Infrastructure assumptions

### Supabase

The current application is built around Supabase JS and PostgreSQL/Supabase table access. The first generic installer should therefore officially target Supabase rather than pretending to be database-neutral before that has been proven.

A later PostgreSQL adapter is possible, but promising arbitrary hosting/database compatibility now would create unnecessary risk.

### Authentication

The current admin sign-in flow uses GitHub OAuth through Supabase.

Important security behavior: current code treats any signed-in user as an admin when the configured `ADMIN_EMAILS` list is empty. A generic setup flow must not accidentally expose that behavior. The installer should require either:

1. at least one explicit administrator identity, or
2. an explicit acknowledgement that all authenticated users are administrators.

This is a generic-installer rule only at this stage. Existing WNMU authentication behavior is not being changed by productization work yet.

### Hosting

The application is currently a static web application plus Supabase services. That is favorable for distribution. The generic release should initially document/test static hosting targets rather than embed one provider into application logic.

## Distribution hazards in the repository

The generic package must be generated from an allowlist rather than by zipping the repository.

Known hazards include:

- committed live `config.js`
- WNMU logos and branding
- legacy `trace40/` material
- legacy `WNMU-Pledge-Program-Library-v0.18.0-import-fix/` snapshot
- `.bak` JavaScript files
- root `README.txt` containing unrelated Fishing Logbook documentation
- root `supabase-setup.sql` containing unrelated Fishing Logbook schema
- `manifest.webmanifest` containing unrelated Fishing Logbook identity
- historical one-off SQL patches and release notes that do not collectively represent a clean blank-database installer

None of those files should be deleted merely as part of genericization. The generic release builder should ignore them.

## Safest extraction order

Runtime genericization should happen in small, independently testable steps after the release boundary and blank schema are established:

1. Station display name/title/logo abstraction.
2. Browser/realtime namespace abstraction with WNMU-compatible defaults.
3. Non-pledge Program Library source abstraction.
4. Report fiscal-year configuration.
5. Weather-location configuration/optional disablement.
6. Historical annotation configuration.
7. Pledge-season configuration.
8. Authentication-provider/admin policy abstraction.
9. Database object-name configuration only where it improves compatibility without destabilizing queries.

Each step should add regression tests before changing the active runtime and should preserve the exact current WNMU default behavior.

## Next database task

Before an installer exists, the next substantial task is to reconstruct a **clean blank current schema** in `productization/database/migrations/` using the current application contract and existing SQL history. That work must not execute against WNMU's production Supabase project. It should first be tested against an empty disposable project/database.

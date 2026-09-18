# Generic Station Productization

This directory is the isolated foundation for turning the WNMU pledge application into a station-deployable application without changing the current WNMU runtime.

## Safety rule

Productization work begins as additive, branch-only work. The current application files, database objects, live configuration, and working WNMU deployment are not to be changed merely to make the application generic.

The first distributable build will be produced from a controlled release process that copies approved application files into a separate output and refuses to package station-specific configuration or data.

Base used for this work: `main` at application version `0.22.141`.

Working branch: `productization/generic-station-foundation-2026-09-15`.

## Data boundary

A generic release may contain application code, blank database migrations, configuration templates, documentation, and optional fictional demo data.

It must never contain:

- WNMU production pledge records, program records, fundraiser schedules, imported reports, analytics snapshots, contacts, notes, or other station data.
- WNMU's live `config.js`.
- A concrete WNMU Supabase project URL or station credentials.
- WNMU logos or station-specific branding unless explicitly distributed as a separate WNMU-only package.
- Database dumps or seed files derived from WNMU production data.

## Current productization blockers found in the repository

These are inventory findings only. They are not being repaired in the live application yet.

1. `index.html`, `app-shell.html`, and `assets/js/core.js` contain hard-coded WNMU naming/branding.
2. `assets/js/core.js` uses WNMU-specific browser storage keys.
3. Database table/view names are hard-coded in application constants rather than fully supplied by station configuration.
4. A live `config.js` is committed. A generic release must explicitly exclude it.
5. `supabase-setup.sql`, `README.txt`, and `manifest.webmanifest` currently contain unrelated Fishing Logbook material. They cannot be used as the generic installer source.
6. The repository contains legacy snapshots, backup JavaScript files, and WNMU logo files that must be excluded from a generic release.
7. The repository currently has historical SQL patches, but not yet a clean, ordered, blank-database migration set representing the complete current pledge schema.

## Productization strategy

The safest route is to separate the product from the station installation without immediately refactoring the working app.

### Phase 1: inventory and release boundary

- Identify station-specific strings, rules, database object names, auth assumptions, and assets.
- Define the files that may enter a generic release.
- Add a generic-readiness audit that reports station-specific material without changing runtime behavior.
- Define a station configuration contract.

### Phase 2: blank database installer

- Reconstruct the current required pledge schema from the actual application and SQL history.
- Convert it into ordered, idempotent migrations for a new empty Supabase/PostgreSQL database.
- Add schema version tracking.
- Add RLS/policy migrations separately from data migrations.
- Test against a completely empty test project before considering it distributable.

### Phase 3: configuration extraction

Move station-specific assumptions behind configuration one item at a time, with regression coverage for every move. WNMU values remain the defaults in the WNMU installation so existing behavior is preserved.

Expected configurable areas include station display name, call letters, logo, timezone, fiscal-year start, browser storage namespace, enabled modules, database object names, non-pledge Program Library source, authentication provider, administrator list, and scheduler defaults.

### Phase 4: generic release builder

Create a release builder that copies only approved files into a separate output directory, generates a blank `config.example.js`, applies generic branding defaults, and fails if WNMU-specific or live-configuration material remains.

The builder must never edit the source working tree.

### Phase 5: first-run setup

After the generic package can be created safely, add a first-run setup flow for station configuration and database initialization. This should operate on the station's database and hosting, not WNMU's.

## Compatibility goal

WNMU should remain one configured installation of the same application, not a fork that must be maintained separately from a generic edition.

The immediate rule, however, is preservation first: no refactor is worth risking the working WNMU application. Genericization proceeds behind tests, branch isolation, and release-copy tooling until each change is proven safe.

# Report import notes v0.14.0

## What changed
- The importer now treats **NOLA as the authoritative match key**.
- Imported report money is stored only at the **airing row** level.
- Fundraiser/title totals are **derived** from those airings; they are not stored a second time.
- If a report title is abbreviated but the NOLA matches a library title, the app keeps the **library title**.
- The browser build still does **not** parse `.xls` / `.xlsx` directly. Export the **PBS Break Report** tab as CSV first.

## Recommended workflow
1. Export the PBS Break Report tab as CSV.
2. Load the CSV in Report Imports.
3. Review unmatched NOLAs and title-mismatch warnings.
4. Import airings to Supabase.
5. Let totals and fundraiser rollups come from the derived SQL view.

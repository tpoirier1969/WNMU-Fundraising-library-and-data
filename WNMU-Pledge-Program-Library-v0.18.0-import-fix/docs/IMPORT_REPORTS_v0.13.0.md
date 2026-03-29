# Report Imports v0.13.0

## What this adds

The new **Report Imports** workspace is the first real intake lane for pledge reports.

It does four things:

1. reads CSV / TSV / delimited text exports
2. guesses whether each file behaves more like **airings** or **drive results**
3. normalizes the rows into the fields the app already knows how to analyze
4. lets you either export those normalized rows or import them into Supabase

## Expected source files

Best-case inputs are:

- CSV exports
- TSV / tab-delimited exports
- plain text delimited reports

`.xlsx` is not wired in yet in this build.

## First-use steps

1. Copy `config.example.js` to `config.js` and fill in Supabase credentials.
2. Run `supabase/report_import_bootstrap_v0.13.0.sql` in the Supabase SQL editor.
3. Open the app and go to **Report Imports**.
4. Load one or more report files.
5. Review the detected target, warnings, and normalized previews.
6. Either export the normalized CSVs or press **Import to Supabase**.

## Important caveats

- Direct import is intended for authenticated admins.
- If the database schema is older than this build, use the bootstrap SQL first.
- The importer writes a `raw_payload` JSON copy of each source row so nothing important gets thrown away.
- Duplicate handling is starter-grade and leans on `row_hash` when available.
- The Performance workspace already knows how to read the normalized date, time, money, break, and premium fields this importer produces.

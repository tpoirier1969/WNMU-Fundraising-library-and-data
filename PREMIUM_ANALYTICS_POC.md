# Premium Analytics proof of concept

This proof of concept is intentionally isolated from the existing pledge data model.

## Safety boundary

- No existing Supabase table, view, policy, imported pledge result, program record, or fundraiser schedule is changed.
- Premium cost spreadsheets are parsed in the browser with SheetJS.
- Normalized premium history is stored only in the browser under `wnmuPremiumAnalyticsHistoryV1`.
- Program Library and existing fundraiser/airing analytics are read from Supabase; this module does not write to them.
- Current `premium_summary` values may serve as historical proxies, but are labeled `Current-offer proxy` rather than historical fact.
- Station-wide premiums remain unassigned unless there is a strong program-specific match.
- Broadcast results and premium-linked pledge dollars are displayed side by side as context. They are not silently combined or subtracted because their giving-channel scope may differ.

## Data model

The accounting unit is the exact selectable premium package. A bundle is one premium. Components such as DVD, book, drinkware, blanket, apparel, and tote are analytical tags only. Category totals overlap and are never meant to be added together.

Each imported premium result remains tied to its fundraiser. That prevents a current premium package from becoming a timeless property of a program.

## Proof-of-concept views

- Fundraiser premium economics, including premium take rate and premium vs. no-premium average pledge.
- Exact premium/package performance.
- Overlapping analytical category trends.
- Program and topic premium rollups using clearly labeled mapping confidence.
- Combined program/topic context using the existing pledge-airing analytics alongside premium report results.
- Data-quality flags for missing or suspicious source costs and unmapped packages.
- Printable Premium Performance & Economics report.

## New files

- `premium-analytics.html`: interactive import and analytics module.
- `premium-report.html`: printable Premium Performance & Economics report.
- `assets/js/premium-analysis.js`: pure parsing, classification, mapping, combined-analysis, and aggregation logic.
- `assets/js/premium-data.js`: browser storage, XLS/XLSX parsing, admin gate, and read-only Program Library/fundraiser access.
- `assets/js/premium-analytics.js`: module UI.
- `assets/js/premium-report.js`: printable report UI.
- `assets/js/report-hub-premium-analytics.js`: report-card integration.
- `assets/premium-analytics.css`: module/report styling.
- `tests/premium-analysis.test.mjs`: regression coverage for parser, bundles, categories, fundraiser economics, mapping, and combined analytics.

## Future durable-storage step

If the proof of concept is useful, move normalized premium history into new dedicated Supabase premium tables. Do not overload existing program or pledge-airing tables. The pure analysis layer is designed so the storage backend can change without rewriting the analytics.

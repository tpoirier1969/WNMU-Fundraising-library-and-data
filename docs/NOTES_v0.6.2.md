# WNMU Pledge Program Library v0.6.2

This revision fixes the list data path, expands filters to the fields you actually need, and cleans the detail modal up so it focuses on pledge-specific information instead of generic ballast.

## What changed in v0.6.2

- Rights Begin, Rights End, and Last Aired are now enriched from the base pledge program rows for the visible list page.
- Last Aired now shows **N/A** when a title has never aired.
- Added filters for primary topics, secondary topics, lengths, and distributor.
- Kept the default sort as **Topic, then Title**.
- Reworked the detail modal to emphasize Length, NOLA, Distributor, timing and segment structure, air-date contribution history, and premiums.

## Notes

- Air-date contribution history is shown when the underlying table is readable and available.
- `config.js` is still expected at runtime but is not packaged in this build.

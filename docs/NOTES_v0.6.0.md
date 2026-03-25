# WNMU Pledge Program Library v0.6.0

This revision rebuilds the pledge library UI so it follows the same visual language and filter layout as the main Program Library, while keeping the pledge-specific detail sections.

## What changed in v0.6.0

- Reworked the header, controls, colors, and table styling to match the WNMU-TV / Program Library look much more closely.
- Rebuilt the search and filter area to use the same general pattern as the Program Library:
  - Search in
  - Search text
  - Topics
  - Distributor
  - State of the library
  - Clear all filters
- Changed the default list order to **Topic first, then Title**.
- Simplified the table columns to:
  - Title
  - Length
  - Topic
  - Distributor
  - Premiums
  - Rights Begin
  - Rights End
  - Last Aired
- Premium summary now breaks onto a new line whenever another dollar-sign amount appears.
- Hardened detail loading so the modal uses the visible summary row as a fallback and then layers in versions, premiums, and segments when those reads are available.

## Notes

- Detail still opens from the **title area** only.
- Version, premium, and segment reads still come from the base pledge tables when available.
- If one of those supplemental reads is unavailable, the modal now keeps the readable summary data on screen instead of collapsing into an empty shell.

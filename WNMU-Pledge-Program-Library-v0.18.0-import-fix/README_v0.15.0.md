# WNMU Pledge Program Library v0.15.0

## What changed
- Added an admin-only **Add pledge program** button in the main app chrome.
- New-title workflow reuses the existing detail editor so a new record can be created without leaving the library.
- New-title validation now treats **NOLA as required** for create flow.
- Duplicate guardrails:
  - exact NOLA duplicate blocks save
  - exact title duplicate shows a warning
- After a successful create, the app refreshes and opens the newly created title in the detail view.

## No SQL change required
This revision uses the existing `pledge_programs_v2` table and current detail-editor fields. If admin edit already works in your environment, add-program uses the same auth/session path.

## Still next
- dedicated timing editor
- dedicated premiums editor
- manual revenue adjustment editor

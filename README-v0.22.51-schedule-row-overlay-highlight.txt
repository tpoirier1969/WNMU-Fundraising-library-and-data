WNMU Pledge Program Library v0.22.51 — Schedule Row Overlay Highlight

This patch refines the Pledge Scheduling time-row highlight.

Changes:
- Clicking a left-side time label still selects/highlights that row.
- The highlighted row is now drawn as a translucent overlay across the calendar day columns.
- The overlay is drawn above scheduled program blocks, so the row remains visible even when programs fill the slot.
- The underlying program blocks remain readable and clickable because the overlay ignores pointer events.
- The row cells themselves no longer use opaque yellow backgrounds.

No database/schema changes.

WNMU Pledge Program Library v0.22.52
Printable Pledge Scheduling calendar

Changes
- Moved Daily Rundown out of the main workspace navigation.
- Added Daily Rundown and Print Calendar beside Scheduled Fundraisers.
- Added the same two actions to the mobile fundraiser selector.
- Print Calendar opens the loaded fundraiser in a new browser tab.
- The print view uses landscape page formatting and the currently visible calendar hours.
- Program blocks preserve their calendar length and position.
- Placeholders, non-pledge blocks, live-break flags, and entered/transferred status remain distinguishable.
- Fundraisers up to nine days print on one page. Longer drives paginate into seven-day sections to avoid unreadably tiny columns.
- The print preview includes a Print Calendar button and does not alter schedule data.

Verification performed
- node --check passed for core.js, dom.js, and ui-scheduling.js.
- pledge-performance-lab.html inline script passed syntax validation.
- Version references were checked for v0.22.52 consistency.
- ZIP integrity was tested.
- config.js is not included.

Not verified
- No live Supabase or interactive browser test was performed against WNMU production data.

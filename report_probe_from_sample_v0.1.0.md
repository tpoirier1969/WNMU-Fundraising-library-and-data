# Pledge Manager Build Spec v0.1.0

## Goal

Create a sister app to the WNMU Program Library for quarterly pledge/fundraiser planning, pledge title management, schedule building, and post-drive performance imports.

---

## Guiding rules

1. **Same Supabase project, separate pledge tables**
2. **Type-ahead placement** is the main scheduling method
3. **Rounded board runtime** controls the schedule block height
4. **Exact runtime** is stored separately for detail/reporting
5. **Break structure** is stored as reusable segment rows
6. **Archive is default-hidden but still searchable**
7. **Import rows are preserved raw before matching**
8. **Ambiguous import matches go to review**

---

## Main app sections

### 1. Fundraisers
Create, edit, archive, duplicate, and manage fundraiser periods.

### 2. Schedule
Visual board for placing and moving titles inside a fundraiser.

### 3. Pledge Program Library
Master catalog of all pledge titles and versions.

### 4. Results / Reports
Totals, averages, comparisons, import status, review queue.

### 5. Settings / Lookups
Optional lookup maintenance later.

---

## Screen 1: Fundraisers list

### Purpose
Show all fundraiser periods, including variable-length drives.

### Main controls
- Create Fundraiser
- Duplicate Fundraiser
- Archive Fundraiser
- Open Schedule
- Import Results Report

### Columns
- Fundraiser name
- Date range
- Status
- Scheduled airings
- Total raised
- Notes flag

### Create Fundraiser modal fields
- Fundraiser name
- Season label
- Year
- Start date
- End date
- PBS core start date
- PBS core end date
- Fundraising overnight? yes/no
- Fundraising morning? yes/no
- Fundraising daytime? yes/no
- Fundraising evening? yes/no
- Fundraising late night? yes/no
- Notes

### Optional later
- blackout date editor
- duplicate prior fundraiser template

---

## Screen 2: Schedule board

### Core behavior
- Board columns are one day each
- Rows are 30-minute blocks
- Fundraiser date range controls board width
- Empty slot click opens inline quick-add
- Program block height uses board runtime bucket

### Primary scheduling workflow
1. Click empty slot at a specific day/time
2. Type a title, alias, or NOLA
3. Choose from autocomplete results
4. Scheduled airing row is created automatically
5. Board block appears automatically
6. Lower run list updates automatically

### Autocomplete result content
Each result line should show:
- Title
- Version
- Board runtime
- Distributor
- Avg dollars per airing (if available)
- Archived badge if archived

### Scheduler actions
- Click empty slot to add
- Drag block up/down by 30-minute increments
- Drag block to another day
- Duplicate block
- Remove block
- Replace title
- Change version
- Mark live
- Add notes

### Board color/label guidance
- Standard programs: neutral but readable
- Live blocks: stronger badge/label
- Archived titles if scheduled: clearly tagged
- Blackout windows: shaded or locked
- Overlaps/conflicts: obvious warning state

---

## Screen 3: Lower run list beneath schedule

### Purpose
Auto-generated operations/fundraising handoff list for the current fundraiser.

### Source
Derived automatically from the scheduled airings on the board. No manual duplicate entry.

### Default columns
- Date
- Start
- End
- Title
- Version
- NOLA
- Distributor
- Board runtime
- Exact runtime
- Break summary
- Premium summary
- Avg dollars
- Lifetime dollars
- Current fundraiser dollars
- Notes / status

### Expandable row
When expanded, show:
- full break map
- local cut-in opportunities
- rights notes
- distributor notes
- premium notes
- revenue history

---

## Screen 4: Pledge Program Library

### Purpose
Manage the large title catalog without cluttering the schedule screen.

### Main controls
- Add Program
- Include Archived toggle
- Search
- Filter by topic
- Filter by distributor
- Filter by version
- Filter by rights
- Sort by title / last aired / lifetime dollars / average dollars

### Default list columns
- Title
- Version count
- Board runtime
- Exact runtime
- Break summary
- Premium summary
- Distributor
- Last aired
- Lifetime dollars
- Avg dollars per airing
- Status

### Break summary in list
This is compact, not the full segment map.
Suggested display:
- `5 breaks · 2 local`
- optionally shorthand: `P26 F2[L] P21 F2 P19`

### Program detail page / drawer
Tabs or sections:
- Overview
- Versions
- Break Map
- Premiums
- Revenue History

---

## Program detail: Versions + Break Map

### Version record fields
- Version label
- Break style (HDPL / HDPE / LIVE / OTHER)
- Board runtime minutes
- Exact runtime
- Break count
- Local cut-in count
- Notes

### Break Map editor
Use an ordered row editor, not fixed columns.

Each row contains:
- order
- segment type
- label
- duration
- local cut-in available?
- optional?
- notes

Example:
- Program Section 1 — 26:05
- Fundraising Section 1 — 2:00 — local yes
- Program Section 2 — 20:33
- Fundraising Section 2 — 1:27 — local yes
- Program Section 3 — 18:48

---

## Screen 5: Results / Reports

### Default sections
- Fundraiser totals
- Program performance rankings
- Version comparisons
- Import history
- Review queue

### Useful report outputs
- Lifetime by title
- Avg dollars per airing
- Avg dollars per fundraiser
- Best/worst fundraiser by title
- HDPL vs HDPE
- Performance by daypart
- Performance by weekday
- Extension-day value
- Overnight performance

---

## Import Review screen

### Purpose
Show rows from uploaded reports that could not be matched cleanly.

### Columns
- Raw date
- Raw time
- Raw NOLA
- Raw title
- Raw dollars
- Raw pledges
- Match confidence
- Proposed airing
- Action buttons

### Actions
- Accept suggested match
- Search for correct airing
- Ignore row
- Add note

---

## Runtime rules

### Board runtime
Rounded planning bucket:
- 1:26:05 => 90
- 0:28:00 => 30
- 2:03:20 => 120

### Exact runtime
Kept in the record for detail/reference.

### UI display
Show both when relevant:
- Board: 90 min
- Exact: 1:26:05

---

## Archive rules

### Default behavior
Only active titles are shown by default.

### Include Archived
A toggle adds archived titles into the same list/search results.

### Scheduler search behavior
- active titles rank first
- archived titles remain available
- archived badge shown clearly

---

## Phase order

### Phase 1
- schema
- fundraisers list
- schedule board
- type-ahead placement
- pledge program library
- version/break map editor

### Phase 2
- results storage
- report import
- auto matching
- review queue

### Phase 3
- richer analytics
- duplicate-from-prior-fundraiser helpers
- blackout/daypart locking
- smarter suggestions


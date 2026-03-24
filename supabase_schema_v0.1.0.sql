# Import Spec for PBS / Break Reports v0.1.0

## Goal

Allow the user to upload an end-of-drive report workbook and automatically connect revenue/performance data to scheduled pledge airings.

---

## Import pipeline

1. Upload workbook
2. Detect workbook structure
3. Parse supported sheets into raw import rows
4. Match rows against scheduled airings
5. Auto-post high-confidence matches
6. Put ambiguous matches into review queue
7. Recompute fundraiser/program summary values

---

## Raw-first rule

Do not write directly from workbook rows into final airing results without preserving the source rows.

Instead:
- create one `pledge_report_imports` record per workbook
- create many `pledge_report_import_rows` records per parsed row
- match those rows later

This preserves auditability and allows parser improvements later.

---

## Sheets seen in the uploaded sample workbook

From the uploaded sample report, the workbook contained these tabs:

- On Air Break Summary by Type
- On Air Break Summary by Date
- On Air Break Tally Sheet
- Pledge Break Report Summary
- Pledge Detail Break Report
- PBS Break Report

The most useful sheets for matching appear to be:
- **PBS Break Report**
- **Pledge Break Report Summary**
- **Pledge Detail Break Report**

---

## Recommended import priority

### 1. PBS Break Report
Best candidate for first-pass airing matching.

Observed columns:
- Station
- Air Date
- Air Time
- NOLA
- Program Title
- Dollars
- Pledges
- Program Minutes
- Sustainers

Why it matters:
- It already has date + time + title + dollars + pledges + runtime
- It resembles a clean airing-level result table

### 2. Pledge Break Report Summary
Useful as supporting data and fallback.

Observed columns include:
- Call Letters
- Date
- Program Time
- Program number
- Program Name
- Number of Breaks
- Break Minutes
- Pledges
- Dollars
- Number of Premiums
- Avg $ Per Brk
- $ Per Min
- $ Per Pledge
- % Prem Requested

Why it matters:
- includes premium count and break metrics
- appears summary-level per airing/program-time row

### 3. Pledge Detail Break Report
Useful for finer break-level analysis or difficult matches.

Observed columns include:
- Call Letters
- Date
- Break Time
- Program number
- Program Name
- Break Code
- Break Minutes
- Pledges
- Dollars
- Num of Premiums

---

## Matching order

### Primary match keys
1. fundraiser id
2. air date
3. air time / program time
4. NOLA
5. normalized program title

### Secondary match keys
- rounded board runtime / program minutes
- version label
- same-day nearest scheduled slot

### Do not trust
- title alone
- date alone
- same runtime alone

---

## Title normalization rules

Before matching:
- lowercase
- trim whitespace
- collapse punctuation
- remove repeated spaces
- normalize `&` and `and`
- strip non-alphanumeric comparison characters for a second-pass normalized form

Example:
`BARRY MANILOW: LIVE BY REQUEST`
and
`Barry Manilow Live By Request`
should normalize to the same comparison form.

---

## Recommended confidence model

### 100
Exact date + exact time + exact NOLA

### 95
Exact date + exact time + normalized title

### 90
Exact date + near time + exact NOLA

### 85
Exact date + near time + normalized title + matching runtime bucket

### < 85
Send to review queue

---

## Review queue triggers

Send a row to review if:
- more than one possible airing matches
- title is missing or malformed
- time is missing
- multiple same-title airings exist on the same date
- NOLA conflicts with title
- workbook line appears to be a total row instead of an airing row
- row is `.NON-SPECIFIC PLEDGES`
- row is clearly summary-only and not assignable to a specific airing

---

## Special handling

### NON-SPECIFIC PLEDGES
These should not be auto-assigned to a title airing.
Store them as import rows and either:
- ignore in title-level analysis, or
- assign to fundraiser-level unattributed totals

### Totals rows
Rows such as `Totals for Date` or `Totals for Prerecorded` should not be imported as airing results.
They may be kept in a separate summary table later, but should not match to airings.

### Online/mail
If a workbook does not clearly assign online/mail to a specific airing, store them at fundraiser level or leave them manual for now.

---

## Result posting rules

After a row is matched to a scheduled airing:
- create or update `pledge_airing_results`
- store dollars
- store pledges
- store premium count if present
- store sustainer count if present
- flag needs_review when confidence is not perfect

### One-to-one default
Assume one airing result row per scheduled airing unless proven otherwise.

If duplicate rows appear for the same airing:
- either merge them deliberately with notes
- or place duplicates into review

---

## First-pass supported workbook fields from sample

### PBS Break Report example
- `2026-03-01`
- `2000`
- `ACSD`
- `ALL CREATURES GREAT AND SMALL`
- `1734`
- `6`
- `90`
- `1 sustainer`

This should match well against a scheduled airing of:
- fundraiser = matching fundraiser
- air_date = 2026-03-01
- start_time = 20:00
- title or NOLA match
- board runtime = 90

---

## Suggested implementation order

### Phase 1
Support import from:
- PBS Break Report
- Pledge Break Report Summary

### Phase 2
Use Pledge Detail Break Report for deeper break analytics and overrides.

### Phase 3
Add alias-learning:
- when manual matches are made repeatedly, suggest aliases for future imports


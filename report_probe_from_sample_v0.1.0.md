# Sample Report Probe Notes v0.1.0

This note summarizes what was actually observed from the uploaded workbook:

`tv march pledge report 022826 to 031826.xls`

The workbook was converted to `.xlsx` for inspection.

## Workbook metadata
- Old Excel `.xls` format
- Last saved by: Sarah Stanley
- Last saved time/date: 2026-03-19 12:36:39

## Sheet names found
1. On Air Break Summary by Type
2. On Air Break Summary by Date
3. On Air Break Tally Sheet
4. Pledge Break Report Summary
5. Pledge Detail Break Report
6. PBS Break Report

## Most useful sheet for direct airing matching
### PBS Break Report
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

Sample rows observed:
- 2026-02-28 2100 CCLA COUNTRY CLASSICS 255 2 90
- 2026-03-01 1800 LWPR LAWRENCE WELK : PRECIOUS MEMOR 200 1 120
- 2026-03-01 2000 ACSD ALL CREATURES GREAT AND SMALL 1734 6 90
- 2026-03-01 2130 BAML BARRY MANILOW: LIVE BY REQUEST 0 0 90

## Helpful supporting sheet
### Pledge Break Report Summary
Observed columns:
- Call Letters
- Date
- Program Time
- Program
- Program Name
- # of Breaks
- Break Minutes
- Pledges
- Dollars
- # of Premiums
- Avg $ Per Brk
- $ Per Min
- $ Per Pledge
- % Prem Requested

## Fine-grained sheet
### Pledge Detail Break Report
Observed columns:
- Call Letters
- Date
- Break Time
- Program
- Program Name
- Break Code
- Break Minutes
- Pledges
- Dollars
- Num of Premiums

## Import implications
1. The workbook structure is regular enough to parse.
2. The PBS Break Report looks like the best first-pass matching source.
3. The summary/detail break reports are strong supporting data.
4. NON-SPECIFIC PLEDGES appears in the report and should not be blindly matched to a title.
5. Date and start-time matching should work well if the fundraiser board stores scheduled airings cleanly.


import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('assets/js/program-library-controls.js', 'utf8');
const seasonFocus = fs.readFileSync('assets/js/program-fundraiser-season-focus.js', 'utf8');
const libraryList = fs.readFileSync('assets/js/ui-list.js', 'utf8');

test('library performance selector exposes average, median, and total dollars', () => {
  assert.match(source, /Avg \$ \/ Pledge Hour/);
  assert.match(source, /Median \$ \/ Pledge Hour/);
  assert.match(source, /Total \$ Raised/);
  assert.match(source, /state\.sortField === 'library_performance_metric'/);
  assert.match(source, /function reorderMetricRows\(\)/);
});

test('all-time total dollars drive the min and max pledge-dollar filters', () => {
  assert.match(source, /\['minTotal', 'Min total \$'/);
  assert.match(source, /\['maxTotal', 'Max total \$'/);
  assert.match(source, /const total = numberOrNull\(derive\.totalRaised\?\.\(program\)\) \?\? 0;/);
  assert.match(source, /if \(minTotal != null && total < minTotal\) return false;/);
  assert.match(source, /if \(maxTotal != null && total > maxTotal\) return false;/);
});

test('average pledge-hour and air-date range filters are present', () => {
  assert.match(source, /minAvgPledgeHour/);
  assert.match(source, /minAirDates/);
  assert.match(source, /maxAirDates/);
  assert.match(source, /function airDateCount\(program = \{\}\)/);
});

test('median pledge-hour calculation remains fundraiser-balanced', () => {
  assert.match(source, /function fundraiserKey\(row = \{\}\)/);
  assert.match(source, /const groups = new Map\(\);/);
  assert.match(source, /rates\.push\(\(dollars \* 60\) \/ minutes\);/);
  assert.match(source, /rates\.length % 2 \? rates\[middle\] : \(rates\[middle - 1\] \+ rates\[middle\]\) \/ 2/);
});

test('the new library controls are loaded by the existing library bootstrap path', () => {
  assert.match(seasonFocus, /assets\/js\/program-library-controls\.js/);
  assert.match(source, /program-library-controls-style/);
});

test('topic taxonomy options remain visible when titles are archived', () => {
  assert.match(libraryList, /except !== 'topic' && except !== 'secondary' && !rowMatchesStatus\(row\)/);
  assert.match(libraryList, /sourceRows\.filter\(\(row\) => rowMatchesFiltersExcept\(row, 'topic'\)\)/);
  assert.match(libraryList, /sourceRows\.filter\(\(row\) => rowMatchesFiltersExcept\(row, 'secondary'\)\)/);
  assert.match(libraryList, /function rowMatchesFilters\(row\) \{\s*return rowMatchesFiltersExcept\(row, ''\);/);
});

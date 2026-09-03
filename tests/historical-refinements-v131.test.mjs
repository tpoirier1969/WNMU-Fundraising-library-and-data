import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../reports.html', import.meta.url), 'utf8');
const version = JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url), 'utf8'));

assert.equal(version.appVersion, '0.22.137');
assert.match(source, /historicalStartDate/);
assert.match(source, /historicalEndDate/);
assert.match(source, /Pre-COVID/);
assert.match(source, /Post-COVID/);
assert.match(source, /function yearHistoryBands\(analyses = \[\], bandSize = 3\)/);
assert.match(source, /yearHistoryBands\(ordered, 3\)/);
assert.match(source, /All selected years/);
assert.match(source, /Corresponding fundraiser days by era/);
assert.doesNotMatch(source, /chartCard\('Fundraiser lifecycle'/);
assert.doesNotMatch(source, /title: 'Fundraiser lifecycle'/);
assert.match(source, /Corresponding fundraiser days vs history/);
assert.match(source, /currentCorrespondingDayComparisonData\(analysis, historical\)/);
assert.doesNotMatch(source, /currentCorrespondingDayComparisonData\(analysis, baseline\);\n    const topics/);
assert.match(source, /verticalGridEvery/);
assert.match(source, /visual-card-wide/);
assert.match(source, /Fiscal Year to Date \| FY/);
assert.match(source, /fiscalYearToDateSection/);
assert.match(source, /minAirings: 1, minFundraisers: 1, minTitles: 1/);
assert.match(html, /visual-card-wide/);
assert.match(html, /0\.22\.137/);
console.log('v0.22.137 historical refinements tests passed');

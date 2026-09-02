import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reports = fs.readFileSync('assets/js/one-sheet-reports.js', 'utf8');
const html = fs.readFileSync('reports.html', 'utf8');
const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));

test('v0.22.130 puts visual summaries before detailed report tables', () => {
  assert.match(reports, /function historicalVisualOverview\(analyses = \[\]\)/);
  assert.match(reports, /historicalVisualOverview\(analyses\),\s*historicalSeasonTable/);
  assert.match(reports, /function fundraiserVisualOverview\(analysis, historical = \[\]\)/);
  assert.match(reports, /fundraiserVisualOverview\(analysis, history\).*fundraiserHistoricalContext\(analysis, history\).*fundraiserAirSchedule/s);
});

test('v0.22.130 adds trend, lifecycle, topic, start-time, and donor-context views', () => {
  for (const marker of [
    'Fundraiser productivity over time',
    'Average gift over time',
    'Fundraiser lifecycle',
    'Season performance over time',
    'Corresponding fundraiser days',
    'Start-time performance',
    'Topic performance vs history',
    'Top program rates',
    'Donor behavior',
    'Scheduling pattern'
  ]) assert.ok(reports.includes(marker), `missing ${marker}`);
});

test('historical context remains fundraiser-balanced and excludes the selected fundraiser when possible', () => {
  assert.match(reports, /historyWithoutCurrent = historical\.filter/);
  assert.match(reports, /medianNumber\(overallRates\)/);
  assert.match(reports, /percentileForValue\(overallRates, currentRate\)/);
  assert.match(reports, /historicalLifecycleMedians\(baseline\)/);
});

test('report assets and application version are synchronized at v0.22.130', () => {
  assert.equal(version.appVersion, '0.22.130');
  assert.ok(html.includes('one-sheet-reports.css?v=0.22.130'));
  assert.ok(html.includes('one-sheet-analysis.js?v=0.22.130'));
  assert.ok(html.includes('one-sheet-reports.js?v=0.22.130'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reports = fs.readFileSync('assets/js/one-sheet-reports.js', 'utf8');
const html = fs.readFileSync('reports.html', 'utf8');
const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));

test('v0.22.138 puts visual summaries before detailed report tables', () => {
  assert.match(reports, /function historicalVisualOverview\(analyses = \[\]\)/);
  assert.match(reports, /historicalVisualOverview\(analyses\),\s*historicalSeasonTable/);
  assert.match(reports, /function fundraiserVisualOverview\(analysis, historical = \[\]\)/);
  assert.match(reports, /fundraiserVisualOverview\(analysis, history\).*fundraiserHistoricalContext\(analysis, history\).*fundraiserAirSchedule/s);
});

test('v0.22.138 adds trend, lifecycle, topic, start-time, and donor-context views', () => {
  for (const marker of [
    'Fundraiser productivity over time',
    'Average gift over time',
    'Corresponding fundraiser days by era',
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
  assert.match(reports, /currentCorrespondingDayComparisonData\(analysis, baseline\)/);
});

test('report asset cache-busters stay synchronized', () => {
  assert.match(version.appVersion, /^\d+\.\d+\.\d+$/);
  const assetVersions = [...html.matchAll(/(?:one-sheet-reports\.css|one-sheet-analysis\.js|one-sheet-reports\.js)\?v=(\d+\.\d+\.\d+)/g)].map((match) => match[1]);
  assert.equal(assetVersions.length, 3);
  assert.equal(new Set(assetVersions).size, 1);
});
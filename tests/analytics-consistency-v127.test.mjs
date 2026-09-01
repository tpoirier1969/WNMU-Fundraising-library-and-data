import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import A from '../assets/js/one-sheet-analysis.js';

const analytics = fs.readFileSync(new URL('../assets/js/ui-analytics.js', import.meta.url), 'utf8');
const reports = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');

test('Performance Analytics prefers Program Library/saved schedule length over imported Program_Minutes', () => {
  assert.match(analytics, /DURATION_MISMATCH_TOLERANCE_MINUTES = 10/);
  assert.match(analytics, /actual_runtime_seconds/);
  assert.match(analytics, /actual_runtime_minutes/);
  assert.match(analytics, /runtime_minutes/);
  assert.match(analytics, /length_bucket_minutes/);
  assert.match(analytics, /durationSource: libraryDuration \? 'program-library'/);
  assert.match(analytics, /Program_Minutes value\(s\) differ from internal Program Library\/schedule length/);
});

test('Performance Analytics short fundraiser ownership falls back to saved date range, not whole pledge season', () => {
  const perfFn = analytics.match(/function airingRecordsForSchedule\([\s\S]*?\n  \}/)?.[0] || '';
  assert.match(perfFn, /key >= start && key <= end/);
  assert.doesNotMatch(perfFn, /record\.season === season/);
});

test('whole-fundraiser rates use all Broadcast dollars over saved pledge hours', () => {
  assert.match(reports, /A\.dollarsPerHour\(analysis\.broadcastDollars, analysis\.scheduledMinutes\)/);
  assert.match(reports, /A\.pledgesPerHour\(analysis\.pledges, analysis\.scheduledMinutes\)/);
  assert.match(reports, /Broadcast \$ \/ pledge hour/);
});

test('historical season rates include Non-Specific Broadcast dollars and distributor aliases normalize', () => {
  const season = A.historicalRanking([{
    schedule: { id: 'm1', title: 'March 2026', season: 'March', startDate: '2026-03-01' },
    scheduledMinutes: 60,
    broadcastDollars: 150,
    placementRows: [{ countsTowardScheduleMinutes: true, known: true, durationMissing: false, minutes: 60, dollars: 100, title: 'Program A' }]
  }], 'season');
  assert.equal(season[0].medianDollarsPerHour, 150);

  const distributors = A.historicalRanking([
    { schedule: { id: 'd1', title: 'Drive 1', season: 'March' }, placementRows: [{ countsTowardScheduleMinutes: true, known: true, durationMissing: false, minutes: 60, dollars: 100, title: 'A', distributor: 'eps tv' }] },
    { schedule: { id: 'd2', title: 'Drive 2', season: 'March' }, placementRows: [{ countsTowardScheduleMinutes: true, known: true, durationMissing: false, minutes: 60, dollars: 200, title: 'B', distributor: 'EPS' }] }
  ], 'distributor', { minAirings: 1, minFundraisers: 1, minTitles: 1 });
  assert.equal(distributors.length, 1);
  assert.equal(distributors[0].key, 'EPS');
  assert.equal(distributors[0].fundraisers, 2);
});

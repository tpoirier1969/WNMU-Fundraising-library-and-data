import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = new URL('../assets/js/ui-analytics.js', import.meta.url);
let source = fs.readFileSync(sourcePath, 'utf8');
const marker = '  App.analyticsUi = { ensureReady, openCohort, reload };';
assert.ok(source.includes(marker), 'analytics export marker must exist');
source = source.replace(marker, `${marker}\n  globalThis.__balancedRateHooks = { fundraiserBalancedRateSummary, pairedStartTimeComparison };`);

const context = {
  window: {
    PledgeLib: { constants: {}, state: {}, data: {}, derive: {}, utils: {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: async () => { throw new Error('network unavailable in balanced-rate tests'); }
  },
  document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {}, createElement: () => ({ innerHTML: '', textContent: '', innerText: '' }) },
  console,
  Date,
  Map,
  Set,
  Promise,
  Number,
  String,
  Math,
  Intl,
  URLSearchParams
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'ui-analytics.js' });
const hooks = context.__balancedRateHooks;

const rec = (scheduleId, title, dollars, durationMinutes, startMinutes = 1200) => ({
  scheduleId,
  scheduleTitle: scheduleId,
  fundraiser: scheduleId,
  title,
  programId: title,
  programOpenId: title,
  dollars,
  pledges: 1,
  durationMinutes,
  startMinutes,
  season: 'August',
  seasonYear: 'August 2026',
  isNonSpecific: false
});

test('fundraiser-balanced rate gives each fundraiser one observation regardless of airing count', () => {
  const rows = [
    rec('drive-a', 'A1', 100, 60),
    rec('drive-a', 'A2', 100, 60),
    rec('drive-a', 'A3', 100, 60),
    rec('drive-a', 'A4', 100, 60),
    rec('drive-b', 'B1', 500, 60)
  ];
  const summary = hooks.fundraiserBalancedRateSummary('slot', rows, { minAirings: 1, minFundraisers: 1, minTitles: 1 });
  assert.equal(summary.fundraiserCount, 2);
  assert.equal(summary.rateAirings, 5);
  assert.equal(summary.medianRate, 300); // median of drive rates 100 and 500, not median airing dollars 100
  assert.equal(summary.averageRate, 300);
  assert.equal(Math.round(summary.pooledRate), 180); // useful volume-weighted context, not the ranking statistic
});

test('a fundraiser with a missing duration is excluded as a partial rate observation', () => {
  const rows = [
    rec('drive-a', 'A1', 100, 60),
    rec('drive-a', 'A2', 100, 0),
    rec('drive-b', 'B1', 400, 60)
  ];
  const summary = hooks.fundraiserBalancedRateSummary('topic', rows, { minAirings: 1, minFundraisers: 1, minTitles: 1 });
  assert.equal(summary.fundraiserCount, 1);
  assert.equal(summary.rateAirings, 1);
  assert.equal(summary.medianRate, 400);
});

test('8 PM vs 9 PM comparison uses only fundraisers containing both rate-valid slots', () => {
  const rows = [
    rec('drive-a', 'A8', 100, 60, 1200), rec('drive-a', 'A9', 200, 60, 1260),
    rec('drive-b', 'B8', 300, 60, 1200), rec('drive-b', 'B9', 150, 60, 1260),
    rec('drive-c', 'C8', 500, 60, 1200)
  ];
  const comparison = hooks.pairedStartTimeComparison(rows, 1200, 1260);
  assert.equal(comparison.pairedFundraisers, 2);
  assert.equal(comparison.firstMedianRate, 200);
  assert.equal(comparison.secondMedianRate, 175);
  assert.equal(comparison.medianDifference, -25);
  assert.equal(comparison.firstWins, 1);
  assert.equal(comparison.secondWins, 1);
  assert.equal(comparison.ties, 0);
});

test('rate-based Performance Analytics questions use saved schedule rows and label pledge-hour statistics', () => {
  const text = fs.readFileSync(sourcePath, 'utf8');
  assert.match(text, /rateBalanced: true/);
  assert.match(text, /source: 'schedule'/);
  assert.match(text, /Median \$ \/ pledge hr/);
  assert.match(text, /pairedStartTimeComparison\(filteredRecordsFor\('startTimes'\), 1200, 1260\)/);
  assert.match(text, /Each fundraiser contributes one rate observation per topic/);
  assert.match(text, /median fundraiser \$ \/ pledge hour/);
});

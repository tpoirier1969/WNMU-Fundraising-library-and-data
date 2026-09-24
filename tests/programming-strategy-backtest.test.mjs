import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../assets/js/programming-strategy-backtest.js', import.meta.url), 'utf8');
const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);
const B = context.WNMUStrategyBacktest;

const schedule = { id:'dec-2025', title:'December 2025', startDate:'2025-12-01', endDate:'2025-12-07' };
const strategy = {
  cutoff:'2025-11-30',
  windows:[
    { experimental:false, blocked:false, recommendations:[
      { programId:'a', title:'Alpha', topic:'Music', score:88, reasons:['Strong history'] },
      { programId:'b', title:'Beta', topic:'Health', score:78 },
      { programId:'c', title:'Gamma', topic:'History', score:68 }
    ]},
    { experimental:true, blocked:false, recommendations:[
      { programId:'a', title:'Alpha', topic:'Music', score:90 },
      { programId:'d', title:'Delta', topic:'Local', score:72 }
    ]}
  ]
};

const actualRows = [
  { programId:'a', title:'Alpha', dateKey:'2025-12-01', minutes:60, dollars:300, pledges:3, known:true, countsTowardScheduleMinutes:true },
  { programId:'a', title:'Alpha', dateKey:'2025-12-03', minutes:60, dollars:100, pledges:1, known:true, countsTowardScheduleMinutes:true },
  { programId:'b', title:'Beta', dateKey:'2025-12-02', minutes:60, dollars:50, pledges:1, known:true, countsTowardScheduleMinutes:true },
  { programId:'z', title:'Zeta', dateKey:'2025-12-04', minutes:60, dollars:500, pledges:4, known:true, countsTowardScheduleMinutes:true },
  { programId:'x', title:'Outside', dateKey:'2025-11-30', minutes:60, dollars:9999, known:true, countsTowardScheduleMinutes:true },
  { programId:'m', title:'Missing Duration', dateKey:'2025-12-05', minutes:0, dollars:9999, known:true, countsTowardScheduleMinutes:true, durationMissing:true }
];

test('aggregates actual outcomes within the fundraiser and excludes unusable rows', () => {
  const outcomes = B.actualTitleOutcomes(actualRows, schedule);
  assert.equal(outcomes.length, 3);
  const alpha = outcomes.find((item) => item.title === 'Alpha');
  assert.equal(alpha.airings, 2);
  assert.equal(alpha.minutes, 120);
  assert.equal(alpha.dollars, 400);
  assert.equal(alpha.rate, 200);
  assert.ok(!outcomes.some((item) => item.title === 'Outside'));
  assert.ok(!outcomes.some((item) => item.title === 'Missing Duration'));
});

test('deduplicates recommendations and keeps the strongest score plus window exposure', () => {
  const rows = B.flattenRecommendations(strategy, 20);
  assert.equal(rows.length, 4);
  const alpha = rows.find((item) => item.title === 'Alpha');
  assert.equal(alpha.score, 90);
  assert.equal(alpha.windows, 2);
  assert.equal(alpha.normalWindows, 1);
  assert.equal(alpha.experimentalWindows, 1);
});

test('backtest treats unaired recommendations as untestable rather than failures', () => {
  const result = B.evaluate({ strategy, actualRows, schedule });
  const gamma = result.recommendationResults.find((item) => item.title === 'Gamma');
  const delta = result.recommendationResults.find((item) => item.title === 'Delta');
  assert.equal(gamma.observed, false);
  assert.equal(delta.observed, false);
  assert.equal(result.summary.untestedRecommendations, 2);
  assert.equal(result.summary.testedRecommendations, 2);
});

test('backtest exposes strong actual performers the recommendation set missed', () => {
  const result = B.evaluate({ strategy, actualRows, schedule });
  assert.ok(result.topActual.some((item) => item.title === 'Zeta'));
  assert.ok(result.missedTopPerformers.some((item) => item.title === 'Zeta'));
  assert.equal(result.topActual.find((item) => item.title === 'Zeta').recommended, false);
});

test('backtest verifies the evidence cutoff is no later than the day before the drive', () => {
  const safe = B.evaluate({ strategy, actualRows, schedule });
  assert.equal(safe.expectedCutoff, '2025-11-30');
  assert.equal(safe.leakageSafe, true);

  const leaky = B.evaluate({ strategy:{...strategy, cutoff:'2025-12-03'}, actualRows, schedule });
  assert.equal(leaky.leakageSafe, false);
});

test('score/rate correlation stays null when fewer than three recommendations were actually aired', () => {
  const result = B.evaluate({ strategy, actualRows, schedule });
  assert.equal(result.summary.scoreRateCorrelation, null);
});

test('zero-dollar titles are not counted as above-median or top-quartile hits when the drive median is zero', () => {
  const zeroSchedule = { id:'zero-drive', title:'Zero-heavy drive', startDate:'2025-12-01', endDate:'2025-12-03' };
  const zeroStrategy = {
    cutoff:'2025-11-30',
    windows:[{ experimental:false, blocked:false, recommendations:[
      { programId:'a', title:'Alpha Zero', topic:'Music', score:80 },
      { programId:'b', title:'Beta Winner', topic:'Music', score:70 }
    ]}]
  };
  const rows = [
    { programId:'a', title:'Alpha Zero', dateKey:'2025-12-01', minutes:60, dollars:0, known:true, countsTowardScheduleMinutes:true },
    { programId:'b', title:'Beta Winner', dateKey:'2025-12-02', minutes:60, dollars:100, known:true, countsTowardScheduleMinutes:true },
    { programId:'c', title:'Gamma Zero', dateKey:'2025-12-03', minutes:60, dollars:0, known:true, countsTowardScheduleMinutes:true }
  ];
  const result = B.evaluate({ strategy:zeroStrategy, actualRows:rows, schedule:zeroSchedule });
  assert.equal(result.drive.medianTitleRate, 0);
  const alpha = result.recommendationResults.find((item) => item.title === 'Alpha Zero');
  const beta = result.recommendationResults.find((item) => item.title === 'Beta Winner');
  assert.equal(alpha.aboveMedian, false);
  assert.equal(alpha.topQuartile, false);
  assert.equal(beta.aboveMedian, true);
  assert.equal(beta.topQuartile, true);
  assert.ok(!result.topActual.some((item) => item.title === 'Alpha Zero'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = new URL('../assets/js/ui-fundraiser-comparison.js', import.meta.url);
let source = fs.readFileSync(sourcePath, 'utf8');
const exportMarker = '  App.fundraiserComparisonUi = { ensureReady };';
assert.ok(source.includes(exportMarker), 'comparison test export marker must exist');
source = source.replace(exportMarker, `${exportMarker}\n  globalThis.__comparisonTestHooks = { daypartLabel, overallRevenueDecomposition, comparisonChannelPolicy, comparableTotalForPolicy, topicRevenueDecomposition, subtopicRevenueDecomposition, placementResult, analyzeSchedule, alignedDailyContextRows, fundraiserDayOffset, fundraiserDayLabel, dailyContextAnalyses, weatherDateIsFetchable, medianValue, outlierSummary, groupStrength, pledgeWeatherWindowForDate, stationPledgeWindowSummaries, setAirings: (rows) => { state.airings = rows; state.analysisCache.clear(); } };`);

const context = {
  window: {
    PledgeLib: {
      state: {},
      data: {},
      derive: {},
      utils: {}
    }
  },
  document: { getElementById: () => null, querySelector: () => null },
  console,
  Date,
  Map,
  Set,
  URLSearchParams,
  Promise,
  Number,
  String,
  Math,
  Intl,
  fetch: async () => { throw new Error('network is not available in comparison unit tests'); }
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'ui-fundraiser-comparison.js' });
const hooks = context.__comparisonTestHooks;

function nearlyEqual(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test('WNMU daypart boundaries use half-hour pledge slots', () => {
  assert.equal(hooks.daypartLabel(390), 'Overnight');
  assert.equal(hooks.daypartLabel(420), 'Morning');
  assert.equal(hooks.daypartLabel(690), 'Morning');
  assert.equal(hooks.daypartLabel(720), 'Afternoon');
  assert.equal(hooks.daypartLabel(990), 'Afternoon');
  assert.equal(hooks.daypartLabel(1020), 'Early evening');
  assert.equal(hooks.daypartLabel(1170), 'Early evening');
  assert.equal(hooks.daypartLabel(1200), 'Prime');
  assert.equal(hooks.daypartLabel(1320), 'Prime');
  assert.equal(hooks.daypartLabel(1350), 'Overnight');
});

test('whole-drive hours and performance effects reconcile to Broadcast change', () => {
  const base = { scheduledMinutes: 46 * 60, broadcastDollars: 1909 };
  const current = { scheduledMinutes: 67 * 60, broadcastDollars: 7587 };
  const result = hooks.overallRevenueDecomposition(base, current);
  assert.equal(result.difference, 5678);
  nearlyEqual(result.hoursEffect + result.rateEffect + result.residual, result.difference);
  nearlyEqual(result.residual, 0);
});

test('channel comparison excludes Online or Mail unless every selected fundraiser tracked it', () => {
  const onlineOnly = hooks.comparisonChannelPolicy([
    { onlineTracked: true, mailTracked: true },
    { onlineTracked: true, mailTracked: false }
  ]);
  assert.equal(onlineOnly.includeOnline, true);
  assert.equal(onlineOnly.includeMail, false);

  const mailOnly = hooks.comparisonChannelPolicy([
    { onlineTracked: true, mailTracked: true },
    { onlineTracked: false, mailTracked: true }
  ]);
  assert.equal(mailOnly.includeOnline, false);
  assert.equal(mailOnly.includeMail, true);
});

test('comparable total follows the selected-set channel policy', () => {
  const analysis = { broadcastDollars: 1000, onlineDollars: 200, mailDollars: 300 };
  assert.equal(hooks.comparableTotalForPolicy(analysis, { includeOnline: false, includeMail: false }), 1000);
  assert.equal(hooks.comparableTotalForPolicy(analysis, { includeOnline: true, includeMail: false }), 1200);
  assert.equal(hooks.comparableTotalForPolicy(analysis, { includeOnline: true, includeMail: true }), 1500);
});

test('explicit manual zero remains a known result while a missing result remains unknown', () => {
  const used = new Set();
  const manualZero = hooks.placementResult({ manualResultRecorded: true, manualBroadcastDollars: 0, manualPledgeCount: 0 }, used);
  assert.equal(manualZero.known, true);
  assert.equal(manualZero.dollars, 0);
  assert.equal(manualZero.source, 'manual');

  const missing = hooks.placementResult({}, new Set());
  assert.equal(missing.known, false);
  assert.equal(missing.source, 'none');
});

test('topic decomposition reconciles length, share, and rate effects', () => {
  const base = { scheduledMinutes: 40 * 60 };
  const current = { scheduledMinutes: 50 * 60 };
  const topicBase = { minutes: 8 * 60, dollars: 1600 };
  const topicCurrent = { minutes: 15 * 60, dollars: 3900 };
  const result = hooks.topicRevenueDecomposition(base, current, topicBase, topicCurrent);
  nearlyEqual(result.length + result.share + result.rate + result.residual, result.difference);
});

test('subtopic decomposition reconciles length, topic allocation, subtopic mix, and rate', () => {
  const base = { scheduledMinutes: 40 * 60 };
  const current = { scheduledMinutes: 50 * 60 };
  const topicBase = { minutes: 8 * 60, dollars: 1600 };
  const topicCurrent = { minutes: 15 * 60, dollars: 3900 };
  const subtopicBase = { minutes: 3 * 60, dollars: 750 };
  const subtopicCurrent = { minutes: 8 * 60, dollars: 2400 };
  const result = hooks.subtopicRevenueDecomposition(base, current, topicBase, topicCurrent, subtopicBase, subtopicCurrent);
  nearlyEqual(result.length + result.topicShare + result.subtopicShare + result.rate + result.residual, result.difference);
});


test('corresponding fundraiser days align to the first Saturday and preserve Friday as day -1', () => {
  const makeAnalysis = (startDate, dates) => ({
    schedule: { startDate },
    placementRows: dates.map((dateKey) => ({ dateKey, startMinutes: 420, title: 'Test program', topic: 'Test', secondary: 'Unspecified', daypart: 'Morning', minutes: 60, known: true, dollars: 100, pledges: 1 }))
  });
  const fridayStart = makeAnalysis('2026-08-07', ['2026-08-07', '2026-08-08', '2026-08-09', '2026-08-15']);
  const saturdayStart = makeAnalysis('2025-08-09', ['2025-08-09', '2025-08-10', '2025-08-16']);
  const rows = hooks.alignedDailyContextRows([fridayStart, saturdayStart]);
  assert.deepEqual(Array.from(rows, (row) => row.offset), [-1, 0, 1, 7]);
  assert.equal(rows.find((row) => row.offset === -1).days[0].dateKey, '2026-08-07');
  assert.equal(rows.find((row) => row.offset === -1).days[1], null);
  assert.equal(rows.find((row) => row.offset === 0).days[0].dateKey, '2026-08-08');
  assert.equal(rows.find((row) => row.offset === 0).days[1].dateKey, '2025-08-09');
  assert.equal(rows.find((row) => row.offset === 1).days[0].dateKey, '2026-08-09');
  assert.equal(rows.find((row) => row.offset === 1).days[1].dateKey, '2025-08-10');
  assert.equal(rows.find((row) => row.offset === 7).days[0].dateKey, '2026-08-15');
  assert.equal(rows.find((row) => row.offset === 7).days[1].dateKey, '2025-08-16');
  assert.equal(hooks.fundraiserDayLabel(-1).detail, 'Day -1 · pre-Saturday start');
  assert.equal(hooks.fundraiserDayLabel(0).title, '1st Saturday');
  assert.equal(hooks.fundraiserDayLabel(1).title, '1st Sunday');
  assert.equal(hooks.fundraiserDayLabel(7).title, '2nd Saturday');
});


test('daily context omits selected fundraisers with no scheduled pledge programming', () => {
  const empty = { schedule: { startDate: '2027-08-07' }, placementRows: [] };
  const one = { schedule: { startDate: '2026-08-08' }, placementRows: [{ dateKey: '2026-08-08', startMinutes: 420, title: 'A', topic: 'Test', secondary: 'Unspecified', daypart: 'Morning', minutes: 60, known: true, dollars: 100, pledges: 1 }] };
  const two = { schedule: { startDate: '2025-08-09' }, placementRows: [{ dateKey: '2025-08-09', startMinutes: 420, title: 'B', topic: 'Test', secondary: 'Unspecified', daypart: 'Morning', minutes: 60, known: true, dollars: 100, pledges: 1 }] };
  const filtered = hooks.dailyContextAnalyses([empty, one, two]);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0], one);
  assert.equal(filtered[1], two);
});

test('weather fetchability treats far-future fundraiser dates as not available yet', () => {
  const now = new Date(2026, 7, 21);
  assert.equal(hooks.weatherDateIsFetchable('2026-08-30', now), true);
  assert.equal(hooks.weatherDateIsFetchable('2027-03-13', now), false);
  assert.equal(hooks.weatherDateIsFetchable('2025-08-09', now), true);
});


test('median average and MAD outlier flag preserve an unusual high result', () => {
  const values = [0, 150, 240, 310, 2400];
  assert.equal(hooks.medianValue(values), 240);
  const strength = hooks.groupStrength({ results: values });
  assert.equal(strength.avg, 620);
  assert.equal(strength.median, 240);
  assert.equal(strength.outlierCount, 1);
  assert.equal(strength.highOutliers, 1);
  assert.deepEqual(Array.from(strength.outlierValues), [2400]);
});

test('pledge weather windows use weekday evenings and weekend 3 PM starts', () => {
  const monday = hooks.pledgeWeatherWindowForDate('2026-08-10');
  const saturday = hooks.pledgeWeatherWindowForDate('2026-08-08');
  assert.equal(monday.startHour, 17);
  assert.equal(monday.endHourExclusive, 24);
  assert.equal(saturday.startHour, 15);
  assert.equal(saturday.endHourExclusive, 24);
});

test('hourly weather aggregation excludes hours outside the pledge window', () => {
  const summaries = hooks.stationPledgeWindowSummaries({
    time: ['2026-08-10T10:00', '2026-08-10T17:00', '2026-08-10T18:00', '2026-08-10T23:00'],
    temperature_2m: [90, 60, 64, 68],
    precipitation: [9, 0.01, 0.02, 0.03]
  });
  const day = summaries.get('2026-08-10');
  assert.ok(day);
  assert.equal(day.avgTemp, 64);
  nearlyEqual(day.precip, 0.06);
  assert.equal(day.windowLabel, '5 PM-midnight');
});


test('corresponding fundraiser alignment uses actual pledge placement sequence even when saved start date is stale', () => {
  const analysis = {
    schedule: { startDate: '2026-08-01' },
    placementRows: ['2026-08-21', '2026-08-22', '2026-08-23'].map((dateKey) => ({ dateKey, startMinutes: 420, title: 'Test', topic: 'Test', secondary: 'Unspecified', daypart: 'Morning', minutes: 60, known: true, dollars: 100, pledges: 1 }))
  };
  assert.equal(hooks.fundraiserDayOffset(analysis, { dateKey: '2026-08-21' }), -1);
  assert.equal(hooks.fundraiserDayOffset(analysis, { dateKey: '2026-08-22' }), 0);
  assert.equal(hooks.fundraiserDayOffset(analysis, { dateKey: '2026-08-23' }), 1);
});

test('daily context starts at the pre-Saturday Friday at earliest and omits unmatched tail days', () => {
  const makeAnalysis = (startDate, dates) => ({
    schedule: { startDate },
    placementRows: dates.map((dateKey) => ({ dateKey, startMinutes: 420, title: 'Test', topic: 'Test', secondary: 'Unspecified', daypart: 'Morning', minutes: 60, known: true, dollars: 100, pledges: 1 }))
  });
  const longer = makeAnalysis('2026-08-01', ['2026-08-17', '2026-08-21', '2026-08-22', '2026-08-23', '2026-08-29', '2026-09-05']);
  const peer = makeAnalysis('2025-08-08', ['2025-08-08', '2025-08-09', '2025-08-10', '2025-08-16']);
  const rows = hooks.alignedDailyContextRows([longer, peer]);
  assert.deepEqual(Array.from(rows, (row) => row.offset), [-1, 0, 1, 7]);
});


test('same-day imported report coverage turns an omitted scheduled title into a completed zero', () => {
  const importedRows = [{ id: 'reported', air_date: '2026-08-08', air_time: '20:00', program_title: 'Reported Program', dollars: 500, pledge_count: 2 }];
  const zero = hooks.placementResult({ dateKey: '2026-08-08', startMinutes: 1260, programTitle: 'Scheduled But Missing' }, new Set(), importedRows);
  assert.equal(zero.known, true);
  assert.equal(zero.dollars, 0);
  assert.equal(zero.source, 'report-day-zero');

  const pending = hooks.placementResult({ dateKey: '2026-08-09', startMinutes: 1260, programTitle: 'Not Reported Yet' }, new Set(), importedRows);
  assert.equal(pending.known, false);
  assert.equal(pending.source, 'none');
});

test('unique imported date and time wins even when the planned title differs', () => {
  const importedRows = [{ id: 'actual', air_date: '2026-08-08', air_time: '20:00', imported_program_title: 'Actual Program', program_title: 'Actual Program', dollars: 725, pledge_count: 3 }];
  const result = hooks.placementResult({ dateKey: '2026-08-08', startMinutes: 1200, programTitle: 'Planned Program' }, new Set(), importedRows);
  assert.equal(result.source, 'report');
  assert.equal(result.dollars, 725);
  assert.equal(result.actualDateKey, '2026-08-08');
  assert.equal(result.actualStartMinutes, 1200);
  assert.equal(result.actualTitle, 'Actual Program');
});

test('imported fundraiser dates establish the historical first-Saturday anchor', () => {
  hooks.setAirings([
    { id: 'f', air_date: '2026-08-21', air_time: '20:00', program_title: 'Friday Actual', dollars: 100 },
    { id: 's', air_date: '2026-08-22', air_time: '20:00', program_title: 'Saturday Actual', dollars: 200 }
  ]);
  const analysis = {
    schedule: { title: 'August 2026', startDate: '2026-08-01', season: 'August', year: 2026, placements: [] },
    placementRows: [{ dateKey: '2026-08-08', startMinutes: 420, title: 'Stale scheduled day', topic: 'Test', secondary: 'Unspecified', daypart: 'Morning', minutes: 60, known: false, dollars: 0, pledges: 0 }]
  };
  assert.equal(hooks.fundraiserDayOffset(analysis, { dateKey: '2026-08-21' }), -1);
  assert.equal(hooks.fundraiserDayOffset(analysis, { dateKey: '2026-08-22' }), 0);
  hooks.setAirings([]);
});

test('raw imported Broadcast dollars override stale saved fundraiser totals', () => {
  hooks.setAirings([{ id: 'r1', air_date: '2026-08-08', air_time: '20:00', program_title: 'Actual Program', dollars: 500, pledge_count: 2 }]);
  const analysis = hooks.analyzeSchedule({
    id: 's1',
    title: 'August 2026',
    startDate: '2026-08-08',
    season: 'August',
    year: 2026,
    meta: { reportedBroadcastTotalDollars: 9999 },
    placements: [{ id: 'p1', dateKey: '2026-08-08', startMinutes: 1200, endMinutes: 1260, programTitle: 'Planned Program' }]
  });
  assert.equal(analysis.broadcastDollars, 500);
  assert.equal(analysis.attributableDollars, 500);
  assert.equal(analysis.placementRows[0].title, 'Actual Program');
  hooks.setAirings([]);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/one-sheet-analysis.js', import.meta.url), 'utf8');
const sandbox = { console, Date, Map, Set, Math, Number, String, Array, Object, RegExp };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const A = sandbox.WNMUOneSheetAnalysis;
assert.ok(A, 'analysis API should load');

{
  const placement = {
    dateKey: '2026-08-08',
    startMinutes: 1260,
    programId: 'missing',
    programTitle: 'Scheduled But Missing',
    importedBroadcastDollars: 840,
    importedFromReport: true
  };
  const importedRows = [
    { id: 'actual', air_date: '2026-08-08', air_time: '20:00', program_id: 'other', program_title: 'Actual Program', dollars: 500, pledge_count: 2 }
  ];
  const result = A.placementResult(placement, new Set(), importedRows, A.buildLibraryIndexes([]));
  assert.equal(result.source, 'report-day-zero', 'current report-day evidence must beat stale attached imported dollars');
  assert.equal(result.dollars, 0);
}

{
  const days = A.calendarDays({
    placementRows: [
      {
        dateKey: '2026-08-08', countsTowardScheduleMinutes: true, minutes: 60,
        known: true, durationMissing: false, dollars: 100, pledges: 2,
        startMinutes: 1200, endMinutes: 1260
      },
      {
        dateKey: '2026-08-08', countsTowardScheduleMinutes: true, minutes: 60,
        known: false, durationMissing: false, dollars: 0, pledges: 0,
        startMinutes: 1260, endMinutes: 1320
      }
    ]
  });
  assert.equal(days.length, 1);
  assert.equal(days[0].minutes, 120, 'scheduled pledge hours remain factual schedule hours');
  assert.equal(days[0].rateMinutes, 60, 'rate denominator includes only observations eligible for the rate numerator');
  assert.equal(days[0].dollarsPerHour, 100, 'unknown hours must not dilute completed dollars-per-hour');
  assert.equal(days[0].pledgesPerHour, 2);
}

{
  const schedule = {
    id: 'case-test', title: 'August 2026', startDate: '2026-08-08', endDate: '2026-08-08',
    placements: [
      {
        id: 'a', dateKey: '2026-08-08', startMinutes: 1200, lengthMinutes: 60,
        programId: 'a', programTitle: 'A', topicPrimary: 'Music',
        manualResultRecorded: true, manualBroadcastDollars: 100, manualPledgeCount: 1
      },
      {
        id: 'b', dateKey: '2026-08-08', startMinutes: 1260, lengthMinutes: 60,
        programId: 'b', programTitle: 'B', topicPrimary: 'MuSiC',
        manualResultRecorded: true, manualBroadcastDollars: 200, manualPledgeCount: 2
      }
    ], onlineTracked: false, mailTracked: false
  };
  const analysis = A.analyzeSchedule(schedule, [], A.buildLibraryIndexes([]));
  assert.equal(analysis.topics.size, 1, 'topic identity must be case-insensitive');
  const topic = [...analysis.topics.values()][0];
  assert.equal(topic.minutes, 120);
  assert.equal(topic.dollars, 300);
  assert.equal(topic.rateMinutes, 120);
  const comparison = A.topicComparisonRows([analysis]);
  assert.equal(comparison.length, 1);
  assert.equal(comparison[0].values[0].dollarsPerHour, 150);
}

{
  const sundayOnly = {
    schedule: { id: 'aug-2021', title: 'Aug 15, 2021 - Aug 15, 2021', startDate: '2021-08-15', endDate: '2021-08-15' },
    importedRows: [{ air_date: '2021-08-15' }],
    placementRows: [{
      dateKey: '2021-08-15', countsTowardScheduleMinutes: false, minutes: 60,
      known: true, durationMissing: false, dollars: 4321, pledges: 12,
      startMinutes: 1080, endMinutes: 1140
    }]
  };
  const anchor = A.firstSaturdayAnchor(sundayOnly);
  assert.equal(anchor?.getFullYear(), 2021);
  assert.equal(anchor?.getMonth(), 7);
  assert.equal(anchor?.getDate(), 14, 'a fundraiser with no Saturday in its saved range anchors to the preceding Saturday');
  assert.equal(A.fundraiserDayOffset(sundayOnly, { dateKey: '2021-08-15' }), 1, 'Sunday-only fundraiser must align as 1st Sunday, not be discarded as Day -6');
  const aligned = A.alignedDailyRows([sundayOnly]);
  assert.equal(aligned.length, 1);
  assert.equal(aligned[0].offset, 1);
  assert.equal(aligned[0].label.title, '1st Sunday');
  assert.equal(aligned[0].days[0].dollars, 4321, 'Sunday-only fundraiser daily dollars must survive alignment');
}

{
  const april = {
    schedule: { id: 'april', startDate: '2016-04-30' },
    importedRows: [],
    placementRows: [{ dateKey: '2016-04-30' }]
  };
  const may = {
    schedule: { id: 'may', startDate: '2021-05-01' },
    importedRows: [],
    placementRows: [{ dateKey: '2021-05-01' }]
  };
  const offsets = A.firstSaturdaySeasonalOffsets([april, may]);
  assert.equal(offsets[0].daysFromEarliest, 0);
  assert.equal(offsets[1].daysFromEarliest, 1, 'seasonal displacement must use real calendar spacing across month boundaries');
}

{
  const analyses = [];
  for (let index = 0; index < 5; index += 1) {
    analyses.push({
      schedule: { id: 'valid-drive', title: 'Valid Drive' },
      placementRows: [{
        dateKey: `2026-08-${String(8 + index).padStart(2, '0')}`,
        startMinutes: 1200, minutes: 60, durationMissing: false, known: true,
        title: 'Same Valid Title', dollars: 100 + index, pledges: 1
      }]
    });
  }
  analyses.push({
    schedule: { id: 'missing-drive-1', title: 'Missing Drive 1' },
    placementRows: [{
      dateKey: '2025-08-09', startMinutes: 1200, minutes: 0, durationMissing: true,
      known: true, title: 'Missing Title 1', dollars: 500, pledges: 2
    }]
  });
  analyses.push({
    schedule: { id: 'missing-drive-2', title: 'Missing Drive 2' },
    placementRows: [{
      dateKey: '2024-08-10', startMinutes: 1200, minutes: 0, durationMissing: true,
      known: true, title: 'Missing Title 2', dollars: 600, pledges: 2
    }]
  });

  const ranking = A.historicalRanking(analyses, 'startTime');
  assert.equal(ranking.length, 0, 'missing-duration rows must not supply fundraiser/title diversity for start-time qualification');
}

{
  const analyses = Array.from({ length: 5 }, (_unused, index) => ({
    schedule: { id: `start-audit-${index}`, title: `Start Audit ${index}` },
    placementRows: [
      {
        dateKey: `2026-08-${String(10 + index).padStart(2, '0')}`,
        startMinutes: 1200, minutes: 60, durationMissing: false, known: true,
        title: `Scheduled 8 PM ${index}`, dollars: 100 + index, pledges: 1,
        unmatchedImported: false
      },
      {
        dateKey: `2026-08-${String(10 + index).padStart(2, '0')}`,
        startMinutes: 1260, minutes: 60, durationMissing: false, known: true,
        title: `Unmatched 9 PM ${index}`, dollars: 1000 + index, pledges: 5,
        unmatchedImported: true, source: 'report-unmatched'
      }
    ]
  }));
  const ranking = A.historicalRanking(analyses, 'startTime');
  const eightPm = ranking.find((row) => row.key === '1200');
  assert.equal(eightPm?.rateAirings, 5, 'schedule-reconciled start-time rows remain eligible');
  assert.equal(ranking.some((row) => row.key === '1260'), false, 'unmatched imported rows must not qualify or influence historical start-time rankings');
}

{
  const schedule = {
    id: 'tooltip-day-scope', title: 'Aug 16, 2019–Aug 29, 2019', startDate: '2019-08-16', endDate: '2019-08-29',
    placements: [
      { dateKey: '2019-08-22', startMinutes: 1200, lengthMinutes: 60, programId: 'thu', programTitle: 'Planned Thursday Title' },
      { dateKey: '2019-08-23', startMinutes: 1200, lengthMinutes: 60, programId: 'fri', programTitle: 'Planned Friday Title' }
    ], onlineTracked: false, mailTracked: false
  };
  const airings = [
    { row_hash: 'thu-row', air_date: '2019-08-22', air_time: '20:00', program_id: 'thu', imported_program_title: 'Actual Thursday Title', dollars: 2701, pledge_count: 10 },
    { row_hash: 'fri-row', air_date: '2019-08-23', air_time: '20:00', program_id: 'fri', imported_program_title: 'Actual Friday Title', dollars: 999, pledge_count: 3 }
  ];
  const analysis = A.analyzeSchedule(schedule, airings, A.buildLibraryIndexes([
    { id: 'thu', title: 'Thursday Library Title', length_bucket_minutes: 60 },
    { id: 'fri', title: 'Friday Library Title', length_bucket_minutes: 60 }
  ]));
  const thursdayRows = analysis.placementRows.filter((row) => row.dateKey === '2019-08-22');
  assert.deepEqual(Array.from(thursdayRows, (row) => row.title), ['Actual Thursday Title'], 'the plotted Thursday must use the actual imported Thursday title');
  assert.equal(thursdayRows.some((row) => row.title === 'Actual Friday Title'), false, 'adjacent fundraiser-day titles must never leak into the Thursday popup');
  assert.equal(thursdayRows.reduce((sum, row) => sum + Number(row.dollars || 0), 0), 2701, 'the program lines for the plotted Thursday must reconcile to that day’s Broadcast point');
}

{
  const seasonAnalyses = [
    { schedule: { id: 'june-a', title: 'June A', season: 'June', startDate: '2024-06-01' }, broadcastDollars: 1000, placementRows: [{ known: true, durationMissing: false, countsTowardScheduleMinutes: true, minutes: 600, dollars: 1000, title: 'A' }] },
    { schedule: { id: 'june-b', title: 'June B', season: 'June', startDate: '2025-06-01' }, broadcastDollars: 300, placementRows: [{ known: true, durationMissing: false, countsTowardScheduleMinutes: true, minutes: 60, dollars: 300, title: 'B' }] },
    { schedule: { id: 'june-c', title: 'June C', season: 'June', startDate: '2026-06-01' }, broadcastDollars: 500, placementRows: [{ known: true, durationMissing: false, countsTowardScheduleMinutes: true, minutes: 60, dollars: 500, title: 'C' }] }
  ];
  const season = A.historicalRanking(seasonAnalyses, 'season', { minFundraisers: 1 });
  assert.equal(season.length, 1);
  assert.equal(season[0].medianDollarsPerHour, 300, 'season median must be the median of fundraiser-level $/hr values');
  assert.equal(season[0].averageDollarsPerHour, 300, 'season average must give each fundraiser equal weight rather than weighting by pledge hours');
  assert.equal(season[0].fundraisers, 3);
}

const reportSource = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');
const reportHarnessSource = reportSource.replace("  document.addEventListener('DOMContentLoaded', () => { void init(); }, { once: true });", "  globalThis.__reportHarness = { lineChartSvg, CHART_STYLES };");
const reportSandbox = { console, window: {}, document: { addEventListener() {} }, Date, Map, Set, Math, Number, String, Array, Object, RegExp };
vm.createContext(reportSandbox);
vm.runInContext(reportHarnessSource, reportSandbox);
assert.ok(reportSandbox.__reportHarness?.lineChartSvg, 'report chart harness should expose lineChartSvg');
assert.equal(reportSandbox.__reportHarness.CHART_STYLES.length, 5);
const monochromeStyles = reportSandbox.__reportHarness.CHART_STYLES.map((style) => `${style.dash}|${style.width}`);
assert.equal(new Set(monochromeStyles).size, 5, 'all five series must remain distinguishable when color is removed');
const overlapHtml = reportSandbox.__reportHarness.lineChartSvg({
  labels: ['1st Saturday'],
  series: [
    { label: 'Fundraiser A', values: [1000], tooltips: [{ title: 'Aug 5, 2017 · 1st Saturday', detail: '$1,000 Broadcast', lines: ['Program A — $1,000'] }] },
    { label: 'Fundraiser B', values: [1000], tooltips: [{ title: 'Aug 17, 2019 · 1st Saturday', detail: '$1,000 Broadcast', lines: ['Program B — $1,000'] }] }
  ]
});
const overlapPayloads = [...overlapHtml.matchAll(/data-chart-tooltip="([^"]+)"/g)].map((match) => JSON.parse(decodeURIComponent(match[1])));
assert.equal(overlapPayloads.length, 2, 'both touching markers should remain interactive');
assert.equal(overlapPayloads[0].sections?.length, 2, 'hovering either touching marker should expose both point payloads');
assert.deepEqual(Array.from(overlapPayloads[0].sections, (section) => section.title), ['Aug 5, 2017 · 1st Saturday', 'Aug 17, 2019 · 1st Saturday']);
assert.match(reportSource, /Rate-eligible hours/);
assert.match(reportSource, /rate base/);
assert.match(reportSource, /Topic attribution:/);
assert.match(reportSource, /Regional weather/);
assert.match(reportSource, /function nonSpecificSummary/);
assert.match(reportSource, /filter\(\(row\) => !rowIsNonSpecific\(row\)\)/);
assert.match(reportSource, /Non-Specific Pledges are shown as their own giving category/);
assert.match(reportSource, /not tied to a specific program/);
assert.match(reportSource, /unknown results and airings with missing duration/);

console.log('one-sheet analytics hardening tests passed');

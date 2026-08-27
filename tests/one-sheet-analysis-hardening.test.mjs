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

console.log('one-sheet analytics hardening tests passed');

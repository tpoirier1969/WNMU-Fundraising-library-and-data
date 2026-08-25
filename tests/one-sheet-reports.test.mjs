import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/one-sheet-analysis.js', import.meta.url), 'utf8');
const sandbox = { console, Date, Map, Set, Math, Number, String, Array, Object, RegExp };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const A = sandbox.WNMUOneSheetAnalysis;
assert.ok(A, 'analysis API should load');

function schedule(overrides = {}) {
  return {
    id: 's1', title: 'August 2026', startDate: '2026-08-28', endDate: '2026-09-06', season: 'August', year: 2026,
    placements: [], onlineDollars: 0, mailDollars: 0, onlineTracked: false, mailTracked: false, meta: {}, ...overrides
  };
}

function placement(overrides = {}) {
  return {
    id: 'p1', dateKey: '2026-08-29', startMinutes: 1200, lengthMinutes: 60,
    programId: 'music-1', programTitle: 'Music Special', ...overrides
  };
}

const indexes = A.buildLibraryIndexes([
  { id: 'music-1', title: 'Music Special', nola_code: 'MUS1', topic_primary: 'Music', topic_secondary: 'Concert' },
  { id: 'hist-1', title: 'History Special', nola_code: 'HIS1', topic_primary: 'History', topic_secondary: 'American History' }
]);

{
  const s = schedule({ placements: [
    placement({ id: 'p1', startMinutes: 1200, lengthMinutes: 60 }),
    placement({ id: 'p2', startMinutes: 1260, lengthMinutes: 60, programId: 'hist-1', programTitle: 'History Special' })
  ] });
  const rows = [
    { id: 'r1', air_date: '2026-08-29', air_time: '20:00', program_id: 'music-1', dollars: 300, pledge_count: 3, program_minutes: 60 },
    { id: 'r2', air_date: '2026-08-29', air_time: '21:00', program_id: 'hist-1', dollars: 100, pledge_count: 1, program_minutes: 60 }
  ];
  const analysis = A.analyzeSchedule(s, rows, indexes);
  assert.equal(analysis.broadcastDollars, 400);
  assert.equal(analysis.scheduledMinutes, 120);
  assert.equal(A.dollarsPerHour(analysis.broadcastDollars, analysis.scheduledMinutes), 200);
  assert.equal(A.pledgesPerHour(analysis.pledges, analysis.scheduledMinutes), 2);
  assert.equal(A.dollarsPerPledge(analysis.broadcastDollars, analysis.pledges), 100);
}

{
  const s = schedule({ placements: [placement({ manualResultRecorded: true, manualBroadcastDollars: 999, manualPledgeCount: 99 })] });
  const rows = [{ id: 'r1', air_date: '2026-08-29', air_time: '20:00', program_id: 'music-1', dollars: 125, pledge_count: 2, program_minutes: 60 }];
  const analysis = A.analyzeSchedule(s, rows, indexes);
  assert.equal(analysis.attributableDollars, 125, 'imported result should override stale manual result');
  assert.equal(analysis.attributablePledges, 2);
}

{
  const s = schedule({ placements: [
    placement({ id: 'p1' }),
    placement({ id: 'p2', startMinutes: 1260, programId: 'hist-1', programTitle: 'History Special' })
  ] });
  const rows = [{ id: 'r1', air_date: '2026-08-29', air_time: '20:00', program_id: 'music-1', dollars: 200, pledge_count: 2, program_minutes: 60 }];
  const analysis = A.analyzeSchedule(s, rows, indexes);
  const history = analysis.placementRows.find((row) => row.topic === 'History');
  assert.ok(history?.known, 'missing scheduled title on a populated imported day should be a known zero');
  assert.equal(history.dollars, 0);
}

{
  const a2024 = A.analyzeSchedule(schedule({
    id: '2024', title: 'August 2024', startDate: '2024-08-09', endDate: '2024-08-18', year: 2024,
    placements: [placement({ dateKey: '2024-08-10' })]
  }), [{ id: 'a', air_date: '2024-08-10', air_time: '20:00', program_id: 'music-1', dollars: 100, pledge_count: 1, program_minutes: 60 }], indexes);
  const a2026 = A.analyzeSchedule(schedule({
    id: '2026', title: 'August 2026', startDate: '2026-08-28', endDate: '2026-09-06', year: 2026,
    placements: [placement({ dateKey: '2026-08-29' })]
  }), [{ id: 'b', air_date: '2026-08-29', air_time: '20:00', program_id: 'music-1', dollars: 100, pledge_count: 1, program_minutes: 60 }], indexes);
  const timing = A.firstSaturdaySeasonalOffsets([a2024, a2026]);
  assert.equal(timing[0].daysFromEarliest, 0);
  assert.equal(timing[1].daysFromEarliest, 19, 'seasonal calendar displacement should survive first-Saturday alignment');
  const aligned = A.alignedDailyRows([a2024, a2026]);
  assert.equal(aligned[0].offset, 0);
  assert.equal(aligned[0].label.title, '1st Saturday');
}

{
  const a1 = A.analyzeSchedule(schedule({ id: 'a1', placements: [
    placement({ id: 'm', lengthMinutes: 120 }),
    placement({ id: 'h', startMinutes: 1320, lengthMinutes: 60, programId: 'hist-1', programTitle: 'History Special' })
  ] }), [
    { id: 'm1', air_date: '2026-08-29', air_time: '20:00', program_id: 'music-1', dollars: 600, pledge_count: 6, program_minutes: 120 },
    { id: 'h1', air_date: '2026-08-29', air_time: '22:00', program_id: 'hist-1', dollars: 100, pledge_count: 1, program_minutes: 60 }
  ], indexes);
  const topicRows = A.topicComparisonRows([a1]);
  const music = topicRows.find((row) => row.key === 'Music').values[0];
  assert.equal(music.minutes, 120);
  assert.equal(music.share, 2 / 3);
  assert.equal(music.dollarsPerHour, 300);
  assert.equal(music.pledgesPerHour, 3);
}

{
  const base = { broadcastDollars: 1000, onlineDollars: 100, mailDollars: 50, onlineTracked: true, mailTracked: true };
  const current = { broadcastDollars: 1200, onlineDollars: 0, mailDollars: 40, onlineTracked: false, mailTracked: true };
  const policy = A.comparisonChannelPolicy([base, current]);
  assert.equal(policy.includeOnline, false);
  assert.equal(policy.includeMail, true);
  assert.equal(A.comparableTotal(base, policy), 1050);
  assert.equal(A.comparableTotal(current, policy), 1240);
}

{
  const prepared = A.prepareSchedules([
    schedule({ id: 'weak', placements: [], updatedAt: '2026-01-01T00:00:00Z' }),
    schedule({ id: 'strong', placements: [placement()], updatedAt: '2026-01-02T00:00:00Z' })
  ]);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].id, 'strong');
  assert.equal(prepared[0].duplicateRangeCount, 2);
}

{
  const reportSource = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');
  assert.match(reportSource, /Select 3–5 fundraisers/);
  assert.match(reportSource, /state\.selectedIds\.size >= 5/);
  assert.match(reportSource, /Broadcast \$ \/ pledge hour/);
  assert.match(reportSource, /Topic airtime & performance/);
  assert.match(reportSource, /Pledges by program start hour/);
}

console.log('one-sheet reports tests passed');

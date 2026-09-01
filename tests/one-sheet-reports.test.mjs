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
  { id: 'music-1', title: 'Music Special', nola_code: 'MUS1', topic_primary: 'Music', topic_secondary: 'Concert', distributor: 'PBS', length_bucket_minutes: 60 },
  { id: 'hist-1', title: 'History Special', nola_code: 'HIS1', topic_primary: 'HISTORY', topic_secondary: 'American History', distributor: 'APT', length_bucket_minutes: 60 },
  { id: 'nolength', title: 'Missing Length', nola_code: 'MISS', topic_primary: 'MUSIC', topic_secondary: 'Concert', distributor: 'PBS' }
]);

{
  const s = schedule({ placements: [
    placement({ id: 'p1', startMinutes: 1200, lengthMinutes: 60 }),
    placement({ id: 'p2', startMinutes: 1260, lengthMinutes: 60, programId: 'hist-1', programTitle: 'History Special' })
  ] });
  const rows = [
    { id: 'r1', air_date: '2026-08-29', air_time: '20:00', program_id: 'music-1', dollars: 300, pledge_count: 3, program_minutes: 30 },
    { id: 'r2', air_date: '2026-08-29', air_time: '21:00', program_id: 'hist-1', dollars: 100, pledge_count: 1, program_minutes: 240 }
  ];
  const analysis = A.analyzeSchedule(s, rows, indexes);
  assert.equal(analysis.broadcastDollars, 400);
  assert.equal(analysis.scheduledMinutes, 120, 'pledge hours use saved schedule/library duration, not imported runtime');
  assert.equal(A.dollarsPerHour(analysis.rateEligibleDollars, analysis.rateEligibleMinutes), 200);
}

{
  const s = schedule({ placements: [
    placement({ id: 'missing', programId: 'nolength', programTitle: 'Missing Length', lengthMinutes: undefined })
  ] });
  const rows = [{ id: 'r1', air_date: '2026-08-29', air_time: '20:00', program_id: 'nolength', dollars: 60, pledge_count: 1 }];
  const analysis = A.analyzeSchedule(s, rows, indexes);
  assert.equal(analysis.scheduledMinutes, 0, 'missing duration must not silently default to 30 minutes');
  assert.equal(analysis.rateEligibleDollars, 0, 'missing-duration dollars are excluded from rate numerator');
  assert.equal(analysis.broadcastDollars, 60, 'actual dollars remain in factual totals');
  assert.equal(analysis.missingDurationRows.length, 1);
  assert.equal(A.missingDurationPrograms([analysis])[0].title, 'Missing Length');
  assert.equal(A.programResultsRows(analysis)[0].lengthLabel, 'Length missing');
}

{
  const s = schedule({ placements: [
    placement({ id: 'a', programId: 'music-1', programTitle: 'Music Special', lengthMinutes: undefined }),
    placement({ id: 'b', programId: 'hist-1', programTitle: 'History Special', lengthMinutes: undefined, startMinutes: 1260 })
  ] });
  const rows = [
    { id: 'a1', air_date: '2026-08-29', air_time: '20:00', program_id: 'music-1', dollars: 120, pledge_count: 1 },
    { id: 'b1', air_date: '2026-08-29', air_time: '21:00', program_id: 'hist-1', dollars: 60, pledge_count: 1 }
  ];
  const analysis = A.analyzeSchedule(s, rows, indexes);
  assert.equal(analysis.scheduledMinutes, 120, 'Program Library bucket is a valid fallback duration');
}

{
  const s = schedule({ placements: [
    placement({ id: 'm1', programId: 'music-1', programTitle: 'Music Special', lengthMinutes: 60 }),
    placement({ id: 'm2', programId: 'music-1', programTitle: 'Music Special', lengthMinutes: 60, dateKey: '2026-08-30' }),
    placement({ id: 'h1', programId: 'hist-1', programTitle: 'History Special', lengthMinutes: 60, startMinutes: 1260 })
  ] });
  const rows = [
    { id: 'r1', air_date: '2026-08-29', air_time: '20:00', program_id: 'music-1', dollars: 300, pledge_count: 3 },
    { id: 'r2', air_date: '2026-08-30', air_time: '20:00', program_id: 'music-1', dollars: 100, pledge_count: 1 },
    { id: 'r3', air_date: '2026-08-29', air_time: '21:00', program_id: 'hist-1', dollars: 200, pledge_count: 2 }
  ];
  const analysis = A.analyzeSchedule(s, rows, indexes);
  const programRows = A.programResultsRows(analysis);
  assert.equal(programRows[0].title, 'Music Special');
  assert.equal(programRows[0].dollars, 400);
  assert.equal(programRows[0].airings, 2);
  assert.equal(programRows[0].dollarsPerHour, 200);
}

{
  const s = schedule({ placements: [
    placement({ id: 'm', programId: 'music-1', programTitle: 'Music Special' }),
    placement({ id: 'h', programId: 'hist-1', programTitle: 'History Special', startMinutes: 1260 })
  ] });
  const rows = [
    { id: 'm1', air_date: '2026-08-29', air_time: '20:00', program_id: 'music-1', dollars: 600, pledge_count: 6 },
    { id: 'h1', air_date: '2026-08-29', air_time: '21:00', program_id: 'hist-1', dollars: 100, pledge_count: 1 }
  ];
  const analysis = A.analyzeSchedule(s, rows, indexes);
  const topicRows = A.topicComparisonRows([analysis]);
  assert.ok(topicRows.some((row) => row.key === 'Music'));
  assert.ok(topicRows.some((row) => row.key === 'History'), 'all-caps HISTORY should canonicalize to History');
}

{
  const analyses = [];
  for (let i = 0; i < 3; i += 1) {
    const year = 2023 + i;
    const placements = [];
    const airings = [];
    for (let n = 0; n < 2; n += 1) {
      const id = `p-${i}-${n}`;
      const programId = n === 0 ? 'music-1' : 'hist-1';
      const title = n === 0 ? 'Music Special' : 'History Special';
      placements.push(placement({ id, dateKey: `${year}-08-${String(10 + i).padStart(2,'0')}`, startMinutes: 660, programId, programTitle: title }));
      airings.push({ id: `r-${i}-${n}`, air_date: `${year}-08-${String(10 + i).padStart(2,'0')}`, air_time: '11:00', program_id: programId, dollars: 100 + (i * 10) + n, pledge_count: 1 });
    }
    analyses.push(A.analyzeSchedule(schedule({ id: `s${i}`, title: `August ${year}`, startDate: `${year}-08-10`, endDate: `${year}-08-20`, year, placements }), airings, indexes));
  }
  const startRows = A.historicalRanking(analyses, 'startTime');
  assert.equal(startRows.length, 0, '11:00 with only two distinct titles must be excluded even with 6 airings across 3 fundraisers');
  const qualifying = analyses.map((analysis, index) => ({
    ...analysis,
    placementRows: [
      ...analysis.placementRows,
      { ...analysis.placementRows[0], title: `Third Title ${index}`, dollars: 150, minutes: 60, durationMissing: false, startMinutes: 660 }
    ]
  }));
  assert.equal(A.historicalRanking(qualifying, 'startTime').length, 1, 'start slot qualifies once 5+ airings, 3 fundraisers, and 3+ titles are present');
}

{
  const analysis = {
    placementRows: [
      { startMinutes: 1260, known: true, dollars: 840, pledges: 6 },
      { startMinutes: 1290, known: true, dollars: 360, pledges: 2 }
    ]
  };
  const buckets = A.startTimePledgeBuckets(analysis);
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0].startMinutes, 1260);
  assert.equal(buckets[1].startMinutes, 1290);
}

const reportSource = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../assets/one-sheet-reports.css', import.meta.url), 'utf8');
const reportHtml = fs.readFileSync(new URL('../reports.html', import.meta.url), 'utf8');
assert.match(reportSource, /Select 2–5 fundraisers/);
assert.match(reportSource, /function programResultsTable/);
assert.match(reportSource, /One entry per title, ranked by total Broadcast dollars/);
assert.match(reportSource, /Program topics are ranked by Broadcast \$\/hour/);
assert.doesNotMatch(reportSource, /topic-rank/);
assert.match(reportSource, /legendTop: true/);
assert.match(reportSource, /Historical Fundraiser Analytics/);
assert.match(reportSource, /function isNonSpecificLabel/);
assert.match(reportSource, /Non-Specific Pledges are not treated as incomplete program\/topic data/);
assert.match(reportSource, /function analysesForWeekpart/);
assert.match(reportSource, /Weekday start-time performance/);
assert.match(reportSource, /Saturday start-time performance/);
assert.match(reportSource, /Sunday start-time performance/);
assert.match(reportSource, /5 rate-valid airings, 3 fundraisers, and 3 distinct titles/);
assert.match(reportSource, /Continue with incomplete data/);
assert.match(reportSource, /Data Health \/ Preflight/);
assert.match(reportSource, /function defaultReportSchedule/);
assert.match(reportSource, /state\.schedules\.filter\(scheduleHasImportedResults\)/, 'historical reports should exclude empty planned fundraiser shells');
assert.match(reportSource, /Preview schedule repair/);
assert.match(reportSource, /repairedFromPreflight/);
assert.match(reportSource, /The imported pledge report proves activity occurred/);
assert.match(reportHtml, /0\.22\.118/);
assert.match(reportSource, /programResultsForFundraiserDay/);
assert.match(reportSource, /Regional \${weatherLine\(day\)}/);
assert.match(reportSource, /Affected title/);
assert.match(reportSource, /function bindChartTooltips/);
assert.match(reportSource, /function programResultsForFundraiserDay/);
assert.match(reportSource, /data-chart-tooltip/);
assert.match(css, /@page\{size:letter portrait/);
assert.match(reportHtml, /font-size:8pt/);
assert.match(reportHtml, /No programming within this topic occurred during this fundraiser/);

console.log('one-sheet reports tests passed');

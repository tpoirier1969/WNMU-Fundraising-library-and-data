from pathlib import Path
import re

root = Path('.')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, found {count}')
    print(f'OK {label}')
    return text.replace(old, new, 1)

def regex_once(text, pattern, repl, label):
    new, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, found {count}')
    print(f'OK {label}')
    return new

# 1. Performance Analytics: authoritative fundraiser ownership, internal duration,
#    and normalized distributor metadata.
p = root / 'assets/js/ui-analytics.js'
s = p.read_text()

s = replace_once(
    s,
    "  const START_TIME_MIN_TITLES = 3;\n",
    "  const START_TIME_MIN_TITLES = 3;\n  const DURATION_MISMATCH_TOLERANCE_MINUTES = 10;\n",
    'duration tolerance constant'
)

s = replace_once(
    s,
    "  function resolveLibraryByNola(indexes, nola = '', title = '') {\n",
    """  function normalizeDistributor(value = '') {
    const upper = text(value).toUpperCase();
    if (!upper) return '';
    return upper === 'EPS TV' ? 'EPS' : upper;
  }

  function libraryDurationMinutes(lib = {}) {
    const seconds = Number(lib.actual_runtime_seconds || 0);
    if (Number.isFinite(seconds) && seconds > 0) return seconds / 60;
    const actualMinutes = Number(lib.actual_runtime_minutes || 0);
    if (Number.isFinite(actualMinutes) && actualMinutes > 0) return actualMinutes;
    const runtimeMinutes = Number(lib.runtime_minutes || 0);
    if (Number.isFinite(runtimeMinutes) && runtimeMinutes > 0) return runtimeMinutes;
    const bucket = Number(lib.length_bucket_minutes || 0);
    return Number.isFinite(bucket) && bucket > 0 ? bucket : null;
  }

  function resolveLibraryByNola(indexes, nola = '', title = '') {
""",
    'internal metadata helpers'
)

s = regex_once(
    s,
    r"  function airingRecordsForSchedule\(schedule = \{\}, airingRecords = \[\]\) \{.*?\n  \}\n\n  function buildDriveSeasonRecords",
    """  function airingRecordsForSchedule(schedule = {}, airingRecords = []) {
    const start = text(schedule.startDate || '');
    const end = text(schedule.endDate || '');
    if (!(start && end)) return [];
    const exact = airingRecords.filter((record) =>
      text(record.row?.drive_start_date || '').slice(0, 10) === start
      && text(record.row?.drive_end_date || '').slice(0, 10) === end
    );
    if (exact.length) return exact;
    return airingRecords.filter((record) => {
      const key = text(record.dateKey || '');
      return Boolean(key && key >= start && key <= end);
    });
  }

  function buildDriveSeasonRecords""",
    'short fundraiser ownership'
)

s = replace_once(
    s,
    "        distributor: text(lib.distributor || row.distributor || ''),\n",
    "        distributor: normalizeDistributor(lib.distributor || row.distributor || ''),\n",
    'imported distributor normalization'
)

s = replace_once(
    s,
    "      const topicMissing = !nonSpecific && isMissingTopic(rawTopic);\n      const record = {\n",
    """      const topicMissing = !nonSpecific && isMissingTopic(rawTopic);
      const libraryDuration = libraryDurationMinutes(lib);
      const importedDuration = Number(row.program_minutes || 0) > 0 ? Number(row.program_minutes) : null;
      const record = {
""",
    'imported duration inputs'
)

s = replace_once(
    s,
    "        durationMinutes: Number(row.program_minutes || 0) > 0 ? Number(row.program_minutes) : null,\n",
    """        durationMinutes: libraryDuration || importedDuration,
        importedDurationMinutes: importedDuration,
        durationSource: libraryDuration ? 'program-library' : (importedDuration ? 'imported-report-fallback' : 'unknown'),
        durationMismatch: Boolean(libraryDuration && importedDuration && Math.abs(libraryDuration - importedDuration) > DURATION_MISMATCH_TOLERANCE_MINUTES),
""",
    'imported duration priority'
)

s = replace_once(
    s,
    "        record.scheduleMatched = true;\n        applyScheduleStartCorrection(record, scheduleMatch);\n        record.live = Boolean(scheduleMatch.live);\n",
    """        record.scheduleMatched = true;
        record.scheduleId = scheduleMatch.scheduleId || '';
        applyScheduleStartCorrection(record, scheduleMatch);
        const scheduleDuration = durationFromTimes(scheduleMatch.start, scheduleMatch.end);
        if (!libraryDuration && scheduleDuration) {
          record.durationMinutes = scheduleDuration;
          record.durationSource = 'saved-schedule';
        }
        const preferredInternalDuration = libraryDuration || scheduleDuration;
        record.durationMismatch = Boolean(preferredInternalDuration && importedDuration
          && Math.abs(preferredInternalDuration - importedDuration) > DURATION_MISMATCH_TOLERANCE_MINUTES);
        record.live = Boolean(scheduleMatch.live);
""",
    'saved schedule duration fallback'
)

s = replace_once(
    s,
    "      const actualDurationMinutes = Number(firstNonEmpty(matched?.durationMinutes, scheduledDurationMinutes, null)) || durationFromTimes(actualStartMinutes, actualEndMinutes);\n",
    """      const libraryDuration = libraryDurationMinutes(lib);
      const importedDuration = Number(matched?.importedDurationMinutes || matched?.durationMinutes || 0) > 0
        ? Number(matched?.importedDurationMinutes || matched?.durationMinutes)
        : null;
      const actualDurationMinutes = libraryDuration
        || (Number(scheduledDurationMinutes) > 0 ? Number(scheduledDurationMinutes) : null)
        || importedDuration
        || durationFromTimes(actualStartMinutes, actualEndMinutes);
""",
    'schedule-derived duration priority'
)

s = replace_once(
    s,
    "        distributor: text(firstNonEmpty(matched?.distributor, lib.distributor, placement.distributor, '')),\n",
    "        distributor: normalizeDistributor(firstNonEmpty(lib.distributor, placement.distributor, matched?.distributor, '')),\n",
    'schedule distributor normalization'
)

s = replace_once(
    s,
    "        durationMinutes: actualDurationMinutes,\n        daypart: daypartFromMinutes(Number.isFinite(actualStartMinutes) ? actualStartMinutes : null),\n",
    """        durationMinutes: actualDurationMinutes,
        importedDurationMinutes: importedDuration,
        durationSource: libraryDuration ? 'program-library' : ((Number(scheduledDurationMinutes) > 0) ? 'saved-schedule' : (importedDuration ? 'imported-report-fallback' : 'unknown')),
        durationMismatch: Boolean((libraryDuration || Number(scheduledDurationMinutes || 0)) && importedDuration
          && Math.abs((libraryDuration || Number(scheduledDurationMinutes || 0)) - importedDuration) > DURATION_MISMATCH_TOLERANCE_MINUTES),
        daypart: daypartFromMinutes(Number.isFinite(actualStartMinutes) ? actualStartMinutes : null),
""",
    'schedule-derived duration diagnostics'
)

# Make runtime columns preferred but keep schema-safe fallbacks for older views.
s = replace_once(
    s,
    """  async function fetchLibraryRows() {
    const baseColumns = 'id,title,nola_code,topic_primary,topic_secondary,distributor,rights_start,rights_end';
    const stateColumns = `${baseColumns},library_state,is_archived,archived,inactive_flag`;
    const fullColumns = `${baseColumns},status,library_state,is_archived,archived,inactive_flag`;
    const attempts = [
      { table: LIBRARY_VIEW, select: fullColumns, label: `${LIBRARY_VIEW} full library-state columns` },
      { table: LIBRARY_VIEW, select: stateColumns, label: `${LIBRARY_VIEW} library-state columns` },
      { table: LIBRARY_VIEW, select: baseColumns, label: `${LIBRARY_VIEW} base library columns` },
      { table: BASE_TABLE, select: stateColumns, label: `${BASE_TABLE} library-state columns` },
      { table: BASE_TABLE, select: baseColumns, label: `${BASE_TABLE} base library columns` }
    ];
""",
    """  async function fetchLibraryRows() {
    const coreColumns = 'id,title,nola_code,topic_primary,topic_secondary,distributor,rights_start,rights_end';
    const durationColumns = `${coreColumns},length_bucket_minutes,actual_runtime_seconds,actual_runtime_minutes,runtime_minutes`;
    const durationStateColumns = `${durationColumns},library_state,is_archived,archived,inactive_flag`;
    const durationFullColumns = `${durationColumns},status,library_state,is_archived,archived,inactive_flag`;
    const coreStateColumns = `${coreColumns},library_state,is_archived,archived,inactive_flag`;
    const attempts = [
      { table: LIBRARY_VIEW, select: durationFullColumns, label: `${LIBRARY_VIEW} runtime + full library-state columns` },
      { table: LIBRARY_VIEW, select: durationStateColumns, label: `${LIBRARY_VIEW} runtime + library-state columns` },
      { table: LIBRARY_VIEW, select: durationColumns, label: `${LIBRARY_VIEW} runtime columns` },
      { table: BASE_TABLE, select: durationStateColumns, label: `${BASE_TABLE} runtime + library-state columns` },
      { table: BASE_TABLE, select: durationColumns, label: `${BASE_TABLE} runtime columns` },
      { table: LIBRARY_VIEW, select: coreStateColumns, label: `${LIBRARY_VIEW} core library-state fallback` },
      { table: LIBRARY_VIEW, select: coreColumns, label: `${LIBRARY_VIEW} core fallback` },
      { table: BASE_TABLE, select: coreStateColumns, label: `${BASE_TABLE} core library-state fallback` },
      { table: BASE_TABLE, select: coreColumns, label: `${BASE_TABLE} core fallback` }
    ];
""",
    'runtime-aware library fetch'
)

s = replace_once(
    s,
    "    const scheduleMatchedCount = state.records.filter((record) => record.scheduleMatched).length;\n",
    "    const scheduleMatchedCount = state.records.filter((record) => record.scheduleMatched).length;\n    const durationMismatchCount = state.records.filter((record) => record.durationMismatch).length;\n",
    'duration mismatch count'
)

s = replace_once(
    s,
    "      note(`Loaded ${formatNumber(state.records.length)} usable pledge airing records. Unambiguous schedules: ${formatNumber(state.scheduleAudit.activeSchedules || 0)} of ${formatNumber(state.scheduleAudit.rawSchedules || 0)}.${duplicateNote} Schedule-derived rows: ${formatNumber(schedulePlacementCount)}. Live-break rows from saved schedules: ${formatNumber(scheduleLiveCount)}. Live-break source: ${LIVE_BREAK_ANALYTICS_SOURCE}.`);\n",
    """      const durationNote = durationMismatchCount
        ? ` ${formatNumber(durationMismatchCount)} imported Program_Minutes value(s) differ from internal Program Library/schedule length by more than ${DURATION_MISMATCH_TOLERANCE_MINUTES} minutes; analytics uses the internal length.`
        : '';
      note(`Loaded ${formatNumber(state.records.length)} usable pledge airing records. Unambiguous schedules: ${formatNumber(state.scheduleAudit.activeSchedules || 0)} of ${formatNumber(state.scheduleAudit.rawSchedules || 0)}.${duplicateNote} Schedule-derived rows: ${formatNumber(schedulePlacementCount)}. Live-break rows from saved schedules: ${formatNumber(scheduleLiveCount)}. Live-break source: ${LIVE_BREAK_ANALYTICS_SOURCE}.${durationNote}`);
""",
    'duration mismatch notice'
)

p.write_text(s)
print('WROTE ui-analytics.js')

# 2. Legacy fundraiser-comparison view gets the same saved-range ownership rule.
p = root / 'assets/js/ui-fundraiser-comparison.js'
s = p.read_text()
s = regex_once(
    s,
    r"function importedRowsForSchedule\(schedule = \{\}\) \{.*?\n\}\n\nfunction importedUseKey",
    """function importedRowsForSchedule(schedule = {}) {
  const start = text(schedule.startDate || schedule.start_date || '');
  const end = text(schedule.endDate || schedule.end_date || '');
  if (!(start && end)) return [];
  const exact = (state.airings || []).filter((row) =>
    text(row.drive_start_date || '').slice(0, 10) === start
    && text(row.drive_end_date || '').slice(0, 10) === end
  );
  if (exact.length) return exact;
  return (state.airings || []).filter((row) => {
    const key = importedDateKey(row);
    return Boolean(key && key >= start && key <= end);
  });
}

function importedUseKey""",
    'legacy comparison short fundraiser ownership'
)
p.write_text(s)
print('WROTE ui-fundraiser-comparison.js')

# 3. Historical Analytics distributor aliases and whole-season Broadcast dollars.
p = root / 'assets/js/one-sheet-analysis.js'
s = p.read_text()
s = replace_once(
    s,
    "      case 'distributor': return text(row.distributor || 'Unknown') || 'Unknown';\n",
    """      case 'distributor': {
        const distributor = text(row.distributor || 'Unknown').toUpperCase();
        return distributor === 'EPS TV' ? 'EPS' : (distributor || 'UNKNOWN');
      }
""",
    'historical distributor normalization'
)
s = replace_once(
    s,
    "      const rateMinutes = scheduledRows.reduce((sum, row) => sum + Number(row.minutes || 0), 0);\n      const rateDollars = scheduledRows.reduce((sum, row) => sum + Number(row.dollars || 0), 0);\n",
    """      const rateMinutes = dimension === 'season'
        ? (Number(analysis?.scheduledMinutes || 0) || scheduledRows.reduce((sum, row) => sum + Number(row.minutes || 0), 0))
        : scheduledRows.reduce((sum, row) => sum + Number(row.minutes || 0), 0);
      const attributableDollars = scheduledRows.reduce((sum, row) => sum + Number(row.dollars || 0), 0);
      const rateDollars = dimension === 'season'
        ? (Number(analysis?.broadcastDollars || 0) || attributableDollars)
        : attributableDollars;
""",
    'whole-season non-specific Broadcast dollars'
)
p.write_text(s)
print('WROTE one-sheet-analysis.js')

# 4. Whole-fundraiser report KPI uses all Broadcast dollars over saved pledge hours.
p = root / 'assets/js/one-sheet-reports.js'
s = p.read_text()
s = replace_once(
    s,
    """  function rateForAnalysis(analysis) {
    return A.dollarsPerHour(analysis.rateEligibleDollars, analysis.rateEligibleMinutes);
  }

  function pledgeRateForAnalysis(analysis) {
    return A.pledgesPerHour(analysis.rateEligiblePledges, analysis.rateEligibleMinutes);
  }
""",
    """  function rateForAnalysis(analysis) {
    return A.dollarsPerHour(analysis.broadcastDollars, analysis.scheduledMinutes);
  }

  function pledgeRateForAnalysis(analysis) {
    return A.pledgesPerHour(analysis.pledges, analysis.scheduledMinutes);
  }
""",
    'whole fundraiser Broadcast rate'
)
s = replace_once(
    s,
    '<div><span>Broadcast $ / hour</span><strong>${escapeHtml(money(rateForAnalysis(analysis)))}</strong></div>',
    '<div><span>Broadcast $ / pledge hour</span><strong>${escapeHtml(money(rateForAnalysis(analysis)))}</strong></div>',
    'whole fundraiser KPI label'
)
s = replace_once(
    s,
    'Broadcast $/hour excludes unknown results and airings with missing duration from both numerator and denominator; Rate-eligible hours show that exact denominator. Non-Specific Pledges are not treated as incomplete program/topic data.',
    'Whole-fundraiser Broadcast $/pledge hour uses all Broadcast dollars over saved pledge hours. Program/topic $/hour excludes unknown results, Non-Specific Pledges, and airings with missing duration from both numerator and denominator; Rate-eligible hours show that program-attributed denominator. Non-Specific Pledges remain in factual Broadcast totals.',
    'rate-definition footer'
)
p.write_text(s)
print('WROTE one-sheet-reports.js')

# Focused source-level regression guardrails for stage 1.
p = root / 'tests/analytics-consistency-v127.test.mjs'
p.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import A from '../assets/js/one-sheet-analysis.js';

const analytics = fs.readFileSync(new URL('../assets/js/ui-analytics.js', import.meta.url), 'utf8');
const comparison = fs.readFileSync(new URL('../assets/js/ui-fundraiser-comparison.js', import.meta.url), 'utf8');
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

test('short fundraiser ownership falls back to saved date range, not whole pledge season', () => {
  const perfFn = analytics.match(/function airingRecordsForSchedule\([\s\S]*?\n  \}/)?.[0] || '';
  assert.match(perfFn, /key >= start && key <= end/);
  assert.doesNotMatch(perfFn, /record\.season === season/);
  const comparisonFn = comparison.match(/function importedRowsForSchedule\([\s\S]*?\n\}/)?.[0] || '';
  assert.match(comparisonFn, /key >= start && key <= end/);
  assert.doesNotMatch(comparisonFn, /seasonForDate\(date\)/);
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
''')
print('WROTE stage-1 tests')

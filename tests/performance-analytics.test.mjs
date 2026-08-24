import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = new URL('../assets/js/ui-analytics.js', import.meta.url);
let source = fs.readFileSync(sourcePath, 'utf8');
const exportMarker = '  App.analyticsUi = { ensureReady, openCohort, reload };';
assert.ok(source.includes(exportMarker), 'analytics test export marker must exist');
source = source.replace(exportMarker, `${exportMarker}\n  globalThis.__analyticsTestHooks = { daypartFromMinutes, medianValue, outlierSummary, summarizeGroup, distributionLabel, buildAiringRecordLookup, findAiringForSchedulePlacement, buildScheduleRecords, dedupeSchedulesByDateRange, getScheduleAudit: () => state.scheduleAudit, getMetric: () => state.metric };`);

const storage = new Map();
const context = {
  window: {
    PledgeLib: { constants: {}, state: {}, data: {}, derive: {}, utils: {} },
    sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async () => { throw new Error('network unavailable in analytics tests'); }
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
const hooks = context.__analyticsTestHooks;

test('Performance Analytics defaults to median', () => {
  assert.equal(hooks.getMetric(), 'median');
});

test('WNMU daypart boundaries are shared by Performance Analytics', () => {
  assert.equal(hooks.daypartFromMinutes(390), 'overnight');
  assert.equal(hooks.daypartFromMinutes(420), 'morning');
  assert.equal(hooks.daypartFromMinutes(690), 'morning');
  assert.equal(hooks.daypartFromMinutes(720), 'afternoon');
  assert.equal(hooks.daypartFromMinutes(990), 'afternoon');
  assert.equal(hooks.daypartFromMinutes(1020), 'early-evening');
  assert.equal(hooks.daypartFromMinutes(1170), 'early-evening');
  assert.equal(hooks.daypartFromMinutes(1200), 'prime');
  assert.equal(hooks.daypartFromMinutes(1320), 'prime');
  assert.equal(hooks.daypartFromMinutes(1350), 'overnight');
});

test('MAD outlier detection flags a single unusually high airing', () => {
  const result = hooks.outlierSummary([0, 150, 240, 310, 2400]);
  assert.equal(hooks.medianValue([0, 150, 240, 310, 2400]), 240);
  assert.equal(result.outlierCount, 1);
  assert.equal(result.highOutliers, 1);
  assert.deepEqual(Array.from(result.outlierValues), [2400]);
});

function airing({ id, startMinutes, dollars }) {
  return { id, sourceAiringHash: '', dateKey: '2026-08-08', startMinutes, title: 'Same Show', importedTitle: 'Same Show', programId: 'p1', programOpenId: 'p1', nola: '', dollars };
}

test('exact scheduled start keeps 8 PM and 9:30 PM results in their own buckets', () => {
  const lookup = hooks.buildAiringRecordLookup([airing({ id: 'a', startMinutes: 1200, dollars: 900 }), airing({ id: 'b', startMinutes: 1290, dollars: 100 })]);
  const matched = hooks.findAiringForSchedulePlacement({ placement: { programId: 'p1', programTitle: 'Same Show' }, dateKey: '2026-08-08', startMinutes: 1290, pid: 'p1', nola: '', title: 'same show', airingLookup: lookup });
  assert.equal(matched?.id, 'b');
  assert.equal(matched?.dollars, 100);
});

test('ambiguous same-day candidates are excluded instead of choosing the highest-dollar result', () => {
  const lookup = hooks.buildAiringRecordLookup([airing({ id: 'a', startMinutes: 1200, dollars: 900 }), airing({ id: 'b', startMinutes: 1290, dollars: 100 })]);
  const matched = hooks.findAiringForSchedulePlacement({ placement: { programId: 'p1', programTitle: 'Same Show' }, dateKey: '2026-08-08', startMinutes: 1260, pid: 'p1', nola: '', title: 'same show', airingLookup: lookup });
  assert.equal(matched, null);
});

test('manual explicit zero remains a completed schedule-derived result', () => {
  const schedules = [{ id: 's1', title: 'August', placements: [{ id: 'x', dateKey: '2026-08-08', startMinutes: 1200, endMinutes: 1260, programId: 'p1', programTitle: 'Manual Zero', manualResultRecorded: true, manualBroadcastDollars: 0, manualPledgeCount: 0 }] }];
  const library = [{ id: 'p1', title: 'Manual Zero', topic_primary: 'Music', topic_secondary: 'Rock' }];
  const rows = hooks.buildScheduleRecords(schedules, library, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dollars, 0);
});

test('duplicate fundraiser date ranges are not merged into a synthetic schedule', () => {
  const unique = { id: 'u', startDate: '2026-03-01', endDate: '2026-03-10', placements: [] };
  const a = { id: 'a', startDate: '2026-08-08', endDate: '2026-08-16', placements: [{ id: '1' }] };
  const b = { id: 'b', startDate: '2026-08-08', endDate: '2026-08-16', placements: [{ id: '2' }] };
  const result = hooks.dedupeSchedulesByDateRange([unique, a, b]);
  assert.deepEqual(Array.from(result, (row) => row.id), ['u']);
  const audit = hooks.getScheduleAudit();
  assert.equal(audit.duplicateSchedulesMerged, 0);
  assert.equal(audit.duplicateSchedulesSuppressed, 2);
  assert.equal(audit.ambiguousDateRanges.length, 1);
});

test('analytics source uses the canonical imported-airing data layer when available', () => {
  const text = fs.readFileSync(sourcePath, 'utf8');
  assert.match(text, /App\.data\?\.fetchImportedAirings/);
});


test('topic analytics exposes clickable topic and outlier drilldown controls', () => {
  const text = fs.readFileSync(sourcePath, 'utf8');
  assert.match(text, /groupTitleDetailCell/);
  assert.match(text, /groupOutlierDetailCell/);
  assert.match(text, /data-group-detail-id/);
  assert.match(text, /openGroupDetail/);
});

test('topic analytics columns explicitly opt into left alignment', () => {
  const text = fs.readFileSync(sourcePath, 'utf8');
  assert.ok(text.includes('analytics-left'));
  const workspace = fs.readFileSync(new URL('../assets/analytics-workspace.html', import.meta.url), 'utf8');
  assert.ok(workspace.includes('.analytics-left { text-align: left !important; }'));
});


test('zero-dominated groups are flagged even when MAD has no statistical outlier', () => {
  const values = [0, 0, 0, 400, 900];
  const records = values.map((dollars, index) => ({ dollars, pledges: 0, season: 'August', seasonYear: `August ${2020 + index}` }));
  const row = hooks.summarizeGroup('Drama Doc', records);
  assert.equal(row.median, 0);
  assert.equal(row.avg, 260);
  assert.equal(row.zeroCount, 3);
  assert.equal(row.zeroDominated, true);
  assert.equal(row.outlierCount, 0);
  assert.match(hooks.distributionLabel(row), /Zero-dominated/);
  assert.match(hooks.distributionLabel(row), /3\/5 at \$0/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/one-sheet-analysis.js', import.meta.url), 'utf8');
const sandbox = { console, Date, Map, Set, Math, Number, String, Array, Object, RegExp };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const A = sandbox.WNMUOneSheetAnalysis;
assert.ok(A?.dataHealthReport, 'dataHealthReport should be exported');

const schedule = A.normalizeSchedule({
  id: 's1', title: 'August 2026', start_date: '2026-08-08', end_date: '2026-08-18',
  schedule_data: { placements: [{ dateKey: '2026-08-08', programTitle: 'Missing Length', sourceAiringHash: 'gone-hash' }], onlineDollars: 0, mailDollars: 0 }
});
assert.equal(schedule.onlineTrackedExplicit, false);
assert.equal(schedule.mailTrackedExplicit, false);
schedule.duplicateRangeCount = 2;

const nspl = { title: 'Non-Specific Pledges', topic: 'Non-Specific Pledges', unmatchedImported: true, known: true, dollars: 50, dateKey: '2026-08-08' };
const unmatched = { title: 'Mystery Program', topic: 'Unattributed', unmatchedImported: true, known: true, dollars: 20, dateKey: '2026-08-08' };
const missing = { title: 'Missing Length', topic: 'Music', known: true, dollars: 90, durationMissing: true, minutes: 0, dateKey: '2026-08-08', startMinutes: 1200 };
const analysis = {
  schedule,
  importedRows: [{ row_hash: 'live-hash', air_date: '2026-08-08', dollars: 100 }],
  placementRows: [missing, nspl, unmatched],
  unmatchedImportedRows: [nspl, unmatched],
  missingDurationRows: [missing],
  scheduled: 1
};
const library = [
  { id: 'a', title: 'Concert A', topic_primary: 'Music', topic_secondary: 'Concert' },
  { id: 'b', title: 'Concert B', topic_primary: 'MUSIC', topic_secondary: 'CONCERT' }
];
const health = A.dataHealthReport([schedule], [analysis], [{ row_hash: 'live-hash', air_date: '2026-08-08', dollars: 100, program_id: 'a' }], library);
assert.equal(health.status, 'review');
assert.ok(health.checks.find((check) => check.id === 'missing-duration').count > 0);
assert.equal(health.checks.find((check) => check.id === 'unmatched-imported').count, 1, 'Non-Specific Pledges must not count as unmatched program results');
assert.ok(health.checks.find((check) => check.id === 'topic-case').count >= 2);
assert.ok(health.checks.find((check) => check.id === 'duplicate-ranges').count > 0);
assert.ok(health.checks.find((check) => check.id === 'stale-hashes').count > 0);
assert.ok(health.checks.find((check) => check.id === 'channel-tracking').count > 0);

const cleanSchedule = { id: 'clean', title: 'Clean', startDate: '2026-08-01', endDate: '2026-08-02', placements: [], onlineDollars: 0, mailDollars: 0, onlineTrackedExplicit: true, mailTrackedExplicit: true };
const cleanAnalysis = { schedule: cleanSchedule, importedRows: [{ row_hash: 'r1', dollars: 25 }], placementRows: [{ known: true, dollars: 25, durationMissing: false, title: 'Clean Program', dateKey: '2026-08-01', startMinutes: 1200, minutes: 60 }], unmatchedImportedRows: [], missingDurationRows: [], scheduled: 1 };
const cleanHealth = A.dataHealthReport([cleanSchedule], [cleanAnalysis], [{ row_hash: 'r1', dollars: 25, program_id: 'p1' }], [{ id: 'p1', title: 'Clean Program', topic_primary: 'Music', topic_secondary: 'Concert' }]);
assert.equal(cleanHealth.status, 'pass');
assert.equal(cleanHealth.failures, 0);

console.log('data health preflight tests passed');

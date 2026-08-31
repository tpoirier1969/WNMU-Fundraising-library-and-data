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


assert.ok(A.canonicalizeImportedAirings, 'canonicalizeImportedAirings should be exported');
const rawDuplicateAirings = [
  {
    id: 'old', row_hash: 'old-hash', station: 'WNMU', imported_program_title: 'Imported Alias',
    air_date: '2026-08-08', air_time: '20:00', drive_start_date: '2026-08-08', drive_end_date: '2026-08-18',
    dollars: 75, updated_at: '2026-08-20T12:00:00Z'
  },
  {
    id: 'new', row_hash: 'new-hash', station: 'WNMU', imported_program_title: 'Imported Alias', matched_library_title: 'Matched Program',
    program_id: 'p-match', air_date: '2026-08-08', air_time: '20:00', drive_start_date: '2026-08-08', drive_end_date: '2026-08-18',
    dollars: 80, updated_at: '2026-08-21T12:00:00Z', match_method: 'manual_library'
  }
];
const canonical = A.canonicalizeImportedAirings(rawDuplicateAirings);
assert.equal(canonical.length, 1, 'superseded observations with the same imported identity/date/time should collapse');
assert.equal(canonical[0].row_hash, 'new-hash', 'newer manually matched observation should win canonicalization');

const matchedSchedule = A.normalizeSchedule({
  id: 'matched-schedule', title: 'August 2026', start_date: '2026-08-08', end_date: '2026-08-18',
  schedule_data: { placements: [{ dateKey: '2026-08-08', startMinutes: 1200, programId: 'p-match', programTitle: 'Matched Program', lengthMinutes: 60 }] }
});
const matchedLibrary = [{ id: 'p-match', title: 'Matched Program', topic_primary: 'Music', length_bucket_minutes: 60 }];
const matchedAnalysis = A.analyzeSchedule(matchedSchedule, canonical, A.buildLibraryIndexes(matchedLibrary));
assert.equal(matchedAnalysis.unmatchedImportedRows.length, 0, 'canonical manually matched row should attach to its scheduled Program Library record');
assert.equal(matchedAnalysis.broadcastDollars, 80);

const actionableHealth = A.dataHealthReport([matchedSchedule], [{
  schedule: matchedSchedule,
  importedRows: canonical,
  placementRows: [{ known: true, dollars: 80, durationMissing: true, title: 'Matched Program', programId: 'p-match', dateKey: '2026-08-08' }],
  unmatchedImportedRows: [],
  missingDurationRows: [{ known: true, dollars: 80, durationMissing: true, title: 'Matched Program', programId: 'p-match', dateKey: '2026-08-08' }],
  scheduled: 1
}], canonical, matchedLibrary);
const actionableMissing = actionableHealth.checks.find((check) => check.id === 'missing-duration').details[0];
assert.equal(actionableMissing.programId, 'p-match', 'actionable Preflight details should preserve Program Library IDs for deep links');
assert.equal(actionableMissing.title, 'Matched Program');

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
assert.equal(health.checks.some((check) => check.id === 'topic-case'), false, 'topic capitalization variants are one category and must not create a cleanup warning');
assert.ok(health.checks.find((check) => check.id === 'duplicate-ranges').count > 0);
assert.ok(health.checks.find((check) => check.id === 'stale-hashes').count > 0);
assert.ok(health.checks.find((check) => check.id === 'channel-tracking').count > 0);

const cleanSchedule = { id: 'clean', title: 'Clean', startDate: '2026-08-01', endDate: '2026-08-02', placements: [], onlineDollars: 0, mailDollars: 0, onlineTrackedExplicit: true, mailTrackedExplicit: true };
const cleanAnalysis = { schedule: cleanSchedule, importedRows: [{ row_hash: 'r1', air_date: '2026-08-01', dollars: 25 }], placementRows: [{ known: true, dollars: 25, durationMissing: false, title: 'Clean Program', dateKey: '2026-08-01', startMinutes: 1200, minutes: 60 }], unmatchedImportedRows: [], missingDurationRows: [], scheduled: 1 };
const cleanHealth = A.dataHealthReport([cleanSchedule], [cleanAnalysis], [{ row_hash: 'r1', air_date: '2026-08-01', dollars: 25, program_id: 'p1' }], [{ id: 'p1', title: 'Clean Program', topic_primary: 'Music', topic_secondary: 'Concert' }]);
assert.equal(cleanHealth.status, 'pass');
assert.equal(cleanHealth.failures, 0);
assert.equal(A.canonicalCategory('MUSIC'), 'Music');
assert.equal(A.canonicalCategory('music'), 'Music');
assert.equal(A.canonicalCategory('MuSiC'), 'Music');
assert.equal(A.canonicalCategory('WNMU'), 'WNMU', 'short station abbreviations should retain their display casing');

const coreSource = fs.readFileSync(new URL('../assets/js/core.js', import.meta.url), 'utf8');
const coreWindow = { PledgeLib: {}, PLEDGE_MANAGER_CONFIG: {} };
const coreSandbox = { window: coreWindow, console, Date, Map, Set, Math, Number, String, Array, Object, RegExp, Intl, URL, crypto: { randomUUID: () => 'test-id' } };
coreSandbox.globalThis = coreSandbox;
vm.createContext(coreSandbox);
vm.runInContext(coreSource, coreSandbox);
assert.equal(coreWindow.PledgeLib.derive.topicPrimary({ topic_primary: 'MUSIC' }), 'Music');
assert.equal(coreWindow.PledgeLib.derive.topicSecondary({ topic_secondary: 'black history' }), 'Black History');
assert.equal(coreWindow.PledgeLib.derive.topicPrimary({ topic_primary: 'WNMU' }), 'WNMU');

const offSeasonSchedule = A.normalizeSchedule({
  id: 'jan-special', title: 'January Special Event', start_date: '2016-01-03', end_date: '2016-01-04',
  schedule_data: { placements: [{ dateKey: '2016-01-03', startMinutes: 1200, programId: 'jan-program', programTitle: 'January Special', lengthMinutes: 60 }] }
});
assert.equal(offSeasonSchedule.season, '', 'January special event should remain off-season rather than being mislabeled as a normal pledge season');
assert.equal(offSeasonSchedule.year, 2016);
const offSeasonAirings = [{ row_hash: 'jan-row', air_date: '2016-01-03', air_time: '20:00', program_id: 'jan-program', imported_program_title: 'January Special', dollars: 1460, pledge_count: 9 }];
const offSeasonLibrary = [{ id: 'jan-program', title: 'January Special', topic_primary: 'Music', length_bucket_minutes: 60 }];
const offSeasonAnalysis = A.analyzeSchedule(offSeasonSchedule, offSeasonAirings, A.buildLibraryIndexes(offSeasonLibrary));
const offSeasonHealth = A.dataHealthReport([offSeasonSchedule], [offSeasonAnalysis], offSeasonAirings, offSeasonLibrary);
assert.equal(offSeasonHealth.checks.find((check) => check.id === 'schedule-coverage').count, 0, 'a saved off-season fundraiser must cover its imported air dates normally');

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


const mismatchSchedule = A.normalizeSchedule({
  id: 'mismatch', title: 'Mismatch Drive', start_date: '2026-08-08', end_date: '2026-08-18',
  schedule_data: { placements: [{ dateKey: '2026-08-08', startMinutes: 1200, programTitle: 'Expected Program', importedBroadcastDollars: 35, lengthMinutes: 60 }] }
});
const mismatchAnalysis = {
  schedule: mismatchSchedule,
  importedRows: [{ row_hash: 'mismatch-row', air_date: '2026-08-08', air_time: '20:30', dollars: 40, imported_program_title: 'Wrong Imported Title' }],
  placementRows: [],
  unmatchedImportedRows: [{ title: 'Wrong Imported Title', importedSourceTitle: 'Wrong Imported Title', programId: '', dateKey: '2026-08-08', startMinutes: 1230, dollars: 40, unmatchedImported: true, known: true }],
  missingDurationRows: [],
  scheduled: 1
};
const mismatchHealth = A.dataHealthReport([mismatchSchedule], [mismatchAnalysis], mismatchAnalysis.importedRows, []);
const mismatchDetail = mismatchHealth.checks.find((check) => check.id === 'unmatched-imported').details[0];
assert.ok(mismatchDetail.mismatchTypes.includes('Title match problem'));
assert.ok(mismatchDetail.mismatchTypes.includes('Air time mismatch'));
assert.ok(mismatchDetail.mismatchTypes.includes('Dollar mismatch'));
assert.match(mismatchDetail.detail, /Wrong Imported Title/);
assert.match(mismatchDetail.detail, /Expected Program/);
assert.match(mismatchDetail.detail, /8:30 PM/);
assert.match(mismatchDetail.detail, /8:00 PM/);
assert.match(mismatchDetail.detail, /\$40\.00/);
assert.match(mismatchDetail.detail, /\$35\.00/);


const strayDecemberSchedule = A.normalizeSchedule({
  id: 'dec-2019-stray', title: 'December 2019 standalone', start_date: '2019-12-26', end_date: '2019-12-27',
  schedule_data: { placements: [] }
});
const historicalDecemberAirings = [
  { id: 'nov14', row_hash: 'nov14', air_date: '2019-11-14', air_time: '21:00', imported_program_title: "Mister Rogers: It's You I Like", dollars: 564 },
  { id: 'nov16', row_hash: 'nov16', air_date: '2019-11-16', air_time: '23:00', imported_program_title: 'A Classic Christmas', dollars: 0 },
  { id: 'nov30', row_hash: 'nov30', air_date: '2019-11-30', air_time: '18:00', imported_program_title: 'Fundraiser Opening', drive_start_date: '2019-11-30', drive_end_date: '2019-12-11', dollars: 100 },
  { id: 'dec03', row_hash: 'dec03', air_date: '2019-12-03', air_time: '20:00', imported_program_title: 'Fundraiser Middle', drive_start_date: '2019-11-30', drive_end_date: '2019-12-11', dollars: 200 },
  { id: 'dec11', row_hash: 'dec11', air_date: '2019-12-11', air_time: '21:00', imported_program_title: 'Fundraiser Closing', drive_start_date: '2019-11-30', drive_end_date: '2019-12-11', dollars: 300 },
  { id: 'dec26', row_hash: 'dec26', air_date: '2019-12-26', air_time: '20:00', imported_program_title: 'Standalone Holiday Pledge', drive_start_date: '2019-12-01', drive_end_date: '2019-12-10', dollars: 50 }
];
const strayAnalysis = A.analyzeSchedule(strayDecemberSchedule, historicalDecemberAirings, A.buildLibraryIndexes([]));
assert.deepEqual(
  Array.from(strayAnalysis.importedRows, (row) => row.air_date),
  ['2019-12-26'],
  'a saved Dec 26–27 schedule must not absorb every November/December airing merely because they share the December pledge season'
);
assert.equal(strayAnalysis.broadcastDollars, 50, 'actual air date inside a saved standalone event must win over stale imported drive-boundary metadata');
const historicalCoverageHealth = A.dataHealthReport([strayDecemberSchedule], [strayAnalysis], historicalDecemberAirings, []);
const scheduleCoverageCheck = historicalCoverageHealth.checks.find((check) => check.id === 'schedule-coverage');
assert.ok(scheduleCoverageCheck.count >= 3, 'standalone uncovered dates and the explicit missing fundraiser should be schedule-level findings');
assert.ok(scheduleCoverageCheck.details.some((item) => /2019-11-30–2019-12-11/.test(item.detail)), 'explicit imported drive dates should expose the missing main December fundraiser window');
assert.ok(scheduleCoverageCheck.details.some((item) => item.repair?.startDate === '2019-11-30' && item.repair?.endDate === '2019-12-11'), 'the missing fundraiser finding should carry its explicit source range into the repair preview');
assert.ok(scheduleCoverageCheck.details.some((item) => item.repair?.startDate === '2019-11-14' && item.repair?.endDate === '2019-11-14'), 'uncovered standalone pledge activity must not be silently rolled into the later fundraiser');
assert.equal(historicalCoverageHealth.metrics.importedRows, 6, 'Preflight imported-row metric must count the full canonical dataset, including rows outside saved schedules');

const missingOwnershipHealth = A.dataHealthReport([matchedSchedule], [{
  schedule: matchedSchedule,
  importedRows: [],
  placementRows: [],
  unmatchedImportedRows: [],
  missingDurationRows: [],
  scheduled: 1
}], canonical, matchedLibrary);
const ownershipCheck = missingOwnershipHealth.checks.find((check) => check.id === 'result-ownership');
assert.equal(ownershipCheck.count, 1, 'Preflight must fail when covered imported rows disappear from fundraiser analysis');
assert.match(ownershipCheck.details[0].detail, /1 covered imported rows \/ \$80\.00 Broadcast vs 0 attached rows \/ \$0\.00/);

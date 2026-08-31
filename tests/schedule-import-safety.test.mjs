import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = new URL('../assets/js/ui-scheduling.js', import.meta.url);
let source = fs.readFileSync(sourcePath, 'utf8');
const imports = fs.readFileSync(new URL('../assets/js/ui-imports.js', import.meta.url), 'utf8');
const exportMarker = '  App.schedulingUi = {\n';
assert.ok(source.includes(exportMarker), 'scheduling test export marker must exist');
source = source.replace(exportMarker, `  globalThis.__scheduleImportTestHooks = { mergeImportedRowsIntoSchedules, deleteMergedImportedScheduleRecords, confirmImportedScheduleDestructiveRepair, reconcileSchedulePlacementResults };\n\n${exportMarker}`);

const stored = new Map();
let nextId = 1;
const state = {
  schedules: [],
  rawRows: [],
  baseRows: [],
  activeScheduleId: '',
  scheduleStoreMode: 'local',
  client: null,
  scheduleView: {},
  scheduleDraft: {},
  scheduleDetailCache: {},
  imports: {}
};
const utils = {
  normalizeText: (value) => String(value ?? '').trim(),
  normalizeLookupKey: (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  nolaCodeKey: (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''),
  firstNonEmpty: (...values) => values.find((value) => value !== undefined && value !== null && value !== '') ?? '',
  makeId: (prefix = 'id') => `${prefix}-${nextId++}`,
  formatDate: (value) => String(value || ''),
  formatCount: (value) => String(Number(value || 0)),
  formatMoney: (value) => `$${Number(value || 0).toFixed(2)}`,
  minutesToLabel: (value) => String(value),
  dateKeyFromDate: (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  },
  plusDays: (dateKey, days) => {
    const date = new Date(`${dateKey}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  },
  datesBetween: (start, end) => {
    const out = [];
    for (let key = start; key && key <= end; key = utils.plusDays(key, 1)) out.push(key);
    return out;
  },
  storageSet: (key, value) => stored.set(key, JSON.parse(JSON.stringify(value))),
  storageGet: (key, fallback) => stored.has(key) ? stored.get(key) : fallback,
  isNonSpecificRow: () => false,
  isNonSpecificTitle: () => false,
  isNonSpecificNola: () => false,
  compareText: (a, b) => String(a || '').localeCompare(String(b || '')),
  escapeHtml: (value) => String(value ?? '')
};
const derive = {
  programId: (row) => String(row?.id || row?.program_id || row?.pledge_program_id || ''),
  title: (row) => String(row?.title || row?.program_title || row?.imported_program_title || ''),
  nola: (row) => String(row?.nola_code || row?.nola || ''),
  runtimeMinutes: (row) => Number(row?.runtime_minutes || row?.program_minutes || 60) || 60,
  lengthBucket: (row) => Number(row?.length_bucket || 60) || 60,
  isActive: () => true,
  topicPrimary: () => '',
  rightsBegin: () => '',
  rightsEnd: () => '',
  distributor: () => '',
  actualRuntimeLabel: () => '—',
  avgPerFundraiser: () => 0,
  totalRaised: () => 0,
  premiumSummary: () => '',
  description: () => '',
  scheduleById: (id) => state.schedules.find((row) => row.id === id) || null
};
const data = {
  deleteScheduleRemote: async () => {},
  fetchImportedAirings: async () => []
};
const context = {
  window: {
    PledgeLib: {
      state,
      constants: {
        DEFAULT_DAY_START_HOUR: 7,
        DEFAULT_DAY_END_HOUR: 25,
        DEFAULT_DAY_START_MINUTES: 420,
        DEFAULT_DAY_END_MINUTES: 1500,
        DEFAULT_SLOT_MINUTES: 30,
        MIN_VISIBLE_HOUR: 0,
        MAX_VISIBLE_HOUR: 30,
        SCHEDULE_STORAGE_KEY: 'test-schedules'
      },
      utils,
      derive,
      data,
      programFilters: {},
      dom: { els: {}, setNotice: () => {} },
      programLinks: { render: () => '' },
      auth: { canEdit: () => true },
      app: {}
    },
    prompt: () => null,
    setTimeout,
    clearTimeout
  },
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: { classList: { add: () => {}, remove: () => {} }, appendChild: () => {} },
    createElement: () => ({ innerHTML: '', addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] })
  },
  console,
  Date,
  Map,
  Set,
  Promise,
  Number,
  String,
  Boolean,
  Math,
  Intl,
  URLSearchParams,
  setTimeout,
  clearTimeout
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'ui-scheduling.js' });
const hooks = context.__scheduleImportTestHooks;

function resetState() {
  state.schedules = [];
  state.rawRows = [];
  state.baseRows = [];
  state.activeScheduleId = '';
  state.scheduleStoreMode = 'local';
  state.client = null;
  state.scheduleSyncMessage = '';
  stored.clear();
  data.deleteScheduleRemote = async () => {};
}

function libraryRow(id, title) {
  return { id, title, runtime_minutes: 60 };
}

function importedRow({ hash = 'r1', time = '20:00', title = 'Reported Program', programId = 'p1', dollars = 100 } = {}) {
  return {
    row_hash: hash,
    air_date: '2026-08-08',
    air_time: time,
    imported_program_title: title,
    program_title: title,
    program_id: programId,
    source_file_name: 'August.csv',
    dollars,
    pledge_count: 1
  };
}

function targetSchedule(placements = []) {
  return {
    id: 'target',
    title: 'August 2026',
    startDate: '2026-08-08',
    endDate: '2026-08-08',
    goalDollars: 1000,
    placements,
    meta: {}
  };
}

function importedDuplicate(id = 'dup') {
  return {
    id,
    title: 'Imported pledge Aug 8',
    startDate: '2026-08-08',
    endDate: '2026-08-08',
    placements: [{
      id: `${id}-old`,
      importedFromReport: true,
      programId: 'p1',
      programTitle: 'Reported Program',
      dateKey: '2026-08-08',
      startMinutes: 1200,
      endMinutes: 1260,
      sourceName: 'August.csv',
      sourceAiringHash: `${id}-oldhash`
    }],
    meta: { autoCreatedFromReports: true, importedFromReports: true }
  };
}

test('Scheduling refresh replaces stale positive Actual with current imported zero', () => {
  resetState();
  state.rawRows = [libraryRow('p1', 'Reported Program')];
  const placement = {
    id: 'planned', importedFromReport: true, programId: 'p1', programTitle: 'Reported Program',
    dateKey: '2026-08-08', startMinutes: 1200, endMinutes: 1260,
    sourceAiringHash: 'r1', importedBroadcastDollars: 840,
    manualResultRecorded: true, manualBroadcastDollars: 99, manualPledgeCount: 2
  };
  const schedule = targetSchedule([placement]);
  const changed = hooks.reconcileSchedulePlacementResults(schedule, [importedRow({ hash: 'r1', dollars: 0 })]);
  assert.equal(changed, true);
  assert.equal(schedule.placements[0].importedBroadcastDollars, 0);
  assert.equal(schedule.placements[0].manualResultRecorded, false);
  assert.equal(schedule.placements[0].manualBroadcastDollars, 0);
});

test('Scheduling refresh follows a corrected imported row when its hash changes but slot is unique', () => {
  resetState();
  state.rawRows = [libraryRow('p1', 'Reported Program')];
  const placement = {
    id: 'planned', importedFromReport: true, programId: 'p1', programTitle: 'Old Planned Title',
    dateKey: '2026-08-08', startMinutes: 1200, endMinutes: 1260,
    sourceAiringHash: 'old-hash', importedBroadcastDollars: 840
  };
  const schedule = targetSchedule([placement]);
  const changed = hooks.reconcileSchedulePlacementResults(schedule, [importedRow({ hash: 'new-hash', dollars: 360 })]);
  assert.equal(changed, true);
  assert.equal(schedule.placements[0].importedBroadcastDollars, 360);
  assert.equal(schedule.placements[0].sourceAiringHash, 'new-hash');
  assert.equal(schedule.placements[0].programTitle, 'Old Planned Title');
});

test('Scheduling refresh treats a scheduled title omitted from a populated imported day as Actual zero', () => {
  resetState();
  state.rawRows = [libraryRow('p1', 'Planned Program'), libraryRow('p2', 'Other Program')];
  const placement = {
    id: 'planned', importedFromReport: true, programId: 'p1', programTitle: 'Planned Program',
    dateKey: '2026-08-08', startMinutes: 1200, endMinutes: 1260,
    sourceAiringHash: 'stale-hash', importedBroadcastDollars: 840
  };
  const schedule = targetSchedule([placement]);
  const changed = hooks.reconcileSchedulePlacementResults(schedule, [importedRow({ hash: 'other-hash', programId: 'p2', title: 'Other Program', time: '21:00', dollars: 250 })]);
  assert.equal(changed, true);
  assert.equal(schedule.placements[0].importedBroadcastDollars, 0);
  assert.equal(schedule.placements[0].sourceAiringHash, '');
});

test('ordinary Results Import remains explicitly non-mutating', () => {
  assert.match(imports, /Results Import never creates, merges, repairs, or changes fundraiser schedules\./);
  assert.match(imports, /allowDuplicateMerges:\s*false/);
  assert.match(imports, /allowRefreshPlacements:\s*false/);
});

test('typed approval accepts only the exact destructive merge phrase', () => {
  context.window.prompt = () => 'nope';
  assert.equal(hooks.confirmImportedScheduleDestructiveRepair({ mergeableSchedules: 1, groupSummaries: [] }, { merge: true }), false);
  context.window.prompt = () => 'APPLY SCHEDULE CHANGES';
  assert.equal(hooks.confirmImportedScheduleDestructiveRepair({ mergeableSchedules: 1, groupSummaries: [] }, { merge: true }), true);
  assert.equal(hooks.confirmImportedScheduleDestructiveRepair({}, { merge: false }), true);
});

test('duplicate merge flag cannot stage deletion without propagated approval', () => {
  resetState();
  state.rawRows = [libraryRow('p1', 'Reported Program')];
  state.schedules = [targetSchedule(), importedDuplicate()];
  const summary = hooks.mergeImportedRowsIntoSchedules([importedRow()], {
    activateFirst: false,
    allowDuplicateMerges: true,
    destructiveApproval: false,
    allowCreateMissing: false,
    allowRefreshPlacements: false
  });
  assert.deepEqual(Array.from(summary.removedScheduleIds), []);
  assert.deepEqual(Array.from(state.schedules, (row) => row.id), ['target', 'dup']);
});

test('approved duplicate merge stages deletion but keeps the row visible until deletion succeeds', () => {
  resetState();
  state.rawRows = [libraryRow('p1', 'Reported Program')];
  state.schedules = [targetSchedule(), importedDuplicate()];
  const summary = hooks.mergeImportedRowsIntoSchedules([importedRow()], {
    activateFirst: false,
    allowDuplicateMerges: true,
    destructiveApproval: true,
    allowCreateMissing: false,
    allowRefreshPlacements: false
  });
  assert.deepEqual(Array.from(summary.removedScheduleIds), ['dup']);
  assert.equal(summary.removedScheduleReplacements.dup, 'target');
  assert.deepEqual(Array.from(state.schedules, (row) => row.id), ['target', 'dup']);
});

test('low-level deletion refuses to remove a schedule without explicit approval', async () => {
  resetState();
  state.schedules = [targetSchedule(), importedDuplicate()];
  const removed = await hooks.deleteMergedImportedScheduleRecords(['dup']);
  assert.equal(removed, 0);
  assert.deepEqual(Array.from(state.schedules, (row) => row.id), ['target', 'dup']);
});

test('approved local duplicate deletion removes only the approved row and activates its retained replacement', async () => {
  resetState();
  state.schedules = [targetSchedule(), importedDuplicate()];
  state.activeScheduleId = 'dup';
  const removed = await hooks.deleteMergedImportedScheduleRecords(['dup'], {
    explicitApproval: true,
    replacementScheduleIds: { dup: 'target' }
  });
  assert.equal(removed, 1);
  assert.deepEqual(Array.from(state.schedules, (row) => row.id), ['target']);
  assert.equal(state.activeScheduleId, 'target');
});

test('remote delete failure reports zero and leaves the duplicate schedule visible', async () => {
  resetState();
  state.schedules = [targetSchedule(), importedDuplicate()];
  state.scheduleStoreMode = 'remote';
  state.client = {};
  data.deleteScheduleRemote = async () => { throw new Error('simulated outage'); };
  const removed = await hooks.deleteMergedImportedScheduleRecords(['dup'], {
    explicitApproval: true,
    replacementScheduleIds: { dup: 'target' }
  });
  assert.equal(removed, 0);
  assert.deepEqual(Array.from(state.schedules, (row) => row.id), ['target', 'dup']);
  assert.equal(state.scheduleStoreMode, 'local');
  assert.match(state.scheduleSyncMessage, /failed duplicate remains visible/i);
});

test('partial remote delete removes only records confirmed deleted before a failure', async () => {
  resetState();
  state.schedules = [targetSchedule(), importedDuplicate('d1'), importedDuplicate('d2')];
  state.scheduleStoreMode = 'remote';
  state.client = {};
  data.deleteScheduleRemote = async (id) => { if (id === 'd2') throw new Error('second delete failed'); };
  const removed = await hooks.deleteMergedImportedScheduleRecords(['d1', 'd2'], {
    explicitApproval: true,
    replacementScheduleIds: { d1: 'target', d2: 'target' }
  });
  assert.equal(removed, 1);
  assert.deepEqual(Array.from(state.schedules, (row) => row.id), ['target', 'd2']);
});

test('report title conflict preserves the existing scheduled program', () => {
  resetState();
  state.rawRows = [libraryRow('p1', 'Planned Program'), libraryRow('p2', 'Reported Program')];
  const planned = {
    id: 'planned',
    importedFromReport: false,
    programId: 'p1',
    programTitle: 'Planned Program',
    dateKey: '2026-08-08',
    startMinutes: 1200,
    endMinutes: 1260
  };
  state.schedules = [targetSchedule([planned])];
  const summary = hooks.mergeImportedRowsIntoSchedules([importedRow({ programId: 'p2' })], {
    activateFirst: false,
    allowDuplicateMerges: false,
    destructiveApproval: false,
    allowCreateMissing: false,
    allowRefreshPlacements: true
  });
  assert.equal(summary.scheduleConflicts, 1);
  assert.equal(state.schedules[0].placements.length, 1);
  assert.equal(state.schedules[0].placements[0].programTitle, 'Planned Program');
});

test('refresh adds non-conflicting imported evidence without deleting existing schedule blocks', () => {
  resetState();
  state.rawRows = [libraryRow('p1', 'Planned Program'), libraryRow('p2', 'Reported Program')];
  const planned = {
    id: 'planned',
    importedFromReport: false,
    programId: 'p1',
    programTitle: 'Planned Program',
    dateKey: '2026-08-08',
    startMinutes: 1200,
    endMinutes: 1260
  };
  state.schedules = [targetSchedule([planned])];
  const summary = hooks.mergeImportedRowsIntoSchedules([importedRow({ programId: 'p2', time: '21:00' })], {
    activateFirst: false,
    allowDuplicateMerges: false,
    destructiveApproval: false,
    allowCreateMissing: false,
    allowRefreshPlacements: true
  });
  assert.equal(summary.removedScheduleIds.length, 0);
  assert.equal(state.schedules[0].placements.length, 2);
  assert.equal(state.schedules[0].placements[0].programTitle, 'Planned Program');
  assert.equal(state.schedules[0].placements[1].programTitle, 'Reported Program');
});

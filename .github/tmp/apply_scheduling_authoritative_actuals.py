from pathlib import Path
import re

source_path = Path('assets/js/ui-scheduling.js')
source = source_path.read_text()

old_maps = "  const importedBroadcastHydration = new Map();\n  const importedScheduleTotalsHydration = new Map();"
if old_maps not in source:
    raise SystemExit('imported hydration map block not found')
source = source.replace(old_maps, "  const importedScheduleTotalsHydration = new Map();", 1)

old_sig = """      utils.normalizeText(schedule?.endDate),
      String(Array.isArray(rows) ? rows.length : 0),
      latestStamp
"""
new_sig = """      utils.normalizeText(schedule?.endDate),
      String(Array.isArray(rows) ? rows.length : 0),
      latestStamp,
      'placement-results-v2'
"""
if old_sig not in source:
    raise SystemExit('importedTotalsSignature block not found')
source = source.replace(old_sig, new_sig, 1)

old_report_total = "reportedBroadcastTotalDollars: Number(totals.reportedBroadcastTotalDollars || 0) || Number(currentMeta.reportedBroadcastTotalDollars || 0) || 0,"
new_report_total = "reportedBroadcastTotalDollars: Number(totals.reportedBroadcastTotalDollars || 0) || 0,"
if old_report_total not in source:
    raise SystemExit('reported total precedence line not found')
source = source.replace(old_report_total, new_report_total, 1)

marker = "  async function ensureScheduleImportedTotals(schedule = {}) {\n"
if marker not in source:
    raise SystemExit('ensureScheduleImportedTotals marker not found')
helper = r'''  function currentImportedEvidenceForPlacement(placement = {}, rows = []) {
    if (!placement || placement.isNonPledge || placementLooksNonSpecific(placement)) return null;
    const programRows = (Array.isArray(rows) ? rows : []).filter((row) => !importedRowIsNonSpecific(row));
    if (!programRows.length) return null;

    const sourceHash = utils.normalizeText(placement?.sourceAiringHash || '');
    if (sourceHash) {
      const hashRows = programRows.filter((row) => utils.normalizeText(row?.row_hash || '') === sourceHash);
      if (hashRows.length) {
        return { kind: 'airing', row: hashRows.reduce((best, row) => choosePreferredImportedRow(best, row)) };
      }
    }

    const directMatches = programRows.filter((row) => importedPlacementLooksLikeRow(placement, row));
    if (directMatches.length) {
      return { kind: 'airing', row: directMatches.reduce((best, row) => choosePreferredImportedRow(best, row)) };
    }

    const dateKey = utils.normalizeText(placement?.dateKey || '');
    const startMinutes = Number(placement?.startMinutes);
    if (!(dateKey && Number.isFinite(startMinutes))) return null;
    const slotRows = programRows.filter((row) => importedRowDateKey(row) === dateKey && Number(importedRowStartMinutes(row)) === startMinutes);
    if (slotRows.length === 1) return { kind: 'airing', row: slotRows[0] };
    if (slotRows.length > 1) return null;

    const dateHasProgramResults = programRows.some((row) => importedRowDateKey(row) === dateKey);
    return dateHasProgramResults ? { kind: 'report-day-zero', row: null } : null;
  }

  function reconcileSchedulePlacementResults(schedule = {}, rows = []) {
    if (!Array.isArray(schedule?.placements) || !schedule.placements.length) return false;
    let changed = false;
    schedule.placements = schedule.placements.map((placement) => {
      const evidence = currentImportedEvidenceForPlacement(placement, rows);
      if (!evidence) return placement;
      const row = evidence.row || {};
      const next = {
        ...placement,
        importedFromReport: true,
        importedBroadcastDollars: evidence.kind === 'airing' ? (Number(row?.dollars || 0) || 0) : 0,
        sourceAiringHash: evidence.kind === 'airing' ? (utils.normalizeText(row?.row_hash || '') || placement?.sourceAiringHash || '') : '',
        sourceImportBatchId: evidence.kind === 'airing' ? (utils.normalizeText(row?.import_batch_id || '') || placement?.sourceImportBatchId || '') : (placement?.sourceImportBatchId || ''),
        sourceName: evidence.kind === 'airing' ? (utils.normalizeText(row?.source_file_name || '') || placement?.sourceName || '') : (placement?.sourceName || ''),
        sourceLabel: placement?.sourceLabel || 'Imported report',
        manualResultRecorded: false,
        manualBroadcastDollars: 0,
        manualPledgeCount: 0,
        manualResultUpdatedAt: ''
      };
      const keys = ['importedFromReport', 'importedBroadcastDollars', 'sourceAiringHash', 'sourceImportBatchId', 'sourceName', 'sourceLabel', 'manualResultRecorded', 'manualBroadcastDollars', 'manualPledgeCount', 'manualResultUpdatedAt'];
      if (keys.some((key) => next[key] !== placement[key])) changed = true;
      return next;
    });
    return changed;
  }

'''
source = source.replace(marker, helper + marker, 1)

old_apply = """        const relevantRows = importedRowsForSchedule(schedule, rows);
        const totals = summarizeImportedRows(relevantRows);
        const changed = applyImportedTotalsToSchedule(schedule, totals, signature);
        if (changed) {
          renderScheduleForm();
          renderHomeDriveSummary();
          renderScheduledProgramDetails();
        }
"""
new_apply = """        const relevantRows = importedRowsForSchedule(schedule, rows);
        const totals = summarizeImportedRows(relevantRows);
        const totalsChanged = applyImportedTotalsToSchedule(schedule, totals, signature);
        const placementsChanged = reconcileSchedulePlacementResults(schedule, relevantRows);
        if (totalsChanged || placementsChanged) {
          await persistSchedules(schedule);
          renderScheduleForm();
          renderHomeDriveSummary();
          renderScheduledProgramDetails();
        }
"""
if old_apply not in source:
    raise SystemExit('ensureScheduleImportedTotals apply block not found')
source = source.replace(old_apply, new_apply, 1)

pattern = re.compile(r"  async function ensureScheduleBroadcastTotal\(schedule\) \{.*?\n  \}\n\n  function scheduleGrandTotal", re.S)
replacement = """  async function ensureScheduleBroadcastTotal(schedule) {
    return ensureScheduleImportedTotals(schedule);
  }

  function scheduleGrandTotal"""
source, count = pattern.subn(replacement, source, count=1)
if count != 1:
    raise SystemExit(f'ensureScheduleBroadcastTotal replacement count={count}')

export_old = "globalThis.__scheduleImportTestHooks = { mergeImportedRowsIntoSchedules, deleteMergedImportedScheduleRecords, confirmImportedScheduleDestructiveRepair };"
export_new = "globalThis.__scheduleImportTestHooks = { mergeImportedRowsIntoSchedules, deleteMergedImportedScheduleRecords, confirmImportedScheduleDestructiveRepair, reconcileSchedulePlacementResults };"
if export_old not in source:
    raise SystemExit('schedule test hook marker not found')
source = source.replace(export_old, export_new, 1)
source_path.write_text(source)

test_path = Path('tests/schedule-import-safety.test.mjs')
tests = test_path.read_text()
insert_marker = "test('ordinary Results Import remains explicitly non-mutating', () => {\n"
if insert_marker not in tests:
    raise SystemExit('schedule test insertion marker not found')
new_tests = r'''test('Scheduling refresh replaces stale positive Actual with current imported zero', () => {
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

'''
tests = tests.replace(insert_marker, new_tests + insert_marker, 1)
test_path.write_text(tests)

version_path = Path('version.json')
version = version_path.read_text()
if '"0.22.108"' not in version:
    raise SystemExit('expected v0.22.108 version marker not found')
version_path.write_text(version.replace('"0.22.108"', '"0.22.109"', 1))

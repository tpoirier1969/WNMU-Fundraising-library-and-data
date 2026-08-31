from pathlib import Path

source_path = Path('assets/js/ui-scheduling.js')
source = source_path.read_text()
old = """  function importedTotalsSignature(schedule = {}, rows = []) {
    const latestStamp = (Array.isArray(rows) ? rows : []).reduce((latest, row) => {
      const stamp = utils.normalizeText(row?.updated_at || row?.created_at || row?.imported_at || '');
      return stamp > latest ? stamp : latest;
    }, '');
    return [
      utils.normalizeText(schedule?.id),
      utils.normalizeText(schedule?.startDate),
      utils.normalizeText(schedule?.endDate),
      String(Array.isArray(rows) ? rows.length : 0),
      latestStamp,
      'placement-results-v2'
    ].join('|');
  }
"""
new = """  function importedTotalsSignature(schedule = {}, rows = []) {
    const latestStamp = (Array.isArray(rows) ? rows : []).reduce((latest, row) => {
      const stamp = utils.normalizeText(row?.updated_at || row?.created_at || row?.imported_at || '');
      return stamp > latest ? stamp : latest;
    }, '');
    const placementResultState = (Array.isArray(schedule?.placements) ? schedule.placements : [])
      .map((placement) => [
        utils.normalizeText(placement?.id || ''),
        utils.normalizeText(placement?.sourceAiringHash || ''),
        String(Number(placement?.importedBroadcastDollars || 0) || 0),
        normalizePlacementBoolean(placement?.manualResultRecorded, false) ? '1' : '0',
        String(Number(placement?.manualBroadcastDollars || 0) || 0),
        String(Number(placement?.manualPledgeCount || 0) || 0)
      ].join(':'))
      .sort()
      .join(',');
    return [
      utils.normalizeText(schedule?.id),
      utils.normalizeText(schedule?.startDate),
      utils.normalizeText(schedule?.endDate),
      String(Array.isArray(rows) ? rows.length : 0),
      latestStamp,
      placementResultState,
      'placement-results-v3'
    ].join('|');
  }
"""
if old not in source:
    raise SystemExit('importedTotalsSignature v2 block not found')
source_path.write_text(source.replace(old, new, 1))

test_path = Path('tests/schedule-import-safety.test.mjs')
tests = test_path.read_text()
old_hook = "confirmImportedScheduleDestructiveRepair, reconcileSchedulePlacementResults };"
new_hook = "confirmImportedScheduleDestructiveRepair, reconcileSchedulePlacementResults, importedTotalsSignature };"
if old_hook not in tests:
    raise SystemExit('test hook block not found')
tests = tests.replace(old_hook, new_hook, 1)
marker = "test('Scheduling refresh replaces stale positive Actual with current imported zero', () => {\n"
if marker not in tests:
    raise SystemExit('Scheduling regression marker not found')
extra = """test('Scheduling imported-result signature changes when placement result state changes', () => {
  resetState();
  const placement = {
    id: 'planned', importedFromReport: true, programId: 'p1', programTitle: 'Reported Program',
    dateKey: '2026-08-08', startMinutes: 1200, sourceAiringHash: 'r1', importedBroadcastDollars: 100,
    manualResultRecorded: false, manualBroadcastDollars: 0, manualPledgeCount: 0
  };
  const schedule = targetSchedule([placement]);
  const rows = [importedRow({ hash: 'r1', dollars: 100 })];
  const before = hooks.importedTotalsSignature(schedule, rows);
  schedule.placements[0].manualResultRecorded = true;
  schedule.placements[0].manualBroadcastDollars = 25;
  const after = hooks.importedTotalsSignature(schedule, rows);
  assert.notEqual(after, before);
});

"""
test_path.write_text(tests.replace(marker, extra + marker, 1))

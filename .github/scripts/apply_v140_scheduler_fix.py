from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Missing expected source block: {label}")
    return text.replace(old, new, 1)


def sub_once(text, pattern, replacement, label, flags=0):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"Expected one regex replacement for {label}, got {count}")
    return updated


path = Path('assets/js/ui-scheduling.js')
source = path.read_text()

source = replace_once(
    source,
    "  let scheduledDetailRerenderTimer = 0;\n",
    "  let scheduledDetailRerenderTimer = 0;\n  const scheduleSaveQueues = new Map();\n",
    'schedule save queue state'
)

source = sub_once(
    source,
    r"  async function persistSchedules\(schedule\) \{.*?\n  \}\n\n  async function deleteScheduleRecord",
    """  function cloneScheduleForPersistence(schedule = {}) {
    try {
      return JSON.parse(JSON.stringify(schedule || {}));
    } catch (_error) {
      return {
        ...schedule,
        placements: [...(schedule?.placements || [])],
        slotNotes: { ...(schedule?.slotNotes || {}) },
        meta: { ...(schedule?.meta || {}) }
      };
    }
  }

  async function persistSchedules(schedule, options = {}) {
    state.scheduleSlotRescueCache = {};
    if (!schedule) return false;
    const requireRemote = Boolean(options.requireRemote);
    const key = utils.normalizeText(schedule?.id || '') || '__schedule__';
    const previous = scheduleSaveQueues.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      // Snapshot only when this save reaches the head of the queue. That way a later
      // placement added while an earlier request is in flight cannot be overwritten
      // by an older full-row Supabase upsert completing out of order.
      const snapshot = cloneScheduleForPersistence(schedule);
      if (state.scheduleStoreMode === 'remote' && state.client) {
        try {
          await App.data.upsertScheduleRemote(snapshot);
          state.scheduleSyncMessage = 'Fundraisers sync through Supabase.';
          return true;
        } catch (error) {
          console.warn('Remote schedule save failed.', error);
          if (requireRemote) {
            state.scheduleSyncMessage = `Remote save failed. Manual fundraiser dollars were NOT saved to Supabase. ${error.message || ''}`.trim();
            throw error;
          }
          state.scheduleStoreMode = 'local';
          state.scheduleSyncMessage = `Remote save failed. Using this browser only. ${error.message || ''}`.trim();
        }
      }
      if (requireRemote) {
        state.scheduleSyncMessage = 'Manual fundraiser dollars were NOT saved because Supabase schedule sync is unavailable.';
        return false;
      }
      utils.storageSet(constants.SCHEDULE_STORAGE_KEY, state.schedules);
      return false;
    });
    scheduleSaveQueues.set(key, task);
    try {
      return await task;
    } finally {
      if (scheduleSaveQueues.get(key) === task) scheduleSaveQueues.delete(key);
    }
  }

  async function deleteScheduleRecord""",
    'serialized schedule persistence',
    flags=re.S
)

source = sub_once(
    source,
    r"\n\n  async function persistScheduleMetadataOnly\(schedule, options = \{\}\) \{.*?\n  \}\n\n  async function saveActiveScheduleDraft",
    "\n\n  async function saveActiveScheduleDraft",
    'remove duplicate metadata-only persistence path',
    flags=re.S
)

source = replace_once(
    source,
    "    if (!(titleChanged || dateRangeChanged || windowChanged || moneyChanged)) return true;\n    try {\n      const remoteSaved = await persistScheduleMetadataOnly(schedule, { requireRemote: moneyChanged });\n",
    "    const forcePersist = Boolean(options.forcePersist);\n    if (!(titleChanged || dateRangeChanged || windowChanged || moneyChanged || forcePersist)) return true;\n    try {\n      const remoteSaved = await persistSchedules(schedule, { requireRemote: moneyChanged });\n",
    'full-state fundraiser save path'
)

source = replace_once(
    source,
    "      const saved = await saveActiveScheduleDraft({ silent: true });\n",
    "      const saved = await saveActiveScheduleDraft({ silent: true, forcePersist: true });\n",
    'manual Save fundraiser full retry'
)

source = replace_once(
    source,
    "    state.scheduleView.dayStartHour = Math.floor(state.scheduleView.dayStartMinutes / 60);\n    state.scheduleView.dayEndHour = Math.floor(state.scheduleView.dayEndMinutes / 60);\n    renderScheduleGrid();\n  }\n\n  async function movePlacement",
    "    state.scheduleView.dayStartHour = Math.floor(state.scheduleView.dayStartMinutes / 60);\n    state.scheduleView.dayEndHour = Math.floor(state.scheduleView.dayEndMinutes / 60);\n    renderScheduleGrid();\n    if (getActiveSchedule()) void saveActiveScheduleDraft({ silent: true });\n  }\n\n  async function movePlacement",
    'calendar range autosave'
)

source = replace_once(
    source,
    "  function scheduleDetailKeyForPlacement(placement = {}) {\n    if (!placement || placement.isNonPledge || isPlaceholderPlacement(placement)) return '';\n    const directId = String(placement.programId || '').trim();\n    const row = directId ? getProgramRowById(directId) : null;\n    return String(derive.programId(row) || directId || '').trim();\n  }\n",
    """  function scheduleProgramRowForPlacement(placement = {}) {
    if (!placement || placement.isNonPledge || isPlaceholderPlacement(placement)) return null;
    const directId = String(placement.programId || '').trim();
    const directRow = directId ? getProgramRowById(directId) : null;
    if (directRow) return directRow;
    const titleKey = utils.normalizeLookupKey(placement.programTitle || placement.title || '');
    if (!titleKey) return null;
    return [...(state.rawRows || []), ...(state.nonPledgeRows || [])]
      .find((row) => utils.normalizeLookupKey(derive.title(row)) === titleKey) || null;
  }

  function scheduleDetailKeyForPlacement(placement = {}) {
    if (!placement || placement.isNonPledge || isPlaceholderPlacement(placement)) return '';
    const directId = String(placement.programId || '').trim();
    const row = scheduleProgramRowForPlacement(placement);
    return String(scheduleRowLookupId(row) || directId || '').trim();
  }
""",
    'title fallback for scheduled detail lookup'
)

source = replace_once(
    source,
    "  function scheduleDetailHasBreakInfo(detail = {}) {\n    const rows = normalizeScheduledTimingRows(detail?.timings || []);\n    return rows.some((entry) => Number.isFinite(entry.breakSeconds) || Number.isFinite(entry.localCutInSeconds));\n  }\n",
    "  function scheduleDetailHasBreakInfo(detail = {}) {\n    const rows = normalizeScheduledTimingRows(detail?.timings || []);\n    return rows.some((entry) => (Number.isFinite(entry.breakSeconds) && entry.breakSeconds > 0)\n      || (Number.isFinite(entry.localCutInSeconds) && entry.localCutInSeconds > 0));\n  }\n",
    'zero-second break data is not usable break info'
)

source = replace_once(
    source,
    "    const detailKeyByGroup = new Map(groupedEntries.map(([groupKey, occurrences]) => {\n      const row = getProgramRowById(groupKey) || getProgramRowById(occurrences?.[0]?.programId || '') || null;\n      const detailProgramId = String(derive.programId(row) || '').trim();\n      return [groupKey, detailProgramId];\n    }));\n",
    "    const detailKeyByGroup = new Map(groupedEntries.map(([groupKey, occurrences]) => [\n      groupKey,\n      scheduleDetailKeyForPlacement(occurrences?.[0] || {})\n    ]));\n",
    'scheduled detail group lookup'
)

source = replace_once(
    source,
    "      const row = getProgramRowById(programId) || getProgramRowById(occurrences?.[0]?.programId || '') || {};\n",
    "      const row = scheduleProgramRowForPlacement(occurrences?.[0] || {}) || getProgramRowById(programId) || {};\n",
    'scheduled detail row fallback'
)

# New placements should retain a stable lookup identity even for Library rows that lack a canonical id.
assign_start = source.find('  async function assignProgramToSelectedSlot(programId, options = {}) {')
assign_end = source.find('  async function clearSelectedPlacement()', assign_start)
if assign_start < 0 or assign_end < 0:
    raise SystemExit('Could not locate assignProgramToSelectedSlot')
assign_block = source[assign_start:assign_end]
if 'programId: derive.programId(row),' not in assign_block:
    raise SystemExit('Expected assignment program id line not found')
assign_block = assign_block.replace('programId: derive.programId(row),', 'programId: scheduleRowLookupId(row),', 1)
source = source[:assign_start] + assign_block + source[assign_end:]

path.write_text(source)

# Keep release/cache version coherent across the app and report shell.
version = Path('version.json')
version.write_text('{"appVersion":"0.22.140","releasedAt":"2026-09-10"}\n')
reports = Path('reports.html')
reports.write_text(reports.read_text().replace('0.22.139', '0.22.140'))
for test_path in Path('tests').glob('*.test.mjs'):
    text = test_path.read_text()
    if '0.22.139' in text or r'0\.22\.139' in text:
        text = text.replace('0.22.139', '0.22.140').replace(r'0\.22\.139', r'0\.22\.140')
        test_path.write_text(text)

# Strengthen the existing Scheduling safety harness with real concurrency and break-info checks.
test_path = Path('tests/schedule-import-safety.test.mjs')
test = test_path.read_text()
test = replace_once(
    test,
    "globalThis.__scheduleImportTestHooks = { mergeImportedRowsIntoSchedules, deleteMergedImportedScheduleRecords, confirmImportedScheduleDestructiveRepair, reconcileSchedulePlacementResults, importedTotalsSignature };",
    "globalThis.__scheduleImportTestHooks = { mergeImportedRowsIntoSchedules, deleteMergedImportedScheduleRecords, confirmImportedScheduleDestructiveRepair, reconcileSchedulePlacementResults, importedTotalsSignature, persistSchedules, scheduleDetailHasBreakInfo, scheduleDetailKeyForPlacement };",
    'Scheduling test hooks'
)
test = replace_once(
    test,
    "const data = {\n  deleteScheduleRemote: async () => {},\n  fetchImportedAirings: async () => []\n};",
    "const data = {\n  deleteScheduleRemote: async () => {},\n  upsertScheduleRemote: async () => {},\n  fetchImportedAirings: async () => []\n};",
    'Scheduling remote upsert test stub'
)
test = replace_once(
    test,
    "  data.deleteScheduleRemote = async () => {};\n}",
    "  data.deleteScheduleRemote = async () => {};\n  data.upsertScheduleRemote = async () => {};\n}\n",
    'Scheduling reset remote upsert'
)

insert_before = "test('Scheduling imported-result signature changes when placement result state changes', () => {"
new_tests = r'''test('Scheduling autosave serializes full-row Supabase writes so an older placement snapshot cannot overwrite a newer one', async () => {
  resetState();
  state.scheduleStoreMode = 'remote';
  state.client = {};
  const schedule = targetSchedule([{ id: 'one', programId: 'p1', programTitle: 'One' }]);
  state.schedules = [schedule];
  const snapshots = [];
  let releaseFirst = null;
  data.upsertScheduleRemote = async (saved) => {
    snapshots.push((saved.placements || []).map((placement) => placement.id));
    if (snapshots.length === 1) await new Promise((resolve) => { releaseFirst = resolve; });
  };

  const first = hooks.persistSchedules(schedule);
  await new Promise((resolve) => setTimeout(resolve, 0));
  schedule.placements.push({ id: 'two', programId: 'p2', programTitle: 'Two' });
  const second = hooks.persistSchedules(schedule);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(snapshots.length, 1, 'second remote write must wait for the first save to finish');
  assert.ok(releaseFirst, 'first queued save should be waiting in the remote stub');
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(snapshots, [['one'], ['one', 'two']]);
});

test('Scheduling break warning treats zero-second timing rows as missing break information', () => {
  resetState();
  assert.equal(hooks.scheduleDetailHasBreakInfo({ timings: [] }), false);
  assert.equal(hooks.scheduleDetailHasBreakInfo({ timings: [{ pledge_break_seconds: 0, local_cutin_seconds: 0 }] }), false);
  assert.equal(hooks.scheduleDetailHasBreakInfo({ timings: [{ pledge_break_seconds: 30, local_cutin_seconds: 0 }] }), true);
  assert.equal(hooks.scheduleDetailHasBreakInfo({ timings: [{ pledge_break_seconds: 0, local_cutin_seconds: 15 }] }), true);
});

test('Scheduling break-detail lookup can recover an older title-only placement', () => {
  resetState();
  state.rawRows = [{ title: 'Title Only Program', nola_code: 'TOP1', runtime_minutes: 60 }];
  const key = hooks.scheduleDetailKeyForPlacement({ programId: '', programTitle: 'Title Only Program' });
  assert.match(key, /^lookup:/);
});

'''
test = replace_once(test, insert_before, new_tests + insert_before, 'v0.22.140 Scheduling regression tests')
test_path.write_text(test)

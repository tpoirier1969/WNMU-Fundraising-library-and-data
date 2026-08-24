from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)


path = Path('assets/js/ui-scheduling.js')
text = path.read_text()

text = replace_once(
    text,
    "  function mergeImportedRowsIntoSchedules(rows = [], { rebuild = false, activateFirst = true, dirtySchedules = [], allowDuplicateMerges = true, allowCreateMissing = true, allowRefreshPlacements = true, allowTitleUpdates = false } = {}) {",
    "  function mergeImportedRowsIntoSchedules(rows = [], { rebuild = false, activateFirst = true, dirtySchedules = [], allowDuplicateMerges = false, allowCreateMissing = true, allowRefreshPlacements = true, allowTitleUpdates = false, destructiveApproval = false } = {}) {",
    'safe merge defaults'
)

text = replace_once(
    text,
    "    const prepared = prepareImportedScheduleRows(rows);\n    const { sourceRows, groupedRows, skippedRows, groups, diagnostics } = prepared;\n\n    let createdSchedules = 0;",
    "    const prepared = prepareImportedScheduleRows(rows);\n    const { sourceRows, groupedRows, skippedRows, groups, diagnostics } = prepared;\n    const safeAllowDuplicateMerges = Boolean(allowDuplicateMerges && destructiveApproval);\n    const safeRebuild = Boolean(rebuild && destructiveApproval);\n\n    let createdSchedules = 0;",
    'destructive approval flags'
)

text = replace_once(
    text,
    "      const duplicateSchedules = allowDuplicateMerges ? findMergeableDuplicateSchedulesForImportedGroup(schedule, group, groupFileKeys) : [];",
    "      const duplicateSchedules = safeAllowDuplicateMerges ? findMergeableDuplicateSchedulesForImportedGroup(schedule, group, groupFileKeys) : [];",
    'duplicate merge gate'
)

text = replace_once(
    text,
    "      const shouldRefreshPlacements = Boolean(allowRefreshPlacements || createdThisSchedule || duplicateSchedules.length || rebuild);",
    "      const shouldRefreshPlacements = Boolean(allowRefreshPlacements || createdThisSchedule || duplicateSchedules.length || safeRebuild);",
    'rebuild gate'
)

text = replace_once(
    text,
    "checked: analysis.mergeableSchedules > 0, disabled: analysis.mergeableSchedules <= 0",
    "checked: false, disabled: analysis.mergeableSchedules <= 0",
    'duplicate merge not preselected'
)

anchor = "  async function openScheduleRepairOptions(defaultOptions = {}) {"
guard = r'''  function confirmImportedScheduleDestructiveRepair(analysis = {}, options = {}) {
    const wantsMerge = Boolean(options.merge);
    const wantsRebuild = Boolean(options.rebuild);
    if (!wantsMerge && !wantsRebuild) return true;

    const duplicateGroups = (analysis.groupSummaries || []).filter((group) => group.duplicateIds?.length);
    const preview = duplicateGroups.slice(0, 6).map((group) => {
      const range = group.startDate && group.endDate && group.startDate !== group.endDate
        ? `${group.startDate} through ${group.endDate}`
        : (group.startDate || group.endDate || 'date range unavailable');
      return `${group.title || group.scheduleTitle || 'Fundraiser'} (${range}): ${utils.formatCount(group.duplicateIds.length)} duplicate schedule row${group.duplicateIds.length === 1 ? '' : 's'} could be removed after its placements are merged.`;
    });
    const more = duplicateGroups.length > preview.length
      ? `And ${utils.formatCount(duplicateGroups.length - preview.length)} more duplicate fundraiser group${duplicateGroups.length - preview.length === 1 ? '' : 's'}.`
      : '';
    const lines = [
      'MANUAL SCHEDULE CHECK REQUIRED',
      '',
      'Imported fundraiser reports are the factual record of what actually aired, but they do not get permission to erase saved Scheduling work automatically.',
      '',
      wantsMerge ? `Merge is selected. ${utils.formatCount(analysis.mergeableSchedules || 0)} duplicate schedule row${Number(analysis.mergeableSchedules || 0) === 1 ? '' : 's'} may be removed only after their placements are merged into the retained schedule.` : '',
      wantsRebuild ? 'Rebuild is selected. Imported-only placements may be removed and recreated from report evidence. Manual and non-imported scheduled placements are preserved.' : '',
      ...preview,
      more,
      '',
      'Review the Scheduling calendar before authorizing this repair.',
      'Type APPLY SCHEDULE CHANGES to continue. Cancel or any other text makes no destructive schedule change.'
    ].filter(Boolean);
    const typed = window.prompt(lines.join('\n'));
    return String(typed || '').trim().toUpperCase() === 'APPLY SCHEDULE CHANGES';
  }

'''
if anchor not in text:
    raise SystemExit('manual schedule check anchor not found')
text = text.replace(anchor, guard + anchor, 1)

text = replace_once(
    text,
    "  async function deleteMergedImportedScheduleRecords(scheduleIds = []) {\n    const wanted = [...new Set((Array.isArray(scheduleIds) ? scheduleIds : []).map((id) => utils.normalizeText(id)).filter(Boolean))];",
    "  async function deleteMergedImportedScheduleRecords(scheduleIds = [], { explicitApproval = false } = {}) {\n    if (!explicitApproval) {\n      console.warn('Blocked imported schedule deletion because explicit manual approval was not supplied.');\n      return 0;\n    }\n    const wanted = [...new Set((Array.isArray(scheduleIds) ? scheduleIds : []).map((id) => utils.normalizeText(id)).filter(Boolean))];",
    'delete requires explicit approval'
)

text = replace_once(
    text,
    "    const rows = Array.isArray(options.rows) ? options.rows : await App.data.fetchImportedAirings();\n    const preflightConflicts = analyzeImportedScheduleConflicts(rows);",
    "    const rows = Array.isArray(options.rows) ? options.rows : await App.data.fetchImportedAirings();\n    const destructiveRequested = Boolean(options.allowDuplicateMerges || options.rebuild);\n    if (destructiveRequested) {\n      const repairAnalysis = analyzeImportedScheduleRepairs(rows);\n      const approved = confirmImportedScheduleDestructiveRepair(repairAnalysis, {\n        merge: Boolean(options.allowDuplicateMerges),\n        rebuild: Boolean(options.rebuild)\n      });\n      if (!approved) {\n        setNotice('Imported schedule repair cancelled. No schedule rows or placements were removed.', 'warn');\n        return null;\n      }\n    }\n    const preflightConflicts = analyzeImportedScheduleConflicts(rows);",
    'build destructive manual check'
)

text = replace_once(
    text,
    "      allowRefreshPlacements: options.allowRefreshPlacements !== false,\n      allowTitleUpdates: Boolean(options.allowTitleUpdates)\n    });",
    "      allowRefreshPlacements: options.allowRefreshPlacements !== false,\n      allowTitleUpdates: Boolean(options.allowTitleUpdates),\n      destructiveApproval: destructiveRequested\n    });",
    'pass internal destructive approval'
)

text = replace_once(
    text,
    "      summary.removedScheduleRecords = await deleteMergedImportedScheduleRecords(summary.removedScheduleIds);",
    "      summary.removedScheduleRecords = await deleteMergedImportedScheduleRecords(summary.removedScheduleIds, { explicitApproval: destructiveRequested });",
    'approved duplicate deletion call'
)

path.write_text(text)

Path('tests/schedule-import-safety.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scheduling = fs.readFileSync(new URL('../assets/js/ui-scheduling.js', import.meta.url), 'utf8');
const imports = fs.readFileSync(new URL('../assets/js/ui-imports.js', import.meta.url), 'utf8');

test('ordinary Results Import never mutates fundraiser schedules', () => {
  assert.match(imports, /Results Import never creates, merges, repairs, or changes fundraiser schedules\./);
  assert.match(imports, /allowDuplicateMerges:\s*false/);
  assert.match(imports, /allowRefreshPlacements:\s*false/);
  assert.match(imports, /rebuild:\s*false/);
});

test('duplicate schedule merge is never preselected and defaults safe', () => {
  assert.match(scheduling, /allowDuplicateMerges = false/);
  assert.match(scheduling, /key: 'merge'[\s\S]{0,500}checked: false/);
});

test('destructive imported schedule repairs require a typed manual check', () => {
  assert.match(scheduling, /MANUAL SCHEDULE CHECK REQUIRED/);
  assert.match(scheduling, /Type APPLY SCHEDULE CHANGES to continue/);
  assert.match(scheduling, /confirmImportedScheduleDestructiveRepair/);
  assert.match(scheduling, /destructiveRequested = Boolean\(options\.allowDuplicateMerges \|\| options\.rebuild\)/);
});

test('low-level duplicate schedule deletion refuses calls without explicit approval', () => {
  assert.match(scheduling, /deleteMergedImportedScheduleRecords\(scheduleIds = \[\], \{ explicitApproval = false \} = \{\}\)/);
  assert.match(scheduling, /if \(!explicitApproval\) \{[\s\S]{0,180}return 0;/);
  assert.match(scheduling, /explicitApproval: destructiveRequested/);
});

test('report title conflicts preserve the existing scheduled program automatically', () => {
  assert.match(scheduling, /No scheduled program will be deleted or replaced automatically\./);
  assert.match(scheduling, /keep the existing schedule and add only non-conflicting imported placements/);
});
''')

Path('version.json').write_text('{"appVersion":"0.22.96","releasedAt":"2026-08-24"}\n')

from pathlib import Path
import json


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_region(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"{label}: start marker not found")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{label}: end marker not found")
    if text.find(start_marker, start + 1) >= 0:
        raise SystemExit(f"{label}: start marker not unique")
    return text[:start] + replacement + text[end:]


# Match memory: only human-confirmed rows can teach future imports.
data_path = Path('assets/js/data.js')
data = data_path.read_text(encoding='utf-8')
data = replace_once(
    data,
    ".in('match_method', ['manual_library', 'saved_title_rule'])",
    ".eq('match_method', 'manual_library')",
    'manual-only match-memory query'
)
data = replace_once(
    data,
    "return (allRows || []).filter((row) => ['manual_library', 'saved_title_rule'].includes(String(row?.match_method || '').trim().toLowerCase()));",
    "return (allRows || []).filter((row) => String(row?.match_method || '').trim().toLowerCase() === 'manual_library');",
    'manual-only match-memory fallback'
)
data_path.write_text(data, encoding='utf-8')

imports_path = Path('assets/js/ui-imports.js')
imports = imports_path.read_text(encoding='utf-8')
imports = replace_once(
    imports,
    "    const localRules = utils.storageGet(IMPORT_MATCH_RULES_STORAGE_KEY, []);",
    "    const localRules = (utils.storageGet(IMPORT_MATCH_RULES_STORAGE_KEY, []) || [])\n      .filter((rule) => !String(rule?.id || '').startsWith('history:'));",
    'purge cached historical auto-rules'
)
imports = replace_once(
    imports,
    "      if (!['manual_library', 'saved_title_rule'].includes(method)) return;",
    "      if (method !== 'manual_library') return;",
    'manual-only historical alias source'
)

alias_block = """    const aliasRule = findAliasRuleForRow({ station, imported_program_title: importedTitle, nola_code: importedCode });
    if (aliasRule) {
      const target = (state.rawRows || []).find((row) => String(derive.programId(row) || '').trim() === String(aliasRule.targetProgramId || '').trim()) || null;
      if (target) {
        const scopeLabel = aliasRule.matchScope === 'title' ? 'saved import-title rule' : 'saved import-title/NOLA rule';
        return { program: target, matchMethod: 'saved_title_rule', matchReason: `Matched from a ${scopeLabel}.` };
      }
    }
"""
if imports.count(alias_block) != 1:
    raise SystemExit(f"saved alias priority block: expected one match, found {imports.count(alias_block)}")
imports = imports.replace(alias_block, '', 1)
safe_anchor = """    if (specificNola && broadImportedTitle(importedTitle)) {
      return { program: null, matchMethod: 'unmatched', matchReason: `NOLA ${importedLibraryNola} did not match a pledge-library NOLA after normalization. The imported title “${importedTitle}” is too broad for safe fuzzy title matching.` };
    }
"""
if imports.count(safe_anchor) != 1:
    raise SystemExit(f"saved alias fallback anchor: expected one match, found {imports.count(safe_anchor)}")
imports = imports.replace(safe_anchor, safe_anchor + alias_block, 1)

old_final_tone = "      const finalTone = (verification?.missingDateCount || scheduleError) ? 'warn' : 'success';"
new_final_tone = """      const scheduleConflictCount = Number(scheduleSummary?.scheduleConflicts || 0) || 0;
      if (scheduleConflictCount > 0) {
        success += ` WARNING: ${utils.formatCount(scheduleConflictCount)} imported airing${scheduleConflictCount === 1 ? '' : 's'} did not match the existing calendar at the same date/time. Existing scheduled programming was left unchanged.`;
      }
      if (scheduleSummary?.scheduleChangesSkipped) {
        success += ' No scheduler changes from this import were applied because review was requested.';
      }
      const finalTone = (verification?.missingDateCount || scheduleError || scheduleConflictCount > 0 || scheduleSummary?.scheduleChangesSkipped) ? 'warn' : 'success';"""
imports = replace_once(imports, old_final_tone, new_final_tone, 'import conflict result banner')
imports_path.write_text(imports, encoding='utf-8')

sched_path = Path('assets/js/ui-scheduling.js')
sched = sched_path.read_text(encoding='utf-8')

old_normalize = """    next.placements = (Array.isArray(next.placements) ? next.placements : []).filter((placement) => {
      return !(placement?.importedFromReport && placementLooksNonSpecific(placement));
    }).map((placement) => ({"""
new_normalize = """    next.placements = (Array.isArray(next.placements) ? next.placements : []).map((placement) => ({"""
sched = replace_once(sched, old_normalize, new_normalize, 'remove normalization-time placement deletion')

heal_start = sched.find('  async function healImportedSchedulesIfNeeded() {')
heal_end = sched.find('\n\n  function scheduleWarmupDelay', heal_start)
if heal_start < 0 or heal_end < 0:
    raise SystemExit('automatic schedule heal function region not found')
sched = sched[:heal_start] + sched[heal_end + 2:]
heal_call = """    void healImportedSchedulesIfNeeded()
      .then(() => {
        ensureCurrentScheduleApplied();
        if (state.activeWorkspace === 'scheduling') renderAll();
      })
      .catch((error) => {
        console.warn('Imported schedule auto-heal failed.', error);
      });
"""
if sched.count(heal_call) != 1:
    raise SystemExit(f"automatic schedule heal call: expected one match, found {sched.count(heal_call)}")
sched = sched.replace(heal_call, '', 1)

merge_marker = '  function mergeImportedRowsIntoSchedules(rows = [],'
merge_pos = sched.find(merge_marker)
if merge_pos < 0:
    raise SystemExit('mergeImportedRowsIntoSchedules not found')
conflict_helpers = r'''  function scheduledPlacementMatchesImported(existing = {}, incoming = {}) {
    if (!existing || !incoming) return false;
    const existingHash = String(existing?.sourceAiringHash || '').trim();
    const incomingHash = String(incoming?.sourceAiringHash || '').trim();
    if (existingHash && incomingHash && existingHash === incomingHash) return true;
    const existingId = String(existing?.programId || '').trim();
    const incomingId = String(incoming?.programId || '').trim();
    if (existingId && incomingId && existingId === incomingId) return true;
    const existingTitle = utils.normalizeLookupKey(existing?.programTitle || '');
    const incomingTitle = utils.normalizeLookupKey(incoming?.programTitle || '');
    if (existingTitle && incomingTitle && existingTitle === incomingTitle) return true;
    const existingNola = importedNolaCodeKey(utils.firstNonEmpty(existing?.nolaCode, existing?.nola, ''));
    const incomingNola = importedNolaCodeKey(utils.firstNonEmpty(incoming?.nolaCode, incoming?.nola, ''));
    return Boolean(existingNola && incomingNola && existingNola === incomingNola);
  }

  function importedScheduleConflict(schedule = {}, placement = {}) {
    if (!schedule || !placement?.dateKey || !Number.isFinite(Number(placement?.startMinutes))) return null;
    const slotKey = `${placement.dateKey}|${Number(placement.startMinutes)}`;
    const existing = findPlacementForSlot(schedule, slotKey);
    if (!existing || scheduledPlacementMatchesImported(existing, placement)) return null;
    return {
      scheduleId: schedule.id || '',
      scheduleTitle: schedule.title || '',
      dateKey: placement.dateKey,
      startMinutes: Number(placement.startMinutes),
      scheduledTitle: existing.programTitle || 'Scheduled block',
      importedTitle: placement.programTitle || 'Imported report title',
      existingPlacementId: existing.id || '',
      importedRowHash: placement.sourceAiringHash || ''
    };
  }

  function analyzeImportedScheduleConflicts(rows = []) {
    const prepared = prepareImportedScheduleRows(rows);
    const conflicts = [];
    (prepared.groups || []).forEach((group) => {
      if (group?.spansCalendarYears || group?.suspiciousSpan) return;
      const schedule = findExistingScheduleForImportedGroup(group, groupImportedFileKeys(group));
      if (!schedule) return;
      (group.rows || []).forEach((entry) => {
        if (entry?.isNonSpecific || !canBuildImportedPlacement(entry) || !entry?.dateKey || !Number.isFinite(importedRowStartMinutes(entry.row))) return;
        const placement = buildPlacementFromImportedAiring({ ...entry, startMinutes: importedRowStartMinutes(entry.row) });
        const conflict = importedScheduleConflict(schedule, placement);
        if (conflict) conflicts.push(conflict);
      });
    });
    const seen = new Set();
    return conflicts.filter((item) => {
      const key = `${item.scheduleId}|${item.dateKey}|${item.startMinutes}|${utils.normalizeLookupKey(item.scheduledTitle)}|${utils.normalizeLookupKey(item.importedTitle)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function importedScheduleConflictPrompt(conflicts = []) {
    const preview = (Array.isArray(conflicts) ? conflicts : []).slice(0, 6).map((item) => {
      return `${formatScheduleDay(item.dateKey)} ${utils.minutesToLabel(item.startMinutes)}: schedule has “${item.scheduledTitle}”; report says “${item.importedTitle}”`;
    });
    const more = conflicts.length > preview.length ? `\n…and ${conflicts.length - preview.length} more conflict${conflicts.length - preview.length === 1 ? '' : 's'}.` : '';
    return [
      "What you just imported doesn't appear to match what's in the schedule.",
      '',
      ...preview,
      more,
      '',
      'No scheduled program will be deleted or replaced automatically.',
      '',
      'Click OK to keep the existing schedule and add only non-conflicting imported placements.',
      'Click Cancel to make NO schedule changes from this import so you can review the calendar first.'
    ].filter((line) => line !== '').join('\n');
  }

'''
sched = sched[:merge_pos] + conflict_helpers + sched[merge_pos:]

old_refresh_block = """      if (!createdThisSchedule) {
        updatedSchedules += 1;
        if (shouldRefreshPlacements && rebuild) {
          schedule.placements = (schedule.placements || []).filter((item) => !item.importedFromReport);
        } else if (shouldRefreshPlacements) {
          schedule.placements = (schedule.placements || []).filter((placement) => {
            if (!placement?.importedFromReport) return true;
            const sameImportedKey = utils.normalizeText(placement?.importedFundraiserKey) === utils.normalizeText(group.key);
            const sameFile = groupFileKeys.has(utils.normalizeLookupKey(placement?.sourceName || ''));
            const inGroupRange = placement?.dateKey && group.startDate && group.endDate
              ? placement.dateKey >= group.startDate && placement.dateKey <= group.endDate
              : false;
            return !(sameImportedKey || (sameFile && inGroupRange));
          });
        }
      }
"""
new_refresh_block = """      if (!createdThisSchedule) updatedSchedules += 1;
"""
sched = replace_once(sched, old_refresh_block, new_refresh_block, 'remove import refresh placement deletion')

sched = replace_once(
    sched,
    '    let unresolvedCollisions = 0;\n    let mergedDuplicateSchedules = 0;',
    '    let unresolvedCollisions = 0;\n    const scheduleConflicts = [];\n    let mergedDuplicateSchedules = 0;',
    'add schedule conflict accumulator'
)

old_loop_anchor = """        if (!placement) return;
        placement.importedFundraiserKey = group.key;
        const dedupeKey = placement.sourceAiringHash || `${placement.programId}|${placement.dateKey}|${placement.startMinutes}`;
"""
new_loop_anchor = """        if (!placement) return;
        placement.importedFundraiserKey = group.key;
        const conflict = importedScheduleConflict(schedule, placement);
        if (conflict) {
          scheduleConflicts.push(conflict);
          skippedPlacements += 1;
          return;
        }
        const existingAtSlot = findPlacementForSlot(schedule, placement.startSlotKey);
        if (existingAtSlot && scheduledPlacementMatchesImported(existingAtSlot, placement)) {
          existingAtSlot.importedBroadcastDollars = Number(placement.importedBroadcastDollars || 0) || 0;
          if (placement.sourceAiringHash) existingAtSlot.sourceAiringHash = placement.sourceAiringHash;
          if (placement.sourceImportBatchId) existingAtSlot.sourceImportBatchId = placement.sourceImportBatchId;
          existingAtSlot.importMatchMethod = placement.importMatchMethod || existingAtSlot.importMatchMethod || '';
          existingAtSlot.importMatchReason = placement.importMatchReason || existingAtSlot.importMatchReason || '';
          skippedPlacements += 1;
          return;
        }
        const dedupeKey = placement.sourceAiringHash || `${placement.programId}|${placement.dateKey}|${placement.startMinutes}`;
"""
sched = replace_once(sched, old_loop_anchor, new_loop_anchor, 'protect occupied slots during import merge')

old_coverage = """      const coverage = shouldRefreshPlacements ? reconcileImportedScheduleCoverage(schedule, scheduleableRows, group.key) : null;
      restoredPlacements += Number(coverage?.restoredPlacements || 0) || 0;
      reboundPlacements += Number(coverage?.reboundPlacements || 0) || 0;
      unresolvedCollisions += Number(coverage?.unresolvedCollisions || 0) || 0;
"""
new_coverage = """      // Existing calendar blocks are authoritative. Imported rows never replace them here.
"""
sched = replace_once(sched, old_coverage, new_coverage, 'disable replacement-oriented import reconciliation')

old_return_piece = """      unresolvedCollisions,
      mergedDuplicateSchedules,
"""
new_return_piece = """      unresolvedCollisions,
      scheduleConflicts: scheduleConflicts.length,
      scheduleConflictDetails: scheduleConflicts.slice(0, 25),
      mergedDuplicateSchedules,
"""
sched = replace_once(sched, old_return_piece, new_return_piece, 'return schedule conflicts')

old_build_start = """  async function buildSchedulesFromImportedReports(options = {}) {
    if (!canScheduleEdit()) { setNotice('Sign in as admin to build fundraiser calendars from imported reports.', 'warn'); return null; }
    const rows = Array.isArray(options.rows) ? options.rows : await App.data.fetchImportedAirings();
    const dirtySchedules = [];
    const summary = mergeImportedRowsIntoSchedules(rows, {
"""
new_build_start = """  async function buildSchedulesFromImportedReports(options = {}) {
    if (!canScheduleEdit()) { setNotice('Sign in as admin to build fundraiser calendars from imported reports.', 'warn'); return null; }
    const rows = Array.isArray(options.rows) ? options.rows : await App.data.fetchImportedAirings();
    const preflightConflicts = analyzeImportedScheduleConflicts(rows);
    if (preflightConflicts.length && options.promptOnConflicts !== false) {
      const proceedSafely = window.confirm(importedScheduleConflictPrompt(preflightConflicts));
      if (!proceedSafely) {
        setNotice(`Imported report results were kept, but no calendar changes were made because ${utils.formatCount(preflightConflicts.length)} schedule conflict${preflightConflicts.length === 1 ? '' : 's'} need review.`, 'warn');
        return {
          schedulesCreated: 0,
          schedulesUpdated: 0,
          placementsCreated: 0,
          placementsSkipped: 0,
          skippedRows: 0,
          correctedDurations: 0,
          restoredPlacements: 0,
          reboundPlacements: 0,
          unresolvedCollisions: preflightConflicts.length,
          scheduleConflicts: preflightConflicts.length,
          scheduleConflictDetails: preflightConflicts.slice(0, 25),
          scheduleChangesSkipped: true,
          mergedDuplicateSchedules: 0,
          suspiciousSpanGroups: 0,
          suspiciousSpanRows: 0,
          removedScheduleIds: [],
          fundraiserCount: 0,
          diagnostics: { inputRows: rows.length, droppedRows: [] }
        };
      }
    }
    const dirtySchedules = [];
    const summary = mergeImportedRowsIntoSchedules(rows, {
"""
sched = replace_once(sched, old_build_start, new_build_start, 'schedule conflict preflight')

sched = replace_once(
    sched,
    '      allowDuplicateMerges: options.allowDuplicateMerges !== false,',
    '      allowDuplicateMerges: Boolean(options.allowDuplicateMerges),',
    'make duplicate schedule merge opt-in'
)

old_after_merge = """    for (const schedule of dirtySchedules) {
      await persistSchedules(schedule);
    }
"""
new_after_merge = """    summary.scheduleConflicts = Math.max(Number(summary.scheduleConflicts || 0) || 0, preflightConflicts.length);
    if (preflightConflicts.length) summary.scheduleConflictDetails = preflightConflicts.slice(0, 25);
    for (const schedule of dirtySchedules) {
      await persistSchedules(schedule);
    }
"""
sched = replace_once(sched, old_after_merge, new_after_merge, 'merge preflight conflict summary')

old_placeholder_existing = """    const existing = findPlacementForSlot(schedule, slot.key);
    const base = {
"""
new_placeholder_existing = """    const existing = findPlacementForSlot(schedule, slot.key);
    if (existing && !isPlaceholderPlacement(existing)) {
      showScheduleModalWarning('That slot already contains a scheduled program. Use Admin right-click → Delete scheduled block first if you really intend to remove it.', 'bad');
      return false;
    }
    const base = {
"""
sched = replace_once(sched, old_placeholder_existing, new_placeholder_existing, 'placeholder cannot overwrite real program')

old_assign_existing = """    const existing = findPlacementForSlot(schedule, slot.key);
    const endMinutes = slot.minutes + (slotCount * constants.DEFAULT_SLOT_MINUTES);
"""
new_assign_existing = """    const existing = findPlacementForSlot(schedule, slot.key);
    const existingSameProgram = existing && !isPlaceholderPlacement(existing)
      && String(existing.programId || '').trim() === String(derive.programId(row) || '').trim();
    if (existing && !isPlaceholderPlacement(existing) && !existingSameProgram) {
      showScheduleModalWarning('That slot already contains a scheduled program. It will not be replaced. Use Admin right-click → Delete scheduled block first.', 'bad');
      return;
    }
    const endMinutes = slot.minutes + (slotCount * constants.DEFAULT_SLOT_MINUTES);
"""
sched = replace_once(sched, old_assign_existing, new_assign_existing, 'program assignment cannot overwrite')

clear_start = sched.find('  async function clearSelectedPlacement() {')
clear_end = sched.find('\n\n  async function updateLiveBreakFlag()', clear_start)
if clear_start < 0 or clear_end < 0:
    raise SystemExit('clearSelectedPlacement region not found')
clear_replacement = """  async function clearSelectedPlacement() {
    if (!canScheduleEdit()) { showScheduleModalWarning('Viewer mode. Sign in as admin to remove programs.', 'bad'); return false; }
    showScheduleModalWarning('Scheduled programs can only be removed with Admin right-click → Delete scheduled block.', 'warn');
    return false;
  }
"""
sched = sched[:clear_start] + clear_replacement + sched[clear_end:]

sched = sched.replace(
    "      if (els.scheduleClearPlacementButton) els.scheduleClearPlacementButton.disabled = !editable;",
    "      if (els.scheduleClearPlacementButton) { els.scheduleClearPlacementButton.disabled = true; els.scheduleClearPlacementButton.classList.add('hidden'); }"
)
sched = sched.replace(
    "      if (els.scheduleClearPlacementButton) els.scheduleClearPlacementButton.disabled = true;",
    "      if (els.scheduleClearPlacementButton) { els.scheduleClearPlacementButton.disabled = true; els.scheduleClearPlacementButton.classList.add('hidden'); }"
)

old_move_anchor = """    const slotCount = Math.max(1, Math.ceil(Number(placement.lengthMinutes || 30) / constants.DEFAULT_SLOT_MINUTES));
    placement.dateKey = targetDateKey;
"""
new_move_anchor = """    const slotCount = Math.max(1, Math.ceil(Number(placement.lengthMinutes || 30) / constants.DEFAULT_SLOT_MINUTES));
    const occupiedTarget = findPlacementForSlot(schedule, `${targetDateKey}|${targetMinutes}`);
    if (occupiedTarget && occupiedTarget.id !== placement.id) {
      setNotice(`Cannot move ${placement.programTitle} onto ${occupiedTarget.programTitle}. Delete the existing target block first with Admin right-click → Delete scheduled block.`, 'warn');
      return;
    }
    placement.dateKey = targetDateKey;
"""
sched = replace_once(sched, old_move_anchor, new_move_anchor, 'move cannot overwrite')

old_paste = """    const existing = findPlacementForSlot(schedule, slot.key);
    if (existing) schedule.placements = schedule.placements.filter((item) => item.id !== existing.id);
    const lengthMinutes = placeholder ? placeholderLengthMinutes(clip.lengthMinutes) : Number(derive.runtimeMinutes(row) || clip.lengthMinutes || 30);
"""
new_paste = """    const existing = findPlacementForSlot(schedule, slot.key);
    if (existing) {
      showScheduleModalWarning(`That slot already contains ${existing.programTitle}. Paste will not replace it. Use Admin right-click → Delete scheduled block first.`, 'bad');
      return false;
    }
    const lengthMinutes = placeholder ? placeholderLengthMinutes(clip.lengthMinutes) : Number(derive.runtimeMinutes(row) || clip.lengthMinutes || 30);
"""
sched = replace_once(sched, old_paste, new_paste, 'paste cannot overwrite')

old_rescue = """    const existingSlotPlacement = findPlacementForSlot(schedule, slot.key);
    const existingHashPlacement = scheduleImportedPlacementByHash(schedule, rowHash);
    schedule.placements = (schedule.placements || []).filter((item) => item.id !== existingSlotPlacement?.id && item.id !== existingHashPlacement?.id);
    if (existingHashPlacement?.transferredToStation || existingSlotPlacement?.transferredToStation) placement.transferredToStation = true;
    if (hasLiveBreakFlag(existingHashPlacement) || hasLiveBreakFlag(existingSlotPlacement)) {
      placement.liveBreakFlag = true;
      placement.liveBreakNotes = existingHashPlacement?.liveBreakNotes || existingSlotPlacement?.liveBreakNotes || '';
    }
    schedule.placements.push({
      ...placement,
      id: existingHashPlacement?.id || existingSlotPlacement?.id || placement.id
    });
"""
new_rescue = """    const existingSlotPlacement = findPlacementForSlot(schedule, slot.key);
    const existingHashPlacement = scheduleImportedPlacementByHash(schedule, rowHash);
    if (existingSlotPlacement) {
      showScheduleModalWarning(`That slot already contains ${existingSlotPlacement.programTitle}. Imported-row rescue will not replace it. Use Admin right-click → Delete scheduled block first.`, 'bad');
      return false;
    }
    if (existingHashPlacement) {
      showScheduleModalWarning(`That imported airing is already scheduled as ${existingHashPlacement.programTitle}. It was not moved or duplicated.`, 'warn');
      return false;
    }
    schedule.placements.push(placement);
"""
sched = replace_once(sched, old_rescue, new_rescue, 'rescue cannot delete/replace')

sched_path.write_text(sched, encoding='utf-8')

version_path = Path('version.json')
version = json.loads(version_path.read_text(encoding='utf-8'))
if version.get('appVersion') != '0.22.60':
    raise SystemExit(f"Expected version 0.22.60, found {version.get('appVersion')!r}")
version['appVersion'] = '0.22.61'
version['releasedAt'] = '2026-08-12'
version_path.write_text(json.dumps(version, separators=(',', ':')) + '\n', encoding='utf-8')

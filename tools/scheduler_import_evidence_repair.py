from pathlib import Path
import json


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


sched_path = Path("assets/js/ui-scheduling.js")
imports_path = Path("assets/js/ui-imports.js")
version_path = Path("version.json")

old_identity = '''  function importedNolaCodeKey(value = '') {
    if (typeof utils.nolaCodeKey === 'function') return utils.nolaCodeKey(value);
    return utils.normalizeText(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function importedNaturalKey(row = {}) {
    const canonicalProgramId = String(utils.firstNonEmpty(row.program_id, row.pledge_program_id, row.manual_match_program_id, '') || '').trim();
    const identity = canonicalProgramId
      ? `program_id:${canonicalProgramId}`
      : (utils.nolaIdentityKey(
          row.nola_code || row.nola || row.program_nola || '',
          row.program_title || row.imported_program_title || row.title || row.name || ''
        ) || utils.normalizeLookupKey(row.program_title || row.imported_program_title || row.title || row.name || ''));
    return [
      identity,
      utils.normalizeText(row.air_date) || utils.dateKeyFromDate(row.aired_at) || '',
      utils.normalizeText(row.air_time) || '',
      utils.normalizeText(row.drive_start_date) || '',
      utils.normalizeText(row.drive_end_date) || ''
    ].join('|').toLowerCase();
  }
'''

new_identity = '''  function importedNolaCodeKey(value = '') {
    if (typeof utils.nolaCodeKey === 'function') return utils.nolaCodeKey(value);
    return utils.normalizeText(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function importedSourceIdentityCode(row = {}) {
    const raw = row?.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {};
    return utils.normalizeText(utils.firstNonEmpty(
      row?.source_report_code,
      row?.imported_report_code,
      row?.imported_nola_code,
      raw?.nola_code,
      raw?.nola,
      raw?.program_nola,
      raw?.program_code,
      raw?.episode_code,
      ''
    ) || '');
  }

  function importedSourceIdentity(row = {}) {
    const sourceCodeKey = importedNolaCodeKey(importedSourceIdentityCode(row));
    if (sourceCodeKey) return `source_code:${sourceCodeKey}`;
    const importedTitle = utils.normalizeLookupKey(row.imported_program_title || row.program_title || row.title || row.name || '');
    return importedTitle ? `source_title:${importedTitle}` : '';
  }

  function importedNaturalKey(row = {}) {
    const identity = importedSourceIdentity(row);
    return [
      utils.normalizeLookupKey(row.station || ''),
      identity,
      utils.normalizeText(row.air_date) || utils.dateKeyFromDate(row.aired_at) || '',
      utils.normalizeText(row.air_time) || ''
    ].join('|').toLowerCase();
  }
'''
replace_once(sched_path, old_identity, new_identity, "scheduler stable imported identity")

old_candidates = '''    const candidates = [
      ['id', placement.programId || derive.programId(row)],
      ['nola', placement.nolaCode || placement.nola || derive.nola(row)],
      ['title', placement.programTitle || derive.title(row)]
    ];
'''
new_candidates = '''    const candidates = [
      ['id', placement.programId || derive.programId(row)],
      ['nola', placement.nolaCode || placement.nola || derive.nola(row)],
      ['title', placement.programTitle || derive.title(row)],
      // The slot map deliberately keeps the original imported title separately from the
      // library title. Exact day/time + imported title is valid airing evidence even when
      // a library match was corrected after the report was first loaded.
      ['imported', placement.programTitle || derive.title(row)]
    ];
'''
replace_once(sched_path, old_candidates, new_candidates, "scheduler imported-title evidence")

old_existing_slot = '''        if (existingAtSlot && scheduledPlacementMatchesImported(existingAtSlot, placement)) {
          existingAtSlot.importedBroadcastDollars = Number(placement.importedBroadcastDollars || 0) || 0;
          if (placement.sourceAiringHash) existingAtSlot.sourceAiringHash = placement.sourceAiringHash;
          if (placement.sourceImportBatchId) existingAtSlot.sourceImportBatchId = placement.sourceImportBatchId;
          existingAtSlot.importMatchMethod = placement.importMatchMethod || existingAtSlot.importMatchMethod || '';
          existingAtSlot.importMatchReason = placement.importMatchReason || existingAtSlot.importMatchReason || '';
          skippedPlacements += 1;
          return;
        }
'''
new_existing_slot = '''        if (existingAtSlot && scheduledPlacementMatchesImported(existingAtSlot, placement)) {
          // A manually restored block that exactly matches an imported airing should keep
          // its calendar identity, but it can safely inherit the report evidence attached
          // to that exact slot. This never replaces a different scheduled program.
          existingAtSlot.importedFromReport = true;
          existingAtSlot.importedBroadcastDollars = Number(placement.importedBroadcastDollars || 0) || 0;
          if (placement.sourceAiringHash) existingAtSlot.sourceAiringHash = placement.sourceAiringHash;
          if (placement.sourceImportBatchId) existingAtSlot.sourceImportBatchId = placement.sourceImportBatchId;
          if (placement.importedFundraiserKey) existingAtSlot.importedFundraiserKey = placement.importedFundraiserKey;
          if (placement.sourceName) existingAtSlot.sourceName = placement.sourceName;
          existingAtSlot.sourceLabel = placement.sourceLabel || existingAtSlot.sourceLabel || 'Imported report';
          existingAtSlot.nolaCode = placement.nolaCode || existingAtSlot.nolaCode || '';
          existingAtSlot.importMatchMethod = placement.importMatchMethod || existingAtSlot.importMatchMethod || '';
          existingAtSlot.importMatchReason = placement.importMatchReason || existingAtSlot.importMatchReason || '';
          skippedPlacements += 1;
          return;
        }
'''
replace_once(sched_path, old_existing_slot, new_existing_slot, "bind exact imported evidence to existing schedule slot")

old_import_refresh = '''      await refreshTableStatus({ silent: true });
      await refreshExistingUnlinkedRows({ silent: true });
      renderAll();
      let verification = null;
'''
new_import_refresh = '''      await refreshTableStatus({ silent: true });
      await refreshExistingUnlinkedRows({ silent: true });
      // Results Import changes the exact airing evidence used by scheduler green/blue
      // markers. Invalidate and rebuild those caches immediately so calendar state does
      // not lag behind the dollars that were just written.
      await App.schedulingUi?.refreshImportedAiringMarkers?.();
      renderAll();
      let verification = null;
'''
replace_once(imports_path, old_import_refresh, new_import_refresh, "refresh scheduler markers after results import")

version = json.loads(version_path.read_text(encoding="utf-8"))
if version.get("appVersion") != "0.22.69":
    raise SystemExit(f"Expected v0.22.69 before repair, found {version.get('appVersion')}")
version["appVersion"] = "0.22.70"
version["releasedAt"] = "2026-08-19"
version_path.write_text(json.dumps(version, separators=(",", ":")) + "\n", encoding="utf-8")

print("Scheduler imported-airing evidence repair staged successfully.")

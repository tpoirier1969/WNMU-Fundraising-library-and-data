from pathlib import Path
import json

analytics_path = Path("assets/js/ui-analytics.js")
source = analytics_path.read_text()

marker = "  function buildScheduleRecords(schedules = [], libraryRows = [], airingRecords = []) {"
if marker not in source:
    raise SystemExit("buildScheduleRecords marker not found")

helper = """  function schedulePlacementDedupeKey(placement = {}) {
    const dateKey = text(placement.dateKey || placement.date_key || '');
    const start = Number(placement.startMinutes ?? placement.start_minutes ?? placement.start ?? NaN);
    const pid = text(firstNonEmpty(placement.programId, placement.program_id, ''));
    const nola = nolaKey(firstNonEmpty(placement.nolaCode, placement.nola_code, placement.nola, placement.program_nola, ''));
    const title = lookupKey(firstNonEmpty(placement.programTitle, placement.program_title, placement.title, placement.name, ''));
    const identity = pid ? `id:${pid}` : (nola ? `nola:${nola}` : (title ? `title:${title}` : ''));
    if (dateKey && Number.isFinite(start) && identity) return `${dateKey}|${start}|${identity}`;
    const hash = text(placement.sourceAiringHash || placement.source_airing_hash || '');
    return hash ? `hash:${hash}` : '';
  }

  function schedulePlacementPreferenceScore(placement = {}) {
    let score = 0;
    if (!placement.importedFromReport) score += 1000;
    if (placementLive(placement)) score += 500;
    if (placement.transferredToStation) score += 250;
    if (placement.manualResultRecorded) score += 200;
    if (text(placement.sourceAiringHash || placement.source_airing_hash || '')) score += 100;
    if (placement.importedBroadcastDollars !== '' && placement.importedBroadcastDollars != null) score += 50;
    if (!placement.isPlaceholder) score += 10;
    return score;
  }

  function dedupeSchedulePlacementsForAnalytics(placements = []) {
    const kept = [];
    const indexes = new Map();
    let suppressed = 0;
    (placements || []).forEach((placement) => {
      const key = schedulePlacementDedupeKey(placement);
      if (!key) {
        kept.push(placement);
        return;
      }
      if (!indexes.has(key)) {
        indexes.set(key, kept.length);
        kept.push(placement);
        return;
      }
      suppressed += 1;
      const index = indexes.get(key);
      if (schedulePlacementPreferenceScore(placement) > schedulePlacementPreferenceScore(kept[index])) kept[index] = placement;
    });
    return { placements: kept, suppressed };
  }

"""
if "function dedupeSchedulePlacementsForAnalytics" not in source:
    source = source.replace(marker, helper + marker, 1)

old_diag = "const diagnostics = { schedulePlacements: 0, livePlacements: 0, liveRows: 0, liveDollars: 0, unmatchedLivePlacements: 0, implicitZeroRows: 0 };"
new_diag = "const diagnostics = { schedulePlacements: 0, duplicatePlacementsSuppressed: 0, livePlacements: 0, liveRows: 0, liveDollars: 0, unmatchedLivePlacements: 0, implicitZeroRows: 0 };"
if old_diag not in source:
    raise SystemExit("diagnostics target not found")
source = source.replace(old_diag, new_diag, 1)

old_loop = "  schedules.forEach((schedule) => {\n    (schedule.placements || []).forEach((placement) => {"
new_loop = "  schedules.forEach((schedule) => {\n    const placementSet = dedupeSchedulePlacementsForAnalytics(schedule.placements || []);\n    diagnostics.duplicatePlacementsSuppressed += placementSet.suppressed;\n    placementSet.placements.forEach((placement) => {"
if old_loop not in source:
    raise SystemExit("schedule loop target not found")
source = source.replace(old_loop, new_loop, 1)

duration_anchor = """      const durationNote = durationMismatchCount
        ? ` ${formatNumber(durationMismatchCount)} imported Program_Minutes value(s) differ from internal Program Library/schedule length by more than ${DURATION_MISMATCH_TOLERANCE_MINUTES} minutes; analytics uses the internal length.`
        : '';"""
duplicate_note = duration_anchor + """
      const placementDuplicateNote = Number(diag.duplicatePlacementsSuppressed || 0)
        ? ` ${formatNumber(diag.duplicatePlacementsSuppressed || 0)} exact duplicate saved placement(s) were suppressed from schedule-derived analytics.`
        : '';"""
if duration_anchor not in source:
    raise SystemExit("duration note target not found")
source = source.replace(duration_anchor, duplicate_note, 1)

old_notice = "${duplicateNote} Schedule-derived rows:"
new_notice = "${duplicateNote}${placementDuplicateNote} Schedule-derived rows:"
if old_notice not in source:
    raise SystemExit("analytics notice target not found")
source = source.replace(old_notice, new_notice, 1)
analytics_path.write_text(source)

report_path = Path("reports.html")
report_path.write_text(report_path.read_text().replace("0.22.128", "0.22.129"))

for filename in [
    "tests/library-load-performance.test.mjs",
    "tests/one-sheet-report-refinements.test.mjs",
    "tests/one-sheet-reports.test.mjs",
]:
    path = Path(filename)
    if path.exists():
        path.write_text(path.read_text().replace("0.22.128", "0.22.129"))

Path("version.json").write_text(json.dumps({"appVersion":"0.22.129","releasedAt":"2026-09-02"}, separators=(",", ":")) + "\n")

test = """import assert from 'node:assert/strict';
import fs from 'node:fs';

const analytics = fs.readFileSync(new URL('../assets/js/ui-analytics.js', import.meta.url), 'utf8');
const imports = fs.readFileSync(new URL('../assets/js/ui-imports.js', import.meta.url), 'utf8');
const scheduling = fs.readFileSync(new URL('../assets/js/ui-scheduling.js', import.meta.url), 'utf8');

assert.match(analytics, /function schedulePlacementDedupeKey\\(placement = \\{\\}\\)/);
assert.match(analytics, /function dedupeSchedulePlacementsForAnalytics\\(placements = \\[\\]\\)/);
assert.match(analytics, /const placementSet = dedupeSchedulePlacementsForAnalytics\\(schedule\\.placements \\|\\| \\[\\]\\);/);
assert.match(analytics, /duplicatePlacementsSuppressed/);
assert.match(analytics, /exact duplicate saved placement\\(s\\) were suppressed from schedule-derived analytics/);

const importStart = imports.indexOf('async function importToSupabase');
const importEnd = imports.indexOf('async function buildSchedulerFromCurrentBatch', importStart);
assert.ok(importStart >= 0 && importEnd > importStart, 'Results Import section should be identifiable');
const importSection = imports.slice(importStart, importEnd);
assert.match(importSection, /Results Import never creates, merges, repairs, or changes fundraiser schedules/);
assert.doesNotMatch(importSection, /buildSchedulesFromImportedReports\\s*\\(/, 'normal Results Import must not reconstruct schedules');

assert.match(scheduling, /if \\(existingAtSlot && scheduledPlacementMatchesImported\\(existingAtSlot, placement\\)\\)/);
assert.match(scheduling, /existingAtSlot\\.importedBroadcastDollars = Number\\(placement\\.importedBroadcastDollars \\|\\| 0\\) \\|\\| 0/);
assert.match(scheduling, /if \\(placement\\.sourceAiringHash\\) existingAtSlot\\.sourceAiringHash = placement\\.sourceAiringHash/);

console.log('v0.22.129 import/schedule reconciliation guardrails are present');
"""
Path("tests/import-schedule-reconciliation-v129.test.mjs").write_text(test)

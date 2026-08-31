from pathlib import Path
import json

ROOT = Path('.')

def replace_once(path, old, new):
    text = path.read_text()
    if old not in text:
        raise SystemExit(f'missing expected block in {path}: {old[:180]!r}')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one match in {path}, found {count}')
    path.write_text(text.replace(old, new, 1))

analysis = ROOT / 'assets/js/one-sheet-analysis.js'
reports = ROOT / 'assets/js/one-sheet-reports.js'
css = ROOT / 'assets/one-sheet-reports.css'
html = ROOT / 'reports.html'
version = ROOT / 'version.json'
test = ROOT / 'tests/data-health-preflight.test.mjs'
refine = ROOT / 'tests/one-sheet-report-refinements.test.mjs'

canonical_helpers = r'''  function importedSourceIdentityCode(row = {}) {
    const raw = row?.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {};
    return text(
      row?.source_report_code
      || row?.imported_report_code
      || row?.imported_nola_code
      || raw?.nola_code
      || raw?.nola
      || raw?.program_nola
      || raw?.program_code
      || raw?.episode_code
      || ''
    );
  }

  function importedAiringIdentity(row = {}) {
    const sourceCode = nolaKey(importedSourceIdentityCode(row));
    if (sourceCode) return `source_code:${sourceCode}`;
    const sourceTitle = lookupKey(row?.imported_program_title || row?.program_title || row?.title || row?.name || '');
    return sourceTitle ? `source_title:${sourceTitle}` : '';
  }

  function importedNaturalKey(row = {}) {
    const identity = importedAiringIdentity(row);
    if (!identity) return '';
    return [
      lookupKey(row?.station || ''),
      identity,
      importedDateKey(row),
      text(row?.air_time || '')
    ].join('|').toLowerCase();
  }

  function validImportedDateKey(yearValue, monthValue, dayValue) {
    const year = Number(yearValue);
    const month = Number(monthValue);
    const day = Number(dayValue);
    if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return '';
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const probe = new Date(`${key}T12:00:00Z`);
    if (Number.isNaN(probe.getTime())) return '';
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return '';
    return key;
  }

  function importedReportCoverageEnd(row = {}) {
    const direct = text(row?.drive_end_date || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
    const sourceText = [row?.fundraiser_label, row?.source_file_name].map(text).filter(Boolean).join(' ');
    if (!sourceText) return '';
    const found = [];
    for (const match of sourceText.matchAll(/\b(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)\b/g)) {
      const key = validImportedDateKey(match[1], match[2], match[3]);
      if (key) found.push(key);
    }
    for (const match of sourceText.matchAll(/\b([01]\d)([0-3]\d)(\d{2})\b/g)) {
      const key = validImportedDateKey(`20${match[3]}`, match[1], match[2]);
      if (key) found.push(key);
    }
    for (const match of sourceText.matchAll(/\b([01]\d)([0-3]\d)(20\d{2})\b/g)) {
      const key = validImportedDateKey(match[3], match[1], match[2]);
      if (key) found.push(key);
    }
    return found.sort().slice(-1)[0] || '';
  }

  function importedAiringTimestamp(row = {}) {
    for (const value of [row?.updated_at, row?.imported_at, row?.created_at]) {
      const stamp = Date.parse(value || '');
      if (Number.isFinite(stamp)) return stamp;
    }
    return 0;
  }

  function canonicalizeImportedAirings(rows = []) {
    const chosen = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
      const naturalKey = importedNaturalKey(row) || `raw:${text(row?.id || row?.row_hash || index)}`;
      const candidate = {
        row,
        index,
        reportEnd: importedReportCoverageEnd(row),
        timestamp: importedAiringTimestamp(row)
      };
      const current = chosen.get(naturalKey);
      const wins = !current
        || candidate.reportEnd > current.reportEnd
        || (candidate.reportEnd === current.reportEnd && candidate.timestamp > current.timestamp)
        || (candidate.reportEnd === current.reportEnd && candidate.timestamp === current.timestamp && candidate.index > current.index);
      if (wins) chosen.set(naturalKey, candidate);
    });
    return [...chosen.values()].sort((a, b) => a.index - b.index).map((entry) => entry.row);
  }

'''
replace_once(analysis, '  function importedDateKey(row = {}) {\n', canonical_helpers + '  function importedDateKey(row = {}) {\n')
replace_once(analysis, '    buildLibraryIndexes,\n    libraryRuntimeMinutes,\n', '    buildLibraryIndexes,\n    canonicalizeImportedAirings,\n    libraryRuntimeMinutes,\n')

replace_once(analysis, "        missingDurations.push(`${analysis.schedule?.title || 'Fundraiser'} · ${row?.dateKey || 'unknown date'} · ${text(row?.title || row?.plannedTitle || 'Untitled program')}`);\n", "        missingDurations.push({\n          title: text(row?.title || row?.plannedTitle || 'Untitled program'),\n          programId: text(row?.programId || ''),\n          detail: `${analysis.schedule?.title || 'Fundraiser'} · ${row?.dateKey || 'unknown date'}`\n        });\n")
replace_once(analysis, "        unmatchedPrograms.push(`${analysis.schedule?.title || 'Fundraiser'} · ${row?.dateKey || 'unknown date'} · ${text(row?.title || 'Unidentified imported result')} · $${Number(row?.dollars || 0).toFixed(2)}`);\n", "        unmatchedPrograms.push({\n          title: text(row?.title || 'Unidentified imported result'),\n          programId: text(row?.programId || ''),\n          detail: `${analysis.schedule?.title || 'Fundraiser'} · ${row?.dateKey || 'unknown date'} · $${Number(row?.dollars || 0).toFixed(2)}`\n        });\n")
replace_once(analysis, "        staleHashes.push(`${schedule.title || 'Fundraiser'} · ${text(placement?.dateKey || placement?.date_key || '?')} · ${text(placement?.programTitle || placement?.program_title || placement?.title || 'Untitled program')}`);\n", "        staleHashes.push({\n          title: text(placement?.programTitle || placement?.program_title || placement?.title || 'Untitled program'),\n          programId: text(placement?.programId || placement?.program_id || ''),\n          detail: `${schedule.title || 'Fundraiser'} · ${text(placement?.dateKey || placement?.date_key || '?')}`\n        });\n")

replace_once(reports, "    airings: [],\n    library: [],\n", "    airings: [],\n    rawAiringsCount: 0,\n    supersededAiringsCount: 0,\n    library: [],\n")
replace_once(reports, "    state.schedules = A.prepareSchedules(scheduleRows.map(A.normalizeSchedule)).filter((schedule) => schedule.season && schedule.year);\n    state.airings = airings;\n    state.library = library;\n", "    state.schedules = A.prepareSchedules(scheduleRows.map(A.normalizeSchedule)).filter((schedule) => schedule.season && schedule.year);\n    const canonicalAirings = A.canonicalizeImportedAirings ? A.canonicalizeImportedAirings(airings) : airings;\n    state.rawAiringsCount = airings.length;\n    state.supersededAiringsCount = Math.max(0, airings.length - canonicalAirings.length);\n    state.airings = canonicalAirings;\n    state.library = library;\n")

old_detail_markup = """    const detailMarkup = details.length
      ? `<details ${check.severity !== 'info' && check.count ? 'open' : ''}><summary>${escapeHtml(count(details.length))} detail${details.length === 1 ? '' : 's'}</summary><ul>${details.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>`
      : '';
"""
new_detail_markup = """    const detailItemMarkup = (item) => {
      if (!item || typeof item !== 'object') return escapeHtml(item);
      const title = A.text(item.title || '');
      const programId = A.text(item.programId || '');
      const detail = A.text(item.detail || item.text || '');
      const titleMarkup = programId && title
        ? `<a class="preflight-program-link" href="./?openProgram=${encodeURIComponent(programId)}" target="_blank" rel="noopener" title="Open ${escapeHtml(title)} in the Pledge Program Library">${escapeHtml(title)}</a>`
        : escapeHtml(title);
      return `${titleMarkup}${detail ? `${titleMarkup ? ' · ' : ''}${escapeHtml(detail)}` : ''}` || '—';
    };
    const detailMarkup = details.length
      ? `<details ${check.severity !== 'info' && check.count ? 'open' : ''}><summary>${escapeHtml(count(details.length))} detail${details.length === 1 ? '' : 's'}</summary><ul>${details.map((item) => `<li>${detailItemMarkup(item)}</li>`).join('')}</ul></details>`
      : '';
"""
replace_once(reports, old_detail_markup, new_detail_markup)
replace_once(reports, "    const health = A.dataHealthReport(state.schedules, analyses, state.airings, state.library);\n    const passed = health.status === 'pass';\n", "    const health = A.dataHealthReport(state.schedules, analyses, state.airings, state.library);\n    if (state.supersededAiringsCount > 0) {\n      health.checks.unshift({\n        id: 'superseded-imports',\n        label: 'Superseded imported observations',\n        severity: 'info',\n        summary: 'Older duplicate/superseded imported observations were ignored before reports and Preflight analyzed the current pledge history.',\n        count: state.supersededAiringsCount,\n        details: [`${count(state.supersededAiringsCount)} of ${count(state.rawAiringsCount)} raw imported rows were superseded by a newer observation with the same station/program/date/time identity.`]\n      });\n    }\n    const passed = health.status === 'pass';\n")

if '.preflight-program-link{' not in css.read_text():
    css.write_text(css.read_text() + '\n.preflight-program-link{font-weight:850;color:#145f91;text-decoration:underline;text-underline-offset:2px}\n.preflight-program-link:hover,.preflight-program-link:focus-visible{color:#0b456d;text-decoration-thickness:2px}\n')

html_text = html.read_text()
html_text = html_text.replace('assets/one-sheet-reports.css?v=0.22.111', 'assets/one-sheet-reports.css?v=0.22.113')
html_text = html_text.replace('assets/js/one-sheet-analysis.js?v=0.22.111', 'assets/js/one-sheet-analysis.js?v=0.22.113')
html_text = html_text.replace('assets/js/one-sheet-reports.js?v=0.22.111', 'assets/js/one-sheet-reports.js?v=0.22.113')
html.write_text(html_text)

payload = json.loads(version.read_text())
payload['appVersion'] = '0.22.113'
payload['releasedAt'] = '2026-08-31'
version.write_text(json.dumps(payload, separators=(',', ':')) + '\n')

with test.open('a') as fh:
    fh.write(r'''

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
''')

with refine.open('a') as fh:
    fh.write(r'''

assert.match(reportsSource, /A\.canonicalizeImportedAirings \? A\.canonicalizeImportedAirings\(airings\) : airings/);
assert.match(reportsSource, /preflight-program-link/);
assert.match(reportsSource, /openProgram=\$\{encodeURIComponent\(programId\)\}/);
assert.match(reportsSource, /Superseded imported observations/);
assert.match(htmlSource, /one-sheet-analysis\.js\?v=0\.22\.113/);
assert.match(htmlSource, /one-sheet-reports\.js\?v=0\.22\.113/);
''')

print('v0.22.113 preflight canonicalization/link patch applied')

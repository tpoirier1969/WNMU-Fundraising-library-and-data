from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Missing expected source block: {label}')
    return text.replace(old, new, 1)

# -----------------------------------------------------------------------------
# Core: add a distinct pledge-hour metric without disturbing the old
# avg-per-fundraiser helper that is still used as a historical-total fallback.
# -----------------------------------------------------------------------------
core_path = Path('assets/js/core.js')
core = core_path.read_text()
core = replace_once(
    core,
    "      avg_per_fundraiser: 'Average $ / fundraiser'\n",
    "      avg_per_pledge_hour: 'Average $ / pledge hour'\n",
    'Program Library sort label'
)
core = replace_once(
    core,
    "    totalRaised(row) {\n",
    """    avgPerPledgeHour(row) {
      const value = utils.firstNonEmpty(
        row?.__avg_dollars_per_pledge_hour,
        row?.avg_dollars_per_pledge_hour,
        row?.average_dollars_per_pledge_hour,
        row?.avg_per_pledge_hour,
        row?.average_per_pledge_hour
      );
      const numeric = Number(value);
      return value == null || value === '' || !Number.isFinite(numeric) ? null : numeric;
    },

    totalRaised(row) {
""",
    'pledge-hour derive helper'
)
core_path.write_text(core)

# -----------------------------------------------------------------------------
# Data: enrich Program Library rows in the existing background airing-history
# pass. The rate uses the same fundraiser-balanced principle as analytics:
# each fundraiser contributes one observation, and a fundraiser is excluded
# from rate calculation if any of that program's airings lacks usable duration.
# -----------------------------------------------------------------------------
data_path = Path('assets/js/data.js')
data = data_path.read_text()
old = """  function attachAiringHistory(rows = [], historyIndex = null) {
    return (rows || []).map((row) => {
      const dateKeys = resolveAiringDateKeysForRow(row, historyIndex);
      const display = dateKeys.length
        ? dateKeys.map((value) => utils.formatDate(value, value)).join(' · ')
        : '';
      return {
        ...row,
        all_air_dates_display: display || utils.normalizeText(row?.all_air_dates_display || ''),
        all_air_dates_latest: dateKeys[0] || utils.firstNonEmpty(row?.all_air_dates_latest, row?.last_air_date, row?.last_aired_at, row?.last_aired, row?.aired_at, row?.air_date) || '',
        all_air_dates_count: dateKeys.length
      };
    });
  }

  let libraryAiringHistoryPromise = null;

  function applyLibraryAiringHistory(airingsRows = []) {
    const historyIndex = buildAiringHistoryIndex(airingsRows);
    state.baseRows = attachAiringHistory(state.baseRows, historyIndex);
    state.rawRows = attachAiringHistory(state.rawRows, historyIndex);
    return state.rawRows;
  }
"""
new = """  function buildProgramAiringPerformanceIndex(airingsRows = []) {
    const byId = new Map();
    const byLookup = new Map();
    const byTitle = new Map();

    const addRow = (map, key, row) => {
      const normalizedKey = utils.normalizeLookupKey(key);
      if (!normalizedKey || !row) return;
      const existing = map.get(normalizedKey) || [];
      if (!existing.includes(row)) existing.push(row);
      map.set(normalizedKey, existing);
    };

    (airingsRows || []).forEach((row) => {
      if (!row || utils.isNonSpecificRow(row)) return;
      const idCandidates = [row?.pledge_program_id, row?.manual_match_program_id, row?.program_id]
        .map((value) => utils.normalizeText(value))
        .filter(Boolean);
      const titleCandidates = [row?.matched_library_title, row?.imported_program_title, row?.program_title, row?.title, row?.name]
        .map((value) => utils.normalizeText(value))
        .filter(Boolean);
      const nolaCandidates = [row?.nola_code, row?.nola, row?.program_nola]
        .map((value) => utils.normalizeText(value))
        .filter(Boolean);

      idCandidates.forEach((value) => addRow(byId, value, row));
      titleCandidates.forEach((title) => addRow(byTitle, title, row));
      nolaCandidates.forEach((nola) => {
        titleCandidates.forEach((title) => {
          const lookupKey = utils.nolaIdentityKey(nola, title);
          if (lookupKey) addRow(byLookup, lookupKey, row);
        });
      });
    });

    return { byId, byLookup, byTitle };
  }

  function resolveAiringRowsForLibraryRow(row, performanceIndex) {
    if (!row || !performanceIndex) return [];
    const idKey = utils.normalizeLookupKey(derive.programId(row));
    if (idKey && performanceIndex.byId.has(idKey)) return performanceIndex.byId.get(idKey);

    const lookupKey = utils.nolaIdentityKey(derive.nola(row), derive.title(row));
    if (lookupKey && performanceIndex.byLookup.has(lookupKey)) return performanceIndex.byLookup.get(lookupKey);

    const titleKey = utils.normalizeLookupKey(derive.title(row));
    if (titleKey && performanceIndex.byTitle.has(titleKey)) return performanceIndex.byTitle.get(titleKey);

    return [];
  }

  function libraryRateDurationMinutes(row = {}, airing = {}) {
    const seconds = Number(utils.firstNonEmpty(row?.actual_runtime_seconds, row?.runtime_seconds, row?.actual_runtime));
    if (Number.isFinite(seconds) && seconds > 0) return seconds / 60;
    const actualMinutes = Number(utils.firstNonEmpty(row?.actual_runtime_minutes, row?.runtime_minutes, row?.length_minutes));
    if (Number.isFinite(actualMinutes) && actualMinutes > 0) return actualMinutes;
    const bucket = Number(row?.length_bucket_minutes || 0);
    if (Number.isFinite(bucket) && bucket > 0) return bucket;
    const importedMinutes = Number(airing?.program_minutes || 0);
    return Number.isFinite(importedMinutes) && importedMinutes > 0 ? importedMinutes : null;
  }

  function libraryRateFundraiserKey(airing = {}) {
    const label = utils.normalizeText(utils.firstNonEmpty(
      airing?.fundraiser_label,
      airing?.fundraiser_name,
      airing?.drive_label,
      airing?.drive_name
    ));
    if (label) return `label:${utils.normalizeLookupKey(label)}`;

    const start = utils.normalizeText(utils.firstNonEmpty(airing?.drive_start_date, airing?.fundraiser_start_date, '')).slice(0, 10);
    const end = utils.normalizeText(utils.firstNonEmpty(airing?.drive_end_date, airing?.fundraiser_end_date, '')).slice(0, 10);
    if (start || end) return `range:${start}|${end}`;

    const dateKey = normalizedAiringDateKey(airing);
    if (dateKey) return `month:${dateKey.slice(0, 7)}`;
    return '';
  }

  function libraryProgramAveragePledgeHour(row = {}, performanceIndex = null) {
    const airings = resolveAiringRowsForLibraryRow(row, performanceIndex);
    if (!airings.length) return null;
    const byFundraiser = new Map();
    airings.forEach((airing) => {
      const key = libraryRateFundraiserKey(airing);
      if (!key) return;
      if (!byFundraiser.has(key)) byFundraiser.set(key, []);
      byFundraiser.get(key).push(airing);
    });

    const rates = [];
    byFundraiser.forEach((fundraiserAirings) => {
      const durations = fundraiserAirings.map((airing) => libraryRateDurationMinutes(row, airing));
      // Match the analytics guardrail: do not turn a fundraiser with missing
      // duration into a partial $/pledge-hour observation.
      if (!durations.length || durations.some((minutes) => !(Number(minutes) > 0))) return;
      const minutes = durations.reduce((sum, value) => sum + Number(value || 0), 0);
      if (!(minutes > 0)) return;
      const dollars = fundraiserAirings.reduce((sum, airing) => sum + Number(utils.firstNonEmpty(
        airing?.dollars,
        airing?.contribution_amount,
        airing?.broadcast_dollars,
        0
      ) || 0), 0);
      rates.push((dollars * 60) / minutes);
    });

    if (!rates.length) return null;
    return rates.reduce((sum, value) => sum + value, 0) / rates.length;
  }

  function attachAiringHistory(rows = [], historyIndex = null, performanceIndex = null) {
    return (rows || []).map((row) => {
      const dateKeys = resolveAiringDateKeysForRow(row, historyIndex);
      const display = dateKeys.length
        ? dateKeys.map((value) => utils.formatDate(value, value)).join(' · ')
        : '';
      const averagePledgeHour = libraryProgramAveragePledgeHour(row, performanceIndex);
      return {
        ...row,
        all_air_dates_display: display || utils.normalizeText(row?.all_air_dates_display || ''),
        all_air_dates_latest: dateKeys[0] || utils.firstNonEmpty(row?.all_air_dates_latest, row?.last_air_date, row?.last_aired_at, row?.last_aired, row?.aired_at, row?.air_date) || '',
        all_air_dates_count: dateKeys.length,
        __avg_dollars_per_pledge_hour: Number.isFinite(averagePledgeHour) ? averagePledgeHour : null
      };
    });
  }

  let libraryAiringHistoryPromise = null;

  function applyLibraryAiringHistory(airingsRows = []) {
    const historyIndex = buildAiringHistoryIndex(airingsRows);
    const performanceIndex = buildProgramAiringPerformanceIndex(airingsRows);
    state.baseRows = attachAiringHistory(state.baseRows, historyIndex, performanceIndex);
    state.rawRows = attachAiringHistory(state.rawRows, historyIndex, performanceIndex);
    return state.rawRows;
  }
"""
data = replace_once(data, old, new, 'Program Library airing/performance enrichment')
data_path.write_text(data)

# -----------------------------------------------------------------------------
# List UI: display, sort, and earnings signal use the new rate metric.
# -----------------------------------------------------------------------------
list_path = Path('assets/js/ui-list.js')
ui = list_path.read_text()
ui = replace_once(
    ui,
    "      case 'avg_per_fundraiser':\n        return utils.compareNumber(derive.avgPerFundraiser(a), derive.avgPerFundraiser(b)) || utils.compareText(derive.title(a), derive.title(b));\n",
    "      case 'avg_per_pledge_hour':\n        return utils.compareNumber(derive.avgPerPledgeHour(a), derive.avgPerPledgeHour(b)) || utils.compareText(derive.title(a), derive.title(b));\n",
    'Program Library rate sorting'
)
ui = replace_once(
    ui,
    "    const avg = Number(derive.avgPerFundraiser(row) || 0);\n",
    "    const avg = Number(derive.avgPerPledgeHour(row) || 0);\n",
    'Program Library earnings signal rate'
)
ui = replace_once(
    ui,
    "          <td class=\"avg-cell\">${utils.escapeHtml(utils.formatMoney(derive.avgPerFundraiser(row)))}</td>\n",
    "          <td class=\"avg-cell\" title=\"Average fundraiser $ / pledge hour from rate-valid program history\">${derive.avgPerPledgeHour(row) == null ? '—' : utils.escapeHtml(utils.formatMoney(derive.avgPerPledgeHour(row)))}</td>\n",
    'Program Library rate cell'
)
list_path.write_text(ui)

# -----------------------------------------------------------------------------
# Shell labels.
# -----------------------------------------------------------------------------
shell_path = Path('app-shell.html')
shell = shell_path.read_text()
shell = shell.replace('<option value="avg_per_fundraiser">Average $ / fundraiser</option>', '<option value="avg_per_pledge_hour">Average $ / pledge hour</option>')
shell = shell.replace('data-sort-field="avg_per_fundraiser" data-sort-label="Avg $ / event">Avg $ / event</button>', 'data-sort-field="avg_per_pledge_hour" data-sort-label="Avg $ / pledge hour">Avg $ / pledge hour</button>')
if 'data-sort-field="avg_per_pledge_hour" data-sort-label="Avg $ / pledge hour">Avg $ / pledge hour</button>' not in shell:
    raise SystemExit('Program Library pledge-hour column label replacement failed')
shell_path.write_text(shell)

# -----------------------------------------------------------------------------
# Version/cache locks.
# -----------------------------------------------------------------------------
version_path = Path('version.json')
version_path.write_text('{"appVersion":"0.22.141","releasedAt":"2026-09-10"}\n')

reports_path = Path('reports.html')
reports = reports_path.read_text().replace('0.22.140', '0.22.141').replace(r'0\.22\.140', r'0\.22\.141')
reports_path.write_text(reports)

for test_path in Path('tests').glob('*.test.mjs'):
    text = test_path.read_text()
    text = text.replace('0.22.140', '0.22.141').replace(r'0\.22\.140', r'0\.22\.141')
    test_path.write_text(text)

# Strengthen existing Library background-enrichment regression.
test_path = Path('tests/library-load-performance.test.mjs')
test = test_path.read_text()
test = replace_once(
    test,
    "const loader = fs.readFileSync(new URL('../assets/js/library-load.js', import.meta.url), 'utf8');\n",
    "const loader = fs.readFileSync(new URL('../assets/js/library-load.js', import.meta.url), 'utf8');\nconst core = fs.readFileSync(new URL('../assets/js/core.js', import.meta.url), 'utf8');\nconst list = fs.readFileSync(new URL('../assets/js/ui-list.js', import.meta.url), 'utf8');\nconst shell = fs.readFileSync(new URL('../app-shell.html', import.meta.url), 'utf8');\n",
    'library regression source inputs'
)
marker = "assert.match(loader, /Air-date history is updating in the background/);\n"
additions = r"""assert.match(data, /function buildProgramAiringPerformanceIndex\(airingsRows = \[\]\)/);
assert.match(data, /function libraryProgramAveragePledgeHour\(row = \{\}, performanceIndex = null\)/);
assert.match(data, /durations\.some\(\(minutes\) => !\(Number\(minutes\) > 0\)\)/, 'missing duration must exclude the fundraiser rate observation');
assert.match(data, /rates\.reduce\(\(sum, value\) => sum \+ value, 0\) \/ rates\.length/, 'Program Library average must average fundraiser rate observations rather than pool all hours');
assert.match(core, /avgPerPledgeHour\(row\)/);
assert.match(core, /avg_per_pledge_hour: 'Average \$ \/ pledge hour'/);
assert.match(list, /case 'avg_per_pledge_hour'/);
assert.match(list, /derive\.avgPerPledgeHour\(row\)/);
assert.match(shell, /data-sort-field="avg_per_pledge_hour" data-sort-label="Avg \$ \/ pledge hour">Avg \$ \/ pledge hour<\/button>/);
assert.doesNotMatch(shell, /data-sort-label="Avg \$ \/ event">Avg \$ \/ event<\/button>/);
"""
if additions not in test:
    test = replace_once(test, marker, marker + additions, 'Program Library pledge-hour assertions')
test_path.write_text(test)

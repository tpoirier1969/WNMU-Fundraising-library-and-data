from pathlib import Path


def read(path):
    return Path(path).read_text()


def write(path, value):
    Path(path).write_text(value)


def replace_once(path, old, new, label):
    value = read(path)
    count = value.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 exact match in {path}, found {count}')
    write(path, value.replace(old, new, 1))


def replace_between(path, start, end, replacement, label):
    value = read(path)
    i = value.find(start)
    if i < 0:
        raise SystemExit(f'{label}: start marker not found in {path}')
    j = value.find(end, i + len(start))
    if j < 0:
        raise SystemExit(f'{label}: end marker not found in {path}')
    write(path, value[:i] + replacement + value[j:])


analytics = 'assets/js/ui-analytics.js'
comparison = 'assets/js/ui-fundraiser-comparison.js'
atest = 'tests/performance-analytics.test.mjs'
ctest = 'tests/fundraiser-comparison.test.mjs'

# ---------------- Performance Analytics ----------------
replace_once(
    analytics,
    "  const WEAK_BROADCASTS = 3;\n  const WEAK_SEASONS = 2;\n  const LONG_PAUSE_YEARS = 2;",
    "  const WEAK_BROADCASTS = 3;\n  const WEAK_SEASONS = 2;\n  const START_TIME_MIN_AIRINGS = 5;\n  const START_TIME_MIN_FUNDRAISERS = 3;\n  const START_TIME_MIN_TITLES = 3;\n  const LONG_PAUSE_YEARS = 2;",
    'analytics start-time thresholds'
)

replace_once(
    analytics,
    "  function text(value) { return String(value ?? '').trim(); }\n  function lookupKey(value) { return text(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }\n  function nolaKey(value) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ''); }",
    "  function text(value) { return String(value ?? '').trim(); }\n  function lookupKey(value) { return text(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }\n  function nolaKey(value) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ''); }\n  function canonicalCategory(value, fallback = '') {\n    const raw = text(value);\n    if (!raw) return fallback;\n    return raw.split(/([\\s\\-/&]+)/).map((part) => /^[A-Za-z]+$/.test(part)\n      ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`\n      : part).join('');\n  }",
    'analytics category normalizer'
)

old_drive = """  function buildDriveSeasonRecords(schedules = []) {
    return schedules.map((schedule) => {
      const date = parseLocalDate(schedule.startDate || schedule.endDate || '');
      const season = pledgeSeason(date);
      const year = date ? date.getFullYear() : '';
      const broadcastDollars = scheduleBroadcastTotal(schedule);
      const onlineDollars = Number(schedule.onlineDollars || 0) || 0;
      const mailDollars = Number(schedule.mailDollars || 0) || 0;
      const dollars = broadcastDollars + onlineDollars + mailDollars;
      const broadcastCount = (schedule.placements || []).filter((placement) => placementDollars(placement) > 0).length;
      return {
        id: schedule.id || '',
        title: season || schedule.title || 'Unknown season',
        scheduleTitle: schedule.title || '',
        date,
        season,
        year,
        seasonYear: season && year ? `${season} ${year}` : 'Unseasoned',
        dollars,
        broadcastDollars,
        onlineDollars,
        mailDollars,
        pledges: schedulePledgeTotal(schedule),
        broadcasts: broadcastCount,
        avg: broadcastCount ? broadcastDollars / broadcastCount : 0,
        topic: 'All pledge giving',
        distributor: '',
        liveState: 'all',
        daypart: '',
        weekpart: '',
        mode: 'drive-total',
        sourceLabel: 'Saved fundraiser schedule total',
        records: []
      };
    }).filter((record) => record.date && record.season && record.dollars > 0);
  }
"""
new_drive = """  function airingRecordsForSchedule(schedule = {}, airingRecords = []) {
    const start = text(schedule.startDate || '');
    const end = text(schedule.endDate || '');
    if (start && end) {
      const exact = airingRecords.filter((record) =>
        text(record.row?.drive_start_date || '').slice(0, 10) === start
        && text(record.row?.drive_end_date || '').slice(0, 10) === end
      );
      if (exact.length) return exact;
    }
    const date = parseLocalDate(schedule.startDate || schedule.endDate || '');
    const season = pledgeSeason(date);
    const year = date ? date.getFullYear() : 0;
    if (!season || !year) return [];
    return airingRecords.filter((record) => record.season === season && Number(record.year) === Number(year));
  }

  function buildDriveSeasonRecords(schedules = [], airingRecords = []) {
    return schedules.map((schedule) => {
      const date = parseLocalDate(schedule.startDate || schedule.endDate || '');
      const season = pledgeSeason(date);
      const year = date ? date.getFullYear() : '';
      const imported = airingRecordsForSchedule(schedule, airingRecords);
      const broadcastDollars = imported.length
        ? imported.reduce((sum, record) => sum + Number(record.dollars || 0), 0)
        : scheduleBroadcastTotal(schedule);
      const pledges = imported.length
        ? imported.reduce((sum, record) => sum + Number(record.pledges || 0), 0)
        : schedulePledgeTotal(schedule);
      const onlineDollars = Number(schedule.onlineDollars || 0) || 0;
      const mailDollars = Number(schedule.mailDollars || 0) || 0;
      const dollars = broadcastDollars + onlineDollars + mailDollars;
      const broadcastCount = imported.length
        ? imported.length
        : (schedule.placements || []).filter((placement) => placementDollars(placement) > 0).length;
      return {
        id: schedule.id || '',
        title: season || schedule.title || 'Unknown season',
        scheduleTitle: schedule.title || '',
        date,
        season,
        year,
        seasonYear: season && year ? `${season} ${year}` : 'Unseasoned',
        dollars,
        broadcastDollars,
        onlineDollars,
        mailDollars,
        pledges,
        broadcasts: broadcastCount,
        avg: broadcastCount ? broadcastDollars / broadcastCount : 0,
        topic: 'All pledge giving',
        distributor: '',
        liveState: 'all',
        daypart: '',
        weekpart: '',
        mode: 'drive-total',
        sourceLabel: imported.length ? 'Current imported fundraiser history' : 'Saved fundraiser schedule fallback',
        records: imported
      };
    }).filter((record) => record.date && record.season && record.dollars > 0);
  }
"""
replace_once(analytics, old_drive, new_drive, 'analytics imported drive totals')

replace_once(
    analytics,
    "      const rawTopic = nonSpecific ? 'Non-Specific' : text(firstNonEmpty(lib.topic_primary, row.topic_primary, row.topic, ''));\n      const topicMissing = !nonSpecific && isMissingTopic(rawTopic);",
    "      const rawTopic = nonSpecific ? 'Non-Specific' : canonicalCategory(firstNonEmpty(lib.topic_primary, row.topic_primary, row.topic, ''), '');\n      const topicMissing = !nonSpecific && isMissingTopic(rawTopic);",
    'analytics imported topic canonicalization'
)
replace_once(
    analytics,
    "        secondaryTopic: text(firstNonEmpty(lib.topic_secondary, row.topic_secondary, row.secondary_topic, '')),",
    "        secondaryTopic: canonicalCategory(firstNonEmpty(lib.topic_secondary, row.topic_secondary, row.secondary_topic, ''), ''),",
    'analytics imported secondary topic canonicalization'
)

old_order = """      if (matched) {
        resultSource = 'report';
        dollars = Number(matched.dollars || 0) || 0;
        pledges = Number(matched.pledges || 0) || 0;
        if (matchedDollarKey) usedAiringDollarMatches.add(matchedDollarKey);
      } else if (Number.isFinite(attachedImportedDollars)) {
        resultSource = 'attached-report';
        dollars = attachedImportedDollars;
        pledges = Number(attachedImportedPledges || 0) || 0;
      } else if (sameDayReported) {
        resultSource = 'report-day-zero';
        dollars = 0;
        pledges = 0;
        diagnostics.implicitZeroRows += 1;
      } else if (savedDollars != null) {
"""
new_order = """      if (matched) {
        resultSource = 'report';
        dollars = Number(matched.dollars || 0) || 0;
        pledges = Number(matched.pledges || 0) || 0;
        if (matchedDollarKey) usedAiringDollarMatches.add(matchedDollarKey);
      } else if (sameDayReported) {
        resultSource = 'report-day-zero';
        dollars = 0;
        pledges = 0;
        diagnostics.implicitZeroRows += 1;
      } else if (Number.isFinite(attachedImportedDollars)) {
        resultSource = 'attached-report';
        dollars = attachedImportedDollars;
        pledges = Number(attachedImportedPledges || 0) || 0;
      } else if (savedDollars != null) {
"""
replace_once(analytics, old_order, new_order, 'analytics report-day zero precedence')

replace_once(
    analytics,
    "      const rawTopic = nonSpecific ? 'Non-Specific' : text(firstNonEmpty(matched?.topic, lib.topic_primary, ''));\n      const topicMissing = !nonSpecific && isMissingTopic(rawTopic);",
    "      const rawTopic = nonSpecific ? 'Non-Specific' : canonicalCategory(firstNonEmpty(matched?.topic, lib.topic_primary, ''), '');\n      const topicMissing = !nonSpecific && isMissingTopic(rawTopic);",
    'analytics schedule topic canonicalization'
)
replace_once(
    analytics,
    "        topic: nonSpecific ? 'Non-Specific' : (topicMissing ? 'Uncategorized' : rawTopic),\n        secondaryTopic: text(firstNonEmpty(matched?.secondaryTopic, lib.topic_secondary, placement.topicSecondary, placement.topic_secondary, '')),",
    "        topic: nonSpecific ? 'Non-Specific' : (topicMissing ? 'Uncategorized' : rawTopic),\n        secondaryTopic: canonicalCategory(firstNonEmpty(matched?.secondaryTopic, lib.topic_secondary, placement.topicSecondary, placement.topic_secondary, ''), ''),",
    'analytics schedule secondary topic canonicalization'
)
replace_once(
    analytics,
    "        id: placement.id || text(matched?.sourceAiringHash) || hash || `${schedule.id}|${actualDateKey}|${actualStartMinutes}|${title}`,\n        row: matched?.row || {},",
    "        id: placement.id || text(matched?.sourceAiringHash) || hash || `${schedule.id}|${actualDateKey}|${actualStartMinutes}|${title}`,\n        scheduleId: text(schedule.id || ''),\n        row: matched?.row || {},",
    'analytics schedule identity'
)

start_old = """  function startTimeLabel(record = {}) {
    const minutes = Number(record.startMinutes);
    return Number.isFinite(minutes) ? formatTimeFromMinutes(Math.floor(minutes / 30) * 30) : 'Unknown start time';
  }

  function startTimeSortKey(row = {}) {
    const value = Number(row.startMinutes);
    return Number.isFinite(value) ? value : 99999;
  }

  function startTimeRead(rows = []) {
    if (!rows.length) return 'No start-time records match the current filters.';
    const useful = rows.filter((row) => Number(row.broadcasts || 0) >= 3);
    const bestUseful = useful[0] || rows[0];
    return `Start-time performance is grouped in <b>30-minute actual program-start buckets</b> from the saved fundraiser schedules, not from pledge-report timestamps. Each scheduled airing carries its attached imported or manual broadcast result. Completed <b>$0 broadcasts still count as airings</b>.<br><br>Current rank: <b>${escapeHtml(metricLabel())}</b>. Best current bucket with useful sample size: <b>${escapeHtml(bestUseful.title)}</b> at <b>${formatMetricValue(bestUseful)}</b>; median <b>${formatMoney(bestUseful.median || 0)}</b>, average <b>${formatMoney(bestUseful.avg || 0)}</b>, total <b>${formatMoney(bestUseful.dollars || 0)}</b>, across <b>${formatNumber(bestUseful.broadcasts || 0)}</b> airing(s).<br><br>Use Pledge season = March/June/August/December, plus Primary and Secondary topic, to test specific scheduling arguments.`;
  }

  function rowsStartTimes() {
    return applyEvidence([...groupBy(filteredRecordsFor('startTimes'), startTimeLabel)]
      .map(([title, records]) => {
        const row = summarizeGroup(title, records);
        row.startMinutes = records.map((record) => Number(record.startMinutes)).filter((value) => Number.isFinite(value)).sort((a, b) => a - b)[0];
        return row;
      })
      .filter((row) => row.title !== 'Unknown start time')
      .sort((a, b) => metricValue(b) - metricValue(a) || startTimeSortKey(a) - startTimeSortKey(b)));
  }
"""
start_new = """  function startTimeLabel(record = {}) {
    const minutes = Number(record.startMinutes);
    return Number.isFinite(minutes) ? formatTimeFromMinutes(Math.floor(minutes / 30) * 30) : 'Unknown start time';
  }

  function startTimeSortKey(row = {}) {
    const value = Number(row.startMinutes);
    return Number.isFinite(value) ? value : 99999;
  }

  function startTimeEvidence(records = []) {
    const rateValid = records.filter((record) => Number(durationFromRecord(record)) > 0);
    const fundraisers = new Set(rateValid.map((record) => text(record.scheduleId || record.scheduleTitle || record.fundraiser || '')).filter(Boolean));
    const titles = new Set(rateValid.map((record) => programIdentityKey(record)).filter(Boolean));
    return {
      rateAirings: rateValid.length,
      fundraiserCount: fundraisers.size,
      titleCount: titles.size,
      sufficient: rateValid.length >= START_TIME_MIN_AIRINGS
        && fundraisers.size >= START_TIME_MIN_FUNDRAISERS
        && titles.size >= START_TIME_MIN_TITLES
    };
  }

  function startTimeRead(rows = []) {
    if (!rows.length) return 'No start-time records match the current filters.';
    const useful = rows.filter((row) => !row.weak);
    if (!useful.length) {
      return `Start-time performance is grouped in <b>30-minute actual program-start buckets</b>. No current bucket meets the historical evidence threshold of <b>${START_TIME_MIN_AIRINGS} rate-valid airings across ${START_TIME_MIN_FUNDRAISERS} fundraisers and ${START_TIME_MIN_TITLES} distinct titles</b>. Sparse buckets remain visible only when weak evidence is shown.`;
    }
    const bestUseful = useful[0];
    return `Start-time performance is grouped in <b>30-minute actual program-start buckets</b>. Imported fundraiser history supplies completed results; saved Scheduling placements preserve completed report-day $0s, and unreported days remain pending. A bucket is considered usable only with <b>${START_TIME_MIN_AIRINGS}+ rate-valid airings, ${START_TIME_MIN_FUNDRAISERS}+ fundraisers, and ${START_TIME_MIN_TITLES}+ distinct titles</b>. Missing-duration rows cannot make a bucket qualify.<br><br>Current rank: <b>${escapeHtml(metricLabel())}</b>. Best qualified bucket: <b>${escapeHtml(bestUseful.title)}</b> at <b>${formatMetricValue(bestUseful)}</b>; median <b>${formatMoney(bestUseful.median || 0)}</b>, average <b>${formatMoney(bestUseful.avg || 0)}</b>, total <b>${formatMoney(bestUseful.dollars || 0)}</b>, with <b>${formatNumber(bestUseful.rateAirings || 0)}</b> rate-valid airing(s) across <b>${formatNumber(bestUseful.fundraiserCount || 0)}</b> fundraiser(s) and <b>${formatNumber(bestUseful.titleCount || 0)}</b> title(s).`;
  }

  function rowsStartTimes() {
    return applyEvidence([...groupBy(filteredRecordsFor('startTimes'), startTimeLabel)]
      .map(([title, records]) => {
        const row = summarizeGroup(title, records);
        const evidence = startTimeEvidence(records);
        row.startMinutes = records.map((record) => Number(record.startMinutes)).filter((value) => Number.isFinite(value)).sort((a, b) => a - b)[0];
        row.rateAirings = evidence.rateAirings;
        row.fundraiserCount = evidence.fundraiserCount;
        row.titleCount = evidence.titleCount;
        row.weak = !evidence.sufficient;
        return row;
      })
      .filter((row) => row.title !== 'Unknown start time')
      .sort((a, b) => metricValue(b) - metricValue(a) || startTimeSortKey(a) - startTimeSortKey(b)));
  }
"""
replace_once(analytics, start_old, start_new, 'analytics start-time evidence')

replace_once(
    analytics,
    "      tableNote: 'Imported fundraiser history is the factual source for completed airing date, time, title, and dollars. Saved Scheduling placements are retained so a scheduled title missing from an otherwise populated imported report day counts as a completed $0 at its scheduled slot. A schedule day with no imported fundraiser rows remains pending and is excluded until results exist. Use Pledge season plus Primary/Secondary topic to test March, June, August, or December scheduling arguments. Rights and title filters are intentionally not part of this view.',",
    "      tableNote: 'Imported fundraiser history is the factual source for completed airing date, time, title, and dollars. Saved Scheduling placements retain completed report-day $0s; unreported days remain pending. Historical evidence rules match the printed Historical Analytics report: at least 5 rate-valid airings across 3 fundraisers and 3 distinct titles. Missing-duration rows cannot qualify a start slot. Use Pledge season plus Primary/Secondary topic to test scheduling arguments.',",
    'analytics start-time note'
)
replace_once(
    analytics,
    "        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],\n        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]",
    "        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],\n        ['Evidence', (row) => `${formatNumber(row.rateAirings || 0)} valid · ${formatNumber(row.fundraiserCount || 0)} drives · ${formatNumber(row.titleCount || 0)} titles`, '', (row) => row.rateAirings || 0],\n        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]",
    'analytics start-time evidence column'
)
replace_once(
    analytics,
    "    state.driveSeasonRecords = buildDriveSeasonRecords(state.schedules);",
    "    state.driveSeasonRecords = buildDriveSeasonRecords(state.schedules, state.records);",
    'analytics drive totals load'
)

# ---------------- Fundraiser Comparison Lab ----------------
replace_once(
    comparison,
    "  const text = (value) => String(value ?? '').trim();\n  const lookupKey = (value) => text(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();\n  const nolaKey = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');",
    "  const text = (value) => String(value ?? '').trim();\n  const lookupKey = (value) => text(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();\n  const nolaKey = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');\n  const canonicalCategory = (value, fallback = '') => {\n    const raw = text(value);\n    if (!raw) return fallback;\n    return raw.split(/([\\s\\-/&]+)/).map((part) => /^[A-Za-z]+$/.test(part)\n      ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`\n      : part).join('');\n  };",
    'comparison category normalizer'
)

old_rows = """function importedRowsForSchedule(schedule = {}) {
  const identity = scheduleSeasonYear(schedule);
  if (!identity.season || !identity.year) return [];
  return (state.airings || []).filter((row) => {
    const date = parseDate(importedDateKey(row));
    return Boolean(date && seasonForDate(date) === identity.season && date.getFullYear() === identity.year);
  });
}
"""
new_rows = """function importedRowsForSchedule(schedule = {}) {
  const start = text(schedule.startDate || schedule.start_date || '');
  const end = text(schedule.endDate || schedule.end_date || '');
  if (start && end) {
    const exact = (state.airings || []).filter((row) =>
      text(row.drive_start_date || '').slice(0, 10) === start
      && text(row.drive_end_date || '').slice(0, 10) === end
    );
    if (exact.length) return exact;
  }
  const identity = scheduleSeasonYear(schedule);
  if (!identity.season || !identity.year) return [];
  return (state.airings || []).filter((row) => {
    const date = parseDate(importedDateKey(row));
    return Boolean(date && seasonForDate(date) === identity.season && date.getFullYear() === identity.year);
  });
}
"""
replace_once(comparison, old_rows, new_rows, 'comparison exact imported fundraiser rows')

old_result = """  const attachedRaw = placement.importedBroadcastDollars;
  const attached = attachedRaw === '' || attachedRaw == null ? null : Number(attachedRaw);
  if (Number.isFinite(attached)) {
    return {
      known: true,
      dollars: attached,
      pledges: Number(placement.importedPledges || placement.importedBroadcastPledges || 0) || 0,
      source: 'attached-report'
    };
  }

  const dateKey = text(placement.dateKey || placement.date_key || '');
  if (importedDateHasResults(dateKey, importedRows)) {
    return {
      known: true,
      dollars: 0,
      pledges: 0,
      source: 'report-day-zero',
      implicitZero: true
    };
  }
"""
new_result = """  const dateKey = text(placement.dateKey || placement.date_key || '');
  if (importedDateHasResults(dateKey, importedRows)) {
    return {
      known: true,
      dollars: 0,
      pledges: 0,
      source: 'report-day-zero',
      implicitZero: true
    };
  }

  const attachedRaw = placement.importedBroadcastDollars;
  const attached = attachedRaw === '' || attachedRaw == null ? null : Number(attachedRaw);
  if (Number.isFinite(attached)) {
    return {
      known: true,
      dollars: attached,
      pledges: Number(placement.importedPledges || placement.importedBroadcastPledges || 0) || 0,
      source: 'attached-report'
    };
  }
"""
replace_once(comparison, old_result, new_result, 'comparison report-day zero precedence')

old_minutes = """  function programMinutes(placement = {}) {
    const explicit = Number(placement.lengthMinutes ?? placement.programMinutes ?? placement.program_minutes ?? placement.durationMinutes);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const start = placementStartMinutes(placement);
    const end = Number(placement.endMinutes ?? placement.end_minutes ?? placement.end);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      let diff = end - start;
      if (diff < 0) diff += 1440;
      if (diff > 0) return diff;
    }
    return 30;
  }
"""
new_minutes = """  function libraryRuntimeMinutes(row = {}) {
    const seconds = Number(row.actual_runtime_seconds ?? row.runtime_seconds ?? row.actual_runtime);
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds / 60);
    const direct = Number(row.actual_runtime_minutes ?? row.runtime_minutes ?? row.length_minutes);
    if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
    const bucket = Number(row.length_bucket_minutes ?? row.lengthBucketMinutes ?? row.length_bucket);
    return Number.isFinite(bucket) && bucket > 0 ? bucket : null;
  }

  function programMinutes(placement = {}, lib = {}) {
    const explicit = Number(placement.lengthMinutes ?? placement.programMinutes ?? placement.program_minutes ?? placement.durationMinutes);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const start = placementStartMinutes(placement);
    const end = Number(placement.endMinutes ?? placement.end_minutes ?? placement.end);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      let diff = end - start;
      if (diff < 0) diff += 1440;
      if (diff > 0) return diff;
    }
    const libraryMinutes = libraryRuntimeMinutes(lib);
    return Number.isFinite(libraryMinutes) && libraryMinutes > 0 ? libraryMinutes : 0;
  }
"""
replace_once(comparison, old_minutes, new_minutes, 'comparison remove duration guess')

old_group = """  function addGroup(map, key, minutes, result) {
    if (!map.has(key)) map.set(key, { key, minutes: 0, scheduled: 0, completed: 0, dollars: 0, pledges: 0, results: [] });
    const item = map.get(key);
    item.minutes += Number(minutes || 0);
    item.scheduled += 1;
    if (result.known) {
      item.completed += 1;
      item.dollars += Number(result.dollars || 0);
      item.pledges += Number(result.pledges || 0);
      item.results.push(Number(result.dollars || 0));
    }
  }
"""
new_group = """  function addGroup(map, key, minutes, result, durationMissing = false) {
    if (!map.has(key)) map.set(key, { key, minutes: 0, scheduled: 0, completed: 0, dollars: 0, pledges: 0, rateDollars: 0, ratePledges: 0, rateMinutes: 0, rateAirings: 0, missingDurationCount: 0, results: [] });
    const item = map.get(key);
    item.minutes += Number(minutes || 0);
    item.scheduled += 1;
    if (durationMissing) item.missingDurationCount += 1;
    if (result.known) {
      item.completed += 1;
      item.dollars += Number(result.dollars || 0);
      item.pledges += Number(result.pledges || 0);
      item.results.push(Number(result.dollars || 0));
      if (!durationMissing && Number(minutes || 0) > 0) {
        item.rateDollars += Number(result.dollars || 0);
        item.ratePledges += Number(result.pledges || 0);
        item.rateMinutes += Number(minutes || 0);
        item.rateAirings += 1;
      }
    }
  }
"""
replace_once(comparison, old_group, new_group, 'comparison rate group accounting')

analysis_new = """  function analyzeSchedule(schedule = {}) {
  const used = new Set();
  const importedRows = importedRowsForSchedule(schedule);
  const topics = new Map();
  const times = new Map();
  const placementRows = [];
  let scheduled = 0;
  let completed = 0;
  let scheduledMinutes = 0;
  let attributableDollars = 0;
  let attributablePledges = 0;
  let rateEligibleDollars = 0;
  let rateEligiblePledges = 0;
  let rateEligibleMinutes = 0;

  (schedule.placements || []).forEach((placement) => {
    if (!placement || placement.isNonPledge) return;
    const scheduledTitle = text(placement.programTitle || placement.program_title || placement.title || '');
    if (!scheduledTitle && !placement.programId) return;
    const scheduledLib = libraryRowForPlacement(placement) || {};
    const scheduledStartMinutes = placementStartMinutes(placement);
    const result = placementResult(placement, used, importedRows);
    const importedLib = result.importedRow ? libraryRowForImportedRow(result.importedRow) || {} : {};
    const lib = Object.keys(importedLib).length ? importedLib : scheduledLib;
    const minutes = programMinutes(placement, lib);
    const durationMissing = !(Number(minutes) > 0);
    const startMinutes = Number.isFinite(result.actualStartMinutes) ? result.actualStartMinutes : scheduledStartMinutes;
    const dateKey = text(result.actualDateKey || placement.dateKey || placement.date_key || '');
    const displayTitle = text(result.actualTitle || lib.title || scheduledTitle || 'Untitled program');
    const topic = canonicalCategory(lib.topic_primary || result.importedRow?.topic_primary || result.importedRow?.topic || placement.topicPrimary || placement.topic_primary || 'Uncategorized', 'Uncategorized');
    const secondary = canonicalCategory(lib.topic_secondary || result.importedRow?.topic_secondary || result.importedRow?.secondary_topic || placement.topicSecondary || placement.topic_secondary || 'Unspecified', 'Unspecified');
    const daypart = daypartLabel(startMinutes);

    scheduled += 1;
    scheduledMinutes += Number(minutes || 0);
    if (result.known) {
      completed += 1;
      attributableDollars += Number(result.dollars || 0);
      attributablePledges += Number(result.pledges || 0);
      if (!durationMissing) {
        rateEligibleDollars += Number(result.dollars || 0);
        rateEligiblePledges += Number(result.pledges || 0);
        rateEligibleMinutes += Number(minutes || 0);
      }
    }
    addGroup(topics, topic, minutes, result, durationMissing);
    addGroup(times, timeBucketLabel(startMinutes), minutes, result, durationMissing);
    placementRows.push({
      dateKey,
      startMinutes,
      title: displayTitle,
      plannedTitle: scheduledTitle,
      topic,
      secondary,
      daypart,
      minutes,
      durationMissing,
      known: Boolean(result.known),
      dollars: Number(result.dollars || 0),
      pledges: Number(result.pledges || 0),
      source: result.source || 'none'
    });
  });

  placementRows.sort((a, b) => text(a.dateKey).localeCompare(text(b.dateKey)) || Number(a.startMinutes || 0) - Number(b.startMinutes || 0));

  const meta = schedule.meta || {};
  const reportedBroadcast = Number(meta.reportedBroadcastTotalDollars ?? meta.importedBroadcastTotalDollars ?? meta.importedProgramSpecificBroadcastTotalDollars);
  const importedBroadcast = importedRows.reduce((sum, row) => sum + (Number(row.dollars ?? row.contribution_amount ?? 0) || 0), 0);
  const broadcastDollars = importedRows.length
    ? importedBroadcast
    : (Number.isFinite(reportedBroadcast) ? reportedBroadcast : attributableDollars);
  const onlineDollars = Number(schedule.onlineDollars || 0) || 0;
  const mailDollars = Number(schedule.mailDollars || 0) || 0;
  const onlineTracked = onlineDollars > 0;
  const mailTracked = mailDollars > 0;
  const recordedTotal = broadcastDollars + onlineDollars + mailDollars;

  return {
    schedule,
    scheduled,
    completed,
    scheduledMinutes,
    attributableDollars,
    attributablePledges,
    rateEligibleDollars,
    rateEligiblePledges,
    rateEligibleMinutes,
    missingDurationCount: placementRows.filter((row) => row.durationMissing).length,
    broadcastDollars,
    unattributedBroadcast: broadcastDollars - attributableDollars,
    onlineDollars,
    mailDollars,
    onlineTracked,
    mailTracked,
    recordedTotal,
    topics,
    times,
    placementRows,
    importedRows
  };
}
"""
replace_between(comparison, "  function analyzeSchedule(schedule = {}) {", "  function analysisForSchedule(schedule = {}) {", analysis_new, 'comparison schedule analysis')

# ---------------- Regression tests ----------------
replace_once(
    atest,
    "globalThis.__analyticsTestHooks = { daypartFromMinutes, medianValue, outlierSummary, summarizeGroup, distributionLabel, buildAiringRecordLookup, findAiringForSchedulePlacement, buildScheduleRecords, dedupeSchedulesByDateRange, getScheduleAudit: () => state.scheduleAudit, getMetric: () => state.metric };",
    "globalThis.__analyticsTestHooks = { daypartFromMinutes, medianValue, outlierSummary, summarizeGroup, distributionLabel, buildAiringRecordLookup, findAiringForSchedulePlacement, buildScheduleRecords, dedupeSchedulesByDateRange, canonicalCategory, startTimeEvidence, buildDriveSeasonRecords, getScheduleAudit: () => state.scheduleAudit, getMetric: () => state.metric };",
    'analytics test hooks'
)
write(atest, read(atest) + r'''

test('current imported report-day coverage beats a stale attached imported dollar value', () => {
  const schedules = [{ id: 's1', title: 'August 2026', placements: [
    { id: 'actual', dateKey: '2026-08-08', startMinutes: 1200, endMinutes: 1260, programId: 'p1', programTitle: 'Actual Show' },
    { id: 'stale', dateKey: '2026-08-08', startMinutes: 1260, endMinutes: 1320, programId: 'p2', programTitle: 'Missing Show', importedBroadcastDollars: 840, importedFromReport: true }
  ] }];
  const library = [
    { id: 'p1', title: 'Actual Show', topic_primary: 'Music' },
    { id: 'p2', title: 'Missing Show', topic_primary: 'History' }
  ];
  const imported = [{ id: 'a1', dateKey: '2026-08-08', date: new Date(2026, 7, 8), startMinutes: 1200, title: 'Actual Show', importedTitle: 'Actual Show', programId: 'p1', programOpenId: 'p1', dollars: 500, pledges: 2 }];
  const rows = hooks.buildScheduleRecords(schedules, library, imported);
  const stale = rows.find((row) => row.plannedTitle === 'Missing Show');
  assert.ok(stale);
  assert.equal(stale.resultSource, 'report-day-zero');
  assert.equal(stale.dollars, 0);
});

test('topic category normalization collapses inconsistent casing', () => {
  assert.equal(hooks.canonicalCategory('MUSIC'), 'Music');
  assert.equal(hooks.canonicalCategory('Music'), 'Music');
  assert.equal(hooks.canonicalCategory('MuSiC'), 'Music');
  assert.equal(hooks.canonicalCategory('HISTORY'), 'History');
});

test('start-time evidence requires rate-valid airings, three fundraisers, and three titles', () => {
  const make = (scheduleId, title, durationMinutes = 60) => ({ scheduleId, scheduleTitle: scheduleId, fundraiser: scheduleId, title, programId: `${scheduleId}-${title}`, programOpenId: `${scheduleId}-${title}`, durationMinutes });
  const twoTitles = [make('a', 'One'), make('a', 'Two'), make('b', 'One'), make('b', 'Two'), make('c', 'One'), make('c', 'Two')];
  assert.equal(hooks.startTimeEvidence(twoTitles).sufficient, false);
  assert.equal(hooks.startTimeEvidence([...twoTitles, make('c', 'Three')]).sufficient, true);
  const missingDurationDiversity = [make('a', 'One'), make('a', 'Two'), make('a', 'Three'), make('a', 'Four'), make('a', 'Five'), make('b', 'Six', 0), make('c', 'Seven', 0)];
  assert.equal(hooks.startTimeEvidence(missingDurationDiversity).sufficient, false);
});

test('season overview uses current imported Broadcast totals over stale saved schedule totals', () => {
  const schedules = [{ id: 's1', title: 'August 2026', startDate: '2026-08-08', endDate: '2026-08-16', placements: [], onlineDollars: 100, mailDollars: 50, meta: { reportedBroadcastTotalDollars: 9999 } }];
  const imported = [
    { row: { drive_start_date: '2026-08-08', drive_end_date: '2026-08-16' }, season: 'August', year: 2026, dollars: 400, pledges: 2 },
    { row: { drive_start_date: '2026-08-08', drive_end_date: '2026-08-16' }, season: 'August', year: 2026, dollars: 300, pledges: 1 }
  ];
  const rows = hooks.buildDriveSeasonRecords(schedules, imported);
  assert.equal(rows[0].broadcastDollars, 700);
  assert.equal(rows[0].dollars, 850);
  assert.equal(rows[0].pledges, 3);
  assert.equal(rows[0].sourceLabel, 'Current imported fundraiser history');
});
''')

replace_once(
    ctest,
    "globalThis.__comparisonTestHooks = { daypartLabel, overallRevenueDecomposition, comparisonChannelPolicy, comparableTotalForPolicy, topicRevenueDecomposition, subtopicRevenueDecomposition, placementResult, analyzeSchedule, alignedDailyContextRows, fundraiserDayOffset, fundraiserDayLabel, dailyContextAnalyses, weatherDateIsFetchable, medianValue, outlierSummary, groupStrength, pledgeWeatherWindowForDate, stationPledgeWindowSummaries, setAirings: (rows) => { state.airings = rows; state.analysisCache.clear(); } };",
    "globalThis.__comparisonTestHooks = { daypartLabel, overallRevenueDecomposition, comparisonChannelPolicy, comparableTotalForPolicy, topicRevenueDecomposition, subtopicRevenueDecomposition, placementResult, programMinutes, libraryRuntimeMinutes, canonicalCategory, analyzeSchedule, alignedDailyContextRows, fundraiserDayOffset, fundraiserDayLabel, dailyContextAnalyses, weatherDateIsFetchable, medianValue, outlierSummary, groupStrength, pledgeWeatherWindowForDate, stationPledgeWindowSummaries, setAirings: (rows) => { state.airings = rows; state.analysisCache.clear(); } };",
    'comparison test hooks'
)
write(ctest, read(ctest) + r'''

test('Comparison Lab never guesses a 30-minute duration', () => {
  assert.equal(hooks.programMinutes({ startMinutes: 1200 }, {}), 0);
  assert.equal(hooks.programMinutes({ startMinutes: 1200, endMinutes: 1260 }, {}), 60);
  assert.equal(hooks.programMinutes({ startMinutes: 1200 }, { length_bucket_minutes: 90 }), 90);
});

test('Comparison Lab current report-day evidence beats stale attached imported dollars', () => {
  const importedRows = [{ id: 'reported', air_date: '2026-08-08', air_time: '20:00', program_title: 'Reported Program', dollars: 500, pledge_count: 2 }];
  const result = hooks.placementResult({ dateKey: '2026-08-08', startMinutes: 1260, programTitle: 'Scheduled But Missing', importedBroadcastDollars: 840, importedFromReport: true }, new Set(), importedRows);
  assert.equal(result.source, 'report-day-zero');
  assert.equal(result.dollars, 0);
});

test('Comparison Lab category normalization collapses mixed topic casing', () => {
  assert.equal(hooks.canonicalCategory('MUSIC'), 'Music');
  assert.equal(hooks.canonicalCategory('Music'), 'Music');
  assert.equal(hooks.canonicalCategory('MuSiC'), 'Music');
});

test('missing-duration dollars stay factual but are excluded from Comparison Lab rate accounting', () => {
  hooks.setAirings([]);
  const analysis = hooks.analyzeSchedule({
    id: 's1', title: 'August 2026', startDate: '2026-08-08', endDate: '2026-08-08',
    placements: [
      { id: 'a', dateKey: '2026-08-08', startMinutes: 1200, lengthMinutes: 60, programTitle: 'Known', topicPrimary: 'MUSIC', manualResultRecorded: true, manualBroadcastDollars: 100 },
      { id: 'b', dateKey: '2026-08-08', startMinutes: 1260, programTitle: 'Unknown Length', topicPrimary: 'MuSiC', manualResultRecorded: true, manualBroadcastDollars: 200 }
    ]
  });
  assert.equal(analysis.scheduledMinutes, 60);
  assert.equal(analysis.attributableDollars, 300);
  assert.equal(analysis.rateEligibleMinutes, 60);
  assert.equal(analysis.rateEligibleDollars, 100);
  assert.equal(analysis.missingDurationCount, 1);
  assert.equal(analysis.topics.size, 1);
  const music = [...analysis.topics.values()][0];
  assert.equal(music.key, 'Music');
  assert.equal(music.dollars, 300);
  assert.equal(music.rateDollars, 100);
  assert.equal(music.rateMinutes, 60);
});
''')

if 'return 30;' in read(comparison):
    raise SystemExit('Comparison Lab still contains a 30-minute duration fallback')

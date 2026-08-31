(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WNMUOneSheetAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SEASONS = ['March', 'June', 'August', 'December'];

  function text(value) {
    return String(value ?? '').trim();
  }

  function lookupKey(value) {
    return text(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function titleCaseLabel(value) {
    const raw = text(value);
    if (!raw) return '';
    if (raw === raw.toUpperCase() || raw === raw.toLowerCase()) {
      return raw.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
    }
    return raw;
  }

  function canonicalCategory(value, fallback = 'Uncategorized') {
    const raw = text(value);
    return raw ? titleCaseLabel(raw) : fallback;
  }

  function nolaKey(value) {
    return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function parseDate(value) {
    const raw = text(value);
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [year, month, day] = raw.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function seasonForDate(value) {
    const date = value instanceof Date ? value : parseDate(value);
    if (!date) return '';
    const month = date.getMonth() + 1;
    if (month === 2 || month === 3) return 'March';
    if (month === 5 || month === 6) return 'June';
    if (month === 8 || month === 9) return 'August';
    if (month === 11 || month === 12) return 'December';
    return '';
  }

  function normalizeSchedule(row = {}) {
    const data = row.schedule_data && typeof row.schedule_data === 'object' ? row.schedule_data : {};
    const meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
    const startDate = text(row.start_date || data.startDate);
    const endDate = text(row.end_date || data.endDate);
    const onlineDollars = Number(data.onlineDollars ?? row.online_dollars ?? row.onlineDollars ?? 0) || 0;
    const mailDollars = Number(data.mailDollars ?? row.mail_dollars ?? row.mailDollars ?? 0) || 0;
    const start = parseDate(startDate);
    return {
      id: text(row.id || data.id),
      title: text(row.title || data.title || 'Untitled fundraiser'),
      startDate,
      endDate,
      createdAt: text(row.created_at || data.createdAt),
      updatedAt: text(row.updated_at || data.updatedAt),
      placements: Array.isArray(data.placements) ? data.placements : [],
      onlineDollars,
      mailDollars,
      goalDollars: Number(data.goalDollars ?? row.goal_dollars ?? row.goalDollars ?? 0) || 0,
      onlineTracked: Boolean(data.onlineTracked ?? meta.onlineTracked ?? onlineDollars > 0),
      mailTracked: Boolean(data.mailTracked ?? meta.mailTracked ?? mailDollars > 0),
      onlineTrackedExplicit: data.onlineTracked !== undefined || meta.onlineTracked !== undefined,
      mailTrackedExplicit: data.mailTracked !== undefined || meta.mailTracked !== undefined,
      meta,
      season: seasonForDate(startDate),
      year: start?.getFullYear() || 0
    };
  }

  function schedulePreferenceScore(schedule = {}) {
    let score = 0;
    if (schedule.onlineTracked || schedule.mailTracked || schedule.onlineDollars || schedule.mailDollars) score += 100000;
    if ((schedule.placements || []).some((placement) => !placement?.importedFromReport)) score += 50000;
    if ((schedule.placements || []).length) score += Math.min(10000, schedule.placements.length * 10);
    const updated = Date.parse(schedule.updatedAt || schedule.createdAt || '');
    if (Number.isFinite(updated)) score += Math.floor(updated / 1000000000);
    return score;
  }

  function prepareSchedules(schedules = []) {
    const buckets = new Map();
    (schedules || []).forEach((schedule) => {
      if (!schedule) return;
      const key = schedule.startDate && schedule.endDate ? `${schedule.startDate}|${schedule.endDate}` : `id:${schedule.id}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(schedule);
    });
    const prepared = [];
    buckets.forEach((items) => {
      const ranked = [...items].sort((a, b) => schedulePreferenceScore(b) - schedulePreferenceScore(a));
      if (ranked[0]) prepared.push({ ...ranked[0], duplicateRangeCount: ranked.length });
    });
    return prepared.sort((a, b) =>
      text(b.startDate).localeCompare(text(a.startDate))
      || text(b.updatedAt).localeCompare(text(a.updatedAt))
      || text(b.title).localeCompare(text(a.title))
    );
  }

  function buildLibraryIndexes(rows = []) {
    const byId = new Map();
    const byTitle = new Map();
    const byNola = new Map();
    (rows || []).forEach((row) => {
      const id = text(row?.id);
      const title = text(row?.title);
      const nola = nolaKey(row?.nola_code);
      if (id) byId.set(id, row);
      if (title) byTitle.set(lookupKey(title), row);
      if (nola) {
        if (!byNola.has(nola)) byNola.set(nola, []);
        byNola.get(nola).push(row);
      }
    });
    return { byId, byTitle, byNola };
  }

  function libraryForPlacement(placement = {}, indexes = {}) {
    const id = text(placement.programId || placement.program_id || '');
    if (id && indexes.byId?.has(id)) return indexes.byId.get(id);
    const nola = nolaKey(placement.nolaCode || placement.nola_code || placement.nola || '');
    const title = lookupKey(placement.programTitle || placement.program_title || placement.title || '');
    if (nola) {
      const matches = indexes.byNola?.get(nola) || [];
      if (title) {
        const exact = matches.find((row) => lookupKey(row?.title) === title);
        if (exact) return exact;
      }
      if (matches.length === 1) return matches[0];
    }
    return title ? indexes.byTitle?.get(title) || null : null;
  }

  function libraryForImportedRow(row = {}, indexes = {}) {
    const id = text(row.pledge_program_id || row.manual_match_program_id || row.program_id || '');
    if (id && indexes.byId?.has(id)) return indexes.byId.get(id);
    const nola = nolaKey(row.nola_code || row.nola || row.program_nola || '');
    const title = lookupKey(row.matched_library_title || row.program_title || row.title || row.imported_program_title || '');
    if (nola) {
      const matches = indexes.byNola?.get(nola) || [];
      if (title) {
        const exact = matches.find((candidate) => lookupKey(candidate?.title) === title);
        if (exact) return exact;
      }
      if (matches.length === 1) return matches[0];
    }
    return title ? indexes.byTitle?.get(title) || null : null;
  }

  function importedSourceIdentityCode(row = {}) {
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

  function importedDateKey(row = {}) {
    const direct = text(row.air_date || row.drive_date);
    if (direct) return direct.slice(0, 10);
    return dateKey(parseDate(row.aired_at));
  }

  function importedStartMinutes(row = {}) {
    const raw = text(row.air_time || '');
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (match) return (Number(match[1]) * 60) + Number(match[2]);
    const date = new Date(row.aired_at || '');
    return Number.isNaN(date.getTime()) ? null : (date.getHours() * 60) + date.getMinutes();
  }

  function importedTitle(row = {}) {
    return text(row.matched_library_title || row.program_title || row.title || row.imported_program_title || '');
  }

  function scheduleSeasonYear(schedule = {}) {
    const counts = new Map();
    (schedule.placements || []).forEach((placement) => {
      const date = parseDate(placement?.dateKey || placement?.date_key || '');
      if (!date) return;
      const season = seasonForDate(date);
      const year = date.getFullYear();
      if (!season || !year) return;
      const key = `${season}|${year}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    if (counts.size) {
      const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      const [season, year] = key.split('|');
      return { season, year: Number(year) };
    }
    const title = text(schedule.title || '');
    const titleSeason = SEASONS.find((season) => new RegExp(`\\b${season}\\b`, 'i').test(title)) || '';
    const titleYearMatch = title.match(/\b(20\d{2})\b/);
    if (titleSeason && titleYearMatch) return { season: titleSeason, year: Number(titleYearMatch[1]) };
    const start = parseDate(schedule.startDate || '');
    return { season: text(schedule.season || seasonForDate(start)), year: Number(schedule.year || start?.getFullYear() || 0) };
  }

  function importedRowsForSchedule(schedule = {}, allRows = []) {
    const rows = Array.isArray(allRows) ? allRows : [];
    const start = text(schedule.startDate);
    const end = text(schedule.endDate);
    if (start && end) {
      const exact = rows.filter((row) =>
        text(row.drive_start_date).slice(0, 10) === start
        && text(row.drive_end_date).slice(0, 10) === end
      );
      if (exact.length) return exact;
    }
    const identity = scheduleSeasonYear(schedule);
    if (!identity.season || !identity.year) return [];
    return rows.filter((row) => {
      const date = parseDate(importedDateKey(row));
      return Boolean(date && seasonForDate(date) === identity.season && date.getFullYear() === identity.year);
    });
  }

  function importedUseKey(row = {}) {
    return text(row.row_hash || row.id || `${importedDateKey(row)}|${importedStartMinutes(row) ?? ''}|${importedTitle(row)}|${row.dollars ?? row.contribution_amount ?? ''}`);
  }

  function placementStartMinutes(placement = {}) {
    const value = Number(placement.startMinutes ?? placement.start_minutes ?? placement.start);
    return Number.isFinite(value) ? value : null;
  }

  function libraryRuntimeMinutes(row = {}) {
    const seconds = Number(row.actual_runtime_seconds ?? row.runtime_seconds ?? row.actual_runtime);
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds / 60);
    const direct = Number(row.actual_runtime_minutes ?? row.runtime_minutes ?? row.length_minutes);
    if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
    const bucket = Number(row.length_bucket_minutes ?? row.lengthBucketMinutes ?? row.length_bucket);
    return Number.isFinite(bucket) && bucket > 0 ? bucket : null;
  }

  function placementDuration(placement = {}, lib = {}) {
    const explicit = Number(
      placement.lengthMinutes
      ?? placement.programMinutes
      ?? placement.program_minutes
      ?? placement.durationMinutes
      ?? placement.length_bucket_minutes
      ?? placement.lengthBucketMinutes
    );
    if (Number.isFinite(explicit) && explicit > 0) {
      return { minutes: explicit, source: 'schedule', missing: false };
    }
    const libraryMinutes = libraryRuntimeMinutes(lib);
    if (Number.isFinite(libraryMinutes) && libraryMinutes > 0) {
      return { minutes: libraryMinutes, source: 'library', missing: false };
    }
    return { minutes: 0, source: 'missing', missing: true };
  }

  function identityMatches(row = {}, placement = {}, lib = null) {
    const placementId = text(placement.programId || placement.program_id || lib?.id || '');
    const rowId = text(row.program_id || row.pledge_program_id || row.manual_match_program_id || '');
    if (placementId && rowId && placementId === rowId) return true;
    const placementNola = nolaKey(lib?.nola_code || placement.nolaCode || placement.nola_code || placement.nola || '');
    const rowNola = nolaKey(row.nola_code || row.nola || row.program_nola || '');
    if (placementNola && rowNola && placementNola === rowNola) return true;
    const placementTitle = lookupKey(lib?.title || placement.programTitle || placement.program_title || placement.title || '');
    const rowTitle = lookupKey(row.matched_library_title || row.program_title || row.title || row.imported_program_title || '');
    return Boolean(placementTitle && rowTitle && placementTitle === rowTitle);
  }

  function importedRowForPlacement(placement = {}, used = new Set(), importedRows = [], indexes = {}) {
    const available = (importedRows || []).filter((row) => !used.has(importedUseKey(row)));
    const hash = text(placement.sourceAiringHash || placement.source_airing_hash || '');
    if (hash) {
      const direct = available.find((row) => text(row.row_hash) === hash);
      if (direct) return direct;
    }
    const date = text(placement.dateKey || placement.date_key || '');
    if (!date) return null;
    const start = placementStartMinutes(placement);
    const lib = libraryForPlacement(placement, indexes);
    const sameDay = available.filter((row) => importedDateKey(row) === date);
    if (Number.isFinite(start)) {
      const exactTime = sameDay.filter((row) => importedStartMinutes(row) === start);
      const exactIdentity = exactTime.filter((row) => identityMatches(row, placement, lib));
      if (exactIdentity.length === 1) return exactIdentity[0];
      if (exactIdentity.length > 1) return null;
      if (exactTime.length === 1) return exactTime[0];
      if (exactTime.length > 1) return null;
    }
    const sameDayIdentity = sameDay.filter((row) => identityMatches(row, placement, lib));
    return sameDayIdentity.length === 1 ? sameDayIdentity[0] : null;
  }

  function importedDateHasResults(date = '', importedRows = []) {
    const wanted = text(date);
    return Boolean(wanted && (importedRows || []).some((row) => importedDateKey(row) === wanted));
  }

  function placementResult(placement = {}, used = new Set(), importedRows = [], indexes = {}) {
    if (placement?.isNonPledge) return { known: false, dollars: 0, pledges: 0, source: 'non-pledge' };
    const imported = importedRowForPlacement(placement, used, importedRows, indexes);
    if (imported) {
      const usedKey = importedUseKey(imported);
      if (usedKey) used.add(usedKey);
      return {
        known: true,
        dollars: Number(imported.dollars ?? imported.contribution_amount ?? 0) || 0,
        pledges: Number(imported.pledge_count || imported.pledges || 0) || 0,
        source: 'report',
        importedRow: imported,
        actualDateKey: importedDateKey(imported),
        actualStartMinutes: importedStartMinutes(imported),
        actualTitle: importedTitle(imported)
      };
    }

    // Current imported report coverage is authoritative. If this date is present in
    // the report but this scheduled placement is not, it is a completed $0 even if
    // an older saved placement still carries stale imported dollars.
    const date = text(placement.dateKey || placement.date_key || '');
    if (importedDateHasResults(date, importedRows)) {
      return { known: true, dollars: 0, pledges: 0, source: 'report-day-zero', implicitZero: true };
    }

    // Attached imported dollars remain a fallback only when no current imported
    // evidence is available for that fundraiser date.
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
    if (placement?.manualResultRecorded) {
      return {
        known: true,
        dollars: Number(placement.manualBroadcastDollars || 0) || 0,
        pledges: Number(placement.manualPledgeCount || 0) || 0,
        source: 'manual'
      };
    }
    return { known: false, dollars: 0, pledges: 0, source: 'none' };
  }

  function daypartLabel(minutes) {
    if (!Number.isFinite(Number(minutes))) return 'Unknown';
    const normalized = ((Number(minutes) % 1440) + 1440) % 1440;
    if (normalized >= 420 && normalized < 720) return 'Morning';
    if (normalized >= 720 && normalized < 1020) return 'Afternoon';
    if (normalized >= 1020 && normalized < 1200) return 'Early evening';
    if (normalized >= 1200 && normalized < 1350) return 'Prime';
    return 'Overnight';
  }

  function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : fallback;
    const raw = text(value).toLowerCase();
    if (['true', 'yes', 'y', '1', 'live', 'live break', 'live-break', 'has live break', 'has live breaks'].includes(raw)) return true;
    if (['false', 'no', 'n', '0', 'none', 'not live', 'no live break', 'no live breaks'].includes(raw)) return false;
    return fallback;
  }

  function liveBreakFlag(placement = {}) {
    const objects = [placement, placement.meta, placement.flags, placement.scheduleFlags, placement.liveBreakMeta]
      .filter((value) => value && typeof value === 'object');
    const keys = [
      'liveBreakFlag', 'scheduleLiveBreakFlag', 'hasLiveBreakFlag', 'isLiveBreakFlag',
      'live_break_flag', 'schedule_live_break_flag', 'liveBreak', 'live_break',
      'liveBreaks', 'live_breaks', 'hasLiveBreak', 'has_live_break', 'isLiveBreak', 'is_live_break',
      'liveFlag', 'live_flag', 'liveEvent', 'live_event', 'isLiveEvent', 'is_live_event',
      'livePledgeFlag', 'live_pledge_flag'
    ];
    const noteKeys = ['liveBreakNotes', 'live_break_notes', 'liveBreakNote', 'live_break_note', 'liveNotes', 'live_notes'];
    for (const object of objects) {
      if (noteKeys.some((key) => text(object?.[key]))) return true;
      for (const key of keys) {
        if (normalizeBoolean(object?.[key], null) === true) return true;
      }
    }
    return false;
  }

  function addGroup(map, key, minutes, result, durationMissing = false) {
    const label = canonicalCategory(key);
    const groupKey = lookupKey(label) || label;
    if (!map.has(groupKey)) {
      map.set(groupKey, {
        key: label, minutes: 0, scheduled: 0, completed: 0, dollars: 0, pledges: 0,
        rateDollars: 0, ratePledges: 0, rateMinutes: 0, rateAirings: 0, missingDurationCount: 0, results: []
      });
    }
    const item = map.get(groupKey);
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

  function normalizeUnmatchedImportedRow(row = {}, indexes = {}) {
    const lib = libraryForImportedRow(row, indexes) || {};
    const duration = placementDuration({}, lib);
    const startMinutes = importedStartMinutes(row);
    const title = importedTitle(row) || 'Unattributed Broadcast result';
    return {
      dateKey: importedDateKey(row),
      startMinutes,
      endMinutes: Number.isFinite(startMinutes) && duration.minutes > 0 ? startMinutes + duration.minutes : null,
      title,
      plannedTitle: '',
      topic: canonicalCategory(lib.topic_primary || row.topic_primary || row.topic || 'Unattributed', 'Unattributed'),
      secondary: canonicalCategory(lib.topic_secondary || row.topic_secondary || row.secondary_topic || 'Unspecified', 'Unspecified'),
      distributor: text(lib.distributor || row.distributor || 'Unknown') || 'Unknown',
      daypart: daypartLabel(startMinutes),
      minutes: duration.minutes,
      durationSource: duration.source,
      durationMissing: duration.missing,
      countsTowardScheduleMinutes: false,
      known: true,
      dollars: Number(row.dollars ?? row.contribution_amount ?? 0) || 0,
      pledges: Number(row.pledge_count || row.pledges || 0) || 0,
      source: 'report-unmatched',
      unmatchedImported: true,
      liveBreak: false,
      rowHash: text(row.row_hash || ''),
      importedSourceTitle: text(row.imported_program_title || row.program_title || row.title || ''),
      importedMatchedTitle: text(row.matched_library_title || ''),
      importedNola: text(row.nola_code || row.nola || row.program_nola || ''),
      programId: text(lib.id || row.program_id || row.pledge_program_id || '')
    };
  }

  function analyzeSchedule(schedule = {}, allAirings = [], indexes = {}) {
    const used = new Set();
    const importedRows = importedRowsForSchedule(schedule, allAirings);
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
      if (placement?.isNonPledge) return;
      scheduled += 1;
      const scheduledTitle = text(placement.programTitle || placement.program_title || placement.title || '');
      const scheduledLib = libraryForPlacement(placement, indexes) || {};
      const result = placementResult(placement, used, importedRows, indexes);
      const importedLib = result.importedRow ? (libraryForImportedRow(result.importedRow, indexes) || {}) : {};
      const lib = Object.keys(importedLib).length ? importedLib : scheduledLib;
      const duration = placementDuration(placement, lib);
      const minutes = duration.minutes;
      scheduledMinutes += minutes;
      const scheduledStart = placementStartMinutes(placement);
      const startMinutes = Number.isFinite(result.actualStartMinutes) ? result.actualStartMinutes : scheduledStart;
      const resultDate = text(result.actualDateKey || placement.dateKey || placement.date_key || '');
      const displayTitle = result.source === 'report'
        ? text(result.actualTitle || lib.title || scheduledTitle || 'Untitled program')
        : text(scheduledTitle || lib.title || 'Untitled program');
      const topic = canonicalCategory(lib.topic_primary || result.importedRow?.topic_primary || result.importedRow?.topic || placement.topicPrimary || placement.topic_primary || 'Uncategorized');
      const secondary = canonicalCategory(lib.topic_secondary || result.importedRow?.topic_secondary || result.importedRow?.secondary_topic || placement.topicSecondary || placement.topic_secondary || 'Unspecified', 'Unspecified');
      const distributor = text(lib.distributor || placement.distributor || result.importedRow?.distributor || 'Unknown') || 'Unknown';

      if (result.known) {
        completed += 1;
        attributableDollars += Number(result.dollars || 0);
        attributablePledges += Number(result.pledges || 0);
        if (!duration.missing && minutes > 0) {
          rateEligibleDollars += Number(result.dollars || 0);
          rateEligiblePledges += Number(result.pledges || 0);
          rateEligibleMinutes += minutes;
        }
      }

      addGroup(topics, topic, minutes, result, duration.missing);
      const timeKey = Number.isFinite(startMinutes) ? Math.floor((((startMinutes % 1440) + 1440) % 1440) / 30) * 30 : null;
      addGroup(times, Number.isFinite(timeKey) ? String(timeKey) : 'Unknown', minutes, result, duration.missing);
      placementRows.push({
        dateKey: resultDate,
        startMinutes,
        endMinutes: Number.isFinite(startMinutes) && minutes > 0 ? startMinutes + minutes : null,
        title: displayTitle,
        plannedTitle: scheduledTitle,
        topic,
        secondary,
        distributor,
        daypart: daypartLabel(startMinutes),
        minutes,
        durationSource: duration.source,
        durationMissing: duration.missing,
        countsTowardScheduleMinutes: true,
        known: Boolean(result.known),
        dollars: Number(result.dollars || 0),
        pledges: Number(result.pledges || 0),
        source: result.source || 'none',
        liveBreak: liveBreakFlag(placement),
        programId: text(lib.id || placement.programId || placement.program_id || '')
      });
    });

    const unmatchedImportedRows = importedRows
      .filter((row) => {
        const key = importedUseKey(row);
        return Boolean(key && !used.has(key));
      })
      .map((row) => normalizeUnmatchedImportedRow(row, indexes));
    placementRows.push(...unmatchedImportedRows);
    placementRows.sort((a, b) => text(a.dateKey).localeCompare(text(b.dateKey)) || Number(a.startMinutes || 0) - Number(b.startMinutes || 0));

    const meta = schedule.meta || {};
    const reportedBroadcast = Number(meta.reportedBroadcastTotalDollars ?? meta.importedBroadcastTotalDollars ?? meta.importedProgramSpecificBroadcastTotalDollars);
    const importedBroadcast = importedRows.reduce((sum, row) => sum + (Number(row.dollars ?? row.contribution_amount ?? 0) || 0), 0);
    const importedPledges = importedRows.reduce((sum, row) => sum + (Number(row.pledge_count || row.pledges || 0) || 0), 0);
    const broadcastDollars = importedRows.length ? importedBroadcast : (Number.isFinite(reportedBroadcast) ? reportedBroadcast : attributableDollars);
    const pledges = importedRows.length ? importedPledges : attributablePledges;
    const missingDurationRows = placementRows.filter((row) => row.durationMissing && !row.unmatchedImported);
    const onlineDollars = Number(schedule.onlineDollars || 0) || 0;
    const mailDollars = Number(schedule.mailDollars || 0) || 0;

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
      broadcastDollars,
      pledges,
      onlineDollars,
      mailDollars,
      onlineTracked: Boolean(schedule.onlineTracked),
      mailTracked: Boolean(schedule.mailTracked),
      topics,
      times,
      placementRows,
      importedRows,
      unmatchedImportedRows,
      missingDurationRows
    };
  }

  function dollarsPerHour(dollars, minutes) {
    return Number(minutes || 0) > 0 ? Number(dollars || 0) / (Number(minutes) / 60) : 0;
  }

  function pledgesPerHour(pledges, minutes) {
    return Number(minutes || 0) > 0 ? Number(pledges || 0) / (Number(minutes) / 60) : 0;
  }

  function dollarsPerPledge(dollars, pledges) {
    return Number(pledges || 0) > 0 ? Number(dollars || 0) / Number(pledges) : 0;
  }

  function median(values = []) {
    const sorted = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function calendarDays(analysis = {}) {
    const buckets = new Map();
    (analysis.placementRows || []).forEach((row) => {
      if (!row.dateKey) return;
      if (!buckets.has(row.dateKey)) buckets.set(row.dateKey, []);
      buckets.get(row.dateKey).push(row);
    });
    return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rows]) => {
      const scheduledRows = rows.filter((row) => row.countsTowardScheduleMinutes !== false);
      const minutes = scheduledRows.reduce((sum, row) => sum + Number(row.minutes || 0), 0);
      const rateRows = scheduledRows.filter((row) => row.known && !row.durationMissing && Number(row.minutes) > 0);
      const rateMinutes = rateRows.reduce((sum, row) => sum + Number(row.minutes || 0), 0);
      const eligibleDollars = rateRows.reduce((sum, row) => sum + Number(row.dollars || 0), 0);
      const eligiblePledges = rateRows.reduce((sum, row) => sum + Number(row.pledges || 0), 0);
      const dollars = rows.reduce((sum, row) => sum + (row.known ? Number(row.dollars || 0) : 0), 0);
      const pledges = rows.reduce((sum, row) => sum + (row.known ? Number(row.pledges || 0) : 0), 0);
      const starts = scheduledRows.map((row) => Number(row.startMinutes)).filter(Number.isFinite);
      const ends = scheduledRows.map((row) => Number(row.endMinutes)).filter(Number.isFinite);
      const date = parseDate(key);
      return {
        dateKey: key,
        date,
        weekday: date ? date.toLocaleDateString(undefined, { weekday: 'long' }) : key,
        minutes,
        rateMinutes,
        dollars,
        pledges,
        dollarsPerHour: dollarsPerHour(eligibleDollars, rateMinutes),
        pledgesPerHour: pledgesPerHour(eligiblePledges, rateMinutes),
        startMinutes: starts.length ? Math.min(...starts) : null,
        endMinutes: ends.length ? Math.max(...ends) : null,
        missingDurationCount: scheduledRows.filter((row) => row.durationMissing).length
      };
    });
  }

  function firstSaturdayAnchor(analysis = {}) {
    const importedDates = (analysis.importedRows || []).map(importedDateKey).filter(Boolean);
    const placementDates = (analysis.placementRows || []).map((row) => row.dateKey).filter(Boolean);
    const candidates = [...new Set(importedDates.length ? importedDates : placementDates)].sort();
    const saturday = candidates.map(parseDate).find((date) => date && date.getDay() === 6);
    if (saturday) return saturday;
    const start = parseDate(analysis.schedule?.startDate);
    if (!start) return null;
    const next = new Date(start);
    while (next.getDay() !== 6) next.setDate(next.getDate() + 1);
    return next;
  }

  function firstSaturdaySeasonalOffsets(analyses = []) {
    const items = analyses.map((analysis) => ({ analysis, date: firstSaturdayAnchor(analysis) }));
    const seasonalDay = (date) => date
      ? Math.round(Date.UTC(2000, date.getMonth(), date.getDate()) / 86400000)
      : null;
    const valid = items.map((item) => seasonalDay(item.date)).filter(Number.isFinite);
    const earliest = valid.length ? Math.min(...valid) : 0;
    return items.map((item) => ({
      analysis: item.analysis,
      date: item.date,
      daysFromEarliest: Number.isFinite(seasonalDay(item.date)) ? seasonalDay(item.date) - earliest : 0
    }));
  }

  function fundraiserDayOffset(analysis = {}, row = {}) {
    const anchor = firstSaturdayAnchor(analysis);
    const date = parseDate(row.dateKey);
    return anchor && date ? Math.round((date - anchor) / 86400000) : null;
  }

  function ordinal(value) {
    const n = Number(value);
    if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
    if (n % 10 === 1) return `${n}st`;
    if (n % 10 === 2) return `${n}nd`;
    if (n % 10 === 3) return `${n}rd`;
    return `${n}th`;
  }

  function fundraiserDayLabel(offset) {
    const n = Number(offset);
    if (n === -1) return { title: 'Friday before', detail: 'Day -1 · pre-Saturday start' };
    if (!Number.isFinite(n)) return { title: 'Unknown day', detail: '' };
    const anchor = new Date(2026, 7, 8);
    anchor.setDate(anchor.getDate() + n);
    const weekday = anchor.toLocaleDateString(undefined, { weekday: 'long' });
    if (n >= 0) return { title: `${ordinal(Math.floor(n / 7) + 1)} ${weekday}`, detail: `Day +${n}` };
    return { title: weekday, detail: `Day ${n}` };
  }

  function alignedDailyRows(analyses = []) {
    const byAnalysis = analyses.map((analysis) => {
      const map = new Map();
      calendarDays(analysis).forEach((day) => {
        const offset = fundraiserDayOffset(analysis, day);
        if (Number.isFinite(offset)) map.set(offset, day);
      });
      return map;
    });
    const offsets = [...new Set(byAnalysis.flatMap((map) => [...map.keys()]))].filter((value) => value >= -1).sort((a, b) => a - b);
    return offsets.map((offset) => ({
      offset,
      label: fundraiserDayLabel(offset),
      days: byAnalysis.map((map) => map.get(offset) || null)
    })).filter((entry) => entry.days.some(Boolean));
  }

  function comparisonChannelPolicy(analyses = []) {
    return {
      includeOnline: analyses.length > 0 && analyses.every((analysis) => analysis.onlineTracked),
      includeMail: analyses.length > 0 && analyses.every((analysis) => analysis.mailTracked)
    };
  }

  function comparableTotal(analysis = {}, policy = {}) {
    return Number(analysis.broadcastDollars || 0)
      + (policy.includeOnline ? Number(analysis.onlineDollars || 0) : 0)
      + (policy.includeMail ? Number(analysis.mailDollars || 0) : 0);
  }

  function topicComparisonRows(analyses = []) {
    const keys = new Map();
    analyses.forEach((analysis) => {
      analysis.topics?.forEach((item, key) => {
        const norm = lookupKey(key);
        if (!keys.has(norm)) keys.set(norm, item.key || key);
      });
    });
    return [...keys.entries()].map(([norm, display]) => {
      const values = analyses.map((analysis) => {
        let item = null;
        analysis.topics?.forEach((candidate, key) => {
          if (!item && lookupKey(key) === norm) item = candidate;
        });
        item = item || {
          key: display, minutes: 0, scheduled: 0, completed: 0, dollars: 0, pledges: 0,
          rateDollars: 0, ratePledges: 0, rateMinutes: 0, rateAirings: 0, missingDurationCount: 0
        };
        const totalMinutes = Number(analysis.scheduledMinutes || 0);
        return {
          ...item,
          share: totalMinutes > 0 ? Number(item.minutes || 0) / totalMinutes : 0,
          dollarsPerHour: dollarsPerHour(item.rateDollars, item.rateMinutes),
          pledgesPerHour: pledgesPerHour(item.ratePledges, item.rateMinutes),
          dollarsPerPledge: dollarsPerPledge(item.dollars, item.pledges)
        };
      });
      return { key: canonicalCategory(display), values };
    }).sort((a, b) => {
      const aMinutes = a.values.reduce((sum, value) => sum + Number(value.minutes || 0), 0);
      const bMinutes = b.values.reduce((sum, value) => sum + Number(value.minutes || 0), 0);
      return bMinutes - aMinutes || a.key.localeCompare(b.key);
    });
  }

  function startTimePledgeBuckets(analysis = {}) {
    const map = new Map();
    (analysis.placementRows || []).forEach((row) => {
      if (!row.known || !Number.isFinite(Number(row.startMinutes))) return;
      const normalized = ((Number(row.startMinutes) % 1440) + 1440) % 1440;
      const bucket = Math.floor(normalized / 30) * 30;
      if (!map.has(bucket)) map.set(bucket, { startMinutes: bucket, pledges: 0, dollars: 0, airings: 0 });
      const item = map.get(bucket);
      item.pledges += Number(row.pledges || 0);
      item.dollars += Number(row.dollars || 0);
      item.airings += 1;
    });
    return [...map.values()].sort((a, b) => a.startMinutes - b.startMinutes);
  }

  function pledgeWeatherWindowForDate(dateValue, day = null) {
    const date = parseDate(dateValue);
    const dayNumber = date?.getDay();
    const startHour = dayNumber === 0 || dayNumber === 6 ? 15 : 17;
    const scheduledStart = Number(day?.startMinutes);
    const scheduledEnd = Number(day?.endMinutes);
    const derivedStart = Number.isFinite(scheduledStart) ? Math.max(0, Math.floor((scheduledStart % 1440) / 60)) : startHour;
    const derivedEnd = Number.isFinite(scheduledEnd) ? Math.min(24, Math.ceil((((scheduledEnd - 1) % 1440) + 1) / 60)) : 24;
    return { startHour: Math.min(startHour, derivedStart), endHourExclusive: Math.max(derivedEnd, startHour + 1) };
  }

  function programResultsRows(analysis = {}) {
    const groups = new Map();
    (analysis.placementRows || []).forEach((row) => {
      if (!row.known) return;
      const key = lookupKey(row.title || row.plannedTitle || 'Untitled program') || 'untitled';
      if (!groups.has(key)) {
        groups.set(key, {
          title: text(row.title || row.plannedTitle || 'Untitled program'),
          topic: canonicalCategory(row.topic),
          airings: 0,
          minutes: 0,
          durationValues: [],
          dollars: 0,
          pledges: 0,
          rateDollars: 0,
          rateMinutes: 0,
          missingDurationCount: 0
        });
      }
      const item = groups.get(key);
      item.airings += 1;
      item.dollars += Number(row.dollars || 0);
      item.pledges += Number(row.pledges || 0);
      if (row.durationMissing || !(Number(row.minutes) > 0)) {
        item.missingDurationCount += 1;
      } else {
        item.minutes += Number(row.minutes || 0);
        item.durationValues.push(Number(row.minutes || 0));
        item.rateDollars += Number(row.dollars || 0);
        item.rateMinutes += Number(row.minutes || 0);
      }
    });
    return [...groups.values()].map((item) => {
      const uniqueLengths = [...new Set(item.durationValues.map((value) => Math.round(value)))];
      return {
        ...item,
        lengthMinutes: uniqueLengths.length === 1 ? uniqueLengths[0] : null,
        lengthLabel: !item.durationValues.length ? 'Length missing' : uniqueLengths.length === 1 ? `${uniqueLengths[0]} min` : 'Varies',
        dollarsPerHour: dollarsPerHour(item.rateDollars, item.rateMinutes)
      };
    }).sort((a, b) => b.dollars - a.dollars || b.dollarsPerHour - a.dollarsPerHour || a.title.localeCompare(b.title));
  }

  function weekpartLabel(dateValue) {
    const date = parseDate(dateValue);
    if (!date) return 'Unknown';
    if (date.getDay() === 6) return 'Saturday';
    if (date.getDay() === 0) return 'Sunday';
    return 'Weekday';
  }

  function historicalRows(analyses = []) {
    const rows = [];
    analyses.forEach((analysis) => {
      (analysis.placementRows || []).forEach((row) => {
        if (!row.known) return;
        rows.push({
          ...row,
          fundraiserId: text(analysis.schedule?.id || analysis.schedule?.title),
          fundraiserTitle: text(analysis.schedule?.title),
          season: canonicalCategory(analysis.schedule?.season || seasonForDate(row.dateKey), 'Unknown'),
          weekpart: weekpartLabel(row.dateKey),
          startBucket: Number.isFinite(Number(row.startMinutes))
            ? Math.floor(((((Number(row.startMinutes) % 1440) + 1440) % 1440) / 30)) * 30
            : null,
          breakType: row.unmatchedImported ? '' : (row.liveBreak ? 'Live break' : 'Pre-recorded break')
        });
      });
    });
    return rows;
  }

  function historicalGroupValue(row, dimension) {
    switch (dimension) {
      case 'topic': return canonicalCategory(row.topic);
      case 'subtopic': return canonicalCategory(row.secondary, 'Unspecified');
      case 'season': return canonicalCategory(row.season, 'Unknown');
      case 'startTime': return Number.isFinite(row.startBucket) ? String(row.startBucket) : '';
      case 'weekpart': return row.weekpart || 'Unknown';
      case 'daypart': return row.daypart || 'Unknown';
      case 'breakType': return row.breakType || '';
      case 'distributor': return text(row.distributor || 'Unknown') || 'Unknown';
      default: return '';
    }
  }

  function historicalRanking(analyses = [], dimension, options = {}) {
    const rows = historicalRows(analyses);
    const groups = new Map();
    rows.forEach((row) => {
      const key = historicalGroupValue(row, dimension);
      if (!key) return;
      const normalized = dimension === 'startTime' ? key : lookupKey(key);
      if (!groups.has(normalized)) {
        groups.set(normalized, {
          key,
          airings: 0,
          rateAirings: 0,
          totalDollars: 0,
          rateDollars: 0,
          rateMinutes: 0,
          rates: [],
          fundraisers: new Set(),
          titles: new Set(),
          rateFundraisers: new Set(),
          rateTitles: new Set()
        });
      }
      const item = groups.get(normalized);
      item.airings += 1;
      item.totalDollars += Number(row.dollars || 0);
      item.fundraisers.add(row.fundraiserId);
      item.titles.add(lookupKey(row.title));
      if (!row.durationMissing && Number(row.minutes) > 0) {
        item.rateAirings += 1;
        item.rateDollars += Number(row.dollars || 0);
        item.rateMinutes += Number(row.minutes || 0);
        item.rates.push(dollarsPerHour(row.dollars, row.minutes));
        item.rateFundraisers.add(row.fundraiserId);
        item.rateTitles.add(lookupKey(row.title));
      }
    });

    const defaultMinimums = dimension === 'startTime'
      ? { minAirings: 5, minFundraisers: 3, minTitles: 3 }
      : { minAirings: 3, minFundraisers: 2, minTitles: 1 };
    const minAirings = Number(options.minAirings ?? defaultMinimums.minAirings);
    const minFundraisers = Number(options.minFundraisers ?? defaultMinimums.minFundraisers);
    const minTitles = Number(options.minTitles ?? defaultMinimums.minTitles);

    return [...groups.values()].map((item) => ({
      key: item.key,
      airings: item.airings,
      rateAirings: item.rateAirings,
      fundraisers: item.rateFundraisers.size,
      titles: item.rateTitles.size,
      broadcastDollars: item.totalDollars,
      medianDollarsPerHour: median(item.rates),
      averageDollarsPerHour: dollarsPerHour(item.rateDollars, item.rateMinutes),
      minutes: item.rateMinutes,
      sufficient: item.rateAirings >= minAirings && item.rateFundraisers.size >= minFundraisers && item.rateTitles.size >= minTitles
    })).filter((item) => item.sufficient)
      .sort((a, b) => b.medianDollarsPerHour - a.medianDollarsPerHour || b.rateAirings - a.rateAirings || String(a.key).localeCompare(String(b.key)));
  }

  function missingDurationPrograms(analyses = []) {
    const groups = new Map();
    analyses.forEach((analysis) => {
      (analysis.placementRows || []).forEach((row) => {
        if (!row.durationMissing) return;
        const title = text(row.title || row.plannedTitle || '');
        if (!title || lookupKey(title) === 'unattributed broadcast result') return;
        const key = lookupKey(title);
        if (!groups.has(key)) groups.set(key, { title, airings: 0, fundraisers: new Set(), dollars: 0 });
        const item = groups.get(key);
        item.airings += 1;
        item.fundraisers.add(text(analysis.schedule?.title || analysis.schedule?.id));
        if (row.known) item.dollars += Number(row.dollars || 0);
      });
    });
    return [...groups.values()].map((item) => ({
      title: item.title,
      airings: item.airings,
      fundraisers: item.fundraisers.size,
      dollars: item.dollars
    })).sort((a, b) => b.dollars - a.dollars || a.title.localeCompare(b.title));
  }

  function isNonSpecificDataLabel(value) {
    const key = lookupKey(value);
    const compact = key.replace(/\s+/g, '');
    return compact === 'nspl'
      || key === 'non specific'
      || key === 'non specific pledge'
      || key === 'non specific pledges'
      || key === 'non specific web pledge'
      || key === 'non specific web pledges';
  }

  function compactIdentityKey(value) {
    return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function preflightCaseCollisions(rows = [], field = '', label = '') {
    const groups = new Map();
    (rows || []).forEach((row) => {
      const raw = text(row?.[field]);
      const key = lookupKey(raw);
      if (!raw || !key) return;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(raw);
    });
    return [...groups.entries()]
      .filter(([_key, values]) => values.size > 1)
      .map(([_key, values]) => `${label}: ${[...values].sort().join(' / ')}`);
  }

  function preflightAmbiguousIdentities(airings = [], library = []) {
    const byTitle = new Map();
    const byNola = new Map();
    (library || []).forEach((row) => {
      const titleKey = lookupKey(row?.title);
      const nola = compactIdentityKey(row?.nola_code);
      if (titleKey) {
        if (!byTitle.has(titleKey)) byTitle.set(titleKey, []);
        byTitle.get(titleKey).push(row);
      }
      if (nola) {
        if (!byNola.has(nola)) byNola.set(nola, []);
        byNola.get(nola).push(row);
      }
    });
    const groups = new Map();
    (airings || []).forEach((row) => {
      const explicitId = text(row?.pledge_program_id || row?.manual_match_program_id || row?.program_id || '');
      if (explicitId) return;
      const title = text(row?.matched_library_title || row?.program_title || row?.title || row?.imported_program_title || '');
      if (!title || isNonSpecificDataLabel(title)) return;
      const titleKey = lookupKey(title);
      const nola = compactIdentityKey(row?.nola_code || row?.nola || row?.program_nola || '');
      const nolaRows = nola ? (byNola.get(nola) || []) : [];
      const titleRows = titleKey ? (byTitle.get(titleKey) || []) : [];
      let candidates = [];
      if (nola && titleKey) {
        candidates = nolaRows.filter((candidate) => lookupKey(candidate?.title) === titleKey);
        if (!candidates.length) candidates = nolaRows;
      } else if (nola) candidates = nolaRows;
      else candidates = titleRows;
      if (candidates.length <= 1) return;
      const key = `${titleKey}|${nola}`;
      if (!groups.has(key)) groups.set(key, { title, nola, rows: 0, candidates: candidates.length, sampleDate: importedDateKey(row) });
      groups.get(key).rows += 1;
    });
    return [...groups.values()]
      .sort((a, b) => b.rows - a.rows || a.title.localeCompare(b.title))
      .map((item) => `${item.title}${item.nola ? ` (${item.nola.toUpperCase()})` : ''}: ${item.rows} imported row${item.rows === 1 ? '' : 's'} could map to ${item.candidates} Library records${item.sampleDate ? `; sample ${item.sampleDate}` : ''}`);
  }

  function preflightClockLabel(minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value)) return 'unknown time';
    const normalized = ((Math.round(value) % 1440) + 1440) % 1440;
    const hour24 = Math.floor(normalized / 60);
    const minute = normalized % 60;
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
  }

  function preflightSavedPlacementDollars(placement = {}) {
    const imported = placement?.importedBroadcastDollars;
    if (imported !== '' && imported != null && Number.isFinite(Number(imported))) return Number(imported);
    if (placement?.manualResultRecorded && Number.isFinite(Number(placement?.manualBroadcastDollars))) return Number(placement.manualBroadcastDollars);
    return null;
  }

  function preflightUnmatchedDiagnostic(row = {}, analysis = {}, indexes = {}) {
    const importedTitle = text(row?.importedSourceTitle || row?.title || 'Unidentified imported result');
    const resolvedTitle = text(row?.title || importedTitle);
    const importedDate = text(row?.dateKey || '');
    const importedStart = Number(row?.startMinutes);
    const importedDollars = Number(row?.dollars || 0) || 0;
    const importedProgramId = text(row?.programId || '');
    const placements = (analysis?.schedule?.placements || [])
      .filter((placement) => !placement?.isNonPledge)
      .map((placement) => {
        const lib = libraryForPlacement(placement, indexes) || {};
        return {
          placement,
          dateKey: text(placement?.dateKey || placement?.date_key || ''),
          startMinutes: placementStartMinutes(placement),
          title: text(lib?.title || placement?.programTitle || placement?.program_title || placement?.title || 'Untitled program'),
          programId: text(lib?.id || placement?.programId || placement?.program_id || ''),
          savedDollars: preflightSavedPlacementDollars(placement)
        };
      });

    const identityMatches = (candidate) => {
      if (!candidate) return false;
      if (importedProgramId && candidate.programId && importedProgramId === candidate.programId) return true;
      const candidateKey = lookupKey(candidate.title);
      return Boolean(candidateKey && [importedTitle, resolvedTitle].some((value) => lookupKey(value) === candidateKey));
    };
    const sameDate = placements.filter((candidate) => importedDate && candidate.dateKey === importedDate);
    const sameDateTime = sameDate.filter((candidate) => Number.isFinite(importedStart) && Number.isFinite(candidate.startMinutes) && candidate.startMinutes === importedStart);
    const sameIdentity = placements.filter(identityMatches);
    const sameDateIdentity = sameDate.filter(identityMatches);
    const sameIdentityTime = sameIdentity.filter((candidate) => Number.isFinite(importedStart) && Number.isFinite(candidate.startMinutes) && candidate.startMinutes === importedStart);

    let candidate = null;
    let ambiguous = false;
    const unique = (rows) => rows.length === 1 ? rows[0] : null;
    candidate = unique(sameDateTime.filter(identityMatches))
      || unique(sameDateTime)
      || unique(sameDateIdentity)
      || unique(sameIdentityTime)
      || unique(sameIdentity)
      || unique(sameDate);
    if (!candidate) {
      ambiguous = sameDateTime.length > 1 || sameDateIdentity.length > 1 || sameIdentity.length > 1 || sameDate.length > 1;
    }

    const mismatchTypes = [];
    const parts = [];
    const addMismatch = (type, message) => {
      if (!mismatchTypes.includes(type)) mismatchTypes.push(type);
      if (message) parts.push(message);
    };

    if (candidate) {
      const rawTitleKey = lookupKey(importedTitle);
      const scheduledTitleKey = lookupKey(candidate.title);
      if (rawTitleKey && scheduledTitleKey && rawTitleKey !== scheduledTitleKey) {
        addMismatch('Title match problem', `Title: imported “${importedTitle}” vs scheduled “${candidate.title}”`);
      }
      if (importedDate && candidate.dateKey && importedDate !== candidate.dateKey) {
        addMismatch('Air date mismatch', `Air date: imported ${importedDate} vs scheduled ${candidate.dateKey}`);
      }
      if (Number.isFinite(importedStart) && Number.isFinite(candidate.startMinutes) && importedStart !== candidate.startMinutes) {
        addMismatch('Air time mismatch', `Air time: imported ${preflightClockLabel(importedStart)} vs scheduled ${preflightClockLabel(candidate.startMinutes)}`);
      }
      if (Number.isFinite(candidate.savedDollars) && Math.abs(candidate.savedDollars - importedDollars) > 0.01) {
        addMismatch('Dollar mismatch', `Dollars: imported $${importedDollars.toFixed(2)} vs saved $${candidate.savedDollars.toFixed(2)}`);
      }
      if (!mismatchTypes.length) {
        addMismatch('No unique scheduled match', 'The imported row resembles a scheduled placement, but it was not the unique row consumed by the current matching rules.');
      }
    } else {
      if (!sameDate.length) addMismatch('Air date mismatch', `Air date: imported ${importedDate || 'unknown'}; no scheduled pledge placement exists on that date.`);
      if (!sameIdentity.length) addMismatch('Title match problem', `Title: imported “${importedTitle}”; no scheduled placement has the same Program Library identity/title.`);
      if (sameDate.length && Number.isFinite(importedStart) && !sameDate.some((candidate) => Number.isFinite(candidate.startMinutes) && candidate.startMinutes === importedStart)) {
        const scheduledTimes = [...new Set(sameDate.map((candidate) => candidate.startMinutes).filter(Number.isFinite).map(preflightClockLabel))];
        addMismatch('Air time mismatch', `Air time: imported ${preflightClockLabel(importedStart)}${scheduledTimes.length ? `; scheduled that day: ${scheduledTimes.join(', ')}` : ''}`);
      }
      if (ambiguous) addMismatch('Ambiguous schedule slot', 'More than one scheduled placement is plausible, so the imported row cannot be assigned confidently.');
      if (!mismatchTypes.length) addMismatch('No unique scheduled match', 'No unique scheduled pledge placement could be identified for this imported result.');
    }

    return {
      title: resolvedTitle || importedTitle,
      programId: importedProgramId,
      mismatchTypes,
      detail: `${analysis?.schedule?.title || 'Fundraiser'} · imported ${importedDate || 'unknown date'}${Number.isFinite(importedStart) ? ` ${preflightClockLabel(importedStart)}` : ''} · $${importedDollars.toFixed(2)} · ${parts.join(' · ')}`,
      imported: {
        title: importedTitle,
        dateKey: importedDate,
        startMinutes: Number.isFinite(importedStart) ? importedStart : null,
        dollars: importedDollars
      },
      scheduled: candidate ? {
        title: candidate.title,
        programId: candidate.programId,
        dateKey: candidate.dateKey,
        startMinutes: Number.isFinite(candidate.startMinutes) ? candidate.startMinutes : null,
        dollars: Number.isFinite(candidate.savedDollars) ? candidate.savedDollars : null
      } : null
    };
  }

  function dataHealthReport(schedules = [], analyses = [], airings = [], library = []) {
    const checks = [];
    const add = (id, label, severity, summary, details = [], countOverride = null) => {
      const count = countOverride === null ? details.length : Number(countOverride || 0);
      checks.push({ id, label, severity, summary, count, details });
    };

    const reconciliation = [];
    (analyses || []).forEach((analysis) => {
      if (!(analysis?.importedRows || []).length) return;
      const imported = (analysis.importedRows || []).reduce((sum, row) => sum + (Number(row?.dollars ?? row?.contribution_amount ?? 0) || 0), 0);
      const represented = (analysis.placementRows || []).reduce((sum, row) => sum + (row?.known ? Number(row?.dollars || 0) : 0), 0);
      const difference = represented - imported;
      if (Math.abs(difference) > 0.01) {
        reconciliation.push({
          title: text(analysis.schedule?.title || 'Fundraiser'),
          programId: '',
          mismatchTypes: ['Dollar mismatch'],
          detail: `Imported Broadcast $${imported.toFixed(2)} vs analyzed $${represented.toFixed(2)} · difference $${difference.toFixed(2)}`
        });
      }
    });
    add('broadcast-reconciliation', 'Broadcast reconciliation', 'fail', reconciliation.length ? 'Imported Broadcast totals do not fully reconcile to the analyzed result rows.' : 'Imported Broadcast totals reconcile to the analyzed result rows.', reconciliation);

    const missingDurations = [];
    (analyses || []).forEach((analysis) => {
      (analysis?.missingDurationRows || []).forEach((row) => {
        if ([row?.title, row?.plannedTitle, row?.topic].some(isNonSpecificDataLabel)) return;
        missingDurations.push({
          title: text(row?.title || row?.plannedTitle || 'Untitled program'),
          programId: text(row?.programId || ''),
          detail: `${analysis.schedule?.title || 'Fundraiser'} · ${row?.dateKey || 'unknown date'}`
        });
      });
    });
    add('missing-duration', 'Missing program durations', 'fail', missingDurations.length ? 'Programs without a saved schedule length or reliable Program Library runtime are excluded from $/hour analytics.' : 'Every scheduled program used by the reports has a usable duration.', missingDurations);

    const unmatchedPrograms = [];
    const healthIndexes = buildLibraryIndexes(library);
    let nonSpecificRows = 0;
    let nonSpecificDollars = 0;
    (analyses || []).forEach((analysis) => {
      (analysis?.unmatchedImportedRows || []).forEach((row) => {
        if ([row?.title, row?.plannedTitle, row?.topic].some(isNonSpecificDataLabel)) {
          nonSpecificRows += 1;
          nonSpecificDollars += Number(row?.dollars || 0);
          return;
        }
        unmatchedPrograms.push(preflightUnmatchedDiagnostic(row, analysis, healthIndexes));
      });
    });
    add('unmatched-imported', 'Unmatched imported program results', 'fail', unmatchedPrograms.length ? 'Imported program results remain that cannot be assigned confidently to a scheduled program/topic.' : 'All imported program-specific results are attributable; Non-Specific Pledges are intentionally excluded from this check.', unmatchedPrograms);

    const duplicateRanges = (schedules || [])
      .filter((schedule) => Number(schedule?.duplicateRangeCount || 1) > 1)
      .map((schedule) => `${schedule.title || 'Fundraiser'} · ${schedule.startDate || '?'}–${schedule.endDate || '?'} · ${schedule.duplicateRangeCount} records share this date range`);
    add('duplicate-ranges', 'Duplicate fundraiser date ranges', 'fail', duplicateRanges.length ? 'Multiple saved fundraiser records share an identical date range; analytics keeps the preferred record and suppresses the others.' : 'No duplicate fundraiser date ranges were detected.', duplicateRanges);

    const airingHashes = new Set((airings || []).map((row) => text(row?.row_hash)).filter(Boolean));
    const staleHashes = [];
    (schedules || []).forEach((schedule) => {
      (schedule?.placements || []).forEach((placement) => {
        const hash = text(placement?.sourceAiringHash || placement?.source_airing_hash || '');
        if (!hash || airingHashes.has(hash)) return;
        staleHashes.push({
          title: text(placement?.programTitle || placement?.program_title || placement?.title || 'Untitled program'),
          programId: text(placement?.programId || placement?.program_id || ''),
          detail: `${schedule.title || 'Fundraiser'} · ${text(placement?.dateKey || placement?.date_key || '?')}`
        });
      });
    });
    add('stale-hashes', 'Stale imported-airing links', 'warn', staleHashes.length ? 'Saved placements reference imported row hashes that are no longer present. Current reports can often rematch by date/time/identity, but these links should be reviewed.' : 'No saved imported-airing hashes point to missing rows.', staleHashes);

    const ambiguousIdentities = preflightAmbiguousIdentities(airings, library);
    add('ambiguous-identities', 'Potential ambiguous imported identities', 'warn', ambiguousIdentities.length ? 'Some imported rows without an explicit Program Library ID have more than one plausible Library record.' : 'No multi-candidate imported identities were detected among rows lacking an explicit Library ID.', ambiguousIdentities);

    const topicCollisions = [
      ...preflightCaseCollisions(library, 'topic_primary', 'Primary topic'),
      ...preflightCaseCollisions(library, 'topic_secondary', 'Secondary topic')
    ];
    add('topic-case', 'Topic/subtopic case collisions', 'warn', topicCollisions.length ? 'Stored topic labels differ only by capitalization. Analytics combines them case-insensitively, but the source taxonomy should be cleaned.' : 'No topic or subtopic capitalization collisions were detected.', topicCollisions);

    const channelTracking = [];
    (schedules || []).forEach((schedule) => {
      if (!schedule?.onlineTrackedExplicit && Number(schedule?.onlineDollars || 0) === 0) channelTracking.push(`${schedule.title || 'Fundraiser'}: Online tracking is not explicitly recorded; $0 cannot distinguish tracked-zero from not tracked.`);
      if (!schedule?.mailTrackedExplicit && Number(schedule?.mailDollars || 0) === 0) channelTracking.push(`${schedule.title || 'Fundraiser'}: Mail tracking is not explicitly recorded; $0 cannot distinguish tracked-zero from not tracked.`);
    });
    add('channel-tracking', 'Online/Mail tracking state', 'warn', channelTracking.length ? 'Some historical fundraiser records rely on inferred channel tracking state.' : 'Online and Mail tracking state is explicitly recorded for all saved fundraisers.', channelTracking);

    const splitForWeekpart = (weekpart) => (analyses || []).map((analysis) => ({
      ...analysis,
      placementRows: (analysis?.placementRows || []).filter((row) => {
        const date = parseDate(row?.dateKey);
        if (!date) return false;
        if (weekpart === 'Saturday') return date.getDay() === 6;
        if (weekpart === 'Sunday') return date.getDay() === 0;
        return date.getDay() >= 1 && date.getDay() <= 5;
      })
    }));
    const coverage = ['Weekday', 'Saturday', 'Sunday'].map((weekpart) => ({
      weekpart,
      slots: historicalRanking(splitForWeekpart(weekpart), 'startTime').length
    }));
    add('start-time-coverage', 'Historical start-time sample coverage', 'info', 'Qualifying 30-minute start slots use the same 5-airing / 3-fundraiser / 3-title evidence rule as Historical Analytics.', coverage.map((item) => `${item.weekpart}: ${item.slots} qualifying start slot${item.slots === 1 ? '' : 's'}`), coverage.reduce((sum, item) => sum + item.slots, 0));

    add('non-specific', 'Non-Specific Pledges', 'info', 'Non-Specific Pledges are a legitimate giving category, not an attribution error; they have no program airtime or $/hour.', [`${nonSpecificRows} imported row${nonSpecificRows === 1 ? '' : 's'} · $${nonSpecificDollars.toFixed(2)} Broadcast`], nonSpecificRows);

    const failures = checks.filter((check) => check.severity === 'fail' && check.count > 0).length;
    const warnings = checks.filter((check) => check.severity === 'warn' && check.count > 0).length;
    return {
      status: failures ? 'review' : 'pass',
      failures,
      warnings,
      checks,
      metrics: {
        fundraisers: (analyses || []).length,
        importedRows: (analyses || []).reduce((sum, analysis) => sum + Number(analysis?.importedRows?.length || 0), 0),
        libraryPrograms: (library || []).length,
        scheduledAirings: (analyses || []).reduce((sum, analysis) => sum + Number(analysis?.scheduled || 0), 0)
      }
    };
  }

  return {
    SEASONS,
    text,
    lookupKey,
    canonicalCategory,
    parseDate,
    dateKey,
    seasonForDate,
    normalizeSchedule,
    prepareSchedules,
    buildLibraryIndexes,
    canonicalizeImportedAirings,
    libraryRuntimeMinutes,
    placementDuration,
    placementResult,
    analyzeSchedule,
    dollarsPerHour,
    pledgesPerHour,
    dollarsPerPledge,
    median,
    calendarDays,
    firstSaturdayAnchor,
    firstSaturdaySeasonalOffsets,
    fundraiserDayOffset,
    fundraiserDayLabel,
    alignedDailyRows,
    comparisonChannelPolicy,
    comparableTotal,
    topicComparisonRows,
    startTimePledgeBuckets,
    pledgeWeatherWindowForDate,
    programResultsRows,
    historicalRows,
    historicalRanking,
    missingDurationPrograms,
    dataHealthReport
  };
});

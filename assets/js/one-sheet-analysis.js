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
    const goalDollars = Number(data.goalDollars ?? row.goal_dollars ?? row.goalDollars ?? 0) || 0;
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
      goalDollars,
      onlineTracked: Boolean(data.onlineTracked ?? meta.onlineTracked ?? onlineDollars > 0),
      mailTracked: Boolean(data.mailTracked ?? meta.mailTracked ?? mailDollars > 0),
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
      if (!ranked[0]) return;
      prepared.push({ ...ranked[0], duplicateRangeCount: ranked.length });
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

  function importedDateKey(row = {}) {
    const direct = text(row.air_date || row.drive_date);
    if (direct) return direct.slice(0, 10);
    return dateKey(parseDate(row.aired_at));
  }

  function importedStartMinutes(row = {}) {
    const raw = text(row.air_time || '');
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (Number.isFinite(hours) && Number.isFinite(minutes)) return (hours * 60) + minutes;
    }
    const date = new Date(row.aired_at || '');
    return Number.isNaN(date.getTime()) ? null : (date.getHours() * 60) + date.getMinutes();
  }

  function importedTitle(row = {}) {
    return text(row.matched_library_title || row.program_title || row.title || row.imported_program_title || '');
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
      const exactDrive = rows.filter((row) =>
        text(row.drive_start_date).slice(0, 10) === start
        && text(row.drive_end_date).slice(0, 10) === end
      );
      if (exactDrive.length) return exactDrive;
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

  function placementProgramMinutes(placement = {}) {
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
    const date = text(placement.dateKey || placement.date_key || '');
    if (importedDateHasResults(date, importedRows)) {
      return { known: true, dollars: 0, pledges: 0, source: 'report-day-zero', implicitZero: true };
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
    const value = Number(minutes);
    if (!Number.isFinite(value)) return 'Unknown';
    const normalized = ((value % 1440) + 1440) % 1440;
    if (normalized >= 420 && normalized < 720) return 'Morning';
    if (normalized >= 720 && normalized < 1020) return 'Afternoon';
    if (normalized >= 1020 && normalized < 1200) return 'Early evening';
    if (normalized >= 1200 && normalized < 1350) return 'Prime';
    return 'Overnight';
  }

  function addGroup(map, key, minutes, result) {
    const wanted = text(key) || 'Uncategorized';
    if (!map.has(wanted)) {
      map.set(wanted, { key: wanted, minutes: 0, scheduled: 0, completed: 0, dollars: 0, pledges: 0, results: [] });
    }
    const item = map.get(wanted);
    item.minutes += Number(minutes || 0);
    item.scheduled += 1;
    if (result.known) {
      item.completed += 1;
      item.dollars += Number(result.dollars || 0);
      item.pledges += Number(result.pledges || 0);
      item.results.push(Number(result.dollars || 0));
    }
  }

  function normalizeUnmatchedImportedRow(row = {}, indexes = {}) {
    const lib = libraryForImportedRow(row, indexes) || {};
    const rawMinutes = Number(row.program_minutes ?? row.runtime_minutes ?? row.duration_minutes);
    const minutes = Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : 0;
    const startMinutes = importedStartMinutes(row);
    const title = importedTitle(row) || 'Unattributed Broadcast result';
    return {
      dateKey: importedDateKey(row),
      startMinutes,
      endMinutes: Number.isFinite(startMinutes) && minutes > 0 ? startMinutes + minutes : null,
      title,
      plannedTitle: '',
      topic: text(lib.topic_primary || row.topic_primary || row.topic || 'Unattributed') || 'Unattributed',
      secondary: text(lib.topic_secondary || row.topic_secondary || row.secondary_topic || 'Unspecified') || 'Unspecified',
      daypart: daypartLabel(startMinutes),
      minutes,
      known: true,
      dollars: Number(row.dollars ?? row.contribution_amount ?? 0) || 0,
      pledges: Number(row.pledge_count || row.pledges || 0) || 0,
      source: 'report-unmatched',
      unmatchedImported: true,
      rowHash: text(row.row_hash || '')
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

    (schedule.placements || []).forEach((placement) => {
      if (!placement || placement.isNonPledge) return;
      const scheduledTitle = text(placement.programTitle || placement.program_title || placement.title || '');
      if (!scheduledTitle && !placement.programId && !placement.program_id) return;
      const scheduledLib = libraryForPlacement(placement, indexes) || {};
      const result = placementResult(placement, used, importedRows, indexes);
      const importedLib = result.importedRow ? libraryForImportedRow(result.importedRow, indexes) || {} : {};
      const lib = Object.keys(importedLib).length ? importedLib : scheduledLib;

      // Pledge-hour denominators always come from the saved fundraiser schedule.
      // Imported rows establish what aired and what it raised, but runtime coverage in
      // historical reports is not allowed to change the denominator from year to year.
      const minutes = placementProgramMinutes(placement);
      const scheduledStart = placementStartMinutes(placement);
      const startMinutes = Number.isFinite(result.actualStartMinutes) ? result.actualStartMinutes : scheduledStart;
      const resultDate = text(result.actualDateKey || placement.dateKey || placement.date_key || '');
      const displayTitle = result.source === 'report'
        ? text(result.actualTitle || lib.title || scheduledTitle || 'Untitled program')
        : text(scheduledTitle || lib.title || 'Untitled program');
      const topic = text(lib.topic_primary || result.importedRow?.topic_primary || result.importedRow?.topic || placement.topicPrimary || placement.topic_primary || 'Uncategorized') || 'Uncategorized';
      const secondary = text(lib.topic_secondary || result.importedRow?.topic_secondary || result.importedRow?.secondary_topic || placement.topicSecondary || placement.topic_secondary || 'Unspecified') || 'Unspecified';

      scheduled += 1;
      scheduledMinutes += minutes;
      if (result.known) {
        completed += 1;
        attributableDollars += Number(result.dollars || 0);
        attributablePledges += Number(result.pledges || 0);
      }
      addGroup(topics, topic, minutes, result);
      const timeKey = Number.isFinite(startMinutes) ? Math.floor(startMinutes / 30) * 30 : null;
      addGroup(times, Number.isFinite(timeKey) ? String(timeKey) : 'Unknown', minutes, result);
      placementRows.push({
        dateKey: resultDate,
        startMinutes,
        endMinutes: Number.isFinite(startMinutes) ? startMinutes + minutes : null,
        title: displayTitle,
        plannedTitle: scheduledTitle,
        topic,
        secondary,
        daypart: daypartLabel(startMinutes),
        minutes,
        known: Boolean(result.known),
        dollars: Number(result.dollars || 0),
        pledges: Number(result.pledges || 0),
        source: result.source || 'none'
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
    unmatchedImportedRows.sort((a, b) => text(a.dateKey).localeCompare(text(b.dateKey)) || Number(a.startMinutes || 0) - Number(b.startMinutes || 0));

    const meta = schedule.meta || {};
    const reportedBroadcast = Number(meta.reportedBroadcastTotalDollars ?? meta.importedBroadcastTotalDollars ?? meta.importedProgramSpecificBroadcastTotalDollars);
    const importedBroadcast = importedRows.reduce((sum, row) => sum + (Number(row.dollars ?? row.contribution_amount ?? 0) || 0), 0);
    const importedPledges = importedRows.reduce((sum, row) => sum + (Number(row.pledge_count || row.pledges || 0) || 0), 0);
    const broadcastDollars = importedRows.length ? importedBroadcast : (Number.isFinite(reportedBroadcast) ? reportedBroadcast : attributableDollars);
    const pledges = importedRows.length ? importedPledges : attributablePledges;
    const onlineDollars = Number(schedule.onlineDollars || 0) || 0;
    const mailDollars = Number(schedule.mailDollars || 0) || 0;

    return {
      schedule,
      scheduled,
      completed,
      scheduledMinutes,
      attributableDollars,
      attributablePledges,
      broadcastDollars,
      pledges,
      unattributedBroadcast: broadcastDollars - attributableDollars,
      onlineDollars,
      mailDollars,
      onlineTracked: Boolean(schedule.onlineTracked),
      mailTracked: Boolean(schedule.mailTracked),
      recordedTotal: broadcastDollars + onlineDollars + mailDollars,
      topics,
      times,
      placementRows,
      importedRows,
      unmatchedImportedRows
    };
  }

  function dollarsPerHour(dollars, minutes) {
    const hours = Number(minutes || 0) / 60;
    return hours > 0 ? Number(dollars || 0) / hours : 0;
  }

  function pledgesPerHour(pledges, minutes) {
    const hours = Number(minutes || 0) / 60;
    return hours > 0 ? Number(pledges || 0) / hours : 0;
  }

  function dollarsPerPledge(dollars, pledges) {
    const count = Number(pledges || 0);
    return count > 0 ? Number(dollars || 0) / count : 0;
  }

  function calendarDays(analysis = {}) {
    const buckets = new Map();
    (analysis.placementRows || []).forEach((row) => {
      const key = text(row.dateKey);
      if (!key) return;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    });
    return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rows]) => {
      const date = parseDate(key);
      const scheduledRows = rows.filter((row) => !row.unmatchedImported);
      const minutes = scheduledRows.reduce((sum, row) => sum + Number(row.minutes || 0), 0);
      const dollars = rows.reduce((sum, row) => sum + (row.known ? Number(row.dollars || 0) : 0), 0);
      const pledges = rows.reduce((sum, row) => sum + (row.known ? Number(row.pledges || 0) : 0), 0);
      const starts = scheduledRows.map((row) => Number(row.startMinutes)).filter(Number.isFinite);
      const ends = scheduledRows.map((row) => Number(row.endMinutes)).filter(Number.isFinite);
      const startMinutes = starts.length ? Math.min(...starts) : null;
      const endMinutes = ends.length ? Math.max(...ends) : null;
      return {
        dateKey: key,
        date,
        weekday: date ? date.toLocaleDateString(undefined, { weekday: 'long' }) : 'Unknown day',
        minutes,
        dollars,
        pledges,
        startMinutes,
        endMinutes,
        dollarsPerHour: dollarsPerHour(dollars, minutes),
        pledgesPerHour: pledgesPerHour(pledges, minutes),
        rows: [...rows].sort((a, b) => Number(a.startMinutes || 0) - Number(b.startMinutes || 0))
      };
    });
  }

  function firstSaturdayAnchor(analysis = {}) {
    const importedDays = (analysis.importedRows || []).map((row) => parseDate(importedDateKey(row))).filter((date) => date instanceof Date && !Number.isNaN(date.getTime())).sort((a, b) => a - b);
    const placementDays = calendarDays(analysis).map((day) => day.date).filter((date) => date instanceof Date && !Number.isNaN(date.getTime())).sort((a, b) => a - b);
    const observed = importedDays.length ? importedDays : placementDays;
    const saturday = observed.find((date) => date.getDay() === 6);
    if (saturday) return new Date(saturday.getFullYear(), saturday.getMonth(), saturday.getDate());
    const start = observed[0] || parseDate(analysis.schedule?.startDate);
    if (!start) return null;
    const anchor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const weekday = anchor.getDay();
    const daysToSaturday = weekday === 0 ? -1 : (6 - weekday + 7) % 7;
    anchor.setDate(anchor.getDate() + daysToSaturday);
    return anchor;
  }

  function localDateSerial(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  }

  function fundraiserDayOffset(analysis = {}, day = {}) {
    const anchorSerial = localDateSerial(firstSaturdayAnchor(analysis));
    const daySerial = localDateSerial(day.date || parseDate(day.dateKey));
    if (!Number.isFinite(anchorSerial) || !Number.isFinite(daySerial)) return null;
    return Math.round(daySerial - anchorSerial);
  }

  function ordinal(value) {
    const n = Math.abs(Number(value || 0));
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    if (n % 10 === 1) return `${n}st`;
    if (n % 10 === 2) return `${n}nd`;
    if (n % 10 === 3) return `${n}rd`;
    return `${n}th`;
  }

  function fundraiserDayLabel(offset) {
    const value = Number(offset);
    if (value === -1) return { title: 'Friday', detail: 'Day -1' };
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekdayIndex = ((6 + value) % 7 + 7) % 7;
    const weekday = weekdays[weekdayIndex];
    if (value >= 0) return { title: `${ordinal(Math.floor(value / 7) + 1)} ${weekday}`, detail: `Day ${value}` };
    return { title: weekday, detail: `Day ${value}` };
  }

  function alignedDailyRows(analyses = []) {
    const maps = analyses.map((analysis) => {
      const map = new Map();
      calendarDays(analysis).forEach((day) => {
        const offset = fundraiserDayOffset(analysis, day);
        if (Number.isFinite(offset) && offset >= -1) map.set(offset, day);
      });
      return map;
    });
    const offsets = [...new Set(maps.flatMap((map) => [...map.keys()]))]
      .filter((offset) => offset >= -1 && maps.filter((map) => map.has(offset)).length >= Math.min(2, maps.length))
      .sort((a, b) => a - b);
    return offsets.map((offset) => ({ offset, label: fundraiserDayLabel(offset), days: maps.map((map) => map.get(offset) || null) }));
  }

  function seasonalOrdinal(value) {
    const date = value instanceof Date ? value : parseDate(value);
    if (!date) return null;
    const reference = Date.UTC(2001, date.getMonth(), date.getDate());
    return Math.round((reference - Date.UTC(2001, 0, 1)) / 86400000) + 1;
  }

  function firstSaturdaySeasonalOffsets(analyses = []) {
    const anchors = analyses.map((analysis) => firstSaturdayAnchor(analysis));
    const ordinals = anchors.map(seasonalOrdinal);
    const finite = ordinals.filter(Number.isFinite);
    const baseline = finite.length ? Math.min(...finite) : null;
    return analyses.map((analysis, index) => ({
      analysis,
      date: anchors[index],
      ordinal: ordinals[index],
      daysFromEarliest: Number.isFinite(ordinals[index]) && Number.isFinite(baseline) ? ordinals[index] - baseline : null
    }));
  }

  function comparisonChannelPolicy(analyses = []) {
    const list = analyses || [];
    return {
      includeOnline: list.length > 0 && list.every((analysis) => analysis.onlineTracked),
      includeMail: list.length > 0 && list.every((analysis) => analysis.mailTracked)
    };
  }

  function comparableTotal(analysis = {}, policy = {}) {
    return Number(analysis.broadcastDollars || 0)
      + (policy.includeOnline ? Number(analysis.onlineDollars || 0) : 0)
      + (policy.includeMail ? Number(analysis.mailDollars || 0) : 0);
  }

  function topicComparisonRows(analyses = []) {
    const keys = new Set();
    analyses.forEach((analysis) => (analysis.topics || new Map()).forEach((_value, key) => keys.add(key)));
    return [...keys].map((key) => {
      const values = analyses.map((analysis) => {
        const item = analysis.topics?.get(key) || { key, minutes: 0, scheduled: 0, completed: 0, dollars: 0, pledges: 0 };
        const totalMinutes = Number(analysis.scheduledMinutes || 0);
        return {
          ...item,
          share: totalMinutes > 0 ? Number(item.minutes || 0) / totalMinutes : 0,
          dollarsPerHour: dollarsPerHour(item.dollars, item.minutes),
          pledgesPerHour: pledgesPerHour(item.pledges, item.minutes),
          dollarsPerPledge: dollarsPerPledge(item.dollars, item.pledges)
        };
      });
      return {
        key,
        values,
        totalMinutes: values.reduce((sum, value) => sum + Number(value.minutes || 0), 0),
        totalDollars: values.reduce((sum, value) => sum + Number(value.dollars || 0), 0)
      };
    }).sort((a, b) => b.totalMinutes - a.totalMinutes || b.totalDollars - a.totalDollars || a.key.localeCompare(b.key));
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
    if (day && Number.isFinite(Number(day.startMinutes)) && Number.isFinite(Number(day.endMinutes))) {
      const startHour = Math.max(0, Math.min(23, Math.floor(Number(day.startMinutes) / 60)));
      const endHourExclusive = Math.max(startHour + 1, Math.min(24, Math.ceil(Number(day.endMinutes) / 60)));
      return { startHour, endHourExclusive, label: 'fundraising hours' };
    }
    const date = dateValue instanceof Date ? dateValue : parseDate(dateValue);
    const weekend = Boolean(date && (date.getDay() === 0 || date.getDay() === 6));
    return { startHour: weekend ? 15 : 17, endHourExclusive: 24, label: weekend ? '3 PM-midnight' : '5 PM-midnight' };
  }

  return {
    SEASONS,
    text,
    lookupKey,
    nolaKey,
    parseDate,
    dateKey,
    seasonForDate,
    normalizeSchedule,
    schedulePreferenceScore,
    prepareSchedules,
    buildLibraryIndexes,
    importedDateKey,
    importedStartMinutes,
    importedRowsForSchedule,
    placementStartMinutes,
    placementProgramMinutes,
    placementResult,
    analyzeSchedule,
    dollarsPerHour,
    pledgesPerHour,
    dollarsPerPledge,
    calendarDays,
    firstSaturdayAnchor,
    fundraiserDayOffset,
    fundraiserDayLabel,
    alignedDailyRows,
    seasonalOrdinal,
    firstSaturdaySeasonalOffsets,
    comparisonChannelPolicy,
    comparableTotal,
    topicComparisonRows,
    startTimePledgeBuckets,
    pledgeWeatherWindowForDate
  };
});

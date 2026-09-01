(() => {
  const App = window.PledgeLib;
  if (!App) return;

  const SEASONS = ['March', 'June', 'August', 'December'];
  const CERTIFIED_SUBTOPIC_TOPICS = new Set(['music']);
  const WEATHER_LOCATIONS = [
    { name: 'Ironwood', latitude: 46.4547, longitude: -90.1710 },
    { name: 'Houghton', latitude: 47.1211, longitude: -88.5690 },
    { name: 'Marquette', latitude: 46.5436, longitude: -87.3954 },
    { name: 'Escanaba', latitude: 45.7452, longitude: -87.0646 },
    { name: 'Sault Ste. Marie', latitude: 46.4953, longitude: -84.3453 }
  ];

  const state = {
    ready: false,
    loading: false,
    schedules: [],
    airings: [],
    season: 'all',
    selectedIds: new Set(),
    compareAId: '',
    compareBId: '',
    selectedTopic: '',
    libraryById: new Map(),
    libraryByTitle: new Map(),
    libraryByNola: new Map(),
    analysisCache: new Map(),
    weatherByDate: new Map(),
    weatherRequested: new Set(),
    weatherLoading: false,
    weatherError: ''
  };

  const text = (value) => String(value ?? '').trim();
  const lookupKey = (value) => text(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const nolaKey = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const canonicalCategory = (value, fallback = '') => {
    const raw = text(value);
    if (!raw) return fallback;
    return raw.split(/([\s\-/&]+)/).map((part) => {
      if (!/^[A-Za-z]+$/.test(part)) return part;
      if (/^[A-Z]{2,4}$/.test(part)) return part;
      return `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`;
    }).join('');
  };
  const money = (value) => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const number = (value) => Number(value || 0).toLocaleString();
  const signedMoney = (value) => `${Number(value || 0) > 0 ? '+' : ''}${money(value)}`;

  function root() { return document.getElementById('fundraiser-comparison-root'); }
  function client() { return App.state?.client || App.data?.createClient?.() || null; }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function formatDateRange(schedule = {}) {
    const start = parseDate(schedule.startDate);
    const end = parseDate(schedule.endDate);
    const format = (date) => date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    if (!start && !end) return 'No date range';
    if (start && end && schedule.startDate === schedule.endDate) return format(start);
    return `${format(start)} – ${format(end)}`;
  }

  function normalizeSchedule(row = {}) {
    const data = row.schedule_data && typeof row.schedule_data === 'object' ? row.schedule_data : {};
    const startDate = text(row.start_date || data.startDate);
    const start = parseDate(startDate);
    return {
      id: text(row.id || data.id),
      title: text(row.title || data.title || 'Untitled fundraiser'),
      startDate,
      endDate: text(row.end_date || data.endDate),
      createdAt: text(row.created_at || data.createdAt),
      updatedAt: text(row.updated_at || data.updatedAt),
      placements: Array.isArray(data.placements) ? data.placements : [],
      onlineDollars: Number(data.onlineDollars ?? row.online_dollars ?? row.onlineDollars ?? 0) || 0,
      mailDollars: Number(data.mailDollars ?? row.mail_dollars ?? row.mailDollars ?? 0) || 0,
      meta: data.meta && typeof data.meta === 'object' ? data.meta : {},
      season: seasonForDate(startDate),
      year: start?.getFullYear() || ''
    };
  }

  function schedulePreferenceScore(schedule = {}) {
    let score = 0;
    if (schedule.onlineDollars || schedule.mailDollars) score += 100000;
    if ((schedule.placements || []).some((placement) => !placement?.importedFromReport)) score += 50000;
    if ((schedule.placements || []).length) score += Math.min(10000, schedule.placements.length * 10);
    const updated = Date.parse(schedule.updatedAt || schedule.createdAt || '');
    if (Number.isFinite(updated)) score += Math.floor(updated / 1000000000);
    return score;
  }

  function prepareSchedules(schedules = []) {
    const buckets = new Map();
    schedules.forEach((schedule) => {
      const key = schedule.startDate && schedule.endDate ? `${schedule.startDate}|${schedule.endDate}` : `id:${schedule.id}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(schedule);
    });
    const prepared = [];
    buckets.forEach((items) => {
      const ranked = [...items].sort((a, b) => schedulePreferenceScore(b) - schedulePreferenceScore(a));
      ranked.forEach((schedule, index) => prepared.push({
        ...schedule,
        duplicateRangeCount: ranked.length,
        duplicateRangeIndex: index + 1
      }));
    });
    return prepared
      .filter(Boolean)
      .sort((a, b) => text(b.startDate).localeCompare(text(a.startDate)) || text(b.title).localeCompare(text(a.title)) || text(b.updatedAt).localeCompare(text(a.updatedAt)));
  }

  async function fetchAll(table, select, orderField = '') {
    const c = client();
    if (!c) throw new Error('No data connection is available.');
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let query = c.from(table).select(select).range(from, from + pageSize - 1);
      if (orderField) query = query.order(orderField, { ascending: true });
      const { data, error } = await query;
      if (error) throw error;
      const chunk = Array.isArray(data) ? data : [];
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
    }
    return rows;
  }

  function buildLibraryIndexes(rows = []) {
    state.libraryById.clear();
    state.libraryByTitle.clear();
    state.libraryByNola.clear();
    rows.forEach((row) => {
      const id = text(row?.id || App.derive?.programId?.(row));
      const title = text(row?.title || App.derive?.title?.(row));
      const nola = text(row?.nola_code || App.derive?.nola?.(row));
      if (id) state.libraryById.set(id, row);
      if (title) state.libraryByTitle.set(lookupKey(title), row);
      if (nola) {
        const key = nolaKey(nola);
        if (!state.libraryByNola.has(key)) state.libraryByNola.set(key, []);
        state.libraryByNola.get(key).push(row);
      }
    });
  }

  function libraryRowForPlacement(placement = {}) {
    const id = text(placement.programId || placement.program_id || '');
    if (id && state.libraryById.has(id)) return state.libraryById.get(id);
    const title = lookupKey(placement.programTitle || placement.program_title || placement.title || '');
    const nola = nolaKey(placement.nolaCode || placement.nola_code || placement.nola || '');
    if (nola) {
      const matches = state.libraryByNola.get(nola) || [];
      if (title) {
        const exact = matches.find((row) => lookupKey(row.title) === title);
        if (exact) return exact;
      }
      if (matches.length === 1) return matches[0];
    }
    return title ? state.libraryByTitle.get(title) || null : null;
  }

  function importedDateKey(row = {}) {
    return text(row.air_date || row.drive_date || App.utils?.dateKeyFromDate?.(row.aired_at) || '');
  }

  function importedStartMinutes(row = {}) {
  const raw = text(row.air_time || '');
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (match) return (Number(match[1]) * 60) + Number(match[2]);
  const date = new Date(row.aired_at || '');
  return Number.isNaN(date.getTime()) ? null : (date.getHours() * 60) + date.getMinutes();
}

function importedTitle(row = {}) {
  return text(row.imported_program_title || row.program_title || row.title || row.matched_library_title || '');
}

function libraryRowForImportedRow(row = {}) {
  const id = text(row.pledge_program_id || row.manual_match_program_id || row.program_id || '');
  if (id && state.libraryById.has(id)) return state.libraryById.get(id);
  const nola = nolaKey(row.nola_code || row.nola || row.program_nola || '');
  const title = lookupKey(row.matched_library_title || row.program_title || row.title || row.imported_program_title || '');
  if (nola) {
    const matches = state.libraryByNola.get(nola) || [];
    if (title) {
      const exact = matches.find((candidate) => lookupKey(candidate.title) === title);
      if (exact) return exact;
    }
    if (matches.length === 1) return matches[0];
  }
  return title ? state.libraryByTitle.get(title) || null : null;
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
  const titleYearMatch = title.match(/\\b(20\\d{2})\\b/);
  if (titleSeason && titleYearMatch) return { season: titleSeason, year: Number(titleYearMatch[1]) };
  const start = parseDate(schedule.startDate || schedule.start_date || '');
  return {
    season: text(schedule.season || seasonForDate(start)),
    year: Number(schedule.year || start?.getFullYear() || 0)
  };
}

function importedRowsForSchedule(schedule = {}) {
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

function importedUseKey(row = {}) {
  return text(row.row_hash || row.id || `${importedDateKey(row)}|${importedStartMinutes(row) ?? ''}|${importedTitle(row)}|${row.dollars ?? row.contribution_amount ?? ''}`);
}

function importedDateHasResults(dateKey = '', importedRows = []) {
  const wanted = text(dateKey);
  return Boolean(wanted && (importedRows || []).some((row) => importedDateKey(row) === wanted));
}

function placementStartMinutes(placement = {}) {
  const value = Number(placement.startMinutes ?? placement.start_minutes ?? placement.start);
  return Number.isFinite(value) ? value : null;
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

function importedRowForPlacement(placement = {}, used = new Set(), importedRows = state.airings || []) {
  const available = (importedRows || []).filter((row) => !used.has(importedUseKey(row)));
  const hash = text(placement.sourceAiringHash || placement.source_airing_hash || '');
  if (hash) {
    const direct = available.find((row) => text(row.row_hash) === hash);
    if (direct) return direct;
  }

  const dateKey = text(placement.dateKey || placement.date_key || '');
  if (!dateKey) return null;
  const start = placementStartMinutes(placement);
  const lib = libraryRowForPlacement(placement);
  const sameDay = available.filter((row) => importedDateKey(row) === dateKey);
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

function placementResult(placement = {}, used = new Set(), importedRows = state.airings || []) {
  if (placement?.isNonPledge) return { known: false, dollars: 0, pledges: 0, source: 'non-pledge' };

  const imported = importedRowForPlacement(placement, used, importedRows);
  if (imported) {
    const usedKey = importedUseKey(imported);
    if (usedKey) used.add(usedKey);
    return {
      known: true,
      dollars: Number(imported.dollars ?? imported.contribution_amount ?? 0) || 0,
      pledges: Number(imported.pledge_count || 0) || 0,
      source: 'report',
      importedRow: imported,
      actualDateKey: importedDateKey(imported),
      actualStartMinutes: importedStartMinutes(imported),
      actualTitle: importedTitle(imported)
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
  function libraryRuntimeMinutes(row = {}) {
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

  function timeLabel(minutes) {
    if (!Number.isFinite(Number(minutes))) return 'Unknown time';
    const total = ((Math.floor(Number(minutes)) % 1440) + 1440) % 1440;
    const hour24 = Math.floor(total / 60);
    const minute = total % 60;
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    return `${hour24 % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
  }

  function timeBucketLabel(minutes) {
    if (!Number.isFinite(Number(minutes))) return 'Unknown time';
    return timeLabel(Math.floor(Number(minutes) / 30) * 30);
  }

  function timeSortValue(label = '') {
    const match = text(label).match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/);
    if (!match) return 99999;
    let hour = Number(match[1]) % 12;
    if (match[3] === 'PM') hour += 12;
    return (hour * 60) + Number(match[2]);
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

  function addGroup(map, key, minutes, result, durationMissing = false) {
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

  function analyzeSchedule(schedule = {}) {
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
  function analysisForSchedule(schedule = {}) {
    const id = text(schedule.id);
    if (id && state.analysisCache.has(id)) return state.analysisCache.get(id);
    const analysis = analyzeSchedule(schedule);
    if (id) state.analysisCache.set(id, analysis);
    return analysis;
  }

  function mapSimilarity(a = new Map(), b = new Map()) {
    const totalA = [...a.values()].reduce((sum, row) => sum + Number(row.minutes || 0), 0);
    const totalB = [...b.values()].reduce((sum, row) => sum + Number(row.minutes || 0), 0);
    if (!(totalA > 0) || !(totalB > 0)) return null;
    const keys = new Set([...a.keys(), ...b.keys()]);
    let distance = 0;
    keys.forEach((key) => {
      distance += Math.abs((a.get(key)?.minutes || 0) / totalA - (b.get(key)?.minutes || 0) / totalB);
    });
    return Math.max(0, Math.min(1, 1 - (distance / 2)));
  }

  function comparisonSimilarity(base, current) {
    const topic = mapSimilarity(base.topics, current.topics);
    const time = mapSimilarity(base.times, current.times);
    const values = [topic, time].filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function unionRows(analyses, field) {
    const keys = new Set();
    analyses.forEach((analysis) => analysis[field].forEach((_value, key) => keys.add(key)));
    return [...keys].map((key) => ({
      key,
      values: analyses.map((analysis) => analysis[field].get(key) || { minutes: 0, scheduled: 0, completed: 0, dollars: 0, pledges: 0, results: [] })
    }));
  }

  function differenceRows(base, current, field) {
    return unionRows([base, current], field).map((row) => ({
      key: row.key,
      baseline: row.values[0],
      current: row.values[1],
      difference: Number(row.values[1].dollars || 0) - Number(row.values[0].dollars || 0)
    })).filter((row) => row.baseline.scheduled || row.current.scheduled || row.baseline.dollars || row.current.dollars);
  }

  function biggestDifference(base, current, field) {
    const rows = differenceRows(base, current, field);
    const positive = [...rows].sort((a, b) => b.difference - a.difference)[0] || null;
    const negative = [...rows].sort((a, b) => a.difference - b.difference)[0] || null;
    return { positive, negative };
  }

  function comparisonChannelPolicy(analyses = []) {
    const selected = (analyses || []).filter(Boolean);
    return {
      includeOnline: selected.length > 0 && selected.every((analysis) => analysis.onlineTracked),
      includeMail: selected.length > 0 && selected.every((analysis) => analysis.mailTracked)
    };
  }

  function comparableTotalForPolicy(analysis = {}, policy = {}) {
    return Number(analysis.broadcastDollars || 0)
      + (policy.includeOnline ? Number(analysis.onlineDollars || 0) : 0)
      + (policy.includeMail ? Number(analysis.mailDollars || 0) : 0);
  }

  function channelBasisLabel(policy = {}) {
    return ['Broadcast', policy.includeOnline ? 'Online' : '', policy.includeMail ? 'Mail' : ''].filter(Boolean).join(' + ');
  }

  function excludedChannelLines(analysis = {}, policy = {}) {
    const lines = [];
    if (!policy.includeOnline && analysis.onlineTracked) lines.push(`Additional Online monies ${money(analysis.onlineDollars)} · not included`);
    if (!policy.includeMail && analysis.mailTracked) lines.push(`Additional Mail monies ${money(analysis.mailDollars)} · not included`);
    return lines;
  }

  function comparisonChannelNote(analyses = [], policy = {}) {
    const excludedOnline = !policy.includeOnline && analyses.some((analysis) => analysis.onlineTracked);
    const excludedMail = !policy.includeMail && analyses.some((analysis) => analysis.mailTracked);
    const excluded = [excludedOnline ? 'Online' : '', excludedMail ? 'Mail' : ''].filter(Boolean);
    if (!excluded.length) return `Comparable totals include ${channelBasisLabel(policy)} because those channels are tracked across every selected fundraiser.`;
    return `Additional monies attributed to ${excluded.join(' and ')} are shown as small line items where available. Those channels were not tracked evenly across the selected fundraisers and are not included in the comparison totals.`;
  }

  function hoursLabel(minutes = 0) {
    const value = Number(minutes || 0) / 60;
    if (!Number.isFinite(value) || value <= 0) return '0 hr';
    return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} hr`;
  }

  function dollarsPerHour(dollars = 0, minutes = 0) {
    const hours = Number(minutes || 0) / 60;
    return hours > 0 ? Number(dollars || 0) / hours : 0;
  }

function medianValue(values = []) {
    const clean = values.map(Number).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!clean.length) return 0;
    const mid = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
  }

  function outlierSummary(values = []) {
    const clean = values.map(Number).filter((value) => Number.isFinite(value));
    if (clean.length < 4) return { outlierCount: 0, highOutliers: 0, lowOutliers: 0, outlierValues: [] };
    const median = medianValue(clean);
    const mad = medianValue(clean.map((value) => Math.abs(value - median)));
    if (!(mad > 0)) return { outlierCount: 0, highOutliers: 0, lowOutliers: 0, outlierValues: [] };
    const outlierValues = clean.filter((value) => Math.abs((0.6745 * (value - median)) / mad) > 3.5);
    return {
      outlierCount: outlierValues.length,
      highOutliers: outlierValues.filter((value) => value > median).length,
      lowOutliers: outlierValues.filter((value) => value < median).length,
      outlierValues
    };
  }

  function groupStrength(group = {}) {
    const results = Array.isArray(group.results) ? group.results.map(Number).filter((value) => Number.isFinite(value)) : [];
    const total = results.reduce((sum, value) => sum + value, 0);
    return {
      median: medianValue(results),
      avg: results.length ? total / results.length : 0,
      count: results.length,
      ...outlierSummary(results)
    };
  }

  function outlierShortLabel(strength = {}) {
    const count = Number(strength.outlierCount || 0);
    if (!count) return '';
    if (strength.highOutliers && !strength.lowOutliers) return `${count} unusual high`;
    if (strength.lowOutliers && !strength.highOutliers) return `${count} unusual low`;
    return `${count} unusual`;
  }

  function percentChange(current = 0, baseline = 0) {
    const base = Number(baseline || 0);
    const value = Number(current || 0);
    if (!(base > 0)) return null;
    return ((value - base) / base) * 100;
  }

  function signedPercent(value) {
    if (!Number.isFinite(Number(value))) return '—';
    const rounded = Math.round(Number(value));
    return `${rounded > 0 ? '+' : ''}${rounded}%`;
  }

  function chartHue(index = 0) {
    return (205 + (Number(index || 0) * 47)) % 360;
  }

  function overallRevenueDecomposition(base = {}, current = {}) {
    const baseHours = Number(base.scheduledMinutes || 0) / 60;
    const currentHours = Number(current.scheduledMinutes || 0) / 60;
    const baseRate = dollarsPerHour(base.broadcastDollars, base.scheduledMinutes);
    const currentRate = dollarsPerHour(current.broadcastDollars, current.scheduledMinutes);
    const difference = Number(current.broadcastDollars || 0) - Number(base.broadcastDollars || 0);
    const hoursEffect = (currentHours - baseHours) * ((baseRate + currentRate) / 2);
    const rateEffect = (currentRate - baseRate) * ((baseHours + currentHours) / 2);
    return { difference, hoursEffect, rateEffect, residual: difference - hoursEffect - rateEffect };
  }

  function renderOverallRevenueDecomposition(base = {}, current = {}) {
    const result = overallRevenueDecomposition(base, current);
    const residual = Math.abs(result.residual) >= 1 ? `<span>Rounding residual <b>${escapeHtml(signedMoney(result.residual))}</b></span>` : '<span>Effects reconcile to the Broadcast change</span>';
    return `<section class="fc-panel fc-overall-decomposition"><div class="fc-panel-head"><div><h3>Hours vs performance</h3><span>Broadcast revenue change is split into fundraising-hours and Broadcast $/hour effects. This is accounting, not a claim about cause.</span></div></div><div class="fc-overall-effect-grid"><div><span>Broadcast change</span><strong class="${result.difference > 0 ? 'positive' : result.difference < 0 ? 'negative' : ''}">${escapeHtml(signedMoney(result.difference))}</strong></div><div><span>Fundraising-hours effect</span><strong>${escapeHtml(signedMoney(result.hoursEffect))}</strong><small>${escapeHtml(hoursLabel(base.scheduledMinutes))} → ${escapeHtml(hoursLabel(current.scheduledMinutes))}</small></div><div><span>$/hour performance effect</span><strong>${escapeHtml(signedMoney(result.rateEffect))}</strong><small>${escapeHtml(money(dollarsPerHour(base.broadcastDollars, base.scheduledMinutes)))}/hr → ${escapeHtml(money(dollarsPerHour(current.broadcastDollars, current.scheduledMinutes)))}/hr</small></div></div><div class="fc-overall-reconcile">${residual}</div></section>`;
  }

  function aggregatePlacementRows(rows = [], keyFn = () => '') {
    const map = new Map();
    rows.forEach((row) => {
      const key = text(keyFn(row)) || 'Unknown';
      if (!map.has(key)) map.set(key, { key, minutes: 0, dollars: 0, pledges: 0, scheduled: 0, completed: 0, results: [] });
      const item = map.get(key);
      item.minutes += Number(row.minutes || 0);
      item.dollars += Number(row.dollars || 0);
      item.pledges += Number(row.pledges || 0);
      item.scheduled += 1;
      if (row.known) {
        item.completed += 1;
        item.results.push(Number(row.dollars || 0));
      }
    });
    return map;
  }

  function renderTopicScheduleMix(analyses = []) {
    const rows = unionRows(analyses, 'topics')
      .map((row) => ({
        ...row,
        maxMedian: Math.max(0, ...row.values.map((value) => groupStrength(value).median)),
        totalMinutes: row.values.reduce((sum, value) => sum + Number(value.minutes || 0), 0),
        totalDollars: row.values.reduce((sum, value) => sum + Number(value.dollars || 0), 0)
      }))
      .filter((row) => row.totalMinutes > 0 || row.totalDollars > 0)
      .sort((a, b) => b.maxMedian - a.maxMedian || b.totalDollars - a.totalDollars || b.totalMinutes - a.totalMinutes || a.key.localeCompare(b.key));

    if (!rows.length) return '<section class="fc-panel"><h3>Topic hours vs performance</h3><div class="fc-chart-empty">No topic schedule/results to graph.</div></section>';

    const legend = rows.map((row, index) => `<span class="fc-legend-item"><i style="background:hsl(${chartHue(index)} 65% 48%)"></i>${escapeHtml(row.key)}</span>`).join('');
    const body = analyses.map((analysis) => {
      const totalMinutes = Number(analysis.scheduledMinutes || 0) || [...analysis.topics.values()].reduce((sum, row) => sum + Number(row.minutes || 0), 0);
      const totalDollars = [...analysis.topics.values()].reduce((sum, row) => sum + Number(row.dollars || 0), 0);
      const overallRate = dollarsPerHour(analysis.broadcastDollars, totalMinutes);
      const scheduleSegments = rows.map((row, index) => {
        const value = analysis.topics.get(row.key) || {};
        const minutes = Number(value.minutes || 0);
        if (!(minutes > 0) || !(totalMinutes > 0)) return '';
        const share = (minutes / totalMinutes) * 100;
        return `<span class="fc-stack-segment" style="width:${share.toFixed(2)}%;background:hsl(${chartHue(index)} 65% 48%)" title="${escapeHtml(row.key)} · ${escapeHtml(hoursLabel(minutes))} of ${escapeHtml(hoursLabel(totalMinutes))} · ${Math.round(share)}% of scheduled hours">${share >= 11 ? `${Math.round(share)}%` : ''}</span>`;
      }).join('');
      const revenueSegments = rows.map((row, index) => {
        const value = analysis.topics.get(row.key) || {};
        const dollars = Number(value.dollars || 0);
        if (!(dollars > 0) || !(totalDollars > 0)) return '';
        const share = (dollars / totalDollars) * 100;
        return `<span class="fc-stack-segment" style="width:${share.toFixed(2)}%;background:hsl(${chartHue(index)} 65% 48%)" title="${escapeHtml(row.key)} · ${escapeHtml(money(dollars))} · ${Math.round(share)}% of attributable Broadcast $">${share >= 11 ? `${Math.round(share)}%` : ''}</span>`;
      }).join('');
      const topicMetrics = rows.map((row) => {
        const value = analysis.topics.get(row.key) || {};
        const minutes = Number(value.minutes || 0);
        const dollars = Number(value.dollars || 0);
        if (!(minutes > 0) && !(dollars > 0)) return '';
        const strength = groupStrength(value);
        const scheduleShare = totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0;
        const revenueShare = totalDollars > 0 ? (dollars / totalDollars) * 100 : 0;
        const unusual = outlierShortLabel(strength);
        return `<div class="fc-topic-metric-chip"><button type="button" class="fc-topic-drill-button" data-topic-drill="${escapeHtml(row.key)}">${escapeHtml(row.key)}</button><span class="fc-strength-line"><b>Median ${escapeHtml(money(strength.median))}</b>/airing · Avg ${escapeHtml(money(strength.avg))} · ${number(strength.count)} result${strength.count === 1 ? '' : 's'}${unusual ? ` · <em>${escapeHtml(unusual)}</em>` : ''}</span><span>${escapeHtml(hoursLabel(minutes))} of ${escapeHtml(hoursLabel(totalMinutes))} · ${Math.round(scheduleShare)}% schedule</span><span>${escapeHtml(money(dollars))} · ${Math.round(revenueShare)}% revenue</span></div>`;
      }).join('');
      return `<div class="fc-topic-pair-row"><div class="fc-topic-pair-label"><strong>${escapeHtml(analysis.schedule.title)}</strong><span>${escapeHtml(String(analysis.schedule.year || ''))}</span><em>${escapeHtml(hoursLabel(totalMinutes))} total · ${escapeHtml(money(overallRate))}/fundraising hr</em></div><div class="fc-topic-pair-bars"><div class="fc-share-line"><b>Hours</b><div class="fc-stack-track">${scheduleSegments}</div><span>${escapeHtml(hoursLabel(totalMinutes))}</span></div><div class="fc-share-line"><b>Revenue</b><div class="fc-stack-track">${revenueSegments}</div><span>${escapeHtml(money(totalDollars))}</span></div><div class="fc-topic-metric-grid">${topicMetrics}</div></div></div>`;
    }).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>Topic hours vs performance</h3><span>Median $/airing is the primary strength signal. Average, sample size and unusual results stay visible beside schedule share and actual revenue share, so a lightly scheduled topic can still stand out.</span></div></div><div class="fc-topic-pair-chart">${body}</div><div class="fc-legend">${legend}</div></section>`;
  }

  function renderTimeScheduleMix(analyses = []) {
    const rows = unionRows(analyses, 'times')
      .filter((row) => row.values.some((value) => Number(value.minutes || 0) > 0 || Number(value.dollars || 0) > 0))
      .sort((a, b) => timeSortValue(a.key) - timeSortValue(b.key));

    if (!rows.length) return '<section class="fc-panel"><h3>Time-slot hours and revenue</h3><div class="fc-chart-empty">No start-time schedule/results to graph.</div></section>';

    const maxMinutes = Math.max(1, ...rows.flatMap((row) => row.values.map((value) => Number(value.minutes || 0))));
    const maxDollars = Math.max(1, ...rows.flatMap((row) => row.values.map((value) => Number(value.dollars || 0))));
    const columns = `84px repeat(${Math.max(1, analyses.length)}, minmax(185px,1fr))`;
    const head = analyses.map((analysis) => `<div class="fc-time-head"><strong>${escapeHtml(analysis.schedule.title)}</strong><span>${escapeHtml(String(analysis.schedule.year || ''))}</span></div>`).join('');
    const body = rows.map((row) => `<div class="fc-time-matrix-row" style="grid-template-columns:${columns}"><div class="fc-time-label">${escapeHtml(row.key)}</div>${row.values.map((value, index) => {
      const minutes = Number(value.minutes || 0);
      const dollars = Number(value.dollars || 0);
      const hourWidth = Math.max(0, Math.min(100, (minutes / maxMinutes) * 100));
      const dollarWidth = Math.max(0, Math.min(100, (dollars / maxDollars) * 100));
      return `<div class="fc-time-cell"><div class="fc-time-metric"><b>H</b><div><span style="width:${hourWidth.toFixed(2)}%;background:hsl(${chartHue(index)} 45% 62%)"></span></div><strong>${escapeHtml(hoursLabel(minutes))}</strong></div><div class="fc-time-metric money"><b>$</b><div><span style="width:${dollarWidth.toFixed(2)}%;background:hsl(${chartHue(index)} 65% 42%)"></span></div><strong>${escapeHtml(money(dollars))}</strong></div><small>${escapeHtml(money(dollarsPerHour(dollars, minutes)))}/hr</small></div>`;
    }).join('')}</div>`).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>Time-slot hours and revenue</h3><span>Each program start-time bucket shows scheduled hours, attributable Broadcast $, and dollars per scheduled hour.</span></div></div><div class="fc-time-matrix-head" style="grid-template-columns:${columns}"><div></div>${head}</div><div class="fc-time-matrix">${body}</div></section>`;
  }

  function renderTopicHeatmap(analyses = []) {
    const rows = unionRows(analyses, 'topics')
      .map((row) => ({
        ...row,
        totalMinutes: row.values.reduce((sum, value) => sum + Number(value.minutes || 0), 0),
        maxMedian: Math.max(0, ...row.values.map((value) => groupStrength(value).median))
      }))
      .filter((row) => row.totalMinutes > 0 || row.maxMedian > 0)
      .sort((a, b) => b.maxMedian - a.maxMedian || b.totalMinutes - a.totalMinutes || a.key.localeCompare(b.key));

    if (!rows.length) return '<section class="fc-panel"><h3>Topic strength heatmap</h3><div class="fc-chart-empty">No schedule/results available for the heatmap.</div></section>';

    const maxMedian = Math.max(1, ...rows.flatMap((row) => row.values.map((value) => groupStrength(value).median)));
    const head = analyses.map((analysis) => `<th>${escapeHtml(analysis.schedule.title)}<span>${escapeHtml(String(analysis.schedule.year || ''))}</span></th>`).join('');
    const body = rows.map((row) => `<tr><th><button type="button" class="fc-topic-drill-button" data-topic-drill="${escapeHtml(row.key)}">${escapeHtml(row.key)}</button></th>${row.values.map((value) => {
      const minutes = Number(value.minutes || 0);
      const dollars = Number(value.dollars || 0);
      const strength = groupStrength(value);
      if (!(minutes > 0) && !strength.count) return '<td class="fc-heat-zero">—</td>';
      const intensity = Math.max(0, Math.min(1, strength.median / maxMedian));
      const alpha = strength.count ? (0.12 + (intensity * 0.76)).toFixed(2) : '0.04';
      const dark = intensity >= 0.53 ? ' fc-heat-dark' : '';
      const unusual = outlierShortLabel(strength);
      return `<td class="fc-heat-cell${dark}" style="background:rgba(29,95,150,${alpha})" title="${escapeHtml(row.key)} · ${escapeHtml(hoursLabel(minutes))} · median ${escapeHtml(money(strength.median))}/airing · average ${escapeHtml(money(strength.avg))} · ${number(strength.count)} results · total ${escapeHtml(money(dollars))}${unusual ? ` · ${escapeHtml(unusual)}` : ''}"><strong>${escapeHtml(hoursLabel(minutes))}</strong><span>Median ${escapeHtml(money(strength.median))}</span><small>Avg ${escapeHtml(money(strength.avg))} · ${number(strength.count)} results</small><small>Total ${escapeHtml(money(dollars))}${unusual ? ` · ${escapeHtml(unusual)}` : ''}</small></td>`;
    }).join('')}</tr>`).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>Topic strength heatmap</h3><span>Printed number = scheduled hours. Color intensity = Median $/airing. Average, result count and actual total dollars remain visible in each cell.</span></div><div class="fc-heat-scale"><span>lower median</span><i></i><span>higher median</span></div></div><div class="fc-table-wrap"><table class="fc-heatmap"><thead><tr><th>Topic</th>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
  }

  function renderDifferenceChart(base, current, field, title) {
    let rows = differenceRows(base, current, field);
    rows = field === 'times'
      ? rows.sort((a, b) => timeSortValue(a.key) - timeSortValue(b.key))
      : rows.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.key.localeCompare(b.key));

    if (!rows.length) return `<section class="fc-panel"><h3>${escapeHtml(title)}</h3><div class="fc-chart-empty">No attributable Broadcast $ to compare.</div></section>`;

    const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(Number(row.difference || 0))));
    const body = rows.map((row) => {
      const diff = Number(row.difference || 0);
      const width = Math.max(0, Math.min(48, (Math.abs(diff) / maxAbs) * 48));
      const bar = diff > 0
        ? `<span class="fc-delta-bar positive" style="left:50%;width:${width.toFixed(2)}%"></span>`
        : diff < 0
          ? `<span class="fc-delta-bar negative" style="right:50%;width:${width.toFixed(2)}%"></span>`
          : '<span class="fc-delta-zero-dot"></span>';
      const label = field === 'topics' ? `<button type="button" class="fc-delta-label fc-topic-drill-button" data-topic-drill="${escapeHtml(row.key)}">${escapeHtml(row.key)}</button>` : `<div class="fc-delta-label">${escapeHtml(row.key)}</div>`;
      return `<div class="fc-delta-row">${label}<div class="fc-delta-track"><span class="fc-delta-center"></span>${bar}</div><div class="fc-delta-meta"><strong class="${diff > 0 ? 'positive' : diff < 0 ? 'negative' : ''}">${escapeHtml(signedMoney(diff))}</strong><span>${escapeHtml(hoursLabel(row.baseline.minutes))} → ${escapeHtml(hoursLabel(row.current.minutes))}</span><small>${escapeHtml(money(dollarsPerHour(row.baseline.dollars, row.baseline.minutes)))}/hr → ${escapeHtml(money(dollarsPerHour(row.current.dollars, row.current.minutes)))}/hr</small></div></div>`;
    }).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>${escapeHtml(title)}</h3><span>${escapeHtml(current.schedule.title)} minus ${escapeHtml(base.schedule.title)}. Every row also shows A → B hours and $/hour.</span></div></div><div class="fc-delta-chart">${body}</div></section>`;
  }

  function comparisonFindingGrid(base, current, policy) {
    const difference = comparableTotalForPolicy(current, policy) - comparableTotalForPolicy(base, policy);
    const similarity = comparisonSimilarity(base, current);
    const topic = biggestDifference(base, current, 'topics');
    const time = biggestDifference(base, current, 'times');
    const channels = channelBasisLabel(policy);
    const topicGain = topic.positive ? `${topic.positive.key} ${signedMoney(topic.positive.difference)}` : '—';
    const topicLoss = topic.negative ? `${topic.negative.key} ${signedMoney(topic.negative.difference)}` : '—';
    const timeSwing = [time.positive, time.negative].filter(Boolean).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))[0];
    const hourChange = percentChange(current.scheduledMinutes, base.scheduledMinutes);
    const broadcastChange = percentChange(current.broadcastDollars, base.broadcastDollars);
    const baseRate = dollarsPerHour(base.broadcastDollars, base.scheduledMinutes);
    const currentRate = dollarsPerHour(current.broadcastDollars, current.scheduledMinutes);
    const rateChange = percentChange(currentRate, baseRate);

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>${escapeHtml(current.schedule.title)} vs ${escapeHtml(base.schedule.title)}</h3><span>A → B diagnostic comparison</span></div></div><div class="fc-finding-grid"><div class="fc-finding"><span>Comparable income</span><strong>${escapeHtml(signedMoney(difference))}</strong><small>${escapeHtml(channels)}</small></div><div class="fc-finding"><span>Fundraising hours</span><strong>${escapeHtml(signedPercent(hourChange))}</strong><small>${escapeHtml(hoursLabel(base.scheduledMinutes))} → ${escapeHtml(hoursLabel(current.scheduledMinutes))}</small></div><div class="fc-finding"><span>Broadcast $</span><strong>${escapeHtml(signedPercent(broadcastChange))}</strong><small>${escapeHtml(money(base.broadcastDollars))} → ${escapeHtml(money(current.broadcastDollars))}</small></div><div class="fc-finding"><span>Broadcast $/hour</span><strong>${escapeHtml(signedPercent(rateChange))}</strong><small>${escapeHtml(money(baseRate))} → ${escapeHtml(money(currentRate))}</small></div><div class="fc-finding"><span>Schedule similarity</span><strong>${Number.isFinite(similarity) ? `${Math.round(similarity * 100)}%` : '—'}</strong><small>topic + start-time allocation</small></div><div class="fc-finding"><span>Biggest topic gain</span><strong>${escapeHtml(topicGain)}</strong></div><div class="fc-finding"><span>Biggest topic loss</span><strong>${escapeHtml(topicLoss)}</strong></div><div class="fc-finding"><span>Largest time-slot swing</span><strong>${timeSwing ? `${escapeHtml(timeSwing.key)} ${escapeHtml(signedMoney(timeSwing.difference))}` : '—'}</strong></div></div></section>`;
  }

  function topicDetailRows(analysis, topic) {
    return (analysis.placementRows || []).filter((row) => row.topic === topic);
  }

  function pairedBreakdown(baseRows, currentRows, keyFn, limit = 6) {
    const baseMap = aggregatePlacementRows(baseRows, keyFn);
    const currentMap = aggregatePlacementRows(currentRows, keyFn);
    const keys = new Set([...baseMap.keys(), ...currentMap.keys()]);
    return [...keys]
      .map((key) => ({ key, base: baseMap.get(key) || { minutes: 0, dollars: 0 }, current: currentMap.get(key) || { minutes: 0, dollars: 0 } }))
      .sort((a, b) => Math.max(b.base.dollars, b.current.dollars) - Math.max(a.base.dollars, a.current.dollars) || Math.max(b.base.minutes, b.current.minutes) - Math.max(a.base.minutes, a.current.minutes))
      .slice(0, limit)
      .map((row) => `<span class="fc-detail-chip"><b>${escapeHtml(row.key)}</b><span>${escapeHtml(hoursLabel(row.base.minutes))}/${escapeHtml(money(row.base.dollars))}</span><i>→</i><span>${escapeHtml(hoursLabel(row.current.minutes))}/${escapeHtml(money(row.current.dollars))}</span></span>`)
      .join('');
  }

  function topicRevenueDecomposition(base, current, baselineRow = {}, currentRow = {}) {
    const baseLength = Number(base?.scheduledMinutes || 0) / 60;
    const currentLength = Number(current?.scheduledMinutes || 0) / 60;
    const baseTopicHours = Number(baselineRow?.minutes || 0) / 60;
    const currentTopicHours = Number(currentRow?.minutes || 0) / 60;
    const baseShare = baseLength > 0 ? baseTopicHours / baseLength : 0;
    const currentShare = currentLength > 0 ? currentTopicHours / currentLength : 0;
    const baseRate = baseTopicHours > 0 ? Number(baselineRow?.dollars || 0) / baseTopicHours : 0;
    const currentRate = currentTopicHours > 0 ? Number(currentRow?.dollars || 0) / currentTopicHours : 0;
    const start = { length: baseLength, share: baseShare, rate: baseRate };
    const end = { length: currentLength, share: currentShare, rate: currentRate };
    const permutations = [
      ['length', 'share', 'rate'], ['length', 'rate', 'share'],
      ['share', 'length', 'rate'], ['share', 'rate', 'length'],
      ['rate', 'length', 'share'], ['rate', 'share', 'length']
    ];
    const effects = { length: 0, share: 0, rate: 0 };
    const value = (parts) => Number(parts.length || 0) * Number(parts.share || 0) * Number(parts.rate || 0);
    permutations.forEach((order) => {
      const parts = { ...start };
      let before = value(parts);
      order.forEach((key) => {
        parts[key] = end[key];
        const after = value(parts);
        effects[key] += after - before;
        before = after;
      });
    });
    Object.keys(effects).forEach((key) => { effects[key] /= permutations.length; });
    const difference = Number(currentRow?.dollars || 0) - Number(baselineRow?.dollars || 0);
    const reconciled = effects.length + effects.share + effects.rate;
    return { difference, ...effects, residual: difference - reconciled };
  }

  function explanationCoverageRead(decomposition = {}, proposedFactor = 'share') {
    const difference = Number(decomposition.difference || 0);
    const proposed = Number(decomposition[proposedFactor] || 0);
    const remaining = difference - proposed;
    const tolerance = Math.max(25, Math.abs(difference) * 0.08);
    if (Math.abs(difference) < 1) return 'There is no meaningful revenue change to explain.';
    if (Math.abs(remaining) <= tolerance) return `This reason explains nearly the full ${signedMoney(difference)} revenue change.`;
    if (Math.sign(proposed) === Math.sign(difference) && Math.abs(proposed) > Math.abs(difference) + tolerance) {
      return `This reason more than explains the net ${signedMoney(difference)} change; other effects offset it by about ${money(Math.abs(remaining))}.`;
    }
    if (Math.sign(proposed) === Math.sign(difference) && Math.abs(proposed) > tolerance) {
      return `This reason explains about ${signedMoney(proposed)} of the ${signedMoney(difference)} change; about ${money(Math.abs(remaining))} remains in other effects.`;
    }
    if (Math.abs(proposed) <= tolerance) return `This reason does not materially explain the ${signedMoney(difference)} revenue change.`;
    return `This reason moved against the net ${signedMoney(difference)} change, offsetting it by about ${money(Math.abs(proposed))}.`;
  }

  function factorPermutations(keys = []) {
    if (keys.length <= 1) return [keys];
    return keys.flatMap((key, index) => {
      const rest = [...keys.slice(0, index), ...keys.slice(index + 1)];
      return factorPermutations(rest).map((order) => [key, ...order]);
    });
  }

  function subtopicRevenueDecomposition(base, current, topicBase = {}, topicCurrent = {}, subtopicBase = {}, subtopicCurrent = {}) {
    const baseLength = Number(base?.scheduledMinutes || 0) / 60;
    const currentLength = Number(current?.scheduledMinutes || 0) / 60;
    const baseTopicHours = Number(topicBase?.minutes || 0) / 60;
    const currentTopicHours = Number(topicCurrent?.minutes || 0) / 60;
    const baseSubtopicHours = Number(subtopicBase?.minutes || 0) / 60;
    const currentSubtopicHours = Number(subtopicCurrent?.minutes || 0) / 60;
    const start = {
      length: baseLength,
      topicShare: baseLength > 0 ? baseTopicHours / baseLength : 0,
      subtopicShare: baseTopicHours > 0 ? baseSubtopicHours / baseTopicHours : 0,
      rate: baseSubtopicHours > 0 ? Number(subtopicBase?.dollars || 0) / baseSubtopicHours : 0
    };
    const end = {
      length: currentLength,
      topicShare: currentLength > 0 ? currentTopicHours / currentLength : 0,
      subtopicShare: currentTopicHours > 0 ? currentSubtopicHours / currentTopicHours : 0,
      rate: currentSubtopicHours > 0 ? Number(subtopicCurrent?.dollars || 0) / currentSubtopicHours : 0
    };
    const keys = ['length', 'topicShare', 'subtopicShare', 'rate'];
    const effects = { length: 0, topicShare: 0, subtopicShare: 0, rate: 0 };
    const value = (parts) => Number(parts.length || 0) * Number(parts.topicShare || 0) * Number(parts.subtopicShare || 0) * Number(parts.rate || 0);
    const orders = factorPermutations(keys);
    orders.forEach((order) => {
      const parts = { ...start };
      let before = value(parts);
      order.forEach((key) => {
        parts[key] = end[key];
        const after = value(parts);
        effects[key] += after - before;
        before = after;
      });
    });
    keys.forEach((key) => { effects[key] /= orders.length; });
    const difference = Number(subtopicCurrent?.dollars || 0) - Number(subtopicBase?.dollars || 0);
    const reconciled = keys.reduce((sum, key) => sum + effects[key], 0);
    return { difference, ...effects, residual: difference - reconciled };
  }

  function subtopicExplanationRead(decomposition = {}) {
    const difference = Number(decomposition.difference || 0);
    const factors = [
      { key: 'length', label: 'fundraiser length', value: Number(decomposition.length || 0) },
      { key: 'topicShare', label: 'topic allocation', value: Number(decomposition.topicShare || 0) },
      { key: 'subtopicShare', label: 'subtopic mix', value: Number(decomposition.subtopicShare || 0) },
      { key: 'rate', label: 'subtopic $/hour', value: Number(decomposition.rate || 0) }
    ];
    if (Math.abs(difference) < 1) return { label: 'no material change', read: 'There is no meaningful revenue change to explain.' };
    const sameDirection = factors.filter((factor) => Math.sign(factor.value) === Math.sign(difference) && Math.abs(factor.value) >= 1);
    const dominant = [...(sameDirection.length ? sameDirection : factors)].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
    return { label: dominant?.label || 'mixed effects', read: explanationCoverageRead(decomposition, dominant?.key || 'rate') };
  }

  function renderSubtopicDiagnostics(base, current, topic = '') {
    if (!CERTIFIED_SUBTOPIC_TOPICS.has(lookupKey(topic))) return '';
    const baseRows = topicDetailRows(base, topic);
    const currentRows = topicDetailRows(current, topic);
    const subtopicKey = (row) => (text(row.secondary) && text(row.secondary) !== 'Unspecified' ? text(row.secondary) : 'Unspecified');
    const baseMap = aggregatePlacementRows(baseRows, subtopicKey);
    const currentMap = aggregatePlacementRows(currentRows, subtopicKey);
    const topicBase = base.topics.get(topic) || { minutes: 0, dollars: 0 };
    const topicCurrent = current.topics.get(topic) || { minutes: 0, dollars: 0 };
    const keys = new Set([...baseMap.keys(), ...currentMap.keys()]);
    const rows = [...keys].map((key) => ({
      key,
      base: baseMap.get(key) || { minutes: 0, dollars: 0 },
      current: currentMap.get(key) || { minutes: 0, dollars: 0 }
    })).sort((a, b) => Math.abs(Number(b.current.dollars || 0) - Number(b.base.dollars || 0)) - Math.abs(Number(a.current.dollars || 0) - Number(a.base.dollars || 0)) || a.key.localeCompare(b.key));
    if (!rows.length) return '';

    const body = rows.map((row) => {
      const decomposition = subtopicRevenueDecomposition(base, current, topicBase, topicCurrent, row.base, row.current);
      const explanation = subtopicExplanationRead(decomposition);
      const difference = Number(decomposition.difference || 0);
      const baseMix = Number(topicBase.minutes || 0) > 0 ? (Number(row.base.minutes || 0) / Number(topicBase.minutes || 0)) * 100 : 0;
      const currentMix = Number(topicCurrent.minutes || 0) > 0 ? (Number(row.current.minutes || 0) / Number(topicCurrent.minutes || 0)) * 100 : 0;
      const mixDelta = currentMix - baseMix;
      const residual = Math.abs(Number(decomposition.residual || 0)) >= 1
        ? `<span>Residual <b>${escapeHtml(signedMoney(decomposition.residual))}</b></span>`
        : '<span>Effects reconcile to the full change</span>';
      const baseStrength = groupStrength(row.base);
      const currentStrength = groupStrength(row.current);
      return `<details class="fc-subtopic-diagnostic"><summary><span><strong>${escapeHtml(row.key)}</strong><small>${escapeHtml(hoursLabel(row.base.minutes))} / ${escapeHtml(money(row.base.dollars))} → ${escapeHtml(hoursLabel(row.current.minutes))} / ${escapeHtml(money(row.current.dollars))}</small><small>Median ${escapeHtml(money(baseStrength.median))} → ${escapeHtml(money(currentStrength.median))} · Avg ${escapeHtml(money(baseStrength.avg))} → ${escapeHtml(money(currentStrength.avg))}</small></span><b class="${difference > 0 ? 'positive' : difference < 0 ? 'negative' : ''}">${escapeHtml(signedMoney(difference))}</b></summary><div class="fc-subtopic-explanation"><strong>Main accounting driver: ${escapeHtml(explanation.label)}</strong><p>${escapeHtml(explanation.read)}</p><div class="fc-subtopic-effect-grid"><span>Fundraiser length <b>${escapeHtml(signedMoney(decomposition.length))}</b></span><span>${escapeHtml(topic)} allocation <b>${escapeHtml(signedMoney(decomposition.topicShare))}</b></span><span>Subtopic mix <b>${escapeHtml(signedMoney(decomposition.subtopicShare))}</b></span><span>Subtopic $/hour <b>${escapeHtml(signedMoney(decomposition.rate))}</b></span>${residual}</div><small>Share within ${escapeHtml(topic)}: ${Math.round(baseMix)}% → ${Math.round(currentMix)}% · ${mixDelta > 0 ? '+' : ''}${mixDelta.toFixed(1)} pts. These effects account for the revenue change; they do not prove causation.</small></div></details>`;
    }).join('');

    return `<details class="fc-subtopic-group"><summary>Dial down into ${escapeHtml(topic)} subtopics</summary><div class="fc-subtopic-diagnostics">${body}</div></details>`;
  }

  function renderTopicDiagnostics(base, current) {
    const rows = differenceRows(base, current, 'topics')
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.key.localeCompare(b.key))
      .slice(0, 8);
    if (!rows.length) return '';

    const body = rows.map((row) => {
      const baseRows = topicDetailRows(base, row.key);
      const currentRows = topicDetailRows(current, row.key);
      const useSecondary = CERTIFIED_SUBTOPIC_TOPICS.has(lookupKey(row.key));
      const dayparts = pairedBreakdown(baseRows, currentRows, (item) => item.daypart, 5);
      const mix = pairedBreakdown(baseRows, currentRows, useSecondary ? (item) => item.secondary : (item) => item.title, 7);
      const baseShare = base.scheduledMinutes > 0 ? (Number(row.baseline.minutes || 0) / base.scheduledMinutes) * 100 : 0;
      const currentShare = current.scheduledMinutes > 0 ? (Number(row.current.minutes || 0) / current.scheduledMinutes) * 100 : 0;
      const shareDelta = currentShare - baseShare;
      const driveDeltaMinutes = Number(current.scheduledMinutes || 0) - Number(base.scheduledMinutes || 0);
      const topicDeltaMinutes = Number(row.current.minutes || 0) - Number(row.baseline.minutes || 0);
      const topicRatio = Number(row.baseline.minutes || 0) > 0 ? Number(row.current.minutes || 0) / Number(row.baseline.minutes || 0) : null;
      const signedHoursDelta = (minutes) => {
        const numeric = Number(minutes || 0);
        return `${numeric > 0 ? '+' : numeric < 0 ? '-' : ''}${hoursLabel(Math.abs(numeric))}`;
      };
      const topicScaleRead = Number.isFinite(topicRatio) && topicRatio >= 1.8
        ? ` · ${Math.round(topicRatio * 10) / 10}× as much`
        : '';
      let read = 'Fundraiser length and topic allocation both need inspection.';
      let proposedFactor = 'share';
      if (Math.abs(shareDelta) < 1.5) {
        read = 'Topic share stayed about the same; fundraiser length explains much of the hours difference.';
        proposedFactor = 'length';
      } else if (shareDelta >= 1.5) read = 'This topic took a larger share of the fundraiser, so the schedule mix shifted toward it.';
      else if (shareDelta <= -1.5) read = 'This topic took a smaller share of the fundraiser, so the schedule mix shifted away from it.';
      const decomposition = topicRevenueDecomposition(base, current, row.baseline, row.current);
      const coverageRead = explanationCoverageRead(decomposition, proposedFactor);
      const residualRead = Math.abs(Number(decomposition.residual || 0)) >= 1
        ? `<span>Unassigned/data residual ${escapeHtml(signedMoney(decomposition.residual))}</span>`
        : '<span>Effects reconcile to the full revenue change</span>';
      const subtopicDiagnostics = useSecondary ? renderSubtopicDiagnostics(base, current, row.key) : '';
      const baseStrength = groupStrength(row.baseline);
      const currentStrength = groupStrength(row.current);
      const baseUnusual = outlierShortLabel(baseStrength);
      const currentUnusual = outlierShortLabel(currentStrength);
      return `<article class="fc-topic-diagnostic"><header><button type="button" class="fc-topic-drill-button" data-topic-drill="${escapeHtml(row.key)}">${escapeHtml(row.key)}</button><span class="${row.difference > 0 ? 'positive' : row.difference < 0 ? 'negative' : ''}">${escapeHtml(signedMoney(row.difference))}</span></header><div class="fc-topic-why"><strong>${escapeHtml(read)}</strong><div class="fc-topic-context"><span>Fundraiser ${escapeHtml(hoursLabel(base.scheduledMinutes))} → ${escapeHtml(hoursLabel(current.scheduledMinutes))} · ${escapeHtml(signedHoursDelta(driveDeltaMinutes))}</span><span>Topic ${escapeHtml(hoursLabel(row.baseline.minutes))} → ${escapeHtml(hoursLabel(row.current.minutes))} · ${escapeHtml(signedHoursDelta(topicDeltaMinutes))}${escapeHtml(topicScaleRead)}</span><span>Schedule share ${Math.round(baseShare)}% → ${Math.round(currentShare)}% · ${shareDelta > 0 ? '+' : ''}${shareDelta.toFixed(1)} pts</span></div></div><div class="fc-explanation-check"><strong>Does that explain the full revenue change?</strong><p>${escapeHtml(coverageRead)}</p><div><span>Fundraiser length effect <b>${escapeHtml(signedMoney(decomposition.length))}</b></span><span>Topic share effect <b>${escapeHtml(signedMoney(decomposition.share))}</b></span><span>Topic $/hour effect <b>${escapeHtml(signedMoney(decomposition.rate))}</b></span>${residualRead}</div><small>These are an accounting decomposition of the revenue change, not proof that any factor caused the result. Daypart and program/subtopic mix below help interpret the $/hour effect.</small></div><div class="fc-topic-core"><div><span>A</span><b>Median ${escapeHtml(money(baseStrength.median))}/airing</b><small>Avg ${escapeHtml(money(baseStrength.avg))} · ${number(baseStrength.count)} results${baseUnusual ? ` · ${escapeHtml(baseUnusual)}` : ''}</small><small>${escapeHtml(hoursLabel(row.baseline.minutes))} · total ${escapeHtml(money(row.baseline.dollars))}</small></div><i>→</i><div><span>B</span><b>Median ${escapeHtml(money(currentStrength.median))}/airing</b><small>Avg ${escapeHtml(money(currentStrength.avg))} · ${number(currentStrength.count)} results${currentUnusual ? ` · ${escapeHtml(currentUnusual)}` : ''}</small><small>${escapeHtml(hoursLabel(row.current.minutes))} · total ${escapeHtml(money(row.current.dollars))}</small></div></div><div class="fc-topic-detail"><b>Daypart mix</b><div>${dayparts || '<span class="muted-cell">No daypart detail</span>'}</div></div><div class="fc-topic-detail"><b>${useSecondary ? 'Subtopic mix' : 'Program mix'}</b><div>${mix || '<span class="muted-cell">No useful mix detail</span>'}</div></div>${subtopicDiagnostics}</article>`;
    }).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>Why did this topic change?</h3><span>Fundraiser length is separated from true schedule-share changes. Music uses its normalized subtopics; other topics use program mix unless they are certified for subtopic analysis later.</span></div></div><div class="fc-topic-diagnostics">${body}</div></section>`;
  }

  function renderTopicDrilldown(analyses = [], topic = '') {
    const wanted = text(topic);
    if (!wanted) return '';
    const sets = analyses.map((analysis) => ({
      analysis,
      rows: (analysis.placementRows || []).filter((row) => row.topic === wanted)
    }));
    const useSecondary = CERTIFIED_SUBTOPIC_TOPICS.has(lookupKey(wanted));
    const keyFor = useSecondary
      ? (row) => (text(row.secondary) && text(row.secondary) !== 'Unspecified' ? text(row.secondary) : 'Unspecified')
      : (row) => text(row.title) || 'Untitled program';
    const maps = sets.map((set) => aggregatePlacementRows(set.rows, keyFor));
    const keys = new Set(maps.flatMap((map) => [...map.keys()]));
    const rows = [...keys].map((key) => {
      const programs = useSecondary
        ? [...new Set(sets.flatMap((set) => set.rows.filter((row) => keyFor(row) === key).map((row) => text(row.title)).filter(Boolean)))].sort()
        : [];
      const values = maps.map((map) => map.get(key) || { minutes: 0, dollars: 0, scheduled: 0, completed: 0, results: [] });
      return { key, programs, values, maxMedian: Math.max(0, ...values.map((value) => groupStrength(value).median)) };
    }).sort((a, b) => b.maxMedian - a.maxMedian || b.values.reduce((sum, value) => sum + Number(value.dollars || 0), 0) - a.values.reduce((sum, value) => sum + Number(value.dollars || 0), 0));
    const maxMedian = Math.max(1, ...rows.flatMap((row) => row.values.map((value) => groupStrength(value).median)));
    const head = analyses.map((analysis) => `<th>${escapeHtml(analysis.schedule.title)}<span>${escapeHtml(String(analysis.schedule.year || ''))}</span></th>`).join('');
    const body = rows.map((row) => `<tr><th><strong>${escapeHtml(row.key)}</strong>${row.programs.length ? `<small class="fc-topic-drill-programs">${row.programs.map(escapeHtml).join(' · ')}</small>` : ''}</th>${row.values.map((value) => {
      const dollars = Number(value.dollars || 0);
      const minutes = Number(value.minutes || 0);
      const strength = groupStrength(value);
      const intensity = Math.max(0, Math.min(1, strength.median / maxMedian));
      const alpha = strength.count ? (0.10 + intensity * 0.58).toFixed(2) : '0.02';
      const unusual = outlierShortLabel(strength);
      return `<td style="background:rgba(29,95,150,${alpha})"><strong>${escapeHtml(hoursLabel(minutes))}</strong><span>Median ${escapeHtml(money(strength.median))}</span><small>Avg ${escapeHtml(money(strength.avg))} · ${number(strength.count)} results</small><small>Total ${escapeHtml(money(dollars))}${unusual ? ` · ${escapeHtml(unusual)}` : ''}</small></td>`;
    }).join('')}</tr>`).join('');
    const mode = useSecondary ? 'Certified subtopic breakdown' : 'Program-title breakdown';
    const note = useSecondary
      ? 'Median $/airing is the primary strength signal. Program titles are listed beneath each subtopic; average, total dollars, sample size and unusual results remain visible.'
      : 'Median $/airing is the primary strength signal. This topic defaults to program titles; subtopics are only used after the taxonomy is certified as analytically meaningful.';
    return `<section class="fc-panel fc-topic-drill"><div class="fc-panel-head"><div><h3>${escapeHtml(wanted)} drill-down</h3><span>${escapeHtml(mode)} · ${escapeHtml(note)}</span></div><button type="button" class="ghost fc-topic-drill-close" id="fc-topic-drill-close">Close</button></div>${rows.length ? `<div class="fc-table-wrap"><table class="fc-topic-drill-table"><thead><tr><th>${escapeHtml(useSecondary ? 'Subtopic' : 'Program')}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>` : '<div class="fc-chart-empty">No scheduled programs in this topic for the selected fundraisers.</div>'}</section>`;
  }

  function calendarDays(analysis = {}) {
    const buckets = new Map();
    (analysis.placementRows || []).forEach((row) => {
      const key = text(row.dateKey);
      if (!key) return;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    });

    return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dateKey, rows]) => {
      const date = parseDate(dateKey);
      const minutes = rows.reduce((sum, row) => sum + Number(row.minutes || 0), 0);
      const dollars = rows.reduce((sum, row) => sum + Number(row.dollars || 0), 0);
      return {
        dateKey,
        date,
        weekday: date ? date.toLocaleDateString(undefined, { weekday: 'long' }) : 'Unknown day',
        dateLabel: date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : dateKey,
        minutes,
        dollars,
        rows: [...rows].sort((a, b) => Number(a.startMinutes || 0) - Number(b.startMinutes || 0)),
        topics: aggregatePlacementRows(rows, (row) => row.topic),
        dayparts: aggregatePlacementRows(rows, (row) => row.daypart)
      };
    });
  }

  function pairCalendarDays(base = {}, current = {}) {
    const baseDays = calendarDays(base);
    const currentDays = calendarDays(current);
    const currentBuckets = new Map();
    currentDays.forEach((day) => {
      if (!currentBuckets.has(day.weekday)) currentBuckets.set(day.weekday, []);
      currentBuckets.get(day.weekday).push(day);
    });
    const counts = new Map();
    const usedDates = new Set();
    const pairs = baseDays.map((day) => {
      const index = counts.get(day.weekday) || 0;
      counts.set(day.weekday, index + 1);
      const match = currentBuckets.get(day.weekday)?.[index] || null;
      if (match) usedDates.add(match.dateKey);
      return { base: day, current: match };
    });
    currentDays.filter((day) => !usedDates.has(day.dateKey)).forEach((day) => pairs.push({ base: null, current: day }));
    return pairs;
  }

  function weatherEndpointOrder(endDate = '') {
    const end = parseDate(endDate);
    const ageDays = end ? (Date.now() - end.getTime()) / 86400000 : 9999;
    const forecast = 'https://api.open-meteo.com/v1/forecast';
    const archive = 'https://archive-api.open-meteo.com/v1/archive';
    return ageDays >= -16 && ageDays <= 92 ? [forecast, archive] : [archive, forecast];
  }

  function weatherDateIsFetchable(dateKey = '', now = new Date()) {
    const date = parseDate(dateKey);
    const current = now instanceof Date ? now : new Date(now);
    if (!date || Number.isNaN(current.getTime())) return true;
    const maxForecast = new Date(current.getFullYear(), current.getMonth(), current.getDate());
    maxForecast.setDate(maxForecast.getDate() + 16);
    return localDateSerial(date) <= localDateSerial(maxForecast);
  }

function pledgeWeatherWindowForDate(dateKey = '') {
    const date = parseDate(dateKey);
    const weekend = Boolean(date && (date.getDay() === 0 || date.getDay() === 6));
    return { startHour: weekend ? 15 : 17, endHourExclusive: 24, label: weekend ? '3 PM-midnight' : '5 PM-midnight' };
  }

  function stationPledgeWindowSummaries(hourly = {}) {
    const buckets = new Map();
    (hourly.time || []).forEach((stamp, index) => {
      const raw = text(stamp);
      const dateKey = raw.slice(0, 10);
      const hour = Number(raw.slice(11, 13));
      if (!dateKey || !Number.isFinite(hour)) return;
      const window = pledgeWeatherWindowForDate(dateKey);
      if (hour < window.startHour || hour >= window.endHourExclusive) return;
      if (!buckets.has(dateKey)) buckets.set(dateKey, { temps: [], precip: 0, windowLabel: window.label });
      const bucket = buckets.get(dateKey);
      const temp = Number(hourly.temperature_2m?.[index]);
      const precip = Number(hourly.precipitation?.[index]);
      if (Number.isFinite(temp)) bucket.temps.push(temp);
      if (Number.isFinite(precip)) bucket.precip += precip;
    });
    const summaries = new Map();
    buckets.forEach((bucket, dateKey) => {
      summaries.set(dateKey, {
        avgTemp: bucket.temps.length ? bucket.temps.reduce((sum, value) => sum + value, 0) / bucket.temps.length : null,
        precip: bucket.precip,
        windowLabel: bucket.windowLabel
      });
    });
    return summaries;
  }

  async function fetchStationWeather(location, startDate, endDate) {
    let lastError = null;
    for (const endpoint of weatherEndpointOrder(endDate)) {
      try {
        const params = new URLSearchParams({
          latitude: String(location.latitude),
          longitude: String(location.longitude),
          start_date: startDate,
          end_date: endDate,
          hourly: 'temperature_2m,precipitation',
          temperature_unit: 'fahrenheit',
          precipitation_unit: 'inch',
          timezone: 'America/Detroit'
        });
        const response = await fetch(`${endpoint}?${params.toString()}`);
        if (!response.ok) throw new Error(`${location.name} weather ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data?.hourly?.time)) throw new Error(`${location.name} weather response had no hourly data`);
        return { location, hourly: data.hourly };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`${location.name} weather unavailable`);
  }

  async function fetchWeatherForAnalysis(analysis = {}) {
    const dates = [...new Set((analysis.placementRows || []).map((row) => text(row.dateKey)).filter(Boolean))].sort();
    const fetchableDates = dates.filter((dateKey) => weatherDateIsFetchable(dateKey));
    if (!fetchableDates.length) return;
    const startDate = fetchableDates[0];
    const endDate = fetchableDates[fetchableDates.length - 1];
    const settled = await Promise.allSettled(WEATHER_LOCATIONS.map((location) => fetchStationWeather(location, startDate, endDate)));
    const successes = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value);
    if (!successes.length) throw new Error('Regional weather could not be loaded from Open-Meteo.');

    const perDate = new Map();
    successes.forEach(({ location, hourly }) => {
      stationPledgeWindowSummaries(hourly).forEach((summary, dateKey) => {
        if (!perDate.has(dateKey)) perDate.set(dateKey, []);
        perDate.get(dateKey).push({ location: location.name, ...summary });
      });
    });

    perDate.forEach((rows, dateKey) => {
      const average = (field) => {
        const values = rows.map((row) => Number(row[field])).filter(Number.isFinite);
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      };
      state.weatherByDate.set(dateKey, {
        stations: rows.length,
        avgTemp: average('avgTemp'),
        precip: average('precip'),
        wetStations: rows.filter((row) => Number(row.precip || 0) >= 0.01).length,
        windowLabel: rows[0]?.windowLabel || pledgeWeatherWindowForDate(dateKey).label
      });
    });
  }

  async function ensureWeatherForAnalyses(analyses = []) {
    const pending = analyses.filter((analysis) => {
      const id = text(analysis?.schedule?.id);
      return id && !state.weatherRequested.has(id);
    });
    if (!pending.length || state.weatherLoading) return;

    pending.forEach((analysis) => state.weatherRequested.add(text(analysis.schedule.id)));
    state.weatherLoading = true;
    state.weatherError = '';
    try {
      const settled = await Promise.allSettled(pending.map((analysis) => fetchWeatherForAnalysis(analysis)));
      const failed = settled.filter((item) => item.status === 'rejected');
      if (failed.length === settled.length && settled.length) state.weatherError = failed[0]?.reason?.message || 'Weather unavailable.';
    } finally {
      state.weatherLoading = false;
      renderPicker();
    }
  }

  function weatherMarkup(dateKey = '') {
    const weather = state.weatherByDate.get(text(dateKey));
    if (!weather) {
      if (!weatherDateIsFetchable(dateKey)) return '<span class="fc-weather-line muted">Weather not available yet</span>';
      if (state.weatherLoading) return '<span class="fc-weather-line loading">Loading U.P. weather…</span>';
      if (state.weatherError) return `<span class="fc-weather-line error">${escapeHtml(state.weatherError)}</span>`;
      return '<span class="fc-weather-line muted">Weather unavailable</span>';
    }
    const temp = Number.isFinite(weather.avgTemp) ? `${Math.round(weather.avgTemp)}°F avg` : 'temp —';
    const precip = Number.isFinite(weather.precip) ? `${weather.precip.toFixed(weather.precip < 0.1 ? 2 : 1)} in avg precip` : 'precip —';
    const wet = `${weather.wetStations}/${weather.stations} regions wet`;
    return `<span class="fc-weather-line">${escapeHtml(weather.windowLabel || 'Pledge window')} · ${escapeHtml(temp)} · ${escapeHtml(precip)} · ${escapeHtml(wet)}</span>`;
  }

  function compactBreakdown(map = new Map(), limit = 5) {
    return [...map.values()]
      .sort((a, b) => Number(b.dollars || 0) - Number(a.dollars || 0) || Number(b.minutes || 0) - Number(a.minutes || 0))
      .slice(0, limit)
      .map((item) => `<span class="fc-break-chip"><b>${escapeHtml(item.key)}</b>${escapeHtml(hoursLabel(item.minutes))} · ${escapeHtml(money(item.dollars))}</span>`)
      .join('');
  }

  function dailyProgrammingSummary(day = {}) {
    const topicItems = [...(day.topics || new Map()).values()]
      .sort((a, b) => Number(b.dollars || 0) - Number(a.dollars || 0) || Number(b.minutes || 0) - Number(a.minutes || 0))
      .slice(0, 3)
      .map((item) => `${item.key} ${hoursLabel(item.minutes)}`);
    const daypartItems = [...(day.dayparts || new Map()).values()]
      .sort((a, b) => Number(b.dollars || 0) - Number(a.dollars || 0) || Number(b.minutes || 0) - Number(a.minutes || 0))
      .slice(0, 2)
      .map((item) => item.key);
    const titleItems = [...(day.rows || [])]
      .sort((a, b) => Number(b.dollars || 0) - Number(a.dollars || 0) || Number(b.minutes || 0) - Number(a.minutes || 0))
      .slice(0, 3)
      .map((row) => `${timeLabel(row.startMinutes)} ${row.title}`);
    return { topics: topicItems.join(' · '), dayparts: daypartItems.join(' · '), titles: titleItems.join(' · ') };
  }

  function firstSaturdayAnchor(analysis = {}) {
  const importedDays = importedRowsForSchedule(analysis?.schedule || {})
    .map((row) => parseDate(importedDateKey(row)))
    .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b);
  const placementDays = calendarDays(analysis)
    .map((day) => day?.date || parseDate(day?.dateKey))
    .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b);
  const observedDays = importedDays.length ? importedDays : placementDays;
  const firstObservedSaturday = observedDays.find((date) => date.getDay() === 6);
  if (firstObservedSaturday) {
    return new Date(firstObservedSaturday.getFullYear(), firstObservedSaturday.getMonth(), firstObservedSaturday.getDate());
  }
  const startDate = observedDays[0] || parseDate(analysis?.schedule?.startDate);
  if (!startDate) return null;
  const anchor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
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
    const anchor = firstSaturdayAnchor(analysis);
    const anchorSerial = localDateSerial(anchor);
    const daySerial = localDateSerial(day?.date || parseDate(day?.dateKey));
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
    if (value === -1) return { title: 'Friday', detail: 'Day -1 · pre-Saturday start' };
    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekdayIndex = ((6 + value) % 7 + 7) % 7;
    const weekday = weekdayNames[weekdayIndex];
    if (value >= 0) {
      const occurrence = Math.floor(value / 7) + 1;
      return { title: `${ordinal(occurrence)} ${weekday}`, detail: `Day ${value}` };
    }
    return { title: weekday, detail: `Day ${value}` };
  }

  function alignedDailyContextRows(analyses = []) {
    const maps = analyses.map((analysis) => {
      const map = new Map();
      calendarDays(analysis).forEach((day) => {
        const offset = fundraiserDayOffset(analysis, day);
        if (Number.isFinite(offset) && offset >= -1) map.set(offset, day);
      });
      return map;
    });
    const maxOffsets = maps.map((map) => {
      const postSaturday = [...map.keys()].filter((offset) => offset >= 0);
      return postSaturday.length ? Math.max(...postSaturday) : null;
    });
    const offsets = [...new Set(maps.flatMap((map) => [...map.keys()]))]
      .filter((offset) => {
        if (offset === -1) return maps.some((map) => map.has(-1));
        if (offset < 0) return false;
        const comparableWindows = maxOffsets.filter((maxOffset) => Number.isFinite(maxOffset) && offset <= maxOffset).length;
        return comparableWindows >= 2;
      })
      .sort((a, b) => a - b);
    return offsets.map((offset) => ({ offset, days: maps.map((map) => map.get(offset) || null) }));
  }

  function renderDailyContextCard(day = null, analysis = {}) {
    if (!day) return '<article class="fc-day-context-card missing"><strong>No pledge programming this day</strong><span>This fundraiser has no pledge programming on the corresponding fundraiser day.</span></article>';
    const programming = dailyProgrammingSummary(day);
    const totalMinutes = Number(analysis.scheduledMinutes || 0);
    const totalDollars = Number(analysis.attributableDollars || 0);
    const hourShare = totalMinutes > 0 ? (Number(day.minutes || 0) / totalMinutes) * 100 : 0;
    const revenueShare = totalDollars > 0 ? (Number(day.dollars || 0) / totalDollars) * 100 : 0;
    return `<article class="fc-day-context-card"><header><div><strong>${escapeHtml(analysis.schedule.title)}</strong><span>${escapeHtml(day.dateLabel)}</span></div>${weatherMarkup(day.dateKey)}</header><div class="fc-day-context-metrics"><div><b>${escapeHtml(hoursLabel(day.minutes))}</b><span>fundraising</span></div><div><b>${escapeHtml(money(day.dollars))}</b><span>Broadcast</span></div><div><b>${escapeHtml(money(dollarsPerHour(day.dollars, day.minutes)))}</b><span>$/hr</span></div></div><div class="fc-day-context-share"><b>${Math.round(hourShare)}% hrs → ${Math.round(revenueShare)}% $</b><span>share of this fundraiser's attributable Broadcast results</span></div><div class="fc-day-context-programming"><strong>${escapeHtml(programming.topics || 'No topic detail')}</strong><span>${escapeHtml(programming.dayparts || 'No daypart detail')}</span><small>${escapeHtml(programming.titles || 'No program detail')}</small></div></article>`;
  }

  function dailyContextAnalyses(analyses = []) {
    return (analyses || []).filter((analysis) => calendarDays(analysis).length > 0);
  }

  function renderDailyContext(analyses = []) {
    const comparableAnalyses = dailyContextAnalyses(analyses);
    if (comparableAnalyses.length < 2) return '';
    const rows = alignedDailyContextRows(comparableAnalyses).map((row) => {
      const label = fundraiserDayLabel(row.offset);
      const cards = row.days.map((day, index) => renderDailyContextCard(day, comparableAnalyses[index])).join('');
      return `<div class="fc-day-match-row"><div class="fc-day-match-label"><strong>${escapeHtml(label.title)}</strong><span>${escapeHtml(label.detail)}</span></div><div class="fc-day-match-grid" style="grid-template-columns:repeat(${comparableAnalyses.length},minmax(260px,1fr))">${cards}</div></div>`;
    }).join('');
    return `<section class="fc-panel fc-day-context"><div class="fc-panel-head"><div><h3>Weather, income and programming by corresponding fundraiser day</h3><span>Imported fundraiser history establishes the actual historical calendar whenever it exists. Days are then aligned by fundraiser sequence, not by calendar date: first Saturday with first Saturday, first Sunday with first Sunday, second Saturday with second Saturday, and so on. Day 0 is the first Saturday; only the Friday immediately before it can appear as Day -1. Extra tail days that fall outside the shared comparison window are omitted.</span></div></div>${rows}<div class="fc-weather-source">WNMU dayparts: Morning 7:00–11:30 AM · Afternoon 12:00–4:30 PM · Early evening 5:00–7:30 PM · Prime 8:00–10:00 PM · Overnight 10:30 PM–6:30 AM. Weather source: Open-Meteo five-location U.P. composite.</div></section>`;
  }

function renderWeatherScatter(analyses = []) {
    const points = [];
    analyses.forEach((analysis, analysisIndex) => {
      calendarDays(analysis).forEach((day) => {
        const weather = state.weatherByDate.get(text(day.dateKey));
        if (!weather || !Number.isFinite(weather.avgTemp) || !Number.isFinite(weather.precip)) return;
        const offset = fundraiserDayOffset(analysis, day);
        if (Number.isFinite(offset) && offset < -1) return;
        const label = Number.isFinite(offset) ? fundraiserDayLabel(offset).title : day.weekday;
        const programming = dailyProgrammingSummary(day);
        points.push({
          analysis,
          analysisIndex,
          day,
          weather,
          label,
          rate: dollarsPerHour(day.dollars, day.minutes),
          hours: Number(day.minutes || 0) / 60,
          programming
        });
      });
    });
    if (points.length < 2) {
      if (state.weatherLoading) return '<section class="fc-panel"><h3>Weather & pledge performance</h3><div class="fc-chart-empty">Loading pledge-window weather for the scatter view…</div></section>';
      return '';
    }
    const width = 880;
    const height = 390;
    const pad = { left: 72, right: 28, top: 24, bottom: 62 };
    const temps = points.map((point) => point.weather.avgTemp);
    const precips = points.map((point) => point.weather.precip);
    let minTemp = Math.floor(Math.min(...temps) / 5) * 5;
    let maxTemp = Math.ceil(Math.max(...temps) / 5) * 5;
    if (minTemp === maxTemp) { minTemp -= 5; maxTemp += 5; }
    const maxPrecip = Math.max(0.05, ...precips);
    const maxRate = Math.max(1, ...points.map((point) => point.rate));
    const maxHours = Math.max(1, ...points.map((point) => point.hours));
    const x = (temp) => pad.left + ((temp - minTemp) / (maxTemp - minTemp)) * (width - pad.left - pad.right);
    const y = (precip) => pad.top + (height - pad.top - pad.bottom) * (1 - (precip / maxPrecip));
    const xTicks = Array.from({ length: 5 }, (_, index) => minTemp + ((maxTemp - minTemp) * index / 4));
    const yTicks = Array.from({ length: 5 }, (_, index) => maxPrecip * index / 4);
    const circles = points.map((point) => {
      const radius = 5 + 9 * Math.sqrt(point.hours / maxHours);
      const opacity = 0.28 + 0.67 * Math.sqrt(Math.max(0, point.rate) / maxRate);
      const title = `${point.analysis.schedule.title} · ${point.label} · ${point.day.dateLabel} · ${point.weather.windowLabel}: ${Math.round(point.weather.avgTemp)}°F avg, ${point.weather.precip.toFixed(2)} in avg precip · ${money(point.day.dollars)} Broadcast · ${hoursLabel(point.day.minutes)} · ${money(point.rate)}/hr · ${point.programming.topics || 'No topic detail'} · ${point.programming.titles || 'No program detail'}`;
      return `<circle cx="${x(point.weather.avgTemp).toFixed(1)}" cy="${y(point.weather.precip).toFixed(1)}" r="${radius.toFixed(1)}" fill="hsl(${chartHue(point.analysisIndex)} 65% 45% / ${opacity.toFixed(2)})" stroke="hsl(${chartHue(point.analysisIndex)} 65% 32%)" stroke-width="1.5"><title>${escapeHtml(title)}</title></circle>`;
    }).join('');
    const legend = analyses.map((analysis, index) => `<span class="fc-weather-legend-item"><i style="background:hsl(${chartHue(index)} 65% 45%)"></i>${escapeHtml(analysis.schedule.title)} ${escapeHtml(String(analysis.schedule.year || ''))}</span>`).join('');
    return `<section class="fc-panel fc-weather-scatter"><div class="fc-panel-head"><div><h3>Weather & pledge performance</h3><span>Each point is one fundraiser day. X = average temperature during the pledge window; Y = average precipitation across the five U.P. locations. Larger points mean more fundraising hours; stronger point intensity means higher Broadcast $/fundraising hour.</span></div></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Weather and pledge performance scatter"><rect x="0" y="0" width="${width}" height="${height}" fill="#fbfdfe"></rect>${yTicks.map((tick) => `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}" stroke="#dfe9ed"></line><text x="${pad.left - 10}" y="${y(tick) + 4}" text-anchor="end" font-size="12" fill="#607685">${tick.toFixed(tick < 0.1 ? 2 : 1)} in</text>`).join('')}${xTicks.map((tick) => `<line x1="${x(tick)}" x2="${x(tick)}" y1="${pad.top}" y2="${height - pad.bottom}" stroke="#edf2f4"></line><text x="${x(tick)}" y="${height - 32}" text-anchor="middle" font-size="12" fill="#607685">${Math.round(tick)}°F</text>`).join('')}<text x="${width / 2}" y="${height - 8}" text-anchor="middle" font-size="13" font-weight="700" fill="#29465b">Average pledge-window temperature</text><text x="16" y="${height / 2}" text-anchor="middle" font-size="13" font-weight="700" fill="#29465b" transform="rotate(-90 16 ${height / 2})">Average pledge-window precipitation</text>${circles}</svg><div class="fc-weather-legend">${legend}</div><div class="fc-weather-scatter-note">Weather window: Monday-Friday 5 PM-midnight; Saturday-Sunday 3 PM-midnight. Point intensity is a visual performance cue, not evidence that weather caused the result. Hover a point for the day, dollars, hours and leading programming.</div></section>`;
  }

  function renderCalendarDay(day = null) {
    if (!day) return '<div class="fc-calendar-day missing"><strong>No matching weekday</strong><span>This fundraiser did not have a comparable day in this position.</span></div>';
    const programs = day.rows.map((row) => {
      const result = row.known ? money(row.dollars) : 'Result pending';
      const secondary = row.secondary && row.secondary !== 'Unspecified' ? ` › ${row.secondary}` : '';
      return `<div class="fc-calendar-program"><div class="fc-calendar-time">${escapeHtml(timeLabel(row.startMinutes))}</div><div class="fc-calendar-program-copy"><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(row.topic)}${escapeHtml(secondary)} · ${escapeHtml(hoursLabel(row.minutes))}</span></div><div class="fc-calendar-program-money ${row.known ? '' : 'pending'}">${escapeHtml(result)}</div></div>`;
    }).join('');
    return `<article class="fc-calendar-day"><header><div><strong>${escapeHtml(day.weekday)}</strong><span>${escapeHtml(day.dateLabel)}</span></div>${weatherMarkup(day.dateKey)}</header><div class="fc-calendar-day-metrics"><div><span>Broadcast $</span><strong>${escapeHtml(money(day.dollars))}</strong></div><div><span>Hours</span><strong>${escapeHtml(hoursLabel(day.minutes))}</strong></div></div><div class="fc-calendar-breakdown"><b>Topics</b><div>${compactBreakdown(day.topics)}</div></div><div class="fc-calendar-breakdown"><b>Dayparts</b><div>${compactBreakdown(day.dayparts)}</div></div><div class="fc-calendar-programs">${programs}</div></article>`;
  }

  function renderCalendarComparison(base, current) {
    const pairs = pairCalendarDays(base, current);
    const rows = pairs.map((pair) => `<div class="fc-calendar-pair">${renderCalendarDay(pair.base)}${renderCalendarDay(pair.current)}</div>`).join('');
    return `<section class="fc-panel fc-calendar-panel"><div class="fc-panel-head"><div><h3>Calendar comparison</h3><span>Days are paired by weekday occurrence. Daily dollars are attributable Broadcast $ from scheduled program results. Weather is a five-location U.P. composite.</span></div></div><div class="fc-calendar-head"><div><strong>A · ${escapeHtml(base.schedule.title)}</strong><span>${escapeHtml(String(base.schedule.year || ''))}</span></div><div><strong>B · ${escapeHtml(current.schedule.title)}</strong><span>${escapeHtml(String(current.schedule.year || ''))}</span></div></div>${rows || '<div class="fc-chart-empty">No scheduled days to compare.</div>'}<div class="fc-weather-source">Historical weather context: Open-Meteo, using Ironwood, Houghton, Marquette, Escanaba, and Sault Ste. Marie. Weather is context only, not treated as causal.</div></section>`;
  }

  function selectedAnalyses() {
    return [...state.selectedIds]
      .map((id) => state.schedules.find((schedule) => schedule.id === id))
      .filter(Boolean)
      .map(analysisForSchedule);
  }

  function filteredSchedules() {
    return state.schedules.filter((schedule) => state.season === 'all' || schedule.season === state.season);
  }

  function renderPicker() {
    const host = root();
    if (!host) return;

    const list = filteredSchedules();
    const selectedCount = state.selectedIds.size;
    if (state.compareAId && !state.selectedIds.has(state.compareAId)) state.compareAId = '';
    if (state.compareBId && !state.selectedIds.has(state.compareBId)) state.compareBId = '';

    const analyses = selectedAnalyses();
    const policy = analyses.length >= 2 ? comparisonChannelPolicy(analyses) : null;
    const rows = list.map((schedule) => {
      const analysis = analysisForSchedule(schedule);
      const displayTotal = policy ? comparableTotalForPolicy(analysis, policy) : analysis.recordedTotal;
      const extras = policy ? excludedChannelLines(analysis, policy) : [];
      const duplicateLine = Number(schedule.duplicateRangeCount || 0) > 1
        ? `<small class="fc-drive-duplicate">Same date range has ${number(schedule.duplicateRangeCount)} saved records · this is record ${number(schedule.duplicateRangeIndex)} · ${escapeHtml(text(schedule.id).slice(0, 8))}</small>`
        : '';
      return `<label class="fc-drive-option"><input type="checkbox" value="${escapeHtml(schedule.id)}" ${state.selectedIds.has(schedule.id) ? 'checked' : ''}><span class="fc-drive-copy"><strong>${escapeHtml(schedule.title)}</strong><small>${escapeHtml(formatDateRange(schedule))}</small>${duplicateLine}<span class="fc-drive-stats"><b>${policy ? 'Comparable' : 'Recorded'} $ ${escapeHtml(money(displayTotal))}</b><b>Total hours ${escapeHtml(hoursLabel(analysis.scheduledMinutes))}</b></span>${extras.length ? `<span class="fc-drive-extras">${extras.map((line) => `<small>${escapeHtml(line)}</small>`).join('')}</span>` : ''}</span></label>`;
    }).join('');

    const comparison = analyses.length < 2
      ? '<div class="fc-empty"><strong>Select at least two fundraisers.</strong><span>The peer charts will appear without forcing any fundraiser to be the baseline.</span></div>'
      : renderComparison(analyses);

    host.innerHTML = `<style>${styles()}</style><section class="fc-shell"><header class="fc-head"><div><div class="fc-kicker">Fundraiser analysis workspace</div><h2>Fundraiser Comparison Lab</h2><div class="fc-subtitle">Peer comparison first. Use A/B diagnostics only when you want to investigate a specific difference.</div></div><span class="fc-beta">BETA</span></header><section class="fc-controls"><label><span>Pledge season</span><select id="fc-season"><option value="all">All pledge seasons</option>${SEASONS.map((season) => `<option value="${season}" ${state.season === season ? 'selected' : ''}>${season}</option>`).join('')}</select></label><div class="fc-selection-note">${number(selectedCount)} fundraiser${selectedCount === 1 ? '' : 's'} selected</div><button type="button" id="fc-clear">Clear selection</button><button type="button" id="fc-reload">Reload data</button></section><div class="fc-layout"><aside class="fc-picker"><h3>Choose fundraisers</h3><div class="fc-drive-list">${rows || '<div class="fc-chart-empty">No saved fundraisers match this season.</div>'}</div></aside><main class="fc-results">${comparison}</main></div></section>`;

    host.querySelector('#fc-season')?.addEventListener('change', (event) => {
      state.season = event.target.value || 'all';
      state.selectedIds.clear();
      state.compareAId = '';
      state.compareBId = '';
      state.selectedTopic = '';
      renderPicker();
    });
    host.querySelector('#fc-clear')?.addEventListener('click', () => {
      state.selectedIds.clear();
      state.compareAId = '';
      state.compareBId = '';
      state.selectedTopic = '';
      renderPicker();
    });
    host.querySelector('#fc-reload')?.addEventListener('click', () => {
      state.ready = false;
      void ensureReady({ force: true });
    });
    host.querySelectorAll('.fc-drive-option input').forEach((input) => input.addEventListener('change', () => {
      if (input.checked) state.selectedIds.add(input.value);
      else {
        state.selectedIds.delete(input.value);
        if (state.compareAId === input.value) state.compareAId = '';
        if (state.compareBId === input.value) state.compareBId = '';
      }
      renderPicker();
    }));
    host.querySelector('#fc-compare-a')?.addEventListener('change', (event) => {
      state.compareAId = event.target.value || '';
      renderPicker();
    });
    host.querySelector('#fc-compare-b')?.addEventListener('change', (event) => {
      state.compareBId = event.target.value || '';
      renderPicker();
    });
    host.querySelectorAll('[data-topic-drill]').forEach((button) => button.addEventListener('click', () => {
      state.selectedTopic = button.dataset.topicDrill || '';
      renderPicker();
      document.querySelector('.fc-topic-drill')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }));
    host.querySelector('#fc-topic-drill-close')?.addEventListener('click', () => {
      state.selectedTopic = '';
      renderPicker();
    });

    const weatherAnalyses = dailyContextAnalyses(analyses);
    if (weatherAnalyses.length >= 2) void ensureWeatherForAnalyses(weatherAnalyses);
  }

  function renderComparison(analyses) {
    const policy = comparisonChannelPolicy(analyses);
    const comparableTotals = analyses.map((analysis) => comparableTotalForPolicy(analysis, policy)).sort((a, b) => a - b);
    const medianTotal = comparableTotals.length % 2
      ? comparableTotals[Math.floor(comparableTotals.length / 2)]
      : (comparableTotals[(comparableTotals.length / 2) - 1] + comparableTotals[comparableTotals.length / 2]) / 2;
    const cards = analyses.map((analysis) => {
      const comparableTotal = comparableTotalForPolicy(analysis, policy);
      const onlineLine = policy.includeOnline ? `Online ${money(analysis.onlineDollars)}` : (analysis.onlineTracked ? `Additional Online monies ${money(analysis.onlineDollars)} · not included` : 'Online not tracked');
      const mailLine = policy.includeMail ? `Mail ${money(analysis.mailDollars)}` : (analysis.mailTracked ? `Additional Mail monies ${money(analysis.mailDollars)} · not included` : 'Mail not tracked');
      const medianDelta = comparableTotal - medianTotal;
      const recordLine = Number(analysis.schedule.duplicateRangeCount || 0) > 1 ? `Saved record ${analysis.schedule.duplicateRangeIndex} of ${analysis.schedule.duplicateRangeCount} for this date range` : '';
      return `<article class="fc-summary-card"><div class="fc-card-kicker">Selected fundraiser</div><h3>${escapeHtml(analysis.schedule.title)}</h3><div class="fc-total">${money(comparableTotal)}</div><div class="fc-total-label">Comparable total $</div><div class="fc-summary-metrics"><span><b>${escapeHtml(hoursLabel(analysis.scheduledMinutes))}</b> fundraising</span><span><b>${escapeHtml(money(analysis.broadcastDollars))}</b> Broadcast $</span><span><b>${escapeHtml(money(dollarsPerHour(analysis.broadcastDollars, analysis.scheduledMinutes)))}</b> Broadcast $/hr</span></div><div class="fc-mini"><span>Selected median ${escapeHtml(money(medianTotal))} · ${escapeHtml(signedMoney(medianDelta))}</span>${recordLine ? `<span class="fc-duplicate-summary">${escapeHtml(recordLine)}</span>` : ''}<span>${escapeHtml(onlineLine)}</span><span>${escapeHtml(mailLine)}</span></div></article>`;
    }).join('');

    const options = analyses.map((analysis) => `<option value="${escapeHtml(analysis.schedule.id)}">${escapeHtml(analysis.schedule.title)} · ${escapeHtml(String(analysis.schedule.year || ''))}</option>`).join('');
    const optionA = options.replace(`value="${escapeHtml(state.compareAId)}"`, `value="${escapeHtml(state.compareAId)}" selected`);
    const optionB = options.replace(`value="${escapeHtml(state.compareBId)}"`, `value="${escapeHtml(state.compareBId)}" selected`);
    const compareA = state.compareAId ? analyses.find((analysis) => analysis.schedule.id === state.compareAId) || null : null;
    const compareB = state.compareBId ? analyses.find((analysis) => analysis.schedule.id === state.compareBId) || null : null;
    const pairReady = Boolean(compareA && compareB && compareA.schedule.id !== compareB.schedule.id);
    const pairPrompt = compareA && compareB && compareA.schedule.id === compareB.schedule.id
      ? '<div class="fc-empty"><strong>Choose two different fundraisers.</strong><span>A and B are deliberately explicit so the comparison has a clear meaning.</span></div>'
      : '<div class="fc-empty"><strong>Optional deeper comparison.</strong><span>Choose Fundraiser A and Fundraiser B only when you want to investigate a particular difference. The peer charts above do not use a baseline.</span></div>';
    const pairContent = pairReady
      ? `${comparisonFindingGrid(compareA, compareB, policy)}${renderOverallRevenueDecomposition(compareA, compareB)}<section class="fc-section-label"><strong>Why did things change?</strong><span>Fundraiser length, topic share, daypart, and topic/program mix are separated where possible.</span></section>${renderTopicDiagnostics(compareA, compareB)}<section class="fc-section-label"><strong>Calendar comparison</strong><span>Weekday, weather, daily Broadcast $, topics, dayparts, and individual program results together.</span></section>${renderCalendarComparison(compareA, compareB)}<section class="fc-section-label"><strong>Revenue difference A → B</strong><span>Rows include revenue delta plus A → B hours and $/hour.</span></section><section class="fc-difference-pair"><div class="fc-difference-title"><strong>${escapeHtml(compareA.schedule.title)} → ${escapeHtml(compareB.schedule.title)}</strong><span>explicit A/B diagnostic</span></div><div class="fc-difference-grid">${renderDifferenceChart(compareA, compareB, 'topics', 'Topic income difference')}${renderDifferenceChart(compareA, compareB, 'times', 'Time-slot income difference')}</div></section>`
      : pairPrompt;

    return `<div class="fc-comparable-note"><strong>Comparison basis: ${escapeHtml(channelBasisLabel(policy))}</strong><span>${escapeHtml(comparisonChannelNote(analyses, policy))} Selected median is a neutral reference only; no fundraiser is treated as the permanent baseline.</span></div><div class="fc-summary-grid">${cards}</div>${renderDailyContext(analyses)}${renderWeatherScatter(dailyContextAnalyses(analyses))}${renderTopicScheduleMix(analyses)}${renderTimeScheduleMix(analyses)}${renderTopicHeatmap(analyses)}${renderTopicDrilldown(analyses, state.selectedTopic)}<section class="fc-panel fc-ab-controls"><div class="fc-panel-head"><div><h3>Optional A/B diagnostic comparison</h3><span>Peer comparison is the default. Pick two drives here only when you want a directional A → B explanation.</span></div></div><div class="fc-ab-control-grid"><label><span>Fundraiser A</span><select id="fc-compare-a"><option value="">Choose A…</option>${optionA}</select></label><label><span>Fundraiser B</span><select id="fc-compare-b"><option value="">Choose B…</option>${optionB}</select></label></div></section>${pairContent}<div class="fc-note-grid"><div class="fc-note-card"><strong>Channel rule</strong><span>${escapeHtml(comparisonChannelNote(analyses, policy))}</span></div><div class="fc-note-card"><strong>Weather rule</strong><span>Weather is regional context only. It is shown beside schedule and revenue evidence so the reviewer can form their own conclusions.</span></div></div>`;
  }

  function styles() {
    return `
      .fc-shell{padding:18px;max-width:1500px;margin:0 auto;color:#1e3140}.fc-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;background:#fff;border:1px solid #d6e4ea;border-radius:18px;padding:16px;margin-bottom:12px}.fc-head h2{margin:2px 0 4px;color:#0c3159}.fc-subtitle{color:#5f7383;margin-top:4px}.fc-kicker{font-size:.72rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#12867f}.fc-beta{font-size:.72rem;font-weight:900;border-radius:999px;background:#fff8e8;color:#765400;padding:5px 9px;border:1px solid #ead69e}.fc-controls{display:flex;gap:10px;align-items:end;flex-wrap:wrap;background:#fff;border:1px solid #d6e4ea;border-radius:16px;padding:12px;margin-bottom:12px}.fc-controls label{display:grid;gap:4px}.fc-controls label span{font-size:.72rem;font-weight:900;text-transform:uppercase;color:#5f7383}.fc-controls select,.fc-controls button{border:1px solid #d6e4ea;border-radius:10px;padding:8px 10px;background:#fff;color:#103a66;font:inherit}.fc-controls select:disabled{opacity:.55}.fc-baseline-control{min-width:260px}.fc-selection-note{font-weight:800;color:#103a66;padding:8px}.fc-layout{display:grid;grid-template-columns:minmax(280px,350px) minmax(0,1fr);gap:12px;align-items:start}.fc-picker,.fc-panel{background:#fff;border:1px solid #d6e4ea;border-radius:16px;padding:13px}.fc-picker{position:sticky;top:8px}.fc-picker h3,.fc-panel h3{margin:0 0 9px;color:#0c3159}.fc-drive-list{display:grid;gap:6px;max-height:70vh;overflow:auto}.fc-drive-option{display:flex;gap:8px;align-items:flex-start;padding:8px;border:1px solid #e0ebef;border-radius:10px;background:#f8fbfc;cursor:pointer}.fc-drive-option input{margin-top:3px}.fc-drive-copy{display:grid;gap:2px;min-width:0}.fc-drive-copy small{color:#5f7383}.fc-drive-stats{display:flex!important;gap:5px!important;flex-wrap:wrap;margin-top:3px}.fc-drive-stats b{font-size:.72rem;color:#103a66;background:#eaf4f8;border-radius:999px;padding:2px 6px}.fc-results{display:grid;gap:12px;min-width:0}.fc-empty{background:#fff;border:1px dashed #b9d3df;border-radius:16px;padding:22px;color:#5f7383;display:grid;gap:4px}.fc-empty strong{color:#103a66}.fc-baseline-prompt{border-color:#d7c37f;background:#fffdf6}.fc-comparable-note{background:#eef7fb;border:1px solid #cfe2ea;border-radius:14px;padding:10px 12px;display:grid;gap:3px}.fc-comparable-note strong{color:#103a66}.fc-comparable-note span{color:#5f7383;font-size:.8rem;line-height:1.35}.fc-drive-extras{display:grid!important;gap:1px!important;margin-top:2px}.fc-drive-extras small{font-size:.69rem;color:#7a6740}.fc-drive-duplicate,.fc-duplicate-summary{color:#8a5f15!important;font-weight:800}.fc-topic-pair-label em{font-style:normal;font-size:.7rem;font-weight:800;color:#31566e}.fc-topic-metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:5px;margin-top:4px}.fc-topic-metric-chip{display:grid;gap:1px;border:1px solid #e1eaee;border-radius:8px;background:#fbfdfe;padding:5px 6px}.fc-topic-metric-chip span{font-size:.66rem;color:#607685}.fc-strength-line b{color:#103a66}.fc-strength-line em{font-style:normal;font-weight:900;color:#8a5f15}.fc-topic-why{display:grid;gap:5px;background:#eef7fb;border-radius:9px;padding:7px}.fc-topic-why>strong{font-size:.76rem;color:#103a66}.fc-topic-context{display:flex;gap:5px;flex-wrap:wrap}.fc-topic-context span{font-size:.67rem;color:#536d7d;background:#fff;border:1px solid #dbe7eb;border-radius:999px;padding:2px 6px}.fc-explanation-check{display:grid;gap:5px;border:1px solid #cfe2ea;background:#f7fbfd;border-radius:10px;padding:8px}.fc-explanation-check>strong{color:#103a66;font-size:.76rem}.fc-explanation-check p{margin:0;color:#29465b;font-size:.75rem;font-weight:800}.fc-explanation-check>div{display:flex;gap:5px;flex-wrap:wrap}.fc-explanation-check>div span{font-size:.67rem;color:#536d7d;background:#fff;border:1px solid #dbe7eb;border-radius:999px;padding:3px 6px}.fc-explanation-check>div b{color:#103a66}.fc-explanation-check small{color:#6d8291;font-size:.66rem;line-height:1.3}.fc-subtopic-group{border:1px solid #cfe2ea;border-radius:10px;background:#f8fbfc;padding:7px}.fc-subtopic-group>summary{cursor:pointer;color:#103a66;font-size:.75rem;font-weight:900}.fc-subtopic-diagnostics{display:grid;gap:6px;margin-top:7px}.fc-subtopic-diagnostic{border:1px solid #dde9ed;border-radius:9px;background:#fff;padding:6px 8px}.fc-subtopic-diagnostic>summary{cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:center;list-style-position:inside}.fc-subtopic-diagnostic>summary>span{display:grid;gap:1px}.fc-subtopic-diagnostic>summary strong{color:#103a66;font-size:.74rem}.fc-subtopic-diagnostic>summary small{color:#6d8291;font-size:.65rem}.fc-subtopic-diagnostic>summary>b{font-size:.74rem}.fc-subtopic-explanation{display:grid;gap:5px;padding:7px 0 2px}.fc-subtopic-explanation>strong{font-size:.72rem;color:#29465b}.fc-subtopic-explanation p{margin:0;font-size:.7rem;font-weight:800;color:#3f5c6e}.fc-subtopic-effect-grid{display:flex;gap:4px;flex-wrap:wrap}.fc-subtopic-effect-grid span{font-size:.64rem;color:#536d7d;background:#f6fafc;border:1px solid #dbe7eb;border-radius:999px;padding:3px 6px}.fc-subtopic-effect-grid b{color:#103a66}.fc-subtopic-explanation>small{font-size:.64rem;color:#708591;line-height:1.3}.fc-ab-controls{background:#f6fafc}.fc-ab-control-grid{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:9px}.fc-ab-control-grid label{display:grid;gap:4px}.fc-ab-control-grid label>span{font-size:.7rem;text-transform:uppercase;font-weight:900;color:#5f7383}.fc-ab-control-grid select{border:1px solid #d6e4ea;border-radius:10px;padding:8px 10px;background:#fff;color:#103a66;font:inherit}.fc-topic-drill-programs{display:block;margin-top:3px;font-weight:500!important;white-space:normal;color:#6d8291!important}.fc-topic-drill-button{border:0;background:transparent;padding:0;color:#103a66;font:inherit;font-weight:900;text-align:left;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:3px}.fc-topic-drill-button:hover{color:#12867f}.fc-topic-drill-table{width:100%;border-collapse:collapse;font-size:.8rem}.fc-topic-drill-table th,.fc-topic-drill-table td{padding:8px;border-bottom:1px solid #e2ecef;text-align:left;vertical-align:middle}.fc-topic-drill-table thead th{background:#eef7fb;color:#103a66}.fc-topic-drill-table th span{display:block;font-size:.7rem;color:#5f7383}.fc-topic-drill-table td{text-align:center;min-width:120px}.fc-topic-drill-table td strong,.fc-topic-drill-table td span,.fc-topic-drill-table td small{display:block}.fc-topic-drill-table td span{font-weight:900;color:#103a66}.fc-topic-drill-table td small{color:#5f7383}.fc-topic-drill-close{align-self:start}.fc-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:9px}.fc-summary-card{background:#fff;border:1px solid #d6e4ea;border-radius:15px;padding:12px}.fc-summary-card.baseline{border-color:#12867f;background:#f1faf8}.fc-card-kicker{font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;font-weight:900;color:#5f7383}.fc-summary-card h3{margin:3px 0 6px;color:#103a66}.fc-total{font-size:1.5rem;font-weight:950;color:#1d5f96}.fc-total-label{font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;font-weight:900;color:#5f7383;margin-top:-2px}.fc-summary-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin:8px 0}.fc-summary-metrics span{background:#f4f8fa;border-radius:8px;padding:6px;font-size:.7rem;color:#5f7383}.fc-summary-metrics b{display:block;color:#103a66;font-size:.86rem}.fc-mini{display:grid;gap:2px;margin-top:6px;font-size:.8rem;color:#5f7383}.fc-panel-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}.fc-panel-head h3{margin:0}.fc-panel-head span{display:block;color:#5f7383;font-size:.78rem;margin-top:2px}.fc-chart-empty{color:#5f7383;padding:10px 0}.fc-stack-track{height:28px;background:#e6eef2;border-radius:8px;overflow:hidden;display:flex}.fc-stack-segment{height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:.7rem;font-weight:900;min-width:1px}.fc-legend{display:flex;flex-wrap:wrap;gap:7px 12px;margin:8px 0 4px}.fc-legend-item{display:inline-flex;align-items:center;gap:5px;color:#5f7383;font-size:.74rem}.fc-legend-item i{width:10px;height:10px;border-radius:3px;display:inline-block}.fc-topic-pair-chart{display:grid;gap:13px}.fc-topic-pair-row{display:grid;grid-template-columns:minmax(145px,210px) minmax(0,1fr);gap:10px;align-items:center}.fc-topic-pair-label{display:grid;gap:2px}.fc-topic-pair-label span{font-size:.72rem;color:#5f7383}.fc-topic-pair-bars{display:grid;gap:5px}.fc-share-line{display:grid;grid-template-columns:58px minmax(220px,1fr) 74px;gap:7px;align-items:center}.fc-share-line>b{font-size:.7rem;text-transform:uppercase;color:#5f7383}.fc-share-line>span{text-align:right;font-size:.72rem;font-weight:900;color:#103a66}.fc-time-matrix-head,.fc-time-matrix-row{display:grid;gap:8px}.fc-time-matrix-head{align-items:end;margin-bottom:6px}.fc-time-head{display:grid;gap:1px;color:#103a66;font-size:.75rem}.fc-time-head span{font-size:.68rem;color:#5f7383}.fc-time-matrix{display:grid;gap:6px;overflow-x:auto}.fc-time-label{font-size:.76rem;font-weight:900;color:#103a66;padding-top:7px}.fc-time-cell{background:#f7fafb;border:1px solid #e1eaee;border-radius:9px;padding:5px;display:grid;gap:3px}.fc-time-metric{display:grid;grid-template-columns:16px minmax(50px,1fr) 64px;gap:4px;align-items:center}.fc-time-metric>b{font-size:.66rem;color:#6d8291}.fc-time-metric>div{height:7px;background:#e5edf1;border-radius:999px;overflow:hidden}.fc-time-metric>div span{display:block;height:100%;border-radius:999px}.fc-time-metric>strong{font-size:.68rem;text-align:right;color:#29465b}.fc-time-cell>small{text-align:right;color:#5f7383;font-size:.66rem}.fc-table-wrap{overflow:auto}.fc-heatmap{width:100%;border-collapse:collapse;font-size:.82rem}.fc-heatmap th,.fc-heatmap td{padding:8px;border-bottom:1px solid #e2ecef;text-align:left;vertical-align:middle}.fc-heatmap thead th{background:#eef7fb;color:#103a66}.fc-heatmap th span{display:block;font-size:.7rem;color:#5f7383;margin-top:2px}.fc-heatmap tbody th{background:#f8fbfc;white-space:nowrap}.fc-heat-cell,.fc-heat-zero{text-align:center!important;font-weight:900;min-width:110px}.fc-heat-cell strong{display:block}.fc-heat-cell span{display:block;font-size:.68rem;font-weight:700;margin-top:2px}.fc-heat-cell small{display:block;font-size:.62rem;font-weight:700;margin-top:2px}.fc-heat-zero{background:#f5f8f9;color:#8ca0ad}.fc-heat-dark{color:#fff}.fc-heat-zero-money{outline:1px dashed #c5d4da;outline-offset:-3px;color:#4f6877}.fc-heat-scale{display:flex;align-items:center;gap:5px;color:#5f7383;font-size:.7rem}.fc-heat-scale i{width:78px;height:10px;border-radius:999px;background:linear-gradient(90deg,rgba(29,95,150,.10),rgba(29,95,150,.88))}.fc-section-label{display:flex;justify-content:space-between;gap:12px;align-items:end;padding:4px 2px}.fc-section-label strong{color:#0c3159}.fc-section-label span{color:#5f7383;font-size:.76rem;text-align:right}      .fc-overall-effect-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.fc-overall-effect-grid>div{background:#f5fafc;border:1px solid #d9e7ec;border-radius:12px;padding:10px;display:grid;gap:2px}.fc-overall-effect-grid span{font-size:.68rem;text-transform:uppercase;font-weight:900;color:#5f7383}.fc-overall-effect-grid strong{font-size:1.05rem;color:#103a66}.fc-overall-effect-grid strong.positive{color:#0d736d}.fc-overall-effect-grid strong.negative{color:#a32538}.fc-overall-effect-grid small{font-size:.7rem;color:#5f7383}.fc-overall-reconcile{margin-top:7px;font-size:.7rem;color:#6d8291}.fc-day-context{display:grid;gap:10px}.fc-day-match-row{display:grid;grid-template-columns:115px minmax(0,1fr);gap:9px;align-items:start;border-top:1px solid #e5edef;padding-top:10px}.fc-day-match-row:first-of-type{border-top:0;padding-top:0}.fc-day-match-label{display:grid;gap:1px;position:sticky;left:0;background:#fff;padding:6px 4px;z-index:1}.fc-day-match-label strong{color:#103a66}.fc-day-match-label span{font-size:.68rem;color:#6d8291}.fc-day-match-grid{display:grid;gap:9px;overflow-x:auto;padding-bottom:2px}.fc-day-context-card{border:1px solid #dbe7eb;border-radius:12px;background:#fbfdfe;padding:9px;display:grid;gap:7px;min-width:0}.fc-day-context-card.missing{align-content:center;min-height:135px;color:#7d909d;background:#f7f9fa}.fc-day-context-card.missing strong{color:#647986}.fc-day-context-card.missing span{font-size:.7rem}.fc-day-context-card>header{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.fc-day-context-card>header>div{display:grid;gap:1px;min-width:0}.fc-day-context-card>header strong{color:#103a66;overflow-wrap:anywhere}.fc-day-context-card>header span{font-size:.68rem;color:#5f7383}.fc-day-context-card .fc-weather-line{max-width:55%;text-align:right;font-size:.64rem!important}.fc-day-context-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.fc-day-context-metrics>div{background:#eef7fb;border-radius:8px;padding:6px;display:grid;gap:1px}.fc-day-context-metrics b{color:#103a66;font-size:.84rem}.fc-day-context-metrics span{font-size:.62rem;text-transform:uppercase;font-weight:900;color:#6d8291}.fc-day-context-share{display:grid;gap:1px;background:#f4f8fa;border-radius:8px;padding:6px}.fc-day-context-share b{color:#103a66;font-size:.74rem}.fc-day-context-share span{font-size:.64rem;color:#657b89}.fc-day-context-programming{display:grid;gap:2px}.fc-day-context-programming strong{color:#103a66;font-size:.74rem}.fc-day-context-programming span,.fc-day-context-programming small{font-size:.65rem;color:#657b89;line-height:1.3}.fc-finding-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}.fc-finding{background:#f5fafc;border:1px solid #d9e7ec;border-radius:12px;padding:9px;display:grid;gap:3px}.fc-finding span{font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;font-weight:900;color:#5f7383}.fc-finding strong{color:#103a66;font-size:1rem}.fc-finding small{color:#5f7383}.fc-topic-diagnostics{display:grid;gap:8px}.fc-topic-diagnostic{border:1px solid #dbe7eb;border-radius:12px;padding:9px;background:#fbfdfe;display:grid;gap:8px}.fc-topic-diagnostic>header{display:flex;justify-content:space-between;gap:10px}.fc-topic-diagnostic>header strong{color:#103a66}.fc-topic-diagnostic>header span{font-weight:950}.fc-topic-diagnostic .positive{color:#0d736d}.fc-topic-diagnostic .negative{color:#a32538}.fc-topic-core{display:grid;grid-template-columns:minmax(0,1fr) 20px minmax(0,1fr);gap:8px;align-items:center}.fc-topic-core>div{background:#f2f7f9;border-radius:9px;padding:7px;display:grid;gap:2px}.fc-topic-core>div span{font-size:.67rem;text-transform:uppercase;font-weight:900;color:#6d8291}.fc-topic-core>div b{color:#103a66}.fc-topic-core>div small{color:#5f7383}.fc-topic-core>i{text-align:center;color:#7d919e}.fc-topic-detail{display:grid;grid-template-columns:120px minmax(0,1fr);gap:7px;align-items:start}.fc-topic-detail>b{font-size:.7rem;text-transform:uppercase;color:#5f7383;padding-top:4px}.fc-topic-detail>div{display:flex;flex-wrap:wrap;gap:4px}.fc-detail-chip,.fc-break-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid #dce7eb;background:#fff;border-radius:999px;padding:3px 7px;font-size:.68rem;color:#526a79}.fc-detail-chip b,.fc-break-chip b{color:#29465b}.fc-detail-chip i{font-style:normal;color:#8da0aa}.fc-difference-pair{display:grid;gap:8px}.fc-difference-title{display:flex;justify-content:space-between;gap:10px;align-items:baseline;color:#103a66}.fc-difference-title span{color:#5f7383;font-size:.76rem}.fc-difference-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fc-delta-chart{display:grid;gap:7px}.fc-delta-row{display:grid;grid-template-columns:minmax(115px,165px) minmax(180px,1fr) minmax(130px,165px);gap:8px;align-items:center}.fc-delta-label{font-size:.78rem;font-weight:800;color:#29465b;overflow-wrap:anywhere}.fc-delta-track{height:18px;background:#edf3f5;border-radius:5px;position:relative;overflow:hidden}.fc-delta-center{position:absolute;left:50%;top:0;bottom:0;width:1px;background:#8297a5}.fc-delta-bar{position:absolute;top:3px;bottom:3px;border-radius:4px}.fc-delta-bar.positive{background:#12867f}.fc-delta-bar.negative{background:#bf2f43}.fc-delta-zero-dot{position:absolute;left:calc(50% - 2px);top:7px;width:4px;height:4px;border-radius:50%;background:#8297a5}.fc-delta-meta{display:grid;gap:1px;text-align:right}.fc-delta-meta strong{font-size:.78rem;color:#5f7383}.fc-delta-meta strong.positive{color:#0d736d}.fc-delta-meta strong.negative{color:#a32538}.fc-delta-meta span,.fc-delta-meta small{font-size:.67rem;color:#5f7383}.fc-calendar-panel{display:grid;gap:8px}.fc-calendar-head{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fc-calendar-head>div{background:#edf6f9;border-radius:10px;padding:8px;display:grid;gap:2px;color:#103a66}.fc-calendar-head span{font-size:.72rem;color:#5f7383}.fc-calendar-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-items:start}.fc-calendar-day{border:1px solid #d9e6eb;border-radius:13px;padding:9px;background:#fff;display:grid;gap:8px;min-width:0}.fc-calendar-day.missing{background:#f7f9fa;color:#7d909d;min-height:100px;align-content:center}.fc-calendar-day>header{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.fc-calendar-day>header>div{display:grid;gap:1px}.fc-calendar-day>header strong{color:#103a66}.fc-calendar-day>header span{font-size:.72rem;color:#5f7383}.fc-weather-line{max-width:58%;text-align:right;font-size:.68rem!important;color:#536d7d!important;line-height:1.25}.fc-weather-line.loading{font-style:italic}.fc-weather-line.error{color:#a32538!important}.fc-calendar-day-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}.fc-calendar-day-metrics>div{background:#f1f7f9;border-radius:8px;padding:6px;display:grid;gap:1px}.fc-calendar-day-metrics span{font-size:.64rem;text-transform:uppercase;color:#6d8291;font-weight:900}.fc-calendar-day-metrics strong{font-size:.86rem;color:#103a66}.fc-calendar-breakdown{display:grid;grid-template-columns:64px minmax(0,1fr);gap:5px;align-items:start}.fc-calendar-breakdown>b{font-size:.65rem;text-transform:uppercase;color:#6d8291;padding-top:4px}.fc-calendar-breakdown>div{display:flex;flex-wrap:wrap;gap:3px}.fc-break-chip{border-radius:7px}.fc-break-chip b{margin-right:1px}.fc-calendar-programs{display:grid;gap:4px}.fc-calendar-program{display:grid;grid-template-columns:66px minmax(0,1fr) minmax(100px,145px);gap:7px;align-items:center;border-top:1px solid #edf2f4;padding-top:5px}.fc-calendar-time{font-size:.72rem;font-weight:900;color:#103a66}.fc-calendar-program-copy{display:grid;gap:1px;min-width:0}.fc-calendar-program-copy strong{font-size:.76rem;color:#29465b;overflow-wrap:anywhere}.fc-calendar-program-copy span{font-size:.67rem;color:#6b808f}.fc-calendar-program-money{text-align:right;font-size:.7rem;font-weight:900;color:#0d736d}.fc-calendar-program-money.pending{color:#8a9ba5}.fc-weather-source{font-size:.67rem;color:#6d8291;border-top:1px solid #e6edef;padding-top:7px}.fc-weather-scatter svg{width:100%;min-height:320px;border:1px solid #e1eaee;border-radius:12px;background:#fbfdfe}.fc-weather-legend{display:flex;flex-wrap:wrap;gap:7px 12px;margin-top:8px}.fc-weather-legend-item{display:inline-flex;align-items:center;gap:5px;color:#536d7d;font-size:.72rem}.fc-weather-legend-item i{width:10px;height:10px;border-radius:50%;display:inline-block}.fc-weather-scatter-note{font-size:.68rem;color:#6d8291;line-height:1.35;margin-top:6px}.fc-note-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fc-note-card{background:#fffdf6;border:1px solid #e7dcc0;border-radius:14px;padding:10px;display:grid;gap:3px}.fc-note-card strong{color:#6c5415}.fc-note-card span{color:#6f6550;font-size:.78rem;line-height:1.35}.muted-cell{color:#81949f;font-size:.72rem}@media(max-width:1100px){.fc-difference-grid{grid-template-columns:1fr}.fc-calendar-program{grid-template-columns:60px minmax(0,1fr)}.fc-calendar-program-money{grid-column:2;text-align:left}}@media(max-width:1100px){.fc-day-context-row{grid-template-columns:120px minmax(160px,1fr) 70px 90px 70px minmax(150px,1fr)}.fc-day-context-programming{grid-column:2/-1}.fc-overall-effect-grid{grid-template-columns:1fr 1fr}.fc-overall-effect-grid>div:first-child{grid-column:1/-1}}@media(max-width:900px){.fc-ab-control-grid{grid-template-columns:1fr}.fc-day-context-row{grid-template-columns:1fr 1fr}.fc-day-context-date,.fc-day-context-weather,.fc-day-context-share,.fc-day-context-programming{grid-column:1/-1}.fc-overall-effect-grid{grid-template-columns:1fr}.fc-overall-effect-grid>div:first-child{grid-column:auto}.fc-layout{grid-template-columns:1fr}.fc-picker{position:static}.fc-drive-list{max-height:300px}.fc-topic-pair-row{grid-template-columns:1fr}.fc-share-line{grid-template-columns:52px minmax(180px,1fr) 70px}.fc-calendar-pair,.fc-calendar-head{grid-template-columns:1fr}.fc-calendar-head>div:nth-child(2){margin-top:4px}.fc-note-grid{grid-template-columns:1fr}.fc-section-label{align-items:start;flex-direction:column}.fc-section-label span{text-align:left}.fc-topic-detail{grid-template-columns:1fr}.fc-summary-metrics{grid-template-columns:1fr}}
    `;
  }

  async function loadData() {
    const c = client();
    if (!c) throw new Error('Fundraiser Comparison could not access the data connection.');

    const [scheduleRows, airings] = await Promise.all([
      fetchAll(App.constants?.SCHEDULES_TABLE || 'pledge_fundraiser_schedules', 'id,title,start_date,end_date,created_at,updated_at,schedule_data', 'start_date'),
      Promise.resolve(App.data?.fetchImportedAirings?.()).then((rows) => Array.isArray(rows) ? rows : [])
    ]);

    state.schedules = prepareSchedules(scheduleRows.map(normalizeSchedule)).filter((schedule) => schedule.season && schedule.year);
    state.airings = airings;

    let libraryRows = Array.isArray(App.state?.rawRows) ? App.state.rawRows : [];
    if (!libraryRows.length) {
      libraryRows = await fetchAll(App.constants?.BASE_TABLE || 'pledge_programs_v2', 'id,title,nola_code,topic_primary,topic_secondary');
    }
    buildLibraryIndexes(libraryRows);

    state.analysisCache.clear();
    state.weatherByDate.clear();
    state.weatherRequested.clear();
    state.weatherLoading = false;
    state.weatherError = '';
    state.ready = true;
  }

  async function ensureReady(options = {}) {
    const host = root();
    if (!host) return false;
    if (state.loading) return false;

    if (!state.ready || options.force) {
      state.loading = true;
      host.innerHTML = '<div class="notice-strip">Loading fundraiser comparison data…</div>';
      try {
        await loadData();
      } catch (error) {
        console.error(error);
        host.innerHTML = `<div class="notice-strip bad">${escapeHtml(error.message || 'Could not load fundraiser comparison data.')}</div>`;
        return false;
      } finally {
        state.loading = false;
      }
    }

    renderPicker();
    return true;
  }

  App.fundraiserComparisonUi = { ensureReady };
})();

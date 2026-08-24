(() => {
  const App = window.PledgeLib;
  if (!App) return;

  let host = null;
  let root = null;
  let mounted = false;
  let initialized = false;
  let loaded = false;
  let loadPromise = null;

  async function mountAnalyticsWorkspace() {
    host = document.getElementById('performance-analytics-root');
    if (!host) throw new Error('Performance Analytics workspace host is missing.');
    root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    if (mounted) return root;
    const version = String(App.constants?.APP_VERSION || '').replace(/^v/i, '');
    const response = await window.fetch(`assets/analytics-workspace.html?v=${encodeURIComponent(version)}&_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Performance Analytics workspace could not load (${response.status}).`);
    root.innerHTML = await response.text();
    bindDom();
    bindEvents();
    mounted = true;
    return root;
  }

  const AIRINGS_TABLE = 'pledge_program_airings_v2';
  const LIBRARY_VIEW = 'pledge_program_library_summary_v2';
  const BASE_TABLE = 'pledge_programs_v2';
  const SCHEDULES_TABLE = 'pledge_fundraiser_schedules';
  const SEASONS = ['March', 'June', 'August', 'December'];
  const SEASON_CODE = { March: 'M', June: 'J', August: 'A', December: 'D' };
  const WEAK_BROADCASTS = 3;
  const WEAK_SEASONS = 2;
  const LONG_PAUSE_YEARS = 2;
  const HOLIDAY_RE = /christmas|holiday|holidays|xmas|thanksgiving|new year|hanukkah|kwanzaa/i;
  const ANALYTICS_COHORT_STORAGE_KEY = App.constants.ANALYTICS_COHORT_STORAGE_KEY || 'wnmuPledgeAnalyticsCohortV1';

  const state = {
    client: null,
    session: null,
    isAdmin: false,
    email: '',
    records: [],
    filtered: [],
    schedules: [],
    scheduleRecords: [],
    driveSeasonRecords: [],
    libraryRows: [],
    libraryById: new Map(),
    libraryByTitle: new Map(),
    question: 'startTimes',
    season: 'all',
    yearFilters: null,
    search: '',
    evidence: 'all',
    metric: 'median',
    topicFilters: [],
    secondaryTopicFilter: 'all',
    rightsScope: 'all',
    advancedDistributor: 'all',
    advancedLive: 'all',
    advancedDaypart: 'all',
    advancedWeekpart: 'all',
    advancedDuration: 'all',
    trendRows: new Map(),
    groupDetailRows: new Map(),
    tableSort: { question: '', index: null, direction: 'asc' },
    liveBreakDiagnostics: { schedulePlacements: 0, livePlacements: 0, liveRows: 0, liveDollars: 0, unmatchedLivePlacements: 0 },
    scheduleAudit: { rawSchedules: 0, activeSchedules: 0, duplicateSchedulesSuppressed: 0 },
    cohort: null
  };

  const LIVE_BREAK_ANALYTICS_SOURCE = 'saved-scheduling-placements-only';

  const el = (id) => root?.getElementById(id) || null;
  let dom = {};
  function bindDom() {
    dom = {
    notice: el('notice'), lab: el('lab'),
    season: el('season'), yearPicker: el('year-picker'), yearSummary: el('year-summary'), yearOptions: el('year-options'), search: el('search'), evidence: el('evidence'), topicPicker: el('topic-picker'), topicSummary: el('topic-summary'), topicOptions: el('topic-options'), secondaryTopic: el('secondary-topic'), rightsScope: el('rights-scope'), reload: el('reload'), scopeNote: el('scope-note'),
    requiredFilters: el('required-filters'), refineFilters: el('refine-filters'), requiredFilterCard: el('required-filter-card'), requiredFilterStatus: el('required-filter-status'), requiredFilterNote: el('required-filter-note'), refineFilterNote: el('refine-filter-note'), filterBank: el('filter-bank'),
    advDistributor: el('adv-distributor'), advMetric: el('adv-metric'), advLive: el('adv-live'), advDaypart: el('adv-daypart'), advWeekpart: el('adv-weekpart'), advDuration: el('adv-duration'),
    cards: el('cards'), detail: root?.querySelector('.detail'), detailTitle: el('dt'), detailSummary: el('ds'), stats: el('stats'), chartTitle: el('ct'), chartNote: el('cn'),
    chart: el('chart'), read: el('read'), tableTitle: el('tt'), tableNote: el('tn'), table: el('table'),
    trendModal: el('trend-modal'), trendTitle: el('trend-title'), trendSubtitle: el('trend-subtitle'), trendBody: el('trend-body'), trendClose: el('trend-close'),
    programModal: el('program-modal'), programModalTitle: el('program-modal-title'), programModalSubtitle: el('program-modal-subtitle'), programModalBody: el('program-modal-body'), programModalClose: el('program-modal-close')
    };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function text(value) { return String(value ?? '').trim(); }
  function lookupKey(value) { return text(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function nolaKey(value) { return text(value).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function firstNonEmpty(...values) {
    for (const value of values) {
      if (value === 0 || value === false) return value;
      if (text(value)) return value;
    }
    return null;
  }

  function readAnalyticsCohort() {
    try {
      const raw = window.sessionStorage.getItem(ANALYTICS_COHORT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const keys = Array.isArray(parsed?.keys) ? parsed.keys.map((key) => text(key)).filter(Boolean) : [];
      const ids = Array.isArray(parsed?.ids) ? parsed.ids.map((id) => text(id)).filter(Boolean).map((id) => `id:${id}`) : [];
      const allKeys = [...new Set([...keys, ...ids])];
      if (!allKeys.length) return null;
      return {
        ...parsed,
        keys: allKeys,
        keySet: new Set(allKeys),
        count: Number(parsed?.count || 0) || allKeys.length,
        filterSummary: text(parsed?.filterSummary || '')
      };
    } catch (error) {
      console.warn('Could not read analytics cohort.', error);
      return null;
    }
  }

  function clearAnalyticsCohort() {
    try { window.sessionStorage.removeItem(ANALYTICS_COHORT_STORAGE_KEY); } catch (_error) {}
    state.cohort = null;
    render();
  }

  function recordCohortKeys(record = {}) {
    const id = text(record.programOpenId || record.programId || '');
    const nola = nolaKey(record.nola || '');
    const title = lookupKey(record.title || record.importedTitle || '');
    const keys = [];
    if (id) keys.push(`id:${id}`);
    if (nola) keys.push(`nola:${nola}`);
    if (title) keys.push(`title:${title}`);
    if (nola && title) keys.push(`nola-title:${nola}|${title}`);
    return keys;
  }

  function recordInAnalyticsCohort(record = {}) {
    if (!state.cohort?.keySet) return true;
    return recordCohortKeys(record).some((key) => state.cohort.keySet.has(key));
  }

  function cohortScopePrefix() {
    if (!state.cohort?.keySet) return '';
    const count = state.cohort.count || state.cohort.keySet.size;
    const summary = state.cohort.filterSummary ? ` · ${state.cohort.filterSummary}` : '';
    return `<div class="cohort-note"><strong>Current-list cohort:</strong> ${escapeHtml(formatNumber(count))} title${count === 1 ? '' : 's'}${escapeHtml(summary)} <button type="button" class="ghost cohort-clear" id="clear-cohort">Clear cohort</button></div>`;
  }

  function setScopeNote(message = '') {
    if (!dom.scopeNote) return;
    const cohort = cohortScopePrefix();
    const messageHtml = message ? escapeHtml(message) : '';
    dom.scopeNote.innerHTML = `${cohort}${cohort && messageHtml ? '<div style="margin-top:6px"></div>' : ''}${messageHtml}`;
    dom.scopeNote.querySelector('#clear-cohort')?.addEventListener('click', clearAnalyticsCohort);
  }

  function formatMoney(value) { return Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }); }
  function formatNumber(value) { return Number(value || 0).toLocaleString(); }
  function formatPercent(value) { return Number.isFinite(value) ? `${value > 0 ? '+' : ''}${Math.round(value)}%` : '—'; }
  function note(message, type = '') { dom.notice.textContent = message; dom.notice.className = `notice ${type}`.trim(); }
  function isMissingTopic(value) {
    const key = lookupKey(value);
    return !key || ['uncategorized', 'unassigned', 'unknown', 'unspecified', 'n a', 'na'].includes(key);
  }

  function isNonSpecificPledgeBucket(...values) {
    return values.some((value) => {
      const normalized = lookupKey(value);
      const compact = normalized.replace(/\s+/g, '');
      return compact === 'nspl'
        || normalized === 'non specific pledges'
        || normalized === 'non specific pledge'
        || normalized === 'non specific web pledges'
        || normalized === 'non specific web pledge'
        || /(^| )non specific pledge(s)?($| )/.test(normalized)
        || /(^| )non specific web pledge(s)?($| )/.test(normalized);
    });
  }

  function parseLocalDate(value) {
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


  function objectFromMaybeJson(value) {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const raw = value.trim();
      if (!raw || !/^[{[]/.test(raw)) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch (_error) {
        return null;
      }
    }
    return null;
  }

  function payloadValue(row = {}, keys = [], regex = null) {
    const payload = objectFromMaybeJson(row?.raw_payload || row?.rawPayload || row?.raw || row?.raw_workbook_row || row?.source_row || row?.sourceRow);
    if (!payload) return null;
    for (const key of keys) {
      if (payload[key] != null && text(payload[key]) !== '') return payload[key];
    }
    if (regex) {
      for (const [key, value] of Object.entries(payload)) {
        if (regex.test(key) && text(value) !== '') return value;
      }
    }
    return null;
  }

  function excelFractionMinutes(value) {
    const num = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    if (!Number.isFinite(num) || num < 0 || num >= 1) return null;
    let total = Math.round(num * 24 * 60);
    if (total >= 1440) total = 1439;
    return total;
  }

  function isMidnightMinutes(value) {
    const minutes = parseMinutes(value);
    return Number.isFinite(minutes) && minutes === 0;
  }

  function preferredRawTime(row = {}, fallback = null) {
    const raw = payloadValue(row, ['air_time', 'program_time', 'break_time', 'broadcast_time', 'time'], /(air_?time|program_?time|break_?time|broadcast_?time|time)$/i);
    if (Number.isFinite(parseMinutes(raw)) && (isMidnightMinutes(fallback) || !Number.isFinite(parseMinutes(fallback)))) return raw;
    return fallback;
  }

  function parseMinutes(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return (value.getHours() * 60) + value.getMinutes();
    if (typeof value === 'number' && Number.isFinite(value)) {
      const excel = excelFractionMinutes(value);
      if (Number.isFinite(excel)) return excel;
    }
    const raw = text(value);
    if (!raw) return null;
    const excel = excelFractionMinutes(raw);
    if (Number.isFinite(excel)) return excel;
    const ampm = raw.match(/\b(am|pm)\b/i)?.[1]?.toLowerCase() || '';
    const match = raw.match(/^(\d{1,2})(?::?(\d{2}))?(?::?(\d{2}))?(?:\s*(?:am|pm))?$/i);
    if (!match) return null;
    let hour = Number(match[1] || 0);
    const minute = Number(match[2] || 0);
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return (hour * 60) + minute;
  }

  function parseAiringDate(row) {
    const explicitDate = text(firstNonEmpty(row?.air_date, row?.aired_date, row?.drive_date, ''));
    const explicitTime = preferredRawTime(row, firstNonEmpty(row?.air_time, row?.time_of_day, row?.scheduled_time, ''));
    if (explicitDate) {
      const date = parseLocalDate(explicitDate);
      if (!date) return { date: null, dateKey: '', startMinutes: null };
      const minutes = parseMinutes(explicitTime);
      if (Number.isFinite(minutes)) date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      return { date, dateKey: localDateKey(date), startMinutes: minutes };
    }
    const date = parseLocalDate(firstNonEmpty(row?.aired_at, row?.air_datetime, row?.broadcast_at, row?.scheduled_at, ''));
    if (!date) return { date: null, dateKey: '', startMinutes: null };
    return { date, dateKey: localDateKey(date), startMinutes: (date.getHours() * 60) + date.getMinutes() };
  }

  function localDateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function todayKey() { return localDateKey(new Date()); }

  function normalizedDateKey(value) {
    const date = parseLocalDate(value);
    return date ? localDateKey(date) : '';
  }

  function rightsExpiredFromEnd(rightsEnd = '') {
    const end = normalizedDateKey(rightsEnd);
    return Boolean(end && end < todayKey());
  }

  function rightsNotStartedFromStart(rightsStart = '') {
    const start = normalizedDateKey(rightsStart);
    return Boolean(start && start > todayKey());
  }

  function formatDateKey(value = '') {
    const key = normalizedDateKey(value);
    if (!key) return '—';
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function currentRightsOnly() {
    return state.rightsScope === 'current';
  }

  function recordWithinBroadcastRights(record = {}) {
    if (!currentRightsOnly()) return true;
    if (!record || record.isNonSpecific) return false;
    if (!record.libraryKnown) return false;
    if (record.rightsExpired || record.rightsNotStarted || record.inactive) return false;
    return true;
  }

  function rightsEndNote(row = {}) {
    if (!currentRightsOnly()) return '';
    return ` <span class="mix">(rights end ${escapeHtml(row.rightsEndDisplay || formatDateKey(row.rightsEnd) || '—')})</span>`;
  }

  function pledgeSeason(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const month = date.getMonth() + 1;
    if (month === 2 || month === 3) return 'March';
    if (month === 5 || month === 6) return 'June';
    if (month === 8 || month === 9) return 'August';
    if (month === 11 || month === 12) return 'December';
    return '';
  }

  function daypartFromMinutes(minutes) {
    if (!Number.isFinite(Number(minutes))) return '';
    const normalized = ((Number(minutes) % 1440) + 1440) % 1440;
    if (normalized >= 420 && normalized < 720) return 'morning';
    if (normalized >= 720 && normalized < 1020) return 'afternoon';
    if (normalized >= 1020 && normalized < 1200) return 'early-evening';
    if (normalized >= 1200 && normalized < 1350) return 'prime';
    return 'overnight';
  }

  function weekpartFromDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const day = date.getDay();
    return day === 0 || day === 6 ? 'weekend' : 'weekday';
  }

  function seasonYearSortKey(label) {
    const match = String(label || '').match(/(March|June|August|December)\s+(\d{4})/);
    return match ? (Number(match[2]) * 10) + SEASONS.indexOf(match[1]) + 1 : 0;
  }

  function normalizeSchedule(row = {}) {
    const data = row.schedule_data && typeof row.schedule_data === 'object' ? row.schedule_data : {};
    return {
      id: row.id || data.id || '',
      title: row.title || data.title || '',
      startDate: row.start_date || data.startDate || '',
      endDate: row.end_date || data.endDate || '',
      createdAt: row.created_at || row.createdAt || data.createdAt || '',
      updatedAt: row.updated_at || row.updatedAt || data.updatedAt || '',
      placements: Array.isArray(data.placements) ? data.placements : [],
      onlineDollars: Number(firstNonEmpty(data.onlineDollars, row.online_dollars, row.onlineDollars, 0) || 0) || 0,
      mailDollars: Number(firstNonEmpty(data.mailDollars, row.mail_dollars, row.mailDollars, 0) || 0) || 0,
      goalDollars: Number(firstNonEmpty(data.goalDollars, row.goal_dollars, row.goalDollars, 0) || 0) || 0,
      meta: data.meta && typeof data.meta === 'object' ? data.meta : {}
    };
  }

  function placementDollars(placement = {}) {
    return Number(firstNonEmpty(
      placement.importedBroadcastDollars,
      placement.manualResultRecorded ? Number(placement.manualBroadcastDollars || 0) : null,
      placement.actualDollars,
      placement.broadcastDollars,
      placement.dollars,
      placement.pledgeDollars,
      0
    ) || 0) || 0;
  }

  function scheduleBroadcastTotal(schedule = {}) {
    const meta = schedule.meta || {};
    const reported = Number(firstNonEmpty(
      meta.reportedBroadcastTotalDollars,
      meta.importedBroadcastTotalDollars,
      meta.importedProgramSpecificBroadcastTotalDollars,
      0
    ) || 0) || 0;
    if (reported > 0) return reported;
    return (schedule.placements || []).reduce((sum, placement) => sum + placementDollars(placement), 0);
  }

  function schedulePledgeTotal(schedule = {}) {
    const meta = schedule.meta || {};
    const reported = Number(firstNonEmpty(meta.importedPledgesTotal, meta.pledgesTotal, 0) || 0) || 0;
    if (reported > 0) return reported;
    return (schedule.placements || []).reduce((sum, placement) => sum + (Number(firstNonEmpty(
      placement.importedPledges,
      placement.importedBroadcastPledges,
      placement.pledges,
      placement.pledgeCount,
      0
    ) || 0) || 0), 0);
  }

  function scheduleGrandTotal(schedule = {}) {
    return scheduleBroadcastTotal(schedule)
      + (Number(schedule.onlineDollars || 0) || 0)
      + (Number(schedule.mailDollars || 0) || 0);
  }

  function scheduleManualMoneyTotal(schedule = {}) {
    return (Number(schedule?.onlineDollars || 0) || 0)
      + (Number(schedule?.mailDollars || 0) || 0)
      + (Number(schedule?.goalDollars || 0) || 0);
  }

  function scheduleLooksAutoImported(schedule = {}) {
    const titleKey = lookupKey(schedule?.title || '');
    return titleKey.startsWith('imported pledge')
      || Boolean(schedule?.meta?.importedFromReports)
      || Boolean(text(schedule?.meta?.importedFundraiserKey || ''));
  }

  function schedulePreferenceScore(schedule = {}) {
    let score = 0;
    const moneyTotal = scheduleManualMoneyTotal(schedule);
    if (moneyTotal > 0) score += 1000000 + Math.min(999999, Math.round(moneyTotal));
    if (!scheduleLooksAutoImported(schedule)) score += 100000;
    if ((schedule?.placements || []).some((placement) => !placement?.importedFromReport)) score += 50000;
    if ((schedule?.placements || []).some((placement) => placement?.importedFromReport)) score += 10000;
    if (schedule?.meta?.importedTotalsHydratedFromAirings) score += 5000;
    const updated = Date.parse(schedule?.updatedAt || schedule?.updated_at || schedule?.createdAt || '');
    if (Number.isFinite(updated)) score += Math.floor(updated / 1000000000);
    return score;
  }

  function mergeDuplicateScheduleBucket(items = []) {
    const sorted = [...items].sort((a, b) => schedulePreferenceScore(b) - schedulePreferenceScore(a));
    const primary = sorted[0] || {};
    if (sorted.length <= 1) return primary;
    const placementMap = new Map();
    sorted.forEach((schedule) => {
      (schedule.placements || []).forEach((placement) => {
        const key = text(firstNonEmpty(
          placement.id,
          placement.sourceAiringHash,
          placement.source_airing_hash,
          `${placement.dateKey || placement.date_key || ''}|${placement.startMinutes ?? placement.start_minutes ?? placement.start ?? ''}|${lookupKey(firstNonEmpty(placement.programTitle, placement.program_title, placement.title, placement.name, ''))}|${nolaKey(firstNonEmpty(placement.nolaCode, placement.nola_code, placement.nola, ''))}`
        ));
        if (!key || !placementMap.has(key)) placementMap.set(key || `${placementMap.size}`, placement);
        else {
          const current = placementMap.get(key) || {};
          placementMap.set(key, { ...placement, ...current });
        }
      });
    });
    const firstPositive = (field) => {
      const found = sorted.find((schedule) => Number(schedule?.[field] || 0) > 0);
      return Number(found?.[field] || 0) || 0;
    };
    const meta = sorted.reduce((merged, schedule) => ({ ...merged, ...(schedule.meta || {}) }), {});
    const latestUpdate = sorted
      .map((schedule) => Date.parse(schedule.updatedAt || schedule.createdAt || ''))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    return {
      ...primary,
      title: text(primary.title) || sorted.map((schedule) => text(schedule.title)).find(Boolean) || '',
      placements: [...placementMap.values()],
      onlineDollars: firstPositive('onlineDollars'),
      mailDollars: firstPositive('mailDollars'),
      goalDollars: firstPositive('goalDollars'),
      meta: {
        ...meta,
        duplicateScheduleIdsMerged: sorted.map((schedule) => schedule.id).filter(Boolean),
        duplicateScheduleCountMerged: sorted.length
      },
      updatedAt: Number.isFinite(latestUpdate) ? new Date(latestUpdate).toISOString() : primary.updatedAt
    };
  }

  function dedupeSchedulesByDateRange(schedules = []) {
    const buckets = new Map();
    schedules.forEach((schedule) => {
      const start = text(schedule.startDate);
      const end = text(schedule.endDate);
      const key = start && end ? `${start}|${end}` : `id:${text(schedule.id)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(schedule);
    });
    const active = [];
    const ambiguous = [];
    buckets.forEach((items, key) => {
      if (items.length === 1 || key.startsWith('id:')) {
        active.push(items[0]);
        return;
      }
      ambiguous.push({ key, count: items.length, ids: items.map((schedule) => text(schedule.id)).filter(Boolean) });
    });
    state.scheduleAudit = {
      rawSchedules: schedules.length,
      activeSchedules: active.length,
      duplicateSchedulesMerged: 0,
      duplicateSchedulesSuppressed: ambiguous.reduce((sum, item) => sum + item.count, 0),
      ambiguousDateRanges: ambiguous
    };
    return active.sort((a, b) => `${text(a.startDate)}|${text(a.endDate)}`.localeCompare(`${text(b.startDate)}|${text(b.endDate)}`));
  }

  function buildDriveSeasonRecords(schedules = []) {
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

  function parseBooleanish(value) {
    if (typeof value === 'boolean') return value;
    const raw = text(value).toLowerCase();
    if (!raw) return null;
    if (['true', 'yes', 'y', '1', 'live', 'has live breaks', 'flagged'].includes(raw)) return true;
    if (['false', 'no', 'n', '0', 'none', 'no live breaks', 'no live-breaks', 'no live break', 'not live'].includes(raw)) return false;
    return null;
  }

  function libraryInactive(_row = {}) {
    // Archive state is date-only in the main app.  Older status/archive fields may
    // exist in legacy data, but analytics must not treat them as archive state.
    return false;
  }

  function placementLive(placement = {}) {
    // Canonical source for Performance Analytics live-break logic.
    // Saved Scheduling placement truth wins. A stale false alias must never suppress live notes.
    // Do not read imported-airing live_break* columns here; those caused the old false $0 result.
    const notes = text(placement?.liveBreakNotes || placement?.live_break_notes || placement?.liveNotes || placement?.live_notes || '');
    const values = [
      placement?.liveBreakFlag,
      placement?.live_break_flag,
      placement?.liveBreak,
      placement?.live_break,
      placement?.liveBreaks,
      placement?.live_breaks,
      placement?.hasLiveBreak,
      placement?.has_live_break,
      placement?.isLiveBreak,
      placement?.is_live_break,
      placement?.liveFlag,
      placement?.live_flag
    ];
    for (const value of values) {
      if (parseBooleanish(value) === true) return true;
    }
    if (notes) return true;
    for (const value of values) {
      if (parseBooleanish(value) === false) return false;
    }
    return false;
  }

  function mapListPush(map, key, row) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }

  function buildLibraryIndexes(rows = []) {
    const byId = new Map();
    const byNola = new Map();
    const byTitle = new Map();
    rows.forEach((row) => {
      if (text(row.id)) byId.set(text(row.id), row);
      if (nolaKey(row.nola_code)) mapListPush(byNola, nolaKey(row.nola_code), row);
      if (lookupKey(row.title)) byTitle.set(lookupKey(row.title), row);
    });
    return { byId, byNola, byTitle };
  }

  function resolveLibraryByNola(indexes, nola = '', title = '') {
    const matches = indexes.byNola.get(nolaKey(nola)) || [];
    if (!matches.length) return null;
    const titleKey = lookupKey(title || '');
    if (titleKey) {
      const titleMatch = matches.find((row) => lookupKey(row.title) === titleKey);
      if (titleMatch) return titleMatch;
    }
    // Guardrail: many imported rows use broad series codes like NOVA/GPER.
    // Only use NOLA by itself when it maps to exactly one library row.
    return matches.length === 1 ? matches[0] : null;
  }

  function resolveLibraryRow(row, indexes) {
    const id = text(firstNonEmpty(row.pledge_program_id, row.manual_match_program_id, row.program_id, row.programId, ''));
    const nola = nolaKey(firstNonEmpty(row.nola_code, row.nola, row.program_nola, ''));
    const title = lookupKey(firstNonEmpty(row.matched_library_title, row.program_title, row.title, row.imported_program_title, ''));
    return indexes.byId.get(id) || resolveLibraryByNola(indexes, nola, title) || indexes.byTitle.get(title) || null;
  }

  function buildScheduleIndex(schedules = [], indexes) {
    const maps = { hash: new Map(), exact: new Map(), dateProgram: new Map(), dateNola: new Map(), dateTitle: new Map() };
    const push = (map, key, value) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    };
    schedules.forEach((schedule) => {
      (schedule.placements || []).forEach((placement) => {
        const rawPid = text(placement.programId || placement.program_id || '');
        const rawNola = nolaKey(firstNonEmpty(placement.nolaCode, placement.nola_code, placement.nola, placement.program_nola, ''));
        const rawTitle = lookupKey(firstNonEmpty(placement.programTitle, placement.program_title, placement.title, placement.name, ''));
        const lib = indexes.byId.get(rawPid) || resolveLibraryByNola(indexes, rawNola, rawTitle) || indexes.byTitle.get(rawTitle) || null;
        const dateKey = text(placement.dateKey || placement.date_key || '');
        const start = Number(placement.startMinutes ?? placement.start_minutes ?? placement.start ?? 0);
        const end = Number(placement.endMinutes ?? placement.end_minutes ?? start);
        const pid = text(firstNonEmpty(placement.programId, placement.program_id, lib?.id, ''));
        const nola = nolaKey(firstNonEmpty(lib?.nola_code, rawNola, ''));
        const title = lookupKey(firstNonEmpty(lib?.title, placement.programTitle, placement.program_title, placement.title, placement.name, ''));
        const hash = text(placement.sourceAiringHash || placement.source_airing_hash || '');
        const entry = { scheduleId: schedule.id, scheduleTitle: schedule.title, dateKey, start, end, pid, nola, title, hash, live: placementLive(placement), placement };
        push(maps.hash, hash, entry);
        push(maps.dateProgram, `${dateKey}|${pid}`, entry);
        push(maps.dateNola, `${dateKey}|${nola}`, entry);
        push(maps.dateTitle, `${dateKey}|${title}`, entry);
        push(maps.exact, `${dateKey}|${pid}|${start}`, entry);
        push(maps.exact, `${dateKey}|${nola}|${start}`, entry);
        push(maps.exact, `${dateKey}|${title}|${start}`, entry);
      });
    });
    return maps;
  }

  function findScheduleMatch(record, scheduleIndex) {
    const hashMatch = record.sourceAiringHash ? (scheduleIndex.hash.get(record.sourceAiringHash) || []) : [];
    if (hashMatch.length) return hashMatch.some((item) => item.live) ? hashMatch.find((item) => item.live) : hashMatch[0];
    const keys = [record.programId, record.nola ? nolaKey(record.nola) : '', lookupKey(record.title)].filter(Boolean);
    const candidates = [];
    keys.forEach((key) => {
      if (Number.isFinite(record.startMinutes)) candidates.push(...(scheduleIndex.exact.get(`${record.dateKey}|${key}|${record.startMinutes}`) || []));
      candidates.push(...(scheduleIndex.dateProgram.get(`${record.dateKey}|${key}`) || []));
      candidates.push(...(scheduleIndex.dateNola.get(`${record.dateKey}|${key}`) || []));
      candidates.push(...(scheduleIndex.dateTitle.get(`${record.dateKey}|${key}`) || []));
    });
    const unique = [];
    const seen = new Set();
    candidates.forEach((item) => {
      const id = `${item.scheduleId}|${item.dateKey}|${item.start}|${item.title}|${item.nola}|${item.pid}`;
      if (seen.has(id)) return;
      seen.add(id);
      unique.push(item);
    });
    if (!unique.length) return null;
    if (Number.isFinite(record.startMinutes)) {
      const overlapping = unique.filter((item) => record.startMinutes >= Number(item.start || 0) && record.startMinutes < Number(item.end || item.start || 0));
      if (overlapping.length) return overlapping.some((item) => item.live) ? overlapping.find((item) => item.live) : overlapping[0];
    }
    return unique.some((item) => item.live) ? unique.find((item) => item.live) : unique[0];
  }


  function sameTwelveHourClock(a, b) {
    if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return false;
    return Math.abs((Number(a) % 720) - (Number(b) % 720)) <= 1;
  }

  function applyScheduleStartCorrection(record = {}, scheduleMatch = null) {
    if (!record || !scheduleMatch) return false;
    const start = Number(scheduleMatch.start);
    if (!Number.isFinite(start) || start < 0) return false;
    const current = Number(record.startMinutes);
    if (!Number.isFinite(current) || Math.abs(current - start) <= 1) return false;
    const rawTime = firstNonEmpty(record.row?.air_time, payloadValue(record.row, ['air_time', 'program_time', 'break_time', 'broadcast_time', 'time'], /(air_?time|program_?time|break_?time|broadcast_?time|time)$/i), '');
    const rawText = text(rawTime);
    const safe = sameTwelveHourClock(current, start)
      || (current === 0 && /^(0{1,2}:?0{2}(?::0{2})?|12:?0{2}\s*a\.?m\.?)$/i.test(rawText));
    if (!safe) return false;
    record.startMinutes = start;
    if (record.date instanceof Date && !Number.isNaN(record.date.getTime())) {
      record.date.setHours(Math.floor(start / 60) % 24, start % 60, 0, 0);
      record.dateKey = localDateKey(record.date);
    }
    record.daypart = daypartFromMinutes(start);
    record.timeCorrectedFromSchedule = true;
    return true;
  }

  function buildRecords(airings, libraryRows, schedules) {
    const indexes = buildLibraryIndexes(libraryRows);
    const scheduleIndex = buildScheduleIndex(schedules, indexes);
    return airings.map((row) => {
      const temporal = parseAiringDate(row);
      const date = temporal.date;
      const season = pledgeSeason(date);
      const year = date ? date.getFullYear() : '';
      const lib = resolveLibraryRow(row, indexes) || {};
      const importedTitle = text(firstNonEmpty(row.matched_library_title, row.program_title, row.title, row.imported_program_title, 'Untitled'));
      const nonSpecific = isNonSpecificPledgeBucket(
        lib.title,
        importedTitle,
        row.matched_library_title,
        row.program_title,
        row.title,
        row.imported_program_title,
        lib.nola_code,
        row.nola_code,
        row.nola,
        row.match_method
      );
      const rawTopic = nonSpecific ? 'Non-Specific' : text(firstNonEmpty(lib.topic_primary, row.topic_primary, row.topic, ''));
      const topicMissing = !nonSpecific && isMissingTopic(rawTopic);
      const record = {
        id: row.id || '',
        row,
        programId: text(firstNonEmpty(row.pledge_program_id, row.manual_match_program_id, row.program_id, lib.id, '')),
        programOpenId: text(firstNonEmpty(lib.id, row.pledge_program_id, row.manual_match_program_id, row.program_id, '')),
        sourceAiringHash: text(row.row_hash || row.sourceAiringHash || ''),
        title: text(lib.title) || importedTitle || 'Untitled',
        importedTitle,
        nola: text(firstNonEmpty(lib.nola_code, row.nola_code, row.nola, '')),
        topic: nonSpecific ? 'Non-Specific' : (topicMissing ? 'Uncategorized' : rawTopic),
        secondaryTopic: text(firstNonEmpty(lib.topic_secondary, row.topic_secondary, row.secondary_topic, '')),
        topicMissing,
        isNonSpecific: nonSpecific,
        distributor: text(lib.distributor || row.distributor || ''),
        libraryKnown: Boolean(lib && lib.id),
        rightsStart: text(lib.rights_start || ''),
        rightsEnd: text(lib.rights_end || ''),
        rightsStartKey: normalizedDateKey(lib.rights_start || ''),
        rightsEndKey: normalizedDateKey(lib.rights_end || ''),
        rightsEndDisplay: formatDateKey(lib.rights_end || ''),
        rightsExpired: rightsExpiredFromEnd(lib.rights_end || ''),
        rightsNotStarted: rightsNotStartedFromStart(lib.rights_start || ''),
        inactive: libraryInactive(lib),
        date,
        dateKey: temporal.dateKey,
        startMinutes: temporal.startMinutes,
        endMinutes: Number.isFinite(Number(row.end_minutes)) ? Number(row.end_minutes) : null,
        durationMinutes: Number(row.program_minutes || 0) > 0 ? Number(row.program_minutes) : null,
        daypart: daypartFromMinutes(temporal.startMinutes ?? (date ? ((date.getHours() * 60) + date.getMinutes()) : null)),
        weekpart: weekpartFromDate(date),
        season,
        year,
        seasonYear: season && year ? `${season} ${year}` : 'Unseasoned',
        fundraiser: text(row.fundraiser_label) || (season && year ? `${season} ${year}` : ''),
        dollars: Number(firstNonEmpty(row.dollars, row.contribution_amount, 0) || 0),
        pledges: Number(row.pledge_count || 0),
        live: false,
        liveState: 'unknown',
        liveSource: 'none',
        scheduleMatched: false
      };
      const scheduleMatch = findScheduleMatch(record, scheduleIndex);
      if (scheduleMatch) {
        record.scheduleMatched = true;
        applyScheduleStartCorrection(record, scheduleMatch);
        record.live = Boolean(scheduleMatch.live);
        record.liveState = scheduleMatch.live ? 'live' : 'nonlive';
        record.liveSource = 'schedule';
        record.scheduleTitle = scheduleMatch.scheduleTitle || '';
      }
      return record;
    }).filter((record) => record.date && Number.isFinite(Number(record.dollars)) && Number(record.dollars) >= 0 && record.season);
  }


  function buildAiringRecordLookup(airingRecords = []) {
    const maps = { hash: new Map(), exact: new Map(), dateProgram: new Map(), dateNola: new Map(), dateTitle: new Map() };
    const push = (map, key, record) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(record);
    };
    airingRecords.forEach((record) => {
      const hash = text(record.sourceAiringHash || record.row?.row_hash || '');
      if (hash) maps.hash.set(hash, record);
      const dateKey = text(record.dateKey || '');
      if (!dateKey) return;
      const keys = [
        text(record.programOpenId || ''),
        text(record.programId || ''),
        record.nola ? nolaKey(record.nola) : '',
        lookupKey(record.title),
        lookupKey(record.importedTitle)
      ].filter(Boolean);
      keys.forEach((key) => {
        if (Number.isFinite(record.startMinutes)) push(maps.exact, `${dateKey}|${key}|${record.startMinutes}`, record);
        push(maps.dateProgram, `${dateKey}|${key}`, record);
        push(maps.dateNola, `${dateKey}|${key}`, record);
        push(maps.dateTitle, `${dateKey}|${key}`, record);
      });
    });
    return maps;
  }

  function findAiringForSchedulePlacement({ placement = {}, dateKey = '', startMinutes = NaN, pid = '', nola = '', title = '', airingLookup }) {
    const hash = text(placement.sourceAiringHash || placement.source_airing_hash || '');
    if (hash && airingLookup.hash.has(hash)) return airingLookup.hash.get(hash);
    const keys = [pid, nola, title, lookupKey(placement.programTitle || placement.program_title || placement.title || placement.name || '')].filter(Boolean);
    const exactCandidates = [];
    const sameDayCandidates = [];
    keys.forEach((key) => {
      if (Number.isFinite(startMinutes)) exactCandidates.push(...(airingLookup.exact.get(`${dateKey}|${key}|${startMinutes}`) || []));
      sameDayCandidates.push(...(airingLookup.dateProgram.get(`${dateKey}|${key}`) || []));
      sameDayCandidates.push(...(airingLookup.dateNola.get(`${dateKey}|${key}`) || []));
      sameDayCandidates.push(...(airingLookup.dateTitle.get(`${dateKey}|${key}`) || []));
    });
    const uniqueRows = (rows) => {
      const unique = [];
      const seen = new Set();
      rows.forEach((record) => {
        const id = text(record.id || record.sourceAiringHash || `${record.dateKey}|${record.startMinutes}|${record.title}|${record.dollars}`);
        if (!id || seen.has(id)) return;
        seen.add(id);
        unique.push(record);
      });
      return unique;
    };
    const exact = uniqueRows(exactCandidates);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
    const sameDay = uniqueRows(sameDayCandidates);
    return sameDay.length === 1 ? sameDay[0] : null;
  }

  function buildScheduleRecords(schedules = [], libraryRows = [], airingRecords = []) {
    const indexes = buildLibraryIndexes(libraryRows);
    const airingLookup = buildAiringRecordLookup(airingRecords);
    const out = [];
    const usedAiringDollarMatches = new Set();
    const diagnostics = { schedulePlacements: 0, livePlacements: 0, liveRows: 0, liveDollars: 0, unmatchedLivePlacements: 0 };
    schedules.forEach((schedule) => {
      (schedule.placements || []).forEach((placement) => {
        diagnostics.schedulePlacements += 1;
        const liveFlag = placementLive(placement);
        if (liveFlag) diagnostics.livePlacements += 1;
        const dateKey = text(placement.dateKey || placement.date_key || '');
        const date = parseLocalDate(dateKey);
        const season = pledgeSeason(date);
        const year = date ? date.getFullYear() : '';
        const startMinutes = Number(placement.startMinutes ?? placement.start_minutes ?? placement.start ?? NaN);
        const endMinutes = Number(placement.endMinutes ?? placement.end_minutes ?? placement.end ?? NaN);
        const durationMinutes = Number(firstNonEmpty(placement.programMinutes, placement.program_minutes, placement.durationMinutes, placement.duration_minutes, null)) || durationFromTimes(startMinutes, endMinutes);
        if (!dateKey || !date || !season) return;
        const hash = text(placement.sourceAiringHash || placement.source_airing_hash || '');
        const rawPid = text(firstNonEmpty(placement.programId, placement.program_id, ''));
        const rawNola = nolaKey(firstNonEmpty(placement.nolaCode, placement.nola_code, placement.nola, placement.program_nola, ''));
        const rawTitle = lookupKey(firstNonEmpty(placement.programTitle, placement.program_title, placement.title, placement.name, ''));
        const initialLib = indexes.byId.get(rawPid) || resolveLibraryByNola(indexes, rawNola, rawTitle) || indexes.byTitle.get(rawTitle) || {};
        const initialPid = text(firstNonEmpty(rawPid, initialLib.id, ''));
        const initialNola = nolaKey(firstNonEmpty(initialLib.nola_code, rawNola, ''));
        const initialTitle = lookupKey(firstNonEmpty(initialLib.title, placement.programTitle, placement.program_title, placement.title, placement.name, ''));
        const matched = findAiringForSchedulePlacement({ placement, dateKey, startMinutes, pid: initialPid, nola: initialNola, title: initialTitle, airingLookup });
        if (liveFlag && !matched) diagnostics.unmatchedLivePlacements += 1;
        const pid = text(firstNonEmpty(placement.programId, placement.program_id, matched?.programOpenId, matched?.programId, initialLib.id, ''));
        const lib = indexes.byId.get(pid) || (matched?.nola ? resolveLibraryByNola(indexes, nolaKey(matched.nola), lookupKey(firstNonEmpty(matched?.title, matched?.importedTitle, ''))) : null) || resolveLibraryByNola(indexes, initialNola, initialTitle) || indexes.byTitle.get(lookupKey(firstNonEmpty(placement.programTitle, placement.program_title, placement.title, matched?.title, ''))) || initialLib || {};
        const title = text(firstNonEmpty(lib.title, matched?.title, placement.programTitle, placement.program_title, placement.title, placement.name, 'Untitled'));
        const nonSpecific = isNonSpecificPledgeBucket(title, lib.nola_code, matched?.nola, placement.nolaCode, placement.nola_code, placement.nola);
        const rawTopic = nonSpecific ? 'Non-Specific' : text(firstNonEmpty(lib.topic_primary, matched?.topic, ''));
        const topicMissing = !nonSpecific && isMissingTopic(rawTopic);
        const matchedDollarKey = matched ? text(firstNonEmpty(
          matched.sourceAiringHash,
          matched.id,
          `${matched.dateKey || dateKey}|${matched.startMinutes ?? ''}|${lookupKey(matched.title || '')}|${matched.dollars ?? ''}`
        )) : '';
        const explicitDollars = firstNonEmpty(
          placement.importedBroadcastDollars,
          placement.manualResultRecorded ? Number(placement.manualBroadcastDollars || 0) : null,
          placement.actualDollars,
          placement.broadcastDollars,
          placement.dollars,
          placement.pledgeDollars,
          null
        );
        const explicitPledges = firstNonEmpty(
          placement.importedPledges,
          placement.importedBroadcastPledges,
          placement.manualResultRecorded ? Number(placement.manualPledgeCount || 0) : null,
          placement.pledges,
          placement.pledgeCount,
          null
        );
        const canUseMatchedDollars = matchedDollarKey ? !usedAiringDollarMatches.has(matchedDollarKey) : Boolean(matched);
        const resultKnown = explicitDollars != null || Boolean(canUseMatchedDollars && matched);
        const dollars = Number(firstNonEmpty(
          explicitDollars,
          canUseMatchedDollars ? matched?.dollars : null,
          0
        ) || 0);
        const pledges = Number(firstNonEmpty(
          explicitPledges,
          canUseMatchedDollars ? matched?.pledges : null,
          0
        ) || 0);
        if (matchedDollarKey && explicitDollars == null && canUseMatchedDollars && matched) usedAiringDollarMatches.add(matchedDollarKey);
        if (!resultKnown) return;
        if (liveFlag) {
          diagnostics.liveRows += 1;
          diagnostics.liveDollars += dollars;
        }
        out.push({
          id: placement.id || hash || `${schedule.id}|${dateKey}|${startMinutes}|${title}`,
          row: matched?.row || {},
          programId: pid,
          programOpenId: text(firstNonEmpty(lib.id, matched?.programOpenId, pid, '')),
          sourceAiringHash: hash,
          title,
          importedTitle: matched?.importedTitle || title,
          nola: text(firstNonEmpty(lib.nola_code, matched?.nola, placement.nolaCode, placement.nola_code, placement.nola, '')),
          topic: nonSpecific ? 'Non-Specific' : (topicMissing ? 'Uncategorized' : rawTopic),
          secondaryTopic: text(firstNonEmpty(lib.topic_secondary, matched?.secondaryTopic, placement.topicSecondary, placement.topic_secondary, '')),
          topicMissing,
          isNonSpecific: nonSpecific,
          distributor: text(firstNonEmpty(lib.distributor, matched?.distributor, placement.distributor, '')),
          libraryKnown: Boolean(lib && lib.id),
          rightsStart: text(lib.rights_start || ''),
          rightsEnd: text(lib.rights_end || ''),
          rightsStartKey: normalizedDateKey(lib.rights_start || ''),
          rightsEndKey: normalizedDateKey(lib.rights_end || ''),
          rightsEndDisplay: formatDateKey(lib.rights_end || ''),
          rightsExpired: rightsExpiredFromEnd(lib.rights_end || ''),
          rightsNotStarted: rightsNotStartedFromStart(lib.rights_start || ''),
          inactive: libraryInactive(lib),
          date,
          dateKey,
          startMinutes,
          endMinutes,
          durationMinutes,
          daypart: daypartFromMinutes(Number.isFinite(startMinutes) ? startMinutes : null),
          weekpart: weekpartFromDate(date),
          season,
          year,
          seasonYear: `${season} ${year}`,
          fundraiser: text(schedule.title || matched?.fundraiser || `${season} ${year}`),
          dollars,
          pledges,
          live: liveFlag,
          liveState: liveFlag ? 'live' : 'nonlive',
          liveSource: 'schedule-placement',
          scheduleMatched: true,
          scheduleTitle: schedule.title || ''
        });
      });
    });
    state.liveBreakDiagnostics = diagnostics;
    return out;
  }

  function groupBy(rows, fn) {
    const map = new Map();
    rows.forEach((row) => {
      const key = fn(row) || 'Unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });
    return map;
  }

  function seasonMix(records = []) {
    const counts = Object.fromEntries(SEASONS.map((season) => [season, 0]));
    records.forEach((record) => { if (counts[record.season] != null) counts[record.season] += 1; });
    const label = `[${SEASONS.map((season) => `${SEASON_CODE[season]}-${counts[season]}`).join(', ')}]`;
    const allFour = SEASONS.every((season) => counts[season] > 0);
    return { counts, label, allFour };
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
    const deviations = clean.map((value) => Math.abs(value - median));
    const mad = medianValue(deviations);
    if (!(mad > 0)) return { outlierCount: 0, highOutliers: 0, lowOutliers: 0, outlierValues: [] };
    const outlierValues = clean.filter((value) => Math.abs((0.6745 * (value - median)) / mad) > 3.5);
    return {
      outlierCount: outlierValues.length,
      highOutliers: outlierValues.filter((value) => value > median).length,
      lowOutliers: outlierValues.filter((value) => value < median).length,
      outlierValues
    };
  }

  function outlierLabel(row = {}) {
    const count = Number(row.outlierCount || 0);
    if (!count) return 'None flagged';
    const bits = [];
    if (row.highOutliers) bits.push(`${row.highOutliers} high`);
    if (row.lowOutliers) bits.push(`${row.lowOutliers} low`);
    return `${count} unusual${bits.length ? ` · ${bits.join(' / ')}` : ''}`;
  }

  function groupDetailId(row = {}) {
    const id = `group-${state.groupDetailRows.size + 1}`;
    state.groupDetailRows.set(id, row);
    return id;
  }

  function groupTitleDetailCell(row = {}) {
    const id = groupDetailId(row);
    return `<button type="button" class="analytics-detail-link" data-group-detail-id="${escapeHtml(id)}" data-group-detail-mode="all">${labelWithMixCell(row)}</button>`;
  }

  function distributionLabel(row = {}) {
    const count = Array.isArray(row.records) ? row.records.length : Number(row.broadcasts || 0);
    const zeroCount = Number(row.zeroCount || 0);
    if (row.zeroDominated && count > 0) {
      const outlierText = Number(row.outlierCount || 0) ? ` · ${outlierLabel(row)}` : '';
      return `Zero-dominated · ${zeroCount}/${count} at $0${outlierText}`;
    }
    return outlierLabel(row);
  }

  function groupOutlierDetailCell(row = {}) {
    const hasOutliers = Number(row.outlierCount || 0) > 0;
    const hasDistributionWarning = Boolean(row.zeroDominated);
    if (!hasOutliers && !hasDistributionWarning) return escapeHtml(distributionLabel(row));
    const id = groupDetailId(row);
    const mode = hasDistributionWarning ? 'distribution' : 'outliers';
    const linkClass = hasDistributionWarning ? 'distribution-link' : 'outlier-link';
    return `<button type="button" class="analytics-detail-link ${linkClass}" data-group-detail-id="${escapeHtml(id)}" data-group-detail-mode="${mode}">${escapeHtml(distributionLabel(row))}</button>`;
  }

  function outlierStatusForRecord(row = {}, record = {}) {
    const value = Number(record.dollars || 0);
    const flagged = Array.isArray(row.outlierValues) && row.outlierValues.some((candidate) => Number(candidate) === value);
    if (!flagged) return '';
    const median = Number(row.median || 0);
    if (value > median) return 'High outlier';
    if (value < median) return 'Low outlier';
    return 'Unusual result';
  }

  function closestMedianSeason(realSeasonStats = []) {
    const median = medianValue(realSeasonStats.map((item) => item.avg));
    return realSeasonStats.reduce((winner, item) => {
      if (!winner) return item;
      const winnerDistance = Math.abs(Number(winner.avg || 0) - median);
      const itemDistance = Math.abs(Number(item.avg || 0) - median);
      if (itemDistance < winnerDistance) return item;
      if (itemDistance === winnerDistance && Number(item.avg || 0) < Number(winner.avg || 0)) return item;
      return winner;
    }, null);
  }

  function summarizeGroup(title, records) {
    const seasons = new Set(records.map((record) => record.seasonYear));
    const resultValues = records.map((record) => Number(record.dollars || 0));
    const dollars = resultValues.reduce((sum, value) => sum + value, 0);
    const pledges = records.reduce((sum, record) => sum + Number(record.pledges || 0), 0);
    const median = medianValue(resultValues);
    const zeroCount = resultValues.filter((value) => value === 0).length;
    const zeroDominated = dollars > 0 && zeroCount > resultValues.length / 2;
    const mix = seasonMix(records);
    const ids = [...new Set(records.map((record) => record.programOpenId || record.programId).filter(Boolean))];
    const rightsEndKeys = [...new Set(records.map((record) => record.rightsEndKey || '').filter(Boolean))].sort();
    const rightsEndKey = rightsEndKeys[0] || '';
    return {
      title,
      programOpenId: ids.length === 1 ? ids[0] : '',
      rightsEnd: rightsEndKey,
      rightsEndDisplay: rightsEndKey ? formatDateKey(rightsEndKey) : '—',
      dollars,
      broadcastDollars: records.reduce((sum, record) => sum + Number(firstNonEmpty(record.broadcastDollars, record.dollars, 0) || 0), 0),
      onlineDollars: records.reduce((sum, record) => sum + Number(record.onlineDollars || 0), 0),
      mailDollars: records.reduce((sum, record) => sum + Number(record.mailDollars || 0), 0),
      pledges,
      broadcasts: records.reduce((sum, record) => sum + Number(firstNonEmpty(record.broadcasts, 1) || 0), 0),
      seasons: seasons.size,
      avg: records.length ? dollars / records.length : 0,
      median,
      zeroCount,
      zeroShare: resultValues.length ? zeroCount / resultValues.length : 0,
      zeroDominated,
      ...outlierSummary(resultValues),
      weak: records.length < WEAK_BROADCASTS || seasons.size < WEAK_SEASONS,
      mix: mix.label,
      allFour: mix.allFour,
      records
    };
  }


  function formatTimeFromMinutes(value) {
    if (!Number.isFinite(Number(value))) return '—';
    const total = ((Number(value) % 1440) + 1440) % 1440;
    const hour24 = Math.floor(total / 60);
    const minute = Math.round(total % 60);
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
  }

  function timeDistanceMinutes(a, b) {
    if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return 720;
    const raw = Math.abs(Number(a) - Number(b));
    return Math.min(raw, 1440 - raw);
  }

  function durationFromTimes(start, end) {
    if (!Number.isFinite(Number(start)) || !Number.isFinite(Number(end))) return null;
    let duration = Number(end) - Number(start);
    if (duration < 0) duration += 1440;
    return duration > 0 ? duration : null;
  }

  function durationFromRecord(record = {}) {
    const explicit = Number(firstNonEmpty(record.durationMinutes, record.programMinutes, record.program_minutes, null));
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    return durationFromTimes(record.startMinutes, record.endMinutes);
  }

  function formatDuration(minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) return 'unknown length';
    if (value < 75) return `${Math.round(value)} min`;
    const hours = Math.floor(value / 60);
    const mins = Math.round(value % 60);
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
  }

  function durationCompatibility(live = {}, candidate = {}) {
    const liveDuration = durationFromRecord(live);
    const candidateDuration = durationFromRecord(candidate);
    if (!liveDuration || !candidateDuration) {
      return {
        ok: false,
        reason: `missing program length (${formatDuration(liveDuration)} vs ${formatDuration(candidateDuration)})`,
        penalty: 900,
        liveDuration,
        candidateDuration
      };
    }
    const shorter = Math.min(liveDuration, candidateDuration);
    const longer = Math.max(liveDuration, candidateDuration);
    const ratio = shorter / longer;
    const delta = Math.abs(liveDuration - candidateDuration);
    const crossesLongShortBoundary = longer >= 120 && shorter <= 75;
    const ok = !crossesLongShortBoundary && (ratio >= 0.70 || delta <= 30);
    return {
      ok,
      reason: ok ? `similar length (${formatDuration(liveDuration)} vs ${formatDuration(candidateDuration)})` : `length mismatch (${formatDuration(liveDuration)} vs ${formatDuration(candidateDuration)})`,
      penalty: ok ? Math.min(180, delta * 2) : 900,
      liveDuration,
      candidateDuration
    };
  }

  function meaningfulTitleTokens(value = '') {
    const generic = new Set(['a', 'an', 'and', 'at', 'by', 'classic', 'classics', 'collection', 'concert', 'episode', 'favorite', 'favorites', 'for', 'forever', 'from', 'great', 'in', 'live', 'of', 'on', 'pbs', 'performance', 'performances', 'program', 'special', 'the', 'to', 'with']);
    return lookupKey(value || '').split(' ').filter((token) => token.length > 2 && !generic.has(token));
  }

  function titleTokenSimilarity(a = '', b = '') {
    const aTokens = new Set(meaningfulTitleTokens(a));
    const bTokens = new Set(meaningfulTitleTokens(b));
    if (!aTokens.size || !bTokens.size) return 0;
    let overlap = 0;
    aTokens.forEach((token) => { if (bTokens.has(token)) overlap += 1; });
    const union = new Set([...aTokens, ...bTokens]).size || 1;
    return overlap / union;
  }

  function titleTokenOverlapCount(a = '', b = '') {
    const aTokens = new Set(meaningfulTitleTokens(a));
    const bTokens = new Set(meaningfulTitleTokens(b));
    let overlap = 0;
    aTokens.forEach((token) => { if (bTokens.has(token)) overlap += 1; });
    return overlap;
  }

  function isPerformerStyleRecord(record = {}) {
    const context = lookupKey(`${record.topic || ''} ${record.secondaryTopic || ''} ${record.title || ''} ${record.importedTitle || ''}`);
    return /(^| )(music|concert|singer|artist|band|orchestra|performance|performances|great performances|opera|vocal|song|songs)($| )/.test(context);
  }


  function intrinsicLiveFormatReason(record = {}) {
    const title = lookupKey(`${record.title || ''} ${record.importedTitle || ''}`);
    if (/^ask the( |$)/.test(title) || /(^| )ask the (doctor|doctors|expert|experts|lawyer|lawyers|vet|vets|governor|mayor|candidates|candidates? forum)( |$)/.test(title)) {
      return 'program itself is a live/call-in format';
    }
    return '';
  }

  function musicStyleBucket(record = {}) {
    if (!isPerformerStyleRecord(record)) return '';
    const value = lookupKey(`${record.title || ''} ${record.importedTitle || ''} ${record.secondaryTopic || ''}`);
    if (/(josh groban|groban|andrea bocelli|bocelli|il volo|il divo|jackie evancho|sarah brightman|celtic woman|celtic thunder|tenors|classical crossover|crossover)/.test(value)) return 'classical-crossover-vocal';
    if (/(roy orbison|orbison|elvis|bee gees|neil diamond|john denver|johnny mathis|frankie valli|carole king|peter paul mary|doo wop|oldies|60s|70s|my music|nostalgia)/.test(value)) return 'nostalgia-pop';
    if (/(country|johnny cash|dolly parton|willie nelson|ken burns country|garth brooks|patsy cline)/.test(value)) return 'country';
    if (/(rock|beatles|rolling stones|fleetwood mac|eagles|red rocks|pink floyd|grateful dead)/.test(value)) return 'rock';
    if (/(opera|pavarotti|metropolitan opera|aria|arias)/.test(value)) return 'opera';
    if (/(orchestra|symphony|classical|vienna|andre rieu|rieu)/.test(value)) return 'classical-orchestral';
    return '';
  }

  function sameKnownMusicStyle(a = {}, b = {}) {
    const aBucket = musicStyleBucket(a);
    const bBucket = musicStyleBucket(b);
    return Boolean(aBucket && bBucket && aBucket === bBucket);
  }

  function knownDifferentMusicStyle(a = {}, b = {}) {
    const aBucket = musicStyleBucket(a);
    const bBucket = musicStyleBucket(b);
    return Boolean(aBucket && bBucket && aBucket !== bBucket);
  }

  function suspiciousSameDollarClone(live = {}, candidate = {}) {
    const liveDollars = Number(live.dollars || 0);
    const candidateDollars = Number(candidate.dollars || 0);
    if (!(liveDollars > 0) || liveDollars !== candidateDollars) return false;
    const sameTitle = lookupKey(live.title || '') && lookupKey(live.title || '') === lookupKey(candidate.title || '');
    const sameIdentity = programIdentityKey(live) && programIdentityKey(live) === programIdentityKey(candidate);
    if (!sameTitle && !sameIdentity) return false;
    const hashA = text(live.sourceAiringHash || '');
    const hashB = text(candidate.sourceAiringHash || '');
    if (!hashA || !hashB || hashA === hashB) return true;
    // Same program, same dollars, different live state is more likely a duplicated imported result than evidence.
    return true;
  }

  function sameSourceAiring(a = {}, b = {}) {
    const hashA = text(a.sourceAiringHash || '');
    const hashB = text(b.sourceAiringHash || '');
    if (hashA && hashB && hashA === hashB) return true;
    const idA = text(a.id || '');
    const idB = text(b.id || '');
    if (idA && idB && idA === idB) return true;
    return Boolean(a.dateKey && b.dateKey && a.dateKey === b.dateKey
      && Number(a.startMinutes) === Number(b.startMinutes)
      && programIdentityKey(a) === programIdentityKey(b));
  }

  function liveMatchEligibility(live = {}, candidate = {}) {
    if (!candidate || candidate.liveState !== 'nonlive') return { ok: false, reason: 'not a non-live airing' };
    const liveIntrinsic = intrinsicLiveFormatReason(live);
    if (liveIntrinsic) return { ok: false, reason: liveIntrinsic };
    const candidateIntrinsic = intrinsicLiveFormatReason(candidate);
    if (candidateIntrinsic) return { ok: false, reason: `comparison airing is ${candidateIntrinsic}` };
    if (sameSourceAiring(live, candidate)) return { ok: false, reason: 'same source airing' };
    if (live.dateKey && candidate.dateKey && live.dateKey === candidate.dateKey) return { ok: false, reason: 'same calendar night' };
    if (suspiciousSameDollarClone(live, candidate)) return { ok: false, reason: 'same-title same-dollar clone risk' };
    if (live.topic && candidate.topic && live.topic !== candidate.topic) return { ok: false, reason: 'different primary topic' };
    if (live.daypart && candidate.daypart && live.daypart !== candidate.daypart) return { ok: false, reason: 'different daypart' };
    if (live.weekpart && candidate.weekpart && live.weekpart !== candidate.weekpart) return { ok: false, reason: 'different weekpart' };
    const duration = durationCompatibility(live, candidate);
    if (!duration.ok) return { ok: false, reason: duration.reason, duration };
    const exactTitle = lookupKey(live.title || '') && lookupKey(live.title || '') === lookupKey(candidate.title || '');
    const sameSecondary = lookupKey(live.secondaryTopic || '') && lookupKey(live.secondaryTopic || '') === lookupKey(candidate.secondaryTopic || '');
    const sameStyle = sameKnownMusicStyle(live, candidate);
    const differentStyle = knownDifferentMusicStyle(live, candidate);
    const similarity = titleTokenSimilarity(live.title || live.importedTitle || '', candidate.title || candidate.importedTitle || '');
    const overlap = titleTokenOverlapCount(live.title || live.importedTitle || '', candidate.title || candidate.importedTitle || '');
    if (!exactTitle && differentStyle) {
      return { ok: false, reason: `different music style (${musicStyleBucket(live)} vs ${musicStyleBucket(candidate)})`, similarity, duration };
    }
    if (!exactTitle && isPerformerStyleRecord(live) && isPerformerStyleRecord(candidate) && !(sameSecondary || sameStyle) && overlap < 1) {
      return { ok: false, reason: 'different performer/title', similarity, duration };
    }
    if (!exactTitle && !sameSecondary && !sameStyle && similarity < 0.2) return { ok: false, reason: 'different specific title', similarity, duration };
    return { ok: true, reason: exactTitle ? 'same title' : (sameSecondary ? 'same secondary topic' : (sameStyle ? `same music style (${musicStyleBucket(live)})` : 'similar title')), similarity, duration };
  }

  function liveMatchScore(live = {}, candidate = {}) {
    let score = 0;
    const notes = [];
    const eligibility = liveMatchEligibility(live, candidate);
    if (!eligibility.ok) return { score: Number.POSITIVE_INFINITY, notes: [eligibility.reason], timeDelta: null, eligible: false };
    notes.push(eligibility.reason);
    if (eligibility.duration?.reason) notes.push(eligibility.duration.reason);
    if (live.topic && candidate.topic && live.topic === candidate.topic) notes.push('same primary topic');
    if (live.daypart && candidate.daypart && live.daypart === candidate.daypart) notes.push('same daypart');
    if (live.weekpart && candidate.weekpart && live.weekpart === candidate.weekpart) notes.push('same weekpart');
    const timeDelta = timeDistanceMinutes(live.startMinutes, candidate.startMinutes);
    score += Math.min(480, timeDelta);
    score += Number(eligibility.duration?.penalty || 0);
    notes.push(`${Math.round(timeDelta)} min time gap`);
    if (live.season && candidate.season && live.season !== candidate.season) score += 80;
    if (Number.isFinite(Number(live.year)) && Number.isFinite(Number(candidate.year))) score += Math.min(200, Math.abs(Number(live.year) - Number(candidate.year)) * 35);
    if (eligibility.reason !== 'same title') score += 120;
    if (candidate.comparisonSourceLabel) notes.push(candidate.comparisonSourceLabel);
    return { score, notes, timeDelta, eligible: true };
  }

  function recordMatchesLiveComparisonFilters(record = {}) {
    const searchKey = lookupKey(state.search);
    const selectedTopics = Array.isArray(state.topicFilters) ? state.topicFilters : [];
    if (searchKey && !lookupKey(`${record.title} ${record.importedTitle} ${record.nola}`).includes(searchKey)) return false;
    if (selectedTopics.length && !selectedTopics.includes(record.topic)) return false;
    if (state.secondaryTopicFilter !== 'all' && (record.secondaryTopic || '') !== state.secondaryTopicFilter) return false;
    if (state.season !== 'all' && record.season !== state.season) return false;
    if (!yearFilterMatches(record.year)) return false;
    if (state.advancedDistributor !== 'all' && (record.distributor || 'Unknown') !== state.advancedDistributor) return false;
    if (state.advancedDaypart !== 'all' && record.daypart !== state.advancedDaypart) return false;
    if (state.advancedWeekpart !== 'all' && record.weekpart !== state.advancedWeekpart) return false;
    if (!durationFilterMatches(record)) return false;
    return true;
  }

  function liveComparisonCandidateKey(record = {}) {
    return text(firstNonEmpty(record.sourceAiringHash, record.id, `${record.dateKey || ''}|${record.startMinutes ?? ''}|${programIdentityKey(record)}|${record.title || ''}|${record.dollars || 0}`));
  }

  function nonLiveCandidatesForLiveComparison(scheduleRows = []) {
    // Saved non-live schedule placements are the cleanest comparison source.
    // If that pool is too small, include historical imported airing rows that have no saved live flag.
    // These are labeled as historical candidates and still have to pass the strict same-topic/daypart/weekpart/length/title checks.
    const unique = [];
    const seen = new Set();
    const addCandidate = (record, sourceLabel = '') => {
      if (!record || !(Number(record.dollars || 0) > 0)) return;
      const key = liveComparisonCandidateKey(record);
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push(sourceLabel ? { ...record, liveState: 'nonlive', liveSource: sourceLabel, comparisonSourceLabel: sourceLabel } : record);
    };

    scheduleRows
      .filter((record) => record.liveState === 'nonlive')
      .forEach((record) => addCandidate(record));

    (state.records || [])
      .filter((record) => record.liveState !== 'live')
      .filter((record) => !record.isNonSpecific)
      .filter((record) => recordMatchesLiveComparisonFilters(record))
      .forEach((record) => addCandidate(record, record.scheduleMatched ? 'saved non-live schedule' : 'historical non-live airing'));

    return unique;
  }

  function buildLiveMatchedPairs() {
    const rows = filteredRecordsFor('live').filter((record) => record.liveState === 'live' || record.liveState === 'nonlive');
    const liveRows = rows.filter((record) => record.liveState === 'live').sort((a, b) => (a.date || 0) - (b.date || 0) || Number(a.startMinutes || 0) - Number(b.startMinutes || 0));
    const nonLiveRows = nonLiveCandidatesForLiveComparison(rows);
    const used = new Set();
    return liveRows.map((live) => {
      const scored = nonLiveRows
        .filter((candidate) => !used.has(liveComparisonCandidateKey(candidate)))
        .map((candidate) => ({ candidate, match: liveMatchScore(live, candidate) }));
      const candidates = scored
        .filter((item) => item.match.eligible && Number.isFinite(item.match.score))
        .sort((a, b) => a.match.score - b.match.score || Number(b.candidate.dollars || 0) - Number(a.candidate.dollars || 0));
      const bestRejected = scored
        .filter((item) => !item.match.eligible)
        .sort((a, b) => {
          const aSameTopic = a.candidate.topic === live.topic ? 0 : 1;
          const bSameTopic = b.candidate.topic === live.topic ? 0 : 1;
          const aTime = timeDistanceMinutes(live.startMinutes, a.candidate.startMinutes);
          const bTime = timeDistanceMinutes(live.startMinutes, b.candidate.startMinutes);
          return aSameTopic - bSameTopic || aTime - bTime;
        })[0] || null;
      const best = candidates[0] || null;
      if (best) used.add(liveComparisonCandidateKey(best.candidate));
      const match = best?.candidate || null;
      const difference = match ? Number(live.dollars || 0) - Number(match.dollars || 0) : null;
      const percent = match && Number(match.dollars || 0) > 0 ? (difference / Number(match.dollars || 0)) * 100 : null;
      return { live, match, difference, percent, basis: best?.match?.notes || [], score: best?.match?.score ?? null, noMatchReason: bestRejected?.match?.notes?.[0] || 'no strong non-live match' };
    });
  }

  function liveMatchedSummary(pairs = []) {
    const matched = pairs.filter((pair) => pair.match);
    const liveTotal = matched.reduce((sum, pair) => sum + Number(pair.live.dollars || 0), 0);
    const matchTotal = matched.reduce((sum, pair) => sum + Number(pair.match.dollars || 0), 0);
    const liveAvg = matched.length ? liveTotal / matched.length : 0;
    const matchAvg = matched.length ? matchTotal / matched.length : 0;
    const diff = liveAvg - matchAvg;
    const pct = matchAvg > 0 ? (diff / matchAvg) * 100 : null;
    return { matchedCount: matched.length, unmatchedCount: pairs.length - matched.length, liveTotal, matchTotal, liveAvg, matchAvg, diff, pct };
  }

  function renderLiveMatchedComparison() {
    const pairs = buildLiveMatchedPairs();
    const matched = pairs.filter((pair) => pair.match);
    if (!pairs.length) {
      dom.table.insertAdjacentHTML('beforeend', '<div class="matched-section"><h4>1:1 live vs non-live comparison</h4><p class="matched-note">No saved live-break airings fit the current filters, so there is nothing to compare.</p></div>');
      return;
    }
    if (!matched.length) {
      dom.table.insertAdjacentHTML('beforeend', '<div class="matched-section"><h4>1:1 live vs non-live comparison</h4><p class="matched-note">Saved live-break airings exist, but no comparable non-live scheduled airings fit the current filters closely enough to compare. Try clearing topic/daypart/weekpart filters.</p></div>');
      return;
    }
    const summary = liveMatchedSummary(pairs);
    const rows = matched.map((pair) => {
      const liveDate = pair.live.date ? pair.live.date.toLocaleDateString() : '—';
      const matchDate = pair.match?.date ? pair.match.date.toLocaleDateString() : '—';
      const diffClass = Number(pair.difference || 0) >= 0 ? 'ok' : 'risk';
      const pctText = Number.isFinite(pair.percent) ? ` (${formatPercent(pair.percent)})` : '';
      const sourceLabel = pair.match?.comparisonSourceLabel || pair.match?.liveSource || '';
      const matchCell = `${programTitleCell(pair.match)}<div class="match-basis">${escapeHtml(matchDate)} · ${escapeHtml(pair.match.daypart || 'unknown daypart')} · ${escapeHtml(pair.match.topic || 'unknown topic')} · ${escapeHtml(formatTimeFromMinutes(pair.match.startMinutes))} · ${escapeHtml(formatDuration(durationFromRecord(pair.match)))}${sourceLabel ? ` · ${escapeHtml(sourceLabel)}` : ''}</div>`;
      return `<tr>
        <td>${programTitleCell(pair.live)}<div class="match-basis">${escapeHtml(liveDate)} · ${escapeHtml(pair.live.daypart || 'unknown daypart')} · ${escapeHtml(pair.live.topic || 'unknown topic')} · ${escapeHtml(formatTimeFromMinutes(pair.live.startMinutes))} · ${escapeHtml(formatDuration(durationFromRecord(pair.live)))}</div></td>
        <td>${matchCell}</td>
        <td class="money emphasis">${formatMoney(pair.live.dollars)}</td>
        <td class="money">${formatMoney(pair.match.dollars)}</td>
        <td class="money ${diffClass}">${formatMoney(pair.difference)}${escapeHtml(pctText)}</td>
        <td><span class="match-basis">${escapeHtml(pair.basis.length ? pair.basis.join(' · ') : 'Comparable non-live airing')}</span></td>
      </tr>`;
    }).join('');
    dom.table.insertAdjacentHTML('beforeend', `<div class="matched-section">
      <h4>1:1 live vs non-live comparison</h4>
      <p class="matched-note">This lists only live-break airings that have a strong comparable non-live airing. Saved non-live schedule placements are preferred; if none fit, historical imported airings with no saved live flag may be used, but they still must pass primary topic, daypart, weekday/weekend, start time, program length, season/year, and title/performer checks. Live airings with no good comparison are counted above but not listed as fake pairs.</p>
      <div class="matched-summary">
        <div class="stat"><div class="v">${formatNumber(summary.matchedCount)}</div><div>Comparable pairs</div></div>
        <div class="stat"><div class="v">${formatNumber(summary.unmatchedCount)}</div><div>Unmatched live airings</div></div>
        <div class="stat"><div class="v">${formatMoney(summary.liveAvg)}</div><div>Live avg / airing</div></div>
        <div class="stat"><div class="v">${formatMoney(summary.matchAvg)}</div><div>Non-live avg</div></div>
        <div class="stat"><div class="v">${formatMoney(summary.diff)}${Number.isFinite(summary.pct) ? ` · ${formatPercent(summary.pct)}` : ''}</div><div>Avg difference</div></div>
      </div>
      <table><thead><tr><th>Live break airing</th><th>Closest non-live airing</th><th class="money emphasis">Live $</th><th class="money">Non-live $</th><th class="money">Difference</th><th>Comparison basis</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`);
    dom.table.querySelectorAll('[data-program-detail-id]').forEach((button) => {
      button.addEventListener('click', () => openProgramDetail(button.dataset.programDetailId || '', button.dataset.programDetailTitle || button.textContent || ''));
    });
  }

  function programIdentityKey(record = {}) {
    const id = text(record.programOpenId || record.programId || '');
    if (id) return `id:${id}`;
    const nola = nolaKey(record.nola || '');
    const title = lookupKey(record.title || record.importedTitle || '');
    return nola && title ? `nola-title:${nola}|${title}` : `title:${title}`;
  }

  function groupDisplayTitle(records = [], fallback = '') {
    return text(records.map((record) => record.title).find(Boolean)) || fallback || 'Unknown';
  }

  function applyEvidence(rows) {
    return state.evidence === 'hide' ? rows.filter((row) => !row.weak) : rows;
  }


  function seasonOverviewUsesDriveTotals() {
    return state.question === 'seasonOverview'
      && !state.cohort?.keySet
      && !lookupKey(state.search)
      && !(Array.isArray(state.topicFilters) && state.topicFilters.length)
      && state.secondaryTopicFilter === 'all'
      && state.advancedDistributor === 'all'
      && state.advancedLive === 'all'
      && state.advancedDaypart === 'all'
      && state.advancedWeekpart === 'all'
      && state.advancedDuration === 'all';
  }

  function seasonOverviewRecords() {
    if (seasonOverviewUsesDriveTotals()) {
      return (state.driveSeasonRecords || []).filter((record) => {
        if (!yearFilterMatches(record.year)) return false;
        if (state.season !== 'all' && record.season !== state.season) return false;
        return true;
      });
    }
    return filteredRecordsFor('seasonOverview');
  }

  function seasonOverviewModeText() {
    return seasonOverviewUsesDriveTotals()
      ? 'This view is using full fundraiser totals from saved schedules: broadcast dollars plus Online $ and Mail $. Rank-by/evidence filters do not apply to full drive totals.'
      : 'This view is using content-level airing rows because a program/topic/distributor/live/daypart/weekpart filter is active. Online $ and Mail $ cannot be attributed to specific content in this mode.';
  }

  function yearFilterMatches(year) {
    if (!Array.isArray(state.yearFilters)) return true;
    return state.yearFilters.includes(String(year));
  }

  function durationFilterMatches(record = {}) {
    const selected = state.advancedDuration || 'all';
    if (selected === 'all') return true;
    const minutes = Number(record.durationMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return selected === 'unknown';
    if (selected === '60') return minutes <= 60;
    if (selected === '61-90') return minutes > 60 && minutes <= 90;
    if (selected === '91-120') return minutes > 90 && minutes <= 120;
    if (selected === '121+') return minutes > 120;
    return true;
  }

  function supportsCurrentFilter(filterName) {
    const question = QUESTIONS[state.question] || QUESTIONS.programs;
    if (filterName === 'season') return question.useSeason !== false;
    if (filterName === 'year') return question.useYear !== false;
    return true;
  }

  function filteredRecordsFor(questionId = state.question) {
    const question = QUESTIONS[questionId] || QUESTIONS.programs;
    const searchKey = lookupKey(state.search);
    const selectedTopics = Array.isArray(state.topicFilters) ? state.topicFilters : [];
    const selectedSecondaryTopic = state.secondaryTopicFilter || 'all';
    const sourceRecords = question.source === 'schedule' ? state.scheduleRecords : state.records;
    return sourceRecords.filter((record) => {
      if (!recordInAnalyticsCohort(record)) return false;
      if (question.excludeNonSpecific && record.isNonSpecific) return false;
      if (searchKey && !lookupKey(`${record.title} ${record.importedTitle} ${record.nola}`).includes(searchKey)) return false;
      if (selectedTopics.length && !selectedTopics.includes(record.topic)) return false;
      if (selectedSecondaryTopic !== 'all' && (record.secondaryTopic || '') !== selectedSecondaryTopic) return false;
      if (!recordWithinBroadcastRights(record)) return false;
      if (question.useSeason !== false && state.season !== 'all' && record.season !== state.season) return false;
      if (question.useYear !== false && !yearFilterMatches(record.year)) return false;
      if (state.advancedDistributor !== 'all' && (record.distributor || 'Unknown') !== state.advancedDistributor) return false;
      if (questionId !== 'live' && state.advancedLive !== 'all' && record.liveState !== state.advancedLive) return false;
      if (state.advancedDaypart !== 'all' && record.daypart !== state.advancedDaypart) return false;
      if (state.advancedWeekpart !== 'all' && record.weekpart !== state.advancedWeekpart) return false;
      if (!durationFilterMatches(record)) return false;
      return true;
    });
  }

  function metricValue(row) {
    if (state.metric === 'median') return Number(row.median || 0);
    if (state.metric === 'total') return Number(row.dollars || 0);
    if (state.metric === 'pledges') return Number(row.pledges || 0);
    if (state.metric === 'broadcasts') return Number(row.broadcasts || 0);
    return Number(row.avg || 0);
  }

  function formatMetricValue(row) {
    if (state.metric === 'median') return formatMoney(row.median || 0);
    if (state.metric === 'total') return formatMoney(row.dollars || 0);
    if (state.metric === 'pledges') return formatNumber(row.pledges || 0);
    if (state.metric === 'broadcasts') return formatNumber(row.broadcasts || 0);
    return formatMoney(row.avg || 0);
  }

  function metricLabel() {
    if (state.metric === 'median') return 'Median / airing';
    if (state.metric === 'total') return 'Total dollars';
    if (state.metric === 'pledges') return 'Pledges';
    if (state.metric === 'broadcasts') return 'Broadcasts';
    return 'Avg / airing';
  }

  function programTitleCell(row) {
    const label = escapeHtml(row.title || 'Untitled program');
    const programId = text(row.programOpenId || row.programId || '');
    const suffix = rightsEndNote(row);
    if (!programId) return `${label}${suffix}`;
    return `<button type="button" class="program-link" data-program-detail-id="${escapeHtml(programId)}" data-program-detail-title="${escapeHtml(row.title || '')}">${label}</button>${suffix}`;
  }

  function startTimeLabel(record = {}) {
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

  function rowsPrograms() {
    return applyEvidence([...groupBy(filteredRecordsFor('programs'), (record) => programIdentityKey(record))]
      .map(([key, records]) => summarizeGroup(groupDisplayTitle(records, key), records))
      .sort((a, b) => metricValue(b) - metricValue(a) || b.dollars - a.dollars));
  }

  function rowsTopics() {
    return applyEvidence([...groupBy(filteredRecordsFor('topics'), (record) => record.topic)]
      .map(([title, records]) => summarizeGroup(title, records))
      .sort((a, b) => metricValue(b) - metricValue(a) || b.avg - a.avg));
  }

  function rowsSecondaryTopics() {
    return applyEvidence([...groupBy(filteredRecordsFor('secondaryTopics'), (record) => record.secondaryTopic || 'Unassigned secondary topic')]
      .map(([title, records]) => summarizeGroup(title, records))
      .filter((row) => row.title && row.title !== 'Unassigned secondary topic')
      .sort((a, b) => metricValue(b) - metricValue(a) || b.avg - a.avg || b.dollars - a.dollars));
  }

  function rowsTopicOverview() {
    return [...groupBy(filteredRecordsFor('topicOverview'), (record) => record.topic)]
      .map(([title, records]) => summarizeGroup(title, records))
      .sort((a, b) => metricValue(b) - metricValue(a) || b.dollars - a.dollars || b.avg - a.avg);
  }

  function rowsSeasonOverview() {
    const records = seasonOverviewRecords();
    if (seasonOverviewUsesDriveTotals()) {
      return [...records].sort((a, b) => (Number(b.year || 0) - Number(a.year || 0)) || (SEASONS.indexOf(a.season) - SEASONS.indexOf(b.season)));
    }
    return [...groupBy(records, (record) => `${record.season} ${record.year}`)]
      .map(([title, groupRecords]) => {
        const row = summarizeGroup(title, groupRecords);
        row.season = groupRecords[0]?.season || '';
        row.year = groupRecords[0]?.year || '';
        row.broadcastDollars = row.dollars;
        row.onlineDollars = null;
        row.mailDollars = null;
        row.scheduleTitle = 'Content-level airing rows';
        row.sourceLabel = 'Imported/content airing rows';
        return row;
      })
      .sort((a, b) => (Number(b.year || 0) - Number(a.year || 0)) || (SEASONS.indexOf(a.season) - SEASONS.indexOf(b.season)));
  }

  function rowsUncategorized() {
    return [...groupBy(filteredRecordsFor('uncategorized').filter((record) => record.topicMissing), (record) => record.title)]
      .map(([title, records]) => {
        const row = summarizeGroup(title, records);
        row.nola = records.map((record) => record.nola).find(Boolean) || '';
        row.importedTitles = [...new Set(records.map((record) => record.importedTitle).filter(Boolean))].slice(0, 4).join('; ');
        row.lastSeen = records.map((record) => record.seasonYear).sort((a, b) => seasonYearSortKey(b) - seasonYearSortKey(a))[0] || '';
        return row;
      })
      .sort((a, b) => b.broadcasts - a.broadcasts || a.title.localeCompare(b.title));
  }

  function historyRowsBase() {
    const rows = filteredRecordsFor('history');
    const out = [];
    groupBy(rows, (record) => programIdentityKey(record)).forEach((records, key) => {
      const title = groupDisplayTitle(records, key);
      const drives = [...groupBy(records, (record) => record.seasonYear)]
        .map(([seasonYear, driveRecords]) => ({
          seasonYear,
          sortKey: seasonYearSortKey(seasonYear),
          date: driveRecords.map((record) => record.date).sort((a, b) => a - b)[0],
          total: driveRecords.reduce((sum, record) => sum + record.dollars, 0),
          broadcasts: driveRecords.length,
          records: driveRecords
        }))
        .filter((drive) => drive.seasonYear !== 'Unseasoned')
        .sort((a, b) => a.sortKey - b.sortKey);
      if (drives.length < 2) return;
      const first = drives[0];
      const last = drives[drives.length - 1];
      const previous = drives.length > 1 ? drives[drives.length - 2] : null;
      const peak = drives.reduce((best, drive) => drive.total > best.total ? drive : best, drives[0]);
      const yearsTracked = (last.date - first.date) / (365.25 * 24 * 60 * 60 * 1000);
      const pauseYears = previous ? (last.date - previous.date) / (365.25 * 24 * 60 * 60 * 1000) : 0;
      const firstChange = first.total ? ((last.total - first.total) / first.total) * 100 : 0;
      const peakChange = peak.total ? ((last.total - peak.total) / peak.total) * 100 : 0;
      out.push({
        title,
        programOpenId: [...new Set(records.map((record) => record.programOpenId || record.programId).filter(Boolean))][0] || '',
        first,
        last,
        previous,
        peak,
        drives,
        driveCount: drives.length,
        broadcasts: records.length,
        seasons: new Set(records.map((record) => record.season)).size,
        yearsTracked,
        pauseYears,
        firstChange,
        peakChange,
        dollars: last.total,
        weak: drives.length < 3 || records.length < WEAK_BROADCASTS,
        records
      });
    });
    return out;
  }

  function rowsHistory() {
    return applyEvidence(historyRowsBase().sort((a, b) => a.firstChange - b.firstChange));
  }

  function rowsComeback() {
    return applyEvidence(historyRowsBase()
      .filter((row) => row.pauseYears >= LONG_PAUSE_YEARS)
      .sort((a, b) => b.pauseYears - a.pauseYears || b.last.total - a.last.total));
  }

  function rowsLive() {
    const make = (title, records) => {
      const row = summarizeGroup(title, records);
      row.weak = false;
      return row;
    };
    const scheduleRows = filteredRecordsFor('live').filter((record) => record.liveState === 'live' || record.liveState === 'nonlive');
    return [
      make('Live break', scheduleRows.filter((record) => record.liveState === 'live')),
      make('No live break', scheduleRows.filter((record) => record.liveState === 'nonlive'))
    ];
  }

  function rowsSeasonal() {
    const rows = filteredRecordsFor('seasonal').filter((record) => !HOLIDAY_RE.test(`${record.title} ${record.topic}`));
    const out = [];
    groupBy(rows, (record) => record.topic).forEach((records, title) => {
      const bySeason = SEASONS.map((season) => {
        const matches = records.filter((record) => record.season === season);
        const dollars = matches.reduce((sum, record) => sum + record.dollars, 0);
        return { season, broadcasts: matches.length, dollars, avg: matches.length ? dollars / matches.length : null, lift: null, isBaseline: false };
      });
      const real = bySeason.filter((item) => item.broadcasts > 0 && Number.isFinite(item.avg));
      if (!real.length) return;
      const baseline = closestMedianSeason(real) || real[0];
      const baselineAvg = Number(baseline?.avg || 0);
      bySeason.forEach((item) => {
        if (!item.broadcasts || !Number.isFinite(item.avg) || !(baselineAvg > 0)) return;
        item.lift = ((item.avg - baselineAvg) / baselineAvg) * 100;
        item.isBaseline = item.season === baseline.season;
      });
      const best = real.reduce((winner, item) => Number(item.lift || 0) > Number(winner.lift || 0) ? item : winner, real[0]);
      const worst = real.reduce((winner, item) => Number(item.lift || 0) < Number(winner.lift || 0) ? item : winner, real[0]);
      const positiveLift = Math.max(...real.map((item) => Number(item.lift || 0)), 0);
      const negativeLift = Math.min(...real.map((item) => Number(item.lift || 0)), 0);
      const summary = summarizeGroup(title, records);
      out.push({
        ...summary,
        seasons: real.length,
        avg: baselineAvg,
        baselineSeason: baseline.season,
        baselineAvg,
        seasonStats: bySeason,
        bestSeason: best.season,
        bestLift: Number(best.lift || 0),
        worstSeason: worst.season,
        worstLift: Number(worst.lift || 0),
        liftRangeLabel: `${formatPercent(positiveLift)} / ${formatPercent(negativeLift)}`,
        weak: records.length < WEAK_BROADCASTS || real.length < WEAK_SEASONS
      });
    });
    return applyEvidence(out.sort((a, b) => b.avg - a.avg || b.dollars - a.dollars));
  }

  function evidenceLabel(row) {
    if (!row.weak) return '<span class="ok">Strong enough</span>';
    if (state.evidence === 'all') return '<span>Weak evidence</span>';
    return '<span class="risk">Weak evidence</span>';
  }


  function seasonStat(row, season) {
    return (row.seasonStats || []).find((item) => item.season === season) || { broadcasts: 0, dollars: 0, avg: null, lift: null, isBaseline: false };
  }

  function liftClass(value) {
    if (!Number.isFinite(value) || Math.abs(value) < 0.5) return 'flat';
    return value > 0 ? 'up' : 'down';
  }

  function seasonPerformanceCell(row, season) {
    const stat = seasonStat(row, season);
    if (!stat.broadcasts) return '<span class="muted-cell">—</span>';
    const lift = Number.isFinite(stat.lift) ? stat.lift : 0;
    const liftText = stat.isBaseline ? '0% avg' : formatPercent(lift);
    return `<b>${formatMoney(stat.avg || 0)}</b><br><span class="mix">${formatMoney(stat.dollars || 0)} · <span class="season-lift ${liftClass(lift)}">${escapeHtml(liftText)}</span></span>`;
  }

  function labelWithMixCell(row, labelHtml = '') {
    const label = labelHtml || escapeHtml(row.title || '');
    return `<span class="topic-label-cell"><span>${label}</span>${row.mix ? `<span class="mix">${escapeHtml(row.mix)}</span>` : ''}</span>`;
  }

  function topRowsText(rows, valueFn = (row) => formatMetricValue(row), limit = 3) {
    return rows.slice(0, limit).map((row, index) => `${index + 1}. <b>${escapeHtml(row.title)}</b> — ${valueFn(row)}`).join('<br>');
  }

  function programRead(rows) {
    if (!rows.length) return 'No program records match the current filters.';
    const total = rows.reduce((sum, row) => sum + Number(row.dollars || 0), 0);
    return `${formatNumber(rows.length)} programs match the current filters. Top results by ${metricLabel().toLowerCase()}:<br>${topRowsText(rows)}<br><br>Total across this result set: <b>${formatMoney(total)}</b>. The season-mix row under each title shows whether the result is spread across pledge seasons or coming from one pocket of history.`;
  }

  function topicRead(rows) {
    if (!rows.length) return 'No topic records match the current filters.';
    const top = rows[0];
    const total = rows.reduce((sum, row) => sum + Number(row.dollars || 0), 0);
    const fourSeason = rows.filter((row) => row.allFour).length;
    return `${formatNumber(rows.length)} primary topic(s) match the current filters. <b>${escapeHtml(top.title)}</b> leads by ${metricLabel().toLowerCase()} at <b>${formatMetricValue(top)}</b>.<br><br>${topRowsText(rows)}<br><br>Combined dollars in these topic rows: <b>${formatMoney(total)}</b>. ${formatNumber(fourSeason)} topic(s) have airings in all four pledge seasons.`;
  }

  function secondaryTopicRead(rows) {
    if (!rows.length) return 'No secondary-topic records match the current filters.';
    const top = rows[0];
    const total = rows.reduce((sum, row) => sum + Number(row.dollars || 0), 0);
    const topicText = Array.isArray(state.topicFilters) && state.topicFilters.length === 1 ? ` inside <b>${escapeHtml(state.topicFilters[0])}</b>` : '';
    return `${formatNumber(rows.length)} secondary topic(s) match the current filters${topicText}. <b>${escapeHtml(top.title)}</b> leads by ${metricLabel().toLowerCase()} at <b>${formatMetricValue(top)}</b>.<br><br>${topRowsText(rows)}<br><br>Combined dollars in these secondary-topic rows: <b>${formatMoney(total)}</b>. For Music, choose Primary topic = Music and leave Secondary topic on All to compare the subtopics against each other.`;
  }

  function seasonalRead(rows) {
    if (!rows.length) return 'No seasonal topic records match the current filters.';
    const topLines = rows.slice(0, 3).map((row, index) => {
      const seasonBits = SEASONS.map((season) => {
        const stat = seasonStat(row, season);
        if (!stat.broadcasts) return `${season}: no airings`;
        const liftText = stat.isBaseline ? '0% avg' : formatPercent(Number(stat.lift || 0));
        return `${season}: ${formatMoney(stat.avg || 0)} (${liftText})`;
      }).join(' · ');
      return `${index + 1}. <b>${escapeHtml(row.title)}</b> — baseline <b>${escapeHtml(row.baselineSeason || '')}</b> at <b>${formatMoney(row.baselineAvg || row.avg || 0)}</b>; ${escapeHtml(seasonBits)}; total <b>${formatMoney(row.dollars || 0)}</b>.`;
    }).join('<br>');
    return `This view compares each primary topic to <b>itself</b>, not to the whole pledge drive. For each topic, the season closest to that topic’s median seasonal average is treated as the <b>0% average</b>. The other seasons show how far above or below that topic’s own baseline they landed.<br><br>${topLines}<br><br>Use the four season columns to spot useful patterns: a topic with December +80% and August -40% is probably a December tool, even if its all-year average looks merely okay.`;
  }

  function liveRead(rows) {
    const live = rows.find((row) => row.title === 'Live break');
    const nonlive = rows.find((row) => row.title === 'No live break');
    if (!live || !nonlive) return 'No saved-schedule live-break comparison is available for this filter. This view intentionally ignores imported live-break guesses and uses saved Scheduling flags only.';
    const diff = live.avg - nonlive.avg;
    const diffText = `${diff >= 0 ? '+' : ''}${formatMoney(diff).replace('$-', '-$')}`;
    const pairs = buildLiveMatchedPairs();
    const summary = liveMatchedSummary(pairs);
    const matchedText = summary.matchedCount
      ? `<br><br>The 1:1 live vs non-live comparison pairs ${formatNumber(summary.matchedCount)} saved live-break airing(s) to comparable saved non-live scheduled airing(s). It excludes same-source/same-night records, import-only historical rows, and loose title-only pairings. Live average: <b>${formatMoney(summary.liveAvg)}</b>; non-live average: <b>${formatMoney(summary.matchAvg)}</b>; difference: <b>${formatMoney(summary.diff)}${Number.isFinite(summary.pct) ? ` · ${formatPercent(summary.pct)}` : ''}</b>.`
      : '<br><br>No 1:1 non-live comparison is available under the current filters.';
    return `This view uses <b>saved Scheduling placements only</b>. The live-break filter is ignored here on purpose, because filtering to “No live-break flag” would remove the live rows and recreate the old false $0 answer.<br><br>The raw aggregate is biased: live-break nights were chosen because they were expected to do well, while most historical non-live nights were not planned the same way. Raw live-break airings average <b>${formatMoney(live.avg)}</b>; non-live scheduled airings average <b>${formatMoney(nonlive.avg)}</b>. Raw difference: <b>${diffText}</b> per airing. Live season mix: <b>${escapeHtml(live.mix)}</b>. Non-live season mix: <b>${escapeHtml(nonlive.mix)}</b>.${matchedText}`;
  }

  function trendId(row) {
    const id = `trend-${state.trendRows.size + 1}`;
    state.trendRows.set(id, row);
    return id;
  }

  function sparkline(drives = []) {
    if (!Array.isArray(drives) || drives.length < 2) return '—';
    const values = drives.map((drive) => Number(drive.total || 0));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const width = 150;
    const height = 32;
    const pad = 3;
    const points = values.map((value, index) => {
      const x = drives.length === 1 ? width / 2 : pad + ((width - pad * 2) * index) / (drives.length - 1);
      const y = max === min ? height / 2 : pad + (height - pad * 2) * (1 - ((value - min) / (max - min)));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg class="mini-spark" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="${points.split(' ')[0].split(',')[0]}" cy="${points.split(' ')[0].split(',')[1]}" r="2"/><circle cx="${points.split(' ').at(-1).split(',')[0]}" cy="${points.split(' ').at(-1).split(',')[1]}" r="2"/></svg>`;
  }

  function trendCell(row) {
    const id = trendId(row);
    return `${sparkline(row.drives)} <button type="button" class="trend-button" data-trend-id="${escapeHtml(id)}">Open</button>`;
  }

  const QUESTIONS = {
    startTimes: {
      title: 'Start time performance',
      summary: 'Broadcast proceeds by actual 30-minute program start bucket from saved fundraiser schedules.',
      graphTitle: 'Start time buckets',
      tableTitle: 'Start time performance',
      tableNote: 'Uses saved Scheduling placements for the actual program start time, then attaches the imported or manual broadcast result for that airing. Completed $0 broadcasts count as airings. Use Pledge season plus Primary/Secondary topic to test March, June, August, or December scheduling arguments. Rights and title filters are intentionally not part of this view.',
      source: 'schedule',
      rows: rowsStartTimes,
      metricDriven: true,
      excludeNonSpecific: true,
      metric: (rows) => rows[0] ? formatMetricValue(rows[0]) : '—',
      tag: 'time lens',
      read: startTimeRead,
      columns: [
        ['Start time', (row) => labelWithMixCell(row), '', (row) => startTimeSortKey(row)],
        ['Median / airing', (row) => formatMoney(row.median || 0), 'money emphasis', (row) => row.median || 0],
        ['Avg / airing', (row) => formatMoney(row.avg || 0), 'money', (row) => row.avg || 0],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['Pledges', (row) => formatNumber(row.pledges), 'num', (row) => row.pledges],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]
      ]
    },
    programs: {
      title: 'What programs raise the most?',
      summary: 'Best current earners for the selected season/year.',
      graphTitle: 'Top programs by total dollars',
      tableTitle: 'Program ranking',
      tableNote: 'Graph shows the top 12. Table shows every matching program row.',
      rows: rowsPrograms,
      metricDriven: true,
      metric: (rows) => rows[0] ? formatMoney(rows[0].dollars) : '—',
      tag: 'program lens',
      read: programRead,
      columns: [
        ['Program', (row) => labelWithMixCell(row, programTitleCell(row)), '', (row) => row.title],
        ['Rights end', (row) => escapeHtml(row.rightsEndDisplay || '—'), '', (row) => row.rightsEnd || '9999-12-31'],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money emphasis', (row) => row.avg],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]
      ]
    },
    topicOverview: {
      title: 'Topic overview',
      summary: 'General topic totals for the selected filters.',
      graphTitle: 'Topic totals',
      tableTitle: 'Topic overview',
      tableNote: 'Uses the selected season/year/search and advanced filters at the top of the page.',
      rows: rowsTopicOverview,
      metricDriven: true,
      read: topicRead,
      columns: [
        ['Topic', (row) => groupTitleDetailCell(row), 'analytics-left', (row) => row.title],
        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis analytics-left', (row) => row.median],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money analytics-left', (row) => row.avg],
        ['Distribution / outliers', (row) => groupOutlierDetailCell(row), 'analytics-left', (row) => row.zeroDominated ? Number(row.zeroCount || 0) : (row.outlierCount || 0)],
        ['Total $', (row) => formatMoney(row.dollars), 'money analytics-left', (row) => row.dollars],
        ['Pledges', (row) => formatNumber(row.pledges), 'num analytics-left', (row) => row.pledges],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num analytics-left', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), 'analytics-left', (row) => row.seasons || 0]
      ]
    },
    seasonOverview: {
      title: 'Season overview',
      summary: 'Pledge-season totals across years. Full drive totals are used unless a content filter is active.',
      graphTitle: 'Pledge season totals',
      tableTitle: 'Season / fundraiser detail',
      tableNote: 'Full mode shows one row per saved fundraiser schedule, including Broadcast, Online, and Mail. Content-filter mode shows airing-row totals only because Online/Mail cannot be assigned to a specific title/topic.',
      useEvidence: false,
      useMetric: false,
      rows: rowsSeasonOverview,
      chartValue: (row) => row.dollars,
      chartLabel: (row) => formatMoney(row.dollars),
      read: (rows) => rows.length ? `${seasonOverviewModeText()}<br><br>${formatNumber(rows.length)} season/year row(s) match. ${state.season === 'all' ? 'The line graph compares March, June, August, and December across selected years' : `The line graph compares ${state.season} fundraisers across selected years`}; missing seasons are not treated as $0.` : 'No season records match.',
      columns: [
        ['Season', (row) => `${escapeHtml(row.season || row.title || '')}<br><span class="mix">${escapeHtml(row.year || '')}</span>`, '', (row) => (Number(row.year || 0) * 10) + SEASONS.indexOf(row.season || row.title || '')],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['Broadcast $', (row) => formatMoney(firstNonEmpty(row.broadcastDollars, row.dollars, 0)), 'money', (row) => Number(firstNonEmpty(row.broadcastDollars, row.dollars, 0) || 0)],
        ['Online $', (row) => row.onlineDollars == null ? '<span class="muted-cell">—</span>' : formatMoney(row.onlineDollars), 'money', (row) => Number(row.onlineDollars || 0)],
        ['Mail $', (row) => row.mailDollars == null ? '<span class="muted-cell">—</span>' : formatMoney(row.mailDollars), 'money', (row) => Number(row.mailDollars || 0)],
        ['Pledges', (row) => formatNumber(row.pledges), 'num', (row) => row.pledges],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],
        ['Source', (row) => escapeHtml(row.scheduleTitle || row.sourceLabel || 'Content-level airing rows'), '', (row) => row.scheduleTitle || row.sourceLabel || '']
      ]
    },
    topics: {
      title: 'What topics work best?',
      summary: 'Topic strength by median dollars per airing, with average, outliers, and four-season coverage shown.',
      graphTitle: 'Topics by typical dollars per airing',
      tableTitle: 'Topic ranking',
      tableNote: 'Season mix uses M/J/A/D counts, for example [M-3, J-1, A-0, D-5].',
      rows: rowsTopics,
      metricDriven: true,
      metric: (rows) => rows[0] ? formatMoney(rows[0].median) : '—',
      tag: 'topic lens',
      read: topicRead,
      columns: [
        ['Topic', (row) => groupTitleDetailCell(row), 'analytics-left', (row) => row.title],
        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis analytics-left', (row) => row.median],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money analytics-left', (row) => row.avg],
        ['Distribution / outliers', (row) => groupOutlierDetailCell(row), 'analytics-left', (row) => row.zeroDominated ? Number(row.zeroCount || 0) : (row.outlierCount || 0)],
        ['Total $', (row) => formatMoney(row.dollars), 'money analytics-left', (row) => row.dollars],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num analytics-left', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), 'analytics-left', (row) => row.seasons || 0]
      ]
    },
    secondaryTopics: {
      title: 'What secondary topics work best?',
      summary: 'Subtopic strength inside the selected filters. Use Primary topic = Music for Music styles.',
      graphTitle: 'Secondary topics by typical dollars per airing',
      tableTitle: 'Secondary topic ranking',
      tableNote: 'Choose Primary topic = Music and leave Secondary topic = All to compare Music subtopics against each other.',
      rows: rowsSecondaryTopics,
      metricDriven: true,
      metric: (rows) => rows[0] ? formatMoney(rows[0].median) : '—',
      tag: 'subtopic lens',
      read: secondaryTopicRead,
      columns: [
        ['Secondary topic', (row) => groupTitleDetailCell(row), 'analytics-left', (row) => row.title],
        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis analytics-left', (row) => row.median],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money analytics-left', (row) => row.avg],
        ['Distribution / outliers', (row) => groupOutlierDetailCell(row), 'analytics-left', (row) => row.zeroDominated ? Number(row.zeroCount || 0) : (row.outlierCount || 0)],
        ['Total $', (row) => formatMoney(row.dollars), 'money analytics-left', (row) => row.dollars],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num analytics-left', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), 'analytics-left', (row) => row.seasons || 0]
      ]
    },
    seasonal: {
      title: 'When do topics work best?',
      summary: 'Compares each primary topic across March, June, August, and December using that topic’s own median-like season as the baseline.',
      graphTitle: 'Season lift by topic',
      tableTitle: 'Topic seasonal lift',
      tableNote: 'Holiday-related titles are excluded. Each topic uses its own closest-to-median season as the 0% average, then March, June, August, and December show avg/airing, total dollars, and percent above or below that topic baseline.',
      useSeason: false,
      rows: rowsSeasonal,
      metric: (rows) => rows[0] ? formatMoney(rows[0].avg) : '—',
      tag: 'four-season lift',
      chartValue: (row) => row.avg || 0,
      chartLabel: (row) => formatMoney(row.avg || 0),
      read: seasonalRead,
      columns: [
        ['Topic', (row) => labelWithMixCell(row), '', (row) => row.title],
        ['Average', (row) => `${formatMoney(row.baselineAvg || row.avg || 0)}<br><span class="mix">${escapeHtml(row.baselineSeason || '')} baseline</span>`, 'money emphasis', (row) => row.baselineAvg || row.avg || 0],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['March', (row) => seasonPerformanceCell(row, 'March'), 'money emphasis', (row) => Number(seasonStat(row, 'March').avg || 0)],
        ['June', (row) => seasonPerformanceCell(row, 'June'), 'money emphasis', (row) => Number(seasonStat(row, 'June').avg || 0)],
        ['August', (row) => seasonPerformanceCell(row, 'August'), 'money emphasis', (row) => Number(seasonStat(row, 'August').avg || 0)],
        ['December', (row) => seasonPerformanceCell(row, 'December'), 'money emphasis', (row) => Number(seasonStat(row, 'December').avg || 0)]
      ]
    },
    history: {
      title: 'Is an old favorite fading?',
      summary: 'Compares first fundraiser total to latest fundraiser total; not repeats inside the same drive.',
      graphTitle: 'Biggest drop from first fundraiser to latest fundraiser',
      tableTitle: 'Historical program durability',
      tableNote: 'Season/year filters are disabled here because this question needs the full history. Use search to inspect a title.',
      useSeason: false,
      useYear: false,
      rows: rowsHistory,
      metric: (rows) => rows[0] ? `${formatMoney(rows[0].first.total)} → ${formatMoney(rows[0].last.total)}` : '—',
      tag: 'full-history trend',
      read: (rows) => rows[0] ? `<b>${escapeHtml(rows[0].title)}</b> went from ${formatMoney(rows[0].first.total)} in ${escapeHtml(rows[0].first.seasonYear)} to ${formatMoney(rows[0].last.total)} in ${escapeHtml(rows[0].last.seasonYear)}. The percentage is now context, not the whole damn story.` : 'No historical rows match.',
      chartValue: (row) => Math.abs(Math.min(row.firstChange, 0)),
      chartLabel: (row) => `${formatMoney(row.first.total)} → ${formatMoney(row.last.total)}`,
      columns: [
        ['Program', (row) => programTitleCell(row)],
        ['First fundraiser', (row) => `${escapeHtml(row.first.seasonYear)}<br>${formatMoney(row.first.total)}`, '', (row) => row.first.sortKey],
        ['Latest fundraiser', (row) => `${escapeHtml(row.last.seasonYear)}<br>${formatMoney(row.last.total)}`, '', (row) => row.last.sortKey],
        ['Change first → latest', (row) => formatPercent(row.firstChange), 'num', (row) => row.firstChange],
        ['Peak fundraiser', (row) => `${escapeHtml(row.peak.seasonYear)}<br>${formatMoney(row.peak.total)}`, '', (row) => row.peak.total],
        ['Trend', trendCell, '', (row) => row.last?.total || 0]
      ]
    },
    comeback: {
      title: 'What happens after a long pause?',
      summary: `Programs returning after a gap of ${LONG_PAUSE_YEARS}+ years.`,
      graphTitle: `Programs returning after a ${LONG_PAUSE_YEARS}+ year pause`,
      tableTitle: 'Long-pause return performance',
      tableNote: 'Season/year filters are disabled here because pause detection needs the full history. Table shows every title that fits.',
      useSeason: false,
      useYear: false,
      rows: rowsComeback,
      metric: (rows) => `${formatNumber(rows.length)} titles`,
      tag: `${LONG_PAUSE_YEARS}+ year gap`,
      read: (rows) => rows[0] ? `<b>${escapeHtml(rows[0].title)}</b> returned after about ${rows[0].pauseYears.toFixed(1)} years and raised ${formatMoney(rows[0].last.total)}. This is the “does absence make the phones ring?” view.` : `No title has a ${LONG_PAUSE_YEARS}+ year pause in the matching data.`,
      chartValue: (row) => row.last.total,
      chartLabel: (row) => `${row.pauseYears.toFixed(1)} yrs · ${formatMoney(row.last.total)}`,
      columns: [
        ['Program', (row) => programTitleCell(row)],
        ['Previous fundraiser', (row) => row.previous ? `${escapeHtml(row.previous.seasonYear)}<br>${formatMoney(row.previous.total)}` : '—', '', (row) => row.previous?.sortKey || 0],
        ['Latest fundraiser', (row) => `${escapeHtml(row.last.seasonYear)}<br>${formatMoney(row.last.total)}`, '', (row) => row.last.sortKey],
        ['Gap', (row) => `${row.pauseYears.toFixed(1)} yrs`, 'num', (row) => row.pauseYears],
        ['First fundraiser', (row) => `${escapeHtml(row.first.seasonYear)}<br>${formatMoney(row.first.total)}`, '', (row) => row.first.sortKey],
        ['Trend', trendCell, '', (row) => row.last?.total || 0]
      ]
    },
    live: {
      title: 'Are live breaks helping?',
      summary: 'Compares saved Scheduling live-break flags, plus a 1:1 matched topic/day/time check.',
      graphTitle: 'Live-break average comparison',
      source: 'schedule',
      tableTitle: 'Live break split',
      tableNote: 'Uses saved Scheduling placements only. The raw split is shown first; the 1:1 matched comparison below pairs each live break with the closest non-live airing by topic/day/time.',
      rows: rowsLive,
      metric: (rows) => rows.find((row) => row.title === 'Live break') ? formatMoney(rows.find((row) => row.title === 'Live break').avg) : '—',
      tag: 'schedule flags only',
      hideWeakStats: true,
      read: liveRead,
      columns: [
        ['Break type', (row) => escapeHtml(row.title), '', (row) => row.title],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money emphasis', (row) => row.avg],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]
      ]
    }
  };

  const FILTER_PLANS = {
    startTimes: {
      required: ['season', 'topic'],
      refine: ['year', 'secondary', 'duration', 'weekpart', 'live', 'daypart', 'distributor', 'metric', 'evidence', 'search'],
      note: 'Choose exactly one Primary Topic for a clean time-slot comparison. Season belongs in the setup, but All seasons is allowed; when it is used, remember that some topics perform differently in March, June, August, and December.'
    },
    programs: {
      required: [],
      refine: ['season', 'year', 'topic', 'secondary', 'duration', 'weekpart', 'live', 'daypart', 'distributor', 'metric', 'evidence', 'search'],
      note: 'No setup filter is required. All-history totals answer a lifetime-value question; season and year selections answer a more current planning question.'
    },
    topicOverview: {
      required: [],
      refine: ['season', 'year', 'topic', 'secondary', 'duration', 'weekpart', 'live', 'daypart', 'distributor', 'metric', 'search'],
      note: 'No setup filter is required. This is intentionally a broad descriptive view; narrow it only when you want to inspect a specific slice of the schedule.'
    },
    seasonOverview: {
      required: [],
      refine: ['season', 'year', 'topic', 'secondary', 'duration', 'weekpart', 'live', 'daypart', 'distributor', 'search'],
      note: 'No setup filter is required. Use Pledge season to compare August-to-August, March-to-March, June-to-June, or December-to-December across selected years. Content filters switch this view from full fundraiser totals to attributable airing dollars only.'
    },
    topics: {
      required: ['season'],
      refine: ['year', 'topic', 'secondary', 'duration', 'weekpart', 'live', 'daypart', 'distributor', 'metric', 'evidence', 'search'],
      note: 'Season belongs in the setup because topic strength can change by fundraiser. All seasons is still valid as a broad view, but its ranking reflects the historical season mix as well as topic strength.'
    },
    secondaryTopics: {
      required: ['season', 'topic'],
      refine: ['year', 'secondary', 'duration', 'weekpart', 'live', 'daypart', 'distributor', 'metric', 'evidence', 'search'],
      note: 'Choose exactly one Primary Topic so the subtopics stay inside a comparable parent category. All seasons is allowed, but season mix can influence which subtopic appears strongest.'
    },
    seasonal: {
      required: [],
      refine: ['year', 'topic', 'secondary', 'duration', 'weekpart', 'live', 'daypart', 'distributor', 'evidence', 'search'],
      note: 'No setup filter is required because this question must compare March, June, August, and December. Use year checkboxes to omit unusual years without destroying the cross-season comparison.'
    },
    history: {
      required: [],
      refine: ['topic', 'secondary', 'duration', 'weekpart', 'live', 'daypart', 'distributor', 'evidence', 'search'],
      note: 'No setup filter is required. Season and year stay out because fading detection needs the full timeline. Other refinements remain available for deliberate exploration.'
    },
    comeback: {
      required: [],
      refine: ['topic', 'secondary', 'duration', 'weekpart', 'live', 'daypart', 'distributor', 'evidence', 'search'],
      note: 'No setup filter is required. Season and year stay out because the analysis needs the full history to detect a long pause.'
    },
    live: {
      required: [],
      refine: ['season', 'year', 'topic', 'secondary', 'duration', 'weekpart', 'daypart', 'distributor', 'search'],
      note: 'No setup filter is required because the matched comparison already controls for topic, day/time, length, and season/year where possible. Refinements can still test narrower hypotheses.'
    }
  };

  function requiredFilterIssues(questionId = state.question) {
    const plan = FILTER_PLANS[questionId] || { required: [] };
    const issues = [];
    if ((plan.required || []).includes('topic')) {
      const count = Array.isArray(state.topicFilters) ? state.topicFilters.length : 0;
      if (count === 0) issues.push('choose one Primary Topic');
      else if (count > 1) issues.push('use one Primary Topic for a clean comparison');
    }
    return issues;
  }

  function seasonMixCaution(questionId = state.question) {
    const plan = FILTER_PLANS[questionId] || { required: [] };
    if (!(plan.required || []).includes('season') || state.season !== 'all') return '';
    return 'All seasons is a valid view, but some topics perform differently by pledge season. Treat the result as a combined-season picture, or choose one season when testing a specific scheduling decision.';
  }

  function moveFilterControl(key, target) {
    const node = root.querySelector(`[data-filter-key="${key}"]`);
    if (node && target) target.appendChild(node);
  }

  function placeFilterControls() {
    const plan = FILTER_PLANS[state.question] || FILTER_PLANS.programs;
    [...root.querySelectorAll('[data-filter-key]')].forEach((node) => dom.filterBank?.appendChild(node));
    (plan.required || []).forEach((key) => moveFilterControl(key, dom.requiredFilters));
    (plan.refine || []).forEach((key) => moveFilterControl(key, dom.refineFilters));
    const issues = requiredFilterIssues();
    const hasRequired = Boolean((plan.required || []).length);
    dom.requiredFilterCard?.classList.toggle('exploratory', Boolean(issues.length));
    if (dom.requiredFilterStatus) {
      dom.requiredFilterStatus.textContent = !hasRequired ? 'No setup needed' : (issues.length ? 'Exploratory' : 'Ready');
      dom.requiredFilterStatus.className = `filter-status ${!hasRequired || !issues.length ? 'ready' : 'exploratory'}`;
    }
    if (dom.requiredFilterNote) dom.requiredFilterNote.textContent = plan.note || 'These controls define the cleanest version of the selected question.';
    if (dom.refineFilterNote) dom.refineFilterNote.textContent = 'Optional controls. Use them when you have a reason to narrow the data; the app will not prevent you from building your own analytical path.';
  }

  function analysisGuidanceHtml() {
    const issues = requiredFilterIssues();
    const caution = seasonMixCaution();
    const parts = [];
    if (issues.length) parts.push(`<div class="analysis-guidance"><strong>Exploratory result:</strong> ${escapeHtml(issues.join('; '))}. The data is still shown, but do not treat the apparent winner as a clean conclusion until the recommended setup is satisfied.</div>`);
    if (caution) parts.push(`<div class="analysis-caution"><strong>Season mix:</strong> ${escapeHtml(caution)}</div>`);
    return parts.join('');
  }

  async function fetchAll(table, select, orderField = '') {
    const pageSize = 1000;
    let from = 0;
    const rows = [];
    while (true) {
      let query = state.client.from(table).select(select).range(from, from + pageSize - 1);
      if (orderField) query = query.order(orderField, { ascending: true });
      const { data, error } = await query;
      if (error) throw error;
      const chunk = Array.isArray(data) ? data : [];
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  }


  async function fetchLibraryRows() {
    const baseColumns = 'id,title,nola_code,topic_primary,topic_secondary,distributor,rights_start,rights_end';
    const stateColumns = `${baseColumns},library_state,is_archived,archived,inactive_flag`;
    const fullColumns = `${baseColumns},status,library_state,is_archived,archived,inactive_flag`;
    const attempts = [
      { table: LIBRARY_VIEW, select: fullColumns, label: `${LIBRARY_VIEW} full library-state columns` },
      { table: LIBRARY_VIEW, select: stateColumns, label: `${LIBRARY_VIEW} library-state columns` },
      { table: LIBRARY_VIEW, select: baseColumns, label: `${LIBRARY_VIEW} base library columns` },
      { table: BASE_TABLE, select: stateColumns, label: `${BASE_TABLE} library-state columns` },
      { table: BASE_TABLE, select: baseColumns, label: `${BASE_TABLE} base library columns` }
    ];
    let lastError = null;
    for (const attempt of attempts) {
      try {
        return await fetchAll(attempt.table, attempt.select);
      } catch (error) {
        lastError = error;
        console.warn(`Library metadata fetch failed for ${attempt.label}; trying fallback.`, error);
      }
    }
    throw lastError || new Error('Unable to load library metadata.');
  }

  async function init() {
    if (!initialized) {
      state.cohort = readAnalyticsCohort();
      if (state.cohort?.keySet) {
        state.question = 'programs';
        state.metric = 'median';
      }
      initialized = true;
    }
    state.client = App.state.client || App.data?.createClient?.() || null;
    if (!state.client) {
      note('Performance Analytics could not access the Pledge Program Library data connection.', 'bad');
      return false;
    }
    note('Loading live pledge performance records…');
    return true;
  }


  async function fetchAiringsForAnalytics() {
    if (App.data?.fetchImportedAirings) return App.data.fetchImportedAirings();
    const base = 'id,program_id,pledge_program_id,manual_match_program_id,aired_at,air_date,air_time,contribution_amount,dollars,pledge_count,fundraiser_label,drive_start_date,drive_end_date,title,program_title,imported_program_title,matched_library_title,nola_code,row_hash,program_minutes';
    try {
      const rows = await fetchAll(AIRINGS_TABLE, `${base},raw_payload`, 'air_date');
      return App.data?.canonicalizeImportedAirings ? App.data.canonicalizeImportedAirings(rows) : rows;
    } catch (error) {
      console.warn('Airings raw_payload fetch failed; retrying without raw payload.', error);
      const rows = await fetchAll(AIRINGS_TABLE, base, 'air_date');
      return App.data?.canonicalizeImportedAirings ? App.data.canonicalizeImportedAirings(rows) : rows;
    }
  }

  async function load() {
    note('Loading live pledge performance records…');
    const [airings, scheduleRows] = await Promise.all([
      fetchAiringsForAnalytics(),
      fetchAll(SCHEDULES_TABLE, 'id,title,start_date,end_date,created_at,updated_at,schedule_data', 'start_date')
    ]);
    const libraryRows = await fetchLibraryRows();
    state.libraryRows = libraryRows;
    state.libraryById = new Map(libraryRows.map((row) => [text(row.id), row]).filter(([id]) => id));
    state.libraryByTitle = new Map(libraryRows.map((row) => [lookupKey(row.title), row]).filter(([title]) => title));
    const normalizedSchedules = scheduleRows.map(normalizeSchedule);
    state.schedules = dedupeSchedulesByDateRange(normalizedSchedules);
    state.records = buildRecords(airings, libraryRows, state.schedules);
    state.scheduleRecords = buildScheduleRecords(state.schedules, libraryRows, state.records);
    state.driveSeasonRecords = buildDriveSeasonRecords(state.schedules);
    rebuildFilterOptions();
    render();
    const scheduleLiveCount = state.scheduleRecords.filter((record) => record.liveState === 'live').length;
    const schedulePlacementCount = state.scheduleRecords.length;
    const scheduleMatchedCount = state.records.filter((record) => record.scheduleMatched).length;
    const diag = state.liveBreakDiagnostics || {};
    if ((diag.livePlacements || 0) > 0 && (diag.liveDollars || 0) <= 0) {
      note(`Live-break guardrail: ${formatNumber(diag.livePlacements || 0)} saved live-break placement(s) exist, but none matched pledge dollars. Analytics did not fall back to imported live-break guesses. Check schedule placement hashes/titles/times.`, 'bad');
    } else {
      const duplicateNote = Number(state.scheduleAudit.duplicateSchedulesSuppressed || 0)
        ? ` ${formatNumber(state.scheduleAudit.duplicateSchedulesSuppressed || 0)} saved schedule row(s) from ambiguous duplicate date ranges were excluded from schedule-derived analytics rather than blended.`
        : '';
      note(`Loaded ${formatNumber(state.records.length)} usable pledge airing records. Unambiguous schedules: ${formatNumber(state.scheduleAudit.activeSchedules || 0)} of ${formatNumber(state.scheduleAudit.rawSchedules || 0)}.${duplicateNote} Schedule-derived rows: ${formatNumber(schedulePlacementCount)}. Live-break rows from saved schedules: ${formatNumber(scheduleLiveCount)}. Live-break source: ${LIVE_BREAK_ANALYTICS_SOURCE}.`);
    }
  }

  function rebuildFilterOptions() {
    const years = [...new Set([...(state.records || []), ...(state.driveSeasonRecords || [])].map((record) => record.year).filter(Boolean))].sort((a, b) => b - a);
    dom.season.innerHTML = '<option value="all">All pledge seasons</option>' + SEASONS.map((season) => `<option>${escapeHtml(season)}</option>`).join('');
    dom.season.value = state.season;
    const availableYearStrings = years.map(String);
    if (Array.isArray(state.yearFilters)) state.yearFilters = state.yearFilters.filter((year) => availableYearStrings.includes(String(year)));
    const includedYears = Array.isArray(state.yearFilters) ? state.yearFilters.map(String) : availableYearStrings;
    dom.yearOptions.innerHTML = years.map((year) => `<label class="topic-option"><input type="checkbox" value="${escapeHtml(year)}" ${includedYears.includes(String(year)) ? 'checked' : ''}> ${escapeHtml(year)}</label>`).join('');
    updateYearSummary(years);
    const topics = [...new Set(state.records.map((record) => record.topic).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const selectedTopicFilter = Array.isArray(state.topicFilters) ? state.topicFilters : [];
    const secondaryTopicRows = selectedTopicFilter.length ? state.records.filter((record) => selectedTopicFilter.includes(record.topic)) : state.records;
    const secondaryTopics = [...new Set(secondaryTopicRows.map((record) => record.secondaryTopic).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const distributors = [...new Set(state.records.map((record) => record.distributor || 'Unknown').filter(Boolean))].sort((a, b) => a.localeCompare(b));
    state.topicFilters = (state.topicFilters || []).filter((topic) => topics.includes(topic));
    dom.topicOptions.innerHTML = '<label class="topic-option"><input type="checkbox" value="__all__"> All topics</label>' + topics.map((topic) => `<label class="topic-option"><input type="checkbox" value="${escapeHtml(topic)}" ${state.topicFilters.includes(topic) ? 'checked' : ''}> ${escapeHtml(topic)}</label>`).join('');
    dom.topicOptions.querySelector('input[value="__all__"]').checked = !state.topicFilters.length;
    updateTopicSummary();
    dom.secondaryTopic.innerHTML = '<option value="all">All secondary topics</option>' + secondaryTopics.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
    if (secondaryTopics.includes(state.secondaryTopicFilter)) dom.secondaryTopic.value = state.secondaryTopicFilter; else { state.secondaryTopicFilter = 'all'; dom.secondaryTopic.value = 'all'; }
    if (dom.rightsScope) dom.rightsScope.value = state.rightsScope || 'all';
    dom.advDistributor.innerHTML = '<option value="all">All distributors</option>' + distributors.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
    if (distributors.includes(state.advancedDistributor)) dom.advDistributor.value = state.advancedDistributor; else { state.advancedDistributor = 'all'; dom.advDistributor.value = 'all'; }
    dom.advMetric.value = state.metric;
    dom.advLive.value = state.advancedLive;
    dom.advDaypart.value = state.advancedDaypart;
    dom.advWeekpart.value = state.advancedWeekpart;
    dom.advDuration.value = state.advancedDuration;
  }


  function updateTopicSummary() {
    const topics = Array.isArray(state.topicFilters) ? state.topicFilters : [];
    if (!dom.topicSummary) return;
    if (!topics.length) dom.topicSummary.textContent = 'All topics';
    else if (topics.length === 1) dom.topicSummary.textContent = topics[0];
    else dom.topicSummary.textContent = `${topics.length} topics selected`;
  }

  function updateYearSummary(years = null) {
    if (!dom.yearSummary || !dom.yearOptions) return;
    const available = Array.isArray(years) ? years.map(String) : [...dom.yearOptions.querySelectorAll('input[type="checkbox"]')].map((item) => item.value);
    const checked = [...dom.yearOptions.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value);
    if (!available.length || checked.length === available.length) {
      dom.yearSummary.textContent = 'All years';
      return;
    }
    if (!checked.length) {
      dom.yearSummary.textContent = 'No years selected';
      return;
    }
    const omitted = available.filter((year) => !checked.includes(year));
    if (omitted.length <= 2 && checked.length > omitted.length) {
      dom.yearSummary.textContent = `All except ${omitted.join(', ')}`;
      return;
    }
    dom.yearSummary.textContent = checked.length <= 3 ? checked.join(', ') : `${checked.length} years included`;
  }

  function updateFilterState() {
    const question = QUESTIONS[state.question] || QUESTIONS.programs;
    const liveComparison = state.question === 'live';
    dom.season.disabled = question.useSeason === false;
    const yearDisabled = question.useYear === false;
    if (dom.yearPicker) {
      dom.yearPicker.open = yearDisabled ? false : dom.yearPicker.open;
      dom.yearPicker.style.pointerEvents = yearDisabled ? 'none' : '';
    }
    dom.advLive.disabled = liveComparison;
    dom.advMetric.disabled = question.useMetric === false;
    dom.evidence.disabled = question.useEvidence === false || question.hideWeakStats === true;
    placeFilterControls();
    if (state.question === 'seasonOverview') {
      const seasonScope = state.season === 'all' ? 'All four pledge seasons are included.' : `Only ${state.season} fundraisers are included.`;
      setScopeNote(`${seasonOverviewModeText()} ${seasonScope} Year checkboxes change which fundraiser years are compared without forcing content-level mode.`);
      return;
    }
    const issues = requiredFilterIssues();
    const caution = seasonMixCaution();
    setScopeNote(`${issues.length ? 'Recommended setup is incomplete, so the result is exploratory. ' : 'Recommended setup is satisfied. '}${caution ? 'All seasons is currently combining potentially different seasonal behavior. ' : ''}${currentRightsOnly() ? 'Broadcast-rights filtering is active. ' : ''}You can still use Refine results to test your own path through the data.`);
  }

  function render() {
    state.trendRows.clear();
    state.groupDetailRows.clear();
    updateFilterState();
    const entries = Object.entries(QUESTIONS).map(([id, question]) => ({ id, question }));
    dom.cards.innerHTML = entries.map(({ id, question }) => `<button type="button" class="qcard ${id === state.question ? 'active' : ''}" data-question="${escapeHtml(id)}">
        <div class="qtitle">${escapeHtml(question.title)}</div>
        <div class="qsum">${escapeHtml(question.summary)}</div>
      </button>`).join('');
    dom.cards.querySelectorAll('[data-question]').forEach((button) => {
      button.addEventListener('click', () => {
        state.question = button.dataset.question || 'programs';
        state.tableSort = { question: state.question, index: null, direction: 'asc' };
        render();
      });
    });
    const selected = entries.find((entry) => entry.id === state.question) || entries[0];
    renderDetail({ ...selected, rows: selected.question.rows() });
  }

  function chartValue(row, question) {
    if (typeof question.chartValue === 'function') return question.chartValue(row);
    if (question.metricDriven) return metricValue(row);
    if (state.question === 'seasonal') return Math.abs(row.bestLift || 0);
    if (state.question === 'topics' || state.question === 'live') return row.avg || 0;
    return row.dollars || row.broadcasts || 0;
  }

  function chartLabel(row, question) {
    if (typeof question.chartLabel === 'function') return question.chartLabel(row);
    if (question.metricDriven) return formatMetricValue(row);
    if (state.question === 'seasonal') return `${row.bestSeason} ${formatPercent(row.bestLift)}`;
    if (state.question === 'topics' || state.question === 'live') return formatMoney(row.avg || 0);
    return formatMoney(row.dollars || 0);
  }

  function chartRowLabel(row) {
    const showMix = ['startTimes', 'programs', 'topicOverview', 'topics', 'secondaryTopics', 'seasonal', 'live'].includes(state.question) && row.mix;
    const titleHtml = `<span class="chart-title-label">${escapeHtml(row.title)}</span>`;
    return `${titleHtml}${showMix ? `<span class="chart-season-mix">${escapeHtml(row.mix)}</span>` : ''}`;
  }

  function questionSourceText(question = {}) {
    if (state.question === 'seasonOverview') return seasonOverviewUsesDriveTotals() ? 'Using saved fundraiser totals.' : 'Using content-level airing rows because content filters are active.';
    if (question.source === 'schedule') return 'Using saved Scheduling placements.';
    if (state.question === 'startTimes') return 'Using imported pledge airing rows grouped by 30-minute start bucket.';
    if (state.question === 'seasonal' || state.question === 'topics' || state.question === 'topicOverview') return 'Using imported pledge airing rows joined to primary library topics.';
    if (state.question === 'secondaryTopics') return 'Using imported pledge airing rows joined to secondary library topics.';
    return 'Using imported pledge airing rows joined to library program identity.';
  }

  function renderDetail(entry) {
    const { question, rows } = entry;
    dom.detail?.classList.toggle('seasonal-view', state.question === 'seasonal');
    dom.detailTitle.textContent = question.title;
    dom.detailSummary.textContent = `${question.summary} ${questionSourceText(question)}`;
    dom.chartTitle.textContent = question.metricDriven ? `${question.graphTitle} · ranked by ${metricLabel()}` : question.graphTitle;
    dom.tableTitle.textContent = question.tableTitle;
    dom.tableNote.textContent = question.tableNote || 'The table follows the selected question so the graph and rows tell the same story.';
    dom.chartNote.textContent = state.question === 'seasonOverview'
      ? 'Graph uses fundraiser total dollars from saved schedules when no content filters are active.'
      : (question.metricDriven ? `Graph uses ${metricLabel()} from Refine results.` : (rows.length > 12 ? 'Graph shows the first 12 rows. The table below shows everything that matches.' : 'Graph follows the selected question and filters.'));
    dom.read.innerHTML = `${analysisGuidanceHtml()}${question.read(rows)}`;
    renderStats(rows, question);
    renderChart(rows, question);
    renderTable(rows, question.columns);
    if (state.question === 'live') renderLiveMatchedComparison();
  }

  function renderStats(rows, question = {}) {
    const dollars = rows.reduce((sum, row) => sum + Number(row.dollars || row.last?.total || 0), 0);
    const broadcasts = rows.reduce((sum, row) => sum + Number(row.broadcasts || 0), 0);
    const weak = rows.filter((row) => row.weak).length;
    const cells = [
      ['Rows', formatNumber(rows.length)],
      ['Broadcasts', formatNumber(broadcasts)],
      ['Dollars', formatMoney(dollars)]
    ];
    if (question.metricDriven) cells.push([metricLabel(), formatMetricValue(rows[0] || {})]);
    else if (state.question === 'live') cells.push(['Avg / airing', rows[0] ? formatMoney(rows[0].avg || 0) : '—']);
    else cells.push(['Result count', formatNumber(rows.length)]);
    dom.stats.innerHTML = cells.map(([label, value]) => `<div class="stat"><div class="v">${escapeHtml(value)}</div><div>${escapeHtml(label)}</div></div>`).join('');
  }


  function renderSeasonTrendChart(question) {
    const records = seasonOverviewRecords();
    const years = [...new Set(records.map((record) => record.year).filter(Boolean))].sort((a, b) => a - b);
    if (!years.length) {
      dom.chart.innerHTML = '<div class="empty">No graphable season records.</div>';
      return;
    }
    const totals = new Map();
    records.forEach((record) => {
      const key = `${record.season}|${record.year}`;
      totals.set(key, (totals.get(key) || 0) + Number(record.dollars || 0));
    });
    const width = 900;
    const height = 330;
    const padLeft = 72;
    const padRight = 24;
    const padTop = 24;
    const padBottom = 70;
    const values = [...totals.values()].filter((value) => Number.isFinite(value) && value > 0);
    const max = Math.max(...values, 1);
    const xFor = (index) => years.length === 1 ? (padLeft + width - padRight) / 2 : padLeft + ((width - padLeft - padRight) * index) / (years.length - 1);
    const yFor = (value) => padTop + (height - padTop - padBottom) * (1 - (value / max));
    const strokes = ['#7b341e', '#2f5d62', '#8b6f35', '#5f4b8b'];
    const yTicks = [0, max / 2, max];
    const seasonSeries = SEASONS.map((season, seasonIndex) => {
      const points = years
        .map((year, index) => ({ year, index, value: totals.has(`${season}|${year}`) ? totals.get(`${season}|${year}`) : null }))
        .filter((point) => point.value != null && Number.isFinite(point.value));
      const pointString = points.map((point) => `${xFor(point.index).toFixed(1)},${yFor(point.value).toFixed(1)}`).join(' ');
      const line = points.length > 1 ? `<polyline points="${pointString}" fill="none" stroke="${strokes[seasonIndex]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>` : '';
      const circles = points.map((point) => `<circle cx="${xFor(point.index)}" cy="${yFor(point.value)}" r="4" fill="${strokes[seasonIndex]}"><title>${escapeHtml(season)} ${escapeHtml(point.year)}: ${escapeHtml(formatMoney(point.value))}</title></circle>`).join('');
      return `${line}${circles}`;
    }).join('');
    dom.chart.innerHTML = `<div class="chart-mode-note">${seasonOverviewModeText()} Missing season/year combinations are left blank, not plotted as $0.</div><svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Season totals over time">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#fffdf8"></rect>
      ${yTicks.map((tick) => `<line x1="${padLeft}" x2="${width - padRight}" y1="${yFor(tick)}" y2="${yFor(tick)}" stroke="#eadcc8"></line><text x="10" y="${yFor(tick) + 4}" font-size="12" fill="#6d6255">${escapeHtml(formatMoney(tick))}</text>`).join('')}
      ${seasonSeries}
      ${years.map((year, index) => `<text x="${xFor(index)}" y="${height - 38}" text-anchor="middle" font-size="12" fill="#6d6255">${escapeHtml(year)}</text>`).join('')}
      ${SEASONS.map((season, index) => `<circle cx="${padLeft + index * 130}" cy="${height - 12}" r="5" fill="${strokes[index]}"></circle><text x="${padLeft + 10 + index * 130}" y="${height - 8}" font-size="12" fill="#272019">${escapeHtml(season)}</text>`).join('')}
    </svg>`;
  }

  function renderSeasonalLiftChart(rows) {
    const chartRows = state.question === 'startTimes' ? rows : rows.slice(0, 12);
    if (!chartRows.length) {
      dom.chart.innerHTML = '<div class="empty">No graphable rows.</div>';
      return;
    }
    const seasonCellHtml = (row, season) => {
      const stat = seasonStat(row, season);
      if (!stat.broadcasts) {
        return `<div class="season-cell no-data"><span class="season-code">${escapeHtml(SEASON_CODE[season])}</span><span class="season-avg">—</span><span class="season-lift flat">No data</span></div>`;
      }
      const lift = Number.isFinite(stat.lift) ? stat.lift : 0;
      const liftText = stat.isBaseline ? '0% avg' : formatPercent(lift);
      return `<div class="season-cell ${stat.isBaseline ? 'baseline' : ''}">
        <span class="season-code">${escapeHtml(SEASON_CODE[season])}</span>
        <span class="season-avg">${escapeHtml(formatMoney(stat.avg || 0))}</span>
        <span class="season-lift ${liftClass(lift)}">${escapeHtml(liftText)}</span>
      </div>`;
    };
    dom.chart.innerHTML = `<div class="seasonal-chart">${chartRows.map((row) => `<div class="seasonal-row">
        <div class="blabel" title="${escapeHtml(row.title)}">${chartRowLabel(row)}</div>
        <div class="season-cells">${SEASONS.map((season) => seasonCellHtml(row, season)).join('')}</div>
        <div class="seasonal-value"><span class="value-kicker">Average</span><strong>${escapeHtml(formatMoney(row.baselineAvg || row.avg || 0))}</strong><span>Total ${escapeHtml(formatMoney(row.dollars || 0))}</span><span>${escapeHtml(row.liftRangeLabel || '')}</span></div>
      </div>`).join('')}</div>`;
  }

  function renderChart(rows, question) {
    if (state.question === 'seasonOverview') {
      renderSeasonTrendChart(question);
      return;
    }
    if (state.question === 'seasonal') {
      renderSeasonalLiftChart(rows);
      return;
    }
    const chartRows = state.question === 'startTimes' ? rows : rows.slice(0, 12);
    if (!chartRows.length) {
      dom.chart.innerHTML = '<div class="empty">No graphable rows.</div>';
      return;
    }
    const max = Math.max(...chartRows.map((row) => chartValue(row, question)), 1);
    dom.chart.innerHTML = chartRows.map((row) => {
      const value = chartValue(row, question);
      const width = Math.max(2, (value / max) * 100);
      return `<div class="bar">
        <div class="blabel" title="${escapeHtml(row.title)}">${chartRowLabel(row)}</div>
        <div class="track"><div class="fill" style="width:${width}%"></div></div>
        <div class="bval">${escapeHtml(chartLabel(row, question))}</div>
      </div>`;
    }).join('');
  }

  function stripHtml(value) {
    const node = document.createElement('div');
    node.innerHTML = String(value ?? '');
    return text(node.textContent || node.innerText || '');
  }

  function sortValue(row, column) {
    if (typeof column[3] === 'function') return column[3](row);
    return stripHtml(column[1](row));
  }

  function compareSortValues(a, b) {
    const aBlank = a == null || a === '';
    const bBlank = b == null || b === '';
    if (aBlank && bBlank) return 0;
    if (aBlank) return 1;
    if (bBlank) return -1;
    const aNum = typeof a === 'number' ? a : Number(String(a).replace(/[$,% ,]/g, ''));
    const bNum = typeof b === 'number' ? b : Number(String(b).replace(/[$,% ,]/g, ''));
    if (Number.isFinite(aNum) && Number.isFinite(bNum) && String(a).match(/[0-9]/) && String(b).match(/[0-9]/)) return aNum - bNum;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  function sortedTableRows(rows, columns) {
    const sort = state.tableSort || {};
    if (sort.question !== state.question || sort.index == null || !columns[sort.index]) return rows;
    const direction = sort.direction === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => direction * compareSortValues(sortValue(a, columns[sort.index]), sortValue(b, columns[sort.index])));
  }

  function renderTable(rows, columns) {
    if (!rows.length) {
      dom.table.innerHTML = '<div class="empty">No table rows.</div>';
      return;
    }
    const tableRows = sortedTableRows(rows, columns);
    const sort = state.tableSort || {};
    dom.table.innerHTML = `<table><thead><tr>${columns.map((column, index) => {
      const active = sort.question === state.question && sort.index === index;
      const arrow = active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕';
      return `<th class="${column[2] || ''}"><button type="button" class="sort-th-button" data-sort-index="${index}"><span>${escapeHtml(column[0])}</span><span class="sort-arrow">${arrow}</span></button></th>`;
    }).join('')}</tr></thead><tbody>${tableRows.map((row) => `<tr>${columns.map((column) => `<td class="${column[2] || ''}">${column[1](row)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    dom.table.querySelectorAll('[data-sort-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.getAttribute('data-sort-index'));
        if (state.tableSort.question === state.question && state.tableSort.index === index) {
          state.tableSort.direction = state.tableSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          state.tableSort = { question: state.question, index, direction: String(columns[index]?.[2] || '').split(/\s+/).some((klass) => klass === 'money' || klass === 'num' || klass === 'emphasis') ? 'desc' : 'asc' };
        }
        render();
      });
    });
    dom.table.querySelectorAll('[data-trend-id]').forEach((button) => {
      button.addEventListener('click', () => openTrend(button.dataset.trendId || ''));
    });
    dom.table.querySelectorAll('[data-group-detail-id]').forEach((button) => {
      button.addEventListener('click', () => openGroupDetail(button.dataset.groupDetailId || '', button.dataset.groupDetailMode || 'all'));
    });
    dom.table.querySelectorAll('[data-program-detail-id]').forEach((button) => {
      button.addEventListener('click', () => openProgramDetail(button.dataset.programDetailId || '', button.dataset.programDetailTitle || button.textContent || ''));
    });
  }

  function openTrend(id) {
    const row = state.trendRows.get(id);
    if (!row) return;
    dom.trendTitle.textContent = row.title;
    dom.trendSubtitle.textContent = `${row.drives.length} fundraiser appearances · first ${formatMoney(row.first.total)} · latest ${formatMoney(row.last.total)}`;
    dom.trendBody.innerHTML = renderTrendSvg(row);
    dom.trendModal.classList.remove('hidden');
  }

  function renderTrendSvg(row) {
    const drives = row.drives || [];
    if (!drives.length) return '<div class="empty">No trend data.</div>';
    const width = 900;
    const height = 360;
    const padLeft = 70;
    const padRight = 24;
    const padTop = 24;
    const padBottom = 80;
    const values = drives.map((drive) => Number(drive.total || 0));
    const min = Math.min(0, ...values);
    const max = Math.max(...values, 1);
    const xFor = (index) => drives.length === 1 ? (width - padRight + padLeft) / 2 : padLeft + ((width - padLeft - padRight) * index) / (drives.length - 1);
    const yFor = (value) => padTop + (height - padTop - padBottom) * (1 - ((value - min) / (max - min || 1)));
    const points = drives.map((drive, index) => `${xFor(index).toFixed(1)},${yFor(drive.total).toFixed(1)}`).join(' ');
    const yTicks = [0, max / 2, max];
    return `<svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Fundraiser trend for ${escapeHtml(row.title)}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="#fffdf8"></rect>
      ${yTicks.map((tick) => `<line x1="${padLeft}" x2="${width - padRight}" y1="${yFor(tick)}" y2="${yFor(tick)}" stroke="#eadcc8"></line><text x="10" y="${yFor(tick) + 4}" font-size="13" fill="#6d6255">${escapeHtml(formatMoney(tick))}</text>`).join('')}
      <polyline points="${points}" fill="none" stroke="#2f5d62" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
      ${drives.map((drive, index) => {
        const x = xFor(index);
        const y = yFor(drive.total);
        return `<circle cx="${x}" cy="${y}" r="5" fill="#7b341e"></circle><text x="${x}" y="${Math.max(16, y - 12)}" text-anchor="middle" font-size="12" fill="#272019">${escapeHtml(formatMoney(drive.total))}</text><text x="${x}" y="${height - 44}" text-anchor="middle" font-size="12" fill="#6d6255" transform="rotate(-30 ${x} ${height - 44})">${escapeHtml(drive.seasonYear)}</text>`;
      }).join('')}
    </svg>`;
  }


  function findProgramRow(programId = '', title = '') {
    const id = text(programId);
    const titleKey = lookupKey(title);
    return state.libraryById.get(id)
      || state.libraryByTitle.get(titleKey)
      || state.libraryRows.find((row) => text(row.id) === id)
      || state.libraryRows.find((row) => lookupKey(row.title) === titleKey)
      || null;
  }

  function recordsForProgram(programId = '', title = '') {
    const id = text(programId);
    const titleKey = lookupKey(title);
    return state.records.filter((record) => {
      if (id && (text(record.programOpenId) === id || text(record.programId) === id)) return true;
      return titleKey && lookupKey(record.title) === titleKey;
    }).sort((a, b) => (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0));
  }

  function openProgramDetail(programId = '', title = '') {
    const program = findProgramRow(programId, title) || {};
    const displayTitle = text(program.title || title || 'Program detail');
    const rows = recordsForProgram(programId, displayTitle);
    const dollars = rows.reduce((sum, record) => sum + Number(record.dollars || 0), 0);
    const pledges = rows.reduce((sum, record) => sum + Number(record.pledges || 0), 0);
    const avg = rows.length ? dollars / rows.length : 0;
    const mix = seasonMix(rows);
    const recentRows = rows.slice(0, 40);

    dom.programModalTitle.textContent = displayTitle;
    dom.programModalSubtitle.textContent = rows.length
      ? `${formatNumber(rows.length)} pledge airing row(s) in analytics history · ${formatMoney(dollars)} total`
      : 'No pledge airing rows found in the analytics history for this title.';

    dom.programModalBody.innerHTML = `
      <div class="program-detail-grid">
        <div class="program-detail-item"><span class="program-detail-label">Title</span><div class="program-detail-value">${escapeHtml(displayTitle)}</div></div>
        <div class="program-detail-item"><span class="program-detail-label">NOLA</span><div class="program-detail-value">${escapeHtml(text(program.nola_code) || rows.map((record) => record.nola).find(Boolean) || '—')}</div></div>
        <div class="program-detail-item"><span class="program-detail-label">Primary topic</span><div class="program-detail-value">${escapeHtml(text(program.topic_primary) || rows.map((record) => record.topic).find(Boolean) || '—')}</div></div>
        <div class="program-detail-item"><span class="program-detail-label">Secondary topic</span><div class="program-detail-value">${escapeHtml(text(program.topic_secondary) || '—')}</div></div>
        <div class="program-detail-item"><span class="program-detail-label">Distributor</span><div class="program-detail-value">${escapeHtml(text(program.distributor) || rows.map((record) => record.distributor).find(Boolean) || '—')}</div></div>
        <div class="program-detail-item"><span class="program-detail-label">Rights</span><div class="program-detail-value">${escapeHtml([program.rights_start, program.rights_end].map(text).filter(Boolean).join(' → ') || '—')}</div></div>
      </div>
      <div class="program-detail-summary">
        <div class="stat"><div class="v">${formatMoney(dollars)}</div><div>Total dollars</div></div>
        <div class="stat"><div class="v">${formatMoney(avg)}</div><div>Avg / airing</div></div>
        <div class="stat"><div class="v">${formatNumber(rows.length)}</div><div>Broadcasts</div></div>
        <div class="stat"><div class="v">${escapeHtml(mix.label)}</div><div>Season mix</div></div>
      </div>
      ${recentRows.length ? `<div class="program-detail-table-wrap"><table><thead><tr><th>Date</th><th>Fundraiser</th><th class="money">Dollars</th><th class="num">Pledges</th><th>Live break</th></tr></thead><tbody>${recentRows.map((record) => `<tr><td>${escapeHtml(record.date ? record.date.toLocaleDateString() : '—')}</td><td>${escapeHtml(record.fundraiser || record.seasonYear || '—')}</td><td class="money">${formatMoney(record.dollars)}</td><td class="num">${formatNumber(record.pledges)}</td><td>${escapeHtml(record.liveState === 'live' ? 'Yes' : record.liveState === 'nonlive' ? 'No' : 'Unknown')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No pledge-airing detail rows found for this title.</div>'}
      <div class="program-detail-note">This popup stays inside Performance Analytics. It uses the analytics page’s loaded library row plus pledge-airing history; it does not jump back to the Program Library.</div>`;
    dom.programModal.classList.remove('hidden');
  }

  function closeProgramDetail() {
    dom.programModal.classList.add('hidden');
    dom.programModalBody.innerHTML = '';
  }


  function openGroupDetail(id = '', mode = 'all') {
    const row = state.groupDetailRows.get(id);
    if (!row) return;
    const records = Array.isArray(row.records) ? [...row.records] : [];
    const zeroCount = records.filter((record) => Number(record.dollars || 0) === 0).length;
    const outlierCount = Number(row.outlierCount || 0);
    const sortedRecords = records.sort((a, b) => {
      if (mode === 'outliers') {
        const aFlagged = outlierStatusForRecord(row, a) ? 1 : 0;
        const bFlagged = outlierStatusForRecord(row, b) ? 1 : 0;
        if (aFlagged !== bFlagged) return bFlagged - aFlagged;
      } else if (mode === 'distribution') {
        const aZero = Number(a.dollars || 0) === 0 ? 1 : 0;
        const bZero = Number(b.dollars || 0) === 0 ? 1 : 0;
        if (aZero !== bZero) return bZero - aZero;
      }
      const aTime = a.date instanceof Date && !Number.isNaN(a.date.getTime()) ? a.date.getTime() : 0;
      const bTime = b.date instanceof Date && !Number.isNaN(b.date.getTime()) ? b.date.getTime() : 0;
      return bTime - aTime || Number(b.dollars || 0) - Number(a.dollars || 0);
    });
    const lens = state.question === 'secondaryTopics' ? 'Secondary topic' : 'Topic';
    dom.programModalTitle.textContent = `${row.title || lens} · ${lens} detail`;
    dom.programModalSubtitle.textContent = `${formatNumber(records.length)} airing(s) · Median ${formatMoney(row.median || 0)} · Average ${formatMoney(row.avg || 0)} · Total ${formatMoney(row.dollars || 0)}`;
    const detailRows = sortedRecords.map((record) => {
      const status = outlierStatusForRecord(row, record);
      const date = record.date instanceof Date && !Number.isNaN(record.date.getTime()) ? record.date.toLocaleDateString() : (record.dateKey || '—');
      const start = Number.isFinite(Number(record.startMinutes)) ? formatTimeFromMinutes(record.startMinutes) : '—';
      return `<tr class="${status ? 'outlier-row' : ''}"><td>${escapeHtml(date)}</td><td>${escapeHtml(record.fundraiser || record.seasonYear || '—')}</td><td>${escapeHtml(record.title || record.importedTitle || '—')}</td><td>${escapeHtml(start)}</td><td class="analytics-left">${formatMoney(record.dollars || 0)}</td><td class="analytics-left">${formatNumber(record.pledges || 0)}</td><td>${status ? `<span class="risk">${escapeHtml(status)}</span>` : '—'}</td></tr>`;
    }).join('');
    dom.programModalBody.innerHTML = `
      <div class="program-detail-summary">
        <div class="stat"><div class="v">${formatMoney(row.median || 0)}</div><div>Median / airing</div></div>
        <div class="stat"><div class="v">${formatMoney(row.avg || 0)}</div><div>Average / airing</div></div>
        <div class="stat"><div class="v">${formatNumber(records.length)}</div><div>Airings</div></div>
        <div class="stat"><div class="v">${formatNumber(outlierCount)}</div><div>Outliers</div></div>
        <div class="stat"><div class="v">${formatNumber(zeroCount)}</div><div>Zero-$ airings</div></div>
      </div>
      <div class="program-detail-table-wrap"><table><thead><tr><th>Date</th><th>Fundraiser</th><th>Program</th><th>Start</th><th>Dollars</th><th>Pledges</th><th>Outlier status</th></tr></thead><tbody>${detailRows || '<tr><td colspan="7">No airing detail is available.</td></tr>'}</tbody></table></div>
      <div class="program-detail-note">${row.zeroDominated ? `Zero-dominated distribution: ${formatNumber(zeroCount)} of ${formatNumber(records.length)} included airings are $0. This is a distribution warning, not an outlier claim. ` : ''}${mode === 'outliers' ? 'Flagged outliers are listed first. ' : ''}${mode === 'distribution' ? 'Zero-dollar airings are listed first. ' : ''}Outlier flags use Median Absolute Deviation. No airing is removed or discounted from the Median, Average, or Total shown here.</div>`;
    dom.programModal.classList.remove('hidden');
  }

  function bindEvents() {
    dom.reload.addEventListener('click', () => load().catch((error) => note(error.message || 'Could not reload data.', 'bad')));
    dom.season.addEventListener('change', () => { state.season = dom.season.value; render(); });
    dom.yearOptions.addEventListener('change', () => {
      const allValues = [...dom.yearOptions.querySelectorAll('input[type="checkbox"]')].map((item) => item.value);
      const checked = [...dom.yearOptions.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value);
      state.yearFilters = checked.length === allValues.length ? null : checked;
      updateYearSummary();
      render();
    });
    dom.search.addEventListener('input', () => { state.search = dom.search.value; render(); });
    dom.evidence.addEventListener('change', () => { state.evidence = dom.evidence.value; render(); });
    dom.secondaryTopic.addEventListener('change', () => { state.secondaryTopicFilter = dom.secondaryTopic.value || 'all'; render(); });
    dom.rightsScope?.addEventListener('change', () => { state.rightsScope = dom.rightsScope.value || 'all'; state.tableSort = { question: state.question, index: null, direction: 'asc' }; render(); });
    dom.topicOptions.addEventListener('change', (event) => {
      const input = event.target.closest('input[type="checkbox"]');
      if (!input) return;
      if (input.value === '__all__') {
        state.topicFilters = [];
      } else {
        const checked = [...dom.topicOptions.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value).filter((value) => value !== '__all__');
        state.topicFilters = checked;
      }
      updateTopicSummary();
      render();
    });
    dom.advDistributor.addEventListener('change', () => { state.advancedDistributor = dom.advDistributor.value; render(); });
    dom.advMetric.addEventListener('change', () => { state.metric = dom.advMetric.value; render(); });
    dom.advLive.addEventListener('change', () => { state.advancedLive = dom.advLive.value; render(); });
    dom.advDaypart.addEventListener('change', () => { state.advancedDaypart = dom.advDaypart.value; render(); });
    dom.advWeekpart.addEventListener('change', () => { state.advancedWeekpart = dom.advWeekpart.value; render(); });
    dom.advDuration.addEventListener('change', () => { state.advancedDuration = dom.advDuration.value; render(); });
    dom.trendClose.addEventListener('click', () => dom.trendModal.classList.add('hidden'));
    dom.trendModal.addEventListener('click', (event) => { if (event.target === dom.trendModal) dom.trendModal.classList.add('hidden'); });
    dom.programModalClose.addEventListener('click', closeProgramDetail);
    dom.programModal.addEventListener('click', (event) => { if (event.target === dom.programModal) closeProgramDetail(); });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      dom.trendModal.classList.add('hidden');
      closeProgramDetail();
    });
  }


  async function ensureReady(options = {}) {
    await mountAnalyticsWorkspace();
    const wantsCohort = Boolean(options.cohort);
    if (wantsCohort) {
      state.cohort = readAnalyticsCohort();
      if (state.cohort?.keySet) {
        state.question = 'programs';
        state.metric = 'median';
      }
    }
    if (loaded && !options.force) {
      if (wantsCohort) {
        rebuildFilterOptions();
        render();
      }
      return true;
    }
    if (!loadPromise) {
      loadPromise = (async () => {
        if (!(await init())) return false;
        await load();
        loaded = true;
        return true;
      })().catch((error) => {
        console.error(error);
        note(error.message || 'Performance Analytics failed to load.', 'bad');
        return false;
      }).finally(() => {
        loadPromise = null;
      });
    }
    return loadPromise;
  }

  async function openCohort() {
    return ensureReady({ cohort: true });
  }

  async function reload() {
    return ensureReady({ force: true });
  }

  App.analyticsUi = { ensureReady, openCohort, reload };
})();

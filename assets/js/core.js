window.PledgeLib = window.PledgeLib || {};

(() => {
  const App = window.PledgeLib;
  const cfg = window.PLEDGE_MANAGER_CONFIG || {};

  App.cfg = cfg;
  App.constants = {
    APP_NAME: 'WNMU Pledge Program Library',
    APP_VERSION: 'v0.21.34',
    LIBRARY_VIEW: 'pledge_program_library_summary_v2',
    BASE_TABLE: 'pledge_programs_v2',
    TIMING_TABLE: 'pledge_program_timings_v2',
    DRIVE_RESULTS_TABLE: 'pledge_program_drive_rollups_v2',
    AIRINGS_TABLE: 'pledge_program_airings_v2',
    DEFAULT_PAGE_SIZE: Number(cfg.DEFAULT_PAGE_SIZE) || 100,
    SEARCHABLE_FIELDS: new Set([
      'title',
      'nola_code',
      'topic_primary',
      'topic_secondary',
      'distributor',
      'premium_summary',
      'program_notes'
    ]),
    EDITABLE_FIELDS: [
      'title',
      'nola_code',
      'distributor',
      'length_bucket_minutes',
      'actual_runtime_input',
      'topic_primary',
      'topic_secondary',
      'rights_start',
      'rights_end',
      'package_type',
      'source_format',
      'rights_notes',
      'premium_summary',
      'program_notes'
    ],
    SOURCE_CANDIDATES: [
      { name: 'pledge_programs_v2', label: 'base table', preferred: true },
      { name: 'pledge_program_library_summary_v2', label: 'summary view', preferred: false }
    ],
    SORT_FIELDS: {
      title: 'Title',
      length: 'Length',
      topic: 'Topic',
      rights_begin: 'Rights Begin',
      rights_end: 'Rights End',
      last_aired: 'Last Aired',
      avg_per_fundraiser: 'Average $ / fundraiser'
    },
    WORKSPACES: [
      { id: 'library', label: 'Program Library', live: true },
      { id: 'scheduling', label: 'Pledge Scheduling', live: true },
      { id: 'imports', label: 'Import Pledge Report', live: true },
      { id: 'performance', label: 'Pledge Performance', live: true }
    ],
    SCHEDULE_STORAGE_KEY: 'wnmuPledgeSchedulesV2',
    IMPORT_MATCH_RULES_STORAGE_KEY: 'wnmuPledgeImportMatchRulesV1',
    IMPORT_REPORT_TOTALS_STORAGE_KEY: 'wnmuPledgeImportReportTotalsV1',
    SCHEDULES_TABLE: 'pledge_fundraiser_schedules',
    NON_PLEDGE_SOURCE_CANDIDATES: (() => {
      const raw = cfg.NON_PLEDGE_SOURCE_CANDIDATES;
      if (Array.isArray(raw) && raw.length) {
        return raw.map((entry) => (typeof entry === 'string'
          ? { name: entry, label: entry }
          : { name: entry?.name || '', label: entry?.label || entry?.name || '' })).filter((entry) => entry.name);
      }
      return [
        { name: 'program_library_summary_v2', label: 'Program Library summary' },
        { name: 'wnmu_program_library_summary_v2', label: 'WNMU Program Library summary' },
        { name: 'program_library_v2', label: 'Program Library table' },
        { name: 'programs_v2', label: 'Programs table' }
      ];
    })(),
    DEFAULT_DAY_START_HOUR: 7,
    DEFAULT_DAY_END_HOUR: 31,
    DEFAULT_DAY_START_MINUTES: 420,
    DEFAULT_DAY_END_MINUTES: 1830,
    MIN_VISIBLE_HOUR: 0,
    MAX_VISIBLE_HOUR: 36,
    DEFAULT_SLOT_MINUTES: 30,
    VERSION_MANIFEST: 'version.json',
    VERSION_CHECK_INTERVAL_MS: 10 * 60 * 1000
  };

  const adminEmails = Array.isArray(cfg.ADMIN_EMAILS)
    ? cfg.ADMIN_EMAILS.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    : [];

  App.adminEmails = adminEmails;
  App.state = {
    client: null,
    session: null,
    userEmail: null,
    isAdmin: false,
    rawRows: [],
    baseRows: [],
    rows: [],
    totalRows: 0,
    selectedProgramId: null,
    searchText: '',
    searchField: '',
    statusFilter: 'active',
    topicFilter: '',
    secondaryTopicFilter: '',
    lengthFilter: '',
    distributorFilter: '',
    sortField: 'topic',
    sortDirection: 'asc',
    topicOptions: [],
    secondaryTopicOptions: [],
    lengthOptions: [],
    distributorOptions: [],
    detailEditMode: false,
    detailCreateMode: false,
    currentDetailProgram: null,
    currentDetailTimings: [],
    currentDetailDriveResults: [],
    detailExtraFieldDraft: {},
    currentDetailAirings: [],
    detailCache: {},
    detailPending: {},
    detailQueryHints: {},
    detailLoadToken: null,
    librarySource: null,
    lastProbeSummary: [],
    configVersionMismatch: '',
    configReady: false,
    remoteVersionInfo: {
      remoteVersion: '',
      localVersion: '',
      checkedAt: '',
      dismissedVersion: ''
    },
    scheduleImportedAiringsCache: null,
    scheduleImportedAiringsPromise: null,
    scheduleSlotRescueCache: {},
    activeWorkspace: 'library',
    schedulingReady: false,
    fieldAudit: {
      rowCount: 0,
      missingTopicCount: 0,
      missingDistributorCount: 0,
      missingBothCount: 0,
      matchedByIdCount: 0,
      matchedByNolaCount: 0,
      matchedByTitleCount: 0,
      unmatchedSupplementCount: 0,
      topicCandidateKeys: [],
      distributorCandidateKeys: []
    },
    loadingState: {
      active: false,
      label: '',
      detail: ''
    },
    schedules: [],
    activeScheduleId: '',
    scheduleDraft: {
      title: '',
      startDate: '',
      endDate: '',
      dayStartHour: 7,
      dayEndHour: 31,
      dayStartMinutes: 420,
      dayEndMinutes: 1830,
      onlineDollars: 0,
      mailDollars: 0
    },
    scheduleView: {
      zoom: 1,
      dayStartHour: 7,
      dayEndHour: 31,
      dayStartMinutes: 420,
      dayEndMinutes: 1830
    },
    selectedScheduleSlot: null,
    selectedScheduleProgram: null,
    scheduleProgramQuery: '',
    scheduleProgramTopicFilter: '',
    scheduleNonPledgeMode: false,
    scheduleFilterUnaired: false,
    scheduleFilterRightsStartYear: false,
    scheduleFilterTopEarner: false,
    scheduleModalWarning: { text: '', type: '' },
    scheduleStoreMode: 'local',
    scheduleStoreReady: false,
    scheduleExpectationLoading: false,
    nonPledgeRows: [],
    nonPledgeSource: null,
    nonPledgeLoadState: 'idle',
    nonPledgeLoadPromise: null,
    scheduleDetailCache: {},
    scheduleClipboard: null,
    draggedPlacementId: '',
    scheduleSyncMessage: '',
    imports: {
      ready: false,
      loading: false,
      targetMode: 'auto',
      rawFiles: [],
      fileSummaries: [],
      airingsRows: [],
      driveRows: [],
      warnings: [],
      tableStatus: [],
      existingUnlinkedRows: [],
      existingUnlinkedError: '',
      quarantineFilterText: '',
      selectedExistingUnlinkedHash: '',
      suspectRows: [],
      suspectRowsError: '',
      suspectFilterText: '',
      selectedSuspectId: '',
      suspectLinkSelections: {},
      scheduleAiringHistoryMap: {},
      scheduleAiringHistoryLoading: false,
      scheduleAiringHistoryLoaded: false,
      detailTimingDraftRows: [],
      lastAnalyzedAt: '',
      lastImportedAt: '',
      lastImportResult: null,
      importBatchId: '',
      aliasRules: [],
      reportTotalsByFile: {},
      rawAccountingRows: [],
      rawAccountingSummaries: [],
      error: ''
    },

  performance: {
    ready: false,
    loading: false,
    criterion: 'topic',
    metric: 'avg_dollars',
    chartType: 'auto',
    topN: 12,
    labelFilter: '',
    startDate: '',
    endDate: '',
    useAllDates: false,
    monthFilter: '',
    topicFilter: '',
    programFilter: '',
    daySetFilter: '',
    daypartScope: '',
    weekpartScope: '',
    broadcastDayStartHour: 7,
    slotCompareA: '',
    slotCompareB: '',
    slotDrillKey: '',
    slotDrillMode: 'winner',
    quickFilter: '',
    includeExpiredPrograms: true,
    records: [],
    filteredRecords: [],
    groups: [],
    dataShape: {
      driveRows: 0,
      airingRows: 0,
      recordsWithMoney: 0,
      recordsWithDateTime: 0
    },
    criteriaSummary: [],
    warnings: [],
    notes: [],
    lastLoadedAt: '',
    error: ''
  }
};

  const state = App.state;

  const utils = {
    escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    toDisplayText(value) {
      if (value == null) return '';
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (Array.isArray(value)) {
        return value
          .map((item) => utils.toDisplayText(item))
          .filter(Boolean)
          .join(', ')
          .trim();
      }
      if (typeof value === 'object') {
        const guessed = [value.label, value.name, value.title, value.text, value.value]
          .map((item) => utils.toDisplayText(item))
          .find(Boolean);
        return guessed || '';
      }
      return String(value).trim();
    },

    normalizeText(value) {
      return utils.toDisplayText(value);
    },

    normalizeLookupKey(value) {
      return utils.normalizeText(value)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    },

    canonicalNonSpecificTitle() {
      return 'Non-Specific Pledges';
    },

    canonicalNonSpecificNola() {
      return 'NSPL';
    },

    isPlaceholderNoNola(value) {
      const key = utils.normalizeLookupKey(value || '').replace(/\s+/g, '');
      return key === 'nonola';
    },

    nolaIdentityKey(nolaValue, titleValue = '') {
      const nolaKey = utils.normalizeLookupKey(nolaValue || '');
      if (!nolaKey) return '';
      if (utils.isPlaceholderNoNola(nolaValue)) {
        const titleKey = utils.normalizeLookupKey(titleValue || '');
        return titleKey ? `nola_title:${nolaKey}|${titleKey}` : `nola:${nolaKey}`;
      }
      return `nola:${nolaKey}`;
    },

    isNonSpecificTitle(value) {
      const key = utils.normalizeLookupKey(value || '');
      return key === 'non specific pledges'
        || key.endsWith('non specific pledges')
        || key === 'non specific pledge'
        || key.endsWith('non specific pledge')
        || /(^| )non specific pledge(s)?($| )/.test(key);
    },

    isNonSpecificNola(value) {
      const key = utils.normalizeLookupKey(value || '').replace(/\s+/g, '');
      return key === 'nspl';
    },

    isNonSpecificRow(row = {}) {
      if (!row || typeof row !== 'object') return false;
      return Boolean(
        row.is_non_specific === true
        || row.isNonSpecific === true
        || String(row.match_method || '').toLowerCase() === 'non_specific'
        || String(row.review_status || '').toLowerCase() === 'non_specific'
        || utils.isNonSpecificNola(utils.firstNonEmpty(row.nola_code, row.nola, row.program_nola, ''))
        || utils.isNonSpecificTitle(utils.firstNonEmpty(row.imported_program_title, row.title, row.program_title, row.name, ''))
      );
    },

    canonicalizeNonSpecificRow(row = {}) {
      if (!utils.isNonSpecificRow(row)) return row || {};
      const normalized = { ...(row || {}) };
      normalized.is_non_specific = true;
      normalized.isNonSpecific = true;
      normalized.match_method = 'non_specific';
      if (Object.prototype.hasOwnProperty.call(normalized, 'review_status') && utils.isBlank(normalized.review_status)) normalized.review_status = 'non_specific';
      normalized.imported_program_title = utils.canonicalNonSpecificTitle();
      normalized.matched_library_title = utils.canonicalNonSpecificTitle();
      normalized.title = utils.canonicalNonSpecificTitle();
      normalized.program_title = utils.canonicalNonSpecificTitle();
      normalized.name = utils.canonicalNonSpecificTitle();
      normalized.nola_code = utils.canonicalNonSpecificNola();
      normalized.nola = utils.canonicalNonSpecificNola();
      normalized.program_nola = utils.canonicalNonSpecificNola();
      return normalized;
    },

    isBlank(value) {
      return !utils.normalizeText(value);
    },

    firstNonEmpty(...values) {
      for (const value of values) {
        if (value === 0 || value === false) return value;
        if (!utils.isBlank(value)) return value;
      }
      return null;
    },

    preferPrimary(primaryValue, fallbackValue) {
      return utils.isBlank(primaryValue) ? fallbackValue : primaryValue;
    },

    mergeRows(primaryRow = {}, fallbackRow = {}) {
      const merged = { ...fallbackRow };
      Object.entries(primaryRow || {}).forEach(([key, value]) => {
        merged[key] = utils.preferPrimary(value, merged[key]);
      });
      return merged;
    },

    valueFromExactKeys(row, keys = []) {
      if (!row) return null;
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(row, key) && !utils.isBlank(row[key])) return row[key];
      }
      return null;
    },

    valueFromKeyScan(row, includePattern, excludePattern = null) {
      if (!row) return null;
      for (const [key, value] of Object.entries(row)) {
        if (excludePattern && excludePattern.test(key)) continue;
        if (includePattern.test(key) && !utils.isBlank(value)) return value;
      }
      return null;
    },

    candidateKeys(rows = [], includePattern, excludePattern = null) {
      const found = new Set();
      rows.forEach((row) => {
        Object.entries(row || {}).forEach(([key, value]) => {
          if (excludePattern && excludePattern.test(key)) return;
          if (includePattern.test(key) && !utils.isBlank(value)) found.add(key);
        });
      });
      return [...found].sort((a, b) => a.localeCompare(b));
    },

    formatCount(value) {
      return Number(value || 0).toLocaleString();
    },

    formatDate(value, fallback = '—') {
      if (!value) return fallback;
      const date = utils.parseDateLike(value, { preferDateOnlyLocal: true });
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    },

    parseFlexibleDateInput(value) {
      const text = utils.normalizeText(value);
      if (!text) return { blank: true, valid: true, iso: null, display: '' };

      const direct = new Date(text);
      if (!Number.isNaN(direct.getTime()) && /\d{4}-\d{1,2}-\d{1,2}/.test(text)) {
        const year = direct.getFullYear();
        const month = String(direct.getMonth() + 1).padStart(2, '0');
        const day = String(direct.getDate()).padStart(2, '0');
        return { blank: false, valid: true, iso: `${year}-${month}-${day}`, display: `${month}/${day}/${String(year).slice(-2)}` };
      }

      const match = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
      if (!match) return { blank: false, valid: false, iso: null, display: text };

      let month = Number(match[1]);
      let day = Number(match[2]);
      let year = Number(match[3]);
      if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) {
        return { blank: false, valid: false, iso: null, display: text };
      }
      if (match[3].length === 2) year += year >= 70 ? 1900 : 2000;
      if (month < 1 || month > 12 || day < 1 || day > 31) {
        return { blank: false, valid: false, iso: null, display: text };
      }
      const probe = new Date(year, month - 1, day);
      if (
        Number.isNaN(probe.getTime())
        || probe.getFullYear() != year
        || probe.getMonth() != month - 1
        || probe.getDate() != day
      ) {
        return { blank: false, valid: false, iso: null, display: text };
      }
      const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const display = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${String(year).slice(-2)}`;
      return { blank: false, valid: true, iso, display };
    },

    formatCompactDateInput(value, fallback = '') {
      const parsed = utils.parseFlexibleDateInput(value);
      if (!parsed.valid) return utils.normalizeText(value) || fallback;
      return parsed.display || fallback;
    },

    formatDateTime(value, fallback = 'N/A') {
      if (!value) return fallback;
      const text = utils.normalizeText(value);
      const date = utils.parseDateLike(value, { preferDateOnlyLocal: true });
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return String(value);
      if (text && /^\d{4}-\d{2}-\d{2}$/.test(text)) return utils.formatDate(text, fallback);
      return date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
    },

    parseClockTime(value) {
      const text = utils.normalizeText(value);
      if (!text) return null;
      let match = text.match(/^(\d{1,2})(?::?(\d{2}))?(?::?(\d{2}))?$/);
      if (match) {
        const hour = Number(match[1] || 0);
        const minute = Number(match[2] || 0);
        const second = Number(match[3] || 0);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59) {
          return { hour, minute, second };
        }
      }
      match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
      if (match) {
        let hour = Number(match[1] || 0);
        const minute = Number(match[2] || 0);
        const suffix = String(match[3] || '').toLowerCase();
        if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
          if (suffix === 'pm' && hour < 12) hour += 12;
          if (suffix === 'am' && hour === 12) hour = 0;
          return { hour, minute, second: 0 };
        }
      }
      return null;
    },

    buildLocalDateTime(dateValue, timeValue = '', fallbackHour = 12) {
      const date = utils.parseFlexibleDateInput(dateValue);
      if (!date.valid || !date.iso) return null;
      const [year, month, day] = date.iso.split('-').map((part) => Number(part));
      const parsedTime = utils.parseClockTime(timeValue);
      const hour = parsedTime ? parsedTime.hour : fallbackHour;
      const minute = parsedTime ? parsedTime.minute : 0;
      const second = parsedTime ? parsedTime.second : 0;
      const local = new Date(year, month - 1, day, hour, minute, second, 0);
      return Number.isNaN(local.getTime()) ? null : local;
    },

    formatTime(value, fallback = '—') {
      if (!value && value !== 0) return fallback;
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      }
      const parsed = utils.parseClockTime(value);
      if (parsed) {
        const sample = new Date(2000, 0, 1, parsed.hour, parsed.minute, parsed.second || 0, 0);
        return sample.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      }
      return utils.normalizeText(value) || fallback;
    },

    rowLocalDateTime(row = {}, options = {}) {
      const preferDriveFallback = options.preferDriveFallback !== false;
      const explicitTime = utils.firstNonEmpty(row?.air_time, row?.time_of_day, row?.scheduled_time, row?.slot_time, row?.airtime, row?.broadcast_time);
      const localAiring = utils.buildLocalDateTime(utils.firstNonEmpty(row?.air_date, row?.broadcast_date, row?.airing_date), explicitTime, 12);
      if (localAiring) return localAiring;
      if (preferDriveFallback) {
        const localDrive = utils.buildLocalDateTime(utils.firstNonEmpty(row?.drive_date, row?.drive_start_date, row?.date_key), explicitTime, 12);
        if (localDrive) return localDrive;
      }
      const rawDateTime = utils.firstNonEmpty(row?.aired_at, row?.air_datetime, row?.broadcast_at, row?.scheduled_at, row?.date_time, row?.datetime, row?.airing_at, row?.airing_date);
      return rawDateTime ? utils.parseDateLike(rawDateTime, { preferDateOnlyLocal: true }) : null;
    },

    rowDisplayDateTime(row = {}, fallback = '—', options = {}) {
      const date = utils.rowLocalDateTime(row, options);
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return fallback;
      const hasExplicitTime = Boolean(utils.firstNonEmpty(row?.air_time, row?.time_of_day, row?.scheduled_time, row?.slot_time, row?.airtime, row?.broadcast_time))
        || /\d{1,2}:\d{2}/.test(utils.normalizeText(utils.firstNonEmpty(row?.aired_at, row?.air_datetime, row?.broadcast_at, row?.scheduled_at, row?.date_time, row?.datetime, row?.airing_at)));
      if (!hasExplicitTime) return utils.formatDate(date, fallback);
      return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    },

    formatMoney(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) return utils.normalizeText(value) || '—';
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
      }).format(num);
    },

    formatSeconds(totalSeconds) {
      const num = Number(totalSeconds);
      if (!Number.isFinite(num) || num <= 0) return '—';
      const sec = Math.round(num);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
    },

    parseRuntimeInput(value) {
      const text = utils.normalizeText(value);
      if (!text) return null;
      if (/^\d+$/.test(text)) return Number(text) * 60;
      const parts = text.split(':').map((part) => Number(part));
      if (parts.some((part) => Number.isNaN(part))) return null;
      if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
      if (parts.length === 2) return (parts[0] * 60) + parts[1];
      return null;
    },

    compareText(a, b) {
      return utils.normalizeText(a).localeCompare(utils.normalizeText(b), undefined, {
        sensitivity: 'base',
        numeric: true
      });
    },

    compareNumber(a, b) {
      const aNum = Number(a);
      const bNum = Number(b);
      if (!Number.isFinite(aNum) && !Number.isFinite(bNum)) return 0;
      if (!Number.isFinite(aNum)) return 1;
      if (!Number.isFinite(bNum)) return -1;
      return aNum - bNum;
    },

    parseDateLike(value, options = {}) {
      const preferDateOnlyLocal = options.preferDateOnlyLocal !== false;
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
      const text = utils.normalizeText(value);
      if (!text) return null;
      if (preferDateOnlyLocal && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const [year, month, day] = text.split('-').map((part) => Number(part));
        const local = new Date(year, month - 1, day);
        return Number.isNaN(local.getTime()) ? null : local;
      }
      const flex = utils.parseFlexibleDateInput(text);
      if (preferDateOnlyLocal && flex.valid && flex.iso && /^\d{4}-\d{2}-\d{2}$/.test(flex.iso)) {
        const [year, month, day] = flex.iso.split('-').map((part) => Number(part));
        const local = new Date(year, month - 1, day);
        return Number.isNaN(local.getTime()) ? null : local;
      }
      const parsed = new Date(text);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    },

    compareDate(a, b) {
      const aDateObj = a ? utils.parseDateLike(a) : null;
      const bDateObj = b ? utils.parseDateLike(b) : null;
      const aDate = aDateObj ? aDateObj.getTime() : Number.POSITIVE_INFINITY;
      const bDate = bDateObj ? bDateObj.getTime() : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(aDate) && !Number.isFinite(bDate)) return 0;
      return aDate - bDate;
    },

    sortLabel(field) {
      return App.constants.SORT_FIELDS[field] || field;
    },

    buildMismatchNotice() {
      const strict = String(cfg.REQUIRE_CONFIG_VERSION_MATCH || '').toLowerCase() === 'true';
      if (!strict) return '';
      if (!cfg.APP_VERSION) return '';
      if (cfg.APP_VERSION === App.constants.APP_VERSION) return '';
      return 'config.js build tag does not match this build.';
    },

    minutesToLabel(minutes) {
      const total = Number(minutes) || 0;
      const wrapped = ((Math.floor(total) % 1440) + 1440) % 1440;
      const hour = Math.floor(wrapped / 60);
      const min = wrapped % 60;
      const suffix = hour >= 12 ? 'PM' : 'AM';
      const displayHour = ((hour + 11) % 12) + 1;
      return `${displayHour}:${String(min).padStart(2, '0')} ${suffix}`;
    },

    dateKeyFromDate(value) {
      const date = utils.parseDateLike(value, { preferDateOnlyLocal: true });
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
      const offset = date.getTimezoneOffset();
      const local = new Date(date.getTime() - (offset * 60000));
      return local.toISOString().slice(0, 10);
    },

    datesBetween(startKey, endKey) {
      const results = [];
      if (!startKey || !endKey) return results;
      const start = new Date(`${startKey}T00:00:00`);
      const end = new Date(`${endKey}T00:00:00`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return results;
      const maxDays = 400;
      const cursor = new Date(start);
      let steps = 0;
      while (cursor <= end && steps < maxDays) {
        results.push(utils.dateKeyFromDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
        steps += 1;
      }
      return results;
    },

    plusDays(dateKey, delta) {
      const date = new Date(`${dateKey}T00:00:00`);
      if (Number.isNaN(date.getTime())) return dateKey;
      date.setDate(date.getDate() + delta);
      return utils.dateKeyFromDate(date);
    },

    storageGet(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_error) {
        return fallback;
      }
    },

    storageSet(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (_error) {
        // ignore localStorage failures
      }
    },

    makeId(prefix = 'id') {
      return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
    }
  };

  const derive = {
    programId(row) {
      return utils.firstNonEmpty(row?.id, row?.program_id, row?.pledge_program_id, row?.program_uuid, row?.uuid, row?.__synthetic_program_id) || '';
    },

    title(row) {
      if (utils.isNonSpecificRow(row)) return utils.canonicalNonSpecificTitle();
      return utils.firstNonEmpty(row?.title, row?.program_title, row?.name) || 'Untitled program';
    },

    nola(row) {
      if (utils.isNonSpecificRow(row)) return utils.canonicalNonSpecificNola();
      return utils.firstNonEmpty(row?.nola_code, row?.nola, row?.program_nola) || '';
    },

    topicPrimary(row) {
      return utils.firstNonEmpty(row?.__resolved_topic_primary, row?.topic_primary, row?.primary_topic, row?.topic, row?.category) || '';
    },

    topicSecondary(row) {
      return utils.firstNonEmpty(row?.__resolved_topic_secondary, row?.topic_secondary, row?.secondary_topic, row?.subcategory) || '';
    },

    distributor(row) {
      return utils.firstNonEmpty(row?.__resolved_distributor, row?.distributor, row?.distributor_name, row?.supplier, row?.syndicator) || '';
    },

    description(row) {
      return utils.firstNonEmpty(row?.program_notes, row?.description, row?.summary, row?.notes) || '';
    },

    premiumSummary(row) {
      return utils.firstNonEmpty(row?.premium_summary, row?.premiums, row?.premium_notes) || '';
    },

    rightsBegin(row) {
      return utils.firstNonEmpty(row?.rights_start, row?.rights_begin, row?.rights_start_date) || '';
    },

    rightsEnd(row) {
      return utils.firstNonEmpty(row?.rights_end, row?.rights_end_date) || '';
    },

    lengthBucket(row) {
      return Number(utils.firstNonEmpty(row?.length_bucket_minutes, row?.runtime_minutes, row?.length_minutes)) || null;
    },

    lengthLabel(row) {
      const length = derive.lengthBucket(row);
      return Number.isFinite(length) && length > 0 ? String(length) : '—';
    },

    avgPerFundraiser(row) {
      return utils.firstNonEmpty(
        row?.avg_contribution_per_drive,
        row?.average_per_fundraiser,
        row?.avg_per_fundraiser,
        row?.avg_contribution,
        row?.average_contribution_per_drive,
        row?.avg_dollars_per_drive,
        row?.avg_dollars,
        row?.average_dollars,
        row?.avg_per_event,
        row?.average_per_event,
        row?.event_average,
        row?.historical_average_per_fundraiser,
        row?.historical_avg_per_fundraiser,
        row?.historical_average,
        row?.historical_avg
      ) || null;
    },

    totalRaised(row) {
      const direct = utils.firstNonEmpty(
        row?.total_contributions,
        row?.total_raised,
        row?.sum_contributions,
        row?.gross_contributions,
        row?.contribution_total,
        row?.total_dollars,
        row?.revenue_total,
        row?.gross_revenue,
        row?.revenue,
        row?.historical_total,
        row?.historical_total_dollars,
        row?.historical_broadcast_total,
        row?.broadcast_total,
        row?.broadcast_total_dollars,
        row?.imported_program_specific_broadcast_total_dollars,
        row?.program_specific_broadcast_total_dollars,
        row?.lifetime_total,
        row?.lifetime_total_dollars
      );

      const avg = Number(derive.avgPerFundraiser(row) || 0);
      const count = Number(utils.firstNonEmpty(
        row?.fundraiser_count,
        row?.drive_count,
        row?.fundraiser_total,
        row?.drive_total,
        row?.airing_count,
        row?.aired_count,
        row?.times_aired,
        row?.total_airings,
        row?.event_count,
        row?.events_count
      ) || 0);

      if (!utils.isBlank(direct)) {
        const directNum = Number(direct);
        if (Number.isFinite(directNum)) {
          if (directNum > 0) return directNum;
          if (directNum === 0 && avg > 0) {
            if (Number.isFinite(count) && count > 0) return Math.round(avg * count * 100) / 100;
            return Math.round(avg * 100) / 100;
          }
          return directNum;
        }
        return direct;
      }

      if (!(avg > 0)) return null;
      if (Number.isFinite(count) && count > 0) return Math.round(avg * count * 100) / 100;
      return Math.round(avg * 100) / 100;
    },

    runtimeMinutes(row) {
      const seconds = Number(utils.firstNonEmpty(row?.actual_runtime_seconds, row?.runtime_seconds, row?.actual_runtime));
      if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds / 60);
      const direct = Number(utils.firstNonEmpty(row?.actual_runtime_minutes, row?.runtime_minutes, row?.length_minutes));
      if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
      const bucket = derive.lengthBucket(row);
      return Number.isFinite(bucket) && bucket > 0 ? bucket : null;
    },

    actualRuntimeLabel(row) {
      const seconds = Number(utils.firstNonEmpty(row?.actual_runtime_seconds, row?.runtime_seconds, row?.actual_runtime));
      if (Number.isFinite(seconds) && seconds > 0) return utils.formatSeconds(seconds);
      const directMinutes = Number(utils.firstNonEmpty(row?.actual_runtime_minutes, row?.runtime_minutes, row?.length_minutes));
      if (Number.isFinite(directMinutes) && directMinutes > 0) return utils.formatSeconds(directMinutes * 60);
      const bucket = derive.lengthBucket(row);
      return Number.isFinite(bucket) && bucket > 0 ? utils.formatSeconds(bucket * 60) : '—';
    },

    lastAiredDisplay(row) {
      const explicitLocal = utils.rowLocalDateTime({
        air_date: utils.firstNonEmpty(row?.last_air_date, row?.air_date, row?.last_aired_date),
        air_time: utils.firstNonEmpty(row?.last_air_time, row?.air_time),
        aired_at: utils.firstNonEmpty(row?.last_aired_at, row?.last_aired, row?.aired_at)
      }, { preferDriveFallback: false });
      return explicitLocal instanceof Date && !Number.isNaN(explicitLocal.getTime())
        ? utils.formatDate(explicitLocal, '—')
        : utils.formatDate(utils.firstNonEmpty(row?.last_aired_at, row?.last_aired, row?.aired_at, row?.last_aired_date, row?.air_date), '—');
    },

    isActive(row) {
      const archived = utils.firstNonEmpty(row?.is_archived, row?.archived, row?.inactive_flag);
      if (typeof archived === 'boolean') return !archived;
      const raw = utils.normalizeText(utils.firstNonEmpty(row?.status, row?.library_state)).toLowerCase();
      if (raw === 'archived' || raw === 'inactive') return false;
      const rightsEnd = utils.normalizeText(derive.rightsEnd(row));
      if (rightsEnd) {
        const parsed = utils.parseDateLike(rightsEnd, { preferDateOnlyLocal: true });
        if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
          const today = new Date();
          const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          const endLocal = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
          if (endLocal < todayLocal) return false;
        }
      }
      return true;
    },

    scheduleById(id) {
      return App.state.schedules.find((item) => item.id === id) || null;
    }
  };

  const programLinks = {
    fallbackLookupId(programLike) {
      const row = typeof programLike === 'object' && programLike ? programLike : null;
      const direct = String(!row ? (programLike || '') : '').trim();
      if (direct.startsWith('lookup:')) return direct;
      const titleKey = utils.normalizeLookupKey(row ? derive.title(row) : '');
      const nolaKey = utils.normalizeLookupKey(row ? derive.nola(row) : '');
      if (!(titleKey || nolaKey)) return '';
      return `lookup:${titleKey}|${nolaKey}`;
    },

    resolveRow(programLike) {
      const candidateRows = [...(state.rawRows || []), ...(state.baseRows || [])];
      const key = String(typeof programLike === 'object' && programLike ? derive.programId(programLike) : (programLike || '')).trim();
      if (key) {
        const directMatch = candidateRows.find((row) => String(derive.programId(row)).trim() === key);
        if (directMatch) return directMatch;
      }
      const fallback = programLinks.fallbackLookupId(programLike);
      if (!fallback) return null;
      return candidateRows.find((row) => programLinks.fallbackLookupId(row) === fallback) || null;
    },

    resolveId(programLike) {
      const direct = String(typeof programLike === 'object' && programLike ? derive.programId(programLike) : (programLike || '')).trim();
      if (direct) {
        const row = programLinks.resolveRow(direct);
        return row ? String(derive.programId(row)).trim() || direct : direct;
      }
      return programLinks.fallbackLookupId(programLike);
    },

    render({ programId = '', title = '', html = '', className = '', nested = false, ariaLabel = '', titleAttr = '' } = {}) {
      const resolvedId = programLinks.resolveId(programId);
      const resolvedTitle = utils.normalizeText(title || '') || (resolvedId ? derive.title(programLinks.resolveRow(resolvedId)) : '') || 'Untitled program';
      const content = html || utils.escapeHtml(resolvedTitle);
      if (!resolvedId) return content;
      const tag = nested ? 'span' : 'button';
      const classes = [nested ? 'program-link-inline' : 'program-link-button', className].filter(Boolean).join(' ');
      const attrs = [
        nested ? 'role="button"' : 'type="button"',
        `class="${utils.escapeHtml(classes)}"`,
        `data-program-open-id="${utils.escapeHtml(resolvedId)}"`,
        `aria-label="${utils.escapeHtml(ariaLabel || `Open details for ${resolvedTitle}`)}"`
      ];
      if (titleAttr) attrs.push(`title="${utils.escapeHtml(titleAttr)}"`);
      return `<${tag} ${attrs.join(' ')}>${content}</${tag}>`;
    }
  };

  App.utils = utils;
  App.derive = derive;
  App.programLinks = programLinks;
})();

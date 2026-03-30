window.PledgeLib = window.PledgeLib || {};

(() => {
  const App = window.PledgeLib;
  const cfg = window.PLEDGE_MANAGER_CONFIG || {};

  App.cfg = cfg;
  App.constants = {
    APP_NAME: 'WNMU Pledge Program Library',
    APP_VERSION: 'v0.20.8',
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
      { name: 'pledge_program_library_summary_v2', label: 'summary view', preferred: true },
      { name: 'pledge_programs_v2', label: 'base table', preferred: false }
    ],
    SORT_FIELDS: {
      title: 'Title',
      length: 'Length',
      topic: 'Topic',
      rights_end: 'Rights End',
      avg_per_fundraiser: 'Average $ / fundraiser'
    },
    WORKSPACES: [
      { id: 'library', label: 'Program Library', live: true },
      { id: 'scheduling', label: 'Pledge Scheduling', live: true },
      { id: 'imports', label: 'Report Imports', live: true },
      { id: 'performance', label: 'Pledge Performance', live: true }
    ],
    SCHEDULE_STORAGE_KEY: 'wnmuPledgeSchedulesV2',
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
    DEFAULT_SLOT_MINUTES: 30
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
    currentDetailAirings: [],
    librarySource: null,
    lastProbeSummary: [],
    configVersionMismatch: '',
    configReady: false,
    activeWorkspace: 'library',
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
      dayEndMinutes: 1830
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
    scheduleModalWarning: { text: '', type: '' },
    scheduleStoreMode: 'local',
    scheduleStoreReady: false,
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
      lastAnalyzedAt: '',
      lastImportedAt: '',
      lastImportResult: null,
      importBatchId: '',
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
    monthFilter: '',
    topicFilter: '',
    programFilter: '',
    daypartScope: '',
    weekpartScope: '',
    quickFilter: '',
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
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    },

    formatDateTime(value, fallback = 'N/A') {
      if (!value) return fallback;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
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

    compareDate(a, b) {
      const aDate = a ? new Date(a).getTime() : Number.POSITIVE_INFINITY;
      const bDate = b ? new Date(b).getTime() : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(aDate) && !Number.isFinite(bDate)) return 0;
      return aDate - bDate;
    },

    sortLabel(field) {
      return App.constants.SORT_FIELDS[field] || field;
    },

    buildMismatchNotice() {
      if (!cfg.APP_VERSION) return '';
      if (cfg.APP_VERSION === App.constants.APP_VERSION) return '';
      return `Config version ${cfg.APP_VERSION} does not match build ${App.constants.APP_VERSION}.`;
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
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return '';
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
      const cursor = new Date(start);
      while (cursor <= end) {
        results.push(utils.dateKeyFromDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
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
      return utils.firstNonEmpty(row?.__synthetic_program_id, row?.id, row?.program_id, row?.pledge_program_id, row?.program_uuid, row?.uuid) || '';
    },

    title(row) {
      return utils.firstNonEmpty(row?.title, row?.program_title, row?.name) || 'Untitled program';
    },

    nola(row) {
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
      return utils.firstNonEmpty(row?.avg_contribution_per_drive, row?.average_per_fundraiser, row?.avg_per_fundraiser, row?.avg_contribution) || null;
    },

    totalRaised(row) {
      return utils.firstNonEmpty(row?.total_contributions, row?.total_raised, row?.sum_contributions, row?.gross_contributions) || null;
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
      return utils.formatDate(utils.firstNonEmpty(row?.last_aired_at, row?.last_aired, row?.aired_at), '—');
    },

    isActive(row) {
      const archived = utils.firstNonEmpty(row?.is_archived, row?.archived, row?.inactive_flag);
      if (typeof archived === 'boolean') return !archived;
      const raw = utils.normalizeText(utils.firstNonEmpty(row?.status, row?.library_state)).toLowerCase();
      if (raw === 'archived' || raw === 'inactive') return false;
      return true;
    },

    scheduleById(id) {
      return App.state.schedules.find((item) => item.id === id) || null;
    }
  };

  App.utils = utils;
  App.derive = derive;
})();

window.PledgeLib = window.PledgeLib || {};

(() => {
  const App = window.PledgeLib;
  const cfg = window.PLEDGE_MANAGER_CONFIG || {};

  App.cfg = cfg;
  App.constants = {
    APP_NAME: 'WNMU Pledge Program Library',
    APP_VERSION: 'v0.8.0',
    LIBRARY_VIEW: 'pledge_program_library_summary_v2',
    BASE_TABLE: 'pledge_programs_v2',
    TIMING_TABLE: 'pledge_program_timings_v2',
    DRIVE_RESULTS_TABLE: 'pledge_program_drive_results_v2',
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
      { id: 'library', label: 'Library', live: true },
      { id: 'versions', label: 'Versions & Timing', live: false },
      { id: 'performance', label: 'Performance', live: false },
      { id: 'imports', label: 'Import Tools', live: false },
      { id: 'reports', label: 'Reports', live: false },
      { id: 'admin', label: 'Admin', live: false }
    ]
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
      const av = Number(a);
      const bv = Number(b);
      const aFinite = Number.isFinite(av);
      const bFinite = Number.isFinite(bv);
      if (!aFinite && !bFinite) return 0;
      if (!aFinite) return 1;
      if (!bFinite) return -1;
      return av - bv;
    },

    compareDate(a, b) {
      const at = a ? new Date(a).getTime() : Number.NaN;
      const bt = b ? new Date(b).getTime() : Number.NaN;
      const aFinite = Number.isFinite(at);
      const bFinite = Number.isFinite(bt);
      if (!aFinite && !bFinite) return 0;
      if (!aFinite) return 1;
      if (!bFinite) return -1;
      return at - bt;
    },

    sortLabel(sortField) {
      return App.constants.SORT_FIELDS[sortField] || sortField;
    },

    buildMismatchNotice() {
      const configuredVersion = utils.normalizeText(cfg.APP_VERSION);
      if (!configuredVersion || configuredVersion === App.constants.APP_VERSION) return '';
      return `Build ${App.constants.APP_VERSION} is running, but config.js still says ${configuredVersion}.`;
    }
  };

  const derive = {
    programId(row) {
      return utils.firstNonEmpty(
        row?.id,
        row?.program_id,
        row?.pledge_program_id,
        row?.program_uuid,
        row?.source_program_id,
        row?.program_pk
      );
    },
    title(row) {
      return utils.firstNonEmpty(row?.title, row?.program_title, row?.program_name, row?.display_title) || 'Untitled';
    },
    nola(row) {
      return utils.firstNonEmpty(row?.nola_code, row?.nola, row?.program_nola, row?.nola_id) || '';
    },
    distributor(row) {
      return utils.firstNonEmpty(
        row?.__resolved_distributor,
        utils.valueFromExactKeys(row, [
          'distributor',
          'distributor_name',
          'distributor_label',
          'program_distributor',
          'program_distributor_name',
          'distributor_clean',
          'source_distributor',
          'syndicator'
        ]),
        utils.valueFromKeyScan(row, /(distributor|syndicator|supplier|source_distributor)/i, /(id|code|count|amount)/i)
      ) || '';
    },
    topicPrimary(row) {
      return utils.firstNonEmpty(
        row?.__resolved_topic_primary,
        utils.valueFromExactKeys(row, [
          'topic_primary',
          'primary_topic',
          'topic',
          'topic_name',
          'subject_primary',
          'category_primary',
          'genre',
          'genre_primary',
          'topic_primary_clean'
        ]),
        utils.valueFromKeyScan(row, /(topic|subject|category|genre)/i, /(secondary|sub|id|code|count)/i)
      ) || '';
    },
    topicSecondary(row) {
      return utils.firstNonEmpty(
        row?.__resolved_topic_secondary,
        utils.valueFromExactKeys(row, [
          'topic_secondary',
          'secondary_topic',
          'subtopic',
          'subject_secondary',
          'category_secondary',
          'topic_secondary_clean'
        ]),
        utils.valueFromKeyScan(row, /(secondary|subtopic|topic_secondary|subject_secondary|category_secondary)/i, /(id|code|count)/i)
      ) || '';
    },
    description(row) { return utils.firstNonEmpty(row?.program_notes, row?.description, row?.notes) || ''; },
    premiumSummary(row) { return utils.firstNonEmpty(row?.premium_summary, row?.premium_notes, row?.premiums) || ''; },
    rightsBegin(row) { return utils.firstNonEmpty(row?.rights_start, row?.rights_begin, row?.rights_start_date) || ''; },
    rightsEnd(row) { return utils.firstNonEmpty(row?.rights_end, row?.rights_end_date) || ''; },
    lengthBucket(row) {
      const value = Number(utils.firstNonEmpty(row?.length_bucket_minutes, row?.board_runtime_minutes, row?.length_minutes));
      return Number.isFinite(value) && value > 0 ? value : null;
    },
    lengthLabel(row) {
      const value = derive.lengthBucket(row);
      return value ? String(value) : '—';
    },
    actualRuntimeLabel(row) {
      return utils.formatSeconds(utils.firstNonEmpty(row?.actual_runtime_seconds));
    },
    avgPerFundraiser(row) {
      const value = Number(utils.firstNonEmpty(
        row?.avg_contribution_per_fundraiser,
        row?.avg_contribution_per_drive,
        row?.average_contribution_per_drive,
        row?.average_dollars_per_fundraiser,
        row?.avg_contribution
      ));
      return Number.isFinite(value) ? value : null;
    },
    lastAiredDisplay(row) {
      return utils.firstNonEmpty(row?.last_aired_display, row?.last_aired_text) || utils.formatDate(row?.last_aired_at, 'N/A');
    },
    isActive(row) {
      if (typeof row?.is_active === 'boolean') return row.is_active;
      const rightsEnd = derive.rightsEnd(row);
      if (!rightsEnd) return true;
      const date = new Date(rightsEnd);
      if (Number.isNaN(date.getTime())) return true;
      return date >= new Date(new Date().toDateString());
    }
  };

  App.utils = utils;
  App.derive = derive;
})();

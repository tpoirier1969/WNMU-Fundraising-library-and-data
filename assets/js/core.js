window.PledgeLib = window.PledgeLib || {};

(() => {
  const App = window.PledgeLib;
  const cfg = window.PLEDGE_MANAGER_CONFIG || {};

  App.cfg = cfg;
  App.constants = {
    APP_NAME: 'WNMU Pledge Program Library',
    APP_VERSION: 'v0.7.0',
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
    configReady: false
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

    normalizeText(value) {
      return String(value ?? '').trim();
    },

    firstNonEmpty(...values) {
      for (const value of values) {
        if (value === 0 || value === false) return value;
        const text = utils.normalizeText(value);
        if (text) return value;
      }
      return null;
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

    buildMismatchNotice() {
      const configuredVersion = utils.normalizeText(cfg.APP_VERSION);
      if (!configuredVersion || configuredVersion === App.constants.APP_VERSION) return '';
      return `Build ${App.constants.APP_VERSION} is running, but config.js still says ${configuredVersion}.`;
    }
  };

  const derive = {
    programId(row) {
      return utils.firstNonEmpty(row?.id, row?.program_id, row?.pledge_program_id, row?.program_uuid);
    },
    title(row) { return utils.firstNonEmpty(row?.title) || 'Untitled'; },
    nola(row) { return utils.firstNonEmpty(row?.nola_code) || ''; },
    distributor(row) { return utils.firstNonEmpty(row?.distributor) || ''; },
    topicPrimary(row) { return utils.firstNonEmpty(row?.topic_primary) || ''; },
    topicSecondary(row) { return utils.firstNonEmpty(row?.topic_secondary) || ''; },
    description(row) { return utils.firstNonEmpty(row?.program_notes, row?.description, row?.notes) || ''; },
    premiumSummary(row) { return utils.firstNonEmpty(row?.premium_summary) || ''; },
    rightsBegin(row) { return utils.firstNonEmpty(row?.rights_start) || ''; },
    rightsEnd(row) { return utils.firstNonEmpty(row?.rights_end) || ''; },
    lengthBucket(row) {
      const value = Number(utils.firstNonEmpty(row?.length_bucket_minutes, row?.board_runtime_minutes));
      return Number.isFinite(value) && value > 0 ? value : null;
    },
    lengthLabel(row) {
      const value = derive.lengthBucket(row);
      return value ? String(value) : '—';
    },
    actualRuntimeLabel(row) {
      return utils.formatSeconds(utils.firstNonEmpty(row?.actual_runtime_seconds));
    },
    lastAiredDisplay(row) {
      return utils.firstNonEmpty(row?.last_aired_display) || 'N/A';
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

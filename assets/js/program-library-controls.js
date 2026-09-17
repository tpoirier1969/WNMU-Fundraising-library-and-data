(() => {
  'use strict';

  const App = window.PledgeLib;
  if (!App?.state || !App?.derive || !App?.utils) return;

  const { state, derive, utils } = App;
  const METRICS = {
    average: { label: 'Avg $ / Pledge Hour', shortLabel: 'Avg $ / Pledge Hour' },
    median: { label: 'Median $ / Pledge Hour', shortLabel: 'Median $ / Pledge Hour' },
    total: { label: 'Total $ Raised', shortLabel: 'Total $ Raised' }
  };
  const FILTER_FIELDS = [
    ['minTotal', 'Min total $', 'Minimum all-time pledge dollars'],
    ['maxTotal', 'Max total $', 'Maximum all-time pledge dollars'],
    ['minAvgPledgeHour', 'Min $ / hr', 'Minimum average dollars per pledge hour'],
    ['minAirDates', 'Min air dates', 'Minimum number of air dates'],
    ['maxAirDates', 'Max air dates', 'Maximum number of air dates']
  ];

  let initialized = false;
  let wrapped = false;
  let applyDepth = 0;
  let medianCacheRows = null;
  let medianCache = new Map();
  let filterTimer = 0;

  state.libraryPerformanceMetric = state.libraryPerformanceMetric || 'average';
  state.libraryNumericFilters = state.libraryNumericFilters || {
    minTotal: '',
    maxTotal: '',
    minAvgPledgeHour: '',
    minAirDates: '',
    maxAirDates: ''
  };

  function text(value) {
    return String(value ?? '').trim();
  }

  function numberOrNull(value) {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function programId(program = {}) {
    return text(App.programLinks?.resolveId?.(program) || derive.programId?.(program) || '');
  }

  function linkedAiringRows(program = {}) {
    const id = programId(program);
    if (!id) return [];
    return (Array.isArray(state.scorecardAiringRows) ? state.scorecardAiringRows : []).filter((row) => {
      const linked = text(utils.firstNonEmpty?.(row?.manual_match_program_id, row?.pledge_program_id, row?.program_id, ''));
      return linked === id;
    });
  }

  function airingDateKey(row = {}) {
    const local = utils.rowLocalDateTime?.(row, { preferDriveFallback: true });
    if (local instanceof Date && !Number.isNaN(local.getTime())) {
      return utils.dateKeyFromDate?.(local) || local.toISOString().slice(0, 10);
    }
    return text(utils.firstNonEmpty?.(row.air_date, row.drive_date, row.drive_start_date, row.aired_at, ''));
  }

  function airDateCount(program = {}) {
    const direct = Number(program?.all_air_dates_count);
    if (Number.isFinite(direct) && direct >= 0) return direct;

    const exactDates = new Set(linkedAiringRows(program).map(airingDateKey).filter(Boolean));
    if (exactDates.size) return exactDates.size;

    const display = text(derive.allAirDatesDisplay?.(program));
    if (display && display !== '—') return display.split(/\s+·\s+/).filter(Boolean).length;

    const fallback = Number(utils.firstNonEmpty?.(
      program?.airing_count,
      program?.aired_count,
      program?.times_aired,
      program?.total_airings,
      program?.fundraiser_count,
      program?.drive_count,
      0
    ));
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
  }

  function fundraiserKey(row = {}) {
    const direct = text(utils.firstNonEmpty?.(
      row.fundraiser_id,
      row.fundraiser_label,
      row.fundraiser_name,
      row.drive_id,
      row.drive_start_date,
      row.fundraiser_start_date,
      row.campaign_start_date,
      ''
    ));
    if (direct) return direct;
    const dateKey = airingDateKey(row);
    return dateKey ? `month:${dateKey.slice(0, 7)}` : '';
  }

  function durationMinutes(program = {}, airing = {}) {
    const seconds = Number(utils.firstNonEmpty?.(program.actual_runtime_seconds, program.runtime_seconds, program.actual_runtime));
    if (Number.isFinite(seconds) && seconds > 0) return seconds / 60;
    const minutes = Number(utils.firstNonEmpty?.(program.actual_runtime_minutes, program.runtime_minutes, program.length_minutes));
    if (Number.isFinite(minutes) && minutes > 0) return minutes;
    const bucket = Number(utils.firstNonEmpty?.(program.length_bucket_minutes, derive.lengthBucket?.(program)));
    if (Number.isFinite(bucket) && bucket > 0) return bucket;
    const imported = Number(airing.program_minutes);
    return Number.isFinite(imported) && imported > 0 ? imported : null;
  }

  function contributionDollars(row = {}) {
    const value = Number(utils.firstNonEmpty?.(
      row.__resolved_contribution_amount,
      row.dollars,
      row.contribution_amount,
      row.total_contributions,
      row.total_dollars,
      row.broadcast_dollars,
      0
    ));
    return Number.isFinite(value) ? value : 0;
  }

  function medianPledgeHour(program = {}) {
    const direct = numberOrNull(utils.firstNonEmpty?.(
      program.__median_dollars_per_pledge_hour,
      program.median_dollars_per_pledge_hour,
      program.median_per_pledge_hour
    ));
    if (direct != null) return direct;

    const currentRows = state.scorecardAiringRows;
    if (medianCacheRows !== currentRows) {
      medianCacheRows = currentRows;
      medianCache = new Map();
    }

    const id = programId(program);
    if (id && medianCache.has(id)) return medianCache.get(id);

    const groups = new Map();
    linkedAiringRows(program).forEach((airing) => {
      const key = fundraiserKey(airing);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(airing);
    });

    const rates = [];
    groups.forEach((airings) => {
      const durations = airings.map((airing) => durationMinutes(program, airing));
      if (!durations.length || durations.some((minutes) => !(Number(minutes) > 0))) return;
      const minutes = durations.reduce((sum, value) => sum + Number(value || 0), 0);
      if (!(minutes > 0)) return;
      const dollars = airings.reduce((sum, airing) => sum + contributionDollars(airing), 0);
      rates.push((dollars * 60) / minutes);
    });

    rates.sort((a, b) => a - b);
    let median = null;
    if (rates.length) {
      const middle = Math.floor(rates.length / 2);
      median = rates.length % 2 ? rates[middle] : (rates[middle - 1] + rates[middle]) / 2;
    }
    if (id) medianCache.set(id, median);
    return median;
  }

  function metricValue(program = {}) {
    if (state.libraryPerformanceMetric === 'total') return numberOrNull(derive.totalRaised?.(program));
    if (state.libraryPerformanceMetric === 'median') return medianPledgeHour(program);
    return numberOrNull(derive.avgPerPledgeHour?.(program));
  }

  function numericFilterValue(name) {
    return numberOrNull(state.libraryNumericFilters?.[name]);
  }

  function matchesNumericFilters(program = {}) {
    const total = numberOrNull(derive.totalRaised?.(program)) ?? 0;
    const avg = numberOrNull(derive.avgPerPledgeHour?.(program));
    const dates = airDateCount(program);
    const minTotal = numericFilterValue('minTotal');
    const maxTotal = numericFilterValue('maxTotal');
    const minAvg = numericFilterValue('minAvgPledgeHour');
    const minDates = numericFilterValue('minAirDates');
    const maxDates = numericFilterValue('maxAirDates');

    if (minTotal != null && total < minTotal) return false;
    if (maxTotal != null && total > maxTotal) return false;
    if (minAvg != null && (avg == null || avg < minAvg)) return false;
    if (minDates != null && dates < minDates) return false;
    if (maxDates != null && dates > maxDates) return false;
    return true;
  }

  function ensureNumericFilters() {
    const row = document.querySelector('[data-workspace-pane="library"] .controls .filter-row');
    if (!row || document.getElementById('library-min-total-filter')) return;
    const focus = document.getElementById('outlook-fundraiser-focus-wrap');
    const fragment = document.createDocumentFragment();
    FILTER_FIELDS.forEach(([key, label, title]) => {
      const wrap = document.createElement('div');
      wrap.className = 'filter-field library-number-filter';
      const id = `library-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}-filter`;
      wrap.innerHTML = `<label class="filter-label" for="${id}">${utils.escapeHtml(label)}</label><input id="${id}" type="number" min="0" step="1" inputmode="decimal" title="${utils.escapeHtml(title)}">`;
      const input = wrap.querySelector('input');
      input.value = state.libraryNumericFilters[key] ?? '';
      input.addEventListener('input', () => {
        state.libraryNumericFilters[key] = input.value;
        window.clearTimeout(filterTimer);
        filterTimer = window.setTimeout(() => App.listUi?.applyLibraryView?.(), 140);
      });
      fragment.append(wrap);
    });
    if (focus?.parentNode === row) row.insertBefore(fragment, focus);
    else row.append(fragment);
  }

  function ensureMetricHeader() {
    const th = document.querySelector('[data-workspace-pane="library"] .programs-table thead th.col-avg');
    if (!th || th.querySelector('#library-performance-metric-select')) return;
    th.innerHTML = `
      <div class="library-metric-header">
        <select id="library-performance-metric-select" aria-label="Performance metric">
          <option value="average">Avg $ / Pledge Hour</option>
          <option value="median">Median $ / Pledge Hour</option>
          <option value="total">Total $ Raised</option>
        </select>
        <button type="button" id="library-performance-metric-sort" aria-label="Sort by selected performance metric"><span class="sort-arrow">↕</span></button>
      </div>`;
    const select = th.querySelector('#library-performance-metric-select');
    const sort = th.querySelector('#library-performance-metric-sort');
    select.value = METRICS[state.libraryPerformanceMetric] ? state.libraryPerformanceMetric : 'average';
    select.addEventListener('change', () => {
      state.libraryPerformanceMetric = METRICS[select.value] ? select.value : 'average';
      if (state.sortField === 'library_performance_metric') App.listUi?.applyLibraryView?.();
      else decorateMetricCells();
      syncMetricHeader();
    });
    sort.addEventListener('click', () => {
      if (state.sortField === 'library_performance_metric') {
        state.sortDirection = state.sortDirection === 'desc' ? 'asc' : 'desc';
      } else {
        state.sortField = 'library_performance_metric';
        state.sortDirection = 'desc';
      }
      App.listUi?.applyLibraryView?.();
    });
  }

  function injectStyles() {
    if (document.getElementById('program-library-controls-style')) return;
    const style = document.createElement('style');
    style.id = 'program-library-controls-style';
    style.textContent = `
      .library-metric-header{display:flex;align-items:center;gap:2px;min-width:150px}
      #library-performance-metric-select{min-width:0;width:100%;border:0;outline:0;background:transparent;color:#fff;font:inherit;font-weight:800;padding:2px 18px 2px 0;cursor:pointer}
      #library-performance-metric-select option{background:#fff;color:#17384a}
      #library-performance-metric-sort{flex:0 0 auto;border:0;background:transparent;color:#fff;padding:3px 2px;border-radius:5px;box-shadow:none}
      #library-performance-metric-sort:hover{transform:none;background:rgba(255,255,255,.12)}
      #library-performance-metric-sort.active{background:rgba(255,255,255,.16)}
      .library-number-filter{min-width:76px}
      .library-number-filter input{text-align:right}
      @media (min-width:981px){
        [data-workspace-pane="library"] .compact-controls .filter-row{display:flex;flex-wrap:wrap;align-items:end;gap:6px}
        [data-workspace-pane="library"] .compact-controls .filter-row>.filter-field:not(.search-grow){flex:0 0 108px;min-width:0}
        [data-workspace-pane="library"] .compact-controls .filter-row>.filter-field.search-grow{flex:1 1 210px;min-width:170px}
        [data-workspace-pane="library"] .compact-controls .filter-row>.filter-actions{flex:0 0 auto}
        [data-workspace-pane="library"] .compact-controls .filter-row>.filter-field.narrow{flex-basis:92px}
        [data-workspace-pane="library"] .compact-controls .filter-row>.library-number-filter{flex-basis:82px}
        [data-workspace-pane="library"] .compact-controls .filter-row>#outlook-fundraiser-focus-wrap{flex-basis:102px}
        [data-workspace-pane="library"] .compact-controls .filter-row input,
        [data-workspace-pane="library"] .compact-controls .filter-row select{padding:7px 7px}
      }
    `;
    document.head.append(style);
  }

  function compareMetricRows(a, b) {
    const aValue = metricValue(a);
    const bValue = metricValue(b);
    if (aValue == null && bValue == null) return utils.compareText(derive.title(a), derive.title(b));
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    const direction = state.sortDirection === 'asc' ? 1 : -1;
    const delta = (aValue - bValue) * direction;
    return delta || utils.compareText(derive.title(a), derive.title(b));
  }

  function reorderMetricRows() {
    if (state.sortField !== 'library_performance_metric') return;
    const rows = [...(state.rows || [])].sort(compareMetricRows);
    state.rows = rows;
    const body = document.getElementById('library-body');
    if (!body) return;
    const byId = new Map([...body.querySelectorAll('tr[data-id]')].map((tr) => [text(tr.dataset.id), tr]));
    rows.forEach((row) => {
      const tr = byId.get(programId(row));
      if (tr) body.append(tr);
    });
  }

  function decorateMetricCells() {
    const body = document.getElementById('library-body');
    if (!body) return;
    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const program = App.programLinks?.resolveRow?.(tr.dataset.id)
        || (state.rows || []).find((row) => programId(row) === text(tr.dataset.id));
      if (!program) return;
      const cell = tr.querySelector('td.avg-cell');
      if (!cell) return;
      const value = metricValue(program);
      cell.textContent = value == null ? '—' : utils.formatMoney(value);
      const label = METRICS[state.libraryPerformanceMetric]?.label || METRICS.average.label;
      cell.title = state.libraryPerformanceMetric === 'median'
        ? `${label} from fundraiser-balanced, rate-valid program history`
        : state.libraryPerformanceMetric === 'average'
          ? `${label} from fundraiser-balanced, rate-valid program history`
          : 'All-time pledge dollars raised by this title';
    });
  }

  function syncMetricHeader() {
    ensureMetricHeader();
    const select = document.getElementById('library-performance-metric-select');
    const sort = document.getElementById('library-performance-metric-sort');
    if (select) select.value = METRICS[state.libraryPerformanceMetric] ? state.libraryPerformanceMetric : 'average';
    if (sort) {
      const active = state.sortField === 'library_performance_metric';
      sort.classList.toggle('active', active);
      sort.setAttribute('aria-pressed', active ? 'true' : 'false');
      const arrow = sort.querySelector('.sort-arrow');
      if (arrow) arrow.textContent = active ? (state.sortDirection === 'desc' ? '↓' : '↑') : '↕';
    }
  }

  function resetNumericFilters() {
    Object.keys(state.libraryNumericFilters || {}).forEach((key) => { state.libraryNumericFilters[key] = ''; });
    FILTER_FIELDS.forEach(([key]) => {
      const id = `library-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}-filter`;
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
  }

  function postRender() {
    if (state.sortField === 'library_performance_metric') reorderMetricRows();
    decorateMetricCells();
    syncMetricHeader();
  }

  function wrapListUi() {
    if (wrapped || !App.listUi?.applyLibraryView) return false;
    const originalApply = App.listUi.applyLibraryView.bind(App.listUi);
    const originalReset = App.listUi.resetFilters?.bind(App.listUi);

    App.listUi.applyLibraryView = (...args) => {
      if (applyDepth > 0) return originalApply(...args);
      applyDepth += 1;
      const originalRows = state.rawRows;
      const metricSort = state.sortField === 'library_performance_metric';
      const requestedSort = state.sortField;
      try {
        state.rawRows = (Array.isArray(originalRows) ? originalRows : []).filter(matchesNumericFilters);
        if (metricSort) state.sortField = 'title';
        return originalApply(...args);
      } finally {
        state.rawRows = originalRows;
        state.sortField = requestedSort;
        applyDepth -= 1;
        window.setTimeout(postRender, 0);
      }
    };

    if (originalReset) {
      App.listUi.resetFilters = (...args) => {
        resetNumericFilters();
        state.libraryPerformanceMetric = 'average';
        return originalReset(...args);
      };
    }

    wrapped = true;
    return true;
  }

  function initialize() {
    if (initialized) return;
    if (!App.listUi?.applyLibraryView) {
      window.setTimeout(initialize, 30);
      return;
    }
    initialized = true;
    injectStyles();
    ensureNumericFilters();
    ensureMetricHeader();
    wrapListUi();
    syncMetricHeader();
    window.setTimeout(() => App.listUi?.applyLibraryView?.(), 0);

    document.addEventListener('pledge-scorecard-airings-ready', () => {
      medianCacheRows = null;
      medianCache.clear();
      App.listUi?.applyLibraryView?.();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();

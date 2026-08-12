(() => {
  'use strict';

  const App = window.PledgeLib;
  if (!App) return;

  const { state, utils, derive } = App;
  const RESULT_CACHE_MS = 5000;
  let resultRows = [];
  let resultRowsLoadedAt = 0;
  let resultRowsPromise = null;
  let observer = null;
  let scheduledFrame = 0;

  function normalizeId(value = '') {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeNola(value = '') {
    if (typeof utils.nolaCodeKey === 'function') return utils.nolaCodeKey(value);
    return utils.normalizeText(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function importedDateKey(row = {}) {
    return utils.normalizeText(row.air_date) || utils.dateKeyFromDate(row.aired_at) || '';
  }

  function importedStartMinutes(row = {}) {
    const time = utils.normalizeText(row.air_time || '');
    if (/^\d{1,2}:\d{2}/.test(time)) {
      const [hours, minutes] = time.split(':').map(Number);
      if (Number.isFinite(hours) && Number.isFinite(minutes)) return (hours * 60) + minutes;
    }
    const airedAt = new Date(row.aired_at || '');
    if (!Number.isNaN(airedAt.getTime())) return (airedAt.getHours() * 60) + airedAt.getMinutes();
    return null;
  }

  function activeSchedule() {
    const wanted = String(state.activeScheduleId || '');
    return (state.schedules || []).find((schedule) => String(schedule?.id || '') === wanted) || null;
  }

  function placementById(schedule, placementId) {
    return (schedule?.placements || []).find((placement) => String(placement?.id || '') === String(placementId || '')) || null;
  }

  function programRowForPlacement(placement = {}) {
    const directId = String(placement.programId || '').trim();
    if (!directId) return null;
    return (state.rawRows || []).find((row) => String(derive.programId(row) || '').trim() === directId) || null;
  }

  function exactSlotRows(dateKey, startMinutes) {
    return resultRows.filter((row) => importedDateKey(row) === dateKey && importedStartMinutes(row) === startMinutes);
  }

  function uniqueMatch(rows, predicate) {
    const matches = rows.filter(predicate);
    return matches.length === 1 ? matches[0] : null;
  }

  function resultForPlacement(placement, dateKey, startMinutes) {
    if (!placement || placement.isNonPledge || !dateKey || !Number.isFinite(Number(startMinutes))) return null;
    const slotRows = exactSlotRows(dateKey, Number(startMinutes));
    if (!slotRows.length) return null;

    const sourceHash = String(placement.sourceAiringHash || '').trim();
    if (sourceHash) {
      const direct = uniqueMatch(slotRows, (row) => String(row?.row_hash || '').trim() === sourceHash);
      if (direct) return direct;
    }

    const programRow = programRowForPlacement(placement);
    const programId = normalizeId(placement.programId || derive.programId(programRow) || '');
    if (programId) {
      const byProgramId = uniqueMatch(slotRows, (row) => normalizeId(row?.program_id || row?.pledge_program_id || '') === programId);
      if (byProgramId) return byProgramId;
    }

    const nola = normalizeNola(derive.nola(programRow) || placement.nolaCode || placement.nola || '');
    if (nola) {
      const byNola = uniqueMatch(slotRows, (row) => normalizeNola(row?.nola_code || row?.nola || row?.program_nola || '') === nola);
      if (byNola) return byNola;
    }

    const titleKey = utils.normalizeLookupKey(placement.programTitle || derive.title(programRow) || '');
    if (titleKey) {
      return uniqueMatch(slotRows, (row) => utils.normalizeLookupKey(
        row?.matched_library_title || row?.program_title || row?.title || row?.imported_program_title || ''
      ) === titleKey);
    }

    return null;
  }

  function compactMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '';
    const sign = amount < 0 ? '-' : '';
    const absolute = Math.abs(amount);
    if (absolute >= 1000000) {
      const digits = absolute < 10000000 ? 1 : 0;
      return `${sign}$${(absolute / 1000000).toFixed(digits).replace(/\.0$/, '')}m`;
    }
    if (absolute >= 1000) {
      const digits = absolute < 10000 ? 1 : 0;
      return `${sign}$${(absolute / 1000).toFixed(digits).replace(/\.0$/, '')}k`;
    }
    return `${sign}$${Math.round(absolute).toLocaleString()}`;
  }

  function fullMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '';
    return utils.formatMoney ? utils.formatMoney(amount) : `$${amount.toLocaleString()}`;
  }

  function stampText(value, placement = {}) {
    const length = Number(placement.lengthMinutes || 0);
    if (length > 30) return fullMoney(value);
    return compactMoney(value);
  }

  function decoratePlacement(node, schedule) {
    const placementId = node.dataset.placementId || '';
    const dateKey = node.dataset.dateKey || '';
    const startMinutes = Number(node.dataset.startMinutes);
    const placement = placementById(schedule, placementId);
    const existing = node.querySelector(':scope > .schedule-broadcast-dollar-stamp');

    if (!placement || !dateKey || !Number.isFinite(startMinutes)) {
      existing?.remove();
      return;
    }

    const result = resultForPlacement(placement, dateKey, startMinutes);
    const amount = Number(result?.dollars);
    if (!result || !Number.isFinite(amount)) {
      existing?.remove();
      return;
    }

    const length = Number(placement.lengthMinutes || 0);
    const text = stampText(amount, placement);
    const full = fullMoney(amount);
    const titleText = placement.programTitle || 'Program';
    node.title = `${titleText} · Broadcast result: ${full}`;

    const stamp = existing || document.createElement('span');
    stamp.className = `schedule-broadcast-dollar-stamp${length <= 30 ? ' compact' : ''}${length <= 15 ? ' tiny' : ''}`;
    if (stamp.textContent !== text) stamp.textContent = text;
    stamp.setAttribute('aria-label', `Broadcast result ${full}`);
    stamp.dataset.resultRowHash = String(result.row_hash || '');
    if (!existing) node.append(stamp);
  }

  function decorateGrid() {
    scheduledFrame = 0;
    const grid = document.getElementById('schedule-grid');
    const schedule = activeSchedule();
    if (!grid || !schedule) return;
    grid.querySelectorAll('.schedule-placement[data-placement-id][data-date-key][data-start-minutes]').forEach((node) => {
      decoratePlacement(node, schedule);
    });
  }

  function scheduleDecorate() {
    if (scheduledFrame) return;
    scheduledFrame = window.requestAnimationFrame(decorateGrid);
  }

  async function loadResults(force = false) {
    const now = Date.now();
    if (!force && resultRowsLoadedAt && (now - resultRowsLoadedAt) < RESULT_CACHE_MS) return resultRows;
    if (resultRowsPromise) return resultRowsPromise;
    resultRowsPromise = Promise.resolve()
      .then(() => App.data?.fetchImportedAirings?.())
      .then((rows) => {
        resultRows = Array.isArray(rows) ? rows : [];
        resultRowsLoadedAt = Date.now();
        return resultRows;
      })
      .catch((error) => {
        console.warn('Schedule broadcast result stamps could not load imported results.', error);
        return resultRows;
      })
      .finally(() => {
        resultRowsPromise = null;
      });
    return resultRowsPromise;
  }

  async function refresh(force = false) {
    await loadResults(force);
    scheduleDecorate();
  }

  function observeGrid() {
    const grid = document.getElementById('schedule-grid');
    if (!grid) return;
    observer?.disconnect();
    observer = new MutationObserver(() => {
      void loadResults(false).then(scheduleDecorate);
    });
    observer.observe(grid, { childList: true, subtree: true });
  }

  function bindWorkspaceRefresh() {
    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-workspace-target="scheduling"], [data-workspace-tab="scheduling"], [data-workspace="scheduling"]');
      if (!target) return;
      window.setTimeout(() => { void refresh(true); }, 0);
    });
  }

  function init() {
    observeGrid();
    bindWorkspaceRefresh();
    void refresh(true);
  }

  App.scheduleResultsUi = { refresh };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

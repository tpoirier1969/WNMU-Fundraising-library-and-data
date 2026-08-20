(() => {
  const App = window.PledgeLib;
  const { state, constants, utils, derive } = App;
  const { els, setNotice } = App.dom;

  const RESULT_CACHE_MS = 5000;
  let scheduleResultRows = [];
  let scheduleResultRowsLoadedAt = 0;
  let scheduleResultRowsPromise = null;
  let scheduleResultObserver = null;
  let scheduleResultFrame = 0;

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
    return scheduleResultRows.filter((row) => importedDateKey(row) === dateKey && importedStartMinutes(row) === startMinutes);
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
    return length > 30 ? fullMoney(value) : compactMoney(value);
  }

  function decorateSchedulePlacement(node, schedule) {
    const placementId = node.dataset.placementId || '';
    const dateKey = node.dataset.dateKey || '';
    const startMinutes = Number(node.dataset.minutes);
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

  function decorateScheduleGrid() {
    scheduleResultFrame = 0;
    const grid = document.getElementById('schedule-grid');
    const schedule = activeSchedule();
    if (!grid || !schedule) return;
    grid.querySelectorAll('.schedule-placement[data-placement-id][data-date-key][data-minutes]').forEach((node) => {
      decorateSchedulePlacement(node, schedule);
    });
  }

  function scheduleResultDecoration() {
    if (scheduleResultFrame) return;
    scheduleResultFrame = window.requestAnimationFrame(decorateScheduleGrid);
  }

  async function loadScheduleResults(force = false) {
    const now = Date.now();
    if (!force && scheduleResultRowsLoadedAt && (now - scheduleResultRowsLoadedAt) < RESULT_CACHE_MS) return scheduleResultRows;
    if (scheduleResultRowsPromise) return scheduleResultRowsPromise;
    scheduleResultRowsPromise = Promise.resolve()
      .then(() => App.data?.fetchImportedAirings?.())
      .then((rows) => {
        scheduleResultRows = Array.isArray(rows) ? rows : [];
        scheduleResultRowsLoadedAt = Date.now();
        return scheduleResultRows;
      })
      .catch((error) => {
        console.warn('Schedule broadcast result stamps could not load imported results.', error);
        return scheduleResultRows;
      })
      .finally(() => {
        scheduleResultRowsPromise = null;
      });
    return scheduleResultRowsPromise;
  }

  async function refreshScheduleBroadcastResults(force = false) {
    await loadScheduleResults(force);
    scheduleResultDecoration();
  }

  function observeScheduleGrid() {
    const grid = document.getElementById('schedule-grid');
    if (!grid) return;
    scheduleResultObserver?.disconnect();
    scheduleResultObserver = new MutationObserver(() => {
      void loadScheduleResults(false).then(scheduleResultDecoration);
    });
    scheduleResultObserver.observe(grid, { childList: true, subtree: true });
  }

  function initScheduleBroadcastResults() {
    observeScheduleGrid();
    if (state.activeWorkspace === 'scheduling') void refreshScheduleBroadcastResults(true);
  }

  function workspaceById(id) {
    return constants.WORKSPACES.find((workspace) => workspace.id === id) || constants.WORKSPACES[0];
  }

  function setWorkspace(workspaceId) {
    const workspace = workspaceById(workspaceId);
    if (workspace.adminOnly && !App.auth?.canEdit?.()) {
      setNotice(`${workspace.label} is available to Admin users only.`);
      return;
    }
    state.activeWorkspace = workspace.id;
    App.auth?.updatePresenceWorkspace?.(workspace.id);

    els.workspaceButtons.forEach((button) => {
      const active = button.dataset.workspaceButton === workspace.id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    els.workspacePanes.forEach((pane) => {
      pane.classList.toggle('hidden', pane.dataset.workspacePane !== workspace.id);
    });

    if (workspace.id === 'scheduling') {
      const ready = App.schedulingUi?.ensureReady?.();
      void Promise.resolve(ready)
        .catch(() => null)
        .then(() => refreshScheduleBroadcastResults(true));
    }
    if (workspace.id === 'imports') void App.importsUi?.ensureReady();
    if (workspace.id === 'performance') void App.analyticsUi?.ensureReady();
    if (workspace.id === 'comparison') void App.fundraiserComparisonUi?.ensureReady();
  }

  function refreshScaffoldSummary() {
    if (els.scaffoldLibraryCount) els.scaffoldLibraryCount.textContent = utils.formatCount(state.rawRows.length);
    if (els.scaffoldTopicGapCount) els.scaffoldTopicGapCount.textContent = utils.formatCount(state.fieldAudit.missingTopicCount);
    if (els.scaffoldDistributorGapCount) els.scaffoldDistributorGapCount.textContent = utils.formatCount(state.fieldAudit.missingDistributorCount);
  }

  function handlePlaceholderAction(button) {
    const workspaceId = button.dataset.workspaceLaunch || 'library';
    const feature = button.dataset.workspaceFeature || 'This feature';
    setWorkspace(workspaceId);
    if (workspaceId === 'library') {
      setNotice(`${feature} is live in the Library workspace.`);
      return;
    }
    setNotice(`${feature} has a scaffolded home in ${workspaceById(workspaceId).label}.`);
  }

  function bindEvents() {
    els.workspaceButtons.forEach((button) => {
      button.addEventListener('click', () => setWorkspace(button.dataset.workspaceButton));
    });

    document.querySelectorAll('[data-workspace-launch]').forEach((button) => {
      button.addEventListener('click', () => handlePlaceholderAction(button));
    });
  }

  App.scheduleResultsUi = { refresh: refreshScheduleBroadcastResults };
  App.workspaceUi = {
    setWorkspace,
    refreshScaffoldSummary,
    bindEvents
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initScheduleBroadcastResults, { once: true });
  else initScheduleBroadcastResults();
})();

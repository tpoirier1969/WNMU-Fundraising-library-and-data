(() => {
  'use strict';

  const APP_VERSION = 'v0.22.55';
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const fetchedAt = new Map();
  const partialIds = new Set();
  const backgroundIds = new Set();
  let initialized = false;
  let patched = false;

  const app = () => window.PledgeLib;
  const text = (value) => String(value ?? '').trim();

  function seedQueryHints() {
    const App = app();
    if (!App?.state || !App?.constants) return;
    App.state.detailQueryHints = App.state.detailQueryHints || {};
    App.state.detailQueryHints[App.constants.TIMING_TABLE] = { field: 'program_id', orderField: 'segment_number' };
    App.state.detailQueryHints[App.constants.DRIVE_RESULTS_TABLE] = { field: 'program_id', orderField: 'drive_date' };
    App.state.detailQueryHints[App.constants.AIRINGS_TABLE] = { field: 'program_id', orderField: 'aired_at' };
  }

  function snapshotFor(programId) {
    const App = app();
    return App?.data?.resolveProgramSnapshot?.(programId)
      || App?.programLinks?.resolveRow?.(programId)
      || null;
  }

  function databaseProgramId(programId, snapshot = null) {
    const App = app();
    const row = snapshot || snapshotFor(programId) || {};
    return text(App?.utils?.firstNonEmpty?.(row.id, row.program_id, row.pledge_program_id, programId) || programId);
  }

  function sortTimings(rows = []) {
    return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
      const aNumber = Number(a?.segment_number ?? a?.slot_number ?? a?.source_row_number ?? 0);
      const bNumber = Number(b?.segment_number ?? b?.slot_number ?? b?.source_row_number ?? 0);
      return aNumber - bNumber;
    });
  }

  async function fetchDirectTimings(programId) {
    const App = app();
    const snapshot = snapshotFor(programId);
    const resolvedId = databaseProgramId(programId, snapshot);
    if (!App?.state?.client || !snapshot || !resolvedId || resolvedId.startsWith('lookup:')) return null;

    const response = await App.state.client
      .from(App.constants.TIMING_TABLE)
      .select('*')
      .eq('program_id', resolvedId);

    if (response.error) {
      const message = String(response.error.message || response.error || '');
      if (!/column .* does not exist|schema cache/i.test(message)) console.warn('Fast timing lookup failed; using the full legacy lookup.', response.error);
      return null;
    }

    const timings = sortTimings(response.data || []);
    if (!timings.length) return null;
    return {
      program: snapshot,
      timings,
      driveResults: [],
      airings: [],
      warnings: [],
      __timingFastPartial: true
    };
  }

  function showTimingLoading(programId, slow = false) {
    const App = app();
    if (text(App?.state?.selectedProgramId) !== text(programId)) return;
    const count = document.getElementById('timing-count-chip');
    const list = document.getElementById('timing-list');
    if (count) count.textContent = slow ? 'Still loading…' : 'Loading…';
    if (list) {
      list.innerHTML = `<div class="timing-card"><strong>${slow ? 'Still loading break timings…' : 'Loading break timings…'}</strong><div class="muted">This is a loading state, not an indication that the program has no timing rows.</div></div>`;
    }
  }

  function showRemainingLoading(programId) {
    const App = app();
    if (text(App?.state?.selectedProgramId) !== text(programId) || !partialIds.has(text(programId))) return;
    const airingCount = document.getElementById('airing-count-chip');
    const airingList = document.getElementById('airing-list');
    const graph = document.getElementById('detail-performance-graph');
    const subtitle = document.getElementById('detail-subtitle');
    if (airingCount) airingCount.textContent = 'Loading…';
    if (airingList) airingList.innerHTML = '<div class="premium-card"><strong>Loading air dates and contribution results…</strong><div class="muted">Break timings are already available above.</div></div>';
    if (graph) graph.innerHTML = '<div class="premium-card">Loading income results…</div>';
    if (subtitle) subtitle.textContent = 'Break timings loaded. Finishing air dates and contribution results…';
  }

  function detailVisibleFor(programId) {
    const App = app();
    const modal = document.getElementById('detail-modal');
    return text(App?.state?.selectedProgramId) === text(programId)
      && modal
      && !modal.classList.contains('hidden');
  }

  function refreshCompletedDetail(programId) {
    const App = app();
    const id = text(programId);
    if (!id || !detailVisibleFor(id) || App?.state?.detailDirty || App?.state?.detailSaveInProgress) return;
    const preserveMode = Boolean(App.state.detailEditMode && App.auth?.canEdit?.());
    window.setTimeout(() => {
      if (!detailVisibleFor(id) || App.state.detailDirty || App.state.detailSaveInProgress) return;
      void App.detailUi.loadProgramDetail(id, { preserveMode, force: true, __timingBackgroundRefresh: true });
    }, 0);
  }

  function patchDataFetch() {
    const App = app();
    if (!App?.data?.fetchProgramDetail || App.data.fetchProgramDetail.__timingFastWrapped) return;
    const originalFetch = App.data.fetchProgramDetail.bind(App.data);

    const wrappedFetch = async (programId, options = {}) => {
      const id = text(programId);
      if (!id) return originalFetch(programId, options);
      seedQueryHints();

      const cached = App.state.detailCache?.[id] || null;
      const age = Date.now() - Number(fetchedAt.get(id) || 0);
      const forceFresh = options.forceFresh === true;
      if (!forceFresh && cached && !cached.__timingFastPartial && (!fetchedAt.has(id) || age < CACHE_TTL_MS)) return cached;

      const fullPromise = originalFetch(id, { ...options, useCache: !forceFresh })
        .then((detail) => {
          if (detail) {
            fetchedAt.set(id, Date.now());
            partialIds.delete(id);
          }
          return detail;
        });

      if (options.__timingBackgroundRefresh || forceFresh) return fullPromise;

      const fastPromise = fetchDirectTimings(id);
      const winner = await Promise.race([
        fullPromise.then((detail) => ({ type: 'full', detail })),
        fastPromise.then((detail) => ({ type: detail ? 'fast' : 'none', detail }))
      ]);

      if (winner.type === 'full') return winner.detail;
      if (winner.type === 'none') return fullPromise;

      partialIds.add(id);
      if (!backgroundIds.has(id)) {
        backgroundIds.add(id);
        fullPromise
          .then(() => refreshCompletedDetail(id))
          .catch((error) => console.warn('Full program detail refresh failed after fast timing display.', error))
          .finally(() => backgroundIds.delete(id));
      }
      return winner.detail;
    };

    wrappedFetch.__timingFastWrapped = true;
    App.data.fetchProgramDetail = wrappedFetch;
  }

  function patchDetailLoad() {
    const App = app();
    if (!App?.detailUi?.loadProgramDetail || App.detailUi.loadProgramDetail.__timingFastWrapped) return;
    const originalLoad = App.detailUi.loadProgramDetail.bind(App.detailUi);

    const wrappedLoad = async (programId, options = {}) => {
      const id = text(programId);
      const cached = Boolean(App.state.detailCache?.[id] && !App.state.detailCache[id].__timingFastPartial);
      let slowTimer = 0;
      if (!cached && !options.__timingBackgroundRefresh) {
        showTimingLoading(id, false);
        slowTimer = window.setTimeout(() => showTimingLoading(id, true), 850);
      }
      try {
        const result = await originalLoad(programId, options);
        if (partialIds.has(id)) window.setTimeout(() => showRemainingLoading(id), 0);
        return result;
      } finally {
        window.clearTimeout(slowTimer);
      }
    };

    wrappedLoad.__timingFastWrapped = true;
    App.detailUi.loadProgramDetail = wrappedLoad;
  }

  function patchWorkflows() {
    if (patched) return;
    patchDataFetch();
    patchDetailLoad();
    patched = true;
  }

  function initialize() {
    if (initialized) return;
    const App = app();
    if (!App?.data?.fetchProgramDetail || !App?.detailUi?.loadProgramDetail || !App?.state?.client) {
      window.setTimeout(initialize, 30);
      return;
    }
    initialized = true;
    App.constants.APP_VERSION = APP_VERSION;
    seedQueryHints();
    patchWorkflows();
  }

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();

(() => {
  'use strict';

  const App = window.PledgeLib;
  if (!App?.data?.refreshAiringHistory) return;

  const { state, utils, derive } = App;
  const originalRefreshAiringHistory = App.data.refreshAiringHistory.bind(App.data);

  function text(value) {
    return utils.normalizeText(value || '');
  }

  function validLibraryProgramIds() {
    const ids = new Set();
    [...(state.baseRows || []), ...(state.rawRows || [])].forEach((row) => {
      const id = text(derive.programId(row));
      if (id) ids.add(id);
    });
    return ids;
  }

  function explicitLinkedProgramId(row = {}, validIds = null) {
    const candidates = [
      row.manual_match_program_id,
      row.pledge_program_id,
      row.program_id
    ].map(text).filter(Boolean);

    if (!candidates.length) return '';
    if (!(validIds instanceof Set) || !validIds.size) return candidates[0];
    return candidates.find((candidate) => validIds.has(candidate)) || '';
  }

  function stripFallbackIdentity(row = {}) {
    return {
      ...row,
      // pledge_program_airings_v2.id is the AIRING RECORD primary key. It is
      // never a pledge-program id and must never participate in program linkage.
      id: null,
      matched_library_title: '',
      imported_program_title: '',
      program_title: '',
      title: '',
      name: '',
      nola_code: '',
      nola: '',
      program_nola: ''
    };
  }

  function sanitizeAiringForLibraryHistory(row = {}, validIds = validLibraryProgramIds()) {
    const linkedProgramId = explicitLinkedProgramId(row, validIds);
    const sanitized = stripFallbackIdentity(row);

    if (!linkedProgramId) {
      // Unlinked/quarantined report rows must not become program history merely
      // because a title, NOLA, or numeric airing-row id happens to resemble a
      // library record. They begin contributing only after an explicit link.
      sanitized.program_id = null;
      sanitized.pledge_program_id = null;
      sanitized.manual_match_program_id = null;
      return sanitized;
    }

    // Use one canonical, explicit program identity for library-history enrichment.
    // Manual links are authoritative when present; otherwise the stored linkage is
    // preserved. Title/NOLA fallbacks are intentionally blanked above so a linked
    // row cannot also leak into a different title through a stale imported label.
    sanitized.program_id = linkedProgramId;
    sanitized.pledge_program_id = linkedProgramId;
    sanitized.manual_match_program_id = linkedProgramId;
    return sanitized;
  }

  function sanitizeAiringsForLibraryHistory(rows = []) {
    const validIds = validLibraryProgramIds();
    return (Array.isArray(rows) ? rows : []).map((row) => sanitizeAiringForLibraryHistory(row, validIds));
  }

  async function refreshAiringHistorySafely() {
    const existingCache = state.scheduleImportedAiringsCache;
    const sourceRows = Array.isArray(existingCache)
      ? existingCache
      : await App.data.fetchImportedAirings();
    const safeRows = sanitizeAiringsForLibraryHistory(sourceRows);

    // The original enrichment routine is well-tested and also computes pledge-hour
    // metrics. Feed it a safe, short-lived cache instead of duplicating that logic.
    // Call it before restoring the cache: when a cache exists, its history indexing
    // is synchronous and the returned Promise is already based on safeRows.
    let refreshPromise;
    state.scheduleImportedAiringsCache = safeRows;
    try {
      refreshPromise = originalRefreshAiringHistory();
    } finally {
      state.scheduleImportedAiringsCache = existingCache;
    }
    return await refreshPromise;
  }

  App.data.refreshAiringHistory = refreshAiringHistorySafely;
  App.airingLinkIntegrity = {
    explicitLinkedProgramId,
    sanitizeAiringForLibraryHistory,
    sanitizeAiringsForLibraryHistory
  };
})();

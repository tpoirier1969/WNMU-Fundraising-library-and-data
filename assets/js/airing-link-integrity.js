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

  function isValidProgramId(programId, validIds = null) {
    const id = text(programId);
    if (!id) return false;
    if (!(validIds instanceof Set) || !validIds.size) return true;
    return validIds.has(id);
  }

  function explicitLinkedProgramId(row = {}, validIds = null) {
    const manual = text(row.manual_match_program_id);
    const pledge = text(row.pledge_program_id);
    const program = text(row.program_id);

    // A manual match is an explicit human decision. If it points to a valid
    // library row, it wins. If it points nowhere, quarantine the airing instead
    // of silently falling back to a different stored id.
    if (manual) return isValidProgramId(manual, validIds) ? manual : '';

    // The two machine linkage fields are expected to agree. Never guess when
    // both are populated but disagree: a conflict is a data-integrity problem.
    if (pledge && program && pledge !== program) return '';

    const candidate = pledge || program;
    return isValidProgramId(candidate, validIds) ? candidate : '';
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
      // Unlinked, stale, or conflicting report rows must not become program
      // history merely because a title, NOLA, or numeric airing-row id happens
      // to resemble a library record. They begin contributing only after a
      // trustworthy explicit link exists.
      sanitized.program_id = null;
      sanitized.pledge_program_id = null;
      sanitized.manual_match_program_id = null;
      return sanitized;
    }

    // Use one canonical, explicit program identity for library-history enrichment.
    // Title/NOLA fallbacks are intentionally blanked above so a linked row cannot
    // also leak into a different title through a stale imported label.
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

    // Reuse the same sanitized history for scorecard rules. This adds no database
    // request and guarantees editorial-override evidence can never use the airing
    // row primary key or stale title/NOLA fallbacks as program identity.
    state.scorecardAiringRows = safeRows;
    if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
      document.dispatchEvent(new CustomEvent('pledge-scorecard-airings-ready'));
    }

    // The original enrichment routine also computes pledge-hour metrics. Feed it
    // a safe, short-lived cache instead of duplicating that logic. The original
    // routine consumes an existing cache synchronously before its Promise returns,
    // so the shared scheduler cache can be restored immediately and never mutated.
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

/* Startup guard: an expired/stale Supabase auth session must never prevent the
   public Program Library from loading. app-init used to display the database
   probe message before awaiting getSession(), which made an auth lock look like
   a database hang. Bound the auth check and recover with a clean anonymous client
   if it stalls; the user can sign in again after the library is available. */
(() => {
  'use strict';

  const App = window.PledgeLib;
  if (!App?.auth?.initAuthRole || !App?.data?.createClient || !App?.state) return;

  const originalInitAuthRole = App.auth.initAuthRole.bind(App.auth);
  const AUTH_STARTUP_TIMEOUT_MS = 4500;

  function clearStoredSupabaseSession() {
    try {
      const ref = new URL(App.cfg?.SUPABASE_URL || '').hostname.split('.')[0];
      if (!ref) return;
      const prefix = `sb-${ref}-auth-token`;
      const keys = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key && key.startsWith(prefix)) keys.push(key);
      }
      keys.forEach((key) => window.localStorage.removeItem(key));
    } catch (error) {
      console.warn('Could not clear a stalled Supabase session from browser storage.', error);
    }
  }

  function setViewerState() {
    App.state.session = null;
    App.state.userEmail = null;
    App.state.isAdmin = false;
    App.auth.setRoleUi?.();
  }

  function createCleanClient() {
    const previousClient = App.state.client;
    App.state.client = null;
    try {
      return App.data.createClient();
    } catch (error) {
      App.state.client = previousClient;
      throw error;
    }
  }

  App.auth.initAuthRole = async function initAuthRoleWithStartupGuard() {
    App.dom?.setNotice?.('Connected. Checking sign-in session…');

    let timeoutId = 0;
    const authAttempt = Promise.resolve().then(() => originalInitAuthRole());
    const outcome = await Promise.race([
      authAttempt.then(() => ({ status: 'ready' })).catch((error) => ({ status: 'error', error })),
      new Promise((resolve) => {
        timeoutId = window.setTimeout(() => resolve({ status: 'timeout' }), AUTH_STARTUP_TIMEOUT_MS);
      })
    ]);
    window.clearTimeout(timeoutId);

    if (outcome.status === 'ready') return;

    if (outcome.status === 'error') {
      console.warn('Auth startup check failed; continuing viewer-only.', outcome.error);
      setViewerState();
      return;
    }

    console.warn('Auth startup check timed out; clearing the stalled session and continuing viewer-only.');
    clearStoredSupabaseSession();
    setViewerState();
    try {
      createCleanClient();
    } catch (error) {
      console.warn('Could not recreate the Supabase client after auth timeout.', error);
    }

    // The original auth promise may eventually resolve. Do not await it here:
    // startup must continue. A later auth-state event or manual sign-in can
    // restore the admin role normally.
    void authAttempt.catch(() => {});
  };
})();

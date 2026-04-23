(() => {
  const App = window.PledgeLib;
  if (!App) return;

  const { state, constants, utils } = App;
  const { els, setNotice, setBuildMeta, setUpdateBanner, setDetailNotice } = App.dom;
  const HOTFIX_VERSION = 'v0.21.32';
  const HOTFIX_NOTE = 'Hotfix v0.21.32: existing-program detail edits are forced into update mode, not create mode.';
  let versionCheckTimer = 0;
  let detailSaveHotfixInstalled = false;
  let detailCreateGuardInstalled = false;
  let detailCreateModeValue = Boolean(state.detailCreateMode);
  let duplicateNoticeRepairTimer = 0;

  function cleanVersion(value = '') {
    return String(value || '').trim().replace(/^v/i, '');
  }

  function compareVersions(a = '', b = '') {
    const aParts = cleanVersion(a).split(/[^0-9]+/).map((part) => Number(part || 0));
    const bParts = cleanVersion(b).split(/[^0-9]+/).map((part) => Number(part || 0));
    const length = Math.max(aParts.length, bParts.length);
    for (let index = 0; index < length; index += 1) {
      const aValue = Number.isFinite(aParts[index]) ? aParts[index] : 0;
      const bValue = Number.isFinite(bParts[index]) ? bParts[index] : 0;
      if (aValue > bValue) return 1;
      if (aValue < bValue) return -1;
    }
    return 0;
  }

  function applyHotfixUiNote() {
    if (els.versionFlag) els.versionFlag.textContent = HOTFIX_VERSION;
    if (typeof document !== 'undefined') {
      document.title = String(document.title || constants.APP_NAME || 'WNMU Pledge Program Library')
        .replace(/v\d+\.\d+\.\d+/i, HOTFIX_VERSION);
    }
    if (!state.configVersionMismatch) setBuildMeta(HOTFIX_NOTE);
  }

  function detailHeadingSuggestsCreate() {
    const heading = String(els.detailFormHeading?.textContent || '').trim();
    return /new\s+program/i.test(heading);
  }

  function hasExistingDetailIdentity() {
    const current = state.currentDetailProgram || {};
    return Boolean(utils.firstNonEmpty(
      current?.id,
      current?.program_id,
      current?.pledge_program_id,
      current?.program_uuid,
      current?.uuid,
      current?.__synthetic_program_id,
      state.selectedProgramId
    ));
  }

  function shouldForceExistingUpdateMode() {
    return Boolean(state.detailEditMode && hasExistingDetailIdentity() && !detailHeadingSuggestsCreate());
  }

  function isDuplicateCreateWarning(text = '') {
    const normalized = String(text || '').toLowerCase();
    return normalized.includes('already exists') || normalized.includes('duplicate title record') || normalized.includes('nola is king');
  }

  function suppressExistingDuplicateWarnings() {
    if (!shouldForceExistingUpdateMode()) return;
    if (state.detailCreateMode) detailCreateModeValue = false;
    if (els.detailNotice && isDuplicateCreateWarning(els.detailNotice.textContent || '')) {
      setDetailNotice('');
    }
  }

  function scheduleDuplicateWarningRepair() {
    window.clearTimeout(duplicateNoticeRepairTimer);
    duplicateNoticeRepairTimer = window.setTimeout(() => {
      if (shouldForceExistingUpdateMode()) {
        detailCreateModeValue = false;
        suppressExistingDuplicateWarnings();
      }
    }, 0);
  }

  function forceExistingDetailIntoUpdateMode() {
    if (!shouldForceExistingUpdateMode()) return;
    detailCreateModeValue = false;
    suppressExistingDuplicateWarnings();
  }

  function installDetailCreateGuard() {
    if (detailCreateGuardInstalled) return;
    detailCreateModeValue = Boolean(state.detailCreateMode);

    Object.defineProperty(state, 'detailCreateMode', {
      configurable: true,
      enumerable: true,
      get() {
        return detailCreateModeValue;
      },
      set(nextValue) {
        const requested = Boolean(nextValue);
        if (requested && shouldForceExistingUpdateMode()) {
          detailCreateModeValue = false;
          scheduleDuplicateWarningRepair();
          return;
        }
        detailCreateModeValue = requested;
        scheduleDuplicateWarningRepair();
      }
    });

    detailCreateGuardInstalled = true;
    scheduleDuplicateWarningRepair();
  }

  function installDetailSaveHotfix() {
    if (detailSaveHotfixInstalled) return;
    if (!App.detailUi || typeof App.detailUi.saveDetailEdit !== 'function') return;

    const originalSaveDetailEdit = App.detailUi.saveDetailEdit.bind(App.detailUi);
    App.detailUi.saveDetailEdit = async function patchedSaveDetailEdit(event) {
      forceExistingDetailIntoUpdateMode();
      return originalSaveDetailEdit(event);
    };

    if (typeof App.detailUi.setDetailMode === 'function') {
      const originalSetDetailMode = App.detailUi.setDetailMode.bind(App.detailUi);
      App.detailUi.setDetailMode = function patchedSetDetailMode(mode, ...args) {
        const result = originalSetDetailMode(mode, ...args);
        if (mode === 'edit') window.setTimeout(forceExistingDetailIntoUpdateMode, 0);
        return result;
      };
    }

    if (typeof App.detailUi.openCreateProgram === 'function') {
      const originalOpenCreateProgram = App.detailUi.openCreateProgram.bind(App.detailUi);
      App.detailUi.openCreateProgram = function patchedOpenCreateProgram(...args) {
        detailCreateModeValue = true;
        return originalOpenCreateProgram(...args);
      };
    }

    detailSaveHotfixInstalled = true;
  }

  function dismissRemoteVersion(version = '') {
    const cleaned = cleanVersion(version);
    state.remoteVersionInfo = {
      ...(state.remoteVersionInfo || {}),
      dismissedVersion: cleaned
    };
    try {
      window.sessionStorage.setItem('wnmuDismissedRemoteVersion', cleaned);
    } catch (_error) {
      // ignore sessionStorage failures
    }
    setUpdateBanner('', { visible: false });
  }

  function getDismissedRemoteVersion() {
    if (state.remoteVersionInfo?.dismissedVersion) return state.remoteVersionInfo.dismissedVersion;
    try {
      return cleanVersion(window.sessionStorage.getItem('wnmuDismissedRemoteVersion') || '');
    } catch (_error) {
      return '';
    }
  }

  function forceFreshReload() {
    const next = new URL(window.location.href);
    next.searchParams.set('reload', String(Date.now()));
    window.location.href = next.toString();
  }

  function applyRemoteVersionBanner(payload = {}) {
    const localVersion = cleanVersion(constants.APP_VERSION);
    const remoteVersion = cleanVersion(payload?.appVersion || payload?.version || '');
    state.remoteVersionInfo = {
      ...(state.remoteVersionInfo || {}),
      localVersion,
      remoteVersion,
      checkedAt: new Date().toISOString()
    };
    if (!remoteVersion || compareVersions(remoteVersion, localVersion) <= 0) {
      setUpdateBanner('', { visible: false });
      return;
    }
    if (getDismissedRemoteVersion() === remoteVersion) {
      setUpdateBanner('', { visible: false });
      return;
    }
    setUpdateBanner(`New version ${remoteVersion} available. You are on ${localVersion}. Refresh to load the latest build.`, { visible: true });
  }

  async function checkForRemoteUpdate({ silent = true } = {}) {
    try {
      const manifestPath = `${constants.VERSION_MANIFEST || 'version.json'}?_=${Date.now()}`;
      const response = await window.fetch(manifestPath, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Version check failed (${response.status})`);
      const payload = await response.json();
      applyRemoteVersionBanner(payload || {});
    } catch (error) {
      if (!silent) console.warn('Could not check for updates.', error);
    }
  }

  function startVersionChecks() {
    window.clearInterval(versionCheckTimer);
    void checkForRemoteUpdate({ silent: true });
    versionCheckTimer = window.setInterval(() => {
      void checkForRemoteUpdate({ silent: true });
    }, Number(constants.VERSION_CHECK_INTERVAL_MS) || (10 * 60 * 1000));
  }

  async function init() {
    applyHotfixUiNote();
    installDetailCreateGuard();
    installDetailSaveHotfix();
    App.auth.setRoleUi();
    App.workspaceUi?.setWorkspace(state.activeWorkspace);
    App.schedulingUi?.renderAll();
    setBuildMeta(state.configVersionMismatch || HOTFIX_NOTE);
    if (!App.data.validateConfig()) {
      setNotice('Fill in config.js with your Supabase URL and anon key. Until then this page is decorative.', 'warn');
      if (state.configVersionMismatch) setBuildMeta(state.configVersionMismatch);
      startVersionChecks();
      return;
    }

    try {
      App.data.createClient();
    } catch (error) {
      setNotice(error.message || 'Supabase failed to initialize.', 'warn');
      startVersionChecks();
      return;
    }

    const authHashError = App.auth.parseAuthErrorFromHash();
    if (authHashError) {
      App.auth.openAuthShell(authHashError);
      setNotice(authHashError, 'warn');
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    setNotice(`Connected. Probing ${constants.LIBRARY_VIEW} and ${constants.BASE_TABLE}.`);
    await App.auth.initAuthRole();
    App.auth.bindAuthListener();

    void App.schedulingUi?.loadSchedules().catch((error) => {
      console.warn('Background fundraiser load failed.', error);
    });

    await App.libraryLoader.refreshAll({ workspace: 'library' });
    startVersionChecks();
    scheduleDuplicateWarningRepair();
  }

  function boot() {
    applyHotfixUiNote();
    installDetailCreateGuard();
    installDetailSaveHotfix();
    App.programOpen?.bindDelegation?.();
    App.app?.bindEvents?.();
    App.app?.ensureMobileModeControls?.();
    window.addEventListener('resize', App.app?.ensureMobileModeControls || (() => {}));
    document.addEventListener('click', scheduleDuplicateWarningRepair, true);
    document.addEventListener('input', scheduleDuplicateWarningRepair, true);
    if (els.detailModal) {
      const observer = new MutationObserver(() => scheduleDuplicateWarningRepair());
      observer.observe(els.detailModal, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    }
    if (els.updateRefreshButton) els.updateRefreshButton.addEventListener('click', forceFreshReload);
    if (els.updateDismissButton) els.updateDismissButton.addEventListener('click', () => dismissRemoteVersion(state.remoteVersionInfo?.remoteVersion || ''));
    void init().catch((error) => {
      console.error(error);
      const message = error?.message || 'App startup failed.';
      setNotice(message, 'warn');
      if (els.libraryBody) {
        els.libraryBody.innerHTML = `<tr><td colspan="10" class="placeholder-row">${utils.escapeHtml(message)}</td></tr>`;
      }
      if (els.resultSummary) els.resultSummary.textContent = 'Load failed.';
      startVersionChecks();
    });
  }

  App.appInit = {
    init,
    boot,
    checkForRemoteUpdate,
    forceFreshReload,
    dismissRemoteVersion,
    installDetailCreateGuard,
    installDetailSaveHotfix,
    forceExistingDetailIntoUpdateMode
  };

  window.addEventListener('DOMContentLoaded', boot);
})();

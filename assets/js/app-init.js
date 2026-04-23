(() => {
  const App = window.PledgeLib;
  if (!App) return;

  const { state, constants, utils } = App;
  const { els, setNotice, setBuildMeta, setUpdateBanner } = App.dom;
  let versionCheckTimer = 0;

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
    App.auth.setRoleUi();
    App.workspaceUi?.setWorkspace(state.activeWorkspace);
    App.schedulingUi?.renderAll();
    setBuildMeta(state.configVersionMismatch || '');
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
  }

  function boot() {
    App.programOpen?.bindDelegation?.();
    App.app?.bindEvents?.();
    App.app?.ensureMobileModeControls?.();
    window.addEventListener('resize', App.app?.ensureMobileModeControls || (() => {}));
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
    dismissRemoteVersion
  };

  window.addEventListener('DOMContentLoaded', boot);
})();

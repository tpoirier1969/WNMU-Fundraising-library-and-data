(() => {
  const App = window.PledgeLib;
  if (!App) return;

  const { state, constants, utils } = App;
  const { els, setNotice, setBuildMeta, setUpdateBanner } = App.dom;
  let versionCheckTimer = 0;

  function versionGateEls() {
    return {
      gate: document.getElementById('version-gate'),
      message: document.getElementById('version-gate-message'),
      pill: document.getElementById('version-gate-version-pill'),
      refreshButton: document.getElementById('version-gate-refresh-button'),
      dismissButton: els.updateDismissButton
    };
  }

  function setVersionGate({ active = false, remoteVersion = '', localVersion = '' } = {}) {
    const gateEls = versionGateEls();
    state.versionGateActive = Boolean(active);
    state.remoteVersionInfo = {
      ...(state.remoteVersionInfo || {}),
      localVersion: cleanVersion(localVersion || constants.APP_VERSION),
      remoteVersion: cleanVersion(remoteVersion || state.remoteVersionInfo?.remoteVersion || ''),
      blocked: Boolean(active)
    };

    document.body.classList.toggle('version-gate-active', Boolean(active));
    if (gateEls.gate) gateEls.gate.classList.toggle('hidden', !active);
    if (gateEls.dismissButton) gateEls.dismissButton.classList.toggle('hidden', Boolean(active));

    const remote = cleanVersion(remoteVersion || state.remoteVersionInfo?.remoteVersion || '');
    const local = cleanVersion(localVersion || constants.APP_VERSION);
    if (gateEls.message) {
      gateEls.message.textContent = remote
        ? `This browser is running v${local}, but v${remote} is published. Reload before using the pledge app.`
        : `This browser is running v${local}. Reload before using the pledge app.`;
    }
    if (gateEls.pill) {
      gateEls.pill.textContent = remote ? `Current page v${local} · Required v${remote}` : `Current page v${local}`;
    }
    if (gateEls.refreshButton && !gateEls.refreshButton.dataset.boundVersionGate) {
      gateEls.refreshButton.dataset.boundVersionGate = 'true';
      gateEls.refreshButton.addEventListener('click', forceFreshReload);
    }
  }

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
    if (state.versionGateActive) return;
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
    setUpdateBanner('', { visible: false, remoteVersion: '', localVersion: '' });
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
    const remote = cleanVersion(state.remoteVersionInfo?.remoteVersion || '');
    next.searchParams.set('reload', remote ? `${remote}-${Date.now()}` : String(Date.now()));
    try {
      window.sessionStorage.removeItem('wnmuDismissedRemoteVersion');
    } catch (_error) {
      // ignore sessionStorage failures
    }
    window.location.replace(next.toString());
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
      if (els.updateRefreshButton) els.updateRefreshButton.textContent = 'Load latest version';
      setUpdateBanner('', { visible: false, remoteVersion: '', localVersion: '' });
      setVersionGate({ active: false, remoteVersion: '', localVersion });
      return false;
    }
    if (els.updateRefreshButton) els.updateRefreshButton.textContent = `Reload to v${remoteVersion}`;
    setUpdateBanner(`Update required. This page is running v${localVersion}; v${remoteVersion} is published. Reload before using the pledge app.`, { visible: true, remoteVersion, localVersion });
    setVersionGate({ active: true, remoteVersion, localVersion });
    return true;
  }

  async function checkForRemoteUpdate({ silent = true } = {}) {
    try {
      const manifestPath = `${constants.VERSION_MANIFEST || 'version.json'}?_=${Date.now()}`;
      const response = await window.fetch(manifestPath, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Version check failed (${response.status})`);
      const payload = await response.json();
      return applyRemoteVersionBanner(payload || {});
    } catch (error) {
      if (!silent) console.warn('Could not check for updates.', error);
      return false;
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
    const updateRequired = await checkForRemoteUpdate({ silent: true });
    if (updateRequired) {
      setNotice('Update required. Reload the latest version before using the pledge app.', 'warn');
      startVersionChecks();
      return;
    }
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

    await App.libraryLoader.refreshAll({ workspace: 'library' });

    void App.schedulingUi?.warmup?.({ defer: true, renderHidden: true }).catch((error) => {
      console.warn('Background fundraiser warmup failed.', error);
    });

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

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
      dismissButton: els.updateDismissButton
    };
  }

  function setVersionGate({ active = false, remoteVersion = '', localVersion = '' } = {}) {
    const gateEls = versionGateEls();
    state.versionGateActive = Boolean(active);
    state.remoteVersionInfo = {
      ...(state.remoteVersionInfo || {}),
      localVersion: cleanVersion(localVersion || getBootLocalVersion()),
      remoteVersion: cleanVersion(remoteVersion || state.remoteVersionInfo?.remoteVersion || ''),
      blocked: Boolean(active)
    };

    document.body.classList.toggle('version-gate-active', Boolean(active));
    if (gateEls.gate) gateEls.gate.classList.toggle('hidden', !active);
    if (gateEls.dismissButton) gateEls.dismissButton.classList.toggle('hidden', Boolean(active));

    const remote = cleanVersion(remoteVersion || state.remoteVersionInfo?.remoteVersion || '');
    const local = cleanVersion(localVersion || getBootLocalVersion());
    if (gateEls.message) {
      gateEls.message.textContent = remote
        ? `The user must refresh this page to load the new version of the site to keep working. This page is running v${local}; v${remote} is published.`
        : `The user must refresh this page to load the new version of the site to keep working.`;
    }
    if (gateEls.pill) {
      gateEls.pill.textContent = remote ? `Current page v${local} · Required v${remote}` : `Current page v${local}`;
    }
  }

  function cleanVersion(value = '') {
    return String(value || '').trim().replace(/^v/i, '');
  }

  function getBootLocalVersion() {
    return cleanVersion(
      window.__PLEDGE_APP_VERSION__
      || document.documentElement?.dataset?.appVersion
      || constants.APP_VERSION
      || ''
    );
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

  async function forceFreshReload(event = null) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const remote = cleanVersion(state.remoteVersionInfo?.remoteVersion || '');
    const stamp = `${remote || 'latest'}-${Date.now()}`;
    const next = new URL(window.location.href);
    next.searchParams.set('reload', stamp);
    next.searchParams.set('_v', stamp);

    document.querySelectorAll('[data-version-reload], #update-refresh-button, #version-gate-refresh-button')
      .forEach((button) => {
        if ('disabled' in button) button.disabled = true;
        button.textContent = 'Reloading…';
      });

    try {
      window.sessionStorage.removeItem('wnmuDismissedRemoteVersion');
    } catch (_error) {
      // ignore sessionStorage failures
    }

    try {
      if ('caches' in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((key) => window.caches.delete(key)));
      }
    } catch (_error) {
      // ignore cache API failures
    }

    try {
      if (navigator.serviceWorker?.getRegistrations) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
    } catch (_error) {
      // ignore service worker failures
    }

    window.location.assign(next.toString());
    window.setTimeout(() => {
      try { window.location.reload(); } catch (_error) { /* ignore */ }
    }, 900);
  }

  function applyRemoteVersionBanner(payload = {}) {
    const localVersion = getBootLocalVersion();
    const remoteVersion = cleanVersion(payload?.appVersion || payload?.version || '');
    state.remoteVersionInfo = {
      ...(state.remoteVersionInfo || {}),
      localVersion,
      remoteVersion,
      checkedAt: new Date().toISOString()
    };
    if (!remoteVersion || compareVersions(remoteVersion, localVersion) <= 0) {
      setUpdateBanner('', { visible: false, remoteVersion: '', localVersion: '' });
      setVersionGate({ active: false, remoteVersion: '', localVersion });
      return false;
    }
    setUpdateBanner(`The user must refresh this page to load the new version of the site to keep working. This page is running v${localVersion}; v${remoteVersion} is published.`, { visible: true, remoteVersion, localVersion });
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


  function openProgramFromQuery() {
    try {
      const url = new URL(window.location.href);
      const programId = (url.searchParams.get('openProgram') || url.searchParams.get('programId') || '').trim();
      if (!programId) return;
      state.activeWorkspace = 'library';
      App.workspaceUi?.setWorkspace?.('library');
      const preserveMode = Boolean(App.auth?.canEdit?.());
      if (App.detailUi?.loadProgramDetail) void App.detailUi.loadProgramDetail(programId, { preserveMode });
      url.searchParams.delete('openProgram');
      url.searchParams.delete('programId');
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState(null, '', next || window.location.pathname);
    } catch (error) {
      console.warn('Could not open linked program.', error);
    }
  }


  function openWorkspaceFromQuery() {
    try {
      const url = new URL(window.location.href);
      const workspaceId = (url.searchParams.get('workspace') || '').trim();
      if (!workspaceId) return;
      const exists = (constants.WORKSPACES || []).some((workspace) => workspace.id === workspaceId);
      if (!exists) return;
      state.activeWorkspace = workspaceId;
      App.workspaceUi?.setWorkspace?.(workspaceId);
    } catch (error) {
      console.warn('Could not open linked workspace.', error);
    }
  }

  async function init() {
    App.auth.setRoleUi();
    App.workspaceUi?.setWorkspace(state.activeWorkspace);
    App.schedulingUi?.renderAll();
    setBuildMeta(state.configVersionMismatch || '');
    const updateRequired = await checkForRemoteUpdate({ silent: true });
    if (updateRequired) {
      setNotice('Update required. The user must refresh this page to load the new version of the site to keep working.', 'warn');
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
    openProgramFromQuery();
    openWorkspaceFromQuery();

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

/* v0.21.96 drive snapshot priority layout patch */
(() => {
  const VERSION = 'v0.21.96-drive-snapshot-priority-layout';
  let raf = 0;

  function injectStyles() {
    if (document.getElementById('driveSnapshotPriorityLayoutStyles')) return;
    const style = document.createElement('style');
    style.id = 'driveSnapshotPriorityLayoutStyles';
    style.textContent = `
      #home-drive-summary.drive-snapshot-priority-layout {
        max-width: 1080px;
        margin-left: auto;
        margin-right: auto;
        padding: 12px 14px;
      }
      #home-drive-summary .drive-summary-priority-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
      }
      #home-drive-summary .drive-summary-priority-main {
        display: grid;
        grid-template-columns: minmax(220px, .9fr) minmax(470px, 1.35fr);
        gap: 12px;
        align-items: stretch;
        min-width: 0;
        width: 100%;
      }
      #home-drive-summary .drive-summary-priority-title-wrap {
        display: grid;
        gap: 3px;
        min-width: 0;
      }
      #home-drive-summary .drive-summary-priority-kicker {
        color: #376d5c;
        text-transform: uppercase;
        letter-spacing: .12em;
        font-weight: 850;
        font-size: .68rem;
      }
      #home-drive-summary .drive-summary-priority-title {
        font-size: clamp(1.05rem, 1.8vw, 1.42rem);
        line-height: 1.08;
        font-weight: 850;
        letter-spacing: -.035em;
        color: #1e332d;
      }
      #home-drive-summary .drive-summary-priority-date {
        color: #5f7383;
        font-size: .78rem;
        font-weight: 750;
        white-space: nowrap;
      }
      #home-drive-summary .drive-summary-priority-row,
      #home-drive-summary .drive-summary-secondary-row {
        display: grid;
        gap: 8px;
      }
      #home-drive-summary .drive-summary-priority-row {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      #home-drive-summary .drive-summary-secondary-row {
        grid-template-columns: repeat(5, minmax(0, 1fr));
        margin-top: 9px;
      }
      #home-drive-summary .drive-summary-priority-card,
      #home-drive-summary .drive-summary-secondary-card {
        min-width: 0;
        border: 1px solid #d6e4ea;
        border-radius: 12px;
        background: #fbfdfe;
        padding: 8px 10px;
      }
      #home-drive-summary .drive-summary-priority-card {
        background: #f6fafc;
      }
      #home-drive-summary .drive-summary-priority-card.important {
        background: #fff;
        border-color: #c8d6e2;
        box-shadow: 0 4px 12px rgba(15,23,42,.05);
      }
      #home-drive-summary .drive-summary-label {
        color: #5f7383;
        font-size: .68rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .055em;
        white-space: nowrap;
      }
      #home-drive-summary .drive-summary-value {
        margin-top: 2px;
        color: #1e3140;
        font-size: clamp(.95rem, 1.35vw, 1.16rem);
        line-height: 1.1;
        font-weight: 850;
        letter-spacing: -.035em;
        white-space: nowrap;
      }
      #home-drive-summary .drive-summary-priority-card .drive-summary-value {
        font-size: clamp(1.1rem, 1.75vw, 1.48rem);
      }
      #home-drive-summary .goal-difference-positive { color: #1f7a4b; }
      #home-drive-summary .goal-difference-negative { color: #a13a3a; }
      #home-drive-summary .goal-difference-neutral { color: #4b5563; }
      @media (max-width: 980px) {
        #home-drive-summary .drive-summary-priority-head {
          display: grid;
        }
        #home-drive-summary .drive-summary-priority-main {
          grid-template-columns: 1fr;
        }
        #home-drive-summary .drive-summary-secondary-row {
          grid-template-columns: repeat(5, minmax(86px, 1fr));
          overflow-x: auto;
          padding-bottom: 2px;
        }
      }
      @media (max-width: 640px) {
        #home-drive-summary .drive-summary-priority-row {
          grid-template-columns: 1fr;
        }
        #home-drive-summary .drive-summary-secondary-row {
          grid-template-columns: 1fr 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function clean(value) {
    return String(value || '').trim();
  }

  function normalizeLabel(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function valueClassFor(label, value) {
    if (normalizeLabel(label) !== 'difference') return '';
    if (/^\s*-/.test(value)) return 'goal-difference-negative';
    if (value && !/^\s*\$?0\b/.test(String(value).replace(/,/g, ''))) return 'goal-difference-positive';
    return 'goal-difference-neutral';
  }

  function readOriginalCards(box) {
    const map = new Map();
    box.querySelectorAll('.home-drive-summary-card, .drive-summary-card').forEach((card) => {
      const label = clean(card.querySelector('.home-drive-summary-label, .drive-summary-label')?.textContent || '');
      const value = clean(card.querySelector('.home-drive-summary-value, .drive-summary-value')?.textContent || '');
      if (label && value) map.set(normalizeLabel(label), { label, value });
    });
    return map;
  }

  function pick(map, keys, fallbackLabel) {
    for (const key of keys) {
      const found = map.get(normalizeLabel(key));
      if (found) return { ...found, label: fallbackLabel || found.label };
    }
    return { label: fallbackLabel || keys[0] || '', value: '—' };
  }

  function renderCard(item, className = '', important = false) {
    const tone = valueClassFor(item.label, item.value);
    return `
      <div class="${className} ${important ? 'important' : ''}">
        <div class="drive-summary-label">${escapeHtml(item.label)}</div>
        <div class="drive-summary-value ${tone}">${escapeHtml(item.value)}</div>
      </div>
    `;
  }

  function transformDriveSummary() {
    const box = document.getElementById('home-drive-summary');
    if (!box || box.classList.contains('hidden')) return;
    if (box.querySelector('.drive-summary-priority-row')) return;

    const cards = readOriginalCards(box);
    if (!cards.size) return;

    const title = clean(box.querySelector('.home-drive-summary-title, .drive-summary-title')?.textContent || '');
    const date = clean(box.querySelector('.home-drive-summary-date, .drive-summary-date')?.textContent || '');

    const goal = pick(cards, ['Goal'], 'Goal');
    const total = pick(cards, ['Total Raised $', 'Total Raised'], 'Total Raised');
    const difference = pick(cards, ['Difference'], 'Difference');

    const pledges = pick(cards, ['Pledges'], 'Pledges');
    const broadcast = pick(cards, ['Broadcast $', 'Broadcast'], 'Broadcast');
    const nonSpecific = pick(cards, ['Non-Specific $', 'Non Specific $', 'Non-Specific'], 'Non-Specific');
    const online = pick(cards, ['Online $', 'Online'], 'Online');
    const mail = pick(cards, ['Mail $', 'Mail'], 'Mail');

    box.innerHTML = `
      <div class="drive-summary-priority-head">
        <div class="drive-summary-priority-main">
          <div class="drive-summary-priority-title-wrap">
            <div class="drive-summary-priority-kicker">Pledge drive snapshot</div>
            <div class="drive-summary-priority-title">${escapeHtml(title || 'Current pledge drive')}</div>
          </div>
          <div class="drive-summary-priority-row">
            ${renderCard(goal, 'drive-summary-priority-card')}
            ${renderCard(total, 'drive-summary-priority-card', true)}
            ${renderCard(difference, 'drive-summary-priority-card', true)}
          </div>
        </div>
        ${date ? `<div class="drive-summary-priority-date">${escapeHtml(date)}</div>` : ''}
      </div>
      <div class="drive-summary-secondary-row">
        ${renderCard(pledges, 'drive-summary-secondary-card')}
        ${renderCard(broadcast, 'drive-summary-secondary-card')}
        ${renderCard(nonSpecific, 'drive-summary-secondary-card')}
        ${renderCard(online, 'drive-summary-secondary-card')}
        ${renderCard(mail, 'drive-summary-secondary-card')}
      </div>
    `;
    box.classList.add('drive-snapshot-priority-layout');
    box.dataset.driveSnapshotLayoutVersion = VERSION;
  }

  function scheduleTransform() {
    window.cancelAnimationFrame(raf);
    raf = window.requestAnimationFrame(transformDriveSummary);
  }

  function bootPatch() {
    injectStyles();
    scheduleTransform();
    const box = document.getElementById('home-drive-summary');
    if (box) {
      const observer = new MutationObserver(scheduleTransform);
      observer.observe(box, { childList: true, subtree: true });
    }
    window.setInterval(scheduleTransform, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootPatch, { once: true });
  } else {
    bootPatch();
  }
})();

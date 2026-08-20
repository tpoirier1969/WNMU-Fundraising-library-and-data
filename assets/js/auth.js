(() => {
  const App = window.PledgeLib;
  const { cfg, adminEmails, state, utils, constants } = App;
  const { els } = App.dom;

  const PRESENCE_TOPIC = 'wnmu-pledge-active-v1';
  const PRESENCE_VISITOR_KEY = 'wnmuPledgePresenceVisitorV1';
  const PRESENCE_TAB_KEY = 'wnmuPledgePresenceTabV1';
  let presenceChannel = null;
  let presenceSubscribed = false;
  let presenceStatus = 'idle';
  let presenceTimer = 0;
  let presenceListenersBound = false;
  let presenceVisitorId = '';
  let presenceTabId = '';

  function canEdit() {
    return Boolean(state.session && state.isAdmin);
  }

  function ensurePresenceUi() {
    let host = document.getElementById('live-presence-admin');
    if (host) return host;
    const roleChip = els.roleChip || document.getElementById('role-chip');
    const parent = roleChip?.parentElement;
    if (!roleChip || !parent) return null;

    let wrapper = roleChip.closest('.admin-role-presence');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'admin-role-presence';
      parent.insertBefore(wrapper, roleChip);
      wrapper.append(roleChip);
    }

    host = document.createElement('details');
    host.id = 'live-presence-admin';
    host.className = 'live-presence-admin hidden';
    host.dataset.adminOnly = 'true';
    host.innerHTML = '<summary id="live-presence-summary">Active now: …</summary><div id="live-presence-detail" class="live-presence-detail">Connecting…</div>';
    wrapper.append(host);

    if (!document.getElementById('live-presence-styles')) {
      const style = document.createElement('style');
      style.id = 'live-presence-styles';
      style.textContent = `
        .admin-role-presence{display:grid;justify-items:end;gap:3px;position:relative}
        .live-presence-admin{position:relative;max-width:270px;font-size:.72rem;color:#536d7d}
        .live-presence-admin summary{cursor:pointer;list-style:none;font-weight:800;color:#31566e;white-space:nowrap}
        .live-presence-admin summary::-webkit-details-marker{display:none}
        .live-presence-admin summary:hover{color:#0c3159}
        .live-presence-detail{position:absolute;right:0;top:calc(100% + 5px);z-index:1200;min-width:230px;background:#fff;border:1px solid #cbdce4;border-radius:10px;padding:8px;box-shadow:0 8px 24px rgba(22,49,66,.16);text-align:left}
        .live-presence-row{display:flex;justify-content:space-between;gap:16px;padding:3px 0;border-bottom:1px solid #eef3f5}
        .live-presence-row:last-of-type{border-bottom:0}
        .live-presence-row strong{color:#103a66}
        .live-presence-note{margin-top:5px;padding-top:5px;border-top:1px solid #e3ecef;color:#708591;font-size:.67rem;line-height:1.3}
      `;
      document.head.append(style);
    }
    return host;
  }

  function randomPresenceId() {
    try {
      if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    } catch (_error) {
      // fall through to a non-cryptographic per-browser id
    }
    return `presence-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function storedPresenceId(storage, key) {
    try {
      const existing = String(storage?.getItem?.(key) || '').trim();
      if (existing) return existing;
      const created = randomPresenceId();
      storage?.setItem?.(key, created);
      return created;
    } catch (_error) {
      return randomPresenceId();
    }
  }

  function presenceMetas() {
    if (!presenceChannel?.presenceState) return [];
    const snapshot = presenceChannel.presenceState() || {};
    return Object.values(snapshot).flatMap((value) => Array.isArray(value) ? value : []);
  }

  function uniquePresenceVisitors() {
    const byVisitor = new Map();
    presenceMetas().forEach((meta) => {
      const key = String(meta?.visitorId || meta?.tabId || meta?.presence_ref || '').trim();
      if (!key) return;
      const previous = byVisitor.get(key);
      const previousSeen = Number(previous?.lastSeen || 0);
      const currentSeen = Number(meta?.lastSeen || 0);
      if (!previous || (meta?.visible && !previous?.visible) || currentSeen >= previousSeen) byVisitor.set(key, meta);
    });
    return [...byVisitor.values()];
  }

  function presencePayload() {
    return {
      visitorId: presenceVisitorId,
      tabId: presenceTabId,
      workspace: state.activeWorkspace || 'library',
      role: canEdit() ? 'admin' : (state.session ? 'signed-in' : 'viewer'),
      visible: document.visibilityState !== 'hidden',
      lastSeen: Date.now()
    };
  }

  function renderPresenceAdmin() {
    const host = ensurePresenceUi();
    const summary = document.getElementById('live-presence-summary');
    const detail = document.getElementById('live-presence-detail');
    if (!host || !summary || !detail) return;

    host.classList.toggle('hidden', !canEdit());
    if (!canEdit()) return;

    if (!presenceSubscribed) {
      const unavailable = ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(presenceStatus);
      summary.textContent = unavailable ? 'Active now: unavailable' : 'Active now: connecting…';
      detail.textContent = unavailable ? 'Live presence is unavailable.' : 'Connecting to live presence…';
      return;
    }

    const visitors = uniquePresenceVisitors();
    summary.textContent = `Active now: ${visitors.length}`;
    const counts = new Map();
    visitors.forEach((visitor) => {
      const workspaceId = String(visitor?.workspace || 'library');
      counts.set(workspaceId, (counts.get(workspaceId) || 0) + 1);
    });

    const rows = constants.WORKSPACES
      .map((workspace) => ({ workspace, count: counts.get(workspace.id) || 0 }))
      .filter((row) => row.count > 0)
      .map((row) => `<div class="live-presence-row"><span>${utils.escapeHtml(row.workspace.label)}</span><strong>${row.count}</strong></div>`)
      .join('');

    detail.innerHTML = `${rows || '<div class="live-presence-row"><span>No active browsers</span><strong>0</strong></div>'}<div class="live-presence-note">Counts unique browsers, not open tabs. While the site is public, visitor identities are intentionally not broadcast through the live channel.</div>`;
  }

  async function refreshPresence() {
    if (!presenceChannel || !presenceSubscribed) return false;
    try {
      await presenceChannel.track(presencePayload());
      renderPresenceAdmin();
      return true;
    } catch (error) {
      console.warn('Live presence update failed.', error);
      return false;
    }
  }

  function bindPresenceListeners() {
    if (presenceListenersBound) return;
    presenceListenersBound = true;
    document.addEventListener('visibilitychange', () => { void refreshPresence(); });
    window.addEventListener('focus', () => { void refreshPresence(); });
    window.addEventListener('pagehide', () => {
      try { presenceChannel?.untrack?.(); } catch (_error) { /* connection close will clear presence */ }
    });
    window.clearInterval(presenceTimer);
    presenceTimer = window.setInterval(() => { void refreshPresence(); }, 60000);
  }

  function initPresence() {
    ensurePresenceUi();
    if (!state.client?.channel) return;
    if (presenceChannel) {
      void refreshPresence();
      return;
    }

    presenceVisitorId = storedPresenceId(window.localStorage, PRESENCE_VISITOR_KEY);
    presenceTabId = storedPresenceId(window.sessionStorage, PRESENCE_TAB_KEY);
    presenceChannel = state.client
      .channel(PRESENCE_TOPIC, { config: { presence: { key: presenceTabId } } })
      .on('presence', { event: 'sync' }, renderPresenceAdmin)
      .on('presence', { event: 'join' }, renderPresenceAdmin)
      .on('presence', { event: 'leave' }, renderPresenceAdmin)
      .subscribe((status) => {
        presenceStatus = status;
        presenceSubscribed = status === 'SUBSCRIBED';
        if (presenceSubscribed) void refreshPresence();
        else renderPresenceAdmin();
      });
    bindPresenceListeners();
    renderPresenceAdmin();
  }

  function updatePresenceWorkspace() {
    void refreshPresence();
  }

  function computeAdmin(session) {
    const email = session?.user?.email ? String(session.user.email).toLowerCase() : null;
    if (!session) return { userEmail: null, isAdmin: false };
    if (!adminEmails.length) return { userEmail: email, isAdmin: true };
    return { userEmail: email, isAdmin: Boolean(email && adminEmails.includes(email)) };
  }

  function setRoleUi() {
    els.versionFlag.textContent = constants.APP_VERSION;
    els.footerVersion.textContent = constants.APP_VERSION;
    document.title = `WNMU Pledge Program Library ${constants.APP_VERSION}`;
    els.detailEditButton.classList.toggle('hidden', !canEdit());
    els.detailDeleteButton?.classList.toggle('hidden', !canEdit() || Boolean(state.detailCreateMode) || !state.selectedProgramId);
    els.addProgramButton?.classList.toggle('hidden', !canEdit());
    document.querySelectorAll('[data-admin-only="true"]').forEach((node) => node.classList.toggle('hidden', !canEdit()));
    if (canEdit()) {
      els.roleChip.textContent = state.userEmail ? `Admin · ${state.userEmail}` : 'Admin';
      els.roleChip.classList.add('admin');
      els.adminButton.classList.add('hidden');
      els.logoutButton.classList.remove('hidden');
    } else if (state.session) {
      els.roleChip.textContent = state.userEmail ? `Viewer · ${state.userEmail}` : 'Viewer';
      els.roleChip.classList.remove('admin');
      els.adminButton.classList.add('hidden');
      els.logoutButton.classList.remove('hidden');
    } else {
      els.roleChip.textContent = 'Viewer';
      els.roleChip.classList.remove('admin');
      els.adminButton.classList.remove('hidden');
      els.logoutButton.classList.add('hidden');
    }
    renderPresenceAdmin();
  }

  function getAdminRedirectUrl() {
    const configured = utils.normalizeText(cfg.ADMIN_REDIRECT_URL);
    if (configured) return configured;
    const url = new URL(window.location.href);
    url.hash = '';
    return url.toString();
  }

  function parseAuthErrorFromHash() {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    if (!hash) return '';
    const params = new URLSearchParams(hash);
    const errorCode = params.get('error_code') || '';
    const description = params.get('error_description') || params.get('error') || '';
    if (!errorCode && !description) return '';
    return decodeURIComponent(description.replace(/\+/g, ' ')) || errorCode;
  }

  function openAuthShell(message = '') {
    if (els.authMessage) els.authMessage.textContent = message;
    els.authShell?.classList.remove('hidden');
  }

  function closeAuthShell() {
    els.authShell?.classList.add('hidden');
    if (els.authMessage) els.authMessage.textContent = '';
  }

  async function initAuthRole() {
    if (!state.client) return;
    try {
      const { data, error } = await state.client.auth.getSession();
      if (error) throw error;
      state.session = data?.session || null;
      const admin = computeAdmin(state.session);
      state.userEmail = admin.userEmail;
      state.isAdmin = admin.isAdmin;
      setRoleUi();
    } catch (error) {
      console.warn('Auth session check failed; staying viewer-only.', error);
      state.session = null;
      state.userEmail = null;
      state.isAdmin = false;
      setRoleUi();
    }
    initPresence();
  }

  function bindAuthListener() {
    state.client.auth.onAuthStateChange((_event, session) => {
      state.session = session;
      const admin = computeAdmin(session);
      state.userEmail = admin.userEmail;
      state.isAdmin = admin.isAdmin;
      setRoleUi();
      void refreshPresence();
      if (els.detailModal && !els.detailModal.classList.contains('hidden')) {
        if (!canEdit()) App.detailUi.setDetailMode('view');
        else if (state.detailEditMode) App.detailUi.setDetailMode('edit');
      }
      App.schedulingUi?.renderAll?.();
      App.importsUi?.renderAll?.();
    });
  }

  App.auth = {
    canEdit,
    computeAdmin,
    setRoleUi,
    getAdminRedirectUrl,
    parseAuthErrorFromHash,
    openAuthShell,
    closeAuthShell,
    initAuthRole,
    bindAuthListener,
    updatePresenceWorkspace,
    refreshPresence
  };
})();

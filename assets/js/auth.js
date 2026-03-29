(() => {
  const App = window.PledgeLib;
  const { cfg, adminEmails, state, utils, constants } = App;
  const { els } = App.dom;

  function canEdit() {
    return Boolean(state.session && state.isAdmin);
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
    els.detailEditButton.classList.toggle('hidden', !canEdit());
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
  }

  function bindAuthListener() {
    state.client.auth.onAuthStateChange((_event, session) => {
      state.session = session;
      const admin = computeAdmin(session);
      state.userEmail = admin.userEmail;
      state.isAdmin = admin.isAdmin;
      setRoleUi();
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
    bindAuthListener
  };
})();

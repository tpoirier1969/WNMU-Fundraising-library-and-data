(() => {
  const App = window.PledgeLib;
  const { state, constants, utils } = App;
  const { els, setNotice, setBuildMeta, setDetailNotice } = App.dom;

  async function refreshAll(options = {}) {
    if (!state.client) return;
    els.libraryBody.innerHTML = '<tr><td colspan="8" class="placeholder-row">Loading library…</td></tr>';
    try {
      await App.data.refreshRawRows();
      App.listUi.buildFilterOptions();
      App.listUi.applyLibraryView();
      const probeStatus = App.data.getProbeStatusMessage();
      if (state.configVersionMismatch) {
        setBuildMeta(`${state.configVersionMismatch} ${probeStatus}`);
      } else {
        setBuildMeta(probeStatus);
      }
      if (options.preserveDetail && state.selectedProgramId && !els.detailModal.classList.contains('hidden')) {
        await App.detailUi.loadProgramDetail(state.selectedProgramId, { preserveMode: state.detailEditMode });
      }
    } catch (error) {
      console.error(error);
      const rawMessage = error?.message || 'Load failed.';
      const message = /permission denied|row-level security|schema cache/i.test(rawMessage)
        ? `${rawMessage} Run the v2 access SQL patch, then reload.`
        : rawMessage;
      els.libraryBody.innerHTML = `<tr><td colspan="8" class="placeholder-row">${utils.escapeHtml(message)}</td></tr>`;
      els.resultSummary.textContent = 'Load failed.';
      setNotice(message, 'warn');
      if (state.configVersionMismatch) setBuildMeta(state.configVersionMismatch);
    }
  }

  function bindEvents() {
    let searchTimer = null;
    els.searchInput.addEventListener('input', (event) => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        state.searchText = event.target.value || '';
        App.listUi.applyLibraryView();
      }, 180);
    });

    els.searchFieldSelect.addEventListener('change', (event) => { state.searchField = event.target.value || ''; App.listUi.applyLibraryView(); });
    els.topicFilter.addEventListener('change', (event) => { state.topicFilter = event.target.value || ''; App.listUi.applyLibraryView(); });
    els.secondaryTopicFilter.addEventListener('change', (event) => { state.secondaryTopicFilter = event.target.value || ''; App.listUi.applyLibraryView(); });
    els.lengthFilter.addEventListener('change', (event) => { state.lengthFilter = event.target.value || ''; App.listUi.applyLibraryView(); });
    els.distributorFilter.addEventListener('change', (event) => { state.distributorFilter = event.target.value || ''; App.listUi.applyLibraryView(); });
    els.statusFilter.addEventListener('change', (event) => { state.statusFilter = event.target.value || 'active'; App.listUi.applyLibraryView(); });
    els.resetFiltersButton.addEventListener('click', () => { App.listUi.resetFilters(); App.listUi.applyLibraryView(); });
    els.refreshButton.addEventListener('click', async () => { await refreshAll({ preserveDetail: true }); });
    els.libraryBody.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-open-id]');
      if (!trigger) return;
      event.preventDefault();
      void App.detailUi.loadProgramDetail(trigger.dataset.openId);
    });
    els.detailCloseButton.addEventListener('click', App.detailUi.closeDetailModal);
    els.detailBackdrop.addEventListener('click', App.detailUi.closeDetailModal);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.detailModal.classList.contains('hidden')) App.detailUi.closeDetailModal();
    });
    els.adminButton.addEventListener('click', () => App.auth.openAuthShell(''));
    els.cancelLoginButton?.addEventListener('click', App.auth.closeAuthShell);
    els.loginGitHubButton?.addEventListener('click', async () => {
      if (!state.client) return;
      if (els.authMessage) els.authMessage.textContent = 'Sending you to GitHub…';
      const { error } = await state.client.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: App.auth.getAdminRedirectUrl() }
      });
      if (error && els.authMessage) {
        els.authMessage.textContent = error.message;
        setNotice(error.message, 'warn');
      }
    });
    els.logoutButton?.addEventListener('click', async () => {
      if (!state.client) return;
      await state.client.auth.signOut();
      state.session = null;
      state.userEmail = null;
      state.isAdmin = false;
      App.auth.setRoleUi();
      App.detailUi.setDetailMode('view');
      setNotice('Signed out.');
    });
    els.detailEditButton.addEventListener('click', () => { if (App.auth.canEdit()) App.detailUi.setDetailMode('edit'); });
    els.detailCancelEditButton?.addEventListener('click', () => { setDetailNotice(''); App.detailUi.setDetailMode('view'); });
    els.detailEditForm?.addEventListener('submit', async (event) => {
      try {
        await App.detailUi.saveDetailEdit(event);
      } catch (error) {
        console.error(error);
        setDetailNotice(error.message || 'Save failed.', 'bad');
        setNotice(error.message || 'Save failed.', 'warn');
      }
    });
  }

  async function init() {
    App.auth.setRoleUi();
    setBuildMeta(state.configVersionMismatch || '');
    if (!App.data.validateConfig()) {
      setNotice('Fill in config.js with your Supabase URL and anon key. Until then this page is decorative.', 'warn');
      if (state.configVersionMismatch) setBuildMeta(state.configVersionMismatch);
      return;
    }

    try {
      App.data.createClient();
    } catch (error) {
      setNotice(error.message || 'Supabase failed to initialize.', 'warn');
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
    await refreshAll();
  }

  App.app = { init, refreshAll, bindEvents };

  window.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    void init();
  });
})();

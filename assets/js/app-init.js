(() => {
  const App = window.PledgeLib;
  if (!App) return;

  const { state, constants, utils } = App;
  const { els, setNotice, setBuildMeta } = App.dom;

  async function init() {
    App.auth.setRoleUi();
    App.workspaceUi?.setWorkspace(state.activeWorkspace);
    App.schedulingUi?.renderAll();
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

    void App.schedulingUi?.loadSchedules().catch((error) => {
      console.warn('Background fundraiser load failed.', error);
    });

    await App.libraryLoader.refreshAll({ workspace: 'library' });
  }

  function boot() {
    App.programOpen?.bindDelegation?.();
    App.app?.bindEvents?.();
    App.app?.ensureMobileModeControls?.();
    window.addEventListener('resize', App.app?.ensureMobileModeControls || (() => {}));
    void init().catch((error) => {
      console.error(error);
      const message = error?.message || 'App startup failed.';
      setNotice(message, 'warn');
      if (els.libraryBody) {
        els.libraryBody.innerHTML = `<tr><td colspan="10" class="placeholder-row">${utils.escapeHtml(message)}</td></tr>`;
      }
      if (els.resultSummary) els.resultSummary.textContent = 'Load failed.';
    });
  }

  App.appInit = { init, boot };

  window.addEventListener('DOMContentLoaded', boot);
})();

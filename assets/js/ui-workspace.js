(() => {
  const App = window.PledgeLib;
  const { state, constants, utils } = App;
  const { els, setNotice } = App.dom;

  function workspaceById(id) {
    return constants.WORKSPACES.find((workspace) => workspace.id === id) || constants.WORKSPACES[0];
  }

  function setWorkspace(workspaceId) {
    const workspace = workspaceById(workspaceId);
    state.activeWorkspace = workspace.id;

    els.workspaceButtons.forEach((button) => {
      const active = button.dataset.workspaceButton === workspace.id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    els.workspacePanes.forEach((pane) => {
      pane.classList.toggle('hidden', pane.dataset.workspacePane !== workspace.id);
    });

    if (workspace.id === 'scheduling') void App.schedulingUi?.ensureReady();
    if (workspace.id === 'imports') void App.importsUi?.ensureReady();
    if (workspace.id === 'performance') void App.performanceUi?.ensureReady();
  }

  function refreshScaffoldSummary() {
    if (els.scaffoldLibraryCount) els.scaffoldLibraryCount.textContent = utils.formatCount(state.rawRows.length);
    if (els.scaffoldTopicGapCount) els.scaffoldTopicGapCount.textContent = utils.formatCount(state.fieldAudit.missingTopicCount);
    if (els.scaffoldDistributorGapCount) els.scaffoldDistributorGapCount.textContent = utils.formatCount(state.fieldAudit.missingDistributorCount);
  }

  function handlePlaceholderAction(button) {
    const workspaceId = button.dataset.workspaceLaunch || 'library';
    const feature = button.dataset.workspaceFeature || 'This feature';
    setWorkspace(workspaceId);
    if (workspaceId === 'library') {
      setNotice(`${feature} is live in the Library workspace.`);
      return;
    }
    setNotice(`${feature} has a scaffolded home in ${workspaceById(workspaceId).label}.`);
  }

  function bindEvents() {
    els.workspaceButtons.forEach((button) => {
      button.addEventListener('click', () => setWorkspace(button.dataset.workspaceButton));
    });

    document.querySelectorAll('[data-workspace-launch]').forEach((button) => {
      button.addEventListener('click', () => handlePlaceholderAction(button));
    });
  }

  App.workspaceUi = {
    setWorkspace,
    refreshScaffoldSummary,
    bindEvents
  };
})();

(() => {
  const App = window.PledgeLib;
  if (!App) return;

  const { state, constants, utils } = App;
  const { els, setNotice, setBuildMeta, setLoading } = App.dom;

  function beginLoading(label, detail = '') {
    state.loadingState = { active: true, label, detail };
    setLoading(true, label, detail);
  }

  function endLoading() {
    state.loadingState = { active: false, label: '', detail: '' };
    setLoading(false, '', '');
  }

  async function refreshAll(options = {}) {
    if (!state.client) return;
    const detailSnapshot = options.preserveDetail
      ? {
          programId: state.selectedProgramId,
          preserveMode: state.detailEditMode,
          modalWasOpen: !els.detailModal.classList.contains('hidden')
        }
      : null;
    beginLoading('Loading pledge program data…', `Probing ${constants.LIBRARY_VIEW} and ${constants.BASE_TABLE}.`);
    els.libraryBody.innerHTML = '<tr><td colspan="10" class="placeholder-row">Loading library…</td></tr>';
    try {
      await App.data.refreshRawRows();
      App.listUi.buildFilterOptions();
      App.listUi.applyLibraryView();
      App.workspaceUi?.refreshScaffoldSummary();

      const activeWorkspace = options.workspace || state.activeWorkspace || 'library';
      if (activeWorkspace === 'scheduling') {
        await App.schedulingUi?.ensureReady();
      } else if (activeWorkspace === 'imports' && state.imports?.ready) {
        await App.importsUi?.refreshTableStatus({ silent: true });
        App.importsUi?.renderAll();
      } else if (activeWorkspace === 'performance' && state.performance?.ready) {
        await App.performanceUi?.refreshData({ silent: true });
        App.performanceUi?.populateControls();
        App.performanceUi?.renderAll();
      }

      const probeStatus = App.data.getProbeStatusMessage();
      if (state.configVersionMismatch) {
        setBuildMeta(`${state.configVersionMismatch} ${probeStatus}`);
      } else {
        setBuildMeta(probeStatus);
      }
      if (detailSnapshot?.programId
        && detailSnapshot.modalWasOpen
        && state.selectedProgramId === detailSnapshot.programId
        && !els.detailModal.classList.contains('hidden')) {
        await App.detailUi.loadProgramDetail(detailSnapshot.programId, { preserveMode: detailSnapshot.preserveMode, autoEdit: false });
      }
      setNotice(`Loaded ${utils.formatCount(state.rawRows.length)} source rows. Scheduling title match is ready.`);
    } catch (error) {
      console.error(error);
      const rawMessage = error?.message || 'Load failed.';
      const message = /permission denied|row-level security|schema cache/i.test(rawMessage)
        ? `${rawMessage} Run the v2 access SQL patch, then reload.`
        : rawMessage;
      els.libraryBody.innerHTML = `<tr><td colspan="10" class="placeholder-row">${utils.escapeHtml(message)}</td></tr>`;
      els.resultSummary.textContent = 'Load failed.';
      setNotice(message, 'warn');
      if (state.configVersionMismatch) setBuildMeta(state.configVersionMismatch);
    } finally {
      endLoading();
    }
  }


  App.libraryLoader = {
    beginLoading,
    endLoading,
    refreshAll
  };
})();

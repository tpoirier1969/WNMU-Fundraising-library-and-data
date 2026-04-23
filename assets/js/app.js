(() => {
  const App = window.PledgeLib;
  const { state } = App;
  const { els, setNotice, setDetailNotice } = App.dom;

  const refreshAll = (...args) => App.libraryLoader.refreshAll(...args);


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
    els.sortFieldSelect?.addEventListener('change', (event) => { state.sortField = event.target.value || 'topic'; App.listUi.applyLibraryView(); });
    els.sortDirectionButton?.addEventListener('click', () => {
      state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      App.listUi.buildFilterOptions();
      App.listUi.applyLibraryView();
    });
    els.sortHeaderButtons?.forEach((button) => {
      button.addEventListener('click', () => App.listUi.setSort(button.dataset.sortField));
    });
    els.resetFiltersButton.addEventListener('click', () => { App.listUi.resetFilters(); App.listUi.applyLibraryView(); });
    els.refreshButton.addEventListener('click', async () => { await refreshAll({ preserveDetail: true, workspace: state.activeWorkspace }); });
    els.libraryBody?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-unarchive-id]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      if (!App.auth.canEdit()) return;
      const programId = button.getAttribute('data-unarchive-id') || '';
      const dbId = button.getAttribute('data-unarchive-db-id') || '';
      const programDbId = button.getAttribute('data-unarchive-program-id') || '';
      const nola = button.getAttribute('data-unarchive-nola') || '';
      const title = button.getAttribute('data-unarchive-title') || '';
      const rightsEnd = button.getAttribute('data-unarchive-rights-end') || '';
      const row = App.programLinks?.resolveRow?.(programId) || App.data.resolveProgramSnapshot?.(programId) || null;
      const payload = {};
      if (!row || Object.prototype.hasOwnProperty.call(row, 'is_archived')) payload.is_archived = false;
      if (!row || Object.prototype.hasOwnProperty.call(row, 'archived')) payload.archived = false;
      if (!row || Object.prototype.hasOwnProperty.call(row, 'inactive_flag')) payload.inactive_flag = false;
      if (!row || Object.prototype.hasOwnProperty.call(row, 'status')) payload.status = 'active';
      if (!row || Object.prototype.hasOwnProperty.call(row, 'library_state')) payload.library_state = 'active';
      if (!Object.keys(payload).length) {
        setNotice('This row did not expose archive fields to clear.', 'warn');
        return;
      }
      const priorText = button.textContent;
      button.disabled = true;
      button.textContent = 'Working…';
      setNotice('Removing archive flag…');
      const response = await App.data.unarchiveProgram({
        id: dbId || row?.id,
        program_id: programDbId || row?.program_id,
        nola_code: nola || row?.nola_code || row?.nola,
        title: title || row?.title || row?.program_title
      }, payload);
      if (response?.error) {
        console.error(response.error);
        button.disabled = false;
        button.textContent = priorText;
        setNotice(response.error.message || 'Could not remove archive flag.', 'warn');
        return;
      }

      const parsedRightsEnd = App.utils.parseDateLike ? App.utils.parseDateLike(rightsEnd, { preferDateOnlyLocal: true }) : null;
      const today = new Date();
      const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const rightsStillExpired = parsedRightsEnd instanceof Date && !Number.isNaN(parsedRightsEnd.getTime())
        ? new Date(parsedRightsEnd.getFullYear(), parsedRightsEnd.getMonth(), parsedRightsEnd.getDate()) < todayLocal
        : false;

      const matchesTarget = (candidate) => {
        if (!candidate) return false;
        const candidateId = String(App.derive.programId(candidate) || '').trim();
        if (programId && candidateId === String(programId).trim()) return true;
        if (dbId && String(candidate?.id || '').trim() === String(dbId).trim()) return true;
        if (programDbId && String(candidate?.program_id || '').trim() === String(programDbId).trim()) return true;
        if (nola && title) {
          return App.utils.normalizeLookupKey(App.derive.nola(candidate) || '') === App.utils.normalizeLookupKey(nola)
            && App.utils.normalizeLookupKey(App.derive.title(candidate) || '') === App.utils.normalizeLookupKey(title);
        }
        return false;
      };

      const applyLocalRestore = (candidate) => {
        if (!matchesTarget(candidate)) return candidate;
        candidate.is_archived = false;
        candidate.archived = false;
        candidate.inactive_flag = false;
        candidate.status = 'active';
        candidate.library_state = 'active';
        if (rightsStillExpired) candidate.__preserve_visible = true;
        else delete candidate.__preserve_visible;
        return candidate;
      };

      (state.baseRows || []).forEach(applyLocalRestore);
      (state.rawRows || []).forEach(applyLocalRestore);
      if (state.currentDetailProgram) applyLocalRestore(state.currentDetailProgram);

      if (rightsStillExpired) {
        state.statusFilter = 'active';
        if (els.statusFilter) els.statusFilter.value = 'active';
        App.listUi.applyLibraryView();
        setNotice('Archive flag cleared. This title still has a past rights-end date, so I moved it into Active only temporarily so you can edit and extend the date.');
      } else {
        App.listUi.applyLibraryView();
        setNotice('Archive flag cleared.');
      }
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
    els.addProgramButton?.addEventListener('click', () => App.detailUi.openCreateProgram());
    els.detailEditButton.addEventListener('click', () => { if (App.auth.canEdit()) App.detailUi.setDetailMode('edit'); });
    els.detailCancelEditButton?.addEventListener('click', () => {
      setDetailNotice('');
      if (state.detailCreateMode) App.detailUi.closeDetailModal();
      else App.detailUi.setDetailMode('view');
    });
    els.detailEditForm?.addEventListener('input', () => App.detailUi.handleEditorInput?.());
    els.detailTimingEditor?.addEventListener('input', () => App.detailUi.syncTimingDraftFromDom?.());
    els.detailTimingEditor?.addEventListener('click', (event) => {
      const removeButton = event.target.closest('.detail-remove-timing-row-button');
      if (!removeButton) return;
      const rowIndex = Number(removeButton.getAttribute('data-timing-row-index') || -1);
      if (rowIndex >= 0) App.detailUi.removeTimingDraftRow?.(rowIndex);
    });
    els.detailAddTimingRowButton?.addEventListener('click', () => App.detailUi.addTimingDraftRow?.());
    els.detailEditForm?.addEventListener('submit', async (event) => {
      try {
        await App.detailUi.saveDetailEdit(event);
      } catch (error) {
        console.error(error);
        setDetailNotice(error.message || 'Save failed.', 'bad');
        setNotice(error.message || 'Save failed.', 'warn');
      }
    });

    App.workspaceUi?.bindEvents();
    App.schedulingUi?.bindEvents();
    App.importsUi?.bindEvents();
    App.performanceUi?.bindEvents();
  }



  function ensureMobileModeControls() {
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    document.body.classList.toggle('phone-ui', mobile);

    const libraryPane = document.querySelector('[data-workspace-pane="library"]');
    if (libraryPane) {
      let row = libraryPane.querySelector('.mobile-mode-row.library-mobile-modes');
      if (!row) {
        row = document.createElement('div');
        row.className = 'mobile-mode-row library-mobile-modes';
        row.innerHTML = '<button type="button" class="mobile-mode-button active" data-mobile-target="filters">Filters</button><button type="button" class="mobile-mode-button" data-mobile-target="programs">Programs</button>';
        libraryPane.insertBefore(row, libraryPane.firstElementChild);
        row.addEventListener('click', (event) => {
          const button = event.target.closest('[data-mobile-target]');
          if (!button) return;
          libraryPane.dataset.mobileMode = button.dataset.mobileTarget;
          row.querySelectorAll('.mobile-mode-button').forEach((item) => item.classList.toggle('active', item === button));
        });
      }
      if (!libraryPane.dataset.mobileMode) libraryPane.dataset.mobileMode = 'programs';
      row.querySelectorAll('.mobile-mode-button').forEach((item) => item.classList.toggle('active', item.dataset.mobileTarget === libraryPane.dataset.mobileMode));
    }

    const performancePane = document.querySelector('[data-workspace-pane="performance"]');
    if (performancePane) {
      let row = performancePane.querySelector('.mobile-mode-row.performance-mobile-modes');
      if (!row) {
        row = document.createElement('div');
        row.className = 'mobile-mode-row performance-mobile-modes';
        row.innerHTML = '<button type="button" class="mobile-mode-button active" data-mobile-target="results">Results</button><button type="button" class="mobile-mode-button" data-mobile-target="filters">Filters</button><button type="button" class="mobile-mode-button" data-mobile-target="explain">Explain</button>';
        performancePane.insertBefore(row, performancePane.firstElementChild);
        row.addEventListener('click', (event) => {
          const button = event.target.closest('[data-mobile-target]');
          if (!button) return;
          performancePane.dataset.mobileMode = button.dataset.mobileTarget;
          row.querySelectorAll('.mobile-mode-button').forEach((item) => item.classList.toggle('active', item === button));
        });
      }
      if (!performancePane.dataset.mobileMode) performancePane.dataset.mobileMode = 'results';
      row.querySelectorAll('.mobile-mode-button').forEach((item) => item.classList.toggle('active', item.dataset.mobileTarget === performancePane.dataset.mobileMode));
    }

    const schedulingPane = document.querySelector('[data-workspace-pane="scheduling"]');
    if (schedulingPane) {
      let row = schedulingPane.querySelector('.mobile-mode-row.scheduling-mobile-modes');
      if (!row) {
        row = document.createElement('div');
        row.className = 'mobile-mode-row scheduling-mobile-modes';
        row.innerHTML = '<button type="button" class="mobile-mode-button active" data-mobile-target="calendar">Calendar</button><button type="button" class="mobile-mode-button" data-mobile-target="details">Details</button>';
        schedulingPane.insertBefore(row, schedulingPane.firstElementChild);
        row.addEventListener('click', (event) => {
          const button = event.target.closest('[data-mobile-target]');
          if (!button) return;
          schedulingPane.dataset.mobileMode = button.dataset.mobileTarget;
          row.querySelectorAll('.mobile-mode-button').forEach((item) => item.classList.toggle('active', item === button));
        });
      }
      if (!schedulingPane.dataset.mobileMode) schedulingPane.dataset.mobileMode = 'calendar';
      row.querySelectorAll('.mobile-mode-button').forEach((item) => item.classList.toggle('active', item.dataset.mobileTarget === schedulingPane.dataset.mobileMode));
    }
  }

  App.app = { refreshAll, bindEvents, ensureMobileModeControls };
})();

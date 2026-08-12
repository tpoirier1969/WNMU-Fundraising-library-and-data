(() => {
  'use strict';

  let initialized = false;
  let patched = false;

  const app = () => window.PledgeLib;
  const text = (value) => String(value ?? '').trim();

  function workspace() {
    const App = app();
    if (text(App?.state?.activeWorkspace)) return text(App.state.activeWorkspace);
    return text(document.querySelector('[data-workspace-pane]:not(.hidden)')?.dataset?.workspacePane || 'library');
  }

  function inLibrary() {
    return workspace() === 'library';
  }

  function elements() {
    return {
      modal: document.getElementById('detail-modal'),
      backdrop: document.getElementById('detail-backdrop'),
      host: document.getElementById('library-split-detail-host'),
      addButton: document.getElementById('library-split-add-button')
    };
  }

  function embed({ show = true } = {}) {
    const App = app();
    const { modal, backdrop, host, addButton } = elements();
    if (!modal || !host) return;
    if (modal.parentElement !== host) host.append(modal);
    document.body.classList.add('library-detail-embedded');
    document.body.classList.remove('library-detail-popup');
    if (show) modal.classList.remove('hidden');
    backdrop?.classList.add('hidden');
    document.body.classList.remove('modal-open');
    addButton?.classList.toggle('hidden', !App?.auth?.canEdit?.());
  }

  function popup({ hide = false } = {}) {
    const { modal, backdrop, addButton } = elements();
    if (!modal || !backdrop) return;
    if (modal.parentElement !== backdrop.parentElement || modal.previousElementSibling !== backdrop) {
      backdrop.insertAdjacentElement('afterend', modal);
    }
    document.body.classList.remove('library-detail-embedded');
    document.body.classList.add('library-detail-popup');
    addButton?.classList.add('hidden');
    if (hide) {
      modal.classList.add('hidden');
      backdrop.classList.add('hidden');
      document.body.classList.remove('modal-open');
    }
  }

  function sync({ hidePopup = true } = {}) {
    if (inLibrary()) embed({ show: true });
    else popup({ hide: hidePopup });
  }

  function scheduleSync(options = {}) {
    window.setTimeout(() => sync(options), 0);
    window.setTimeout(() => sync(options), 30);
  }

  function patchWorkflows() {
    if (patched) return;
    const App = app();
    if (!App?.detailUi || !App?.libraryLoader || !App?.auth || !App?.workspaceUi) return;
    patched = true;

    const load = App.detailUi.loadProgramDetail?.bind(App.detailUi);
    if (load) {
      App.detailUi.loadProgramDetail = async (...args) => {
        const libraryMode = inLibrary();
        if (libraryMode) embed({ show: true });
        else popup({ hide: true });
        const result = await load(...args);
        if (libraryMode && inLibrary()) embed({ show: true });
        else popup({ hide: false });
        return result;
      };
    }

    const create = App.detailUi.openCreateProgram?.bind(App.detailUi);
    if (create) {
      App.detailUi.openCreateProgram = (...args) => {
        const libraryMode = inLibrary();
        if (libraryMode) embed({ show: true });
        else popup({ hide: true });
        const result = create(...args);
        if (libraryMode) embed({ show: true });
        else popup({ hide: false });
        return result;
      };
    }

    const close = App.detailUi.closeDetailModal?.bind(App.detailUi);
    if (close) {
      App.detailUi.closeDetailModal = (...args) => {
        const libraryMode = inLibrary();
        const result = close(...args);
        if (libraryMode) embed({ show: true });
        else popup({ hide: true });
        return result;
      };
    }

    const refresh = App.libraryLoader.refreshAll?.bind(App.libraryLoader);
    if (refresh) {
      App.libraryLoader.refreshAll = async (...args) => {
        const result = await refresh(...args);
        scheduleSync({ hidePopup: !inLibrary() });
        return result;
      };
    }

    const role = App.auth.setRoleUi?.bind(App.auth);
    if (role) {
      App.auth.setRoleUi = (...args) => {
        const result = role(...args);
        scheduleSync({ hidePopup: !inLibrary() });
        return result;
      };
    }

    const setWorkspace = App.workspaceUi.setWorkspace?.bind(App.workspaceUi);
    if (setWorkspace) {
      App.workspaceUi.setWorkspace = (workspaceId, ...args) => {
        const target = text(workspaceId || 'library');
        if (target !== 'library') popup({ hide: true });
        const result = setWorkspace(workspaceId, ...args);
        scheduleSync({ hidePopup: target !== 'library' });
        return result;
      };
    }
  }

  function bindCaptureGuards() {
    document.addEventListener('click', (event) => {
      const workspaceButton = event.target?.closest?.('[data-workspace-button]');
      if (workspaceButton) {
        const target = text(workspaceButton.dataset.workspaceButton || 'library');
        if (target !== 'library') popup({ hide: true });
        scheduleSync({ hidePopup: target !== 'library' });
        return;
      }

      if (event.target?.closest?.('[data-program-open-id], [data-open-id]')) {
        if (inLibrary()) embed({ show: true });
        else popup({ hide: true });
      }
    }, true);
  }

  function initialize() {
    if (initialized) return;
    const App = app();
    if (!App?.detailUi || !App?.libraryLoader || !App?.auth || !App?.workspaceUi) {
      window.setTimeout(initialize, 30);
      return;
    }
    initialized = true;
    patchWorkflows();
    bindCaptureGuards();
    sync({ hidePopup: !inLibrary() });
  }

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();

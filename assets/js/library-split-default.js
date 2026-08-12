(() => {
  'use strict';
  const WIDTH_KEY = 'wnmuPledgeLibrarySplitWidthV1';
  const SECTION_KEY = 'wnmuPledgeLibraryDetailSection:';
  const DUPLICATE_LABELS = new Set([
    'title', 'nola code', 'topic primary', 'topic secondary', 'distributor', 'package type', 'source format',
    'length bucket minutes', 'actual runtime seconds', 'actual runtime minutes', 'runtime minutes',
    'rights start', 'rights end', 'rights notes', 'premium summary', 'program notes', 'status', 'library state',
    'last aired at', 'last aired', 'total contributions', 'avg contribution per drive', 'average per fundraiser'
  ]);
  const TECHNICAL_LABEL = /^(?:id|program id|source row number|created at|updated at|created by|updated by|row hash|supplement match method|match method|match reason|review status)$/i;
  let initialized = false;
  let patched = false;
  let detailLoads = 0;
  let openingDefault = false;

  const app = () => window.PledgeLib;
  const text = (value) => String(value ?? '').trim();

  function keepDetailEmbedded() {
    document.getElementById('detail-modal')?.classList.remove('hidden');
    document.getElementById('detail-backdrop')?.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  function setSplitView(next = 'library') {
    const pane = document.querySelector('[data-workspace-pane="library"]');
    const libraryButton = document.getElementById('library-split-library-button');
    const detailButton = document.getElementById('library-split-detail-button');
    if (!pane || !libraryButton || !detailButton) return;
    const view = next === 'detail' ? 'detail' : 'library';
    pane.dataset.librarySplitView = view;
    libraryButton.classList.toggle('active', view === 'library');
    detailButton.classList.toggle('active', view === 'detail');
  }

  function showViewerAddScreen() {
    const App = app();
    const title = document.getElementById('detail-title');
    const subtitle = document.getElementById('detail-subtitle');
    const empty = document.getElementById('detail-empty');
    const content = document.getElementById('detail-content');
    if (!App || !title || !subtitle || !empty || !content) return;
    App.state.selectedProgramId = null;
    App.state.detailCreateMode = false;
    App.state.detailEditMode = false;
    App.listUi?.syncSelectedRows?.();
    title.textContent = 'Add Program';
    subtitle.textContent = 'Administrator access is required to create a pledge title.';
    content.classList.add('hidden');
    empty.classList.remove('hidden');
    empty.innerHTML = '<div class="split-empty-card"><h3>Add Program</h3><p>Sign in as an administrator to create or edit pledge programs.</p><button type="button" class="primary" id="library-split-signin-button">Admin sign in</button></div>';
    document.getElementById('library-split-signin-button')?.addEventListener('click', () => document.getElementById('admin-button')?.click());
    keepDetailEmbedded();
  }

  function ensureDefaultPane(force = false) {
    const App = app();
    if (!initialized || !App?.detailUi || !App?.auth || detailLoads || App.state?.detailSaveInProgress) return false;
    if (text(App.state?.selectedProgramId)) {
      keepDetailEmbedded();
      return false;
    }
    if (!App.auth.canEdit()) {
      showViewerAddScreen();
      return true;
    }
    const form = document.getElementById('detail-edit-form');
    const content = document.getElementById('detail-content');
    const ready = App.state.detailCreateMode && !form?.classList.contains('hidden') && !content?.classList.contains('hidden');
    if (ready && !force) {
      keepDetailEmbedded();
      return true;
    }
    if (openingDefault) return false;
    openingDefault = true;
    try {
      App.state.selectedProgramId = '';
      App.listUi?.syncSelectedRows?.();
      App.detailUi.openCreateProgram();
      keepDetailEmbedded();
    } finally {
      window.setTimeout(() => { openingDefault = false; }, 0);
    }
    return true;
  }

  function syncAdditionalFields() {
    const source = document.getElementById('all-fields-list');
    const wrap = document.getElementById('library-additional-program-details');
    const output = document.getElementById('library-additional-program-grid');
    if (!source || !wrap || !output) return;
    const rows = [];
    source.querySelectorAll('.raw-grid > div').forEach((row) => {
      const label = row.querySelector('dt')?.textContent.trim() || '';
      const normalized = label.toLowerCase();
      if (!label || DUPLICATE_LABELS.has(normalized) || TECHNICAL_LABEL.test(label) || /^resolved\b/i.test(label)) return;
      rows.push(row.cloneNode(true));
    });
    output.replaceChildren(...rows);
    wrap.classList.toggle('hidden', rows.length === 0);
  }

  function restoreDisclosureState() {
    document.querySelectorAll('[data-library-detail-section]').forEach((section) => {
      const key = section.getAttribute('data-library-detail-section') || '';
      let stored = '';
      try { stored = localStorage.getItem(SECTION_KEY + key) || ''; } catch (_error) { stored = ''; }
      if (stored) section.open = stored === 'open';
      section.addEventListener('toggle', () => {
        try { localStorage.setItem(SECTION_KEY + key, section.open ? 'open' : 'closed'); } catch (_error) { /* ignore */ }
      });
    });
  }

  function installDivider() {
    const pane = document.querySelector('[data-workspace-pane="library"]');
    const divider = document.getElementById('library-split-divider');
    if (!pane || !divider) return;
    let stored = 0;
    try { stored = Number(localStorage.getItem(WIDTH_KEY)); } catch (_error) { stored = 0; }
    if (stored >= 34 && stored <= 68) document.documentElement.style.setProperty('--library-split-left', stored + '%');
    let dragging = false;
    const move = (clientX) => {
      const rect = pane.getBoundingClientRect();
      const next = Math.min(68, Math.max(34, ((clientX - rect.left) / rect.width) * 100));
      document.documentElement.style.setProperty('--library-split-left', next + '%');
      try { localStorage.setItem(WIDTH_KEY, next.toFixed(2)); } catch (_error) { /* ignore */ }
    };
    divider.addEventListener('pointerdown', (event) => {
      dragging = true;
      divider.classList.add('dragging');
      divider.setPointerCapture(event.pointerId);
      move(event.clientX);
    });
    divider.addEventListener('pointermove', (event) => { if (dragging) move(event.clientX); });
    const stop = (event) => {
      dragging = false;
      divider.classList.remove('dragging');
      if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
    };
    divider.addEventListener('pointerup', stop);
    divider.addEventListener('pointercancel', stop);
  }

  function patchWorkflows() {
    if (patched) return;
    const App = app();
    if (!App?.detailUi || !App?.libraryLoader || !App?.auth) return;
    patched = true;

    const originalLoad = App.detailUi.loadProgramDetail?.bind(App.detailUi);
    if (originalLoad) {
      App.detailUi.loadProgramDetail = async (programId, options = {}) => {
        detailLoads += 1;
        try {
          const nextOptions = Object.prototype.hasOwnProperty.call(options, 'preserveMode')
            ? options
            : { ...options, preserveMode: Boolean(App.auth.canEdit()) };
          const result = await originalLoad(programId, nextOptions);
          keepDetailEmbedded();
          if (result !== false && text(App.state.selectedProgramId)) setSplitView('detail');
          return result;
        } finally {
          detailLoads = Math.max(0, detailLoads - 1);
          if (!text(App.state.selectedProgramId)) window.setTimeout(() => ensureDefaultPane(), 0);
        }
      };
    }

    const originalCreate = App.detailUi.openCreateProgram?.bind(App.detailUi);
    if (originalCreate) {
      App.detailUi.openCreateProgram = (...args) => {
        const result = originalCreate(...args);
        keepDetailEmbedded();
        if (!openingDefault) setSplitView('detail');
        return result;
      };
    }

    const originalClose = App.detailUi.closeDetailModal?.bind(App.detailUi);
    if (originalClose) {
      App.detailUi.closeDetailModal = (...args) => {
        const wasCreate = Boolean(App.state.detailCreateMode);
        const result = originalClose(...args);
        keepDetailEmbedded();
        if (wasCreate) {
          App.state.selectedProgramId = '';
          App.listUi?.syncSelectedRows?.();
          window.setTimeout(() => ensureDefaultPane(true), 0);
        } else if (!text(App.state.selectedProgramId)) {
          window.setTimeout(() => ensureDefaultPane(true), 0);
        }
        return result;
      };
    }

    const originalDelete = App.detailUi.deleteCurrentProgram?.bind(App.detailUi);
    if (originalDelete) {
      App.detailUi.deleteCurrentProgram = async (...args) => {
        const result = await originalDelete(...args);
        window.setTimeout(() => ensureDefaultPane(true), 0);
        return result;
      };
    }

    const originalRefresh = App.libraryLoader.refreshAll?.bind(App.libraryLoader);
    if (originalRefresh) {
      App.libraryLoader.refreshAll = async (...args) => {
        const result = await originalRefresh(...args);
        window.setTimeout(() => ensureDefaultPane(), 0);
        return result;
      };
    }

    const originalSetRoleUi = App.auth.setRoleUi?.bind(App.auth);
    if (originalSetRoleUi) {
      App.auth.setRoleUi = (...args) => {
        const result = originalSetRoleUi(...args);
        const addButton = document.getElementById('library-split-add-button');
        addButton?.classList.toggle('hidden', !App.auth.canEdit());
        window.setTimeout(() => ensureDefaultPane(Boolean(App.auth.canEdit())), 0);
        return result;
      };
    }
  }

  function bindControls() {
    document.getElementById('library-split-library-button')?.addEventListener('click', () => setSplitView('library'));
    document.getElementById('library-split-detail-button')?.addEventListener('click', () => setSplitView('detail'));
    document.getElementById('library-split-add-button')?.addEventListener('click', () => {
      const App = app();
      if (!App) return;
      if (App.state?.detailDirty && !window.confirm('Discard unsaved edits and open a blank Add Program form?')) return;
      App.state.selectedProgramId = '';
      App.listUi?.syncSelectedRows?.();
      if (App.auth?.canEdit?.()) ensureDefaultPane(true);
      else showViewerAddScreen();
      setSplitView('detail');
    });

    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('[data-program-open-id], [data-open-id]')) {
        setSplitView('detail');
        keepDetailEmbedded();
      }
    }, true);
  }

  function initialize() {
    if (initialized) return;
    const App = app();
    if (!App?.detailUi || !App?.libraryLoader || !App?.auth || !App?.listUi) {
      window.setTimeout(initialize, 30);
      return;
    }
    initialized = true;
    restoreDisclosureState();
    installDivider();
    bindControls();
    patchWorkflows();
    keepDetailEmbedded();
    setSplitView('library');

    const allFields = document.getElementById('all-fields-list');
    if (allFields) {
      new MutationObserver(syncAdditionalFields).observe(allFields, { childList: true, subtree: true, characterData: true });
      syncAdditionalFields();
    }

    const addButton = document.getElementById('library-split-add-button');
    addButton?.classList.toggle('hidden', !App.auth.canEdit());
    window.setTimeout(() => ensureDefaultPane(true), 0);
  }

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();

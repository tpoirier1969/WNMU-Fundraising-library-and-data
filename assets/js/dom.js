(() => {
  const App = window.PledgeLib;
  const els = {
    authShell: document.getElementById('auth-shell'),
    authMessage: document.getElementById('auth-message'),
    loginGitHubButton: document.getElementById('login-github-button'),
    cancelLoginButton: document.getElementById('cancel-login-button'),
    configStatus: document.getElementById('config-status'),
    buildMeta: document.getElementById('build-meta'),
    roleChip: document.getElementById('role-chip'),
    versionFlag: document.getElementById('version-flag'),
    footerVersion: document.getElementById('footer-version'),
    workspaceButtons: [...document.querySelectorAll('[data-workspace-button]')],
    workspacePanes: [...document.querySelectorAll('[data-workspace-pane]')],
    workspaceTitle: document.getElementById('workspace-title'),
    workspaceStatus: document.getElementById('workspace-status'),
    scaffoldLibraryCount: document.getElementById('scaffold-library-count'),
    scaffoldTopicGapCount: document.getElementById('scaffold-topic-gap-count'),
    scaffoldDistributorGapCount: document.getElementById('scaffold-distributor-gap-count'),
    searchFieldSelect: document.getElementById('search-field-select'),
    searchInput: document.getElementById('search-input'),
    topicFilter: document.getElementById('topic-filter'),
    secondaryTopicFilter: document.getElementById('secondary-topic-filter'),
    lengthFilter: document.getElementById('length-filter'),
    distributorFilter: document.getElementById('distributor-filter'),
    statusFilter: document.getElementById('status-filter'),
    sortFieldSelect: document.getElementById('sort-field-select'),
    sortDirectionButton: document.getElementById('sort-direction-button'),
    resetFiltersButton: document.getElementById('reset-filters-button'),
    refreshButton: document.getElementById('refresh-button'),
    adminButton: document.getElementById('admin-button'),
    logoutButton: document.getElementById('logout-button'),
    libraryBody: document.getElementById('library-body'),
    resultSummary: document.getElementById('result-summary'),
    detailBackdrop: document.getElementById('detail-backdrop'),
    detailModal: document.getElementById('detail-modal'),
    detailCloseButton: document.getElementById('detail-close-button'),
    detailEditButton: document.getElementById('detail-edit-button'),
    detailTitle: document.getElementById('detail-title'),
    detailSubtitle: document.getElementById('detail-subtitle'),
    detailNotice: document.getElementById('detail-notice'),
    detailEmpty: document.getElementById('detail-empty'),
    detailContent: document.getElementById('detail-content'),
    detailEditForm: document.getElementById('detail-edit-form'),
    detailSaveButton: document.getElementById('detail-save-button'),
    detailCancelEditButton: document.getElementById('detail-cancel-edit-button'),
    overviewGrid: document.getElementById('overview-grid'),
    timingList: document.getElementById('timing-list'),
    airingList: document.getElementById('airing-list'),
    premiumsList: document.getElementById('premiums-list'),
    timingCountChip: document.getElementById('timing-count-chip'),
    airingCountChip: document.getElementById('airing-count-chip'),
    premiumCountChip: document.getElementById('premium-count-chip')
  };

  function setNotice(text, type = '') {
    if (!els.configStatus) return;
    els.configStatus.textContent = text;
    els.configStatus.className = 'status-line';
    if (type) els.configStatus.classList.add(type);
  }

  function setBuildMeta(text = '') {
    if (!els.buildMeta) return;
    els.buildMeta.textContent = text;
    els.buildMeta.classList.toggle('hidden', !text);
  }

  function setDetailNotice(text, type = '') {
    if (!text) {
      els.detailNotice.className = 'notice-strip hidden';
      els.detailNotice.textContent = '';
      return;
    }
    els.detailNotice.textContent = text;
    els.detailNotice.className = 'notice-strip';
    if (type) els.detailNotice.classList.add(type);
  }

  function renderSelectOptions(select, values, currentValue, placeholder) {
    if (!select) return;
    const escapeHtml = App.utils.escapeHtml;
    const options = [`<option value="">${escapeHtml(placeholder)}</option>`];
    values.forEach((value) => {
      const selected = currentValue === value ? 'selected' : '';
      options.push(`<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(value)}</option>`);
    });
    select.innerHTML = options.join('');
  }

  App.dom = {
    els,
    setNotice,
    setBuildMeta,
    setDetailNotice,
    renderSelectOptions
  };
})();

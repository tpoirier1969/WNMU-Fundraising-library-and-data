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
    loadingBanner: document.getElementById('loading-banner'),
    loadingTitle: document.getElementById('loading-title'),
    loadingDetail: document.getElementById('loading-detail'),
    workspaceButtons: [...document.querySelectorAll('[data-workspace-button]')],
    workspacePanes: [...document.querySelectorAll('[data-workspace-pane]')],
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
    sortHeaderButtons: [...document.querySelectorAll('[data-sort-field]')],
    resetFiltersButton: document.getElementById('reset-filters-button'),
    refreshButton: document.getElementById('refresh-button'),
    adminButton: document.getElementById('admin-button'),
    logoutButton: document.getElementById('logout-button'),
    addProgramButton: document.getElementById('add-program-button'),
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
    detailFormHeading: document.getElementById('detail-form-heading'),
    detailCancelEditButton: document.getElementById('detail-cancel-edit-button'),
    overviewGrid: document.getElementById('overview-grid'),
    detailProgramMeta: document.getElementById('detail-program-meta'),
    detailProgramDescription: document.getElementById('detail-program-description'),
    timingList: document.getElementById('timing-list'),
    airingList: document.getElementById('airing-list'),
    premiumsList: document.getElementById('premiums-list'),
    allFieldsList: document.getElementById('all-fields-list'),
    timingCountChip: document.getElementById('timing-count-chip'),
    airingCountChip: document.getElementById('airing-count-chip'),
    premiumCountChip: document.getElementById('premium-count-chip'),
    scheduleList: document.getElementById('schedule-list'),
    scheduleSummary: document.getElementById('schedule-summary'),
    newScheduleButton: document.getElementById('new-schedule-button'),
    scheduleEditor: document.getElementById('schedule-editor'),
    scheduleEmpty: document.getElementById('schedule-empty'),
    scheduleForm: document.getElementById('schedule-form'),
    fundraiserTitleInput: document.getElementById('fundraiser-title-input'),
    fundraiserStartInput: document.getElementById('fundraiser-start-input'),
    fundraiserEndInput: document.getElementById('fundraiser-end-input'),
    fundraiserOnlineInput: document.getElementById('fundraiser-online-input'),
    fundraiserMailInput: document.getElementById('fundraiser-mail-input'),
    fundraiserBroadcastTotal: document.getElementById('fundraiser-broadcast-total'),
    fundraiserReportTotal: document.getElementById('fundraiser-report-total'),
    fundraiserImportTotal: document.getElementById('fundraiser-import-total'),
    fundraiserImportDifference: document.getElementById('fundraiser-import-difference'),
    fundraiserGrandTotal: document.getElementById('fundraiser-grand-total'),
    fundraiserBroadcastDiagnostic: document.getElementById('fundraiser-broadcast-diagnostic'),
    scheduleGenerateButton: document.getElementById('schedule-generate-button'),
    scheduleBuildFromImportsButton: document.getElementById('schedule-build-from-imports-button'),
    scheduleRebuildFromImportsButton: document.getElementById('schedule-rebuild-from-imports-button'),
    scheduleZoomOutButton: document.getElementById('schedule-zoom-out-button'),
    scheduleZoomInButton: document.getElementById('schedule-zoom-in-button'),
    scheduleZoomValue: document.getElementById('schedule-zoom-value'),
    scheduleStartEarlierButton: document.getElementById('schedule-start-earlier-button'),
    scheduleStartLaterButton: document.getElementById('schedule-start-later-button'),
    scheduleEndEarlierButton: document.getElementById('schedule-end-earlier-button'),
    scheduleEndLaterButton: document.getElementById('schedule-end-later-button'),
    scheduleWindowLabel: document.getElementById('schedule-window-label'),
    scheduleGrid: document.getElementById('schedule-grid'),
    scheduleProgramPicker: document.getElementById('schedule-program-picker'),
    scheduleSlotLabel: document.getElementById('schedule-slot-label'),
    scheduleProgramSearch: document.getElementById('schedule-program-search'),
    scheduleProgramTopicSelect: document.getElementById('schedule-program-topic-select'),
    scheduleModalWarning: document.getElementById('schedule-modal-warning'),
    scheduleProgramResults: document.getElementById('schedule-program-results'),
    scheduleSelectedPreview: document.getElementById('schedule-selected-preview'),
    scheduleNonPledgeToggle: document.getElementById('schedule-non-pledge-toggle'),
    scheduleLiveBreakFlag: document.getElementById('schedule-live-break-flag'),
    scheduleClearPlacementButton: document.getElementById('schedule-clear-placement-button'),
    scheduleCopyPlacementButton: document.getElementById('schedule-copy-placement-button'),
    schedulePastePlacementButton: document.getElementById('schedule-paste-placement-button'),
    scheduleAssignmentNote: document.getElementById('schedule-assignment-note'),
    scheduleProgramDetails: document.getElementById('schedule-program-details'),
    scheduleExportButton: document.getElementById('schedule-export-button'),
    scheduleProgramBackdrop: document.getElementById('schedule-program-backdrop'),
    scheduleProgramModal: document.getElementById('schedule-program-modal'),
    scheduleProgramCloseButton: document.getElementById('schedule-program-close-button'),
    importStatus: document.getElementById('import-status'),
    importResultBanner: document.getElementById('import-result-banner'),
    importStatusPill: document.getElementById('import-status-pill'),
    importTargetSelect: document.getElementById('import-target-select'),
    importDropZone: document.getElementById('import-drop-zone'),
    importFileInput: document.getElementById('import-file-input'),
    importRefreshButton: document.getElementById('import-refresh-button'),
    importClearButton: document.getElementById('import-clear-button'),
    importExportAiringsButton: document.getElementById('import-export-airings-button'),
    importExportDriveButton: document.getElementById('import-export-drive-button'),
    importSupabaseButton: document.getElementById('import-supabase-button'),
    importBuildScheduleButton: document.getElementById('import-build-schedule-button'),
    importSummaryGrid: document.getElementById('import-summary-grid'),
    importTableStatus: document.getElementById('import-table-status'),
    importTablePill: document.getElementById('import-table-pill'),
    importWarningList: document.getElementById('import-warning-list'),
    importFilePill: document.getElementById('import-file-pill'),
    importFileBody: document.getElementById('import-file-body'),
    importAiringsPill: document.getElementById('import-airings-pill'),
    importAiringsBody: document.getElementById('import-airings-body'),
    importDrivePill: document.getElementById('import-drive-pill'),
    importDriveBody: document.getElementById('import-drive-body'),
    importUnmatchedPill: document.getElementById('import-unmatched-pill'),
    importUnmatchedBody: document.getElementById('import-unmatched-body'),
    importApplyAllButton: document.getElementById('import-apply-all-button'),
    importExistingUnlinkedPill: document.getElementById('import-existing-unlinked-pill'),
    importExistingUnlinkedBody: document.getElementById('import-existing-unlinked-body'),
    performanceStatus: document.getElementById('performance-status'),
    performanceCriterionSelect: document.getElementById('performance-criterion-select'),
    performanceMetricSelect: document.getElementById('performance-metric-select'),
    performanceChartTypeSelect: document.getElementById('performance-chart-type-select'),
    performanceTopnSelect: document.getElementById('performance-topn-select'),
    performanceFilterInput: document.getElementById('performance-filter-input'),
    performanceStartDate: document.getElementById('performance-start-date'),
    performanceEndDate: document.getElementById('performance-end-date'),
    performanceMonthSelect: document.getElementById('performance-month-select'),
    performanceTopicSelect: document.getElementById('performance-topic-select'),
    performanceRefreshButton: document.getElementById('performance-refresh-button'),
    performanceExportButton: document.getElementById('performance-export-button'),
    performanceStatGrid: document.getElementById('performance-stat-grid'),
    performanceCriteriaBar: document.getElementById('performance-criteria-bar'),
    performanceExplainBody: document.getElementById('performance-explain-body'),
    performanceChartTitle: document.getElementById('performance-chart-title'),
    performanceChartPill: document.getElementById('performance-chart-pill'),
    performanceChart: document.getElementById('performance-chart'),
    performanceTableGroupHeader: document.getElementById('performance-table-group-header'),
    performanceTablePill: document.getElementById('performance-table-pill'),
    performanceTableBody: document.getElementById('performance-table-body'),
    performanceNotesPill: document.getElementById('performance-notes-pill'),
    performanceSourceNotes: document.getElementById('performance-source-notes')
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

  function setLoading(active, title = '', detail = '') {
    if (!els.loadingBanner) return;
    els.loadingBanner.classList.toggle('hidden', !active);
    if (els.loadingTitle) els.loadingTitle.textContent = title || 'Loading…';
    if (els.loadingDetail) els.loadingDetail.textContent = detail || '';
  }

  function renderSelectOptions(select, values, currentValue, placeholder) {
    if (!select) return;
    const escapeHtml = App.utils.escapeHtml;
    const options = [`<option value="">${escapeHtml(placeholder)}</option>`];
    values.forEach((entry) => {
      const value = entry && typeof entry === 'object' ? String(entry.value ?? '') : String(entry ?? '');
      const label = entry && typeof entry === 'object' ? String(entry.label ?? entry.value ?? '') : String(entry ?? '');
      const selected = currentValue === value ? 'selected' : '';
      options.push(`<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(label)}</option>`);
    });
    select.innerHTML = options.join('');
  }

  App.dom = {
    els,
    setNotice,
    setBuildMeta,
    setDetailNotice,
    setLoading,
    renderSelectOptions
  };
})();

(() => {
  const cfg = window.PLEDGE_MANAGER_CONFIG || {};
  const APP_VERSION = 'v0.6.5';
  const READ_VIEW = 'pledge_program_library_summary_v2';
  const BASE_TABLE = 'pledge_programs_v2';
  const TIMING_TABLE = 'pledge_program_timings_v2';
  const DRIVE_RESULTS_TABLE = 'pledge_program_drive_results_v2';
  const AIRINGS_TABLE = 'pledge_program_airings_v2';
  const ADMIN_EMAILS = Array.isArray(cfg.ADMIN_EMAILS)
    ? cfg.ADMIN_EMAILS.map((e) => String(e).trim().toLowerCase()).filter(Boolean)
    : [];

  const els = {
    authShell: document.getElementById('auth-shell'),
    authMessage: document.getElementById('auth-message'),
    loginGitHubButton: document.getElementById('login-github-button'),
    cancelLoginButton: document.getElementById('cancel-login-button'),
    configStatus: document.getElementById('config-status'),
    roleChip: document.getElementById('role-chip'),
    versionFlag: document.getElementById('version-flag'),
    footerVersion: document.getElementById('footer-version'),
    searchFieldSelect: document.getElementById('search-field-select'),
    searchInput: document.getElementById('search-input'),
    topicFilter: document.getElementById('topic-filter'),
    secondaryTopicFilter: document.getElementById('secondary-topic-filter'),
    lengthFilter: document.getElementById('length-filter'),
    distributorFilter: document.getElementById('distributor-filter'),
    statusFilter: document.getElementById('status-filter'),
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

  const SEARCHABLE_FIELDS = new Set([
    'title',
    'nola_code',
    'topic_primary',
    'topic_secondary',
    'distributor',
    'premium_summary',
    'program_notes'
  ]);

  const EDITABLE_FIELDS = [
    'title',
    'nola_code',
    'distributor',
    'length_bucket_minutes',
    'actual_runtime_input',
    'topic_primary',
    'topic_secondary',
    'rights_start',
    'rights_end',
    'package_type',
    'source_format',
    'rights_notes',
    'premium_summary',
    'program_notes'
  ];

  const state = {
    client: null,
    session: null,
    userEmail: null,
    isAdmin: false,
    rows: [],
    totalRows: 0,
    selectedProgramId: null,
    searchText: '',
    searchField: '',
    statusFilter: 'active',
    topicFilter: '',
    secondaryTopicFilter: '',
    lengthFilter: '',
    distributorFilter: '',
    topicOptions: [],
    secondaryTopicOptions: [],
    lengthOptions: [],
    distributorOptions: [],
    detailEditMode: false,
    currentDetailProgram: null,
    currentDetailTimings: [],
    currentDetailDriveResults: [],
    currentDetailAirings: []
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const normalizeText = (value) => String(value ?? '').trim();

  const setNotice = (text, type = '') => {
    if (!els.configStatus) return;
    els.configStatus.textContent = text;
    els.configStatus.className = 'status-line';
    if (type) els.configStatus.classList.add(type);
  };

  const setDetailNotice = (text, type = '') => {
    if (!text) {
      els.detailNotice.className = 'notice-strip hidden';
      els.detailNotice.textContent = '';
      return;
    }
    els.detailNotice.textContent = text;
    els.detailNotice.className = 'notice-strip';
    if (type) els.detailNotice.classList.add(type);
  };

  const firstNonEmpty = (...values) => {
    for (const value of values) {
      if (value === 0) return value;
      if (value === false) return value;
      const text = normalizeText(value);
      if (text) return value;
    }
    return null;
  };

  const formatDate = (value, fallback = '—') => {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatDateTime = (value, fallback = 'N/A') => {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  };

  const formatMoney = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return normalizeText(value) || '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0
    }).format(num);
  };

  const formatSeconds = (totalSeconds) => {
    const num = Number(totalSeconds);
    if (!Number.isFinite(num) || num <= 0) return '—';
    const sec = Math.round(num);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':');
  };

  const parseRuntimeInput = (value) => {
    const text = normalizeText(value);
    if (!text) return null;
    if (/^\d+$/.test(text)) return Number(text) * 60;
    const parts = text.split(':').map((part) => Number(part));
    if (parts.some((part) => Number.isNaN(part))) return null;
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    if (parts.length === 2) return (parts[0] * 60) + parts[1];
    return null;
  };

  const deriveTitle = (row) => firstNonEmpty(row.title) || 'Untitled';
  const deriveNola = (row) => firstNonEmpty(row.nola_code) || '';
  const deriveDistributor = (row) => firstNonEmpty(row.distributor) || '';
  const deriveTopicPrimary = (row) => firstNonEmpty(row.topic_primary) || '';
  const deriveTopicSecondary = (row) => firstNonEmpty(row.topic_secondary) || '';
  const deriveDescription = (row) => firstNonEmpty(row.program_notes, row.description, row.notes) || '';
  const derivePremiumSummary = (row) => firstNonEmpty(row.premium_summary) || '';
  const deriveRightsBegin = (row) => firstNonEmpty(row.rights_start) || '';
  const deriveRightsEnd = (row) => firstNonEmpty(row.rights_end) || '';
  const deriveLengthBucket = (row) => {
    const value = Number(firstNonEmpty(row.length_bucket_minutes, row.board_runtime_minutes));
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const deriveLengthLabel = (row) => {
    const value = deriveLengthBucket(row);
    return value ? String(value) : '—';
  };
  const deriveActualRuntimeLabel = (row) => formatSeconds(firstNonEmpty(row.actual_runtime_seconds));
  const deriveLastAiredDisplay = (row) => firstNonEmpty(row.last_aired_display) || 'N/A';
  const deriveIsActive = (row) => {
    if (typeof row.is_active === 'boolean') return row.is_active;
    const rightsEnd = deriveRightsEnd(row);
    if (!rightsEnd) return true;
    const date = new Date(rightsEnd);
    if (Number.isNaN(date.getTime())) return true;
    return date >= new Date(new Date().toDateString());
  };

  const compareText = (a, b) => normalizeText(a).localeCompare(normalizeText(b), undefined, { sensitivity: 'base', numeric: true });

  const premiumSummaryHtml = (value) => {
    const text = normalizeText(value);
    if (!text) return '<div class="premium-line">—</div>';
    const lines = text
      .replace(/\s*;\s*/g, '\n')
      .replace(/\s+(?=\$)/g, '\n')
      .split(/\n+/)
      .map((part) => normalizeText(part))
      .filter(Boolean);
    const finalLines = lines.length ? lines : [text];
    return finalLines.map((line) => `<div class="premium-line">${escapeHtml(line)}</div>`).join('');
  };

  const renderSelectOptions = (select, values, currentValue, placeholder) => {
    const options = [`<option value="">${escapeHtml(placeholder)}</option>`];
    values.forEach((value) => {
      const selected = currentValue === value ? 'selected' : '';
      options.push(`<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(value)}</option>`);
    });
    select.innerHTML = options.join('');
  };

  const fetchAllRows = async (table, columns, mutate) => {
    const pageSize = 1000;
    let from = 0;
    const rows = [];
    while (true) {
      let query = state.client.from(table).select(columns).range(from, from + pageSize - 1);
      if (mutate) query = mutate(query);
      const { data, error } = await query;
      if (error) throw error;
      const chunk = data || [];
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  };

  const applySearchFilter = (query) => {
    const search = normalizeText(state.searchText).replace(/,/g, ' ').replace(/%/g, '').replace(/_/g, '');
    if (!search) return query;
    const like = `%${search}%`;
    if (SEARCHABLE_FIELDS.has(state.searchField)) return query.ilike(state.searchField, like);
    return query.or([
      `title.ilike.${like}`,
      `nola_code.ilike.${like}`,
      `topic_primary.ilike.${like}`,
      `topic_secondary.ilike.${like}`,
      `distributor.ilike.${like}`,
      `premium_summary.ilike.${like}`,
      `program_notes.ilike.${like}`
    ].join(','));
  };

  const applyCommonFilters = (query) => {
    if (state.statusFilter === 'active') query = query.eq('is_active', true);
    else if (state.statusFilter === 'archived') query = query.eq('is_active', false);
    if (state.topicFilter) query = query.eq('topic_primary', state.topicFilter);
    if (state.secondaryTopicFilter) query = query.eq('topic_secondary', state.secondaryTopicFilter);
    if (state.distributorFilter) query = query.eq('distributor', state.distributorFilter);
    query = applySearchFilter(query);
    return query;
  };

  const filterRowsByLength = (rows) => {
    if (!state.lengthFilter) return rows;
    return rows.filter((row) => deriveLengthLabel(row) === state.lengthFilter);
  };

  const sortRows = (rows) => [...rows].sort((a, b) => {
    const topicCompare = compareText(deriveTopicPrimary(a), deriveTopicPrimary(b));
    if (topicCompare !== 0) return topicCompare;
    return compareText(deriveTitle(a), deriveTitle(b));
  });

  const buildFilterOptions = async () => {
    const rows = await fetchAllRows(READ_VIEW, 'id, title, topic_primary, topic_secondary, distributor, length_bucket_minutes, board_runtime_minutes, is_active', (query) => query.order('topic_primary', { ascending: true }).order('title', { ascending: true }));
    state.topicOptions = Array.from(new Set(rows.map((row) => deriveTopicPrimary(row)).filter(Boolean))).sort(compareText);
    state.secondaryTopicOptions = Array.from(new Set(rows.map((row) => deriveTopicSecondary(row)).filter(Boolean))).sort(compareText);
    state.distributorOptions = Array.from(new Set(rows.map((row) => deriveDistributor(row)).filter(Boolean))).sort(compareText);
    state.lengthOptions = Array.from(new Set(rows.map((row) => deriveLengthLabel(row)).filter((value) => value && value !== '—'))).sort((a, b) => Number(a) - Number(b));

    renderSelectOptions(els.topicFilter, state.topicOptions, state.topicFilter, 'All topics');
    renderSelectOptions(els.secondaryTopicFilter, state.secondaryTopicOptions, state.secondaryTopicFilter, 'All secondary topics');
    renderSelectOptions(els.lengthFilter, state.lengthOptions, state.lengthFilter, 'All lengths');
    renderSelectOptions(els.distributorFilter, state.distributorOptions, state.distributorFilter, 'All distributors');
  };

  const renderRows = () => {
    if (!state.rows.length) {
      els.libraryBody.innerHTML = '<tr><td colspan="8" class="placeholder-row">No matching pledge titles found.</td></tr>';
      return;
    }

    els.libraryBody.innerHTML = state.rows.map((row) => `
      <tr data-id="${escapeHtml(row.id)}" class="${row.id === state.selectedProgramId ? 'selected' : ''}">
        <td class="title-cell">
          <button type="button" class="title-open-button" data-open-id="${escapeHtml(row.id)}" aria-label="Open details for ${escapeHtml(deriveTitle(row))}">
            <strong>${escapeHtml(deriveTitle(row))}</strong>
            <div class="sub">${escapeHtml(deriveNola(row) || 'No NOLA')} · ${escapeHtml(deriveDistributor(row) || 'No distributor')}</div>
            <div class="description-snippet">${escapeHtml(deriveDescription(row) || '—')}</div>
          </button>
        </td>
        <td>${escapeHtml(deriveLengthLabel(row))}</td>
        <td>${escapeHtml(deriveTopicPrimary(row) || '—')}</td>
        <td>${escapeHtml(deriveDistributor(row) || '—')}</td>
        <td class="premiums-cell">${premiumSummaryHtml(derivePremiumSummary(row))}</td>
        <td>${escapeHtml(formatDate(deriveRightsBegin(row)))}</td>
        <td>${escapeHtml(formatDate(deriveRightsEnd(row)))}</td>
        <td>${escapeHtml(deriveLastAiredDisplay(row))}</td>
      </tr>
    `).join('');
  };

  const updateSummary = () => {
    const filters = [];
    if (state.topicFilter) filters.push(`topic: ${state.topicFilter}`);
    if (state.secondaryTopicFilter) filters.push(`secondary: ${state.secondaryTopicFilter}`);
    if (state.lengthFilter) filters.push(`length: ${state.lengthFilter}`);
    if (state.distributorFilter) filters.push(`distributor: ${state.distributorFilter}`);
    filters.push(state.statusFilter === 'active' ? 'active only' : state.statusFilter === 'archived' ? 'archived only' : 'all titles');
    els.resultSummary.textContent = `${state.totalRows.toLocaleString()} titles · sorted by topic then title · ${filters.join(' · ')}`;
  };

  const syncSelectedRows = () => {
    [...els.libraryBody.querySelectorAll('tr[data-id]')].forEach((tr) => {
      tr.classList.toggle('selected', tr.dataset.id === state.selectedProgramId);
    });
  };

  const loadLibrary = async () => {
    if (!state.client) return;
    els.libraryBody.innerHTML = '<tr><td colspan="8" class="placeholder-row">Loading library…</td></tr>';
    try {
      const rows = await fetchAllRows(READ_VIEW, '*', (query) => applyCommonFilters(query)
        .order('topic_primary', { ascending: true, nullsFirst: false })
        .order('title', { ascending: true, nullsFirst: false }));
      const filteredRows = filterRowsByLength(rows);
      state.rows = sortRows(filteredRows);
      state.totalRows = state.rows.length;
      renderRows();
      updateSummary();
      syncSelectedRows();
    } catch (error) {
      console.error(error);
      els.libraryBody.innerHTML = `<tr><td colspan="8" class="placeholder-row">${escapeHtml(error.message || 'Load failed.')}</td></tr>`;
      els.resultSummary.textContent = 'Load failed.';
    }
  };

  const canEdit = () => Boolean(state.session && state.isAdmin);

  const computeAdmin = (session) => {
    const email = session?.user?.email ? String(session.user.email).toLowerCase() : null;
    if (!session) return { userEmail: null, isAdmin: false };
    if (!ADMIN_EMAILS.length) return { userEmail: email, isAdmin: true };
    return { userEmail: email, isAdmin: Boolean(email && ADMIN_EMAILS.includes(email)) };
  };

  const setRoleUi = () => {
    els.versionFlag.textContent = APP_VERSION;
    els.footerVersion.textContent = APP_VERSION;
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
  };

  const getAdminRedirectUrl = () => {
    const configured = normalizeText(cfg.ADMIN_REDIRECT_URL);
    if (configured) return configured;
    const url = new URL(window.location.href);
    url.hash = '';
    return url.toString();
  };

  const parseAuthErrorFromHash = () => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    if (!hash) return '';
    const params = new URLSearchParams(hash);
    const errorCode = params.get('error_code') || '';
    const description = params.get('error_description') || params.get('error') || '';
    if (!errorCode && !description) return '';
    return decodeURIComponent(description.replace(/\+/g, ' ')) || errorCode;
  };

  const openAuthShell = (message = '') => {
    if (els.authMessage) els.authMessage.textContent = message;
    els.authShell?.classList.remove('hidden');
  };

  const closeAuthShell = () => {
    els.authShell?.classList.add('hidden');
    if (els.authMessage) els.authMessage.textContent = '';
  };

  const labelValue = (label, value) => `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${value}</dd>
    </div>
  `;

  const detailSubtitleHtml = (program) => {
    const parts = [
      `<span class="detail-chip">Length ${escapeHtml(deriveLengthLabel(program))}</span>`,
      `<span class="detail-chip">Actual ${escapeHtml(deriveActualRuntimeLabel(program))}</span>`,
      `<span class="detail-chip">NOLA ${escapeHtml(deriveNola(program) || 'No NOLA')}</span>`,
      `<span class="detail-chip">${escapeHtml(deriveDistributor(program) || 'No distributor listed')}</span>`
    ];
    return parts.join('');
  };

  const renderOverview = (program, airings) => {
    const topicValue = [deriveTopicPrimary(program), deriveTopicSecondary(program)].filter(Boolean).join(' / ') || '—';
    const rightsNotes = normalizeText(program.rights_notes) || '—';
    const lastAired = airings.length
      ? formatDate(firstNonEmpty(airings[0].drive_date, airings[0].aired_at), 'N/A')
      : deriveLastAiredDisplay(program);
    els.overviewGrid.innerHTML = [
      labelValue('Topic', escapeHtml(topicValue)),
      labelValue('Rights begin', escapeHtml(formatDate(deriveRightsBegin(program)))),
      labelValue('Rights end', escapeHtml(formatDate(deriveRightsEnd(program)))),
      labelValue('Last aired', escapeHtml(lastAired || 'N/A')),
      labelValue('Package type', escapeHtml(normalizeText(program.package_type) || '—')),
      labelValue('Source', escapeHtml(normalizeText(program.source_format) || '—')),
      labelValue('Total contributions', escapeHtml(formatMoney(program.total_contributions))),
      labelValue('Average per drive', escapeHtml(formatMoney(program.avg_contribution_per_drive))),
      labelValue('Description', escapeHtml(deriveDescription(program) || '—')),
      labelValue('Rights notes', escapeHtml(rightsNotes)),
      labelValue('Premium summary', premiumSummaryHtml(derivePremiumSummary(program) || '—'))
    ].join('');
  };

  const renderTiming = (timings) => {
    els.timingCountChip.textContent = `${timings.length}`;
    if (!timings.length) {
      els.timingList.innerHTML = '<div class="timing-card">No detailed timing rows are available for this title.</div>';
      return;
    }
    const rows = [...timings].sort((a, b) => Number(a.slot_number || 0) - Number(b.slot_number || 0));
    els.timingList.innerHTML = `
      <article class="timing-card">
        <div class="segment-table-wrap">
          <table class="segment-table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Program segment</th>
                <th>Pledge break</th>
                <th>Local cut-in</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <td>${escapeHtml(row.slot_number ?? '—')}</td>
                  <td>${escapeHtml(formatSeconds(row.act_seconds))}</td>
                  <td>${escapeHtml(formatSeconds(row.break_seconds))}</td>
                  <td>${escapeHtml(formatSeconds(row.local_cutin_seconds))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </article>
    `;
  };

  const renderDriveResults = (airings, exactAirings) => {
    const combined = [];
    exactAirings.forEach((row) => {
      combined.push({
        when: formatDateTime(row.aired_at, 'N/A'),
        contributed: row.contribution_amount,
        note: normalizeText(firstNonEmpty(row.fundraiser_label, row.notes)) || '—'
      });
    });
    airings.forEach((row) => {
      const label = normalizeText(row.drive_label) || normalizeText(row.drive_column) || 'Drive';
      const when = row.drive_date ? `${formatDate(row.drive_date)}${row.drive_window_text ? ` · ${row.drive_window_text}` : ''}` : label;
      combined.push({
        when,
        contributed: row.contribution_amount,
        note: label
      });
    });
    els.airingCountChip.textContent = `${combined.length}`;
    if (!combined.length) {
      els.airingList.innerHTML = '<div class="premium-card">No readable drive or airing history is available for this title.</div>';
      return;
    }
    els.airingList.innerHTML = `
      <div class="airing-table-wrap">
        <table class="segment-table">
          <thead>
            <tr>
              <th>Aired / drive</th>
              <th>Contributed</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${combined.map((row) => `
              <tr>
                <td>${escapeHtml(row.when)}</td>
                <td>${escapeHtml(row.contributed == null || row.contributed === '' ? '—' : formatMoney(row.contributed))}</td>
                <td>${escapeHtml(row.note || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  const renderPremiums = (program) => {
    const text = derivePremiumSummary(program);
    const lines = normalizeText(text)
      ? normalizeText(text).replace(/\s*;\s*/g, '\n').replace(/\s+(?=\$)/g, '\n').split(/\n+/).map((line) => normalizeText(line)).filter(Boolean)
      : [];
    els.premiumCountChip.textContent = `${lines.length || 0}`;
    els.premiumsList.innerHTML = lines.length
      ? lines.map((line) => `<article class="premium-card">${escapeHtml(line)}</article>`).join('')
      : '<div class="premium-card">No premium summary is available for this title.</div>';
  };

  const renderDetail = (program, timings, driveResults, exactAirings) => {
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    els.detailTitle.textContent = deriveTitle(program);
    els.detailSubtitle.innerHTML = detailSubtitleHtml(program);
    renderOverview(program, driveResults);
    renderTiming(timings);
    renderDriveResults(driveResults, exactAirings);
    renderPremiums(program);
  };

  const showDetailFailure = (message) => {
    els.detailTitle.textContent = 'Detail load failed';
    els.detailSubtitle.textContent = message || 'Something went sideways while loading this title.';
    els.detailContent.classList.add('hidden');
    els.detailEmpty.classList.remove('hidden');
    els.detailEmpty.textContent = message || 'Something went sideways while loading this title.';
  };

  const setDetailMode = (mode = 'view') => {
    state.detailEditMode = mode === 'edit' && canEdit();
    els.detailEditForm.classList.toggle('hidden', !state.detailEditMode);
    [...els.detailContent.querySelectorAll('.detail-block')].forEach((block) => block.classList.toggle('hidden', state.detailEditMode));
    if (!state.detailEditMode) return;
    const source = state.currentDetailProgram || {};
    const form = els.detailEditForm;
    form.elements.title.value = deriveTitle(source);
    form.elements.nola_code.value = deriveNola(source);
    form.elements.distributor.value = deriveDistributor(source);
    form.elements.length_bucket_minutes.value = deriveLengthBucket(source) ?? '';
    form.elements.actual_runtime_input.value = deriveActualRuntimeLabel(source) === '—' ? '' : deriveActualRuntimeLabel(source);
    form.elements.topic_primary.value = deriveTopicPrimary(source);
    form.elements.topic_secondary.value = deriveTopicSecondary(source);
    form.elements.rights_start.value = deriveRightsBegin(source);
    form.elements.rights_end.value = deriveRightsEnd(source);
    form.elements.package_type.value = normalizeText(source.package_type);
    form.elements.source_format.value = normalizeText(source.source_format);
    form.elements.rights_notes.value = normalizeText(source.rights_notes);
    form.elements.premium_summary.value = derivePremiumSummary(source);
    form.elements.program_notes.value = deriveDescription(source);
    requestAnimationFrame(() => form.elements.title?.focus());
  };

  const openDetailModal = () => {
    els.detailModal.classList.remove('hidden');
    els.detailBackdrop.classList.remove('hidden');
    document.body.classList.add('modal-open');
  };

  const closeDetailModal = () => {
    els.detailModal.classList.add('hidden');
    els.detailBackdrop.classList.add('hidden');
    document.body.classList.remove('modal-open');
    state.selectedProgramId = null;
    state.currentDetailProgram = null;
    state.currentDetailTimings = [];
    state.currentDetailDriveResults = [];
    state.currentDetailAirings = [];
    state.detailEditMode = false;
    syncSelectedRows();
  };

  const loadProgramDetail = async (programId, options = {}) => {
    if (!programId || !state.client) return;
    state.selectedProgramId = String(programId);
    syncSelectedRows();
    openDetailModal();
    setDetailNotice('');
    els.detailTitle.textContent = 'Loading…';
    els.detailSubtitle.textContent = 'Pulling imported data.';
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    els.overviewGrid.innerHTML = '';
    els.timingList.innerHTML = '<div class="timing-card">Loading timing rows…</div>';
    els.airingList.innerHTML = '<div class="premium-card">Loading drive history…</div>';
    els.premiumsList.innerHTML = '<div class="premium-card">Loading premiums…</div>';
    setDetailMode('view');

    const rowSummary = state.rows.find((row) => String(row.id) === String(programId)) || null;
    if (rowSummary) {
      state.currentDetailProgram = rowSummary;
      renderDetail(rowSummary, [], [], []);
    }

    const [summaryResp, baseResp, timingResp, driveResp, airingsResp] = await Promise.all([
      rowSummary ? Promise.resolve({ data: rowSummary, error: null }) : state.client.from(READ_VIEW).select('*').eq('id', programId).maybeSingle(),
      state.client.from(BASE_TABLE).select('*').eq('id', programId).maybeSingle(),
      state.client.from(TIMING_TABLE).select('*').eq('program_id', programId).order('slot_number', { ascending: true }),
      state.client.from(DRIVE_RESULTS_TABLE).select('*').eq('program_id', programId).order('drive_order', { ascending: false }),
      state.client.from(AIRINGS_TABLE).select('*').eq('program_id', programId).order('aired_at', { ascending: false })
    ]);

    const summaryProgram = summaryResp.error ? null : summaryResp.data;
    const baseProgram = baseResp.error ? null : baseResp.data;
    const detailProgram = { ...(summaryProgram || {}), ...(baseProgram || {}) };
    if (!Object.keys(detailProgram).length) {
      showDetailFailure(baseResp.error?.message || summaryResp.error?.message || 'No readable detail data came back for this title.');
      return;
    }

    const timings = timingResp.error ? [] : (timingResp.data || []);
    const driveResults = driveResp.error ? [] : (driveResp.data || []);
    const exactAirings = airingsResp.error ? [] : (airingsResp.data || []);
    const warnings = [];
    if (baseResp.error) warnings.push(`Base row read warning: ${baseResp.error.message}`);
    if (timingResp.error) warnings.push(`Timing read warning: ${timingResp.error.message}`);
    if (driveResp.error) warnings.push(`Drive history read warning: ${driveResp.error.message}`);
    if (airingsResp.error) warnings.push(`Exact air history read warning: ${airingsResp.error.message}`);

    state.currentDetailProgram = detailProgram;
    state.currentDetailTimings = timings;
    state.currentDetailDriveResults = driveResults;
    state.currentDetailAirings = exactAirings;
    setDetailNotice(warnings.join(' '), warnings.length ? 'warn' : '');
    renderDetail(detailProgram, timings, driveResults, exactAirings);
    if (options.preserveMode && canEdit()) setDetailMode('edit');
    els.detailCloseButton.focus();
  };

  const saveDetailEdit = async (event) => {
    event.preventDefault();
    if (!canEdit()) return;
    const id = state.selectedProgramId;
    if (!id) return;
    const form = els.detailEditForm;
    const title = normalizeText(form.elements.title.value);
    if (!title) {
      form.elements.title.focus();
      throw new Error('Title is required.');
    }
    const payload = {
      title,
      nola_code: normalizeText(form.elements.nola_code.value) || null,
      distributor: normalizeText(form.elements.distributor.value) || null,
      length_bucket_minutes: normalizeText(form.elements.length_bucket_minutes.value) ? Number(form.elements.length_bucket_minutes.value) : null,
      actual_runtime_seconds: parseRuntimeInput(form.elements.actual_runtime_input.value),
      topic_primary: normalizeText(form.elements.topic_primary.value) || null,
      topic_secondary: normalizeText(form.elements.topic_secondary.value) || null,
      rights_start: normalizeText(form.elements.rights_start.value) || null,
      rights_end: normalizeText(form.elements.rights_end.value) || null,
      package_type: normalizeText(form.elements.package_type.value) || null,
      source_format: normalizeText(form.elements.source_format.value) || null,
      rights_notes: normalizeText(form.elements.rights_notes.value) || null,
      premium_summary: normalizeText(form.elements.premium_summary.value) || null,
      program_notes: normalizeText(form.elements.program_notes.value) || null
    };
    if (payload.length_bucket_minutes != null && !Number.isFinite(payload.length_bucket_minutes)) payload.length_bucket_minutes = null;

    setDetailNotice('Saving changes…');
    const { error } = await state.client.from(BASE_TABLE).update(payload).eq('id', id);
    if (error) throw error;
    await buildFilterOptions();
    await loadLibrary();
    await loadProgramDetail(id, { preserveMode: false });
    setDetailNotice('Changes saved.');
    setNotice('Program updated.');
    setDetailMode('view');
  };

  const initAuthRole = async () => {
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
  };

  const resetFilters = () => {
    state.searchText = '';
    state.searchField = '';
    state.statusFilter = 'active';
    state.topicFilter = '';
    state.secondaryTopicFilter = '';
    state.lengthFilter = '';
    state.distributorFilter = '';
    els.searchInput.value = '';
    els.searchFieldSelect.value = '';
    els.statusFilter.value = 'active';
    renderSelectOptions(els.topicFilter, state.topicOptions, state.topicFilter, 'All topics');
    renderSelectOptions(els.secondaryTopicFilter, state.secondaryTopicOptions, state.secondaryTopicFilter, 'All secondary topics');
    renderSelectOptions(els.lengthFilter, state.lengthOptions, state.lengthFilter, 'All lengths');
    renderSelectOptions(els.distributorFilter, state.distributorOptions, state.distributorFilter, 'All distributors');
  };

  const init = async () => {
    els.versionFlag.textContent = APP_VERSION;
    els.footerVersion.textContent = APP_VERSION;
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || String(cfg.SUPABASE_URL).includes('YOUR_PROJECT')) {
      setNotice('Fill in config.js with your Supabase URL and anon key. Until then this page is decorative.', 'warn');
      setRoleUi();
      return;
    }
    const noStoreFetch = (input, init = {}) => fetch(input, { ...init, cache: 'no-store' });
    state.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { global: { fetch: noStoreFetch } });
    const authHashError = parseAuthErrorFromHash();
    if (authHashError) {
      openAuthShell(authHashError);
      setNotice(authHashError, 'warn');
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    setNotice('Connected. Loading pledge titles from the rebuilt v2 library.');
    await initAuthRole();
    state.client.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
      const admin = computeAdmin(session);
      state.userEmail = admin.userEmail;
      state.isAdmin = admin.isAdmin;
      setRoleUi();
      if (els.detailModal && !els.detailModal.classList.contains('hidden')) {
        if (!canEdit()) setDetailMode('view');
        else if (state.detailEditMode) setDetailMode('edit');
      }
    });
    await buildFilterOptions();
    await loadLibrary();
  };

  let searchTimer = null;
  els.searchInput.addEventListener('input', (event) => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.searchText = event.target.value || '';
      void loadLibrary();
    }, 220);
  });

  els.searchFieldSelect.addEventListener('change', (event) => { state.searchField = event.target.value || ''; void loadLibrary(); });
  els.topicFilter.addEventListener('change', (event) => { state.topicFilter = event.target.value || ''; void loadLibrary(); });
  els.secondaryTopicFilter.addEventListener('change', (event) => { state.secondaryTopicFilter = event.target.value || ''; void loadLibrary(); });
  els.lengthFilter.addEventListener('change', (event) => { state.lengthFilter = event.target.value || ''; void loadLibrary(); });
  els.distributorFilter.addEventListener('change', (event) => { state.distributorFilter = event.target.value || ''; void loadLibrary(); });
  els.statusFilter.addEventListener('change', (event) => { state.statusFilter = event.target.value || 'active'; void loadLibrary(); });
  els.resetFiltersButton.addEventListener('click', () => { resetFilters(); void loadLibrary(); });
  els.refreshButton.addEventListener('click', async () => {
    await buildFilterOptions();
    await loadLibrary();
    if (state.selectedProgramId && !els.detailModal.classList.contains('hidden')) await loadProgramDetail(state.selectedProgramId);
  });
  els.libraryBody.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-open-id]');
    if (!trigger) return;
    event.preventDefault();
    void loadProgramDetail(trigger.dataset.openId);
  });
  els.detailCloseButton.addEventListener('click', closeDetailModal);
  els.detailBackdrop.addEventListener('click', closeDetailModal);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !els.detailModal.classList.contains('hidden')) closeDetailModal(); });
  els.adminButton.addEventListener('click', () => openAuthShell(''));
  els.cancelLoginButton?.addEventListener('click', closeAuthShell);
  els.loginGitHubButton?.addEventListener('click', async () => {
    if (!state.client) return;
    if (els.authMessage) els.authMessage.textContent = 'Sending you to GitHub…';
    const { error } = await state.client.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: getAdminRedirectUrl() } });
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
    setRoleUi();
    setDetailMode('view');
    setNotice('Signed out.');
  });
  els.detailEditButton.addEventListener('click', () => { if (canEdit()) setDetailMode('edit'); });
  els.detailCancelEditButton?.addEventListener('click', () => { setDetailNotice(''); setDetailMode('view'); });
  els.detailEditForm?.addEventListener('submit', async (event) => {
    try { await saveDetailEdit(event); }
    catch (error) {
      console.error(error);
      setDetailNotice(error.message || 'Save failed.', 'bad');
      setNotice(error.message || 'Save failed.', 'warn');
    }
  });

  window.addEventListener('DOMContentLoaded', () => { void init(); });
})();

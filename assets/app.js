
(() => {
  const cfg = window.PLEDGE_MANAGER_CONFIG || {};
  const APP_VERSION = 'v0.6.0';
  const PAGE_SIZE = Number(cfg.DEFAULT_PAGE_SIZE || 100);
  const ADMIN_EMAILS = Array.isArray(cfg.ADMIN_EMAILS) ? cfg.ADMIN_EMAILS.map((e) => String(e).trim().toLowerCase()) : [];

  const els = {
    configStatus: document.getElementById('config-status'),
    roleChip: document.getElementById('role-chip'),
    versionFlag: document.getElementById('version-flag'),
    footerVersion: document.getElementById('footer-version'),
    searchFieldSelect: document.getElementById('search-field-select'),
    searchInput: document.getElementById('search-input'),
    topicFilter: document.getElementById('topic-filter'),
    distributorFilter: document.getElementById('distributor-filter'),
    statusFilter: document.getElementById('status-filter'),
    clearTopicFilter: document.getElementById('clear-topic-filter'),
    resetFiltersButton: document.getElementById('reset-filters-button'),
    refreshButton: document.getElementById('refresh-button'),
    adminNewButton: document.getElementById('admin-new-button'),
    adminEditButton: document.getElementById('admin-edit-button'),
    libraryBody: document.getElementById('library-body'),
    resultSummary: document.getElementById('result-summary'),
    pageLabel: document.getElementById('page-label'),
    prevPage: document.getElementById('prev-page'),
    nextPage: document.getElementById('next-page'),
    detailBackdrop: document.getElementById('detail-backdrop'),
    detailModal: document.getElementById('detail-modal'),
    detailCloseButton: document.getElementById('detail-close-button'),
    detailEditButton: document.getElementById('detail-edit-button'),
    detailTitle: document.getElementById('detail-title'),
    detailSubtitle: document.getElementById('detail-subtitle'),
    detailNotice: document.getElementById('detail-notice'),
    detailEmpty: document.getElementById('detail-empty'),
    detailContent: document.getElementById('detail-content'),
    overviewGrid: document.getElementById('overview-grid'),
    versionsList: document.getElementById('versions-list'),
    premiumsList: document.getElementById('premiums-list'),
    versionCountChip: document.getElementById('version-count-chip'),
    premiumCountChip: document.getElementById('premium-count-chip')
  };

  const state = {
    client: null,
    isAdmin: false,
    userEmail: null,
    page: 1,
    totalRows: 0,
    rows: [],
    selectedProgramId: null,
    searchText: '',
    searchField: '',
    statusFilter: 'active',
    topicFilters: [],
    distributorFilter: '',
    topicOptions: [],
    distributorOptions: []
  };

  const READ_VIEW = 'pledge_program_library_summary';
  const SEARCHABLE_FIELDS = new Set(['title', 'nola_code', 'topic_primary', 'distributor', 'premium_summary']);

  const setNotice = (text, type = '') => {
    els.configStatus.textContent = text;
    els.configStatus.className = 'status-line';
    if (type) els.configStatus.classList.add(type);
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const normalizeText = (value) => String(value ?? '').trim();

  const formatMoney = (value) => {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return normalizeText(value) || '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
  };

  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatInterval = (value) => normalizeText(value) || '—';

  const runtimeLabel = (program) => {
    const minutes = Number(program.board_runtime_minutes);
    if (Number.isFinite(minutes) && minutes > 0) return `${minutes} min`;
    return formatInterval(program.exact_runtime);
  };

  const labelValue = (label, value) => `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value ?? '—')}</dd>
    </div>
  `;

  const selectedValues = (select) => [...(select?.selectedOptions || [])].map((option) => option.value).filter(Boolean);

  const setRoleUi = () => {
    els.versionFlag.textContent = APP_VERSION;
    els.footerVersion.textContent = APP_VERSION;
    if (state.isAdmin) {
      els.roleChip.textContent = state.userEmail ? `Admin · ${state.userEmail}` : 'Admin';
      els.roleChip.classList.add('admin');
      els.adminNewButton.classList.remove('hidden');
      els.adminEditButton.classList.remove('hidden');
      els.detailEditButton.classList.remove('hidden');
    } else {
      els.roleChip.textContent = state.userEmail ? `Viewer · ${state.userEmail}` : 'Viewer';
      els.roleChip.classList.remove('admin');
      els.adminNewButton.classList.add('hidden');
      els.adminEditButton.classList.add('hidden');
      els.detailEditButton.classList.add('hidden');
    }
  };

  const escapeLike = (value) => normalizeText(value).replace(/,/g, ' ').replace(/%/g, '').replace(/_/g, '');

  const fetchAllRows = async (table, columns) => {
    const pageSize = 1000;
    let from = 0;
    const rows = [];
    while (true) {
      const { data, error } = await state.client
        .from(table)
        .select(columns)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const chunk = data || [];
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  };

  const renderTopicOptions = () => {
    const current = new Set(state.topicFilters);
    els.topicFilter.innerHTML = state.topicOptions.map((value) => `
      <option value="${escapeHtml(value)}" ${current.has(value) ? 'selected' : ''}>${escapeHtml(value)}</option>
    `).join('');
  };

  const renderDistributorOptions = () => {
    const options = ['<option value="">All distributors</option>'];
    state.distributorOptions.forEach((value) => {
      options.push(`<option value="${escapeHtml(value)}" ${state.distributorFilter === value ? 'selected' : ''}>${escapeHtml(value)}</option>`);
    });
    els.distributorFilter.innerHTML = options.join('');
  };

  const loadFilterOptions = async () => {
    const rows = await fetchAllRows(READ_VIEW, 'topic_primary, distributor');
    state.topicOptions = Array.from(new Set(rows.map((row) => normalizeText(row.topic_primary)).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    state.distributorOptions = Array.from(new Set(rows.map((row) => normalizeText(row.distributor)).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    renderTopicOptions();
    renderDistributorOptions();
  };

  const syncSelectedRows = () => {
    [...els.libraryBody.querySelectorAll('tr[data-id]')].forEach((tr) => {
      tr.classList.toggle('selected', tr.dataset.id === state.selectedProgramId);
    });
  };

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

  const renderRows = () => {
    if (!state.rows.length) {
      els.libraryBody.innerHTML = '<tr><td colspan="8" class="placeholder-row">No matching pledge titles found.</td></tr>';
      return;
    }

    els.libraryBody.innerHTML = state.rows.map((row) => {
      const statusClass = normalizeText(row.status).toLowerCase() || 'other';
      return `
        <tr data-id="${escapeHtml(row.id)}" class="${row.id === state.selectedProgramId ? 'selected' : ''}">
          <td class="title-cell">
            <button type="button" class="title-open-button" data-open-id="${escapeHtml(row.id)}" aria-label="Open details for ${escapeHtml(row.title)}">
              <strong>${escapeHtml(row.title || 'Untitled')}</strong>
            </button>
          </td>
          <td>${escapeHtml(runtimeLabel(row))}</td>
          <td>${escapeHtml(row.topic_primary || '—')}</td>
          <td>${escapeHtml(row.distributor || '—')}</td>
          <td class="premiums-cell">${premiumSummaryHtml(row.premium_summary)}</td>
          <td>${escapeHtml(formatDate(row.rights_start))}</td>
          <td>${escapeHtml(formatDate(row.rights_end))}</td>
          <td>${escapeHtml(formatDate(row.last_aired_at))}</td>
        </tr>
      `;
    }).join('');
  };

  const updateSummary = () => {
    const first = state.totalRows === 0 ? 0 : ((state.page - 1) * PAGE_SIZE) + 1;
    const last = Math.min(state.totalRows, state.page * PAGE_SIZE);
    els.resultSummary.textContent = `${state.totalRows.toLocaleString()} titles · showing ${first.toLocaleString()}–${last.toLocaleString()} · sorted by topic then title`;
    const pageCount = Math.max(1, Math.ceil(state.totalRows / PAGE_SIZE));
    els.pageLabel.textContent = `Page ${state.page} of ${pageCount}`;
    els.prevPage.disabled = state.page <= 1;
    els.nextPage.disabled = state.page >= pageCount;
  };

  const applySearchFilter = (query) => {
    const search = escapeLike(state.searchText);
    if (!search) return query;
    const like = `%${search}%`;
    if (SEARCHABLE_FIELDS.has(state.searchField)) return query.ilike(state.searchField, like);
    return query.or([
      `title.ilike.${like}`,
      `nola_code.ilike.${like}`,
      `topic_primary.ilike.${like}`,
      `distributor.ilike.${like}`,
      `premium_summary.ilike.${like}`
    ].join(','));
  };

  const loadLibrary = async () => {
    if (!state.client) return;
    els.libraryBody.innerHTML = '<tr><td colspan="8" class="placeholder-row">Loading library…</td></tr>';

    const from = (state.page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = state.client
      .from(READ_VIEW)
      .select('*', { count: 'exact' })
      .order('topic_primary', { ascending: true, nullsFirst: false })
      .order('title', { ascending: true, nullsFirst: false })
      .range(from, to);

    if (state.statusFilter === 'active') {
      query = query.eq('status', 'active');
    } else if (state.statusFilter === 'archived') {
      query = query.eq('status', 'archived');
    }

    if (state.topicFilters.length) query = query.in('topic_primary', state.topicFilters);
    if (state.distributorFilter) query = query.eq('distributor', state.distributorFilter);
    query = applySearchFilter(query);

    const { data, error, count } = await query;
    if (error) {
      console.error(error);
      els.libraryBody.innerHTML = `<tr><td colspan="8" class="placeholder-row">${escapeHtml(error.message)}</td></tr>`;
      els.resultSummary.textContent = 'Load failed.';
      return;
    }

    state.rows = data || [];
    state.totalRows = count || 0;
    renderRows();
    updateSummary();
    syncSelectedRows();
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
    syncSelectedRows();
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

  const renderDetail = (program, versions, premiums) => {
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    els.detailTitle.textContent = program.title || 'Program detail';
    els.detailSubtitle.textContent = `${program.nola_code || 'No NOLA'} · ${program.distributor || 'No distributor listed'}`;

    const topicValue = [normalizeText(program.topic_primary), normalizeText(program.topic_secondary)].filter(Boolean).join(' / ') || '—';
    els.overviewGrid.innerHTML = [
      labelValue('Title', program.title || '—'),
      labelValue('Short title', program.short_title || '—'),
      labelValue('NOLA', program.nola_code || '—'),
      labelValue('Distributor', program.distributor || '—'),
      labelValue('Topic', topicValue),
      labelValue('Length', runtimeLabel(program)),
      labelValue('Exact runtime', formatInterval(program.exact_runtime)),
      labelValue('Break count', program.break_count ?? program.default_break_count ?? '—'),
      labelValue('Local cut-ins', program.local_cut_in_count ?? program.default_local_cut_in_count ?? '—'),
      labelValue('Rights begin', formatDate(program.rights_start)),
      labelValue('Rights end', formatDate(program.rights_end)),
      labelValue('Last aired', formatDate(program.last_aired_at)),
      labelValue('Times aired', program.times_aired_count ?? 0),
      labelValue('Lifetime dollars', formatMoney(program.lifetime_dollars || 0)),
      labelValue('Pickup type', program.pickup_type || '—'),
      labelValue('Source format', program.source_format || '—'),
      labelValue('Storage', program.storage_location || '—'),
      labelValue('Premium summary', program.premium_summary || '—'),
      labelValue('Status', program.status || '—'),
      labelValue('Notes', program.program_notes || '—')
    ].join('');

    els.versionCountChip.textContent = `${versions.length}`;
    els.versionsList.innerHTML = versions.length ? versions.map((version) => {
      const segments = (version.segments || []).map((segment) => `
        <tr>
          <td>${escapeHtml(segment.segment_order)}</td>
          <td>${escapeHtml(segment.segment_type || '—')}</td>
          <td>${escapeHtml(segment.label || '—')}</td>
          <td>${escapeHtml(formatInterval(segment.duration))}</td>
          <td>${escapeHtml(segment.duration_minutes ?? '—')}</td>
          <td>${segment.local_cut_in_available ? 'Yes' : '—'}</td>
          <td>${escapeHtml(segment.notes || '—')}</td>
        </tr>
      `).join('');
      return `
        <article class="version-card">
          <div class="version-card-head">
            <h4>${escapeHtml(version.version_label || 'Version')}</h4>
            <span class="status-pill ${escapeHtml(normalizeText(version.status).toLowerCase() || 'other')}">${escapeHtml(version.break_style || version.status || 'Version')}</span>
          </div>
          <div class="version-meta">
            <span class="mini-chip">Length ${escapeHtml(runtimeLabel(version))}</span>
            <span class="mini-chip">Breaks ${escapeHtml(version.default_break_count ?? '—')}</span>
            <span class="mini-chip">Local ${escapeHtml(version.default_local_cut_in_count ?? '—')}</span>
          </div>
          <div class="muted">${escapeHtml(version.version_notes || 'No version notes.')}</div>
          <div class="segment-table-wrap">
            <table class="segment-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Label</th>
                  <th>Duration</th>
                  <th>Min</th>
                  <th>Local</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>${segments || '<tr><td colspan="7">No segment rows.</td></tr>'}</tbody>
            </table>
          </div>
        </article>
      `;
    }).join('') : '<div class="premium-card">No structured version rows available for this title.</div>';

    els.premiumCountChip.textContent = `${premiums.length}`;
    els.premiumsList.innerHTML = premiums.length ? premiums.map((premium) => `
      <article class="premium-card">
        <h4>${escapeHtml(premium.premium_name || 'Premium')}</h4>
        <div class="muted">${escapeHtml(premium.premium_type || 'No type')} · ${premium.ask_amount ? escapeHtml(formatMoney(premium.ask_amount)) : 'No ask amount'}</div>
        <div>${escapeHtml(premium.description || premium.fulfillment_notes || 'No premium notes.')}</div>
      </article>
    `).join('') : '<div class="premium-card">No structured premium rows available for this title.</div>';
  };

  const showDetailFailure = (message) => {
    els.detailTitle.textContent = 'Detail load failed';
    els.detailSubtitle.textContent = message || 'Something went sideways while loading this title.';
    els.detailContent.classList.add('hidden');
    els.detailEmpty.classList.remove('hidden');
    els.detailEmpty.textContent = message || 'Something went sideways while loading this title.';
  };

  const loadProgramDetail = async (programId) => {
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
    els.versionsList.innerHTML = '<div class="premium-card">Loading versions…</div>';
    els.premiumsList.innerHTML = '<div class="premium-card">Loading premiums…</div>';

    const rowSummary = state.rows.find((row) => String(row.id) === String(programId)) || null;

    const [summaryResult, programResult, versionsResult, premiumsResult] = await Promise.allSettled([
      rowSummary ? Promise.resolve({ data: rowSummary }) : state.client.from(READ_VIEW).select('*').eq('id', programId).maybeSingle(),
      state.client.from('pledge_programs').select('*').eq('id', programId).maybeSingle(),
      state.client.from('pledge_program_versions').select('*').eq('pledge_program_id', programId).order('version_label', { ascending: true }),
      state.client.from('pledge_premiums').select('*').eq('pledge_program_id', programId).order('premium_name', { ascending: true })
    ]);

    const summaryPayload = summaryResult.status === 'fulfilled' ? summaryResult.value : null;
    const basePayload = programResult.status === 'fulfilled' ? programResult.value : null;
    const versionsPayload = versionsResult.status === 'fulfilled' ? versionsResult.value : null;
    const premiumsPayload = premiumsResult.status === 'fulfilled' ? premiumsResult.value : null;

    const summaryProgram = summaryPayload && !summaryPayload.error ? summaryPayload.data : null;
    const baseProgram = basePayload && !basePayload.error ? basePayload.data : null;
    const versions = versionsPayload && !versionsPayload.error ? (versionsPayload.data || []) : [];
    const premiums = premiumsPayload && !premiumsPayload.error ? (premiumsPayload.data || []) : [];

    const mergedProgram = { ...(summaryProgram || {}), ...(baseProgram || {}) };
    if (!Object.keys(mergedProgram).length) {
      console.error(summaryResult, programResult);
      showDetailFailure('No readable detail data came back for this title.');
      return;
    }

    let detailWarnings = [];
    if (programResult.status === 'rejected' || basePayload?.error) detailWarnings.push('Base program row could not be read; showing summary-view data instead.');
    if (versionsResult.status === 'rejected' || versionsPayload?.error) detailWarnings.push('Version rows are unavailable for this role or this title.');
    if (premiumsResult.status === 'rejected' || premiumsPayload?.error) detailWarnings.push('Premium rows are unavailable for this role or this title.');

    let segments = [];
    if (versions.length) {
      const versionIds = versions.map((version) => version.id).filter(Boolean);
      if (versionIds.length) {
        try {
          const { data: segmentData, error: segmentError } = await state.client
            .from('pledge_program_segments')
            .select('*')
            .in('pledge_program_version_id', versionIds)
            .order('segment_order', { ascending: true });
          if (segmentError) {
            detailWarnings.push('Segment rows are unavailable for this role or this title.');
          } else {
            segments = segmentData || [];
          }
        } catch (error) {
          detailWarnings.push('Segment rows are unavailable for this role or this title.');
        }
      }
    }

    const groupedSegments = new Map();
    segments.forEach((segment) => {
      if (!groupedSegments.has(segment.pledge_program_version_id)) groupedSegments.set(segment.pledge_program_version_id, []);
      groupedSegments.get(segment.pledge_program_version_id).push(segment);
    });
    const versionsWithSegments = versions.map((version) => ({ ...version, segments: groupedSegments.get(version.id) || [] }));

    setDetailNotice(detailWarnings.length ? detailWarnings.join(' ') : '', detailWarnings.length ? 'warn' : '');
    renderDetail(mergedProgram, versionsWithSegments, premiums);
    els.detailCloseButton.focus();
  };

  const initAuthRole = async () => {
    if (!state.client) return;
    try {
      const { data, error } = await state.client.auth.getUser();
      if (error) throw error;
      state.userEmail = data?.user?.email ? String(data.user.email).toLowerCase() : null;
      state.isAdmin = !!(state.userEmail && ADMIN_EMAILS.includes(state.userEmail));
      setRoleUi();
    } catch (err) {
      console.warn('Auth user check failed; staying viewer-only.', err);
      state.userEmail = null;
      state.isAdmin = false;
      setRoleUi();
    }
  };

  const init = async () => {
    els.versionFlag.textContent = APP_VERSION;
    els.footerVersion.textContent = APP_VERSION;

    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || String(cfg.SUPABASE_URL).includes('YOUR_PROJECT')) {
      setNotice('Fill in config.js with your Supabase URL and anon key. Until then this page is decorative.', 'warn');
      setRoleUi();
      return;
    }

    state.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    setNotice('Config found. Connecting to Supabase and loading pledge titles.');
    await initAuthRole();
    await loadFilterOptions();
    await loadLibrary();
  };

  let searchTimer = null;
  els.searchInput.addEventListener('input', (event) => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.searchText = event.target.value || '';
      state.page = 1;
      void loadLibrary();
    }, 220);
  });

  els.searchFieldSelect.addEventListener('change', (event) => {
    state.searchField = event.target.value || '';
    state.page = 1;
    void loadLibrary();
  });

  els.topicFilter.addEventListener('change', () => {
    state.topicFilters = selectedValues(els.topicFilter);
    state.page = 1;
    void loadLibrary();
  });

  els.distributorFilter.addEventListener('change', (event) => {
    state.distributorFilter = event.target.value || '';
    state.page = 1;
    void loadLibrary();
  });

  els.statusFilter.addEventListener('change', (event) => {
    state.statusFilter = event.target.value;
    state.page = 1;
    void loadLibrary();
  });

  els.clearTopicFilter.addEventListener('click', () => {
    [...els.topicFilter.options].forEach((option) => { option.selected = false; });
    state.topicFilters = [];
    state.page = 1;
    void loadLibrary();
  });

  els.resetFiltersButton.addEventListener('click', () => {
    state.searchText = '';
    state.searchField = '';
    state.statusFilter = 'active';
    state.topicFilters = [];
    state.distributorFilter = '';
    state.page = 1;
    els.searchInput.value = '';
    els.searchFieldSelect.value = '';
    els.statusFilter.value = 'active';
    renderTopicOptions();
    renderDistributorOptions();
    void loadLibrary();
  });

  els.prevPage.addEventListener('click', () => {
    if (state.page > 1) {
      state.page -= 1;
      void loadLibrary();
    }
  });

  els.nextPage.addEventListener('click', () => {
    const pageCount = Math.max(1, Math.ceil(state.totalRows / PAGE_SIZE));
    if (state.page < pageCount) {
      state.page += 1;
      void loadLibrary();
    }
  });

  els.refreshButton.addEventListener('click', async () => {
    await loadFilterOptions();
    await loadLibrary();
    if (state.selectedProgramId && !els.detailModal.classList.contains('hidden')) void loadProgramDetail(state.selectedProgramId);
  });

  els.libraryBody.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-open-id]');
    if (!trigger) return;
    event.preventDefault();
    void loadProgramDetail(trigger.dataset.openId);
  });

  els.detailCloseButton.addEventListener('click', closeDetailModal);
  els.detailBackdrop.addEventListener('click', closeDetailModal);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.detailModal.classList.contains('hidden')) closeDetailModal();
  });

  const adminMessage = 'Add/edit tools are intentionally held for the next build. This pass focuses on validating the pledge library and getting the detail modal right.';
  els.adminNewButton.addEventListener('click', () => window.alert(adminMessage));
  els.adminEditButton.addEventListener('click', () => window.alert(adminMessage));
  els.detailEditButton.addEventListener('click', () => window.alert(adminMessage));

  window.addEventListener('DOMContentLoaded', () => {
    void init();
  });
})();

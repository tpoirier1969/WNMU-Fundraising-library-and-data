(() => {
  const cfg = window.PLEDGE_MANAGER_CONFIG || {};
  const APP_VERSION = 'v0.6.1';
  const PAGE_SIZE = Number(cfg.DEFAULT_PAGE_SIZE || 100);
  const ADMIN_EMAILS = Array.isArray(cfg.ADMIN_EMAILS)
    ? cfg.ADMIN_EMAILS.map((e) => String(e).trim().toLowerCase())
    : [];

  const els = {
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
    clearTopicFilter: document.getElementById('clear-topic-filter'),
    clearSecondaryTopicFilter: document.getElementById('clear-secondary-topic-filter'),
    clearLengthFilter: document.getElementById('clear-length-filter'),
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
    timingList: document.getElementById('timing-list'),
    airingList: document.getElementById('airing-list'),
    premiumsList: document.getElementById('premiums-list'),
    timingCountChip: document.getElementById('timing-count-chip'),
    airingCountChip: document.getElementById('airing-count-chip'),
    premiumCountChip: document.getElementById('premium-count-chip')
  };

  const READ_VIEW = 'pledge_program_library_summary';
  const SEARCHABLE_FIELDS = new Set([
    'title',
    'nola_code',
    'topic_primary',
    'topic_secondary',
    'distributor',
    'premium_summary',
    'exact_runtime'
  ]);

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
    secondaryTopicFilters: [],
    lengthFilters: [],
    distributorFilter: '',
    topicOptions: [],
    secondaryTopicOptions: [],
    lengthOptions: [],
    distributorOptions: []
  };

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

  const selectedValues = (select) => [...(select?.selectedOptions || [])]
    .map((option) => option.value)
    .filter(Boolean);

  const escapeLike = (value) => normalizeText(value).replace(/,/g, ' ').replace(/%/g, '').replace(/_/g, '');

  const formatMoney = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return normalizeText(value) || '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(num);
  };

  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatDateTime = (value) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return escapeHtml(value);
    return date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  };

  const formatLastAired = (value) => value ? formatDate(value) : 'N/A';

  const formatInterval = (value) => normalizeText(value) || '—';

  const runtimeLabel = (program) => {
    const minutes = Number(program.board_runtime_minutes);
    if (Number.isFinite(minutes) && minutes > 0) return `${minutes} min`;
    return formatInterval(program.exact_runtime);
  };

  const runtimeKey = (program) => {
    const minutes = Number(program.board_runtime_minutes);
    if (Number.isFinite(minutes) && minutes > 0) return `min:${minutes}`;
    const exact = normalizeText(program.exact_runtime);
    if (exact) return `exact:${exact}`;
    return 'unknown';
  };

  const runtimeOptionLabel = (key) => {
    if (key.startsWith('min:')) return `${key.slice(4)} min`;
    if (key.startsWith('exact:')) return key.slice(6);
    return 'Unknown';
  };

  const labelValue = (label, value) => `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${value}</dd>
    </div>
  `;

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

  const renderMultiSelect = (select, values, selected) => {
    const current = new Set(selected);
    select.innerHTML = values.map((value) => `
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

  const renderLengthOptions = () => {
    const current = new Set(state.lengthFilters);
    els.lengthFilter.innerHTML = state.lengthOptions.map((option) => `
      <option value="${escapeHtml(option.value)}" ${current.has(option.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>
    `).join('');
  };

  const loadFilterOptions = async () => {
    const rows = await fetchAllRows(READ_VIEW, '*', (query) => query
      .order('topic_primary', { ascending: true, nullsFirst: false })
      .order('title', { ascending: true, nullsFirst: false })
    );

    state.topicOptions = Array.from(new Set(rows.map((row) => normalizeText(row.topic_primary)).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    state.secondaryTopicOptions = Array.from(new Set(rows.map((row) => normalizeText(row.topic_secondary)).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    state.distributorOptions = Array.from(new Set(rows.map((row) => normalizeText(row.distributor)).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const lengthMap = new Map();
    rows.forEach((row) => {
      const key = runtimeKey(row);
      if (!lengthMap.has(key)) {
        lengthMap.set(key, { value: key, label: runtimeOptionLabel(key) });
      }
    });
    state.lengthOptions = [...lengthMap.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));

    renderMultiSelect(els.topicFilter, state.topicOptions, state.topicFilters);
    renderMultiSelect(els.secondaryTopicFilter, state.secondaryTopicOptions, state.secondaryTopicFilters);
    renderLengthOptions();
    renderDistributorOptions();
  };

  const syncSelectedRows = () => {
    [...els.libraryBody.querySelectorAll('tr[data-id]')].forEach((tr) => {
      tr.classList.toggle('selected', tr.dataset.id === state.selectedProgramId);
    });
  };

  const mergePageBaseFields = async (rows) => {
    const ids = rows.map((row) => row.id).filter(Boolean);
    if (!ids.length) return rows;
    try {
      const { data, error } = await state.client
        .from('pledge_programs')
        .select('id, rights_start, rights_end, last_aired_at, topic_secondary, board_runtime_minutes, exact_runtime, title, distributor, nola_code, premium_summary, program_notes, lifetime_dollars')
        .in('id', ids);
      if (error) throw error;
      const byId = new Map((data || []).map((row) => [String(row.id), row]));
      return rows.map((row) => ({ ...row, ...(byId.get(String(row.id)) || {}) }));
    } catch (error) {
      console.warn('Base pledge row enrichment failed for list display.', error);
      return rows;
    }
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
      `topic_secondary.ilike.${like}`,
      `distributor.ilike.${like}`,
      `premium_summary.ilike.${like}`,
      `exact_runtime.ilike.${like}`
    ].join(','));
  };

  const applyCommonFilters = (query) => {
    if (state.statusFilter === 'active') {
      query = query.eq('status', 'active');
    } else if (state.statusFilter === 'archived') {
      query = query.eq('status', 'archived');
    }
    if (state.topicFilters.length) query = query.in('topic_primary', state.topicFilters);
    if (state.secondaryTopicFilters.length) query = query.in('topic_secondary', state.secondaryTopicFilters);
    if (state.distributorFilter) query = query.eq('distributor', state.distributorFilter);
    query = applySearchFilter(query);
    return query;
  };

  const filterRowsByLength = (rows) => {
    if (!state.lengthFilters.length) return rows;
    const wanted = new Set(state.lengthFilters);
    return rows.filter((row) => wanted.has(runtimeKey(row)));
  };

  const renderRows = () => {
    if (!state.rows.length) {
      els.libraryBody.innerHTML = '<tr><td colspan="8" class="placeholder-row">No matching pledge titles found.</td></tr>';
      return;
    }

    els.libraryBody.innerHTML = state.rows.map((row) => `
      <tr data-id="${escapeHtml(row.id)}" class="${row.id === state.selectedProgramId ? 'selected' : ''}">
        <td class="title-cell">
          <button type="button" class="title-open-button" data-open-id="${escapeHtml(row.id)}" aria-label="Open details for ${escapeHtml(row.title)}">
            <strong>${escapeHtml(row.title || 'Untitled')}</strong>
            <div class="sub">${escapeHtml(row.nola_code || 'No NOLA')} · ${escapeHtml(row.distributor || 'No distributor')}</div>
          </button>
        </td>
        <td>${escapeHtml(runtimeLabel(row))}</td>
        <td>${escapeHtml(row.topic_primary || '—')}</td>
        <td>${escapeHtml(row.distributor || '—')}</td>
        <td class="premiums-cell">${premiumSummaryHtml(row.premium_summary)}</td>
        <td>${escapeHtml(formatDate(row.rights_start))}</td>
        <td>${escapeHtml(formatDate(row.rights_end))}</td>
        <td>${escapeHtml(formatLastAired(row.last_aired_at))}</td>
      </tr>
    `).join('');
  };

  const updateSummary = () => {
    const first = state.totalRows === 0 ? 0 : ((state.page - 1) * PAGE_SIZE) + 1;
    const last = Math.min(state.totalRows, state.page * PAGE_SIZE);
    const filters = [];
    if (state.topicFilters.length) filters.push(`${state.topicFilters.length} primary topic${state.topicFilters.length === 1 ? '' : 's'}`);
    if (state.secondaryTopicFilters.length) filters.push(`${state.secondaryTopicFilters.length} secondary topic${state.secondaryTopicFilters.length === 1 ? '' : 's'}`);
    if (state.lengthFilters.length) filters.push(`${state.lengthFilters.length} length${state.lengthFilters.length === 1 ? '' : 's'}`);
    if (state.distributorFilter) filters.push('1 distributor');
    const filterText = filters.length ? ` · filters: ${filters.join(', ')}` : '';
    els.resultSummary.textContent = `${state.totalRows.toLocaleString()} titles · showing ${first.toLocaleString()}–${last.toLocaleString()} · sorted by topic then title${filterText}`;
    const pageCount = Math.max(1, Math.ceil(state.totalRows / PAGE_SIZE));
    els.pageLabel.textContent = `Page ${state.page} of ${pageCount}`;
    els.prevPage.disabled = state.page <= 1;
    els.nextPage.disabled = state.page >= pageCount;
  };

  const loadLibrary = async () => {
    if (!state.client) return;
    els.libraryBody.innerHTML = '<tr><td colspan="8" class="placeholder-row">Loading library…</td></tr>';

    try {
      if (state.lengthFilters.length) {
        const allRows = await fetchAllRows(READ_VIEW, '*', (query) => applyCommonFilters(query)
          .order('topic_primary', { ascending: true, nullsFirst: false })
          .order('title', { ascending: true, nullsFirst: false })
        );
        const filteredRows = filterRowsByLength(allRows);
        state.totalRows = filteredRows.length;
        const from = (state.page - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE;
        state.rows = await mergePageBaseFields(filteredRows.slice(from, to));
      } else {
        const from = (state.page - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        let query = state.client
          .from(READ_VIEW)
          .select('*', { count: 'exact' })
          .order('topic_primary', { ascending: true, nullsFirst: false })
          .order('title', { ascending: true, nullsFirst: false })
          .range(from, to);
        query = applyCommonFilters(query);
        const { data, error, count } = await query;
        if (error) throw error;
        state.totalRows = count || 0;
        state.rows = await mergePageBaseFields(data || []);
      }
      renderRows();
      updateSummary();
      syncSelectedRows();
    } catch (error) {
      console.error(error);
      els.libraryBody.innerHTML = `<tr><td colspan="8" class="placeholder-row">${escapeHtml(error.message || 'Load failed.')}</td></tr>`;
      els.resultSummary.textContent = 'Load failed.';
    }
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

  const detailSubtitleHtml = (program) => {
    const parts = [
      `<span class="detail-chip">Length ${escapeHtml(runtimeLabel(program))}</span>`,
      `<span class="detail-chip">NOLA ${escapeHtml(program.nola_code || 'No NOLA')}</span>`,
      `<span class="detail-chip">${escapeHtml(program.distributor || 'No distributor listed')}</span>`
    ];
    return parts.join('');
  };

  const renderOverview = (program) => {
    const topicValue = [normalizeText(program.topic_primary), normalizeText(program.topic_secondary)].filter(Boolean).join(' / ') || '—';
    const rightsWindow = `${formatDate(program.rights_start)} → ${formatDate(program.rights_end)}`;
    const premiumSummary = normalizeText(program.premium_summary) ? premiumSummaryHtml(program.premium_summary) : '—';
    els.overviewGrid.innerHTML = [
      labelValue('Topic', escapeHtml(topicValue)),
      labelValue('Rights window', escapeHtml(rightsWindow)),
      labelValue('Last aired', escapeHtml(formatLastAired(program.last_aired_at))),
      labelValue('Lifetime dollars', escapeHtml(formatMoney(program.lifetime_dollars || 0))),
      labelValue('Premium summary', premiumSummary),
      labelValue('Notes', escapeHtml(program.program_notes || '—'))
    ].join('');
  };

  const segmentTypeLabel = (segment) => {
    const raw = normalizeText(segment.segment_type).toLowerCase();
    if (!raw) return 'Segment';
    if (raw.includes('break')) return 'Break segment';
    if (raw.includes('cut')) return 'Local cut-in window';
    if (raw.includes('local')) return 'Local cut-in window';
    return raw.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  };

  const renderTiming = (versions, segments) => {
    const grouped = new Map();
    versions.forEach((version) => {
      grouped.set(String(version.id), []);
    });
    segments.forEach((segment) => {
      const key = String(segment.pledge_program_version_id || 'ungrouped');
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(segment);
    });

    const blocks = versions.map((version) => {
      const versionSegments = (grouped.get(String(version.id)) || []).sort((a, b) => Number(a.segment_order || 0) - Number(b.segment_order || 0));
      return `
        <article class="timing-card">
          <div class="timing-card-head">
            <h4>${escapeHtml(version.version_label || 'Program structure')}</h4>
            <div class="timing-meta">
              <span class="mini-chip">Length ${escapeHtml(runtimeLabel(version))}</span>
              <span class="mini-chip">Breaks ${escapeHtml(version.default_break_count ?? '—')}</span>
              <span class="mini-chip">Local ${escapeHtml(version.default_local_cut_in_count ?? '—')}</span>
            </div>
          </div>
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
              <tbody>
                ${versionSegments.length ? versionSegments.map((segment) => `
                  <tr>
                    <td>${escapeHtml(segment.segment_order ?? '—')}</td>
                    <td>${escapeHtml(segmentTypeLabel(segment))}</td>
                    <td>${escapeHtml(segment.label || '—')}</td>
                    <td>${escapeHtml(formatInterval(segment.duration))}</td>
                    <td>${escapeHtml(segment.duration_minutes ?? '—')}</td>
                    <td>${segment.local_cut_in_available ? 'Yes' : '—'}</td>
                    <td>${escapeHtml(segment.notes || '—')}</td>
                  </tr>
                `).join('') : '<tr><td colspan="7">No structured timing rows for this entry.</td></tr>'}
              </tbody>
            </table>
          </div>
        </article>
      `;
    });

    if (!blocks.length && segments.length) {
      blocks.push(`
        <article class="timing-card">
          <div class="timing-card-head">
            <h4>Program structure</h4>
          </div>
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
              <tbody>
                ${segments.map((segment) => `
                  <tr>
                    <td>${escapeHtml(segment.segment_order ?? '—')}</td>
                    <td>${escapeHtml(segmentTypeLabel(segment))}</td>
                    <td>${escapeHtml(segment.label || '—')}</td>
                    <td>${escapeHtml(formatInterval(segment.duration))}</td>
                    <td>${escapeHtml(segment.duration_minutes ?? '—')}</td>
                    <td>${segment.local_cut_in_available ? 'Yes' : '—'}</td>
                    <td>${escapeHtml(segment.notes || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </article>
      `);
    }

    els.timingCountChip.textContent = `${segments.length}`;
    els.timingList.innerHTML = blocks.length
      ? blocks.join('')
      : '<div class="timing-card">No structured segment timing rows are available for this title.</div>';
  };

  const deriveAiringDateTime = (row) => row.aired_at || row.air_datetime || row.air_date_time || row.air_timestamp || row.airing_at || row.air_date || row.last_aired_at || null;
  const deriveAiringAmount = (row) => row.amount_contributed ?? row.contributed_amount ?? row.contribution_amount ?? row.total_pledged ?? row.total_contributed ?? row.dollars_raised ?? row.amount_raised ?? row.pledged_amount ?? null;

  const renderAirings = (airings) => {
    els.airingCountChip.textContent = `${airings.length}`;
    if (!airings.length) {
      els.airingList.innerHTML = '<div class="premium-card">No readable air history is available for this title.</div>';
      return;
    }
    els.airingList.innerHTML = `
      <div class="airing-table-wrap">
        <table class="segment-table">
          <thead>
            <tr>
              <th>Aired</th>
              <th>Contributed</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${airings.map((row) => `
              <tr>
                <td>${escapeHtml(formatDateTime(deriveAiringDateTime(row)))}</td>
                <td>${escapeHtml(deriveAiringAmount(row) == null || deriveAiringAmount(row) === '' ? '—' : formatMoney(deriveAiringAmount(row)))}</td>
                <td>${escapeHtml(row.notes || row.comments || row.description || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  const renderPremiums = (premiums) => {
    els.premiumCountChip.textContent = `${premiums.length}`;
    els.premiumsList.innerHTML = premiums.length ? premiums.map((premium) => `
      <article class="premium-card">
        <h4>${escapeHtml(premium.premium_name || 'Premium')}</h4>
        <div class="muted">${escapeHtml(premium.premium_type || 'No type')} · ${premium.ask_amount ? escapeHtml(formatMoney(premium.ask_amount)) : 'No ask amount'}</div>
        <div>${escapeHtml(premium.description || premium.fulfillment_notes || 'No premium notes.')}</div>
      </article>
    `).join('') : '<div class="premium-card">No structured premium rows available for this title.</div>';
  };

  const renderDetail = (program, versions, segments, premiums, airings) => {
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    els.detailTitle.textContent = program.title || 'Program detail';
    els.detailSubtitle.innerHTML = detailSubtitleHtml(program);
    renderOverview(program);
    renderTiming(versions, segments);
    renderAirings(airings);
    renderPremiums(premiums);
  };

  const showDetailFailure = (message) => {
    els.detailTitle.textContent = 'Detail load failed';
    els.detailSubtitle.textContent = message || 'Something went sideways while loading this title.';
    els.detailContent.classList.add('hidden');
    els.detailEmpty.classList.remove('hidden');
    els.detailEmpty.textContent = message || 'Something went sideways while loading this title.';
  };

  const queryFirstReadable = async (candidates) => {
    for (const candidate of candidates) {
      try {
        let query = state.client.from(candidate.table).select(candidate.select || '*');
        if (candidate.eqField && candidate.eqValue !== undefined) query = query.eq(candidate.eqField, candidate.eqValue);
        if (candidate.inField && Array.isArray(candidate.inValues) && candidate.inValues.length) query = query.in(candidate.inField, candidate.inValues);
        if (candidate.orderField) query = query.order(candidate.orderField, { ascending: candidate.ascending ?? true });
        const { data, error } = await query;
        if (error) continue;
        return { data: data || [], source: candidate.table };
      } catch (error) {
        // try next candidate
      }
    }
    return { data: [], source: null };
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
    els.timingList.innerHTML = '<div class="timing-card">Loading timing rows…</div>';
    els.airingList.innerHTML = '<div class="premium-card">Loading air history…</div>';
    els.premiumsList.innerHTML = '<div class="premium-card">Loading premiums…</div>';

    const rowSummary = state.rows.find((row) => String(row.id) === String(programId)) || null;
    if (rowSummary) {
      renderDetail(rowSummary, [], [], [], []);
    }

    const [summaryResult, programResult, versionsResult, premiumsResult] = await Promise.allSettled([
      rowSummary ? Promise.resolve({ data: rowSummary, error: null }) : state.client.from(READ_VIEW).select('*').eq('id', programId).maybeSingle(),
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

    const detailWarnings = [];
    if (programResult.status === 'rejected' || basePayload?.error) detailWarnings.push('Base pledge row could not be read; showing summary-view data instead.');
    if (versionsResult.status === 'rejected' || versionsPayload?.error) detailWarnings.push('Timing rows are unavailable for this role or this title.');
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

    const { data: airings, source: airingSource } = await queryFirstReadable([
      {
        table: 'pledge_program_airings',
        eqField: 'pledge_program_id',
        eqValue: programId,
        orderField: 'aired_at',
        ascending: false
      },
      {
        table: 'pledge_program_air_dates',
        eqField: 'pledge_program_id',
        eqValue: programId,
        orderField: 'air_date',
        ascending: false
      },
      {
        table: 'pledge_airings',
        eqField: 'pledge_program_id',
        eqValue: programId,
        orderField: 'aired_at',
        ascending: false
      }
    ]);
    if (!airingSource) detailWarnings.push('Air-date contribution history is unavailable for this role or this title.');

    setDetailNotice(detailWarnings.length ? detailWarnings.join(' ') : '', detailWarnings.length ? 'warn' : '');
    renderDetail(mergedProgram, versions, segments, premiums, airings);
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
    } catch (error) {
      console.warn('Auth user check failed; staying viewer-only.', error);
      state.userEmail = null;
      state.isAdmin = false;
      setRoleUi();
    }
  };

  const resetFilters = () => {
    state.searchText = '';
    state.searchField = '';
    state.statusFilter = 'active';
    state.topicFilters = [];
    state.secondaryTopicFilters = [];
    state.lengthFilters = [];
    state.distributorFilter = '';
    state.page = 1;
    els.searchInput.value = '';
    els.searchFieldSelect.value = '';
    els.statusFilter.value = 'active';
    renderMultiSelect(els.topicFilter, state.topicOptions, state.topicFilters);
    renderMultiSelect(els.secondaryTopicFilter, state.secondaryTopicOptions, state.secondaryTopicFilters);
    renderLengthOptions();
    renderDistributorOptions();
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

  els.secondaryTopicFilter.addEventListener('change', () => {
    state.secondaryTopicFilters = selectedValues(els.secondaryTopicFilter);
    state.page = 1;
    void loadLibrary();
  });

  els.lengthFilter.addEventListener('change', () => {
    state.lengthFilters = selectedValues(els.lengthFilter);
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

  els.clearSecondaryTopicFilter.addEventListener('click', () => {
    [...els.secondaryTopicFilter.options].forEach((option) => { option.selected = false; });
    state.secondaryTopicFilters = [];
    state.page = 1;
    void loadLibrary();
  });

  els.clearLengthFilter.addEventListener('click', () => {
    [...els.lengthFilter.options].forEach((option) => { option.selected = false; });
    state.lengthFilters = [];
    state.page = 1;
    void loadLibrary();
  });

  els.resetFiltersButton.addEventListener('click', () => {
    resetFilters();
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

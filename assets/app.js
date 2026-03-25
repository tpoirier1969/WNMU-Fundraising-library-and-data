(() => {
  const cfg = window.PLEDGE_MANAGER_CONFIG || {};
  const APP_VERSION = 'v0.6.2';
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
    resetFiltersButton: document.getElementById('reset-filters-button'),
    refreshButton: document.getElementById('refresh-button'),
    adminNewButton: document.getElementById('admin-new-button'),
    adminEditButton: document.getElementById('admin-edit-button'),
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
    'premium_summary'
  ]);

  const state = {
    client: null,
    isAdmin: false,
    userEmail: null,
    totalRows: 0,
    rows: [],
    selectedProgramId: null,
    searchText: '',
    searchField: '',
    statusFilter: 'all',
    topicFilter: '',
    secondaryTopicFilter: '',
    lengthFilter: '',
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

  const firstNonEmpty = (...values) => {
    for (const value of values) {
      if (value === 0) return value;
      const text = normalizeText(value);
      if (text) return value;
    }
    return null;
  };

  const asDateLike = (value) => {
    const candidate = firstNonEmpty(value);
    return candidate == null ? '' : String(candidate);
  };

  const asNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const deriveTitle = (row) => firstNonEmpty(row.title, row.program_title) || 'Untitled';
  const deriveNola = (row) => firstNonEmpty(row.nola_code, row.nola, row.program_nola) || '';
  const deriveDistributor = (row) => firstNonEmpty(row.distributor, row.distributor_name) || '';
  const deriveTopicPrimary = (row) => firstNonEmpty(row.topic_primary, row.primary_topic, row.topic) || '';
  const deriveTopicSecondary = (row) => firstNonEmpty(row.topic_secondary, row.secondary_topic, row.topic_secondary_name) || '';
  const derivePremiumSummary = (row) => firstNonEmpty(row.premium_summary, row.premiums, row.premium_text) || '';
  const deriveDescription = (row) => firstNonEmpty(row.description, row.program_description, row.synopsis, row.short_description, row.program_notes) || '';
  const deriveRightsBegin = (row) => asDateLike(firstNonEmpty(row.rights_start, row.rights_begin, row.rights_start_date, row.rights_begin_date));
  const deriveRightsEnd = (row) => asDateLike(firstNonEmpty(row.rights_end, row.rights_stop, row.rights_end_date, row.rights_expire_date));
  const deriveLastAiredRaw = (row) => asDateLike(firstNonEmpty(row.last_aired_at, row.last_aired, row.last_air_date, row.last_air_datetime, row.most_recent_air_date));

  const parseRuntimeMinutes = (row) => {
    const direct = asNumber(firstNonEmpty(row.board_runtime_minutes, row.runtime_minutes, row.length_minutes, row.board_length_minutes));
    if (direct && direct > 0) return direct;
    const exact = normalizeText(firstNonEmpty(row.exact_runtime, row.runtime, row.actual_runtime));
    if (!exact) return null;
    if (/^\d+$/.test(exact)) return asNumber(exact);
    const parts = exact.split(':').map((part) => Number(part));
    if (parts.some((part) => Number.isNaN(part))) return null;
    if (parts.length === 3) return (parts[0] * 60) + parts[1] + (parts[2] >= 30 ? 1 : 0);
    if (parts.length === 2) return parts[0] + (parts[1] >= 30 ? 1 : 0);
    return null;
  };

  const coarseLengthMinutes = (row) => {
    const minutes = parseRuntimeMinutes(row);
    if (!minutes || minutes <= 0) return null;
    return Math.max(30, Math.round(minutes / 30) * 30);
  };

  const coarseLengthLabel = (row) => {
    const bucket = coarseLengthMinutes(row);
    return bucket ? String(bucket) : '—';
  };

  const runtimeDetailLabel = (row) => {
    const exact = normalizeText(firstNonEmpty(row.exact_runtime, row.runtime, row.actual_runtime));
    if (exact) return exact;
    const minutes = parseRuntimeMinutes(row);
    return minutes ? `${minutes} min` : '—';
  };

  const formatMoney = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return normalizeText(value) || '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(num);
  };

  const formatDate = (value, fallback = '—') => {
    if (!value) return fallback;
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

  const formatInterval = (value) => normalizeText(value) || '—';

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

  const labelValue = (label, value) => `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${value}</dd>
    </div>
  `;

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

  const fetchRowsByIds = async (table, columns, ids) => {
    const rows = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunkIds = ids.slice(i, i + 500);
      const { data, error } = await state.client.from(table).select(columns).in('id', chunkIds);
      if (error) throw error;
      rows.push(...(data || []));
    }
    return rows;
  };

  const renderSelectOptions = (select, values, currentValue, placeholder) => {
    const options = [`<option value="">${escapeHtml(placeholder)}</option>`];
    values.forEach((value) => {
      const selected = currentValue === value ? 'selected' : '';
      options.push(`<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(value)}</option>`);
    });
    select.innerHTML = options.join('');
  };

  const enrichRowsFromBase = async (rows) => {
    const ids = rows.map((row) => row.id).filter(Boolean);
    if (!ids.length) return rows;
    try {
      const data = await fetchRowsByIds(
        'pledge_programs',
        'id, rights_start, rights_begin, rights_end, rights_stop, last_aired_at, last_aired, last_air_date, topic_secondary, board_runtime_minutes, exact_runtime, description, program_description, synopsis, title, distributor, nola_code, premium_summary, program_notes, lifetime_dollars',
        ids
      );
      const byId = new Map((data || []).map((row) => [String(row.id), row]));
      return rows.map((row) => ({ ...row, ...(byId.get(String(row.id)) || {}) }));
    } catch (error) {
      console.warn('Optional base pledge enrichment failed; staying with summary rows.', error);
      return rows;
    }
  };

  const compareText = (a, b) => normalizeText(a).localeCompare(normalizeText(b), undefined, { sensitivity: 'base', numeric: true });

  const sortRows = (rows) => [...rows].sort((a, b) => {
    const topicCompare = compareText(deriveTopicPrimary(a), deriveTopicPrimary(b));
    if (topicCompare !== 0) return topicCompare;
    return compareText(deriveTitle(a), deriveTitle(b));
  });

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
      `premium_summary.ilike.${like}`
    ].join(','));
  };

  const applyCommonFilters = (query) => {
    if (state.statusFilter === 'active') {
      query = query.eq('status', 'active');
    } else if (state.statusFilter === 'archived') {
      query = query.eq('status', 'archived');
    }
    if (state.topicFilter) query = query.eq('topic_primary', state.topicFilter);
    if (state.secondaryTopicFilter) query = query.eq('topic_secondary', state.secondaryTopicFilter);
    if (state.distributorFilter) query = query.eq('distributor', state.distributorFilter);
    query = applySearchFilter(query);
    return query;
  };

  const filterRowsByLength = (rows) => {
    if (!state.lengthFilter) return rows;
    return rows.filter((row) => coarseLengthLabel(row) === state.lengthFilter);
  };

  const loadFilterOptions = async () => {
    const rows = await fetchAllRows(READ_VIEW, '*', (query) => query
      .order('topic_primary', { ascending: true, nullsFirst: false })
      .order('title', { ascending: true, nullsFirst: false })
    );

    const enrichedRows = await enrichRowsFromBase(rows);

    state.topicOptions = Array.from(new Set(enrichedRows.map((row) => deriveTopicPrimary(row)).filter(Boolean)))
      .sort(compareText);
    state.secondaryTopicOptions = Array.from(new Set(enrichedRows.map((row) => deriveTopicSecondary(row)).filter(Boolean)))
      .sort(compareText);
    state.distributorOptions = Array.from(new Set(enrichedRows.map((row) => deriveDistributor(row)).filter(Boolean)))
      .sort(compareText);
    state.lengthOptions = Array.from(new Set(enrichedRows.map((row) => coarseLengthLabel(row)).filter((value) => value && value !== '—')))
      .sort((a, b) => Number(a) - Number(b));

    renderSelectOptions(els.topicFilter, state.topicOptions, state.topicFilter, 'All topics');
    renderSelectOptions(els.secondaryTopicFilter, state.secondaryTopicOptions, state.secondaryTopicFilter, 'All secondary topics');
    renderSelectOptions(els.lengthFilter, state.lengthOptions, state.lengthFilter, 'All lengths');
    renderSelectOptions(els.distributorFilter, state.distributorOptions, state.distributorFilter, 'All distributors');
  };

  const syncSelectedRows = () => {
    [...els.libraryBody.querySelectorAll('tr[data-id]')].forEach((tr) => {
      tr.classList.toggle('selected', tr.dataset.id === state.selectedProgramId);
    });
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
        <td>${escapeHtml(coarseLengthLabel(row))}</td>
        <td>${escapeHtml(deriveTopicPrimary(row) || '—')}</td>
        <td>${escapeHtml(deriveDistributor(row) || '—')}</td>
        <td class="premiums-cell">${premiumSummaryHtml(derivePremiumSummary(row))}</td>
        <td>${escapeHtml(formatDate(deriveRightsBegin(row)))}</td>
        <td>${escapeHtml(formatDate(deriveRightsEnd(row)))}</td>
        <td>${escapeHtml(formatDate(deriveLastAiredRaw(row), 'N/A'))}</td>
      </tr>
    `).join('');
  };

  const updateSummary = () => {
    const filters = [];
    if (state.topicFilter) filters.push(`topic: ${state.topicFilter}`);
    if (state.secondaryTopicFilter) filters.push(`secondary: ${state.secondaryTopicFilter}`);
    if (state.lengthFilter) filters.push(`length: ${state.lengthFilter}`);
    if (state.distributorFilter) filters.push(`distributor: ${state.distributorFilter}`);
    if (state.statusFilter !== 'all') filters.push(state.statusFilter === 'active' ? 'active only' : 'archived only');
    const filterText = filters.length ? ` · filters: ${filters.join(', ')}` : '';
    els.resultSummary.textContent = `${state.totalRows.toLocaleString()} titles · sorted by topic then title${filterText}`;
  };

  const loadLibrary = async () => {
    if (!state.client) return;
    els.libraryBody.innerHTML = '<tr><td colspan="8" class="placeholder-row">Loading library…</td></tr>';

    try {
      const rows = await fetchAllRows(READ_VIEW, '*', (query) => applyCommonFilters(query)
        .order('topic_primary', { ascending: true, nullsFirst: false })
        .order('title', { ascending: true, nullsFirst: false })
      );
      const enrichedRows = await enrichRowsFromBase(rows);
      const filteredRows = filterRowsByLength(enrichedRows);
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
      `<span class="detail-chip">Length ${escapeHtml(runtimeDetailLabel(program))}</span>`,
      `<span class="detail-chip">NOLA ${escapeHtml(deriveNola(program) || 'No NOLA')}</span>`,
      `<span class="detail-chip">${escapeHtml(deriveDistributor(program) || 'No distributor listed')}</span>`
    ];
    return parts.join('');
  };

  const renderOverview = (program) => {
    const topicValue = [deriveTopicPrimary(program), deriveTopicSecondary(program)].filter(Boolean).join(' / ') || '—';
    const premiumSummary = derivePremiumSummary(program) ? premiumSummaryHtml(derivePremiumSummary(program)) : '—';
    els.overviewGrid.innerHTML = [
      labelValue('Topic', escapeHtml(topicValue)),
      labelValue('Rights begin', escapeHtml(formatDate(deriveRightsBegin(program)))),
      labelValue('Rights end', escapeHtml(formatDate(deriveRightsEnd(program)))),
      labelValue('Last aired', escapeHtml(formatDate(deriveLastAiredRaw(program), 'N/A'))),
      labelValue('Actual runtime', escapeHtml(runtimeDetailLabel(program))),
      labelValue('Lifetime dollars', escapeHtml(formatMoney(program.lifetime_dollars || 0))),
      labelValue('Description', escapeHtml(deriveDescription(program) || '—')),
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
    versions.forEach((version) => grouped.set(String(version.id), []));
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
              <span class="mini-chip">Length ${escapeHtml(runtimeDetailLabel(version))}</span>
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
    els.timingList.innerHTML = blocks.length ? blocks.join('') : '<div class="timing-card">No structured segment timing rows are available for this title.</div>';
  };

  const deriveAiringDateTime = (row) => firstNonEmpty(row.aired_at, row.air_datetime, row.air_date_time, row.air_timestamp, row.airing_at, row.air_date, row.last_aired_at, row.last_air_date) || null;
  const deriveAiringAmount = (row) => firstNonEmpty(row.amount_contributed, row.contributed_amount, row.contribution_amount, row.total_pledged, row.total_contributed, row.dollars_raised, row.amount_raised, row.pledged_amount);

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
    els.detailTitle.textContent = deriveTitle(program) || 'Program detail';
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
      } catch (_error) {
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
    if (rowSummary) renderDetail(rowSummary, [], [], [], []);

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
        } catch (_error) {
          detailWarnings.push('Segment rows are unavailable for this role or this title.');
        }
      }
    }

    const { data: airings, source: airingSource } = await queryFirstReadable([
      { table: 'pledge_program_airings', eqField: 'pledge_program_id', eqValue: programId, orderField: 'aired_at', ascending: false },
      { table: 'pledge_program_air_dates', eqField: 'pledge_program_id', eqValue: programId, orderField: 'air_date', ascending: false },
      { table: 'pledge_airings', eqField: 'pledge_program_id', eqValue: programId, orderField: 'aired_at', ascending: false }
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
    state.statusFilter = 'all';
    state.topicFilter = '';
    state.secondaryTopicFilter = '';
    state.lengthFilter = '';
    state.distributorFilter = '';
    els.searchInput.value = '';
    els.searchFieldSelect.value = '';
    els.statusFilter.value = 'all';
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
      void loadLibrary();
    }, 220);
  });

  els.searchFieldSelect.addEventListener('change', (event) => {
    state.searchField = event.target.value || '';
    void loadLibrary();
  });

  els.topicFilter.addEventListener('change', (event) => {
    state.topicFilter = event.target.value || '';
    void loadLibrary();
  });

  els.secondaryTopicFilter.addEventListener('change', (event) => {
    state.secondaryTopicFilter = event.target.value || '';
    void loadLibrary();
  });

  els.lengthFilter.addEventListener('change', (event) => {
    state.lengthFilter = event.target.value || '';
    void loadLibrary();
  });

  els.distributorFilter.addEventListener('change', (event) => {
    state.distributorFilter = event.target.value || '';
    void loadLibrary();
  });

  els.statusFilter.addEventListener('change', (event) => {
    state.statusFilter = event.target.value || 'all';
    void loadLibrary();
  });

  els.resetFiltersButton.addEventListener('click', () => {
    resetFilters();
    void loadLibrary();
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

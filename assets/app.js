(() => {
  const cfg = window.PLEDGE_MANAGER_CONFIG || {};
  const APP_VERSION = cfg.APP_VERSION || 'v0.5.0';
  const PAGE_SIZE = Number(cfg.DEFAULT_PAGE_SIZE || 100);
  const ADMIN_EMAILS = Array.isArray(cfg.ADMIN_EMAILS) ? cfg.ADMIN_EMAILS.map((e) => String(e).trim().toLowerCase()) : [];

  const els = {
    configStatus: document.getElementById('config-status'),
    roleChip: document.getElementById('role-chip'),
    versionFlag: document.getElementById('version-flag'),
    footerVersion: document.getElementById('footer-version'),
    searchInput: document.getElementById('search-input'),
    statusFilter: document.getElementById('status-filter'),
    sortSelect: document.getElementById('sort-select'),
    resultSummary: document.getElementById('result-summary'),
    pageLabel: document.getElementById('page-label'),
    prevPage: document.getElementById('prev-page'),
    nextPage: document.getElementById('next-page'),
    refreshButton: document.getElementById('refresh-button'),
    libraryBody: document.getElementById('library-body'),
    detailModal: document.getElementById('detail-modal'),
    detailBackdrop: document.getElementById('detail-backdrop'),
    detailCloseButton: document.getElementById('detail-close-button'),
    detailTitle: document.getElementById('detail-title'),
    detailSubtitle: document.getElementById('detail-subtitle'),
    detailEmpty: document.getElementById('detail-empty'),
    detailContent: document.getElementById('detail-content'),
    overviewGrid: document.getElementById('overview-grid'),
    versionsList: document.getElementById('versions-list'),
    premiumsList: document.getElementById('premiums-list'),
    versionCountChip: document.getElementById('version-count-chip'),
    premiumCountChip: document.getElementById('premium-count-chip'),
    adminNewButton: document.getElementById('admin-new-button'),
    adminEditButton: document.getElementById('admin-edit-button')
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
    statusFilter: 'active',
    sortBy: 'title'
  };

  const setNotice = (text, type = '') => {
    els.configStatus.textContent = text;
    els.configStatus.className = 'notice-strip';
    if (type) els.configStatus.classList.add(type);
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const formatMoney = (value) => {
    const num = Number(value || 0);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
  };

  const formatDate = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatInterval = (value) => {
    if (!value) return '—';
    if (typeof value === 'string') return value;
    return String(value);
  };

  const labelValue = (label, value) => `
    <dt>${escapeHtml(label)}</dt>
    <dd>${escapeHtml(value ?? '—')}</dd>
  `;

  const setRoleUi = () => {
    els.versionFlag.textContent = APP_VERSION;
    els.footerVersion.textContent = APP_VERSION;
    if (state.isAdmin) {
      els.roleChip.textContent = state.userEmail ? `Admin · ${state.userEmail}` : 'Admin';
      els.roleChip.classList.add('admin');
      els.adminNewButton.classList.remove('hidden');
      els.adminEditButton.classList.remove('hidden');
    } else {
      els.roleChip.textContent = state.userEmail ? `Viewer · ${state.userEmail}` : 'Viewer';
      els.roleChip.classList.remove('admin');
      els.adminNewButton.classList.add('hidden');
      els.adminEditButton.classList.add('hidden');
    }
  };

  const getSortClause = () => {
    switch (state.sortBy) {
      case 'runtime': return { column: 'board_runtime_minutes', ascending: true, nullsFirst: false };
      case 'money': return { column: 'lifetime_dollars', ascending: false, nullsFirst: false };
      case 'airings': return { column: 'times_aired_count', ascending: false, nullsFirst: false };
      case 'recent': return { column: 'last_aired_at', ascending: false, nullsFirst: false };
      case 'title':
      default: return { column: 'title', ascending: true, nullsFirst: false };
    }
  };

  const syncSelectedRows = () => {
    [...els.libraryBody.querySelectorAll('tr[data-id]')].forEach((tr) => {
      tr.classList.toggle('selected', tr.dataset.id === state.selectedProgramId);
    });
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

  const renderRows = () => {
    if (!state.rows.length) {
      els.libraryBody.innerHTML = '<tr><td colspan="10" class="placeholder-row">No matching pledge titles found.</td></tr>';
      return;
    }
    els.libraryBody.innerHTML = state.rows.map((row) => {
      const premiumText = row.premium_summary ? row.premium_summary.slice(0, 70) : '—';
      return `
        <tr data-id="${escapeHtml(row.id)}" class="${row.id === state.selectedProgramId ? 'selected' : ''}">
          <td class="title-cell">
            <button type="button" class="title-open-button" data-open-id="${escapeHtml(row.id)}" aria-label="Open details for ${escapeHtml(row.title)}">
              <strong>${escapeHtml(row.title)}</strong>
              <div class="sub">${escapeHtml(row.exact_runtime || '')}</div>
            </button>
          </td>
          <td>${escapeHtml(row.nola_code || '—')}</td>
          <td>${escapeHtml(row.version_count || 0)}</td>
          <td>${escapeHtml(row.board_runtime_minutes || '—')}</td>
          <td>${escapeHtml(row.break_count ?? '—')}</td>
          <td>${escapeHtml(row.local_cut_in_count ?? '—')}</td>
          <td>${escapeHtml(row.topic_primary || '—')}</td>
          <td>${escapeHtml(row.distributor || '—')}</td>
          <td title="${escapeHtml(row.premium_summary || '')}">${escapeHtml(premiumText)}</td>
          <td><span class="status-pill ${escapeHtml(row.status || 'active')}">${escapeHtml(row.status || 'active')}</span></td>
        </tr>
      `;
    }).join('');
  };

  const updateSummary = () => {
    const first = state.totalRows === 0 ? 0 : ((state.page - 1) * PAGE_SIZE) + 1;
    const last = Math.min(state.totalRows, state.page * PAGE_SIZE);
    els.resultSummary.textContent = `${state.totalRows.toLocaleString()} titles · showing ${first.toLocaleString()}–${last.toLocaleString()}`;
    const pageCount = Math.max(1, Math.ceil(state.totalRows / PAGE_SIZE));
    els.pageLabel.textContent = `Page ${state.page} of ${pageCount}`;
    els.prevPage.disabled = state.page <= 1;
    els.nextPage.disabled = state.page >= pageCount;
  };

  const loadLibrary = async () => {
    if (!state.client) return;
    els.libraryBody.innerHTML = '<tr><td colspan="10" class="placeholder-row">Loading library…</td></tr>';

    const sort = getSortClause();
    const from = (state.page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = state.client
      .from('pledge_program_library_summary')
      .select('*', { count: 'exact' })
      .order(sort.column, { ascending: sort.ascending, nullsFirst: sort.nullsFirst })
      .range(from, to);

    if (state.statusFilter === 'active') {
      query = query.eq('status', 'active');
    } else if (state.statusFilter === 'archived') {
      query = query.eq('status', 'archived');
    }

    const search = state.searchText.trim();
    if (search) {
      const like = `%${search}%`;
      query = query.or([
        `title.ilike.${like}`,
        `nola_code.ilike.${like}`,
        `topic_primary.ilike.${like}`,
        `distributor.ilike.${like}`,
        `premium_summary.ilike.${like}`
      ].join(','));
    }

    const { data, error, count } = await query;
    if (error) {
      console.error(error);
      els.libraryBody.innerHTML = `<tr><td colspan="10" class="placeholder-row">${escapeHtml(error.message)}</td></tr>`;
      els.resultSummary.textContent = 'Load failed.';
      return;
    }

    state.rows = data || [];
    state.totalRows = count || 0;
    renderRows();
    updateSummary();
    syncSelectedRows();
  };

  const renderDetail = (program, versions, premiums) => {
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    els.detailTitle.textContent = program.title || 'Program detail';
    els.detailSubtitle.textContent = `${program.nola_code || 'No NOLA'} · ${program.distributor || 'No distributor listed'}`;

    els.overviewGrid.innerHTML = [
      labelValue('Short title', program.short_title || '—'),
      labelValue('Topic', program.topic_primary || '—'),
      labelValue('Secondary topic', program.topic_secondary || '—'),
      labelValue('Board runtime', program.board_runtime_minutes ? `${program.board_runtime_minutes} min` : '—'),
      labelValue('Exact runtime', formatInterval(program.exact_runtime)),
      labelValue('Pickup type', program.pickup_type || '—'),
      labelValue('Source format', program.source_format || '—'),
      labelValue('Storage', program.storage_location || '—'),
      labelValue('Rights start', formatDate(program.rights_start)),
      labelValue('Rights end', formatDate(program.rights_end)),
      labelValue('Premium summary', program.premium_summary || '—'),
      labelValue('Status', program.status || '—'),
      labelValue('Times aired', program.times_aired_count ?? 0),
      labelValue('Lifetime dollars', formatMoney(program.lifetime_dollars || 0)),
      labelValue('Last aired', program.last_aired_at ? formatDate(program.last_aired_at) : '—'),
      labelValue('Notes', program.program_notes || '—')
    ].join('');

    els.versionCountChip.textContent = `${versions.length}`;
    els.versionsList.innerHTML = versions.length ? versions.map((version) => {
      const segments = (version.segments || []).map((segment) => `
        <tr>
          <td>${segment.segment_order}</td>
          <td>${escapeHtml(segment.segment_type)}</td>
          <td>${escapeHtml(segment.label)}</td>
          <td>${escapeHtml(formatInterval(segment.duration) || '—')}</td>
          <td>${escapeHtml(segment.duration_minutes ?? '—')}</td>
          <td>${segment.local_cut_in_available ? 'Yes' : '—'}</td>
          <td>${escapeHtml(segment.notes || '—')}</td>
        </tr>
      `).join('');
      return `
        <article class="version-card">
          <div class="version-card-head">
            <h4>${escapeHtml(version.version_label || 'Version')}</h4>
            <span class="status-pill ${escapeHtml(version.status || 'active')}">${escapeHtml(version.break_style || 'OTHER')}</span>
          </div>
          <div class="version-meta">
            <span class="mini-chip">Board ${escapeHtml(version.board_runtime_minutes ?? '—')} min</span>
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
    }).join('') : '<div class="premium-card">No versions found for this title.</div>';

    els.premiumCountChip.textContent = `${premiums.length}`;
    els.premiumsList.innerHTML = premiums.length ? premiums.map((premium) => `
      <article class="premium-card">
        <h4>${escapeHtml(premium.premium_name || 'Premium')}</h4>
        <div class="muted">${escapeHtml(premium.premium_type || 'No type')} · ${premium.ask_amount ? formatMoney(premium.ask_amount) : 'No ask amount'}</div>
        <div>${escapeHtml(premium.description || premium.fulfillment_notes || 'No premium notes.')}</div>
      </article>
    `).join('') : '<div class="premium-card">No structured premium rows yet. The main premium summary is still visible above.</div>';
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
    els.detailTitle.textContent = 'Loading…';
    els.detailSubtitle.textContent = 'Pulling imported data.';
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    els.overviewGrid.innerHTML = '';
    els.versionsList.innerHTML = '<div class="premium-card">Loading versions…</div>';
    els.premiumsList.innerHTML = '<div class="premium-card">Loading premiums…</div>';

    const [{ data: program, error: programError }, { data: versions, error: versionsError }, { data: premiums, error: premiumsError }] = await Promise.all([
      state.client.from('pledge_programs').select('*').eq('id', programId).maybeSingle(),
      state.client.from('pledge_program_versions').select('*').eq('pledge_program_id', programId).order('version_label', { ascending: true }),
      state.client.from('pledge_premiums').select('*').eq('pledge_program_id', programId).order('premium_name', { ascending: true })
    ]);

    if (programError || versionsError || premiumsError) {
      console.error(programError || versionsError || premiumsError);
      showDetailFailure((programError || versionsError || premiumsError).message);
      return;
    }

    const versionIds = (versions || []).map((version) => version.id);
    let segments = [];
    if (versionIds.length) {
      const { data: segmentData, error: segmentError } = await state.client
        .from('pledge_program_segments')
        .select('*')
        .in('pledge_program_version_id', versionIds)
        .order('segment_order', { ascending: true });
      if (segmentError) {
        console.error(segmentError);
      } else {
        segments = segmentData || [];
      }
    }

    const groupedSegments = new Map();
    for (const segment of segments) {
      if (!groupedSegments.has(segment.pledge_program_version_id)) groupedSegments.set(segment.pledge_program_version_id, []);
      groupedSegments.get(segment.pledge_program_version_id).push(segment);
    }

    const versionsWithSegments = (versions || []).map((version) => ({
      ...version,
      segments: groupedSegments.get(version.id) || []
    }));

    renderDetail(program || {}, versionsWithSegments, premiums || []);
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
      setNotice('Fill in config.js with your Supabase URL and anon key. Until then this page is just decorative.', 'warn');
      setRoleUi();
      return;
    }

    state.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    setNotice('Config found. Connecting to Supabase and loading pledge titles.', 'good');
    await initAuthRole();
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

  els.statusFilter.addEventListener('change', (event) => {
    state.statusFilter = event.target.value;
    state.page = 1;
    void loadLibrary();
  });

  els.sortSelect.addEventListener('change', (event) => {
    state.sortBy = event.target.value;
    state.page = 1;
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

  els.refreshButton.addEventListener('click', () => {
    void loadLibrary();
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
    if (event.key === 'Escape' && !els.detailModal.classList.contains('hidden')) {
      closeDetailModal();
    }
  });

  els.adminNewButton.addEventListener('click', () => {
    window.alert('Add/edit tools are intentionally held for the next build. This pass is still for validating the imported pledge library data first.');
  });

  els.adminEditButton.addEventListener('click', () => {
    window.alert('Edit mode is not in this build yet. I only moved the details workflow into a popup so it matches the Program Library pattern more closely.');
  });

  window.addEventListener('DOMContentLoaded', () => {
    void init();
  });
})();

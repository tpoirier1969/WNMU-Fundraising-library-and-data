(() => {
  const App = window.PledgeLib;
  const { state, constants, utils, derive } = App;
  const { els, renderSelectOptions, setNotice } = App.dom;

  function searchableTextForField(row, field) {
    const map = {
      title: derive.title(row),
      nola_code: derive.nola(row),
      topic_primary: derive.topicPrimary(row),
      topic_secondary: derive.topicSecondary(row),
      distributor: derive.distributor(row),
      premium_summary: derive.premiumSummary(row),
      program_notes: derive.description(row)
    };
    return utils.normalizeText(map[field] || row?.[field] || '');
  }

  function rowMatchesSearch(row) {
    const search = utils.normalizeText(state.searchText).toLowerCase();
    if (!search) return true;
    const cleanedSearch = search.replace(/,/g, ' ').replace(/%/g, '').replace(/_/g, ' ');
    if (constants.SEARCHABLE_FIELDS.has(state.searchField)) {
      return searchableTextForField(row, state.searchField).toLowerCase().includes(cleanedSearch);
    }
    return [
      derive.title(row),
      derive.nola(row),
      derive.topicPrimary(row),
      derive.topicSecondary(row),
      derive.distributor(row),
      derive.premiumSummary(row),
      derive.description(row)
    ].some((value) => utils.normalizeText(value).toLowerCase().includes(cleanedSearch));
  }

  function rowMatchesFilters(row) {
    if (state.topicFilter && derive.topicPrimary(row) !== state.topicFilter) return false;
    if (state.secondaryTopicFilter && derive.topicSecondary(row) !== state.secondaryTopicFilter) return false;
    if (state.distributorFilter && derive.distributor(row) !== state.distributorFilter) return false;
    if (state.lengthFilter && derive.lengthLabel(row) !== state.lengthFilter) return false;
    if (state.statusFilter === 'active' && !derive.isActive(row)) return false;
    if (state.statusFilter === 'archived' && derive.isActive(row)) return false;
    return rowMatchesSearch(row);
  }

  function sortRows(rows) {
    return [...rows].sort((a, b) => {
      const topicCompare = utils.compareText(derive.topicPrimary(a), derive.topicPrimary(b));
      if (topicCompare !== 0) return topicCompare;
      return utils.compareText(derive.title(a), derive.title(b));
    });
  }

  function premiumSummaryHtml(value) {
    const text = utils.normalizeText(value);
    if (!text) return '<div class="premium-line">—</div>';
    const lines = text
      .replace(/\s*;\s*/g, '\n')
      .replace(/\s+(?=\$)/g, '\n')
      .split(/\n+/)
      .map((part) => utils.normalizeText(part))
      .filter(Boolean);
    const finalLines = lines.length ? lines : [text];
    return finalLines.map((line) => `<div class="premium-line">${utils.escapeHtml(line)}</div>`).join('');
  }

  function buildFilterOptions() {
    const rows = state.rawRows || [];
    state.topicOptions = Array.from(new Set(rows.map((row) => derive.topicPrimary(row)).filter(Boolean))).sort(utils.compareText);
    state.secondaryTopicOptions = Array.from(new Set(rows.map((row) => derive.topicSecondary(row)).filter(Boolean))).sort(utils.compareText);
    state.distributorOptions = Array.from(new Set(rows.map((row) => derive.distributor(row)).filter(Boolean))).sort(utils.compareText);
    state.lengthOptions = Array.from(new Set(rows.map((row) => derive.lengthLabel(row)).filter((value) => value && value !== '—'))).sort((a, b) => Number(a) - Number(b));

    renderSelectOptions(els.topicFilter, state.topicOptions, state.topicFilter, 'All topics');
    renderSelectOptions(els.secondaryTopicFilter, state.secondaryTopicOptions, state.secondaryTopicFilter, 'All secondary topics');
    renderSelectOptions(els.lengthFilter, state.lengthOptions, state.lengthFilter, 'All lengths');
    renderSelectOptions(els.distributorFilter, state.distributorOptions, state.distributorFilter, 'All distributors');
  }

  function renderRows() {
    if (!state.rows.length) {
      els.libraryBody.innerHTML = '<tr><td colspan="8" class="placeholder-row">No matching pledge titles found.</td></tr>';
      return;
    }

    els.libraryBody.innerHTML = state.rows.map((row) => {
      const programId = derive.programId(row);
      return `
        <tr data-id="${utils.escapeHtml(programId)}" class="${String(programId) === String(state.selectedProgramId) ? 'selected' : ''}">
          <td class="title-cell">
            <button type="button" class="title-open-button" data-open-id="${utils.escapeHtml(programId)}" aria-label="Open details for ${utils.escapeHtml(derive.title(row))}">
              <strong>${utils.escapeHtml(derive.title(row))}</strong>
              <div class="sub">${utils.escapeHtml(derive.nola(row) || 'No NOLA')} · ${utils.escapeHtml(derive.distributor(row) || 'No distributor')}</div>
              <div class="description-snippet">${utils.escapeHtml(derive.description(row) || '—')}</div>
            </button>
          </td>
          <td>${utils.escapeHtml(derive.lengthLabel(row))}</td>
          <td>${utils.escapeHtml(derive.topicPrimary(row) || '—')}</td>
          <td>${utils.escapeHtml(derive.distributor(row) || '—')}</td>
          <td class="premiums-cell">${premiumSummaryHtml(derive.premiumSummary(row))}</td>
          <td>${utils.escapeHtml(utils.formatDate(derive.rightsBegin(row)))}</td>
          <td>${utils.escapeHtml(utils.formatDate(derive.rightsEnd(row)))}</td>
          <td>${utils.escapeHtml(derive.lastAiredDisplay(row))}</td>
        </tr>
      `;
    }).join('');
  }

  function updateSummary() {
    const filters = [];
    if (state.topicFilter) filters.push(`topic: ${state.topicFilter}`);
    if (state.secondaryTopicFilter) filters.push(`secondary: ${state.secondaryTopicFilter}`);
    if (state.lengthFilter) filters.push(`length: ${state.lengthFilter}`);
    if (state.distributorFilter) filters.push(`distributor: ${state.distributorFilter}`);
    filters.push(state.statusFilter === 'active' ? 'active only' : state.statusFilter === 'archived' ? 'archived only' : 'all titles');
    const sourceName = state.librarySource ? `source: ${state.librarySource.name}` : 'source: unknown';
    els.resultSummary.textContent = `${state.totalRows.toLocaleString()} titles · sorted by topic then title · ${filters.join(' · ')} · ${sourceName}`;
  }

  function syncSelectedRows() {
    [...els.libraryBody.querySelectorAll('tr[data-id]')].forEach((tr) => {
      tr.classList.toggle('selected', tr.dataset.id === String(state.selectedProgramId));
    });
  }

  function applyLibraryView() {
    const sourceRows = state.rawRows || [];
    state.rows = sortRows(sourceRows.filter(rowMatchesFilters));
    state.totalRows = state.rows.length;
    renderRows();
    updateSummary();
    syncSelectedRows();

    if (!sourceRows.length) {
      setNotice(`Connected, but ${state.librarySource?.name || 'the selected data source'} returned 0 rows.`, 'warn');
      return;
    }

    const statusLabel = state.statusFilter === 'active' ? 'active ' : state.statusFilter === 'archived' ? 'archived ' : '';
    setNotice(`Loaded ${utils.formatCount(state.totalRows)} ${statusLabel}titles from ${state.librarySource?.name || 'the pledge library source'}.`);
  }

  function resetFilters() {
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
    buildFilterOptions();
  }

  App.listUi = {
    buildFilterOptions,
    applyLibraryView,
    resetFilters,
    syncSelectedRows
  };
})();

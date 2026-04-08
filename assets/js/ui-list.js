(() => {
  const App = window.PledgeLib;
  const { state, constants, utils, derive } = App;
  const filters = App.programFilters;
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

  function rowMatchesStatus(row) {
    return filters.rowMatchesStatus(row, state.statusFilter);
  }

  function sameLookupValue(a, b) {
    return filters.sameLookupValue(a, b);
  }

  function rowMatchesFiltersExcept(row, except = '') {
    if (!rowMatchesStatus(row)) return false;
    if (except !== 'topic' && state.topicFilter && !sameLookupValue(derive.topicPrimary(row), state.topicFilter)) return false;
    if (except !== 'secondary' && state.secondaryTopicFilter && !sameLookupValue(derive.topicSecondary(row), state.secondaryTopicFilter)) return false;
    if (except !== 'distributor' && state.distributorFilter && !sameLookupValue(derive.distributor(row), state.distributorFilter)) return false;
    if (except !== 'length' && state.lengthFilter && derive.lengthLabel(row) !== state.lengthFilter) return false;
    return rowMatchesSearch(row);
  }

  function rowMatchesFilters(row) {
    return rowMatchesFiltersExcept(row, '');
  }

  function compareBySortField(a, b) {
    switch (state.sortField) {
      case 'title':
        return utils.compareText(derive.title(a), derive.title(b));
      case 'length':
        return utils.compareNumber(derive.lengthBucket(a), derive.lengthBucket(b)) || utils.compareText(derive.title(a), derive.title(b));
      case 'rights_begin':
        return utils.compareDate(derive.rightsBegin(a), derive.rightsBegin(b)) || utils.compareText(derive.title(a), derive.title(b));
      case 'rights_end':
        return utils.compareDate(derive.rightsEnd(a), derive.rightsEnd(b)) || utils.compareText(derive.title(a), derive.title(b));
      case 'last_aired':
        return utils.compareDate(utils.firstNonEmpty(a?.last_aired_at, a?.last_aired, a?.aired_at), utils.firstNonEmpty(b?.last_aired_at, b?.last_aired, b?.aired_at)) || utils.compareText(derive.title(a), derive.title(b));
      case 'avg_per_fundraiser':
        return utils.compareNumber(derive.avgPerFundraiser(a), derive.avgPerFundraiser(b)) || utils.compareText(derive.title(a), derive.title(b));
      case 'topic':
      default:
        return utils.compareText(derive.topicPrimary(a), derive.topicPrimary(b)) || utils.compareText(derive.title(a), derive.title(b));
    }
  }

  function sortRows(rows) {
    const multiplier = state.sortDirection === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => compareBySortField(a, b) * multiplier);
  }

  function premiumLines(value) {
    const text = utils.normalizeText(value);
    if (!text) return ['—'];
    const lines = text
      .replace(/\r/g, '')
      .replace(/\s*;\s*/g, '\n')
      .split(/\n+/)
      .map((part) => utils.normalizeText(part))
      .filter(Boolean);
    return lines.length ? lines : [text];
  }

  function premiumSummaryHtml(value) {
    return `<div class="premium-lines">${premiumLines(value).map((line) => `<div class="premium-line">${utils.escapeHtml(line)}</div>`).join('')}</div>`;
  }


  function ensureCurrentOption(entries = [], currentValue = '') {
    if (!currentValue) return entries;
    if (entries.some((entry) => sameLookupValue(entry?.value ?? entry, currentValue))) return entries;
    return [{ value: currentValue, label: currentValue }, ...entries];
  }

  function buildFilterOptions() {
    const sourceRows = filters.collapseRows(state.rawRows || [], { statusPreference: state.statusFilter });
    const topicRows = sourceRows.filter((row) => rowMatchesFiltersExcept(row, 'topic'));
    const secondaryRows = sourceRows.filter((row) => rowMatchesFiltersExcept(row, 'secondary'));
    const distributorRows = sourceRows.filter((row) => rowMatchesFiltersExcept(row, 'distributor'));
    const lengthRows = sourceRows.filter((row) => rowMatchesFiltersExcept(row, 'length'));

    state.topicOptions = ensureCurrentOption(filters.canonicalOptionEntries(topicRows.map((row) => derive.topicPrimary(row)).filter(Boolean)), state.topicFilter);
    state.secondaryTopicOptions = ensureCurrentOption(filters.canonicalOptionEntries(secondaryRows.map((row) => derive.topicSecondary(row)).filter(Boolean)), state.secondaryTopicFilter);
    state.distributorOptions = ensureCurrentOption(filters.canonicalOptionEntries(distributorRows.map((row) => derive.distributor(row)).filter(Boolean)), state.distributorFilter);
    state.lengthOptions = ensureCurrentOption(Array.from(new Set(lengthRows.map((row) => derive.lengthLabel(row)).filter((value) => value && value !== '—'))).sort((a, b) => Number(a) - Number(b)), state.lengthFilter);

    renderSelectOptions(els.topicFilter, state.topicOptions, state.topicFilter, 'All topics');
    renderSelectOptions(els.secondaryTopicFilter, state.secondaryTopicOptions, state.secondaryTopicFilter, 'All secondary topics');
    renderSelectOptions(els.lengthFilter, state.lengthOptions, state.lengthFilter, 'All lengths');
    renderSelectOptions(els.distributorFilter, state.distributorOptions, state.distributorFilter, 'All distributors');
    if (els.sortFieldSelect) els.sortFieldSelect.value = state.sortField;
    if (els.sortDirectionButton) els.sortDirectionButton.textContent = state.sortDirection === 'desc' ? '↓ Desc' : '↑ Asc';
    syncSortHeaders();
  }

  function syncSortHeaders() {
    if (!els.sortHeaderButtons?.length) return;
    els.sortHeaderButtons.forEach((button) => {
      const field = button.dataset.sortField;
      const label = button.dataset.sortLabel || button.textContent.trim();
      const active = state.sortField === field;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.innerHTML = `<span>${utils.escapeHtml(label)}</span><span class="sort-arrow">${active ? (state.sortDirection === 'desc' ? '↓' : '↑') : '↕'}</span>`;
    });
  }

  function hasAired(row) {
    return filters.rowHasAired(row);
  }

  function earningsTone(row) {
    if (!hasAired(row)) return 'none';
    const avg = Number(derive.avgPerFundraiser(row) || 0);
    const total = Number(derive.totalRaised(row) || 0);
    if (avg >= 1000 || total >= 5000) return 'high';
    if (avg >= 500 || total >= 2500) return 'good';
    if (avg >= 150 || total >= 750) return 'mid';
    if (avg > 0 || total > 0) return 'low';
    return 'zero';
  }

  function renderRows() {
    if (!state.rows.length) {
      els.libraryBody.innerHTML = '<tr><td colspan="10" class="placeholder-row">No matching pledge titles found.</td></tr>';
      return;
    }

    els.libraryBody.innerHTML = state.rows.map((row) => {
      const programId = App.programLinks?.resolveId?.(row) || derive.programId(row);
      const tone = earningsTone(row);
      return `
        <tr data-id="${utils.escapeHtml(programId)}" class="library-earnings-${utils.escapeHtml(tone)} ${String(programId) === String(state.selectedProgramId) ? 'selected' : ''}">
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
          <td class="total-cell">${utils.escapeHtml(utils.formatMoney(derive.totalRaised(row)))}</td>
          <td class="avg-cell">${utils.escapeHtml(utils.formatMoney(derive.avgPerFundraiser(row)))}</td>
          <td class="premiums-cell">${premiumSummaryHtml(derive.premiumSummary(row))}</td>
          <td>${utils.escapeHtml(utils.formatDate(derive.rightsBegin(row)))}</td>
          <td>${utils.escapeHtml(utils.formatDate(derive.rightsEnd(row)))}</td>
          <td>${utils.escapeHtml(derive.lastAiredDisplay(row))}</td>
        </tr>
      `;
    }).join('');
  }

  function updateSummary(sourceRowCount = state.sourceCollapsedCount || 0) {
    const filters = [];
    if (state.topicFilter) filters.push(`topic: ${state.topicFilter}`);
    if (state.secondaryTopicFilter) filters.push(`secondary: ${state.secondaryTopicFilter}`);
    if (state.lengthFilter) filters.push(`length: ${state.lengthFilter}`);
    if (state.distributorFilter) filters.push(`distributor: ${state.distributorFilter}`);
    filters.push(state.statusFilter === 'active' ? 'active only' : state.statusFilter === 'archived' ? 'archived only' : 'all titles');
    filters.push(`sorted by ${utils.sortLabel(state.sortField)} ${state.sortDirection === 'desc' ? 'descending' : 'ascending'}`);
    const sourceName = state.librarySource ? `source: ${state.librarySource.name}` : 'source: unknown';
    const sourceBit = sourceRowCount && sourceRowCount !== state.totalRows
      ? ` · ${sourceRowCount.toLocaleString()} loaded before merge/filter`
      : '';
    els.resultSummary.textContent = `${state.totalRows.toLocaleString()} titles${sourceBit} · ${filters.join(' · ')} · ${sourceName}`;
  }

  function syncSelectedRows() {
    [...els.libraryBody.querySelectorAll('tr[data-id]')].forEach((tr) => {
      tr.classList.toggle('selected', tr.dataset.id === String(state.selectedProgramId));
    });
  }

  function applyLibraryView() {
    const sourceRows = filters.collapseRows(state.rawRows || [], { statusPreference: state.statusFilter });
    state.sourceCollapsedCount = sourceRows.length;
    buildFilterOptions();
    state.rows = sortRows(sourceRows.filter(rowMatchesFilters));
    state.totalRows = state.rows.length;
    renderRows();
    updateSummary(sourceRows.length);
    syncSelectedRows();
    syncSortHeaders();

    if (!sourceRows.length) {
      setNotice(`Connected, but ${state.librarySource?.name || 'the selected data source'} returned 0 rows.`, 'warn');
      return;
    }

    const statusLabel = state.statusFilter === 'active' ? 'active ' : state.statusFilter === 'archived' ? 'archived ' : '';
    const rawCount = Array.isArray(state.rawRows) ? state.rawRows.length : 0;
    const reductionNote = rawCount && rawCount !== sourceRows.length
      ? ` (${utils.formatCount(rawCount)} source rows collapsed to ${utils.formatCount(sourceRows.length)} titles)`
      : '';
    const filterNote = state.totalRows !== sourceRows.length
      ? ` Showing ${utils.formatCount(state.totalRows)} after current filters.`
      : '';
    setNotice(`Loaded ${utils.formatCount(sourceRows.length)} ${statusLabel}titles from ${state.librarySource?.name || 'the pledge library source'}.${reductionNote}${filterNote}`);
  }

  function resetFilters() {
    state.searchText = '';
    state.searchField = '';
    state.statusFilter = 'active';
    state.topicFilter = '';
    state.secondaryTopicFilter = '';
    state.lengthFilter = '';
    state.distributorFilter = '';
    state.sortField = 'topic';
    state.sortDirection = 'asc';
    els.searchInput.value = '';
    els.searchFieldSelect.value = '';
    els.statusFilter.value = 'active';
    buildFilterOptions();
  }

  function setSort(field) {
    if (state.sortField === field) {
      state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortField = field;
      state.sortDirection = 'asc';
    }
    if (els.sortFieldSelect) els.sortFieldSelect.value = state.sortField;
    if (els.sortDirectionButton) els.sortDirectionButton.textContent = state.sortDirection === 'desc' ? '↓ Desc' : '↑ Asc';
    applyLibraryView();
  }

  App.listUi = {
    buildFilterOptions,
    applyLibraryView,
    resetFilters,
    syncSelectedRows,
    premiumLines,
    setSort,
    syncSortHeaders
  };
})();

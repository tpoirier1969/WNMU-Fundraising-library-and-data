(() => {
  'use strict';

  const App = window.PledgeLib;
  if (!App) return;

  let initialized = false;
  let rowObserver = null;
  let detailObserver = null;
  let listApplyWrapped = false;

  function text(value) {
    return String(value ?? '').trim();
  }

  function libraryTable() {
    return document.getElementById('library-body')?.closest('table') || null;
  }

  function findProgram(programId) {
    const id = text(programId);
    if (!id) return null;
    return App.programLinks?.resolveRow?.(id)
      || (App.state?.rows || []).find((row) => String(App.derive?.programId?.(row) || '') === id)
      || (App.state?.rawRows || []).find((row) => String(App.derive?.programId?.(row) || '') === id)
      || null;
  }

  function isNonSpecificProgram(program = {}) {
    if (App.utils?.isNonSpecificRow?.(program)) return true;
    const title = text(App.derive?.title?.(program) || program?.title || program?.program_title || program?.imported_program_title || '');
    return /^\.?\s*non[-\s]?specific\b.*\bpledges?\s*$/i.test(title);
  }

  function targetFundraiserWindow() {
    const focus = App.programFundraiserFocus?.get?.() || null;
    if (!focus?.start) return null;
    return {
      id: text(focus.id || focus.schedule?.id || ''),
      title: text(focus.title || focus.schedule?.title || focus.schedule?.name || 'Target fundraiser'),
      start: focus.start,
      end: focus.end instanceof Date && !Number.isNaN(focus.end.getTime()) ? focus.end : focus.start
    };
  }

  function targetRightsPolicy(program = {}) {
    const target = targetFundraiserWindow();
    if (!target) return { target: null, unavailable: false, startsDuring: false, endsDuring: false, expiredBefore: false, note: '' };
    const rightsStart = App.utils.parseDateLike(App.derive.rightsBegin(program), { preferDateOnlyLocal: true });
    const rightsEnd = App.utils.parseDateLike(App.derive.rightsEnd(program), { preferDateOnlyLocal: true });
    const validStart = rightsStart instanceof Date && !Number.isNaN(rightsStart.getTime());
    const validEnd = rightsEnd instanceof Date && !Number.isNaN(rightsEnd.getTime());

    if (validEnd && rightsEnd < target.start) {
      return { target, unavailable: true, startsDuring: false, endsDuring: false, expiredBefore: true, note: `Rights end ${App.utils.formatDate(rightsEnd)} before ${target.title}.` };
    }
    if (validStart && rightsStart > target.end) {
      return { target, unavailable: true, startsDuring: false, endsDuring: false, expiredBefore: false, note: `Rights begin ${App.utils.formatDate(rightsStart)} after ${target.title}.` };
    }
    if (validStart && rightsStart > target.start && rightsStart <= target.end) {
      return { target, unavailable: false, startsDuring: true, endsDuring: false, expiredBefore: false, note: `Rights begin ${App.utils.formatDate(rightsStart)} during ${target.title}.` };
    }
    if (validEnd && rightsEnd >= target.start && rightsEnd < target.end) {
      return { target, unavailable: false, startsDuring: false, endsDuring: true, expiredBefore: false, note: '' };
    }
    return { target, unavailable: false, startsDuring: false, endsDuring: false, expiredBefore: false, note: '' };
  }

  function applyTargetPolicy(program, sourceResult = {}) {
    const policy = targetRightsPolicy(program);
    const result = {
      ...sourceResult,
      badges: [...(sourceResult.badges || [])].filter((badge) => !/^Rights ending soon/i.test(String(badge || ''))),
      cautions: [...(sourceResult.cautions || [])],
      targetRightsPolicy: policy
    };
    if (policy.unavailable) {
      result.outlook = 'Unavailable for target fundraiser';
      result.tone = 'bad';
      result.cautions.unshift(policy.note);
    } else if (policy.startsDuring) {
      result.outlook = 'Rights window needs attention';
      result.tone = 'warn';
      result.cautions.unshift(policy.note);
    }
    result.badges = [...new Set(result.badges)];
    result.cautions = [...new Set(result.cautions.filter(Boolean))];
    return result;
  }

  function ensureListHeader() {
    const table = libraryTable();
    const headerRow = table?.querySelector('thead tr');
    if (!headerRow) return;
    let th = headerRow.querySelector('.col-outlook');
    if (!th) {
      const avgHeader = headerRow.querySelector('.col-avg');
      if (!avgHeader) return;
      th = document.createElement('th');
      th.className = 'col-outlook';
      avgHeader.after(th);
    }
    if (!th.querySelector('[data-program-outlook-sort]')) {
      th.innerHTML = '<button type="button" class="sort-header-button" data-program-outlook-sort="true"><span>Programming outlook</span><span class="sort-arrow">↕</span></button>';
    }
    ensureRightsHeader();
  }

  function ensureRightsHeader() {
    const table = libraryTable();
    const rightsHeaders = [...(table?.querySelectorAll('thead th.col-rights') || [])];
    if (rightsHeaders.length < 2) return;
    const visible = rightsHeaders[rightsHeaders.length - 1];
    if (visible.querySelector('[data-rights-sort]')) return;
    visible.classList.add('rights-combined-header');
    visible.innerHTML = `
      <div class="rights-combined-title">Rights</div>
      <div class="rights-combined-sort">
        <button type="button" data-rights-sort="rights_begin">Begin <span>↕</span></button>
        <button type="button" data-rights-sort="rights_end">End <span>↕</span></button>
      </div>`;
  }

  function syncSortHeaders() {
    const outlook = document.querySelector('[data-program-outlook-sort]');
    if (outlook) {
      const active = App.state?.sortField === 'programming_outlook';
      outlook.classList.toggle('active', active);
      const arrow = outlook.querySelector('.sort-arrow');
      if (arrow) arrow.textContent = active ? (App.state?.sortDirection === 'desc' ? '↓' : '↑') : '↕';
    }
    document.querySelectorAll('[data-rights-sort]').forEach((button) => {
      const active = App.state?.sortField === button.dataset.rightsSort;
      button.classList.toggle('active', active);
      const arrow = button.querySelector('span');
      if (arrow) arrow.textContent = active ? (App.state?.sortDirection === 'desc' ? '↓' : '↑') : '↕';
    });
  }

  function syncPlaceholderColspan() {
    const table = libraryTable();
    const headerCount = table?.querySelectorAll('thead tr:first-child > th').length || 11;
    document.querySelectorAll('#library-body td[colspan]').forEach((cell) => {
      cell.setAttribute('colspan', String(headerCount));
    });
  }

  function listOutlookHtml(program = {}) {
    if (isNonSpecificProgram(program)) return '';
    const result = applyTargetPolicy(program, App.programScorecard.baseAssessment(program));
    const badges = (result.badges || []).slice(0, 3);
    const targetBit = result.targetRightsPolicy?.target?.title ? `Target: ${result.targetRightsPolicy.target.title}` : '';
    const tooltipBits = [
      `${result.outlook} (${result.confidence || 'Low'} confidence)`,
      targetBit,
      ...(result.badges || []),
      ...(result.cautions || [])
    ].filter(Boolean);
    return `
      <div class="scorecard-list scorecard-tone-${App.utils.escapeHtml(result.tone || 'neutral')}" title="${App.utils.escapeHtml(tooltipBits.join(' · '))}">
        <div class="scorecard-list-outlook">${App.utils.escapeHtml(result.outlook || 'Situational option')}</div>
        <div class="scorecard-list-badges">${badges.map((badge) => `<span>${App.utils.escapeHtml(badge)}</span>`).join('')}</div>
      </div>`;
  }

  function rightsCellHtml(program = {}) {
    const begin = App.utils.formatDate(App.derive.rightsBegin(program)) || '—';
    const end = App.utils.formatDate(App.derive.rightsEnd(program)) || '—';
    return `<div class="rights-date-line"><span>Begin</span><strong>${App.utils.escapeHtml(begin)}</strong></div><div class="rights-date-line"><span>End</span><strong>${App.utils.escapeHtml(end)}</strong></div>`;
  }

  function hideForSelectedFundraiser(program = {}) {
    const policy = targetRightsPolicy(program);
    return Boolean(policy.target && policy.expiredBefore);
  }

  function decorateListRows() {
    if (!App.programScorecard?.baseAssessment) return;
    ensureListHeader();
    const body = document.getElementById('library-body');
    if (!body) return;

    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const program = findProgram(tr.dataset.id);
      if (!program) return;
      const hiddenByRights = hideForSelectedFundraiser(program);
      tr.hidden = hiddenByRights;
      tr.classList.toggle('outlook-hidden-by-rights', hiddenByRights);
      if (hiddenByRights) return;

      let cell = tr.querySelector('td.outlook-cell');
      if (!cell) {
        cell = document.createElement('td');
        cell.className = 'outlook-cell';
        const avgCell = tr.querySelector('td.avg-cell');
        if (avgCell) avgCell.after(cell);
        else tr.append(cell);
      }
      const html = listOutlookHtml(program);
      if (cell.innerHTML !== html) cell.innerHTML = html;

      const rightsCell = tr.querySelector('td.rights-end-heat-cell');
      if (rightsCell) {
        const rightsHtml = rightsCellHtml(program);
        if (rightsCell.innerHTML !== rightsHtml) rightsCell.innerHTML = rightsHtml;
      }
    });
    syncPlaceholderColspan();
    syncSortHeaders();
  }

  function scoreValue(program = {}) {
    if (isNonSpecificProgram(program)) return -10000;
    const result = applyTargetPolicy(program, App.programScorecard.baseAssessment(program));
    if (result.targetRightsPolicy?.unavailable) return -5000;
    if (result.targetRightsPolicy?.startsDuring) return Number(result.score || 0) - 20;
    return Number(result.score || 0);
  }

  function applyOutlookOrder() {
    if (App.state?.sortField !== 'programming_outlook') return;
    const direction = App.state?.sortDirection === 'asc' ? 1 : -1;
    const sorted = [...(App.state?.rows || [])].sort((a, b) => {
      const delta = (scoreValue(a) - scoreValue(b)) * direction;
      if (delta) return delta;
      return String(App.derive.title(a) || '').localeCompare(String(App.derive.title(b) || ''));
    });
    App.state.rows = sorted;
    const body = document.getElementById('library-body');
    if (!body) return;
    const desiredIds = sorted.map((row) => String(App.derive.programId(row) || '')).filter(Boolean);
    const currentIds = [...body.querySelectorAll('tr[data-id]')].map((tr) => String(tr.dataset.id || ''));
    if (desiredIds.length === currentIds.length && desiredIds.every((id, index) => id === currentIds[index])) {
      decorateListRows();
      syncSortHeaders();
      return;
    }
    const byId = new Map([...body.querySelectorAll('tr[data-id]')].map((tr) => [String(tr.dataset.id || ''), tr]));
    desiredIds.forEach((id) => {
      const row = byId.get(id);
      if (row) body.append(row);
    });
    decorateListRows();
  }

  function wrapListApply() {
    if (listApplyWrapped || !App.listUi?.applyLibraryView) return;
    const original = App.listUi.applyLibraryView.bind(App.listUi);
    App.listUi.applyLibraryView = (...args) => {
      const result = original(...args);
      if (App.state?.sortField === 'programming_outlook') window.setTimeout(applyOutlookOrder, 0);
      else window.setTimeout(decorateListRows, 0);
      return result;
    };
    listApplyWrapped = true;
  }

  function ensureFundraiserFocusControl() {
    const filterRow = document.querySelector('[data-workspace-pane="library"] .controls .filter-row');
    if (!filterRow) return null;
    let wrap = document.getElementById('outlook-fundraiser-focus-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'outlook-fundraiser-focus-wrap';
      wrap.className = 'filter-field outlook-fundraiser-focus';
      wrap.innerHTML = '<label class="filter-label" for="outlook-fundraiser-focus">Outlook fundraiser</label><select id="outlook-fundraiser-focus"><option value="">N/A</option></select>';
      filterRow.append(wrap);
    }
    return wrap.querySelector('select');
  }

  function syncFundraiserFocusControl() {
    const select = ensureFundraiserFocusControl();
    if (!select) return;
    const entries = App.programFundraiserFocus?.entries?.() || [];
    select.disabled = false;
    const manualId = text(App.state?.programOutlookFundraiserId || '');
    const options = [`<option value="" ${!manualId ? 'selected' : ''}>N/A</option>`];
    entries.forEach((entry) => {
      const start = entry.start ? App.utils.formatDate(entry.start) : '';
      const label = start ? `${entry.title} · ${start}` : entry.title;
      options.push(`<option value="${App.utils.escapeHtml(entry.id)}" ${manualId === entry.id ? 'selected' : ''}>${App.utils.escapeHtml(label)}</option>`);
    });
    const html = options.join('');
    if (select.innerHTML !== html) select.innerHTML = html;
    select.value = manualId && entries.some((entry) => entry.id === manualId) ? manualId : '';
  }

  function ensureDetailHost() {
    const overview = document.getElementById('overview-grid');
    if (!overview) return null;
    let host = document.getElementById('program-scorecard');
    if (!host) {
      host = document.createElement('div');
      host.id = 'program-scorecard';
      overview.after(host);
    }
    return host;
  }

  function ensureDetailHeaderHost() {
    const header = document.querySelector('#detail-modal .detail-header');
    const actions = header?.querySelector('.toolbar-actions');
    if (!header || !actions) return null;
    let host = document.getElementById('program-scorecard-header');
    if (!host) {
      host = document.createElement('div');
      host.id = 'program-scorecard-header';
      host.className = 'program-scorecard-header hidden';
      actions.before(host);
    }
    return host;
  }

  function renderDetailHeaderScorecard(program, result) {
    const host = ensureDetailHeaderHost();
    if (!host) return;
    if (!program || !result || isNonSpecificProgram(program) || App.state?.detailCreateMode || !text(App.state?.selectedProgramId)) {
      host.innerHTML = '';
      host.classList.add('hidden');
      return;
    }

    const ratingControl = App.programEditorialOverrides?.headerControlHtml?.(program, result.editorialOverride || result.programmerEvidence) || '';
    host.classList.remove('hidden');
    host.innerHTML = `
      <div class="program-scorecard-header-main scorecard-tone-${App.utils.escapeHtml(result.tone || 'neutral')}">
        <div class="program-scorecard-header-label">Programming outlook</div>
        <div class="program-scorecard-header-title">${App.utils.escapeHtml(result.outlook || 'Situational option')}</div>
        <div class="program-scorecard-header-confidence">${App.utils.escapeHtml(result.confidence || 'Low')} confidence</div>
      </div>
      <div class="program-scorecard-header-rating">${ratingControl}</div>`;
  }

  function renderDetailScorecard() {
    const host = ensureDetailHost();
    const headerHost = ensureDetailHeaderHost();
    if (!host || !headerHost || !App.programScorecard?.detailHtml || !App.programScorecard?.detailedAssessment) return;
    const program = App.state?.currentDetailProgram;
    const createMode = Boolean(App.state?.detailCreateMode);
    if (!program || createMode || !text(App.state?.selectedProgramId) || isNonSpecificProgram(program)) {
      host.innerHTML = '';
      host.classList.add('hidden');
      renderDetailHeaderScorecard(null, null);
      return;
    }

    const driveResults = App.state?.currentDetailDriveResults || [];
    const airings = App.state?.currentDetailAirings || [];
    const result = applyTargetPolicy(program, App.programScorecard.detailedAssessment(program, driveResults, airings));
    renderDetailHeaderScorecard(program, result);

    host.classList.remove('hidden');
    const html = App.programScorecard.detailHtml(program, driveResults, airings);
    if (host.innerHTML !== html) host.innerHTML = html;
  }

  function observeList() {
    const body = document.getElementById('library-body');
    if (!body || rowObserver) return;
    rowObserver = new MutationObserver(() => {
      decorateListRows();
      if (App.state?.sortField === 'programming_outlook') window.setTimeout(applyOutlookOrder, 0);
    });
    rowObserver.observe(body, { childList: true, subtree: true });
    decorateListRows();
  }

  function observeDetail() {
    const overview = document.getElementById('overview-grid');
    const title = document.getElementById('detail-title');
    if (!overview || detailObserver) return;
    detailObserver = new MutationObserver(() => renderDetailScorecard());
    detailObserver.observe(overview, { childList: true, subtree: true, characterData: true });
    if (title) detailObserver.observe(title, { childList: true, subtree: true, characterData: true });
    renderDetailScorecard();
  }

  function bindSupplementalEvents() {
    document.addEventListener('click', (event) => {
      const outlookSort = event.target?.closest?.('[data-program-outlook-sort]');
      if (outlookSort) {
        event.preventDefault();
        if (App.state.sortField === 'programming_outlook') App.state.sortDirection = App.state.sortDirection === 'asc' ? 'desc' : 'asc';
        else {
          App.state.sortField = 'programming_outlook';
          App.state.sortDirection = 'desc';
        }
        App.listUi?.applyLibraryView?.();
        return;
      }
      const rightsSort = event.target?.closest?.('[data-rights-sort]');
      if (rightsSort) {
        event.preventDefault();
        App.listUi?.setSort?.(rightsSort.dataset.rightsSort);
        window.setTimeout(syncSortHeaders, 0);
      }
    }, true);

    document.addEventListener('change', (event) => {
      if (event.target?.id !== 'outlook-fundraiser-focus') return;
      App.programFundraiserFocus?.set?.(event.target.value || '');
      decorateListRows();
      renderDetailScorecard();
      if (App.state?.sortField === 'programming_outlook') applyOutlookOrder();
    }, true);

    document.addEventListener('pledge-editorial-overrides-changed', () => {
      window.setTimeout(() => {
        decorateListRows();
        renderDetailScorecard();
        if (App.state?.sortField === 'programming_outlook') applyOutlookOrder();
      }, 0);
    });
  }

  function initialize() {
    if (initialized) return;
    if (!App.programScorecard || !App.derive || !document.getElementById('library-body') || !document.getElementById('overview-grid')) {
      window.setTimeout(initialize, 40);
      return;
    }
    initialized = true;
    ensureListHeader();
    ensureDetailHeaderHost();
    ensureFundraiserFocusControl();
    wrapListApply();
    bindSupplementalEvents();
    observeList();
    observeDetail();
    syncFundraiserFocusControl();

    const scheduleSelect = document.getElementById('schedule-desktop-select');
    if (scheduleSelect) {
      new MutationObserver(() => {
        syncFundraiserFocusControl();
        decorateListRows();
        renderDetailScorecard();
      }).observe(scheduleSelect, { childList: true, subtree: true });
    }
    window.setTimeout(syncFundraiserFocusControl, 800);
    window.setTimeout(syncFundraiserFocusControl, 2500);

    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('[data-program-open-id], [data-open-id], [data-workspace-button], #refresh-button')) {
        window.setTimeout(() => {
          syncFundraiserFocusControl();
          decorateListRows();
          renderDetailScorecard();
          if (App.state?.sortField === 'programming_outlook') applyOutlookOrder();
        }, 80);
      }
    }, true);
  }

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();
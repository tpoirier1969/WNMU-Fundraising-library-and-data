(() => {
  'use strict';

  const App = window.PledgeLib;
  if (!App) return;

  let initialized = false;
  let rowObserver = null;
  let detailObserver = null;

  function text(value) {
    return String(value ?? '').trim();
  }

  function findProgram(programId) {
    const id = text(programId);
    if (!id) return null;
    return App.programLinks?.resolveRow?.(id)
      || (App.state?.rows || []).find((row) => String(App.derive?.programId?.(row) || '') === id)
      || (App.state?.rawRows || []).find((row) => String(App.derive?.programId?.(row) || '') === id)
      || null;
  }

  function ensureListHeader() {
    const headerRow = document.querySelector('.programs-table thead tr');
    if (!headerRow || headerRow.querySelector('.col-outlook')) return;
    const avgHeader = headerRow.querySelector('.col-avg');
    if (!avgHeader) return;
    const th = document.createElement('th');
    th.className = 'col-outlook';
    th.textContent = 'Programming outlook';
    avgHeader.after(th);
  }

  function syncPlaceholderColspan() {
    const headerCount = document.querySelectorAll('.programs-table thead tr:first-child > th').length || 11;
    document.querySelectorAll('#library-body td[colspan]').forEach((cell) => {
      cell.setAttribute('colspan', String(headerCount));
    });
  }

  function decorateListRows() {
    if (!App.programScorecard?.listCellHtml) return;
    ensureListHeader();
    const body = document.getElementById('library-body');
    if (!body) return;

    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const program = findProgram(tr.dataset.id);
      if (!program) return;
      let cell = tr.querySelector('td.outlook-cell');
      if (!cell) {
        cell = document.createElement('td');
        cell.className = 'outlook-cell';
        const avgCell = tr.querySelector('td.avg-cell');
        if (avgCell) avgCell.after(cell);
        else tr.append(cell);
      }
      const html = App.programScorecard.listCellHtml(program);
      if (cell.innerHTML !== html) cell.innerHTML = html;
    });
    syncPlaceholderColspan();
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

  function renderDetailScorecard() {
    const host = ensureDetailHost();
    if (!host || !App.programScorecard?.detailHtml) return;
    const program = App.state?.currentDetailProgram;
    const createMode = Boolean(App.state?.detailCreateMode);
    if (!program || createMode || !text(App.state?.selectedProgramId)) {
      host.innerHTML = '';
      host.classList.add('hidden');
      return;
    }
    host.classList.remove('hidden');
    const html = App.programScorecard.detailHtml(
      program,
      App.state?.currentDetailDriveResults || [],
      App.state?.currentDetailAirings || []
    );
    if (host.innerHTML !== html) host.innerHTML = html;
  }

  function observeList() {
    const body = document.getElementById('library-body');
    if (!body || rowObserver) return;
    rowObserver = new MutationObserver(() => decorateListRows());
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

  function initialize() {
    if (initialized) return;
    if (!App.programScorecard || !App.derive || !document.getElementById('library-body') || !document.getElementById('overview-grid')) {
      window.setTimeout(initialize, 40);
      return;
    }
    initialized = true;
    ensureListHeader();
    observeList();
    observeDetail();

    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('[data-program-open-id], [data-open-id], [data-workspace-button], #refresh-button')) {
        window.setTimeout(() => {
          decorateListRows();
          renderDetailScorecard();
        }, 80);
      }
    }, true);
  }

  document.addEventListener('DOMContentLoaded', initialize, { once: true });
})();

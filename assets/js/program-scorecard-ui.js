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

  function normalizedToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function scheduleEntries() {
    const combined = [
      ...(Array.isArray(App.state?.schedules) ? App.state.schedules : []),
      ...(Array.isArray(App.state?.scorecardSchedules) ? App.state.scorecardSchedules : [])
    ];
    const seen = new Set();
    const schedules = combined.filter((schedule) => {
      const key = String(schedule?.id || `${schedule?.title || ''}|${schedule?.startDate || schedule?.start_date || ''}`);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return schedules.map((schedule) => {
      const start = App.utils.parseDateLike(schedule?.startDate || schedule?.start_date || '', { preferDateOnlyLocal: true });
      const end = App.utils.parseDateLike(schedule?.endDate || schedule?.end_date || schedule?.startDate || schedule?.start_date || '', { preferDateOnlyLocal: true });
      return { schedule, start, end };
    }).filter((entry) => entry.start instanceof Date && !Number.isNaN(entry.start.getTime()));
  }

  function targetFundraiserWindow() {
    const entries = scheduleEntries();
    if (!entries.length) return null;
    const today = normalizedToday();
    const active = entries.find((entry) => String(entry.schedule?.id || '') === String(App.state?.activeScheduleId || '')) || null;
    const activeEnd = active?.end instanceof Date && !Number.isNaN(active.end.getTime()) ? active.end : active?.start;
    const activeIsCurrentOrFuture = Boolean(active && activeEnd >= today);
    const chosen = activeIsCurrentOrFuture
      ? active
      : entries.filter((entry) => (entry.end || entry.start) >= today).sort((a, b) => a.start - b.start)[0] || null;
    if (!chosen) return null;
    return {
      title: text(chosen.schedule?.title || chosen.schedule?.name || 'Target fundraiser'),
      start: chosen.start,
      end: chosen.end instanceof Date && !Number.isNaN(chosen.end.getTime()) ? chosen.end : chosen.start
    };
  }

  function targetRightsPolicy(program = {}) {
    const target = targetFundraiserWindow();
    if (!target) return { target: null, unavailable: false, partial: false, retiringSoonAfter: false, note: '' };
    const rightsStart = App.utils.parseDateLike(App.derive.rightsBegin(program), { preferDateOnlyLocal: true });
    const rightsEnd = App.utils.parseDateLike(App.derive.rightsEnd(program), { preferDateOnlyLocal: true });
    const validStart = rightsStart instanceof Date && !Number.isNaN(rightsStart.getTime());
    const validEnd = rightsEnd instanceof Date && !Number.isNaN(rightsEnd.getTime());

    if (validEnd && rightsEnd < target.start) {
      return { target, unavailable: true, partial: false, retiringSoonAfter: false, note: `Rights end ${App.utils.formatDate(rightsEnd)} before ${target.title}.` };
    }
    if (validStart && rightsStart > target.end) {
      return { target, unavailable: true, partial: false, retiringSoonAfter: false, note: `Rights begin ${App.utils.formatDate(rightsStart)} after ${target.title}.` };
    }
    if (validStart && rightsStart > target.start && rightsStart <= target.end) {
      return { target, unavailable: false, partial: true, retiringSoonAfter: false, note: `Rights begin ${App.utils.formatDate(rightsStart)} during ${target.title}.` };
    }
    if (validEnd && rightsEnd >= target.start && rightsEnd < target.end) {
      return { target, unavailable: false, partial: true, retiringSoonAfter: false, note: `Rights end ${App.utils.formatDate(rightsEnd)} during ${target.title}.` };
    }
    const daysAfter = validEnd ? Math.ceil((rightsEnd.getTime() - target.end.getTime()) / 86400000) : null;
    return {
      target,
      unavailable: false,
      partial: false,
      retiringSoonAfter: Number.isFinite(daysAfter) && daysAfter >= 0 && daysAfter <= 90,
      note: Number.isFinite(daysAfter) && daysAfter >= 0 && daysAfter <= 90
        ? `Rights end ${App.utils.formatDate(rightsEnd)}, within 90 days after ${target.title}.`
        : ''
    };
  }

  function applyTargetPolicy(program, sourceResult = {}) {
    const policy = targetRightsPolicy(program);
    const result = {
      ...sourceResult,
      badges: [...(sourceResult.badges || [])],
      cautions: [...(sourceResult.cautions || [])],
      targetRightsPolicy: policy
    };
    if (policy.unavailable) {
      result.outlook = 'Unavailable for target fundraiser';
      result.tone = 'bad';
      result.cautions.unshift(policy.note);
    } else if (policy.partial) {
      result.outlook = 'Rights window needs attention';
      result.tone = 'warn';
      result.cautions.unshift(policy.note);
    } else if (policy.retiringSoonAfter) {
      result.badges.unshift('Rights ending soon after drive');
    }
    result.badges = [...new Set(result.badges)];
    result.cautions = [...new Set(result.cautions)];
    return result;
  }

  async function refreshScorecardSchedules() {
    if (!App.data?.fetchSchedulesRemote) return;
    try {
      const schedules = await App.data.fetchSchedulesRemote();
      if (Array.isArray(schedules) && schedules.length) App.state.scorecardSchedules = schedules;
    } catch (_error) {
      // The scorecard can operate without schedule context. Never block the library.
    }
  }

  function ensureScorecardPatchStyles() {
    if (document.getElementById('program-scorecard-patch-styles')) return;
    const style = document.createElement('style');
    style.id = 'program-scorecard-patch-styles';
    style.textContent = `
      #program-scorecard-header.program-scorecard-header { flex: 0 1 220px !important; min-width: 160px !important; max-width: 220px !important; padding: 0 !important; }
      #program-scorecard-header .program-scorecard-header-main { width: 100%; min-width: 0 !important; padding: 3px 7px !important; }
      #program-scorecard-header .program-scorecard-header-title { font-size: .78rem !important; line-height: 1.12 !important; }
      #program-scorecard-header .program-scorecard-header-label, #program-scorecard-header .program-scorecard-header-confidence { font-size: .58rem !important; }
      .rights-window-header-inner { display: grid; gap: 4px; }
      .rights-window-sort-row { display: flex; gap: 4px; flex-wrap: wrap; }
      .rights-sort-button { padding: 2px 5px !important; min-height: 0 !important; border-radius: 6px !important; border: 1px solid rgba(255,255,255,.35) !important; background: rgba(255,255,255,.12) !important; color: #fff !important; font-size: .66rem !important; line-height: 1.15 !important; }
      .rights-sort-button.active { background: rgba(255,255,255,.28) !important; }
      .rights-window-cell { min-width: 125px; }
      .rights-window-line { display: grid; grid-template-columns: 34px 1fr; gap: 4px; align-items: baseline; }
      .rights-window-line + .rights-window-line { margin-top: 2px; }
      .rights-window-line span { font-size: .63rem; text-transform: uppercase; letter-spacing: .03em; opacity: .72; }
      .rights-window-line strong { font-size: .72rem; font-weight: 750; white-space: nowrap; }
      @container (max-width: 820px) { #program-scorecard-header.program-scorecard-header { display: none !important; } }
    `;
    document.head.append(style);
  }

  function ensureListHeader() {
    const table = libraryTable();
    const headerRow = table?.querySelector('thead tr');
    if (!headerRow || headerRow.querySelector('.col-outlook')) return;
    const avgHeader = headerRow.querySelector('.col-avg');
    if (!avgHeader) return;
    const th = document.createElement('th');
    th.className = 'col-outlook';
    th.textContent = 'Programming outlook';
    avgHeader.after(th);
  }

  function syncPlaceholderColspan() {
    const table = libraryTable();
    const headerCount = table?.querySelectorAll('thead tr:first-child > th').length || 11;
    document.querySelectorAll('#library-body td[colspan]').forEach((cell) => cell.setAttribute('colspan', String(headerCount)));
  }

  function rightsSortButtonHtml(field, label) {
    const active = App.state?.sortField === field;
    const arrow = active ? (App.state?.sortDirection === 'desc' ? '↓' : '↑') : '↕';
    return `<button type="button" class="rights-sort-button${active ? ' active' : ''}" data-rights-sort="${field}">${label} ${arrow}</button>`;
  }

  function decorateRightsWindow() {
    const table = libraryTable();
    if (!table) return;
    const endButton = table.querySelector('thead button[data-sort-field="rights_end"]');
    const endHeader = table.querySelector('thead th.rights-window-header')
      || endButton?.closest('th')
      || [...table.querySelectorAll('thead th.col-rights')].pop()
      || null;
    if (endHeader) {
      endHeader.classList.add('rights-window-header');
      endHeader.innerHTML = `<div class="rights-window-header-inner"><span>Rights</span><div class="rights-window-sort-row">${rightsSortButtonHtml('rights_begin', 'Begin')}${rightsSortButtonHtml('rights_end', 'End')}</div></div>`;
      endHeader.querySelectorAll('[data-rights-sort]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          App.listUi?.setSort?.(button.getAttribute('data-rights-sort'));
        });
      });
    }

    document.querySelectorAll('#library-body tr[data-id]').forEach((tr) => {
      const program = findProgram(tr.dataset.id);
      const cell = tr.querySelector('.rights-end-heat-cell');
      if (!program || !cell) return;
      const begin = App.utils.formatDate(App.derive.rightsBegin(program), '—');
      const end = App.utils.formatDate(App.derive.rightsEnd(program), '—');
      cell.classList.add('rights-window-cell');
      cell.innerHTML = `<div class="rights-window-line"><span>Begin</span><strong>${App.utils.escapeHtml(begin)}</strong></div><div class="rights-window-line"><span>End</span><strong>${App.utils.escapeHtml(end)}</strong></div>`;
      cell.title = `Rights begin ${begin} · Rights end ${end}`;
    });
  }

  function listOutlookHtml(program = {}) {
    const result = applyTargetPolicy(program, App.programScorecard.baseAssessment(program));
    const badges = (result.badges || []).filter((badge) => !/^Rights /i.test(badge)).slice(0, 3);
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

  function decorateListRows() {
    if (!App.programScorecard?.baseAssessment) return;
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
      const html = listOutlookHtml(program);
      if (cell.innerHTML !== html) cell.innerHTML = html;
    });
    decorateRightsWindow();
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
    if (!program || !result || App.state?.detailCreateMode || !text(App.state?.selectedProgramId)) {
      host.innerHTML = '';
      host.classList.add('hidden');
      return;
    }
    host.classList.remove('hidden');
    host.innerHTML = `
      <div class="program-scorecard-header-main scorecard-tone-${App.utils.escapeHtml(result.tone || 'neutral')}">
        <div class="program-scorecard-header-label">Programming outlook</div>
        <div class="program-scorecard-header-title">${App.utils.escapeHtml(result.outlook || 'Situational option')}</div>
        <div class="program-scorecard-header-confidence">${App.utils.escapeHtml(result.confidence || 'Low')} confidence</div>
      </div>`;
  }

  function renderDetailScorecard() {
    const host = ensureDetailHost();
    const headerHost = ensureDetailHeaderHost();
    if (!host || !headerHost || !App.programScorecard?.detailHtml || !App.programScorecard?.detailedAssessment) return;
    const program = App.state?.currentDetailProgram;
    const createMode = Boolean(App.state?.detailCreateMode);
    if (!program || createMode || !text(App.state?.selectedProgramId)) {
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

  async function initialize() {
    if (initialized) return;
    if (!App.programScorecard || !App.derive || !document.getElementById('library-body') || !document.getElementById('overview-grid')) {
      window.setTimeout(initialize, 40);
      return;
    }
    initialized = true;
    ensureScorecardPatchStyles();
    ensureListHeader();
    ensureDetailHeaderHost();
    observeList();
    observeDetail();

    refreshScorecardSchedules().then(() => {
      decorateListRows();
      renderDetailScorecard();
    });

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

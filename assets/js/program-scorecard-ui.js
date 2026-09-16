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

  function isNonSpecificProgram(program = {}) {
    const title = text(App.derive?.title?.(program) || program?.title || program?.program_title || program?.imported_program_title || '');
    return /^\.?\s*non[-\s]?specific\s+pledges?\s*$/i.test(title);
  }

  function targetFundraiserWindow() {
    const schedules = Array.isArray(App.state?.schedules) ? App.state.schedules : [];
    if (!schedules.length) return null;
    const active = schedules.find((schedule) => String(schedule?.id || '') === String(App.state?.activeScheduleId || '')) || null;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const candidates = schedules.map((schedule) => {
      const start = App.utils.parseDateLike(schedule?.startDate || schedule?.start_date || '', { preferDateOnlyLocal: true });
      const end = App.utils.parseDateLike(schedule?.endDate || schedule?.end_date || schedule?.startDate || schedule?.start_date || '', { preferDateOnlyLocal: true });
      return { schedule, start, end };
    }).filter((entry) => entry.start instanceof Date && !Number.isNaN(entry.start.getTime()));
    let chosen = null;
    if (active) {
      chosen = candidates.find((entry) => entry.schedule === active) || null;
    }
    if (!chosen) {
      chosen = candidates.filter((entry) => (entry.end || entry.start) >= now).sort((a, b) => a.start - b.start)[0] || null;
    }
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
        <div class="scorecard-list-outlook">${App.utils.escapeHtml(result.outlook || 'Worth consideration')}</div>
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

  function restLabel(result = {}) {
    const days = Number(result?.history?.restDays);
    if (!Number.isFinite(days)) return 'Fresh / unaired';
    if (days < 31) return `${Math.max(0, Math.round(days))}d rest`;
    const months = Math.round(days / 30.4375);
    if (months < 24) return `${months} mo rest`;
    return `${Math.round((days / 365.25) * 10) / 10} yr rest`;
  }

  function renderDetailHeaderScorecard(program, result) {
    const host = ensureDetailHeaderHost();
    if (!host) return;
    if (!program || !result || isNonSpecificProgram(program) || App.state?.detailCreateMode || !text(App.state?.selectedProgramId)) {
      host.innerHTML = '';
      host.classList.add('hidden');
      return;
    }

    const quick = [
      restLabel(result),
      result.totalPledges > 0 ? `${App.utils.formatCount(result.totalPledges)} pledges` : '',
      result.trend?.label && result.trend.label !== 'Not enough history' ? `Trend: ${result.trend.label}` : '',
      result.season?.matchesTarget ? 'Seasonal fit' : '',
      result.local ? 'Local / U.P.' : '',
      result.drama?.currentCycle ? 'Current Drama Doc' : '',
      result.targetRightsPolicy?.retiringSoonAfter ? 'Rights ending soon after drive' : result.rights?.retiring ? 'Rights ending soon' : ''
    ].filter(Boolean).slice(0, 5);

    const cautions = (result.cautions || []).slice(0, 2);
    host.classList.remove('hidden');
    host.innerHTML = `
      <div class="program-scorecard-header-main scorecard-tone-${App.utils.escapeHtml(result.tone || 'neutral')}">
        <div class="program-scorecard-header-label">Programming outlook</div>
        <div class="program-scorecard-header-title">${App.utils.escapeHtml(result.outlook || 'Worth consideration')}</div>
        <div class="program-scorecard-header-confidence">${App.utils.escapeHtml(result.confidence || 'Low')} confidence</div>
      </div>
      <div class="program-scorecard-header-facts">
        ${quick.map((item) => `<span>${App.utils.escapeHtml(item)}</span>`).join('')}
        ${cautions.map((item) => `<span class="warn">${App.utils.escapeHtml(item)}</span>`).join('')}
      </div>`;
  }

  function targetRightsNoticeHtml(result = {}) {
    const policy = result.targetRightsPolicy;
    if (!policy?.target || (!policy.unavailable && !policy.partial && !policy.retiringSoonAfter)) return '';
    const typeClass = policy.unavailable ? 'bad' : policy.partial ? 'warn' : 'info';
    const lead = policy.unavailable ? 'Target fundraiser rights conflict' : policy.partial ? 'Target fundraiser rights window' : 'Rights urgency';
    return `<div class="scorecard-target-rights scorecard-target-rights-${typeClass}"><strong>${App.utils.escapeHtml(lead)}:</strong> ${App.utils.escapeHtml(policy.note)}</div>`;
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
    const html = `${targetRightsNoticeHtml(result)}${App.programScorecard.detailHtml(program, driveResults, airings)}`;
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
    ensureDetailHeaderHost();
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

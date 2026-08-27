(() => {
  'use strict';

  const A = window.WNMUOneSheetAnalysis;
  const cfg = window.PLEDGE_MANAGER_CONFIG || {};
  const WEATHER_LOCATIONS = [
    { name: 'Ironwood', latitude: 46.4547, longitude: -90.1710 },
    { name: 'Houghton', latitude: 47.1211, longitude: -88.5690 },
    { name: 'Marquette', latitude: 46.5436, longitude: -87.3954 },
    { name: 'Escanaba', latitude: 45.7452, longitude: -87.0646 },
    { name: 'Sault Ste. Marie', latitude: 46.4953, longitude: -84.3453 }
  ];
  const CHART_STYLES = [
    { stroke: '#145f91', dash: '' },
    { stroke: '#7a3e65', dash: '10 5' },
    { stroke: '#2d6a4f', dash: '3 4' },
    { stroke: '#9a5b13', dash: '12 4 3 4' },
    { stroke: '#4f5d75', dash: '7 4' }
  ];

  const state = {
    client: null,
    schedules: [],
    airings: [],
    library: [],
    indexes: null,
    analysesById: new Map(),
    weatherByDate: new Map(),
    weatherLoadedSchedules: new Set(),
    selectedIds: new Set(),
    season: '',
    activeFundraiserId: '',
    loadingWeather: false,
    durationApprovals: new Set()
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value, digits = 0) {
    return Number(value || 0).toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function compactMoney(value) {
    const numeric = Number(value || 0);
    if (Math.abs(numeric) >= 1000000) return `$${(numeric / 1000000).toFixed(numeric % 1000000 ? 1 : 0)}m`;
    if (Math.abs(numeric) >= 1000) return `$${(numeric / 1000).toFixed(numeric % 1000 ? 1 : 0)}k`;
    return money(numeric);
  }

  function count(value, digits = 0) {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function hours(minutes) {
    return `${(Number(minutes || 0) / 60).toFixed(1)}h`;
  }

  function percent(value, digits = 0) {
    return `${(Number(value || 0) * 100).toFixed(digits)}%`;
  }

  function formatDate(value, withYear = true) {
    const date = value instanceof Date ? value : A.parseDate(value);
    if (!date) return '—';
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {})
    });
  }

  function formatTime(minutes) {
    if (!Number.isFinite(Number(minutes))) return '—';
    const numeric = Number(minutes);
    const dayOffset = Math.floor(numeric / 1440);
    const normalized = ((numeric % 1440) + 1440) % 1440;
    const hour24 = Math.floor(normalized / 60);
    const minute = Math.round(normalized % 60);
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const label = `${hour24 % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
    return dayOffset > 0 ? `${label} +${dayOffset}` : label;
  }

  function chartLabel(value, maxLength = 17) {
    const text = String(value || '');
    return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
  }

  function niceStep(target) {
    const safe = Math.max(1, Number(target || 1));
    const power = 10 ** Math.floor(Math.log10(safe));
    const ratio = safe / power;
    const multiplier = ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10;
    return multiplier * power;
  }

  function chartScale(series = [], tickCount = 4) {
    const values = series.flatMap((item) => (item.values || []).filter((value) => Number.isFinite(Number(value))).map(Number));
    const maxValue = Math.max(0, ...values);
    const step = niceStep((maxValue || 1) / tickCount);
    const max = Math.max(step, Math.ceil((maxValue || 1) / step) * step);
    return { max, step };
  }

  function chartLegend(series = []) {
    return `<div class="chart-legend">${series.map((item, index) => {
      const style = CHART_STYLES[index % CHART_STYLES.length];
      return `<span><svg viewBox="0 0 36 12" aria-hidden="true"><line x1="2" y1="6" x2="34" y2="6" stroke="${style.stroke}" stroke-width="3"${style.dash ? ` stroke-dasharray="${style.dash}"` : ''}/><circle cx="18" cy="6" r="3" fill="#fff" stroke="${style.stroke}" stroke-width="2"/></svg><strong>${escapeHtml(item.label)}</strong></span>`;
    }).join('')}</div>`;
  }

  function lineChartSvg({ labels = [], series = [], ariaLabel = 'Fundraiser comparison line graph', className = '', legendTop = false } = {}) {
    if (!labels.length || !series.length) return '<div class="chart-empty">No chartable results.</div>';
    const width = 760;
    const height = 285;
    const margin = { left: 70, right: 20, top: 22, bottom: labels.length > 8 ? 86 : 62 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const { max, step } = chartScale(series);
    const x = (index) => labels.length === 1 ? margin.left + (plotWidth / 2) : margin.left + ((plotWidth * index) / (labels.length - 1));
    const y = (value) => margin.top + plotHeight - ((Math.max(0, Number(value || 0)) / max) * plotHeight);
    const tickCount = Math.max(1, Math.round(max / step));
    const yTicks = Array.from({ length: tickCount + 1 }, (_item, index) => index * step);
    const rotate = labels.length > 8 || labels.some((label) => String(label).length > 12);
    const xLabels = labels.map((label, index) => {
      const xpos = x(index);
      const ypos = margin.top + plotHeight + 21;
      const labelText = escapeHtml(chartLabel(label, rotate ? 15 : 19));
      return rotate
        ? `<text x="${xpos.toFixed(1)}" y="${ypos}" text-anchor="end" transform="rotate(-38 ${xpos.toFixed(1)} ${ypos})">${labelText}</text>`
        : `<text x="${xpos.toFixed(1)}" y="${ypos}" text-anchor="middle">${labelText}</text>`;
    }).join('');
    const grid = yTicks.map((value) => {
      const ypos = y(value);
      return `<g><line x1="${margin.left}" y1="${ypos.toFixed(1)}" x2="${width - margin.right}" y2="${ypos.toFixed(1)}" class="chart-grid-line"/><text x="${margin.left - 9}" y="${(ypos + 4).toFixed(1)}" text-anchor="end">${escapeHtml(compactMoney(value))}</text></g>`;
    }).join('');
    const plotted = series.map((item, seriesIndex) => {
      const style = CHART_STYLES[seriesIndex % CHART_STYLES.length];
      const values = item.values || [];
      const segments = [];
      let segment = [];
      values.forEach((value, index) => {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) {
          if (segment.length) segments.push(segment);
          segment = [];
          return;
        }
        segment.push([x(index), y(value)]);
      });
      if (segment.length) segments.push(segment);
      const paths = segments.map((points) => `<polyline points="${points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}" fill="none" stroke="${style.stroke}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"${style.dash ? ` stroke-dasharray="${style.dash}"` : ''}/>`).join('');
      const points = values.map((value, index) => {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return '';
        return `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="4" fill="#fff" stroke="${style.stroke}" stroke-width="2"><title>${escapeHtml(item.label)} · ${escapeHtml(labels[index])}: ${escapeHtml(money(value))}</title></circle>`;
      }).join('');
      return `${paths}${points}`;
    }).join('');
    const legend = chartLegend(series);
    const svg = `<svg class="report-line-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(ariaLabel)}"><line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" class="chart-axis"/><line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" class="chart-axis"/>${grid}${plotted}${xLabels}<text x="18" y="${margin.top + (plotHeight / 2)}" transform="rotate(-90 18 ${margin.top + (plotHeight / 2)})" text-anchor="middle" class="chart-axis-title">Broadcast dollars</text></svg>`;
    return `<div class="report-chart ${escapeHtml(className)}">${legendTop ? legend : ''}${svg}${legendTop ? '' : legend}</div>`;
  }

  function incomeBarChartSvg(days = []) {
    if (!days.length) return '<div class="chart-empty">No daily results.</div>';
    const width = 760;
    const height = 270;
    const margin = { left: 70, right: 18, top: 26, bottom: 58 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const maxValue = Math.max(1, ...days.map((day) => Number(day.dollars || 0)));
    const step = niceStep(maxValue / 4);
    const max = Math.max(step, Math.ceil(maxValue / step) * step);
    const y = (value) => margin.top + plotHeight - ((Math.max(0, Number(value || 0)) / max) * plotHeight);
    const tickCount = Math.max(1, Math.round(max / step));
    const yTicks = Array.from({ length: tickCount + 1 }, (_item, index) => index * step);
    const grid = yTicks.map((value) => {
      const ypos = y(value);
      return `<g><line x1="${margin.left}" y1="${ypos.toFixed(1)}" x2="${width - margin.right}" y2="${ypos.toFixed(1)}" class="chart-grid-line"/><text x="${margin.left - 9}" y="${(ypos + 4).toFixed(1)}" text-anchor="end">${escapeHtml(compactMoney(value))}</text></g>`;
    }).join('');
    const slot = plotWidth / days.length;
    const barWidth = Math.max(12, Math.min(46, slot * 0.68));
    const bars = days.map((day, index) => {
      const dollars = Number(day.dollars || 0);
      const xpos = margin.left + (slot * index) + ((slot - barWidth) / 2);
      const ypos = y(dollars);
      const barHeight = Math.max(dollars > 0 ? 2 : 0, margin.top + plotHeight - ypos);
      const center = xpos + (barWidth / 2);
      return `<g><rect x="${xpos.toFixed(1)}" y="${ypos.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2" fill="#3d789d"><title>${escapeHtml(formatDate(day.date))}: ${escapeHtml(money(dollars))}</title></rect><text x="${center.toFixed(1)}" y="${Math.max(14, ypos - 7).toFixed(1)}" text-anchor="middle" class="chart-value-label">${escapeHtml(compactMoney(dollars))}</text><text x="${center.toFixed(1)}" y="${margin.top + plotHeight + 20}" text-anchor="middle">${escapeHtml(formatDate(day.date, false))}</text><text x="${center.toFixed(1)}" y="${margin.top + plotHeight + 36}" text-anchor="middle" class="chart-secondary-label">${escapeHtml(String(day.weekday || '').slice(0, 3))}</text></g>`;
    }).join('');
    return `<div class="report-chart income-chart"><svg class="income-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily Broadcast income across the fundraiser"><line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" class="chart-axis"/><line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" class="chart-axis"/>${grid}${bars}<text x="18" y="${margin.top + (plotHeight / 2)}" transform="rotate(-90 18 ${margin.top + (plotHeight / 2)})" text-anchor="middle" class="chart-axis-title">Broadcast dollars</text></svg></div>`;
  }

  function reportMode() {
    return new URLSearchParams(window.location.search).get('report') || 'hub';
  }

  function setStatus(message = '', type = '') {
    const node = $('#report-status');
    if (!node) return;
    node.textContent = message;
    node.className = `report-status${type ? ` ${type}` : ''}`;
  }

  function showAccessDenied(message) {
    document.body.classList.add('report-access-denied');
    const gate = $('#report-access-gate');
    const app = $('#report-app');
    if (app) app.classList.add('hidden');
    if (!gate) return;
    gate.classList.remove('hidden');
    gate.innerHTML = `
      <div class="report-gate-card">
        <img src="assets/WNMU-TV-logo-head2019.png" alt="WNMU-TV PBS logo">
        <div class="report-kicker">Admin report center</div>
        <h1>Admin access required</h1>
        <p>${escapeHtml(message || 'Sign in as an administrator from the Pledge Program Library, then return to this page.')}</p>
        <a class="report-button primary" href="./">Open Pledge Program Library</a>
      </div>`;
  }

  function makeClient() {
    if (!window.supabase?.createClient) throw new Error('Supabase library did not load.');
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) throw new Error('Supabase configuration is missing.');
    return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  async function requireAdmin() {
    state.client = makeClient();
    const { data, error } = await state.client.auth.getSession();
    if (error) throw error;
    const session = data?.session || null;
    const email = String(session?.user?.email || '').trim().toLowerCase();
    const adminEmails = Array.isArray(cfg.ADMIN_EMAILS)
      ? cfg.ADMIN_EMAILS.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
      : [];
    const isAdmin = Boolean(session && (!adminEmails.length || (email && adminEmails.includes(email))));
    if (!isAdmin) {
      showAccessDenied(session
        ? `${email || 'This account'} is signed in, but does not have administrator report access.`
        : 'Sign in as an administrator from the Pledge Program Library, then return to this page.');
      return false;
    }
    const role = $('#report-role');
    if (role) role.textContent = email ? `Admin · ${email}` : 'Admin';
    return true;
  }

  async function fetchAll(table, select = '*', orderField = '') {
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let query = state.client.from(table).select(select).range(from, from + pageSize - 1);
      if (orderField) query = query.order(orderField, { ascending: true });
      const { data, error } = await query;
      if (error) throw error;
      const chunk = Array.isArray(data) ? data : [];
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
    }
    return rows;
  }

  async function loadData() {
    setStatus('Loading fundraiser history…');
    const [scheduleRows, airings, library] = await Promise.all([
      fetchAll('pledge_fundraiser_schedules', 'id,title,start_date,end_date,created_at,updated_at,schedule_data', 'start_date'),
      fetchAll('pledge_program_airings_v2', '*', 'air_date'),
      fetchAll('pledge_programs_v2', '*')
    ]);
    state.schedules = A.prepareSchedules(scheduleRows.map(A.normalizeSchedule)).filter((schedule) => schedule.season && schedule.year);
    state.airings = airings;
    state.library = library;
    state.indexes = A.buildLibraryIndexes(library);
    state.analysesById.clear();
    setStatus(`${count(state.schedules.length)} fundraiser periods available.`);
  }

  function analysisFor(schedule) {
    if (!schedule) return null;
    if (!state.analysesById.has(schedule.id)) {
      state.analysesById.set(schedule.id, A.analyzeSchedule(schedule, state.airings, state.indexes));
    }
    return state.analysesById.get(schedule.id);
  }

  function durationSignature(analyses = []) {
    return analyses.map((analysis) => analysis.schedule?.id).filter(Boolean).sort().join('|');
  }

  function removeDurationModal() {
    $('#duration-warning-modal')?.remove();
  }

  function isNonSpecificLabel(value) {
    const key = A.lookupKey(value);
    const compact = key.replace(/\s+/g, '');
    return compact === 'nspl'
      || key === 'non specific'
      || key === 'non specific pledge'
      || key === 'non specific pledges'
      || key === 'non specific web pledge'
      || key === 'non specific web pledges';
  }

  function rowIsNonSpecific(row = {}) {
    return [row.title, row.plannedTitle, row.topic].some((value) => isNonSpecificLabel(value));
  }

  function meaningfulMissingDurationRows(analysis = {}) {
    return (analysis.missingDurationRows || []).filter((row) => !rowIsNonSpecific(row));
  }

  function missingDurationSummary(analyses = []) {
    const missing = A.missingDurationPrograms(analyses).filter((item) => !isNonSpecificLabel(item.title));
    const dollars = missing.reduce((sum, item) => sum + Number(item.dollars || 0), 0);
    const airings = missing.reduce((sum, item) => sum + Number(item.airings || 0), 0);
    return { missing, dollars, airings };
  }

  function durationCoverageText(analyses = []) {
    const summary = missingDurationSummary(analyses);
    if (!summary.missing.length) return '';
    return `${summary.airings} program airing${summary.airings === 1 ? '' : 's'} lack a usable saved length and Program Library runtime. Their dollars remain in totals but are excluded from $/hour calculations and rankings.`;
  }

  function unmatchedBroadcastSummary(analysis = {}) {
    const rows = analysis.unmatchedImportedRows || [];
    return {
      rows: rows.length,
      dollars: rows.reduce((sum, row) => sum + Number(row.dollars || 0), 0),
      pledges: rows.reduce((sum, row) => sum + Number(row.pledges || 0), 0)
    };
  }

  function attributionCoverageText(analyses = []) {
    const details = analyses.map((analysis) => {
      const summary = unmatchedBroadcastSummary(analysis);
      if (!summary.rows) return '';
      return `${analysis.schedule?.title || 'Fundraiser'}: ${money(summary.dollars)} across ${count(summary.rows)} imported row${summary.rows === 1 ? '' : 's'}`;
    }).filter(Boolean);
    if (!details.length) return '';
    return `Some imported Broadcast results could not be assigned confidently to a scheduled topic. They remain in Broadcast and program-result totals but are excluded from topic income shares and topic $/hour. ${details.join('; ')}.`;
  }

  async function ensureDurationDecision(analyses = []) {
    const summary = missingDurationSummary(analyses);
    if (!summary.missing.length) return true;
    const signature = durationSignature(analyses);
    if (state.durationApprovals.has(signature)) return true;

    return new Promise((resolve) => {
      removeDurationModal();
      const modal = document.createElement('div');
      modal.id = 'duration-warning-modal';
      modal.className = 'report-modal-backdrop';
      const visible = summary.missing.slice(0, 12);
      const extra = summary.missing.length - visible.length;
      modal.innerHTML = `
        <div class="report-modal" role="dialog" aria-modal="true" aria-labelledby="duration-warning-title">
          <div class="report-kicker">Data quality warning</div>
          <h2 id="duration-warning-title">Program length information is missing</h2>
          <p>These programs do not have a usable saved schedule length or a Program Library runtime. $/hour would be misleading if the report guessed a duration.</p>
          <div class="duration-warning-list">
            ${visible.map((item) => `<div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(count(item.airings))} airing${item.airings === 1 ? '' : 's'} · ${escapeHtml(money(item.dollars))} Broadcast $</span></div>`).join('')}
            ${extra > 0 ? `<div><strong>+ ${extra} more title${extra === 1 ? '' : 's'}</strong></div>` : ''}
          </div>
          <p class="report-modal-note">Continue will keep the actual Broadcast dollars and pledges in factual totals, but exclude these airings from duration-based rates and rankings.</p>
          <div class="report-modal-actions">
            <button type="button" class="report-button primary" data-action="continue">Continue with incomplete data</button>
            <button type="button" class="report-button" data-action="library">Return to Pledge Program Library</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('[data-action="continue"]')?.addEventListener('click', () => {
        state.durationApprovals.add(signature);
        removeDurationModal();
        resolve(true);
      });
      modal.querySelector('[data-action="library"]')?.addEventListener('click', () => {
        window.location.href = './';
        resolve(false);
      });
    });
  }

  function renderHub() {
    document.title = 'WNMU One-Sheet Reports';
    $('#report-page-title').textContent = 'One-Sheet Reports';
    $('#report-page-subtitle').textContent = 'Printable retrospective fundraiser analysis';
    $('#report-controls').innerHTML = '';
    $('#report-output').innerHTML = `
      <section class="report-hub">
        <a class="report-card-link" href="reports.html?report=comparison">
          <div class="report-card-number">01</div>
          <div><h2>Fundraiser Comparison</h2><p>Compare 2–5 fundraisers by $/pledge hour, Broadcast totals, corresponding fundraiser days, regional weather, and topic airtime + performance.</p></div><span>Open report →</span>
        </a>
        <a class="report-card-link" href="reports.html?report=fundraiser">
          <div class="report-card-number">02</div>
          <div><h2>Fundraiser Performance Summary</h2><p>Review one fundraiser’s daily income curve, program results, pledge-hour productivity, regional weather, and topic performance.</p></div><span>Open report →</span>
        </a>
        <a class="report-card-link" href="reports.html?report=historical">
          <div class="report-card-number">03</div>
          <div><h2>Historical Fundraiser Analytics</h2><p>Rank historical performance by season, topic, subtopic, start time by day type, weekday/weekend, daypart, break type, and distributor using median $/hour.</p></div><span>Open report →</span>
        </a>
      </section>`;
  }

  function seasonsAvailable() {
    return A.SEASONS.filter((season) => state.schedules.some((schedule) => schedule.season === season));
  }

  function defaultSeason() {
    const latest = state.schedules[0];
    return latest?.season || seasonsAvailable()[0] || 'all';
  }

  function scheduleOptionLabel(schedule) {
    const analysis = analysisFor(schedule);
    return `${schedule.title} · ${formatDate(schedule.startDate)}–${formatDate(schedule.endDate, false)} · ${hours(analysis?.scheduledMinutes || 0)} · ${money(analysis?.broadcastDollars || 0)}`;
  }

  function schedulePickerDetails(schedule) {
    const analysis = analysisFor(schedule);
    return `${formatDate(schedule.startDate)}–${formatDate(schedule.endDate, false)} · ${hours(analysis?.scheduledMinutes || 0)} · ${money(analysis?.broadcastDollars || 0)} Broadcast`;
  }

  function comparisonSchedules() {
    return state.schedules.filter((schedule) => state.season === 'all' || schedule.season === state.season);
  }

  function ensureDefaultComparisonSelection() {
    const allowed = comparisonSchedules();
    const allowedIds = new Set(allowed.map((schedule) => schedule.id));
    [...state.selectedIds].forEach((id) => {
      if (!allowedIds.has(id)) state.selectedIds.delete(id);
    });
    if (state.selectedIds.size >= 2) return;
    state.selectedIds.clear();
    allowed.slice(0, Math.min(3, allowed.length)).forEach((schedule) => state.selectedIds.add(schedule.id));
  }

  function selectedComparisonAnalyses() {
    return state.schedules
      .filter((schedule) => state.selectedIds.has(schedule.id))
      .sort((a, b) => A.text(a.startDate).localeCompare(A.text(b.startDate)))
      .map(analysisFor)
      .filter(Boolean);
  }

  function renderComparisonControls() {
    const available = comparisonSchedules();
    const seasonOptions = [
      '<option value="all">All seasons</option>',
      ...seasonsAvailable().map((season) => `<option value="${escapeHtml(season)}" ${state.season === season ? 'selected' : ''}>${escapeHtml(season)}</option>`)
    ].join('');
    const checks = available.map((schedule) => `
      <label class="report-check">
        <input type="checkbox" value="${escapeHtml(schedule.id)}" ${state.selectedIds.has(schedule.id) ? 'checked' : ''}>
        <span><strong>${escapeHtml(schedule.title)}</strong><small>${escapeHtml(schedulePickerDetails(schedule))}</small></span>
      </label>`).join('');
    $('#report-controls').innerHTML = `
      <div class="report-control-row">
        <label class="report-field"><span>Pledge season</span><select id="report-season">${seasonOptions}</select></label>
        <div class="report-selection"><span>Select 2–5 fundraisers</span><div id="report-fundraiser-checks" class="report-checks">${checks || '<em>No fundraisers in this season.</em>'}</div></div>
        <button type="button" class="report-button" id="report-print">Print report</button>
      </div>`;
    $('#report-season')?.addEventListener('change', (event) => {
      state.season = event.target.value || 'all';
      state.selectedIds.clear();
      ensureDefaultComparisonSelection();
      renderComparisonControls();
      void renderComparisonReport();
    });
    $$('#report-fundraiser-checks input').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked && state.selectedIds.size >= 5) {
          input.checked = false;
          setStatus('A comparison report can include up to five fundraisers.', 'warn');
          return;
        }
        if (input.checked) state.selectedIds.add(input.value);
        else state.selectedIds.delete(input.value);
        void renderComparisonReport();
      });
    });
    $('#report-print')?.addEventListener('click', () => window.print());
  }

  function comparisonHeader(analyses) {
    const policy = A.comparisonChannelPolicy(analyses);
    const season = analyses.every((analysis) => analysis.schedule.season === analyses[0]?.schedule.season) ? analyses[0]?.schedule.season : 'Multi-season';
    const years = analyses.map((analysis) => analysis.schedule.year).filter(Boolean);
    const yearRange = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '';
    const channels = ['Broadcast', policy.includeOnline ? 'Online' : '', policy.includeMail ? 'Mail' : ''].filter(Boolean).join(' + ');
    return `<header class="sheet-title"><div><div class="report-kicker">WNMU-TV PBS pledge analysis</div><h1>${escapeHtml(season || 'Fundraiser')} Fundraiser Comparison</h1><p>${escapeHtml(yearRange)} · ${analyses.length} fundraisers · Comparable total basis: ${escapeHtml(channels)}</p></div><div class="sheet-stamp">Generated ${escapeHtml(new Date().toLocaleDateString())}</div></header>`;
  }

  function fundraiserColumnHeading(analysis) {
    return `<strong>${escapeHtml(analysis.schedule.title)}</strong><small>${escapeHtml(String(analysis.schedule.year || ''))}</small>`;
  }

  function rateForAnalysis(analysis) {
    return A.dollarsPerHour(analysis.rateEligibleDollars, analysis.rateEligibleMinutes);
  }

  function pledgeRateForAnalysis(analysis) {
    return A.pledgesPerHour(analysis.rateEligiblePledges, analysis.rateEligibleMinutes);
  }

  function knownHoursLabel(analysis) {
    return `<strong>${escapeHtml(hours(analysis.scheduledMinutes))}</strong>`;
  }

  function rateBaseSuffix(rateMinutes, totalMinutes) {
    const rate = Number(rateMinutes || 0);
    const total = Number(totalMinutes || 0);
    return Math.abs(rate - total) >= 0.5 ? ` · ${hours(rate)} rate base` : '';
  }

  function metricMatrix(analyses) {
    const policy = A.comparisonChannelPolicy(analyses);
    const timing = A.firstSaturdaySeasonalOffsets(analyses);
    const head = analyses.map((analysis) => `<th>${fundraiserColumnHeading(analysis)}</th>`).join('');
    const row = (label, values, className = '') => `<tr class="${className}"><th>${escapeHtml(label)}</th>${values.map((value) => `<td>${value}</td>`).join('')}</tr>`;
    const timingCells = timing.map((item) => {
      if (!item.date) return '—';
      const shift = Number(item.daysFromEarliest || 0);
      return `<strong>${escapeHtml(formatDate(item.date))}</strong><small>${shift ? `+${shift} days later in season` : 'earliest selected timing'}</small>`;
    });
    const rows = [
      row('First Saturday', timingCells),
      row('Broadcast $ / pledge hour', analyses.map((a) => `<strong>${escapeHtml(money(rateForAnalysis(a)))}/hr</strong>`), 'metric-primary'),
      row('Broadcast $', analyses.map((a) => `<strong>${escapeHtml(money(a.broadcastDollars))}</strong>`)),
      row('Pledge hours', analyses.map(knownHoursLabel), 'metric-hours'),
      row('Rate-eligible hours', analyses.map((a) => `<strong>${escapeHtml(hours(a.rateEligibleMinutes))}</strong>`)),
      row('Pledges', analyses.map((a) => `<strong>${escapeHtml(count(a.pledges))}</strong>`)),
      row('Pledges / hour', analyses.map((a) => `<strong>${escapeHtml(count(pledgeRateForAnalysis(a), 2))}</strong>`)),
      row('$ / pledge', analyses.map((a) => `<strong>${escapeHtml(money(A.dollarsPerPledge(a.broadcastDollars, a.pledges)))}</strong>`)),
      row('Comparable total', analyses.map((a) => `<strong>${escapeHtml(money(A.comparableTotal(a, policy)))}</strong>`))
    ];
    if (policy.includeOnline) rows.push(row('Online $', analyses.map((a) => escapeHtml(money(a.onlineDollars)))));
    if (policy.includeMail) rows.push(row('Mail $', analyses.map((a) => escapeHtml(money(a.mailDollars)))));
    return `<section class="sheet-section summary-matrix"><h2>Whole-fundraiser comparison</h2><div class="table-scroll"><table><thead><tr><th>Measure</th>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div></section>`;
  }

  function weatherForDay(dateKey) {
    return state.weatherByDate.get(dateKey) || null;
  }

  function weatherLine(day) {
    if (!day) return '';
    const weather = weatherForDay(day.dateKey);
    if (!weather) return 'Weather —';
    const temp = Number.isFinite(weather.avgTemp) ? `${Math.round(weather.avgTemp)}°F` : '—';
    const precip = Number.isFinite(weather.precip) ? `${weather.precip.toFixed(weather.precip < 0.1 ? 2 : 1)} in` : '—';
    return `${temp} · ${precip}`;
  }

  function dailyComparisonChart(analyses, aligned) {
    return lineChartSvg({
      labels: aligned.map((entry) => entry.label.title),
      series: analyses.map((analysis, analysisIndex) => ({
        label: analysis.schedule.title,
        values: aligned.map((entry) => entry.days?.[analysisIndex] ? Number(entry.days[analysisIndex].dollars || 0) : null)
      })),
      ariaLabel: 'Broadcast dollars by corresponding fundraiser day',
      className: 'daily-comparison-chart',
      legendTop: true
    });
  }

  function dailyMatrix(analyses) {
    const aligned = A.alignedDailyRows(analyses);
    const head = analyses.map((analysis) => `<th>${fundraiserColumnHeading(analysis)}</th>`).join('');
    const body = aligned.map((entry) => `
      <tr>
        <th><strong>${escapeHtml(entry.label.title)}</strong><small>${escapeHtml(entry.label.detail)}</small></th>
        ${entry.days.map((day) => {
          if (!day) return '<td class="muted-cell">—</td>';
          return `<td class="day-cell"><strong>${escapeHtml(money(day.dollarsPerHour))}/hr</strong><span>${escapeHtml(formatDate(day.date))} · ${escapeHtml(hours(day.minutes))}${escapeHtml(rateBaseSuffix(day.rateMinutes, day.minutes))}</span><small>${escapeHtml(money(day.dollars))} · ${escapeHtml(count(day.pledges))} pledges</small><small>Regional weather ${escapeHtml(weatherLine(day))}</small></td>`;
        }).join('')}
      </tr>`).join('');
    return `<section class="sheet-section daily-matrix"><div class="section-heading"><div><h2>Corresponding fundraiser days</h2><p>Days align by fundraiser sequence around the first Saturday. The graph compares Broadcast dollars; the table adds $/hour, pledge hours, pledges, and regional pledge-window weather.</p></div></div>${dailyComparisonChart(analyses, aligned)}<div class="table-scroll"><table><thead><tr><th>Fundraiser day</th>${head}</tr></thead><tbody>${body || '<tr><td colspan="6">No comparable fundraiser days.</td></tr>'}</tbody></table></div></section>`;
  }

  function topicProgramTitles(analysis, topic) {
    const titles = [];
    const seen = new Set();
    (analysis?.placementRows || []).forEach((row) => {
      if (A.lookupKey(row.topic) !== A.lookupKey(topic)) return;
      const title = A.text(row.title || row.plannedTitle || '');
      const key = title.toLowerCase();
      if (!title || seen.has(key)) return;
      seen.add(key);
      titles.push(title);
    });
    return titles;
  }

  function recurringProgramKeys(analyses) {
    const counts = new Map();
    analyses.forEach((analysis) => {
      const seenThisFundraiser = new Set();
      (analysis?.placementRows || []).forEach((row) => {
        const title = A.text(row.title || row.plannedTitle || '');
        const key = title.toLowerCase();
        if (!key || seenThisFundraiser.has(key)) return;
        seenThisFundraiser.add(key);
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    return new Set([...counts.entries()].filter(([_key, value]) => value >= 2).map(([key]) => key));
  }

  function topicProgramMarkup(analysis, topic, recurringKeys = new Set()) {
    return topicProgramTitles(analysis, topic).map((title) => {
      const escaped = escapeHtml(title);
      return recurringKeys.has(title.toLowerCase()) ? `<strong>${escaped}</strong>` : escaped;
    }).join(' · ');
  }

  function topicComparisonChart(analyses, rows) {
    return lineChartSvg({
      labels: rows.map((row) => row.key),
      series: analyses.map((analysis, analysisIndex) => ({
        label: analysis.schedule.title,
        values: rows.map((row) => Number(row.values?.[analysisIndex]?.scheduled || 0) > 0 ? Number(row.values[analysisIndex].dollars || 0) : 0)
      })),
      ariaLabel: 'Broadcast dollars by topic across selected fundraisers',
      className: 'topic-comparison-chart'
    });
  }

  function comparisonTopicMatrix(analyses) {
    const rows = A.topicComparisonRows(analyses);
    const head = analyses.map((analysis) => `<th>${fundraiserColumnHeading(analysis)}</th>`).join('');
    const recurringKeys = recurringProgramKeys(analyses);
    const body = rows.map((row) => `
      <tr>
        <th class="topic-label"><strong>${escapeHtml(row.key)}</strong></th>
        ${row.values.map((value, analysisIndex) => {
          if (!(Number(value.scheduled || 0) > 0)) return '<td class="muted-cell">—</td>';
          const analysis = analyses[analysisIndex];
          const hoursShare = Math.max(0, Math.min(100, Number(value.share || 0) * 100));
          const topicIncomeDenominator = [...(analysis.topics?.values?.() || [])].reduce((sum, item) => sum + Number(item.dollars || 0), 0);
          const incomeShare = topicIncomeDenominator > 0 ? Math.max(0, Math.min(100, (Number(value.dollars || 0) / topicIncomeDenominator) * 100)) : 0;
          const programs = topicProgramMarkup(analysis, row.key, recurringKeys);
          const rateBase = rateBaseSuffix(value.rateMinutes, value.minutes);
          return `<td class="topic-cell"><div class="topic-performance-line"><strong>${escapeHtml(money(value.dollarsPerHour))}/hr</strong><span>Hours ${hoursShare.toFixed(0)}%</span><span>Income ${incomeShare.toFixed(0)}%</span></div><small>${escapeHtml(hours(value.minutes))}${escapeHtml(rateBase)} · ${escapeHtml(money(value.dollars))} · ${escapeHtml(count(value.pledges))} pledges · ${escapeHtml(count(value.scheduled))} airings</small>${programs ? `<small class="topic-programs">${programs}</small>` : ''}</td>`;
        }).join('')}
      </tr>`).join('');
    return `<section class="sheet-section topic-matrix"><div class="section-heading"><div><h2>Topic airtime & performance</h2><p>$ / hour uses only airings with valid duration and known results. Hours % and Income % show scheduled allocation and attributable Broadcast income. Programs shown in bold aired in two or more selected fundraisers.</p></div></div>${topicComparisonChart(analyses, rows)}<div class="table-scroll"><table><thead><tr><th>Topic</th>${head}</tr></thead><tbody>${body || '<tr><td>No topic data.</td></tr>'}</tbody></table></div></section>`;
  }

  function durationNoticeSection(analyses) {
    const notices = [];
    const durationText = durationCoverageText(analyses);
    const attributionText = attributionCoverageText(analyses);
    if (durationText) notices.push(`<div class="data-quality-note"><strong>Duration coverage:</strong> ${escapeHtml(durationText)}</div>`);
    if (attributionText) notices.push(`<div class="data-quality-note"><strong>Topic attribution:</strong> ${escapeHtml(attributionText)}</div>`);
    return notices.join('');
  }

  async function renderComparisonReport() {
    const analyses = selectedComparisonAnalyses();
    if (analyses.length < 2 || analyses.length > 5) {
      $('#report-output').innerHTML = `<div class="report-empty"><strong>Select 2–5 fundraisers.</strong><span>${analyses.length} selected.</span></div>`;
      return;
    }
    if (!(await ensureDurationDecision(analyses))) return;
    const render = () => `<article class="one-sheet comparison-sheet">${comparisonHeader(analyses)}${durationNoticeSection(analyses)}${metricMatrix(analyses)}${dailyMatrix(analyses)}${comparisonTopicMatrix(analyses)}<footer class="sheet-footer">Broadcast $/hour excludes unknown results and airings with missing duration from both numerator and denominator; Rate-eligible hours show that exact denominator. Non-Specific Pledges are not treated as incomplete program/topic data. Online and Mail are included only in the comparable-total row when tracked for every selected fundraiser. Regional weather averages available Ironwood, Houghton, Marquette, Escanaba, and Sault Ste. Marie observations during each pledge window.</footer></article>`;
    $('#report-output').innerHTML = render();
    await ensureWeatherForAnalyses(analyses);
    $('#report-output').innerHTML = render();
  }

  async function initComparison() {
    document.title = 'WNMU Fundraiser Comparison Report';
    $('#report-page-title').textContent = 'Fundraiser Comparison';
    $('#report-page-subtitle').textContent = 'Retrospective comparison of 2–5 fundraiser periods';
    state.season = defaultSeason();
    ensureDefaultComparisonSelection();
    renderComparisonControls();
    await renderComparisonReport();
  }

  function renderFundraiserControls() {
    const options = state.schedules.map((schedule) => `<option value="${escapeHtml(schedule.id)}" ${state.activeFundraiserId === schedule.id ? 'selected' : ''}>${escapeHtml(scheduleOptionLabel(schedule))}</option>`).join('');
    $('#report-controls').innerHTML = `<div class="report-control-row"><label class="report-field report-field-grow"><span>Fundraiser</span><select id="report-fundraiser">${options}</select></label><button type="button" class="report-button" id="report-print">Print report</button></div>`;
    $('#report-fundraiser')?.addEventListener('change', (event) => {
      state.activeFundraiserId = event.target.value || '';
      void renderFundraiserReport();
    });
    $('#report-print')?.addEventListener('click', () => window.print());
  }

  function fundraiserSummary(analysis) {
    const schedule = analysis.schedule;
    const firstSaturday = A.firstSaturdayAnchor(analysis);
    return `<header class="sheet-title"><div><div class="report-kicker">WNMU-TV PBS pledge analysis</div><h1>${escapeHtml(schedule.title)}</h1><p>${escapeHtml(formatDate(schedule.startDate))}–${escapeHtml(formatDate(schedule.endDate))}${firstSaturday ? ` · First Saturday ${escapeHtml(formatDate(firstSaturday))}` : ''}</p></div><div class="sheet-stamp">Fundraiser Performance Summary</div></header>
      <section class="fundraiser-kpis">
        <div><span>Broadcast $</span><strong>${escapeHtml(money(analysis.broadcastDollars))}</strong></div>
        <div><span>Pledge hours</span><strong>${escapeHtml(hours(analysis.scheduledMinutes))}</strong><small>${escapeHtml(hours(analysis.rateEligibleMinutes))} rate base</small></div>
        <div><span>Broadcast $ / hour</span><strong>${escapeHtml(money(rateForAnalysis(analysis)))}</strong></div>
        <div><span>Pledges</span><strong>${escapeHtml(count(analysis.pledges))}</strong></div>
        <div><span>Pledges / hour</span><strong>${escapeHtml(count(pledgeRateForAnalysis(analysis), 2))}</strong></div>
        <div><span>$ / pledge</span><strong>${escapeHtml(money(A.dollarsPerPledge(analysis.broadcastDollars, analysis.pledges)))}</strong></div>
        <div><span>Online $</span><strong>${analysis.onlineTracked ? escapeHtml(money(analysis.onlineDollars)) : 'Not tracked'}</strong></div>
        <div><span>Mail $</span><strong>${analysis.mailTracked ? escapeHtml(money(analysis.mailDollars)) : 'Not tracked'}</strong></div>
      </section>`;
  }

  function dailyIncomeChart(analysis) {
    const days = A.calendarDays(analysis);
    return `<section class="sheet-section income-curve"><div class="section-heading"><div><h2>Income across the fundraiser</h2><p>Daily Broadcast dollars across the fundraiser.</p></div></div>${incomeBarChartSvg(days)}</section>`;
  }

  function fundraiserDailyTable(analysis) {
    const days = A.calendarDays(analysis);
    const rows = days.map((day) => {
      const timeRange = `${formatTime(day.startMinutes)}–${formatTime(day.endMinutes)}`;
      const weekend = day.weekday === 'Saturday' || day.weekday === 'Sunday';
      const rateBase = Math.abs(Number(day.rateMinutes || 0) - Number(day.minutes || 0)) >= 0.5
        ? `<small>${escapeHtml(hours(day.rateMinutes))} rate base</small>`
        : '';
      return `<tr class="${weekend ? 'weekend-row' : ''}"><th><strong>${escapeHtml(day.weekday)}</strong><small>${escapeHtml(formatDate(day.date))} · ${escapeHtml(timeRange)}</small></th><td>${escapeHtml(hours(day.minutes))}${rateBase}</td><td>${escapeHtml(money(day.dollars))}</td><td class="metric-primary">${escapeHtml(money(day.dollarsPerHour))}/hr</td><td>${escapeHtml(count(day.pledges))}</td><td>${escapeHtml(count(day.pledgesPerHour, 2))}</td><td>${escapeHtml(weatherLine(day))}</td></tr>`;
    }).join('');
    return `<section class="sheet-section fundraiser-days"><h2>Day-by-day operating results</h2><div class="table-scroll"><table><thead><tr><th>Day</th><th>Hours</th><th>Broadcast $</th><th>$/hr</th><th>Pledges</th><th>Pledges/hr</th><th>Regional weather</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  function programResultsTable(analysis) {
    const rows = A.programResultsRows(analysis);
    const body = rows.map((row) => `
      <tr>
        <th class="program-result-title"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(count(row.airings))} airing${row.airings === 1 ? '' : 's'}</small></th>
        <td>${escapeHtml(row.topic || 'Uncategorized')}</td>
        <td>${escapeHtml(row.lengthLabel)}</td>
        <td class="metric-primary">${escapeHtml(money(row.dollars))}</td>
        <td>${row.rateMinutes > 0 ? `${escapeHtml(money(row.dollarsPerHour))}/hr` : '<span class="missing-rate">N/A</span>'}</td>
        <td>${escapeHtml(count(row.pledges))}</td>
      </tr>`).join('');
    return `<section class="sheet-section program-results"><div class="section-heading"><div><h2>Program results</h2><p>One entry per title, ranked by total Broadcast dollars earned during this fundraiser.</p></div></div><div class="table-scroll"><table><thead><tr><th>Program</th><th>Topic</th><th>Length</th><th>Broadcast $</th><th>$/hr</th><th>Pledges</th></tr></thead><tbody>${body || '<tr><td colspan="6">No program results are available.</td></tr>'}</tbody></table></div></section>`;
  }

  function singleTopicSummary(analysis) {
    const rows = A.topicComparisonRows([analysis])
      .map((row) => ({ row, value: row.values[0] }))
      .filter((item) => Number(item.value.scheduled || 0) > 0)
      .sort((a, b) => b.value.dollarsPerHour - a.value.dollarsPerHour || b.value.dollars - a.value.dollars || a.row.key.localeCompare(b.row.key));
    const totalTopicIncome = rows.reduce((sum, item) => sum + Number(item.value.dollars || 0), 0);
    const body = rows.map(({ row, value }) => {
      const incomeShare = totalTopicIncome > 0 ? Number(value.dollars || 0) / totalTopicIncome : 0;
      const programs = topicProgramMarkup(analysis, row.key);
      const rateBase = rateBaseSuffix(value.rateMinutes, value.minutes);
      return `<tr><th>${escapeHtml(row.key)}</th><td><strong>${escapeHtml(money(value.dollars))} / ${escapeHtml(money(value.dollarsPerHour))}/hr / ${escapeHtml(percent(incomeShare))} income</strong><span>${escapeHtml(hours(value.minutes))}${escapeHtml(rateBase)} / ${escapeHtml(percent(value.share))} / ${escapeHtml(count(value.scheduled))} airings</span>${programs ? `<small class="topic-programs">${programs}</small>` : ''}</td></tr>`;
    }).join('');
    return `<section class="sheet-section topic-summary"><div class="section-heading"><div><h2>Topic airtime & performance</h2><p>Topics are ranked by Broadcast $/hour. The first line shows attributable income; the second shows scheduled airtime, the rate base when different, and exposure.</p></div></div><div class="table-scroll"><table><thead><tr><th>Topic</th><th>Fundraiser result</th></tr></thead><tbody>${body || '<tr><td colspan="2">No topic data.</td></tr>'}</tbody></table></div></section>`;
  }

  async function renderFundraiserReport() {
    const schedule = state.schedules.find((item) => item.id === state.activeFundraiserId) || state.schedules[0];
    if (!schedule) {
      $('#report-output').innerHTML = '<div class="report-empty">No saved fundraisers are available.</div>';
      return;
    }
    state.activeFundraiserId = schedule.id;
    const analysis = analysisFor(schedule);
    if (!(await ensureDurationDecision([analysis]))) return;
    const render = () => `<article class="one-sheet fundraiser-sheet">${fundraiserSummary(analysis)}${durationNoticeSection([analysis])}${dailyIncomeChart(analysis)}${fundraiserDailyTable(analysis)}${programResultsTable(analysis)}${singleTopicSummary(analysis)}<footer class="sheet-footer">Program, daily, and topic $/hour use only observations with known results and valid duration; the displayed rate base identifies the denominator when it differs from scheduled pledge hours. Non-Specific Pledges are not treated as incomplete program/topic data. Start-time performance is reserved for historical analytics where sufficient sample size can be required. Regional weather averages available Ironwood, Houghton, Marquette, Escanaba, and Sault Ste. Marie observations during each pledge window.</footer></article>`;
    $('#report-output').innerHTML = render();
    await ensureWeatherForAnalyses([analysis]);
    $('#report-output').innerHTML = render();
  }

  async function initFundraiser() {
    document.title = 'WNMU Fundraiser Performance Summary';
    $('#report-page-title').textContent = 'Fundraiser Performance Summary';
    $('#report-page-subtitle').textContent = 'One fundraiser, from first pledge hour to last';
    state.activeFundraiserId = state.schedules[0]?.id || '';
    renderFundraiserControls();
    await renderFundraiserReport();
  }

  function historicalControls() {
    $('#report-controls').innerHTML = `<div class="report-control-row"><div class="historical-control-copy"><strong>All saved fundraiser history</strong><span>Historical rankings use median Broadcast $/hour and minimum evidence rules.</span></div><button type="button" class="report-button" id="report-print">Print report</button></div>`;
    $('#report-print')?.addEventListener('click', () => window.print());
  }

  function historicalAnalyses() {
    return state.schedules.map(analysisFor).filter(Boolean);
  }

  function historicalHeader(analyses) {
    const years = analyses.map((analysis) => Number(analysis.schedule?.year || 0)).filter(Boolean);
    const totalBroadcast = analyses.reduce((sum, analysis) => sum + Number(analysis.broadcastDollars || 0), 0);
    const totalMinutes = analyses.reduce((sum, analysis) => sum + Number(analysis.scheduledMinutes || 0), 0);
    const totalAirings = analyses.reduce((sum, analysis) => sum + Number(analysis.scheduled || 0), 0);
    return `<header class="sheet-title"><div><div class="report-kicker">WNMU-TV PBS historical pledge analysis</div><h1>Historical Fundraiser Analytics</h1><p>${years.length ? `${Math.min(...years)}–${Math.max(...years)} · ` : ''}${escapeHtml(count(analyses.length))} fundraisers · ${escapeHtml(count(totalAirings))} scheduled pledge airings</p></div><div class="sheet-stamp">${escapeHtml(money(totalBroadcast))} Broadcast · ${escapeHtml(hours(totalMinutes))} known pledge hours</div></header>`;
  }

  function historicalKeyLabel(dimension, key) {
    if (dimension === 'startTime') return formatTime(Number(key));
    return String(key || 'Unknown');
  }

  function historicalRankingTable(analyses, dimension, title, description, options = {}) {
    const rows = A.historicalRanking(analyses, dimension, options);
    const body = rows.map((row) => `<tr><th>${escapeHtml(historicalKeyLabel(dimension, row.key))}</th><td class="metric-primary">${escapeHtml(money(row.medianDollarsPerHour))}/hr</td><td>${escapeHtml(money(row.averageDollarsPerHour))}/hr</td><td>${escapeHtml(money(row.broadcastDollars))}</td><td>${escapeHtml(count(row.rateAirings))}</td><td>${escapeHtml(count(row.fundraisers))}</td><td>${escapeHtml(count(row.titles))}</td></tr>`).join('');
    return `<section class="sheet-section historical-ranking"><div class="section-heading"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div></div><div class="table-scroll"><table><thead><tr><th>Group</th><th>Median $/hr</th><th>Avg $/hr</th><th>Broadcast $</th><th>Rate airings</th><th>Fundraisers</th><th>Titles</th></tr></thead><tbody>${body || '<tr><td colspan="7">No categories meet the evidence threshold.</td></tr>'}</tbody></table></div></section>`;
  }

  function historicalSeasonTable(analyses) {
    return historicalRankingTable(
      analyses,
      'season',
      'Performance by fundraiser season',
      'Season-level performance across the full historical record.',
      { minAirings: 1, minFundraisers: 1, minTitles: 1 }
    );
  }

  function weekpartForDate(dateValue) {
    const date = A.parseDate(dateValue);
    if (!date) return 'Unknown';
    if (date.getDay() === 6) return 'Saturday';
    if (date.getDay() === 0) return 'Sunday';
    return 'Weekday';
  }

  function analysesForWeekpart(analyses, weekpart) {
    return analyses.map((analysis) => ({
      ...analysis,
      placementRows: (analysis.placementRows || []).filter((row) => weekpartForDate(row.dateKey) === weekpart)
    }));
  }

  function historicalStartTimeTables(analyses) {
    const description = (weekpart) => `Only ${weekpart.toLowerCase()} 30-minute start slots with at least 5 rate-valid airings, 3 fundraisers, and 3 distinct titles are shown. Sparse slots are excluded rather than displayed in the ranking.`;
    return [
      historicalRankingTable(analysesForWeekpart(analyses, 'Weekday'), 'startTime', 'Weekday start-time performance', description('Weekday')),
      historicalRankingTable(analysesForWeekpart(analyses, 'Saturday'), 'startTime', 'Saturday start-time performance', description('Saturday')),
      historicalRankingTable(analysesForWeekpart(analyses, 'Sunday'), 'startTime', 'Sunday start-time performance', description('Sunday'))
    ].join('');
  }

  function historicalReportBody(analyses) {
    return [
      historicalSeasonTable(analyses),
      historicalRankingTable(analyses, 'topic', 'Topic performance', 'Topics with at least 3 rate-valid airings across at least 2 fundraisers, ranked by median Broadcast $/hour.'),
      historicalRankingTable(analyses, 'subtopic', 'Subtopic performance', 'Subtopics with at least 3 rate-valid airings across at least 2 fundraisers, ranked by median Broadcast $/hour.'),
      historicalStartTimeTables(analyses),
      historicalRankingTable(analyses, 'weekpart', 'Weekday / Saturday / Sunday', 'Performance by calendar day type, ranked by median Broadcast $/hour.'),
      historicalRankingTable(analyses, 'daypart', 'Daypart performance', 'Morning, afternoon, early evening, prime, and overnight performance.'),
      historicalRankingTable(analyses, 'breakType', 'Live break vs pre-recorded break', 'Uses saved schedule live-break flags only. Imported rows without schedule flags are not used in this comparison.'),
      historicalRankingTable(analyses, 'distributor', 'Distributor performance', 'Distributors with at least 3 rate-valid airings across at least 2 fundraisers.')
    ].join('');
  }

  async function renderHistoricalReport() {
    const analyses = historicalAnalyses();
    if (!analyses.length) {
      $('#report-output').innerHTML = '<div class="report-empty">No fundraiser history is available.</div>';
      return;
    }
    if (!(await ensureDurationDecision(analyses))) return;
    $('#report-output').innerHTML = `<article class="one-sheet historical-sheet">${historicalHeader(analyses)}${durationNoticeSection(analyses)}${historicalReportBody(analyses)}<footer class="sheet-footer">Historical rankings use median Broadcast $/hour. Rate calculations exclude unknown results and true program airings with missing duration from both numerator and denominator. Non-Specific Pledges are not treated as incomplete program/topic data. Start-time rankings are evaluated separately for Weekdays, Saturdays, and Sundays; each requires 5 rate-valid airings across 3 rate-valid fundraisers and 3 distinct rate-valid titles.</footer></article>`;
  }

  async function initHistorical() {
    document.title = 'WNMU Historical Fundraiser Analytics';
    $('#report-page-title').textContent = 'Historical Fundraiser Analytics';
    $('#report-page-subtitle').textContent = 'Retrospective patterns across the full pledge record';
    historicalControls();
    await renderHistoricalReport();
  }

  function weatherEndpointOrder(endDate = '') {
    const end = A.parseDate(endDate);
    const ageDays = end ? (Date.now() - end.getTime()) / 86400000 : 9999;
    const forecast = 'https://api.open-meteo.com/v1/forecast';
    const archive = 'https://archive-api.open-meteo.com/v1/archive';
    return ageDays >= -16 && ageDays <= 92 ? [forecast, archive] : [archive, forecast];
  }

  async function fetchStationWeather(location, startDate, endDate) {
    let lastError = null;
    for (const endpoint of weatherEndpointOrder(endDate)) {
      try {
        const params = new URLSearchParams({
          latitude: String(location.latitude),
          longitude: String(location.longitude),
          start_date: startDate,
          end_date: endDate,
          hourly: 'temperature_2m,precipitation',
          temperature_unit: 'fahrenheit',
          precipitation_unit: 'inch',
          timezone: 'America/Detroit'
        });
        const response = await fetch(`${endpoint}?${params.toString()}`);
        if (!response.ok) throw new Error(`${location.name} weather ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data?.hourly?.time)) throw new Error(`${location.name} weather response had no hourly data`);
        return data.hourly;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`${location.name} weather unavailable`);
  }

  function summarizeStationForDays(hourly, days) {
    const output = new Map();
    days.forEach((day) => {
      const windowInfo = A.pledgeWeatherWindowForDate(day.dateKey, day);
      const temps = [];
      let precip = 0;
      (hourly.time || []).forEach((stamp, index) => {
        const raw = String(stamp || '');
        if (raw.slice(0, 10) !== day.dateKey) return;
        const hour = Number(raw.slice(11, 13));
        if (!Number.isFinite(hour) || hour < windowInfo.startHour || hour >= windowInfo.endHourExclusive) return;
        const temp = Number(hourly.temperature_2m?.[index]);
        const rain = Number(hourly.precipitation?.[index]);
        if (Number.isFinite(temp)) temps.push(temp);
        if (Number.isFinite(rain)) precip += rain;
      });
      output.set(day.dateKey, {
        avgTemp: temps.length ? temps.reduce((sum, value) => sum + value, 0) / temps.length : null,
        precip
      });
    });
    return output;
  }

  async function fetchWeatherForAnalysis(analysis) {
    const id = analysis.schedule?.id;
    if (!id || state.weatherLoadedSchedules.has(id)) return;
    const days = A.calendarDays(analysis);
    if (!days.length) {
      state.weatherLoadedSchedules.add(id);
      return;
    }
    const startDate = days[0].dateKey;
    const endDate = days[days.length - 1].dateKey;
    const settled = await Promise.allSettled(WEATHER_LOCATIONS.map(async (location) => ({
      location,
      hourly: await fetchStationWeather(location, startDate, endDate)
    })));
    const success = settled.filter((entry) => entry.status === 'fulfilled').map((entry) => entry.value);
    if (!success.length) return;
    const stationMaps = success.map((entry) => summarizeStationForDays(entry.hourly, days));
    days.forEach((day) => {
      const values = stationMaps.map((map) => map.get(day.dateKey)).filter(Boolean);
      const temps = values.map((item) => item.avgTemp).filter(Number.isFinite);
      const precips = values.map((item) => item.precip).filter(Number.isFinite);
      state.weatherByDate.set(day.dateKey, {
        avgTemp: temps.length ? temps.reduce((sum, value) => sum + value, 0) / temps.length : null,
        precip: precips.length ? precips.reduce((sum, value) => sum + value, 0) / precips.length : null
      });
    });
    state.weatherLoadedSchedules.add(id);
  }

  async function ensureWeatherForAnalyses(analyses) {
    const pending = analyses.filter((analysis) => !state.weatherLoadedSchedules.has(analysis.schedule?.id));
    if (!pending.length || state.loadingWeather) return;
    state.loadingWeather = true;
    try {
      await Promise.allSettled(pending.map(fetchWeatherForAnalysis));
    } finally {
      state.loadingWeather = false;
    }
  }

  async function init() {
    try {
      if (!A) throw new Error('One-sheet analysis module did not load.');
      const allowed = await requireAdmin();
      if (!allowed) return;
      $('#report-access-gate')?.classList.add('hidden');
      $('#report-app')?.classList.remove('hidden');
      await loadData();

      const mode = reportMode();
      if (mode === 'comparison') await initComparison();
      else if (mode === 'fundraiser') await initFundraiser();
      else if (mode === 'historical') await initHistorical();
      else renderHub();
    } catch (error) {
      console.error(error);
      showAccessDenied(error?.message || 'The report center could not load.');
    }
  }

  document.addEventListener('DOMContentLoaded', () => { void init(); }, { once: true });
})();
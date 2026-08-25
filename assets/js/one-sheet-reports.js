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
    loadingWeather: false
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

  function count(value, digits = 0) {
    return Number(value || 0).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function hours(minutes) {
    return `${(Number(minutes || 0) / 60).toFixed(1)}h`;
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
    if (gate) {
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
      fetchAll('pledge_programs_v2', 'id,title,nola_code,topic_primary,topic_secondary')
    ]);

    state.schedules = A.prepareSchedules(scheduleRows.map(A.normalizeSchedule))
      .filter((schedule) => schedule.season && schedule.year);
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

  function renderHub() {
    document.title = 'WNMU One-Sheet Reports';
    $('#report-page-title').textContent = 'One-Sheet Reports';
    $('#report-page-subtitle').textContent = 'Printable retrospective fundraiser analysis';
    $('#report-controls').innerHTML = '';
    $('#report-output').innerHTML = `
      <section class="report-hub">
        <a class="report-card-link" href="reports.html?report=comparison">
          <div class="report-card-number">01</div>
          <div>
            <h2>Fundraiser Comparison</h2>
            <p>Compare 3–5 fundraisers by pledge hours, Broadcast $/hour, pledges, corresponding fundraiser days, weather, and topic airtime + performance.</p>
          </div>
          <span>Open report →</span>
        </a>
        <a class="report-card-link" href="reports.html?report=fundraiser">
          <div class="report-card-number">02</div>
          <div>
            <h2>Fundraiser Performance Summary</h2>
            <p>Review one fundraiser’s daily income curve, pledge hours, start/end times, $/hour, pledge response, weather, and topic performance.</p>
          </div>
          <span>Open report →</span>
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
    return `${schedule.title} · ${formatDate(schedule.startDate)}–${formatDate(schedule.endDate, false)}`;
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
    if (state.selectedIds.size >= 3) return;
    state.selectedIds.clear();
    allowed.slice(0, 3).forEach((schedule) => state.selectedIds.add(schedule.id));
  }

  function selectedComparisonAnalyses() {
    const selected = state.schedules
      .filter((schedule) => state.selectedIds.has(schedule.id))
      .sort((a, b) => A.text(a.startDate).localeCompare(A.text(b.startDate)));
    return selected.map(analysisFor).filter(Boolean);
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
        <span><strong>${escapeHtml(schedule.title)}</strong><small>${escapeHtml(formatDate(schedule.startDate))}–${escapeHtml(formatDate(schedule.endDate, false))}</small></span>
      </label>`).join('');

    $('#report-controls').innerHTML = `
      <div class="report-control-row">
        <label class="report-field"><span>Pledge season</span><select id="report-season">${seasonOptions}</select></label>
        <div class="report-selection">
          <span>Select 3–5 fundraisers</span>
          <div id="report-fundraiser-checks" class="report-checks">${checks || '<em>No fundraisers in this season.</em>'}</div>
        </div>
        <button type="button" class="report-button" id="report-print">Print one-sheet</button>
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
          setStatus('A comparison one-sheet can include up to five fundraisers.', 'warn');
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
    const season = analyses.every((analysis) => analysis.schedule.season === analyses[0]?.schedule.season)
      ? analyses[0]?.schedule.season
      : 'Multi-season';
    const years = analyses.map((analysis) => analysis.schedule.year).filter(Boolean);
    const yearRange = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '';
    const channels = ['Broadcast', policy.includeOnline ? 'Online' : '', policy.includeMail ? 'Mail' : ''].filter(Boolean).join(' + ');
    return `
      <header class="sheet-title">
        <div><div class="report-kicker">WNMU-TV PBS pledge analysis</div><h1>${escapeHtml(season || 'Fundraiser')} Fundraiser Comparison</h1><p>${escapeHtml(yearRange)} · ${analyses.length} fundraisers · Comparable total basis: ${escapeHtml(channels)}</p></div>
        <div class="sheet-stamp">Generated ${escapeHtml(new Date().toLocaleDateString())}</div>
      </header>`;
  }

  function metricMatrix(analyses) {
    const policy = A.comparisonChannelPolicy(analyses);
    const timing = A.firstSaturdaySeasonalOffsets(analyses);
    const head = analyses.map((analysis) => `<th><strong>${escapeHtml(analysis.schedule.title)}</strong><small>${escapeHtml(String(analysis.schedule.year || ''))}</small></th>`).join('');
    const row = (label, values, className = '') => `<tr class="${className}"><th>${escapeHtml(label)}</th>${values.map((value) => `<td>${value}</td>`).join('')}</tr>`;
    const timingCells = timing.map((item) => {
      if (!item.date) return '—';
      const shift = Number(item.daysFromEarliest || 0);
      return `<strong>${escapeHtml(formatDate(item.date))}</strong><small>${shift ? `+${shift} days later in season` : 'earliest selected timing'}</small>`;
    });
    const rows = [
      row('First Saturday', timingCells),
      row('Pledge hours', analyses.map((a) => `<strong>${escapeHtml(hours(a.scheduledMinutes))}</strong>`), 'metric-hours'),
      row('Broadcast $', analyses.map((a) => `<strong>${escapeHtml(money(a.broadcastDollars))}</strong>`)),
      row('Broadcast $ / pledge hour', analyses.map((a) => `<strong>${escapeHtml(money(A.dollarsPerHour(a.broadcastDollars, a.scheduledMinutes)))}/hr</strong>`), 'metric-primary'),
      row('Pledges', analyses.map((a) => `<strong>${escapeHtml(count(a.pledges))}</strong>`)),
      row('Pledges / hour', analyses.map((a) => `<strong>${escapeHtml(count(A.pledgesPerHour(a.pledges, a.scheduledMinutes), 2))}</strong>`)),
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

  function dailyMatrix(analyses) {
    const aligned = A.alignedDailyRows(analyses);
    const head = analyses.map((analysis) => `<th>${escapeHtml(analysis.schedule.year || analysis.schedule.title)}</th>`).join('');
    const body = aligned.map((entry) => `
      <tr>
        <th><strong>${escapeHtml(entry.label.title)}</strong><small>${escapeHtml(entry.label.detail)}</small></th>
        ${entry.days.map((day) => {
          if (!day) return '<td class="muted-cell">—</td>';
          return `<td class="day-cell">
            <strong>${escapeHtml(money(day.dollarsPerHour))}/hr</strong>
            <span>${escapeHtml(formatDate(day.date))} · ${escapeHtml(hours(day.minutes))}</span>
            <small>${escapeHtml(money(day.dollars))} · ${escapeHtml(count(day.pledges))} pledges</small>
            <small>${escapeHtml(weatherLine(day))}</small>
          </td>`;
        }).join('')}
      </tr>`).join('');

    return `<section class="sheet-section daily-matrix"><div class="section-heading"><div><h2>Corresponding fundraiser days</h2><p>Days align by fundraiser sequence around the first Saturday. Each cell leads with Broadcast $/pledge hour, then actual date, pledge hours, dollars, pledges, and weather.</p></div></div><div class="table-scroll"><table><thead><tr><th>Fundraiser day</th>${head}</tr></thead><tbody>${body || '<tr><td colspan="6">No comparable fundraiser days.</td></tr>'}</tbody></table></div></section>`;
  }

  function topicMatrix(analyses) {
    const rows = A.topicComparisonRows(analyses);
    const maxRate = Math.max(1, ...rows.flatMap((row) => row.values.map((value) => Number(value.dollarsPerHour || 0))));
    const head = analyses.map((analysis) => `<th>${escapeHtml(analysis.schedule.year || analysis.schedule.title)}</th>`).join('');
    const body = rows.map((row) => `
      <tr>
        <th>${escapeHtml(row.key)}</th>
        ${row.values.map((value) => {
          if (!(Number(value.minutes || 0) > 0)) return '<td class="muted-cell">—</td>';
          const share = Math.max(0, Math.min(100, Number(value.share || 0) * 100));
          const strength = Math.max(0, Math.min(1, Number(value.dollarsPerHour || 0) / maxRate));
          const alpha = (0.035 + (strength * 0.18)).toFixed(3);
          return `<td class="topic-cell" style="background:linear-gradient(90deg,rgba(14,95,145,.14) 0 ${share.toFixed(1)}%,rgba(255,255,255,0) ${share.toFixed(1)}% 100%),rgba(14,95,145,${alpha})">
            <strong>${escapeHtml(hours(value.minutes))} · ${escapeHtml(money(value.dollarsPerHour))}/hr</strong>
            <span>${share.toFixed(0)}% of pledge hours</span>
            <small>${escapeHtml(money(value.dollars))} · ${escapeHtml(count(value.pledges))} pledges · ${escapeHtml(count(value.scheduled))} airings</small>
          </td>`;
        }).join('')}
      </tr>`).join('');

    return `<section class="sheet-section topic-matrix"><div class="section-heading"><div><h2>Topic airtime & performance</h2><p>Bar width = share of fundraiser pledge hours. Cell intensity and printed rate = Broadcast $/pledge hour. Total topic dollars, pledges, and airings remain visible.</p></div></div><div class="table-scroll"><table><thead><tr><th>Topic</th>${head}</tr></thead><tbody>${body || '<tr><td>No topic data.</td></tr>'}</tbody></table></div></section>`;
  }

  function overallWeatherMatrix(analyses) {
    const rows = analyses.map((analysis) => {
      const days = A.calendarDays(analysis);
      const weather = days.map((day) => weatherForDay(day.dateKey)).filter(Boolean);
      if (!weather.length) return { analysis, avgTemp: null, precip: null, wetDays: null, days: 0 };
      const temps = weather.map((item) => item.avgTemp).filter(Number.isFinite);
      return {
        analysis,
        avgTemp: temps.length ? temps.reduce((sum, value) => sum + value, 0) / temps.length : null,
        precip: weather.reduce((sum, item) => sum + (Number(item.precip || 0) || 0), 0),
        wetDays: weather.filter((item) => Number(item.precip || 0) >= 0.01).length,
        days: weather.length
      };
    });
    return `<section class="sheet-section weather-strip"><h2>Weather across pledge hours</h2><div class="weather-cards">${rows.map((row) => `<div><strong>${escapeHtml(row.analysis.schedule.year || row.analysis.schedule.title)}</strong><span>${Number.isFinite(row.avgTemp) ? `${Math.round(row.avgTemp)}°F avg` : 'Weather unavailable'}</span><small>${Number.isFinite(row.precip) ? `${row.precip.toFixed(row.precip < 0.1 ? 2 : 1)} in composite precip · ${row.wetDays}/${row.days} wet days` : '—'}</small></div>`).join('')}</div></section>`;
  }

  async function renderComparisonReport() {
    const analyses = selectedComparisonAnalyses();
    if (analyses.length < 3 || analyses.length > 5) {
      $('#report-output').innerHTML = `<div class="report-empty"><strong>Select 3–5 fundraisers.</strong><span>${analyses.length} selected.</span></div>`;
      return;
    }

    $('#report-output').innerHTML = `<article class="one-sheet comparison-sheet">${comparisonHeader(analyses)}${metricMatrix(analyses)}${dailyMatrix(analyses)}${topicMatrix(analyses)}${overallWeatherMatrix(analyses)}<footer class="sheet-footer">Broadcast $/hour = authoritative Broadcast dollars ÷ pledge-schedule hours. Online and Mail are included only in the comparable-total row when tracked for every selected fundraiser.</footer></article>`;
    await ensureWeatherForAnalyses(analyses);
    $('#report-output').innerHTML = `<article class="one-sheet comparison-sheet">${comparisonHeader(analyses)}${metricMatrix(analyses)}${dailyMatrix(analyses)}${topicMatrix(analyses)}${overallWeatherMatrix(analyses)}<footer class="sheet-footer">Broadcast $/hour = authoritative Broadcast dollars ÷ pledge-schedule hours. Online and Mail are included only in the comparable-total row when tracked for every selected fundraiser.</footer></article>`;
  }

  async function initComparison() {
    document.title = 'WNMU Fundraiser Comparison One-Sheet';
    $('#report-page-title').textContent = 'Fundraiser Comparison';
    $('#report-page-subtitle').textContent = 'Retrospective comparison of 3–5 fundraiser periods';
    state.season = defaultSeason();
    ensureDefaultComparisonSelection();
    renderComparisonControls();
    await renderComparisonReport();
  }

  function renderFundraiserControls() {
    const options = state.schedules.map((schedule) => `<option value="${escapeHtml(schedule.id)}" ${state.activeFundraiserId === schedule.id ? 'selected' : ''}>${escapeHtml(scheduleOptionLabel(schedule))}</option>`).join('');
    $('#report-controls').innerHTML = `
      <div class="report-control-row">
        <label class="report-field report-field-grow"><span>Fundraiser</span><select id="report-fundraiser">${options}</select></label>
        <button type="button" class="report-button" id="report-print">Print one-sheet</button>
      </div>`;
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
        <div><span>Pledge hours</span><strong>${escapeHtml(hours(analysis.scheduledMinutes))}</strong></div>
        <div class="primary"><span>Broadcast $ / hour</span><strong>${escapeHtml(money(A.dollarsPerHour(analysis.broadcastDollars, analysis.scheduledMinutes)))}</strong></div>
        <div><span>Pledges</span><strong>${escapeHtml(count(analysis.pledges))}</strong></div>
        <div><span>Pledges / hour</span><strong>${escapeHtml(count(A.pledgesPerHour(analysis.pledges, analysis.scheduledMinutes), 2))}</strong></div>
        <div><span>$ / pledge</span><strong>${escapeHtml(money(A.dollarsPerPledge(analysis.broadcastDollars, analysis.pledges)))}</strong></div>
        <div><span>Online $</span><strong>${analysis.onlineTracked ? escapeHtml(money(analysis.onlineDollars)) : 'Not tracked'}</strong></div>
        <div><span>Mail $</span><strong>${analysis.mailTracked ? escapeHtml(money(analysis.mailDollars)) : 'Not tracked'}</strong></div>
      </section>`;
  }

  function dailyIncomeChart(analysis) {
    const days = A.calendarDays(analysis);
    const max = Math.max(1, ...days.map((day) => day.dollars));
    return `<section class="sheet-section income-curve"><div class="section-heading"><div><h2>Income across the fundraiser</h2><p>Daily Broadcast dollars. Each bar also shows the day’s pledge count and Broadcast $/pledge hour.</p></div></div><div class="income-bars">${days.map((day) => {
      const height = Math.max(4, Math.round((Number(day.dollars || 0) / max) * 100));
      return `<div class="income-bar-item"><div class="income-bar-value">${escapeHtml(money(day.dollars))}<small>${escapeHtml(count(day.pledges))} pledges · ${escapeHtml(money(day.dollarsPerHour))}/hr</small></div><div class="income-bar-track"><div class="income-bar-fill" style="height:${height}%"></div></div><strong>${escapeHtml(formatDate(day.date, false))}</strong><span>${escapeHtml(day.weekday.slice(0, 3))}</span></div>`;
    }).join('')}</div></section>`;
  }

  function fundraiserDailyTable(analysis) {
    const days = A.calendarDays(analysis);
    const rows = days.map((day) => `<tr>
      <th><strong>${escapeHtml(day.weekday)}</strong><small>${escapeHtml(formatDate(day.date))}</small></th>
      <td>${escapeHtml(formatTime(day.startMinutes))}</td>
      <td>${escapeHtml(formatTime(day.endMinutes))}</td>
      <td>${escapeHtml(hours(day.minutes))}</td>
      <td>${escapeHtml(money(day.dollars))}</td>
      <td class="metric-primary">${escapeHtml(money(day.dollarsPerHour))}/hr</td>
      <td>${escapeHtml(count(day.pledges))}</td>
      <td>${escapeHtml(count(day.pledgesPerHour, 2))}</td>
      <td>${escapeHtml(weatherLine(day))}</td>
    </tr>`).join('');
    return `<section class="sheet-section fundraiser-days"><h2>Day-by-day operating results</h2><div class="table-scroll"><table><thead><tr><th>Day</th><th>Start</th><th>End</th><th>Hours</th><th>Broadcast $</th><th>$/hr</th><th>Pledges</th><th>Pledges/hr</th><th>Weather</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }

  function pledgeHourChart(analysis) {
    const buckets = A.hourlyPledgeBuckets(analysis);
    const max = Math.max(1, ...buckets.map((row) => row.pledges));
    return `<section class="sheet-section pledge-hours"><div class="section-heading"><div><h2>Pledges by program start hour</h2><p>Pledge counts are credited to imported airing rows and grouped by the program’s start hour.</p></div></div><div class="pledge-hour-bars">${buckets.map((row) => {
      const width = Math.max(2, Math.round((Number(row.pledges || 0) / max) * 100));
      return `<div class="pledge-hour-row"><strong>${escapeHtml(formatTime(row.startMinutes).replace(':00 ', ' '))}</strong><div><i style="width:${width}%"></i></div><span>${escapeHtml(count(row.pledges))} pledges · ${escapeHtml(money(row.dollars))}</span></div>`;
    }).join('') || '<div class="muted-cell">No pledge-count rows are available.</div>'}</div></section>`;
  }

  function singleTopicMatrix(analysis) {
    return topicMatrix([analysis]);
  }

  async function renderFundraiserReport() {
    const schedule = state.schedules.find((item) => item.id === state.activeFundraiserId) || state.schedules[0];
    if (!schedule) {
      $('#report-output').innerHTML = '<div class="report-empty">No saved fundraisers are available.</div>';
      return;
    }
    state.activeFundraiserId = schedule.id;
    const analysis = analysisFor(schedule);
    $('#report-output').innerHTML = `<article class="one-sheet fundraiser-sheet">${fundraiserSummary(analysis)}${dailyIncomeChart(analysis)}${fundraiserDailyTable(analysis)}<div class="sheet-two-column">${pledgeHourChart(analysis)}${singleTopicMatrix(analysis)}</div><footer class="sheet-footer">Daily $/hour is Broadcast dollars ÷ pledge-schedule hours for that day. Pledge-by-hour counts are associated with program start time, not donor transaction time.</footer></article>`;
    await ensureWeatherForAnalyses([analysis]);
    $('#report-output').innerHTML = `<article class="one-sheet fundraiser-sheet">${fundraiserSummary(analysis)}${dailyIncomeChart(analysis)}${fundraiserDailyTable(analysis)}<div class="sheet-two-column">${pledgeHourChart(analysis)}${singleTopicMatrix(analysis)}</div><footer class="sheet-footer">Daily $/hour is Broadcast dollars ÷ pledge-schedule hours for that day. Pledge-by-hour counts are associated with program start time, not donor transaction time.</footer></article>`;
  }

  async function initFundraiser() {
    document.title = 'WNMU Fundraiser Performance Summary';
    $('#report-page-title').textContent = 'Fundraiser Performance Summary';
    $('#report-page-subtitle').textContent = 'One fundraiser, from first pledge hour to last';
    state.activeFundraiserId = state.schedules[0]?.id || '';
    renderFundraiserControls();
    await renderFundraiserReport();
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
    const settled = await Promise.allSettled(
      WEATHER_LOCATIONS.map(async (location) => ({
        location,
        hourly: await fetchStationWeather(location, startDate, endDate)
      }))
    );
    const success = settled.filter((entry) => entry.status === 'fulfilled').map((entry) => entry.value);
    if (!success.length) return;

    const stationMaps = success.map((entry) => summarizeStationForDays(entry.hourly, days));
    days.forEach((day) => {
      const values = stationMaps.map((map) => map.get(day.dateKey)).filter(Boolean);
      const temps = values.map((item) => item.avgTemp).filter(Number.isFinite);
      const precips = values.map((item) => item.precip).filter(Number.isFinite);
      state.weatherByDate.set(day.dateKey, {
        avgTemp: temps.length ? temps.reduce((sum, value) => sum + value, 0) / temps.length : null,
        precip: precips.length ? precips.reduce((sum, value) => sum + value, 0) / precips.length : null,
        wetStations: values.filter((item) => Number(item.precip || 0) >= 0.01).length,
        stations: values.length
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
      else renderHub();
    } catch (error) {
      console.error(error);
      showAccessDenied(error?.message || 'The report center could not load.');
    }
  }

  document.addEventListener('DOMContentLoaded', () => { void init(); }, { once: true });
})();

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
    { stroke: '#145f91', dash: '', width: 4 },
    { stroke: '#7a3e65', dash: '12 5', width: 3 },
    { stroke: '#2d6a4f', dash: '2 5', width: 3.5 },
    { stroke: '#9a5b13', dash: '12 4 2 4', width: 4 },
    { stroke: '#4f5d75', dash: '6 3', width: 2.5 }
  ];

  const CHART_NODE_OVERLAP_DISTANCE = 10;

  const state = {
    client: null,
    schedules: [],
    airings: [],
    rawAiringsCount: 0,
    supersededAiringsCount: 0,
    library: [],
    indexes: null,
    analysesById: new Map(),
    weatherByDate: new Map(),
    weatherLoadedSchedules: new Set(),
    selectedIds: new Set(),
    season: '',
    activeFundraiserId: '',
    loadingWeather: false,
    durationApprovals: new Set(),
    historicalStartDate: '',
    historicalEndDate: '',
    historicalSeason: 'all'
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
    if (Math.abs(numeric) >= 1000000) return `$${(numeric / 1000000).toFixed(2)}m`;
    if (Math.abs(numeric) >= 1000) return `$${(numeric / 1000).toFixed(2)}k`;
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
      return `<span><svg viewBox="0 0 36 12" aria-hidden="true"><line x1="2" y1="6" x2="34" y2="6" stroke="${style.stroke}" stroke-width="${style.width}"${style.dash ? ` stroke-dasharray="${style.dash}"` : ''}/><circle cx="18" cy="6" r="3" fill="#fff" stroke="${style.stroke}" stroke-width="2"/></svg><strong>${escapeHtml(item.label)}</strong></span>`;
    }).join('')}</div>`;
  }

  function lineChartSvg({ labels = [], series = [], ariaLabel = 'Fundraiser comparison line graph', className = '', legendTop = false, yLabel = 'Broadcast dollars', axisFormatter = compactMoney, pointFormatter = money, xLabelEvery = 1, verticalGridEvery = 0, xDisplayLabels = null } = {}) {
    if (!labels.length || !series.length) return '<div class="chart-empty">No chartable results.</div>';
    const displayLabels = Array.isArray(xDisplayLabels) && xDisplayLabels.length === labels.length ? xDisplayLabels : labels;
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
    const rotate = displayLabels.length > 8 || displayLabels.some((label) => String(label).length > 12);
    const xLabels = displayLabels.map((label, index) => {
      if (index % Math.max(1, Number(xLabelEvery || 1)) !== 0 && index !== labels.length - 1) return '';
      const xpos = x(index);
      const ypos = margin.top + plotHeight + 21;
      const labelText = escapeHtml(chartLabel(label, rotate ? 15 : 19));
      return rotate
        ? `<text x="${xpos.toFixed(1)}" y="${ypos}" text-anchor="end" transform="rotate(-38 ${xpos.toFixed(1)} ${ypos})">${labelText}</text>`
        : `<text x="${xpos.toFixed(1)}" y="${ypos}" text-anchor="middle">${labelText}</text>`;
    }).join('');
    const verticalGrid = verticalGridEvery > 0 ? labels.map((_label, index) => {
      if (index % Math.max(1, Number(verticalGridEvery)) !== 0 && index !== labels.length - 1) return '';
      const xpos = x(index);
      return `<g><line x1="${xpos.toFixed(1)}" y1="${margin.top}" x2="${xpos.toFixed(1)}" y2="${margin.top + plotHeight}" class="chart-grid-line chart-grid-line-vertical"/><line x1="${xpos.toFixed(1)}" y1="${margin.top + plotHeight}" x2="${xpos.toFixed(1)}" y2="${margin.top + plotHeight + 6}" class="chart-axis"/></g>`;
    }).join('') : '';
    const grid = yTicks.map((value) => {
      const ypos = y(value);
      return `<g><line x1="${margin.left}" y1="${ypos.toFixed(1)}" x2="${width - margin.right}" y2="${ypos.toFixed(1)}" class="chart-grid-line"/><text x="${margin.left - 9}" y="${(ypos + 4).toFixed(1)}" text-anchor="end">${escapeHtml(axisFormatter(value))}</text></g>`;
    }).join('');
    const interactivePoints = series.flatMap((item, seriesIndex) => (item.values || []).map((value, index) => {
      const tooltip = item.tooltips?.[index] || null;
      if (!tooltip || value === null || value === undefined || !Number.isFinite(Number(value))) return null;
      return { seriesIndex, index, x: x(index), y: y(value), tooltip };
    }).filter(Boolean));
    const tooltipForPoint = (seriesIndex, index, tooltip) => {
      if (!tooltip) return null;
      const point = interactivePoints.find((candidate) => candidate.seriesIndex === seriesIndex && candidate.index === index);
      if (!point) return tooltip;
      const touching = interactivePoints.filter((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= CHART_NODE_OVERLAP_DISTANCE);
      return touching.length > 1 ? { sections: touching.map((candidate) => candidate.tooltip) } : tooltip;
    };
    const plotted = series.map((item, seriesIndex) => {
      const style = item.style || CHART_STYLES[seriesIndex % CHART_STYLES.length];
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
      const paths = segments.map((points) => `<polyline points="${points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}" fill="none" stroke="${style.stroke}" stroke-width="${style.width}" stroke-linejoin="round" stroke-linecap="round"${style.dash ? ` stroke-dasharray="${style.dash}"` : ''}/>`).join('');
      const points = values.map((value, index) => {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return '';
        const tooltip = tooltipForPoint(seriesIndex, index, item.tooltips?.[index] || null);
        const title = `${item.label} · ${labels[index]}: ${pointFormatter(value)}`;
        if (!tooltip) return `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="4" fill="#fff" stroke="${style.stroke}" stroke-width="2"><title>${escapeHtml(title)}</title></circle>`;
        const payload = encodeURIComponent(JSON.stringify(tooltip));
        return `<g class="chart-node" tabindex="0" role="button" aria-label="${escapeHtml(title)}. Hover or focus for program titles." data-chart-tooltip="${escapeHtml(payload)}"><circle class="chart-node-hit" cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="11"/><circle class="chart-node-marker" cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="4" fill="#fff" stroke="${style.stroke}" stroke-width="2"/></g>`;
      }).join('');
      return `${paths}${points}`;
    }).join('');
    const legend = chartLegend(series);
    const svg = `<svg class="report-line-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(ariaLabel)}"><line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" class="chart-axis"/><line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" class="chart-axis"/>${grid}${verticalGrid}${plotted}${xLabels}<text x="18" y="${margin.top + (plotHeight / 2)}" transform="rotate(-90 18 ${margin.top + (plotHeight / 2)})" text-anchor="middle" class="chart-axis-title">${escapeHtml(yLabel)}</text></svg>`;
    return `<div class="report-chart ${escapeHtml(className)}">${legendTop ? legend : ''}${svg}${legendTop ? '' : legend}</div>`;
  }


  function barChartSvg({ labels = [], series = [], ariaLabel = 'Fundraiser bar graph', className = '', yLabel = 'Broadcast $ / pledge hour', axisFormatter = compactMoney, pointFormatter = money } = {}) {
    if (!labels.length || !series.length) return '<div class="chart-empty">No chartable results.</div>';
    const width = 760;
    const height = 310;
    const margin = { left: 72, right: 18, top: 28, bottom: labels.length > 6 ? 92 : 66 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const cleanSeries = series.map((item) => ({ ...item, values: (item.values || []).map((value) => value === null || value === undefined || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null)) }));
    const { max, step } = chartScale(cleanSeries);
    const tickCount = Math.max(1, Math.round(max / step));
    const yTicks = Array.from({ length: tickCount + 1 }, (_item, index) => index * step);
    const y = (value) => margin.top + plotHeight - ((Math.max(0, Number(value || 0)) / max) * plotHeight);
    const groupWidth = plotWidth / Math.max(1, labels.length);
    const innerWidth = Math.max(8, groupWidth * 0.74);
    const barGap = 2;
    const barWidth = Math.max(3, (innerWidth - (barGap * Math.max(0, cleanSeries.length - 1))) / Math.max(1, cleanSeries.length));
    const rotate = labels.length > 6 || labels.some((label) => String(label).length > 11);
    const grid = yTicks.map((value) => {
      const ypos = y(value);
      return `<g><line x1="${margin.left}" y1="${ypos.toFixed(1)}" x2="${width - margin.right}" y2="${ypos.toFixed(1)}" class="chart-grid-line"/><text x="${margin.left - 9}" y="${(ypos + 4).toFixed(1)}" text-anchor="end">${escapeHtml(axisFormatter(value))}</text></g>`;
    }).join('');
    const bars = cleanSeries.map((item, seriesIndex) => {
      const style = CHART_STYLES[seriesIndex % CHART_STYLES.length];
      return item.values.map((value, index) => {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return '';
        const x = margin.left + (index * groupWidth) + ((groupWidth - innerWidth) / 2) + (seriesIndex * (barWidth + barGap));
        const ypos = y(value);
        const h = Math.max(0, (margin.top + plotHeight) - ypos);
        const title = `${item.label} · ${labels[index]}: ${pointFormatter(value)}`;
        return `<rect x="${x.toFixed(1)}" y="${ypos.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="none" stroke="${style.stroke}" stroke-width="${Math.max(2, style.width - 1)}"><title>${escapeHtml(title)}</title></rect>`;
      }).join('');
    }).join('');
    const xLabels = labels.map((label, index) => {
      const xpos = margin.left + (index * groupWidth) + (groupWidth / 2);
      const ypos = margin.top + plotHeight + 22;
      const value = escapeHtml(chartLabel(label, rotate ? 16 : 20));
      return rotate
        ? `<text x="${xpos.toFixed(1)}" y="${ypos}" text-anchor="end" transform="rotate(-38 ${xpos.toFixed(1)} ${ypos})">${value}</text>`
        : `<text x="${xpos.toFixed(1)}" y="${ypos}" text-anchor="middle">${value}</text>`;
    }).join('');
    const legend = cleanSeries.length > 1 ? chartLegend(cleanSeries) : '';
    const svg = `<svg class="report-line-chart-svg report-bar-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(ariaLabel)}"><line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" class="chart-axis"/><line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" class="chart-axis"/>${grid}${bars}${xLabels}<text x="18" y="${margin.top + (plotHeight / 2)}" transform="rotate(-90 18 ${margin.top + (plotHeight / 2)})" text-anchor="middle" class="chart-axis-title">${escapeHtml(yLabel)}</text></svg>`;
    return `<div class="report-chart ${escapeHtml(className)}">${svg}${legend}</div>`;
  }

  function chartTooltipElement() {
    let tooltip = document.getElementById('chart-hover-tooltip');
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.id = 'chart-hover-tooltip';
    tooltip.className = 'chart-hover-tooltip hidden';
    tooltip.setAttribute('role', 'status');
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function positionChartTooltip(tooltip, clientX, clientY) {
    const gap = 14;
    const pad = 10;
    tooltip.style.left = `${clientX + gap}px`;
    tooltip.style.top = `${clientY + gap}px`;
    const rect = tooltip.getBoundingClientRect();
    let left = clientX + gap;
    let top = clientY + gap;
    if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, clientX - rect.width - gap);
    if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, clientY - rect.height - gap);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function showChartTooltip(node, clientX, clientY) {
    const encoded = node?.getAttribute('data-chart-tooltip') || '';
    if (!encoded) return;
    let payload;
    try {
      payload = JSON.parse(decodeURIComponent(encoded));
    } catch (_error) {
      return;
    }
    const tooltip = chartTooltipElement();
    const renderSection = (section = {}) => {
      const lines = Array.isArray(section.lines) ? section.lines.filter(Boolean) : [];
      return `<div class="chart-tooltip-section"><strong>${escapeHtml(section.title || '')}</strong>${section.detail ? `<span>${escapeHtml(section.detail)}</span>` : ''}${lines.length ? `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '<em>No program titles recorded for this day.</em>'}</div>`;
    };
    const sections = Array.isArray(payload.sections) ? payload.sections.filter(Boolean) : [];
    tooltip.innerHTML = (sections.length ? sections : [payload]).map(renderSection).join(sections.length > 1 ? '<hr aria-hidden="true">' : '');
    tooltip.classList.remove('hidden');
    positionChartTooltip(tooltip, clientX, clientY);
  }

  function hideChartTooltip() {
    document.getElementById('chart-hover-tooltip')?.classList.add('hidden');
  }

  function bindChartTooltips(root = document) {
    $$('.chart-node[data-chart-tooltip]', root).forEach((node) => {
      if (node.dataset.tooltipBound === 'true') return;
      node.dataset.tooltipBound = 'true';
      node.addEventListener('mouseenter', (event) => showChartTooltip(node, event.clientX, event.clientY));
      node.addEventListener('mousemove', (event) => positionChartTooltip(chartTooltipElement(), event.clientX, event.clientY));
      node.addEventListener('mouseleave', hideChartTooltip);
      node.addEventListener('focus', () => {
        const rect = node.getBoundingClientRect();
        showChartTooltip(node, rect.left + (rect.width / 2), rect.top + (rect.height / 2));
      });
      node.addEventListener('blur', hideChartTooltip);
    });
  }

  function incomeBarChartSvg(days = []) {
    if (!days.length) return '<div class="chart-empty">No daily results.</div>';
    const width = 760;
    const height = 304;
    const margin = { left: 70, right: 18, top: 26, bottom: 92 };
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
      const weather = weatherParts(day);
      return `<g><rect x="${xpos.toFixed(1)}" y="${ypos.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2" fill="#3d789d"><title>${escapeHtml(formatDate(day.date))}: ${escapeHtml(money(dollars))}</title></rect><text x="${center.toFixed(1)}" y="${Math.max(14, ypos - 7).toFixed(1)}" text-anchor="middle" class="chart-value-label">${escapeHtml(compactMoney(dollars))}</text><text x="${center.toFixed(1)}" y="${margin.top + plotHeight + 20}" text-anchor="middle">${escapeHtml(formatDate(day.date, false))}</text><text x="${center.toFixed(1)}" y="${margin.top + plotHeight + 36}" text-anchor="middle" class="chart-secondary-label">${escapeHtml(String(day.weekday || '').slice(0, 3))}</text><text x="${center.toFixed(1)}" y="${margin.top + plotHeight + 52}" text-anchor="middle" class="chart-secondary-label chart-weather-label chart-weather-temp">${escapeHtml(weather.temp)}</text><text x="${center.toFixed(1)}" y="${margin.top + plotHeight + 68}" text-anchor="middle" class="chart-secondary-label chart-weather-label chart-weather-precip">${escapeHtml(weather.precip)}</text></g>`;
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
    state.schedules = A.prepareSchedules(scheduleRows.map(A.normalizeSchedule)).filter((schedule) => schedule.startDate && schedule.endDate && schedule.year);
    const canonicalAirings = A.canonicalizeImportedAirings ? A.canonicalizeImportedAirings(airings) : airings;
    state.rawAiringsCount = airings.length;
    state.supersededAiringsCount = Math.max(0, airings.length - canonicalAirings.length);
    state.airings = canonicalAirings;
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
    const titles = [...new Set(summary.missing.map((item) => A.text(item.title)).filter(Boolean))];
    const visible = titles.slice(0, 8);
    const extra = Math.max(0, titles.length - visible.length);
    const affected = visible.length
      ? ` Affected title${titles.length === 1 ? '' : 's'}: ${visible.join(', ')}${extra ? `, plus ${extra} more` : ''}.`
      : '';
    return `${summary.airings} program airing${summary.airings === 1 ? '' : 's'} lack both a usable saved schedule length and a reliable Program Library runtime.${affected} Their Broadcast dollars and pledges remain in factual totals, but those airings are excluded from $/hour calculations and rankings.`;
  }

  function nonSpecificRows(analysis = {}) {
    return (analysis.unmatchedImportedRows || []).filter((row) => rowIsNonSpecific(row));
  }

  function nonSpecificSummary(analysis = {}) {
    const rows = nonSpecificRows(analysis);
    return {
      rows: rows.length,
      dollars: rows.reduce((sum, row) => sum + Number(row.dollars || 0), 0),
      pledges: rows.reduce((sum, row) => sum + Number(row.pledges || 0), 0)
    };
  }

  function unmatchedBroadcastSummary(analysis = {}) {
    const rows = (analysis.unmatchedImportedRows || []).filter((row) => !rowIsNonSpecific(row));
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
          <p>These programs have neither a usable saved schedule length nor a reliable Program Library runtime. $/hour would be misleading if the report guessed a duration.</p>
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
        <a class="report-card-link" href="reports.html?report=preflight">
          <div class="report-card-number">04</div>
          <div><h2>Data Health / Preflight</h2><p>Check report readiness, Broadcast reconciliation, durations, unmatched imports, duplicate fundraisers, topic taxonomy, source links, channel tracking, and historical sample coverage.</p></div><span>Run preflight →</span>
        </a>
      </section>`;
  }

  function seasonsAvailable() {
    const seasons = A.SEASONS.filter((season) => state.schedules.some((schedule) => schedule.season === season));
    if (state.schedules.some((schedule) => !schedule.season)) seasons.push('Special events');
    return seasons;
  }

  function scheduleHasImportedResults(schedule) {
    const analysis = analysisFor(schedule);
    return Boolean((analysis?.importedRows || []).length || Number(analysis?.broadcastDollars || 0) > 0);
  }

  function defaultReportSchedule() {
    return state.schedules.find(scheduleHasImportedResults) || state.schedules[0] || null;
  }

  function defaultSeason() {
    const latest = defaultReportSchedule();
    return latest ? (latest.season || 'Special events') : (seasonsAvailable()[0] || 'all');
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
    return state.schedules.filter((schedule) => {
      if (state.season === 'all') return true;
      if (state.season === 'Special events') return !schedule.season;
      return schedule.season === state.season;
    });
  }

  function ensureDefaultComparisonSelection() {
    const allowed = comparisonSchedules();
    const allowedIds = new Set(allowed.map((schedule) => schedule.id));
    [...state.selectedIds].forEach((id) => {
      if (!allowedIds.has(id)) state.selectedIds.delete(id);
    });
    if (state.selectedIds.size >= 2) return;
    state.selectedIds.clear();
    const completed = allowed.filter(scheduleHasImportedResults);
    const defaults = completed.length >= 2 ? completed : allowed;
    defaults.slice(0, Math.min(3, defaults.length)).forEach((schedule) => state.selectedIds.add(schedule.id));
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
    return A.dollarsPerHour(analysis.broadcastDollars, analysis.scheduledMinutes);
  }

  function pledgeRateForAnalysis(analysis) {
    return A.pledgesPerHour(analysis.pledges, analysis.scheduledMinutes);
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

  function weatherParts(day) {
    if (!day) return { temp: '', precip: '' };
    const weather = weatherForDay(day.dateKey);
    if (!weather) return { temp: '—', precip: '—' };
    return {
      temp: Number.isFinite(weather.avgTemp) ? `${Math.round(weather.avgTemp)}°F` : '—',
      precip: Number.isFinite(weather.precip) ? `${weather.precip.toFixed(weather.precip < 0.1 ? 2 : 1)} in` : '—'
    };
  }

  function weatherLine(day) {
    const weather = weatherParts(day);
    if (!(weather.temp || weather.precip)) return '';
    return `${weather.temp} · ${weather.precip}`;
  }

  function programResultsForFundraiserDay(analysis, day) {
    const dateKey = A.text(day?.dateKey || '');
    if (!dateKey) return [];
    const groups = new Map();
    [...(analysis?.placementRows || [])]
      .filter((row) => A.text(row.dateKey) === dateKey && !rowIsNonSpecific(row))
      .sort((a, b) => Number(a.startMinutes ?? 99999) - Number(b.startMinutes ?? 99999))
      .forEach((row) => {
        const title = A.text(row.title || row.plannedTitle || '');
        const key = title.toLowerCase();
        if (!key) return;
        if (!groups.has(key)) groups.set(key, { title, dollars: 0, known: false });
        const item = groups.get(key);
        if (row.known) {
          item.known = true;
          item.dollars += Number(row.dollars || 0);
        }
      });
    return [...groups.values()];
  }

  function dailyComparisonChart(analyses, aligned) {
    return lineChartSvg({
      labels: aligned.map((entry) => entry.label.title),
      series: analyses.map((analysis, analysisIndex) => ({
        label: analysis.schedule.title,
        values: aligned.map((entry) => entry.days?.[analysisIndex] ? Number(entry.days[analysisIndex].dollars || 0) : null),
        tooltips: aligned.map((entry) => {
          const day = entry.days?.[analysisIndex] || null;
          if (!day) return null;
          return {
            title: `${formatDate(day.date)} · ${entry.label.title}`,
            detail: `${money(day.dollars)} Broadcast · Regional ${weatherLine(day)}`,
            lines: programResultsForFundraiserDay(analysis, day).map((item) => item.known
              ? `${item.title} — ${money(item.dollars)}`
              : `${item.title} — result unavailable`)
          };
        })
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
        values: rows.map((row) => row.isNonSpecific
          ? Number(row.values?.[analysisIndex]?.dollars || 0)
          : (Number(row.values?.[analysisIndex]?.scheduled || 0) > 0 ? Number(row.values[analysisIndex].dollars || 0) : 0))
      })),
      ariaLabel: 'Broadcast dollars by topic and non-specific giving across selected fundraisers',
      className: 'topic-comparison-chart'
    });
  }

  function topicIncomeDenominator(analysis = {}) {
    const topicDollars = [...(analysis.topics?.values?.() || [])].reduce((sum, item) => sum + Number(item.dollars || 0), 0);
    return topicDollars + Number(nonSpecificSummary(analysis).dollars || 0);
  }

  function comparisonTopicMatrix(analyses) {
    const rows = A.topicComparisonRows(analyses);
    const nonSpecific = {
      key: 'Non-Specific Pledges',
      isNonSpecific: true,
      values: analyses.map((analysis) => {
        const summary = nonSpecificSummary(analysis);
        return { dollars: summary.dollars, pledges: summary.pledges, rows: summary.rows, scheduled: 0, minutes: 0, rateMinutes: 0, share: 0 };
      })
    };
    if (nonSpecific.values.some((value) => Number(value.dollars || 0) > 0 || Number(value.pledges || 0) > 0 || Number(value.rows || 0) > 0)) rows.push(nonSpecific);
    const head = analyses.map((analysis) => `<th>${fundraiserColumnHeading(analysis)}</th>`).join('');
    const recurringKeys = recurringProgramKeys(analyses);
    const body = rows.map((row) => `
      <tr>
        <th class="topic-label"><strong>${escapeHtml(row.key)}</strong></th>
        ${row.values.map((value, analysisIndex) => {
          const analysis = analyses[analysisIndex];
          const incomeBase = topicIncomeDenominator(analysis);
          const incomeShare = incomeBase > 0 ? Math.max(0, Math.min(100, (Number(value.dollars || 0) / incomeBase) * 100)) : 0;
          if (row.isNonSpecific) {
            if (!(Number(value.rows || 0) > 0 || Number(value.dollars || 0) > 0 || Number(value.pledges || 0) > 0)) return '<td class="muted-cell">—</td>';
            return `<td class="topic-cell non-specific-topic"><div class="topic-performance-line"><strong>Not applicable</strong><span>Hours N/A</span><span>Income ${incomeShare.toFixed(0)}%</span></div><small>${escapeHtml(money(value.dollars))} · ${escapeHtml(count(value.pledges))} pledges · not tied to a specific program</small></td>`;
          }
          if (!(Number(value.scheduled || 0) > 0)) return '<td class="muted-cell">—</td>';
          const hoursShare = Math.max(0, Math.min(100, Number(value.share || 0) * 100));
          const programs = topicProgramMarkup(analysis, row.key, recurringKeys);
          const rateBase = rateBaseSuffix(value.rateMinutes, value.minutes);
          return `<td class="topic-cell"><div class="topic-performance-line"><strong>${escapeHtml(money(value.dollarsPerHour))}/hr</strong><span>Hours ${hoursShare.toFixed(0)}%</span><span>Income ${incomeShare.toFixed(0)}%</span></div><small>${escapeHtml(hours(value.minutes))}${escapeHtml(rateBase)} · ${escapeHtml(money(value.dollars))} · ${escapeHtml(count(value.pledges))} pledges · ${escapeHtml(count(value.scheduled))} airings</small>${programs ? `<small class="topic-programs">${programs}</small>` : ''}</td>`;
        }).join('')}
      </tr>`).join('');
    const durationCopy = analyses.some((analysis) => meaningfulMissingDurationRows(analysis).length)
      ? 'Programs excluded from $/hour because duration is unavailable are named in the Duration coverage note above. '
      : '';
    return `<section class="sheet-section topic-matrix"><div class="section-heading"><div><h2>Topic airtime & performance</h2><p>${durationCopy}Non-Specific Pledges are shown as their own giving category; because those donations are not tied to a program, airtime and $/hour are not applicable. Income % includes Non-Specific Pledges in the giving-category denominator. Programs shown in bold aired in two or more selected fundraisers.</p></div></div>${topicComparisonChart(analyses, rows)}<div class="table-scroll"><table><thead><tr><th>Topic / giving category</th>${head}</tr></thead><tbody>${body || '<tr><td>No topic data.</td></tr>'}</tbody></table></div></section>`;
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
    const render = () => `<article class="one-sheet comparison-sheet">${comparisonHeader(analyses)}${durationNoticeSection(analyses)}${metricMatrix(analyses)}${dailyMatrix(analyses)}${comparisonTopicMatrix(analyses)}<footer class="sheet-footer">Whole-fundraiser Broadcast $/pledge hour uses all Broadcast dollars over saved pledge hours. Program/topic $/hour excludes unknown results and airings with missing duration from both numerator and denominator; Non-Specific Pledges are also excluded from program/topic attribution but remain in factual Broadcast totals. Rate-eligible hours show the program-attributed denominator. Online and Mail are included only in the comparable-total row when tracked for every selected fundraiser. Regional weather averages available Ironwood, Houghton, Marquette, Escanaba, and Sault Ste. Marie observations during each pledge window.</footer></article>`;
    $('#report-output').innerHTML = render();
    bindChartTooltips($('#report-output'));
    await ensureWeatherForAnalyses(analyses);
    $('#report-output').innerHTML = render();
    bindChartTooltips($('#report-output'));
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
        <div><span>Broadcast $ / pledge hour</span><strong>${escapeHtml(money(rateForAnalysis(analysis)))}</strong></div>
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

  function fundraiserAirSchedule(analysis) {
  const rows = [...(analysis?.placementRows || [])]
    .filter((row) => A.text(row?.dateKey) && !rowIsNonSpecific(row))
    .sort((a, b) => A.text(a.dateKey).localeCompare(A.text(b.dateKey)) || Number(a.startMinutes || 0) - Number(b.startMinutes || 0));
  const body = rows.map((row) => {
    const title = A.text(row.title || row.plannedTitle || 'Untitled program');
    const known = Boolean(row.known);
    return `<tr><td>${escapeHtml(formatDate(row.dateKey))}</td><th class="program-result-title">${escapeHtml(title)}</th><td>${escapeHtml(formatTime(row.startMinutes))}</td><td>${known ? escapeHtml(count(row.pledges)) : '<span class="muted-cell">—</span>'}</td><td class="${known ? 'metric-primary' : 'muted-cell'}">${known ? escapeHtml(money(row.dollars)) : '—'}</td></tr>`;
  }).join('');
  return `<section class="sheet-section fundraiser-air-schedule"><div class="section-heading"><div><h2>Airing schedule & results</h2><p>Date, title, start time, pledges, and Broadcast income for each program airing.</p></div></div><div class="table-scroll"><table><thead><tr><th>Date</th><th>Title</th><th>Start time</th><th>Pledges</th><th>Income</th></tr></thead><tbody>${body || '<tr><td colspan="5">No program airings are recorded for this fundraiser.</td></tr>'}</tbody></table></div></section>`;
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
    const rows = A.programResultsRows(analysis).filter((row) => !isNonSpecificLabel(row.title) && !isNonSpecificLabel(row.topic));
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
    const nonSpecific = nonSpecificSummary(analysis);
    const totalTopicIncome = rows.reduce((sum, item) => sum + Number(item.value.dollars || 0), 0) + Number(nonSpecific.dollars || 0);
    const topicBody = rows.map(({ row, value }) => {
      const incomeShare = totalTopicIncome > 0 ? Number(value.dollars || 0) / totalTopicIncome : 0;
      const programs = topicProgramMarkup(analysis, row.key);
      const rateBase = rateBaseSuffix(value.rateMinutes, value.minutes);
      return `<tr><th>${escapeHtml(row.key)}</th><td><strong>${escapeHtml(money(value.dollars))} / ${escapeHtml(money(value.dollarsPerHour))}/hr / ${escapeHtml(percent(incomeShare))} income</strong><span>${escapeHtml(hours(value.minutes))}${escapeHtml(rateBase)} / ${escapeHtml(percent(value.share))} / ${escapeHtml(count(value.scheduled))} airings</span>${programs ? `<small class="topic-programs">${programs}</small>` : ''}</td></tr>`;
    }).join('');
    const nonSpecificBody = nonSpecific.rows || nonSpecific.dollars || nonSpecific.pledges
      ? `<tr class="non-specific-topic"><th>Non-Specific Pledges</th><td><strong>${escapeHtml(money(nonSpecific.dollars))} / ${escapeHtml(percent(totalTopicIncome > 0 ? nonSpecific.dollars / totalTopicIncome : 0))} income</strong><span>No program airtime · $/hour N/A · ${escapeHtml(count(nonSpecific.pledges))} pledges</span></td></tr>`
      : '';
    const body = `${topicBody}${nonSpecificBody}`;
    return `<section class="sheet-section topic-summary"><div class="section-heading"><div><h2>Topic airtime & performance</h2><p>Program topics are ranked by Broadcast $/hour. Non-Specific Pledges appear as a separate giving category with no program airtime or $/hour.</p></div></div><div class="table-scroll"><table><thead><tr><th>Topic / giving category</th><th>Fundraiser result</th></tr></thead><tbody>${body || '<tr><td colspan="2">No topic data.</td></tr>'}</tbody></table></div></section>`;
  }

  function fiscalYearToDateSection(analysis, history = []) {
    const asOf = A.parseDate(analysis?.schedule?.endDate || analysis?.schedule?.startDate);
    if (!asOf) return '';
    const calendarYear = asOf.getFullYear();
    const fiscalStartYear = asOf.getMonth() >= 6 ? calendarYear : calendarYear - 1;
    const fiscalEndYear = fiscalStartYear + 1;
    const fiscalStart = `${fiscalStartYear}-07-01`;
    const asOfKey = A.dateKey ? A.dateKey(asOf) : `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}-${String(asOf.getDate()).padStart(2, '0')}`;
    const included = history.filter((item) => {
      const start = A.text(item.schedule?.startDate || '');
      const end = A.text(item.schedule?.endDate || start);
      return start && end && end >= fiscalStart && start <= asOfKey && end <= asOfKey;
    });
    if (!included.length) return '';
    const broadcast = included.reduce((sum, item) => sum + Number(item.broadcastDollars || 0), 0);
    const pledges = included.reduce((sum, item) => sum + Number(item.pledges || 0), 0);
    const minutes = included.reduce((sum, item) => sum + Number(item.scheduledMinutes || 0), 0);
    const rate = minutes > 0 ? A.dollarsPerHour(broadcast, minutes) : 0;
    const pledgeRate = minutes > 0 ? A.pledgesPerHour(pledges, minutes) : 0;
    const gift = pledges > 0 ? A.dollarsPerPledge(broadcast, pledges) : 0;
    const topics = rankingRows(included, 'topic', { minAirings: 1, minFundraisers: 1, minTitles: 1 }).slice(0, 3);
    return `<section class="sheet-section fiscal-ytd"><div class="section-heading"><div><h2>Fiscal Year to Date | FY${escapeHtml(fiscalEndYear)}</h2><p>${escapeHtml(formatDate(fiscalStart))} through ${escapeHtml(formatDate(asOfKey))}. Only completed factual fundraiser results through the selected fundraiser are included.</p></div></div>
      <section class="fundraiser-kpis fiscal-ytd-kpis">
        <div><span>Fundraisers</span><strong>${escapeHtml(count(included.length))}</strong></div>
        <div><span>Broadcast $</span><strong>${escapeHtml(money(broadcast))}</strong></div>
        <div><span>Pledge hours</span><strong>${escapeHtml(hours(minutes))}</strong></div>
        <div><span>Broadcast $ / pledge hour</span><strong>${escapeHtml(money(rate))}</strong></div>
        <div><span>Pledges</span><strong>${escapeHtml(count(pledges))}</strong></div>
        <div><span>Pledges / hour</span><strong>${escapeHtml(count(pledgeRate, 2))}</strong></div>
        <div><span>$ / pledge</span><strong>${escapeHtml(money(gift))}</strong></div>
      </section>
      ${topics.length ? `<p class="fiscal-ytd-note"><strong>Leading YTD topics by fundraiser-balanced $/hour:</strong> ${topics.map((row) => `${escapeHtml(row.key)} ${escapeHtml(money(row.medianDollarsPerHour))}/hr`).join(' · ')}</p>` : ''}
    </section>`;
  }

  async function renderFundraiserReport() {
    const schedule = state.schedules.find((item) => item.id === state.activeFundraiserId) || defaultReportSchedule();
    if (!schedule) {
      $('#report-output').innerHTML = '<div class="report-empty">No saved fundraisers are available.</div>';
      return;
    }
    state.activeFundraiserId = schedule.id;
    const analysis = analysisFor(schedule);
    if (!(await ensureDurationDecision([analysis]))) return;
    const history = allHistoricalAnalyses();
    const render = () => `<article class="one-sheet fundraiser-sheet">${fundraiserSummary(analysis)}${durationNoticeSection([analysis])}${fundraiserVisualOverview(analysis, history)}${fundraiserHistoricalContext(analysis, history)}${fiscalYearToDateSection(analysis, history)}${fundraiserAirSchedule(analysis)}${fundraiserDailyTable(analysis)}${programResultsTable(analysis)}${singleTopicSummary(analysis)}<footer class="sheet-footer">Program, daily, and topic $/hour use only observations with known results and valid duration; the displayed rate base identifies the denominator when it differs from scheduled pledge hours. Historical context uses fundraiser-balanced comparisons and excludes the selected fundraiser from its baseline when prior history is available. Fiscal YTD uses the July 1–June 30 WNMU fiscal calendar and includes only completed factual results through the selected fundraiser. Non-Specific Pledges are not treated as incomplete program/topic data. Start-time performance is reserved for historical analytics where sufficient sample size can be required. Regional weather averages available Ironwood, Houghton, Marquette, Escanaba, and Sault Ste. Marie observations during each pledge window.</footer></article>`;
    $('#report-output').innerHTML = render();
    bindChartTooltips($('#report-output'));
    await ensureWeatherForAnalyses([analysis]);
    $('#report-output').innerHTML = render();
    bindChartTooltips($('#report-output'));
  }

  async function initFundraiser() {
    document.title = 'WNMU Fundraiser Performance Summary';
    $('#report-page-title').textContent = 'Fundraiser Performance Summary';
    $('#report-page-subtitle').textContent = 'One fundraiser, from first pledge hour to last';
    state.activeFundraiserId = defaultReportSchedule()?.id || '';
    renderFundraiserControls();
    await renderFundraiserReport();
  }

  function allHistoricalAnalyses() {
    return state.schedules.filter(scheduleHasImportedResults).map(analysisFor).filter(Boolean);
  }

  function historicalDateBounds() {
    const analyses = allHistoricalAnalyses();
    const starts = analyses.map((analysis) => A.text(analysis.schedule?.startDate || '')).filter(Boolean).sort();
    const ends = analyses.map((analysis) => A.text(analysis.schedule?.endDate || analysis.schedule?.startDate || '')).filter(Boolean).sort();
    return { min: starts[0] || '', max: ends.slice(-1)[0] || '' };
  }

  function setHistoricalRange(startDate = '', endDate = '') {
    const bounds = historicalDateBounds();
    state.historicalStartDate = A.text(startDate || bounds.min);
    state.historicalEndDate = A.text(endDate || bounds.max);
    const start = $('#historical-start-date');
    const end = $('#historical-end-date');
    if (start) start.value = state.historicalStartDate;
    if (end) end.value = state.historicalEndDate;
    void renderHistoricalReport();
  }

  function historicalControls() {
    const bounds = historicalDateBounds();
    if (!state.historicalStartDate) state.historicalStartDate = bounds.min;
    if (!state.historicalEndDate) state.historicalEndDate = bounds.max;
    const currentYear = A.parseDate(bounds.max)?.getFullYear() || new Date().getFullYear();
    const fiveYearStart = `${Math.max(1900, currentYear - 4)}-01-01`;
    const seasonOptions = ['all', ...HISTORICAL_SEASONS].map((season) => `<option value="${escapeHtml(season)}" ${state.historicalSeason === season ? 'selected' : ''}>${season === 'all' ? 'All seasons' : escapeHtml(season)}</option>`).join('');
    $('#report-controls').innerHTML = `<div class="report-control-row historical-range-controls">
      <div class="historical-control-copy"><strong>Historical analysis range</strong><span>Every chart, median, and evidence threshold is recalculated from only the selected dates and season.</span></div>
      <label class="report-field"><span>Start date</span><input type="date" id="historical-start-date" min="${escapeHtml(bounds.min)}" max="${escapeHtml(bounds.max)}" value="${escapeHtml(state.historicalStartDate)}"></label>
      <label class="report-field"><span>End date</span><input type="date" id="historical-end-date" min="${escapeHtml(bounds.min)}" max="${escapeHtml(bounds.max)}" value="${escapeHtml(state.historicalEndDate)}"></label>
      <label class="report-field"><span>Season</span><select id="historical-season">${seasonOptions}</select></label>
      <div class="historical-range-presets">
        <button type="button" class="report-button" data-history-range="all">All history</button>
        <button type="button" class="report-button" data-history-range="five">Last 5 years</button>
        <button type="button" class="report-button" data-history-range="pre">Pre-COVID</button>
        <button type="button" class="report-button" data-history-range="post">Post-COVID</button>
      </div>
      <button type="button" class="report-button" id="report-print">Print report</button>
    </div>`;
    $('#historical-start-date')?.addEventListener('change', (event) => { state.historicalStartDate = event.target.value || bounds.min; void renderHistoricalReport(); });
    $('#historical-end-date')?.addEventListener('change', (event) => { state.historicalEndDate = event.target.value || bounds.max; void renderHistoricalReport(); });
    $('#historical-season')?.addEventListener('change', (event) => { state.historicalSeason = event.target.value || 'all'; void renderHistoricalReport(); });
    $$('[data-history-range]').forEach((button) => button.addEventListener('click', () => {
      const preset = button.dataset.historyRange;
      if (preset === 'all') setHistoricalRange(bounds.min, bounds.max);
      else if (preset === 'five') setHistoricalRange(fiveYearStart < bounds.min ? bounds.min : fiveYearStart, bounds.max);
      else if (preset === 'pre') setHistoricalRange(bounds.min, '2019-12-31' < bounds.max ? '2019-12-31' : bounds.max);
      else if (preset === 'post') setHistoricalRange('2022-01-01' > bounds.min ? '2022-01-01' : bounds.min, bounds.max);
    }));
    $('#report-print')?.addEventListener('click', () => window.print());
  }

  function historicalAnalyses() {
    const start = A.text(state.historicalStartDate || '');
    const end = A.text(state.historicalEndDate || '');
    const season = A.text(state.historicalSeason || 'all');
    return allHistoricalAnalyses().filter((analysis) => {
      const scheduleStart = A.text(analysis.schedule?.startDate || '');
      const scheduleEnd = A.text(analysis.schedule?.endDate || scheduleStart);
      const inDateRange = (!start || scheduleEnd >= start) && (!end || scheduleStart <= end);
      const inSeason = season === 'all' || historicalSeasonBucket(analysis) === season;
      return inDateRange && inSeason;
    });
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
    const medianHeading = 'Median fundraiser $/hr';
    const averageHeading = 'Avg fundraiser $/hr';
    const body = rows.map((row) => `<tr><th>${escapeHtml(historicalKeyLabel(dimension, row.key))}</th><td class="metric-primary">${escapeHtml(money(row.medianDollarsPerHour))}/hr</td><td>${escapeHtml(money(row.averageDollarsPerHour))}/hr</td><td>${escapeHtml(money(row.broadcastDollars))}</td><td>${escapeHtml(count(row.rateAirings))}</td><td>${escapeHtml(count(row.fundraisers))}</td><td>${escapeHtml(count(row.titles))}</td></tr>`).join('');
    return `<section class="sheet-section historical-ranking"><div class="section-heading"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div></div><div class="table-scroll"><table><thead><tr><th>Group</th><th>${escapeHtml(medianHeading)}</th><th>${escapeHtml(averageHeading)}</th><th>Broadcast $</th><th>Rate airings</th><th>Fundraisers</th><th>Titles</th></tr></thead><tbody>${body || '<tr><td colspan="7">No categories meet the evidence threshold.</td></tr>'}</tbody></table></div></section>`;
  }

  function historicalSeasonTable(analyses) {
    return historicalRankingTable(
      analyses,
      'season',
      'Performance by fundraiser season',
      'Each fundraiser contributes one $/pledge-hour observation. Median and average therefore describe the typical fundraiser in that season, not the typical individual program airing.',
      { minAirings: 1, minFundraisers: 1, minTitles: 1, rateUnit: 'fundraiser' }
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
    const description = (weekpart) => `Only schedule-reconciled ${weekpart.toLowerCase()} 30-minute start slots with at least 5 rate-valid airings, 3 fundraisers, and 3 distinct titles are shown. Each fundraiser contributes one slot-specific $/hour observation regardless of how many times that start slot occurred. Unmatched imported results remain in fundraiser totals but are excluded from performance rankings. Sparse slots are excluded rather than displayed in the ranking.`;
    return [
      historicalRankingTable(analysesForWeekpart(analyses, 'Weekday'), 'startTime', 'Weekday start-time performance', description('Weekday')),
      historicalRankingTable(analysesForWeekpart(analyses, 'Saturday'), 'startTime', 'Saturday start-time performance', description('Saturday')),
      historicalRankingTable(analysesForWeekpart(analyses, 'Sunday'), 'startTime', 'Sunday start-time performance', description('Sunday'))
    ].join('');
  }


  function medianNumber(values = []) {
    const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function percentileForValue(values = [], target = 0) {
    const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length || !Number.isFinite(Number(target))) return null;
    const below = sorted.filter((value) => value < Number(target)).length;
    const equal = sorted.filter((value) => value === Number(target)).length;
    return Math.round(((below + (equal * 0.5)) / sorted.length) * 100);
  }

  function chronologicalAnalyses(analyses = []) {
    return [...analyses].sort((a, b) => A.text(a.schedule?.startDate || '').localeCompare(A.text(b.schedule?.startDate || '')) || A.text(a.schedule?.title || '').localeCompare(A.text(b.schedule?.title || '')));
  }

  const HISTORICAL_SEASONS = ['March', 'June', 'August', 'December', 'Special'];

  function historicalSeasonBucket(value = {}) {
    const schedule = value?.schedule || value || {};
    const season = A.text(schedule?.season || '');
    return ['March', 'June', 'August', 'December'].includes(season) ? season : 'Special';
  }

  function analysisTrendLabel(analysis) {
    const season = historicalSeasonBucket(analysis);
    const year = Number(analysis?.schedule?.year || 0) || A.parseDate(analysis?.schedule?.startDate)?.getFullYear() || '';
    return `${season} ${year}`.trim();
  }

  function compactTrendAxisLabel(analysis) {
    const season = historicalSeasonBucket(analysis);
    const year = Number(analysis?.schedule?.year || 0) || A.parseDate(analysis?.schedule?.startDate)?.getFullYear() || '';
    const shortYear = year ? `'${String(year).slice(-2)}` : '';
    if (season === 'March') return `March ${year}`.trim();
    if (season === 'June') return `J ${shortYear}`.trim();
    if (season === 'August') return `A ${shortYear}`.trim();
    if (season === 'December') return `D ${shortYear}`.trim();
    return `S ${shortYear}`.trim();
  }

  function fiveYearHistoryBands(analyses = []) {
    const ordered = chronologicalAnalyses(analyses);
    const years = ordered.map((analysis) => Number(analysis.schedule?.year || 0) || A.parseDate(analysis.schedule?.startDate)?.getFullYear()).filter(Number.isFinite);
    if (!years.length) return [];
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const firstStart = Math.floor(minYear / 5) * 5;
    const bands = [];
    for (let bandStart = firstStart; bandStart <= maxYear; bandStart += 5) {
      const bandEnd = bandStart + 4;
      const subset = ordered.filter((analysis) => {
        const year = Number(analysis.schedule?.year || 0) || A.parseDate(analysis.schedule?.startDate)?.getFullYear();
        return year >= bandStart && year <= bandEnd;
      });
      if (subset.length) bands.push({ start: bandStart, end: Math.min(bandEnd, maxYear), label: `${bandStart}–${Math.min(bandEnd, maxYear)}`, analyses: subset });
    }
    return bands;
  }

  function correspondingDaySeries(analyses = []) {
    const aligned = A.alignedDailyRows(analyses);
    return {
      labels: aligned.map((entry) => entry.label.title),
      values: aligned.map((entry) => {
        const values = (entry.days || []).filter(Boolean).map((day) => Number(day.dollarsPerHour)).filter(Number.isFinite);
        return values.length ? medianNumber(values) : null;
      })
    };
  }

  function historicalCorrespondingDayBandData(analyses = []) {
    const combined = correspondingDaySeries(analyses);
    const bands = fiveYearHistoryBands(analyses);
    const labels = combined.labels;
    const series = bands.map((band) => {
      const data = correspondingDaySeries(band.analyses);
      const byLabel = new Map(data.labels.map((label, index) => [label, data.values[index]]));
      return { label: band.label, values: labels.map((label) => byLabel.has(label) ? byLabel.get(label) : null) };
    });
    series.push({ label: 'All selected years', values: combined.values, style: { stroke: '#667781', dash: '5 5', width: 1.5 } });
    return { labels, series };
  }

  function currentCorrespondingDayComparisonData(analysis, historical = []) {
    const baseline = historical.filter((item) => A.text(item.schedule?.id || '') !== A.text(analysis.schedule?.id || ''));
    const combined = A.alignedDailyRows([analysis, ...baseline]);
    return {
      labels: combined.map((entry) => entry.label.title),
      current: combined.map((entry) => entry.days?.[0] ? Number(entry.days[0].dollarsPerHour) : null),
      historical: combined.map((entry) => {
        const values = (entry.days || []).slice(1).filter(Boolean).map((day) => Number(day.dollarsPerHour)).filter(Number.isFinite);
        return values.length ? medianNumber(values) : null;
      })
    };
  }

  function chartCard(title, description, chart, className = '') {
    return `<section class="visual-card ${escapeHtml(className)}"><div class="section-heading"><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div></div>${chart}</section>`;
  }

  function rateChartOptions(yLabel = 'Broadcast $ / pledge hour') {
    return {
      yLabel,
      axisFormatter: (value) => money(value),
      pointFormatter: (value) => `${money(value)}/hr`
    };
  }

  function trendSeriesForHistory(analyses, metric) {
    const ordered = chronologicalAnalyses(analyses);
    return {
      ordered,
      labels: ordered.map(analysisTrendLabel),
      axisLabels: ordered.map(compactTrendAxisLabel),
      values: ordered.map((analysis) => Number(metric(analysis) || 0))
    };
  }

  function historicalSeasonTrendData(analyses = []) {
    const ordered = chronologicalAnalyses(analyses);
    const years = [...new Set(ordered.map((analysis) => Number(analysis.schedule?.year || 0)).filter(Boolean))].sort((a, b) => a - b);
    const seasons = HISTORICAL_SEASONS.filter((season) => ordered.some((analysis) => historicalSeasonBucket(analysis) === season));
    return {
      labels: years.map(String),
      series: seasons.map((season) => ({
        label: season,
        values: years.map((year) => {
          const values = ordered.filter((analysis) => Number(analysis.schedule?.year || 0) === year && historicalSeasonBucket(analysis) === season).map(rateForAnalysis).filter((value) => Number.isFinite(Number(value)));
          return values.length ? medianNumber(values) : null;
        })
      }))
    };
  }

  function historicalCorrespondingDayData(analyses = []) {
    return correspondingDaySeries(analyses);
  }

  function rankingRows(analyses, dimension, options = {}) {
    return A.historicalRanking(analyses, dimension, options);
  }

  function rankingBarCard(analyses, dimension, title, description, options = {}, limit = 10) {
    const rows = rankingRows(analyses, dimension, options).slice(0, limit);
    return chartCard(title, description, barChartSvg({
      labels: rows.map((row) => historicalKeyLabel(dimension, row.key)),
      series: [{ label: 'Historical median', values: rows.map((row) => Number(row.medianDollarsPerHour || 0)) }],
      ariaLabel: `${title} historical median rate`,
      className: `historical-${dimension}-overview`,
      ...rateChartOptions()
    }));
  }

  function historicalStartTimeOverviewCard(analyses = []) {
    const sets = [
      ['Weekday', analysesForWeekpart(analyses, 'Weekday')],
      ['Saturday', analysesForWeekpart(analyses, 'Saturday')],
      ['Sunday', analysesForWeekpart(analyses, 'Sunday')]
    ].map(([label, subset]) => [label, rankingRows(subset, 'startTime')]);
    const keys = [...new Set(sets.flatMap(([_label, rows]) => rows.map((row) => Number(row.key)).filter(Number.isFinite)))].sort((a, b) => a - b);
    return chartCard(
      'Start-time performance',
      'Historical fundraiser-balanced median $/hour by schedule-reconciled 30-minute start slot. The detailed tables below retain the evidence counts and thresholds.',
      lineChartSvg({
        labels: keys.map(formatTime),
        series: sets.map(([label, rows]) => {
          const byKey = new Map(rows.map((row) => [Number(row.key), Number(row.medianDollarsPerHour || 0)]));
          return { label, values: keys.map((key) => byKey.has(key) ? byKey.get(key) : null) };
        }),
        ariaLabel: 'Historical start-time performance by weekday, Saturday, and Sunday',
        className: 'historical-start-time-overview',
        legendTop: true,
        ...rateChartOptions()
      })
    );
  }

  function historicalVisualOverview(analyses = []) {
    const productivity = trendSeriesForHistory(analyses, rateForAnalysis);
    const gifts = trendSeriesForHistory(analyses, (analysis) => A.dollarsPerPledge(analysis.broadcastDollars, analysis.pledges));
    const seasonal = historicalSeasonTrendData(analyses);
    const correspondingBands = historicalCorrespondingDayBandData(analyses);
    const overview = [
      chartCard('Fundraiser productivity over time', 'One observation per fundraiser. Every fundraiser keeps its own tick and vertical guide; compact season labels keep the full chronology visible.', lineChartSvg({
        labels: productivity.labels,
        xDisplayLabels: productivity.axisLabels,
        series: [{ label: 'Broadcast $ / pledge hour', values: productivity.values }],
        ariaLabel: 'Historical fundraiser productivity over time',
        className: 'historical-productivity-trend',
        xLabelEvery: 1,
        verticalGridEvery: 1,
        ...rateChartOptions()
      }), 'visual-card-wide'),
      chartCard('Average gift over time', 'Broadcast dollars per pledge by fundraiser, separating changes in gift size from changes in donor frequency. Compact labels preserve every fundraiser on the time axis.', lineChartSvg({
        labels: gifts.labels,
        xDisplayLabels: gifts.axisLabels,
        series: [{ label: '$ / pledge', values: gifts.values }],
        ariaLabel: 'Historical dollars per pledge over time',
        className: 'historical-gift-trend',
        yLabel: 'Broadcast $ / pledge',
        axisFormatter: (value) => money(value),
        pointFormatter: (value) => money(value),
        xLabelEvery: 1,
        verticalGridEvery: 1
      }), 'visual-card-wide'),
      chartCard('Season performance over time', 'March, June, August, December, and Special fundraising periods are shown across years rather than collapsed into one lifetime season ranking.', lineChartSvg({
        labels: seasonal.labels,
        series: seasonal.series,
        ariaLabel: 'Historical fundraiser season performance over time',
        className: 'historical-season-trend',
        legendTop: true,
        verticalGridEvery: 1,
        ...rateChartOptions()
      }), 'visual-card-wide'),
      chartCard('Corresponding fundraiser days by era', 'Five-year bands show how the fundraiser calendar and day-by-day productivity have changed. The thin dashed line is the combined result for the selected date range.', lineChartSvg({
        labels: correspondingBands.labels,
        series: correspondingBands.series,
        ariaLabel: 'Historical corresponding fundraiser day performance by five-year period',
        className: 'historical-corresponding-days',
        legendTop: true,
        verticalGridEvery: 1,
        ...rateChartOptions()
      }), 'visual-card-wide'),
      rankingBarCard(analyses, 'topic', 'Topic performance', 'Top historical topics by fundraiser-balanced median $/hour. Full evidence counts appear in the table below.'),
      rankingBarCard(analyses, 'subtopic', 'Subtopic performance', 'Top historical subtopics by fundraiser-balanced median $/hour. Full evidence counts appear in the table below.', {}, 10),
      historicalStartTimeOverviewCard(analyses),
      rankingBarCard(analyses, 'daypart', 'Daypart performance', 'Historical median performance by morning, afternoon, early evening, prime, and overnight.'),
      rankingBarCard(analyses, 'weekpart', 'Weekday / Saturday / Sunday', 'Historical median performance by day type.'),
      rankingBarCard(analyses, 'breakType', 'Live vs pre-recorded breaks', 'Historical median performance using saved schedule live-break flags. Live evidence is shown even when only one fundraiser currently retains the flag.', { minAirings: 1, minFundraisers: 1, minTitles: 1 }),
      rankingBarCard(analyses, 'distributor', 'Distributor performance', 'Top distributors by historical fundraiser-balanced median $/hour.', {}, 10)
    ];
    return `<section class="sheet-section visual-overview historical-visual-overview"><div class="section-heading"><div><h2>Historical patterns at a glance</h2><p>Graphs come first for quick reading. The detailed evidence tables below use the same fundraiser-balanced methodology and provide the sample sizes behind each picture.</p></div></div><div class="visual-grid">${overview.join('')}</div></section>`;
  }

  function currentTopicComparisonData(analysis, historical) {
    const current = A.topicComparisonRows([analysis])
      .map((row) => ({ key: row.key, value: row.values[0] }))
      .filter((item) => Number(item.value?.scheduled || 0) > 0 && Number(item.value?.rateMinutes || 0) > 0)
      .sort((a, b) => Number(b.value.dollarsPerHour || 0) - Number(a.value.dollarsPerHour || 0))
      .slice(0, 10);
    const historicalRows = rankingRows(historical, 'topic');
    const historicalByKey = new Map(historicalRows.map((row) => [A.lookupKey(row.key), Number(row.medianDollarsPerHour || 0)]));
    return {
      labels: current.map((item) => item.key),
      current: current.map((item) => Number(item.value.dollarsPerHour || 0)),
      historical: current.map((item) => historicalByKey.has(A.lookupKey(item.key)) ? historicalByKey.get(A.lookupKey(item.key)) : null)
    };
  }

  function currentProgramRateData(analysis) {
    const rows = A.programResultsRows(analysis)
      .filter((row) => !isNonSpecificLabel(row.title) && Number(row.rateMinutes || 0) > 0)
      .sort((a, b) => Number(b.dollarsPerHour || 0) - Number(a.dollarsPerHour || 0))
      .slice(0, 10);
    return { labels: rows.map((row) => row.title), values: rows.map((row) => Number(row.dollarsPerHour || 0)) };
  }

  function selectedHistoryTrendCard(analysis, historical, metric, title, description, yLabel, suffix = '/hr') {
    const trend = trendSeriesForHistory(historical, metric);
    const selectedId = A.text(analysis.schedule?.id || '');
    const marker = trend.ordered.map((item, index) => A.text(item.schedule?.id || '') === selectedId ? trend.values[index] : null);
    return chartCard(title, description, lineChartSvg({
      labels: trend.labels,
      series: [
        { label: 'Historical', values: trend.values },
        { label: 'Selected fundraiser', values: marker }
      ],
      ariaLabel: title,
      className: 'fundraiser-history-trend',
      legendTop: true,
      yLabel,
      axisFormatter: (value) => money(value),
      pointFormatter: (value) => suffix ? `${money(value)}${suffix}` : money(value)
    }));
  }

  function fundraiserVisualOverview(analysis, historical = []) {
    const days = A.calendarDays(analysis);
    const corresponding = currentCorrespondingDayComparisonData(analysis, historical);
    const topics = currentTopicComparisonData(analysis, historical);
    const programs = currentProgramRateData(analysis);
    const cards = [
      chartCard('Daily Broadcast income', 'Daily Broadcast dollars. The day-by-day table later in the report supplies hours, $/hour, pledges, and weather.', incomeBarChartSvg(days)),
      chartCard('Corresponding fundraiser days vs history', 'The selected fundraiser is aligned to the same fundraiser-day positions used in Historical Analytics, preserving actual calendar behavior around the first Saturday.', lineChartSvg({
        labels: corresponding.labels,
        series: [
          { label: 'This fundraiser', values: corresponding.current },
          { label: 'Historical median', values: corresponding.historical }
        ],
        ariaLabel: 'Current corresponding fundraiser days compared with historical median',
        className: 'fundraiser-corresponding-days-comparison',
        legendTop: true,
        verticalGridEvery: 1,
        ...rateChartOptions()
      })),
      selectedHistoryTrendCard(analysis, historical, rateForAnalysis, 'Productivity in historical context', 'Broadcast $/pledge-hour across the complete fundraiser history, with the selected fundraiser marked.', 'Broadcast $ / pledge hour'),
      selectedHistoryTrendCard(analysis, historical, (item) => A.dollarsPerPledge(item.broadcastDollars, item.pledges), 'Average gift in historical context', 'Broadcast dollars per pledge across fundraiser history, with the selected fundraiser marked.', 'Broadcast $ / pledge', ''),
      chartCard('Topic performance vs history', 'Current topic $/hour beside the historical fundraiser-level median for the same topic when enough historical evidence exists.', barChartSvg({
        labels: topics.labels,
        series: [
          { label: 'This fundraiser', values: topics.current },
          { label: 'Historical median', values: topics.historical }
        ],
        ariaLabel: 'Current topic performance compared with historical medians',
        className: 'fundraiser-topic-comparison',
        ...rateChartOptions()
      })),
      chartCard('Top program rates', 'The strongest rate-valid programs in this fundraiser. The program-results table later supplies dollars, pledges, length, and airing counts.', barChartSvg({
        labels: programs.labels,
        series: [{ label: 'This fundraiser', values: programs.values }],
        ariaLabel: 'Top current fundraiser program rates',
        className: 'fundraiser-program-overview',
        ...rateChartOptions()
      }))
    ];
    return `<section class="sheet-section visual-overview fundraiser-visual-overview"><div class="section-heading"><div><h2>Fundraiser at a glance</h2><p>Graphs lead the report for quick review. The tables that follow provide the detailed records and evidence behind each pattern.</p></div></div><div class="visual-grid">${cards.join('')}</div></section>`;
  }

  function comparisonPhrase(current, baseline, noun = 'historical median') {
    if (!(Number.isFinite(Number(current)) && Number.isFinite(Number(baseline))) || Number(baseline) === 0) return `No stable ${noun} is available for comparison.`;
    const difference = ((Number(current) - Number(baseline)) / Math.abs(Number(baseline))) * 100;
    if (Math.abs(difference) < 2) return `essentially even with the ${noun}`;
    return `${Math.abs(Math.round(difference))}% ${difference > 0 ? 'above' : 'below'} the ${noun}`;
  }

  function historicalContextParagraphs(analysis, historical = []) {
    const historyWithoutCurrent = historical.filter((item) => A.text(item.schedule?.id || '') !== A.text(analysis.schedule?.id || ''));
    const baseline = historyWithoutCurrent.length ? historyWithoutCurrent : historical;
    const overallRates = baseline.map(rateForAnalysis).filter((value) => Number.isFinite(Number(value)));
    const currentRate = rateForAnalysis(analysis);
    const overallMedian = medianNumber(overallRates);
    const percentile = percentileForValue(overallRates, currentRate);
    const sameSeason = baseline.filter((item) => item.schedule?.season && item.schedule.season === analysis.schedule?.season);
    const seasonMedian = medianNumber(sameSeason.map(rateForAnalysis).filter((value) => Number.isFinite(Number(value))));
    const currentGift = A.dollarsPerPledge(analysis.broadcastDollars, analysis.pledges);
    const giftMedian = medianNumber(baseline.map((item) => A.dollarsPerPledge(item.broadcastDollars, item.pledges)).filter((value) => Number.isFinite(Number(value))));
    const currentPledgesPerHour = pledgeRateForAnalysis(analysis);
    const pledgeRateMedian = medianNumber(baseline.map(pledgeRateForAnalysis).filter((value) => Number.isFinite(Number(value))));
    const corresponding = currentCorrespondingDayComparisonData(analysis, baseline);
    const comparableDays = corresponding.labels.map((label, index) => ({ label, current: corresponding.current[index], historical: corresponding.historical[index] }))
      .filter((row) => Number.isFinite(Number(row.current)) && Number.isFinite(Number(row.historical)));
    const strongestDay = [...comparableDays].sort((a, b) => Number(b.current || 0) - Number(a.current || 0))[0] || null;
    const topicRows = currentTopicComparisonData(analysis, baseline);
    let topicText = 'There is not enough rate-valid topic data for a historical comparison.';
    if (topicRows.labels.length) {
      const bestIndex = topicRows.current.reduce((best, value, index, values) => Number(value || 0) > Number(values[best] || 0) ? index : best, 0);
      const topic = topicRows.labels[bestIndex];
      const historicalTopic = topicRows.historical[bestIndex];
      topicText = `${topic} was the strongest rate-valid topic in this fundraiser at ${money(topicRows.current[bestIndex])}/hr. ${historicalTopic !== null && historicalTopic !== undefined && Number.isFinite(Number(historicalTopic)) ? `That is ${comparisonPhrase(topicRows.current[bestIndex], historicalTopic, `${topic} historical median`)}.` : 'That topic does not yet have enough historical evidence for a stable median.'}`;
    }
    const daypartCurrent = rankingRows([analysis], 'daypart', { minAirings: 1, minFundraisers: 1, minTitles: 1 });
    const daypartHistory = rankingRows(baseline, 'daypart');
    let timingText = 'There is not enough rate-valid daypart evidence to compare this fundraiser with history.';
    if (daypartCurrent.length) {
      const best = daypartCurrent[0];
      const historic = daypartHistory.find((row) => A.lookupKey(row.key) === A.lookupKey(best.key));
      timingText = `${historicalKeyLabel('daypart', best.key)} was this fundraiser’s strongest daypart at ${money(best.medianDollarsPerHour)}/hr. ${historic ? `That is ${comparisonPhrase(best.medianDollarsPerHour, historic.medianDollarsPerHour, `${historicalKeyLabel('daypart', best.key)} historical median`)}.` : 'The historical evidence threshold is not met for that same daypart.'}`;
    }
    return [
      {
        title: 'Overall productivity',
        text: `${analysis.schedule.title} produced ${money(currentRate)}/pledge hour, ${comparisonPhrase(currentRate, overallMedian)}${percentile == null ? '' : ` and roughly the ${percentile}th percentile of the comparison history`}.${sameSeason.length && seasonMedian > 0 ? ` Against prior ${analysis.schedule.season} fundraisers, it is ${comparisonPhrase(currentRate, seasonMedian, `${analysis.schedule.season} median`)}.` : ''}`
      },
      {
        title: 'Donor behavior',
        text: `Average Broadcast gift was ${money(currentGift)}, ${comparisonPhrase(currentGift, giftMedian, 'historical $/pledge median')}. Pledges arrived at ${count(currentPledgesPerHour, 2)} per pledge hour, ${comparisonPhrase(currentPledgesPerHour, pledgeRateMedian, 'historical pledges/hour median')}. This helps distinguish stronger donor volume from larger gifts.`
      },
      {
        title: 'Fundraiser-day pattern',
        text: strongestDay
          ? `${strongestDay.label} was the strongest directly comparable fundraiser-day position at ${money(strongestDay.current)}/hr, ${comparisonPhrase(strongestDay.current, strongestDay.historical, `${strongestDay.label} historical median`)}. The comparison preserves actual fundraiser-day placement rather than normalizing the drive into arbitrary fifths.`
          : 'Corresponding-day comparison is unavailable because there are not enough directly aligned day-level rate observations.'
      },
      { title: 'Programming mix', text: topicText },
      { title: 'Scheduling pattern', text: timingText }
    ];
  }

  function fundraiserHistoricalContext(analysis, historical = []) {
    const paragraphs = historicalContextParagraphs(analysis, historical);
    return `<section class="sheet-section historical-context"><div class="section-heading"><div><h2>Historical context</h2><p>The selected fundraiser is interpreted against prior fundraiser-level evidence so the report answers not only what happened, but whether it was unusual.</p></div></div><div class="historical-context-grid">${paragraphs.map((item) => `<article><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.text)}</p></article>`).join('')}</div></section>`;
  }

  function historicalReportBody(analyses) {
    return [
      historicalVisualOverview(analyses),
      historicalSeasonTable(analyses),
      historicalRankingTable(analyses, 'topic', 'Topic performance', 'Each fundraiser contributes one topic-specific $/pledge-hour observation; topics require at least 3 rate-valid airings across at least 2 fundraisers.'),
      historicalRankingTable(analyses, 'subtopic', 'Subtopic performance', 'Each fundraiser contributes one subtopic-specific $/pledge-hour observation; subtopics require at least 3 rate-valid airings across at least 2 fundraisers.'),
      historicalStartTimeTables(analyses),
      historicalRankingTable(analyses, 'weekpart', 'Weekday / Saturday / Sunday', 'Each fundraiser contributes one aggregated weekday, Saturday, or Sunday $/pledge-hour observation.'),
      historicalRankingTable(analyses, 'daypart', 'Daypart performance', 'Each fundraiser contributes one $/pledge-hour observation for each daypart it used: morning, afternoon, early evening, prime, or overnight.'),
      historicalRankingTable(analyses, 'breakType', 'Live break vs pre-recorded break', 'Each fundraiser contributes one rate per break type. Uses saved schedule live-break flags only; unmatched imported rows are excluded. Live evidence is shown when at least one rate-valid live airing survives in saved schedule history.', { minAirings: 1, minFundraisers: 1, minTitles: 1 }),
      historicalRankingTable(analyses, 'distributor', 'Distributor performance', 'Each fundraiser contributes one distributor-specific $/pledge-hour observation; distributors require at least 3 rate-valid airings across at least 2 fundraisers.')
    ].join('');
  }

  async function renderHistoricalReport() {
    const analyses = historicalAnalyses();
    if (!analyses.length) {
      $('#report-output').innerHTML = '<div class="report-empty">No fundraiser history is available.</div>';
      return;
    }
    if (!(await ensureDurationDecision(analyses))) return;
    $('#report-output').innerHTML = `<article class="one-sheet historical-sheet">${historicalHeader(analyses)}${durationNoticeSection(analyses)}${historicalReportBody(analyses)}<footer class="sheet-footer">Historical rankings use fundraiser-balanced median Broadcast $/hour: each fundraiser contributes at most one rate observation to each category or start-time slot, regardless of how many individual programs it aired there. A category is omitted for a fundraiser if any of its scheduled rows in that category has an unknown result or missing duration. Non-Specific Pledges are not treated as incomplete program/topic data. Start-time rankings are evaluated separately for Weekdays, Saturdays, and Sundays; each requires 5 rate-valid airings across 3 rate-valid fundraisers and 3 distinct rate-valid titles. Imported results that cannot be reconciled to a saved schedule placement remain in fundraiser totals but are excluded from historical performance rankings.</footer></article>`;
  }

  async function initHistorical() {
    document.title = 'WNMU Historical Fundraiser Analytics';
    $('#report-page-title').textContent = 'Historical Fundraiser Analytics';
    $('#report-page-subtitle').textContent = 'Retrospective patterns across the full pledge record';
    historicalControls();
    await renderHistoricalReport();
  }


  function preflightResolveLibraryRow(row = {}) {
    const id = A.text(row?.pledge_program_id || row?.manual_match_program_id || row?.program_id || '');
    if (id && state.indexes?.byId?.has(id)) return state.indexes.byId.get(id);
    const nola = A.text(row?.nola_code || row?.nola || row?.program_nola || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (nola) {
      const candidates = state.indexes?.byNola?.get(nola) || [];
      if (candidates.length === 1) return candidates[0];
    }
    const title = A.lookupKey(row?.matched_library_title || row?.program_title || row?.title || row?.imported_program_title || '');
    return title ? state.indexes?.byTitle?.get(title) || null : null;
  }

  function preflightRepairRows(startDate = '', endDate = '') {
    const start = A.text(startDate);
    const end = A.text(endDate || startDate);
    if (!(start && end)) return [];
    return (state.airings || []).filter((row) => {
      const date = A.importedDateKey?.(row) || A.text(row?.air_date || '').slice(0, 10);
      return date && date >= start && date <= end;
    });
  }

  function preflightRepairPlacementCandidate(row = {}, index = 0) {
    const sourceTitle = A.text(row?.imported_program_title || row?.program_title || row?.title || '');
    if (isNonSpecificLabel(sourceTitle) || isNonSpecificLabel(row?.matched_library_title || '')) return { row, skipReason: 'non-specific' };
    const libraryRow = preflightResolveLibraryRow(row);
    if (!libraryRow) return { row, skipReason: 'no-library-match' };
    const programId = A.text(libraryRow?.id || row?.program_id || row?.pledge_program_id || '');
    if (!programId) return { row, skipReason: 'no-library-match' };
    const dateKey = A.importedDateKey?.(row) || A.text(row?.air_date || '').slice(0, 10);
    const startMinutes = A.importedStartMinutes?.(row);
    if (!dateKey || !Number.isFinite(Number(startMinutes))) return { row, skipReason: 'bad-date-time' };
    const directRuntime = Number(row?.program_minutes ?? row?.runtime_minutes ?? row?.length_minutes ?? 0) || 0;
    const lengthMinutes = Number(A.libraryRuntimeMinutes?.(libraryRow) || directRuntime || 0);
    if (!(lengthMinutes > 0)) return { row, skipReason: 'missing-duration' };
    const programTitle = A.text(libraryRow?.title || A.importedTitle?.(row) || sourceTitle || 'Untitled program');
    const sourceHash = A.text(row?.row_hash || row?.id || '');
    return {
      row,
      slotKey: `${dateKey}|${Number(startMinutes)}`,
      placement: {
        id: `preflight-${sourceHash || `${dateKey}-${startMinutes}-${programId}-${index}`}`,
        programId,
        programTitle,
        dateKey,
        startMinutes: Number(startMinutes),
        endMinutes: Number(startMinutes) + lengthMinutes,
        lengthMinutes,
        importedFromReport: true,
        sourceAiringHash: sourceHash,
        sourceName: A.text(row?.source_file_name || ''),
        importedBroadcastDollars: Number(row?.dollars ?? row?.contribution_amount ?? 0) || 0,
        importedPledges: Number(row?.pledge_count || row?.pledges || 0) || 0,
        nolaCode: A.text(libraryRow?.nola_code || row?.nola_code || '')
      }
    };
  }

  function preflightRepairTitle(startDate = '', endDate = '') {
    const parsed = A.parseDate(startDate);
    const season = A.seasonForDate(parsed) || 'Fundraiser';
    const year = parsed?.getFullYear() || '';
    const base = `${season}${year ? ` ${year}` : ''}`.trim();
    const duplicateTitle = state.schedules.some((schedule) => A.lookupKey(schedule?.title || '') === A.lookupKey(base));
    return duplicateTitle ? `${base} Fundraiser · ${formatDate(startDate, false)}–${formatDate(endDate || startDate, false)}` : base;
  }

  function buildPreflightScheduleRepairPreview(startDate = '', endDate = '') {
    const start = A.text(startDate);
    const end = A.text(endDate || startDate);
    const rows = preflightRepairRows(start, end);
    const candidates = rows.map(preflightRepairPlacementCandidate);
    const slotGroups = new Map();
    candidates.filter((item) => item.placement).forEach((item) => {
      if (!slotGroups.has(item.slotKey)) slotGroups.set(item.slotKey, []);
      slotGroups.get(item.slotKey).push(item);
    });
    const collisionKeys = new Set([...slotGroups.entries()].filter(([_key, items]) => items.length > 1).map(([key]) => key));
    const placements = candidates
      .filter((item) => item.placement && !collisionKeys.has(item.slotKey))
      .map((item) => item.placement)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.startMinutes - b.startMinutes || a.programTitle.localeCompare(b.programTitle));
    const skipped = candidates.filter((item) => !item.placement).length;
    const collisions = collisionKeys.size;
    const dollars = rows.reduce((sum, row) => sum + (Number(row?.dollars ?? row?.contribution_amount ?? 0) || 0), 0);
    const pledges = rows.reduce((sum, row) => sum + (Number(row?.pledge_count || row?.pledges || 0) || 0), 0);
    return { startDate: start, endDate: end, title: preflightRepairTitle(start, end), rows, placements, skipped, collisions, dollars, pledges };
  }

  function closePreflightScheduleRepair() {
    document.getElementById('preflight-schedule-repair-modal')?.remove();
  }

  function preflightScheduleOverlap(startDate = '', endDate = '') {
    return state.schedules.find((schedule) => {
      const start = A.text(schedule?.startDate || '');
      const end = A.text(schedule?.endDate || start || '');
      return start && end && start <= endDate && end >= startDate;
    }) || null;
  }

  async function executePreflightScheduleRepair(preview, title = '') {
    if (!preview?.startDate || !preview?.endDate || !preview?.placements?.length) return;
    const overlap = preflightScheduleOverlap(preview.startDate, preview.endDate);
    if (overlap) {
      setStatus(`Repair stopped: ${overlap.title || 'a saved fundraiser'} overlaps ${preview.startDate}–${preview.endDate}. Refresh Preflight or choose a non-overlapping range.`, 'warn');
      return;
    }
    const resolvedTitle = A.text(title || preview.title || 'Recovered fundraiser');
    const confirmed = window.confirm(`Create ${resolvedTitle} for ${preview.startDate}–${preview.endDate} with ${preview.placements.length} reconstructed program placement${preview.placements.length === 1 ? '' : 's'}?\n\nThis creates one new fundraiser schedule. It does not delete, merge, shorten, or overwrite any existing schedule.`);
    if (!confirmed) return;
    const now = new Date().toISOString();
    const randomPart = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/[^a-z0-9-]/gi, '');
    const id = `schedule-${randomPart}`;
    const scheduleData = {
      id,
      title: resolvedTitle,
      startDate: preview.startDate,
      endDate: preview.endDate,
      dayStartHour: 7,
      dayEndHour: 25,
      dayStartMinutes: 420,
      dayEndMinutes: 1500,
      placements: preview.placements,
      onlineDollars: 0,
      mailDollars: 0,
      goalDollars: 0,
      meta: {
        autoCreatedFromReports: false,
        importedFromReports: true,
        repairedFromPreflight: true,
        repairCreatedAt: now,
        repairSourceRange: `${preview.startDate}|${preview.endDate}`,
        repairImportedRowCount: preview.rows.length,
        repairPlacementCount: preview.placements.length
      }
    };
    setStatus(`Creating recovered fundraiser ${preview.startDate}–${preview.endDate}…`);
    const { data: createdRows, error } = await state.client.from('pledge_fundraiser_schedules').insert({
      id,
      title: resolvedTitle,
      start_date: preview.startDate,
      end_date: preview.endDate,
      day_start_hour: 7,
      day_end_hour: 25,
      schedule_data: scheduleData,
      updated_at: now
    }).select('id,title,start_date,end_date');
    if (error) throw error;
    const created = Array.isArray(createdRows) ? createdRows[0] : null;
    if (!created || A.text(created.id) !== id || A.text(created.start_date) !== preview.startDate || A.text(created.end_date) !== preview.endDate) {
      throw new Error('Supabase did not confirm the newly created fundraiser schedule. Nothing will be treated as repaired until the saved row can be read back.');
    }
    closePreflightScheduleRepair();
    await loadData();
    if (!state.schedules.some((schedule) => schedule.id === id)) {
      throw new Error(`The fundraiser was saved as ${id}, but the report loader did not retain it. Refresh before attempting another repair.`);
    }
    renderPreflightReport();
    setStatus(`Recovered ${resolvedTitle}: ${preview.placements.length} imported placement${preview.placements.length === 1 ? '' : 's'} across ${preview.startDate}–${preview.endDate}. Existing schedules were untouched.`);
  }

  function previewPreflightScheduleRepair(startDate = '', endDate = '') {
    closePreflightScheduleRepair();
    const modal = document.createElement('div');
    modal.id = 'preflight-schedule-repair-modal';
    modal.className = 'report-modal-backdrop';
    modal.innerHTML = `<div class="report-modal" role="dialog" aria-modal="true" aria-labelledby="preflight-schedule-repair-title">
      <div class="report-kicker">Non-destructive schedule repair preview</div>
      <h2 id="preflight-schedule-repair-title">Recover a missing fundraiser calendar</h2>
      <p>The imported pledge report proves activity occurred, but it does not get to invent the fundraiser boundaries. Confirm the authoritative dates before creating anything.</p>
      <div class="report-control-row preflight-repair-range">
        <label class="report-field"><span>Start date</span><input type="date" id="preflight-repair-start" value="${escapeHtml(startDate)}"></label>
        <label class="report-field"><span>End date</span><input type="date" id="preflight-repair-end" value="${escapeHtml(endDate || startDate)}"></label>
        <label class="report-field report-field-grow"><span>Schedule title</span><input type="text" id="preflight-repair-title-input"></label>
      </div>
      <div id="preflight-repair-preview"></div>
      <div class="report-modal-actions">
        <button type="button" class="report-button primary" data-action="create">Create missing schedule</button>
        <button type="button" class="report-button" data-action="cancel">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    const startInput = modal.querySelector('#preflight-repair-start');
    const endInput = modal.querySelector('#preflight-repair-end');
    const titleInput = modal.querySelector('#preflight-repair-title-input');
    const previewBox = modal.querySelector('#preflight-repair-preview');
    const createButton = modal.querySelector('[data-action="create"]');
    let currentPreview = null;
    let titleWasEdited = false;

    const refresh = () => {
      const start = A.text(startInput?.value || '');
      const end = A.text(endInput?.value || start);
      currentPreview = start && end && start <= end ? buildPreflightScheduleRepairPreview(start, end) : null;
      if (titleInput && !titleWasEdited) titleInput.value = currentPreview?.title || '';
      const overlap = currentPreview ? preflightScheduleOverlap(start, end) : null;
      const canCreate = Boolean(currentPreview?.placements?.length) && !currentPreview?.collisions && !overlap;
      if (createButton) createButton.disabled = !canCreate;
      if (!previewBox) return;
      if (!currentPreview) {
        previewBox.innerHTML = '<p class="report-modal-note">Choose a valid start and end date.</p>';
        return;
      }
      previewBox.innerHTML = `<div class="duration-warning-list">
        <div><strong>${escapeHtml(count(currentPreview.rows.length))} imported rows</strong><span>${escapeHtml(money(currentPreview.dollars))} Broadcast · ${escapeHtml(count(currentPreview.pledges))} pledges</span></div>
        <div><strong>${escapeHtml(count(currentPreview.placements.length))} reconstructable placements</strong><span>Program Library identity, air date/time, and usable duration are known.</span></div>
        ${currentPreview.skipped ? `<div><strong>${escapeHtml(count(currentPreview.skipped))} rows not placed automatically</strong><span>Non-Specific, unmatched, invalid date/time, or missing-duration rows stay in imported history for manual review.</span></div>` : ''}
        ${currentPreview.collisions ? `<div><strong>${escapeHtml(count(currentPreview.collisions))} ambiguous schedule slots</strong><span>More than one imported program occupies the same date/time. Automatic creation is blocked.</span></div>` : ''}
        ${overlap ? `<div><strong>Overlaps ${escapeHtml(overlap.title || 'saved fundraiser')}</strong><span>${escapeHtml(overlap.startDate || '')}–${escapeHtml(overlap.endDate || '')}. Creation is blocked so no existing schedule is altered.</span></div>` : ''}
      </div>
      <p class="report-modal-note">This repair is additive only. It creates a new historical fundraiser from imported evidence and leaves every existing fundraiser untouched. Imported results may not reconstruct programs that were absent from the pledge report.</p>`;
    };
    startInput?.addEventListener('change', refresh);
    endInput?.addEventListener('change', refresh);
    titleInput?.addEventListener('input', () => { titleWasEdited = true; });
    modal.querySelector('[data-action="cancel"]')?.addEventListener('click', closePreflightScheduleRepair);
    modal.addEventListener('click', (event) => { if (event.target === modal) closePreflightScheduleRepair(); });
    createButton?.addEventListener('click', () => {
      if (!currentPreview) return;
      void executePreflightScheduleRepair(currentPreview, titleInput?.value || '').catch((error) => {
        console.error(error);
        setStatus(`Schedule repair failed: ${error?.message || error}`, 'warn');
      });
    });
    refresh();
  }

  function ensurePreflightProgramEditor() {
    let backdrop = document.getElementById('preflight-program-editor-backdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'preflight-program-editor-backdrop';
    backdrop.className = 'preflight-program-editor-backdrop hidden';
    backdrop.innerHTML = `<section class="preflight-program-editor-modal" role="dialog" aria-modal="true" aria-labelledby="preflight-program-editor-title">
      <header class="preflight-program-editor-head">
        <div><div class="report-kicker">Pledge Program Library editor</div><h2 id="preflight-program-editor-title">Program details</h2></div>
        <button type="button" class="report-button" id="preflight-program-editor-close">Close & refresh Preflight</button>
      </header>
      <div class="preflight-program-editor-body"><iframe id="preflight-program-editor-frame" title="Pledge Program Library detail editor"></iframe></div>
    </section>`;
    document.body.append(backdrop);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) void closePreflightProgramEditor();
    });
    backdrop.querySelector('#preflight-program-editor-close')?.addEventListener('click', () => { void closePreflightProgramEditor(); });
    return backdrop;
  }

  function openPreflightProgramEditor(programId, title = '') {
    const id = A.text(programId || '');
    if (!id) return;
    const backdrop = ensurePreflightProgramEditor();
    const frame = backdrop.querySelector('#preflight-program-editor-frame');
    const heading = backdrop.querySelector('#preflight-program-editor-title');
    if (heading) heading.textContent = title ? `Edit ${title}` : 'Edit program';
    if (frame) frame.src = `./?openProgram=${encodeURIComponent(id)}&detailOnly=1&from=preflight`;
    backdrop.classList.remove('hidden');
    document.body.classList.add('preflight-program-editor-open');
    backdrop.querySelector('#preflight-program-editor-close')?.focus();
  }

  async function closePreflightProgramEditor({ refresh = true } = {}) {
    const backdrop = document.getElementById('preflight-program-editor-backdrop');
    if (!backdrop || backdrop.classList.contains('hidden')) return;
    backdrop.classList.add('hidden');
    document.body.classList.remove('preflight-program-editor-open');
    const frame = backdrop.querySelector('#preflight-program-editor-frame');
    if (frame) frame.src = 'about:blank';
    if (refresh && reportMode() === 'preflight') {
      if ($('#report-status')) $('#report-status').textContent = 'Refreshing Preflight after program edit…';
      await loadData();
      renderPreflightReport();
      if ($('#report-status')) $('#report-status').textContent = 'Preflight refreshed.';
    }
  }

  function bindPreflightProgramEditor() {
    const output = $('#report-output');
    if (!output || output.dataset.preflightEditorBound === 'true') return;
    output.dataset.preflightEditorBound = 'true';
    output.addEventListener('click', (event) => {
      const repairButton = event.target?.closest?.('[data-preflight-repair-start]');
      if (repairButton) {
        previewPreflightScheduleRepair(repairButton.getAttribute('data-preflight-repair-start') || '', repairButton.getAttribute('data-preflight-repair-end') || '');
        return;
      }
      const button = event.target?.closest?.('[data-preflight-program-id]');
      if (!button) return;
      openPreflightProgramEditor(button.getAttribute('data-preflight-program-id') || '', button.getAttribute('data-preflight-program-title') || button.textContent || '');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !document.getElementById('preflight-program-editor-backdrop')?.classList.contains('hidden')) {
        event.preventDefault();
        void closePreflightProgramEditor();
      }
    });
  }

  function preflightControls() {
    $('#report-controls').innerHTML = `<div class="report-control-row"><div class="historical-control-copy"><strong>Full historical dataset</strong><span>Preflight uses the same saved schedules, imported pledge results, and Program Library records as the reports.</span></div><button type="button" class="report-button" id="report-print">Print preflight</button></div>`;
    $('#report-print')?.addEventListener('click', () => window.print());
  }

  function preflightCheckMarkup(check) {
    const statusLabel = check.severity === 'fail'
      ? (check.count ? 'Needs attention' : 'Pass')
      : check.severity === 'warn'
        ? (check.count ? 'Warning' : 'Clear')
        : 'Information';
    const details = Array.isArray(check.details) ? check.details : [];
    const detailItemMarkup = (item) => {
      if (!item || typeof item !== 'object') return escapeHtml(item);
      const title = A.text(item.title || '');
      const programId = A.text(item.programId || '');
      const detail = A.text(item.detail || item.text || '');
      const mismatchTypes = Array.isArray(item.mismatchTypes) ? item.mismatchTypes.filter(Boolean) : [];
      const repair = item.repair && typeof item.repair === 'object' ? item.repair : null;
      const titleMarkup = programId && title
        ? `<button type="button" class="preflight-program-link" data-preflight-program-id="${escapeHtml(programId)}" data-preflight-program-title="${escapeHtml(title)}" title="Edit ${escapeHtml(title)}">${escapeHtml(title)}</button>`
        : escapeHtml(title);
      const tags = mismatchTypes.length ? `<span class="preflight-mismatch-tags">${mismatchTypes.map((type) => `<span class="preflight-mismatch-tag">${escapeHtml(type)}</span>`).join('')}</span>` : '';
      const repairMarkup = repair?.type === 'create-missing-schedule' && repair.startDate
        ? `<button type="button" class="report-button preflight-repair-button" data-preflight-repair-start="${escapeHtml(repair.startDate)}" data-preflight-repair-end="${escapeHtml(repair.endDate || repair.startDate)}">Preview schedule repair</button>`
        : '';
      return `<span class="preflight-detail-line">${titleMarkup}${tags}${detail ? `<span class="preflight-detail-copy">${escapeHtml(detail)}</span>` : ''}${repairMarkup}</span>` || '—';
    };
    const detailMarkup = details.length
      ? `<details ${check.severity !== 'info' && check.count ? 'open' : ''}><summary>${escapeHtml(count(details.length))} detail${details.length === 1 ? '' : 's'}</summary><ul>${details.map((item) => `<li>${detailItemMarkup(item)}</li>`).join('')}</ul></details>`
      : '';
    const startTimeBreakdown = Array.isArray(check.startTimeBreakdown) ? check.startTimeBreakdown : [];
    const startTimeMarkup = startTimeBreakdown.length
      ? `<div class="preflight-detail-line"><strong>Unmatched rows by reported start time</strong><span class="preflight-mismatch-tags">${startTimeBreakdown.map((item) => `<span class="preflight-mismatch-tag">${escapeHtml(item.label)} · ${escapeHtml(count(item.count))}</span>`).join('')}</span></div>`
      : '';
    return `<section class="preflight-check severity-${escapeHtml(check.severity)} ${check.count ? 'has-findings' : 'clear'}"><div class="preflight-check-head"><div><h2>${escapeHtml(check.label)}</h2><p>${escapeHtml(check.summary)}</p></div><span class="preflight-status">${escapeHtml(statusLabel)}${check.count ? ` · ${escapeHtml(count(check.count))}` : ''}</span></div>${startTimeMarkup}${detailMarkup}</section>`;
  }

  function renderPreflightReport() {
    const analyses = historicalAnalyses();
    const health = A.dataHealthReport(state.schedules, analyses, state.airings, state.library);
    if (state.supersededAiringsCount > 0) {
      health.checks.unshift({
        id: 'superseded-imports',
        label: 'Superseded imported observations',
        severity: 'info',
        summary: 'Older duplicate/superseded imported observations were ignored before reports and Preflight analyzed the current pledge history.',
        count: state.supersededAiringsCount,
        details: [`${count(state.supersededAiringsCount)} of ${count(state.rawAiringsCount)} raw imported rows were superseded by a newer observation with the same station/program/date/time identity.`]
      });
    }
    const passed = health.status === 'pass';
    const headline = passed ? 'PASS' : 'REVIEW REQUIRED';
    const bannerCopy = passed
      ? (health.warnings ? `No blocking report-data defects detected. ${health.warnings} warning categor${health.warnings === 1 ? 'y' : 'ies'} remains for cleanup or verification.` : 'No blocking report-data defects or warnings were detected.')
      : `${health.failures} blocking check${health.failures === 1 ? '' : 's'} require attention before treating the report set as fully clean.`;
    const metrics = health.metrics || {};
    $('#report-output').innerHTML = `<article class="one-sheet preflight-sheet">
      <header class="sheet-title"><div><div class="report-kicker">WNMU-TV PBS report readiness</div><h1>Data Health / Preflight</h1><p>Automated consistency checks across the Pledge Library, Scheduler history, imported pledge results, and report analytics.</p></div><div class="sheet-stamp">Generated ${escapeHtml(new Date().toLocaleDateString())}</div></header>
      <section class="preflight-banner ${passed ? 'pass' : 'review'}"><strong>${escapeHtml(headline)}</strong><span>${escapeHtml(bannerCopy)}</span></section>
      <section class="preflight-metrics">
        <div><span>Fundraisers</span><strong>${escapeHtml(count(metrics.fundraisers))}</strong></div>
        <div><span>Imported rows</span><strong>${escapeHtml(count(metrics.importedRows))}</strong></div>
        <div><span>Scheduled airings</span><strong>${escapeHtml(count(metrics.scheduledAirings))}</strong></div>
        <div><span>Library programs</span><strong>${escapeHtml(count(metrics.libraryPrograms))}</strong></div>
      </section>
      <div class="preflight-checks">${(health.checks || []).map(preflightCheckMarkup).join('')}</div>
      <footer class="sheet-footer">PASS means no blocking defects were found in fundraiser schedule coverage, Broadcast reconciliation, program duration coverage, imported program attribution, or duplicate fundraiser ranges. Warnings identify cleanup or verification work that does not currently invalidate the printed report math. Non-Specific Pledges are treated as a valid giving category, not an attribution error. Unmatched imported program rows remain in factual fundraiser totals but are excluded from historical start-time rankings.</footer>
    </article>`;
  }

  async function initPreflight() {
    document.title = 'WNMU Data Health / Preflight';
    $('#report-page-title').textContent = 'Data Health / Preflight';
    $('#report-page-subtitle').textContent = 'Report-readiness checks across the full pledge dataset';
    preflightControls();
    renderPreflightReport();
    bindPreflightProgramEditor();
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
      else if (mode === 'preflight') await initPreflight();
      else renderHub();
    } catch (error) {
      console.error(error);
      showAccessDenied(error?.message || 'The report center could not load.');
    }
  }

  document.addEventListener('DOMContentLoaded', () => { void init(); }, { once: true });
})();

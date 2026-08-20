(() => {
  const App = window.PledgeLib;
  if (!App) return;

  const SEASONS = ['March', 'June', 'August', 'December'];
  const state = {
    ready: false,
    loading: false,
    schedules: [],
    airings: [],
    season: 'all',
    selectedIds: new Set(),
    baselineId: '',
    libraryById: new Map(),
    libraryByTitle: new Map(),
    libraryByNola: new Map()
  };

  const text = (value) => String(value ?? '').trim();
  const lookupKey = (value) => text(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const nolaKey = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const money = (value) => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const number = (value) => Number(value || 0).toLocaleString();
  const signedMoney = (value) => `${Number(value || 0) > 0 ? '+' : ''}${money(value)}`;

  function root() { return document.getElementById('fundraiser-comparison-root'); }
  function client() { return App.state?.client || App.data?.createClient?.() || null; }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseDate(value) {
    const raw = text(value);
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [year, month, day] = raw.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function seasonForDate(value) {
    const date = value instanceof Date ? value : parseDate(value);
    if (!date) return '';
    const month = date.getMonth() + 1;
    if (month === 2 || month === 3) return 'March';
    if (month === 5 || month === 6) return 'June';
    if (month === 8 || month === 9) return 'August';
    if (month === 11 || month === 12) return 'December';
    return '';
  }

  function formatDateRange(schedule = {}) {
    const start = parseDate(schedule.startDate);
    const end = parseDate(schedule.endDate);
    const format = (date) => date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    if (!start && !end) return 'No date range';
    if (start && end && schedule.startDate === schedule.endDate) return format(start);
    return `${format(start)} – ${format(end)}`;
  }

  function normalizeSchedule(row = {}) {
    const data = row.schedule_data && typeof row.schedule_data === 'object' ? row.schedule_data : {};
    const startDate = text(row.start_date || data.startDate);
    const start = parseDate(startDate);
    return {
      id: text(row.id || data.id),
      title: text(row.title || data.title || 'Untitled fundraiser'),
      startDate,
      endDate: text(row.end_date || data.endDate),
      createdAt: text(row.created_at || data.createdAt),
      updatedAt: text(row.updated_at || data.updatedAt),
      placements: Array.isArray(data.placements) ? data.placements : [],
      onlineDollars: Number(data.onlineDollars ?? row.online_dollars ?? row.onlineDollars ?? 0) || 0,
      mailDollars: Number(data.mailDollars ?? row.mail_dollars ?? row.mailDollars ?? 0) || 0,
      meta: data.meta && typeof data.meta === 'object' ? data.meta : {},
      season: seasonForDate(startDate),
      year: start?.getFullYear() || ''
    };
  }

  function schedulePreferenceScore(schedule = {}) {
    let score = 0;
    if (schedule.onlineDollars || schedule.mailDollars) score += 100000;
    if ((schedule.placements || []).some((placement) => !placement?.importedFromReport)) score += 50000;
    if ((schedule.placements || []).length) score += Math.min(10000, schedule.placements.length * 10);
    const updated = Date.parse(schedule.updatedAt || schedule.createdAt || '');
    if (Number.isFinite(updated)) score += Math.floor(updated / 1000000000);
    return score;
  }

  function dedupeSchedules(schedules = []) {
    const buckets = new Map();
    schedules.forEach((schedule) => {
      const key = schedule.startDate && schedule.endDate ? `${schedule.startDate}|${schedule.endDate}` : `id:${schedule.id}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(schedule);
    });
    return [...buckets.values()]
      .map((items) => [...items].sort((a, b) => schedulePreferenceScore(b) - schedulePreferenceScore(a))[0])
      .filter(Boolean)
      .sort((a, b) => text(b.startDate).localeCompare(text(a.startDate)) || text(b.title).localeCompare(text(a.title)));
  }

  async function fetchAll(table, select, orderField = '') {
    const c = client();
    if (!c) throw new Error('No data connection is available.');
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let query = c.from(table).select(select).range(from, from + pageSize - 1);
      if (orderField) query = query.order(orderField, { ascending: true });
      const { data, error } = await query;
      if (error) throw error;
      const chunk = Array.isArray(data) ? data : [];
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
    }
    return rows;
  }

  function buildLibraryIndexes(rows = []) {
    state.libraryById.clear();
    state.libraryByTitle.clear();
    state.libraryByNola.clear();
    rows.forEach((row) => {
      const id = text(row?.id || App.derive?.programId?.(row));
      const title = text(row?.title || App.derive?.title?.(row));
      const nola = text(row?.nola_code || App.derive?.nola?.(row));
      if (id) state.libraryById.set(id, row);
      if (title) state.libraryByTitle.set(lookupKey(title), row);
      if (nola) {
        const key = nolaKey(nola);
        if (!state.libraryByNola.has(key)) state.libraryByNola.set(key, []);
        state.libraryByNola.get(key).push(row);
      }
    });
  }

  function libraryRowForPlacement(placement = {}) {
    const id = text(placement.programId || placement.program_id || '');
    if (id && state.libraryById.has(id)) return state.libraryById.get(id);
    const title = lookupKey(placement.programTitle || placement.program_title || placement.title || '');
    const nola = nolaKey(placement.nolaCode || placement.nola_code || placement.nola || '');
    if (nola) {
      const matches = state.libraryByNola.get(nola) || [];
      if (title) {
        const exact = matches.find((row) => lookupKey(row.title) === title);
        if (exact) return exact;
      }
      if (matches.length === 1) return matches[0];
    }
    return title ? state.libraryByTitle.get(title) || null : null;
  }

  function importedDateKey(row = {}) {
    return text(row.air_date || row.drive_date || App.utils?.dateKeyFromDate?.(row.aired_at) || '');
  }

  function importedStartMinutes(row = {}) {
    const raw = text(row.air_time || '');
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (match) return (Number(match[1]) * 60) + Number(match[2]);
    const date = new Date(row.aired_at || '');
    return Number.isNaN(date.getTime()) ? null : (date.getHours() * 60) + date.getMinutes();
  }

  function placementStartMinutes(placement = {}) {
    const value = Number(placement.startMinutes ?? placement.start_minutes ?? placement.start);
    return Number.isFinite(value) ? value : null;
  }

  function identityMatches(row = {}, placement = {}, lib = null) {
    const placementId = text(placement.programId || placement.program_id || lib?.id || '');
    const rowId = text(row.program_id || row.pledge_program_id || row.manual_match_program_id || '');
    if (placementId && rowId && placementId === rowId) return true;

    const placementNola = nolaKey(lib?.nola_code || placement.nolaCode || placement.nola_code || placement.nola || '');
    const rowNola = nolaKey(row.nola_code || row.nola || row.program_nola || '');
    if (placementNola && rowNola && placementNola === rowNola) return true;

    const placementTitle = lookupKey(lib?.title || placement.programTitle || placement.program_title || placement.title || '');
    const rowTitle = lookupKey(row.matched_library_title || row.program_title || row.title || row.imported_program_title || '');
    return Boolean(placementTitle && rowTitle && placementTitle === rowTitle);
  }

  function importedRowForPlacement(placement = {}, used = new Set()) {
    const hash = text(placement.sourceAiringHash || placement.source_airing_hash || '');
    if (hash) {
      const direct = state.airings.find((row) => text(row.row_hash) === hash && !used.has(text(row.row_hash || row.id)));
      if (direct) return direct;
    }

    const dateKey = text(placement.dateKey || placement.date_key || '');
    const start = placementStartMinutes(placement);
    if (!dateKey || !Number.isFinite(start)) return null;

    const lib = libraryRowForPlacement(placement);
    const candidates = state.airings.filter((row) => importedDateKey(row) === dateKey && importedStartMinutes(row) === start && !used.has(text(row.row_hash || row.id)));
    const matches = candidates.filter((row) => identityMatches(row, placement, lib));
    return matches.length === 1 ? matches[0] : null;
  }

  function placementResult(placement = {}, used = new Set()) {
    if (placement?.isNonPledge) return { known: false, dollars: 0, pledges: 0, source: 'non-pledge' };

    const imported = importedRowForPlacement(placement, used);
    if (imported) {
      const usedKey = text(imported.row_hash || imported.id);
      if (usedKey) used.add(usedKey);
      return {
        known: true,
        dollars: Number(imported.dollars ?? imported.contribution_amount ?? 0) || 0,
        pledges: Number(imported.pledge_count || 0) || 0,
        source: 'report'
      };
    }

    const attached = Number(placement.importedBroadcastDollars);
    if (Number.isFinite(attached) && (attached !== 0 || placement.importedFromReport || text(placement.sourceAiringHash))) {
      return {
        known: true,
        dollars: attached,
        pledges: Number(placement.importedPledges || placement.importedBroadcastPledges || 0) || 0,
        source: 'attached-report'
      };
    }

    if (placement?.manualResultRecorded) {
      return {
        known: true,
        dollars: Number(placement.manualBroadcastDollars || 0) || 0,
        pledges: Number(placement.manualPledgeCount || 0) || 0,
        source: 'manual'
      };
    }

    return { known: false, dollars: 0, pledges: 0, source: 'none' };
  }

  function programMinutes(placement = {}) {
    const explicit = Number(placement.lengthMinutes ?? placement.programMinutes ?? placement.program_minutes ?? placement.durationMinutes);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const start = placementStartMinutes(placement);
    const end = Number(placement.endMinutes ?? placement.end_minutes ?? placement.end);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      let diff = end - start;
      if (diff < 0) diff += 1440;
      if (diff > 0) return diff;
    }
    return 30;
  }

  function timeLabel(minutes) {
    if (!Number.isFinite(Number(minutes))) return 'Unknown time';
    const bucket = Math.floor(Number(minutes) / 30) * 30;
    const total = ((bucket % 1440) + 1440) % 1440;
    const hour24 = Math.floor(total / 60);
    const minute = total % 60;
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    return `${hour24 % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
  }

  function timeSortValue(label = '') {
    const match = text(label).match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/);
    if (!match) return 99999;
    let hour = Number(match[1]) % 12;
    if (match[3] === 'PM') hour += 12;
    return (hour * 60) + Number(match[2]);
  }

  function topicForPlacement(placement = {}) {
    const lib = libraryRowForPlacement(placement) || {};
    return text(lib.topic_primary || placement.topicPrimary || placement.topic_primary || 'Uncategorized') || 'Uncategorized';
  }

  function addGroup(map, key, minutes, result) {
    if (!map.has(key)) map.set(key, { key, minutes: 0, scheduled: 0, completed: 0, dollars: 0, pledges: 0 });
    const item = map.get(key);
    item.minutes += minutes;
    item.scheduled += 1;
    if (result.known) {
      item.completed += 1;
      item.dollars += result.dollars;
      item.pledges += result.pledges;
    }
  }

  function analyzeSchedule(schedule = {}) {
    const used = new Set();
    const topics = new Map();
    const times = new Map();
    let scheduled = 0;
    let completed = 0;
    let scheduledMinutes = 0;
    let attributableDollars = 0;
    let attributablePledges = 0;

    (schedule.placements || []).forEach((placement) => {
      if (!placement || placement.isNonPledge) return;
      const title = text(placement.programTitle || placement.program_title || placement.title || '');
      if (!title && !placement.programId) return;
      const minutes = programMinutes(placement);
      const result = placementResult(placement, used);
      scheduled += 1;
      scheduledMinutes += minutes;
      if (result.known) {
        completed += 1;
        attributableDollars += result.dollars;
        attributablePledges += result.pledges;
      }
      addGroup(topics, topicForPlacement(placement), minutes, result);
      addGroup(times, timeLabel(placementStartMinutes(placement)), minutes, result);
    });

    const meta = schedule.meta || {};
    const reportedBroadcast = Number(meta.reportedBroadcastTotalDollars ?? meta.importedBroadcastTotalDollars ?? meta.importedProgramSpecificBroadcastTotalDollars);
    const broadcastDollars = Number.isFinite(reportedBroadcast) && reportedBroadcast > 0 ? reportedBroadcast : attributableDollars;
    const onlineDollars = Number(schedule.onlineDollars || 0) || 0;
    const mailDollars = Number(schedule.mailDollars || 0) || 0;
    const onlineTracked = onlineDollars > 0;
    const mailTracked = mailDollars > 0;
    const recordedTotal = broadcastDollars + onlineDollars + mailDollars;

    return {
      schedule,
      scheduled,
      completed,
      scheduledMinutes,
      attributableDollars,
      attributablePledges,
      broadcastDollars,
      unattributedBroadcast: broadcastDollars - attributableDollars,
      onlineDollars,
      mailDollars,
      onlineTracked,
      mailTracked,
      recordedTotal,
      topics,
      times
    };
  }

  function mapSimilarity(a = new Map(), b = new Map()) {
    const totalA = [...a.values()].reduce((sum, row) => sum + Number(row.minutes || 0), 0);
    const totalB = [...b.values()].reduce((sum, row) => sum + Number(row.minutes || 0), 0);
    if (!(totalA > 0) || !(totalB > 0)) return null;
    const keys = new Set([...a.keys(), ...b.keys()]);
    let distance = 0;
    keys.forEach((key) => {
      distance += Math.abs((a.get(key)?.minutes || 0) / totalA - (b.get(key)?.minutes || 0) / totalB);
    });
    return Math.max(0, Math.min(1, 1 - (distance / 2)));
  }

  function comparisonSimilarity(base, current) {
    const topic = mapSimilarity(base.topics, current.topics);
    const time = mapSimilarity(base.times, current.times);
    const values = [topic, time].filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function unionRows(analyses, field) {
    const keys = new Set();
    analyses.forEach((analysis) => analysis[field].forEach((_value, key) => keys.add(key)));
    return [...keys].map((key) => ({
      key,
      values: analyses.map((analysis) => analysis[field].get(key) || { minutes: 0, scheduled: 0, completed: 0, dollars: 0, pledges: 0 })
    }));
  }

  function biggestDifference(base, current, field) {
    const rows = unionRows([base, current], field).map((row) => ({ key: row.key, difference: row.values[1].dollars - row.values[0].dollars }));
    const positive = [...rows].sort((a, b) => b.difference - a.difference)[0] || null;
    const negative = [...rows].sort((a, b) => a.difference - b.difference)[0] || null;
    return { positive, negative };
  }

  function comparableChannels(base, current) {
    const includeOnline = Boolean(base.onlineTracked && current.onlineTracked);
    const includeMail = Boolean(base.mailTracked && current.mailTracked);
    const baseComparableTotal = base.broadcastDollars
      + (includeOnline ? base.onlineDollars : 0)
      + (includeMail ? base.mailDollars : 0);
    const currentComparableTotal = current.broadcastDollars
      + (includeOnline ? current.onlineDollars : 0)
      + (includeMail ? current.mailDollars : 0);
    return { includeOnline, includeMail, baseComparableTotal, currentComparableTotal };
  }

  function hoursLabel(minutes = 0) {
    const value = Number(minutes || 0) / 60;
    if (!Number.isFinite(value) || value <= 0) return '0 hr';
    return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} hr`;
  }

  function chartHue(index = 0) {
    return (205 + (Number(index || 0) * 47)) % 360;
  }

  function renderTopicScheduleMix(analyses = []) {
    const rows = unionRows(analyses, 'topics')
      .map((row) => ({ ...row, totalMinutes: row.values.reduce((sum, value) => sum + Number(value.minutes || 0), 0) }))
      .filter((row) => row.totalMinutes > 0)
      .sort((a, b) => b.totalMinutes - a.totalMinutes || a.key.localeCompare(b.key));
    if (!rows.length) return '<section class="fc-panel"><h3>Topic schedule mix</h3><div class="fc-chart-empty">No scheduled topic minutes to graph.</div></section>';

    const legend = rows.map((row, index) => `<span class="fc-legend-item"><i style="background:hsl(${chartHue(index)} 65% 48%)"></i>${escapeHtml(row.key)}</span>`).join('');
    const bars = analyses.map((analysis) => {
      const total = [...analysis.topics.values()].reduce((sum, row) => sum + Number(row.minutes || 0), 0);
      const segments = rows.map((row, index) => {
        const minutes = Number(analysis.topics.get(row.key)?.minutes || 0);
        if (!(minutes > 0) || !(total > 0)) return '';
        const share = (minutes / total) * 100;
        const inside = share >= 11 ? `${Math.round(share)}%` : '';
        return `<span class="fc-stack-segment" style="width:${share.toFixed(2)}%;background:hsl(${chartHue(index)} 65% 48%)" title="${escapeHtml(row.key)} · ${escapeHtml(hoursLabel(minutes))} · ${Math.round(share)}%">${inside}</span>`;
      }).join('');
      return `<div class="fc-stack-row"><div class="fc-stack-label"><strong>${escapeHtml(analysis.schedule.title)}</strong><span>${escapeHtml(String(analysis.schedule.year || ''))}</span></div><div class="fc-stack-track">${segments}</div><div class="fc-stack-total">${escapeHtml(hoursLabel(total))}</div></div>`;
    }).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>Topic schedule mix</h3><span>Share of scheduled pledge time by primary topic</span></div></div><div class="fc-stack-chart">${bars}</div><div class="fc-legend">${legend}</div></section>`;
  }

  function renderTimeScheduleMix(analyses = []) {
    const rows = unionRows(analyses, 'times')
      .filter((row) => row.values.some((value) => Number(value.minutes || 0) > 0))
      .sort((a, b) => timeSortValue(a.key) - timeSortValue(b.key));
    if (!rows.length) return '<section class="fc-panel"><h3>Time-slot schedule mix</h3><div class="fc-chart-empty">No scheduled start-time minutes to graph.</div></section>';

    const maxMinutes = Math.max(1, ...rows.flatMap((row) => row.values.map((value) => Number(value.minutes || 0))));
    const legend = analyses.map((analysis, index) => `<span class="fc-legend-item"><i style="background:hsl(${chartHue(index)} 60% 46%)"></i>${escapeHtml(analysis.schedule.title)}</span>`).join('');
    const body = rows.map((row) => `<div class="fc-grouped-row"><div class="fc-grouped-label">${escapeHtml(row.key)}</div><div class="fc-grouped-series">${row.values.map((value, index) => {
      const minutes = Number(value.minutes || 0);
      const width = Math.max(0, Math.min(100, (minutes / maxMinutes) * 100));
      return `<div class="fc-grouped-item"><div class="fc-grouped-track"><span style="width:${width.toFixed(2)}%;background:hsl(${chartHue(index)} 60% 46%)"></span></div><b>${escapeHtml(hoursLabel(minutes))}</b></div>`;
    }).join('')}</div></div>`).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>Time-slot schedule mix</h3><span>Scheduled pledge hours by 30-minute start bucket</span></div></div><div class="fc-legend">${legend}</div><div class="fc-grouped-chart">${body}</div></section>`;
  }

  function renderTopicHeatmap(analyses = []) {
    const rows = unionRows(analyses, 'topics')
      .map((row) => ({ ...row, totalMinutes: row.values.reduce((sum, value) => sum + Number(value.minutes || 0), 0) }))
      .filter((row) => row.totalMinutes > 0)
      .sort((a, b) => b.totalMinutes - a.totalMinutes || a.key.localeCompare(b.key));
    if (!rows.length) return '<section class="fc-panel"><h3>Topic schedule heatmap</h3><div class="fc-chart-empty">No schedule minutes available for the heatmap.</div></section>';

    const maxMinutes = Math.max(1, ...rows.flatMap((row) => row.values.map((value) => Number(value.minutes || 0))));
    const head = analyses.map((analysis) => `<th>${escapeHtml(analysis.schedule.title)}<span>${escapeHtml(String(analysis.schedule.year || ''))}</span></th>`).join('');
    const body = rows.map((row) => `<tr><th>${escapeHtml(row.key)}</th>${row.values.map((value) => {
      const minutes = Number(value.minutes || 0);
      if (!(minutes > 0)) return '<td class="fc-heat-zero">—</td>';
      const intensity = Math.max(0, Math.min(1, minutes / maxMinutes));
      const alpha = (0.10 + (intensity * 0.72)).toFixed(2);
      const dark = intensity >= 0.58 ? ' fc-heat-dark' : '';
      return `<td class="fc-heat-cell${dark}" style="background:rgba(29,95,150,${alpha})" title="${escapeHtml(row.key)} · ${escapeHtml(hoursLabel(minutes))}">${escapeHtml(hoursLabel(minutes))}</td>`;
    }).join('')}</tr>`).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>Topic schedule heatmap</h3><span>Darker cells = more scheduled pledge time</span></div><div class="fc-heat-scale"><span>less</span><i></i><span>more</span></div></div><div class="fc-table-wrap"><table class="fc-heatmap"><thead><tr><th>Topic</th>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
  }

  function differenceRows(base, current, field) {
    return unionRows([base, current], field).map((row) => ({
      key: row.key,
      baseline: row.values[0],
      current: row.values[1],
      difference: Number(row.values[1].dollars || 0) - Number(row.values[0].dollars || 0)
    })).filter((row) => row.baseline.scheduled || row.current.scheduled || row.baseline.dollars || row.current.dollars);
  }

  function renderDifferenceChart(base, current, field, title) {
    let rows = differenceRows(base, current, field);
    rows = field === 'times'
      ? rows.sort((a, b) => timeSortValue(a.key) - timeSortValue(b.key))
      : rows.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.key.localeCompare(b.key));
    if (!rows.length) return `<section class="fc-panel"><h3>${escapeHtml(title)}</h3><div class="fc-chart-empty">No attributable broadcast dollars to compare.</div></section>`;

    const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(Number(row.difference || 0))));
    const body = rows.map((row) => {
      const diff = Number(row.difference || 0);
      const width = Math.max(0, Math.min(48, (Math.abs(diff) / maxAbs) * 48));
      const bar = diff > 0
        ? `<span class="fc-delta-bar positive" style="left:50%;width:${width.toFixed(2)}%"></span>`
        : diff < 0
          ? `<span class="fc-delta-bar negative" style="right:50%;width:${width.toFixed(2)}%"></span>`
          : '<span class="fc-delta-zero-dot"></span>';
      return `<div class="fc-delta-row"><div class="fc-delta-label">${escapeHtml(row.key)}</div><div class="fc-delta-track"><span class="fc-delta-center"></span>${bar}</div><div class="fc-delta-value ${diff > 0 ? 'positive' : diff < 0 ? 'negative' : ''}">${escapeHtml(signedMoney(diff))}</div></div>`;
    }).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>${escapeHtml(title)}</h3><span>${escapeHtml(current.schedule.title)} minus baseline ${escapeHtml(base.schedule.title)}</span></div></div><div class="fc-delta-chart">${body}</div></section>`;
  }

  function comparisonFindingGrid(base, current) {
    const comparable = comparableChannels(base, current);
    const difference = comparable.currentComparableTotal - comparable.baseComparableTotal;
    const similarity = comparisonSimilarity(base, current);
    const topic = biggestDifference(base, current, 'topics');
    const time = biggestDifference(base, current, 'times');
    const channels = ['Broadcast', comparable.includeOnline ? 'Online' : '', comparable.includeMail ? 'Mail' : ''].filter(Boolean).join(' + ');
    const topicGain = topic.positive ? `${topic.positive.key} ${signedMoney(topic.positive.difference)}` : '—';
    const topicLoss = topic.negative ? `${topic.negative.key} ${signedMoney(topic.negative.difference)}` : '—';
    const timeSwing = [time.positive, time.negative].filter(Boolean).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))[0];

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>${escapeHtml(current.schedule.title)} vs baseline</h3><span>${escapeHtml(base.schedule.title)}</span></div></div><div class="fc-finding-grid">
      <div class="fc-finding"><span>Comparable income</span><strong>${escapeHtml(signedMoney(difference))}</strong><small>${escapeHtml(channels)}</small></div>
      <div class="fc-finding"><span>Schedule similarity</span><strong>${Number.isFinite(similarity) ? `${Math.round(similarity * 100)}%` : '—'}</strong><small>topic + time allocation</small></div>
      <div class="fc-finding"><span>Biggest topic gain</span><strong>${escapeHtml(topicGain)}</strong></div>
      <div class="fc-finding"><span>Biggest topic loss</span><strong>${escapeHtml(topicLoss)}</strong></div>
      <div class="fc-finding"><span>Largest time-slot swing</span><strong>${timeSwing ? `${escapeHtml(timeSwing.key)} ${escapeHtml(signedMoney(timeSwing.difference))}` : '—'}</strong></div>
    </div></section>`;
  }

  function selectedAnalyses() {
    return [...state.selectedIds]
      .map((id) => state.schedules.find((schedule) => schedule.id === id))
      .filter(Boolean)
      .map(analyzeSchedule);
  }

  function filteredSchedules() {
    return state.schedules.filter((schedule) => state.season === 'all' || schedule.season === state.season);
  }

  function renderPicker() {
    const host = root();
    if (!host) return;

    const list = filteredSchedules();
    const selectedCount = state.selectedIds.size;
    if (state.baselineId && !state.selectedIds.has(state.baselineId)) state.baselineId = '';

    const rows = list.map((schedule) => `<label class="fc-drive-option"><input type="checkbox" value="${escapeHtml(schedule.id)}" ${state.selectedIds.has(schedule.id) ? 'checked' : ''}><span><strong>${escapeHtml(schedule.title)}</strong><small>${escapeHtml(formatDateRange(schedule))}</small></span></label>`).join('');
    const analyses = selectedAnalyses();
    const baseline = state.baselineId ? analyses.find((analysis) => analysis.schedule.id === state.baselineId) || null : null;
    const baselineOptions = analyses.map((analysis) => `<option value="${escapeHtml(analysis.schedule.id)}" ${state.baselineId === analysis.schedule.id ? 'selected' : ''}>${escapeHtml(analysis.schedule.title)} · ${escapeHtml(String(analysis.schedule.year || ''))}</option>`).join('');

    const comparison = analyses.length < 2
      ? '<div class="fc-empty"><strong>Select at least two fundraisers.</strong><span>Then choose which selected fundraiser should be the baseline.</span></div>'
      : !baseline
        ? '<div class="fc-empty fc-baseline-prompt"><strong>Choose the baseline fundraiser.</strong><span>Difference charts stay hidden until you make that decision.</span></div>'
        : renderComparison(analyses, baseline);

    host.innerHTML = `<style>${styles()}</style>
      <section class="fc-shell">
        <header class="fc-head"><div><div class="fc-kicker">Admin-only development workspace</div><h2>Fundraiser Comparison Lab</h2><div class="fc-subtitle">Graph-first comparison of schedule mix, time placement, and attributable broadcast results.</div></div><span class="fc-beta">EARLY BETA</span></header>
        <section class="fc-controls">
          <label><span>Pledge season</span><select id="fc-season"><option value="all">All pledge seasons</option>${SEASONS.map((season) => `<option value="${season}" ${state.season === season ? 'selected' : ''}>${season}</option>`).join('')}</select></label>
          <label class="fc-baseline-control"><span>Baseline fundraiser</span><select id="fc-baseline" ${analyses.length < 2 ? 'disabled' : ''}><option value="">Choose baseline…</option>${baselineOptions}</select></label>
          <div class="fc-selection-note">${number(selectedCount)} fundraiser${selectedCount === 1 ? '' : 's'} selected</div>
          <button type="button" id="fc-clear">Clear selection</button>
          <button type="button" id="fc-reload">Reload data</button>
        </section>
        <div class="fc-layout"><aside class="fc-picker"><h3>Choose fundraisers</h3><div class="fc-drive-list">${rows || '<div class="fc-chart-empty">No saved fundraisers match this season.</div>'}</div></aside><main class="fc-results">${comparison}</main></div>
      </section>`;

    host.querySelector('#fc-season')?.addEventListener('change', (event) => {
      state.season = event.target.value || 'all';
      state.selectedIds.clear();
      state.baselineId = '';
      renderPicker();
    });
    host.querySelector('#fc-baseline')?.addEventListener('change', (event) => {
      state.baselineId = event.target.value || '';
      renderPicker();
    });
    host.querySelector('#fc-clear')?.addEventListener('click', () => {
      state.selectedIds.clear();
      state.baselineId = '';
      renderPicker();
    });
    host.querySelector('#fc-reload')?.addEventListener('click', () => {
      state.ready = false;
      void ensureReady({ force: true });
    });
    host.querySelectorAll('.fc-drive-option input').forEach((input) => input.addEventListener('change', () => {
      if (input.checked) state.selectedIds.add(input.value);
      else {
        state.selectedIds.delete(input.value);
        if (state.baselineId === input.value) state.baselineId = '';
      }
      renderPicker();
    }));
  }

  function renderComparison(analyses, baseline) {
    const ordered = [baseline, ...analyses.filter((analysis) => analysis.schedule.id !== baseline.schedule.id)];
    const comparisons = ordered.slice(1);
    const cards = ordered.map((analysis) => `<article class="fc-summary-card ${analysis.schedule.id === baseline.schedule.id ? 'baseline' : ''}"><div class="fc-card-kicker">${analysis.schedule.id === baseline.schedule.id ? 'Baseline' : 'Compared fundraiser'}</div><h3>${escapeHtml(analysis.schedule.title)}</h3><div class="fc-total">${money(analysis.broadcastDollars)}</div><div class="fc-total-label">Broadcast $</div><div class="fc-mini"><span>Online ${analysis.onlineTracked ? money(analysis.onlineDollars) : 'not tracked'}</span><span>Mail ${analysis.mailTracked ? money(analysis.mailDollars) : 'not tracked'}</span><span>Recorded total ${money(analysis.recordedTotal)}</span><span>${number(analysis.completed)} of ${number(analysis.scheduled)} program results</span></div></article>`).join('');
    const findings = comparisons.map((analysis) => comparisonFindingGrid(baseline, analysis)).join('');
    const deltas = comparisons.map((analysis) => `<section class="fc-difference-pair"><div class="fc-difference-title"><strong>${escapeHtml(analysis.schedule.title)}</strong><span>minus baseline ${escapeHtml(baseline.schedule.title)}</span></div><div class="fc-difference-grid">${renderDifferenceChart(baseline, analysis, 'topics', 'Topic income difference')}${renderDifferenceChart(baseline, analysis, 'times', 'Time-slot income difference')}</div></section>`).join('');

    return `<div class="fc-summary-grid">${cards}</div>
      ${renderTopicScheduleMix(ordered)}
      ${renderTimeScheduleMix(ordered)}
      ${renderTopicHeatmap(ordered)}
      <section class="fc-section-label"><strong>Key comparison findings</strong><span>Dollar swings are attributable broadcast results unless the tile explicitly says comparable income.</span></section>
      ${findings}
      <section class="fc-section-label"><strong>Revenue difference vs baseline</strong><span>Right of zero = higher than baseline. Left of zero = lower than baseline.</span></section>
      ${deltas}
      <div class="fc-note-grid"><div class="fc-note-card"><strong>Channel rule</strong><span>Online $0 and Mail $0 = not tracked. Those channels enter a pairwise comparison only when both fundraisers have a recorded value above $0.</span></div><div class="fc-note-card"><strong>Weather</strong><span>Not wired in yet. External factors remain separate until the schedule/result decomposition is trustworthy.</span></div></div>`;
  }

  function styles() {
    return `
      .fc-shell{padding:18px;max-width:1500px;margin:0 auto;color:#1e3140}.fc-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;background:#fff;border:1px solid #d6e4ea;border-radius:18px;padding:16px;margin-bottom:12px}.fc-head h2{margin:2px 0 4px;color:#0c3159}.fc-subtitle{color:#5f7383;margin-top:4px}.fc-kicker{font-size:.72rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#12867f}.fc-beta{font-size:.72rem;font-weight:900;border-radius:999px;background:#fff8e8;color:#765400;padding:5px 9px;border:1px solid #ead69e}.fc-controls{display:flex;gap:10px;align-items:end;flex-wrap:wrap;background:#fff;border:1px solid #d6e4ea;border-radius:16px;padding:12px;margin-bottom:12px}.fc-controls label{display:grid;gap:4px}.fc-controls label span{font-size:.72rem;font-weight:900;text-transform:uppercase;color:#5f7383}.fc-controls select,.fc-controls button{border:1px solid #d6e4ea;border-radius:10px;padding:8px 10px;background:#fff;color:#103a66;font:inherit}.fc-controls select:disabled{opacity:.55}.fc-baseline-control{min-width:260px}.fc-selection-note{font-weight:800;color:#103a66;padding:8px}.fc-layout{display:grid;grid-template-columns:minmax(250px,330px) minmax(0,1fr);gap:12px;align-items:start}.fc-picker,.fc-panel{background:#fff;border:1px solid #d6e4ea;border-radius:16px;padding:13px}.fc-picker{position:sticky;top:8px}.fc-picker h3,.fc-panel h3{margin:0 0 9px;color:#0c3159}.fc-drive-list{display:grid;gap:6px;max-height:70vh;overflow:auto}.fc-drive-option{display:flex;gap:8px;align-items:flex-start;padding:8px;border:1px solid #e0ebef;border-radius:10px;background:#f8fbfc;cursor:pointer}.fc-drive-option input{margin-top:3px}.fc-drive-option span{display:grid;gap:2px}.fc-drive-option small{color:#5f7383}.fc-results{display:grid;gap:12px;min-width:0}.fc-empty{background:#fff;border:1px dashed #b9d3df;border-radius:16px;padding:22px;color:#5f7383;display:grid;gap:4px}.fc-empty strong{color:#103a66}.fc-baseline-prompt{border-color:#d7c37f;background:#fffdf6}.fc-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:9px}.fc-summary-card{background:#fff;border:1px solid #d6e4ea;border-radius:15px;padding:12px}.fc-summary-card.baseline{border-color:#12867f;background:#f1faf8}.fc-card-kicker{font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;font-weight:900;color:#5f7383}.fc-summary-card h3{margin:3px 0 6px;color:#103a66}.fc-total{font-size:1.5rem;font-weight:950;color:#1d5f96}.fc-total-label{font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;font-weight:900;color:#5f7383;margin-top:-2px}.fc-mini{display:grid;gap:2px;margin-top:6px;font-size:.8rem;color:#5f7383}.fc-panel-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}.fc-panel-head h3{margin:0}.fc-panel-head span{display:block;color:#5f7383;font-size:.78rem;margin-top:2px}.fc-chart-empty{color:#5f7383;padding:10px 0}.fc-stack-chart{display:grid;gap:9px}.fc-stack-row{display:grid;grid-template-columns:minmax(150px,220px) minmax(260px,1fr) 64px;gap:9px;align-items:center}.fc-stack-label{display:grid;gap:2px}.fc-stack-label span{font-size:.72rem;color:#5f7383}.fc-stack-track{height:30px;background:#e6eef2;border-radius:8px;overflow:hidden;display:flex}.fc-stack-segment{height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:.7rem;font-weight:900;min-width:1px}.fc-stack-total{text-align:right;font-weight:900;color:#103a66}.fc-legend{display:flex;flex-wrap:wrap;gap:7px 12px;margin:8px 0 4px}.fc-legend-item{display:inline-flex;align-items:center;gap:5px;color:#5f7383;font-size:.74rem}.fc-legend-item i{width:10px;height:10px;border-radius:3px;display:inline-block}.fc-grouped-chart{display:grid;gap:8px}.fc-grouped-row{display:grid;grid-template-columns:76px minmax(0,1fr);gap:10px;align-items:start}.fc-grouped-label{font-weight:900;color:#103a66;padding-top:3px}.fc-grouped-series{display:grid;gap:4px}.fc-grouped-item{display:grid;grid-template-columns:minmax(0,1fr) 58px;gap:7px;align-items:center}.fc-grouped-item b{font-size:.72rem;color:#5f7383;text-align:right}.fc-grouped-track{height:9px;background:#e6eef2;border-radius:999px;overflow:hidden}.fc-grouped-track span{display:block;height:100%;border-radius:999px}.fc-table-wrap{overflow:auto}.fc-heatmap{width:100%;border-collapse:collapse;font-size:.82rem}.fc-heatmap th,.fc-heatmap td{padding:8px;border-bottom:1px solid #e2ecef;text-align:left;vertical-align:middle}.fc-heatmap thead th{background:#eef7fb;color:#103a66}.fc-heatmap th span{display:block;font-size:.7rem;color:#5f7383;margin-top:2px}.fc-heatmap tbody th{background:#f8fbfc;white-space:nowrap}.fc-heat-cell,.fc-heat-zero{text-align:center!important;font-weight:900;min-width:110px}.fc-heat-zero{background:#f5f8f9;color:#8ca0ad}.fc-heat-dark{color:#fff}.fc-heat-scale{display:flex;align-items:center;gap:5px;color:#5f7383;font-size:.7rem}.fc-heat-scale i{width:78px;height:10px;border-radius:999px;background:linear-gradient(90deg,rgba(29,95,150,.10),rgba(29,95,150,.82))}.fc-section-label{display:flex;justify-content:space-between;gap:12px;align-items:end;padding:4px 2px}.fc-section-label strong{color:#0c3159}.fc-section-label span{color:#5f7383;font-size:.76rem;text-align:right}.fc-finding-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}.fc-finding{background:#f5fafc;border:1px solid #d9e7ec;border-radius:12px;padding:9px;display:grid;gap:3px}.fc-finding span{font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;font-weight:900;color:#5f7383}.fc-finding strong{color:#103a66;font-size:1rem}.fc-finding small{color:#5f7383}.fc-difference-pair{display:grid;gap:8px}.fc-difference-title{display:flex;justify-content:space-between;gap:10px;align-items:baseline;color:#103a66}.fc-difference-title span{color:#5f7383;font-size:.76rem}.fc-difference-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fc-delta-chart{display:grid;gap:7px}.fc-delta-row{display:grid;grid-template-columns:minmax(115px,180px) minmax(180px,1fr) 78px;gap:8px;align-items:center}.fc-delta-label{font-size:.78rem;font-weight:800;color:#29465b;overflow-wrap:anywhere}.fc-delta-track{height:18px;background:#edf3f5;border-radius:5px;position:relative;overflow:hidden}.fc-delta-center{position:absolute;left:50%;top:0;bottom:0;width:1px;background:#8297a5}.fc-delta-bar{position:absolute;top:3px;bottom:3px;border-radius:4px}.fc-delta-bar.positive{background:#12867f}.fc-delta-bar.negative{background:#bf2f43}.fc-delta-zero-dot{position:absolute;left:calc(50% - 2px);top:7px;width:4px;height:4px;border-radius:50%;background:#8297a5}.fc-delta-value{text-align:right;font-size:.78rem;font-weight:900;color:#5f7383}.fc-delta-value.positive{color:#0d736d}.fc-delta-value.negative{color:#a32538}.fc-note-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fc-note-card{background:#fffdf6;border:1px solid #e7dcc0;border-radius:14px;padding:10px;display:grid;gap:3px}.fc-note-card strong{color:#6c5415}.fc-note-card span{color:#6f6550;font-size:.78rem;line-height:1.35}@media(max-width:1050px){.fc-difference-grid{grid-template-columns:1fr}}@media(max-width:850px){.fc-layout{grid-template-columns:1fr}.fc-picker{position:static}.fc-drive-list{max-height:300px}.fc-stack-row{grid-template-columns:1fr}.fc-stack-total{text-align:left}.fc-grouped-row{grid-template-columns:64px minmax(0,1fr)}.fc-note-grid{grid-template-columns:1fr}.fc-section-label{align-items:start;flex-direction:column}.fc-section-label span{text-align:left}}
    `;
  }

  async function loadData() {
    const c = client();
    if (!c) throw new Error('Fundraiser Comparison could not access the data connection.');

    const [scheduleRows, airings] = await Promise.all([
      fetchAll(App.constants?.SCHEDULES_TABLE || 'pledge_fundraiser_schedules', 'id,title,start_date,end_date,created_at,updated_at,schedule_data', 'start_date'),
      Promise.resolve(App.data?.fetchImportedAirings?.()).then((rows) => Array.isArray(rows) ? rows : [])
    ]);

    state.schedules = dedupeSchedules(scheduleRows.map(normalizeSchedule)).filter((schedule) => schedule.season && schedule.year);
    state.airings = airings;

    let libraryRows = Array.isArray(App.state?.rawRows) ? App.state.rawRows : [];
    if (!libraryRows.length) {
      libraryRows = await fetchAll(App.constants?.BASE_TABLE || 'pledge_programs_v2', 'id,title,nola_code,topic_primary,topic_secondary');
    }
    buildLibraryIndexes(libraryRows);
    state.ready = true;
  }

  async function ensureReady(options = {}) {
    const host = root();
    if (!host) return false;
    if (!App.auth?.canEdit?.()) {
      host.innerHTML = '<div class="notice-strip warn">Fundraiser Comparison is an Admin-only development workspace.</div>';
      return false;
    }
    if (state.loading) return false;

    if (!state.ready || options.force) {
      state.loading = true;
      host.innerHTML = '<div class="notice-strip">Loading fundraiser comparison data…</div>';
      try {
        await loadData();
      } catch (error) {
        console.error(error);
        host.innerHTML = `<div class="notice-strip bad">${escapeHtml(error.message || 'Could not load fundraiser comparison data.')}</div>`;
        return false;
      } finally {
        state.loading = false;
      }
    }

    renderPicker();
    return true;
  }

  App.fundraiserComparisonUi = { ensureReady };
})();

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
    libraryById: new Map(),
    libraryByTitle: new Map(),
    libraryByNola: new Map()
  };

  const text = (value) => String(value ?? '').trim();
  const lookupKey = (value) => text(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const nolaKey = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const money = (value) => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const number = (value) => Number(value || 0).toLocaleString();
  const pct = (value) => Number.isFinite(Number(value)) ? `${Math.round(Number(value))}%` : '—';
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
      const [y, m, d] = raw.split('-').map(Number);
      const date = new Date(y, m - 1, d);
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
    const fmt = (date) => date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    if (!start && !end) return 'No date range';
    if (start && end && schedule.startDate === schedule.endDate) return fmt(start);
    return `${fmt(start)} – ${fmt(end)}`;
  }

  function normalizeSchedule(row = {}) {
    const data = row.schedule_data && typeof row.schedule_data === 'object' ? row.schedule_data : {};
    return {
      id: text(row.id || data.id),
      title: text(row.title || data.title || 'Untitled fundraiser'),
      startDate: text(row.start_date || data.startDate),
      endDate: text(row.end_date || data.endDate),
      createdAt: text(row.created_at || data.createdAt),
      updatedAt: text(row.updated_at || data.updatedAt),
      placements: Array.isArray(data.placements) ? data.placements : [],
      onlineDollars: Number(data.onlineDollars ?? row.online_dollars ?? row.onlineDollars ?? 0) || 0,
      mailDollars: Number(data.mailDollars ?? row.mail_dollars ?? row.mailDollars ?? 0) || 0,
      meta: data.meta && typeof data.meta === 'object' ? data.meta : {},
      season: seasonForDate(row.start_date || data.startDate),
      year: parseDate(row.start_date || data.startDate)?.getFullYear() || ''
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
    return [...buckets.values()].map((items) => [...items].sort((a, b) => schedulePreferenceScore(b) - schedulePreferenceScore(a))[0])
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
    if (placement?.manualResultRecorded) {
      return {
        known: true,
        dollars: Number(placement.manualBroadcastDollars || 0) || 0,
        pledges: Number(placement.manualPledgeCount || 0) || 0,
        source: 'manual'
      };
    }
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
    const onlineMail = Number(schedule.onlineDollars || 0) + Number(schedule.mailDollars || 0);
    const grandTotal = broadcastDollars + onlineMail;
    return {
      schedule,
      scheduled,
      completed,
      scheduledMinutes,
      attributableDollars,
      attributablePledges,
      broadcastDollars,
      unattributedBroadcast: broadcastDollars - attributableDollars,
      onlineMail,
      grandTotal,
      topics,
      times
    };
  }

  function mapSimilarity(a = new Map(), b = new Map()) {
    const totalA = [...a.values()].reduce((sum, row) => sum + row.minutes, 0);
    const totalB = [...b.values()].reduce((sum, row) => sum + row.minutes, 0);
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

  function comparisonTable(analyses, field, label, sorter) {
    const rows = unionRows(analyses, field).sort(sorter);
    const heads = analyses.map((analysis) => `<th>${escapeHtml(analysis.schedule.title)}<br><span>${escapeHtml(String(analysis.schedule.year || ''))}</span></th>`).join('');
    const body = rows.map((row) => `<tr><td><strong>${escapeHtml(row.key)}</strong></td>${row.values.map((value) => `<td><strong>${money(value.dollars)}</strong><br><span>${number(value.scheduled)} scheduled · ${number(value.completed)} results · ${Math.round(value.minutes / 60 * 10) / 10} hr</span></td>`).join('')}</tr>`).join('');
    return `<section class="fc-panel"><h3>${escapeHtml(label)}</h3><div class="fc-table-wrap"><table><thead><tr><th>${escapeHtml(field === 'times' ? 'Start time' : 'Topic')}</th>${heads}</tr></thead><tbody>${body || '<tr><td colspan="99">No comparable rows.</td></tr>'}</tbody></table></div></section>`;
  }

  function biggestDifference(base, current, field) {
    const rows = unionRows([base, current], field).map((row) => ({ key: row.key, difference: row.values[1].dollars - row.values[0].dollars }));
    const positive = [...rows].sort((a, b) => b.difference - a.difference)[0] || null;
    const negative = [...rows].sort((a, b) => a.difference - b.difference)[0] || null;
    return { positive, negative };
  }

  function summaryRead(base, current) {
    const difference = current.grandTotal - base.grandTotal;
    const attributableDifference = current.attributableDollars - base.attributableDollars;
    const otherDifference = difference - attributableDifference;
    const similarity = comparisonSimilarity(base, current);
    const topic = biggestDifference(base, current, 'topics');
    const time = biggestDifference(base, current, 'times');
    const similarityText = Number.isFinite(similarity) ? `${Math.round(similarity * 100)}%` : 'not measurable';
    const scheduleRead = Number.isFinite(similarity) && similarity >= 0.85
      ? 'The coarse schedule mix is quite similar, so a large income gap is less likely to be explained simply by changing topic/time allocation.'
      : Number.isFinite(similarity) && similarity < 0.65
        ? 'The schedule mix changed substantially, so programming mix is a plausible contributor to the result difference.'
        : 'The schedule mix is moderately similar; both scheduling choices and within-slot performance may be contributing.';
    return `<article class="fc-read"><h3>${escapeHtml(current.schedule.title)} vs ${escapeHtml(base.schedule.title)}</h3>
      <p><strong>Total difference:</strong> ${signedMoney(difference)}. <strong>Program-attributable broadcast difference:</strong> ${signedMoney(attributableDifference)}. <strong>Everything not assigned to individual scheduled programs:</strong> ${signedMoney(otherDifference)}.</p>
      <p><strong>Schedule similarity:</strong> ${escapeHtml(similarityText)}. ${escapeHtml(scheduleRead)}</p>
      <p><strong>Largest topic swing:</strong> ${escapeHtml(topic.positive?.key || '—')} ${topic.positive ? signedMoney(topic.positive.difference) : '—'}${topic.negative && topic.negative.key !== topic.positive?.key ? `; weakest swing: ${escapeHtml(topic.negative.key)} ${signedMoney(topic.negative.difference)}` : ''}.</p>
      <p><strong>Largest start-time swing:</strong> ${escapeHtml(time.positive?.key || '—')} ${time.positive ? signedMoney(time.positive.difference) : '—'}${time.negative && time.negative.key !== time.positive?.key ? `; weakest swing: ${escapeHtml(time.negative.key)} ${signedMoney(time.negative.difference)}` : ''}.</p>
    </article>`;
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
    const rows = list.map((schedule) => `<label class="fc-drive-option"><input type="checkbox" value="${escapeHtml(schedule.id)}" ${state.selectedIds.has(schedule.id) ? 'checked' : ''}><span><strong>${escapeHtml(schedule.title)}</strong><small>${escapeHtml(formatDateRange(schedule))}</small></span></label>`).join('');
    const analyses = selectedAnalyses();
    const comparison = analyses.length >= 2 ? renderComparison(analyses) : `<div class="fc-empty">Select at least two fundraisers. The first selected fundraiser becomes the baseline for the plain-English comparisons.</div>`;
    host.innerHTML = `<style>${styles()}</style>
      <section class="fc-shell">
        <header class="fc-head"><div><div class="fc-kicker">Admin-only development workspace</div><h2>Fundraiser Comparison Lab</h2><p>This is intentionally separate from Performance Analytics while the difference-explainer is being built.</p></div><span class="fc-beta">EARLY BETA</span></header>
        <section class="fc-controls">
          <label><span>Pledge season</span><select id="fc-season"><option value="all">All pledge seasons</option>${SEASONS.map((season) => `<option value="${season}" ${state.season === season ? 'selected' : ''}>${season}</option>`).join('')}</select></label>
          <div class="fc-selection-note">${number(selectedCount)} fundraiser${selectedCount === 1 ? '' : 's'} selected</div>
          <button type="button" id="fc-clear">Clear selection</button>
          <button type="button" id="fc-reload">Reload data</button>
        </section>
        <div class="fc-layout"><aside class="fc-picker"><h3>Choose fundraisers</h3><div class="fc-drive-list">${rows || '<p>No saved fundraisers match this season.</p>'}</div></aside><main class="fc-results">${comparison}</main></div>
      </section>`;

    host.querySelector('#fc-season')?.addEventListener('change', (event) => { state.season = event.target.value || 'all'; renderPicker(); });
    host.querySelector('#fc-clear')?.addEventListener('click', () => { state.selectedIds.clear(); renderPicker(); });
    host.querySelector('#fc-reload')?.addEventListener('click', () => { state.ready = false; void ensureReady({ force: true }); });
    host.querySelectorAll('.fc-drive-option input').forEach((input) => input.addEventListener('change', () => {
      if (input.checked) state.selectedIds.add(input.value); else state.selectedIds.delete(input.value);
      renderPicker();
    }));
  }

  function renderComparison(analyses) {
    const base = analyses[0];
    const cards = analyses.map((analysis, index) => `<article class="fc-summary-card ${index === 0 ? 'baseline' : ''}"><div class="fc-card-kicker">${index === 0 ? 'Baseline' : 'Compared fundraiser'}</div><h3>${escapeHtml(analysis.schedule.title)}</h3><div class="fc-total">${money(analysis.grandTotal)}</div><div class="fc-mini"><span>Broadcast ${money(analysis.broadcastDollars)}</span><span>Online + mail ${money(analysis.onlineMail)}</span><span>${number(analysis.completed)} of ${number(analysis.scheduled)} program results</span></div></article>`).join('');
    const reads = analyses.slice(1).map((analysis) => summaryRead(base, analysis)).join('');
    const topicTable = comparisonTable(analyses, 'topics', 'Topic contribution', (a, b) => Math.max(...b.values.map((value) => value.dollars)) - Math.max(...a.values.map((value) => value.dollars)) || a.key.localeCompare(b.key));
    const timeTable = comparisonTable(analyses, 'times', 'Start-time contribution', (a, b) => {
      const parse = (label) => {
        const match = label.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/);
        if (!match) return 99999;
        let hour = Number(match[1]) % 12;
        if (match[3] === 'PM') hour += 12;
        return hour * 60 + Number(match[2]);
      };
      return parse(a.key) - parse(b.key);
    });
    return `<div class="fc-summary-grid">${cards}</div>
      <section class="fc-explainer"><h3>What appears to be driving the difference?</h3>${reads}</section>
      ${topicTable}${timeTable}
      <section class="fc-weather"><h3>External factors</h3><p><strong>Weather is not wired in yet.</strong> This first pass deliberately leaves it out until the programming/result decomposition is trustworthy. Weather and other contextual data will be added as a separate explanatory layer, not treated as automatic causation.</p></section>`;
  }

  function styles() {
    return `
      .fc-shell{padding:18px;max-width:1500px;margin:0 auto;color:#1e3140}.fc-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;background:#fff;border:1px solid #d6e4ea;border-radius:18px;padding:16px;margin-bottom:12px}.fc-head h2{margin:2px 0 4px;color:#0c3159}.fc-head p{margin:0;color:#5f7383}.fc-kicker{font-size:.72rem;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#12867f}.fc-beta{font-size:.72rem;font-weight:900;border-radius:999px;background:#fff8e8;color:#765400;padding:5px 9px;border:1px solid #ead69e}.fc-controls{display:flex;gap:10px;align-items:end;flex-wrap:wrap;background:#fff;border:1px solid #d6e4ea;border-radius:16px;padding:12px;margin-bottom:12px}.fc-controls label{display:grid;gap:4px}.fc-controls label span{font-size:.72rem;font-weight:900;text-transform:uppercase;color:#5f7383}.fc-controls select,.fc-controls button{border:1px solid #d6e4ea;border-radius:10px;padding:8px 10px;background:#fff;color:#103a66;font:inherit}.fc-selection-note{font-weight:800;color:#103a66;padding:8px}.fc-layout{display:grid;grid-template-columns:minmax(250px,330px) minmax(0,1fr);gap:12px;align-items:start}.fc-picker,.fc-panel,.fc-explainer,.fc-weather{background:#fff;border:1px solid #d6e4ea;border-radius:16px;padding:13px}.fc-picker{position:sticky;top:8px}.fc-picker h3,.fc-panel h3,.fc-explainer h3,.fc-weather h3{margin:0 0 9px;color:#0c3159}.fc-drive-list{display:grid;gap:6px;max-height:70vh;overflow:auto}.fc-drive-option{display:flex;gap:8px;align-items:flex-start;padding:8px;border:1px solid #e0ebef;border-radius:10px;background:#f8fbfc;cursor:pointer}.fc-drive-option input{margin-top:3px}.fc-drive-option span{display:grid;gap:2px}.fc-drive-option small{color:#5f7383}.fc-results{display:grid;gap:12px;min-width:0}.fc-empty{background:#fff;border:1px dashed #b9d3df;border-radius:16px;padding:22px;color:#5f7383}.fc-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:9px}.fc-summary-card{background:#fff;border:1px solid #d6e4ea;border-radius:15px;padding:12px}.fc-summary-card.baseline{border-color:#12867f;background:#f1faf8}.fc-card-kicker{font-size:.7rem;text-transform:uppercase;letter-spacing:.07em;font-weight:900;color:#5f7383}.fc-summary-card h3{margin:3px 0 6px;color:#103a66}.fc-total{font-size:1.5rem;font-weight:950;color:#1d5f96}.fc-mini{display:grid;gap:2px;margin-top:6px;font-size:.8rem;color:#5f7383}.fc-read{border-top:1px solid #e3edf0;padding-top:10px;margin-top:10px}.fc-read:first-of-type{border-top:0;padding-top:0;margin-top:0}.fc-read h3{font-size:1rem;margin-bottom:4px}.fc-read p{margin:5px 0;line-height:1.42}.fc-table-wrap{overflow:auto}.fc-panel table{width:100%;border-collapse:collapse;font-size:.84rem}.fc-panel th,.fc-panel td{padding:8px;border-bottom:1px solid #e2ecef;text-align:left;vertical-align:top;min-width:130px}.fc-panel th{background:#eef7fb;color:#103a66;position:sticky;top:0}.fc-panel td span,.fc-panel th span{font-size:.74rem;color:#5f7383;font-weight:500}.fc-weather{background:#fffdf6}.fc-weather p{margin:0;line-height:1.45;color:#5f7383}@media(max-width:850px){.fc-layout{grid-template-columns:1fr}.fc-picker{position:static}.fc-drive-list{max-height:300px}}
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

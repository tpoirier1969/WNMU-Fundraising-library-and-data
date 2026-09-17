(() => {
  'use strict';

  const A = globalThis.WNMUOneSheetAnalysis;
  const S = globalThis.WNMUProgrammingStrategyAnalysis;
  const cfg = globalThis.PLEDGE_MANAGER_CONFIG || {};
  const state = { client: null, schedules: [], airings: [], library: [], indexes: null, overrides: [], selectedScheduleId: '' };
  const $ = (selector) => document.querySelector(selector);

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(value, includeYear = true) {
    const date = S.parseDate(value);
    if (!date) return escapeHtml(String(value || '—'));
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: includeYear ? 'numeric' : undefined });
  }

  function clock(minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value)) return '—';
    const normalized = ((value % 1440) + 1440) % 1440;
    const hour24 = Math.floor(normalized / 60);
    const minute = normalized % 60;
    return `${hour24 % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${hour24 >= 12 ? 'PM' : 'AM'}`;
  }

  function setStatus(message, tone = '') {
    const node = $('#strategy-status');
    if (!node) return;
    node.textContent = message || '';
    node.className = `strategy-status${tone ? ` ${tone}` : ''}`;
  }

  function makeClient() {
    if (!globalThis.supabase?.createClient) throw new Error('Supabase library did not load.');
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) throw new Error('Supabase configuration is missing.');
    return globalThis.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  async function requireAdmin() {
    state.client = makeClient();
    const { data, error } = await state.client.auth.getSession();
    if (error) throw error;
    const session = data?.session || null;
    const email = String(session?.user?.email || '').trim().toLowerCase();
    const admins = Array.isArray(cfg.ADMIN_EMAILS) ? cfg.ADMIN_EMAILS.map((item) => String(item).trim().toLowerCase()).filter(Boolean) : [];
    const allowed = Boolean(session && (!admins.length || admins.includes(email)));
    if (allowed) {
      $('#strategy-app')?.classList.remove('hidden');
      const role = $('#strategy-role');
      if (role) role.textContent = email ? `Admin · ${email}` : 'Admin';
      return true;
    }
    $('#strategy-app')?.classList.add('hidden');
    const gate = $('#strategy-access-gate');
    if (gate) {
      gate.classList.remove('hidden');
      gate.innerHTML = `<div class="report-gate-card"><div class="report-kicker">Admin report center</div><h1>Admin access required</h1><p>${escapeHtml(session ? `${email || 'This account'} does not have administrator report access.` : 'Sign in as an administrator from the Pledge Program Library, then return to this report.')}</p><a class="report-button primary" href="./">Open Pledge Program Library</a></div>`;
    }
    return false;
  }

  async function fetchAll(table, select = '*', orderField = '') {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      let query = state.client.from(table).select(select).range(from, from + 999);
      if (orderField) query = query.order(orderField, { ascending: true });
      const { data, error } = await query;
      if (error) throw error;
      const chunk = Array.isArray(data) ? data : [];
      rows.push(...chunk);
      if (chunk.length < 1000) break;
    }
    return rows;
  }

  async function fetchOptional(table) {
    try { return await fetchAll(table); }
    catch (error) { console.warn(`Optional report source ${table} is unavailable.`, error); return []; }
  }

  async function loadData() {
    if (!A || !S) throw new Error('Programming strategy analysis modules did not load.');
    setStatus('Loading fundraiser history and Program Library…');
    const [schedules, airings, library, overrides] = await Promise.all([
      fetchAll('pledge_fundraiser_schedules', 'id,title,start_date,end_date,created_at,updated_at,schedule_data', 'start_date'),
      fetchAll('pledge_program_airings_v2', '*', 'air_date'),
      fetchAll('pledge_programs_v2'),
      fetchOptional('pledge_program_editorial_overrides')
    ]);
    state.schedules = A.prepareSchedules(schedules.map(A.normalizeSchedule)).filter((item) => item.startDate && item.endDate && !item.reportOnly).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    state.airings = A.canonicalizeImportedAirings ? A.canonicalizeImportedAirings(airings) : airings;
    state.library = library;
    state.indexes = A.buildLibraryIndexes(library);
    state.overrides = overrides;
    setStatus(`${state.schedules.length} saved fundraiser${state.schedules.length === 1 ? '' : 's'} · ${library.length} Program Library titles.`);
  }

  function todayStart() { const date = new Date(); date.setHours(0, 0, 0, 0); return date; }

  function defaultSchedule() {
    const today = todayStart();
    return state.schedules.find((item) => S.parseDate(item.endDate) >= today) || state.schedules.at(-1) || null;
  }

  function scheduleLabel(schedule) {
    const upcoming = S.parseDate(schedule.startDate) >= todayStart();
    return `${schedule.title} · ${formatDate(schedule.startDate)}–${formatDate(schedule.endDate, false)} · ${upcoming ? 'Upcoming' : 'Past'}`;
  }

  function renderControls() {
    const select = $('#strategy-fundraiser');
    if (!select) return;
    select.innerHTML = state.schedules.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(scheduleLabel(item))}</option>`).join('');
    const initial = defaultSchedule();
    if (initial) { state.selectedScheduleId = initial.id; select.value = initial.id; }
    select.addEventListener('change', () => { state.selectedScheduleId = select.value; renderStrategy(); });
    $('#strategy-print')?.addEventListener('click', () => window.print());
  }

  function selectedSchedule() { return state.schedules.find((item) => String(item.id) === String(state.selectedScheduleId)) || null; }

  function evidenceFor(schedule) {
    const cutoff = S.evidenceCutoff(schedule);
    const cutoffAirings = S.filterEvidenceAirings(state.airings, cutoff);
    const authoritative = state.schedules.filter((item) => String(item.id) !== String(schedule.id) && S.parseDate(item.startDate) < S.parseDate(cutoff));
    const reportOnly = typeof A.reportOnlySchedulesFromAirings === 'function' ? A.reportOnlySchedulesFromAirings(authoritative, cutoffAirings, state.indexes) : [];
    const history = [...authoritative, ...reportOnly].filter((item) => S.parseDate(item.startDate) < S.parseDate(cutoff));
    const analyses = history.map((item) => A.analyzeSchedule(item, cutoffAirings, state.indexes));
    return A.historicalRows(analyses);
  }

  function topicPill(item) {
    return `<span class="strategy-pill"><strong>${escapeHtml(item.topic)}</strong><small>${escapeHtml(item.confidence || '')}</small></span>`;
  }

  function recommendationHtml(item) {
    const flags = [];
    if (item.local) flags.push('Local / U.P.');
    if (item.season?.holidayInWindow) flags.push(item.season.holidayCategory || 'Seasonal fit');
    if (item.drama?.currentCycle) flags.push('Current Drama Doc');
    if (item.premiumPresent) flags.push('Premium info');
    if (item.programmer?.rating) flags.push(`Programmer: ${item.programmer.label}`);
    return `<article class="strategy-title-card"><div class="strategy-title-card-head"><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.topic)}</span></div><div class="strategy-score"><b>${Math.round(item.score)}</b><small>${escapeHtml(item.fit)}</small></div></div><div class="strategy-title-meta">Evidence: ${escapeHtml(item.confidence)}${flags.length ? ` · ${flags.map(escapeHtml).join(' · ')}` : ''}</div><p>${escapeHtml(item.reasons.slice(0, 2).join(' '))}</p>${item.cautions.length ? `<div class="strategy-caution">${escapeHtml(item.cautions.slice(0, 2).join(' '))}</div>` : ''}</article>`;
  }

  function mixSection(strategy) {
    if (!strategy.mix.length) return '<section class="sheet-section"><h2>Overall recommended mix</h2><p>No defensible mix could be calculated from the current eligible library and pre-cutoff evidence.</p></section>';
    return `<section class="sheet-section"><h2>Overall recommended mix</h2><p>Qualitative planning signal from the strongest eligible titles across normal pledge windows. No percentage quotas are implied.</p><div class="strategy-mix-grid">${strategy.mix.slice(0, 10).map((item) => `<div class="strategy-mix-card"><strong>${escapeHtml(item.topic)}</strong><span class="strategy-strength strength-${escapeHtml(item.strength.toLowerCase())}">${escapeHtml(item.strength)}</span><small>${item.appearances} strong-slot appearance${item.appearances === 1 ? '' : 's'} · avg score ${Math.round(item.averageScore)}</small></div>`).join('')}</div></section>`;
  }

  function groupedDayparts(strategy) {
    const groups = new Map();
    strategy.windows.filter((slot) => !slot.experimental && !slot.blocked).forEach((slot) => {
      const key = `${slot.weekday}|${slot.label}`;
      const group = groups.get(key) || { weekday: slot.weekday, label: slot.label, scores: [], topics: new Map(), samples: 0 };
      slot.recommendations.slice(0, 3).forEach((item) => { group.scores.push(item.score); group.topics.set(item.topic, (group.topics.get(item.topic) || 0) + 1); });
      group.samples += slot.evidenceRows;
      groups.set(key, group);
    });
    return [...groups.values()].map((group) => ({ ...group, average: group.scores.length ? group.scores.reduce((a, b) => a + b, 0) / group.scores.length : 0, topTopics: [...group.topics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([topic]) => topic) })).sort((a, b) => b.average - a.average || b.samples - a.samples);
  }

  function daypartSection(strategy) {
    const strengths = groupedDayparts(strategy);
    const experiments = strategy.windows.filter((slot) => slot.experimental);
    return `<section class="sheet-section strategy-two-column"><div><h2>Strongest day/time patterns</h2>${strengths.slice(0, 8).map((item) => `<div class="strategy-line"><strong>${escapeHtml(item.weekday)} ${escapeHtml(item.label)}</strong><span>${escapeHtml(item.topTopics.join(' / ') || 'No eligible topic signal')} · avg top-candidate score ${Math.round(item.average)}${item.samples ? ` · ${item.samples} comparable historical row${item.samples === 1 ? '' : 's'}` : ' · thin direct history'}</span></div>`).join('') || '<p>No normal-window signal available.</p>'}</div><div><h2>Underutilized opportunities</h2>${experiments.map((slot) => `<div class="strategy-line experimental"><strong>${escapeHtml(slot.weekday)} ${formatDate(slot.date, false)} · ${clock(slot.startMinutes)}–${clock(slot.endMinutes)}</strong><span>Experimental slot · ${escapeHtml(slot.strongestTopics.slice(0, 3).map((item) => item.topic).join(' / ') || 'thin evidence')} · kept separate from established windows.</span></div>`).join('') || '<p>No experimental window identified.</p>'}</div></section>`;
  }

  function dayMapSection(strategy) {
    const byDate = new Map();
    strategy.windows.forEach((slot) => { if (!byDate.has(slot.date)) byDate.set(slot.date, []); byDate.get(slot.date).push(slot); });
    return `<section class="sheet-section"><h2>Day-by-day programming map</h2><div class="strategy-days">${[...byDate.entries()].map(([date, slots]) => `<section class="strategy-day"><header><div><strong>${escapeHtml(slots[0].weekday)}</strong><span>${formatDate(date)}</span></div></header>${slots.map((slot) => `<div class="strategy-slot ${slot.experimental ? 'is-experimental' : ''} ${slot.blocked ? 'is-blocked' : ''}"><div class="strategy-slot-head"><div><strong>${clock(slot.startMinutes)}–${clock(slot.endMinutes)} · ${escapeHtml(slot.label)}</strong><span class="strategy-slot-badge">${slot.blocked ? 'Protected / unavailable' : slot.experimental ? 'Experimental opportunity' : 'Normal pledge window'}</span></div><small>${slot.blocked ? 'Not pledge inventory' : slot.evidenceRows ? `${slot.evidenceRows} comparable historical row${slot.evidenceRows === 1 ? '' : 's'}` : 'thin direct slot evidence'}</small></div>${slot.blocked ? '<p class="strategy-blocked-note">Friday 8–9 PM is intentionally excluded from pledge recommendations.</p>' : `<div class="strategy-topic-row"><span>Strong topic fits</span>${slot.strongestTopics.length ? slot.strongestTopics.map(topicPill).join('') : '<em>No strong topic signal</em>'}</div>${slot.alternativeTopics.length ? `<div class="strategy-topic-row secondary"><span>Alternatives</span>${slot.alternativeTopics.map(topicPill).join('')}</div>` : ''}<div class="strategy-title-grid">${slot.recommendations.slice(0, 4).map(recommendationHtml).join('') || '<p>No eligible Program Library title for this slot.</p>'}</div>`}</div>`).join('')}</section>`).join('')}</div></section>`;
  }

  function compactList(items, renderer, emptyText) {
    return items?.length ? `<div class="strategy-compact-list">${items.map(renderer).join('')}</div>` : `<p>${escapeHtml(emptyText)}</p>`;
  }

  function supportingSections(strategy) {
    return `<section class="sheet-section strategy-two-column"><div><h2>Repeat candidates</h2>${compactList(strategy.repeats, (item) => `<div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.topic)} · score ${Math.round(item.score)} · strong prime candidate on ${item.slots.length} separated days. Consider at most two planned prime uses.</span></div>`, 'No repeat candidate clears the threshold.')}<h2>Seasonal opportunities</h2>${compactList(strategy.seasonal, (item) => `<div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.topic)} · ${escapeHtml(item.season.notes.join(' ') || `${item.season.targetSeason} seasonal support`)}</span></div>`, 'No distinct seasonal opportunity identified.')}</div><div><h2>Local / U.P. opportunities</h2>${compactList(strategy.local, (item) => `<div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.topic)} · best-window score ${Math.round(item.score)} · ${escapeHtml(item.fit)}</span></div>`, 'No eligible Local / U.P. title identified.')}<h2>Titles to avoid / rest</h2>${compactList(strategy.avoid, (item) => `<div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.reasons.join(' · '))}</span></div>`, 'No title needs a prominent rest/avoid caution.')}</div></section>`;
  }

  function rightsSection(strategy) {
    const describe = (item) => `${item.rightsStart ? `Starts ${formatDate(item.rightsStart)}` : ''}${item.rightsStart && item.rightsEnd ? ' · ' : ''}${item.rightsEnd ? `Ends ${formatDate(item.rightsEnd)}` : ''}`;
    return `<section class="sheet-section strategy-two-column"><div><h2>Rights constraints</h2><p>${strategy.rights.unavailable.length} Library title${strategy.rights.unavailable.length === 1 ? '' : 's'} cannot air anywhere in this fundraiser.</p>${compactList(strategy.rights.unavailable.slice(0, 20), (item) => `<div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(describe(item))}</span></div>`, 'No fully unavailable title detected.')}</div><div><h2>Partial-drive rights</h2><p>${strategy.rights.partial.length} title${strategy.rights.partial.length === 1 ? '' : 's'} can be used for only part of the drive. Slot recommendations enforce date-specific rights.</p>${compactList(strategy.rights.partial.slice(0, 20), (item) => `<div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(describe(item))}</span></div>`, 'No partial-drive rights restriction detected.')}</div></section>`;
  }

  function limitationsSection(strategy) {
    return `<section class="sheet-section"><h2>Evidence confidence & limitations</h2><div class="strategy-facts"><div><strong>${strategy.evidenceRows.toLocaleString()}</strong><span>pre-cutoff historical program rows</span></div><div><strong>${strategy.evidenceFundraisers.toLocaleString()}</strong><span>historical fundraiser/event groups</span></div><div><strong>${strategy.eligibleTitles.toLocaleString()}</strong><span>Library titles usable somewhere in the drive</span></div></div><ul class="strategy-limitations">${strategy.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}<li>${escapeHtml(strategy.peerEvidence.note)}</li></ul><p class="strategy-premium-note"><strong>Premiums:</strong> saved premium summaries are context only; premium effectiveness is not inferred from incomplete order data.</p></section>`;
  }

  function renderStrategy() {
    const schedule = selectedSchedule();
    const output = $('#strategy-output');
    if (!schedule || !output) { if (output) output.innerHTML = '<div class="report-empty">No saved fundraiser is available.</div>'; return; }
    setStatus('Calculating pre-drive strategy…');
    try {
      const strategy = S.buildStrategy({ schedule, library: state.library, evidenceRows: evidenceFor(schedule), overrides: state.overrides });
      const cutoff = S.parseDate(strategy.cutoff);
      const evidenceThrough = cutoff ? S.dateKey(new Date(cutoff.getFullYear(), cutoff.getMonth(), cutoff.getDate() - 1)) : '';
      output.innerHTML = `<article class="report-sheet strategy-sheet"><header class="sheet-title"><div><div class="report-kicker">WNMU-TV PBS pre-drive planning</div><h1>Fundraiser Programming Strategy</h1><p>${escapeHtml(schedule.title)} · ${formatDate(schedule.startDate)}–${formatDate(schedule.endDate, false)}</p></div><div class="sheet-stamp">Evidence through ${formatDate(evidenceThrough)}</div></header><section class="strategy-summary"><div><span>Evidence cutoff</span><strong>Strictly before ${formatDate(strategy.cutoff)}</strong><small>Later fundraiser results cannot influence this report.</small></div><div><span>Available library</span><strong>${strategy.eligibleTitles} of ${strategy.libraryTitles} titles</strong><small>Rights are checked for each proposed slot date.</small></div><div><span>Model posture</span><strong>Advisory, not auto-schedule</strong><small>Recommendations expose reasons and confidence.</small></div></section>${mixSection(strategy)}${daypartSection(strategy)}${dayMapSection(strategy)}${supportingSections(strategy)}${rightsSection(strategy)}${limitationsSection(strategy)}</article>`;
      setStatus(`Strategy generated from evidence known before ${formatDate(strategy.cutoff)}.`, 'good');
    } catch (error) {
      console.error(error);
      output.innerHTML = `<div class="report-empty"><strong>Could not generate strategy.</strong><p>${escapeHtml(error?.message || error)}</p></div>`;
      setStatus('Strategy generation failed.', 'error');
    }
  }

  async function init() {
    try {
      if (!await requireAdmin()) return;
      await loadData();
      renderControls();
      renderStrategy();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || String(error), 'error');
      const output = $('#strategy-output');
      if (output) output.innerHTML = `<div class="report-empty"><strong>Report could not start.</strong><p>${escapeHtml(error?.message || error)}</p></div>`;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else void init();
})();

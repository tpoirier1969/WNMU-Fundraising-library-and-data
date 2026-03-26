(() => {
  const App = window.PledgeLib;
  const { state, utils, derive } = App;
  const { els, setNotice } = App.dom;

  const DATETIME_KEYS = ['aired_at', 'air_datetime', 'air_date', 'drive_date', 'broadcast_at', 'scheduled_at', 'date_time', 'datetime', 'airing_at'];
  const TIME_ONLY_KEYS = ['air_time', 'time_of_day', 'scheduled_time', 'slot_time', 'airtime'];
  const MONEY_KEYS = ['contribution_total', 'total_contributions', 'total_raised', 'gross_contributions', 'amount_raised', 'revenue', 'pledge_total', 'contributions'];
  const LOCAL_BREAK_KEYS = ['local_breaks', 'local_break_count', 'local_cutins_count', 'local_cutin_count', 'local_cutins', 'legacy_has_local_cutins_raw'];
  const LIVE_BREAK_KEYS = ['live_breaks', 'live_break_count', 'live_break_flag', 'live_break_notes', 'live_break_note'];
  const PREMIUM_KEYS = ['premium_summary', 'premiums', 'premium_notes', 'premium_offer', 'premium_description'];

  function perf() {
    return state.performance;
  }

  function setStatus(text, type = '') {
    if (!els.performanceStatus) return;
    els.performanceStatus.textContent = text;
    els.performanceStatus.className = 'list-summary';
    if (type) els.performanceStatus.classList.add(type);
  }

  function candidateValue(row, keys = [], regex = null) {
    for (const key of keys) {
      if (!utils.isBlank(row?.[key])) return row[key];
    }
    if (!regex) return null;
    for (const [key, value] of Object.entries(row || {})) {
      if (regex.test(key) && !utils.isBlank(value)) return value;
    }
    return null;
  }

  function parseMoney(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const cleaned = String(value).replace(/[$,]/g, '').trim();
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  function parseInteger(value) {
    if (value == null || value === '') return null;
    const num = Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? Math.trunc(num) : null;
  }

  function parseBooleanish(value) {
    if (typeof value === 'boolean') return value;
    const text = utils.normalizeText(value).toLowerCase();
    if (!text) return null;
    if (['true', 'yes', 'y', '1', 'live', 'has live breaks'].includes(text)) return true;
    if (['false', 'no', 'n', '0', 'none'].includes(text)) return false;
    return null;
  }

  function parseDateTimeParts(row) {
    const rawDateTime = candidateValue(row, DATETIME_KEYS, /(aired_at|air_?date|drive_?date|date_?time|datetime|broadcast_?at|scheduled_?at)/i);
    const rawTimeOnly = candidateValue(row, TIME_ONLY_KEYS, /(air_?time|slot_?time|scheduled_?time|time_?of_?day|airtime)/i);

    if (!utils.isBlank(rawDateTime)) {
      const text = String(rawDateTime).trim();
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) return date;
      if (/^\d{4}-\d{2}-\d{2}$/.test(text) && !utils.isBlank(rawTimeOnly)) {
        const merged = new Date(`${text}T${String(rawTimeOnly).trim()}`);
        if (!Number.isNaN(merged.getTime())) return merged;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const merged = new Date(`${text}T12:00:00`);
        if (!Number.isNaN(merged.getTime())) return merged;
      }
    }
    return null;
  }

  function halfHourBucket(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Unknown time';
    const minutes = (date.getHours() * 60) + date.getMinutes();
    const bucketMinutes = Math.floor(minutes / 30) * 30;
    return utils.minutesToLabel(bucketMinutes);
  }

  function dayLabel(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Unknown day';
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }

  function premiumLabel(row, programRow) {
    const value = utils.firstNonEmpty(
      candidateValue(row, PREMIUM_KEYS, /(premium)/i),
      candidateValue(programRow, PREMIUM_KEYS, /(premium)/i)
    );
    const text = utils.normalizeText(value);
    if (!text) return 'No premium noted';
    const first = text.split(/\n|\r|;|\|/).map((part) => part.trim()).filter(Boolean)[0] || text;
    return first.length > 48 ? `${first.slice(0, 45)}…` : first;
  }

  function localBreakLabel(row, programRow) {
    const direct = utils.firstNonEmpty(
      candidateValue(row, LOCAL_BREAK_KEYS, /(local_?(break|cutin))/i),
      candidateValue(programRow, LOCAL_BREAK_KEYS, /(local_?(break|cutin))/i)
    );
    const booleanish = parseBooleanish(direct);
    if (booleanish === true) return 'Has local breaks';
    if (booleanish === false) return 'No local breaks';
    const count = parseInteger(direct);
    if (Number.isFinite(count) && count > 0) return count === 1 ? '1 local break' : `${count} local breaks`;
    return 'No local breaks';
  }

  function liveBreakLabel(row, programRow) {
    const direct = utils.firstNonEmpty(
      candidateValue(row, LIVE_BREAK_KEYS, /(live_?break)/i),
      candidateValue(programRow, LIVE_BREAK_KEYS, /(live_?break)/i)
    );
    const booleanish = parseBooleanish(direct);
    if (booleanish === true) return 'Has live breaks';
    if (booleanish === false) return 'No live breaks';
    const text = utils.normalizeText(direct);
    if (text) return 'Has live breaks';
    return 'No live breaks';
  }

  function buildProgramIndexes(rows) {
    const byId = new Map();
    const byNola = new Map();
    const byTitle = new Map();
    (rows || []).forEach((row) => {
      const id = utils.normalizeLookupKey(derive.programId(row));
      const nola = utils.normalizeLookupKey(derive.nola(row));
      const title = utils.normalizeLookupKey(derive.title(row));
      if (id && !byId.has(id)) byId.set(id, row);
      if (nola && !byNola.has(nola)) byNola.set(nola, row);
      if (title && !byTitle.has(title)) byTitle.set(title, row);
    });
    return { byId, byNola, byTitle };
  }

  function matchProgramRow(row, indexes) {
    const id = utils.normalizeLookupKey(utils.firstNonEmpty(row?.program_id, row?.pledge_program_id, row?.id));
    if (id && indexes.byId.has(id)) return indexes.byId.get(id);
    const nola = utils.normalizeLookupKey(utils.firstNonEmpty(row?.nola_code, row?.nola, row?.program_nola));
    if (nola && indexes.byNola.has(nola)) return indexes.byNola.get(nola);
    const title = utils.normalizeLookupKey(utils.firstNonEmpty(row?.title, row?.program_title, row?.name));
    if (title && indexes.byTitle.has(title)) return indexes.byTitle.get(title);
    return null;
  }

  function buildPerformanceRecords(inputs) {
    const indexes = buildProgramIndexes(state.rawRows || []);
    const driveRows = Array.isArray(inputs?.driveRows) ? inputs.driveRows : [];
    const airingRows = Array.isArray(inputs?.airingRows) ? inputs.airingRows : [];
    const warnings = [...(inputs?.warnings || [])];
    const records = [];

    const sourceRows = driveRows.length ? driveRows : airingRows;
    const usingDriveRows = driveRows.length > 0;

    sourceRows.forEach((row, index) => {
      const programRow = matchProgramRow(row, indexes);
      const when = parseDateTimeParts(row);
      const amount = usingDriveRows ? parseMoney(candidateValue(row, MONEY_KEYS, /(contribution|raised|gross|amount|revenue|pledge)/i)) : null;
      const title = programRow ? derive.title(programRow) : utils.firstNonEmpty(row?.title, row?.program_title, row?.name, 'Unknown title');
      const topic = programRow ? derive.topicPrimary(programRow) : 'Unspecified topic';
      const distributor = programRow ? derive.distributor(programRow) : 'Unspecified distributor';
      const record = {
        id: utils.firstNonEmpty(row?.id, row?.airing_id, row?.drive_result_id, `perf-${index}`),
        source: usingDriveRows ? 'drive_results' : 'airings',
        programId: programRow ? derive.programId(programRow) : utils.firstNonEmpty(row?.program_id, row?.pledge_program_id, ''),
        title,
        topic: topic || 'Unspecified topic',
        distributor: distributor || 'Unspecified distributor',
        premiums: premiumLabel(row, programRow),
        localBreaks: localBreakLabel(row, programRow),
        liveBreaks: liveBreakLabel(row, programRow),
        amount,
        when,
        day: dayLabel(when),
        time: halfHourBucket(when)
      };
      records.push(record);
    });

    if (!sourceRows.length) warnings.push('No drive-results or airings rows were available yet, so Performance has no records to compare.');

    perf().dataShape = {
      driveRows: driveRows.length,
      airingRows: airingRows.length,
      recordsWithMoney: records.filter((record) => Number.isFinite(record.amount)).length,
      recordsWithDateTime: records.filter((record) => record.when instanceof Date && !Number.isNaN(record.when.getTime())).length
    };
    perf().warnings = warnings;
    perf().records = records;
    perf().lastLoadedAt = new Date().toISOString();
  }

  function criterionLabel(record, criterion) {
    switch (criterion) {
      case 'day': return record.day || 'Unknown day';
      case 'time': return record.time || 'Unknown time';
      case 'topic': return record.topic || 'Unspecified topic';
      case 'local_breaks': return record.localBreaks || 'No local breaks';
      case 'live_breaks': return record.liveBreaks || 'No live breaks';
      case 'premiums': return record.premiums || 'No premium noted';
      case 'distributor': return record.distributor || 'Unspecified distributor';
      default: return 'Unknown';
    }
  }

  function metricLabel(metric) {
    switch (metric) {
      case 'total_dollars': return 'Total dollars';
      case 'airings': return 'Airing count';
      case 'avg_dollars':
      default: return 'Average dollars / airing';
    }
  }

  function metricValue(group, metric) {
    switch (metric) {
      case 'total_dollars': return group.totalDollars;
      case 'airings': return group.airingCount;
      case 'avg_dollars':
      default: return group.avgDollars;
    }
  }

  function filterAndGroupRecords() {
    const labelFilter = utils.normalizeLookupKey(perf().labelFilter || '');
    const records = (perf().records || []).filter((record) => {
      if (!labelFilter) return true;
      return utils.normalizeLookupKey(criterionLabel(record, perf().criterion)).includes(labelFilter);
    });

    const groups = new Map();
    records.forEach((record) => {
      const label = criterionLabel(record, perf().criterion);
      if (!groups.has(label)) {
        groups.set(label, {
          label,
          airingCount: 0,
          totalDollars: 0,
          moneyCount: 0,
          avgDollars: 0,
          titles: new Set()
        });
      }
      const group = groups.get(label);
      group.airingCount += 1;
      if (Number.isFinite(record.amount)) {
        group.totalDollars += record.amount;
        group.moneyCount += 1;
      }
      group.titles.add(record.title || 'Unknown title');
    });

    const grouped = [...groups.values()].map((group) => ({
      ...group,
      avgDollars: group.moneyCount ? group.totalDollars / group.moneyCount : 0,
      titleCount: group.titles.size,
      titles: [...group.titles].sort((a, b) => utils.compareText(a, b))
    }));

    grouped.sort((a, b) => {
      const diff = metricValue(b, perf().metric) - metricValue(a, perf().metric);
      if (diff !== 0) return diff;
      return utils.compareText(a.label, b.label);
    });

    perf().groups = grouped.slice(0, Math.max(1, Number(perf().topN) || 12));
    return { records, grouped };
  }

  function renderStats(records) {
    if (!els.performanceStatGrid) return;
    const titles = new Set(records.map((record) => record.title).filter(Boolean));
    const dollars = records.reduce((sum, record) => sum + (Number.isFinite(record.amount) ? record.amount : 0), 0);
    const moneyCount = records.filter((record) => Number.isFinite(record.amount)).length;
    const stats = [
      ['Records', utils.formatCount(records.length)],
      ['Titles represented', utils.formatCount(titles.size)],
      ['Dollars represented', utils.formatMoney(dollars)],
      ['Money-bearing rows', utils.formatCount(moneyCount)]
    ];
    els.performanceStatGrid.innerHTML = stats.map(([label, value]) => `
      <article class="performance-stat-card">
        <div class="performance-stat-label">${utils.escapeHtml(label)}</div>
        <div class="performance-stat-value">${utils.escapeHtml(value)}</div>
      </article>
    `).join('');
  }

  function renderChart(groups) {
    if (!els.performanceChart) return;
    if (!groups.length) {
      els.performanceChart.innerHTML = '<div class="performance-chart-empty">No comparison groups match this filter yet.</div>';
      return;
    }
    const max = Math.max(...groups.map((group) => metricValue(group, perf().metric)), 1);
    els.performanceChart.innerHTML = groups.map((group) => {
      const value = metricValue(group, perf().metric);
      const width = Math.max(3, Math.round((value / max) * 100));
      const valueLabel = perf().metric === 'airings' ? utils.formatCount(value) : utils.formatMoney(value);
      return `
        <div class="performance-bar-row">
          <div class="performance-bar-head">
            <span class="performance-bar-label">${utils.escapeHtml(group.label)}</span>
            <span class="performance-bar-value">${utils.escapeHtml(valueLabel)}</span>
          </div>
          <div class="performance-bar-track"><div class="performance-bar-fill" style="width:${width}%"></div></div>
          <div class="performance-bar-meta">${utils.escapeHtml(utils.formatCount(group.airingCount))} airings · ${utils.escapeHtml(utils.formatCount(group.titleCount))} titles</div>
        </div>
      `;
    }).join('');
  }

  function renderTable(groups) {
    if (!els.performanceTableBody) return;
    if (!groups.length) {
      els.performanceTableBody.innerHTML = '<tr><td colspan="5" class="placeholder-row">No comparison groups match this filter yet.</td></tr>';
      return;
    }
    els.performanceTableBody.innerHTML = groups.map((group) => `
      <tr>
        <td>${utils.escapeHtml(group.label)}</td>
        <td>${utils.escapeHtml(utils.formatCount(group.airingCount))}</td>
        <td>${utils.escapeHtml(utils.formatMoney(group.totalDollars))}</td>
        <td>${utils.escapeHtml(utils.formatMoney(group.avgDollars))}</td>
        <td>${utils.escapeHtml(utils.formatCount(group.titleCount))}</td>
      </tr>
    `).join('');
  }

  function renderNotes(records, grouped) {
    if (!els.performanceSourceNotes) return;
    const notes = [];
    const shape = perf().dataShape || {};
    notes.push(`Performance is reading from ${utils.formatCount(shape.driveRows || 0)} drive-result rows and ${utils.formatCount(shape.airingRows || 0)} airings rows.`);
    notes.push(`${utils.formatCount(shape.recordsWithDateTime || 0)} records include a usable date/time stamp. ${utils.formatCount(shape.recordsWithMoney || 0)} include dollars.`);
    if (!shape.driveRows) notes.push('Because drive-result rows were not available, dollar-based metrics may be thin or empty until those rows are imported.');
    notes.push(`This starter slice is additive and modular. It uses separate performance code paths so Library and Scheduling stay out of the blast radius.`);
    if (perf().warnings?.length) notes.push(...perf().warnings);

    els.performanceSourceNotes.innerHTML = `
      <ul class="performance-note-list">
        ${notes.map((note) => `<li>${utils.escapeHtml(note)}</li>`).join('')}
      </ul>
      <div class="performance-footnote">Showing ${utils.escapeHtml(utils.formatCount(grouped.length))} comparison groups from ${utils.escapeHtml(utils.formatCount(records.length))} filtered records.</div>
    `;
  }

  function renderAll() {
    if (!els.performanceChart || !els.performanceTableBody) return;
    const { records, grouped } = filterAndGroupRecords();
    renderStats(records);
    renderChart(perf().groups);
    renderTable(perf().groups);
    renderNotes(records, perf().groups);
    if (els.performanceChartTitle) els.performanceChartTitle.textContent = `${metricLabel(perf().metric)} by ${perf().criterion.replace('_', ' ')}`;
    if (els.performanceChartPill) els.performanceChartPill.textContent = perf().ready ? 'Live comparison' : 'Awaiting data';
    if (els.performanceTablePill) els.performanceTablePill.textContent = `Top ${perf().groups.length} groups`;
    if (els.performanceNotesPill) els.performanceNotesPill.textContent = perf().lastLoadedAt ? `Loaded ${utils.formatDateTime(perf().lastLoadedAt)}` : 'Starter framework';
    setStatus(`Comparing ${perf().criterion.replace('_', ' ')} using ${metricLabel(perf().metric).toLowerCase()}. ${utils.formatCount(records.length)} filtered records.`, perf().error ? 'warn' : '');
  }

  async function refreshData(options = {}) {
    if (!state.client) return;
    perf().loading = true;
    perf().error = '';
    if (!options.silent) setStatus('Loading performance history…');
    try {
      const inputs = await App.data.fetchPerformanceInputs();
      buildPerformanceRecords(inputs);
      perf().ready = true;
    } catch (error) {
      console.error(error);
      perf().ready = false;
      perf().records = [];
      perf().groups = [];
      perf().error = error?.message || 'Performance load failed.';
      setStatus(perf().error, 'warn');
      if (!options.silent) setNotice(perf().error, 'warn');
    } finally {
      perf().loading = false;
    }
  }

  async function ensureReady() {
    if (perf().loading) return;
    if (!perf().ready) {
      await refreshData();
    }
    renderAll();
  }

  function reset() {
    perf().ready = false;
    perf().records = [];
    perf().groups = [];
    perf().warnings = [];
    perf().lastLoadedAt = '';
  }

  function bindEvents() {
    els.performanceCriterionSelect?.addEventListener('change', (event) => {
      perf().criterion = event.target.value || 'day';
      renderAll();
    });
    els.performanceMetricSelect?.addEventListener('change', (event) => {
      perf().metric = event.target.value || 'avg_dollars';
      renderAll();
    });
    els.performanceTopnSelect?.addEventListener('change', (event) => {
      perf().topN = Number(event.target.value || 12);
      renderAll();
    });
    els.performanceFilterInput?.addEventListener('input', (event) => {
      perf().labelFilter = event.target.value || '';
      renderAll();
    });
    els.performanceRefreshButton?.addEventListener('click', async () => {
      await refreshData();
      renderAll();
    });
  }

  App.performanceUi = {
    ensureReady,
    refreshData,
    renderAll,
    bindEvents,
    reset
  };
})();


(() => {
  const App = window.PledgeLib;
  const { state, utils, derive } = App;
  const { els, setNotice, renderSelectOptions } = App.dom;

  const DATETIME_KEYS = ['aired_at', 'air_datetime', 'air_date', 'drive_date', 'broadcast_at', 'scheduled_at', 'date_time', 'datetime', 'airing_at'];
  const TIME_ONLY_KEYS = ['air_time', 'time_of_day', 'scheduled_time', 'slot_time', 'airtime'];
  const MONEY_KEYS = ['contribution_total', 'total_contributions', 'total_raised', 'gross_contributions', 'amount_raised', 'revenue', 'pledge_total', 'contributions'];
  const LOCAL_BREAK_KEYS = ['local_breaks', 'local_break_count', 'local_cutins_count', 'local_cutin_count', 'local_cutins', 'legacy_has_local_cutins_raw'];
  const LIVE_BREAK_KEYS = ['live_breaks', 'live_break_count', 'live_break_flag', 'live_break_notes', 'live_break_note'];
  const PREMIUM_KEYS = ['premium_summary', 'premiums', 'premium_notes', 'premium_offer', 'premium_description'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function perf() { return state.performance; }

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

  function dateLabel(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Unknown date';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function premiumLabel(row, programRow) {
    const value = utils.firstNonEmpty(candidateValue(row, PREMIUM_KEYS, /(premium)/i), candidateValue(programRow, PREMIUM_KEYS, /(premium)/i));
    const text = utils.normalizeText(value);
    if (!text) return 'No premium metadata';
    const first = text.split(/\n|\r|;|\|/).map((part) => part.trim()).filter(Boolean)[0] || text;
    return first.length > 48 ? `${first.slice(0, 45)}…` : first;
  }

  function localBreakLabel(row, programRow) {
    const direct = utils.firstNonEmpty(candidateValue(row, LOCAL_BREAK_KEYS, /(local_?(break|cutin))/i), candidateValue(programRow, LOCAL_BREAK_KEYS, /(local_?(break|cutin))/i));
    const booleanish = parseBooleanish(direct);
    if (booleanish === true) return 'Has local breaks';
    if (booleanish === false) return 'No local breaks';
    const count = parseInteger(direct);
    if (Number.isFinite(count) && count > 0) return count === 1 ? '1 local break' : `${count} local breaks`;
    return 'No local breaks';
  }

  function liveBreakLabel(row, programRow) {
    const direct = utils.firstNonEmpty(candidateValue(row, LIVE_BREAK_KEYS, /(live_?break)/i), candidateValue(programRow, LIVE_BREAK_KEYS, /(live_?break)/i));
    const booleanish = parseBooleanish(direct);
    if (booleanish === true) return 'Has live breaks';
    if (booleanish === false) return 'No live breaks';
    const text = utils.normalizeText(direct);
    return text ? 'Has live breaks' : 'No live breaks';
  }

  function normalizeDistributor(value) {
    const raw = utils.normalizeText(value);
    const key = utils.normalizeLookupKey(raw);
    if (!key) return 'Unspecified distributor';
    if (['pbs', 'pbs distribution', 'public broadcasting service', 'pbs dist'].includes(key)) return 'PBS';
    if (key === 'eps') return 'EPS';
    return raw;
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
      const topic = programRow ? derive.topicPrimary(programRow) : utils.firstNonEmpty(row?.topic_primary, row?.topic, 'Unspecified topic');
      const distributor = programRow ? derive.distributor(programRow) : utils.firstNonEmpty(row?.distributor, 'Unspecified distributor');
      const record = {
        id: utils.firstNonEmpty(row?.id, row?.airing_id, row?.drive_result_id, `perf-${index}`),
        source: usingDriveRows ? 'drive_results' : 'airings',
        programId: programRow ? derive.programId(programRow) : utils.firstNonEmpty(row?.program_id, row?.pledge_program_id, ''),
        title: programRow ? derive.title(programRow) : utils.firstNonEmpty(row?.title, row?.program_title, row?.name, 'Unknown title'),
        topic: topic || 'Unspecified topic',
        distributor: normalizeDistributor(distributor),
        premiums: premiumLabel(row, programRow),
        localBreaks: localBreakLabel(row, programRow),
        liveBreaks: liveBreakLabel(row, programRow),
        amount,
        when,
        day: dayLabel(when),
        date: dateLabel(when),
        time: halfHourBucket(when),
        monthIndex: when instanceof Date && !Number.isNaN(when.getTime()) ? when.getMonth() : null
      };
      records.push(record);
    });

    if (!sourceRows.length) warnings.push('No drive-results or airings rows were available yet, so Pledge Performance has no records to compare.');

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

  function criterionDisplayName(criterion = perf().criterion) {
    switch (criterion) {
      case 'date': return 'Date';
      case 'day': return 'Day';
      case 'time': return 'Time';
      case 'topic': return 'Topic';
      case 'local_breaks': return 'Local breaks';
      case 'live_breaks': return 'Live breaks';
      case 'premiums': return 'Premium metadata';
      case 'distributor': return 'Distributor';
      default: return 'Group';
    }
  }

  function criterionLabel(record, criterion) {
    switch (criterion) {
      case 'date': return record.date || 'Unknown date';
      case 'day': return record.day || 'Unknown day';
      case 'time': return record.time || 'Unknown time';
      case 'topic': return record.topic || 'Unspecified topic';
      case 'local_breaks': return record.localBreaks || 'No local breaks';
      case 'live_breaks': return record.liveBreaks || 'No live breaks';
      case 'premiums': return record.premiums || 'No premium metadata';
      case 'distributor': return record.distributor || 'Unspecified distributor';
      default: return 'Unknown';
    }
  }

  function criterionOrderKey(group, criterion) {
    if (criterion === 'date') return group.minTime || Number.MAX_SAFE_INTEGER;
    if (criterion === 'time') return group.minMinutes ?? Number.MAX_SAFE_INTEGER;
    if (criterion === 'day') return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(group.label);
    return group.label;
  }

  function metricLabel(metric = perf().metric) {
    switch (metric) {
      case 'total_dollars': return 'Total dollars';
      case 'airings': return 'Airing count';
      case 'avg_dollars':
      default: return 'Average dollars / airing';
    }
  }

  function metricValue(group, metric = perf().metric) {
    switch (metric) {
      case 'total_dollars': return group.totalDollars;
      case 'airings': return group.airingCount;
      case 'avg_dollars':
      default: return group.avgDollars;
    }
  }

  function chartTypeLabel(type) {
    switch (type) {
      case 'line': return 'Line chart';
      case 'bar': return 'Bar chart';
      default: return 'Auto';
    }
  }

  function isLineFriendly(criterion) {
    return ['date', 'day', 'time'].includes(criterion);
  }

  function effectiveChartType() {
    if (perf().chartType === 'auto') return isLineFriendly(perf().criterion) ? 'line' : 'bar';
    if (perf().chartType === 'line' && !isLineFriendly(perf().criterion)) return 'bar';
    return perf().chartType;
  }

  function filterAndGroupRecords() {
    const labelFilter = utils.normalizeLookupKey(perf().labelFilter || '');
    const startDate = perf().startDate ? new Date(`${perf().startDate}T00:00:00`) : null;
    const endDate = perf().endDate ? new Date(`${perf().endDate}T23:59:59`) : null;
    const records = (perf().records || []).filter((record) => {
      if (perf().monthFilter !== '' && record.monthIndex !== Number(perf().monthFilter)) return false;
      if (perf().topicFilter && utils.normalizeLookupKey(record.topic) !== utils.normalizeLookupKey(perf().topicFilter)) return false;
      if (startDate && (!(record.when instanceof Date) || record.when < startDate)) return false;
      if (endDate && (!(record.when instanceof Date) || record.when > endDate)) return false;
      if (labelFilter && !utils.normalizeLookupKey(criterionLabel(record, perf().criterion)).includes(labelFilter)) return false;
      return true;
    });

    const groups = new Map();
    records.forEach((record) => {
      const label = criterionLabel(record, perf().criterion);
      if (!groups.has(label)) {
        groups.set(label, { label, airingCount: 0, totalDollars: 0, moneyCount: 0, avgDollars: 0, titles: new Set(), minTime: null, minMinutes: null });
      }
      const group = groups.get(label);
      group.airingCount += 1;
      if (Number.isFinite(record.amount)) {
        group.totalDollars += record.amount;
        group.moneyCount += 1;
      }
      group.titles.add(record.title || 'Unknown title');
      if (record.when instanceof Date && !Number.isNaN(record.when.getTime())) {
        const ts = record.when.getTime();
        group.minTime = group.minTime == null ? ts : Math.min(group.minTime, ts);
        const minutes = (record.when.getHours() * 60) + record.when.getMinutes();
        group.minMinutes = group.minMinutes == null ? minutes : Math.min(group.minMinutes, minutes);
      }
    });

    const grouped = [...groups.values()].map((group) => ({
      ...group,
      avgDollars: group.moneyCount ? group.totalDollars / group.moneyCount : 0,
      titleCount: group.titles.size,
      titles: [...group.titles].sort((a, b) => utils.compareText(a, b))
    }));

    const sorted = grouped.sort((a, b) => {
      if (effectiveChartType() === 'line' && isLineFriendly(perf().criterion)) {
        const ak = criterionOrderKey(a, perf().criterion);
        const bk = criterionOrderKey(b, perf().criterion);
        if (typeof ak === 'number' && typeof bk === 'number' && ak !== bk) return ak - bk;
        return utils.compareText(String(a.label), String(b.label));
      }
      const diff = metricValue(b) - metricValue(a);
      if (diff !== 0) return diff;
      return utils.compareText(a.label, b.label);
    });

    const limit = Math.max(1, Number(perf().topN) || 12);
    perf().filteredRecords = records;
    perf().groups = limit >= 999 ? sorted : sorted.slice(0, limit);
    return { records, grouped: perf().groups };
  }

  function renderStats(records) {
    if (!els.performanceStatGrid) return;
    const titles = new Set(records.map((record) => record.title).filter(Boolean));
    const dollars = records.reduce((sum, record) => sum + (Number.isFinite(record.amount) ? record.amount : 0), 0);
    const moneyCount = records.filter((record) => Number.isFinite(record.amount)).length;
    const datedCount = records.filter((record) => record.when instanceof Date && !Number.isNaN(record.when.getTime())).length;
    const stats = [
      ['Records used', utils.formatCount(records.length)],
      ['Titles represented', utils.formatCount(titles.size)],
      ['Dollars represented', utils.formatMoney(dollars)],
      ['Rows with money / date', `${utils.formatCount(moneyCount)} / ${utils.formatCount(datedCount)}`]
    ];
    els.performanceStatGrid.innerHTML = stats.map(([label, value]) => `
      <article class="performance-stat-card">
        <div class="performance-stat-label">${utils.escapeHtml(label)}</div>
        <div class="performance-stat-value">${utils.escapeHtml(value)}</div>
      </article>
    `).join('');
  }

  function buildBarSvg(groups) {
    const width = 940;
    const left = 180;
    const right = 24;
    const top = 20;
    const rowH = 42;
    const height = Math.max(240, top + (groups.length * rowH) + 40);
    const chartW = width - left - right;
    const max = Math.max(...groups.map((g) => metricValue(g)), 1);
    const rows = groups.map((group, index) => {
      const y = top + (index * rowH);
      const value = metricValue(group);
      const barW = Math.max(2, Math.round((value / max) * chartW));
      const label = utils.escapeHtml(group.label);
      const valueLabel = perf().metric === 'airings' ? utils.formatCount(value) : utils.formatMoney(value);
      return `
        <text x="10" y="${y + 16}" font-size="13" font-weight="700" fill="#173a5e">${label}</text>
        <rect x="${left}" y="${y}" width="${chartW}" height="14" rx="7" fill="#dce8f6"></rect>
        <rect x="${left}" y="${y}" width="${barW}" height="14" rx="7" fill="#123e6b"></rect>
        <text x="${left + barW + 8}" y="${y + 12}" font-size="12" fill="#102845">${utils.escapeHtml(valueLabel)}</text>
        <text x="${left}" y="${y + 30}" font-size="11" fill="#5a687d">${utils.escapeHtml(utils.formatCount(group.airingCount))} airings · ${utils.escapeHtml(utils.formatCount(group.titleCount))} titles</text>
      `;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${utils.escapeHtml(metricLabel())} by ${utils.escapeHtml(criterionDisplayName())}">${rows}</svg>`;
  }

  function buildLineSvg(groups) {
    const width = 960;
    const height = 360;
    const left = 56;
    const right = 20;
    const top = 24;
    const bottom = 58;
    const chartW = width - left - right;
    const chartH = height - top - bottom;
    const values = groups.map((g) => metricValue(g));
    const max = Math.max(...values, 1);
    const points = groups.map((group, index) => {
      const x = left + (groups.length <= 1 ? chartW / 2 : (index * chartW / (groups.length - 1)));
      const y = top + chartH - ((metricValue(group) / max) * chartH);
      return { x, y, label: group.label, value: metricValue(group), group };
    });
    const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({ y: top + chartH - (ratio * chartH), value: max * ratio }));
    const labels = points.map((point) => `<text x="${point.x}" y="${height - 18}" font-size="11" text-anchor="middle" fill="#526174">${utils.escapeHtml(point.label)}</text>`).join('');
    const dots = points.map((point) => `
      <circle cx="${point.x}" cy="${point.y}" r="4" fill="#123e6b"></circle>
      <text x="${point.x}" y="${point.y - 10}" font-size="11" text-anchor="middle" fill="#173a5e">${utils.escapeHtml(perf().metric === 'airings' ? utils.formatCount(point.value) : utils.formatMoney(point.value))}</text>
    `).join('');
    const grid = yTicks.map((tick) => `
      <line x1="${left}" y1="${tick.y}" x2="${left + chartW}" y2="${tick.y}" stroke="#dce8f6" stroke-width="1"></line>
      <text x="${left - 8}" y="${tick.y + 4}" font-size="11" text-anchor="end" fill="#526174">${utils.escapeHtml(perf().metric === 'airings' ? utils.formatCount(Math.round(tick.value)) : utils.formatMoney(tick.value))}</text>
    `).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${utils.escapeHtml(metricLabel())} by ${utils.escapeHtml(criterionDisplayName())}">
      ${grid}
      <path d="${path}" fill="none" stroke="#123e6b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots}
      ${labels}
    </svg>`;
  }

  function renderChart(groups) {
    if (!els.performanceChart) return;
    if (!groups.length) {
      els.performanceChart.innerHTML = '<div class="performance-chart-empty">No comparison groups match this filter yet.</div>';
      return;
    }
    const chartType = effectiveChartType();
    const svg = chartType === 'line' ? buildLineSvg(groups) : buildBarSvg(groups);
    const note = chartType === 'line'
      ? '<div class="performance-chart-note">Line chart works best for date, day, or time because those labels have a natural order.</div>'
      : '<div class="performance-chart-note">Bar chart is the safer choice for categories like distributor, topic, break flags, and premium metadata.</div>';
    els.performanceChart.innerHTML = `${svg}${note}`;
  }

  function renderTable(groups) {
    if (!els.performanceTableBody) return;
    if (els.performanceTableGroupHeader) els.performanceTableGroupHeader.textContent = criterionDisplayName();
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

  function buildCriteriaSummary(records, groups) {
    const start = perf().startDate ? utils.formatDate(perf().startDate) : 'Earliest available';
    const end = perf().endDate ? utils.formatDate(perf().endDate) : 'Latest available';
    const month = perf().monthFilter === '' ? 'All months' : MONTH_NAMES[Number(perf().monthFilter)] || 'Unknown month';
    const topic = perf().topicFilter || 'All topics';
    const source = perf().dataShape.driveRows ? 'Drive-result rows (money-bearing rows drive dollar metrics)' : 'Airings rows only';
    perf().criteriaSummary = [
      ['Date window', `${start} to ${end}`],
      ['Fundraiser month', month],
      ['Topic filter', topic],
      ['Compare by', criterionDisplayName()],
      ['Metric', metricLabel()],
      ['Chart', chartTypeLabel(effectiveChartType())],
      ['Source basis', source],
      ['Filtered rows', utils.formatCount(records.length)]
    ];
    if (!els.performanceCriteriaBar) return;
    els.performanceCriteriaBar.innerHTML = perf().criteriaSummary.map(([label, value]) => `
      <div class="performance-criteria-pill"><span class="label">${utils.escapeHtml(label)}</span><span>${utils.escapeHtml(value)}</span></div>
    `).join('');
  }

  function renderExplainTable(records, groups) {
    if (!els.performanceExplainBody) return;
    const rows = [
      ['Date window', perf().startDate || perf().endDate ? `${utils.formatDate(perf().startDate || null, 'Earliest available')} to ${utils.formatDate(perf().endDate || null, 'Latest available')}` : 'All available dates', 'Only records whose usable date falls inside this window are included.'],
      ['Fundraiser month', perf().monthFilter === '' ? 'All months' : MONTH_NAMES[Number(perf().monthFilter)] || 'Unknown month', 'This cuts across years. “December” means every included row that lands in December.'],
      ['Topic filter', perf().topicFilter || 'All topics', 'Uses the program topic already in the library database.'],
      ['Compare by', criterionDisplayName(), `Each row in the comparison table is one ${criterionDisplayName().toLowerCase()} bucket.`],
      ['Metric', metricLabel(), perf().metric === 'avg_dollars' ? 'This is normalized to dollars per counted airing row, which is safer than raw totals when sample sizes differ.' : perf().metric === 'total_dollars' ? 'This is raw dollars represented by the filtered rows, so groups with more rows can dominate.' : 'This is the number of included rows used in the comparison.'],
      ['Source basis', perf().dataShape.driveRows ? 'Drive-result rows first, airings as fallback' : 'Airings rows only', 'Right now the app prefers rows that contain money. That keeps the framework useful, but it is not yet the final imported-report truth set.'],
      ['Premium metadata', 'Not actual viewer choice data', 'Premium comparisons currently mean “programs carrying premium metadata,” not which premium item viewers actually chose.'],
      ['How sturdy is this?', `${utils.formatCount(groups.length)} groups from ${utils.formatCount(records.length)} filtered rows`, 'Small counts can make a result look dramatic while still being flimsy. Read the airing count next to every value.']
    ];
    els.performanceExplainBody.innerHTML = rows.map(([setting, value, read]) => `
      <tr>
        <td>${utils.escapeHtml(setting)}</td>
        <td>${utils.escapeHtml(String(value))}</td>
        <td>${utils.escapeHtml(read)}</td>
      </tr>
    `).join('');
  }

  function renderNotes(records, groups) {
    if (!els.performanceSourceNotes) return;
    const notes = [];
    const shape = perf().dataShape || {};
    notes.push(`Pledge Performance is reading from ${utils.formatCount(shape.driveRows || 0)} drive-result rows and ${utils.formatCount(shape.airingRows || 0)} airings rows.`);
    notes.push(`${utils.formatCount(shape.recordsWithDateTime || 0)} records include a usable date/time stamp. ${utils.formatCount(shape.recordsWithMoney || 0)} include dollars.`);
    if (!shape.driveRows) notes.push('Because drive-result rows were not available, dollar-based metrics may be thin or empty until those rows are imported.');
    notes.push('Average dollars per airing is the safest headline metric for comparisons like local breaks vs no local breaks because it reduces the distortion from unequal sample sizes.');
    notes.push('Premium analysis is metadata-only for now. It does not know which premium item viewers actually chose.');
    if (perf().warnings?.length) notes.push(...perf().warnings);
    els.performanceSourceNotes.innerHTML = `
      <ul class="performance-note-list">
        ${notes.map((note) => `<li>${utils.escapeHtml(note)}</li>`).join('')}
      </ul>
      <div class="performance-footnote"><strong>Filtered scope:</strong> ${utils.escapeHtml(utils.formatCount(records.length))} rows feeding ${utils.escapeHtml(utils.formatCount(groups.length))} comparison groups.</div>
    `;
  }

  function populateControls() {
    const topicValues = [...new Set((state.rawRows || []).map((row) => derive.topicPrimary(row)).filter((value) => !utils.isBlank(value)))].sort((a, b) => utils.compareText(a, b));
    renderSelectOptions(els.performanceTopicSelect, topicValues, perf().topicFilter, 'All topics');
    if (els.performanceCriterionSelect) els.performanceCriterionSelect.value = perf().criterion;
    if (els.performanceMetricSelect) els.performanceMetricSelect.value = perf().metric;
    if (els.performanceChartTypeSelect) els.performanceChartTypeSelect.value = perf().chartType;
    if (els.performanceTopnSelect) els.performanceTopnSelect.value = String(perf().topN);
    if (els.performanceFilterInput) els.performanceFilterInput.value = perf().labelFilter || '';
    if (els.performanceStartDate) els.performanceStartDate.value = perf().startDate || '';
    if (els.performanceEndDate) els.performanceEndDate.value = perf().endDate || '';
    if (els.performanceMonthSelect) els.performanceMonthSelect.value = perf().monthFilter;
    if (els.performanceTopicSelect) els.performanceTopicSelect.value = perf().topicFilter;
  }

  function renderAll() {
    if (!els.performanceChart || !els.performanceTableBody) return;
    populateControls();
    const { records, grouped } = filterAndGroupRecords();
    renderStats(records);
    buildCriteriaSummary(records, grouped);
    renderExplainTable(records, grouped);
    renderChart(perf().groups);
    renderTable(perf().groups);
    renderNotes(records, perf().groups);
    if (els.performanceChartTitle) els.performanceChartTitle.textContent = `${metricLabel()} by ${criterionDisplayName()}`;
    if (els.performanceChartPill) els.performanceChartPill.textContent = perf().ready ? `${chartTypeLabel(effectiveChartType())} · ${criterionDisplayName()}` : 'Awaiting data';
    if (els.performanceTablePill) els.performanceTablePill.textContent = `${utils.formatCount(perf().groups.length)} groups shown`;
    if (els.performanceNotesPill) els.performanceNotesPill.textContent = perf().lastLoadedAt ? `Loaded ${utils.formatDateTime(perf().lastLoadedAt)}` : 'Starter framework';
    setStatus(`Comparing ${criterionDisplayName().toLowerCase()} using ${metricLabel().toLowerCase()}. ${utils.formatCount(records.length)} filtered rows.`, perf().error ? 'warn' : '');
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
      populateControls();
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
    if (!perf().ready) await refreshData();
    renderAll();
  }

  function reset() {
    perf().ready = false;
    perf().records = [];
    perf().filteredRecords = [];
    perf().groups = [];
    perf().warnings = [];
    perf().lastLoadedAt = '';
  }

  function exportChartSvg() {
    const svg = els.performanceChart?.querySelector('svg');
    if (!svg) {
      setNotice('There is no chart to export yet.', 'warn');
      return;
    }
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pledge-performance-${perf().criterion}-${effectiveChartType()}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bindEvents() {
    const rerender = () => renderAll();
    els.performanceCriterionSelect?.addEventListener('change', (event) => { perf().criterion = event.target.value || 'day'; rerender(); });
    els.performanceMetricSelect?.addEventListener('change', (event) => { perf().metric = event.target.value || 'avg_dollars'; rerender(); });
    els.performanceChartTypeSelect?.addEventListener('change', (event) => { perf().chartType = event.target.value || 'auto'; rerender(); });
    els.performanceTopnSelect?.addEventListener('change', (event) => { perf().topN = Number(event.target.value || 12); rerender(); });
    els.performanceFilterInput?.addEventListener('input', (event) => { perf().labelFilter = event.target.value || ''; rerender(); });
    els.performanceStartDate?.addEventListener('change', (event) => { perf().startDate = event.target.value || ''; rerender(); });
    els.performanceEndDate?.addEventListener('change', (event) => { perf().endDate = event.target.value || ''; rerender(); });
    els.performanceMonthSelect?.addEventListener('change', (event) => { perf().monthFilter = event.target.value; rerender(); });
    els.performanceTopicSelect?.addEventListener('change', (event) => { perf().topicFilter = event.target.value || ''; rerender(); });
    els.performanceRefreshButton?.addEventListener('click', async () => { await refreshData(); renderAll(); });
    els.performanceExportButton?.addEventListener('click', exportChartSvg);
  }

  App.performanceUi = { ensureReady, refreshData, renderAll, bindEvents, reset, populateControls };
})();

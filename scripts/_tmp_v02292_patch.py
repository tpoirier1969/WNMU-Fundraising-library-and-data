from pathlib import Path
import json


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def replace_function(text, name, replacement, async_fn=False):
    prefix = f"  {'async ' if async_fn else ''}function {name}("
    start = text.find(prefix)
    if start < 0:
        raise SystemExit(f"function {name} not found")
    brace = text.find('{', start)
    if brace < 0:
        raise SystemExit(f"function {name} opening brace not found")
    depth = 0
    end = None
    quote = None
    escape = False
    template_depth = 0
    for i in range(brace, len(text)):
        ch = text[i]
        if quote:
            if escape:
                escape = False
                continue
            if ch == '\\':
                escape = True
                continue
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"', '`'):
            quote = ch
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise SystemExit(f"function {name} closing brace not found")
    return text[:start] + replacement.rstrip() + text[end:]


def insert_after_function(text, name, addition, async_fn=False):
    prefix = f"  {'async ' if async_fn else ''}function {name}("
    start = text.find(prefix)
    if start < 0:
        raise SystemExit(f"function {name} not found for insertion")
    brace = text.find('{', start)
    depth = 0
    quote = None
    escape = False
    end = None
    for i in range(brace, len(text)):
        ch = text[i]
        if quote:
            if escape:
                escape = False
                continue
            if ch == '\\':
                escape = True
                continue
            if ch == quote:
                quote = None
            continue
        if ch in ("'", '"', '`'):
            quote = ch
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise SystemExit(f"function {name} closing brace not found for insertion")
    return text[:end] + "\n\n" + addition.strip() + text[end:]


# ---------------- Performance Analytics ----------------
apath = Path('assets/js/ui-analytics.js')
a = apath.read_text(encoding='utf-8')
a = replace_once(a, "    metric: 'total',", "    metric: 'median',", 'analytics default median')

a = replace_function(a, 'daypartFromMinutes', '''  function daypartFromMinutes(minutes) {
    if (!Number.isFinite(Number(minutes))) return '';
    const normalized = ((Number(minutes) % 1440) + 1440) % 1440;
    if (normalized >= 420 && normalized < 720) return 'morning';
    if (normalized >= 720 && normalized < 1020) return 'afternoon';
    if (normalized >= 1020 && normalized < 1200) return 'early-evening';
    if (normalized >= 1200 && normalized < 1350) return 'prime';
    return 'overnight';
  }''')

a = replace_function(a, 'dedupeSchedulesByDateRange', '''  function dedupeSchedulesByDateRange(schedules = []) {
    const buckets = new Map();
    schedules.forEach((schedule) => {
      const start = text(schedule.startDate);
      const end = text(schedule.endDate);
      const key = start && end ? `${start}|${end}` : `id:${text(schedule.id)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(schedule);
    });
    const active = [];
    const ambiguous = [];
    buckets.forEach((items, key) => {
      if (items.length === 1 || key.startsWith('id:')) {
        active.push(items[0]);
        return;
      }
      ambiguous.push({ key, count: items.length, ids: items.map((schedule) => text(schedule.id)).filter(Boolean) });
    });
    state.scheduleAudit = {
      rawSchedules: schedules.length,
      activeSchedules: active.length,
      duplicateSchedulesMerged: 0,
      duplicateSchedulesSuppressed: ambiguous.reduce((sum, item) => sum + item.count, 0),
      ambiguousDateRanges: ambiguous
    };
    return active.sort((a, b) => `${text(a.startDate)}|${text(a.endDate)}`.localeCompare(`${text(b.startDate)}|${text(b.endDate)}`));
  }''')

a = replace_once(a, '''      placement.importedBroadcastDollars,
      placement.actualDollars,''', '''      placement.importedBroadcastDollars,
      placement.manualResultRecorded ? Number(placement.manualBroadcastDollars || 0) : null,
      placement.actualDollars,''', 'analytics placement dollars manual')

a = replace_function(a, 'findAiringForSchedulePlacement', '''  function findAiringForSchedulePlacement({ placement = {}, dateKey = '', startMinutes = NaN, pid = '', nola = '', title = '', airingLookup }) {
    const hash = text(placement.sourceAiringHash || placement.source_airing_hash || '');
    if (hash && airingLookup.hash.has(hash)) return airingLookup.hash.get(hash);
    const keys = [pid, nola, title, lookupKey(placement.programTitle || placement.program_title || placement.title || placement.name || '')].filter(Boolean);
    const exactCandidates = [];
    const sameDayCandidates = [];
    keys.forEach((key) => {
      if (Number.isFinite(startMinutes)) exactCandidates.push(...(airingLookup.exact.get(`${dateKey}|${key}|${startMinutes}`) || []));
      sameDayCandidates.push(...(airingLookup.dateProgram.get(`${dateKey}|${key}`) || []));
      sameDayCandidates.push(...(airingLookup.dateNola.get(`${dateKey}|${key}`) || []));
      sameDayCandidates.push(...(airingLookup.dateTitle.get(`${dateKey}|${key}`) || []));
    });
    const uniqueRows = (rows) => {
      const unique = [];
      const seen = new Set();
      rows.forEach((record) => {
        const id = text(record.id || record.sourceAiringHash || `${record.dateKey}|${record.startMinutes}|${record.title}|${record.dollars}`);
        if (!id || seen.has(id)) return;
        seen.add(id);
        unique.push(record);
      });
      return unique;
    };
    const exact = uniqueRows(exactCandidates);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
    const sameDay = uniqueRows(sameDayCandidates);
    return sameDay.length === 1 ? sameDay[0] : null;
  }''')

a = replace_once(a, '''        const explicitDollars = firstNonEmpty(
          placement.importedBroadcastDollars,
          placement.actualDollars,''', '''        const explicitDollars = firstNonEmpty(
          placement.importedBroadcastDollars,
          placement.manualResultRecorded ? Number(placement.manualBroadcastDollars || 0) : null,
          placement.actualDollars,''', 'analytics explicit manual dollars')

a = replace_once(a, '''        const explicitPledges = firstNonEmpty(
          placement.importedPledges,
          placement.importedBroadcastPledges,
          placement.pledges,''', '''        const explicitPledges = firstNonEmpty(
          placement.importedPledges,
          placement.importedBroadcastPledges,
          placement.manualResultRecorded ? Number(placement.manualPledgeCount || 0) : null,
          placement.pledges,''', 'analytics explicit manual pledges')

a = replace_function(a, 'fetchAiringsForAnalytics', '''  async function fetchAiringsForAnalytics() {
    if (App.data?.fetchImportedAirings) return App.data.fetchImportedAirings();
    const base = 'id,program_id,pledge_program_id,manual_match_program_id,aired_at,air_date,air_time,contribution_amount,dollars,pledge_count,fundraiser_label,drive_start_date,drive_end_date,title,program_title,imported_program_title,matched_library_title,nola_code,row_hash,program_minutes';
    try {
      const rows = await fetchAll(AIRINGS_TABLE, `${base},raw_payload`, 'air_date');
      return App.data?.canonicalizeImportedAirings ? App.data.canonicalizeImportedAirings(rows) : rows;
    } catch (error) {
      console.warn('Airings raw_payload fetch failed; retrying without raw payload.', error);
      const rows = await fetchAll(AIRINGS_TABLE, base, 'air_date');
      return App.data?.canonicalizeImportedAirings ? App.data.canonicalizeImportedAirings(rows) : rows;
    }
  }''', async_fn=True)

outlier_helpers = '''  function outlierSummary(values = []) {
    const clean = values.map(Number).filter((value) => Number.isFinite(value));
    if (clean.length < 4) return { outlierCount: 0, highOutliers: 0, lowOutliers: 0, outlierValues: [] };
    const median = medianValue(clean);
    const deviations = clean.map((value) => Math.abs(value - median));
    const mad = medianValue(deviations);
    if (!(mad > 0)) return { outlierCount: 0, highOutliers: 0, lowOutliers: 0, outlierValues: [] };
    const outlierValues = clean.filter((value) => Math.abs((0.6745 * (value - median)) / mad) > 3.5);
    return {
      outlierCount: outlierValues.length,
      highOutliers: outlierValues.filter((value) => value > median).length,
      lowOutliers: outlierValues.filter((value) => value < median).length,
      outlierValues
    };
  }

  function outlierLabel(row = {}) {
    const count = Number(row.outlierCount || 0);
    if (!count) return 'None flagged';
    const bits = [];
    if (row.highOutliers) bits.push(`${row.highOutliers} high`);
    if (row.lowOutliers) bits.push(`${row.lowOutliers} low`);
    return `${count} unusual${bits.length ? ` · ${bits.join(' / ')}` : ''}`;
  }'''
a = insert_after_function(a, 'medianValue', outlier_helpers)

a = replace_once(a, '''      median: medianValue(records.map((record) => Number(record.dollars || 0))),
      weak:''', '''      median: medianValue(records.map((record) => Number(record.dollars || 0))),
      ...outlierSummary(records.map((record) => Number(record.dollars || 0))),
      weak:''', 'analytics summarize outliers')

a = a.replace("state.metric = 'avg';", "state.metric = 'median';")

a = replace_once(a, '''      note(`Loaded ${formatNumber(state.records.length)} usable pledge airing records. Active schedules: ${formatNumber(state.scheduleAudit.activeSchedules || 0)} of ${formatNumber(state.scheduleAudit.rawSchedules || 0)} (${formatNumber(state.scheduleAudit.duplicateSchedulesMerged || 0)} duplicate date-range row(s) merged). Schedule-derived rows: ${formatNumber(schedulePlacementCount)}. Live-break rows from saved schedules: ${formatNumber(scheduleLiveCount)}. Live-break source: ${LIVE_BREAK_ANALYTICS_SOURCE}.`);''', '''      const duplicateNote = Number(state.scheduleAudit.duplicateSchedulesSuppressed || 0)
        ? ` ${formatNumber(state.scheduleAudit.duplicateSchedulesSuppressed || 0)} saved schedule row(s) from ambiguous duplicate date ranges were excluded from schedule-derived analytics rather than blended.`
        : '';
      note(`Loaded ${formatNumber(state.records.length)} usable pledge airing records. Unambiguous schedules: ${formatNumber(state.scheduleAudit.activeSchedules || 0)} of ${formatNumber(state.scheduleAudit.rawSchedules || 0)}.${duplicateNote} Schedule-derived rows: ${formatNumber(schedulePlacementCount)}. Live-break rows from saved schedules: ${formatNumber(scheduleLiveCount)}. Live-break source: ${LIVE_BREAK_ANALYTICS_SOURCE}.`);''', 'analytics load duplicate notice')

# Median-first topic language and tables.
a = replace_once(a, "summary: 'Topic strength by average dollars per airing, with four-season coverage shown.',", "summary: 'Topic strength by median dollars per airing, with average, outliers, and four-season coverage shown.',", 'topics summary')
a = replace_once(a, "graphTitle: 'Topics by average dollars per airing',", "graphTitle: 'Topics by typical dollars per airing',", 'topics graph title')
a = replace_once(a, "metric: (rows) => rows[0] ? formatMoney(rows[0].avg) : '—',\n      tag: 'topic lens',", "metric: (rows) => rows[0] ? formatMoney(rows[0].median) : '—',\n      tag: 'topic lens',", 'topics metric')
a = replace_once(a, '''        ['Topic', (row) => labelWithMixCell(row), '', (row) => row.title],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money emphasis', (row) => row.avg],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]''', '''        ['Topic', (row) => labelWithMixCell(row), '', (row) => row.title],
        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis', (row) => row.median],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money', (row) => row.avg],
        ['Outliers', (row) => escapeHtml(outlierLabel(row)), '', (row) => row.outlierCount || 0],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]''', 'topics columns')

a = replace_once(a, "graphTitle: 'Secondary topics by average dollars per airing',", "graphTitle: 'Secondary topics by typical dollars per airing',", 'secondary graph title')
a = replace_once(a, "metric: (rows) => rows[0] ? formatMoney(rows[0].avg) : '—',\n      tag: 'subtopic lens',", "metric: (rows) => rows[0] ? formatMoney(rows[0].median) : '—',\n      tag: 'subtopic lens',", 'secondary metric')
a = replace_once(a, '''        ['Secondary topic', (row) => labelWithMixCell(row), '', (row) => row.title],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money emphasis', (row) => row.avg],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]''', '''        ['Secondary topic', (row) => labelWithMixCell(row), '', (row) => row.title],
        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis', (row) => row.median],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money', (row) => row.avg],
        ['Outliers', (row) => escapeHtml(outlierLabel(row)), '', (row) => row.outlierCount || 0],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]''', 'secondary columns')

# Broad topic overview should also expose median, average and outliers.
a = replace_once(a, '''        ['Topic', (row) => labelWithMixCell(row), '', (row) => row.title],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money emphasis', (row) => row.avg],
        ['Pledges', (row) => formatNumber(row.pledges), 'num', (row) => row.pledges],''', '''        ['Topic', (row) => labelWithMixCell(row), '', (row) => row.title],
        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis', (row) => row.median],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money', (row) => row.avg],
        ['Outliers', (row) => escapeHtml(outlierLabel(row)), '', (row) => row.outlierCount || 0],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['Pledges', (row) => formatNumber(row.pledges), 'num', (row) => row.pledges],''', 'topic overview columns')

apath.write_text(a, encoding='utf-8')

# ---------------- Performance Analytics HTML ----------------
hpath = Path('assets/analytics-workspace.html')
h = hpath.read_text(encoding='utf-8')
h = replace_once(h, '''        <select id="adv-metric">
          <option value="median">Median $ / airing</option>
          <option value="avg">Average $ / airing</option>
          <option value="total" selected>Total dollars</option>
          <option value="pledges">Pledge count</option>
          <option value="broadcasts">Broadcast count</option>
        </select>''', '''        <select id="adv-metric">
          <option value="median" selected>Median $ / airing</option>
          <option value="avg">Average $ / airing</option>
          <option value="pledges">Pledge count</option>
          <option value="broadcasts">Broadcast count</option>
          <optgroup label="Volume context">
            <option value="total">Total dollars</option>
          </optgroup>
        </select>''', 'metric options')
h = replace_once(h, '''          <option value="morning">Morning</option>
          <option value="afternoon">Afternoon</option>
          <option value="evening">Evening</option>
          <option value="overnight">Overnight</option>''', '''          <option value="morning">Morning</option>
          <option value="afternoon">Afternoon</option>
          <option value="early-evening">Early Evening</option>
          <option value="prime">Prime</option>
          <option value="overnight">Overnight</option>''', 'WNMU daypart options')
hpath.write_text(h, encoding='utf-8')

# ---------------- Fundraiser Comparison Lab ----------------
cpath = Path('assets/js/ui-fundraiser-comparison.js')
c = cpath.read_text(encoding='utf-8')

strength_helpers = '''  function medianValue(values = []) {
    const clean = values.map(Number).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!clean.length) return 0;
    const mid = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
  }

  function outlierSummary(values = []) {
    const clean = values.map(Number).filter((value) => Number.isFinite(value));
    if (clean.length < 4) return { outlierCount: 0, highOutliers: 0, lowOutliers: 0, outlierValues: [] };
    const median = medianValue(clean);
    const mad = medianValue(clean.map((value) => Math.abs(value - median)));
    if (!(mad > 0)) return { outlierCount: 0, highOutliers: 0, lowOutliers: 0, outlierValues: [] };
    const outlierValues = clean.filter((value) => Math.abs((0.6745 * (value - median)) / mad) > 3.5);
    return {
      outlierCount: outlierValues.length,
      highOutliers: outlierValues.filter((value) => value > median).length,
      lowOutliers: outlierValues.filter((value) => value < median).length,
      outlierValues
    };
  }

  function groupStrength(group = {}) {
    const results = Array.isArray(group.results) ? group.results.map(Number).filter((value) => Number.isFinite(value)) : [];
    const total = results.reduce((sum, value) => sum + value, 0);
    return {
      median: medianValue(results),
      avg: results.length ? total / results.length : 0,
      count: results.length,
      ...outlierSummary(results)
    };
  }

  function outlierShortLabel(strength = {}) {
    const count = Number(strength.outlierCount || 0);
    if (!count) return '';
    if (strength.highOutliers && !strength.lowOutliers) return `${count} unusual high`;
    if (strength.lowOutliers && !strength.highOutliers) return `${count} unusual low`;
    return `${count} unusual`;
  }'''
c = insert_after_function(c, 'dollarsPerHour', strength_helpers)

c = replace_function(c, 'addGroup', '''  function addGroup(map, key, minutes, result) {
    if (!map.has(key)) map.set(key, { key, minutes: 0, scheduled: 0, completed: 0, dollars: 0, pledges: 0, results: [] });
    const item = map.get(key);
    item.minutes += Number(minutes || 0);
    item.scheduled += 1;
    if (result.known) {
      item.completed += 1;
      item.dollars += Number(result.dollars || 0);
      item.pledges += Number(result.pledges || 0);
      item.results.push(Number(result.dollars || 0));
    }
  }''')

c = replace_function(c, 'aggregatePlacementRows', '''  function aggregatePlacementRows(rows = [], keyFn = () => '') {
    const map = new Map();
    rows.forEach((row) => {
      const key = text(keyFn(row)) || 'Unknown';
      if (!map.has(key)) map.set(key, { key, minutes: 0, dollars: 0, pledges: 0, scheduled: 0, completed: 0, results: [] });
      const item = map.get(key);
      item.minutes += Number(row.minutes || 0);
      item.dollars += Number(row.dollars || 0);
      item.pledges += Number(row.pledges || 0);
      item.scheduled += 1;
      if (row.known) {
        item.completed += 1;
        item.results.push(Number(row.dollars || 0));
      }
    });
    return map;
  }''')

c = replace_once(c, '''analysis[field].get(key) || { minutes: 0, scheduled: 0, completed: 0, dollars: 0, pledges: 0 }''', '''analysis[field].get(key) || { minutes: 0, scheduled: 0, completed: 0, dollars: 0, pledges: 0, results: [] }''', 'comparison union fallback')

c = replace_function(c, 'renderTopicScheduleMix', '''  function renderTopicScheduleMix(analyses = []) {
    const rows = unionRows(analyses, 'topics')
      .map((row) => ({
        ...row,
        maxMedian: Math.max(0, ...row.values.map((value) => groupStrength(value).median)),
        totalMinutes: row.values.reduce((sum, value) => sum + Number(value.minutes || 0), 0),
        totalDollars: row.values.reduce((sum, value) => sum + Number(value.dollars || 0), 0)
      }))
      .filter((row) => row.totalMinutes > 0 || row.totalDollars > 0)
      .sort((a, b) => b.maxMedian - a.maxMedian || b.totalDollars - a.totalDollars || b.totalMinutes - a.totalMinutes || a.key.localeCompare(b.key));

    if (!rows.length) return '<section class="fc-panel"><h3>Topic hours vs performance</h3><div class="fc-chart-empty">No topic schedule/results to graph.</div></section>';

    const legend = rows.map((row, index) => `<span class="fc-legend-item"><i style="background:hsl(${chartHue(index)} 65% 48%)"></i>${escapeHtml(row.key)}</span>`).join('');
    const body = analyses.map((analysis) => {
      const totalMinutes = Number(analysis.scheduledMinutes || 0) || [...analysis.topics.values()].reduce((sum, row) => sum + Number(row.minutes || 0), 0);
      const totalDollars = [...analysis.topics.values()].reduce((sum, row) => sum + Number(row.dollars || 0), 0);
      const overallRate = dollarsPerHour(analysis.broadcastDollars, totalMinutes);
      const scheduleSegments = rows.map((row, index) => {
        const value = analysis.topics.get(row.key) || {};
        const minutes = Number(value.minutes || 0);
        if (!(minutes > 0) || !(totalMinutes > 0)) return '';
        const share = (minutes / totalMinutes) * 100;
        return `<span class="fc-stack-segment" style="width:${share.toFixed(2)}%;background:hsl(${chartHue(index)} 65% 48%)" title="${escapeHtml(row.key)} · ${escapeHtml(hoursLabel(minutes))} of ${escapeHtml(hoursLabel(totalMinutes))} · ${Math.round(share)}% of scheduled hours">${share >= 11 ? `${Math.round(share)}%` : ''}</span>`;
      }).join('');
      const revenueSegments = rows.map((row, index) => {
        const value = analysis.topics.get(row.key) || {};
        const dollars = Number(value.dollars || 0);
        if (!(dollars > 0) || !(totalDollars > 0)) return '';
        const share = (dollars / totalDollars) * 100;
        return `<span class="fc-stack-segment" style="width:${share.toFixed(2)}%;background:hsl(${chartHue(index)} 65% 48%)" title="${escapeHtml(row.key)} · ${escapeHtml(money(dollars))} · ${Math.round(share)}% of attributable Broadcast $">${share >= 11 ? `${Math.round(share)}%` : ''}</span>`;
      }).join('');
      const topicMetrics = rows.map((row) => {
        const value = analysis.topics.get(row.key) || {};
        const minutes = Number(value.minutes || 0);
        const dollars = Number(value.dollars || 0);
        if (!(minutes > 0) && !(dollars > 0)) return '';
        const strength = groupStrength(value);
        const scheduleShare = totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0;
        const revenueShare = totalDollars > 0 ? (dollars / totalDollars) * 100 : 0;
        const unusual = outlierShortLabel(strength);
        return `<div class="fc-topic-metric-chip"><button type="button" class="fc-topic-drill-button" data-topic-drill="${escapeHtml(row.key)}">${escapeHtml(row.key)}</button><span class="fc-strength-line"><b>Median ${escapeHtml(money(strength.median))}</b>/airing · Avg ${escapeHtml(money(strength.avg))} · ${number(strength.count)} result${strength.count === 1 ? '' : 's'}${unusual ? ` · <em>${escapeHtml(unusual)}</em>` : ''}</span><span>${escapeHtml(hoursLabel(minutes))} of ${escapeHtml(hoursLabel(totalMinutes))} · ${Math.round(scheduleShare)}% schedule</span><span>${escapeHtml(money(dollars))} · ${Math.round(revenueShare)}% revenue</span></div>`;
      }).join('');
      return `<div class="fc-topic-pair-row"><div class="fc-topic-pair-label"><strong>${escapeHtml(analysis.schedule.title)}</strong><span>${escapeHtml(String(analysis.schedule.year || ''))}</span><em>${escapeHtml(hoursLabel(totalMinutes))} total · ${escapeHtml(money(overallRate))}/fundraising hr</em></div><div class="fc-topic-pair-bars"><div class="fc-share-line"><b>Hours</b><div class="fc-stack-track">${scheduleSegments}</div><span>${escapeHtml(hoursLabel(totalMinutes))}</span></div><div class="fc-share-line"><b>Revenue</b><div class="fc-stack-track">${revenueSegments}</div><span>${escapeHtml(money(totalDollars))}</span></div><div class="fc-topic-metric-grid">${topicMetrics}</div></div></div>`;
    }).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>Topic hours vs performance</h3><span>Median $/airing is the primary strength signal. Average, sample size and unusual results stay visible beside schedule share and actual revenue share, so a lightly scheduled topic can still stand out.</span></div></div><div class="fc-topic-pair-chart">${body}</div><div class="fc-legend">${legend}</div></section>`;
  }''')

c = replace_function(c, 'renderTopicHeatmap', '''  function renderTopicHeatmap(analyses = []) {
    const rows = unionRows(analyses, 'topics')
      .map((row) => ({
        ...row,
        totalMinutes: row.values.reduce((sum, value) => sum + Number(value.minutes || 0), 0),
        maxMedian: Math.max(0, ...row.values.map((value) => groupStrength(value).median))
      }))
      .filter((row) => row.totalMinutes > 0 || row.maxMedian > 0)
      .sort((a, b) => b.maxMedian - a.maxMedian || b.totalMinutes - a.totalMinutes || a.key.localeCompare(b.key));

    if (!rows.length) return '<section class="fc-panel"><h3>Topic strength heatmap</h3><div class="fc-chart-empty">No schedule/results available for the heatmap.</div></section>';

    const maxMedian = Math.max(1, ...rows.flatMap((row) => row.values.map((value) => groupStrength(value).median)));
    const head = analyses.map((analysis) => `<th>${escapeHtml(analysis.schedule.title)}<span>${escapeHtml(String(analysis.schedule.year || ''))}</span></th>`).join('');
    const body = rows.map((row) => `<tr><th><button type="button" class="fc-topic-drill-button" data-topic-drill="${escapeHtml(row.key)}">${escapeHtml(row.key)}</button></th>${row.values.map((value) => {
      const minutes = Number(value.minutes || 0);
      const dollars = Number(value.dollars || 0);
      const strength = groupStrength(value);
      if (!(minutes > 0) && !strength.count) return '<td class="fc-heat-zero">—</td>';
      const intensity = Math.max(0, Math.min(1, strength.median / maxMedian));
      const alpha = strength.count ? (0.12 + (intensity * 0.76)).toFixed(2) : '0.04';
      const dark = intensity >= 0.53 ? ' fc-heat-dark' : '';
      const unusual = outlierShortLabel(strength);
      return `<td class="fc-heat-cell${dark}" style="background:rgba(29,95,150,${alpha})" title="${escapeHtml(row.key)} · ${escapeHtml(hoursLabel(minutes))} · median ${escapeHtml(money(strength.median))}/airing · average ${escapeHtml(money(strength.avg))} · ${number(strength.count)} results · total ${escapeHtml(money(dollars))}${unusual ? ` · ${escapeHtml(unusual)}` : ''}"><strong>${escapeHtml(hoursLabel(minutes))}</strong><span>Median ${escapeHtml(money(strength.median))}</span><small>Avg ${escapeHtml(money(strength.avg))} · ${number(strength.count)} results</small><small>Total ${escapeHtml(money(dollars))}${unusual ? ` · ${escapeHtml(unusual)}` : ''}</small></td>`;
    }).join('')}</tr>`).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>Topic strength heatmap</h3><span>Printed number = scheduled hours. Color intensity = Median $/airing. Average, result count and actual total dollars remain visible in each cell.</span></div><div class="fc-heat-scale"><span>lower median</span><i></i><span>higher median</span></div></div><div class="fc-table-wrap"><table class="fc-heatmap"><thead><tr><th>Topic</th>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
  }''')

c = replace_function(c, 'renderTopicDrilldown', '''  function renderTopicDrilldown(analyses = [], topic = '') {
    const wanted = text(topic);
    if (!wanted) return '';
    const sets = analyses.map((analysis) => ({
      analysis,
      rows: (analysis.placementRows || []).filter((row) => row.topic === wanted)
    }));
    const useSecondary = CERTIFIED_SUBTOPIC_TOPICS.has(lookupKey(wanted));
    const keyFor = useSecondary
      ? (row) => (text(row.secondary) && text(row.secondary) !== 'Unspecified' ? text(row.secondary) : 'Unspecified')
      : (row) => text(row.title) || 'Untitled program';
    const maps = sets.map((set) => aggregatePlacementRows(set.rows, keyFor));
    const keys = new Set(maps.flatMap((map) => [...map.keys()]));
    const rows = [...keys].map((key) => {
      const programs = useSecondary
        ? [...new Set(sets.flatMap((set) => set.rows.filter((row) => keyFor(row) === key).map((row) => text(row.title)).filter(Boolean)))].sort()
        : [];
      const values = maps.map((map) => map.get(key) || { minutes: 0, dollars: 0, scheduled: 0, completed: 0, results: [] });
      return { key, programs, values, maxMedian: Math.max(0, ...values.map((value) => groupStrength(value).median)) };
    }).sort((a, b) => b.maxMedian - a.maxMedian || b.values.reduce((sum, value) => sum + Number(value.dollars || 0), 0) - a.values.reduce((sum, value) => sum + Number(value.dollars || 0), 0));
    const maxMedian = Math.max(1, ...rows.flatMap((row) => row.values.map((value) => groupStrength(value).median)));
    const head = analyses.map((analysis) => `<th>${escapeHtml(analysis.schedule.title)}<span>${escapeHtml(String(analysis.schedule.year || ''))}</span></th>`).join('');
    const body = rows.map((row) => `<tr><th><strong>${escapeHtml(row.key)}</strong>${row.programs.length ? `<small class="fc-topic-drill-programs">${row.programs.map(escapeHtml).join(' · ')}</small>` : ''}</th>${row.values.map((value) => {
      const dollars = Number(value.dollars || 0);
      const minutes = Number(value.minutes || 0);
      const strength = groupStrength(value);
      const intensity = Math.max(0, Math.min(1, strength.median / maxMedian));
      const alpha = strength.count ? (0.10 + intensity * 0.58).toFixed(2) : '0.02';
      const unusual = outlierShortLabel(strength);
      return `<td style="background:rgba(29,95,150,${alpha})"><strong>${escapeHtml(hoursLabel(minutes))}</strong><span>Median ${escapeHtml(money(strength.median))}</span><small>Avg ${escapeHtml(money(strength.avg))} · ${number(strength.count)} results</small><small>Total ${escapeHtml(money(dollars))}${unusual ? ` · ${escapeHtml(unusual)}` : ''}</small></td>`;
    }).join('')}</tr>`).join('');
    const mode = useSecondary ? 'Certified subtopic breakdown' : 'Program-title breakdown';
    const note = useSecondary
      ? 'Median $/airing is the primary strength signal. Program titles are listed beneath each subtopic; average, total dollars, sample size and unusual results remain visible.'
      : 'Median $/airing is the primary strength signal. This topic defaults to program titles; subtopics are only used after the taxonomy is certified as analytically meaningful.';
    return `<section class="fc-panel fc-topic-drill"><div class="fc-panel-head"><div><h3>${escapeHtml(wanted)} drill-down</h3><span>${escapeHtml(mode)} · ${escapeHtml(note)}</span></div><button type="button" class="ghost fc-topic-drill-close" id="fc-topic-drill-close">Close</button></div>${rows.length ? `<div class="fc-table-wrap"><table class="fc-topic-drill-table"><thead><tr><th>${escapeHtml(useSecondary ? 'Subtopic' : 'Program')}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>` : '<div class="fc-chart-empty">No scheduled programs in this topic for the selected fundraisers.</div>'}</section>`;
  }''')

# Add strength context to A/B subtopic and topic diagnostic lines.
c = replace_once(c, '''      return `<details class="fc-subtopic-diagnostic"><summary><span><strong>${escapeHtml(row.key)}</strong><small>${escapeHtml(hoursLabel(row.base.minutes))} / ${escapeHtml(money(row.base.dollars))} → ${escapeHtml(hoursLabel(row.current.minutes))} / ${escapeHtml(money(row.current.dollars))}</small></span><b class="${difference > 0 ? 'positive' : difference < 0 ? 'negative' : ''}">${escapeHtml(signedMoney(difference))}</b></summary>''', '''      const baseStrength = groupStrength(row.base);
      const currentStrength = groupStrength(row.current);
      return `<details class="fc-subtopic-diagnostic"><summary><span><strong>${escapeHtml(row.key)}</strong><small>${escapeHtml(hoursLabel(row.base.minutes))} / ${escapeHtml(money(row.base.dollars))} → ${escapeHtml(hoursLabel(row.current.minutes))} / ${escapeHtml(money(row.current.dollars))}</small><small>Median ${escapeHtml(money(baseStrength.median))} → ${escapeHtml(money(currentStrength.median))} · Avg ${escapeHtml(money(baseStrength.avg))} → ${escapeHtml(money(currentStrength.avg))}</small></span><b class="${difference > 0 ? 'positive' : difference < 0 ? 'negative' : ''}">${escapeHtml(signedMoney(difference))}</b></summary>''', 'subtopic strength context')

c = replace_once(c, '''      const subtopicDiagnostics = useSecondary ? renderSubtopicDiagnostics(base, current, row.key) : '';
      return `<article class="fc-topic-diagnostic">''', '''      const subtopicDiagnostics = useSecondary ? renderSubtopicDiagnostics(base, current, row.key) : '';
      const baseStrength = groupStrength(row.baseline);
      const currentStrength = groupStrength(row.current);
      const baseUnusual = outlierShortLabel(baseStrength);
      const currentUnusual = outlierShortLabel(currentStrength);
      return `<article class="fc-topic-diagnostic">''', 'topic strength variables')

c = replace_once(c, '''<div class="fc-topic-core"><div><span>A</span><b>${escapeHtml(hoursLabel(row.baseline.minutes))} · ${escapeHtml(money(row.baseline.dollars))}</b><small>${escapeHtml(money(dollarsPerHour(row.baseline.dollars, row.baseline.minutes)))}/hr</small></div><i>→</i><div><span>B</span><b>${escapeHtml(hoursLabel(row.current.minutes))} · ${escapeHtml(money(row.current.dollars))}</b><small>${escapeHtml(money(dollarsPerHour(row.current.dollars, row.current.minutes)))}/hr</small></div></div>''', '''<div class="fc-topic-core"><div><span>A</span><b>Median ${escapeHtml(money(baseStrength.median))}/airing</b><small>Avg ${escapeHtml(money(baseStrength.avg))} · ${number(baseStrength.count)} results${baseUnusual ? ` · ${escapeHtml(baseUnusual)}` : ''}</small><small>${escapeHtml(hoursLabel(row.baseline.minutes))} · total ${escapeHtml(money(row.baseline.dollars))}</small></div><i>→</i><div><span>B</span><b>Median ${escapeHtml(money(currentStrength.median))}/airing</b><small>Avg ${escapeHtml(money(currentStrength.avg))} · ${number(currentStrength.count)} results${currentUnusual ? ` · ${escapeHtml(currentUnusual)}` : ''}</small><small>${escapeHtml(hoursLabel(row.current.minutes))} · total ${escapeHtml(money(row.current.dollars))}</small></div></div>''', 'topic core median')

# Hourly pledge-window weather.
weather_helpers = '''  function pledgeWeatherWindowForDate(dateKey = '') {
    const date = parseDate(dateKey);
    const weekend = Boolean(date && (date.getDay() === 0 || date.getDay() === 6));
    return { startHour: weekend ? 15 : 17, endHourExclusive: 24, label: weekend ? '3 PM-midnight' : '5 PM-midnight' };
  }

  function stationPledgeWindowSummaries(hourly = {}) {
    const buckets = new Map();
    (hourly.time || []).forEach((stamp, index) => {
      const raw = text(stamp);
      const dateKey = raw.slice(0, 10);
      const hour = Number(raw.slice(11, 13));
      if (!dateKey || !Number.isFinite(hour)) return;
      const window = pledgeWeatherWindowForDate(dateKey);
      if (hour < window.startHour || hour >= window.endHourExclusive) return;
      if (!buckets.has(dateKey)) buckets.set(dateKey, { temps: [], precip: 0, windowLabel: window.label });
      const bucket = buckets.get(dateKey);
      const temp = Number(hourly.temperature_2m?.[index]);
      const precip = Number(hourly.precipitation?.[index]);
      if (Number.isFinite(temp)) bucket.temps.push(temp);
      if (Number.isFinite(precip)) bucket.precip += precip;
    });
    const summaries = new Map();
    buckets.forEach((bucket, dateKey) => {
      summaries.set(dateKey, {
        avgTemp: bucket.temps.length ? bucket.temps.reduce((sum, value) => sum + value, 0) / bucket.temps.length : null,
        precip: bucket.precip,
        windowLabel: bucket.windowLabel
      });
    });
    return summaries;
  }'''
c = insert_after_function(c, 'weatherDateIsFetchable', weather_helpers)

c = replace_function(c, 'fetchStationWeather', '''  async function fetchStationWeather(location, startDate, endDate) {
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
        return { location, hourly: data.hourly };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`${location.name} weather unavailable`);
  }''', async_fn=True)

c = replace_function(c, 'fetchWeatherForAnalysis', '''  async function fetchWeatherForAnalysis(analysis = {}) {
    const dates = [...new Set((analysis.placementRows || []).map((row) => text(row.dateKey)).filter(Boolean))].sort();
    const fetchableDates = dates.filter((dateKey) => weatherDateIsFetchable(dateKey));
    if (!fetchableDates.length) return;
    const startDate = fetchableDates[0];
    const endDate = fetchableDates[fetchableDates.length - 1];
    const settled = await Promise.allSettled(WEATHER_LOCATIONS.map((location) => fetchStationWeather(location, startDate, endDate)));
    const successes = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value);
    if (!successes.length) throw new Error('Regional weather could not be loaded from Open-Meteo.');

    const perDate = new Map();
    successes.forEach(({ location, hourly }) => {
      stationPledgeWindowSummaries(hourly).forEach((summary, dateKey) => {
        if (!perDate.has(dateKey)) perDate.set(dateKey, []);
        perDate.get(dateKey).push({ location: location.name, ...summary });
      });
    });

    perDate.forEach((rows, dateKey) => {
      const average = (field) => {
        const values = rows.map((row) => Number(row[field])).filter(Number.isFinite);
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      };
      state.weatherByDate.set(dateKey, {
        stations: rows.length,
        avgTemp: average('avgTemp'),
        precip: average('precip'),
        wetStations: rows.filter((row) => Number(row.precip || 0) >= 0.01).length,
        windowLabel: rows[0]?.windowLabel || pledgeWeatherWindowForDate(dateKey).label
      });
    });
  }''', async_fn=True)

c = replace_function(c, 'weatherMarkup', '''  function weatherMarkup(dateKey = '') {
    const weather = state.weatherByDate.get(text(dateKey));
    if (!weather) {
      if (!weatherDateIsFetchable(dateKey)) return '<span class="fc-weather-line muted">Weather not available yet</span>';
      if (state.weatherLoading) return '<span class="fc-weather-line loading">Loading U.P. weather…</span>';
      if (state.weatherError) return `<span class="fc-weather-line error">${escapeHtml(state.weatherError)}</span>`;
      return '<span class="fc-weather-line muted">Weather unavailable</span>';
    }
    const temp = Number.isFinite(weather.avgTemp) ? `${Math.round(weather.avgTemp)}°F avg` : 'temp —';
    const precip = Number.isFinite(weather.precip) ? `${weather.precip.toFixed(weather.precip < 0.1 ? 2 : 1)} in avg precip` : 'precip —';
    const wet = `${weather.wetStations}/${weather.stations} regions wet`;
    return `<span class="fc-weather-line">${escapeHtml(weather.windowLabel || 'Pledge window')} · ${escapeHtml(temp)} · ${escapeHtml(precip)} · ${escapeHtml(wet)}</span>`;
  }''')

scatter_function = '''  function renderWeatherScatter(analyses = []) {
    const points = [];
    analyses.forEach((analysis, analysisIndex) => {
      calendarDays(analysis).forEach((day) => {
        const weather = state.weatherByDate.get(text(day.dateKey));
        if (!weather || !Number.isFinite(weather.avgTemp) || !Number.isFinite(weather.precip)) return;
        const offset = fundraiserDayOffset(analysis, day);
        const label = Number.isFinite(offset) ? fundraiserDayLabel(offset).title : day.weekday;
        const programming = dailyProgrammingSummary(day);
        points.push({
          analysis,
          analysisIndex,
          day,
          weather,
          label,
          rate: dollarsPerHour(day.dollars, day.minutes),
          hours: Number(day.minutes || 0) / 60,
          programming
        });
      });
    });
    if (points.length < 2) {
      if (state.weatherLoading) return '<section class="fc-panel"><h3>Weather & pledge performance</h3><div class="fc-chart-empty">Loading pledge-window weather for the scatter view…</div></section>';
      return '';
    }
    const width = 880;
    const height = 390;
    const pad = { left: 72, right: 28, top: 24, bottom: 62 };
    const temps = points.map((point) => point.weather.avgTemp);
    const precips = points.map((point) => point.weather.precip);
    let minTemp = Math.floor(Math.min(...temps) / 5) * 5;
    let maxTemp = Math.ceil(Math.max(...temps) / 5) * 5;
    if (minTemp === maxTemp) { minTemp -= 5; maxTemp += 5; }
    const maxPrecip = Math.max(0.05, ...precips);
    const maxRate = Math.max(1, ...points.map((point) => point.rate));
    const maxHours = Math.max(1, ...points.map((point) => point.hours));
    const x = (temp) => pad.left + ((temp - minTemp) / (maxTemp - minTemp)) * (width - pad.left - pad.right);
    const y = (precip) => pad.top + (height - pad.top - pad.bottom) * (1 - (precip / maxPrecip));
    const xTicks = Array.from({ length: 5 }, (_, index) => minTemp + ((maxTemp - minTemp) * index / 4));
    const yTicks = Array.from({ length: 5 }, (_, index) => maxPrecip * index / 4);
    const circles = points.map((point) => {
      const radius = 5 + 9 * Math.sqrt(point.hours / maxHours);
      const opacity = 0.28 + 0.67 * Math.sqrt(Math.max(0, point.rate) / maxRate);
      const title = `${point.analysis.schedule.title} · ${point.label} · ${point.day.dateLabel} · ${point.weather.windowLabel}: ${Math.round(point.weather.avgTemp)}°F avg, ${point.weather.precip.toFixed(2)} in avg precip · ${money(point.day.dollars)} Broadcast · ${hoursLabel(point.day.minutes)} · ${money(point.rate)}/hr · ${point.programming.topics || 'No topic detail'} · ${point.programming.titles || 'No program detail'}`;
      return `<circle cx="${x(point.weather.avgTemp).toFixed(1)}" cy="${y(point.weather.precip).toFixed(1)}" r="${radius.toFixed(1)}" fill="hsl(${chartHue(point.analysisIndex)} 65% 45% / ${opacity.toFixed(2)})" stroke="hsl(${chartHue(point.analysisIndex)} 65% 32%)" stroke-width="1.5"><title>${escapeHtml(title)}</title></circle>`;
    }).join('');
    const legend = analyses.map((analysis, index) => `<span class="fc-weather-legend-item"><i style="background:hsl(${chartHue(index)} 65% 45%)"></i>${escapeHtml(analysis.schedule.title)} ${escapeHtml(String(analysis.schedule.year || ''))}</span>`).join('');
    return `<section class="fc-panel fc-weather-scatter"><div class="fc-panel-head"><div><h3>Weather & pledge performance</h3><span>Each point is one fundraiser day. X = average temperature during the pledge window; Y = average precipitation across the five U.P. locations. Larger points mean more fundraising hours; stronger point intensity means higher Broadcast $/fundraising hour.</span></div></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Weather and pledge performance scatter"><rect x="0" y="0" width="${width}" height="${height}" fill="#fbfdfe"></rect>${yTicks.map((tick) => `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}" stroke="#dfe9ed"></line><text x="${pad.left - 10}" y="${y(tick) + 4}" text-anchor="end" font-size="12" fill="#607685">${tick.toFixed(tick < 0.1 ? 2 : 1)} in</text>`).join('')}${xTicks.map((tick) => `<line x1="${x(tick)}" x2="${x(tick)}" y1="${pad.top}" y2="${height - pad.bottom}" stroke="#edf2f4"></line><text x="${x(tick)}" y="${height - 32}" text-anchor="middle" font-size="12" fill="#607685">${Math.round(tick)}°F</text>`).join('')}<text x="${width / 2}" y="${height - 8}" text-anchor="middle" font-size="13" font-weight="700" fill="#29465b">Average pledge-window temperature</text><text x="16" y="${height / 2}" text-anchor="middle" font-size="13" font-weight="700" fill="#29465b" transform="rotate(-90 16 ${height / 2})">Average pledge-window precipitation</text>${circles}</svg><div class="fc-weather-legend">${legend}</div><div class="fc-weather-scatter-note">Weather window: Monday-Friday 5 PM-midnight; Saturday-Sunday 3 PM-midnight. Point intensity is a visual performance cue, not evidence that weather caused the result. Hover a point for the day, dollars, hours and leading programming.</div></section>`;
  }'''
c = insert_after_function(c, 'renderDailyContext', scatter_function)

c = replace_once(c, '''${renderDailyContext(analyses)}${renderTopicScheduleMix(analyses)}''', '''${renderDailyContext(analyses)}${renderWeatherScatter(dailyContextAnalyses(analyses))}${renderTopicScheduleMix(analyses)}''', 'insert weather scatter')

# CSS enhancements.
c = replace_once(c, '''.fc-topic-metric-chip span{font-size:.66rem;color:#607685}''', '''.fc-topic-metric-chip span{font-size:.66rem;color:#607685}.fc-strength-line b{color:#103a66}.fc-strength-line em{font-style:normal;font-weight:900;color:#8a5f15}''', 'strength css')
c = replace_once(c, '''.fc-heat-cell span{display:block;font-size:.68rem;font-weight:700;margin-top:2px}''', '''.fc-heat-cell span{display:block;font-size:.68rem;font-weight:700;margin-top:2px}.fc-heat-cell small{display:block;font-size:.62rem;font-weight:700;margin-top:2px}''', 'heat small css')
c = replace_once(c, '''.fc-weather-source{font-size:.67rem;color:#6d8291;border-top:1px solid #e6edef;padding-top:7px}''', '''.fc-weather-source{font-size:.67rem;color:#6d8291;border-top:1px solid #e6edef;padding-top:7px}.fc-weather-scatter svg{width:100%;min-height:320px;border:1px solid #e1eaee;border-radius:12px;background:#fbfdfe}.fc-weather-legend{display:flex;flex-wrap:wrap;gap:7px 12px;margin-top:8px}.fc-weather-legend-item{display:inline-flex;align-items:center;gap:5px;color:#536d7d;font-size:.72rem}.fc-weather-legend-item i{width:10px;height:10px;border-radius:50%;display:inline-block}.fc-weather-scatter-note{font-size:.68rem;color:#6d8291;line-height:1.35;margin-top:6px}''', 'weather scatter css')

cpath.write_text(c, encoding='utf-8')

# ---------------- Comparison tests ----------------
tpath = Path('tests/fundraiser-comparison.test.mjs')
t = tpath.read_text(encoding='utf-8')
t = replace_once(t, '''dailyContextAnalyses, weatherDateIsFetchable };''', '''dailyContextAnalyses, weatherDateIsFetchable, medianValue, outlierSummary, groupStrength, pledgeWeatherWindowForDate, stationPledgeWindowSummaries };''', 'comparison test hooks')
t += '''

test('median average and MAD outlier flag preserve an unusual high result', () => {
  const values = [0, 150, 240, 310, 2400];
  assert.equal(hooks.medianValue(values), 240);
  const strength = hooks.groupStrength({ results: values });
  assert.equal(strength.avg, 620);
  assert.equal(strength.median, 240);
  assert.equal(strength.outlierCount, 1);
  assert.equal(strength.highOutliers, 1);
  assert.deepEqual(Array.from(strength.outlierValues), [2400]);
});

test('pledge weather windows use weekday evenings and weekend 3 PM starts', () => {
  const monday = hooks.pledgeWeatherWindowForDate('2026-08-10');
  const saturday = hooks.pledgeWeatherWindowForDate('2026-08-08');
  assert.equal(monday.startHour, 17);
  assert.equal(monday.endHourExclusive, 24);
  assert.equal(saturday.startHour, 15);
  assert.equal(saturday.endHourExclusive, 24);
});

test('hourly weather aggregation excludes hours outside the pledge window', () => {
  const summaries = hooks.stationPledgeWindowSummaries({
    time: ['2026-08-10T10:00', '2026-08-10T17:00', '2026-08-10T18:00', '2026-08-10T23:00'],
    temperature_2m: [90, 60, 64, 68],
    precipitation: [9, 0.01, 0.02, 0.03]
  });
  const day = summaries.get('2026-08-10');
  assert.ok(day);
  assert.equal(day.avgTemp, 64);
  nearlyEqual(day.precip, 0.06);
  assert.equal(day.windowLabel, '5 PM-midnight');
});
'''
tpath.write_text(t, encoding='utf-8')

# ---------------- Performance Analytics tests ----------------
perf_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = new URL('../assets/js/ui-analytics.js', import.meta.url);
let source = fs.readFileSync(sourcePath, 'utf8');
const exportMarker = '  App.analyticsUi = { ensureReady, openCohort, reload };';
assert.ok(source.includes(exportMarker), 'analytics test export marker must exist');
source = source.replace(exportMarker, `${exportMarker}\n  globalThis.__analyticsTestHooks = { daypartFromMinutes, medianValue, outlierSummary, buildAiringRecordLookup, findAiringForSchedulePlacement, buildScheduleRecords, dedupeSchedulesByDateRange, getScheduleAudit: () => state.scheduleAudit, getMetric: () => state.metric };`);

const storage = new Map();
const context = {
  window: {
    PledgeLib: { constants: {}, state: {}, data: {}, derive: {}, utils: {} },
    sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async () => { throw new Error('network unavailable in analytics tests'); }
  },
  document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {}, createElement: () => ({ innerHTML: '', textContent: '', innerText: '' }) },
  console,
  Date,
  Map,
  Set,
  Promise,
  Number,
  String,
  Math,
  Intl,
  URLSearchParams
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'ui-analytics.js' });
const hooks = context.__analyticsTestHooks;

test('Performance Analytics defaults to median', () => {
  assert.equal(hooks.getMetric(), 'median');
});

test('WNMU daypart boundaries are shared by Performance Analytics', () => {
  assert.equal(hooks.daypartFromMinutes(390), 'overnight');
  assert.equal(hooks.daypartFromMinutes(420), 'morning');
  assert.equal(hooks.daypartFromMinutes(690), 'morning');
  assert.equal(hooks.daypartFromMinutes(720), 'afternoon');
  assert.equal(hooks.daypartFromMinutes(990), 'afternoon');
  assert.equal(hooks.daypartFromMinutes(1020), 'early-evening');
  assert.equal(hooks.daypartFromMinutes(1170), 'early-evening');
  assert.equal(hooks.daypartFromMinutes(1200), 'prime');
  assert.equal(hooks.daypartFromMinutes(1320), 'prime');
  assert.equal(hooks.daypartFromMinutes(1350), 'overnight');
});

test('MAD outlier detection flags a single unusually high airing', () => {
  const result = hooks.outlierSummary([0, 150, 240, 310, 2400]);
  assert.equal(hooks.medianValue([0, 150, 240, 310, 2400]), 240);
  assert.equal(result.outlierCount, 1);
  assert.equal(result.highOutliers, 1);
  assert.deepEqual(Array.from(result.outlierValues), [2400]);
});

function airing({ id, startMinutes, dollars }) {
  return { id, sourceAiringHash: '', dateKey: '2026-08-08', startMinutes, title: 'Same Show', importedTitle: 'Same Show', programId: 'p1', programOpenId: 'p1', nola: '', dollars };
}

test('exact scheduled start keeps 8 PM and 9:30 PM results in their own buckets', () => {
  const lookup = hooks.buildAiringRecordLookup([airing({ id: 'a', startMinutes: 1200, dollars: 900 }), airing({ id: 'b', startMinutes: 1290, dollars: 100 })]);
  const matched = hooks.findAiringForSchedulePlacement({ placement: { programId: 'p1', programTitle: 'Same Show' }, dateKey: '2026-08-08', startMinutes: 1290, pid: 'p1', nola: '', title: 'same show', airingLookup: lookup });
  assert.equal(matched?.id, 'b');
  assert.equal(matched?.dollars, 100);
});

test('ambiguous same-day candidates are excluded instead of choosing the highest-dollar result', () => {
  const lookup = hooks.buildAiringRecordLookup([airing({ id: 'a', startMinutes: 1200, dollars: 900 }), airing({ id: 'b', startMinutes: 1290, dollars: 100 })]);
  const matched = hooks.findAiringForSchedulePlacement({ placement: { programId: 'p1', programTitle: 'Same Show' }, dateKey: '2026-08-08', startMinutes: 1260, pid: 'p1', nola: '', title: 'same show', airingLookup: lookup });
  assert.equal(matched, null);
});

test('manual explicit zero remains a completed schedule-derived result', () => {
  const schedules = [{ id: 's1', title: 'August', placements: [{ id: 'x', dateKey: '2026-08-08', startMinutes: 1200, endMinutes: 1260, programId: 'p1', programTitle: 'Manual Zero', manualResultRecorded: true, manualBroadcastDollars: 0, manualPledgeCount: 0 }] }];
  const library = [{ id: 'p1', title: 'Manual Zero', topic_primary: 'Music', topic_secondary: 'Rock' }];
  const rows = hooks.buildScheduleRecords(schedules, library, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dollars, 0);
});

test('duplicate fundraiser date ranges are not merged into a synthetic schedule', () => {
  const unique = { id: 'u', startDate: '2026-03-01', endDate: '2026-03-10', placements: [] };
  const a = { id: 'a', startDate: '2026-08-08', endDate: '2026-08-16', placements: [{ id: '1' }] };
  const b = { id: 'b', startDate: '2026-08-08', endDate: '2026-08-16', placements: [{ id: '2' }] };
  const result = hooks.dedupeSchedulesByDateRange([unique, a, b]);
  assert.deepEqual(Array.from(result, (row) => row.id), ['u']);
  const audit = hooks.getScheduleAudit();
  assert.equal(audit.duplicateSchedulesMerged, 0);
  assert.equal(audit.duplicateSchedulesSuppressed, 2);
  assert.equal(audit.ambiguousDateRanges.length, 1);
});

test('analytics source uses the canonical imported-airing data layer when available', () => {
  const text = fs.readFileSync(sourcePath, 'utf8');
  assert.match(text, /App\.data\?\.fetchImportedAirings/);
});
'''
Path('tests/performance-analytics.test.mjs').write_text(perf_test, encoding='utf-8')

# ---------------- Version ----------------
vpath = Path('version.json')
version = json.loads(vpath.read_text(encoding='utf-8'))
version['appVersion'] = '0.22.92'
version['releasedAt'] = '2026-08-24'
vpath.write_text(json.dumps(version, separators=(',', ':')) + '\n', encoding='utf-8')

print('v0.22.92 patch applied')

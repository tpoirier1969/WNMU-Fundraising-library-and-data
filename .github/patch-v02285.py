from pathlib import Path
import json


def replace_func(src, name, next_name, new_text):
    start = src.index(f"  function {name}")
    end = src.index(f"  function {next_name}", start)
    return src[:start] + new_text.rstrip() + "\n\n" + src[end:]


def replace_once(src, old, new, label):
    count = src.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return src.replace(old, new, 1)


# Fundraiser Comparison Lab
path = Path('assets/js/ui-fundraiser-comparison.js')
src = path.read_text()
src = replace_once(src, "  const SEASONS = ['March', 'June', 'August', 'December'];\n", "  const SEASONS = ['March', 'June', 'August', 'December'];\n  const CERTIFIED_SUBTOPIC_TOPICS = new Set(['music']);\n", 'certified topic constant')
src = replace_once(src, "    baselineId: '',\n    selectedTopic: '',\n", "    compareAId: '',\n    compareBId: '',\n    selectedTopic: '',\n", 'comparison state')

src = replace_func(src, 'renderTopicScheduleMix', 'renderTimeScheduleMix', r'''  function renderTopicScheduleMix(analyses = []) {
    const rows = unionRows(analyses, 'topics')
      .map((row) => ({
        ...row,
        totalMinutes: row.values.reduce((sum, value) => sum + Number(value.minutes || 0), 0),
        totalDollars: row.values.reduce((sum, value) => sum + Number(value.dollars || 0), 0)
      }))
      .filter((row) => row.totalMinutes > 0 || row.totalDollars > 0)
      .sort((a, b) => b.totalDollars - a.totalDollars || b.totalMinutes - a.totalMinutes || a.key.localeCompare(b.key));

    if (!rows.length) return '<section class="fc-panel"><h3>Topic hours vs revenue</h3><div class="fc-chart-empty">No topic schedule/results to graph.</div></section>';

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
        const scheduleShare = totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0;
        const revenueShare = totalDollars > 0 ? (dollars / totalDollars) * 100 : 0;
        return `<div class="fc-topic-metric-chip"><button type="button" class="fc-topic-drill-button" data-topic-drill="${escapeHtml(row.key)}">${escapeHtml(row.key)}</button><span>${escapeHtml(hoursLabel(minutes))} of ${escapeHtml(hoursLabel(totalMinutes))} · ${Math.round(scheduleShare)}% schedule</span><span>${escapeHtml(money(dollars))} · ${Math.round(revenueShare)}% revenue</span></div>`;
      }).join('');
      return `<div class="fc-topic-pair-row"><div class="fc-topic-pair-label"><strong>${escapeHtml(analysis.schedule.title)}</strong><span>${escapeHtml(String(analysis.schedule.year || ''))}</span><em>${escapeHtml(hoursLabel(totalMinutes))} total · ${escapeHtml(money(overallRate))}/fundraising hr</em></div><div class="fc-topic-pair-bars"><div class="fc-share-line"><b>Hours</b><div class="fc-stack-track">${scheduleSegments}</div><span>${escapeHtml(hoursLabel(totalMinutes))}</span></div><div class="fc-share-line"><b>Revenue</b><div class="fc-stack-track">${revenueSegments}</div><span>${escapeHtml(money(totalDollars))}</span></div><div class="fc-topic-metric-grid">${topicMetrics}</div></div></div>`;
    }).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>Topic hours vs revenue</h3><span>Bars compare schedule share with revenue share. Topic rows show absolute hours against total fundraiser length, so a shorter fundraiser cannot masquerade as a programming shift.</span></div></div><div class="fc-topic-pair-chart">${body}</div><div class="fc-legend">${legend}</div></section>`;
  }''')

src = replace_func(src, 'renderDifferenceChart', 'comparisonFindingGrid', r'''  function renderDifferenceChart(base, current, field, title) {
    let rows = differenceRows(base, current, field);
    rows = field === 'times'
      ? rows.sort((a, b) => timeSortValue(a.key) - timeSortValue(b.key))
      : rows.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.key.localeCompare(b.key));

    if (!rows.length) return `<section class="fc-panel"><h3>${escapeHtml(title)}</h3><div class="fc-chart-empty">No attributable Broadcast $ to compare.</div></section>`;

    const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(Number(row.difference || 0))));
    const body = rows.map((row) => {
      const diff = Number(row.difference || 0);
      const width = Math.max(0, Math.min(48, (Math.abs(diff) / maxAbs) * 48));
      const bar = diff > 0
        ? `<span class="fc-delta-bar positive" style="left:50%;width:${width.toFixed(2)}%"></span>`
        : diff < 0
          ? `<span class="fc-delta-bar negative" style="right:50%;width:${width.toFixed(2)}%"></span>`
          : '<span class="fc-delta-zero-dot"></span>';
      const label = field === 'topics' ? `<button type="button" class="fc-delta-label fc-topic-drill-button" data-topic-drill="${escapeHtml(row.key)}">${escapeHtml(row.key)}</button>` : `<div class="fc-delta-label">${escapeHtml(row.key)}</div>`;
      return `<div class="fc-delta-row">${label}<div class="fc-delta-track"><span class="fc-delta-center"></span>${bar}</div><div class="fc-delta-meta"><strong class="${diff > 0 ? 'positive' : diff < 0 ? 'negative' : ''}">${escapeHtml(signedMoney(diff))}</strong><span>${escapeHtml(hoursLabel(row.baseline.minutes))} → ${escapeHtml(hoursLabel(row.current.minutes))}</span><small>${escapeHtml(money(dollarsPerHour(row.baseline.dollars, row.baseline.minutes)))}/hr → ${escapeHtml(money(dollarsPerHour(row.current.dollars, row.current.minutes)))}/hr</small></div></div>`;
    }).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>${escapeHtml(title)}</h3><span>${escapeHtml(current.schedule.title)} minus ${escapeHtml(base.schedule.title)}. Every row also shows A → B hours and $/hour.</span></div></div><div class="fc-delta-chart">${body}</div></section>`;
  }''')

src = replace_func(src, 'comparisonFindingGrid', 'topicDetailRows', r'''  function comparisonFindingGrid(base, current, policy) {
    const difference = comparableTotalForPolicy(current, policy) - comparableTotalForPolicy(base, policy);
    const similarity = comparisonSimilarity(base, current);
    const topic = biggestDifference(base, current, 'topics');
    const time = biggestDifference(base, current, 'times');
    const channels = channelBasisLabel(policy);
    const topicGain = topic.positive ? `${topic.positive.key} ${signedMoney(topic.positive.difference)}` : '—';
    const topicLoss = topic.negative ? `${topic.negative.key} ${signedMoney(topic.negative.difference)}` : '—';
    const timeSwing = [time.positive, time.negative].filter(Boolean).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))[0];
    const hourChange = percentChange(current.scheduledMinutes, base.scheduledMinutes);
    const broadcastChange = percentChange(current.broadcastDollars, base.broadcastDollars);
    const baseRate = dollarsPerHour(base.broadcastDollars, base.scheduledMinutes);
    const currentRate = dollarsPerHour(current.broadcastDollars, current.scheduledMinutes);
    const rateChange = percentChange(currentRate, baseRate);

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>${escapeHtml(current.schedule.title)} vs ${escapeHtml(base.schedule.title)}</h3><span>A → B diagnostic comparison</span></div></div><div class="fc-finding-grid"><div class="fc-finding"><span>Comparable income</span><strong>${escapeHtml(signedMoney(difference))}</strong><small>${escapeHtml(channels)}</small></div><div class="fc-finding"><span>Fundraising hours</span><strong>${escapeHtml(signedPercent(hourChange))}</strong><small>${escapeHtml(hoursLabel(base.scheduledMinutes))} → ${escapeHtml(hoursLabel(current.scheduledMinutes))}</small></div><div class="fc-finding"><span>Broadcast $</span><strong>${escapeHtml(signedPercent(broadcastChange))}</strong><small>${escapeHtml(money(base.broadcastDollars))} → ${escapeHtml(money(current.broadcastDollars))}</small></div><div class="fc-finding"><span>Broadcast $/hour</span><strong>${escapeHtml(signedPercent(rateChange))}</strong><small>${escapeHtml(money(baseRate))} → ${escapeHtml(money(currentRate))}</small></div><div class="fc-finding"><span>Schedule similarity</span><strong>${Number.isFinite(similarity) ? `${Math.round(similarity * 100)}%` : '—'}</strong><small>topic + start-time allocation</small></div><div class="fc-finding"><span>Biggest topic gain</span><strong>${escapeHtml(topicGain)}</strong></div><div class="fc-finding"><span>Biggest topic loss</span><strong>${escapeHtml(topicLoss)}</strong></div><div class="fc-finding"><span>Largest time-slot swing</span><strong>${timeSwing ? `${escapeHtml(timeSwing.key)} ${escapeHtml(signedMoney(timeSwing.difference))}` : '—'}</strong></div></div></section>`;
  }''')

src = replace_func(src, 'renderTopicDiagnostics', 'renderTopicDrilldown', r'''  function renderTopicDiagnostics(base, current) {
    const rows = differenceRows(base, current, 'topics')
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.key.localeCompare(b.key))
      .slice(0, 8);
    if (!rows.length) return '';

    const body = rows.map((row) => {
      const baseRows = topicDetailRows(base, row.key);
      const currentRows = topicDetailRows(current, row.key);
      const useSecondary = CERTIFIED_SUBTOPIC_TOPICS.has(lookupKey(row.key));
      const dayparts = pairedBreakdown(baseRows, currentRows, (item) => item.daypart, 5);
      const mix = pairedBreakdown(baseRows, currentRows, useSecondary ? (item) => item.secondary : (item) => item.title, 7);
      const baseShare = base.scheduledMinutes > 0 ? (Number(row.baseline.minutes || 0) / base.scheduledMinutes) * 100 : 0;
      const currentShare = current.scheduledMinutes > 0 ? (Number(row.current.minutes || 0) / current.scheduledMinutes) * 100 : 0;
      const shareDelta = currentShare - baseShare;
      const driveChange = percentChange(current.scheduledMinutes, base.scheduledMinutes);
      const topicChange = percentChange(row.current.minutes, row.baseline.minutes);
      let read = 'Fundraiser length and topic allocation both need inspection.';
      if (Math.abs(shareDelta) < 1.5) read = 'Topic share stayed about the same; fundraiser length explains much of the hours difference.';
      else if (shareDelta >= 1.5) read = 'This topic took a larger share of the fundraiser, so the schedule mix shifted toward it.';
      else if (shareDelta <= -1.5) read = 'This topic took a smaller share of the fundraiser, so the schedule mix shifted away from it.';
      return `<article class="fc-topic-diagnostic"><header><button type="button" class="fc-topic-drill-button" data-topic-drill="${escapeHtml(row.key)}">${escapeHtml(row.key)}</button><span class="${row.difference > 0 ? 'positive' : row.difference < 0 ? 'negative' : ''}">${escapeHtml(signedMoney(row.difference))}</span></header><div class="fc-topic-why"><strong>${escapeHtml(read)}</strong><div class="fc-topic-context"><span>Fundraiser ${escapeHtml(hoursLabel(base.scheduledMinutes))} → ${escapeHtml(hoursLabel(current.scheduledMinutes))}${Number.isFinite(driveChange) ? ` · ${escapeHtml(signedPercent(driveChange))}` : ''}</span><span>Topic ${escapeHtml(hoursLabel(row.baseline.minutes))} → ${escapeHtml(hoursLabel(row.current.minutes))}${Number.isFinite(topicChange) ? ` · ${escapeHtml(signedPercent(topicChange))}` : ''}</span><span>Schedule share ${Math.round(baseShare)}% → ${Math.round(currentShare)}% · ${shareDelta > 0 ? '+' : ''}${shareDelta.toFixed(1)} pts</span></div></div><div class="fc-topic-core"><div><span>A</span><b>${escapeHtml(hoursLabel(row.baseline.minutes))} · ${escapeHtml(money(row.baseline.dollars))}</b><small>${escapeHtml(money(dollarsPerHour(row.baseline.dollars, row.baseline.minutes)))}/hr</small></div><i>→</i><div><span>B</span><b>${escapeHtml(hoursLabel(row.current.minutes))} · ${escapeHtml(money(row.current.dollars))}</b><small>${escapeHtml(money(dollarsPerHour(row.current.dollars, row.current.minutes)))}/hr</small></div></div><div class="fc-topic-detail"><b>Daypart mix</b><div>${dayparts || '<span class="muted-cell">No daypart detail</span>'}</div></div><div class="fc-topic-detail"><b>${useSecondary ? 'Subtopic mix' : 'Program mix'}</b><div>${mix || '<span class="muted-cell">No useful mix detail</span>'}</div></div></article>`;
    }).join('');

    return `<section class="fc-panel"><div class="fc-panel-head"><div><h3>Why did this topic change?</h3><span>Fundraiser length is separated from true schedule-share changes. Music uses its normalized subtopics; other topics use program mix unless they are certified for subtopic analysis later.</span></div></div><div class="fc-topic-diagnostics">${body}</div></section>`;
  }''')

src = replace_func(src, 'renderTopicDrilldown', 'calendarDays', r'''  function renderTopicDrilldown(analyses = [], topic = '') {
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
      return { key, programs, values: maps.map((map) => map.get(key) || { minutes: 0, dollars: 0, scheduled: 0 }) };
    }).sort((a, b) => b.values.reduce((sum, value) => sum + Number(value.dollars || 0), 0) - a.values.reduce((sum, value) => sum + Number(value.dollars || 0), 0));
    const maxDollars = Math.max(1, ...rows.flatMap((row) => row.values.map((value) => Number(value.dollars || 0))));
    const head = analyses.map((analysis) => `<th>${escapeHtml(analysis.schedule.title)}<span>${escapeHtml(String(analysis.schedule.year || ''))}</span></th>`).join('');
    const body = rows.map((row) => `<tr><th><strong>${escapeHtml(row.key)}</strong>${row.programs.length ? `<small class="fc-topic-drill-programs">${row.programs.map(escapeHtml).join(' · ')}</small>` : ''}</th>${row.values.map((value) => {
      const dollars = Number(value.dollars || 0);
      const minutes = Number(value.minutes || 0);
      const intensity = Math.max(0, Math.min(1, dollars / maxDollars));
      const alpha = dollars > 0 ? (0.10 + intensity * 0.58).toFixed(2) : '0.02';
      return `<td style="background:rgba(29,95,150,${alpha})"><strong>${escapeHtml(hoursLabel(minutes))}</strong><span>${escapeHtml(money(dollars))}</span><small>${escapeHtml(money(dollarsPerHour(dollars, minutes)))}/hr</small></td>`;
    }).join('')}</tr>`).join('');
    const mode = useSecondary ? 'Certified subtopic breakdown' : 'Program-title breakdown';
    const note = useSecondary
      ? 'This topic is certified for subtopic analysis. Program titles are listed beneath each subtopic.'
      : 'This topic defaults to program titles. Subtopics will only be used here after that topic is specifically certified as analytically meaningful.';
    return `<section class="fc-panel fc-topic-drill"><div class="fc-panel-head"><div><h3>${escapeHtml(wanted)} drill-down</h3><span>${escapeHtml(mode)} · ${escapeHtml(note)}</span></div><button type="button" class="ghost fc-topic-drill-close" id="fc-topic-drill-close">Close</button></div>${rows.length ? `<div class="fc-table-wrap"><table class="fc-topic-drill-table"><thead><tr><th>${escapeHtml(useSecondary ? 'Subtopic' : 'Program')}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>` : '<div class="fc-chart-empty">No scheduled programs in this topic for the selected fundraisers.</div>'}</section>`;
  }''')

src = replace_func(src, 'renderCalendarComparison', 'selectedAnalyses', r'''  function renderCalendarComparison(base, current) {
    const pairs = pairCalendarDays(base, current);
    const rows = pairs.map((pair) => `<div class="fc-calendar-pair">${renderCalendarDay(pair.base)}${renderCalendarDay(pair.current)}</div>`).join('');
    return `<section class="fc-panel fc-calendar-panel"><div class="fc-panel-head"><div><h3>Calendar comparison</h3><span>Days are paired by weekday occurrence. Daily dollars are attributable Broadcast $ from scheduled program results. Weather is a five-location U.P. composite.</span></div></div><div class="fc-calendar-head"><div><strong>A · ${escapeHtml(base.schedule.title)}</strong><span>${escapeHtml(String(base.schedule.year || ''))}</span></div><div><strong>B · ${escapeHtml(current.schedule.title)}</strong><span>${escapeHtml(String(current.schedule.year || ''))}</span></div></div>${rows || '<div class="fc-chart-empty">No scheduled days to compare.</div>'}<div class="fc-weather-source">Historical weather context: Open-Meteo, using Ironwood, Houghton, Marquette, Escanaba, and Sault Ste. Marie. Weather is context only, not treated as causal.</div></section>`;
  }''')

src = replace_func(src, 'renderPicker', 'renderComparison', r'''  function renderPicker() {
    const host = root();
    if (!host) return;

    const list = filteredSchedules();
    const selectedCount = state.selectedIds.size;
    if (state.compareAId && !state.selectedIds.has(state.compareAId)) state.compareAId = '';
    if (state.compareBId && !state.selectedIds.has(state.compareBId)) state.compareBId = '';

    const analyses = selectedAnalyses();
    const policy = analyses.length >= 2 ? comparisonChannelPolicy(analyses) : null;
    const rows = list.map((schedule) => {
      const analysis = analysisForSchedule(schedule);
      const displayTotal = policy ? comparableTotalForPolicy(analysis, policy) : analysis.recordedTotal;
      const extras = policy ? excludedChannelLines(analysis, policy) : [];
      return `<label class="fc-drive-option"><input type="checkbox" value="${escapeHtml(schedule.id)}" ${state.selectedIds.has(schedule.id) ? 'checked' : ''}><span class="fc-drive-copy"><strong>${escapeHtml(schedule.title)}</strong><small>${escapeHtml(formatDateRange(schedule))}</small><span class="fc-drive-stats"><b>${policy ? 'Comparable' : 'Recorded'} $ ${escapeHtml(money(displayTotal))}</b><b>Total hours ${escapeHtml(hoursLabel(analysis.scheduledMinutes))}</b></span>${extras.length ? `<span class="fc-drive-extras">${extras.map((line) => `<small>${escapeHtml(line)}</small>`).join('')}</span>` : ''}</span></label>`;
    }).join('');

    const comparison = analyses.length < 2
      ? '<div class="fc-empty"><strong>Select at least two fundraisers.</strong><span>The peer charts will appear without forcing any fundraiser to be the baseline.</span></div>'
      : renderComparison(analyses);

    host.innerHTML = `<style>${styles()}</style><section class="fc-shell"><header class="fc-head"><div><div class="fc-kicker">Fundraiser analysis workspace</div><h2>Fundraiser Comparison Lab</h2><div class="fc-subtitle">Peer comparison first. Use A/B diagnostics only when you want to investigate a specific difference.</div></div><span class="fc-beta">BETA</span></header><section class="fc-controls"><label><span>Pledge season</span><select id="fc-season"><option value="all">All pledge seasons</option>${SEASONS.map((season) => `<option value="${season}" ${state.season === season ? 'selected' : ''}>${season}</option>`).join('')}</select></label><div class="fc-selection-note">${number(selectedCount)} fundraiser${selectedCount === 1 ? '' : 's'} selected</div><button type="button" id="fc-clear">Clear selection</button><button type="button" id="fc-reload">Reload data</button></section><div class="fc-layout"><aside class="fc-picker"><h3>Choose fundraisers</h3><div class="fc-drive-list">${rows || '<div class="fc-chart-empty">No saved fundraisers match this season.</div>'}</div></aside><main class="fc-results">${comparison}</main></div></section>`;

    host.querySelector('#fc-season')?.addEventListener('change', (event) => {
      state.season = event.target.value || 'all';
      state.selectedIds.clear();
      state.compareAId = '';
      state.compareBId = '';
      state.selectedTopic = '';
      renderPicker();
    });
    host.querySelector('#fc-clear')?.addEventListener('click', () => {
      state.selectedIds.clear();
      state.compareAId = '';
      state.compareBId = '';
      state.selectedTopic = '';
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
        if (state.compareAId === input.value) state.compareAId = '';
        if (state.compareBId === input.value) state.compareBId = '';
      }
      renderPicker();
    }));
    host.querySelector('#fc-compare-a')?.addEventListener('change', (event) => {
      state.compareAId = event.target.value || '';
      renderPicker();
    });
    host.querySelector('#fc-compare-b')?.addEventListener('change', (event) => {
      state.compareBId = event.target.value || '';
      renderPicker();
    });
    host.querySelectorAll('[data-topic-drill]').forEach((button) => button.addEventListener('click', () => {
      state.selectedTopic = button.dataset.topicDrill || '';
      renderPicker();
      document.querySelector('.fc-topic-drill')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }));
    host.querySelector('#fc-topic-drill-close')?.addEventListener('click', () => {
      state.selectedTopic = '';
      renderPicker();
    });

    const compareA = state.compareAId ? analyses.find((analysis) => analysis.schedule.id === state.compareAId) : null;
    const compareB = state.compareBId ? analyses.find((analysis) => analysis.schedule.id === state.compareBId) : null;
    if (compareA && compareB && compareA.schedule.id !== compareB.schedule.id) void ensureWeatherForAnalyses([compareA, compareB]);
  }''')

src = replace_func(src, 'renderComparison', 'styles', r'''  function renderComparison(analyses) {
    const policy = comparisonChannelPolicy(analyses);
    const comparableTotals = analyses.map((analysis) => comparableTotalForPolicy(analysis, policy)).sort((a, b) => a - b);
    const medianTotal = comparableTotals.length % 2
      ? comparableTotals[Math.floor(comparableTotals.length / 2)]
      : (comparableTotals[(comparableTotals.length / 2) - 1] + comparableTotals[comparableTotals.length / 2]) / 2;
    const cards = analyses.map((analysis) => {
      const comparableTotal = comparableTotalForPolicy(analysis, policy);
      const onlineLine = policy.includeOnline ? `Online ${money(analysis.onlineDollars)}` : (analysis.onlineTracked ? `Additional Online monies ${money(analysis.onlineDollars)} · not included` : 'Online not tracked');
      const mailLine = policy.includeMail ? `Mail ${money(analysis.mailDollars)}` : (analysis.mailTracked ? `Additional Mail monies ${money(analysis.mailDollars)} · not included` : 'Mail not tracked');
      const medianDelta = comparableTotal - medianTotal;
      return `<article class="fc-summary-card"><div class="fc-card-kicker">Selected fundraiser</div><h3>${escapeHtml(analysis.schedule.title)}</h3><div class="fc-total">${money(comparableTotal)}</div><div class="fc-total-label">Comparable total $</div><div class="fc-summary-metrics"><span><b>${escapeHtml(hoursLabel(analysis.scheduledMinutes))}</b> fundraising</span><span><b>${escapeHtml(money(analysis.broadcastDollars))}</b> Broadcast $</span><span><b>${escapeHtml(money(dollarsPerHour(analysis.broadcastDollars, analysis.scheduledMinutes)))}</b> Broadcast $/hr</span></div><div class="fc-mini"><span>Selected median ${escapeHtml(money(medianTotal))} · ${escapeHtml(signedMoney(medianDelta))}</span><span>${escapeHtml(onlineLine)}</span><span>${escapeHtml(mailLine)}</span></div></article>`;
    }).join('');

    const options = analyses.map((analysis) => `<option value="${escapeHtml(analysis.schedule.id)}">${escapeHtml(analysis.schedule.title)} · ${escapeHtml(String(analysis.schedule.year || ''))}</option>`).join('');
    const optionA = options.replace(`value="${escapeHtml(state.compareAId)}"`, `value="${escapeHtml(state.compareAId)}" selected`);
    const optionB = options.replace(`value="${escapeHtml(state.compareBId)}"`, `value="${escapeHtml(state.compareBId)}" selected`);
    const compareA = state.compareAId ? analyses.find((analysis) => analysis.schedule.id === state.compareAId) || null : null;
    const compareB = state.compareBId ? analyses.find((analysis) => analysis.schedule.id === state.compareBId) || null : null;
    const pairReady = Boolean(compareA && compareB && compareA.schedule.id !== compareB.schedule.id);
    const pairPrompt = compareA && compareB && compareA.schedule.id === compareB.schedule.id
      ? '<div class="fc-empty"><strong>Choose two different fundraisers.</strong><span>A and B are deliberately explicit so the comparison has a clear meaning.</span></div>'
      : '<div class="fc-empty"><strong>Optional deeper comparison.</strong><span>Choose Fundraiser A and Fundraiser B only when you want to investigate a particular difference. The peer charts above do not use a baseline.</span></div>';
    const pairContent = pairReady
      ? `${comparisonFindingGrid(compareA, compareB, policy)}<section class="fc-section-label"><strong>Why did things change?</strong><span>Fundraiser length, topic share, daypart, and topic/program mix are separated where possible.</span></section>${renderTopicDiagnostics(compareA, compareB)}<section class="fc-section-label"><strong>Calendar comparison</strong><span>Weekday, weather, daily Broadcast $, topics, dayparts, and individual program results together.</span></section>${renderCalendarComparison(compareA, compareB)}<section class="fc-section-label"><strong>Revenue difference A → B</strong><span>Rows include revenue delta plus A → B hours and $/hour.</span></section><section class="fc-difference-pair"><div class="fc-difference-title"><strong>${escapeHtml(compareA.schedule.title)} → ${escapeHtml(compareB.schedule.title)}</strong><span>explicit A/B diagnostic</span></div><div class="fc-difference-grid">${renderDifferenceChart(compareA, compareB, 'topics', 'Topic income difference')}${renderDifferenceChart(compareA, compareB, 'times', 'Time-slot income difference')}</div></section>`
      : pairPrompt;

    return `<div class="fc-comparable-note"><strong>Comparison basis: ${escapeHtml(channelBasisLabel(policy))}</strong><span>${escapeHtml(comparisonChannelNote(analyses, policy))} Selected median is a neutral reference only; no fundraiser is treated as the permanent baseline.</span></div><div class="fc-summary-grid">${cards}</div>${renderTopicScheduleMix(analyses)}${renderTimeScheduleMix(analyses)}${renderTopicHeatmap(analyses)}${renderTopicDrilldown(analyses, state.selectedTopic)}<section class="fc-panel fc-ab-controls"><div class="fc-panel-head"><div><h3>Optional A/B diagnostic comparison</h3><span>Peer comparison is the default. Pick two drives here only when you want a directional A → B explanation.</span></div></div><div class="fc-ab-control-grid"><label><span>Fundraiser A</span><select id="fc-compare-a"><option value="">Choose A…</option>${optionA}</select></label><label><span>Fundraiser B</span><select id="fc-compare-b"><option value="">Choose B…</option>${optionB}</select></label></div></section>${pairContent}<div class="fc-note-grid"><div class="fc-note-card"><strong>Channel rule</strong><span>${escapeHtml(comparisonChannelNote(analyses, policy))}</span></div><div class="fc-note-card"><strong>Weather rule</strong><span>Weather is regional context only. The lab does not claim weather caused a fundraising result.</span></div></div>`;
  }''')

css_anchor = ".fc-drive-extras small{font-size:.69rem;color:#7a6740}.fc-topic-drill-button"
css_insert = ".fc-drive-extras small{font-size:.69rem;color:#7a6740}.fc-topic-pair-label em{font-style:normal;font-size:.7rem;font-weight:800;color:#31566e}.fc-topic-metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:5px;margin-top:4px}.fc-topic-metric-chip{display:grid;gap:1px;border:1px solid #e1eaee;border-radius:8px;background:#fbfdfe;padding:5px 6px}.fc-topic-metric-chip span{font-size:.66rem;color:#607685}.fc-topic-why{display:grid;gap:5px;background:#eef7fb;border-radius:9px;padding:7px}.fc-topic-why>strong{font-size:.76rem;color:#103a66}.fc-topic-context{display:flex;gap:5px;flex-wrap:wrap}.fc-topic-context span{font-size:.67rem;color:#536d7d;background:#fff;border:1px solid #dbe7eb;border-radius:999px;padding:2px 6px}.fc-ab-controls{background:#f6fafc}.fc-ab-control-grid{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:9px}.fc-ab-control-grid label{display:grid;gap:4px}.fc-ab-control-grid label>span{font-size:.7rem;text-transform:uppercase;font-weight:900;color:#5f7383}.fc-ab-control-grid select{border:1px solid #d6e4ea;border-radius:10px;padding:8px 10px;background:#fff;color:#103a66;font:inherit}.fc-topic-drill-programs{display:block;margin-top:3px;font-weight:500!important;white-space:normal;color:#6d8291!important}.fc-topic-drill-button"
src = replace_once(src, css_anchor, css_insert, 'comparison css insertion')
src = src.replace("@media(max-width:900px){.fc-layout", "@media(max-width:900px){.fc-ab-control-grid{grid-template-columns:1fr}.fc-layout", 1)
path.write_text(src)


# Scheduling UI: daily and fundraiser fundraising hours.
path = Path('assets/js/ui-scheduling.js')
src = path.read_text()
marker = "  function scheduleStartBucketMoneyMap(schedule = {}, importedRows = []) {"
if marker not in src:
    raise SystemExit('scheduling insertion marker missing')
helpers = r'''  function scheduleFundraisingMinutesByDate(schedule = {}) {
    const result = new Map(scheduleFundraiserDayKeys(schedule).map((dateKey) => [dateKey, 0]));
    (schedule?.placements || []).forEach((placement) => {
      if (!placement || placement.isNonPledge) return;
      const dateKey = utils.normalizeText(placement.dateKey || '');
      if (!dateKey) return;
      const minutes = Number(placement.lengthMinutes || scheduledPlacementRuntimeMinutes(placement) || 0);
      if (!(minutes > 0)) return;
      result.set(dateKey, (result.get(dateKey) || 0) + minutes);
    });
    return result;
  }

  function scheduleTotalFundraisingMinutes(schedule = {}) {
    return [...scheduleFundraisingMinutesByDate(schedule).values()].reduce((sum, minutes) => sum + Number(minutes || 0), 0);
  }

  function scheduleFundraisingHoursLabel(minutes = 0) {
    const hours = Number(minutes || 0) / 60;
    if (!(hours > 0)) return '0 hr';
    const value = Math.abs(hours - Math.round(hours)) < 0.01 ? Math.round(hours) : Math.round(hours * 10) / 10;
    return `${value} hr`;
  }

'''
src = src.replace(marker, helpers + marker, 1)
src = replace_once(src, "    const dailyMoney = scheduleDailyMoneyMap(schedule, importedRows);\n    const startBucketMoney = scheduleStartBucketMoneyMap(schedule, importedRows);\n", "    const dailyMoney = scheduleDailyMoneyMap(schedule, importedRows);\n    const dailyFundraisingMinutes = scheduleFundraisingMinutesByDate(schedule);\n    const totalFundraisingMinutes = scheduleTotalFundraisingMinutes(schedule);\n    const startBucketMoney = scheduleStartBucketMoneyMap(schedule, importedRows);\n", 'schedule daily hour maps')
src = replace_once(src, "    els.scheduleWindowLabel.textContent = `${utils.minutesToLabel(visibleStartMin)} – ${utils.minutesToLabel(visibleEndMin - constants.DEFAULT_SLOT_MINUTES)}`;\n", "    els.scheduleWindowLabel.textContent = `${utils.minutesToLabel(visibleStartMin)} – ${utils.minutesToLabel(visibleEndMin - constants.DEFAULT_SLOT_MINUTES)} · ${scheduleFundraisingHoursLabel(totalFundraisingMinutes)} fundraising scheduled`;\n", 'schedule top total hours')
old_header = "      const moneyTitle = money.hasImportedResults\n        ? `Imported broadcast ${utils.formatMoney(money.broadcast)} + prorated Online/Mail ${utils.formatMoney(money.onlineMail)}`\n        : 'No imported results for this date yet';\n      header.push(`<div class=\"schedule-day-head sticky ${weekendClass}\"><span class=\"schedule-day-date\">${label}</span><span class=\"schedule-day-total ${money.hasImportedResults ? 'reported' : 'unreported'}\" title=\"${utils.escapeHtml(moneyTitle)}\">${utils.escapeHtml(utils.formatMoney(money.total))}</span></div>`);\n"
new_header = "      const moneyTitle = money.hasImportedResults\n        ? `Imported broadcast ${utils.formatMoney(money.broadcast)} + prorated Online/Mail ${utils.formatMoney(money.onlineMail)}`\n        : 'No imported results for this date yet';\n      const fundraisingHours = scheduleFundraisingHoursLabel(dailyFundraisingMinutes.get(dateKey) || 0);\n      header.push(`<div class=\"schedule-day-head sticky ${weekendClass}\"><span class=\"schedule-day-date\">${label}</span><span class=\"schedule-day-total ${money.hasImportedResults ? 'reported' : 'unreported'}\" title=\"${utils.escapeHtml(moneyTitle)}\">${utils.escapeHtml(utils.formatMoney(money.total))}</span><span class=\"schedule-day-hours\" style=\"font-size:.68rem;color:#5f7383;font-weight:800;\">${utils.escapeHtml(fundraisingHours)} fundraising</span></div>`);\n"
src = replace_once(src, old_header, new_header, 'schedule daily hours header')
path.write_text(src)


# Program Library historical performance fingerprint.
path = Path('assets/js/ui-detail.js')
src = path.read_text()
marker = "  function renderOverview(program, driveResults = [], exactAirings = []) {"
if marker not in src:
    raise SystemExit('detail fingerprint marker missing')
helper = r'''  function historicalPerformanceFingerprint(program = {}, driveResults = [], exactAirings = []) {
    const resolvedAirings = resolvedExactAiringRows(exactAirings, driveResults);
    const airingCount = resolvedAirings.length;
    const exactTotal = resolvedAirings.reduce((sum, row) => sum + (Number(row.__resolved_contribution_amount || 0) || 0), 0);
    const driveTotal = (driveResults || []).reduce((sum, row) => sum + contributionAmount(row), 0);
    const storedTotal = Number(derive.totalRaised(program) || 0) || 0;
    const total = storedTotal > 0 ? storedTotal : (driveTotal > 0 ? driveTotal : exactTotal);
    const fundraiserKeys = new Set([...(driveResults || []), ...(exactAirings || [])].map((row) => historyGroupKey(row)).filter(Boolean));
    const fundraiserCount = fundraiserKeys.size;
    const storedAvg = Number(derive.avgPerFundraiser(program) || 0) || 0;
    const avgFundraiser = storedAvg > 0 ? storedAvg : (fundraiserCount > 0 ? total / fundraiserCount : 0);
    const avgAiring = airingCount > 0 ? exactTotal / airingCount : 0;
    const bits = [];
    if (fundraiserCount) bits.push(`${utils.formatCount(fundraiserCount)} pledge period${fundraiserCount === 1 ? '' : 's'}`);
    if (airingCount) bits.push(`${utils.formatCount(airingCount)} exact airing${airingCount === 1 ? '' : 's'}`);
    if (total > 0) bits.push(`${utils.formatMoney(total)} total`);
    if (avgAiring > 0) bits.push(`${utils.formatMoney(avgAiring)}/airing`);
    if (avgFundraiser > 0) bits.push(`${utils.formatMoney(avgFundraiser)}/fundraiser`);
    return bits.length ? bits.join(' · ') : 'No completed pledge history yet.';
  }

'''
src = src.replace(marker, helper + marker, 1)
src = replace_once(src, "      labelValue('Last aired', utils.escapeHtml(lastAired || 'N/A')),\n      labelValue('Status', utils.escapeHtml(derive.isActive(program) ? 'Active' : 'Archived by rights-end date')),\n", "      labelValue('Last aired', utils.escapeHtml(lastAired || 'N/A')),\n      labelValue('Historical fingerprint', utils.escapeHtml(historicalPerformanceFingerprint(program, driveResults, exactAirings)), 'overview-wide overview-spotlight'),\n      labelValue('Status', utils.escapeHtml(derive.isActive(program) ? 'Active' : 'Archived by rights-end date')),\n", 'detail fingerprint row')
path.write_text(src)

Path('version.json').write_text(json.dumps({'appVersion': '0.22.85', 'releasedAt': '2026-08-21'}, separators=(',', ':')) + '\n')

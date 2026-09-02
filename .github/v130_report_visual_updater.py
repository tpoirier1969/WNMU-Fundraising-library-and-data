from pathlib import Path
import json

ROOT = Path('.')
REPORTS_JS = ROOT / 'assets/js/one-sheet-reports.js'
REPORTS_HTML = ROOT / 'reports.html'
VERSION = ROOT / 'version.json'
TEST = ROOT / 'tests/report-visual-historical-context-v130.test.mjs'


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


js = REPORTS_JS.read_text()

# Make the shared line chart reusable for rates and per-pledge trends while preserving
# the existing Broadcast-dollar defaults used by comparison reports.
js = replace_once(
    js,
    "function lineChartSvg({ labels = [], series = [], ariaLabel = 'Fundraiser comparison line graph', className = '', legendTop = false } = {}) {",
    "function lineChartSvg({ labels = [], series = [], ariaLabel = 'Fundraiser comparison line graph', className = '', legendTop = false, yLabel = 'Broadcast dollars', axisFormatter = compactMoney, pointFormatter = money } = {}) {",
    'line chart signature'
)
js = replace_once(js, '${escapeHtml(compactMoney(value))}</text></g>`;', '${escapeHtml(axisFormatter(value))}</text></g>`;', 'line chart axis formatter')
js = replace_once(js, 'const title = `${item.label} · ${labels[index]}: ${money(value)}`;', 'const title = `${item.label} · ${labels[index]}: ${pointFormatter(value)}`;', 'line chart point formatter')
js = replace_once(js, 'class="chart-axis-title">Broadcast dollars</text></svg>`;', 'class="chart-axis-title">${escapeHtml(yLabel)}</text></svg>`;', 'line chart y label')

bar_chart = r'''

  function barChartSvg({ labels = [], series = [], ariaLabel = 'Fundraiser bar graph', className = '', yLabel = 'Broadcast $ / pledge hour', axisFormatter = compactMoney, pointFormatter = money } = {}) {
    if (!labels.length || !series.length) return '<div class="chart-empty">No chartable results.</div>';
    const width = 760;
    const height = 310;
    const margin = { left: 72, right: 18, top: 28, bottom: labels.length > 6 ? 92 : 66 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const cleanSeries = series.map((item) => ({ ...item, values: (item.values || []).map((value) => Number.isFinite(Number(value)) ? Number(value) : 0) }));
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
'''
js = replace_once(js, '\n  function chartTooltipElement() {', bar_chart + '\n  function chartTooltipElement() {', 'bar chart insertion')

# Add the visual-overview and historical-context model immediately before the historical body.
visual_block = r'''

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

  function analysisTrendLabel(analysis) {
    const season = A.text(analysis?.schedule?.season || 'Special');
    const year = Number(analysis?.schedule?.year || 0) || A.parseDate(analysis?.schedule?.startDate)?.getFullYear() || '';
    return `${season} ${year}`.trim();
  }

  function lifecycleForAnalysis(analysis) {
    const labels = ['Opening 20%', 'Early 20%', 'Middle 20%', 'Late 20%', 'Closing 20%'];
    const buckets = labels.map((label) => ({ label, dollars: 0, pledges: 0, minutes: 0, days: 0 }));
    const days = A.calendarDays(analysis).filter((day) => Number(day.minutes || 0) > 0 || Number(day.rateMinutes || 0) > 0 || Number(day.dollars || 0) > 0 || Number(day.pledges || 0) > 0);
    days.forEach((day, index) => {
      const bucketIndex = Math.min(4, Math.floor((index * 5) / Math.max(1, days.length)));
      const bucket = buckets[bucketIndex];
      bucket.dollars += Number(day.dollars || 0);
      bucket.pledges += Number(day.pledges || 0);
      bucket.minutes += Number(day.rateMinutes || day.minutes || 0);
      bucket.days += 1;
    });
    return buckets.map((bucket) => ({
      ...bucket,
      dollarsPerHour: bucket.minutes > 0 ? A.dollarsPerHour(bucket.dollars, bucket.minutes) : null,
      pledgesPerHour: bucket.minutes > 0 ? A.pledgesPerHour(bucket.pledges, bucket.minutes) : null
    }));
  }

  function historicalLifecycleMedians(analyses = []) {
    const byFundraiser = analyses.map(lifecycleForAnalysis);
    const labels = ['Opening 20%', 'Early 20%', 'Middle 20%', 'Late 20%', 'Closing 20%'];
    return labels.map((label, index) => ({
      label,
      dollarsPerHour: medianNumber(byFundraiser.map((rows) => rows[index]?.dollarsPerHour).filter((value) => Number.isFinite(Number(value)))),
      pledgesPerHour: medianNumber(byFundraiser.map((rows) => rows[index]?.pledgesPerHour).filter((value) => Number.isFinite(Number(value)))),
      fundraisers: byFundraiser.filter((rows) => Number.isFinite(Number(rows[index]?.dollarsPerHour))).length
    }));
  }

  function chartCard(title, description, chart) {
    return `<section class="visual-card"><div class="section-heading"><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div></div>${chart}</section>`;
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
      values: ordered.map((analysis) => Number(metric(analysis) || 0))
    };
  }

  function historicalSeasonTrendData(analyses = []) {
    const ordered = chronologicalAnalyses(analyses);
    const years = [...new Set(ordered.map((analysis) => Number(analysis.schedule?.year || 0)).filter(Boolean))].sort((a, b) => a - b);
    const seasons = ['March', 'June', 'August', 'December'].filter((season) => ordered.some((analysis) => analysis.schedule?.season === season));
    return {
      labels: years.map(String),
      series: seasons.map((season) => ({
        label: season,
        values: years.map((year) => {
          const values = ordered.filter((analysis) => Number(analysis.schedule?.year || 0) === year && analysis.schedule?.season === season).map(rateForAnalysis).filter((value) => Number.isFinite(Number(value)));
          return values.length ? medianNumber(values) : null;
        })
      }))
    };
  }

  function historicalCorrespondingDayData(analyses = []) {
    const aligned = A.alignedDailyRows(analyses);
    return {
      labels: aligned.map((entry) => entry.label.title),
      values: aligned.map((entry) => {
        const values = (entry.days || []).filter(Boolean).map((day) => Number(day.dollarsPerHour || 0)).filter((value) => Number.isFinite(value));
        return values.length ? medianNumber(values) : null;
      })
    };
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
    const lifecycle = historicalLifecycleMedians(analyses);
    const seasonal = historicalSeasonTrendData(analyses);
    const corresponding = historicalCorrespondingDayData(analyses);
    const overview = [
      chartCard('Fundraiser productivity over time', 'One observation per fundraiser. This exposes long-term movement that lifetime medians can hide.', lineChartSvg({
        labels: productivity.labels,
        series: [{ label: 'Broadcast $ / pledge hour', values: productivity.values }],
        ariaLabel: 'Historical fundraiser productivity over time',
        className: 'historical-productivity-trend',
        ...rateChartOptions()
      })),
      chartCard('Average gift over time', 'Broadcast dollars per pledge by fundraiser, separating changes in gift size from changes in donor frequency.', lineChartSvg({
        labels: gifts.labels,
        series: [{ label: '$ / pledge', values: gifts.values }],
        ariaLabel: 'Historical dollars per pledge over time',
        className: 'historical-gift-trend',
        yLabel: 'Broadcast $ / pledge',
        axisFormatter: (value) => money(value),
        pointFormatter: (value) => money(value)
      })),
      chartCard('Fundraiser lifecycle', 'Each fundraiser is normalized into five equal day-sequence bands, then the fundraiser-level rates are combined by median so longer drives cannot dominate the result.', lineChartSvg({
        labels: lifecycle.map((row) => row.label),
        series: [{ label: 'Historical median', values: lifecycle.map((row) => row.dollarsPerHour) }],
        ariaLabel: 'Historical fundraiser lifecycle performance',
        className: 'historical-lifecycle',
        ...rateChartOptions()
      })),
      chartCard('Season performance over time', 'March, June, August, and December are shown across years rather than collapsed into one lifetime season ranking.', lineChartSvg({
        labels: seasonal.labels,
        series: seasonal.series,
        ariaLabel: 'Historical fundraiser season performance over time',
        className: 'historical-season-trend',
        legendTop: true,
        ...rateChartOptions()
      })),
      chartCard('Corresponding fundraiser days', 'Median $/pledge-hour for matching fundraiser-day positions around the first Saturday.', lineChartSvg({
        labels: corresponding.labels,
        series: [{ label: 'Historical median', values: corresponding.values }],
        ariaLabel: 'Historical corresponding fundraiser day performance',
        className: 'historical-corresponding-days',
        ...rateChartOptions()
      })),
      rankingBarCard(analyses, 'topic', 'Topic performance', 'Top historical topics by fundraiser-balanced median $/hour. Full evidence counts appear in the table below.'),
      rankingBarCard(analyses, 'subtopic', 'Subtopic performance', 'Top historical subtopics by fundraiser-balanced median $/hour. Full evidence counts appear in the table below.', {}, 10),
      historicalStartTimeOverviewCard(analyses),
      rankingBarCard(analyses, 'daypart', 'Daypart performance', 'Historical median performance by morning, afternoon, early evening, prime, and overnight.'),
      rankingBarCard(analyses, 'weekpart', 'Weekday / Saturday / Sunday', 'Historical median performance by day type.'),
      rankingBarCard(analyses, 'breakType', 'Live vs pre-recorded breaks', 'Historical median performance using saved schedule live-break flags.'),
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
    const lifecycle = lifecycleForAnalysis(analysis);
    const historicalLifecycle = historicalLifecycleMedians(historical);
    const topics = currentTopicComparisonData(analysis, historical);
    const programs = currentProgramRateData(analysis);
    const cards = [
      chartCard('Daily Broadcast income', 'Daily Broadcast dollars. The day-by-day table later in the report supplies hours, $/hour, pledges, and weather.', incomeBarChartSvg(days)),
      chartCard('Fundraiser lifecycle vs history', 'This fundraiser and the historical fundraiser-balanced median, normalized into opening through closing fifths.', lineChartSvg({
        labels: lifecycle.map((row) => row.label),
        series: [
          { label: 'This fundraiser', values: lifecycle.map((row) => row.dollarsPerHour) },
          { label: 'Historical median', values: historicalLifecycle.map((row) => row.dollarsPerHour) }
        ],
        ariaLabel: 'Current fundraiser lifecycle compared with history',
        className: 'fundraiser-lifecycle-comparison',
        legendTop: true,
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
    const currentLifecycle = lifecycleForAnalysis(analysis);
    const historyLifecycle = historicalLifecycleMedians(baseline);
    const currentPeak = [...currentLifecycle].filter((row) => Number.isFinite(Number(row.dollarsPerHour))).sort((a, b) => Number(b.dollarsPerHour || 0) - Number(a.dollarsPerHour || 0))[0];
    const historicalPeak = [...historyLifecycle].filter((row) => Number.isFinite(Number(row.dollarsPerHour))).sort((a, b) => Number(b.dollarsPerHour || 0) - Number(a.dollarsPerHour || 0))[0];
    const topicRows = currentTopicComparisonData(analysis, baseline);
    let topicText = 'There is not enough rate-valid topic data for a historical comparison.';
    if (topicRows.labels.length) {
      const bestIndex = topicRows.current.reduce((best, value, index, values) => Number(value || 0) > Number(values[best] || 0) ? index : best, 0);
      const topic = topicRows.labels[bestIndex];
      const historicalTopic = topicRows.historical[bestIndex];
      topicText = `${topic} was the strongest rate-valid topic in this fundraiser at ${money(topicRows.current[bestIndex])}/hr. ${Number.isFinite(Number(historicalTopic)) ? `That is ${comparisonPhrase(topicRows.current[bestIndex], historicalTopic, `${topic} historical median`)}.` : 'That topic does not yet have enough historical evidence for a stable median.'}`;
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
        title: 'Fundraiser lifecycle',
        text: currentPeak && historicalPeak
          ? `This fundraiser peaked in its ${currentPeak.label.toLowerCase()} at ${money(currentPeak.dollarsPerHour)}/hr. Historically, the strongest median lifecycle band is the ${historicalPeak.label.toLowerCase()} at ${money(historicalPeak.dollarsPerHour)}/hr.${currentPeak.label === historicalPeak.label ? ' The timing of this fundraiser’s peak matches the long-term pattern.' : ' Its peak occurred in a different part of the drive than the long-term pattern.'}`
          : 'Lifecycle comparison is unavailable because the fundraiser does not have enough day-level rate data.'
      },
      { title: 'Programming mix', text: topicText },
      { title: 'Scheduling pattern', text: timingText }
    ];
  }

  function fundraiserHistoricalContext(analysis, historical = []) {
    const paragraphs = historicalContextParagraphs(analysis, historical);
    return `<section class="sheet-section historical-context"><div class="section-heading"><div><h2>Historical context</h2><p>The selected fundraiser is interpreted against prior fundraiser-level evidence so the report answers not only what happened, but whether it was unusual.</p></div></div><div class="historical-context-grid">${paragraphs.map((item) => `<article><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.text)}</p></article>`).join('')}</div></section>`;
  }
'''
js = replace_once(js, '\n  function historicalReportBody(analyses) {', visual_block + '\n  function historicalReportBody(analyses) {', 'historical visual block insertion')

old_body = """  function historicalReportBody(analyses) {
    return [
      historicalSeasonTable(analyses),
      historicalRankingTable(analyses, 'topic', 'Topic performance', 'Each fundraiser contributes one topic-specific $/pledge-hour observation; topics require at least 3 rate-valid airings across at least 2 fundraisers.'),
      historicalRankingTable(analyses, 'subtopic', 'Subtopic performance', 'Each fundraiser contributes one subtopic-specific $/pledge-hour observation; subtopics require at least 3 rate-valid airings across at least 2 fundraisers.'),
      historicalStartTimeTables(analyses),
      historicalRankingTable(analyses, 'weekpart', 'Weekday / Saturday / Sunday', 'Each fundraiser contributes one aggregated weekday, Saturday, or Sunday $/pledge-hour observation.'),
      historicalRankingTable(analyses, 'daypart', 'Daypart performance', 'Each fundraiser contributes one $/pledge-hour observation for each daypart it used: morning, afternoon, early evening, prime, or overnight.'),
      historicalRankingTable(analyses, 'breakType', 'Live break vs pre-recorded break', 'Each fundraiser contributes one rate per break type. Uses saved schedule live-break flags only; unmatched imported rows are excluded.'),
      historicalRankingTable(analyses, 'distributor', 'Distributor performance', 'Each fundraiser contributes one distributor-specific $/pledge-hour observation; distributors require at least 3 rate-valid airings across at least 2 fundraisers.')
    ].join('');
  }"""
new_body = """  function historicalReportBody(analyses) {
    return [
      historicalVisualOverview(analyses),
      historicalSeasonTable(analyses),
      historicalRankingTable(analyses, 'topic', 'Topic performance', 'Each fundraiser contributes one topic-specific $/pledge-hour observation; topics require at least 3 rate-valid airings across at least 2 fundraisers.'),
      historicalRankingTable(analyses, 'subtopic', 'Subtopic performance', 'Each fundraiser contributes one subtopic-specific $/pledge-hour observation; subtopics require at least 3 rate-valid airings across at least 2 fundraisers.'),
      historicalStartTimeTables(analyses),
      historicalRankingTable(analyses, 'weekpart', 'Weekday / Saturday / Sunday', 'Each fundraiser contributes one aggregated weekday, Saturday, or Sunday $/pledge-hour observation.'),
      historicalRankingTable(analyses, 'daypart', 'Daypart performance', 'Each fundraiser contributes one $/pledge-hour observation for each daypart it used: morning, afternoon, early evening, prime, or overnight.'),
      historicalRankingTable(analyses, 'breakType', 'Live break vs pre-recorded break', 'Each fundraiser contributes one rate per break type. Uses saved schedule live-break flags only; unmatched imported rows are excluded.'),
      historicalRankingTable(analyses, 'distributor', 'Distributor performance', 'Each fundraiser contributes one distributor-specific $/pledge-hour observation; distributors require at least 3 rate-valid airings across at least 2 fundraisers.')
    ].join('');
  }"""
js = replace_once(js, old_body, new_body, 'historical body')

old_render = """    const analysis = analysisFor(schedule);
    if (!(await ensureDurationDecision([analysis]))) return;
    const render = () => `<article class=\"one-sheet fundraiser-sheet\">${fundraiserSummary(analysis)}${durationNoticeSection([analysis])}${dailyIncomeChart(analysis)}${fundraiserAirSchedule(analysis)}${fundraiserDailyTable(analysis)}${programResultsTable(analysis)}${singleTopicSummary(analysis)}<footer class=\"sheet-footer\">Program, daily, and topic $/hour use only observations with known results and valid duration; the displayed rate base identifies the denominator when it differs from scheduled pledge hours. Non-Specific Pledges are not treated as incomplete program/topic data. Start-time performance is reserved for historical analytics where sufficient sample size can be required. Regional weather averages available Ironwood, Houghton, Marquette, Escanaba, and Sault Ste. Marie observations during each pledge window.</footer></article>`;
    $('#report-output').innerHTML = render();
    await ensureWeatherForAnalyses([analysis]);
    $('#report-output').innerHTML = render();"""
new_render = """    const analysis = analysisFor(schedule);
    if (!(await ensureDurationDecision([analysis]))) return;
    const history = historicalAnalyses();
    const render = () => `<article class=\"one-sheet fundraiser-sheet\">${fundraiserSummary(analysis)}${durationNoticeSection([analysis])}${fundraiserVisualOverview(analysis, history)}${fundraiserHistoricalContext(analysis, history)}${fundraiserAirSchedule(analysis)}${fundraiserDailyTable(analysis)}${programResultsTable(analysis)}${singleTopicSummary(analysis)}<footer class=\"sheet-footer\">Program, daily, and topic $/hour use only observations with known results and valid duration; the displayed rate base identifies the denominator when it differs from scheduled pledge hours. Historical context uses fundraiser-balanced comparisons and excludes the selected fundraiser from its baseline when prior history is available. Non-Specific Pledges are not treated as incomplete program/topic data. Start-time performance is reserved for historical analytics where sufficient sample size can be required. Regional weather averages available Ironwood, Houghton, Marquette, Escanaba, and Sault Ste. Marie observations during each pledge window.</footer></article>`;
    $('#report-output').innerHTML = render();
    bindChartTooltips($('#report-output'));
    await ensureWeatherForAnalyses([analysis]);
    $('#report-output').innerHTML = render();
    bindChartTooltips($('#report-output'));"""
js = replace_once(js, old_render, new_render, 'fundraiser render')

REPORTS_JS.write_text(js)

# Report styling and cache-busting. The CSS is intentionally presentation-only and does not alter analytics math.
html = REPORTS_HTML.read_text()
html = html.replace('0.22.129', '0.22.130')
css = r'''
    .visual-overview{break-inside:auto}
    .visual-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:12px}
    .visual-card{border:1px solid #d5e1e7;border-radius:9px;background:#fbfdfe;padding:12px;min-width:0;break-inside:avoid}
    .visual-card .section-heading{margin-bottom:4px}
    .visual-card h3{margin:0;color:#17384a;font-size:1rem}
    .visual-card .section-heading p{margin-top:4px;font-size:.82rem;line-height:1.35}
    .visual-card .report-chart{margin-top:4px}
    .historical-context-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:10px}
    .historical-context-grid article{border-left:4px solid #9bb8c7;background:#f6fafc;padding:10px 12px;break-inside:avoid}
    .historical-context-grid h3{margin:0 0 4px;color:#17384a;font-size:.95rem}
    .historical-context-grid p{margin:0;color:#334f5e;line-height:1.45}
    .report-bar-chart-svg rect{vector-effect:non-scaling-stroke}
    @media(max-width:900px){.visual-grid,.historical-context-grid{grid-template-columns:1fr}}
    @media print{
      .visual-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .visual-card{padding:7px}
      .visual-card .section-heading p{font-size:7.5pt}
      .visual-card h3{font-size:9pt}
      .historical-context-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
      .historical-context-grid p{font-size:8pt}
    }
'''
html = replace_once(html, '  </style>', css + '  </style>', 'report visual css')
REPORTS_HTML.write_text(html)

VERSION.write_text(json.dumps({'appVersion': '0.22.130', 'releasedAt': '2026-09-02'}, separators=(',', ':')) + '\n')

TEST.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reports = fs.readFileSync('assets/js/one-sheet-reports.js', 'utf8');
const html = fs.readFileSync('reports.html', 'utf8');
const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));

test('v0.22.130 puts visual summaries before detailed report tables', () => {
  assert.match(reports, /function historicalVisualOverview\(analyses = \[\]\)/);
  assert.match(reports, /historicalVisualOverview\(analyses\),\s*historicalSeasonTable/);
  assert.match(reports, /function fundraiserVisualOverview\(analysis, historical = \[\]\)/);
  assert.match(reports, /fundraiserVisualOverview\(analysis, history\).*fundraiserHistoricalContext\(analysis, history\).*fundraiserAirSchedule/s);
});

test('v0.22.130 adds trend, lifecycle, topic, start-time, and donor-context views', () => {
  for (const marker of [
    'Fundraiser productivity over time',
    'Average gift over time',
    'Fundraiser lifecycle',
    'Season performance over time',
    'Corresponding fundraiser days',
    'Start-time performance',
    'Topic performance vs history',
    'Top program rates',
    'Donor behavior',
    'Scheduling pattern'
  ]) assert.ok(reports.includes(marker), `missing ${marker}`);
});

test('historical context remains fundraiser-balanced and excludes the selected fundraiser when possible', () => {
  assert.match(reports, /historyWithoutCurrent = historical\.filter/);
  assert.match(reports, /medianNumber\(overallRates\)/);
  assert.match(reports, /percentileForValue\(overallRates, currentRate\)/);
  assert.match(reports, /historicalLifecycleMedians\(baseline\)/);
});

test('report assets and application version are synchronized at v0.22.130', () => {
  assert.equal(version.appVersion, '0.22.130');
  assert.ok(html.includes('one-sheet-reports.css?v=0.22.130'));
  assert.ok(html.includes('one-sheet-analysis.js?v=0.22.130'));
  assert.ok(html.includes('one-sheet-reports.js?v=0.22.130'));
});
''')

print('v0.22.130 report visual/context changes staged')

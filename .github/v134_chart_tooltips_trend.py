from pathlib import Path

p = Path('assets/js/one-sheet-reports.js')
s = p.read_text()

# Add reusable tooltip and regression helpers after programResultsForFundraiserDay.
needle = """  function dailyComparisonChart(analyses, aligned) {\n"""
insert = r"""
  function programTooltipLinesForRows(rows = [], limit = 24) {
    const groups = new Map();
    (rows || []).filter((row) => !rowIsNonSpecific(row)).forEach((row) => {
      const title = A.text(row.title || row.plannedTitle || '');
      if (!title) return;
      const key = title.toLowerCase();
      if (!groups.has(key)) groups.set(key, { title, dollars: 0, pledges: 0, airings: 0, known: 0 });
      const item = groups.get(key);
      item.airings += 1;
      if (row.known) {
        item.known += 1;
        item.dollars += Number(row.dollars || 0);
        item.pledges += Number(row.pledges || 0);
      }
    });
    const items = [...groups.values()].sort((a, b) => Number(b.dollars || 0) - Number(a.dollars || 0) || a.title.localeCompare(b.title));
    const shown = items.slice(0, limit).map((item) => item.known
      ? `${item.title} — ${money(item.dollars)} · ${count(item.pledges)} pledge${Number(item.pledges) === 1 ? '' : 's'}${item.airings > 1 ? ` · ${item.airings} airings` : ''}`
      : `${item.title} — result unavailable`);
    if (items.length > limit) shown.push(`+ ${items.length - limit} more program title${items.length - limit === 1 ? '' : 's'}`);
    return shown;
  }

  function analysisProgramTooltip(analysis, title = '', detail = '') {
    return {
      title: title || A.text(analysis?.schedule?.title || 'Fundraiser'),
      detail,
      lines: programTooltipLinesForRows(analysis?.placementRows || [])
    };
  }

  function aggregateProgramTooltip(analyses = [], title = '', detail = '', rowFilter = null) {
    const rows = (analyses || []).flatMap((analysis) => (analysis?.placementRows || []).filter((row) => !rowFilter || rowFilter(row, analysis)));
    return { title, detail, lines: programTooltipLinesForRows(rows) };
  }

  function linearTrend(values = []) {
    const points = values.map((value, index) => ({ x: index, y: Number(value) })).filter((point) => Number.isFinite(point.y));
    if (points.length < 2) return { values: values.map(() => null), slope: 0, intercept: 0, r2: 0, n: points.length };
    const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const ssX = points.reduce((sum, point) => sum + ((point.x - meanX) ** 2), 0);
    const slope = ssX ? points.reduce((sum, point) => sum + ((point.x - meanX) * (point.y - meanY)), 0) / ssX : 0;
    const intercept = meanY - (slope * meanX);
    const predicted = values.map((_value, index) => intercept + (slope * index));
    const ssTot = points.reduce((sum, point) => sum + ((point.y - meanY) ** 2), 0);
    const ssRes = points.reduce((sum, point) => sum + ((point.y - (intercept + (slope * point.x))) ** 2), 0);
    const r2 = ssTot ? Math.max(0, Math.min(1, 1 - (ssRes / ssTot))) : 1;
    return { values: predicted, slope, intercept, r2, n: points.length };
  }

  function startBucketForRow(row = {}) {
    if (!Number.isFinite(Number(row.startMinutes))) return null;
    const normalized = ((Number(row.startMinutes) % 1440) + 1440) % 1440;
    return Math.floor(normalized / 30) * 30;
  }

"""
if needle not in s:
    raise SystemExit('dailyComparisonChart insertion point not found')
s = s.replace(needle, insert + needle, 1)

# Give historical trend data program tooltips.
old = r"""  function trendSeriesForHistory(analyses, metric) {
    const ordered = chronologicalAnalyses(analyses);
    return {
      ordered,
      labels: ordered.map(analysisTrendLabel),
      axisLabels: ordered.map(compactTrendAxisLabel),
      values: ordered.map((analysis) => Number(metric(analysis) || 0))
    };
  }
"""
new = r"""  function trendSeriesForHistory(analyses, metric) {
    const ordered = chronologicalAnalyses(analyses);
    return {
      ordered,
      labels: ordered.map(analysisTrendLabel),
      axisLabels: ordered.map(compactTrendAxisLabel),
      values: ordered.map((analysis) => Number(metric(analysis) || 0)),
      tooltips: ordered.map((analysis) => analysisProgramTooltip(
        analysis,
        analysis.schedule.title,
        `${formatDate(analysis.schedule.startDate)}–${formatDate(analysis.schedule.endDate)} · ${money(analysis.broadcastDollars)} Broadcast · ${count(analysis.pledges)} pledges`
      ))
    };
  }
"""
if old not in s:
    raise SystemExit('trendSeriesForHistory block not found')
s = s.replace(old, new, 1)

# Add aggregate tooltip evidence to corresponding-day series.
old = r"""  function correspondingDaySeries(analyses = []) {
    const aligned = A.alignedDailyRows(analyses);
    return {
      labels: aligned.map((entry) => entry.label.title),
      values: aligned.map((entry) => {
        const values = (entry.days || []).filter(Boolean).map((day) => Number(day.dollarsPerHour)).filter(Number.isFinite);
        return values.length ? medianNumber(values) : null;
      })
    };
  }
"""
new = r"""  function correspondingDaySeries(analyses = []) {
    const aligned = A.alignedDailyRows(analyses);
    return {
      labels: aligned.map((entry) => entry.label.title),
      values: aligned.map((entry) => {
        const values = (entry.days || []).filter(Boolean).map((day) => Number(day.dollarsPerHour)).filter(Number.isFinite);
        return values.length ? medianNumber(values) : null;
      }),
      tooltips: aligned.map((entry) => {
        const contributing = (entry.days || []).map((day, index) => day ? { day, analysis: analyses[index] } : null).filter(Boolean);
        const values = contributing.map(({ day }) => Number(day.dollarsPerHour)).filter(Number.isFinite);
        if (!values.length) return null;
        const rows = contributing.flatMap(({ day, analysis }) => (analysis?.placementRows || []).filter((row) => A.text(row.dateKey) === A.text(day.dateKey)));
        return {
          title: `Corresponding ${entry.label.title}`,
          detail: `${contributing.length} fundraiser observation${contributing.length === 1 ? '' : 's'} · median ${money(medianNumber(values))}/hr`,
          lines: programTooltipLinesForRows(rows)
        };
      })
    };
  }
"""
if old not in s:
    raise SystemExit('correspondingDaySeries block not found')
s = s.replace(old, new, 1)

# Five-year corresponding-day graph: tooltips, standout all-years line, and explicit linear trend statistic.
old = r"""  function historicalCorrespondingDayBandData(analyses = []) {
    const combined = correspondingDaySeries(analyses);
    const bands = fiveYearHistoryBands(analyses);
    const labels = combined.labels;
    const series = bands.map((band) => {
      const data = correspondingDaySeries(band.analyses);
      const byLabel = new Map(data.labels.map((label, index) => [label, data.values[index]]));
      return { label: band.label, values: labels.map((label) => byLabel.has(label) ? byLabel.get(label) : null) };
    });
    series.push({ label: 'All selected years', values: combined.values, style: { stroke: '#667781', dash: '5 5', width: 1.25 } });
    return { labels, series };
  }
"""
new = r"""  function historicalCorrespondingDayBandData(analyses = []) {
    const combined = correspondingDaySeries(analyses);
    const bands = fiveYearHistoryBands(analyses);
    const labels = combined.labels;
    const series = bands.map((band) => {
      const data = correspondingDaySeries(band.analyses);
      const byLabel = new Map(data.labels.map((label, index) => [label, { value: data.values[index], tooltip: data.tooltips?.[index] || null }]));
      return {
        label: band.label,
        values: labels.map((label) => byLabel.has(label) ? byLabel.get(label).value : null),
        tooltips: labels.map((label) => byLabel.has(label) ? byLabel.get(label).tooltip : null)
      };
    });
    series.push({
      label: 'All selected years',
      values: combined.values,
      tooltips: combined.tooltips,
      style: { stroke: '#ff2020', dash: '', width: 3.25 }
    });
    const trend = linearTrend(combined.values);
    if (trend.n >= 2) {
      const sign = trend.slope >= 0 ? '+' : '−';
      const slope = money(Math.abs(trend.slope));
      series.push({
        label: `Long-term linear trend: ${sign}${slope}/hr per fundraiser-day position · R² ${trend.r2.toFixed(2)}`,
        values: trend.values,
        style: { stroke: '#ff2020', dash: '9 6', width: 2 }
      });
    }
    return { labels, series };
  }
"""
if old not in s:
    raise SystemExit('historicalCorrespondingDayBandData block not found')
s = s.replace(old, new, 1)

# Add tooltips to seasonal aggregate points.
old = r"""      series: seasons.map((season) => ({
        label: season,
        values: years.map((year) => {
          const values = ordered.filter((analysis) => Number(analysis.schedule?.year || 0) === year && historicalSeasonBucket(analysis) === season).map(rateForAnalysis).filter((value) => Number.isFinite(Number(value)));
          return values.length ? medianNumber(values) : null;
        })
      }))
"""
new = r"""      series: seasons.map((season) => ({
        label: season,
        values: years.map((year) => {
          const values = ordered.filter((analysis) => Number(analysis.schedule?.year || 0) === year && historicalSeasonBucket(analysis) === season).map(rateForAnalysis).filter((value) => Number.isFinite(Number(value)));
          return values.length ? medianNumber(values) : null;
        }),
        tooltips: years.map((year) => {
          const subset = ordered.filter((analysis) => Number(analysis.schedule?.year || 0) === year && historicalSeasonBucket(analysis) === season);
          if (!subset.length) return null;
          return aggregateProgramTooltip(subset, `${season} ${year}`, `${subset.length} fundraiser${subset.length === 1 ? '' : 's'} contributing to this point`);
        })
      }))
"""
if old not in s:
    raise SystemExit('historicalSeasonTrendData series block not found')
s = s.replace(old, new, 1)

# Historical start-time line nodes get program evidence.
old = r"""          const byKey = new Map(rows.map((row) => [Number(row.key), Number(row.medianDollarsPerHour || 0)]));
          return { label, values: keys.map((key) => byKey.has(key) ? byKey.get(key) : null) };
"""
new = r"""          const byKey = new Map(rows.map((row) => [Number(row.key), Number(row.medianDollarsPerHour || 0)]));
          return {
            label,
            values: keys.map((key) => byKey.has(key) ? byKey.get(key) : null),
            tooltips: keys.map((key) => byKey.has(key)
              ? aggregateProgramTooltip(
                  subset,
                  `${label} · ${formatTime(key)}`,
                  `${money(byKey.get(key))}/hr historical fundraiser-balanced median`,
                  (row) => startBucketForRow(row) === key
                )
              : null)
          };
"""
if old not in s:
    raise SystemExit('historicalStartTimeOverviewCard series block not found')
s = s.replace(old, new, 1)

# Historical productivity and gift lines consume their per-fundraiser tooltips.
s = s.replace("series: [{ label: 'Broadcast $ / pledge hour', values: productivity.values }],", "series: [{ label: 'Broadcast $ / pledge hour', values: productivity.values, tooltips: productivity.tooltips }],", 1)
s = s.replace("series: [{ label: '$ / pledge', values: gifts.values }],", "series: [{ label: '$ / pledge', values: gifts.values, tooltips: gifts.tooltips }],", 1)

# Selected fundraiser historical context lines consume program tooltips too.
old = r"""      series: [
        { label: 'Historical', values: trend.values },
        { label: 'Selected fundraiser', values: marker }
      ],
"""
new = r"""      series: [
        { label: 'Historical', values: trend.values, tooltips: trend.tooltips },
        { label: 'Selected fundraiser', values: marker, tooltips: trend.tooltips.map((tooltip, index) => marker[index] === null ? null : tooltip) }
      ],
"""
if old not in s:
    raise SystemExit('selectedHistoryTrendCard series block not found')
s = s.replace(old, new, 1)

# Current corresponding-day line: current day and historical aggregate nodes both expose programs.
old = r"""  function currentCorrespondingDayComparisonData(analysis, historical = []) {
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
"""
new = r"""  function currentCorrespondingDayComparisonData(analysis, historical = []) {
    const baseline = historical.filter((item) => A.text(item.schedule?.id || '') !== A.text(analysis.schedule?.id || ''));
    const combined = A.alignedDailyRows([analysis, ...baseline]);
    return {
      labels: combined.map((entry) => entry.label.title),
      current: combined.map((entry) => entry.days?.[0] ? Number(entry.days[0].dollarsPerHour) : null),
      currentTooltips: combined.map((entry) => {
        const day = entry.days?.[0] || null;
        if (!day) return null;
        return {
          title: `${analysis.schedule.title} · ${entry.label.title}`,
          detail: `${formatDate(day.date)} · ${money(day.dollarsPerHour)}/hr`,
          lines: programResultsForFundraiserDay(analysis, day).map((item) => item.known ? `${item.title} — ${money(item.dollars)}` : `${item.title} — result unavailable`)
        };
      }),
      historical: combined.map((entry) => {
        const values = (entry.days || []).slice(1).filter(Boolean).map((day) => Number(day.dollarsPerHour)).filter(Number.isFinite);
        return values.length ? medianNumber(values) : null;
      }),
      historicalTooltips: combined.map((entry) => {
        const pairs = (entry.days || []).slice(1).map((day, index) => day ? { day, analysis: baseline[index] } : null).filter(Boolean);
        const values = pairs.map(({ day }) => Number(day.dollarsPerHour)).filter(Number.isFinite);
        if (!values.length) return null;
        const rows = pairs.flatMap(({ day, analysis: item }) => (item?.placementRows || []).filter((row) => A.text(row.dateKey) === A.text(day.dateKey)));
        return {
          title: `Historical median · ${entry.label.title}`,
          detail: `${pairs.length} fundraiser observation${pairs.length === 1 ? '' : 's'} · ${money(medianNumber(values))}/hr`,
          lines: programTooltipLinesForRows(rows)
        };
      })
    };
  }
"""
if old not in s:
    raise SystemExit('currentCorrespondingDayComparisonData block not found')
s = s.replace(old, new, 1)

old = r"""        series: [
          { label: 'This fundraiser', values: corresponding.current },
          { label: 'Historical median', values: corresponding.historical }
        ],
"""
new = r"""        series: [
          { label: 'This fundraiser', values: corresponding.current, tooltips: corresponding.currentTooltips },
          { label: 'Historical median', values: corresponding.historical, tooltips: corresponding.historicalTooltips }
        ],
"""
if old not in s:
    raise SystemExit('fundraiser corresponding series block not found')
s = s.replace(old, new, 1)

# Update description to define the trend statistic.
s = s.replace(
    "Five-year bands show how the fundraiser calendar and day-by-day productivity have changed. The thin dashed line is the combined result for the selected date range.",
    "Five-year bands show how the fundraiser calendar and day-by-day productivity have changed. The bright red line combines all selected years; the dashed red least-squares line reports the long-term slope across fundraiser-day positions with R² in the legend.",
    1
)

p.write_text(s)

# Advance version/cache refs and all current-version regression locks.
Path('version.json').write_text('{"appVersion":"0.22.134","releasedAt":"2026-09-03"}\n')
r = Path('reports.html')
rs = r.read_text()
if '0.22.133' not in rs:
    raise SystemExit('reports.html missing v0.22.133 refs')
r.write_text(rs.replace('0.22.133', '0.22.134'))

for path in Path('tests').glob('*.test.mjs'):
    text = path.read_text()
    if '0.22.133' in text or r'0\.22\.133' in text:
        path.write_text(text.replace('0.22.133', '0.22.134').replace(r'0\.22\.133', r'0\.22\.134'))

Path('tests/chart-program-tooltips-trend-v134.test.mjs').write_text(r"""import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../reports.html', import.meta.url), 'utf8');
const version = JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url), 'utf8'));

assert.equal(version.appVersion, '0.22.134');
assert.match(html, /0\.22\.134/);
assert.match(source, /function programTooltipLinesForRows/);
assert.match(source, /function aggregateProgramTooltip/);
assert.match(source, /tooltips: productivity\.tooltips/);
assert.match(source, /tooltips: gifts\.tooltips/);
assert.match(source, /historicalTooltips/);
assert.match(source, /currentTooltips/);
assert.match(source, /tooltips: combined\.tooltips/);
assert.match(source, /stroke: '#ff2020', dash: '', width: 3\.25/);
assert.match(source, /Long-term linear trend:/);
assert.match(source, /R² \$\{trend\.r2\.toFixed\(2\)\}/);
assert.match(source, /stroke: '#ff2020', dash: '9 6', width: 2/);
assert.match(source, /least-squares line reports the long-term slope/);
console.log('v0.22.134 chart program tooltip and trend tests passed');
""")

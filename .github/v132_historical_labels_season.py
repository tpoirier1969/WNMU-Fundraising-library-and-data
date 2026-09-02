from pathlib import Path
import json

ROOT = Path('.')
REPORTS = ROOT / 'assets/js/one-sheet-reports.js'
HTML = ROOT / 'reports.html'
VERSION = ROOT / 'version.json'


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing target: {label}')
    return text.replace(old, new, 1)

text = REPORTS.read_text()

text = replace_once(
    text,
    "    historicalStartDate: '',\n    historicalEndDate: ''\n",
    "    historicalStartDate: '',\n    historicalEndDate: '',\n    historicalSeason: 'all'\n",
    'historical state'
)

text = replace_once(
    text,
    "  function lineChartSvg({ labels = [], series = [], ariaLabel = 'Fundraiser comparison line graph', className = '', legendTop = false, yLabel = 'Broadcast dollars', axisFormatter = compactMoney, pointFormatter = money, xLabelEvery = 1, verticalGridEvery = 0 } = {}) {\n    if (!labels.length || !series.length) return '<div class=\"chart-empty\">No chartable results.</div>';\n",
    "  function lineChartSvg({ labels = [], series = [], ariaLabel = 'Fundraiser comparison line graph', className = '', legendTop = false, yLabel = 'Broadcast dollars', axisFormatter = compactMoney, pointFormatter = money, xLabelEvery = 1, verticalGridEvery = 0, xDisplayLabels = null } = {}) {\n    if (!labels.length || !series.length) return '<div class=\"chart-empty\">No chartable results.</div>';\n    const displayLabels = Array.isArray(xDisplayLabels) && xDisplayLabels.length === labels.length ? xDisplayLabels : labels;\n",
    'line chart display labels'
)

text = replace_once(
    text,
    "    const rotate = labels.length > 8 || labels.some((label) => String(label).length > 12);\n    const xLabels = labels.map((label, index) => {\n",
    "    const rotate = displayLabels.length > 8 || displayLabels.some((label) => String(label).length > 12);\n    const xLabels = displayLabels.map((label, index) => {\n",
    'line chart x labels'
)

old = """  function analysisTrendLabel(analysis) {\n    const season = A.text(analysis?.schedule?.season || 'Special');\n    const year = Number(analysis?.schedule?.year || 0) || A.parseDate(analysis?.schedule?.startDate)?.getFullYear() || '';\n    return `${season} ${year}`.trim();\n  }\n"""
new = """  const HISTORICAL_SEASONS = ['March', 'June', 'August', 'December', 'Special'];\n\n  function historicalSeasonBucket(value = {}) {\n    const schedule = value?.schedule || value || {};\n    const season = A.text(schedule?.season || '');\n    return ['March', 'June', 'August', 'December'].includes(season) ? season : 'Special';\n  }\n\n  function analysisTrendLabel(analysis) {\n    const season = historicalSeasonBucket(analysis);\n    const year = Number(analysis?.schedule?.year || 0) || A.parseDate(analysis?.schedule?.startDate)?.getFullYear() || '';\n    return `${season} ${year}`.trim();\n  }\n\n  function compactTrendAxisLabel(analysis) {\n    const season = historicalSeasonBucket(analysis);\n    const year = Number(analysis?.schedule?.year || 0) || A.parseDate(analysis?.schedule?.startDate)?.getFullYear() || '';\n    const shortYear = year ? `'${String(year).slice(-2)}` : '';\n    if (season === 'March') return `March ${year}`.trim();\n    if (season === 'June') return `J ${shortYear}`.trim();\n    if (season === 'August') return `A ${shortYear}`.trim();\n    if (season === 'December') return `D ${shortYear}`.trim();\n    return `S ${shortYear}`.trim();\n  }\n"""
text = replace_once(text, old, new, 'trend season helpers')

old = """  function trendSeriesForHistory(analyses, metric) {\n    const ordered = chronologicalAnalyses(analyses);\n    return {\n      ordered,\n      labels: ordered.map(analysisTrendLabel),\n      values: ordered.map((analysis) => Number(metric(analysis) || 0))\n    };\n  }\n"""
new = """  function trendSeriesForHistory(analyses, metric) {\n    const ordered = chronologicalAnalyses(analyses);\n    return {\n      ordered,\n      labels: ordered.map(analysisTrendLabel),\n      axisLabels: ordered.map(compactTrendAxisLabel),\n      values: ordered.map((analysis) => Number(metric(analysis) || 0))\n    };\n  }\n"""
text = replace_once(text, old, new, 'trend axis labels')

old = """  function historicalSeasonTrendData(analyses = []) {\n    const ordered = chronologicalAnalyses(analyses);\n    const years = [...new Set(ordered.map((analysis) => Number(analysis.schedule?.year || 0)).filter(Boolean))].sort((a, b) => a - b);\n    const seasons = ['March', 'June', 'August', 'December'].filter((season) => ordered.some((analysis) => analysis.schedule?.season === season));\n    return {\n      labels: years.map(String),\n      series: seasons.map((season) => ({\n        label: season,\n        values: years.map((year) => {\n          const values = ordered.filter((analysis) => Number(analysis.schedule?.year || 0) === year && analysis.schedule?.season === season).map(rateForAnalysis).filter((value) => Number.isFinite(Number(value)));\n          return values.length ? medianNumber(values) : null;\n        })\n      }))\n    };\n  }\n"""
new = """  function historicalSeasonTrendData(analyses = []) {\n    const ordered = chronologicalAnalyses(analyses);\n    const years = [...new Set(ordered.map((analysis) => Number(analysis.schedule?.year || 0)).filter(Boolean))].sort((a, b) => a - b);\n    const seasons = HISTORICAL_SEASONS.filter((season) => ordered.some((analysis) => historicalSeasonBucket(analysis) === season));\n    return {\n      labels: years.map(String),\n      series: seasons.map((season) => ({\n        label: season,\n        values: years.map((year) => {\n          const values = ordered.filter((analysis) => Number(analysis.schedule?.year || 0) === year && historicalSeasonBucket(analysis) === season).map(rateForAnalysis).filter((value) => Number.isFinite(Number(value)));\n          return values.length ? medianNumber(values) : null;\n        })\n      }))\n    };\n  }\n"""
text = replace_once(text, old, new, 'season trend special bucket')

text = replace_once(
    text,
    "    const trendEvery = Math.max(1, Math.ceil(productivity.labels.length / 14));\n    const giftEvery = Math.max(1, Math.ceil(gifts.labels.length / 14));\n",
    "",
    'remove culled label cadence'
)

text = replace_once(
    text,
    "      chartCard('Fundraiser productivity over time', 'One observation per fundraiser. Full width, selected date labels, vertical guides, and nodes make long-term movement easier to follow without shrinking the type.', lineChartSvg({\n        labels: productivity.labels,\n",
    "      chartCard('Fundraiser productivity over time', 'One observation per fundraiser. Every fundraiser keeps its own tick and vertical guide; compact season labels keep the full chronology visible.', lineChartSvg({\n        labels: productivity.labels,\n        xDisplayLabels: productivity.axisLabels,\n",
    'productivity description and display labels'
)
text = replace_once(text, "        xLabelEvery: trendEvery,\n        verticalGridEvery: trendEvery,\n", "        xLabelEvery: 1,\n        verticalGridEvery: 1,\n", 'productivity cadence')

text = replace_once(
    text,
    "      chartCard('Average gift over time', 'Broadcast dollars per pledge by fundraiser, separating changes in gift size from changes in donor frequency.', lineChartSvg({\n        labels: gifts.labels,\n",
    "      chartCard('Average gift over time', 'Broadcast dollars per pledge by fundraiser, separating changes in gift size from changes in donor frequency. Compact labels preserve every fundraiser on the time axis.', lineChartSvg({\n        labels: gifts.labels,\n        xDisplayLabels: gifts.axisLabels,\n",
    'gift display labels'
)
text = replace_once(text, "        xLabelEvery: giftEvery,\n        verticalGridEvery: giftEvery\n", "        xLabelEvery: 1,\n        verticalGridEvery: 1\n", 'gift cadence')

text = replace_once(
    text,
    "      chartCard('Season performance over time', 'March, June, August, and December are shown across years rather than collapsed into one lifetime season ranking.', lineChartSvg({\n",
    "      chartCard('Season performance over time', 'March, June, August, December, and Special fundraising periods are shown across years rather than collapsed into one lifetime season ranking.', lineChartSvg({\n",
    'season chart description'
)
text = replace_once(
    text,
    "        verticalGridEvery: 1,\n        ...rateChartOptions()\n      })),\n      chartCard('Corresponding fundraiser days by era'",
    "        verticalGridEvery: 1,\n        ...rateChartOptions()\n      }), 'visual-card-wide'),\n      chartCard('Corresponding fundraiser days by era'",
    'season chart full width'
)

old = """    $('#report-controls').innerHTML = `<div class=\"report-control-row historical-range-controls\">\n      <div class=\"historical-control-copy\"><strong>Historical analysis range</strong><span>Every chart, median, and evidence threshold is recalculated from only the selected fundraiser history.</span></div>\n      <label class=\"report-field\"><span>Start date</span><input type=\"date\" id=\"historical-start-date\" min=\"${escapeHtml(bounds.min)}\" max=\"${escapeHtml(bounds.max)}\" value=\"${escapeHtml(state.historicalStartDate)}\"></label>\n      <label class=\"report-field\"><span>End date</span><input type=\"date\" id=\"historical-end-date\" min=\"${escapeHtml(bounds.min)}\" max=\"${escapeHtml(bounds.max)}\" value=\"${escapeHtml(state.historicalEndDate)}\"></label>\n      <div class=\"historical-range-presets\">\n"""
new = """    const seasonOptions = ['all', ...HISTORICAL_SEASONS].map((season) => `<option value=\"${escapeHtml(season)}\" ${state.historicalSeason === season ? 'selected' : ''}>${season === 'all' ? 'All seasons' : escapeHtml(season)}</option>`).join('');\n    $('#report-controls').innerHTML = `<div class=\"report-control-row historical-range-controls\">\n      <div class=\"historical-control-copy\"><strong>Historical analysis range</strong><span>Every chart, median, and evidence threshold is recalculated from only the selected dates and season.</span></div>\n      <label class=\"report-field\"><span>Start date</span><input type=\"date\" id=\"historical-start-date\" min=\"${escapeHtml(bounds.min)}\" max=\"${escapeHtml(bounds.max)}\" value=\"${escapeHtml(state.historicalStartDate)}\"></label>\n      <label class=\"report-field\"><span>End date</span><input type=\"date\" id=\"historical-end-date\" min=\"${escapeHtml(bounds.min)}\" max=\"${escapeHtml(bounds.max)}\" value=\"${escapeHtml(state.historicalEndDate)}\"></label>\n      <label class=\"report-field\"><span>Season</span><select id=\"historical-season\">${seasonOptions}</select></label>\n      <div class=\"historical-range-presets\">\n"""
text = replace_once(text, old, new, 'historical season control')

text = replace_once(
    text,
    "    $('#historical-end-date')?.addEventListener('change', (event) => { state.historicalEndDate = event.target.value || bounds.max; void renderHistoricalReport(); });\n    $$('[data-history-range]').forEach",
    "    $('#historical-end-date')?.addEventListener('change', (event) => { state.historicalEndDate = event.target.value || bounds.max; void renderHistoricalReport(); });\n    $('#historical-season')?.addEventListener('change', (event) => { state.historicalSeason = event.target.value || 'all'; void renderHistoricalReport(); });\n    $$('[data-history-range]').forEach",
    'historical season listener'
)

old = """  function historicalAnalyses() {\n    const start = A.text(state.historicalStartDate || '');\n    const end = A.text(state.historicalEndDate || '');\n    return allHistoricalAnalyses().filter((analysis) => {\n      const scheduleStart = A.text(analysis.schedule?.startDate || '');\n      const scheduleEnd = A.text(analysis.schedule?.endDate || scheduleStart);\n      return (!start || scheduleEnd >= start) && (!end || scheduleStart <= end);\n    });\n  }\n"""
new = """  function historicalAnalyses() {\n    const start = A.text(state.historicalStartDate || '');\n    const end = A.text(state.historicalEndDate || '');\n    const season = A.text(state.historicalSeason || 'all');\n    return allHistoricalAnalyses().filter((analysis) => {\n      const scheduleStart = A.text(analysis.schedule?.startDate || '');\n      const scheduleEnd = A.text(analysis.schedule?.endDate || scheduleStart);\n      const inDateRange = (!start || scheduleEnd >= start) && (!end || scheduleStart <= end);\n      const inSeason = season === 'all' || historicalSeasonBucket(analysis) === season;\n      return inDateRange && inSeason;\n    });\n  }\n"""
text = replace_once(text, old, new, 'historical season filter')

REPORTS.write_text(text)

html = HTML.read_text().replace('0.22.131', '0.22.132')
HTML.write_text(html)
VERSION.write_text(json.dumps({'appVersion': '0.22.132', 'releasedAt': '2026-09-02'}, separators=(',', ':')) + '\n')

for test_path in [
    ROOT / 'tests/historical-refinements-v131.test.mjs',
    ROOT / 'tests/report-visual-historical-context-v130.test.mjs',
    ROOT / 'tests/library-load-performance.test.mjs',
    ROOT / 'tests/one-sheet-report-refinements.test.mjs',
    ROOT / 'tests/one-sheet-reports.test.mjs',
]:
    if test_path.exists():
        test_path.write_text(test_path.read_text().replace('0.22.131', '0.22.132'))

v132 = ROOT / 'tests/historical-labels-season-filter-v132.test.mjs'
v132.write_text("""import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\n\nconst source = fs.readFileSync('assets/js/one-sheet-reports.js', 'utf8');\nconst html = fs.readFileSync('reports.html', 'utf8');\nconst version = JSON.parse(fs.readFileSync('version.json', 'utf8'));\n\ntest('historical trend charts retain every fundraiser position with compact labels and guides', () => {\n  assert.match(source, /xDisplayLabels = null/);\n  assert.match(source, /axisLabels: ordered\\.map\\(compactTrendAxisLabel\\)/);\n  assert.match(source, /if \\(season === 'March'\\) return `March \\${year}`/);\n  assert.match(source, /if \\(season === 'June'\\) return `J \\${shortYear}`/);\n  assert.match(source, /if \\(season === 'August'\\) return `A \\${shortYear}`/);\n  assert.match(source, /if \\(season === 'December'\\) return `D \\${shortYear}`/);\n  assert.match(source, /xLabelEvery: 1,\\n        verticalGridEvery: 1/);\n  assert.doesNotMatch(source, /trendEvery|giftEvery/);\n});\n\ntest('season chart is full width and historical analytics can filter canonical or special seasons', () => {\n  assert.match(source, /HISTORICAL_SEASONS = \\['March', 'June', 'August', 'December', 'Special'\\]/);\n  assert.match(source, /id=\\\"historical-season\\\"/);\n  assert.match(source, /historicalSeasonBucket\\(analysis\\) === season/);\n  assert.match(source, /Season performance over time[\\s\\S]*?visual-card-wide/);\n});\n\ntest('v0.22.132 report assets stay synchronized', () => {\n  assert.equal(version.appVersion, '0.22.132');\n  assert.ok(html.includes('one-sheet-reports.css?v=0.22.132'));\n  assert.ok(html.includes('one-sheet-analysis.js?v=0.22.132'));\n  assert.ok(html.includes('one-sheet-reports.js?v=0.22.132'));\n});\n""")

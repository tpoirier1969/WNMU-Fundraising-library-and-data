from pathlib import Path
import json

path = Path('assets/js/ui-fundraiser-comparison.js')
s = path.read_text()

old = """  function weatherEndpointOrder(endDate = '') {\n    const end = parseDate(endDate);\n    const ageDays = end ? (Date.now() - end.getTime()) / 86400000 : 9999;\n    const forecast = 'https://api.open-meteo.com/v1/forecast';\n    const archive = 'https://archive-api.open-meteo.com/v1/archive';\n    return ageDays >= -16 && ageDays <= 92 ? [forecast, archive] : [archive, forecast];\n  }\n"""
new = old + """\n  function weatherDateIsFetchable(dateKey = '', now = new Date()) {\n    const date = parseDate(dateKey);\n    const current = now instanceof Date ? now : new Date(now);\n    if (!date || Number.isNaN(current.getTime())) return true;\n    const maxForecast = new Date(current.getFullYear(), current.getMonth(), current.getDate());\n    maxForecast.setDate(maxForecast.getDate() + 16);\n    return localDateSerial(date) <= localDateSerial(maxForecast);\n  }\n"""
if old not in s:
    raise SystemExit('weatherEndpointOrder block not found')
s = s.replace(old, new, 1)

old = """  async function fetchWeatherForAnalysis(analysis = {}) {\n    const dates = (analysis.placementRows || []).map((row) => text(row.dateKey)).filter(Boolean).sort();\n    if (!dates.length) return;\n    const startDate = dates[0];\n    const endDate = dates[dates.length - 1];\n"""
new = """  async function fetchWeatherForAnalysis(analysis = {}) {\n    const dates = [...new Set((analysis.placementRows || []).map((row) => text(row.dateKey)).filter(Boolean))].sort();\n    const fetchableDates = dates.filter((dateKey) => weatherDateIsFetchable(dateKey));\n    if (!fetchableDates.length) return;\n    const startDate = fetchableDates[0];\n    const endDate = fetchableDates[fetchableDates.length - 1];\n"""
if old not in s:
    raise SystemExit('fetchWeatherForAnalysis start not found')
s = s.replace(old, new, 1)

old = """      const failed = settled.filter((item) => item.status === 'rejected');\n      if (failed.length === settled.length) state.weatherError = failed[0]?.reason?.message || 'Weather unavailable.';\n      else if (failed.length) state.weatherError = 'Some fundraiser weather could not be loaded.';\n"""
new = """      const failed = settled.filter((item) => item.status === 'rejected');\n      if (failed.length === settled.length && settled.length) state.weatherError = failed[0]?.reason?.message || 'Weather unavailable.';\n"""
if old not in s:
    raise SystemExit('weather failure block not found')
s = s.replace(old, new, 1)

old = """    if (!weather) {\n      if (state.weatherLoading) return '<span class=\"fc-weather-line loading\">Loading U.P. weather…</span>';\n      if (state.weatherError) return `<span class=\"fc-weather-line error\">${escapeHtml(state.weatherError)}</span>`;\n      return '<span class=\"fc-weather-line muted\">Weather unavailable</span>';\n    }\n"""
new = """    if (!weather) {\n      if (!weatherDateIsFetchable(dateKey)) return '<span class=\"fc-weather-line muted\">Weather not available yet</span>';\n      if (state.weatherLoading) return '<span class=\"fc-weather-line loading\">Loading U.P. weather…</span>';\n      if (state.weatherError) return `<span class=\"fc-weather-line error\">${escapeHtml(state.weatherError)}</span>`;\n      return '<span class=\"fc-weather-line muted\">Weather unavailable</span>';\n    }\n"""
if old not in s:
    raise SystemExit('weatherMarkup empty block not found')
s = s.replace(old, new, 1)

old = """  function renderDailyContextCard(day = null, analysis = {}) {\n    if (!day) return '<article class=\"fc-day-context-card missing\"><strong>No fundraising scheduled</strong><span>No corresponding fundraiser day is present in this saved schedule.</span></article>';\n"""
new = """  function renderDailyContextCard(day = null, analysis = {}) {\n    if (!day) return '<article class=\"fc-day-context-card missing\"><strong>No pledge programming this day</strong><span>This fundraiser has no pledge programming on the corresponding fundraiser day.</span></article>';\n"""
if old not in s:
    raise SystemExit('renderDailyContextCard empty state not found')
s = s.replace(old, new, 1)

old = """  function renderDailyContext(analyses = []) {\n    if (!analyses.length) return '';\n    const rows = alignedDailyContextRows(analyses).map((row) => {\n      const label = fundraiserDayLabel(row.offset);\n      const cards = row.days.map((day, index) => renderDailyContextCard(day, analyses[index])).join('');\n      return `<div class=\"fc-day-match-row\"><div class=\"fc-day-match-label\"><strong>${escapeHtml(label.title)}</strong><span>${escapeHtml(label.detail)}</span></div><div class=\"fc-day-match-grid\" style=\"grid-template-columns:repeat(${analyses.length},minmax(260px,1fr))\">${cards}</div></div>`;\n    }).join('');\n    return `<section class=\"fc-panel fc-day-context\"><div class=\"fc-panel-head\"><div><h3>Weather, income and programming by corresponding fundraiser day</h3><span>Days are aligned to the first Saturday of each fundraiser: first Saturday with first Saturday, first Sunday with first Sunday, and so on. A Friday immediately before the first Saturday is Day -1.</span></div></div>${rows || '<div class=\"fc-chart-empty\">No scheduled fundraiser days.</div>'}<div class=\"fc-weather-source\">WNMU dayparts: Morning 7:00–11:30 AM · Afternoon 12:00–4:30 PM · Early evening 5:00–7:30 PM · Prime 8:00–10:00 PM · Overnight 10:30 PM–6:30 AM. Historical weather: Open-Meteo five-location U.P. composite.</div></section>`;\n  }\n"""
new = """  function dailyContextAnalyses(analyses = []) {\n    return (analyses || []).filter((analysis) => calendarDays(analysis).length > 0);\n  }\n\n  function renderDailyContext(analyses = []) {\n    const comparableAnalyses = dailyContextAnalyses(analyses);\n    if (comparableAnalyses.length < 2) return '';\n    const rows = alignedDailyContextRows(comparableAnalyses).map((row) => {\n      const label = fundraiserDayLabel(row.offset);\n      const cards = row.days.map((day, index) => renderDailyContextCard(day, comparableAnalyses[index])).join('');\n      return `<div class=\"fc-day-match-row\"><div class=\"fc-day-match-label\"><strong>${escapeHtml(label.title)}</strong><span>${escapeHtml(label.detail)}</span></div><div class=\"fc-day-match-grid\" style=\"grid-template-columns:repeat(${comparableAnalyses.length},minmax(260px,1fr))\">${cards}</div></div>`;\n    }).join('');\n    return `<section class=\"fc-panel fc-day-context\"><div class=\"fc-panel-head\"><div><h3>Weather, income and programming by corresponding fundraiser day</h3><span>Days are aligned to the first Saturday of each fundraiser: first Saturday with first Saturday, first Sunday with first Sunday, and so on. A Friday immediately before the first Saturday is Day -1. Selected fundraisers with no scheduled pledge programming are omitted until there is a day to compare.</span></div></div>${rows}<div class=\"fc-weather-source\">WNMU dayparts: Morning 7:00–11:30 AM · Afternoon 12:00–4:30 PM · Early evening 5:00–7:30 PM · Prime 8:00–10:00 PM · Overnight 10:30 PM–6:30 AM. Weather source: Open-Meteo five-location U.P. composite.</div></section>`;\n  }\n"""
if old not in s:
    raise SystemExit('renderDailyContext block not found')
s = s.replace(old, new, 1)

old = """    if (analyses.length >= 2) void ensureWeatherForAnalyses(analyses);\n"""
new = """    const weatherAnalyses = dailyContextAnalyses(analyses);\n    if (weatherAnalyses.length >= 2) void ensureWeatherForAnalyses(weatherAnalyses);\n"""
if old not in s:
    raise SystemExit('weather ensure call not found')
s = s.replace(old, new, 1)
path.write_text(s)

test_path = Path('tests/fundraiser-comparison.test.mjs')
t = test_path.read_text()
old_export = 'globalThis.__comparisonTestHooks = { daypartLabel, overallRevenueDecomposition, comparisonChannelPolicy, comparableTotalForPolicy, topicRevenueDecomposition, subtopicRevenueDecomposition, placementResult, alignedDailyContextRows, fundraiserDayOffset, fundraiserDayLabel };'
new_export = 'globalThis.__comparisonTestHooks = { daypartLabel, overallRevenueDecomposition, comparisonChannelPolicy, comparableTotalForPolicy, topicRevenueDecomposition, subtopicRevenueDecomposition, placementResult, alignedDailyContextRows, fundraiserDayOffset, fundraiserDayLabel, dailyContextAnalyses, weatherDateIsFetchable };'
if old_export not in t:
    raise SystemExit('comparison test export marker not found')
t = t.replace(old_export, new_export, 1)
t += r'''

test('daily context omits selected fundraisers with no scheduled pledge programming', () => {
  const empty = { schedule: { startDate: '2027-08-07' }, placementRows: [] };
  const one = { schedule: { startDate: '2026-08-08' }, placementRows: [{ dateKey: '2026-08-08', startMinutes: 420, title: 'A', topic: 'Test', secondary: 'Unspecified', daypart: 'Morning', minutes: 60, known: true, dollars: 100, pledges: 1 }] };
  const two = { schedule: { startDate: '2025-08-09' }, placementRows: [{ dateKey: '2025-08-09', startMinutes: 420, title: 'B', topic: 'Test', secondary: 'Unspecified', daypart: 'Morning', minutes: 60, known: true, dollars: 100, pledges: 1 }] };
  const filtered = hooks.dailyContextAnalyses([empty, one, two]);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0], one);
  assert.equal(filtered[1], two);
});

test('weather fetchability treats far-future fundraiser dates as not available yet', () => {
  const now = new Date(2026, 7, 21);
  assert.equal(hooks.weatherDateIsFetchable('2026-08-30', now), true);
  assert.equal(hooks.weatherDateIsFetchable('2027-03-13', now), false);
  assert.equal(hooks.weatherDateIsFetchable('2025-08-09', now), true);
});
'''
test_path.write_text(t)

version_path = Path('version.json')
version = json.loads(version_path.read_text())
version['appVersion'] = '0.22.91'
version['releasedAt'] = '2026-08-21'
version_path.write_text(json.dumps(version, separators=(',', ':')) + '\n')

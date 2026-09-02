from pathlib import Path
import json

ROOT = Path('.')
ANALYSIS = ROOT / 'assets/js/one-sheet-analysis.js'
REPORTS = ROOT / 'assets/js/one-sheet-reports.js'
REPORT_CSS = ROOT / 'assets/one-sheet-reports.css'
LIST = ROOT / 'assets/js/ui-list.js'
HTML = ROOT / 'reports.html'
VERSION = ROOT / 'version.json'


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing target: {label}')
    return text.replace(old, new, 1)

# ---------- analysis dimensions ----------
text = ANALYSIS.read_text()
text = replace_once(text,
"""  function weekpartLabel(dateValue) {\n    const date = parseDate(dateValue);\n    if (!date) return 'Unknown';\n    if (date.getDay() === 6) return 'Saturday';\n    if (date.getDay() === 0) return 'Sunday';\n    return 'Weekday';\n  }\n""",
"""  function weekdayLabel(dateValue) {\n    const date = parseDate(dateValue);\n    if (!date) return 'Unknown';\n    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()] || 'Unknown';\n  }\n\n  function weekpartLabel(dateValue) {\n    const weekday = weekdayLabel(dateValue);\n    if (weekday === 'Saturday') return 'Saturday';\n    if (weekday === 'Sunday') return 'Sunday';\n    return weekday === 'Unknown' ? 'Unknown' : 'Weekday';\n  }\n""", 'weekday helper')

text = replace_once(text,
"""          season: canonicalCategory(analysis.schedule?.season || seasonForDate(row.dateKey), 'Special events'),\n          weekpart: weekpartLabel(row.dateKey),\n          startBucket: Number.isFinite(Number(row.startMinutes))\n""",
"""          season: canonicalCategory(analysis.schedule?.season || seasonForDate(row.dateKey), 'Special events'),\n          weekday: weekdayLabel(row.dateKey),\n          weekpart: weekpartLabel(row.dateKey),\n          startBucket: Number.isFinite(Number(row.startMinutes))\n""", 'historical rows weekday')

text = replace_once(text,
"""      case 'startTime': return Number.isFinite(row.startBucket) ? String(row.startBucket) : '';\n      case 'weekpart': return row.weekpart || 'Unknown';\n      case 'daypart': return row.daypart || 'Unknown';\n""",
"""      case 'startTime': return Number.isFinite(row.startBucket) ? String(row.startBucket) : '';\n      case 'weekday': return row.weekday || 'Unknown';\n      case 'weekdayStartTime': return row.weekday && Number.isFinite(row.startBucket) ? `${row.weekday}|${row.startBucket}` : '';\n      case 'weekpart': return row.weekpart || 'Unknown';\n      case 'daypart': return row.daypart || 'Unknown';\n""", 'historical dimension values')

text = replace_once(text,
"""          fundraiserTitle,\n          season: canonicalCategory(analysis?.schedule?.season || seasonForDate(row?.dateKey), 'Special events'),\n          weekpart: weekpartLabel(row?.dateKey),\n          startBucket: Number.isFinite(Number(row?.startMinutes))\n""",
"""          fundraiserTitle,\n          season: canonicalCategory(analysis?.schedule?.season || seasonForDate(row?.dateKey), 'Special events'),\n          weekday: weekdayLabel(row?.dateKey),\n          weekpart: weekpartLabel(row?.dateKey),\n          startBucket: Number.isFinite(Number(row?.startMinutes))\n""", 'historical ranking weekday')

text = replace_once(text,
"""    const defaultMinimums = dimension === 'startTime'\n      ? { minAirings: 5, minFundraisers: 3, minTitles: 3 }\n      : { minAirings: 3, minFundraisers: 2, minTitles: 1 };\n""",
"""    const defaultMinimums = dimension === 'startTime' || dimension === 'weekdayStartTime'\n      ? { minAirings: 5, minFundraisers: 3, minTitles: 3 }\n      : { minAirings: 3, minFundraisers: 2, minTitles: 1 };\n""", 'weekday start threshold')

text = replace_once(text,
"""    weekpartForDate,\n""" if False else """    calendarDays,\n    firstSaturdayAnchor,\n""",
"""    calendarDays,\n    weekdayLabel,\n    firstSaturdayAnchor,\n""", 'export weekday label')
ANALYSIS.write_text(text)

# ---------- report charts/tooltips/day analytics ----------
text = REPORTS.read_text()

text = replace_once(text,
'''        return `<rect x="${x.toFixed(1)}" y="${ypos.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="none" stroke="${style.stroke}" stroke-width="${Math.max(2, style.width - 1)}"><title>${escapeHtml(title)}</title></rect>`;''',
'''        return `<rect x="${x.toFixed(1)}" y="${ypos.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${style.stroke}" stroke="${style.stroke}" stroke-width="${Math.max(2, style.width - 1)}"><title>${escapeHtml(title)}</title></rect>`;''', 'filled bars')

old = """  function chartTooltipElement() {\n    let tooltip = document.getElementById('chart-hover-tooltip');\n    if (tooltip) return tooltip;\n    tooltip = document.createElement('div');\n    tooltip.id = 'chart-hover-tooltip';\n    tooltip.className = 'chart-hover-tooltip hidden';\n    tooltip.setAttribute('role', 'status');\n    document.body.appendChild(tooltip);\n    return tooltip;\n  }\n"""
new = """  let chartTooltipHideTimer = null;\n\n  function cancelChartTooltipHide() {\n    if (chartTooltipHideTimer) clearTimeout(chartTooltipHideTimer);\n    chartTooltipHideTimer = null;\n  }\n\n  function chartTooltipElement() {\n    let tooltip = document.getElementById('chart-hover-tooltip');\n    if (tooltip) return tooltip;\n    tooltip = document.createElement('div');\n    tooltip.id = 'chart-hover-tooltip';\n    tooltip.className = 'chart-hover-tooltip hidden';\n    tooltip.setAttribute('role', 'status');\n    tooltip.addEventListener('mouseenter', cancelChartTooltipHide);\n    tooltip.addEventListener('mouseleave', () => hideChartTooltip(true));\n    document.body.appendChild(tooltip);\n    return tooltip;\n  }\n"""
text = replace_once(text, old, new, 'tooltip hover persistence')

old = """    const renderSection = (section = {}) => {\n      const lines = Array.isArray(section.lines) ? section.lines.filter(Boolean) : [];\n      return `<div class=\"chart-tooltip-section\"><strong>${escapeHtml(section.title || '')}</strong>${section.detail ? `<span>${escapeHtml(section.detail)}</span>` : ''}${lines.length ? `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '<em>No program titles recorded for this day.</em>'}</div>`;\n    };\n"""
new = """    cancelChartTooltipHide();\n    const renderSection = (section = {}) => {\n      const lines = Array.isArray(section.lines) ? section.lines.filter(Boolean) : [];\n      if (!lines.length) return `<div class=\"chart-tooltip-section\"><strong>${escapeHtml(section.title || '')}</strong>${section.detail ? `<span>${escapeHtml(section.detail)}</span>` : ''}<em>No program titles recorded for this point.</em></div>`;\n      const shouldCollapse = lines.length >= 20;\n      const firstLines = shouldCollapse ? lines.slice(0, 10) : lines;\n      const extraLines = shouldCollapse ? lines.slice(10) : [];\n      const firstMarkup = `<ul>${firstLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;\n      const moreMarkup = extraLines.length ? `<details class=\"chart-tooltip-more\"><summary>Show all ${escapeHtml(count(lines.length))} programs</summary><ul>${extraLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul></details>` : '';\n      return `<div class=\"chart-tooltip-section\"><strong>${escapeHtml(section.title || '')}</strong>${section.detail ? `<span>${escapeHtml(section.detail)}</span>` : ''}${firstMarkup}${moreMarkup}</div>`;\n    };\n"""
text = replace_once(text, old, new, 'tooltip truncation')

text = replace_once(text,
"""  function hideChartTooltip() {\n    document.getElementById('chart-hover-tooltip')?.classList.add('hidden');\n  }\n""",
"""  function hideChartTooltip(immediate = false) {\n    cancelChartTooltipHide();\n    const hide = () => document.getElementById('chart-hover-tooltip')?.classList.add('hidden');\n    if (immediate) hide();\n    else chartTooltipHideTimer = setTimeout(hide, 180);\n  }\n""", 'tooltip delayed hide')

text = replace_once(text,
"""      node.addEventListener('mouseenter', (event) => showChartTooltip(node, event.clientX, event.clientY));\n      node.addEventListener('mousemove', (event) => positionChartTooltip(chartTooltipElement(), event.clientX, event.clientY));\n      node.addEventListener('mouseleave', hideChartTooltip);\n""",
"""      node.addEventListener('mouseenter', (event) => showChartTooltip(node, event.clientX, event.clientY));\n      node.addEventListener('mousemove', (event) => positionChartTooltip(chartTooltipElement(), event.clientX, event.clientY));\n      node.addEventListener('mouseleave', () => hideChartTooltip(false));\n""", 'tooltip node leave')
text = replace_once(text, "      node.addEventListener('blur', hideChartTooltip);\n", "      node.addEventListener('blur', () => hideChartTooltip(false));\n", 'tooltip blur')

# Add historical tooltip helpers just before correspondingDaySeries.
needle = """  function correspondingDaySeries(analyses = []) {\n"""
insert = """  function programTooltipLinesForRows(rows = []) {\n    const groups = new Map();\n    (rows || []).forEach((row) => {\n      if (row?.countsTowardScheduleMinutes === false || row?.unmatchedImported) return;\n      const title = A.text(row?.title || row?.plannedTitle || '');\n      if (!title || isNonSpecificLabel(title)) return;\n      const key = A.lookupKey(title);\n      if (!groups.has(key)) groups.set(key, { title, dollars: 0, known: false, airings: 0 });\n      const item = groups.get(key);\n      item.airings += 1;\n      if (row?.known) {\n        item.known = true;\n        item.dollars += Number(row?.dollars || 0);\n      }\n    });\n    return [...groups.values()]\n      .sort((a, b) => b.dollars - a.dollars || a.title.localeCompare(b.title))\n      .map((item) => `${item.title}${item.airings > 1 ? ` (${item.airings} airings)` : ''}${item.known ? ` — ${money(item.dollars)}` : ' — result unavailable'}`);\n  }\n\n  function fundraiserTooltip(analysis, detail = '') {\n    return {\n      title: analysisTrendLabel(analysis),\n      detail: detail || `${formatDate(analysis?.schedule?.startDate)}–${formatDate(analysis?.schedule?.endDate)}`,\n      lines: programTooltipLinesForRows(analysis?.placementRows || [])\n    };\n  }\n\n  function correspondingDaySeries(analyses = []) {\n"""
text = replace_once(text, needle, insert, 'historical tooltip helpers')

old = """  function correspondingDaySeries(analyses = []) {\n    const aligned = A.alignedDailyRows(analyses);\n    return {\n      labels: aligned.map((entry) => entry.label.title),\n      values: aligned.map((entry) => {\n        const values = (entry.days || []).filter(Boolean).map((day) => Number(day.dollarsPerHour)).filter(Number.isFinite);\n        return values.length ? medianNumber(values) : null;\n      })\n    };\n  }\n"""
new = """  function correspondingDaySeries(analyses = []) {\n    const aligned = A.alignedDailyRows(analyses);\n    return {\n      labels: aligned.map((entry) => entry.label.title),\n      values: aligned.map((entry) => {\n        const values = (entry.days || []).filter((day) => day && Number(day.rateMinutes || 0) > 0).map((day) => Number(day.dollarsPerHour)).filter(Number.isFinite);\n        return values.length ? medianNumber(values) : null;\n      }),\n      tooltips: aligned.map((entry) => {\n        const participating = [];\n        (entry.days || []).forEach((day, index) => {\n          if (!day || !(Number(day.rateMinutes || 0) > 0)) return;\n          const analysis = analyses[index];\n          const rows = (analysis?.placementRows || []).filter((row) => A.text(row?.dateKey) === A.text(day.dateKey || A.dateKey?.(day.date)));\n          participating.push({ analysis, day, rows });\n        });\n        if (!participating.length) return null;\n        const programLines = participating.flatMap((item) => programTooltipLinesForRows(item.rows).map((line) => `${analysisTrendLabel(item.analysis)}: ${line}`));\n        return {\n          title: entry.label.title,\n          detail: `${participating.length} of ${analyses.length} selected fundraisers had rate-valid pledge programming on this corresponding day.`,\n          lines: programLines\n        };\n      })\n    };\n  }\n"""
text = replace_once(text, old, new, 'corresponding gap evidence')

old = """      const data = correspondingDaySeries(band.analyses);\n      const byLabel = new Map(data.labels.map((label, index) => [label, data.values[index]]));\n      return { label: band.label, values: labels.map((label) => byLabel.has(label) ? byLabel.get(label) : null) };\n    });\n    series.push({ label: 'All selected years', values: combined.values, style: { stroke: '#667781', dash: '5 5', width: 1.5 } });\n"""
new = """      const data = correspondingDaySeries(band.analyses);\n      const byLabel = new Map(data.labels.map((label, index) => [label, { value: data.values[index], tooltip: data.tooltips[index] }]));\n      return {\n        label: band.label,\n        values: labels.map((label) => byLabel.has(label) ? byLabel.get(label).value : null),\n        tooltips: labels.map((label) => byLabel.has(label) ? byLabel.get(label).tooltip : null)\n      };\n    });\n    series.push({ label: 'All selected years', values: combined.values, tooltips: combined.tooltips, style: { stroke: '#667781', dash: '5 5', width: 1.5 } });\n"""
text = replace_once(text, old, new, 'corresponding band tooltips')

old = """      current: combined.map((entry) => entry.days?.[0] ? Number(entry.days[0].dollarsPerHour) : null),\n      historical: combined.map((entry) => {\n        const values = (entry.days || []).slice(1).filter(Boolean).map((day) => Number(day.dollarsPerHour)).filter(Number.isFinite);\n        return values.length ? medianNumber(values) : null;\n      })\n"""
new = """      current: combined.map((entry) => entry.days?.[0] && Number(entry.days[0].rateMinutes || 0) > 0 ? Number(entry.days[0].dollarsPerHour) : null),\n      historical: combined.map((entry) => {\n        const values = (entry.days || []).slice(1).filter((day) => day && Number(day.rateMinutes || 0) > 0).map((day) => Number(day.dollarsPerHour)).filter(Number.isFinite);\n        return values.length ? medianNumber(values) : null;\n      })\n"""
text = replace_once(text, old, new, 'current corresponding gap evidence')

text = replace_once(text,
"""      values: ordered.map((analysis) => Number(metric(analysis) || 0))\n""",
"""      values: ordered.map((analysis) => Number(metric(analysis) || 0)),\n      tooltips: ordered.map((analysis) => fundraiserTooltip(analysis))\n""", 'trend tooltips')

# Replace season trend function with tooltip-aware version.
old = """  function historicalSeasonTrendData(analyses = []) {\n    const ordered = chronologicalAnalyses(analyses);\n    const years = [...new Set(ordered.map((analysis) => Number(analysis.schedule?.year || 0)).filter(Boolean))].sort((a, b) => a - b);\n    const seasons = HISTORICAL_SEASONS.filter((season) => ordered.some((analysis) => historicalSeasonBucket(analysis) === season));\n    return {\n      labels: years.map(String),\n      series: seasons.map((season) => ({\n        label: season,\n        values: years.map((year) => {\n          const values = ordered.filter((analysis) => Number(analysis.schedule?.year || 0) === year && historicalSeasonBucket(analysis) === season).map(rateForAnalysis).filter((value) => Number.isFinite(Number(value)));\n          return values.length ? medianNumber(values) : null;\n        })\n      }))\n    };\n  }\n"""
new = """  function historicalSeasonTrendData(analyses = []) {\n    const ordered = chronologicalAnalyses(analyses);\n    const years = [...new Set(ordered.map((analysis) => Number(analysis.schedule?.year || 0)).filter(Boolean))].sort((a, b) => a - b);\n    const seasons = HISTORICAL_SEASONS.filter((season) => ordered.some((analysis) => historicalSeasonBucket(analysis) === season));\n    return {\n      labels: years.map(String),\n      series: seasons.map((season) => ({\n        label: season,\n        values: years.map((year) => {\n          const matches = ordered.filter((analysis) => Number(analysis.schedule?.year || 0) === year && historicalSeasonBucket(analysis) === season);\n          const values = matches.map(rateForAnalysis).filter((value) => Number.isFinite(Number(value)));\n          return values.length ? medianNumber(values) : null;\n        }),\n        tooltips: years.map((year) => {\n          const matches = ordered.filter((analysis) => Number(analysis.schedule?.year || 0) === year && historicalSeasonBucket(analysis) === season);\n          if (!matches.length) return null;\n          return {\n            title: `${season} ${year}`,\n            detail: `${matches.length} fundraiser${matches.length === 1 ? '' : 's'} in this season/year point.`,\n            lines: matches.flatMap((analysis) => programTooltipLinesForRows(analysis?.placementRows || []).map((line) => `${analysis.schedule?.title || analysisTrendLabel(analysis)}: ${line}`))\n          };\n        })\n      }))\n    };\n  }\n"""
text = replace_once(text, old, new, 'season tooltips')

# Day of week helpers and weekday-start-time historical card/table.
needle = """  function rankingBarCard(analyses, dimension, title, description, options = {}, limit = 10) {\n"""
insert = """  const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];\n\n  function dayOfWeekRankingRows(analyses = []) {\n    const byKey = new Map(rankingRows(analyses, 'weekday').map((row) => [row.key, row]));\n    return WEEKDAY_ORDER.map((day) => byKey.get(day)).filter(Boolean);\n  }\n\n  function dayOfWeekPerformanceCard(analyses = []) {\n    const rows = dayOfWeekRankingRows(analyses);\n    return chartCard('Day-of-week performance', 'Monday through Sunday are separated so an underused Friday cannot be mistaken for a poor Friday. The detailed table below shows rate airings, fundraisers, and titles.', barChartSvg({\n      labels: rows.map((row) => row.key),\n      series: [{ label: 'Historical median', values: rows.map((row) => Number(row.medianDollarsPerHour || 0)) }],\n      ariaLabel: 'Historical fundraiser performance by day of week',\n      className: 'historical-weekday-overview',\n      ...rateChartOptions()\n    }));\n  }\n\n  function dayOfWeekStartTimeTable(analyses = []) {\n    return historicalRankingTable(\n      analyses,\n      'weekdayStartTime',\n      'Day-of-week × start-time performance',\n      'Specific weekday/start-time combinations use the same 5-airing / 3-fundraiser / 3-title evidence rule as the start-time rankings. This is the scheduling view for questions such as Friday at 8:00 PM.'\n    );\n  }\n\n  function rankingBarCard(analyses, dimension, title, description, options = {}, limit = 10) {\n"""
text = replace_once(text, needle, insert, 'day of week report helpers')

# Historical key labels for combined key.
text = replace_once(text,
"""  function historicalKeyLabel(dimension, key) {\n    if (dimension === 'startTime') return formatTime(Number(key));\n    return String(key || 'Unknown');\n  }\n""",
"""  function historicalKeyLabel(dimension, key) {\n    if (dimension === 'startTime') return formatTime(Number(key));\n    if (dimension === 'weekdayStartTime') {\n      const [weekday, minutes] = String(key || '').split('|');\n      return `${weekday || 'Unknown'} · ${formatTime(Number(minutes))}`;\n    }\n    return String(key || 'Unknown');\n  }\n""", 'weekday start label')

# Start-time card with tooltips per slot/daytype.
old = """          const byKey = new Map(rows.map((row) => [Number(row.key), Number(row.medianDollarsPerHour || 0)]));\n          return { label, values: keys.map((key) => byKey.has(key) ? byKey.get(key) : null) };\n"""
new = """          const byKey = new Map(rows.map((row) => [Number(row.key), Number(row.medianDollarsPerHour || 0)]));\n          const relevant = label === 'Weekday' ? analysesForWeekpart(analyses, 'Weekday') : analysesForWeekpart(analyses, label);\n          return {\n            label,\n            values: keys.map((key) => byKey.has(key) ? byKey.get(key) : null),\n            tooltips: keys.map((key) => {\n              if (!byKey.has(key)) return null;\n              const matchingRows = relevant.flatMap((analysis) => (analysis.placementRows || []).filter((row) => {\n                if (!Number.isFinite(Number(row.startMinutes))) return false;\n                const bucket = Math.floor(((((Number(row.startMinutes) % 1440) + 1440) % 1440) / 30)) * 30;\n                return bucket === key;\n              }));\n              return { title: `${label} · ${formatTime(key)}`, detail: `${matchingRows.length} schedule-reconciled airing${matchingRows.length === 1 ? '' : 's'} in the selected history.`, lines: programTooltipLinesForRows(matchingRows) };\n            })\n          };\n"""
text = replace_once(text, old, new, 'start-time tooltips')

# Add tooltips to top historical trend series and day-of-week card.
text = replace_once(text,
"series: [{ label: 'Broadcast $ / pledge hour', values: productivity.values }],",
"series: [{ label: 'Broadcast $ / pledge hour', values: productivity.values, tooltips: productivity.tooltips }],", 'productivity tooltips')
text = replace_once(text,
"series: [{ label: '$ / pledge', values: gifts.values }],",
"series: [{ label: '$ / pledge', values: gifts.values, tooltips: gifts.tooltips }],", 'gift tooltips')
text = replace_once(text,
"""      rankingBarCard(analyses, 'daypart', 'Daypart performance', 'Historical median performance by morning, afternoon, early evening, prime, and overnight.'),\n      rankingBarCard(analyses, 'weekpart', 'Weekday / Saturday / Sunday', 'Historical median performance by day type.'),\n""",
"""      rankingBarCard(analyses, 'daypart', 'Daypart performance', 'Historical median performance by morning, afternoon, early evening, prime, and overnight.'),\n      dayOfWeekPerformanceCard(analyses),\n      rankingBarCard(analyses, 'weekpart', 'Weekday / Saturday / Sunday', 'Broader operational comparison retained alongside the more specific Monday-through-Sunday view.'),\n""", 'day of week visual')

# Detailed tables.
text = replace_once(text,
"""      historicalStartTimeTables(analyses),\n      historicalRankingTable(analyses, 'weekpart', 'Weekday / Saturday / Sunday', 'Each fundraiser contributes one aggregated weekday, Saturday, or Sunday $/pledge-hour observation.'),\n""",
"""      historicalStartTimeTables(analyses),\n      historicalRankingTable(analyses, 'weekday', 'Day-of-week performance', 'Monday through Sunday are analyzed separately. Rate airings and fundraiser counts show whether a low median reflects actual performance or simply sparse use of that day.'),\n      dayOfWeekStartTimeTable(analyses),\n      historicalRankingTable(analyses, 'weekpart', 'Weekday / Saturday / Sunday', 'Each fundraiser contributes one aggregated weekday, Saturday, or Sunday $/pledge-hour observation.'),\n""", 'day of week tables')

# Bind tooltips in Historical report.
text = replace_once(text,
"""    $('#report-output').innerHTML = `<article class=\"one-sheet historical-sheet\">${historicalHeader(analyses)}${durationNoticeSection(analyses)}${historicalReportBody(analyses)}<footer class=\"sheet-footer\">Historical rankings use fundraiser-balanced median Broadcast $/hour: each fundraiser contributes at most one rate observation to each category or start-time slot, regardless of how many individual programs it aired there. A category is omitted for a fundraiser if any of its scheduled rows in that category has an unknown result or missing duration. Non-Specific Pledges are not treated as incomplete program/topic data. Start-time rankings are evaluated separately for Weekdays, Saturdays, and Sundays; each requires 5 rate-valid airings across 3 rate-valid fundraisers and 3 distinct rate-valid titles. Imported results that cannot be reconciled to a saved schedule placement remain in fundraiser totals but are excluded from historical performance rankings.</footer></article>`;\n""",
"""    $('#report-output').innerHTML = `<article class=\"one-sheet historical-sheet\">${historicalHeader(analyses)}${durationNoticeSection(analyses)}${historicalReportBody(analyses)}<footer class=\"sheet-footer\">Historical rankings use fundraiser-balanced median Broadcast $/hour: each fundraiser contributes at most one rate observation to each category or start-time slot, regardless of how many individual programs it aired there. A category is omitted for a fundraiser if any of its scheduled rows in that category has an unknown result or missing duration. Non-Specific Pledges are not treated as incomplete program/topic data. Start-time rankings are evaluated separately for Weekdays, Saturdays, and Sundays; each requires 5 rate-valid airings across 3 rate-valid fundraisers and 3 distinct rate-valid titles. Imported results that cannot be reconciled to a saved schedule placement remain in fundraiser totals but are excluded from historical performance rankings.</footer></article>`;\n    bindChartTooltips($('#report-output'));\n""", 'historical tooltip binding')
REPORTS.write_text(text)

# ---------- report tooltip CSS ----------
css = REPORT_CSS.read_text()
css = replace_once(css,
".chart-hover-tooltip{position:fixed;z-index:2500;pointer-events:none;width:max-content;max-width:min(380px,calc(100vw - 24px));padding:9px 11px;border-radius:8px;background:#17384a;color:#fff;box-shadow:0 8px 24px rgb(0 0 0 / 28%);font-size:.86rem;line-height:1.3}",
".chart-hover-tooltip{position:fixed;z-index:2500;pointer-events:auto;width:max-content;max-width:min(460px,calc(100vw - 24px));max-height:min(72vh,620px);overflow:auto;padding:9px 11px;border-radius:8px;background:#17384a;color:#fff;box-shadow:0 8px 24px rgb(0 0 0 / 28%);font-size:.86rem;line-height:1.3}", 'interactive tooltip css')
css = replace_once(css,
".chart-hover-tooltip em{display:block;margin-top:5px;color:#dbe8ee}",
".chart-hover-tooltip em{display:block;margin-top:5px;color:#dbe8ee}.chart-tooltip-more{margin-top:5px}.chart-tooltip-more summary{cursor:pointer;color:#fff;font-weight:850;text-decoration:underline;text-underline-offset:2px}.chart-tooltip-more ul{margin-top:5px}", 'tooltip details css')
REPORT_CSS.write_text(css)

# ---------- Program Library missing distributor sentinel ----------
text = LIST.read_text()
text = replace_once(text,
"""  const filters = App.programFilters;\n  const { els, renderSelectOptions, setNotice } = App.dom;\n""",
"""  const filters = App.programFilters;\n  const { els, renderSelectOptions, setNotice } = App.dom;\n  const MISSING_DISTRIBUTOR_FILTER = '__missing_distributor__';\n""", 'missing distributor sentinel')
text = replace_once(text,
"""    if (except !== 'distributor' && state.distributorFilter && !sameLookupValue(derive.distributor(row), state.distributorFilter)) return false;\n""",
"""    if (except !== 'distributor' && state.distributorFilter) {\n      const distributor = utils.normalizeText(derive.distributor(row));\n      if (state.distributorFilter === MISSING_DISTRIBUTOR_FILTER) {\n        if (distributor) return false;\n      } else if (!sameLookupValue(distributor, state.distributorFilter)) return false;\n    }\n""", 'missing distributor filter logic')
text = replace_once(text,
"""    state.distributorOptions = ensureCurrentOption(filters.canonicalOptionEntries(distributorRows.map((row) => derive.distributor(row)).filter(Boolean)), state.distributorFilter);\n""",
"""    const namedDistributorOptions = filters.canonicalOptionEntries(distributorRows.map((row) => derive.distributor(row)).filter(Boolean));\n    const missingDistributorOption = distributorRows.some((row) => !utils.normalizeText(derive.distributor(row)))\n      ? [{ value: MISSING_DISTRIBUTOR_FILTER, label: 'Missing Distributor' }]\n      : [];\n    state.distributorOptions = state.distributorFilter === MISSING_DISTRIBUTOR_FILTER\n      ? [...missingDistributorOption, ...namedDistributorOptions]\n      : ensureCurrentOption([...missingDistributorOption, ...namedDistributorOptions], state.distributorFilter);\n""", 'missing distributor option')
text = text.replace("if (state.distributorFilter) filters.push(`distributor: ${state.distributorFilter}`);", "if (state.distributorFilter) filters.push(`distributor: ${state.distributorFilter === MISSING_DISTRIBUTOR_FILTER ? 'Missing Distributor' : state.distributorFilter}`);")
text = text.replace("if (state.distributorFilter) parts.push(`distributor: ${state.distributorFilter}`);", "if (state.distributorFilter) parts.push(`distributor: ${state.distributorFilter === MISSING_DISTRIBUTOR_FILTER ? 'Missing Distributor' : state.distributorFilter}`);")
LIST.write_text(text)

# ---------- version/cache refs ----------
html = HTML.read_text().replace('0.22.132', '0.22.133')
HTML.write_text(html)
VERSION.write_text(json.dumps({'appVersion': '0.22.133', 'releasedAt': '2026-09-02'}, separators=(',', ':')) + '\n')

for test_path in ROOT.glob('tests/*.test.mjs'):
    body = test_path.read_text()
    if '0.22.132' in body:
        test_path.write_text(body.replace('0.22.132', '0.22.133'))

# ---------- regression tests ----------
(ROOT / 'tests/historical-weekday-tooltips-library-v133.test.mjs').write_text("""import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport { createRequire } from 'node:module';\n\nconst require = createRequire(import.meta.url);\nconst A = require('../assets/js/one-sheet-analysis.js');\nconst reports = fs.readFileSync('assets/js/one-sheet-reports.js', 'utf8');\nconst css = fs.readFileSync('assets/one-sheet-reports.css', 'utf8');\nconst list = fs.readFileSync('assets/js/ui-list.js', 'utf8');\nconst html = fs.readFileSync('reports.html', 'utf8');\nconst version = JSON.parse(fs.readFileSync('version.json', 'utf8'));\n\ntest('v0.22.133 adds day-of-week and weekday/start-time historical dimensions', () => {\n  const makeAnalysis = (id, date, startMinutes, dollars, title) => ({\n    schedule: { id, title: id, season: 'June' },\n    placementRows: [{ dateKey: date, startMinutes, minutes: 60, dollars, known: true, durationMissing: false, title, countsTowardScheduleMinutes: true }]\n  });\n  const analyses = [\n    makeAnalysis('f1', '2026-06-05', 1200, 100, 'Friday One'),\n    makeAnalysis('f2', '2025-06-06', 1200, 0, 'Friday Two'),\n    makeAnalysis('m1', '2026-06-08', 1200, 200, 'Monday One')\n  ];\n  const weekdays = A.historicalRanking(analyses, 'weekday', { minAirings: 1, minFundraisers: 1, minTitles: 1 });\n  const friday = weekdays.find((row) => row.key === 'Friday');\n  assert.ok(friday);\n  assert.equal(friday.fundraisers, 2);\n  assert.equal(friday.medianDollarsPerHour, 50);\n  const slots = A.historicalRanking(analyses, 'weekdayStartTime', { minAirings: 1, minFundraisers: 1, minTitles: 1 });\n  assert.ok(slots.some((row) => row.key === 'Friday|1200'));\n  assert.equal(A.weekdayLabel('2026-06-05'), 'Friday');\n});\n\ntest('corresponding-day rates distinguish no rate-valid pledge programming from a true zero', () => {\n  assert.match(reports, /Number\\(day\\.rateMinutes \\|\\| 0\\) > 0/);\n  assert.match(reports, /had rate-valid pledge programming on this corresponding day/);\n});\n\ntest('historical report exposes weekday scheduling evidence and rich program tooltips', () => {\n  assert.match(reports, /Day-of-week performance/);\n  assert.match(reports, /Day-of-week × start-time performance/);\n  assert.match(reports, /Show all \\${escapeHtml\\(count\\(lines\\.length\\)\\)} programs/);\n  assert.match(reports, /bindChartTooltips\\(\\$\\('#report-output'\\)\\)/);\n  assert.match(css, /pointer-events:auto/);\n  assert.match(css, /chart-tooltip-more/);\n});\n\ntest('generic report bars are solid filled using the series stroke color', () => {\n  assert.match(reports, /fill=\\"\\${style\\.stroke}\\" stroke=\\"\\${style\\.stroke}\\"/);\n  assert.doesNotMatch(reports, /fill=\\"none\\" stroke=\\"\\${style\\.stroke}\\"/);\n});\n\ntest('Program Library distributor dropdown includes a true missing-distributor choice', () => {\n  assert.match(list, /MISSING_DISTRIBUTOR_FILTER = '__missing_distributor__'/);\n  assert.match(list, /label: 'Missing Distributor'/);\n  assert.match(list, /if \\(distributor\\) return false/);\n  assert.match(list, /utils\\.normalizeText\\(derive\\.distributor\\(row\\)\\)/);\n});\n\ntest('v0.22.133 report assets and version stay synchronized', () => {\n  assert.equal(version.appVersion, '0.22.133');\n  assert.ok(html.includes('one-sheet-reports.css?v=0.22.133'));\n  assert.ok(html.includes('one-sheet-analysis.js?v=0.22.133'));\n  assert.ok(html.includes('one-sheet-reports.js?v=0.22.133'));\n});\n""")

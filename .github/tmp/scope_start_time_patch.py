from pathlib import Path

path = Path('.github/tmp/apply_in_app_analytics_hardening.py')
text = path.read_text()
old = '''replace_once(
    analytics,
    "        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],\\n        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]",
    "        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],\\n        ['Evidence', (row) => `${formatNumber(row.rateAirings || 0)} valid · ${formatNumber(row.fundraiserCount || 0)} drives · ${formatNumber(row.titleCount || 0)} titles`, '', (row) => row.rateAirings || 0],\\n        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]",
    'analytics start-time evidence column'
)
'''
new = '''value = read(analytics)
region_start = value.find("    startTimes: {")
region_end = value.find("    programs: {", region_start)
if region_start < 0 or region_end < 0:
    raise SystemExit('analytics start-time evidence column: startTimes question region not found')
region = value[region_start:region_end]
old_column = "        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],\\n        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]"
new_column = "        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],\\n        ['Evidence', (row) => `${formatNumber(row.rateAirings || 0)} valid · ${formatNumber(row.fundraiserCount || 0)} drives · ${formatNumber(row.titleCount || 0)} titles`, '', (row) => row.rateAirings || 0],\\n        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]"
if region.count(old_column) != 1:
    raise SystemExit(f'analytics start-time evidence column: expected one match in startTimes region, found {region.count(old_column)}')
region = region.replace(old_column, new_column, 1)
write(analytics, value[:region_start] + region + value[region_end:])
'''
if text.count(old) != 1:
    raise SystemExit(f'temporary patch script target count was {text.count(old)}, expected 1')
path.write_text(text.replace(old, new, 1))

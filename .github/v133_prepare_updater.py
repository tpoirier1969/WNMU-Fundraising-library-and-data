from pathlib import Path
import re

path = Path('.github/v133_weekday_tooltips_library.py')
text = path.read_text()

pattern = re.compile(r'''text = replace_once\(text,\n"""    weekpartForDate,.*?'export weekday label'\)\n''', re.S)
replacement = '''text = replace_once(text,\n"""    calendarDays,\\n    firstSaturdayAnchor,\\n""",\n"""    calendarDays,\\n    weekdayLabel,\\n    firstSaturdayAnchor,\\n""", 'export weekday label')\n'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'updater export patch target count={count}')

marker = "text = replace_once(text,\n\"\"\"    const defaultMinimums = dimension === 'startTime'"
idx = text.find(marker)
if idx < 0:
    raise SystemExit('default minimum marker not found')
normalize_patch = '''text = replace_once(text,\n"""        const normalized = dimension === 'startTime' ? key : lookupKey(key);\\n""",\n"""        const normalized = dimension === 'startTime' || dimension === 'weekdayStartTime' ? key : lookupKey(key);\\n""", 'weekday start normalize key')\n\n'''
text = text[:idx] + normalize_patch + text[idx:]

text = text.replace("A.text(day.dateKey || A.dateKey?.(day.date))", "A.text(day.dateKey)")
text = text.replace("new Map(rankingRows(analyses, 'weekday').map((row) => [row.key, row]))", "new Map(rankingRows(analyses, 'weekday').map((row) => [String(row.key || '').toLowerCase(), row]))")
text = text.replace("return WEEKDAY_ORDER.map((day) => byKey.get(day)).filter(Boolean);", "return WEEKDAY_ORDER.map((day) => byKey.get(day.toLowerCase())).filter(Boolean);")

text = text.replace('needle = """  function correspondingDaySeries(analyses = []) {\\n"""', 'needle = "  function correspondingDaySeries(analyses = []) {"')
text = text.replace('  function correspondingDaySeries(analyses = []) {\\n"""\ntext = replace_once(text, needle, insert, \'historical tooltip helpers\')', '  function correspondingDaySeries(analyses = []) {"""\ntext = replace_once(text, needle, insert, \'historical tooltip helpers\')')

block_pattern = re.compile(r'''old = """      current: combined\.map\(.*?text = replace_once\(text, old, new, 'current corresponding gap evidence'\)\n''', re.S)
block_replacement = '''text = replace_once(text,\n    "current: combined.map((entry) => entry.days?.[0] ? Number(entry.days[0].dollarsPerHour) : null)",\n    "current: combined.map((entry) => entry.days?.[0] && Number(entry.days[0].rateMinutes || 0) > 0 ? Number(entry.days[0].dollarsPerHour) : null)",\n    'current corresponding rate evidence')\ntext = replace_once(text,\n    ".slice(1).filter(Boolean).map((day) => Number(day.dollarsPerHour)).filter(Number.isFinite)",\n    ".slice(1).filter((day) => day && Number(day.rateMinutes || 0) > 0).map((day) => Number(day.dollarsPerHour)).filter(Number.isFinite)",\n    'historical corresponding rate evidence')\n'''
text, count = block_pattern.subn(block_replacement, text, count=1)
if count != 1:
    raise SystemExit(f'current corresponding updater block count={count}')

for label in ['trend tooltips', 'season tooltips', 'day of week report helpers']:
    tooltip_pattern = re.compile(rf'''(?:old = .*?\nnew = .*?\n|needle = .*?\ninsert = .*?\n)?text = replace_once\(text,.*?'{re.escape(label)}'\)\n''', re.S)
    text, count = tooltip_pattern.subn(f"# {label} applied by v133_post_updater.py\n", text, count=1)
    if count != 1:
        raise SystemExit(f'{label} updater block count={count}')

path.write_text(text)

from pathlib import Path
import re

path = Path('.github/v133_weekday_tooltips_library.py')
text = path.read_text()

# Replace the malformed export edit with the actual export neighborhood.
pattern = re.compile(r'''text = replace_once\(text,\n"""    weekpartForDate,.*?'export weekday label'\)\n''', re.S)
replacement = '''text = replace_once(text,\n"""    calendarDays,\\n    firstSaturdayAnchor,\\n""",\n"""    calendarDays,\\n    weekdayLabel,\\n    firstSaturdayAnchor,\\n""", 'export weekday label')\n'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'updater export patch target count={count}')

# historicalRanking normalizes inline rather than through a helper. Preserve weekday|time keys.
marker = "text = replace_once(text,\n\"\"\"    const defaultMinimums = dimension === 'startTime'"
idx = text.find(marker)
if idx < 0:
    raise SystemExit('default minimum marker not found')
normalize_patch = '''text = replace_once(text,\n"""        const normalized = dimension === 'startTime' ? key : lookupKey(key);\\n""",\n"""        const normalized = dimension === 'startTime' || dimension === 'weekdayStartTime' ? key : lookupKey(key);\\n""", 'weekday start normalize key')\n\n'''
text = text[:idx] + normalize_patch + text[idx:]

# calendarDays already exposes dateKey. Do not call an unexported date helper.
text = text.replace("A.text(day.dateKey || A.dateKey?.(day.date))", "A.text(day.dateKey)")

# Weekday ranking returns the original display key, so keep visual ordering case-insensitive.
text = text.replace("new Map(rankingRows(analyses, 'weekday').map((row) => [row.key, row]))", "new Map(rankingRows(analyses, 'weekday').map((row) => [String(row.key || '').toLowerCase(), row]))")
text = text.replace("return WEEKDAY_ORDER.map((day) => byKey.get(day)).filter(Boolean);", "return WEEKDAY_ORDER.map((day) => byKey.get(day.toLowerCase())).filter(Boolean);")

# Make the historical tooltip helper insertion match the signature alone.
text = text.replace('needle = """  function correspondingDaySeries(analyses = []) {\\n"""', 'needle = "  function correspondingDaySeries(analyses = []) {"')
# The inserted replacement must retain the newline before the body.
text = text.replace('  function correspondingDaySeries(analyses = []) {\\n"""\ntext = replace_once(text, needle, insert, \'historical tooltip helpers\')', '  function correspondingDaySeries(analyses = []) {\\n"""\ntext = replace_once(text, needle, insert, \'historical tooltip helpers\')')

path.write_text(text)

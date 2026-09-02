from pathlib import Path
import re

path = Path('.github/v133_weekday_tooltips_library.py')
text = path.read_text()

pattern = re.compile(r'''text = replace_once\(text,\n"""    weekpartForDate,.*?'export weekday label'\)\n''', re.S)
replacement = '''text = replace_once(text,\n"""    calendarDays,\\n    alignedDailyRows,\\n""",\n"""    calendarDays,\\n    weekdayLabel,\\n    alignedDailyRows,\\n""", 'export weekday label')\n'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'updater export patch target count={count}')

# Preserve weekday + time combined keys instead of normalizing punctuation away.
marker = "text = replace_once(text,\n\"\"\"    const defaultMinimums = dimension === 'startTime'"
idx = text.find(marker)
if idx < 0:
    raise SystemExit('default minimum marker not found')
normalize_patch = '''text = replace_once(text,\n"""  function historicalNormalizeKey(dimension, value) {\\n    if (dimension === 'startTime') return text(value);\\n    return lookupKey(value);\\n  }\\n""",\n"""  function historicalNormalizeKey(dimension, value) {\\n    if (dimension === 'startTime' || dimension === 'weekdayStartTime') return text(value);\\n    return lookupKey(value);\\n  }\\n""", 'weekday start normalize key')\n\n'''
text = text[:idx] + normalize_patch + text[idx:]

# calendarDays already exposes dateKey. Do not call an unexported date helper.
text = text.replace("A.text(day.dateKey || A.dateKey?.(day.date))", "A.text(day.dateKey)")

path.write_text(text)

from pathlib import Path

path = Path('.github/v133_weekday_tooltips_library.py')
text = path.read_text()
old = '''text = replace_once(text,
"""    weekpartForDate,\\n""" if False else """    calendarDays,\\n    firstSaturdayAnchor,\\n""",
"""    calendarDays,\\n    weekdayLabel,\\n    firstSaturdayAnchor,\\n""", 'export weekday label')'''
new = '''text = replace_once(text,
"""    calendarDays,\\n    firstSaturdayAnchor,\\n""",
"""    calendarDays,\\n    weekdayLabel,\\n    firstSaturdayAnchor,\\n""", 'export weekday label')'''
if old not in text:
    raise SystemExit('updater export patch target not found')
path.write_text(text.replace(old, new, 1))

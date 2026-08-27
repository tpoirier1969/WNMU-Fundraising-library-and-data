from pathlib import Path

path = Path('.github/tmp/postprocess_analytics_and_non_specific.py')
text = path.read_text()
old = 'nottest'
new = 'ottest'
if text.count(old) != 2:
    raise SystemExit(f'expected two postprocess typo markers, found {text.count(old)}')
path.write_text(text.replace(old, new))

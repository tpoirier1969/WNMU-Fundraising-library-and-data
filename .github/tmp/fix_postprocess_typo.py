from pathlib import Path

path = Path('.github/tmp/postprocess_analytics_and_non_specific.py')
text = path.read_text()
old = 'source = read(nottest)'
new = 'source = read(ottest)'
if text.count(old) != 1:
    raise SystemExit(f'expected one postprocess typo marker, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))

from pathlib import Path

replacements = {
    'tests/one-sheet-report-refinements.test.mjs': [
        ('assert.match(reports, /Broadcast dollars by topic across selected fundraisers/);',
         'assert.match(reports, /Broadcast dollars by topic and non-specific giving across selected fundraisers/);'),
        ('assert.match(reports, /Topics are ranked by Broadcast \\$\\/hour/);',
         'assert.match(reports, /Program topics are ranked by Broadcast \\$\\/hour/);'),
    ],
    'tests/one-sheet-reports.test.mjs': [
        ('assert.match(reportSource, /Topics are ranked by Broadcast \\$\\/hour/);',
         'assert.match(reportSource, /Program topics are ranked by Broadcast \\$\\/hour/);'),
    ],
}

for filename, pairs in replacements.items():
    path = Path(filename)
    text = path.read_text()
    for old, new in pairs:
        if text.count(old) != 1:
            raise SystemExit(f'{filename}: expected one match for {old!r}, found {text.count(old)}')
        text = text.replace(old, new, 1)
    path.write_text(text)

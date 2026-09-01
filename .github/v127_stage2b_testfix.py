from pathlib import Path

p = Path('tests/analytics-balanced-rates-v127.test.mjs')
s = p.read_text()
old = "  assert.match(text, /pairedStartTimeComparison\\(filteredRecordsFor\\('startTimes'\\), 1200, 1260\\)/);\n"
new = "  assert.match(text, /const comparisonRecords = filteredRecordsFor\\('startTimes'\\)/);\n  assert.match(text, /pairedStartTimeComparison\\(comparisonRecords, 1200, 1260\\)/);\n  assert.match(text, /sameTitleStartTimeComparison\\(comparisonRecords, 1200, 1260\\)/);\n"
count = s.count(old)
if count != 1:
    raise RuntimeError(f'stage 2b start-time expectation: expected 1 occurrence, found {count}')
p.write_text(s.replace(old, new, 1))
print('OK updated paired start-time regression expectation')

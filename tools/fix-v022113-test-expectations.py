from pathlib import Path

library_test = Path('tests/library-load-performance.test.mjs')
refine = Path('tests/one-sheet-report-refinements.test.mjs')

text = library_test.read_text()
old = "assert.equal(version.appVersion, '0.22.112');"
if old not in text:
    raise SystemExit('library-load version expectation not found')
library_test.write_text(text.replace(old, "assert.equal(version.appVersion, '0.22.113');", 1))

text = refine.read_text()
old_version = r'0\.22\.111'
new_version = r'0\.22\.113'
occurrences = text.count(old_version)
if occurrences != 3:
    raise SystemExit(f'expected 3 report asset version assertions, found {occurrences}')
text = text.replace(old_version, new_version)
text = text.replace('reportsSource', 'reports')
text = text.replace('htmlSource', 'reportHtml')
refine.write_text(text)
print('v0.22.113 stale test expectations and assertion variable names fixed')

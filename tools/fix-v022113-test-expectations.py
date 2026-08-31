from pathlib import Path

library_test = Path('tests/library-load-performance.test.mjs')
refine = Path('tests/one-sheet-report-refinements.test.mjs')

text = library_test.read_text()
old = "assert.equal(version.appVersion, '0.22.112');"
if old not in text:
    raise SystemExit('library-load version expectation not found')
library_test.write_text(text.replace(old, "assert.equal(version.appVersion, '0.22.113');", 1))

text = refine.read_text()
for old, new in [
    (r'/one-sheet-reports\\.js\\?v=0\\.22\\.111/', r'/one-sheet-reports\\.js\\?v=0\\.22\\.113/'),
    (r'/one-sheet-analysis\\.js\\?v=0\\.22\\.111/', r'/one-sheet-analysis\\.js\\?v=0\\.22\\.113/'),
    (r'/one-sheet-reports\\.css\\?v=0\\.22\\.111/', r'/one-sheet-reports\\.css\\?v=0\\.22\\.113/')
]:
    if old not in text:
        raise SystemExit(f'refinement expectation not found: {old}')
    text = text.replace(old, new, 1)
refine.write_text(text)
print('v0.22.113 stale test expectations fixed')

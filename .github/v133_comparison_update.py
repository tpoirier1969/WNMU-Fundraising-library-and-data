from pathlib import Path

p = Path('assets/js/one-sheet-reports.js')
s = p.read_text()
replacements = {
    "    { stroke: '#145f91', dash: '', width: 4 },\n    { stroke: '#7a3e65', dash: '12 5', width: 3 },\n    { stroke: '#2d6a4f', dash: '2 5', width: 3.5 },\n    { stroke: '#9a5b13', dash: '12 4 2 4', width: 4 },\n    { stroke: '#4f5d75', dash: '6 3', width: 2.5 }\n":
    "    { stroke: '#145f91', dash: '', width: 2.75 },\n    { stroke: '#7a3e65', dash: '12 5', width: 2.25 },\n    { stroke: '#2d6a4f', dash: '2 5', width: 2.5 },\n    { stroke: '#9a5b13', dash: '12 4 2 4', width: 2.75 },\n    { stroke: '#4f5d75', dash: '6 3', width: 2 },\n    { stroke: '#6f4e37', dash: '9 3 2 3', width: 2.25 },\n    { stroke: '#5f6f2d', dash: '3 3', width: 2.25 },\n    { stroke: '#6b5b95', dash: '14 4', width: 2.5 }\n",
    "Compare 2–5 fundraisers": "Compare 2–8 fundraisers",
    "Select 2–5 fundraisers": "Select 2–8 fundraisers",
    "state.selectedIds.size >= 5": "state.selectedIds.size >= 8",
    "A comparison report can include up to five fundraisers.": "A comparison report can include up to eight fundraisers.",
    "analyses.length < 2 || analyses.length > 5": "analyses.length < 2 || analyses.length > 8",
    "style: { stroke: '#667781', dash: '5 5', width: 1.5 }": "style: { stroke: '#667781', dash: '5 5', width: 1.25 }",
}
for old, new in replacements.items():
    if old not in s:
        raise SystemExit(f'missing target in one-sheet-reports.js: {old}')
    s = s.replace(old, new)
p.write_text(s)

Path('version.json').write_text('{"appVersion":"0.22.133","releasedAt":"2026-09-03"}\n')

r = Path('reports.html')
rs = r.read_text()
if '0.22.132' not in rs:
    raise SystemExit('reports.html does not contain v0.22.132 cache/version refs')
r.write_text(rs.replace('0.22.132', '0.22.133'))

# Keep regression expectations synchronized with the intentional new current version and comparison limit.
for name in [
    'tests/historical-labels-season-filter-v132.test.mjs',
    'tests/historical-refinements-v131.test.mjs',
    'tests/library-load-performance.test.mjs',
    'tests/report-visual-historical-context-v130.test.mjs',
]:
    path = Path(name)
    text = path.read_text()
    if '0.22.132' not in text:
        raise SystemExit(f'missing current-version expectation in {name}')
    path.write_text(text.replace('0.22.132', '0.22.133'))

for name in [
    'tests/one-sheet-report-refinements.test.mjs',
    'tests/one-sheet-reports.test.mjs',
]:
    path = Path(name)
    text = path.read_text()
    if 'Select 2–5 fundraisers' not in text:
        raise SystemExit(f'missing comparison-selection expectation in {name}')
    path.write_text(text.replace('Select 2–5 fundraisers', 'Select 2–8 fundraisers'))

hardening = Path('tests/one-sheet-analysis-hardening.test.mjs')
ht = hardening.read_text()
old = "assert.equal(reportSandbox.__reportHarness.CHART_STYLES.length, 5);\nconst monochromeStyles = reportSandbox.__reportHarness.CHART_STYLES.map((style) => `${style.dash}|${style.width}`);\nassert.equal(new Set(monochromeStyles).size, 5, 'all five series must remain distinguishable when color is removed');"
new = "assert.equal(reportSandbox.__reportHarness.CHART_STYLES.length, 8);\nconst monochromeStyles = reportSandbox.__reportHarness.CHART_STYLES.map((style) => `${style.dash}|${style.width}`);\nassert.equal(new Set(monochromeStyles).size, 8, 'all eight series must remain distinguishable when color is removed');"
if old not in ht:
    raise SystemExit('missing five-style hardening expectation')
hardening.write_text(ht.replace(old, new))

Path('tests/comparison-eight-thinner-lines-v133.test.mjs').write_text(r"""import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../reports.html', import.meta.url), 'utf8');
const version = JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url), 'utf8'));

assert.equal(version.appVersion, '0.22.133');
assert.match(source, /Compare 2–8 fundraisers/);
assert.match(source, /Select 2–8 fundraisers/);
assert.match(source, /state\.selectedIds\.size >= 8/);
assert.match(source, /up to eight fundraisers/);
assert.match(source, /analyses\.length < 2 \|\| analyses\.length > 8/);
const styles = [...source.matchAll(/\{ stroke: '#[0-9a-fA-F]{6}', dash: '[^']*', width: ([0-9.]+) \}/g)].slice(0, 8);
assert.equal(styles.length, 8);
assert.ok(styles.every((match) => Number(match[1]) <= 2.75));
assert.match(source, /width: 1\.25/);
assert.match(html, /0\.22\.133/);
console.log('v0.22.133 comparison limit and line-weight tests passed');
""")

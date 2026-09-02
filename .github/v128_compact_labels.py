from pathlib import Path

p = Path('assets/js/one-sheet-reports.js')
s = p.read_text()
old = """  function compactMoney(value) {
    const numeric = Number(value || 0);
    if (Math.abs(numeric) >= 1000000) return `$${(numeric / 1000000).toFixed(numeric % 1000000 ? 1 : 0)}m`;
    if (Math.abs(numeric) >= 1000) return `$${(numeric / 1000).toFixed(numeric % 1000 ? 1 : 0)}k`;
    return money(numeric);
  }
"""
new = """  function compactMoney(value) {
    const numeric = Number(value || 0);
    if (Math.abs(numeric) >= 1000000) return `$${(numeric / 1000000).toFixed(2)}m`;
    if (Math.abs(numeric) >= 1000) return `$${(numeric / 1000).toFixed(2)}k`;
    return money(numeric);
  }
"""
if s.count(old) != 1:
    raise RuntimeError(f'compactMoney source match count was {s.count(old)}, expected 1')
p.write_text(s.replace(old, new, 1))

# Focused regression: close values must remain distinguishable in compact labels.
t = Path('tests/compact-money-labels-v128.test.mjs')
t.write_text("""import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');
assert.match(source, /function compactMoney\(value\)/);
assert.match(source, /numeric \/ 1000\)\.toFixed\(2\)/);
assert.match(source, /numeric \/ 1000000\)\.toFixed\(2\)/);
assert.match(source, /chart-value-label\">\$\{escapeHtml\(compactMoney\(dollars\)\)\}/);
assert.doesNotMatch(source, /numeric \/ 1000\)\.toFixed\(numeric % 1000 \? 1 : 0\)/);
console.log('compact money labels preserve two decimal places');
""")
print('Updated compact chart money labels and added regression test.')

import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');
assert.match(source, /function compactMoney\(value\)/);
assert.match(source, /numeric \/ 1000\)\.toFixed\(2\)/);
assert.match(source, /numeric \/ 1000000\)\.toFixed\(2\)/);
assert.match(source, /chart-value-label">\$\{escapeHtml\(compactMoney\(dollars\)\)\}/);
assert.doesNotMatch(source, /numeric \/ 1000\)\.toFixed\(numeric % 1000 \? 1 : 0\)/);
console.log('compact money labels preserve two decimal places');

import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../reports.html', import.meta.url), 'utf8');
const version = JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url), 'utf8'));

assert.equal(version.appVersion, '0.22.136');
assert.match(source, /Compare 2–8 fundraisers/);
assert.match(source, /Select 2–8 fundraisers/);
assert.match(source, /state\.selectedIds\.size >= 8/);
assert.match(source, /up to eight fundraisers/);
assert.match(source, /analyses\.length < 2 \|\| analyses\.length > 8/);
const styles = [...source.matchAll(/\{ stroke: '#[0-9a-fA-F]{6}', dash: '[^']*', width: ([0-9.]+) \}/g)].slice(0, 8);
assert.equal(styles.length, 8);
assert.ok(styles.every((match) => Number(match[1]) <= 2.75));
assert.match(source, /stroke: '#ff2020', dash: '', width: 3\.25/);
assert.match(source, /stroke: '#ff2020', dash: '9 6', width: 2/);
assert.match(html, /0\.22\.136/);
console.log('v0.22.136 comparison limit and line-weight tests passed');

import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../reports.html', import.meta.url), 'utf8');
const version = JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url), 'utf8'));

assert.equal(version.appVersion, '0.22.135');
assert.match(html, /0\.22\.135/);
assert.match(source, /function programTooltipLinesForRows/);
assert.match(source, /function aggregateProgramTooltip/);
assert.match(source, /\.map\(\(\[label, subset\]\) => \[label, subset, rankingRows\(subset, 'startTime'\)\]\)/);
assert.match(source, /sets\.flatMap\(\(\[_label, _subset, rows\]\)/);
assert.match(source, /series: sets\.map\(\(\[label, subset, rows\]\)/);
assert.match(source, /let checkingAccess = true/);
assert.match(source, /checkingAccess = false/);
assert.match(source, /Your administrator session is still valid\. This is a report-generation error, not an access failure\./);
assert.doesNotMatch(source, /showAccessDenied\(error\?\.message \|\| 'The report center could not load\.'\)/);
assert.match(source, /tooltips: productivity\.tooltips/);
assert.match(source, /tooltips: gifts\.tooltips/);
assert.match(source, /historicalTooltips/);
assert.match(source, /currentTooltips/);
assert.match(source, /tooltips: combined\.tooltips/);
assert.match(source, /stroke: '#ff2020', dash: '', width: 3\.25/);
assert.match(source, /Long-term linear trend:/);
assert.match(source, /R² \$\{trend\.r2\.toFixed\(2\)\}/);
assert.match(source, /stroke: '#ff2020', dash: '9 6', width: 2/);
assert.match(source, /least-squares line reports the long-term slope/);
console.log('v0.22.135 chart program tooltip and trend tests passed');

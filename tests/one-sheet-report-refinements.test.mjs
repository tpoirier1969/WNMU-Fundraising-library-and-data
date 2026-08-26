import assert from 'node:assert/strict';
import fs from 'node:fs';

const reports = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../assets/one-sheet-reports.css', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const reportHtml = fs.readFileSync(new URL('../reports.html', import.meta.url), 'utf8');

assert.match(index, /data\.adminOnly='true'/);
assert.match(index, /textContent='Report Center'/);
assert.match(reports, /schedulePickerDetails/);
assert.match(reports, /attributableIncome/);
assert.match(reports, /topic-income-fill/);
assert.match(reports, /topicProgramTitles/);
assert.match(reports, /maxRates = analyses\.map/);
assert.doesNotMatch(reports, /overallWeatherMatrix/);
assert.match(reports, /height\.toFixed\(2\)/);
assert.match(reports, /weekend-row/);
assert.match(reports, /function programResultsTable/);
assert.doesNotMatch(reports, /pledgeHourChart/);
assert.match(css, /rgba\(0,0,0,\.10\)/);
assert.match(css, /topic-hours-fill/);
assert.match(css, /topic-income-fill/);
assert.match(css, /@page\{size:letter landscape;margin:\.32in\}/);
assert.match(css, /\.fundraiser-kpis\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
assert.match(css, /\.fundraiser-sheet \.program-results\{break-before:page;page-break-before:always\}/);
assert.match(css, /\.comparison-sheet \.topic-matrix\{break-before:page;page-break-before:always\}/);
assert.match(css, /thead\{display:table-header-group\}/);
assert.match(css, /tr,\.income-bar-item\{break-inside:avoid-page;page-break-inside:avoid\}/);
assert.doesNotMatch(css, /pledge-hour-row/);
assert.match(reportHtml, /one-sheet-reports\.js\?v=0\.22\.101/);

console.log('one-sheet report refinements tests passed');

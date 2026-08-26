import assert from 'node:assert/strict';
import fs from 'node:fs';

const reports = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../assets/one-sheet-reports.css', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const reportHtml = fs.readFileSync(new URL('../reports.html', import.meta.url), 'utf8');

assert.match(index, /data\.adminOnly='true'/);
assert.match(index, /textContent='Report Center'/);
assert.match(reports, /schedulePickerDetails/);
assert.match(reports, /function lineChartSvg/);
assert.match(reports, /function incomeBarChartSvg/);
assert.match(reports, /class=\"income-chart-svg\"/);
assert.match(reports, /function dailyComparisonChart/);
assert.match(reports, /function topicComparisonChart/);
assert.match(reports, /Broadcast dollars by corresponding fundraiser day/);
assert.match(reports, /Broadcast dollars by topic across selected fundraisers/);
assert.match(reports, /function recurringProgramKeys/);
assert.match(reports, /recurringKeys\.has\(title\.toLowerCase\(\)\)/);
assert.match(reports, /function topicRankMarkers/);
assert.match(reports, /topic-rank/);
assert.match(reports, /Hours \$\{hoursShare\.toFixed\(0\)\}%/);
assert.match(reports, /Income \$\{incomeShare\.toFixed\(0\)\}%/);
assert.doesNotMatch(reports, /topic-income-fill/);
assert.doesNotMatch(reports, /topic-hours-fill/);
assert.doesNotMatch(reports, /height\.toFixed\(2\)%/);
assert.match(reports, /<th>Day<\/th><th>Hours<\/th><th>Broadcast \$<\/th><th>\$\/hr<\/th><th>Pledges<\/th><th>Pledges\/hr<\/th><th>Weather<\/th>/);
assert.match(reports, /formatTime\(day\.startMinutes\).*formatTime\(day\.endMinutes\)/s);
assert.match(reports, /function programResultsTable/);
assert.doesNotMatch(reports, /pledgeHourChart/);

assert.match(css, /@page\{size:letter portrait;margin:\.35in\}/);
assert.match(css, /\.sheet-section h2\{font-size:16pt/);
assert.match(css, /\.comparison-sheet \.section-heading p\{font-size:14pt/);
assert.match(css, /table\{font-size:9pt/);
assert.match(css, /thead th\{font-size:9pt/);
assert.match(css, /\.fundraiser-kpis strong\{font-size:13pt/);
assert.match(css, /\.report-chart svg text\{font-size:12px/);
assert.doesNotMatch(css, /break-before:page|page-break-before:always/);
const printCss = css.slice(css.indexOf('@media print'));
assert.doesNotMatch(printCss, /font-size:[0-8](?:\.\d+)?pt/, 'print styles must not use type smaller than 9pt');
assert.doesNotMatch(css, /pledge-hour-row/);
assert.match(reportHtml, /one-sheet-reports\.js\?v=0\.22\.102/);

console.log('one-sheet report refinements tests passed');

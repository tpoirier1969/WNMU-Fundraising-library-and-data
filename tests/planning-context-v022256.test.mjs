import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const list = fs.readFileSync('assets/js/ui-list.js','utf8');
const scheduling = fs.readFileSync('assets/js/ui-scheduling.js','utf8');
const report = fs.readFileSync('assets/js/programming-strategy-report.js','utf8');
const worker = fs.readFileSync('assets/js/programming-strategy-worker.js','utf8');
const appCss = fs.readFileSync('assets/styles.css','utf8');
const strategyCss = fs.readFileSync('assets/programming-strategy-report.css','utf8');

test('Program List reuses the existing scorecard score beside each title', () => {
  assert.match(list, /App\.programScorecard\?\.baseAssessment\?\.\(row\)/);
  assert.match(list, /class="program-list-score/);
  assert.match(list, /Score \$\{Math\.round\(scoreValue\)\}/);
  assert.match(appCss, /\.program-list-score/);
});

test('Fundraiser plan places day outlook on a second row below the day/date header', () => {
  assert.match(report, /<header><div><strong>\$\{esc\(day\.label\)\}<\/strong><span>\$\{esc\(fmt\(day\.date,false\)\)\}<\/span><\/div><\/header>/);
  assert.match(report, /class="strategy-plan-day-outlook"/);
  assert.match(strategyCss, /\.strategy-plan-day-outlook/);
});

test('Time-of-Day comparison identifies displayed topics as top signals and reports topic breadth', () => {
  assert.match(worker, /topicCount: topicGroups\.size/);
  assert.match(worker, /topicCount: topicSummary\.topicCount/);
  assert.match(report, /Top: \$\{row\.topics\.join\(' · '\)\}/);
  assert.match(report, /topic\$\{row\.topicCount===1\?'':'s'\} tried/);
  assert.doesNotMatch(report, /topTopics\|\|\[\]\)\.slice\(0,2\)/);
});

test('Time-of-Day heat scale runs from white at zero to salmon at the highest displayed rate', () => {
  assert.match(report, /const maxRate=/);
  assert.match(report, /const target=\[250,128,114\]/);
  assert.match(report, /255\+\(\(value-255\)\*ratio\)/);
  assert.match(report, /White = \$0\/hr; deepest salmon = highest displayed \$\/hr/);
  assert.match(strategyCss, /background:#fa8072/);
});

test('Scheduler shows historical same-season weekday broadcast-hour rate only before actual daily results exist', () => {
  assert.match(scheduling, /function historicalSeasonWeekdayRate\(/);
  assert.match(scheduling, /schedulePledgeSeason\(historical\) !== targetSeason/);
  assert.match(scheduling, /historicalDate\.getDay\(\) !== targetWeekday/);
  assert.match(scheduling, /day\.dollars \+= dollars/);
  assert.match(scheduling, /day\.minutes \+= minutes/);
  assert.match(scheduling, /\(day\.dollars \* 60\) \/ day\.minutes/);
  assert.match(scheduling, /const historicalRate = money\.hasImportedResults \? null : historicalSeasonWeekdayRate\(schedule, dateKey\)/);
  assert.match(scheduling, /Historic \$\{utils\.escapeHtml\(historicalRate\.season\)\}/);
  assert.match(appCss, /\.schedule-day-historical-rate/);
});

test('edited source files parse', () => {
  assert.doesNotThrow(() => new vm.Script(list,{filename:'ui-list.js'}));
  assert.doesNotThrow(() => new vm.Script(scheduling,{filename:'ui-scheduling.js'}));
  assert.doesNotThrow(() => new vm.Script(report,{filename:'programming-strategy-report.js'}));
  assert.doesNotThrow(() => new vm.Script(worker,{filename:'programming-strategy-worker.js'}));
});

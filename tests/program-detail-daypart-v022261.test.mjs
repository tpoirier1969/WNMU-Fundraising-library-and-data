import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const shell = fs.readFileSync(new URL('../app-shell.html', import.meta.url), 'utf8');
const dom = fs.readFileSync(new URL('../assets/js/dom.js', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../assets/js/ui-detail.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../assets/styles.css', import.meta.url), 'utf8');
const strategy = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = detail.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should exist`);
  const bodyMarker = detail.indexOf(') {', start);
  assert.ok(bodyMarker >= 0, `${name} should have a readable function body`);
  const brace = bodyMarker + 2;
  let depth = 0;
  for (let index = brace; index < detail.length; index += 1) {
    if (detail[index] === '{') depth += 1;
    else if (detail[index] === '}') {
      depth -= 1;
      if (depth === 0) return detail.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

test('Program Detail includes time-of-day performance below Income over time', () => {
  const graphIndex = shell.indexOf('<h3>Income over time</h3>');
  const daypartIndex = shell.indexOf('<h3>Performance by time of day</h3>');
  const fieldsIndex = shell.indexOf('<h3>All known program fields</h3>');
  assert.ok(graphIndex >= 0 && daypartIndex > graphIndex && fieldsIndex > daypartIndex);
  assert.match(shell, /id="detail-daypart-pill"/);
  assert.match(shell, /id="detail-daypart-performance"/);
  assert.match(dom, /detailDaypartPerformance: document\.getElementById\('detail-daypart-performance'\)/);
  assert.match(dom, /detailDaypartPill: document\.getElementById\('detail-daypart-pill'\)/);
});

test('daypart analysis code parses and remains out of Strategy', () => {
  assert.doesNotThrow(() => new vm.Script(detail, { filename:'ui-detail.js' }));
  assert.match(detail, /function buildDaypartPerformance/);
  assert.match(detail, /function renderDaypartPerformance/);
  assert.match(detail, /renderDaypartPerformance\(program, \[\], \[\]\)/);
  assert.match(detail, /renderDaypartPerformance\(program, driveResults, exactAirings\)/);
  assert.doesNotMatch(strategy, /detail-daypart|buildDaypartPerformance|renderDaypartPerformance/);
});

test('broadcast dayparts use the intended WNMU planning windows', () => {
  const context = { Date, Number };
  vm.createContext(context);
  vm.runInContext(extractFunction('detailDaypartForDate'), context);
  const at = (hour, minute = 0) => new Date(2026, 0, 1, hour, minute, 0);
  assert.equal(context.detailDaypartForDate(at(7)).id, 'morning');
  assert.equal(context.detailDaypartForDate(at(12)).id, 'afternoon');
  assert.equal(context.detailDaypartForDate(at(17)).id, 'early-evening');
  assert.equal(context.detailDaypartForDate(at(19)).id, 'prime');
  assert.equal(context.detailDaypartForDate(at(22)).id, 'late');
  assert.equal(context.detailDaypartForDate(at(2)).id, 'late');
});

test('airing lifecycle is split into early, middle, and late thirds', () => {
  const context = { Number };
  vm.createContext(context);
  vm.runInContext(extractFunction('detailLifecycleStage'), context);
  assert.equal(context.detailLifecycleStage(0, 9), 'early');
  assert.equal(context.detailLifecycleStage(2, 9), 'early');
  assert.equal(context.detailLifecycleStage(3, 9), 'middle');
  assert.equal(context.detailLifecycleStage(5, 9), 'middle');
  assert.equal(context.detailLifecycleStage(6, 9), 'late');
  assert.equal(context.detailLifecycleStage(8, 9), 'late');
});

test('raw rates are per pledge hour and zero-dollar source rows are not discarded as missing', () => {
  assert.match(detail, /entry\.amount \/ \(entry\.minutes \/ 60\)/);
  assert.match(detail, /bucket\.totalDollars \/ \(bucket\.totalMinutes \/ 60\)/);
  assert.match(detail, /Object\.prototype\.hasOwnProperty\.call\(row \|\| \{\}, key\)/);
  assert.match(detail, /Number\.isFinite\(Number\(value\)\)/);
});

test('fatigue-adjusted guidance requires enough title history and lifecycle overlap', () => {
  assert.match(detail, /usable\.length >= 6/);
  assert.match(detail, /bucket\.rows\.length >= 3/);
  assert.match(detail, /lifecycleStages\.size >= 2/);
  assert.match(detail, /adjustedValues\.length >= 3/);
  assert.match(detail, /Too thin to separate slot from fatigue/);
  assert.match(detail, /100 = its life-stage norm/);
  assert.match(detail, /not proof that a time slot caused the result/);
});

test('time-of-day analysis has dedicated compact styling', () => {
  assert.match(styles, /\.detail-daypart-performance/);
  assert.match(styles, /\.detail-daypart-table/);
  assert.match(styles, /\.detail-daypart-fatigue/);
  assert.match(styles, /\.detail-daypart-evidence\.evidence-good/);
});

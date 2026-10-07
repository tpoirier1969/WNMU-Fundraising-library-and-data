import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const schedulingSource = fs.readFileSync(new URL('../assets/js/ui-scheduling.js', import.meta.url), 'utf8');
const strategySource = fs.readFileSync(new URL('../assets/js/programming-strategy-analysis.js', import.meta.url), 'utf8');
const reportSource = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
const workerSource = fs.readFileSync(new URL('../assets/js/programming-strategy-worker.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../assets/styles.css', import.meta.url), 'utf8');

const context = { console, Date, Map, Set, Math, Number, String, Object, Array, RegExp, Intl };
context.globalThis = context;
vm.runInNewContext(strategySource, context, { filename: 'programming-strategy-analysis.js' });
const S = context.WNMUProgrammingStrategyAnalysis;

test('regular schedule blocks are explicit non-pledge placements with no financial workflow', () => {
  assert.match(schedulingSource, /placementType: 'regular'/);
  assert.match(schedulingSource, /isNonPledge: true/);
  assert.match(schedulingSource, /Regular schedule · Not for pledge/);
  assert.match(schedulingSource, /if \(!placement \|\| placement\.isNonPledge\) return;/);
  assert.match(schedulingSource, /currentPlacement && !currentPlacement\.isNonPledge && !isPlaceholderPlacement\(currentPlacement\)/);
  assert.match(schedulingSource, /!placement\.isNonPledge && !isPlaceholder/);
});

test('placeholder and regular blocks preserve optional schedule notes', () => {
  assert.match(schedulingSource, /id="schedule-placeholder-note"/);
  assert.match(schedulingSource, /Why is this placeholder here\?/);
  assert.match(schedulingSource, /id="schedule-regular-note"/);
  assert.match(schedulingSource, /scheduleNote/);
  assert.match(schedulingSource, /schedule-placement-note/);
  assert.match(schedulingSource, /scheduleNote: utils\.normalizeText\(clip\.scheduleNote/);
});

test('calendar color identifies break mode without workflow-status styling', () => {
  assert.doesNotMatch(schedulingSource, /function schedulePlacementReadinessClass/);
  assert.doesNotMatch(schedulingSource, /setup-break-ready|setup-entered|setup-break-missing/);
  assert.doesNotMatch(schedulingSource, /transferred-to-station/);
  assert.match(schedulingSource, /Break info/);
  assert.match(schedulingSource, /Schd/);
  assert.match(schedulingSource, /breakInfoComplete/);
  assert.doesNotMatch(schedulingSource, /BREAK INFO NEEDED/);
  assert.match(css, /schedule-placement-status-toggle input:checked \+ \.schedule-placement-status-check[\s\S]*background: #facc15/);
  assert.match(css, /Calendar color is determined only by break mode/);
  assert.match(css, /\.schedule-placement\.break-mode-phones-staffed,[\s\S]*\.schedule-placement\.repeat-run\.break-mode-phones-staffed[\s\S]*background: #4f93c7/);
  assert.match(css, /\.schedule-placement\.break-mode-web-only,[\s\S]*\.schedule-placement\.repeat-run\.break-mode-web-only[\s\S]*background: #3b9f96/);
  assert.match(css, /\.schedule-placement\.break-mode-live,[\s\S]*\.schedule-placement\.repeat-run\.break-mode-live[\s\S]*background: #7c5bab/);
  assert.match(css, /Retire the old red LIVE pseudo-badge\/border/);
});

test('Fundraising Window labels stay behind scheduled program cards', () => {
  assert.match(css, /\.schedule-fundraising-window-tag\{[\s\S]*z-index:0/);
  assert.match(css, /\.schedule-slot\.fundraising-window-slot \.schedule-placement\{[\s\S]*z-index:2/);
});

test('regular blocks are yellow and placeholders are visually distinct neutral blocks', () => {
  assert.match(css, /\.schedule-placement\.non-pledge\.regular-schedule/);
  assert.match(css, /#ffe97a/);
  assert.match(css, /\.schedule-placement\.placeholder[\s\S]*#eef1f4/);
  assert.match(css, /\.schedule-placement\.non-pledge\.regular-schedule[\s\S]*color: #17130a/);
});

test('regular schedule time inside a Fundraising Window is protected from pledge recommendations', () => {
  const schedule = {
    id: 'dec26',
    title: 'December 2026',
    startDate: '2026-12-05',
    endDate: '2026-12-05',
    fundraisingWindows: [{
      id: 'sat-prime',
      dateKey: '2026-12-05',
      startMinutes: 19 * 60,
      endMinutes: 22 * 60,
      priority: 'open'
    }],
    meta: { fundraisingWindowPlanning: true },
    placements: [{
      id: 'regular-1',
      placementType: 'regular',
      isNonPledge: true,
      programTitle: 'Regular Saturday Program',
      scheduleNote: 'Normal schedule carries through here',
      dateKey: '2026-12-05',
      startMinutes: 20 * 60,
      endMinutes: 21 * 60,
      lengthMinutes: 60
    }]
  };
  const windows = Array.from(S.planningWindows(schedule));
  assert.equal(windows.length, 3);
  assert.deepEqual(windows.map((item) => [item.startMinutes, item.endMinutes, item.blocked]), [
    [19 * 60, 20 * 60, false],
    [20 * 60, 21 * 60, true],
    [21 * 60, 22 * 60, false]
  ]);
  assert.equal(windows[1].regularProgramTitle, 'Regular Saturday Program');
  assert.equal(windows[1].regularProgramNote, 'Normal schedule carries through here');
  assert.equal(windows[1].blockedReason, 'regular_schedule');
  assert.match(reportSource, /regularProgramTitle/);
  assert.match(reportSource, /not available for pledge recommendations/);
});

test('regular-block strategy logic remains loaded through the current strategy worker', () => {
  assert.match(workerSource, /programming-strategy-analysis\.js\?v=0\.22\.263/);
  assert.match(reportSource, /programming-strategy-worker\.js\?v=0\.22\.274/);
});

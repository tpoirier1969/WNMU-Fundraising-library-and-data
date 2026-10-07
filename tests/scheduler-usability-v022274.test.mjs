import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scheduling = fs.readFileSync(new URL('../assets/js/ui-scheduling.js', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../assets/js/ui-workspace.js', import.meta.url), 'utf8');
const appInit = fs.readFileSync(new URL('../assets/js/app-init.js', import.meta.url), 'utf8');
const scorecardUi = fs.readFileSync(new URL('../assets/js/program-scorecard-ui.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../assets/styles.css', import.meta.url), 'utf8');

test('workspace persists in both browser storage and URL', () => {
  assert.match(workspace, /localStorage\?\.setItem\(constants\.WORKSPACE_STORAGE_KEY/);
  assert.match(workspace, /url\.searchParams\.set\('workspace', workspaceId\)/);
  assert.match(workspace, /persistWorkspace\(workspace\.id\)/);
  assert.match(workspace, /persistWorkspaceInUrl\(workspace\.id\)/);
});

test('scheduler warmup does not render the hidden calendar', () => {
  assert.match(appInit, /warmup\?\.\(\{ defer: true, renderHidden: false \}\)/);
});

test('fundraiser list can render cached schedules before remote Supabase load completes', () => {
  const fnStart = scheduling.indexOf('async function loadSchedules()');
  assert.ok(fnStart >= 0);
  const cachedIndex = scheduling.indexOf('const cachedRows = utils.storageGet', fnStart);
  const cachedRenderIndex = scheduling.indexOf('renderScheduleList();', cachedIndex);
  const remoteProbeIndex = scheduling.indexOf('await App.data.probeScheduleStore()', fnStart);
  assert.ok(cachedIndex >= 0 && cachedRenderIndex > cachedIndex);
  assert.ok(remoteProbeIndex > cachedRenderIndex, 'cached fundraiser picker should render before the remote probe');
  assert.match(scheduling.slice(fnStart, scheduling.indexOf('\n  function scheduleDistanceFromToday', fnStart)), /utils\.storageSet\(constants\.SCHEDULE_STORAGE_KEY, state\.schedules\)/);
});

test('fundraiser picker precomputes duplicate-range counts instead of rescanning schedules per option', () => {
  const start = scheduling.indexOf('function renderScheduleList()');
  const end = scheduling.indexOf('\n  function activateScheduleById', start);
  const body = scheduling.slice(start, end);
  assert.match(body, /const rangeCounts = new Map\(\)/);
  assert.match(body, /rangeCounts\.get\(info\.rangeKey\)/);
  assert.doesNotMatch(body, /sameDateRangeSchedules\(/);
});

test('Best Fit uses one indexed evidence pass and supports back navigation', () => {
  assert.match(scheduling, /function buildScheduleAdvisorEvidence\(/);
  assert.match(scheduling, /const programStats = new Map\(\)/);
  assert.match(scheduling, /const topicGroups = new Map\(\)/);
  assert.match(scheduling, /scheduleAdvisorProgramFit\(entry\.row, schedule, slot, advisorEvidence\)/);
  assert.match(scheduling, /data-schedule-advisor-back/);
  assert.match(scheduling, /function closeScheduleAdvisorTopic\(/);
});

test('Schedule this slot modal is draggable while calendar stays visible', () => {
  assert.match(scheduling, /function startScheduleModalDrag\(/);
  assert.match(scheduling, /function handleScheduleModalDrag\(/);
  assert.match(scheduling, /scheduleModalHeader\?\.addEventListener\('pointerdown', startScheduleModalDrag\)/);
  assert.match(css, /#schedule-program-backdrop\s*\{[\s\S]*background:rgba\(9,29,48,\.10\)/);
});

test('fundraising window note is visible on the calendar', () => {
  assert.match(scheduling, /schedule-fundraising-window-note/);
  assert.match(scheduling, /fundraisingWindowMark\.window\.note/);
  assert.match(css, /\.schedule-fundraising-window-note\s*\{/);
});

test('missing break information gets a subtle red outline', () => {
  assert.match(scheduling, /needsBreakInfo \? 'break-info-missing' : ''/);
  assert.match(css, /\.schedule-placement\.break-info-missing\s*\{[\s\S]*outline:1px solid rgba\(190,28,28,\.9\)/);
});

test('calendar shows current fundraiser use count after scheduled titles', () => {
  assert.match(scheduling, /function schedulePlacementUseCounts\(/);
  assert.match(scheduling, /schedule-placement-use-count/);
  assert.match(scheduling, /\(\$\{fundraiserUseCount\}\)/);
});

test('Program Library scorecard work sleeps outside the Library workspace', () => {
  const start = scorecardUi.indexOf('function scheduleListRefresh()');
  const end = scorecardUi.indexOf('\n  function scheduleDetailRefresh', start);
  const body = scorecardUi.slice(start, end);
  assert.match(body, /App\.state\?\.activeWorkspace !== 'library'/);
});

test('legacy drive summary transformer no longer polls every 1.5 seconds', () => {
  assert.doesNotMatch(appInit, /setInterval\(scheduleTransform, 1500\)/);
});

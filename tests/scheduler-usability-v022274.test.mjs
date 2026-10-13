import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scheduling = fs.readFileSync(new URL('../assets/js/ui-scheduling.js', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../assets/js/ui-workspace.js', import.meta.url), 'utf8');
const appInit = fs.readFileSync(new URL('../assets/js/app-init.js', import.meta.url), 'utf8');
const scorecardUi = fs.readFileSync(new URL('../assets/js/program-scorecard-ui.js', import.meta.url), 'utf8');
const importsUi = fs.readFileSync(new URL('../assets/js/ui-imports.js', import.meta.url), 'utf8');
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

test('workflow checkboxes do not alter scheduler block styling', () => {
  assert.doesNotMatch(scheduling, /break-info-missing/);
  assert.doesNotMatch(css, /\.schedule-placement\.break-info-missing/);
  assert.match(scheduling, /data-grid-break-info-placement-id=/);
  assert.match(scheduling, /data-grid-transfer-placement-id=/);
  assert.match(css, /schedule-placement-status-toggle input:checked \+ \.schedule-placement-status-check\s*\{[\s\S]*background:\s*#facc15/);
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


test('remembered Scheduling retries fundraiser loading after Supabase becomes available', () => {
  assert.match(scheduling, /let schedulesLoadedWithClient = false/);
  assert.match(scheduling, /const loadHadClient = Boolean\(state\.client\)/);
  assert.match(scheduling, /schedulesLoadedWithClient = loadHadClient/);
  assert.match(scheduling, /const needsClientReload = Boolean\(state\.client && !schedulesLoadedWithClient\)/);
});

test('remembered Scheduling loads fundraiser picker before the full Program Library refresh', () => {
  const authIndex = appInit.indexOf('await App.auth.initAuthRole()');
  const schedulingWarmupIndex = appInit.indexOf("warmup?.({ defer: false, renderHidden: false })", authIndex);
  const libraryRefreshIndex = appInit.indexOf("await App.libraryLoader.refreshAll({ workspace: 'library' })", authIndex);
  const schedulingEnsureIndex = appInit.indexOf('await App.schedulingUi?.ensureReady?.()', libraryRefreshIndex);
  assert.ok(authIndex >= 0);
  assert.ok(schedulingWarmupIndex > authIndex, 'Scheduling should warm up after auth');
  assert.ok(libraryRefreshIndex > schedulingWarmupIndex, 'Fundraiser picker should load before Program Library refresh');
  assert.ok(schedulingEnsureIndex > libraryRefreshIndex, 'Full Scheduling render should run after Program Library refresh');
});


test('remembered Imports stays unready until Supabase exists', () => {
  const start = importsUi.indexOf('async function ensureReady()');
  const end = importsUi.indexOf('\n  function normalizeDroppedFiles', start);
  const body = importsUi.slice(start, end);
  assert.match(body, /if \(!state\.client\) \{/);
  assert.match(body, /return false/);
  const readyIndex = body.indexOf('imp().ready = true');
  const clientGuardIndex = body.indexOf('if (!state.client)');
  assert.ok(clientGuardIndex >= 0 && readyIndex > clientGuardIndex);
});

test('Scheduler consumers share imported-airings work instead of duplicate full-table fetches', () => {
  assert.match(scheduling, /const rows = await ensureScheduleImportedAiringsLoaded\(\)/);
  assert.match(scheduling, /state\.scheduleImportedAiringsLoadedAt = Date\.now\(\)/);
  assert.match(workspace, /const RESULT_CACHE_MS = 30000/);
  assert.match(workspace, /if \(state\.scheduleImportedAiringsPromise\)/);
  assert.match(workspace, /state\.scheduleImportedAiringsCache/);
  assert.match(workspace, /state\.scheduleImportedAiringsLoadedAt/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scheduling = fs.readFileSync('assets/js/ui-scheduling.js', 'utf8');
const styles = fs.readFileSync('assets/styles.css', 'utf8');

test('regular schedule blocks are explicit non-pledge placements with no break or finance mode', () => {
  assert.match(scheduling, /placementType: 'regular'/);
  assert.match(scheduling, /isRegularScheduleBlock: true/);
  assert.match(scheduling, /isNonPledge: true/);
  assert.match(scheduling, /breakMode: ''/);
  assert.match(scheduling, /Regular program · Not for pledge/);
  assert.match(styles, /\.schedule-placement\.regular-program/);
  assert.match(styles, /REGULAR · NO PLEDGE/);
});

test('placeholder and regular schedule blocks can persist optional notes', () => {
  assert.match(scheduling, /id="schedule-placeholder-note"/);
  assert.match(scheduling, /placeholderNote: scheduleNote/);
  assert.match(scheduling, /id="schedule-regular-note"/);
  assert.match(scheduling, /regularNote: scheduleNote/);
  assert.match(scheduling, /schedule-placement-note/);
});

test('fundraising mode hue is separate from workflow intensity', () => {
  assert.match(styles, /break-mode-phones-staffed\.workflow-pending/);
  assert.match(styles, /break-mode-phones-staffed\.workflow-break-ready/);
  assert.match(styles, /break-mode-phones-staffed\.workflow-entered/);
  assert.match(styles, /break-mode-web-only\.workflow-pending/);
  assert.match(styles, /break-mode-web-only\.workflow-break-ready/);
  assert.match(styles, /break-mode-web-only\.workflow-entered/);
  assert.match(styles, /break-mode-live\.workflow-pending/);
  assert.match(styles, /break-mode-live\.workflow-break-ready/);
  assert.match(styles, /break-mode-live\.workflow-entered/);
  assert.match(scheduling, /schedulePlacementReadinessClass/);
  assert.match(scheduling, /workflow-break-ready/);
  assert.match(scheduling, /workflow-entered/);
});

test('repeat pledge blocks remain lighter within each fundraising-mode family', () => {
  assert.match(styles, /repeat-run\.break-mode-phones-staffed\.workflow-entered/);
  assert.match(styles, /repeat-run\.break-mode-web-only\.workflow-entered/);
  assert.match(styles, /repeat-run\.break-mode-live\.workflow-entered/);
});

test('calendar keeps explicit PHONES WEB and LIVE text labels in addition to color', () => {
  assert.match(scheduling, /breakMode === BREAK_MODES\.WEB_ONLY \? 'WEB'/);
  assert.match(scheduling, /breakMode === BREAK_MODES\.LIVE \? 'LIVE' : 'PHONES'/);
});

test('regular and placeholder blocks survive scheduler copy paste', () => {
  assert.match(scheduling, /state\.scheduleClipboard\?\.isRegularScheduleBlock/);
  assert.match(scheduling, /const regular = Boolean\(clip\.isRegularScheduleBlock/);
  assert.match(scheduling, /scheduleNote: utils\.normalizeText\(clip\.scheduleNote/);
});

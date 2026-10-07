import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scheduling = fs.readFileSync('assets/js/ui-scheduling.js', 'utf8');
const dom = fs.readFileSync('assets/js/dom.js', 'utf8');
const shell = fs.readFileSync('app-shell.html', 'utf8');

test('scheduler undo source parses and keeps a bounded history', () => {
  assert.doesNotThrow(() => new vm.Script(scheduling, { filename: 'ui-scheduling.js' }));
  assert.match(scheduling, /const scheduleUndoStacks = new Map\(\)/);
  assert.match(scheduling, /const SCHEDULE_UNDO_LIMIT = 30/);
  assert.match(scheduling, /stack\.splice\(0, stack\.length - SCHEDULE_UNDO_LIMIT\)/);
});

test('Undo restores the saved schedule snapshot and persists it', () => {
  assert.match(scheduling, /async function undoScheduleEdit\(\)/);
  assert.match(scheduling, /normalizeScheduleWindow\(cloneScheduleForPersistence\(entry\.snapshot\)\)/);
  assert.match(scheduling, /state\.schedules\[index\] = restored/);
  assert.match(scheduling, /await persistSchedules\(restored\)/);
  assert.match(scheduling, /Undid \$\{entry\.label\}/);
});

test('Ctrl+Z works only in Pledge Scheduling and does not steal text editing undo', () => {
  assert.match(scheduling, /event\.key\.toLowerCase\(\) === 'z'/);
  assert.match(scheduling, /state\.activeWorkspace === 'scheduling'/);
  assert.match(scheduling, /\/INPUT\|TEXTAREA\|SELECT\/\.test\(activeTag\) \|\| activeEditable/);
  assert.match(scheduling, /&& !inField/);
});

test('visible Undo control is wired to the scheduling module', () => {
  assert.match(shell, /id="schedule-undo-button"/);
  assert.match(shell, /Ctrl\+Z/);
  assert.match(dom, /scheduleUndoButton: document\.getElementById\('schedule-undo-button'\)/);
  assert.match(scheduling, /scheduleUndoButton\?\.addEventListener\('click'/);
});

test('core scheduling edits create undo checkpoints before mutation', () => {
  assert.match(scheduling, /recordScheduleUndo\(schedule, .*fundraising window/);
  assert.match(scheduling, /recordScheduleUndo\(schedule, .*placeholder/);
  assert.match(scheduling, /recordScheduleUndo\(schedule, .*regular program/);
  assert.match(scheduling, /recordScheduleUndo\(schedule, `schedule \$\{derive\.title\(row\)\}`\)/);
  assert.match(scheduling, /recordScheduleUndo\(schedule, `move \$\{placement\.programTitle\}`\)/);
  assert.match(scheduling, /recordScheduleUndo\(schedule, `remove \$\{target\.programTitle\}`\)/);
  assert.match(scheduling, /recordScheduleUndo\(schedule, `change \$\{target\.programTitle\} break mode`\)/);
  assert.match(scheduling, /recordScheduleUndo\(schedule, .*entered in traffic/);
});

test('regular no-pledge blocks can be drag-moved without requiring a library row', () => {
  assert.match(scheduling, /const regular = isRegularSchedulePlacement\(placement\)/);
  assert.match(scheduling, /\(!placeholder && !regular && !row\)/);
  assert.match(scheduling, /if \(!placeholder && !regular\) \{/);
});

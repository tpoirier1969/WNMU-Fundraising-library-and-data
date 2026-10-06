import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const schedulingSource = fs.readFileSync('assets/js/ui-scheduling.js', 'utf8');
const detailSource = fs.readFileSync('assets/js/ui-detail.js', 'utf8');
const shell = fs.readFileSync('app-shell.html', 'utf8');

test('normal-click schedule removal uses the schedule placement delete path only', () => {
  const clearBlock = schedulingSource.match(/async function clearSelectedPlacement\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.ok(clearBlock, 'clearSelectedPlacement should exist');
  assert.match(clearBlock, /deletePlacementFromContext\(slot\)/);
  assert.doesNotMatch(clearBlock, /deleteProgram|pledge_programs_v2|BASE_TABLE/);
  assert.doesNotMatch(schedulingSource, /App\.data\.deleteProgram\(/);
});

test('schedule modal labels removal as schedule-only and hides it by default', () => {
  assert.match(shell, /class="ghost danger hidden" id="schedule-clear-placement-button">Remove from schedule<\/button>/);
  assert.match(schedulingSource, /scheduleClearPlacementButton\.classList\.toggle\('hidden', !editable\)/);
});

test('permanent program deletion is available only from the Program Library workspace', () => {
  assert.match(detailSource, /const inLibraryWorkspace = state\.activeWorkspace === 'library';/);
  assert.match(detailSource, /const canDeleteCurrent = canEdit\(\) && inLibraryWorkspace/);
  assert.match(shell, /id="detail-delete-button">Delete from Library…<\/button>/);
});


test('Schedule This Slot closes after successful window edits and scheduling', () => {
  assert.match(schedulingSource,/saveFundraisingWindowToSelectedSlot\(true\)/);
  assert.match(schedulingSource,/removeFundraisingWindowFromSelectedSlot\(true\)/);
  const assignBlock=schedulingSource.match(/async function assignProgramToSelectedSlot[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(assignBlock,/closeScheduleModal\(\)/);
});

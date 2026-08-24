import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scheduling = fs.readFileSync(new URL('../assets/js/ui-scheduling.js', import.meta.url), 'utf8');
const imports = fs.readFileSync(new URL('../assets/js/ui-imports.js', import.meta.url), 'utf8');

test('ordinary Results Import never mutates fundraiser schedules', () => {
  assert.match(imports, /Results Import never creates, merges, repairs, or changes fundraiser schedules\./);
  assert.match(imports, /allowDuplicateMerges:\s*false/);
  assert.match(imports, /allowRefreshPlacements:\s*false/);
  assert.match(imports, /rebuild:\s*false/);
});

test('duplicate schedule merge is never preselected and defaults safe', () => {
  assert.match(scheduling, /allowDuplicateMerges = false/);
  assert.match(scheduling, /key: 'merge'[\s\S]{0,500}checked: false/);
});

test('destructive imported schedule repairs require a typed manual check', () => {
  assert.match(scheduling, /MANUAL SCHEDULE CHECK REQUIRED/);
  assert.match(scheduling, /Type APPLY SCHEDULE CHANGES to continue/);
  assert.match(scheduling, /confirmImportedScheduleDestructiveRepair/);
  assert.match(scheduling, /destructiveRequested = Boolean\(options\.allowDuplicateMerges \|\| options\.rebuild\)/);
});

test('low-level duplicate schedule deletion refuses calls without explicit approval', () => {
  assert.match(scheduling, /deleteMergedImportedScheduleRecords\(scheduleIds = \[\], \{ explicitApproval = false \} = \{\}\)/);
  assert.match(scheduling, /if \(!explicitApproval\) \{[\s\S]{0,180}return 0;/);
  assert.match(scheduling, /explicitApproval: destructiveRequested/);
});

test('report title conflicts preserve the existing scheduled program automatically', () => {
  assert.match(scheduling, /No scheduled program will be deleted or replaced automatically\./);
  assert.match(scheduling, /keep the existing schedule and add only non-conflicting imported placements/);
});

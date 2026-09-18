import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const libraryLoadSource = fs.readFileSync('assets/js/library-load.js', 'utf8');
const controlsSource = fs.readFileSync('assets/js/program-library-controls.js', 'utf8');
const outlookSource = fs.readFileSync('assets/js/program-outlook-enhancements.js', 'utf8');
const scoreUiSource = fs.readFileSync('assets/js/program-scorecard-ui.js', 'utf8');
const detailSource = fs.readFileSync('assets/js/ui-detail.js', 'utf8');
const dataSource = fs.readFileSync('assets/js/data.js', 'utf8');
const appSource = fs.readFileSync('assets/js/app.js', 'utf8');

test('metadata saves do not restart full airing-history enrichment', () => {
  assert.match(libraryLoadSource, /options\.refreshAiringHistory !== false && !state\.detailSaveInProgress/);
  assert.match(libraryLoadSource, /if \(shouldRefreshHistory\) \{[\s\S]*?App\.data\.refreshAiringHistory/);
});

test('library numeric controls do not scan airing history when no numeric filter needs it', () => {
  assert.match(controlsSource, /function hasActiveNumericFilters\(\)/);
  assert.match(controlsSource, /state\.rawRows = hasActiveNumericFilters\(\)[\s\S]*?filter\(matchesNumericFilters\)[\s\S]*?: originalRows/);
  assert.match(controlsSource, /let airingRowsByProgram = new Map\(\)/);
  assert.match(controlsSource, /return airingRowsByProgram\.get\(id\) \|\| \[\]/);
});

test('airings-ready event avoids an unconditional full library redraw', () => {
  assert.match(controlsSource, /pledge-scorecard-airings-ready[\s\S]*?if \(hasActiveNumericFilters\(\) \|\| state\.sortField === 'library_performance_metric'\)/);
  assert.match(controlsSource, /else \{[\s\S]*?decorateMetricCells\(\);[\s\S]*?syncMetricHeader\(\);/);
});

test('program outlook uses an indexed airing lookup instead of filtering the full history per title', () => {
  assert.match(outlookSource, /let airingRowsByProgram = new Map\(\)/);
  assert.match(outlookSource, /function rebuildAiringRowCacheIfNeeded\(\)/);
  assert.match(outlookSource, /return airingRowsByProgram\.get\(id\) \|\| \[\]/);
  assert.match(outlookSource, /pledge-scorecard-airings-ready', invalidateAiringRowCache/);
});

test('scorecard UI coalesces redraws and does not observe its own subtree mutations', () => {
  assert.match(scoreUiSource, /requestAnimationFrame\(\(\) => \{/);
  assert.match(scoreUiSource, /rowObserver\.observe\(body, \{ childList: true, subtree: false \}\)/);
  assert.doesNotMatch(scoreUiSource, /rowObserver\.observe\(body, \{ childList: true, subtree: true \}\)/);
});


test('ordinary program edits patch saved rows locally instead of reloading the whole library', () => {
  const saveBlock = detailSource.match(/const updateResponse = await App\.data\.updateProgram[\s\S]*?setDetailMode\('view'\);/)?.[0] || '';
  assert.ok(saveBlock, 'normal update save block should be present');
  assert.match(saveBlock, /applyProgramUpdateLocally/);
  assert.match(saveBlock, /App\.listUi\?\.applyLibraryView/);
  assert.doesNotMatch(saveBlock, /App\.app\.refreshAll/);
  assert.match(dataSource, /\.update\(attemptPayload\)[\s\S]*?query\.select\('\*'\)\.limit\(2\)/);
});

test('program editor dropdowns autosave without making dropdown-only changes dirty', () => {
  assert.match(detailSource, /async function autoSaveSelectChange\(event\)/);
  assert.match(detailSource, /target\.tagName !== 'SELECT'/);
  assert.match(detailSource, /constants\.EDITABLE_FIELDS\.includes\(fieldName\)/);
  assert.match(detailSource, /payload\.topic_primary/);
  assert.match(detailSource, /payload\.topic_secondary/);
  assert.match(appSource, /if \(event\.target\?\.tagName === 'SELECT'\) return;/);
  assert.match(appSource, /autoSaveSelectChange\?\.\(event\)/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';

const data = fs.readFileSync(new URL('../assets/js/data.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../assets/js/library-load.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../assets/js/core.js', import.meta.url), 'utf8');
const list = fs.readFileSync(new URL('../assets/js/ui-list.js', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../app-shell.html', import.meta.url), 'utf8');
const version = JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url), 'utf8'));

const rawStart = data.indexOf('async function refreshRawRows()');
const rawEnd = data.indexOf('\n  function getProbeStatusMessage', rawStart);
assert.ok(rawStart >= 0 && rawEnd > rawStart, 'refreshRawRows source block should exist');
const rawBlock = data.slice(rawStart, rawEnd);
assert.doesNotMatch(rawBlock, /AIRINGS_TABLE/, 'initial Program Library rows must not wait for imported airing history');
assert.match(data, /async function refreshAiringHistory\(\)/);
assert.match(data, /fetchAllRows\(constants\.AIRINGS_TABLE\)/);
assert.match(data, /Array\.isArray\(state\.scheduleImportedAiringsCache\)/);
assert.match(loader, /const historyRefresh = App\.data\.refreshAiringHistory\?\.\(\);/);
assert.doesNotMatch(loader, /await App\.data\.refreshAiringHistory/);
assert.match(loader, /Air-date history is updating in the background/);
assert.match(data, /function buildProgramAiringPerformanceIndex\(airingsRows = \[\]\)/);
assert.match(data, /function libraryProgramAveragePledgeHour\(row = \{\}, performanceIndex = null\)/);
assert.match(data, /durations\.some\(\(minutes\) => !\(Number\(minutes\) > 0\)\)/, 'missing duration must exclude the fundraiser rate observation');
assert.match(data, /rates\.reduce\(\(sum, value\) => sum \+ value, 0\) \/ rates\.length/, 'Program Library average must average fundraiser rate observations rather than pool all hours');
assert.match(core, /avgPerPledgeHour\(row\)/);
assert.match(core, /avg_per_pledge_hour: 'Average \$ \/ pledge hour'/);
assert.match(list, /case 'avg_per_pledge_hour'/);
assert.match(list, /derive\.avgPerPledgeHour\(row\)/);
assert.match(shell, /data-sort-field="avg_per_pledge_hour" data-sort-label="Avg \$ \/ pledge hour">Avg \$ \/ pledge hour<\/button>/);
assert.doesNotMatch(shell, /data-sort-label="Avg \$ \/ event">Avg \$ \/ event<\/button>/);
assert.equal(version.appVersion, '0.22.141');

console.log('library fast-load tests passed');
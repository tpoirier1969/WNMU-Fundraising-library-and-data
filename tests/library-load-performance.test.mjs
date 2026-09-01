import assert from 'node:assert/strict';
import fs from 'node:fs';

const data = fs.readFileSync(new URL('../assets/js/data.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../assets/js/library-load.js', import.meta.url), 'utf8');
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
assert.equal(version.appVersion, '0.22.115');

console.log('library fast-load tests passed');

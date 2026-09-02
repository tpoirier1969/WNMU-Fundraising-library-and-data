import assert from 'node:assert/strict';
import fs from 'node:fs';

const analytics = fs.readFileSync(new URL('../assets/js/ui-analytics.js', import.meta.url), 'utf8');
const imports = fs.readFileSync(new URL('../assets/js/ui-imports.js', import.meta.url), 'utf8');
const scheduling = fs.readFileSync(new URL('../assets/js/ui-scheduling.js', import.meta.url), 'utf8');

assert.match(analytics, /function schedulePlacementDedupeKey\(placement = \{\}\)/);
assert.match(analytics, /function dedupeSchedulePlacementsForAnalytics\(placements = \[\]\)/);
assert.match(analytics, /const placementSet = dedupeSchedulePlacementsForAnalytics\(schedule\.placements \|\| \[\]\);/);
assert.match(analytics, /duplicatePlacementsSuppressed/);
assert.match(analytics, /exact duplicate saved placement\(s\) were suppressed from schedule-derived analytics/);

assert.match(imports, /Results Import never creates, merges, repairs, or changes fundraiser schedules/);

assert.match(scheduling, /if \(existingAtSlot && scheduledPlacementMatchesImported\(existingAtSlot, placement\)\)/);
assert.match(scheduling, /existingAtSlot\.importedBroadcastDollars = Number\(placement\.importedBroadcastDollars \|\| 0\) \|\| 0/);
assert.match(scheduling, /if \(placement\.sourceAiringHash\) existingAtSlot\.sourceAiringHash = placement\.sourceAiringHash/);

console.log('v0.22.129 import/schedule reconciliation guardrails are present');

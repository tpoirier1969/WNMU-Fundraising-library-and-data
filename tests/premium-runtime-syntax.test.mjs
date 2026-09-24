import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const runtimeFiles = [
  '../assets/js/premium-analysis.js',
  '../assets/js/premium-historical-evidence.js',
  '../assets/js/premium-data.js',
  '../assets/js/premium-evidence-ui.js',
  '../assets/js/premium-analytics.js',
  '../assets/js/premium-report.js',
  '../assets/js/premium-chart-analysis.js',
  '../assets/js/premium-charts.js',
  '../assets/js/premium-visuals.js',
  '../assets/js/premium-impact-ui.js'
];

for (const path of runtimeFiles) {
  test(`${path} parses as valid JavaScript`, () => {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: path }));
  });
}

test('premium entry modules contain only one top-level IIFE closure', () => {
  for (const path of ['../assets/js/premium-analytics.js','../assets/js/premium-report.js']) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    const closures = source.match(/\n\}\)\(\);/g) || [];
    assert.equal(closures.length, 1, `${path} should not contain appended duplicate modules or fragments`);
    assert.match(source.trimEnd(), /\}\)\(\);$/);
  }
});

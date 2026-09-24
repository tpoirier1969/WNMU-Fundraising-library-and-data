import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const pages = [
  ['reports.html','reports'],
  ['programming-strategy.html','strategy'],
  ['premium-analytics.html','premium'],
  ['premium-report.html','premium-report']
];

test('standalone report pages load the same shared navigation component', () => {
  for (const [path,active] of pages) {
    const html = fs.readFileSync(new URL('../' + path, import.meta.url),'utf8');
    assert.match(html,/standalone-navigation\.css\?v=0\.22\.200/);
    assert.match(html,/standalone-navigation\.js\?v=0\.22\.200/);
    assert.match(html,new RegExp('data-standalone-navigation[^>]+data-active="' + active + '"'));
  }
});

test('shared navigation contains the five main app destinations in the same order', () => {
  const source = fs.readFileSync(new URL('../assets/js/standalone-navigation.js', import.meta.url),'utf8');
  assert.doesNotThrow(() => new vm.Script(source,{filename:'standalone-navigation.js'}));
  const labels = [
    'Program Library',
    'Pledge Scheduling',
    'Import Pledge Report',
    'Performance Analytics',
    'Fundraiser Comparison Lab'
  ];
  let last = -1;
  for (const label of labels) {
    const index = source.indexOf(label);
    assert.ok(index > last,'expected ' + label + ' after prior core navigation item');
    last = index;
  }
  assert.match(source,/Report Center/);
  assert.match(source,/Fundraiser Programming Strategy/);
  assert.match(source,/Premium Analytics/);
});

test('premium pages add Premium Report without changing the shared core navigation', () => {
  const analytics = fs.readFileSync(new URL('../premium-analytics.html', import.meta.url),'utf8');
  const report = fs.readFileSync(new URL('../premium-report.html', import.meta.url),'utf8');
  assert.match(analytics,/data-extras="reports,strategy,premium,premium-report"/);
  assert.match(report,/data-extras="reports,strategy,premium,premium-report"/);
});

test('standalone navigation is hidden from printed reports', () => {
  const css = fs.readFileSync(new URL('../assets/standalone-navigation.css', import.meta.url),'utf8');
  assert.match(css,/@media print\{[\s\S]*?\.standalone-nav-shell\{display:none!important\}/);
});

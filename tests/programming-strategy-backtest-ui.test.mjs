import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

test('historical backtest page is linked and uses the current strategy worker', () => {
  const page = fs.readFileSync(new URL('../programming-strategy-backtest.html', import.meta.url), 'utf8');
  const strategyPage = fs.readFileSync(new URL('../programming-strategy.html', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../assets/js/programming-strategy-backtest-ui.js', import.meta.url), 'utf8');
  const version = JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url), 'utf8'));

  assert.doesNotThrow(() => new vm.Script(ui, { filename:'programming-strategy-backtest-ui.js' }));
  assert.match(page, /programming-strategy-backtest-ui\.js\?v=0\.22\.209/);
  assert.match(page, /Fundraiser Strategy Backtest/);
  assert.match(strategyPage, /href="programming-strategy-backtest\.html">Historical backtest/);
  assert.match(strategyPage, /programming-strategy-report\.js\?v=0\.22\.209/);
  assert.match(ui, /programming-strategy-worker\.js\?v=0\.22\.209/);
  assert.match(ui, /mode:'backtest'/);
  assert.match(ui, /Not aired · untestable/);
  assert.equal(version.appVersion, '0.22.208');
});

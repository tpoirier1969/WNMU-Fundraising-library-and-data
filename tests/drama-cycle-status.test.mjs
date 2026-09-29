import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('Program Library exposes and saves explicit Drama Doc cycle status', () => {
  const shell=fs.readFileSync(new URL('../app-shell.html',import.meta.url),'utf8');
  const core=fs.readFileSync(new URL('../assets/js/core.js',import.meta.url),'utf8');
  const detail=fs.readFileSync(new URL('../assets/js/ui-detail.js',import.meta.url),'utf8');
  assert.match(shell,/name="drama_cycle_status"/);
  assert.match(shell,/Current series \/ season/);
  assert.match(shell,/Older series \/ season/);
  assert.match(core,/'drama_cycle_status'/);
  assert.match(detail,/form\.elements\.drama_cycle_status\.value/);
  assert.match(detail,/drama_cycle_status:\s*utils\.normalizeText\(form\.elements\.drama_cycle_status\.value\)/);
});

test('explicit Drama cycle beats rights-date inference', () => {
  const source=fs.readFileSync(new URL('../assets/js/programming-strategy-analysis.js',import.meta.url),'utf8');
  const context={console,Date,Map,Set,Math,Number,String,Object,Array,RegExp,Intl};
  context.globalThis=context;
  vm.runInNewContext(source,context,{filename:'programming-strategy-analysis.js'});
  const S=context.WNMUProgrammingStrategyAnalysis;
  const schedule={startDate:'2026-12-05',endDate:'2026-12-13'};
  const current=S.dramaInfo({
    title:'Old rights, explicit current',
    topic_primary:'Drama Doc',
    rights_start:'2024-01-01',
    drama_cycle_status:'current'
  },schedule,new Map());
  const older=S.dramaInfo({
    title:'Recent rights, explicit older',
    topic_primary:'Drama Doc',
    rights_start:'2026-09-01',
    drama_cycle_status:'older'
  },schedule,new Map());
  assert.equal(current.basis,'explicit');
  assert.equal(current.currentCycle,true);
  assert.equal(older.basis,'explicit');
  assert.equal(older.olderCycle,true);
});

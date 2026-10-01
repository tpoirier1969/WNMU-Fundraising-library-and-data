import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('Program Library exposes and saves companion program status', () => {
  const shell=fs.readFileSync(new URL('../app-shell.html',import.meta.url),'utf8');
  const core=fs.readFileSync(new URL('../assets/js/core.js',import.meta.url),'utf8');
  const detail=fs.readFileSync(new URL('../assets/js/ui-detail.js',import.meta.url),'utf8');
  const report=fs.readFileSync(new URL('../assets/js/programming-strategy-report.js',import.meta.url),'utf8');
  const migration=fs.readFileSync(new URL('../13_add_companion_program_status_v0.22.245.sql',import.meta.url),'utf8');

  assert.match(shell,/name="companion_program_status"/);
  assert.match(shell,/Current companion/);
  assert.match(shell,/Dated companion/);
  assert.match(core,/'companion_program_status'/);
  assert.match(detail,/form\.elements\.companion_program_status\.value/);
  assert.match(detail,/companion_program_status:\s*utils\.normalizeText\(form\.elements\.companion_program_status\.value\)/);
  assert.match(report,/'companion_program_status'/);
  assert.match(migration,/companion_program_status/);
});

test('dated companion rule applies to any topic and only opens in the 5-7 Web-only experiment', () => {
  const source=fs.readFileSync(new URL('../assets/js/programming-strategy-analysis.js',import.meta.url),'utf8');
  const context={console,Date,Map,Set,Math,Number,String,Object,Array,RegExp,Intl};
  context.globalThis=context;
  vm.runInNewContext(source,context,{filename:'programming-strategy-analysis.js'});
  const S=context.WNMUProgrammingStrategyAnalysis;

  assert.equal(S.companionProgramStatus({companion_program_status:'dated'}),'dated');
  assert.equal(S.companionProgramStatus({companion_program_status:'current'}),'current');
  assert.equal(S.companionProgramStatus({}),'');
  
  const datedMusic={
    programId:'dated-music',
    title:'Concert Series Retrospective',
    topic:'Music',
    score:68,
    evidenceCount:3,
    newTitle:true,
    reviewedNew:false,
    companionStatus:'dated',
    drama:{isDramaDoc:false,currentCycle:false},
    programmer:{rating:'neutral'},
    season:{holidayOutOfSeason:false},
    titleHistory:{rows:0,latest:null}
  };
  const regularMusic={
    ...datedMusic,
    programId:'regular-music',
    title:'Standalone Concert',
    companionStatus:''
  };

  assert.equal(S.recommendationAllowed(datedMusic,{webOnlyExperimental:false}),false);
  assert.equal(S.recommendationAllowed(datedMusic,{webOnlyExperimental:true}),true);

  const normal=S.selectRecommendationsForSlot(
    [datedMusic,regularMusic],
    4,
    {webOnlyExperimental:false,date:'2026-12-01'}
  );
  assert.deepEqual(Array.from(normal,item=>item.title),['Standalone Concert']);

  const webOnly=S.selectWebOnlyRecommendationsForSlot(
    [datedMusic],
    new Map(),
    {webOnlyExperimental:true,date:'2026-12-01'},
    8
  );
  assert.deepEqual(Array.from(webOnly,item=>item.title),['Concert Series Retrospective']);
});

test('dated companion status can deliberately route an older Drama Doc to 5-7 without reopening prime', () => {
  const source=fs.readFileSync(new URL('../assets/js/programming-strategy-analysis.js',import.meta.url),'utf8');
  const context={console,Date,Map,Set,Math,Number,String,Object,Array,RegExp,Intl};
  context.globalThis=context;
  vm.runInNewContext(source,context,{filename:'programming-strategy-analysis.js'});
  const S=context.WNMUProgrammingStrategyAnalysis;

  const item={
    programId:'dated-drama',
    title:'Series Celebration from Earlier Seasons',
    topic:'Drama Doc',
    score:65,
    newTitle:false,
    companionStatus:'dated',
    drama:{isDramaDoc:true,currentCycle:false,basis:'explicit'},
    programmer:{rating:'neutral'},
    season:{holidayOutOfSeason:false},
    titleHistory:{rows:2,latest:'2025-01-01'}
  };

  assert.equal(S.dramaDocRecommendationAllowed(item),false);
  assert.equal(S.recommendationAllowed(item,{webOnlyExperimental:false}),false);
  assert.equal(S.recommendationAllowed(item,{webOnlyExperimental:true}),true);
});


test('historical backtests do not project present-day companion status backward', () => {
  const worker=fs.readFileSync(new URL('../assets/js/programming-strategy-worker.js',import.meta.url),'utf8');
  const backtestUi=fs.readFileSync(new URL('../assets/js/programming-strategy-backtest-ui.js',import.meta.url),'utf8');
  assert.match(worker,/companion_program_status:\s*null/);
  assert.match(worker,/companionProgramStatus:\s*null/);
  assert.match(backtestUi,/'companion_program_status'/);
});


test('dated companion is not protected out of 5-7 by a theoretical staffed score', () => {
  const source=fs.readFileSync(new URL('../assets/js/programming-strategy-analysis.js',import.meta.url),'utf8');
  const context={console,Date,Map,Set,Math,Number,String,Object,Array,RegExp,Intl};
  context.globalThis=context;
  vm.runInNewContext(source,context,{filename:'programming-strategy-analysis.js'});
  const S=context.WNMUProgrammingStrategyAnalysis;

  const dated={
    programId:'dated-companion',
    title:'Dated Series Celebration',
    topic:'Documentary',
    score:66,
    evidenceCount:3,
    newTitle:false,
    reviewedNew:false,
    companionStatus:'dated',
    drama:{isDramaDoc:false,currentCycle:false},
    programmer:{rating:'neutral'},
    season:{holidayOutOfSeason:false},
    titleHistory:{rows:2,latest:'2025-01-01'}
  };
  const staffedBest=new Map([['dated-companion',{score:95}]]);
  const selected=S.selectWebOnlyRecommendationsForSlot(
    [dated],
    staffedBest,
    {webOnlyExperimental:true,date:'2026-12-01'},
    8
  );
  assert.equal(selected.length,1);
  assert.equal(selected[0].title,'Dated Series Celebration');
  assert.ok(selected[0].webOnlyPriority < 5);
});

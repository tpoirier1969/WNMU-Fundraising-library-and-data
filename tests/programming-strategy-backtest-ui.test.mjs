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
  assert.match(page, /programming-strategy-backtest-ui\.js\?v=0\.22\.267/);
  assert.match(page, /Fundraiser Strategy Backtest/);
  assert.match(page, /programming-strategy-backtest\.js\?v=0\.22\.266/);
  assert.match(page, /id="backtest-run-all"/);
  assert.match(strategyPage, /href="programming-strategy-backtest\.html">Historical backtest/);
  assert.match(strategyPage, /programming-strategy-report\.js\?v=0\.22\.263/);
  assert.match(ui, /programming-strategy-worker\.js\?v=0\.22\.267/);
  assert.match(ui, /mode:'backtest'/);
  assert.match(ui, /source_id,evidence_scope,season,observation_date/);
  assert.match(ui, /pledge_peer_evidence_sources/);
  assert.match(ui, /__source_date:peerSourceDateById/);
  assert.match(ui, /drama_cycle_status/);
  assert.match(ui, /fundraisingWindows:Array\.isArray\(saved\.fundraisingWindows\)/);
  assert.match(ui, /Topic \+ time answer sheet/);
  assert.match(ui, /Multi-fundraiser calibration audit/);
  const worker = fs.readFileSync(new URL('../assets/js/programming-strategy-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /function peerEvidenceStatus\(item = \{\}\)/);
  assert.match(worker, /results_incomplete/);
  assert.match(worker, /positiveEligible/);
  assert.match(worker, /Contextual \/ undated/);
  assert.match(ui, /aggregateBacktests/);
  assert.match(ui, /Not aired · untestable/);
  assert.equal(version.appVersion, '0.22.267');
});


test('multi-fundraiser calibration aggregates only tested recommended windows', () => {
  const source = fs.readFileSync(new URL('../assets/js/programming-strategy-backtest.js', import.meta.url), 'utf8');
  const context = { console, Date, Map, Set, Math, Number, String, Object, Array, RegExp, Intl };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename:'programming-strategy-backtest.js' });
  const B = context.WNMUStrategyBacktest;
  const make = (title, score, rate, medianRate, flags = {}) => ({
    schedule:{title,startDate:'2026-01-01',endDate:'2026-01-10'},
    leakageSafe:true,
    targetScheduleFound:true,
    drive:{titleCount:4,medianTitleRate:medianRate},
    summary:{windowTestedRecommendations:1,windowAboveMedianHits:rate>medianRate?1:0,windowTopQuartileHits:0,topActualCoverage:.5},
    recommendationResults:[{
      title,
      topic:flags.topic||'Music',
      score,
      observedInRecommendedWindow:true,
      matchedWindowRate:rate,
      matchedWindowAboveMedian:rate>medianRate,
      matchedWindowTopQuartile:false,
      newTitle:!!flags.newTitle,
      reviewedNew:!!flags.reviewedNew,
      newSeasonalFitActive:!!flags.newSeasonalFitActive,
      recommendedWindows:[{label:'Prime'}],
      matchedRecommendedWindows:[{label:'Prime',airings:1,rate,aboveMedian:rate>medianRate,topQuartile:false}]
    }],
    topicTime:{signalResults:[]}
  });
  const out = B.aggregateBacktests([
    make('Fresh seasonal',82,200,100,{newTitle:true,newSeasonalFitActive:true}),
    make('Repeat',72,80,100,{})
  ]);
  assert.equal(out.windowTests,2);
  assert.equal(out.aboveMedianHits,1);
  assert.equal(out.scoreBands[0].label,'80+');
  assert.equal(out.scoreBands[0].aboveMedianRate,1);
  assert.ok(out.recommendationClasses.some(row => row.label === 'New seasonal fit'));
  assert.ok(out.recommendationClasses.some(row => row.label === 'Repeat / established'));
  assert.equal(out.dayparts.length,1);
  assert.equal(out.dayparts[0].label,'Prime');
  assert.equal(out.dayparts[0].tests,2);
});

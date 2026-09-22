import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function loadModule(path, exportName, context = null) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const sandbox = context || { console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { api: sandbox[exportName], context: sandbox, source };
}

const analysisLoaded = loadModule('../assets/js/premium-chart-analysis.js','WNMUPremiumChartAnalysis');
const X = analysisLoaded.api;
const chartLoaded = loadModule('../assets/js/premium-charts.js','WNMUPremiumCharts');
const C = chartLoaded.api;

test('workhorse score rewards both net dollars and donor reach', () => {
  const leaders = X.workhorseLeaders([
    {description:'One whale',fundraiserLabel:'A',pledgeCount:1,pledgedDollars:1000,totalPremiumCost:0,estimatedNetAfterPremium:1000},
    {description:'Broad performer',fundraiserLabel:'A',pledgeCount:10,pledgedDollars:900,totalPremiumCost:100,estimatedNetAfterPremium:800},
    {description:'Lots of tiny pledges',fundraiserLabel:'A',pledgeCount:12,pledgedDollars:300,totalPremiumCost:100,estimatedNetAfterPremium:200}
  ],3);
  assert.equal(leaders[0].description,'Broad performer');
  assert.ok(leaders[0].workhorseScore > leaders[1].workhorseScore);
  assert.ok(leaders[0].workhorseScore > leaders[2].workhorseScore);
});

test('composition mix can switch among additive metrics', () => {
  const rows = [
    {fundraiserLabel:'March 2025',fundraiserKey:'2025-03',packageCompositionLabel:'DVD + Book',pledgeCount:2,pledgedDollars:300,sentCost:30,outstandingCost:0},
    {fundraiserLabel:'March 2025',fundraiserKey:'2025-03',packageCompositionLabel:'CD',pledgeCount:1,pledgedDollars:100,sentCost:10,outstandingCost:0},
    {fundraiserLabel:'June 2025',fundraiserKey:'2025-06',packageCompositionLabel:'DVD + Book',pledgeCount:3,pledgedDollars:450,sentCost:50,outstandingCost:0}
  ];
  const net = X.compositionMix(rows,'net');
  const pledges = X.compositionMix(rows,'pledges');
  assert.deepEqual([...net.categories],['March 2025','June 2025']);
  assert.equal(net.series.find((s)=>s.label==='DVD + Book').values[0],270);
  assert.equal(pledges.series.find((s)=>s.label==='DVD + Book').values[1],3);
});

test('topic composition heatmap aggregates the selected metric', () => {
  const rows = [
    {topicPrimary:'Music',packageCompositionLabel:'DVD + CD',pledgeCount:2,pledgedDollars:300,sentCost:30,outstandingCost:0},
    {topicPrimary:'Music',packageCompositionLabel:'DVD + CD',pledgeCount:1,pledgedDollars:150,sentCost:20,outstandingCost:0},
    {topicPrimary:'Travel',packageCompositionLabel:'Book',pledgeCount:2,pledgedDollars:200,sentCost:10,outstandingCost:0}
  ];
  const heat = X.topicCompositionHeatmap(rows,'net',10,8);
  const music = heat.topics.indexOf('Music');
  const dvdCd = heat.compositions.indexOf('DVD + CD');
  assert.equal(heat.values[music][dvdCd],400);
});

test('brand pie uses mutually exclusive brand-scope rows', () => {
  const pie = X.brandPie([
    {scope:'WNMU / local',pledgeCount:5,pledgedDollars:500,estimatedNetAfterPremium:430},
    {scope:'Program / title',pledgeCount:10,pledgedDollars:1400,estimatedNetAfterPremium:1200}
  ],'pledges');
  assert.deepEqual(JSON.parse(JSON.stringify(pie)),[
    {label:'WNMU / local',value:5},
    {label:'Program / title',value:10}
  ]);
});

test('chart renderer produces bars, pie, combo, stacked bars, and heat map without external chart libraries', () => {
  assert.match(C.horizontalBars([{label:'DVD + Book',value:300}],{formatter:C.money}),/<svg/);
  assert.match(C.groupedBars(['March'],[{label:'A',values:[2]},{label:'B',values:[3]}]),/<rect/);
  assert.match(C.stackedBars(['March'],[{label:'DVD',values:[2]},{label:'Book',values:[1]}]),/premium-chart-legend/);
  assert.match(C.percentCombo(['March'],[.5],[.1]),/<polyline/);
  assert.match(C.pie([{label:'WNMU',value:4},{label:'Program',value:6}]),/premium-pie-chart/);
  assert.match(C.heatmap({topics:['Music'],compositions:['DVD'],values:[[100]]},{formatter:C.money}),/premium-heatmap/);
});

test('premium analytics and report pages load the shared visual files and analytics page exposes all chart controls', () => {
  const analytics = fs.readFileSync(new URL('../premium-analytics.html', import.meta.url),'utf8');
  const report = fs.readFileSync(new URL('../premium-report.html', import.meta.url),'utf8');
  for (const source of [analytics, report]) {
    assert.match(source,/premium-chart-analysis\.js\?v=0\.22\.191/);
    assert.match(source,/premium-charts\.js\?v=0\.22\.191/);
    assert.match(source,/premium-visuals\.js\?v=0\.22\.191/);
  }
  for (const id of [
    'premium-workhorse-list','premium-composition-net-chart','premium-efficiency-chart','premium-mix-metric',
    'premium-average-pledge-chart','premium-take-rate-chart','premium-rank-metric','premium-rank-direction',
    'premium-brand-grouped-chart','premium-brand-pie-chart','premium-heatmap-metric','premium-topic-composition-heatmap'
  ]) {
    assert.match(analytics,new RegExp(`id=["']${id}["']`));
  }
});

test('visual implementation contains no scatter-plot dependency or canvas chart library', () => {
  const visuals = fs.readFileSync(new URL('../assets/js/premium-visuals.js', import.meta.url),'utf8');
  const charts = fs.readFileSync(new URL('../assets/js/premium-charts.js', import.meta.url),'utf8');
  assert.doesNotMatch(visuals,/scatter/i);
  assert.doesNotMatch(charts,/new\s+Chart\s*\(/);
});

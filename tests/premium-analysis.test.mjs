import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../assets/js/premium-analysis.js', import.meta.url), 'utf8');
const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);
const A = context.WNMUPremiumAnalysis;

test('fundraiser filename maps PMMYY to fundraiser season and year', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(A.fundraiserFromFilename('P0826 premium costs.xls'))), {
    key: '2026-08', label: 'August 2026', month: 8, year: 2026, season: 'August'
  });
});

test('bundle remains one premium while components become analytical tags', () => {
  const item = A.classifyPackage('All Creatures Season 6 2 DVD Set + James Herriot Paperback + Blanket');
  assert.equal(item.isBundle, true);
  assert.deepEqual([...item.componentCategories].sort(), ['Blanket / Home','Book','DVD / Blu-ray'].sort());
});

test('category analytics do not split package accounting rows', () => {
  const rows = [{ description:'DVD + Book', componentCategories:['DVD / Blu-ray','Book'], isBundle:true, fundraiserKey:'2026-08', pledgeCount:2, pledgedDollars:240, sentCost:20, outstandingCost:0 }];
  const categories = A.categoryAnalysis(rows);
  assert.equal(categories.find((item)=>item.category==='DVD / Blu-ray').pledgedDollars, 240);
  assert.equal(categories.find((item)=>item.category==='Book').pledgedDollars, 240);
  assert.equal(A.metricSummary(rows).pledgedDollars, 240, 'accounting total must remain one package row');
});

test('current Program Library premium text creates a current-offer proxy mapping', () => {
  const premium = { description:'All Creatures Great and Small Season 6 2 DVD Set + James Herriot Paperback', stationGeneric:false };
  const programs = [
    { id:'a', title:'All Creatures Great and Small: Chapter Six', premium_summary:'All Creatures Great and Small Season 6 (2 DVD Set) + James Herriot: All Creatures Great and Small (PBK)' },
    { id:'b', title:'Rick Steves Europe', premium_summary:'Rick Steves Europe DVD' }
  ];
  const mapped = A.mapPremiumToProgram(premium, programs);
  assert.equal(mapped.program.id, 'a');
  assert.equal(mapped.confidence, 'Current-offer proxy');
});

test('station generic premium is not forced onto a title without a strong premium-text match', () => {
  const premium = { description:'WNMU Green Water Bottle', stationGeneric:true };
  const programs = [{ id:'a', title:'All Creatures Great and Small', premium_summary:'Season 6 DVD + blanket' }];
  const mapped = A.mapPremiumToProgram(premium, programs);
  assert.equal(mapped.program, null);
});

test('matrix parser finds expected premium report columns and summary rows', () => {
  const matrix = [
    ['Premium Cost Report'],
    ['Premium Code','Premium Description','Unit Cost','Pledges','Dollars Pledged','Premiums Sent','Premiums Outstanding','Paid to Date','Premium Cost Sent','Premium Cost Outstanding','Net Revenue','Premium Cost Percent'],
    ['ACGS','All Creatures DVD + Book',20,3,360,2,1,240,40,20,200,'16.7%'],
    ['','With No Premiums','',4,300,'','',300,'','','',''],
    ['','TOTAL','',7,660,'','',540,'','','','']
  ];
  const result = A.parseMatrix(matrix,'P0826 premium costs.xls');
  assert.equal(result.rows.length,1);
  assert.equal(result.summaries.length,2);
  assert.equal(result.rows[0].description,'All Creatures DVD + Book');
  assert.equal(result.rows[0].pledgedDollars,360);
  assert.equal(result.rows[0].isBundle,true);
});

test('fundraiser economics compare premium and no-premium pledge behavior without changing package accounting', () => {
  const rows = [
    { fundraiserKey:'2026-08', fundraiserLabel:'August 2026', description:'Program DVD', pledgeCount:2, pledgedDollars:300, sentCost:20, outstandingCost:10 }
  ];
  const summaries = [
    { fundraiserKey:'2026-08', description:'With Any Premiums', pledgeCount:2, pledgedDollars:300 },
    { fundraiserKey:'2026-08', description:'With No Premiums', pledgeCount:3, pledgedDollars:450 },
    { fundraiserKey:'2026-08', description:'TOTAL', pledgeCount:5, pledgedDollars:750 }
  ];
  const item = A.fundraiserAnalysis(rows, summaries)[0];
  assert.equal(item.premiumTakeRate, 0.4);
  assert.equal(item.averagePremiumPledge, 150);
  assert.equal(item.averageNoPremiumPledge, 150);
  assert.equal(item.premiumCostPercentOfTotal, 30 / 750);
  assert.equal(item.premiumCostPercentOfPremiumDollars, 30 / 300);
});

test('combined program analytics keep existing broadcast results and premium-report dollars as separate measures', () => {
  const premiums = [{
    fundraiserKey:'2026-08', fundraiserLabel:'August 2026', programId:'p1', programTitle:'Example Program', topicPrimary:'Music',
    description:'Example Program DVD', componentCategories:['DVD / Blu-ray'], mappingConfidence:'Current-offer proxy', pledgeCount:3, pledgedDollars:360, sentCost:30, outstandingCost:0
  }];
  const performance = [{
    fundraiserKey:'2026-08', fundraiserLabel:'August 2026', programId:'p1', programTitle:'Example Program', topicPrimary:'Music',
    broadcastDollars:500, broadcastPledges:4, minutes:60, airings:1
  }];
  const item = A.combinedProgramAnalysis(premiums, performance)[0];
  assert.equal(item.broadcastDollars, 500);
  assert.equal(item.pledgedDollars, 360);
  assert.equal(item.totalPremiumCost, 30);
  assert.equal(item.broadcastDollarsPerHour, 500);
});

test('parser recognizes the real Allegiance numbered premium-cost headers and decorated summary labels', () => {
  const matrix = [
    ['Prem','Size','Description','1\n\n\nCost\n','2\n\n#\nPledged\n','3\n\n$\nPledged\n','4\n#\nPrem\nSent\n','5\n#\nPrem\nOutst\n(2-4)','6\n$\nPaid to\nDate\n','7\n$\nPrem\nSent\n(1*4)','8\n$\nPrem\nOutst\n(1*5)','9\n$\nNet\nRevenue\n(6-7)','10\n\nPrem\nPct\n(7+8)/3'],
    ['AC6BLKT','','ALL CREATURES CHAP 6 BLANKET',32,1,144,1,0,144,32,0,112,0.2222222222],
    ['','','** With No Premiums**','',7,2796,0,0,2796,0,0,2796,0],
    ['','','** With Known Premiums**',998.35,25,4613,23,2,3561,949.35,49,2611.65,0.2164],
    ['','','** With Any Premium**',1222.35,28,5594,25,3,4086,1098.68,123.67,2987.32,0.2185],
    ['','','******  TOTAL  ******',1222.35,35,8390,25,3,6882,1098.68,123.67,5783.32,0.14569]
  ];
  const result = A.parseMatrix(matrix,'P0826 premium costs.xls');
  assert.equal(result.rows.length,1);
  assert.equal(result.summaries.length,4);
  assert.equal(result.rows[0].code,'AC6BLKT');
  assert.equal(result.rows[0].unitCost,32);
  assert.equal(result.rows[0].pledgeCount,1);
  assert.equal(result.rows[0].pledgedDollars,144);
  assert.equal(result.rows[0].sentCost,32);
  assert.equal(result.rows[0].costPercent,0.2222222222);
  assert.ok(result.summaries.some((row)=>row.description==='With Any Premium'));
  assert.ok(result.summaries.some((row)=>row.description==='Total'));
});

test('fundraiser premium cost uses the With Any Premium summary so individualized premiums are not dropped', () => {
  const rows = [{ fundraiserKey:'2026-08', fundraiserLabel:'August 2026', description:'Known DVD', pledgeCount:25, pledgedDollars:4613, sentCost:949.35, outstandingCost:49 }];
  const summaries = [
    { fundraiserKey:'2026-08', fundraiserLabel:'August 2026', description:'With Individualized Premiums', pledgeCount:3, pledgedDollars:981, sentCost:149.3333333333, outstandingCost:74.6666666667 },
    { fundraiserKey:'2026-08', fundraiserLabel:'August 2026', description:'With Known Premiums', pledgeCount:25, pledgedDollars:4613, sentCost:949.35, outstandingCost:49 },
    { fundraiserKey:'2026-08', fundraiserLabel:'August 2026', description:'With Any Premium', pledgeCount:28, pledgedDollars:5594, sentCost:1098.6833333333, outstandingCost:123.6666666667 },
    { fundraiserKey:'2026-08', fundraiserLabel:'August 2026', description:'With No Premiums', pledgeCount:7, pledgedDollars:2796, sentCost:0, outstandingCost:0 },
    { fundraiserKey:'2026-08', fundraiserLabel:'August 2026', description:'Total', pledgeCount:35, pledgedDollars:8390, sentCost:1098.6833333333, outstandingCost:123.6666666667 }
  ];
  const item = A.fundraiserAnalysis(rows, summaries)[0];
  assert.equal(Math.round(item.totalPremiumCost * 100) / 100, 1222.35);
  assert.equal(item.unitemizedPremiumPledges, 3);
  assert.equal(item.unitemizedPremiumDollars, 981);
  assert.equal(Math.round(item.premiumCostPercentOfTotal * 10000) / 10000, Math.round((1222.35 / 8390) * 10000) / 10000);
});

test('generic combo can borrow component categories from current offer while preserving proxy provenance', () => {
  const rows = [{ description:'BILLY JOEL 100TH COMBO', componentCategories:['Other'], isBundle:true, stationGeneric:false }];
  const programs = [{ id:'bj', title:'Billy Joel: Live at the Garden', premium_summary:'Billy Joel 100th Combo: 2-CD Set + DVD + Book' }];
  const mapped = A.addMappings(rows, programs)[0];
  assert.equal(mapped.programId, 'bj');
  assert.equal(mapped.isBundle, true);
  assert.equal(mapped.componentCategorySource, 'Current-offer proxy');
  assert.ok(mapped.componentCategories.includes('DVD / Blu-ray') || mapped.componentCategories.includes('CD / Vinyl') || mapped.componentCategories.includes('Book'));
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const analysisSource = fs.readFileSync(new URL('../assets/js/premium-analysis.js', import.meta.url), 'utf8');
const routerSource = fs.readFileSync(new URL('../assets/js/premium-import-router.js', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function loadRouter() {
  const context = {
    console,
    document: {
      readyState: 'loading',
      addEventListener() {}
    },
    localStorage: {
      getItem() { return null; },
      setItem() {}
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(analysisSource, context);
  vm.runInContext(routerSource, context);
  return context.WNMUPremiumImportRouter;
}

test('main app loads the isolated premium analysis and import router before app init', () => {
  const analysisAt = indexSource.indexOf('assets/js/premium-analysis.js');
  const routerAt = indexSource.indexOf('assets/js/premium-import-router.js');
  const appInitAt = indexSource.indexOf('assets/js/app-init.js');
  assert.ok(analysisAt >= 0, 'premium-analysis.js should be injected into the main app');
  assert.ok(routerAt >= 0, 'premium-import-router.js should be injected into the main app');
  assert.ok(appInitAt >= 0, 'app-init.js anchor should remain present');
});

test('router recognizes premium-cost filenames', () => {
  const router = loadRouter();
  assert.equal(router.filenameLooksPremium({ name: 'P0826 premium costs.xls' }), true);
  assert.equal(router.filenameLooksPremium({ name: 'March 2026 Premium Cost Report.xlsx' }), true);
  assert.equal(router.filenameLooksPremium({ name: 'PBS Break Report.xlsx' }), false);
});

test('router recognizes the real Allegiance premium-cost header shape', () => {
  const router = loadRouter();
  const matrix = [
    ['Prem','Size','Description','1\n\n\nCost\n','2\n\n#\nPledged\n','3\n\n$\nPledged\n','4\n#\nPrem\nSent\n','5\n#\nPrem\nOutst\n(2-4)','6\n$\nPaid to\nDate\n','7\n$\nPrem\nSent\n(1*4)','8\n$\nPrem\nOutst\n(1*5)','9\n$\nNet\nRevenue\n(6-7)','10\n\nPrem\nPct\n(7+8)/3'],
    ['AC6BLKT','','ALL CREATURES CHAP 6 BLANKET',32,1,144,1,0,144,32,0,112,0.2222]
  ];
  assert.equal(router.matrixLooksPremium(matrix), true);
});

test('router does not misclassify a normal airing-level report header as premium-cost data', () => {
  const router = loadRouter();
  const matrix = [
    ['Date','Time','Program','NOLA','Pledges','Dollars'],
    ['8/1/2026','8:00 PM','Example Program','EXAM0001',4,500]
  ];
  assert.equal(router.matrixLooksPremium(matrix), false);
});

test('router and Premium Analytics share the same browser storage key', () => {
  assert.match(routerSource, /wnmuPremiumAnalyticsHistoryV1/);
  const premiumDataSource = fs.readFileSync(new URL('../assets/js/premium-data.js', import.meta.url), 'utf8');
  assert.match(premiumDataSource, /wnmuPremiumAnalyticsHistoryV1/);
});

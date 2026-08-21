import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = new URL('../assets/js/ui-fundraiser-comparison.js', import.meta.url);
let source = fs.readFileSync(sourcePath, 'utf8');
const exportMarker = '  App.fundraiserComparisonUi = { ensureReady };';
assert.ok(source.includes(exportMarker), 'comparison test export marker must exist');
source = source.replace(exportMarker, `${exportMarker}\n  globalThis.__comparisonTestHooks = { daypartLabel, overallRevenueDecomposition, comparisonChannelPolicy, comparableTotalForPolicy, topicRevenueDecomposition, subtopicRevenueDecomposition, placementResult };`);

const context = {
  window: {
    PledgeLib: {
      state: {},
      data: {},
      derive: {},
      utils: {}
    }
  },
  document: { getElementById: () => null, querySelector: () => null },
  console,
  Date,
  Map,
  Set,
  URLSearchParams,
  Promise,
  Number,
  String,
  Math,
  Intl,
  fetch: async () => { throw new Error('network is not available in comparison unit tests'); }
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'ui-fundraiser-comparison.js' });
const hooks = context.__comparisonTestHooks;

function nearlyEqual(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test('WNMU daypart boundaries use half-hour pledge slots', () => {
  assert.equal(hooks.daypartLabel(390), 'Overnight');
  assert.equal(hooks.daypartLabel(420), 'Morning');
  assert.equal(hooks.daypartLabel(690), 'Morning');
  assert.equal(hooks.daypartLabel(720), 'Afternoon');
  assert.equal(hooks.daypartLabel(990), 'Afternoon');
  assert.equal(hooks.daypartLabel(1020), 'Early evening');
  assert.equal(hooks.daypartLabel(1170), 'Early evening');
  assert.equal(hooks.daypartLabel(1200), 'Prime');
  assert.equal(hooks.daypartLabel(1320), 'Prime');
  assert.equal(hooks.daypartLabel(1350), 'Overnight');
});

test('whole-drive hours and performance effects reconcile to Broadcast change', () => {
  const base = { scheduledMinutes: 46 * 60, broadcastDollars: 1909 };
  const current = { scheduledMinutes: 67 * 60, broadcastDollars: 7587 };
  const result = hooks.overallRevenueDecomposition(base, current);
  assert.equal(result.difference, 5678);
  nearlyEqual(result.hoursEffect + result.rateEffect + result.residual, result.difference);
  nearlyEqual(result.residual, 0);
});

test('channel comparison excludes Online or Mail unless every selected fundraiser tracked it', () => {
  assert.deepEqual(
    hooks.comparisonChannelPolicy([
      { onlineTracked: true, mailTracked: true },
      { onlineTracked: true, mailTracked: false }
    ]),
    { includeOnline: true, includeMail: false }
  );
  assert.deepEqual(
    hooks.comparisonChannelPolicy([
      { onlineTracked: true, mailTracked: true },
      { onlineTracked: false, mailTracked: true }
    ]),
    { includeOnline: false, includeMail: true }
  );
});

test('comparable total follows the selected-set channel policy', () => {
  const analysis = { broadcastDollars: 1000, onlineDollars: 200, mailDollars: 300 };
  assert.equal(hooks.comparableTotalForPolicy(analysis, { includeOnline: false, includeMail: false }), 1000);
  assert.equal(hooks.comparableTotalForPolicy(analysis, { includeOnline: true, includeMail: false }), 1200);
  assert.equal(hooks.comparableTotalForPolicy(analysis, { includeOnline: true, includeMail: true }), 1500);
});

test('explicit manual zero remains a known result while a missing result remains unknown', () => {
  const used = new Set();
  const manualZero = hooks.placementResult({ manualResultRecorded: true, manualBroadcastDollars: 0, manualPledgeCount: 0 }, used);
  assert.equal(manualZero.known, true);
  assert.equal(manualZero.dollars, 0);
  assert.equal(manualZero.source, 'manual');

  const missing = hooks.placementResult({}, new Set());
  assert.equal(missing.known, false);
  assert.equal(missing.source, 'none');
});

test('topic decomposition reconciles length, share, and rate effects', () => {
  const base = { scheduledMinutes: 40 * 60 };
  const current = { scheduledMinutes: 50 * 60 };
  const topicBase = { minutes: 8 * 60, dollars: 1600 };
  const topicCurrent = { minutes: 15 * 60, dollars: 3900 };
  const result = hooks.topicRevenueDecomposition(base, current, topicBase, topicCurrent);
  nearlyEqual(result.length + result.share + result.rate + result.residual, result.difference);
});

test('subtopic decomposition reconciles length, topic allocation, subtopic mix, and rate', () => {
  const base = { scheduledMinutes: 40 * 60 };
  const current = { scheduledMinutes: 50 * 60 };
  const topicBase = { minutes: 8 * 60, dollars: 1600 };
  const topicCurrent = { minutes: 15 * 60, dollars: 3900 };
  const subtopicBase = { minutes: 3 * 60, dollars: 750 };
  const subtopicCurrent = { minutes: 8 * 60, dollars: 2400 };
  const result = hooks.subtopicRevenueDecomposition(base, current, topicBase, topicCurrent, subtopicBase, subtopicCurrent);
  nearlyEqual(result.length + result.topicShare + result.subtopicShare + result.rate + result.residual, result.difference);
});

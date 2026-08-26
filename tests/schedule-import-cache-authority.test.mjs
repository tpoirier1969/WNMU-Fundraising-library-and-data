import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/data.js', import.meta.url), 'utf8');

const remoteRows = [{
  id: 'schedule-1',
  title: 'August 2026',
  start_date: '2026-08-08',
  end_date: '2026-08-18',
  schedule_data: {
    placements: [
      {
        id: 'linked',
        sourceAiringHash: 'airing-hash-1',
        importedBroadcastDollars: 840,
        importedPledges: 6,
        importedBroadcastPledges: 6
      },
      {
        id: 'manual-only',
        importedBroadcastDollars: 55
      }
    ]
  }
}];

function queryResult(data) {
  const query = {
    select() { return query; },
    order() { return query; },
    then(resolve, reject) { return Promise.resolve({ data, error: null }).then(resolve, reject); }
  };
  return query;
}

const state = {
  client: { from: () => queryResult(remoteRows) },
  detailCache: {},
  detailPending: {},
  detailQueryHints: {},
  rawRows: [],
  baseRows: [],
  lastProbeSummary: []
};
const App = {
  cfg: {},
  constants: {
    SCHEDULES_TABLE: 'pledge_fundraiser_schedules',
    DEFAULT_DAY_START_HOUR: 7,
    DEFAULT_DAY_END_HOUR: 25,
    DEFAULT_DAY_START_MINUTES: 420,
    DEFAULT_DAY_END_MINUTES: 1500
  },
  state,
  utils: {
    normalizeText: (value) => String(value ?? '').trim()
  },
  derive: {}
};

const context = {
  window: { PledgeLib: App },
  console,
  Promise,
  Date,
  Map,
  Set,
  Number,
  String,
  Array,
  Object,
  RegExp,
  Math,
  Intl,
  URLSearchParams,
  fetch: async () => ({})
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'data.js' });

const schedules = await App.data.fetchSchedulesRemote();
assert.equal(schedules.length, 1);
const linked = schedules[0].placements.find((row) => row.id === 'linked');
const manual = schedules[0].placements.find((row) => row.id === 'manual-only');

assert.equal(linked.sourceAiringHash, 'airing-hash-1');
assert.equal(Object.prototype.hasOwnProperty.call(linked, 'importedBroadcastDollars'), false, 'hashed imported dollars are a cache and must refresh from the authoritative imported row');
assert.equal(Object.prototype.hasOwnProperty.call(linked, 'importedPledges'), false);
assert.equal(Object.prototype.hasOwnProperty.call(linked, 'importedBroadcastPledges'), false);
assert.equal(manual.importedBroadcastDollars, 55, 'unlinked saved results must not be erased');

console.log('schedule imported-result cache authority tests passed');

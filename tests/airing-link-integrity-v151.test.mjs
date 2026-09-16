import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const guardSource = fs.readFileSync(new URL('../assets/js/airing-link-integrity.js', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function makeHarness({ cacheRows = null, fetchedRows = [] } = {}) {
  let capturedRows = null;
  let fetchCount = 0;
  const originalCache = cacheRows;
  const state = {
    baseRows: [
      { id: 55, title: 'Manual target' },
      { id: 77, title: 'Another program' },
      { id: 123, title: 'Chicago & Friends: Live at 55' },
      { id: 938, title: 'American Masters: Mary Oliver: Saved by the Beauty of the World' }
    ],
    rawRows: [],
    scheduleImportedAiringsCache: cacheRows
  };
  const App = {
    state,
    utils: {
      normalizeText(value) { return String(value ?? '').trim(); }
    },
    derive: {
      programId(row) { return row?.id ?? ''; }
    },
    data: {
      async refreshAiringHistory() {
        capturedRows = (state.scheduleImportedAiringsCache || []).map((row) => ({ ...row }));
        return capturedRows;
      },
      async fetchImportedAirings() {
        fetchCount += 1;
        return fetchedRows;
      }
    }
  };
  const context = vm.createContext({ window: { PledgeLib: App }, console });
  new vm.Script(guardSource, { filename: 'airing-link-integrity.js' }).runInContext(context);
  return {
    App,
    state,
    originalCache,
    getCapturedRows: () => capturedRows,
    getFetchCount: () => fetchCount
  };
}

test('airing record id can never become a library program id', async () => {
  const airing = {
    id: 938,
    program_id: 123,
    pledge_program_id: '123',
    imported_program_title: 'Chicago & Friends: Live at 55',
    matched_library_title: 'Chicago & Friends: Live at 55',
    nola_code: 'CHICAGO55',
    air_date: '2024-09-07'
  };
  const harness = makeHarness({ cacheRows: [airing] });

  await harness.App.data.refreshAiringHistory();
  const [safe] = harness.getCapturedRows();

  assert.equal(safe.id, null, 'airing-table primary key must be removed from history linkage input');
  assert.equal(String(safe.program_id), '123');
  assert.equal(String(safe.pledge_program_id), '123');
  assert.notEqual(String(safe.program_id), '938');
  assert.equal(safe.imported_program_title, '', 'linked rows must not leak through stale title fallback');
  assert.equal(safe.nola_code, '', 'linked rows must not leak through stale NOLA fallback');
  assert.strictEqual(harness.state.scheduleImportedAiringsCache, harness.originalCache, 'shared scheduler cache must be restored unchanged');
});

test('manual match is authoritative when choosing the program identity', async () => {
  const harness = makeHarness({
    cacheRows: [{ id: 444, program_id: 77, pledge_program_id: '77', manual_match_program_id: 55, air_date: '2026-06-01' }]
  });

  await harness.App.data.refreshAiringHistory();
  const [safe] = harness.getCapturedRows();
  assert.equal(String(safe.program_id), '55');
  assert.equal(String(safe.pledge_program_id), '55');
  assert.equal(String(safe.manual_match_program_id), '55');
});

test('invalid manual match is quarantined instead of falling back to another stored id', async () => {
  const harness = makeHarness({
    cacheRows: [{ id: 444, program_id: 77, pledge_program_id: '77', manual_match_program_id: 999999, air_date: '2026-06-01' }]
  });

  await harness.App.data.refreshAiringHistory();
  const [safe] = harness.getCapturedRows();
  assert.equal(safe.program_id, null);
  assert.equal(safe.pledge_program_id, null);
  assert.equal(safe.manual_match_program_id, null);
});

test('conflicting machine linkage fields are quarantined instead of guessed', async () => {
  const harness = makeHarness({
    cacheRows: [{ id: 444, program_id: 77, pledge_program_id: '123', air_date: '2026-06-01' }]
  });

  await harness.App.data.refreshAiringHistory();
  const [safe] = harness.getCapturedRows();
  assert.equal(safe.program_id, null);
  assert.equal(safe.pledge_program_id, null);
  assert.equal(safe.manual_match_program_id, null);
});

test('unlinked rows stay quarantined even when their airing id or title resembles a library program', async () => {
  const harness = makeHarness({
    cacheRows: [{
      id: 938,
      imported_program_title: 'American Masters: Mary Oliver: Saved by the Beauty of the World',
      matched_library_title: 'American Masters: Mary Oliver: Saved by the Beauty of the World',
      nola_code: 'AMMS',
      air_date: '2024-09-07'
    }]
  });

  await harness.App.data.refreshAiringHistory();
  const [safe] = harness.getCapturedRows();
  assert.equal(safe.id, null);
  assert.equal(safe.program_id, null);
  assert.equal(safe.pledge_program_id, null);
  assert.equal(safe.manual_match_program_id, null);
  assert.equal(safe.imported_program_title, '');
  assert.equal(safe.matched_library_title, '');
  assert.equal(safe.nola_code, '');
});

test('stale program ids that do not exist in the loaded library cannot create history', async () => {
  const harness = makeHarness({
    cacheRows: [{ id: 700, program_id: 999999, pledge_program_id: '999999', imported_program_title: 'Stale Link', air_date: '2025-01-01' }]
  });

  await harness.App.data.refreshAiringHistory();
  const [safe] = harness.getCapturedRows();
  assert.equal(safe.program_id, null);
  assert.equal(safe.pledge_program_id, null);
  assert.equal(safe.id, null);
});

test('guard also sanitizes rows fetched when the scheduler cache is not warm', async () => {
  const harness = makeHarness({
    cacheRows: null,
    fetchedRows: [{ id: 938, program_id: 123, pledge_program_id: '123', imported_program_title: 'Chicago', air_date: '2024-09-07' }]
  });

  await harness.App.data.refreshAiringHistory();
  assert.equal(harness.getFetchCount(), 1);
  const [safe] = harness.getCapturedRows();
  assert.equal(safe.id, null);
  assert.equal(String(safe.program_id), '123');
  assert.strictEqual(harness.state.scheduleImportedAiringsCache, null);
});

test('integrity guard is loaded before app-init starts the library', () => {
  assert.match(indexSource, /appInit\.before\(airingIntegrity\)/);
  assert.match(indexSource, /assets\/js\/airing-link-integrity\.js/);
});

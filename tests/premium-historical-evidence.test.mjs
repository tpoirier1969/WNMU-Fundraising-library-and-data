import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const analysisSource = fs.readFileSync(new URL('../assets/js/premium-analysis.js', import.meta.url), 'utf8');
const evidenceSource = fs.readFileSync(new URL('../assets/js/premium-historical-evidence.js', import.meta.url), 'utf8');

function load() {
  const store = new Map();
  const context = {
    console,
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); }
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(analysisSource, context);
  vm.runInContext(evidenceSource, context);
  return { A:context.WNMUPremiumAnalysis, H:context.WNMUPremiumHistoricalEvidence, store };
}

const sampleEvidence = {
  schema:'wnmu-premium-historical-evidence-v1',
  generatedAt:'2026-09-24',
  offers:[
    {
      id:'mrrg-2025-12',
      fundraiserKey:'2025-12',
      programTitle:"Mister Rogers: It's You I Like",
      contentIdentifier:'MRRG',
      offerSetId:'MRRG-2025-10',
      offerSummary:'DVD; mug + book; collection',
      evidenceLevel:'Historically verified',
      sourceType:'PBS Program Offer + WNMU schedule',
      sourceDate:'2025-11-06',
      scheduleSourceDate:'2025-11-04',
      selectedPremiumMappings:[
        {code:'MRRVC1',offerTierId:'middle',offerTierLabel:'Mug + book',componentCategories:['Drinkware','Book']}
      ]
    }
  ]
};

test('historical evidence validates and persists in browser storage', () => {
  const { H } = load();
  const checked = H.validateEvidence(sampleEvidence);
  assert.equal(checked.valid,true);
  const saved = H.saveEvidence(sampleEvidence);
  assert.equal(saved.offers.length,1);
  assert.equal(H.loadEvidence().offers[0].offerSetId,'MRRG-2025-10');
});

test('verified historical mapping overrides a proxy mapping for an exact fundraiser premium code', () => {
  const { A, H } = load();
  const base = A.addMappings([
    {
      fundraiserKey:'2025-12',
      fundraiserLabel:'December 2025',
      code:'MRRVC1',
      description:'MR ROGERS YOU I LIKE REV CMB 1',
      pledgeCount:1,
      pledgedDollars:120,
      sentCost:21.25,
      outstandingCost:0
    }
  ],[
    {id:'p1',title:"Mister Rogers: It's You I Like",topic_primary:'Arts & Culture',premium_summary:'Mug + PBK'}
  ]);
  const mapped = H.applyMappings(base,[
    {id:'p1',title:"Mister Rogers: It's You I Like",topic_primary:'Arts & Culture',premium_summary:'Mug + PBK'}
  ],sampleEvidence)[0];

  assert.equal(mapped.mappingConfidence,'Historically verified');
  assert.equal(mapped.mappingMethod,'historical-offer-evidence');
  assert.equal(mapped.programId,'p1');
  assert.equal(mapped.programTitle,"Mister Rogers: It's You I Like");
  assert.equal(mapped.historicalOfferSetId,'MRRG-2025-10');
  assert.equal(mapped.historicalContentIdentifier,'MRRG');
  assert.equal(mapped.packageCompositionLabel,'Book + Drinkware');
});

test('historical evidence does not touch a premium from another fundraiser', () => {
  const { H } = load();
  const row = {
    fundraiserKey:'2026-06',
    code:'MRRVC1',
    description:'MR ROGERS YOU I LIKE REV CMB 1',
    mappingConfidence:'Current-offer proxy'
  };
  const mapped = H.applyMappings([row],[],sampleEvidence)[0];
  assert.equal(mapped.mappingConfidence,'Current-offer proxy');
  assert.equal(mapped.historicalOfferSetId,undefined);
});

test('evidence summary reports offers, programs, fundraisers, and selected mappings', () => {
  const { H } = load();
  const summary = H.summary(sampleEvidence);
  assert.deepEqual(JSON.parse(JSON.stringify(summary)),{
    offerCount:1,
    fundraiserCount:1,
    programCount:1,
    offerSetCount:1,
    selectedMappingCount:1
  });
});

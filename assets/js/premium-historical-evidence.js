(() => {
  'use strict';

  const A = window.WNMUPremiumAnalysis;
  const STORAGE_KEY = 'wnmuPremiumHistoricalEvidenceV1';
  const SCHEMA = 'wnmu-premium-historical-evidence-v1';

  function text(value) {
    return String(value ?? '').trim();
  }

  function normalize(value) {
    return A?.normalize ? A.normalize(value) : text(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  }

  function emptyEvidence() {
    return { schema: SCHEMA, generatedAt: '', offers: [] };
  }

  function normalizeEvidence(document = {}) {
    const offers = Array.isArray(document?.offers) ? document.offers : [];
    return {
      schema: text(document?.schema) || SCHEMA,
      generatedAt: text(document?.generatedAt),
      notes: text(document?.notes),
      offers: offers.map((offer, index) => ({
        id: text(offer.id) || `offer-${index + 1}`,
        fundraiserKey: text(offer.fundraiserKey),
        programTitle: text(offer.programTitle),
        contentIdentifier: text(offer.contentIdentifier),
        offerSetId: text(offer.offerSetId),
        offerSummary: text(offer.offerSummary),
        evidenceLevel: text(offer.evidenceLevel) || 'Historically verified',
        sourceType: text(offer.sourceType) || 'Historical source',
        sourceDate: text(offer.sourceDate),
        scheduleSourceDate: text(offer.scheduleSourceDate),
        rightsStart: text(offer.rightsStart),
        rightsEnd: text(offer.rightsEnd),
        selectedPremiumMappings: Array.isArray(offer.selectedPremiumMappings)
          ? offer.selectedPremiumMappings.map((mapping) => ({
              code: text(mapping.code),
              descriptionContains: text(mapping.descriptionContains),
              offerTierId: text(mapping.offerTierId),
              offerTierLabel: text(mapping.offerTierLabel),
              componentCategories: Array.isArray(mapping.componentCategories)
                ? mapping.componentCategories.map(text).filter(Boolean)
                : []
            }))
          : []
      })).filter((offer) => offer.fundraiserKey && offer.programTitle && offer.offerSetId)
    };
  }

  function validateEvidence(document = {}) {
    const normalized = normalizeEvidence(document);
    const errors = [];
    if (normalized.schema !== SCHEMA) errors.push(`Expected schema "${SCHEMA}".`);
    if (!normalized.offers.length) errors.push('No historical premium offers were found.');
    normalized.offers.forEach((offer, index) => {
      if (!offer.selectedPremiumMappings.length) {
        errors.push(`Offer ${index + 1} (${offer.programTitle}) has no selected-premium mappings.`);
      }
    });
    return { valid: !errors.length, errors, evidence: normalized };
  }

  function loadEvidence() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyEvidence();
      return normalizeEvidence(JSON.parse(raw));
    } catch (error) {
      console.warn('Could not read historical premium evidence from browser storage.', error);
      return emptyEvidence();
    }
  }

  function saveEvidence(document = {}) {
    const checked = validateEvidence(document);
    if (!checked.valid) throw new Error(checked.errors.join(' '));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checked.evidence));
    return checked.evidence;
  }

  function clearEvidence() {
    localStorage.removeItem(STORAGE_KEY);
    return emptyEvidence();
  }

  function premiumMappingMatches(row = {}, mapping = {}) {
    const rowCode = text(row.code).toUpperCase();
    const mappingCode = text(mapping.code).toUpperCase();
    if (mappingCode && rowCode === mappingCode) return true;
    const needle = normalize(mapping.descriptionContains);
    return Boolean(needle && normalize(row.description).includes(needle));
  }

  function findEvidenceMatch(row = {}, document = {}) {
    const evidence = normalizeEvidence(document);
    const candidates = evidence.offers.filter((offer) => offer.fundraiserKey === text(row.fundraiserKey));
    for (const offer of candidates) {
      const selected = offer.selectedPremiumMappings.find((mapping) => premiumMappingMatches(row, mapping));
      if (selected) return { offer, selected };
    }
    return null;
  }

  function findProgram(programTitle, programs = []) {
    const target = normalize(programTitle);
    if (!target) return null;
    const exact = programs.find((program) => normalize(program.title || program.program_title) === target);
    if (exact) return exact;
    if (!A?.similarity) return null;
    const candidates = programs.map((program) => ({
      program,
      score: A.similarity(programTitle, program.title || program.program_title || '')
    })).sort((a,b) => b.score - a.score);
    const best = candidates[0];
    const second = candidates[1];
    if (best && best.score >= 0.82 && (best.score - (second?.score || 0)) >= 0.08) return best.program;
    return null;
  }

  function applyMappings(rows = [], programs = [], document = {}) {
    const evidence = normalizeEvidence(document);
    if (!evidence.offers.length) return rows;

    return rows.map((row) => {
      const match = findEvidenceMatch(row, evidence);
      if (!match) return row;

      const { offer, selected } = match;
      const program = findProgram(offer.programTitle, programs);
      const categories = selected.componentCategories.length
        ? selected.componentCategories
        : (row.componentCategories || []);
      const composition = A?.packageComposition
        ? A.packageComposition(categories, row.isBundle)
        : { key:'', label:categories.join(' + '), parts:categories, complete:true };
      const brand = A?.premiumBrandScope
        ? A.premiumBrandScope({ ...row, programTitle: offer.programTitle }, program, { confidence:'Historically verified' })
        : { scope:'Program / title', evidence:'Historical offer evidence' };

      return {
        ...row,
        componentCategories: categories,
        componentCategorySource: 'Historical offer evidence',
        packageCompositionKey: composition.key,
        packageCompositionLabel: composition.label,
        packageCompositionParts: composition.parts,
        packageCompositionComplete: composition.complete,
        packageCompositionSource: 'Historical offer evidence',
        brandScope: brand.scope || 'Program / title',
        brandScopeEvidence: 'Historical offer evidence',
        mappingMethod: 'historical-offer-evidence',
        mappingConfidence: 'Historically verified',
        mappingScore: 1,
        programId: program?.id || program?.program_id || row.programId || '',
        programTitle: program?.title || program?.program_title || offer.programTitle,
        topicPrimary: program?.topic_primary || row.topicPrimary || '',
        topicSecondary: program?.topic_secondary || row.topicSecondary || '',
        distributor: program?.distributor || row.distributor || '',
        historicalOfferId: offer.id,
        historicalOfferSetId: offer.offerSetId,
        historicalOfferSummary: offer.offerSummary,
        historicalContentIdentifier: offer.contentIdentifier,
        historicalOfferTierId: selected.offerTierId,
        historicalOfferTierLabel: selected.offerTierLabel,
        historicalEvidenceSource: offer.sourceType,
        historicalEvidenceDate: offer.sourceDate,
        historicalScheduleEvidenceDate: offer.scheduleSourceDate,
        historicalRightsStart: offer.rightsStart,
        historicalRightsEnd: offer.rightsEnd
      };
    });
  }

  function summary(document = {}) {
    const evidence = normalizeEvidence(document);
    const fundraiserCount = new Set(evidence.offers.map((offer) => offer.fundraiserKey)).size;
    const programCount = new Set(evidence.offers.map((offer) => normalize(offer.programTitle))).size;
    const offerSetCount = new Set(evidence.offers.map((offer) => offer.offerSetId)).size;
    const selectedMappingCount = evidence.offers.reduce((sum, offer) => sum + offer.selectedPremiumMappings.length, 0);
    return {
      offerCount: evidence.offers.length,
      fundraiserCount,
      programCount,
      offerSetCount,
      selectedMappingCount
    };
  }

  window.WNMUPremiumHistoricalEvidence = {
    STORAGE_KEY,
    SCHEMA,
    emptyEvidence,
    normalizeEvidence,
    validateEvidence,
    loadEvidence,
    saveEvidence,
    clearEvidence,
    findEvidenceMatch,
    applyMappings,
    summary
  };
})();
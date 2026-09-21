(() => {
  'use strict';

  const STOP_WORDS = new Set([
    'a','an','and','at','by','for','from','in','of','on','or','the','to','with','pledge','premium','premiums',
    'annual','sustainer','season','collection','combo','set','gift','plus','wnmu','pbs'
  ]);

  const CATEGORY_RULES = [
    ['DVD / Blu-ray', /\b(?:dvd|blu[ -]?ray|bluray)\b/i],
    ['CD / Vinyl', /\b(?:cd|compact disc|vinyl|lp|record album)\b/i],
    ['Book', /\b(?:book|paperback|hardcover|pbk|guidebook|cookbook)\b/i],
    ['Apparel', /\b(?:t[ -]?shirt|shirt|sweatshirt|hoodie|jacket|cap|hat|beanie|apparel)\b/i],
    ['Drinkware', /\b(?:mug|tumbler|water bottle|bottle|tankard|travel cup|glassware|glass)\b/i],
    ['Tote / Bag', /\b(?:tote|bag|backpack)\b/i],
    ['Blanket / Home', /\b(?:blanket|throw|pillow|ornament|home goods?|wall art|poster|print)\b/i],
    ['Experience / Recognition', /\b(?:day sponsor|sponsor|recognition|ticket|tour|experience|meet and greet)\b/i],
    ['Electronics / Radio', /\b(?:radio|headphone|speaker|electronics?)\b/i],
    ['Other Merchandise', /\b(?:key strap|keychain|key chain|calendar|journal|notebook|pen|pin|magnet)\b/i]
  ];

  const STATION_GENERIC_RE = /\b(?:wnmu|pbs emergency radio|day sponsor|station sponsor|member card|tv\s+20\d{2})\b/i;
  const BUNDLE_RE = /\b(?:combo|collection|bundle)\b|\+/i;
  const SUMMARY_RE = /^(?:with\s+no\s+premiums?|with\s+unknown\s+premiums?|with\s+individualized\s+premiums?|with\s+known\s+premiums?|with\s+any\s+premiums?|totals?)$/i;

  function text(value) {
    return String(value ?? '').trim();
  }

  function number(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const raw = text(value).replace(/[$,%(),]/g, (match) => match === '(' ? '-' : '').replace(/[^0-9.+-]/g, '');
    if (!raw || raw === '-' || raw === '.') return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalize(value) {
    return text(value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[’'`]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(value) {
    return normalize(value)
      .split(' ')
      .filter((token) => token && token.length > 1 && !STOP_WORDS.has(token));
  }

  function tokenSet(value) {
    return new Set(tokens(value));
  }

  function intersectionSize(a, b) {
    let count = 0;
    a.forEach((value) => { if (b.has(value)) count += 1; });
    return count;
  }

  function similarity(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const aSet = tokenSet(a);
    const bSet = tokenSet(b);
    if (!aSet.size || !bSet.size) return 0;
    const intersection = intersectionSize(aSet, bSet);
    const containment = intersection / Math.min(aSet.size, bSet.size);
    const jaccard = intersection / (aSet.size + bSet.size - intersection);
    let score = (containment * 0.65) + (jaccard * 0.35);
    if (na.includes(nb) || nb.includes(na)) score = Math.max(score, 0.9);
    return Math.min(1, score);
  }

  function fundraiserFromFilename(filename = '') {
    const name = text(filename);
    const match = name.match(/\bP(\d{2})(\d{2})\b/i);
    if (!match) return { key: normalize(name) || 'unknown', label: name || 'Unknown fundraiser', month: null, year: null, season: 'Special' };
    const month = Number(match[1]);
    const year = 2000 + Number(match[2]);
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const season = month === 3 ? 'March' : month === 6 ? 'June' : month === 8 ? 'August' : month === 12 ? 'December' : (monthNames[month - 1] || 'Special');
    return {
      key: `${year}-${String(month).padStart(2, '0')}`,
      label: `${season} ${year}`,
      month,
      year,
      season
    };
  }

  function normalizeHeader(value) {
    return normalize(value).replace(/\bnumber\b/g, 'count');
  }

  function findHeaderRow(matrix = []) {
    let best = { index: -1, score: -1 };
    matrix.slice(0, 30).forEach((row, index) => {
      const joined = row.map(normalizeHeader).join(' | ');
      let score = 0;
      if (/premium|description|item/.test(joined)) score += 3;
      if (/pledge/.test(joined)) score += 2;
      if (/cost/.test(joined)) score += 2;
      if (/dollar|amount|revenue/.test(joined)) score += 2;
      if (/sent|outstanding|paid/.test(joined)) score += 1;
      if (score > best.score) best = { index, score };
    });
    return best.score >= 5 ? best.index : -1;
  }

  function headerIndex(headers, includePatterns, excludePatterns = []) {
    let bestIndex = -1;
    let bestScore = -1;
    headers.forEach((header, index) => {
      const value = normalizeHeader(header);
      if (!value) return;
      if (excludePatterns.some((pattern) => pattern.test(value))) return;
      let score = 0;
      includePatterns.forEach((pattern, rank) => {
        if (pattern.test(value)) score += Math.max(1, 8 - rank);
      });
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return bestScore > 0 ? bestIndex : -1;
  }

  function mapColumns(headers = []) {
    const map = {
      code: headerIndex(headers, [/premium code/, /^code$/, /item code/, /source code/, /^prem$/]),
      description: headerIndex(headers, [/premium description/, /^description$/, /^premium$/, /item description/, /premium name/, /^item$/], [/cost/, /percent/, /sent/, /outstanding/]),
      unitCost: headerIndex(headers, [/^1 cost\b/, /unit cost/, /^cost$/, /premium unit cost/, /cost each/], [/sent/, /outstanding/, /total/, /percent/]),
      pledgeCount: headerIndex(headers, [/^2 pledged\b/, /pledge count/, /^pledges?$/, /count pledges/, /number of pledges/]),
      pledgedDollars: headerIndex(headers, [/^3 pledged\b/, /dollars pledged/, /pledged dollars/, /^dollars?$/, /pledge dollars/, /pledge amount/], [/paid/, /net/, /cost/]),
      sentCount: headerIndex(headers, [/^4 prem sent\b/, /premiums sent/, /^sent$/, /sent count/, /quantity sent/], [/cost/]),
      outstandingCount: headerIndex(headers, [/^5 prem outst\b/, /premiums outstanding/, /^outstanding$/, /outstanding count/, /quantity outstanding/], [/cost/]),
      paidToDate: headerIndex(headers, [/^6 paid to date\b/, /paid to date/, /^paid$/, /amount paid/], [/cost/]),
      sentCost: headerIndex(headers, [/^7 prem sent\b/, /premium cost sent/, /cost sent/, /sent premium cost/]),
      outstandingCost: headerIndex(headers, [/^8 prem outst\b/, /premium cost outstanding/, /outstanding premium cost/, /cost outstanding/]),
      netRevenue: headerIndex(headers, [/^9 net revenue\b/, /net revenue/, /^net$/]),
      costPercent: headerIndex(headers, [/^10 prem pct\b/, /premium cost percent/, /cost percent/, /percent of revenue/, /premium percentage/, /^percent$/])
    };

    if (map.description < 0) {
      const preferred = headers.findIndex((header, index) => index !== map.code && /premium|description|item/i.test(text(header)));
      if (preferred >= 0) map.description = preferred;
    }
    return map;
  }

  function cell(row, index) {
    return index >= 0 ? row[index] : '';
  }

  function classifyPackage(description = '') {
    const source = text(description);
    const componentCategories = CATEGORY_RULES
      .filter(([, pattern]) => pattern.test(source))
      .map(([label]) => label);
    if (!componentCategories.length) componentCategories.push('Other');
    const unique = [...new Set(componentCategories)];
    const stationBranded = /\bwnmu\b/i.test(source);
    const stationGeneric = STATION_GENERIC_RE.test(source);
    const isBundle = BUNDLE_RE.test(source) || unique.length > 1;
    return {
      componentCategories: unique,
      primaryCategory: isBundle ? 'Bundle / Multi-item' : unique[0],
      isBundle,
      stationBranded,
      stationGeneric
    };
  }

  function dataQualityIssues(row) {
    const issues = [];
    if (row.rowType !== 'premium') return issues;
    if (row.unitCost == null) issues.push('Missing unit cost');
    if (row.pledgeCount != null && row.pledgeCount < 0) issues.push('Negative pledge count');
    if (row.pledgedDollars != null && row.pledgedDollars < 0) issues.push('Negative pledged dollars');
    const totalCost = (row.sentCost || 0) + (row.outstandingCost || 0);
    if (row.pledgedDollars > 0 && totalCost > row.pledgedDollars) issues.push('Premium cost exceeds associated pledged dollars');
    if (row.unitCost != null && row.unitCost > 1000) issues.push('Unusually high unit cost');
    if (row.costPercent != null && Math.abs(row.costPercent) > 1.5 && Math.abs(row.costPercent) <= 100) {
      row.costPercent = row.costPercent / 100;
    }
    if (row.costPercent != null && row.costPercent > 1) issues.push('Premium cost percentage exceeds 100%');
    return issues;
  }

  function parseMatrix(matrix = [], filename = '') {
    const fundraiser = fundraiserFromFilename(filename);
    const headerRow = findHeaderRow(matrix);
    if (headerRow < 0) throw new Error(`Could not identify a premium-cost header row in ${filename || 'the workbook'}.`);
    const headers = matrix[headerRow].map(text);
    const columns = mapColumns(headers);
    if (columns.description < 0) throw new Error(`Could not identify the premium description column in ${filename || 'the workbook'}.`);

    const rows = [];
    const summaries = [];
    for (let rowIndex = headerRow + 1; rowIndex < matrix.length; rowIndex += 1) {
      const sourceRow = matrix[rowIndex] || [];
      const description = text(cell(sourceRow, columns.description));
      const code = text(cell(sourceRow, columns.code));
      const rowLabel = description || code || text(sourceRow.find((value) => text(value)));
      if (!rowLabel) continue;
      const summaryLabel = normalize(rowLabel);
      const rowType = SUMMARY_RE.test(summaryLabel) ? 'summary' : 'premium';
      const classification = classifyPackage(rowLabel);
      const row = {
        fundraiserKey: fundraiser.key,
        fundraiserLabel: fundraiser.label,
        fundraiserMonth: fundraiser.month,
        fundraiserYear: fundraiser.year,
        fundraiserSeason: fundraiser.season,
        sourceFile: filename || '',
        sourceRowNumber: rowIndex + 1,
        rowType,
        code,
        description: rowType === 'summary' ? summaryLabel.replace(/\b\w/g, (letter) => letter.toUpperCase()) : (description || rowLabel),
        unitCost: number(cell(sourceRow, columns.unitCost)),
        pledgeCount: number(cell(sourceRow, columns.pledgeCount)),
        pledgedDollars: number(cell(sourceRow, columns.pledgedDollars)),
        sentCount: number(cell(sourceRow, columns.sentCount)),
        outstandingCount: number(cell(sourceRow, columns.outstandingCount)),
        paidToDate: number(cell(sourceRow, columns.paidToDate)),
        sentCost: number(cell(sourceRow, columns.sentCost)),
        outstandingCost: number(cell(sourceRow, columns.outstandingCost)),
        netRevenue: number(cell(sourceRow, columns.netRevenue)),
        costPercent: number(cell(sourceRow, columns.costPercent)),
        ...classification
      };
      row.issues = dataQualityIssues(row);
      if (rowType === 'summary') summaries.push(row);
      else rows.push(row);
    }
    if (!rows.length && !summaries.length) throw new Error(`No premium rows were found in ${filename || 'the workbook'}.`);
    return { fundraiser, headers, columns, rows, summaries, headerRow: headerRow + 1 };
  }

  function splitPremiumSummary(summary = '') {
    return text(summary)
      .split(/\r?\n|\s*\|\s*|\s*;\s*/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function titleScore(description, program = {}) {
    const title = text(program.title || program.program_title || '');
    if (!title) return 0;
    const d = normalize(description);
    const t = normalize(title);
    if (d.includes(t) && t.length >= 5) return 0.95;
    const titleTokens = new Set(tokens(title).filter((token) => token.length >= 3));
    const descTokens = new Set(tokens(description));
    if (!titleTokens.size) return 0;
    const overlap = intersectionSize(titleTokens, descTokens);
    if (!overlap) return 0;
    return Math.min(0.9, overlap / titleTokens.size);
  }

  function bestPremiumSummaryLine(description, program = {}) {
    const summary = text(program.premium_summary || program.premiums || program.premium_notes || '');
    if (!summary) return { line: '', score: 0 };
    const lines = splitPremiumSummary(summary);
    const candidates = [summary, ...lines].map((line) => ({ line, score: similarity(description, line) }));
    return candidates.sort((a, b) => b.score - a.score)[0] || { line: '', score: 0 };
  }

  function summaryScore(description, program = {}) {
    return bestPremiumSummaryLine(description, program).score;
  }

  function mapPremiumToProgram(premium = {}, programs = []) {
    const description = text(premium.description);
    if (!description) return { program: null, score: 0, method: 'unmapped', confidence: 'Unmapped' };
    const stationGeneric = premium.stationGeneric || STATION_GENERIC_RE.test(description);
    const candidates = programs.map((program) => {
      const premiumScore = summaryScore(description, program);
      const tScore = titleScore(description, program);
      const score = Math.min(1, Math.max(premiumScore, tScore, (premiumScore * 0.75) + (tScore * 0.45)));
      return { program, score, premiumScore, titleScore: tScore };
    }).sort((a, b) => b.score - a.score);
    const best = candidates[0] || null;
    const second = candidates[1] || null;
    if (!best || best.score < 0.42 || (stationGeneric && best.premiumScore < 0.72)) {
      return { program: null, score: best?.score || 0, method: stationGeneric ? 'station-wide-or-unmapped' : 'unmapped', confidence: 'Unmapped' };
    }
    const margin = best.score - (second?.score || 0);
    if (best.premiumScore >= 0.72 && margin >= 0.08) {
      return { program: best.program, score: best.score, method: 'current-premium-proxy', confidence: 'Current-offer proxy' };
    }
    if (best.titleScore >= 0.72 && margin >= 0.1) {
      return { program: best.program, score: best.score, method: 'title-inferred', confidence: 'Strongly inferred' };
    }
    if (best.score >= 0.62 && margin >= 0.12) {
      return { program: best.program, score: best.score, method: 'current-premium-proxy', confidence: 'Current-offer proxy' };
    }
    return { program: null, score: best.score, method: 'ambiguous', confidence: 'Unmapped' };
  }

  function addMappings(rows = [], programs = []) {
    return rows.map((row) => {
      const mapping = mapPremiumToProgram(row, programs);
      const program = mapping.program || null;
      const reportCategories = (row.componentCategories || []).filter(Boolean);
      const onlyOther = !reportCategories.length || reportCategories.every((category) => category === 'Other');
      const proxyMatch = program ? bestPremiumSummaryLine(row.description, program) : { line: '', score: 0 };
      const proxyClass = proxyMatch.line ? classifyPackage(proxyMatch.line) : null;
      const proxyCategories = proxyClass?.componentCategories?.filter((category) => category !== 'Other') || [];
      const useProxyCategories = onlyOther && proxyCategories.length > 0 && proxyMatch.score >= 0.42;
      const componentCategories = useProxyCategories ? proxyCategories : (reportCategories.length ? reportCategories : ['Other']);
      return {
        ...row,
        componentCategories,
        componentCategorySource: useProxyCategories ? 'Current-offer proxy' : 'Report description',
        componentCategoryProxyText: useProxyCategories ? proxyMatch.line : '',
        mappingMethod: mapping.method,
        mappingConfidence: mapping.confidence,
        mappingScore: mapping.score,
        programId: program?.id || program?.program_id || '',
        programTitle: program?.title || program?.program_title || '',
        topicPrimary: program?.topic_primary || '',
        topicSecondary: program?.topic_secondary || '',
        distributor: program?.distributor || ''
      };
    });
  }

  function sum(rows, field) {
    return rows.reduce((total, row) => total + (Number(row?.[field]) || 0), 0);
  }

  function weightedAverage(rows, valueField, weightField) {
    const pairs = rows.map((row) => [Number(row?.[valueField]), Number(row?.[weightField])]).filter(([value, weight]) => Number.isFinite(value) && Number.isFinite(weight) && weight > 0);
    const weight = pairs.reduce((total, pair) => total + pair[1], 0);
    return weight ? pairs.reduce((total, pair) => total + (pair[0] * pair[1]), 0) / weight : null;
  }

  function metricSummary(rows = []) {
    const pledgeCount = sum(rows, 'pledgeCount');
    const pledgedDollars = sum(rows, 'pledgedDollars');
    const paidToDate = sum(rows, 'paidToDate');
    const sentCost = sum(rows, 'sentCost');
    const outstandingCost = sum(rows, 'outstandingCost');
    const totalPremiumCost = sentCost + outstandingCost;
    return {
      rows: rows.length,
      pledgeCount,
      pledgedDollars,
      paidToDate,
      sentCost,
      outstandingCost,
      totalPremiumCost,
      averagePledge: pledgeCount ? pledgedDollars / pledgeCount : null,
      costPercentOfPledged: pledgedDollars ? totalPremiumCost / pledgedDollars : null,
      estimatedNetAfterPremium: pledgedDollars - totalPremiumCost,
      paidNetAfterSentPremium: paidToDate - sentCost,
      averageUnitCost: weightedAverage(rows, 'unitCost', 'pledgeCount')
    };
  }

  function groupBy(rows = [], keyFn = () => '') {
    const groups = new Map();
    rows.forEach((row) => {
      const key = text(keyFn(row)) || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return groups;
  }

  function categoryAnalysis(rows = []) {
    const categories = new Map();
    rows.forEach((row) => {
      (row.componentCategories || ['Other']).forEach((category) => {
        if (!categories.has(category)) categories.set(category, []);
        categories.get(category).push(row);
      });
      if (row.isBundle) {
        if (!categories.has('Bundle / Multi-item')) categories.set('Bundle / Multi-item', []);
        categories.get('Bundle / Multi-item').push(row);
      }
    });
    return [...categories.entries()].map(([category, categoryRows]) => ({
      category,
      ...metricSummary(categoryRows),
      distinctPackages: new Set(categoryRows.map((row) => normalize(row.description))).size,
      fundraiserCount: new Set(categoryRows.map((row) => row.fundraiserKey)).size
    })).sort((a, b) => b.pledgedDollars - a.pledgedDollars);
  }

  function fundraiserAnalysis(rows = [], summaries = []) {
    const groups = groupBy(rows, (row) => row.fundraiserKey);
    return [...groups.entries()].map(([key, fundraiserRows]) => {
      const fundraiserSummaries = summaries.filter((row) => row.fundraiserKey === key);
      const total = fundraiserSummaries.find((row) => /^totals?$/i.test(row.description));
      const anyPremium = fundraiserSummaries.find((row) => /with any premiums?/i.test(row.description));
      const noPremium = fundraiserSummaries.find((row) => /with no premiums?/i.test(row.description));
      const knownPremium = fundraiserSummaries.find((row) => /with known premiums?/i.test(row.description));
      const individualizedPremium = fundraiserSummaries.find((row) => /with individualized premiums?/i.test(row.description));
      const unknownPremium = fundraiserSummaries.find((row) => /with unknown premiums?/i.test(row.description));
      const named = metricSummary(fundraiserRows);
      const fallbackPledges = (anyPremium?.pledgeCount || 0) + (noPremium?.pledgeCount || 0);
      const fallbackDollars = (anyPremium?.pledgedDollars || 0) + (noPremium?.pledgedDollars || 0);
      const totalPledges = total?.pledgeCount ?? (fallbackPledges || null);
      const totalPledged = total?.pledgedDollars ?? (fallbackDollars || null);
      const anyPremiumPledges = anyPremium?.pledgeCount ?? named.pledgeCount;
      const anyPremiumDollars = anyPremium?.pledgedDollars ?? named.pledgedDollars;
      const noPremiumPledges = noPremium?.pledgeCount ?? null;
      const noPremiumDollars = noPremium?.pledgedDollars ?? null;
      const hasSummaryCost = anyPremium && (anyPremium.sentCost != null || anyPremium.outstandingCost != null);
      const summaryPremiumCost = hasSummaryCost
        ? (Number(anyPremium.sentCost || 0) + Number(anyPremium.outstandingCost || 0))
        : named.totalPremiumCost;
      const summarySentCost = hasSummaryCost ? Number(anyPremium.sentCost || 0) : named.sentCost;
      const summaryOutstandingCost = hasSummaryCost ? Number(anyPremium.outstandingCost || 0) : named.outstandingCost;
      const individualizedPremiumPledges = Number(individualizedPremium?.pledgeCount || 0);
      const unknownPremiumPledges = Number(unknownPremium?.pledgeCount || 0);
      const individualizedPremiumDollars = Number(individualizedPremium?.pledgedDollars || 0);
      const unknownPremiumDollars = Number(unknownPremium?.pledgedDollars || 0);
      return {
        key,
        label: fundraiserRows[0]?.fundraiserLabel || fundraiserSummaries[0]?.fundraiserLabel || key,
        ...named,
        sentCost: summarySentCost,
        outstandingCost: summaryOutstandingCost,
        totalPremiumCost: summaryPremiumCost,
        totalPledges,
        totalPledged,
        anyPremiumPledges,
        anyPremiumDollars,
        noPremiumPledges,
        noPremiumDollars,
        knownPremiumPledges: knownPremium?.pledgeCount ?? named.pledgeCount,
        knownPremiumDollars: knownPremium?.pledgedDollars ?? named.pledgedDollars,
        individualizedPremiumPledges,
        individualizedPremiumDollars,
        unknownPremiumPledges,
        unknownPremiumDollars,
        unitemizedPremiumPledges: individualizedPremiumPledges + unknownPremiumPledges,
        unitemizedPremiumDollars: individualizedPremiumDollars + unknownPremiumDollars,
        premiumTakeRate: totalPledges ? anyPremiumPledges / totalPledges : null,
        averagePremiumPledge: anyPremiumPledges ? anyPremiumDollars / anyPremiumPledges : null,
        averageNoPremiumPledge: noPremiumPledges ? noPremiumDollars / noPremiumPledges : null,
        premiumCostPercentOfPremiumDollars: anyPremiumDollars ? summaryPremiumCost / anyPremiumDollars : null,
        premiumCostPercentOfTotal: totalPledged ? summaryPremiumCost / totalPledged : null,
        estimatedTotalNetAfterPremium: totalPledged == null ? null : totalPledged - summaryPremiumCost,
        summaryRows: fundraiserSummaries
      };
    }).sort((a, b) => a.key.localeCompare(b.key));
  }

  function portfolioSummary(rows = [], summaries = []) {
    const fundraisers = fundraiserAnalysis(rows, summaries);
    const totalPledges = fundraisers.reduce((sumValue, item) => sumValue + (Number(item.totalPledges) || 0), 0);
    const totalPledged = fundraisers.reduce((sumValue, item) => sumValue + (Number(item.totalPledged) || 0), 0);
    const anyPremiumPledges = fundraisers.reduce((sumValue, item) => sumValue + (Number(item.anyPremiumPledges) || 0), 0);
    const anyPremiumDollars = fundraisers.reduce((sumValue, item) => sumValue + (Number(item.anyPremiumDollars) || 0), 0);
    const noPremiumPledges = fundraisers.reduce((sumValue, item) => sumValue + (Number(item.noPremiumPledges) || 0), 0);
    const noPremiumDollars = fundraisers.reduce((sumValue, item) => sumValue + (Number(item.noPremiumDollars) || 0), 0);
    const totalPremiumCost = fundraisers.reduce((sumValue, item) => sumValue + (Number(item.totalPremiumCost) || 0), 0);
    const unitemizedPremiumPledges = fundraisers.reduce((sumValue, item) => sumValue + (Number(item.unitemizedPremiumPledges) || 0), 0);
    const unitemizedPremiumDollars = fundraisers.reduce((sumValue, item) => sumValue + (Number(item.unitemizedPremiumDollars) || 0), 0);
    return {
      fundraiserCount: fundraisers.length,
      totalPledges,
      totalPledged,
      anyPremiumPledges,
      anyPremiumDollars,
      noPremiumPledges,
      noPremiumDollars,
      totalPremiumCost,
      unitemizedPremiumPledges,
      unitemizedPremiumDollars,
      premiumTakeRate: totalPledges ? anyPremiumPledges / totalPledges : null,
      averagePremiumPledge: anyPremiumPledges ? anyPremiumDollars / anyPremiumPledges : null,
      averageNoPremiumPledge: noPremiumPledges ? noPremiumDollars / noPremiumPledges : null,
      premiumCostPercentOfPremiumDollars: anyPremiumDollars ? totalPremiumCost / anyPremiumDollars : null,
      premiumCostPercentOfTotal: totalPledged ? totalPremiumCost / totalPledged : null,
      estimatedTotalNetAfterPremium: totalPledged - totalPremiumCost
    };
  }

  function packageAnalysis(rows = []) {
    const groups = groupBy(rows, (row) => normalize(row.description));
    return [...groups.values()].map((packageRows) => ({
      description: packageRows[0]?.description || 'Unknown premium',
      code: packageRows[0]?.code || '',
      codes: [...new Set(packageRows.map((row) => text(row.code)).filter(Boolean))],
      componentCategories: [...new Set(packageRows.flatMap((row) => row.componentCategories || []))],
      stationBranded: packageRows.some((row) => row.stationBranded),
      isBundle: packageRows.some((row) => row.isBundle),
      fundraiserCount: new Set(packageRows.map((row) => row.fundraiserKey)).size,
      ...metricSummary(packageRows),
      rowsDetail: packageRows
    })).sort((a, b) => b.pledgedDollars - a.pledgedDollars);
  }

  function mappedGroupAnalysis(rows = [], field = 'programTitle') {
    const mapped = rows.filter((row) => text(row.programTitle));
    return [...groupBy(mapped, (row) => row[field]).entries()].map(([label, groupRows]) => ({
      label,
      ...metricSummary(groupRows),
      exactPremiumCount: new Set(groupRows.map((row) => normalize(row.description))).size,
      fundraiserCount: new Set(groupRows.map((row) => row.fundraiserKey)).size,
      rowsDetail: groupRows
    })).sort((a, b) => b.pledgedDollars - a.pledgedDollars);
  }

  function seasonMonth(season = '') {
    const key = normalize(season);
    if (key === 'march') return 3;
    if (key === 'june') return 6;
    if (key === 'august') return 8;
    if (key === 'december') return 12;
    return null;
  }

  function fundraiserKeyForSchedule(schedule = {}) {
    const month = seasonMonth(schedule.season);
    const year = Number(schedule.year || String(schedule.startDate || '').slice(0, 4));
    if (!(month && year)) return '';
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  function performanceRowsFromAnalyses(analyses = []) {
    const output = [];
    (analyses || []).forEach((analysis) => {
      const schedule = analysis?.schedule || {};
      const fundraiserKey = fundraiserKeyForSchedule(schedule);
      if (!fundraiserKey) return;
      const fundraiserLabel = `${schedule.season || 'Fundraiser'} ${schedule.year || ''}`.trim();
      (analysis?.placementRows || []).forEach((row) => {
        if (!row?.known) return;
        const programId = text(row.programId);
        const programTitle = text(row.title || row.plannedTitle);
        if (!programId && /^(?:non-specific pledges?|unattributed broadcast result)$/i.test(programTitle)) return;
        output.push({
          fundraiserKey,
          fundraiserLabel,
          programId,
          programTitle,
          topicPrimary: text(row.topic),
          topicSecondary: text(row.secondary),
          broadcastDollars: Number(row.dollars || 0) || 0,
          broadcastPledges: Number(row.pledges || 0) || 0,
          minutes: Number(row.minutes || 0) || 0,
          airings: 1
        });
      });
    });
    return output;
  }

  function joinKey(row = {}) {
    const programId = text(row.programId);
    if (programId) return `${text(row.fundraiserKey)}|id:${programId}`;
    return `${text(row.fundraiserKey)}|title:${normalize(row.programTitle)}`;
  }

  function combinedProgramAnalysis(premiumRows = [], performanceRows = []) {
    const premiumGroups = groupBy(
      premiumRows.filter((row) => text(row.programTitle)),
      joinKey
    );
    const performanceGroups = groupBy(
      performanceRows.filter((row) => text(row.programTitle)),
      joinKey
    );
    const keys = new Set([...premiumGroups.keys(), ...performanceGroups.keys()]);
    return [...keys].map((key) => {
      const premiums = premiumGroups.get(key) || [];
      const performance = performanceGroups.get(key) || [];
      const exemplar = premiums[0] || performance[0] || {};
      const premiumMetrics = metricSummary(premiums);
      const broadcastDollars = sum(performance, 'broadcastDollars');
      const broadcastPledges = sum(performance, 'broadcastPledges');
      const minutes = sum(performance, 'minutes');
      const airings = sum(performance, 'airings');
      return {
        fundraiserKey: exemplar.fundraiserKey || '',
        fundraiserLabel: exemplar.fundraiserLabel || exemplar.fundraiserKey || '',
        programId: exemplar.programId || '',
        programTitle: exemplar.programTitle || 'Unassigned',
        topicPrimary: exemplar.topicPrimary || performance.find((row) => row.topicPrimary)?.topicPrimary || '',
        premiumPackages: new Set(premiums.map((row) => normalize(row.description))).size,
        mappingConfidence: [...new Set(premiums.map((row) => row.mappingConfidence).filter(Boolean))],
        broadcastDollars,
        broadcastPledges,
        broadcastAveragePledge: broadcastPledges ? broadcastDollars / broadcastPledges : null,
        broadcastDollarsPerHour: minutes ? broadcastDollars / (minutes / 60) : null,
        airings,
        minutes,
        ...premiumMetrics
      };
    }).sort((a, b) => b.broadcastDollars - a.broadcastDollars || b.pledgedDollars - a.pledgedDollars);
  }

  function combinedTopicAnalysis(premiumRows = [], performanceRows = []) {
    const premiumGroups = groupBy(premiumRows.filter((row) => text(row.topicPrimary)), (row) => row.topicPrimary);
    const performanceGroups = groupBy(performanceRows.filter((row) => text(row.topicPrimary)), (row) => row.topicPrimary);
    const keys = new Set([...premiumGroups.keys(), ...performanceGroups.keys()]);
    return [...keys].map((topic) => {
      const premiums = premiumGroups.get(topic) || [];
      const performance = performanceGroups.get(topic) || [];
      const premiumMetrics = metricSummary(premiums);
      const broadcastDollars = sum(performance, 'broadcastDollars');
      const broadcastPledges = sum(performance, 'broadcastPledges');
      const minutes = sum(performance, 'minutes');
      return {
        topic,
        premiumPackages: new Set(premiums.map((row) => normalize(row.description))).size,
        fundraiserCount: new Set([...premiums.map((row) => row.fundraiserKey), ...performance.map((row) => row.fundraiserKey)].filter(Boolean)).size,
        broadcastDollars,
        broadcastPledges,
        broadcastAveragePledge: broadcastPledges ? broadcastDollars / broadcastPledges : null,
        broadcastDollarsPerHour: minutes ? broadcastDollars / (minutes / 60) : null,
        airings: sum(performance, 'airings'),
        minutes,
        ...premiumMetrics
      };
    }).sort((a, b) => b.broadcastDollars - a.broadcastDollars || b.pledgedDollars - a.pledgedDollars);
  }

  function mappingQuality(rows = []) {
    const counts = { 'Current-offer proxy': 0, 'Strongly inferred': 0, 'Historically verified': 0, 'Unmapped': 0 };
    rows.forEach((row) => { counts[row.mappingConfidence] = (counts[row.mappingConfidence] || 0) + 1; });
    return counts;
  }

  function mergeImportedFundraisers(existing = [], parsed = []) {
    const byKey = new Map((existing || []).map((item) => [item.fundraiser?.key || item.key, item]));
    (parsed || []).forEach((item) => {
      const key = item.fundraiser?.key || item.key;
      if (key) byKey.set(key, item);
    });
    return [...byKey.values()].sort((a, b) => (a.fundraiser?.key || '').localeCompare(b.fundraiser?.key || ''));
  }

  function flattenImports(imports = []) {
    return {
      rows: imports.flatMap((item) => item.rows || []),
      summaries: imports.flatMap((item) => item.summaries || [])
    };
  }

  const api = {
    text,
    number,
    normalize,
    tokens,
    similarity,
    fundraiserFromFilename,
    findHeaderRow,
    mapColumns,
    classifyPackage,
    parseMatrix,
    splitPremiumSummary,
    bestPremiumSummaryLine,
    mapPremiumToProgram,
    addMappings,
    metricSummary,
    categoryAnalysis,
    fundraiserAnalysis,
    portfolioSummary,
    packageAnalysis,
    mappedGroupAnalysis,
    fundraiserKeyForSchedule,
    performanceRowsFromAnalyses,
    combinedProgramAnalysis,
    combinedTopicAnalysis,
    mappingQuality,
    mergeImportedFundraisers,
    flattenImports
  };

  globalThis.WNMUPremiumAnalysis = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

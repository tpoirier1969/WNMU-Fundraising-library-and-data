
(() => {
  const App = window.PledgeLib;
  const { state, utils, derive } = App;
  const { els, setNotice } = App.dom;

  const IMPORT_MATCH_RULES_STORAGE_KEY = App.constants.IMPORT_MATCH_RULES_STORAGE_KEY || 'wnmuPledgeImportMatchRulesV1';
  const IMPORT_REPORT_TOTALS_STORAGE_KEY = App.constants.IMPORT_REPORT_TOTALS_STORAGE_KEY || 'wnmuPledgeImportReportTotalsV1';
  const IMPORTED_FUNDRAISER_CLUSTER_GAP_DAYS = 14;

  function imp() { return state.imports; }
  function escape(value) { return utils.escapeHtml(utils.toDisplayText(value)); }

  function fileKeyForMeta(file, explicitIndex = 0) {
    const raw = `${utils.normalizeText(file?.name || '')}|${Number(file?.size || 0)}|${Number(file?.lastModified || 0)}|${explicitIndex}`;
    return utils.makeId ? `file-${Math.abs(hashText(raw))}` : raw;
  }

  function fileSummaryByKey(fileKey = '') {
    return imp().fileSummaries.find((item) => item.fileKey === fileKey) || null;
  }

  function importTitleKey(title = '') {
    return utils.normalizeLookupKey(title || '');
  }

  function importStationKey(station = '') {
    return utils.normalizeLookupKey(station || '') || '*';
  }

  function isNonSpecificTitle(title = '') {
    const key = importTitleKey(title).replace(/[^a-z0-9]+/g, ' ').trim();
    return key === 'non specific pledges' || key.endsWith('non specific pledges');
  }

  function isNonSpecificNola(nola = '') {
    return utils.normalizeLookupKey(nola || '').replace(/\s+/g, '') === 'nspl';
  }

  function isNonSpecificRow(row = {}) {
    return Boolean(row?.is_non_specific || isNonSpecificNola(row?.nola_code) || isNonSpecificTitle(row?.imported_program_title || row?.title));
  }

  function isImportMatched(row) {
    if (!row || row.match_method === 'ignored') return false;
    if (isNonSpecificRow(row)) return true;
    return Boolean(String(row.program_id || row.pledge_program_id || '').trim());
  }

  function getMatchedRows() {
    return imp().airingsRows.filter((row) => isImportMatched(row));
  }

  function getUnmatchedRows() {
    return imp().airingsRows.filter((row) => !isImportMatched(row));
  }

  function getStoredAliasRules() {
    return Array.isArray(imp().aliasRules) ? imp().aliasRules : [];
  }

  function saveStoredAliasRules(rules = []) {
    imp().aliasRules = Array.isArray(rules) ? rules : [];
    utils.storageSet(IMPORT_MATCH_RULES_STORAGE_KEY, imp().aliasRules);
  }

  function aliasRuleKey(station = '', importedTitle = '') {
    return `${importStationKey(station)}|${importTitleKey(importedTitle)}`;
  }

  function findAliasRuleForRow(row = {}) {
    const key = aliasRuleKey(row.station, row.imported_program_title || row.program_title || row.title);
    return getStoredAliasRules().find((rule) => aliasRuleKey(rule.station, rule.importedTitle) === key && rule.active !== false) || null;
  }

  function storeAliasRule({ station = '', importedTitle = '', targetProgram = null }) {
    if (!targetProgram || !importedTitle) return null;
    const rules = getStoredAliasRules().slice();
    const nextRule = {
      id: utils.makeId('importrule'),
      station,
      importedTitle,
      importedTitleKey: importTitleKey(importedTitle),
      targetProgramId: String(derive.programId(targetProgram) || '').trim(),
      targetProgramTitle: derive.title(targetProgram) || importedTitle,
      targetProgramNola: derive.nola(targetProgram) || '',
      active: true,
      updatedAt: new Date().toISOString()
    };
    const existingIndex = rules.findIndex((rule) => aliasRuleKey(rule.station, rule.importedTitle) === aliasRuleKey(station, importedTitle));
    if (existingIndex >= 0) nextRule.id = rules[existingIndex].id || nextRule.id;
    if (existingIndex >= 0) rules.splice(existingIndex, 1, nextRule);
    else rules.push(nextRule);
    saveStoredAliasRules(rules);
    return nextRule;
  }

  function storedReportTotals() {
    return imp().reportTotalsByFile && typeof imp().reportTotalsByFile === 'object' ? imp().reportTotalsByFile : {};
  }

  function saveStoredReportTotals(nextMap = {}) {
    imp().reportTotalsByFile = { ...nextMap };
    utils.storageSet(IMPORT_REPORT_TOTALS_STORAGE_KEY, imp().reportTotalsByFile);
  }

  function getMatchReason(row) {
    if (!row) return '';
    if (row.match_method === 'manual_library') return 'Matched manually in import review';
    if (row.match_method === 'saved_title_rule') return 'Matched from a saved “always equals this” rule';
    if (row.match_method === 'title_exact') return 'Matched by exact imported title';
    if (row.match_method === 'non_specific') return 'Non-specific broadcast row';
    if (row.match_method === 'ignored') return row.match_reason || 'Ignored during import review';
    return row.match_reason || 'No pledge-library match yet';
  }

  function optionRankForNeed(entry = {}, unmatchedNeedle = '') {
    const wanted = utils.normalizeLookupKey(unmatchedNeedle);
    if (!wanted) return { score: 99, tie: entry.sortLabel || entry.label || '' };
    const titleKey = entry.titleKey || '';
    const nolaKey = entry.nolaKey || '';
    if (titleKey === wanted || nolaKey === wanted) return { score: 0, tie: entry.sortLabel || entry.label || '' };
    if (titleKey.startsWith(wanted)) return { score: 1, tie: entry.sortLabel || entry.label || '' };
    if (wanted.length >= 4 && titleKey.includes(wanted)) return { score: 2, tie: entry.sortLabel || entry.label || '' };
    const wantedPrefix = wanted.slice(0, Math.min(10, wanted.length));
    if (wantedPrefix && titleKey.startsWith(wantedPrefix)) return { score: 3, tie: entry.sortLabel || entry.label || '' };
    if (wantedPrefix && titleKey.includes(wantedPrefix)) return { score: 4, tie: entry.sortLabel || entry.label || '' };
    return { score: 99, tie: entry.sortLabel || entry.label || '' };
  }

  function buildLibraryProgramOptions(unmatchedNeedle = '') {
    const seen = new Set();
    const options = (state.rawRows || []).map((row) => {
      const value = String(derive.programId(row) || '');
      if (!value || seen.has(value)) return null;
      seen.add(value);
      const title = derive.title(row) || 'Untitled program';
      const nola = derive.nola(row);
      return {
        value,
        label: nola ? `${title} (${nola})` : title,
        sortLabel: `${title} ${nola || ''}`.trim().toLowerCase(),
        titleKey: utils.normalizeLookupKey(title),
        nolaKey: utils.normalizeLookupKey(nola)
      };
    }).filter(Boolean);
    options.sort((a, b) => {
      const ar = optionRankForNeed(a, unmatchedNeedle);
      const br = optionRankForNeed(b, unmatchedNeedle);
      if (ar.score != br.score) return ar.score - br.score;
      return ar.tie.localeCompare(br.tie);
    });
    return options;
  }


  function existingUnlinkedReason(row) {
    const title = utils.normalizeText(row?.program_title || row?.title || row?.imported_program_title);
    const nola = utils.normalizeText(row?.nola_code);
    if (!title && !nola) return 'Missing program title and NOLA';
    if (!title) return 'Missing imported title';
    if (!nola) return 'Missing NOLA';
    return 'No library link on imported airing';
  }

  function normalizeExistingUnlinkedRow(row = {}) {
    return {
      imported_program_title: utils.normalizeText(row.imported_program_title || row.program_title || row.title) || '—',
      nola_code: utils.normalizeText(row.nola_code) || '—',
      air_date: utils.normalizeText(row.air_date) || utils.dateKeyFromDate(row.aired_at) || '—',
      air_time: utils.normalizeText(row.air_time) || '—',
      dollars: Number.isFinite(Number(row.dollars)) ? Number(row.dollars) : null,
      source_file_name: utils.normalizeText(row.source_file_name) || '—',
      match_reason: existingUnlinkedReason(row)
    };
  }

  function setStatus(text, type = '') {
    if (!els.importStatus) return;
    els.importStatus.textContent = text;
    els.importStatus.className = 'list-summary';
    if (type) els.importStatus.classList.add(type);
  }

  function setStatusPill(text, adminOnly = false) {
    if (!els.importStatusPill) return;
    els.importStatusPill.textContent = text;
    els.importStatusPill.classList.toggle('import-pill-admin-only', adminOnly);
  }

  function setResultBanner(text = '', type = '') {
    if (!els.importResultBanner) return;
    if (!text) {
      els.importResultBanner.textContent = '';
      els.importResultBanner.className = 'import-result-banner hidden';
      return;
    }
    els.importResultBanner.textContent = text;
    els.importResultBanner.className = 'import-result-banner';
    if (type) els.importResultBanner.classList.add(type);
  }

  function detectDelimiter(text) {
    const sample = String(text || '').split(/\r?\n/).slice(0, 6).join('\n');
    const counts = [
      { delimiter: '\t', score: (sample.match(/\t/g) || []).length, label: 'TSV' },
      { delimiter: ',', score: (sample.match(/,/g) || []).length, label: 'CSV' },
      { delimiter: ';', score: (sample.match(/;/g) || []).length, label: 'Semicolon' },
      { delimiter: '|', score: (sample.match(/\|/g) || []).length, label: 'Pipe' }
    ].sort((a, b) => b.score - a.score);
    return counts[0]?.score ? counts[0] : { delimiter: ',', label: 'CSV' };
  }

  function parseCsvRows(text, delimiter) {
    const rows = [];
    let cell = '';
    let row = [];
    let inQuotes = false;
    const src = String(text || '');
    for (let i = 0; i < src.length; i += 1) {
      const char = src[i];
      const next = src[i + 1];
      if (char === '"') {
        if (inQuotes && next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (!inQuotes && char === delimiter) {
        row.push(cell);
        cell = '';
        continue;
      }
      if (!inQuotes && (char === '\n' || char === '\r')) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(cell);
        if (row.some((value) => utils.normalizeText(value))) rows.push(row);
        row = [];
        cell = '';
        continue;
      }
      cell += char;
    }
    row.push(cell);
    if (row.some((value) => utils.normalizeText(value))) rows.push(row);
    return rows;
  }

  function looksLikeHeaderRow(cells = []) {
    const joined = cells.map((value) => keyify(value)).join(' ');
    return /(station|air_date|air_time|program_title|nola|dollars|pledges|program_minutes|sustainers)/.test(joined);
  }

  function looksLikeLegacyBreakDataRow(cells = []) {
    if (!cells.length) return false;
    const station = utils.normalizeText(cells[0]);
    const airDate = utils.normalizeText(cells[1]);
    const nola = utils.normalizeText(cells[3]);
    const title = utils.normalizeText(cells[4]);
    return Boolean(station && airDate && nola && title && /^(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{6,8})$/.test(airDate));
  }


  function legacyTrailerMoneyTotal(cells = []) {
    const preferredIndexes = [5, 6, 4, 7, 8];
    const seen = new Set();
    const values = [];

    const collectMoney = (raw, indexLabel) => {
      const key = `${indexLabel}|${String(raw ?? '').trim()}`;
      if (!String(raw ?? '').trim() || seen.has(key)) return;
      seen.add(key);
      const money = parseMoney(raw);
      if (Number.isFinite(money) && money > 0) values.push(money);
    };

    preferredIndexes.forEach((index) => {
      if (index >= cells.length) return;
      collectMoney(cells[index], index);
    });

    cells.forEach((value, index) => collectMoney(value, `all-${index}`));
    if (!values.length) return 0;
    return Math.max(...values);
  }

  function looksLikeLegacyTrailerRow(cells = []) {
    const normalized = cells.map((value) => utils.normalizeText(value));
    if (!normalized.some(Boolean)) return false;
    const joined = normalized.join(' ').toLowerCase();
    const hasTotalWord = /\b(total|totals|grand total|report total|broadcast total)\b/.test(joined);
    const missingProgramIdentity = !utils.normalizeText(cells[3]) && !utils.normalizeText(cells[4]);
    const fewValues = normalized.filter(Boolean).length <= 4;
    const hasTrailerShape = hasTotalWord || (missingProgramIdentity && fewValues);
    return Boolean(hasTrailerShape && legacyTrailerMoneyTotal(cells) > 0 && !looksLikeLegacyBreakDataRow(cells));
  }

  function parseLegacyBreakReport(rows = []) {
    const headers = ['Station', 'Air Date', 'Air Time', 'NOLA', 'Program Title', 'Dollars', 'Secondary Dollars', 'Pledges', 'Program Minutes', 'Sustainers'];
    const records = [];
    const diagnostics = {
      detectedFormat: 'legacy_pbs_break_report',
      embeddedHeaderRows: 0,
      totalRowsSkipped: 0,
      trailerRowsSkipped: 0,
      trailerTotalsDollars: 0,
      rowsWithExtraColumns: 0,
      rowsWithMissingColumns: 0
    };
    rows.forEach((cells) => {
      const normalized = cells.map((value) => utils.normalizeText(value));
      if (!normalized.some(Boolean)) return;
      if (looksLikeHeaderRow(cells)) {
        diagnostics.embeddedHeaderRows += 1;
        return;
      }
      if (looksLikeLegacyTrailerRow(cells)) {
        const trailerMoney = legacyTrailerMoneyTotal(cells);
        if (Number.isFinite(trailerMoney) && trailerMoney > 0) diagnostics.trailerTotalsDollars = Math.max(Number(diagnostics.trailerTotalsDollars || 0), trailerMoney);
        diagnostics.trailerRowsSkipped += 1;
        return;
      }
      if (!looksLikeLegacyBreakDataRow(cells)) {
        diagnostics.totalRowsSkipped += 1;
        return;
      }
      if (cells.length > headers.length) diagnostics.rowsWithExtraColumns += 1;
      if (cells.length < headers.length) diagnostics.rowsWithMissingColumns += 1;
      const out = {};
      headers.forEach((header, index) => {
        out[header] = cells[index] ?? '';
      });
      records.push(out);
    });
    return { headers, records, diagnostics };
  }

  function parseDelimited(text, delimiter) {
    const rows = parseCsvRows(text, delimiter);
    if (!rows.length) return { headers: [], records: [], diagnostics: { detectedFormat: 'empty' } };

    const firstRow = rows[0].map((value, index) => utils.normalizeText(value) || `column_${index + 1}`);
    const secondRow = rows[1] || [];
    const fileLooksLegacy = !looksLikeHeaderRow(rows[0]) && looksLikeLegacyBreakDataRow(rows[0]);
    const hasEmbeddedHeader = rows.some((cells, index) => index > 0 && looksLikeHeaderRow(cells));
    const shouldUseLegacy = fileLooksLegacy || (hasEmbeddedHeader && looksLikeLegacyBreakDataRow(secondRow));
    if (shouldUseLegacy) return parseLegacyBreakReport(rows);

    const headers = firstRow;
    const records = rows.slice(1).map((cells) => {
      const out = {};
      headers.forEach((header, index) => {
        out[header] = cells[index] ?? '';
      });
      return out;
    }).filter((record) => Object.values(record).some((value) => utils.normalizeText(value)));
    return { headers, records, diagnostics: { detectedFormat: 'headered_csv' } };
  }


  function keyify(value) {
    return utils.normalizeLookupKey(value).replace(/\s+/g, '_');
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function hashText(text) {
    let hash = 0;
    const src = String(text || '');
    for (let i = 0; i < src.length; i += 1) {
      hash = ((hash << 5) - hash) + src.charCodeAt(i);
      hash |= 0;
    }
    return `h${Math.abs(hash)}`;
  }

  function mapRowKeys(row = {}) {
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [keyify(key), value]));
  }

  function firstMatching(row, exactKeys = [], regex = null) {
    for (const key of exactKeys) {
      if (Object.prototype.hasOwnProperty.call(row, key) && !utils.isBlank(row[key])) return row[key];
    }
    if (!regex) return null;
    for (const [key, value] of Object.entries(row || {})) {
      if (regex.test(key) && !utils.isBlank(value)) return value;
    }
    return null;
  }

  function parseMoney(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value);
    const cleaned = raw.replace(/[$,]/g, '').trim();
    if (!cleaned) return null;
    const negative = /^\(.*\)$/.test(raw.trim());
    const num = Number(cleaned.replace(/[()]/g, ''));
    if (!Number.isFinite(num)) return null;
    return negative ? -num : num;
  }

  function parseInteger(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    const num = Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? Math.trunc(num) : null;
  }

  function parseDateish(value) {
    const text = utils.normalizeText(value);
    if (!text) return '';
    if (/^\d{6}$/.test(text)) {
      const mm = text.slice(0, 2);
      const dd = text.slice(2, 4);
      const yy = text.slice(4, 6);
      return `20${yy}-${mm}-${dd}`;
    }
    if (/^\d{8}$/.test(text)) {
      if (text.startsWith('19') || text.startsWith('20')) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
      return `${text.slice(4, 8)}-${text.slice(0, 2)}-${text.slice(2, 4)}`;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return '';
    return utils.dateKeyFromDate(date);
  }

  function parseTimeish(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      const raw = String(Math.trunc(value));
      if (raw.length <= 4) {
        const padded = raw.padStart(4, '0');
        return `${padded.slice(0, 2)}:${padded.slice(2, 4)}:00`;
      }
    }
    const text = utils.normalizeText(value);
    if (!text) return '';
    if (/^\d{3,4}$/.test(text)) {
      const padded = text.padStart(4, '0');
      return `${padded.slice(0, 2)}:${padded.slice(2, 4)}:00`;
    }
    const twelveHour = text.match(/^(\d{1,2}):?(\d{2})\s*([ap]m)$/i);
    if (twelveHour) {
      let hours = Number(twelveHour[1]);
      const minutes = twelveHour[2];
      const suffix = twelveHour[3].toLowerCase();
      if (suffix === 'pm' && hours < 12) hours += 12;
      if (suffix === 'am' && hours === 12) hours = 0;
      return `${String(hours).padStart(2, '0')}:${minutes}:00`;
    }
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
      const parts = text.split(':');
      return `${parts[0].padStart(2, '0')}:${parts[1]}:${(parts[2] || '00').padStart(2, '0')}`;
    }
    return '';
  }

  function composeDateTime(dateText, timeText) {
    const dateKey = parseDateish(dateText);
    if (!dateKey) return '';
    const time = parseTimeish(timeText);
    const stamp = time ? `${dateKey}T${time}` : `${dateKey}T12:00:00`;
    const dt = new Date(stamp);
    return Number.isNaN(dt.getTime()) ? '' : dt.toISOString();
  }

  function parseDateRangeFromFilename(fileName = '') {
    const text = String(fileName || '');
    const matches = [...text.matchAll(/(\d{6,8})/g)].map((entry) => entry[1]);
    if (matches.length < 2) return { driveStartDate: '', driveEndDate: '', fundraiserLabel: '' };
    const start = parseDateish(matches[0]);
    const end = parseDateish(matches[1]);
    const labelBits = [];
    if (start) labelBits.push(utils.formatDate(start));
    if (end) labelBits.push(utils.formatDate(end));
    return {
      driveStartDate: start,
      driveEndDate: end,
      fundraiserLabel: labelBits.length === 2 ? `Imported pledge ${labelBits[0]} – ${labelBits[1]}` : ''
    };
  }

  function buildLibraryLookup() {
    const rows = state.rawRows || [];
    const byNola = new Map();
    const titleBuckets = new Map();
    rows.forEach((row) => {
      const nolaKey = utils.normalizeLookupKey(derive.nola(row));
      if (nolaKey && !byNola.has(nolaKey)) byNola.set(nolaKey, row);
      const titleKey = utils.normalizeLookupKey(derive.title(row));
      if (!titleKey) return;
      if (!titleBuckets.has(titleKey)) titleBuckets.set(titleKey, []);
      titleBuckets.get(titleKey).push(row);
    });
    const byUniqueTitle = new Map();
    titleBuckets.forEach((items, key) => {
      if (items.length === 1) byUniqueTitle.set(key, items[0]);
    });
    return { byNola, byUniqueTitle };
  }

  function guessTarget(headers = [], rows = [], fileName = '') {
    const sampleKeys = headers.map(keyify);
    const joined = sampleKeys.join(' ');
    if (/pbs_break_report|break report/i.test(fileName)) return 'airings';
    const hasAiringShape = /(air_date|air_time|program_title|nola|dollars|pledges|program_minutes|sustainers)/.test(joined);
    return hasAiringShape ? 'airings' : 'airings';
  }

  function computeImportRowHash(row = {}) {
    const baseForHash = {
      station: utils.normalizeText(row.station) || '',
      imported_program_title: utils.normalizeText(row.imported_program_title || row.program_title || row.title) || '',
      nola_code: utils.normalizeText(row.nola_code) || '',
      air_date: utils.normalizeText(row.air_date) || '',
      air_time: utils.normalizeText(row.air_time) || '',
      dollars: Number(row.dollars || 0) || 0,
      pledges: Number(row.pledge_count || 0) || 0,
      drive_start_date: utils.normalizeText(row.drive_start_date) || '',
      drive_end_date: utils.normalizeText(row.drive_end_date) || '',
      source_file_name: utils.normalizeText(row.source_file_name) || ''
    };
    return hashText(stableStringify(baseForHash));
  }

  function findProgramForImport({ importedTitle = '', nola = '', station = '' }, libraryLookup) {
    const nolaKey = utils.normalizeLookupKey(nola);
    if (nolaKey && libraryLookup.byNola.has(nolaKey)) {
      return { program: libraryLookup.byNola.get(nolaKey), matchMethod: 'nola', matchReason: '' };
    }
    const aliasRule = findAliasRuleForRow({ station, imported_program_title: importedTitle, nola_code: nola });
    if (aliasRule) {
      const target = (state.rawRows || []).find((row) => String(derive.programId(row) || '').trim() === String(aliasRule.targetProgramId || '').trim()) || null;
      if (target) {
        return { program: target, matchMethod: 'saved_title_rule', matchReason: 'Matched from a saved import-title rule.' };
      }
    }
    const titleKey = importTitleKey(importedTitle);
    if (titleKey && libraryLookup.byUniqueTitle.has(titleKey)) {
      return { program: libraryLookup.byUniqueTitle.get(titleKey), matchMethod: 'title_exact', matchReason: 'Matched by exact imported title.' };
    }
    return { program: null, matchMethod: 'unmatched', matchReason: nola ? `No pledge-library match found for NOLA ${nola}.` : 'No pledge-library match found for that imported title.' };
  }

  function normalizeAiringRow(row, meta, libraryLookup) {
    const mapped = mapRowKeys(row);
    const importedTitle = utils.normalizeText(firstMatching(mapped, ['program_title', 'title', 'program', 'show_title'], /(program|show|title)/i));
    const nola = utils.normalizeText(firstMatching(mapped, ['nola_code', 'nola', 'program_nola'], /(nola|program_code|episode_code)/i));
    if (!nola && !importedTitle) {
      return { row: null, warning: `Skipped one row in ${meta.fileName} because it had neither a usable title nor a NOLA.` };
    }

    const airDateRaw = firstMatching(mapped, ['air_date', 'date', 'broadcast_date'], /(air.*date|broadcast.*date|date$)/i);
    const airTimeRaw = firstMatching(mapped, ['air_time', 'time', 'broadcast_time'], /(air.*time|broadcast.*time|time$)/i);
    const airDate = parseDateish(airDateRaw);
    const airTime = parseTimeish(airTimeRaw);
    const airedAt = composeDateTime(airDateRaw, airTimeRaw);

    const station = utils.normalizeText(firstMatching(mapped, ['station'], /(station)/i));
    const primaryDollars = parseMoney(firstMatching(mapped, ['dollars', 'contribution_total', 'total_contributions', 'revenue'], /(^dollars$|contribution|revenue|gross|amount)/i));
    const secondaryDollars = parseMoney(firstMatching(mapped, ['secondary_dollars', 'secondary_amount'], /(secondary.*dollars|secondary.*amount)/i));
    const dollars = Number.isFinite(primaryDollars) || Number.isFinite(secondaryDollars)
      ? (Number(primaryDollars || 0) + Number(secondaryDollars || 0))
      : null;
    const pledges = parseInteger(firstMatching(mapped, ['pledges'], /(pledges|pledge_count)/i));
    const programMinutes = parseInteger(firstMatching(mapped, ['program_minutes', 'minutes'], /(program.*minutes|minutes)/i));
    const sustainers = parseInteger(firstMatching(mapped, ['sustainers'], /(sustainers)/i));
    const isNonSpecific = isNonSpecificNola(nola) || isNonSpecificTitle(importedTitle);
    const reportTotalDollars = Number.isFinite(Number(meta.reportTotalDollars)) ? Number(meta.reportTotalDollars) : null;

    let matchedProgram = null;
    let matchMethod = 'unmatched';
    let matchReason = '';
    if (isNonSpecific) {
      matchMethod = 'non_specific';
      matchReason = 'Non-specific broadcast row';
    } else {
      const match = findProgramForImport({ importedTitle, nola, station }, libraryLookup);
      matchedProgram = match.program || null;
      matchMethod = match.matchMethod;
      matchReason = match.matchReason;
    }
    const matchedLibraryTitle = matchedProgram ? derive.title(matchedProgram) : '';
    const matchedProgramId = matchedProgram ? derive.programId(matchedProgram) : '';
    const titleMismatch = matchedProgram && importedTitle && utils.normalizeLookupKey(importedTitle) !== utils.normalizeLookupKey(matchedLibraryTitle);

    const normalizedRow = {
      program_id: matchedProgramId || null,
      pledge_program_id: matchedProgramId || null,
      title: matchedLibraryTitle || importedTitle || null,
      program_title: matchedLibraryTitle || importedTitle || null,
      imported_program_title: importedTitle || null,
      matched_library_title: matchedLibraryTitle || null,
      nola_code: nola || null,
      station: station || null,
      aired_at: airedAt || null,
      air_date: airDate || null,
      air_time: airTime || null,
      dollars: Number.isFinite(dollars) ? dollars : null,
      dollars_primary: Number.isFinite(primaryDollars) ? primaryDollars : null,
      dollars_secondary: Number.isFinite(secondaryDollars) ? secondaryDollars : null,
      pledge_count: Number.isFinite(pledges) ? pledges : null,
      program_minutes: Number.isFinite(programMinutes) ? programMinutes : null,
      sustainer_count: Number.isFinite(sustainers) ? sustainers : null,
      fundraiser_label: meta.fundraiserLabel || null,
      drive_start_date: meta.driveStartDate || null,
      drive_end_date: meta.driveEndDate || null,
      source_file_name: meta.fileName,
      source_file_key: meta.fileKey || '',
      source_report_total_dollars: reportTotalDollars,
      source_report_type: meta.target,
      source_delimiter: meta.delimiterLabel,
      import_batch_id: imp().importBatchId || '',
      imported_by_email: state.userEmail || null,
      is_non_specific: isNonSpecific,
      match_method: isNonSpecific ? 'non_specific' : (matchedProgram ? matchMethod : 'unmatched_nola'),
      match_reason: isNonSpecific ? 'Non-specific broadcast row' : (matchedProgram ? matchReason : matchReason || `No pledge-library match found for ${nola || importedTitle || 'that row'}.`),
      title_mismatch_flag: titleMismatch || false,
      pending_persist_match_rule: false,
      manual_match_program_id: null,
      manual_match_label: '',
      raw_payload: mapped
    };
    normalizedRow.row_hash = computeImportRowHash(normalizedRow);

    const warning = isNonSpecific
      ? ''
      : matchedProgram
        ? (titleMismatch ? `Imported title “${importedTitle}” matched library title “${matchedLibraryTitle}”. Imported using the library title.` : '')
        : `${nola || importedTitle} from ${meta.fileName} did not match any title in the pledge library.`;

    return { row: normalizedRow, warning };
  }

  function dateKeyDistance(a = '', b = '') {
    if (!(a && b)) return Number.POSITIVE_INFINITY;
    const da = new Date(`${a}T12:00:00`);
    const db = new Date(`${b}T12:00:00`);
    if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return Number.POSITIVE_INFINITY;
    return Math.abs(Math.round((db.getTime() - da.getTime()) / 86400000));
  }

  function clusterDateKeys(dateKeys = []) {
    const sorted = [...new Set((dateKeys || []).filter(Boolean))].sort();
    if (!sorted.length) return [];
    const groups = [];
    let current = [sorted[0]];
    for (let index = 1; index < sorted.length; index += 1) {
      const next = sorted[index];
      const previous = current[current.length - 1];
      const gap = dateKeyDistance(previous, next);
      if (Number.isFinite(gap) && gap > IMPORTED_FUNDRAISER_CLUSTER_GAP_DAYS) {
        groups.push({ startDate: current[0], endDate: current[current.length - 1], dates: current.slice() });
        current = [next];
      } else {
        current.push(next);
      }
    }
    if (current.length) groups.push({ startDate: current[0], endDate: current[current.length - 1], dates: current.slice() });
    return groups;
  }

  function activityDateForRow(row = {}) {
    return utils.normalizeText(row.air_date) || utils.dateKeyFromDate(row.aired_at) || '';
  }

  function rowHasFundraisingActivity(row = {}) {
    const dollars = Number(row.dollars || 0) || 0;
    const pledges = Number(row.pledge_count || 0) || 0;
    return dollars > 0 || pledges > 0;
  }

  function assignDriveRangesForFile(rows = [], summary = null) {
    const datedRows = rows.filter(Boolean);
    const dateKeys = datedRows.map((row) => activityDateForRow(row)).filter(Boolean);
    const activityDates = datedRows.filter((row) => rowHasFundraisingActivity(row)).map((row) => activityDateForRow(row)).filter(Boolean);
    const clusters = clusterDateKeys(activityDates.length ? activityDates : dateKeys);
    const fallbackStart = dateKeys.slice().sort()[0] || '';
    const fallbackEnd = dateKeys.slice().sort().slice(-1)[0] || fallbackStart;
    const resolvedClusters = clusters.length ? clusters : [{ startDate: fallbackStart, endDate: fallbackEnd, dates: [fallbackStart].filter(Boolean) }];
    datedRows.forEach((row) => {
      const rowDate = activityDateForRow(row);
      let cluster = resolvedClusters.find((entry) => rowDate && rowDate >= entry.startDate && rowDate <= entry.endDate) || null;
      if (!cluster) {
        cluster = resolvedClusters.slice().sort((a, b) => {
          const distA = Math.min(dateKeyDistance(rowDate, a.startDate), dateKeyDistance(rowDate, a.endDate));
          const distB = Math.min(dateKeyDistance(rowDate, b.startDate), dateKeyDistance(rowDate, b.endDate));
          return distA - distB;
        })[0] || null;
      }
      row.drive_start_date = cluster?.startDate || fallbackStart || row.drive_start_date || null;
      row.drive_end_date = cluster?.endDate || fallbackEnd || row.drive_end_date || null;
      row.fundraiser_label = (row.drive_start_date && row.drive_end_date)
        ? `Imported pledge ${utils.formatDate(row.drive_start_date)} – ${utils.formatDate(row.drive_end_date)}`
        : (summary?.fileName || row.source_file_name || 'Imported fundraiser');
      row.source_report_total_dollars = Number.isFinite(Number(summary?.reportTotalDollarsInput)) && Number(summary.reportTotalDollarsInput) > 0
        ? Number(summary.reportTotalDollarsInput)
        : (Number.isFinite(Number(summary?.detectedReportTotalDollars)) && Number(summary.detectedReportTotalDollars) > 0 ? Number(summary.detectedReportTotalDollars) : null);
      row.row_hash = computeImportRowHash(row);
    });
    if (summary) {
      summary.fundraiserClusterCount = resolvedClusters.length;
      summary.detectedStartDate = resolvedClusters[0]?.startDate || fallbackStart || '';
      summary.detectedEndDate = resolvedClusters[resolvedClusters.length - 1]?.endDate || fallbackEnd || '';
      summary.programSpecificTotalDollars = datedRows.filter((row) => !isNonSpecificRow(row)).reduce((sum, row) => sum + (Number(row.dollars || 0) || 0), 0);
      summary.nonSpecificTotalDollars = datedRows.filter((row) => isNonSpecificRow(row)).reduce((sum, row) => sum + (Number(row.dollars || 0) || 0), 0);
      summary.combinedTotalDollars = Number(summary.programSpecificTotalDollars || 0) + Number(summary.nonSpecificTotalDollars || 0);
    }
    return resolvedClusters;
  }

  function updateFileSummaryReconciliation(summary = null) {
    if (!summary) return;
    const reportTotal = Number(summary.reportTotalDollarsInput || 0) || 0;
    summary.reportDifferenceDollars = reportTotal > 0 ? Math.round((reportTotal - Number(summary.combinedTotalDollars || 0)) * 100) / 100 : null;
  }

  function deriveRollups(airingsRows = []) {
    const groups = new Map();
    airingsRows.forEach((row) => {
      const driveKey = utils.normalizeLookupKey([
        row.fundraiser_label || '',
        row.drive_start_date || '',
        row.drive_end_date || '',
        row.source_file_name || ''
      ].join('|')) || `ungrouped|${row.source_file_name || 'file'}`;
      const key = `${driveKey}|${utils.normalizeLookupKey(row.nola_code || row.title || 'unknown')}`;
      if (!groups.has(key)) {
        groups.set(key, {
          title: row.title || row.program_title || row.imported_program_title || 'Untitled program',
          nola_code: row.nola_code || '',
          fundraiser_label: row.fundraiser_label || row.source_file_name || 'Imported batch',
          drive_start_date: row.drive_start_date || '',
          drive_end_date: row.drive_end_date || '',
          airing_count: 0,
          total_dollars: 0,
          total_pledges: 0,
          total_sustainers: 0,
          total_minutes: 0,
          program_id: row.program_id || row.pledge_program_id || null,
          pledge_program_id: row.pledge_program_id || row.program_id || null
        });
      }
      const bucket = groups.get(key);
      bucket.airing_count += 1;
      bucket.total_dollars += Number(row.dollars || 0);
      bucket.total_pledges += Number(row.pledge_count || 0);
      bucket.total_sustainers += Number(row.sustainer_count || 0);
      bucket.total_minutes += Number(row.program_minutes || 0);
    });
    return [...groups.values()].sort((a, b) => {
      const dateA = `${a.drive_start_date}|${a.nola_code}`;
      const dateB = `${b.drive_start_date}|${b.nola_code}`;
      return dateA.localeCompare(dateB);
    });
  }

  async function readFileText(file) {
    const name = String(file?.name || '').toLowerCase();
    if (/\.(xlsx|xls)$/.test(name)) {
      throw new Error(`Excel workbooks are still not parsed in-browser. Export the PBS Break Report tab from ${file.name} as CSV, then load that CSV here.`);
    }
    return file.text();
  }

  async function analyzeFiles(files = []) {
    imp().loading = true;
    imp().error = '';
    imp().rawFiles = files;
    imp().fileSummaries = [];
    imp().airingsRows = [];
    imp().driveRows = [];
    imp().warnings = [];
    imp().existingUnlinkedError = '';
    imp().lastAnalyzedAt = new Date().toISOString();
    imp().lastImportResult = null;
    imp().importBatchId = utils.makeId('import');
    setResultBanner('');
    renderAll();
    setStatus(`Analyzing ${utils.formatCount(files.length)} file${files.length === 1 ? '' : 's'}…`);

    const libraryLookup = buildLibraryLookup();
    const savedTotals = storedReportTotals();

    try {
      const allAirings = [];
      for (const [fileIndex, file] of files.entries()) {
        const fileWarnings = [];
        try {
          const text = await readFileText(file);
          const delimiterInfo = detectDelimiter(text);
          const parsed = parseDelimited(text, delimiterInfo.delimiter);
          const fileKey = fileKeyForMeta(file, fileIndex);
          const detectedReportTotalDollars = Number.isFinite(Number(parsed?.diagnostics?.trailerTotalsDollars)) && Number(parsed.diagnostics.trailerTotalsDollars) > 0
            ? Number(parsed.diagnostics.trailerTotalsDollars)
            : null;
          const storedTotal = Number(savedTotals[fileKey] || 0) || 0;
          const meta = {
            fileName: file.name,
            fileKey,
            target: imp().targetMode === 'auto' ? guessTarget(parsed.headers, parsed.records, file.name) : imp().targetMode,
            delimiterLabel: delimiterInfo.label,
            reportTotalDollars: storedTotal > 0 ? storedTotal : detectedReportTotalDollars,
            ...parseDateRangeFromFilename(file.name)
          };

          const normalized = [];
          parsed.records.forEach((record) => {
            const result = normalizeAiringRow(record, meta, libraryLookup);
            if (result.warning) fileWarnings.push(result.warning);
            if (result.row) normalized.push(result.row);
          });

          const fileSummary = {
            fileKey,
            fileName: file.name,
            delimiter: delimiterInfo.label,
            headerCount: parsed.headers.length,
            parsedRows: parsed.records.length,
            target: 'airings',
            normalizedRows: normalized.length,
            detectedFormat: parsed?.diagnostics?.detectedFormat || 'headered_csv',
            warnings: [],
            detectedReportTotalDollars,
            reportTotalDollarsInput: storedTotal > 0 ? storedTotal : (detectedReportTotalDollars || ''),
            programSpecificTotalDollars: 0,
            nonSpecificTotalDollars: 0,
            combinedTotalDollars: 0,
            reportDifferenceDollars: null,
            fundraiserClusterCount: 0,
            detectedStartDate: '',
            detectedEndDate: ''
          };

          assignDriveRangesForFile(normalized, fileSummary);
          updateFileSummaryReconciliation(fileSummary);

          const parseDiagnostics = parsed.diagnostics || {};
          const summaryWarnings = [...new Set(fileWarnings)];
          if (parseDiagnostics.detectedFormat === 'legacy_pbs_break_report') {
            summaryWarnings.unshift('Detected legacy PBS Break Report CSV format.');
          }
          if (parseDiagnostics.embeddedHeaderRows) {
            summaryWarnings.push(`${utils.formatCount(parseDiagnostics.embeddedHeaderRows)} embedded header row${parseDiagnostics.embeddedHeaderRows === 1 ? '' : 's'} skipped.`);
          }
          if (parseDiagnostics.trailerRowsSkipped) {
            summaryWarnings.push(`${utils.formatCount(parseDiagnostics.trailerRowsSkipped)} trailer / totals row${parseDiagnostics.trailerRowsSkipped === 1 ? '' : 's'} skipped.`);
            if (Number(parseDiagnostics.trailerTotalsDollars || 0) > 0) summaryWarnings.push(`Legacy report total detected: ${utils.formatMoney(Number(parseDiagnostics.trailerTotalsDollars || 0))}.`);
          }
          if (parseDiagnostics.totalRowsSkipped) {
            summaryWarnings.push(`${utils.formatCount(parseDiagnostics.totalRowsSkipped)} malformed legacy row${parseDiagnostics.totalRowsSkipped === 1 ? '' : 's'} skipped.`);
          }
          if (!(Number(fileSummary.reportTotalDollarsInput || 0) > 0)) {
            summaryWarnings.unshift('Enter the report total from the original report before importing this file.');
          }
          if (Number.isFinite(Number(fileSummary.reportDifferenceDollars)) && Math.abs(Number(fileSummary.reportDifferenceDollars)) >= 0.01) {
            summaryWarnings.unshift(`Reconciliation difference currently ${utils.formatMoney(Number(fileSummary.reportDifferenceDollars || 0))}.`);
          }
          fileSummary.warnings = summaryWarnings.slice(0, 12);
          imp().fileSummaries.push(fileSummary);
          allAirings.push(...normalized);
        } catch (error) {
          const message = error?.message || String(error);
          imp().fileSummaries.push({
            fileKey: fileKeyForMeta(file, fileIndex),
            fileName: file.name,
            delimiter: '—',
            headerCount: 0,
            parsedRows: 0,
            target: 'airings',
            normalizedRows: 0,
            detectedFormat: 'unreadable',
            programSpecificTotalDollars: 0,
            nonSpecificTotalDollars: 0,
            combinedTotalDollars: 0,
            reportDifferenceDollars: null,
            fundraiserClusterCount: 0,
            detectedStartDate: '',
            detectedEndDate: '',
            warnings: [message]
          });
          imp().warnings.push(message);
        }
      }

      const deduped = new Map();
      allAirings.forEach((row) => {
        row.row_hash = computeImportRowHash(row);
        if (!deduped.has(row.row_hash)) deduped.set(row.row_hash, row);
      });
      imp().airingsRows = [...deduped.values()];
      imp().driveRows = deriveRollups(imp().airingsRows);

      const matchedCount = getMatchedRows().length;
      const unmatchedCount = getUnmatchedRows().length;
      const eligibleRows = matchedCount;
      const missingReportTotals = imp().fileSummaries.filter((item) => item.normalizedRows && !(Number(item.reportTotalDollarsInput || 0) > 0)).length;
      if (imp().airingsRows.length) {
        imp().warnings.unshift(`The importer has ${utils.formatCount(eligibleRows)} eligible row${eligibleRows === 1 ? '' : 's'} ready for import and ${utils.formatCount(unmatchedCount)} unmatched row${unmatchedCount === 1 ? '' : 's'} still needing review.`);
      }
      if (missingReportTotals) {
        imp().warnings.unshift(`${utils.formatCount(missingReportTotals)} file${missingReportTotals === 1 ? '' : 's'} still need a report total entered before import.`);
      }
      renderAll();
      const legacyFiles = imp().fileSummaries.filter((item) => item.detectedFormat === 'legacy_pbs_break_report').length;
      const legacyNote = legacyFiles ? ` ${utils.formatCount(legacyFiles)} legacy PBS Break Report file${legacyFiles === 1 ? '' : 's'} detected.` : '';
      const totalsNote = missingReportTotals ? ` Enter the report total for ${utils.formatCount(missingReportTotals)} file${missingReportTotals === 1 ? '' : 's'} before importing.` : ' Report totals are ready for reconciliation.';
      setStatus(`Preview ready: ${utils.formatCount(eligibleRows)} eligible rows can be imported. ${utils.formatCount(unmatchedCount)} unmatched rows need review.${legacyNote}${totalsNote}`);
      setResultBanner(`Preview ready: ${utils.formatCount(eligibleRows)} eligible airing rows can be imported. ${utils.formatCount(unmatchedCount)} unmatched rows still need review.${legacyNote}${totalsNote}`);
    } catch (error) {
      console.error(error);
      const message = error?.message || 'Report analysis failed.';
      imp().error = message;
      setStatus(message, 'warn');
      setNotice(message, 'warn');
    } finally {
      imp().loading = false;
    }
  }


  function filesMissingReportTotals() {
    return imp().fileSummaries.filter((item) => Number(item.normalizedRows || 0) > 0 && !(Number(item.reportTotalDollarsInput || 0) > 0));
  }

  function hasMissingReportTotals() {
    return filesMissingReportTotals().length > 0;
  }

  function updateRowsForFileSummary(summary = null) {
    if (!summary?.fileKey) return;
    const rows = imp().airingsRows.filter((row) => row.source_file_key === summary.fileKey);
    assignDriveRangesForFile(rows, summary);
    updateFileSummaryReconciliation(summary);
    imp().driveRows = deriveRollups(imp().airingsRows);
  }

  function setManualReportTotalForFile(fileKey = '', rawValue = '') {
    const summary = fileSummaryByKey(fileKey);
    if (!summary) return;
    const parsed = parseMoney(rawValue);
    summary.reportTotalDollarsInput = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : '';
    const totals = { ...storedReportTotals() };
    if (summary.reportTotalDollarsInput) totals[fileKey] = summary.reportTotalDollarsInput;
    else delete totals[fileKey];
    saveStoredReportTotals(totals);
    updateRowsForFileSummary(summary);
    renderAll();
    const diff = Number(summary.reportDifferenceDollars || 0) || 0;
    const message = summary.reportTotalDollarsInput
      ? `Stored report total ${utils.formatMoney(summary.reportTotalDollarsInput)} for ${summary.fileName}.${Math.abs(diff) >= 0.01 ? ` Difference currently ${utils.formatMoney(diff)}.` : ' Import now reconciles exactly.'}`
      : `Cleared the report total for ${summary.fileName}.`;
    setStatus(message, Math.abs(diff) >= 0.01 ? 'warn' : '');
    setResultBanner(message, Math.abs(diff) >= 0.01 ? 'warn' : '');
  }

  function clearBatch() {
    imp().rawFiles = [];
    imp().fileSummaries = [];
    imp().airingsRows = [];
    imp().driveRows = [];
    imp().warnings = [];
    imp().error = '';
    imp().lastAnalyzedAt = '';
    imp().lastImportResult = null;
    setResultBanner('');
    if (els.importFileInput) els.importFileInput.value = '';
    renderAll();
    setStatus('Batch cleared.');
  }

  function rowsToCsv(rows = []) {
    if (!rows.length) return '';
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const encode = (value) => {
      const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [
      keys.map(encode).join(','),
      ...rows.map((row) => keys.map((key) => encode(row[key])).join(','))
    ].join('\n');
  }

  function downloadCsv(filename, rows) {
    if (!rows.length) {
      setNotice('There are no normalized rows to export yet.', 'warn');
      return;
    }
    const csv = rowsToCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function refreshTableStatus(options = {}) {
    if (!state.client) return;
    try {
      imp().tableStatus = await App.data.probeImportTables();
      imp().ready = true;
      if (!options.silent) renderAll();
    } catch (error) {
      console.error(error);
      imp().tableStatus = [];
      imp().warnings.push(`Table probe failed: ${error?.message || error}`);
      if (!options.silent) renderAll();
    }
  }



  async function buildSchedulerFromCurrentBatch(options = {}) {
    if (!App.auth.canEdit()) {
      setResultBanner('Scheduler creation is admin-only.', 'warn');
      return;
    }
    if (hasMissingReportTotals()) {
      setResultBanner(`Enter the report total for ${utils.formatCount(filesMissingReportTotals().length)} file${filesMissingReportTotals().length === 1 ? '' : 's'} before creating scheduler entries.`, 'warn');
      return;
    }
    const matchedRows = getMatchedRows();
    if (!matchedRows.length) {
      setResultBanner('No matched imported airings are available for scheduler creation yet.', 'warn');
      return;
    }
    const summary = await App.schedulingUi?.buildSchedulesFromImportedReports?.({ rows: matchedRows, rebuild: Boolean(options.rebuild) });
    if (summary) {
      const diag = summary.diagnostics || {};
      const extra = summary.skippedRows
        ? ` ${utils.formatCount(summary.skippedRows)} rows could not be placed${(diag.noLibraryMatch || diag.badDate || diag.badTime) ? ` (${utils.formatCount(diag.noLibraryMatch || 0)} no library match, ${utils.formatCount(diag.badDate || 0)} bad date, ${utils.formatCount(diag.badTime || 0)} bad time)` : ''}.`
        : '';
      setResultBanner(`Scheduler updated from the current import batch: ${utils.formatCount(summary.placementsCreated)} entries created, ${utils.formatCount(summary.placementsSkipped)} duplicates skipped.${extra}`);
    }
  }

  async function importToSupabase() {
    if (!App.auth.canEdit()) {
      setNotice('Direct import is admin-only. Export the normalized CSV if you need a handoff first.', 'warn');
      setStatus('Direct import is admin-only.', 'warn');
      setResultBanner('Direct import is admin-only. Sign in as an admin before writing matched rows to Supabase.', 'warn');
      return;
    }
    if (hasMissingReportTotals()) {
      const count = filesMissingReportTotals().length;
      const message = `Enter the report total for ${utils.formatCount(count)} file${count === 1 ? '' : 's'} before importing.`;
      setStatus(message, 'warn');
      setNotice(message, 'warn');
      setResultBanner(message, 'warn');
      return;
    }
    if (!imp().airingsRows.length) {
      setNotice('There is nothing to import yet.', 'warn');
      setResultBanner('There is nothing to import yet. Load a PBS Break Report CSV first.', 'warn');
      return;
    }
    const matchedRows = getMatchedRows();
    const unmatchedCount = imp().airingsRows.length - matchedRows.length;
    if (!matchedRows.length) {
      const message = 'No matched rows are eligible for direct import yet. Resolve the unmatched rows in the review table or export the preview for manual review.';
      setStatus(message, 'warn');
      setNotice(message, 'warn');
      setResultBanner(message, 'warn');
      return;
    }
    setStatus(`Importing or reimporting ${utils.formatCount(matchedRows.length)} matched airing rows to Supabase…`);
    setResultBanner(`Importing or reimporting ${utils.formatCount(matchedRows.length)} matched airing rows. ${utils.formatCount(unmatchedCount)} unmatched rows will be skipped. Existing duplicates will be ignored automatically.`);
    try {
      const summary = await App.data.importNormalizedRows({
        airingsRows: matchedRows,
        driveRows: []
      });
      imp().lastImportResult = { ...summary, skippedUnmatched: unmatchedCount };
      imp().lastImportedAt = new Date().toISOString();
      await refreshTableStatus({ silent: true });
      renderAll();
      const success = `Imported ${utils.formatCount(summary.airings.written)} matched airings row${summary.airings.written === 1 ? '' : 's'} to Supabase. ${utils.formatCount(summary.airings.skippedDuplicates || 0)} duplicate row${(summary.airings.skippedDuplicates || 0) === 1 ? '' : 's'} were skipped automatically, so reimporting corrected reports is safe. ${utils.formatCount(unmatchedCount)} unmatched row${unmatchedCount === 1 ? '' : 's'} were skipped.`;
      setStatus(success);
      setResultBanner(success);
      setNotice(success);
      await App.performanceUi?.refreshData({ silent: true });
      App.performanceUi?.renderAll();
    } catch (error) {
      console.error(error);
      const message = error?.message || 'Supabase import failed.';
      setStatus(message, 'warn');
      setNotice(message, 'warn');
      setResultBanner(`Import failed. No rows were written. ${message}`, 'warn');
    }
  }

  function renderSummary() {
    if (!els.importSummaryGrid) return;
    const values = [
      utils.formatCount(imp().rawFiles.length),
      utils.formatCount(imp().fileSummaries.reduce((sum, item) => sum + (item.parsedRows || 0), 0)),
      utils.formatCount(imp().airingsRows.length),
      utils.formatCount(imp().driveRows.length)
    ];
    [...els.importSummaryGrid.querySelectorAll('.performance-stat-value')].forEach((el, index) => {
      el.textContent = values[index] || '0';
    });
  }

  function renderTableStatus() {
    if (!els.importTableStatus || !els.importTablePill) return;
    if (!imp().tableStatus.length) {
      els.importTableStatus.innerHTML = '<div class="placeholder-row">No table probe yet.</div>';
      els.importTablePill.textContent = 'Pending probe';
      return;
    }
    const readableCount = imp().tableStatus.filter((item) => item.readable).length;
    els.importTablePill.textContent = `${utils.formatCount(readableCount)} / ${utils.formatCount(imp().tableStatus.length)} readable`;
    els.importTableStatus.innerHTML = imp().tableStatus.map((item) => `
      <div class="import-table-status-row ${item.readable ? '' : 'bad'}">
        <strong>${escape(item.tableName)}</strong>
        <div>${item.readable ? `${escape(utils.formatCount(item.count))} readable rows` : 'Unreadable right now'}</div>
        <div>${item.error ? escape(item.error) : (item.writable ? 'Ready for matched-row writes.' : 'Readable derived view.')}</div>
      </div>
    `).join('');
  }

  function renderWarnings() {
    if (!els.importWarningList) return;
    const warnings = [...new Set(imp().warnings.filter(Boolean))];
    if (imp().lastImportResult) {
      warnings.unshift(`Last import wrote ${utils.formatCount(imp().lastImportResult.airings.written)} airings rows, skipped ${utils.formatCount(imp().lastImportResult.airings.skippedDuplicates || 0)} duplicates, and skipped ${utils.formatCount(imp().lastImportResult.skippedUnmatched || 0)} unmatched rows. Fundraiser rollups remain derived only.`);
    }
    if (!warnings.length) {
      els.importWarningList.innerHTML = '';
      return;
    }
    els.importWarningList.innerHTML = warnings.map((warning) => `<div class="import-warning-item">${escape(warning)}</div>`).join('');
  }

  function renderFileAudit() {
    if (!els.importFileBody || !els.importFilePill) return;
    els.importFilePill.textContent = imp().fileSummaries.length ? `${utils.formatCount(imp().fileSummaries.length)} files` : 'No files';
    if (!imp().fileSummaries.length) {
      els.importFileBody.innerHTML = '<tr><td colspan="10" class="placeholder-row">No reports analyzed yet.</td></tr>';
      return;
    }
    els.importFileBody.innerHTML = imp().fileSummaries.map((item) => {
      const diff = Number(item.reportDifferenceDollars || 0);
      const diffWarn = Number.isFinite(diff) && Math.abs(diff) >= 0.01;
      const reportValue = Number(item.reportTotalDollarsInput || 0) > 0 ? utils.formatMoney(item.reportTotalDollarsInput) : '';
      const dateRange = item.detectedStartDate && item.detectedEndDate
        ? `${utils.formatDate(item.detectedStartDate)} – ${utils.formatDate(item.detectedEndDate)}${Number(item.fundraiserClusterCount || 0) > 1 ? ` (${utils.formatCount(item.fundraiserClusterCount)} clusters)` : ''}`
        : '—';
      return `
      <tr>
        <td>${escape(item.fileName)}</td>
        <td>${escape(item.parsedRows)}</td>
        <td>${escape(item.normalizedRows)}</td>
        <td>${escape(utils.formatMoney(item.programSpecificTotalDollars || 0))}</td>
        <td>${escape(utils.formatMoney(item.nonSpecificTotalDollars || 0))}</td>
        <td>${escape(utils.formatMoney(item.combinedTotalDollars || 0))}</td>
        <td><input type="text" class="import-report-total-input" data-file-key="${escape(item.fileKey || '')}" value="${escape(reportValue)}" placeholder="$0.00"></td>
        <td class="${diffWarn ? 'import-diff-warn' : ''}">${item.reportDifferenceDollars == null ? '—' : escape(utils.formatMoney(item.reportDifferenceDollars))}</td>
        <td>${escape(dateRange)}</td>
        <td>${escape((item.warnings || []).join(' | ') || '—')}</td>
      </tr>
    `;
    }).join('');
  }

  function renderPreviewRows(rows, bodyEl, columns, emptyMessage) {
    if (!bodyEl) return;
    if (!rows.length) {
      bodyEl.innerHTML = `<tr><td colspan="${columns.length}" class="placeholder-row">${escape(emptyMessage)}</td></tr>`;
      return;
    }
    bodyEl.innerHTML = rows.slice(0, 25).map((row) => `
      <tr>
        ${columns.map((column) => `<td>${escape(column.format ? column.format(row[column.key], row) : row[column.key])}</td>`).join('')}
      </tr>
    `).join('');
  }

  function unmatchedTitleGroupKey(row) {
    return utils.normalizeLookupKey(row?.imported_program_title || row?.title || row?.nola_code || '');
  }

  function rowsForUnmatchedTitleGroup(rowOrHash) {
    const sourceRow = typeof rowOrHash === 'string'
      ? imp().airingsRows.find((row) => row.row_hash === rowOrHash)
      : rowOrHash;
    if (!sourceRow) return [];
    const groupKey = unmatchedTitleGroupKey(sourceRow);
    if (!groupKey) return sourceRow ? [sourceRow] : [];
    return imp().airingsRows.filter((row) => unmatchedTitleGroupKey(row) === groupKey);
  }

  function syncPendingManualMatch(rowHash, programId) {
    const targetId = String(programId || '').trim();
    const rows = rowsForUnmatchedTitleGroup(rowHash);
    rows.forEach((row) => {
      row.pending_manual_match_program_id = targetId || '';
      const targetRow = targetId
        ? (state.rawRows || []).find((candidate) => String(derive.programId(candidate) || '') === targetId)
        : null;
      row.pending_manual_match_label = targetRow ? (derive.title(targetRow) || '') : '';
    });
  }

  function syncPersistMatchRule(rowHash, shouldPersist = false) {
    const rows = rowsForUnmatchedTitleGroup(rowHash);
    rows.forEach((row) => {
      row.pending_persist_match_rule = Boolean(shouldPersist);
    });
  }

  function applyManualMatchToGroup(rowHash, programId, options = {}) {
    const targetId = String(programId || '').trim();
    if (!targetId) {
      setNotice('Choose a pledge-library title before applying a manual match.', 'warn');
      return 0;
    }
    const targetRow = (state.rawRows || []).find((row) => String(derive.programId(row) || '') === targetId);
    if (!targetRow) {
      setNotice('That program could not be found in the current pledge library.', 'warn');
      return 0;
    }
    const rows = rowsForUnmatchedTitleGroup(rowHash);
    if (!rows.length) return 0;
    const shouldPersist = options.persistRule ?? rows.some((row) => Boolean(row.pending_persist_match_rule));
    rows.forEach((airing) => {
      airing.program_id = derive.programId(targetRow) || null;
      airing.pledge_program_id = airing.program_id;
      airing.matched_library_title = derive.title(targetRow) || '';
      airing.manual_match_program_id = airing.program_id;
      airing.manual_match_label = derive.title(targetRow) || '';
      airing.pending_manual_match_program_id = '';
      airing.pending_manual_match_label = '';
      airing.title = airing.matched_library_title || airing.imported_program_title || airing.title;
      airing.program_title = airing.title;
      airing.match_method = 'manual_library';
      airing.match_reason = 'Matched manually from import review';
      airing.pending_persist_match_rule = Boolean(shouldPersist);
      airing.row_hash = computeImportRowHash(airing);
    });
    if (shouldPersist) storeAliasRule({ station: rows[0]?.station || '', importedTitle: rows[0]?.imported_program_title || rows[0]?.title || '', targetProgram: targetRow });
    imp().driveRows = deriveRollups(imp().airingsRows);
    renderAll();
    const label = utils.toDisplayText(rows[0]?.imported_program_title || rows[0]?.nola_code || 'row');
    const count = rows.length;
    const persistNote = shouldPersist ? ' Future imports will auto-match this title.' : '';
    setStatus(`Manual match applied for ${label}. ${utils.formatCount(count)} row${count === 1 ? '' : 's'} updated.${persistNote}`);
    setResultBanner(`Manual match applied. ${utils.formatCount(count)} row${count === 1 ? '' : 's'} updated in that title group.${persistNote} Existing duplicates will be skipped automatically.`);
    return count;
  }

  function applyAllPendingMatches() {
    const pendingRows = getUnmatchedRows().filter((row) => String(row.pending_manual_match_program_id || '').trim());
    if (!pendingRows.length) {
      setNotice('Stage one or more unmatched-title matches before using Apply All.', 'warn');
      return;
    }
    const seen = new Set();
    let updated = 0;
    pendingRows.forEach((row) => {
      const groupKey = unmatchedTitleGroupKey(row) || row.row_hash || '';
      if (!groupKey || seen.has(groupKey)) return;
      seen.add(groupKey);
      updated += applyManualMatchToGroup(row.row_hash, row.pending_manual_match_program_id, { persistRule: Boolean(row.pending_persist_match_rule) });
    });
    if (updated) {
      setNotice(`Applied staged matches to ${utils.formatCount(updated)} unmatched row${updated === 1 ? '' : 's'}.`);
    }
  }

  function applyManualMatch(rowHash, programId) {
    return applyManualMatchToGroup(rowHash, programId);
  }


  async function createAndLinkNewProgram(rowHash) {
    if (!App.auth.canEdit()) {
      setNotice('Sign in as admin to create a new pledge title from an unmatched row.', 'warn');
      return;
    }
    const airing = imp().airingsRows.find((row) => row.row_hash === rowHash);
    if (!airing) return;
    const title = utils.normalizeText(airing.imported_program_title || airing.title);
    const nola = utils.normalizeText(airing.nola_code);
    if (!title) {
      setNotice('This unmatched row has no usable title, so a new library title cannot be created from it.', 'warn');
      return;
    }
    if (!nola) {
      setNotice('This unmatched row has no NOLA, so it cannot create a new pledge title yet.', 'warn');
      return;
    }
    const existing = (state.rawRows || []).find((row) => utils.normalizeLookupKey(derive.nola(row)) === utils.normalizeLookupKey(nola));
    if (existing) {
      syncPendingManualMatch(rowHash, derive.programId(existing));
      applyManualMatchToGroup(rowHash, derive.programId(existing));
      return;
    }
    try {
      setStatus(`Creating a new pledge-library title for ${utils.toDisplayText(title)}…`);
      const response = await App.data.createProgram({ title, nola_code: nola });
      if (response.error) throw response.error;
      await App.data.refreshRawRows();
      App.listUi?.buildFilterOptions?.();
      const createdId = derive.programId(response.data || {});
      syncPendingManualMatch(rowHash, createdId);
      const linkedCount = applyManualMatchToGroup(rowHash, createdId, { persistRule: rowsForUnmatchedTitleGroup(rowHash).some((row) => Boolean(row.pending_persist_match_rule)) });
      setNotice(`Created ${title} and linked ${utils.formatCount(linkedCount)} row${linkedCount === 1 ? '' : 's'} from that unmatched title group.`);
    } catch (error) {
      setNotice(`Could not create a new pledge title from that unmatched row. ${error?.message || error}`, 'warn');
    }
  }

  function renderUnmatchedRows() {
    if (els.importUnmatchedPill) els.importUnmatchedPill.textContent = `${utils.formatCount(getUnmatchedRows().length)} rows`;
    const bodyEl = els.importUnmatchedBody;
    if (!bodyEl) return;
    const rows = getUnmatchedRows();
    if (!rows.length) {
      bodyEl.innerHTML = '<tr><td colspan="9" class="placeholder-row">No unmatched rows right now.</td></tr>';
      return;
    }
    bodyEl.innerHTML = rows.slice(0, 80).map((row) => {
      const options = buildLibraryProgramOptions(row.imported_program_title || row.title || row.nola_code || '');
      const selectedProgramId = String(row.pending_manual_match_program_id || row.manual_match_program_id || '');
      const optionHtml = ['<option value="">Select a pledge title…</option>']
        .concat(options.map((entry) => `<option value="${escape(entry.value)}" ${selectedProgramId === String(entry.value) ? 'selected' : ''}>${escape(entry.label)}</option>`))
        .join('');
      return `
      <tr>
        <td>${escape(row.imported_program_title || row.title || '—')}</td>
        <td>${escape(row.nola_code || '—')}</td>
        <td>${escape(row.air_date || '—')}</td>
        <td>${escape(row.air_time || '—')}</td>
        <td>${row.dollars == null ? '—' : escape(utils.formatMoney(row.dollars))}</td>
        <td>${escape(getMatchReason(row))}</td>
        <td>
          <select class="import-manual-match-select" data-row-hash="${escape(row.row_hash)}">${optionHtml}</select>
        </td>
        <td>
          <label class="import-rule-check">
            <input type="checkbox" class="import-persist-match-check" data-row-hash="${escape(row.row_hash)}" ${row.pending_persist_match_rule ? 'checked' : ''}>
            <span>Always</span>
          </label>
        </td>
        <td>
          <div class="import-match-actions">
            <button type="button" class="ghost import-apply-match-button" data-row-hash="${escape(row.row_hash)}">Apply</button>
            <button type="button" class="ghost import-create-link-button" data-row-hash="${escape(row.row_hash)}">Create + link</button>
          </div>
        </td>
      </tr>
    `;
    }).join('');
  }

  function renderExistingUnlinkedRows() {
    if (els.importExistingUnlinkedPill) els.importExistingUnlinkedPill.textContent = `${utils.formatCount(imp().existingUnlinkedRows.length)} rows`;
    const bodyEl = els.importExistingUnlinkedBody;
    if (!bodyEl) return;
    if (imp().existingUnlinkedError) {
      bodyEl.innerHTML = `<tr><td colspan="6" class="placeholder-row">${escape(imp().existingUnlinkedError)}</td></tr>`;
      return;
    }
    const rows = imp().existingUnlinkedRows || [];
    if (!rows.length) {
      bodyEl.innerHTML = '<tr><td colspan="6" class="placeholder-row">No existing unlinked imported airings found.</td></tr>';
      return;
    }
    bodyEl.innerHTML = rows.slice(0, 50).map((row) => `
      <tr>
        <td>${escape(row.imported_program_title || '—')}</td>
        <td>${escape(row.nola_code || '—')}</td>
        <td>${escape(row.air_date || '—')}</td>
        <td>${escape(row.air_time || '—')}</td>
        <td>${row.dollars == null ? '—' : escape(utils.formatMoney(row.dollars))}</td>
        <td>${escape(row.source_file_name || '—')}</td>
      </tr>
    `).join('');
  }

  function renderPreviews() {
    if (els.importAiringsPill) els.importAiringsPill.textContent = `${utils.formatCount(imp().airingsRows.length)} rows`;
    if (els.importDrivePill) els.importDrivePill.textContent = `${utils.formatCount(imp().driveRows.length)} derived rows`;

    renderPreviewRows(imp().airingsRows, els.importAiringsBody, [
      { key: 'title' },
      { key: 'nola_code' },
      { key: 'aired_at', format: (value) => utils.formatDateTime(value, '—') },
      { key: 'dollars', format: (value) => value == null ? '—' : utils.formatMoney(value) },
      { key: 'pledge_count' },
      { key: 'program_minutes' },
      { key: 'match_method', format: (value, row) => {
        if (value === 'manual_library') return 'manual match';
        if (value === 'saved_title_rule') return 'saved rule';
        if (value === 'title_exact') return 'exact title';
        if (value === 'non_specific') return 'non-specific';
        if (value === 'unmatched_nola') return 'needs review';
        return value;
      } },
      { key: 'matched_library_title' }
    ], 'No normalized airings rows yet.');

    renderPreviewRows(imp().driveRows, els.importDriveBody, [
      { key: 'title' },
      { key: 'nola_code' },
      { key: 'fundraiser_label' },
      { key: 'drive_start_date' },
      { key: 'drive_end_date' },
      { key: 'total_dollars', format: (value) => value == null ? '—' : utils.formatMoney(value) },
      { key: 'total_pledges' },
      { key: 'airing_count' }
    ], 'No derived fundraiser rollups yet.');

    renderUnmatchedRows();
    renderExistingUnlinkedRows();
  }

  function renderActions() {
    const canEdit = App.auth.canEdit();
    const matchedCount = getMatchedRows().length;
    const missingTotals = filesMissingReportTotals();
    const needsTotals = missingTotals.length > 0;
    const canImport = Boolean(canEdit && matchedCount);
    const canBuild = Boolean(canEdit && matchedCount);
    if (els.importSupabaseButton) {
      els.importSupabaseButton.disabled = !canImport;
      els.importSupabaseButton.title = !canEdit
        ? 'Admin sign-in required for direct Supabase writes.'
        : (needsTotals
          ? `Enter the report total for ${utils.formatCount(missingTotals.length)} file${missingTotals.length === 1 ? '' : 's'} first.`
          : (matchedCount ? '' : 'Load matched imported airings first.'));
    }
    if (els.importBuildScheduleButton) {
      els.importBuildScheduleButton.disabled = !canBuild;
      els.importBuildScheduleButton.title = !canEdit
        ? 'Admin sign-in required for scheduler writes.'
        : (needsTotals
          ? `Enter the report total for ${utils.formatCount(missingTotals.length)} file${missingTotals.length === 1 ? '' : 's'} first.`
          : (matchedCount ? '' : 'Load matched imported airings first, then sign in as admin.'));
    }
    if (needsTotals) {
      setStatusPill(`Reconciliation required · ${utils.formatCount(missingTotals.length)} file${missingTotals.length === 1 ? '' : 's'}`, true);
      return;
    }
    setStatusPill(canEdit ? 'Direct import enabled' : 'Preview / export mode', !canEdit);
  }

  function renderAll() {
    if (els.importTargetSelect) els.importTargetSelect.value = imp().targetMode || 'auto';
    renderSummary();
    renderTableStatus();
    renderWarnings();
    renderFileAudit();
    renderPreviews();
    renderActions();
  }

  async function ensureReady() {
    if (!imp().ready) {
      imp().aliasRules = utils.storageGet(IMPORT_MATCH_RULES_STORAGE_KEY, []);
      imp().reportTotalsByFile = utils.storageGet(IMPORT_REPORT_TOTALS_STORAGE_KEY, {});
      await refreshTableStatus({ silent: true });
      imp().ready = true;
    }
    renderAll();
  }

  function normalizeDroppedFiles(fileList) {
    return [...(fileList || [])].filter(Boolean);
  }

  async function handleImportedFiles(files = []) {
    const usable = normalizeDroppedFiles(files);
    if (!usable.length) return;
    await analyzeFiles(usable);
  }

  function bindEvents() {
    els.importTargetSelect?.addEventListener('change', async (event) => {
      imp().targetMode = event.target.value || 'auto';
      if (imp().rawFiles.length) await analyzeFiles(imp().rawFiles);
      else renderAll();
    });
    els.importFileInput?.addEventListener('change', async (event) => {
      const files = normalizeDroppedFiles(event.target.files);
      if (!files.length) return;
      await handleImportedFiles(files);
    });
    els.importDropZone?.addEventListener('dragenter', (event) => {
      event.preventDefault();
      els.importDropZone.classList.add('drag-over');
    });
    els.importDropZone?.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      els.importDropZone.classList.add('drag-over');
    });
    els.importDropZone?.addEventListener('dragleave', (event) => {
      event.preventDefault();
      const nextTarget = event.relatedTarget;
      if (nextTarget && els.importDropZone.contains(nextTarget)) return;
      els.importDropZone.classList.remove('drag-over');
    });
    els.importDropZone?.addEventListener('drop', (event) => {
      event.preventDefault();
      els.importDropZone.classList.remove('drag-over');
      void handleImportedFiles(event.dataTransfer?.files || []);
    });
    els.importClearButton?.addEventListener('click', clearBatch);
    els.importRefreshButton?.addEventListener('click', async () => {
      await refreshTableStatus();
      setStatus('Table probe refreshed.');
    });
    els.importExportAiringsButton?.addEventListener('click', () => {
      const matchedRows = getMatchedRows();
      if (!matchedRows.length) {
        setNotice('There are no matched airings rows to export yet.', 'warn');
        return;
      }
      downloadCsv(`pledge-airings-matched-${Date.now()}.csv`, matchedRows);
    });
    els.importExportDriveButton?.addEventListener('click', () => {
      downloadCsv(`pledge-fundraiser-rollups-derived-${Date.now()}.csv`, imp().driveRows);
    });
    els.importSupabaseButton?.addEventListener('click', () => { void importToSupabase(); });
    els.importBuildScheduleButton?.addEventListener('click', () => { void buildSchedulerFromCurrentBatch(); });
    els.importApplyAllButton?.addEventListener('click', () => { applyAllPendingMatches(); });
    const syncReportTotalInput = (event) => {
      const input = event.target.closest('.import-report-total-input');
      if (!input) return;
      const fileKey = input.getAttribute('data-file-key') || '';
      setManualReportTotalForFile(fileKey, input.value || '');
    };
    els.importFileBody?.addEventListener('input', syncReportTotalInput);
    els.importFileBody?.addEventListener('change', syncReportTotalInput);
    els.importFileBody?.addEventListener('focusout', syncReportTotalInput);
    els.importFileBody?.addEventListener('keydown', (event) => {
      const input = event.target.closest('.import-report-total-input');
      if (!input || event.key !== 'Enter') return;
      event.preventDefault();
      const fileKey = input.getAttribute('data-file-key') || '';
      setManualReportTotalForFile(fileKey, input.value || '');
      input.blur();
    });
    els.importUnmatchedBody?.addEventListener('change', (event) => {
      const ruleToggle = event.target.closest('.import-persist-match-check');
      if (ruleToggle) {
        const rowHash = ruleToggle.getAttribute('data-row-hash') || '';
        syncPersistMatchRule(rowHash, Boolean(ruleToggle.checked));
        renderUnmatchedRows();
        return;
      }
      const select = event.target.closest('.import-manual-match-select');
      if (!select) return;
      const rowHash = select.getAttribute('data-row-hash') || '';
      syncPendingManualMatch(rowHash, select.value || '');
      renderUnmatchedRows();
    });
    els.importUnmatchedBody?.addEventListener('click', (event) => {
      const applyButton = event.target.closest('.import-apply-match-button');
      if (applyButton) {
        const rowHash = applyButton.getAttribute('data-row-hash') || '';
        const select = els.importUnmatchedBody.querySelector(`.import-manual-match-select[data-row-hash="${rowHash}"]`);
        const selectedProgramId = select?.value || '';
        syncPendingManualMatch(rowHash, selectedProgramId);
        applyManualMatch(rowHash, selectedProgramId);
        return;
      }
      const createButton = event.target.closest('.import-create-link-button');
      if (createButton) {
        const rowHash = createButton.getAttribute('data-row-hash') || '';
        void createAndLinkNewProgram(rowHash);
      }
    });
  }

  App.importsUi = {
    ensureReady,
    bindEvents,
    renderAll,
    refreshTableStatus
  };
})();

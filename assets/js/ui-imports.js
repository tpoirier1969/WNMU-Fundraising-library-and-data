
(() => {
  const App = window.PledgeLib;
  const { state, utils, derive } = App;
  const { els, setNotice } = App.dom;

  function imp() { return state.imports; }
  function escape(value) { return utils.escapeHtml(utils.toDisplayText(value)); }

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
      if (!inQuotes && (char === '
' || char === '')) {
        if (char === '' && next === '
') i += 1;
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

  function parseLegacyBreakReport(rows = []) {
    const headers = ['Station', 'Air Date', 'Air Time', 'NOLA', 'Program Title', 'Dollars', 'Secondary Dollars', 'Pledges', 'Program Minutes', 'Sustainers'];
    const records = [];
    const diagnostics = {
      detectedFormat: 'legacy_pbs_break_report',
      embeddedHeaderRows: 0,
      totalRowsSkipped: 0,
      trailerRowsSkipped: 0,
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
      const hasOnlyTotals = normalized.filter(Boolean).length <= 2 && !utils.normalizeText(cells[3]) && !utils.normalizeText(cells[4]);
      if (hasOnlyTotals) {
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

  function buildLibraryNolaIndex() {
    const rows = state.rawRows || [];
    const byNola = new Map();
    rows.forEach((row) => {
      const nolaKey = utils.normalizeLookupKey(derive.nola(row));
      if (nolaKey && !byNola.has(nolaKey)) byNola.set(nolaKey, row);
    });
    return byNola;
  }

  function guessTarget(headers = [], rows = [], fileName = '') {
    const sampleKeys = headers.map(keyify);
    const joined = sampleKeys.join(' ');
    if (/pbs_break_report|break report/i.test(fileName)) return 'airings';
    const hasAiringShape = /(air_date|air_time|program_title|nola|dollars|pledges|program_minutes|sustainers)/.test(joined);
    return hasAiringShape ? 'airings' : 'airings';
  }

  function normalizeAiringRow(row, meta, nolaIndex) {
    const mapped = mapRowKeys(row);
    const importedTitle = utils.normalizeText(firstMatching(mapped, ['program_title', 'title', 'program', 'show_title'], /(program|show|title)/i));
    const nola = utils.normalizeText(firstMatching(mapped, ['nola_code', 'nola', 'program_nola'], /(nola|program_code|episode_code)/i));
    if (!nola) {
      return { row: null, warning: `Skipped one row in ${meta.fileName} because it had no NOLA.` };
    }

    const matchedProgram = nolaIndex.get(utils.normalizeLookupKey(nola)) || null;
    const matchedLibraryTitle = matchedProgram ? derive.title(matchedProgram) : '';
    const matchedProgramId = matchedProgram ? derive.programId(matchedProgram) : '';
    const titleMismatch = matchedProgram && importedTitle && utils.normalizeLookupKey(importedTitle) !== utils.normalizeLookupKey(matchedLibraryTitle);

    const airDateRaw = firstMatching(mapped, ['air_date', 'date', 'broadcast_date'], /(air.*date|broadcast.*date|date$)/i);
    const airTimeRaw = firstMatching(mapped, ['air_time', 'time', 'broadcast_time'], /(air.*time|broadcast.*time|time$)/i);
    const airDate = parseDateish(airDateRaw);
    const airTime = parseTimeish(airTimeRaw);
    const airedAt = composeDateTime(airDateRaw, airTimeRaw);

    const station = utils.normalizeText(firstMatching(mapped, ['station'], /(station)/i));
    const dollars = parseMoney(firstMatching(mapped, ['dollars', 'contribution_total', 'total_contributions', 'revenue'], /(dollars|contribution|revenue|gross|amount)/i));
    const pledges = parseInteger(firstMatching(mapped, ['pledges'], /(pledges|pledge_count)/i));
    const programMinutes = parseInteger(firstMatching(mapped, ['program_minutes', 'minutes'], /(program.*minutes|minutes)/i));
    const sustainers = parseInteger(firstMatching(mapped, ['sustainers'], /(sustainers)/i));

    const baseForHash = {
      nola_code: nola,
      air_date: airDate || '',
      air_time: airTime || '',
      dollars: dollars ?? '',
      pledges: pledges ?? '',
      source_report_type: meta.target || '',
      drive_start_date: meta.driveStartDate || '',
      drive_end_date: meta.driveEndDate || ''
    };

    return {
      row: {
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
        pledge_count: Number.isFinite(pledges) ? pledges : null,
        program_minutes: Number.isFinite(programMinutes) ? programMinutes : null,
        sustainer_count: Number.isFinite(sustainers) ? sustainers : null,
        fundraiser_label: meta.fundraiserLabel || null,
        drive_start_date: meta.driveStartDate || null,
        drive_end_date: meta.driveEndDate || null,
        source_file_name: meta.fileName,
        source_report_type: meta.target,
        source_delimiter: meta.delimiterLabel,
        import_batch_id: imp().importBatchId || '',
        imported_by_email: state.userEmail || null,
        match_method: matchedProgram ? 'nola' : 'unmatched_nola',
        title_mismatch_flag: titleMismatch || false,
        row_hash: hashText(stableStringify(baseForHash)),
        raw_payload: mapped
      },
      warning: matchedProgram
        ? (titleMismatch ? `NOLA ${nola} matched library title “${matchedLibraryTitle}” while the report carried abbreviated title “${importedTitle}”. Imported using the library title.` : '')
        : `NOLA ${nola} from ${meta.fileName} did not match any title in the pledge library.`
    };
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
    imp().lastAnalyzedAt = new Date().toISOString();
    imp().lastImportResult = null;
    imp().importBatchId = utils.makeId('import');
    setResultBanner('');
    renderAll();
    setStatus(`Analyzing ${utils.formatCount(files.length)} file${files.length === 1 ? '' : 's'}…`);

    const nolaIndex = buildLibraryNolaIndex();

    try {
      const allAirings = [];
      for (const file of files) {
        const fileWarnings = [];
        try {
          const text = await readFileText(file);
          const delimiterInfo = detectDelimiter(text);
          const parsed = parseDelimited(text, delimiterInfo.delimiter);
          const meta = {
            fileName: file.name,
            target: imp().targetMode === 'auto' ? guessTarget(parsed.headers, parsed.records, file.name) : imp().targetMode,
            delimiterLabel: delimiterInfo.label,
            ...parseDateRangeFromFilename(file.name)
          };

          const normalized = [];
          parsed.records.forEach((record) => {
            const result = normalizeAiringRow(record, meta, nolaIndex);
            if (result.warning) fileWarnings.push(result.warning);
            if (result.row) normalized.push(result.row);
          });

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
          }
          if (parseDiagnostics.totalRowsSkipped) {
            summaryWarnings.push(`${utils.formatCount(parseDiagnostics.totalRowsSkipped)} malformed legacy row${parseDiagnostics.totalRowsSkipped === 1 ? '' : 's'} skipped.`);
          }
          imp().fileSummaries.push({
            fileName: file.name,
            delimiter: delimiterInfo.label,
            headerCount: parsed.headers.length,
            parsedRows: parsed.records.length,
            target: 'airings',
            normalizedRows: normalized.length,
            detectedFormat: parseDiagnostics.detectedFormat || 'headered_csv',
            warnings: summaryWarnings.slice(0, 10)
          });
          allAirings.push(...normalized);
        } catch (error) {
          const message = error?.message || String(error);
          imp().fileSummaries.push({
            fileName: file.name,
            delimiter: '—',
            headerCount: 0,
            parsedRows: 0,
            target: 'airings',
            normalizedRows: 0,
            warnings: [message]
          });
          imp().warnings.push(message);
        }
      }

      const deduped = new Map();
      allAirings.forEach((row) => {
        if (!deduped.has(row.row_hash)) deduped.set(row.row_hash, row);
      });
      imp().airingsRows = [...deduped.values()];
      imp().driveRows = deriveRollups(imp().airingsRows);

      const matchedCount = imp().airingsRows.filter((row) => row.match_method === 'nola').length;
      const unmatchedCount = imp().airingsRows.length - matchedCount;
      if (imp().airingsRows.length) {
        imp().warnings.unshift(`NOLA matched ${utils.formatCount(matchedCount)} imported airing rows to the pledge library. ${utils.formatCount(unmatchedCount)} rows stayed unmatched.`);
      }
      if (imp().driveRows.length) {
        imp().warnings.unshift(`Derived ${utils.formatCount(imp().driveRows.length)} fundraiser rollups from imported airings. No separate money rows will be stored.`);
      }

      renderAll();
      const matchedRows = imp().airingsRows.filter((row) => row.match_method === 'nola').length;
      const skippedRows = imp().airingsRows.length - matchedRows;
      const legacyFiles = imp().fileSummaries.filter((item) => item.detectedFormat === 'legacy_pbs_break_report').length;
      const legacyNote = legacyFiles ? ` ${utils.formatCount(legacyFiles)} legacy PBS Break Report file${legacyFiles === 1 ? '' : 's'} detected.` : '';
      setStatus(`Preview ready: ${utils.formatCount(matchedRows)} matched rows can be imported. ${utils.formatCount(skippedRows)} unmatched rows will be skipped.${legacyNote}`);
      setResultBanner(`Preview ready: ${utils.formatCount(matchedRows)} matched airing rows can be imported. ${utils.formatCount(skippedRows)} unmatched rows will stay in preview only and will not be written to Supabase.${legacyNote}`);
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
    const matchedRows = imp().airingsRows.filter((row) => row.match_method === 'nola' && row.program_id != null);
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
    if (!imp().airingsRows.length) {
      setNotice('There is nothing to import yet.', 'warn');
      setResultBanner('There is nothing to import yet. Load a PBS Break Report CSV first.', 'warn');
      return;
    }
    const matchedRows = imp().airingsRows.filter((row) => row.match_method === 'nola' && row.program_id != null);
    const unmatchedCount = imp().airingsRows.length - matchedRows.length;
    if (!matchedRows.length) {
      const message = 'No matched rows are eligible for direct import yet. Fix the NOLAs or export the preview for manual review.';
      setStatus(message, 'warn');
      setNotice(message, 'warn');
      setResultBanner(message, 'warn');
      return;
    }
    setStatus(`Importing ${utils.formatCount(matchedRows.length)} matched airing rows to Supabase…`);
    setResultBanner(`Importing ${utils.formatCount(matchedRows.length)} matched airing rows. ${utils.formatCount(unmatchedCount)} unmatched rows will be skipped.`);
    try {
      const summary = await App.data.importNormalizedRows({
        airingsRows: matchedRows,
        driveRows: []
      });
      imp().lastImportResult = { ...summary, skippedUnmatched: unmatchedCount };
      imp().lastImportedAt = new Date().toISOString();
      await refreshTableStatus({ silent: true });
      renderAll();
      const success = `Imported ${utils.formatCount(summary.airings.written)} matched airings row${summary.airings.written === 1 ? '' : 's'} to Supabase. ${utils.formatCount(summary.airings.skippedDuplicates || 0)} duplicate row${(summary.airings.skippedDuplicates || 0) === 1 ? '' : 's'} were skipped. ${utils.formatCount(unmatchedCount)} unmatched row${unmatchedCount === 1 ? '' : 's'} were skipped.`;
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
      els.importFileBody.innerHTML = '<tr><td colspan="8" class="placeholder-row">No reports analyzed yet.</td></tr>';
      return;
    }
    els.importFileBody.innerHTML = imp().fileSummaries.map((item) => `
      <tr>
        <td>${escape(item.fileName)}</td>
        <td>${escape(item.delimiter)}</td>
        <td>${escape(item.detectedFormat || 'headered_csv')}</td>
        <td>${escape(item.headerCount)}</td>
        <td>${escape(item.parsedRows)}</td>
        <td>${escape(item.target)}</td>
        <td>${escape(item.normalizedRows)}</td>
        <td>${escape(item.warnings.join(' | ') || '—')}</td>
      </tr>
    `).join('');
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
      { key: 'match_method' },
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
  }

  function renderActions() {
    const canImport = App.auth.canEdit();
    if (els.importSupabaseButton) {
      els.importSupabaseButton.disabled = !canImport;
      els.importSupabaseButton.title = canImport ? '' : 'Admin sign-in required for direct Supabase writes.';
    }
    if (els.importBuildScheduleButton) {
      const canBuild = Boolean(App.auth.canEdit() && imp().airingsRows.some((row) => row.match_method === 'nola' && row.program_id != null));
      els.importBuildScheduleButton.disabled = !canBuild;
      els.importBuildScheduleButton.title = canBuild ? '' : 'Load matched imported airings first, then sign in as admin.';
    }
    setStatusPill(canImport ? 'Direct import enabled' : 'Preview / export mode', !canImport);
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
      await refreshTableStatus({ silent: true });
      imp().ready = true;
    }
    renderAll();
  }

  function bindEvents() {
    els.importTargetSelect?.addEventListener('change', async (event) => {
      imp().targetMode = event.target.value || 'auto';
      if (imp().rawFiles.length) await analyzeFiles(imp().rawFiles);
      else renderAll();
    });
    els.importFileInput?.addEventListener('change', async (event) => {
      const files = [...(event.target.files || [])];
      if (!files.length) return;
      await analyzeFiles(files);
    });
    els.importClearButton?.addEventListener('click', clearBatch);
    els.importRefreshButton?.addEventListener('click', async () => {
      await refreshTableStatus();
      setStatus('Table probe refreshed.');
    });
    els.importExportAiringsButton?.addEventListener('click', () => {
      const matchedRows = imp().airingsRows.filter((row) => row.match_method === 'nola' && row.program_id != null);
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
  }

  App.importsUi = {
    ensureReady,
    bindEvents,
    renderAll,
    refreshTableStatus
  };
})();

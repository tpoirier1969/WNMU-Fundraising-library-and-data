(() => {
  const App = window.PledgeLib;
  const { state, utils } = App;
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

  function detectDelimiter(text) {
    const sample = String(text || '').split(/\r?\n/).slice(0, 5).join('\n');
    const counts = [
      { delimiter: '\t', score: (sample.match(/\t/g) || []).length },
      { delimiter: ',', score: (sample.match(/,/g) || []).length },
      { delimiter: ';', score: (sample.match(/;/g) || []).length },
      { delimiter: '|', score: (sample.match(/\|/g) || []).length }
    ].sort((a, b) => b.score - a.score);
    return counts[0]?.score ? counts[0].delimiter : ',';
  }

  function parseDelimited(text, delimiter) {
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
        const meaningful = row.some((value) => utils.normalizeText(value));
        if (meaningful) rows.push(row);
        row = [];
        cell = '';
        continue;
      }
      cell += char;
    }
    row.push(cell);
    if (row.some((value) => utils.normalizeText(value))) rows.push(row);

    if (!rows.length) return { headers: [], records: [] };
    const headers = rows[0].map((value, index) => utils.normalizeText(value) || `column_${index + 1}`);
    const records = rows.slice(1).map((cells) => {
      const out = {};
      headers.forEach((header, index) => {
        out[header] = cells[index] ?? '';
      });
      return out;
    }).filter((record) => Object.values(record).some((value) => utils.normalizeText(value)));
    return { headers, records };
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
    for (const [key, value] of Object.entries(row)) {
      if (regex.test(key) && !utils.isBlank(value)) return value;
    }
    return null;
  }

  function parseMoney(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const cleaned = String(value).replace(/[$,()]/g, '').replace(/\s+/g, '').trim();
    if (!cleaned) return null;
    const negative = String(value).includes('(') && String(value).includes(')');
    const num = Number(cleaned);
    if (!Number.isFinite(num)) return null;
    return negative ? -num : num;
  }

  function parseInteger(value) {
    if (value == null || value === '') return null;
    const num = Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? Math.trunc(num) : null;
  }

  function parseBooleanish(value) {
    if (typeof value === 'boolean') return value;
    const text = utils.normalizeText(value).toLowerCase();
    if (!text) return null;
    if (['true', 'yes', 'y', '1', 'live', 'has live breaks'].includes(text)) return true;
    if (['false', 'no', 'n', '0', 'none', 'no live breaks'].includes(text)) return false;
    return null;
  }


  function parseDateTimeish(value) {
    const text = utils.normalizeText(value);
    if (!text) return '';
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  function parseDateish(value) {
    const text = utils.normalizeText(value);
    if (!text) return '';
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return '';
    return utils.dateKeyFromDate(date);
  }

  function parseTimeish(value) {
    const text = utils.normalizeText(value);
    if (!text) return '';
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) return text.slice(0, 8);
    const date = new Date(`1970-01-01T${text}`);
    if (!Number.isNaN(date.getTime())) return text;
    return '';
  }

  function composeDateTime(dateText, timeText) {
    const dateKey = parseDateish(dateText);
    if (!dateKey) return '';
    const time = parseTimeish(timeText);
    if (time) {
      const combined = new Date(`${dateKey}T${time}`);
      if (!Number.isNaN(combined.getTime())) return combined.toISOString();
    }
    const plain = new Date(`${dateKey}T12:00:00`);
    return Number.isNaN(plain.getTime()) ? '' : plain.toISOString();
  }

  function guessTarget(headers = [], rows = []) {
    const sampleKeys = headers.map(keyify);
    const joined = sampleKeys.join(' ');
    let driveScore = 0;
    let airingScore = 0;
    if (/(contribution|raised|revenue|gross|pledge|amount|total)/.test(joined)) driveScore += 5;
    if (/(local_break|live_break|air_date|air_time|aired_at|airing)/.test(joined)) airingScore += 4;
    if (/(drive_date|fundraiser|drive)/.test(joined)) driveScore += 3;
    rows.slice(0, 25).forEach((row) => {
      const mapped = mapRowKeys(row);
      if (firstMatching(mapped, [], /(contribution|raised|revenue|gross|pledge|amount|total)/)) driveScore += 1;
      if (firstMatching(mapped, [], /(air_date|air_time|aired_at|broadcast|slot)/)) airingScore += 1;
    });
    return driveScore > airingScore ? 'drive_results' : 'airings';
  }

  function baseNormalization(mapped, meta) {
    const title = utils.normalizeText(firstMatching(mapped, ['title', 'program_title', 'program', 'show_title', 'program_name'], /(program|show|title|series)/i));
    const nola = utils.normalizeText(firstMatching(mapped, ['nola_code', 'nola', 'program_nola'], /(nola|episode_code|program_code)/i));
    const programId = utils.normalizeText(firstMatching(mapped, ['program_id', 'pledge_program_id', 'id'], /program_id|pledge_program_id/i));
    const rawDate = utils.normalizeText(firstMatching(mapped, ['aired_at', 'air_date', 'broadcast_date', 'date', 'drive_date'], /(air.*date|broadcast.*date|drive.*date|date$)/i));
    const rawTime = utils.normalizeText(firstMatching(mapped, ['air_time', 'time', 'broadcast_time', 'slot_time'], /(air.*time|broadcast.*time|slot.*time|time$)/i));
    const directDateTime = utils.normalizeText(firstMatching(mapped, ['aired_at', 'broadcast_at', 'datetime', 'date_time'], /(aired_at|broadcast_at|datetime|date_time)/i));
    const airedAt = directDateTime ? (parseDateTimeish(directDateTime) || composeDateTime(directDateTime, '') || directDateTime) : composeDateTime(rawDate, rawTime);
    const airDate = parseDateish(rawDate || directDateTime);
    const airTime = parseTimeish(rawTime);
    const localBreakCount = parseInteger(firstMatching(mapped, ['local_breaks', 'local_break_count', 'local_cutins', 'local_cutins_count'], /(local.*break|local.*cutin)/i));
    const liveBreakFlag = parseBooleanish(firstMatching(mapped, ['live_breaks', 'live_break_flag', 'live_break_count'], /(live.*break)/i));
    const premiumSummary = utils.normalizeText(firstMatching(mapped, ['premium_summary', 'premium_notes', 'premiums'], /(premium)/i));
    return {
      program_id: programId || null,
      pledge_program_id: programId || null,
      title: title || null,
      program_title: title || null,
      nola_code: nola || null,
      aired_at: airedAt || null,
      air_date: airDate || null,
      air_time: airTime || null,
      local_break_count: Number.isFinite(localBreakCount) ? localBreakCount : null,
      live_break_flag: liveBreakFlag == null ? null : liveBreakFlag,
      premium_summary: premiumSummary || null,
      source_file_name: meta.fileName,
      source_report_type: meta.target,
      source_delimiter: meta.delimiterLabel,
      import_batch_id: imp().importBatchId || '',
      imported_by_email: state.userEmail || null,
      raw_payload: mapped
    };
  }

  function normalizeRecord(row, meta) {
    const mapped = mapRowKeys(row);
    const base = baseNormalization(mapped, meta);
    if (!base.title && !base.nola_code) return null;

    if (meta.target === 'drive_results') {
      const contribution = parseMoney(firstMatching(mapped, ['contribution_total', 'total_contributions', 'total_raised', 'revenue', 'gross_contributions'], /(contribution|raised|revenue|gross|amount|pledge)/i));
      const driveDate = parseDateish(firstMatching(mapped, ['drive_date', 'air_date', 'date'], /(drive.*date|air.*date|date$)/i)) || base.air_date || null;
      const payload = {
        ...base,
        drive_date: driveDate,
        contribution_total: Number.isFinite(contribution) ? contribution : null
      };
      payload.row_hash = hashText(stableStringify({
        type: meta.target,
        file: meta.fileName,
        title: payload.title,
        nola: payload.nola_code,
        drive_date: payload.drive_date,
        aired_at: payload.aired_at,
        contribution_total: payload.contribution_total,
        raw: payload.raw_payload
      }));
      return payload;
    }

    const payload = { ...base };
    payload.row_hash = hashText(stableStringify({
      type: meta.target,
      file: meta.fileName,
      title: payload.title,
      nola: payload.nola_code,
      air_date: payload.air_date,
      air_time: payload.air_time,
      aired_at: payload.aired_at,
      raw: payload.raw_payload
    }));
    return payload;
  }

  function delimiterLabel(delimiter) {
    if (delimiter === '\t') return 'tab';
    if (delimiter === ',') return 'comma';
    if (delimiter === ';') return 'semicolon';
    if (delimiter === '|') return 'pipe';
    return delimiter || 'unknown';
  }

  async function analyzeFiles(fileList = []) {
    imp().loading = true;
    imp().error = '';
    imp().warnings = [];
    imp().airingsRows = [];
    imp().driveRows = [];
    imp().fileSummaries = [];
    imp().rawFiles = [...fileList];
    imp().importBatchId = `batch-${Date.now()}`;
    setStatus('Analyzing report files…');
    try {
      for (const file of fileList) {
        const text = await file.text();
        const delimiter = detectDelimiter(text);
        const parsed = parseDelimited(text, delimiter);
        const forcedTarget = imp().targetMode === 'auto' ? '' : imp().targetMode;
        const target = forcedTarget || guessTarget(parsed.headers, parsed.records);
        const warnings = [];
        if (!parsed.headers.length) warnings.push('No readable headers found.');
        if (!parsed.records.length) warnings.push('No data rows found.');
        const normalized = parsed.records.map((row) => normalizeRecord(row, {
          fileName: file.name,
          target,
          delimiterLabel: delimiterLabel(delimiter)
        })).filter(Boolean);
        if (!normalized.length && parsed.records.length) warnings.push('No rows survived normalization. At least title or NOLA is required.');
        const airings = normalized.filter((row) => target === 'airings');
        const drive = normalized.filter((row) => target === 'drive_results');
        imp().airingsRows.push(...airings);
        imp().driveRows.push(...drive);
        imp().fileSummaries.push({
          fileName: file.name,
          delimiter: delimiterLabel(delimiter),
          headerCount: parsed.headers.length,
          parsedRows: parsed.records.length,
          target,
          normalizedRows: normalized.length,
          warnings
        });
        if (warnings.length) imp().warnings.push(...warnings.map((warning) => `${file.name}: ${warning}`));
      }
      imp().lastAnalyzedAt = new Date().toISOString();
      imp().ready = true;
      renderAll();
      const totalRows = imp().airingsRows.length + imp().driveRows.length;
      setStatus(`Analyzed ${utils.formatCount(imp().rawFiles.length)} file${imp().rawFiles.length === 1 ? '' : 's'} into ${utils.formatCount(totalRows)} normalized row${totalRows === 1 ? '' : 's'}.`, imp().warnings.length ? 'warn' : '');
      setNotice(`Report importer analyzed ${utils.formatCount(totalRows)} normalized row${totalRows === 1 ? '' : 's'}.`);
    } catch (error) {
      console.error(error);
      imp().error = error?.message || 'Import analysis failed.';
      setStatus(imp().error, 'warn');
      setNotice(imp().error, 'warn');
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

  async function importToSupabase() {
    if (!App.auth.canEdit()) {
      setNotice('Direct import is admin-only. Export the normalized CSV if you need a handoff first.', 'warn');
      setStatus('Direct import is admin-only.', 'warn');
      return;
    }
    const total = imp().airingsRows.length + imp().driveRows.length;
    if (!total) {
      setNotice('There is nothing to import yet.', 'warn');
      return;
    }
    setStatus(`Importing ${utils.formatCount(total)} normalized rows to Supabase…`);
    try {
      const summary = await App.data.importNormalizedRows({
        airingsRows: imp().airingsRows,
        driveRows: imp().driveRows
      });
      imp().lastImportResult = summary;
      imp().lastImportedAt = new Date().toISOString();
      await refreshTableStatus({ silent: true });
      renderAll();
      setStatus(`Imported ${utils.formatCount(summary.airings.written + summary.driveResults.written)} rows into Supabase.`);
      setNotice(`Imported airings: ${utils.formatCount(summary.airings.written)}. Drive results: ${utils.formatCount(summary.driveResults.written)}.`);
      if (state.performance?.ready) {
        await App.performanceUi?.refreshData({ silent: true });
        App.performanceUi?.renderAll();
      }
    } catch (error) {
      console.error(error);
      const message = error?.message || 'Supabase import failed.';
      setStatus(message, 'warn');
      setNotice(message, 'warn');
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
        <div>${item.error ? escape(item.error) : 'Select works. Import still depends on write policy.'}</div>
      </div>
    `).join('');
  }

  function renderWarnings() {
    if (!els.importWarningList) return;
    const warnings = [...imp().warnings];
    if (imp().lastImportResult) {
      warnings.unshift(`Last import wrote ${utils.formatCount(imp().lastImportResult.airings.written)} airings rows and ${utils.formatCount(imp().lastImportResult.driveResults.written)} drive rows.`);
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
      els.importFileBody.innerHTML = '<tr><td colspan="7" class="placeholder-row">No reports analyzed yet.</td></tr>';
      return;
    }
    els.importFileBody.innerHTML = imp().fileSummaries.map((item) => `
      <tr>
        <td>${escape(item.fileName)}</td>
        <td>${escape(item.delimiter)}</td>
        <td>${escape(item.headerCount)}</td>
        <td>${escape(item.parsedRows)}</td>
        <td>${escape(item.target)}</td>
        <td>${escape(item.normalizedRows)}</td>
        <td>${escape(item.warnings.join(' | ') || '—')}</td>
      </tr>
    `).join('');
  }

  function renderPreviewRows(rows, bodyEl, columns) {
    if (!bodyEl) return;
    if (!rows.length) {
      bodyEl.innerHTML = `<tr><td colspan="${columns.length}" class="placeholder-row">No normalized rows yet.</td></tr>`;
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
    if (els.importDrivePill) els.importDrivePill.textContent = `${utils.formatCount(imp().driveRows.length)} rows`;
    renderPreviewRows(imp().airingsRows, els.importAiringsBody, [
      { key: 'title' },
      { key: 'nola_code' },
      { key: 'aired_at', format: (value) => utils.formatDateTime(value, '—') },
      { key: 'air_date' },
      { key: 'air_time' },
      { key: 'local_break_count' },
      { key: 'live_break_flag', format: (value) => value == null ? '—' : (value ? 'Yes' : 'No') },
      { key: 'premium_summary' }
    ]);
    renderPreviewRows(imp().driveRows, els.importDriveBody, [
      { key: 'title' },
      { key: 'nola_code' },
      { key: 'drive_date' },
      { key: 'aired_at', format: (value) => utils.formatDateTime(value, '—') },
      { key: 'contribution_total', format: (value) => value == null ? '—' : utils.formatMoney(value) },
      { key: 'local_break_count' },
      { key: 'live_break_flag', format: (value) => value == null ? '—' : (value ? 'Yes' : 'No') },
      { key: 'premium_summary' }
    ]);
  }

  function renderActions() {
    const canImport = App.auth.canEdit();
    if (els.importSupabaseButton) {
      els.importSupabaseButton.disabled = !canImport;
      els.importSupabaseButton.title = canImport ? '' : 'Admin sign-in required for direct Supabase writes.';
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
      downloadCsv(`pledge-airings-normalized-${Date.now()}.csv`, imp().airingsRows);
    });
    els.importExportDriveButton?.addEventListener('click', () => {
      downloadCsv(`pledge-drive-results-normalized-${Date.now()}.csv`, imp().driveRows);
    });
    els.importSupabaseButton?.addEventListener('click', () => { void importToSupabase(); });
  }

  App.importsUi = {
    ensureReady,
    bindEvents,
    renderAll,
    refreshTableStatus
  };
})();
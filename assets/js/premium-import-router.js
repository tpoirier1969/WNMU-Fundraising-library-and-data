(() => {
  'use strict';

  const A = window.WNMUPremiumAnalysis;
  const STORAGE_KEY = 'wnmuPremiumAnalyticsHistoryV1';
  let bypassNextInputChange = false;
  let installed = false;

  function filesFrom(value) {
    return [...(value || [])].filter(Boolean);
  }

  function isSpreadsheet(file) {
    return /\.(?:xls|xlsx)$/i.test(String(file?.name || ''));
  }

  function filenameLooksPremium(file) {
    const name = String(file?.name || '').toLowerCase();
    return /premium[\s_-]*(?:cost|costs|expense|expenses)|(?:cost|costs|expense|expenses)[\s_-]*premium/.test(name);
  }

  function matrixLooksPremium(matrix = []) {
    if (!A?.findHeaderRow || !A?.mapColumns) return false;
    const headerRow = A.findHeaderRow(matrix);
    if (headerRow < 0) return false;
    const columns = A.mapColumns((matrix[headerRow] || []).map((value) => String(value ?? '').trim()));
    return columns.description >= 0
      && columns.unitCost >= 0
      && columns.pledgeCount >= 0
      && columns.pledgedDollars >= 0;
  }

  async function workbookLooksPremium(file) {
    if (!isSpreadsheet(file) || !window.XLSX?.read) return false;
    if (filenameLooksPremium(file)) return true;
    const bytes = await file.arrayBuffer();
    const workbook = window.XLSX.read(bytes, { type: 'array', cellDates: false, raw: true });
    for (const sheetName of (workbook.SheetNames || []).slice(0, 6)) {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) continue;
      const matrix = window.XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: '' });
      if (matrixLooksPremium(matrix)) return true;
    }
    return false;
  }

  async function parsePremiumFile(file) {
    if (!A?.parseMatrix) throw new Error('Premium analysis module did not load.');
    if (!window.XLSX?.read) throw new Error('Spreadsheet reader did not load.');
    const bytes = await file.arrayBuffer();
    const workbook = window.XLSX.read(bytes, { type: 'array', cellDates: false, raw: true });
    const attempts = [];
    for (const sheetName of workbook.SheetNames || []) {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) continue;
      const matrix = window.XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: '' });
      attempts.push(sheetName);
      if (!matrixLooksPremium(matrix)) continue;
      return A.parseMatrix(matrix, file.name);
    }
    throw new Error(`${file.name}: no premium-cost worksheet was found. Sheets checked: ${attempts.join(', ') || 'none'}.`);
  }

  function loadStoredImports() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function saveStoredImports(imports = []) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(imports));
  }

  function clearOrdinaryImportBatch() {
    const state = window.PledgeLib?.state?.imports;
    if (!state) return;
    state.rawFiles = [];
    state.fileSummaries = [];
    state.airingsRows = [];
    state.driveRows = [];
    state.warnings = [];
    state.rawAccountingRows = [];
    state.rawAccountingSummaries = [];
    state.error = '';
    state.lastImportResult = null;
    const input = document.getElementById('import-file-input');
    if (input) input.value = '';
  }

  function setMode(mode) {
    const select = document.getElementById('import-target-select');
    if (window.PledgeLib?.state?.imports) window.PledgeLib.state.imports.targetMode = mode;
    if (select) select.value = mode;
  }

  function setMessage(message, tone = '') {
    const status = document.getElementById('import-status');
    if (status) status.textContent = message;
    const banner = document.getElementById('import-result-banner');
    if (banner) {
      banner.classList.remove('hidden', 'warn', 'success', 'error');
      if (tone) banner.classList.add(tone);
      banner.innerHTML = `${message} <a href="premium-analytics.html" style="font-weight:900">Open Premium Analytics →</a>`;
    }
  }

  async function importPremiumFiles(files = []) {
    if (!files.length) return;
    clearOrdinaryImportBatch();
    setMode('premium');
    setMessage(`Importing ${files.length} premium-cost report${files.length === 1 ? '' : 's'}…`);

    const parsed = [];
    for (const file of files) parsed.push(await parsePremiumFile(file));
    const merged = A.mergeImportedFundraisers(loadStoredImports(), parsed);
    saveStoredImports(merged);

    const labels = parsed.map((item) => item.fundraiser?.label).filter(Boolean);
    const labelText = labels.length <= 4 ? labels.join(', ') : `${labels.slice(0, 3).join(', ')} + ${labels.length - 3} more`;
    setMessage(
      `Imported ${parsed.length} premium-cost report${parsed.length === 1 ? '' : 's'} into Premium Analytics${labelText ? `: ${labelText}` : ''}. Existing pledge/program data was not changed.`,
      'success'
    );
  }

  async function routeSelectedFiles(files = [], forcedMode = '') {
    const usable = filesFrom(files);
    if (!usable.length) return false;
    const mode = forcedMode || document.getElementById('import-target-select')?.value || 'auto';

    if (mode === 'airings') return false;
    if (mode === 'premium') {
      await importPremiumFiles(usable);
      return true;
    }

    const spreadsheets = usable.filter(isSpreadsheet);
    if (spreadsheets.length !== usable.length) return false;

    const detection = await Promise.all(usable.map(workbookLooksPremium));
    if (detection.every(Boolean)) {
      await importPremiumFiles(usable);
      return true;
    }
    if (detection.some(Boolean)) {
      setMessage('This selection mixes Premium Cost Reports with ordinary pledge reports. Import the two report types in separate batches.', 'warn');
      return true;
    }
    return false;
  }

  function installUi() {
    if (installed) return true;
    const select = document.getElementById('import-target-select');
    const input = document.getElementById('import-file-input');
    const dropZone = document.getElementById('import-drop-zone');
    if (!select || !input || !dropZone) return false;

    installed = true;

    const autoOption = select.querySelector('option[value="auto"]');
    if (autoOption) autoOption.textContent = 'Auto-detect report type (recommended)';
    if (!select.querySelector('option[value="premium"]')) {
      const option = document.createElement('option');
      option.value = 'premium';
      option.textContent = 'Premium Cost Report Excel';
      select.append(option);
    }

    const help = select.closest('.import-target-field')?.querySelector('.field-help');
    if (help) help.textContent = 'Auto-detects PBS Break Reports and Premium Cost Reports. Force a type only when detection is wrong.';
    const subtitle = dropZone.querySelector('.import-drop-zone-subtitle');
    if (subtitle) subtitle.textContent = 'or click to browse for PBS Break Reports, Premium Cost Reports, CSV, TSV, or text exports';

    select.addEventListener('change', (event) => {
      if (event.target.value !== 'premium') return;
      event.stopImmediatePropagation();
      setMode('premium');
      setMessage('Premium Cost Report mode selected. Drop or choose one or more .xls/.xlsx premium-cost reports.');
    }, true);

    input.addEventListener('change', (event) => {
      if (bypassNextInputChange) {
        bypassNextInputChange = false;
        return;
      }
      const files = filesFrom(input.files);
      if (!files.length) return;
      const mode = select.value || 'auto';
      if (mode === 'airings') return;
      if (mode === 'auto' && !files.every(isSpreadsheet)) return;

      event.stopImmediatePropagation();
      void routeSelectedFiles(files, mode).then((handled) => {
        if (handled) return;
        bypassNextInputChange = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }).catch((error) => {
        console.error(error);
        setMessage(error?.message || 'Premium Cost Report import failed.', 'error');
      });
    }, true);

    dropZone.addEventListener('drop', (event) => {
      const files = filesFrom(event.dataTransfer?.files || []);
      if (!files.length) return;
      const mode = select.value || 'auto';
      const obviousPremium = files.every(filenameLooksPremium);
      if (mode !== 'premium' && !(mode === 'auto' && obviousPremium)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dropZone.classList.remove('drag-over');
      void routeSelectedFiles(files, mode === 'premium' ? 'premium' : 'auto').catch((error) => {
        console.error(error);
        setMessage(error?.message || 'Premium Cost Report import failed.', 'error');
      });
    }, true);

    return true;
  }

  function start() {
    if (installUi()) return;
    const observer = new MutationObserver(() => {
      if (installUi()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 15000);
  }

  window.WNMUPremiumImportRouter = {
    filenameLooksPremium,
    matrixLooksPremium,
    workbookLooksPremium,
    routeSelectedFiles
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

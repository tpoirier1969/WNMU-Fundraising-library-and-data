(() => {
  'use strict';

  const A = window.WNMUPremiumAnalysis;
  const H = window.WNMUPremiumHistoricalEvidence;
  const O = window.WNMUOneSheetAnalysis;
  const cfg = window.PLEDGE_MANAGER_CONFIG || {};
  const STORAGE_KEY = 'wnmuPremiumAnalyticsHistoryV1';

  const state = {
    client: null,
    imports: [],
    library: [],
    schedules: [],
    airings: [],
    analyses: [],
    performanceRows: [],
    mappedRows: [],
    historicalEvidence: H?.loadEvidence ? H.loadEvidence() : { schema:'wnmu-premium-historical-evidence-v1', offers:[] },
    email: ''
  };

  function loadStoredImports() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('Premium analytics local data could not be read.', error);
      return [];
    }
  }

  function saveStoredImports(imports = []) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(imports));
  }

  function clearStoredImports() {
    localStorage.removeItem(STORAGE_KEY);
    state.imports = [];
    state.mappedRows = [];
  }

  function makeClient() {
    if (!window.supabase?.createClient) throw new Error('Supabase library did not load.');
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) throw new Error('Supabase configuration is missing.');
    return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  async function requireAdmin({ gateId, appId, roleId } = {}) {
    state.client = state.client || makeClient();
    const { data, error } = await state.client.auth.getSession();
    if (error) throw error;
    const session = data?.session || null;
    const email = String(session?.user?.email || '').trim().toLowerCase();
    const admins = Array.isArray(cfg.ADMIN_EMAILS)
      ? cfg.ADMIN_EMAILS.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
      : [];
    const allowed = Boolean(session && (!admins.length || (email && admins.includes(email))));
    state.email = email;
    const gate = gateId ? document.getElementById(gateId) : null;
    const app = appId ? document.getElementById(appId) : null;
    const role = roleId ? document.getElementById(roleId) : null;
    if (!allowed) {
      if (app) app.classList.add('hidden');
      if (gate) {
        gate.classList.remove('hidden');
        gate.innerHTML = `<div class="report-gate-card"><img src="assets/WNMU-TV-logo-head2019.png" alt="WNMU-TV PBS logo"><div class="report-kicker">Admin premium analytics</div><h1>Admin access required</h1><p>${session ? `${email || 'This account'} is signed in, but does not have administrator access.` : 'Sign in as an administrator from the Pledge Program Library, then return to this page.'}</p><a class="premium-button primary" href="./">Open Pledge Program Library</a></div>`;
      }
      return false;
    }
    if (gate) gate.classList.add('hidden');
    if (app) app.classList.remove('hidden');
    if (role) role.textContent = email ? `Admin · ${email}` : 'Admin';
    return true;
  }

  async function fetchAll(table, select = '*', orderField = '') {
    const rows = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let query = state.client.from(table).select(select).range(from, from + pageSize - 1);
      if (orderField) query = query.order(orderField, { ascending: true });
      const { data, error } = await query;
      if (error) throw error;
      const chunk = Array.isArray(data) ? data : [];
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
    }
    return rows;
  }

  async function loadExistingAnalytics() {
    if (!O) throw new Error('Existing WNMU analysis module did not load.');
    state.client = state.client || makeClient();
    const [scheduleRows, airings, library] = await Promise.all([
      fetchAll('pledge_fundraiser_schedules', 'id,title,start_date,end_date,created_at,updated_at,schedule_data', 'start_date'),
      fetchAll('pledge_program_airings_v2', '*', 'air_date'),
      fetchAll('pledge_programs_v2', '*')
    ]);
    state.library = library;
    state.schedules = O.prepareSchedules(scheduleRows.map(O.normalizeSchedule)).filter((row) => row.startDate && row.endDate && row.year);
    state.airings = O.canonicalizeImportedAirings ? O.canonicalizeImportedAirings(airings) : airings;
    const indexes = O.buildLibraryIndexes(library);
    state.analyses = state.schedules.map((schedule) => O.analyzeSchedule(schedule, state.airings, indexes));
    state.performanceRows = A.performanceRowsFromAnalyses(state.analyses);
    remapImports();
    return state;
  }

  function remapImports() {
    const flattened = A.flattenImports(state.imports);
    const baseRows = A.addMappings(flattened.rows, state.library);
    state.mappedRows = H?.applyMappings
      ? H.applyMappings(baseRows, state.library, state.historicalEvidence)
      : baseRows;
    return state.mappedRows;
  }

  function setHistoricalEvidence(document = {}) {
    if (!H?.saveEvidence) throw new Error('Historical premium evidence module did not load.');
    state.historicalEvidence = H.saveEvidence(document);
    remapImports();
    return state.historicalEvidence;
  }

  function clearHistoricalEvidence() {
    state.historicalEvidence = H?.clearEvidence
      ? H.clearEvidence()
      : { schema:'wnmu-premium-historical-evidence-v1', offers:[] };
    remapImports();
    return state.historicalEvidence;
  }

  async function parseFile(file) {
    if (!window.XLSX?.read) throw new Error('Spreadsheet reader did not load. Refresh and try again.');
    const bytes = await file.arrayBuffer();
    const workbook = window.XLSX.read(bytes, { type: 'array', cellDates: false, raw: true });
    const sheetName = workbook.SheetNames?.[0];
    if (!sheetName) throw new Error(`${file.name}: no worksheet was found.`);
    const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: '' });
    return A.parseMatrix(matrix, file.name);
  }

  async function importFiles(files = []) {
    const parsed = [];
    for (const file of [...files]) parsed.push(await parseFile(file));
    state.imports = A.mergeImportedFundraisers(state.imports, parsed);
    saveStoredImports(state.imports);
    remapImports();
    return parsed;
  }

  function setImports(imports = []) {
    state.imports = Array.isArray(imports) ? imports : [];
    saveStoredImports(state.imports);
    remapImports();
  }

  function initializeStoredData() {
    state.imports = loadStoredImports();
    return state.imports;
  }

  function snapshot() {
    const flat = A.flattenImports(state.imports);
    return {
      ...state,
      rows: flat.rows,
      summaries: flat.summaries,
      mappedRows: state.mappedRows,
      fundraiserAnalysis: A.fundraiserAnalysis(flat.rows, flat.summaries),
      portfolio: A.portfolioSummary(flat.rows, flat.summaries),
      categories: A.categoryAnalysis(state.mappedRows),
      compositions: A.compositionAnalysis(state.mappedRows),
      brandScopes: A.brandScopeAnalysis(state.mappedRows),
      packages: A.packageAnalysis(state.mappedRows),
      programs: A.mappedGroupAnalysis(state.mappedRows, 'programTitle'),
      topics: A.mappedGroupAnalysis(state.mappedRows, 'topicPrimary'),
      combinedPrograms: A.combinedProgramAnalysis(state.mappedRows, state.performanceRows),
      combinedTopics: A.combinedTopicAnalysis(state.mappedRows, state.performanceRows),
      premiumImpact: A.premiumImpactEvidence(state.mappedRows, flat.summaries, state.performanceRows),
      historicalEvidence: state.historicalEvidence,
      historicalEvidenceSummary: H?.summary ? H.summary(state.historicalEvidence) : { offerCount:0, fundraiserCount:0, programCount:0, offerSetCount:0, selectedMappingCount:0 },
      mappingQuality: A.mappingQuality(state.mappedRows)
    };
  }

  initializeStoredData();

  window.WNMUPremiumData = {
    STORAGE_KEY,
    state,
    requireAdmin,
    loadExistingAnalytics,
    importFiles,
    clearStoredImports,
    initializeStoredData,
    setImports,
    setHistoricalEvidence,
    clearHistoricalEvidence,
    remapImports,
    snapshot
  };
})();
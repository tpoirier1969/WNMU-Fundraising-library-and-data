(() => {
  const App = window.PledgeLib;
  const { cfg, constants, state, utils, derive } = App;

  function createClient() {
    if (state.client) return state.client;
    if (!window.supabase?.createClient) {
      throw new Error('Supabase client library did not load.');
    }
    const noStoreFetch = (input, init = {}) => fetch(input, { ...init, cache: 'no-store' });
    state.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      global: { fetch: noStoreFetch }
    });
    return state.client;
  }

  function validateConfig() {
    const okay = Boolean(
      cfg.SUPABASE_URL &&
      cfg.SUPABASE_ANON_KEY &&
      !String(cfg.SUPABASE_URL).includes('YOUR_PROJECT')
    );
    state.configVersionMismatch = utils.buildMismatchNotice();
    state.configReady = okay;
    return okay;
  }

  async function fetchAllRows(tableName) {
    const pageSize = 1000;
    let from = 0;
    const rows = [];
    while (true) {
      const { data, error } = await state.client
        .from(tableName)
        .select('*')
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const chunk = data || [];
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  }

  async function probeSource(candidate) {
    const { data, error, count } = await state.client
      .from(candidate.name)
      .select('*', { count: 'exact', head: true });
    return {
      ...candidate,
      okay: !error,
      error,
      count: Number.isFinite(count) ? count : 0,
      rows: data || []
    };
  }

  async function chooseLibrarySource() {
    const probes = [];
    for (const candidate of constants.SOURCE_CANDIDATES) {
      probes.push(await probeSource(candidate));
    }
    state.lastProbeSummary = probes;

    const summaryProbe = probes.find((probe) => probe.name === constants.LIBRARY_VIEW);
    const baseProbe = probes.find((probe) => probe.name === constants.BASE_TABLE);

    if (summaryProbe?.okay && summaryProbe.count > 0) {
      state.librarySource = summaryProbe;
      return summaryProbe;
    }
    if (baseProbe?.okay && baseProbe.count > 0) {
      state.librarySource = baseProbe;
      return baseProbe;
    }
    if (summaryProbe?.okay) {
      state.librarySource = summaryProbe;
      return summaryProbe;
    }
    if (baseProbe?.okay) {
      state.librarySource = baseProbe;
      return baseProbe;
    }

    const message = probes
      .map((probe) => `${probe.name}: ${probe.error?.message || 'unavailable'}`)
      .join(' | ');
    throw new Error(message || 'Neither the summary view nor the base table could be read.');
  }

  async function refreshRawRows() {
    const source = await chooseLibrarySource();
    const rows = await fetchAllRows(source.name);
    state.rawRows = rows;
    return rows;
  }

  function getProbeStatusMessage() {
    const source = state.librarySource;
    const summaryBits = state.lastProbeSummary.map((probe) => {
      if (!probe.okay) return `${probe.name}: ${probe.error?.message || 'unreadable'}`;
      return `${probe.name}: ${utils.formatCount(probe.count)} row${probe.count === 1 ? '' : 's'}`;
    });
    const prefix = source
      ? `Using ${source.label} (${source.name}).`
      : 'No readable data source selected.';
    return [prefix, ...summaryBits].join(' ');
  }

  async function fetchOneById(tableName, programId) {
    if (!programId) return { data: null, error: null };
    const attempts = ['id', 'program_id'];
    for (const field of attempts) {
      const response = await state.client.from(tableName).select('*').eq(field, programId).maybeSingle();
      if (!response.error) return response;
      if (!/column .* does not exist|schema cache/i.test(response.error.message || '')) return response;
    }
    return { data: null, error: new Error(`Unable to match ${tableName} rows to a program id.`) };
  }

  async function fetchManyByProgramId(tableName, programId, orderField, ascending = true) {
    const attempts = ['program_id', 'pledge_program_id'];
    let lastError = null;
    for (const field of attempts) {
      let query = state.client.from(tableName).select('*').eq(field, programId);
      if (orderField) query = query.order(orderField, { ascending });
      const response = await query;
      if (!response.error) return response;
      lastError = response.error;
      if (!/column .* does not exist|schema cache/i.test(response.error.message || '')) break;
    }
    return { data: [], error: lastError };
  }

  async function fetchProgramDetail(programId) {
    const summaryRow = state.rawRows.find((row) => String(derive.programId(row)) === String(programId)) || null;
    const [baseResp, timingResp, driveResp, airingsResp] = await Promise.all([
      fetchOneById(constants.BASE_TABLE, programId),
      fetchManyByProgramId(constants.TIMING_TABLE, programId, 'slot_number', true),
      fetchManyByProgramId(constants.DRIVE_RESULTS_TABLE, programId, 'drive_order', false),
      fetchManyByProgramId(constants.AIRINGS_TABLE, programId, 'aired_at', false)
    ]);

    const detailProgram = { ...(summaryRow || {}), ...(baseResp.data || {}) };
    const warnings = [];
    if (baseResp.error && !baseResp.data) warnings.push(`Base row read warning: ${baseResp.error.message}`);
    if (timingResp.error) warnings.push(`Timing read warning: ${timingResp.error.message}`);
    if (driveResp.error) warnings.push(`Drive history read warning: ${driveResp.error.message}`);
    if (airingsResp.error) warnings.push(`Air history read warning: ${airingsResp.error.message}`);

    return {
      program: Object.keys(detailProgram).length ? detailProgram : null,
      timings: timingResp.data || [],
      driveResults: driveResp.data || [],
      airings: airingsResp.data || [],
      warnings
    };
  }

  async function updateProgram(programId, payload) {
    return state.client.from(constants.BASE_TABLE).update(payload).eq('id', programId);
  }

  App.data = {
    createClient,
    validateConfig,
    fetchAllRows,
    chooseLibrarySource,
    refreshRawRows,
    getProbeStatusMessage,
    fetchProgramDetail,
    updateProgram
  };
})();

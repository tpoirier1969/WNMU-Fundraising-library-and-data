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
    for (const candidate of constants.SOURCE_CANDIDATES) probes.push(await probeSource(candidate));
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

  function buildBaseIndexes(baseRows = []) {
    const byId = new Map();
    const byNola = new Map();
    const byTitle = new Map();

    baseRows.forEach((row) => {
      const id = utils.normalizeLookupKey(derive.programId(row));
      const nola = utils.normalizeLookupKey(derive.nola(row));
      const title = utils.normalizeLookupKey(derive.title(row));
      if (id && !byId.has(id)) byId.set(id, row);
      if (nola && !byNola.has(nola)) byNola.set(nola, row);
      if (title && !byTitle.has(title)) byTitle.set(title, row);
    });

    return { byId, byNola, byTitle };
  }

  function matchBaseRow(sourceRow, indexes) {
    const idKey = utils.normalizeLookupKey(derive.programId(sourceRow));
    if (idKey && indexes.byId.has(idKey)) return { row: indexes.byId.get(idKey), method: 'id' };

    const nolaKey = utils.normalizeLookupKey(derive.nola(sourceRow));
    if (nolaKey && indexes.byNola.has(nolaKey)) return { row: indexes.byNola.get(nolaKey), method: 'nola' };

    const titleKey = utils.normalizeLookupKey(derive.title(sourceRow));
    if (titleKey && indexes.byTitle.has(titleKey)) return { row: indexes.byTitle.get(titleKey), method: 'title' };

    return { row: null, method: 'none' };
  }

  function enrichResolvedFields(mergedRow, matchedBaseRow) {
    const topicPrimary = utils.firstNonEmpty(derive.topicPrimary(mergedRow), matchedBaseRow ? derive.topicPrimary(matchedBaseRow) : null);
    const topicSecondary = utils.firstNonEmpty(derive.topicSecondary(mergedRow), matchedBaseRow ? derive.topicSecondary(matchedBaseRow) : null);
    const distributor = utils.firstNonEmpty(derive.distributor(mergedRow), matchedBaseRow ? derive.distributor(matchedBaseRow) : null);

    return {
      ...mergedRow,
      __resolved_topic_primary: topicPrimary || null,
      __resolved_topic_secondary: topicSecondary || null,
      __resolved_distributor: distributor || null
    };
  }

  function buildFieldAudit(rows = []) {
    const audit = {
      rowCount: rows.length,
      missingTopicCount: 0,
      missingDistributorCount: 0,
      missingBothCount: 0,
      matchedByIdCount: 0,
      matchedByNolaCount: 0,
      matchedByTitleCount: 0,
      unmatchedSupplementCount: 0,
      topicCandidateKeys: utils.candidateKeys(rows, /(topic|subject|category|genre)/i, /(id|code|count)/i),
      distributorCandidateKeys: utils.candidateKeys(rows, /(distributor|syndicator|supplier)/i, /(id|code|count)/i)
    };

    rows.forEach((row) => {
      if (!derive.topicPrimary(row)) audit.missingTopicCount += 1;
      if (!derive.distributor(row)) audit.missingDistributorCount += 1;
      if (!derive.topicPrimary(row) && !derive.distributor(row)) audit.missingBothCount += 1;
      switch (row?.__supplement_match_method) {
        case 'id': audit.matchedByIdCount += 1; break;
        case 'nola': audit.matchedByNolaCount += 1; break;
        case 'title': audit.matchedByTitleCount += 1; break;
        default: audit.unmatchedSupplementCount += 1; break;
      }
    });

    return audit;
  }

  function mergeLibraryRows(summaryRows = [], baseRows = []) {
    if (!summaryRows.length) {
      return baseRows.map((row) => ({
        ...enrichResolvedFields(row, row),
        __supplement_match_method: 'id'
      }));
    }
    if (!baseRows.length) {
      return summaryRows.map((row) => ({
        ...enrichResolvedFields(row, null),
        __supplement_match_method: 'none'
      }));
    }

    const indexes = buildBaseIndexes(baseRows);
    return summaryRows.map((row) => {
      const matched = matchBaseRow(row, indexes);
      const merged = utils.mergeRows(row, matched.row || {});
      return {
        ...enrichResolvedFields(merged, matched.row),
        __supplement_match_method: matched.method
      };
    });
  }

  async function refreshRawRows() {
    const source = await chooseLibrarySource();
    const sourceRows = await fetchAllRows(source.name);
    let baseRows = [];

    const baseProbe = state.lastProbeSummary.find((probe) => probe.name === constants.BASE_TABLE);
    const shouldSupplementWithBase = source.name === constants.LIBRARY_VIEW && baseProbe?.okay;
    if (shouldSupplementWithBase) {
      try {
        baseRows = await fetchAllRows(constants.BASE_TABLE);
      } catch (error) {
        console.warn('Base-table supplement fetch failed.', error);
      }
    } else if (source.name === constants.BASE_TABLE) {
      baseRows = sourceRows;
    }

    state.baseRows = baseRows;
    state.rawRows = mergeLibraryRows(sourceRows, baseRows);
    state.fieldAudit = buildFieldAudit(state.rawRows);
    return state.rawRows;
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

    const auditBits = [];
    if (state.fieldAudit.rowCount) {
      auditBits.push(`topic gaps: ${utils.formatCount(state.fieldAudit.missingTopicCount)}`);
      auditBits.push(`distributor gaps: ${utils.formatCount(state.fieldAudit.missingDistributorCount)}`);
      if (state.librarySource?.name === constants.LIBRARY_VIEW && state.baseRows.length) {
        auditBits.push(`matches by id/nola/title: ${utils.formatCount(state.fieldAudit.matchedByIdCount)}/${utils.formatCount(state.fieldAudit.matchedByNolaCount)}/${utils.formatCount(state.fieldAudit.matchedByTitleCount)}`);
      }
    }

    return [prefix, ...summaryBits, ...auditBits].join(' ');
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

    const detailProgram = enrichResolvedFields(utils.mergeRows(summaryRow || {}, baseResp.data || {}), baseResp.data || summaryRow || {});
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
    updateProgram,
    mergeLibraryRows,
    buildFieldAudit,
    buildBaseIndexes,
    matchBaseRow
  };
})();

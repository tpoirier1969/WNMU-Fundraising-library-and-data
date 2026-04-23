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
    const { data, error } = await state.client
      .from(candidate.name)
      .select('*')
      .range(0, 0);
    return {
      ...candidate,
      okay: !error,
      error,
      count: Array.isArray(data) ? data.length : 0,
      rows: data || []
    };
  }

  async function chooseLibrarySource() {
    const probes = [];
    for (const candidate of constants.SOURCE_CANDIDATES) probes.push(await probeSource(candidate));
    state.lastProbeSummary = probes;

    const summaryProbe = probes.find((probe) => probe.name === constants.LIBRARY_VIEW) || null;
    const baseProbe = probes.find((probe) => probe.name === constants.BASE_TABLE) || null;
    state.summarySource = summaryProbe?.okay ? summaryProbe : null;
    state.baseSource = baseProbe?.okay ? baseProbe : null;

    if (baseProbe?.okay) {
      state.librarySource = {
        ...baseProbe,
        label: summaryProbe?.okay ? 'base table + summary enrichment' : (baseProbe.label || 'base table'),
        canonical: constants.BASE_TABLE,
        supplement: summaryProbe?.okay ? constants.LIBRARY_VIEW : null
      };
      return state.librarySource;
    }
    if (summaryProbe?.okay) {
      state.librarySource = {
        ...summaryProbe,
        label: summaryProbe.label || 'summary view',
        canonical: constants.LIBRARY_VIEW,
        supplement: null
      };
      return state.librarySource;
    }

    const message = probes
      .map((probe) => `${probe.name}: ${probe.error?.message || 'unavailable'}`)
      .join(' | ');
    throw new Error(message || 'Neither the base table nor the summary view could be read.');
  }

  async function chooseOptionalSource(candidates = []) {
    const probes = [];
    for (const candidate of candidates) {
      try {
        probes.push(await probeSource(candidate));
      } catch (error) {
        probes.push({ ...candidate, okay: false, error, count: 0, rows: [] });
      }
    }
    return probes.find((probe) => probe.okay && probe.count >= 0) || null;
  }

  async function refreshNonPledgeRows(force = false) {
    if (!force && state.nonPledgeLoadState === 'ready') return state.nonPledgeRows;
    if (!force && state.nonPledgeLoadState === 'loading' && state.nonPledgeLoadPromise) return state.nonPledgeLoadPromise;

    state.nonPledgeLoadState = 'loading';
    state.nonPledgeLoadPromise = (async () => {
      const source = await chooseOptionalSource(constants.NON_PLEDGE_SOURCE_CANDIDATES || []);
      if (!source) {
        state.nonPledgeRows = [];
        state.nonPledgeSource = null;
        state.nonPledgeLoadState = 'missing';
        return [];
      }
      const rows = await fetchAllRows(source.name);
      state.nonPledgeSource = source;
      state.nonPledgeRows = rows.map((row, index) => ({
        ...row,
        __external_source_name: source.name,
        __external_source_label: source.label || source.name,
        __synthetic_program_id: `nonpledge:${source.name}:${utils.normalizeLookupKey(derive.programId(row) || derive.title(row) || index) || index}`
      }));
      state.nonPledgeLoadState = 'ready';
      return state.nonPledgeRows;
    })().catch((error) => {
      state.nonPledgeRows = [];
      state.nonPledgeSource = null;
      state.nonPledgeLoadState = 'error';
      throw error;
    });

    return state.nonPledgeLoadPromise;
  }

  function buildBaseIndexes(baseRows = []) {
    const byId = new Map();
    const byLookup = new Map();
    const byTitle = new Map();

    baseRows.forEach((row) => {
      const id = utils.normalizeLookupKey(derive.programId(row));
      const lookup = utils.nolaIdentityKey(derive.nola(row), derive.title(row));
      const title = utils.normalizeLookupKey(derive.title(row));
      if (id && !byId.has(id)) byId.set(id, row);
      if (lookup && !byLookup.has(lookup)) byLookup.set(lookup, row);
      if (title && !byTitle.has(title)) byTitle.set(title, row);
    });

    return { byId, byLookup, byTitle };
  }

  function matchBaseRow(sourceRow, indexes) {
    const idKey = utils.normalizeLookupKey(derive.programId(sourceRow));
    if (idKey && indexes.byId.has(idKey)) return { row: indexes.byId.get(idKey), method: 'id' };

    const lookupKey = utils.nolaIdentityKey(derive.nola(sourceRow), derive.title(sourceRow));
    if (lookupKey && indexes.byLookup.has(lookupKey)) {
      return {
        row: indexes.byLookup.get(lookupKey),
        method: lookupKey.startsWith('nola_title:') ? 'nola_title' : 'nola'
      };
    }

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

  function mergeLibraryRows(baseRows = [], summaryRows = []) {
    if (!baseRows.length) {
      return (summaryRows || []).map((row) => ({
        ...enrichResolvedFields(row, null),
        __supplement_match_method: 'summary_only'
      }));
    }

    const summaryIndexes = buildBaseIndexes(summaryRows);
    return baseRows.map((row) => {
      const matched = matchBaseRow(row, summaryIndexes);
      const merged = utils.mergeRows(row, matched.row || {});
      return {
        ...enrichResolvedFields(merged, row),
        __supplement_match_method: matched.row ? `summary_${matched.method}` : 'base'
      };
    });
  }

  async function refreshRawRows() {
    const source = await chooseLibrarySource();
    let baseRows = [];
    let summaryRows = [];

    if (state.baseSource?.okay) {
      try {
        baseRows = await fetchAllRows(constants.BASE_TABLE);
      } catch (error) {
        console.warn('Canonical base-table fetch failed.', error);
      }
    }
    if (state.summarySource?.okay) {
      try {
        summaryRows = await fetchAllRows(constants.LIBRARY_VIEW);
      } catch (error) {
        console.warn('Summary enrichment fetch failed.', error);
      }
    }

    if (!baseRows.length && source.name === constants.LIBRARY_VIEW && summaryRows.length) {
      state.baseRows = [];
      state.rawRows = mergeLibraryRows([], summaryRows);
    } else {
      state.baseRows = baseRows;
      state.rawRows = mergeLibraryRows(baseRows, summaryRows);
    }
    state.fieldAudit = buildFieldAudit(state.rawRows);
    resetDetailCaches();
    return state.rawRows;
  }

  function getProbeStatusMessage() {
    const source = state.librarySource;
    const summaryBits = state.lastProbeSummary.map((probe) => {
      if (!probe.okay) return `${probe.name}: ${probe.error?.message || 'unreadable'}`;
      return `${probe.name}: ${utils.formatCount(probe.count)} row${probe.count === 1 ? '' : 's'}`;
    });
    const prefix = source
      ? `Using ${source.label || source.name} as the canonical library source.`
      : 'No readable data source selected.';

    const auditBits = [];
    if (state.fieldAudit.rowCount) {
      auditBits.push(`topic gaps: ${utils.formatCount(state.fieldAudit.missingTopicCount)}`);
      auditBits.push(`distributor gaps: ${utils.formatCount(state.fieldAudit.missingDistributorCount)}`);
      if (state.baseRows.length && state.summarySource?.okay) {
        auditBits.push(`base rows kept: ${utils.formatCount(state.baseRows.length)}`);
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

  function resetDetailCaches() {
    state.detailCache = {};
    state.detailPending = {};
    state.detailQueryHints = {};
  }

  function resolveProgramSummaryRow(programId) {
    return App.programLinks?.resolveRow?.(programId)
      || state.rawRows.find((row) => String(derive.programId(row)) === String(programId))
      || null;
  }

  function resolveProgramSnapshot(programId) {
    if (!programId) return null;
    const cachedProgram = state.detailCache?.[programId]?.program || null;
    const summaryRow = resolveProgramSummaryRow(programId);
    const merged = utils.mergeRows(summaryRow || {}, cachedProgram || {});
    if (!Object.keys(merged || {}).length) return null;
    return enrichResolvedFields(merged, cachedProgram || summaryRow || {});
  }

  function buildDetailContext(programId, row = {}) {
    return {
      programId,
      nola: derive.nola(row),
      title: derive.title(row)
    };
  }

  function prioritizeFieldAttempts(tableName, fieldAttempts = []) {
    const hint = state.detailQueryHints?.[tableName];
    if (!hint?.field) return fieldAttempts;
    return [...fieldAttempts].sort((a, b) => {
      const aScore = a[0] === hint.field ? 0 : 1;
      const bScore = b[0] === hint.field ? 0 : 1;
      return aScore - bScore;
    });
  }

  function prioritizeOrderAttempts(tableName, orderAttempts = []) {
    const hint = state.detailQueryHints?.[tableName];
    if (!hint || !Object.prototype.hasOwnProperty.call(hint, 'orderField')) return orderAttempts;
    return [...orderAttempts].sort((a, b) => {
      const normalize = (value) => value || '';
      const aScore = normalize(a) === normalize(hint.orderField) ? 0 : 1;
      const bScore = normalize(b) === normalize(hint.orderField) ? 0 : 1;
      return aScore - bScore;
    });
  }

  function cacheDetailQueryHint(tableName, field, orderField) {
    if (!tableName || !field) return;
    state.detailQueryHints[tableName] = { field, orderField: orderField || null };
  }

  function needsContextRetry(initialContext = {}, enrichedContext = {}) {
    return utils.normalizeLookupKey(initialContext.nola) !== utils.normalizeLookupKey(enrichedContext.nola)
      || utils.normalizeLookupKey(initialContext.title) !== utils.normalizeLookupKey(enrichedContext.title);
  }

  function isLookupOnlyProgram(programId) {
    return String(programId || '').startsWith('lookup:');
  }

  function buildDetailWarnings(baseResp, timingResp, driveResp, airingsResp) {
    const warnings = [];
    if (baseResp?.error && !baseResp?.data) warnings.push(`Base row read warning: ${baseResp.error.message}`);
    if (timingResp?.error) warnings.push(`Timing read warning: ${timingResp.error.message}`);
    if (driveResp?.error) warnings.push(`Drive history read warning: ${driveResp.error.message}`);
    if (airingsResp?.error) warnings.push(`Air history read warning: ${airingsResp.error.message}`);
    return warnings;
  }

  function isSchemaOnlyError(message) {
    return /column .* does not exist|schema cache/i.test(message || '');
  }

  async function fetchManyByAttempts(tableName, rawFieldAttempts = [], orderFields = [], ascending = true) {
    const fieldAttempts = prioritizeFieldAttempts(tableName, (Array.isArray(rawFieldAttempts) ? rawFieldAttempts : []).filter((entry) => Array.isArray(entry) && !utils.isBlank(entry[1])));
    const normalizedOrderFields = Array.isArray(orderFields)
      ? orderFields.filter(Boolean)
      : [orderFields].filter(Boolean);
    const orderAttempts = prioritizeOrderAttempts(tableName, [...normalizedOrderFields, null]);

    let lastError = null;
    let sawSchemaOnlyError = false;
    for (const [field, value] of fieldAttempts) {
      for (const orderField of orderAttempts) {
        let query = state.client.from(tableName).select('*').eq(field, value);
        if (orderField) query = query.order(orderField, { ascending });
        const response = await query;
        if (!response.error && Array.isArray(response.data) && response.data.length) {
          cacheDetailQueryHint(tableName, field, orderField);
          return response;
        }
        if (!response.error) {
          lastError = null;
          continue;
        }
        lastError = response.error;
        if (isSchemaOnlyError(response.error.message || '')) {
          sawSchemaOnlyError = true;
          continue;
        }
        break;
      }
    }
    if (lastError && sawSchemaOnlyError && isSchemaOnlyError(lastError.message || '')) {
      return { data: [], error: null };
    }
    return { data: [], error: lastError };
  }

  async function fetchManyByContext(tableName, context = {}, orderFields = [], ascending = true, options = {}) {
    const rawFieldAttempts = [
      ['program_id', context.programId],
      ['pledge_program_id', context.programId],
      ...(options.allowIdField === false ? [] : [['id', context.programId]]),
      ['nola_code', context.nola],
      ['nola', context.nola],
      ['program_nola', context.nola],
      ...(options.allowTitleFields === false ? [] : [
        ['title', context.title],
        ['program_title', context.title],
        ['name', context.title]
      ])
    ];
    return fetchManyByAttempts(tableName, rawFieldAttempts, orderFields, ascending);
  }

  async function fetchManyByFieldIn(tableName, field, values = [], orderFields = [], ascending = true) {
    const uniqueValues = [...new Set((Array.isArray(values) ? values : [values])
      .map((value) => utils.isBlank(value) ? '' : `${value}`.trim())
      .filter(Boolean))];
    if (!field || !uniqueValues.length) return { data: [], error: null, field };
    const normalizedOrderFields = Array.isArray(orderFields)
      ? orderFields.filter(Boolean)
      : [orderFields].filter(Boolean);
    const orderAttempts = prioritizeOrderAttempts(tableName, [...normalizedOrderFields, null]);
    let lastError = null;
    let sawSchemaOnlyError = false;
    for (const orderField of orderAttempts) {
      let query = state.client.from(tableName).select('*').in(field, uniqueValues);
      if (orderField) query = query.order(orderField, { ascending });
      const response = await query;
      if (!response.error) {
        if (Array.isArray(response.data)) {
          cacheDetailQueryHint(tableName, field, orderField);
          return { ...response, field };
        }
        lastError = null;
        continue;
      }
      lastError = response.error;
      if (isSchemaOnlyError(response.error.message || '')) {
        sawSchemaOnlyError = true;
        continue;
      }
      break;
    }
    if (lastError && sawSchemaOnlyError && isSchemaOnlyError(lastError.message || '')) {
      return { data: [], error: null, field };
    }
    return { data: [], error: lastError, field };
  }

  async function fetchManyByFieldSet(tableName, fields = [], values = [], orderFields = [], ascending = true) {
    const fieldAttempts = prioritizeFieldAttempts(tableName, (Array.isArray(fields) ? fields : [fields]).filter(Boolean).map((field) => [field, true]));
    let lastError = null;
    let sawSchemaOnlyError = false;
    for (const [field] of fieldAttempts) {
      const response = await fetchManyByFieldIn(tableName, field, values, orderFields, ascending);
      if (!response.error && Array.isArray(response.data) && response.data.length) return response;
      if (!response.error) {
        lastError = null;
        continue;
      }
      lastError = response.error;
      if (isSchemaOnlyError(response.error.message || '')) {
        sawSchemaOnlyError = true;
        continue;
      }
      break;
    }
    if (lastError && sawSchemaOnlyError && isSchemaOnlyError(lastError.message || '')) {
      return { data: [], error: null, field: null };
    }
    return { data: [], error: lastError, field: null };
  }

  function groupRowsByField(rows = [], field = '') {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const key = utils.isBlank(row?.[field]) ? '' : `${row[field]}`.trim();
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });
    return map;
  }

  async function fetchManyByTitleFallback(tableName, context = {}, orderFields = [], ascending = true) {
    const rawFieldAttempts = [
      ['title', context.title],
      ['program_title', context.title],
      ['name', context.title]
    ];
    return fetchManyByAttempts(tableName, rawFieldAttempts, orderFields, ascending);
  }

  function timingRowMergeKey(row = {}, fallbackIndex = 0) {
    const stableId = utils.firstNonEmpty(row.id, row.timing_id, row.segment_id, row.source_row_number);
    if (!utils.isBlank(stableId)) return `id:${stableId}`;
    return [
      utils.firstNonEmpty(row.program_id, row.pledge_program_id, row.program_title, row.title, row.name, ''),
      utils.firstNonEmpty(row.segment_number, row.slot_number, fallbackIndex + 1),
      utils.firstNonEmpty(row.program_segment_length_seconds, row.segment_seconds, row.act_seconds, ''),
      utils.firstNonEmpty(row.pledge_break_seconds, row.break_length_seconds, row.break_seconds, ''),
      utils.firstNonEmpty(row.local_cutin_seconds, row.local_cutin, row.local_cutin_length_seconds, ''),
      utils.firstNonEmpty(row.notes, row.description, row.segment_title, row.segment_name, row.timing_note, row.timing_notes, '')
    ].map((value) => `${value ?? ''}`).join('|');
  }

  function mergeTimingRows(...lists) {
    const merged = [];
    const seen = new Set();
    lists.forEach((list) => {
      (Array.isArray(list) ? list : []).forEach((row, index) => {
        const key = timingRowMergeKey(row, index);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(row);
      });
    });
    return merged;
  }

  async function fetchProgramDetailsBatch(programIds = [], options = {}) {
    const requestedIds = [...new Set((Array.isArray(programIds) ? programIds : [programIds])
      .map((value) => `${value || ''}`.trim())
      .filter(Boolean))];
    const useCache = options.useCache !== false;
    const resultMap = {};
    requestedIds.forEach((programId) => {
      if (useCache && state.detailCache[programId]) {
        resultMap[programId] = state.detailCache[programId];
      }
    });
    const pendingIds = requestedIds.filter((programId) => !(useCache && state.detailCache[programId]) && !isLookupOnlyProgram(programId));
    const lookupOnlyIds = requestedIds.filter((programId) => isLookupOnlyProgram(programId));
    lookupOnlyIds.forEach((programId) => {
      const summaryRow = resolveProgramSummaryRow(programId);
      const detailProgram = enrichResolvedFields(utils.mergeRows(summaryRow || {}, {}), summaryRow || {});
      resultMap[programId] = {
        program: Object.keys(detailProgram).length ? detailProgram : null,
        timings: [],
        driveResults: [],
        airings: [],
        warnings: []
      };
      if (useCache) state.detailCache[programId] = resultMap[programId];
    });
    if (!pendingIds.length) return resultMap;

    const baseResp = await fetchManyByFieldIn(constants.BASE_TABLE, 'id', pendingIds, [], true);
    const timingResp = await fetchManyByFieldSet(constants.TIMING_TABLE, ['program_id', 'pledge_program_id'], pendingIds, ['segment_number', 'slot_number', 'break_offset_seconds', 'act_offset_seconds'], true);
    const driveResp = await fetchManyByFieldSet(constants.DRIVE_RESULTS_TABLE, ['program_id', 'pledge_program_id'], pendingIds, ['drive_order', 'drive_date', 'aired_at', 'created_at'], false);
    const airingsResp = await fetchManyByFieldSet(constants.AIRINGS_TABLE, ['program_id', 'pledge_program_id'], pendingIds, ['aired_at', 'air_date', 'drive_date', 'created_at'], false);

    const baseById = new Map((baseResp.data || []).map((row) => [`${row?.id || ''}`.trim(), row]));
    const timingField = timingResp.field || 'program_id';
    const driveField = driveResp.field || 'program_id';
    const airingsField = airingsResp.field || 'program_id';
    const timingsByProgram = groupRowsByField(timingResp.data || [], timingField);
    const drivesByProgram = groupRowsByField(driveResp.data || [], driveField);
    const airingsByProgram = groupRowsByField(airingsResp.data || [], airingsField);

    pendingIds.forEach((programId) => {
      const summaryRow = resolveProgramSummaryRow(programId);
      const baseRow = baseById.get(programId) || null;
      const detailProgram = enrichResolvedFields(utils.mergeRows(summaryRow || {}, baseRow || {}), baseRow || summaryRow || {});
      const detail = {
        program: Object.keys(detailProgram).length ? detailProgram : null,
        timings: timingsByProgram.get(programId) || [],
        driveResults: drivesByProgram.get(programId) || [],
        airings: airingsByProgram.get(programId) || [],
        warnings: buildDetailWarnings(baseResp, timingResp, driveResp, airingsResp)
      };
      resultMap[programId] = detail;
      if (useCache) state.detailCache[programId] = detail;
    });

    return resultMap;
  }

  async function fetchProgramDetail(programId, options = {}) {
    if (!programId) return { program: null, timings: [], driveResults: [], airings: [], warnings: [] };
    const useCache = options.useCache !== false;
    if (useCache && state.detailCache[programId]) return state.detailCache[programId];
    if (useCache && state.detailPending[programId]) return state.detailPending[programId];

    const detailPromise = (async () => {
      const summaryRow = resolveProgramSummaryRow(programId);
      const initialContext = buildDetailContext(programId, summaryRow || {});
      const basePromise = isLookupOnlyProgram(programId)
        ? Promise.resolve({ data: null, error: null })
        : fetchOneById(constants.BASE_TABLE, programId);
      const sectionPromise = Promise.all([
        fetchManyByContext(constants.TIMING_TABLE, initialContext, ['segment_number', 'slot_number', 'break_offset_seconds', 'act_offset_seconds'], true, { allowTitleFields: false, allowIdField: false }),
        fetchManyByContext(constants.DRIVE_RESULTS_TABLE, initialContext, ['drive_order', 'drive_date', 'aired_at', 'created_at'], false, { allowIdField: false }),
        fetchManyByContext(constants.AIRINGS_TABLE, initialContext, ['aired_at', 'air_date', 'drive_date', 'created_at'], false, { allowTitleFields: false, allowIdField: false })
      ]);

      const baseResp = await basePromise;
      let [timingResp, driveResp, airingsResp] = await sectionPromise;

      const contextRow = utils.mergeRows(summaryRow || {}, baseResp.data || {});
      const enrichedContext = buildDetailContext(programId, contextRow);

      if (needsContextRetry(initialContext, enrichedContext)) {
        if (!(timingResp.data || []).length) {
          timingResp = await fetchManyByContext(constants.TIMING_TABLE, enrichedContext, ['segment_number', 'slot_number', 'break_offset_seconds', 'act_offset_seconds'], true, { allowTitleFields: false, allowIdField: false });
        }
        if (!(driveResp.data || []).length) {
          driveResp = await fetchManyByContext(constants.DRIVE_RESULTS_TABLE, enrichedContext, ['drive_order', 'drive_date', 'aired_at', 'created_at'], false, { allowIdField: false });
        }
        if (!(airingsResp.data || []).length) {
          airingsResp = await fetchManyByContext(constants.AIRINGS_TABLE, enrichedContext, ['aired_at', 'air_date', 'drive_date', 'created_at'], false, { allowTitleFields: false, allowIdField: false });
        }
      }

      const sparseTimingRows = (timingResp.data || []).length <= 1;
      if (sparseTimingRows && !utils.isBlank(enrichedContext.title)) {
        const titleTimingResp = await fetchManyByTitleFallback(constants.TIMING_TABLE, enrichedContext, ['segment_number', 'slot_number', 'break_offset_seconds', 'act_offset_seconds'], true);
        const mergedTimingRows = mergeTimingRows(timingResp.data || [], titleTimingResp.data || []);
        if (mergedTimingRows.length > (timingResp.data || []).length) {
          timingResp = {
            data: mergedTimingRows,
            error: timingResp.error || titleTimingResp.error || null
          };
        }
      }

      const detailProgram = enrichResolvedFields(utils.mergeRows(summaryRow || {}, baseResp.data || {}), baseResp.data || summaryRow || {});
      const detail = {
        program: Object.keys(detailProgram).length ? detailProgram : null,
        timings: timingResp.data || [],
        driveResults: driveResp.data || [],
        airings: airingsResp.data || [],
        warnings: buildDetailWarnings(baseResp, timingResp, driveResp, airingsResp)
      };
      state.detailCache[programId] = detail;
      return detail;
    })();

    if (useCache) state.detailPending[programId] = detailPromise;
    try {
      return await detailPromise;
    } finally {
      if (useCache) delete state.detailPending[programId];
    }
  }

  async function updateProgram(programId, payload) {
    const resolvedRow = App.programLinks?.resolveRow?.(programId) || null;
    const targetId = utils.firstNonEmpty(
      resolvedRow?.id,
      resolvedRow?.program_id,
      resolvedRow?.pledge_program_id,
      resolvedRow?.program_uuid,
      resolvedRow?.uuid,
      programId
    );
    return state.client.from(constants.BASE_TABLE).update(payload).eq('id', targetId);
  }

  function sanitizeTimingRow(row = {}) {
    const clone = { ...row };
    delete clone.created_at;
    delete clone.updated_at;
    delete clone.program_title;
    Object.keys(clone).forEach((key) => {
      if (clone[key] === '') clone[key] = null;
    });
    return clone;
  }

  async function saveTimingRows(programId, rows = []) {
    const wanted = Array.isArray(rows) ? rows.map((row) => sanitizeTimingRow({ ...row, program_id: programId })).filter((row) => Object.keys(row).length) : [];
    const currentResp = await fetchManyByContext(constants.TIMING_TABLE, { programId }, ['segment_number', 'slot_number'], true, { allowIdField: false });
    const currentRows = Array.isArray(currentResp?.data) ? currentResp.data : [];
    const currentIds = new Set(currentRows.map((row) => String(row.id || '')).filter(Boolean));
    const wantedIds = new Set(wanted.map((row) => String(row.id || '')).filter(Boolean));
    const idsToDelete = [...currentIds].filter((id) => !wantedIds.has(id));
    for (const id of idsToDelete) {
      const delResp = await state.client.from(constants.TIMING_TABLE).delete().eq('id', id);
      if (delResp.error) return delResp;
    }
    for (const row of wanted) {
      let response;
      if (row.id) {
        const payload = { ...row };
        delete payload.id;
        response = await state.client.from(constants.TIMING_TABLE).update(payload).eq('id', row.id);
      } else {
        const payload = { ...row };
        delete payload.id;
        response = await state.client.from(constants.TIMING_TABLE).insert(payload);
      }
      if (response.error) return response;
    }
    return { error: null };
  }

  function buildManualSourceRowNumber() {
    const base = Number(Date.now() % 2147483000);
    const noise = Math.floor(Math.random() * 997);
    return -1 * ((base + noise) % 2147483000 || 1);
  }

  function attemptSignature(payload = {}) {
    return JSON.stringify(Object.keys(payload).sort().map((key) => [key, payload[key]]));
  }

  function extractMissingColumnName(message = '') {
    const exact = String(message || '').match(/could not find the ['"]?([a-zA-Z0-9_]+)['"]? column/i);
    if (exact?.[1]) return exact[1];
    const generic = String(message || '').match(/column ['"]?([a-zA-Z0-9_]+)['"]? does not exist/i);
    return generic?.[1] || '';
  }

  function omitKeys(payload = {}, keys = []) {
    const next = { ...payload };
    keys.forEach((key) => { delete next[key]; });
    return next;
  }

  async function createProgram(payload) {
    const hasSourceRowNumber = Object.prototype.hasOwnProperty.call(payload, 'source_row_number');
    const hasWorkspaceKey = Object.prototype.hasOwnProperty.call(payload, 'workspace_key');
    const attempts = [];
    const queued = new Set();

    const pushAttempt = (attempt, priority = false) => {
      const signature = attemptSignature(attempt);
      if (queued.has(signature)) return;
      queued.add(signature);
      if (priority) attempts.unshift(attempt);
      else attempts.push(attempt);
    };

    pushAttempt({ ...payload });
    if (!hasSourceRowNumber) pushAttempt({ ...payload, source_row_number: buildManualSourceRowNumber() });
    if (!hasWorkspaceKey) pushAttempt({ ...payload, workspace_key: 'default' });
    if (!hasSourceRowNumber && !hasWorkspaceKey) pushAttempt({ ...payload, workspace_key: 'default', source_row_number: buildManualSourceRowNumber() });

    let lastResponse = null;
    while (attempts.length) {
      const attempt = attempts.shift();
      const response = await state.client.from(constants.BASE_TABLE).insert(attempt).select('*').single();
      lastResponse = response;
      if (!response.error) return response;
      const message = String(response.error?.message || '');
      const missingColumn = extractMissingColumnName(message);

      if (missingColumn === 'workspace_key' && Object.prototype.hasOwnProperty.call(attempt, 'workspace_key')) {
        pushAttempt(omitKeys(attempt, ['workspace_key']), true);
        continue;
      }
      if (missingColumn === 'source_row_number' && Object.prototype.hasOwnProperty.call(attempt, 'source_row_number')) {
        pushAttempt(omitKeys(attempt, ['source_row_number']), true);
        continue;
      }
      if (/workspace_key/i.test(message) && !Object.prototype.hasOwnProperty.call(attempt, 'workspace_key')) continue;
      if (/source_row_number/i.test(message) && !Object.prototype.hasOwnProperty.call(attempt, 'source_row_number')) continue;
      if (/source_row_number/i.test(message) && /duplicate key value|unique constraint/i.test(message) && Object.prototype.hasOwnProperty.call(attempt, 'source_row_number')) {
        pushAttempt({ ...attempt, source_row_number: buildManualSourceRowNumber() }, true);
        continue;
      }
      return response;
    }
    return lastResponse || state.client.from(constants.BASE_TABLE).insert(payload).select('*').single();
  }


  async function probeScheduleStore() {
    try {
      const { error } = await state.client
        .from(constants.SCHEDULES_TABLE)
        .select('id', { head: true, count: 'exact' });
      if (error) throw error;
      state.scheduleStoreMode = 'remote';
      state.scheduleStoreReady = true;
      state.scheduleSyncMessage = 'Fundraisers sync through Supabase.';
      return true;
    } catch (error) {
      state.scheduleStoreMode = 'local';
      state.scheduleStoreReady = false;
      state.scheduleSyncMessage = `Fundraisers are local only until ${constants.SCHEDULES_TABLE} exists.`;
      return false;
    }
  }

  async function fetchSchedulesRemote() {
    const { data, error } = await state.client
      .from(constants.SCHEDULES_TABLE)
      .select('*')
      .order('start_date', { ascending: true })
      .order('title', { ascending: true });
    if (error) throw error;
    return (data || []).map((row) => ({
      id: row.id,
      title: row.title || '',
      startDate: row.start_date || '',
      endDate: row.end_date || '',
      dayStartHour: Number(row.day_start_hour ?? constants.DEFAULT_DAY_START_HOUR),
      dayEndHour: Number(row.day_end_hour ?? constants.DEFAULT_DAY_END_HOUR),
      dayStartMinutes: Number(row.schedule_data?.dayStartMinutes ?? (Number(row.day_start_hour ?? constants.DEFAULT_DAY_START_HOUR) * 60) ?? constants.DEFAULT_DAY_START_MINUTES),
      dayEndMinutes: Number(row.schedule_data?.dayEndMinutes ?? (Number(row.day_end_hour ?? constants.DEFAULT_DAY_END_HOUR) * 60) ?? constants.DEFAULT_DAY_END_MINUTES),
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      placements: Array.isArray(row.schedule_data?.placements) ? row.schedule_data.placements : [],
      slotNotes: row.schedule_data?.slotNotes || {},
      onlineDollars: Number(row.schedule_data?.onlineDollars || 0) || 0,
      mailDollars: Number(row.schedule_data?.mailDollars || 0) || 0,
      meta: row.schedule_data?.meta || {}
    }));
  }

  async function upsertScheduleRemote(schedule) {
    const payload = {
      id: schedule.id,
      title: schedule.title,
      start_date: schedule.startDate,
      end_date: schedule.endDate,
      day_start_hour: Math.floor((schedule.dayStartMinutes ?? (Number(schedule.dayStartHour || constants.DEFAULT_DAY_START_HOUR) * 60)) / 60),
      day_end_hour: Math.floor((schedule.dayEndMinutes ?? (Number(schedule.dayEndHour || constants.DEFAULT_DAY_END_HOUR) * 60)) / 60),
      schedule_data: {
        placements: schedule.placements || [],
        slotNotes: schedule.slotNotes || {},
        dayStartMinutes: schedule.dayStartMinutes ?? (Number(schedule.dayStartHour || constants.DEFAULT_DAY_START_HOUR) * 60),
        dayEndMinutes: schedule.dayEndMinutes ?? (Number(schedule.dayEndHour || constants.DEFAULT_DAY_END_HOUR) * 60),
        onlineDollars: Number(schedule.onlineDollars || 0) || 0,
        mailDollars: Number(schedule.mailDollars || 0) || 0,
        meta: schedule.meta || {}
      },
      updated_at: new Date().toISOString()
    };
    const { error } = await state.client.from(constants.SCHEDULES_TABLE).upsert(payload);
    if (error) throw error;
    return true;
  }

  async function deleteScheduleRemote(scheduleId) {
    const { error } = await state.client.from(constants.SCHEDULES_TABLE).delete().eq('id', scheduleId);
    if (error) throw error;
    return true;
  }


  async function fetchExistingImportHashes(hashes = []) {
    const wanted = [...new Set((Array.isArray(hashes) ? hashes : []).map((value) => String(value || '').trim()).filter(Boolean))];
    if (!wanted.length) return new Set();
    const found = new Set();
    const chunkSize = 250;
    for (let index = 0; index < wanted.length; index += chunkSize) {
      const chunk = wanted.slice(index, index + chunkSize);
      const { data, error } = await state.client
        .from(constants.AIRINGS_TABLE)
        .select('row_hash')
        .in('row_hash', chunk);
      if (error) throw error;
      (data || []).forEach((row) => { if (row?.row_hash) found.add(String(row.row_hash)); });
    }
    return found;
  }


  function importNaturalKey(row = {}) {
    return [
      utils.normalizeLookupKey(row.nola_code),
      utils.normalizeText(row.air_date) || utils.dateKeyFromDate(row.aired_at) || '',
      utils.normalizeText(row.air_time),
      utils.normalizeText(row.drive_start_date),
      utils.normalizeText(row.drive_end_date)
    ].join('|').toLowerCase();
  }

  async function fetchExistingImportedNaturalKeys(rows = []) {
    const wanted = new Set((Array.isArray(rows) ? rows : []).map((row) => importNaturalKey(row)).filter(Boolean));
    if (!wanted.size) return new Set();
    const existingRows = await fetchAllRows(constants.AIRINGS_TABLE);
    const found = new Set();
    (existingRows || []).forEach((row) => {
      const key = importNaturalKey(row);
      if (key && wanted.has(key)) found.add(key);
    });
    return found;
  }

  async function fetchImportedAirings() {
    return fetchAllRows(constants.AIRINGS_TABLE);
  }

  async function fetchUnlinkedImportedAirings() {
    const rows = await fetchAllRows(constants.AIRINGS_TABLE);
    return (rows || []).filter((row) => {
      const hasProgram = String(row?.program_id || row?.pledge_program_id || '').trim();
      const isNonSpecific = utils.isNonSpecificRow(row);
      return !hasProgram && !isNonSpecific;
    });
  }

  async function updateImportedAiringByHash(rowHash, payload = {}) {
    if (!rowHash) return { error: new Error('Missing row hash.') };
    let next = sanitizeImportRow(payload);
    let safety = 0;
    while (safety < 10) {
      safety += 1;
      const response = await state.client.from(constants.AIRINGS_TABLE).update(next).eq('row_hash', rowHash);
      if (!response.error) return response;
      const missingColumn = extractMissingColumnName(response.error);
      if (missingColumn && Object.prototype.hasOwnProperty.call(next, missingColumn)) {
        const clone = { ...next };
        delete clone[missingColumn];
        next = clone;
        continue;
      }
      return response;
    }
    return { error: new Error('Could not update imported airing row with current schema.') };
  }

  async function deleteImportedAiringByHash(rowHash) {
    if (!rowHash) return { error: new Error('Missing row hash.') };
    return state.client.from(constants.AIRINGS_TABLE).delete().eq('row_hash', rowHash);
  }
  async function fetchPerformanceInputs() {
    const warnings = [];
    let airingRows = [];
    try {
      airingRows = await fetchAllRows(constants.AIRINGS_TABLE);
    } catch (error) {
      warnings.push(`Airings read warning: ${error.message || error}`);
    }
    return { driveRows: [], airingRows, warnings };
  }


  async function probeImportTables() {
    const checks = [constants.AIRINGS_TABLE, constants.DRIVE_RESULTS_TABLE];
    const results = [];
    for (const tableName of checks) {
      try {
        const { error, count } = await state.client
          .from(tableName)
          .select('*', { head: true, count: 'exact' });
        results.push({
          tableName,
          readable: !error,
          writable: tableName === constants.AIRINGS_TABLE,
          count: Number.isFinite(count) ? count : 0,
          error: error?.message || ''
        });
      } catch (error) {
        results.push({
          tableName,
          readable: false,
          writable: tableName === constants.AIRINGS_TABLE,
          count: 0,
          error: error?.message || String(error)
        });
      }
    }
    return results;
  }

  function sanitizeImportRow(row = {}) {
    const uiOnlyKeys = new Set([
      'pending_persist_match_rule',
      'pending_manual_match_program_id',
      'pending_manual_match_label',
      'manual_match_label'
    ]);
    return Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => !uiOnlyKeys.has(key))
        .map(([key, value]) => [key, value === undefined ? null : value])
    );
  }

  function extractMissingColumnName(errorLike) {
    const message = String(errorLike?.message || errorLike || '');
    const patterns = [
      /Could not find the '([^']+)' column/i,
      /column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i,
      /schema cache.*'([^']+)' column/i
    ];
    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match?.[1]) return match[1];
    }
    return '';
  }

  function omitColumnFromRows(rows = [], columnName = '') {
    if (!columnName) return rows;
    return rows.map((row) => {
      if (!(columnName in row)) return row;
      const clone = { ...row };
      delete clone[columnName];
      return clone;
    });
  }

  async function writeImportChunk(tableName, rows) {
    if (!rows.length) return { written: 0, mode: 'skip' };
    let payload = rows.map((row) => sanitizeImportRow(row));
    let omittedColumns = [];
    let safety = 0;

    while (safety < 12) {
      safety += 1;
      let response = await state.client.from(tableName).upsert(payload, { onConflict: 'row_hash' });
      if (!response.error) return { written: payload.length, mode: omittedColumns.length ? `upsert-pruned:${omittedColumns.join(',')}` : 'upsert' };

      const missingColumn = extractMissingColumnName(response.error);
      if (missingColumn) {
        payload = omitColumnFromRows(payload, missingColumn);
        if (!omittedColumns.includes(missingColumn)) omittedColumns.push(missingColumn);
        continue;
      }

      const message = response.error?.message || '';
      if (/ON CONFLICT|constraint|row_hash|column .* does not exist|schema cache/i.test(message)) {
        response = await state.client.from(tableName).insert(payload);
        if (!response.error) return { written: payload.length, mode: omittedColumns.length ? `insert-pruned:${omittedColumns.join(',')}` : 'insert' };
        const insertMissingColumn = extractMissingColumnName(response.error);
        if (insertMissingColumn) {
          payload = omitColumnFromRows(payload, insertMissingColumn);
          if (!omittedColumns.includes(insertMissingColumn)) omittedColumns.push(insertMissingColumn);
          continue;
        }
      }
      throw response.error || new Error(`Import failed for ${tableName}.`);
    }
    throw new Error(`Import failed for ${tableName}: incompatible schema columns (${omittedColumns.join(', ') || 'unknown'}).`);
  }

  async function importNormalizedRows({ airingsRows = [], driveRows = [] } = {}) {
    const summary = {
      airings: { attempted: airingsRows.length, written: 0, skippedDuplicates: 0, mode: 'skip' },
      driveResults: { attempted: 0, written: 0, mode: 'derived' }
    };

    const existingHashes = await fetchExistingImportHashes(airingsRows.map((row) => row?.row_hash));
    const existingNaturalKeys = await fetchExistingImportedNaturalKeys(airingsRows);
    const freshRows = airingsRows.filter((row) => {
      const rowHash = String(row?.row_hash || '');
      if (rowHash && existingHashes.has(rowHash)) return false;
      const naturalKey = importNaturalKey(row);
      if (naturalKey && existingNaturalKeys.has(naturalKey)) return false;
      return true;
    });
    summary.airings.skippedDuplicates = Math.max(0, airingsRows.length - freshRows.length);
    if (!freshRows.length) {
      summary.airings.mode = 'duplicate-skip';
      return summary;
    }

    const chunkSize = 250;
    for (let index = 0; index < freshRows.length; index += chunkSize) {
      const result = await writeImportChunk(constants.AIRINGS_TABLE, freshRows.slice(index, index + chunkSize));
      summary.airings.written += result.written;
      summary.airings.mode = result.mode;
    }
    return summary;
  }

  App.data = {
    createClient,
    validateConfig,
    fetchAllRows,
    chooseLibrarySource,
    refreshRawRows,
    getProbeStatusMessage,
    fetchProgramDetail,
    fetchProgramDetailsBatch,
    resolveProgramSnapshot,
    resetDetailCaches,
    updateProgram,
    saveTimingRows,
    mergeLibraryRows,
    buildFieldAudit,
    buildBaseIndexes,
    matchBaseRow,
    probeScheduleStore,
    refreshNonPledgeRows,
    fetchSchedulesRemote,
    upsertScheduleRemote,
    deleteScheduleRemote,
    fetchPerformanceInputs,
    fetchImportedAirings,
    fetchUnlinkedImportedAirings,
    updateImportedAiringByHash,
    deleteImportedAiringByHash,
    probeImportTables,
    importNormalizedRows,
    createProgram
  };
})();

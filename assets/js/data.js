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

  function isSchemaOnlyError(message) {
    return /column .* does not exist|schema cache/i.test(message || '');
  }

  async function fetchManyByContext(tableName, context = {}, orderFields = [], ascending = true, options = {}) {
    const fieldAttempts = [
      ['program_id', context.programId],
      ['pledge_program_id', context.programId],
      ['id', context.programId],
      ['nola_code', context.nola],
      ['nola', context.nola],
      ['program_nola', context.nola],
      ...(options.allowTitleFields === false ? [] : [
        ['title', context.title],
        ['program_title', context.title],
        ['name', context.title]
      ])
    ].filter((entry) => !utils.isBlank(entry[1]));

    const normalizedOrderFields = Array.isArray(orderFields)
      ? orderFields.filter(Boolean)
      : [orderFields].filter(Boolean);
    const orderAttempts = [...normalizedOrderFields, null];

    let lastError = null;
    let sawSchemaOnlyError = false;
    for (const [field, value] of fieldAttempts) {
      for (const orderField of orderAttempts) {
        let query = state.client.from(tableName).select('*').eq(field, value);
        if (orderField) query = query.order(orderField, { ascending });
        const response = await query;
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
    }
    if (lastError && sawSchemaOnlyError && isSchemaOnlyError(lastError.message || '')) {
      return { data: [], error: null };
    }
    return { data: [], error: lastError };
  }

  async function fetchProgramDetail(programId) {
    const summaryRow = state.rawRows.find((row) => String(derive.programId(row)) === String(programId)) || null;
    const baseResp = await fetchOneById(constants.BASE_TABLE, programId);
    const contextRow = utils.mergeRows(summaryRow || {}, baseResp.data || {});
    const context = {
      programId,
      nola: derive.nola(contextRow),
      title: derive.title(contextRow)
    };
    const [timingResp, driveResp, airingsResp] = await Promise.all([
      fetchManyByContext(constants.TIMING_TABLE, context, ['segment_number', 'slot_number', 'break_offset_seconds', 'act_offset_seconds'], true),
      fetchManyByContext(constants.DRIVE_RESULTS_TABLE, context, ['drive_order', 'drive_date', 'aired_at', 'created_at'], false),
      fetchManyByContext(constants.AIRINGS_TABLE, context, ['aired_at', 'air_date', 'drive_date', 'created_at'], false, { allowTitleFields: false })
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

  async function createProgram(payload) {
    const attempts = [
      payload,
      { ...payload, source_row_number: 0 },
      { ...payload, created_by_email: state.userEmail || null, updated_by_email: state.userEmail || null },
      { ...payload, created_by_email: state.userEmail || null, updated_by_email: state.userEmail || null, source_row_number: 0 },
      { ...payload, created_by: state.userEmail || null, updated_by: state.userEmail || null },
      { ...payload, created_by: state.userEmail || null, updated_by: state.userEmail || null, source_row_number: 0 },
      { ...payload, workspace_key: 'default', created_by_email: state.userEmail || null, updated_by_email: state.userEmail || null },
      { ...payload, workspace_key: 'default', created_by_email: state.userEmail || null, updated_by_email: state.userEmail || null, source_row_number: 0 }
    ];
    let lastResponse = null;
    for (const attempt of attempts) {
      const response = await state.client.from(constants.BASE_TABLE).insert(attempt).select('*').single();
      lastResponse = response;
      if (!response.error) return response;
      const message = String(response.error?.message || '');
      if (/source_row_number/i.test(message) && !Object.prototype.hasOwnProperty.call(attempt, 'source_row_number')) {
        continue;
      }
      if (!/row-level security|violates row-level security|permission denied|source_row_number/i.test(message)) return response;
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
      return !hasProgram;
    });
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
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value === undefined ? null : value])
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

    for (let attempt = 0; attempt < 4; attempt += 1) {
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
    updateProgram,
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
    probeImportTables,
    importNormalizedRows,
    createProgram
  };
})();

(() => {
  const App = window.PledgeLib;
  const { state, constants, utils, derive } = App;
  const filters = App.programFilters;
  const { els, setNotice } = App.dom;
  const scheduledDetailQueue = new Set();
  let scheduledDetailPumpActive = false;
  let scheduledDetailRerenderTimer = 0;
  let cachedProgramLookupRows = null;
  let cachedProgramLookup = null;

  function getActiveSchedule() {
    return derive.scheduleById(state.activeScheduleId);
  }

  function formatScheduleDay(dateKey) {
    const date = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dateKey;
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function defaultScheduleTitle(startDate, endDate) {
    if (!startDate || !endDate) return 'New fundraiser';
    return `Fundraiser ${utils.formatDate(startDate)} – ${utils.formatDate(endDate)}`;
  }

  function renderProgramTitleLink(programId, title, { html = '', className = '', nested = false, titleAttr = '' } = {}) {
    return App.programLinks.render({
      programId,
      title,
      html: html || `<strong>${utils.escapeHtml(title || 'Untitled program')}</strong>`,
      className,
      nested,
      titleAttr
    });
  }

  function getScheduleDateSpanInfo(schedule = {}) {
    const startKey = utils.normalizeText(schedule?.startDate);
    const endKey = utils.normalizeText(schedule?.endDate);
    if (!startKey || !endKey) return { ok: false, reason: 'This fundraiser is missing a start or end date.', days: 0 };
    const start = new Date(`${startKey}T00:00:00`);
    const end = new Date(`${endKey}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return { ok: false, reason: 'This fundraiser has an invalid date range.', days: 0 };
    }
    const days = Math.floor((end - start) / 86400000) + 1;
    if (!Number.isFinite(days) || days > 400) {
      return { ok: false, reason: `This fundraiser spans ${days} days, which is beyond the safe scheduler limit. Remove or fix it before opening.`, days };
    }
    return { ok: true, reason: '', days };
  }

  function normalizeScheduleWindow(schedule = {}) {
    const next = { ...schedule };
    const startMinutes = Number.isFinite(Number(next.dayStartMinutes)) ? Number(next.dayStartMinutes) : (Number(next.dayStartHour || constants.DEFAULT_DAY_START_HOUR) * 60);
    let endMinutes = Number.isFinite(Number(next.dayEndMinutes)) ? Number(next.dayEndMinutes) : (Number(next.dayEndHour || constants.DEFAULT_DAY_END_HOUR) * 60);
    if (endMinutes <= startMinutes) endMinutes += 1440;
    const needsLegacyUpgrade = endMinutes <= 1440 || startMinutes < constants.DEFAULT_DAY_START_MINUTES;
    next.dayStartMinutes = needsLegacyUpgrade ? constants.DEFAULT_DAY_START_MINUTES : startMinutes;
    next.dayEndMinutes = needsLegacyUpgrade ? constants.DEFAULT_DAY_END_MINUTES : endMinutes;
    next.dayStartHour = Math.floor(next.dayStartMinutes / 60);
    next.dayEndHour = Math.floor(next.dayEndMinutes / 60);
    return next;
  }

  function sortSchedulesNewestFirst(items = []) {
    return [...items].sort((a, b) => {
      const aKey = `${utils.normalizeText(a.endDate) || ''}|${utils.normalizeText(a.startDate) || ''}|${utils.normalizeText(a.createdAt) || ''}`;
      const bKey = `${utils.normalizeText(b.endDate) || ''}|${utils.normalizeText(b.startDate) || ''}|${utils.normalizeText(b.createdAt) || ''}`;
      return bKey.localeCompare(aKey);
    });
  }

  async function loadSchedules() {
    let loaded = [];
    if (state.client) {
      await App.data.probeScheduleStore();
      if (state.scheduleStoreMode === 'remote') {
        try {
          loaded = await App.data.fetchSchedulesRemote();
        } catch (error) {
          console.warn('Remote schedule load failed.', error);
          state.scheduleStoreMode = 'local';
          state.scheduleSyncMessage = `Remote fundraiser sync failed. Using this browser only. ${error.message || ''}`.trim();
        }
      }
    }
    if (state.scheduleStoreMode !== 'remote') {
      loaded = utils.storageGet(constants.SCHEDULE_STORAGE_KEY, []);
      if (!state.scheduleSyncMessage) state.scheduleSyncMessage = 'Fundraisers are saved only in this browser.';
    }
    state.schedules = sortSchedulesNewestFirst((Array.isArray(loaded) ? loaded : []).map((schedule) => normalizeScheduleWindow(schedule)));
    state.schedulingReady = true;
    const activeSchedule = getActiveSchedule();
    const activeInfo = activeSchedule ? getScheduleDateSpanInfo(activeSchedule) : null;
    if (!state.activeScheduleId || !activeSchedule || !activeInfo?.ok) {
      const firstSafeSchedule = state.schedules.find((item) => getScheduleDateSpanInfo(item).ok) || state.schedules[0] || null;
      state.activeScheduleId = firstSafeSchedule?.id || '';
    }
    if (getActiveSchedule() && getScheduleDateSpanInfo(getActiveSchedule()).ok) applyScheduleToView(getActiveSchedule());
    renderScheduleList();
  }

  async function ensureReady() {
    if (!state.schedulingReady) await loadSchedules();
    renderAll();
  }

  async function persistSchedules(schedule) {
    if (state.scheduleStoreMode === 'remote' && state.client) {
      try {
        await App.data.upsertScheduleRemote(schedule);
        state.scheduleSyncMessage = 'Fundraisers sync through Supabase.';
        return true;
      } catch (error) {
        console.warn('Remote schedule save failed.', error);
        state.scheduleStoreMode = 'local';
        state.scheduleSyncMessage = `Remote save failed. Using this browser only. ${error.message || ''}`.trim();
      }
    }
    utils.storageSet(constants.SCHEDULE_STORAGE_KEY, state.schedules);
    return false;
  }

  async function deleteScheduleRecord(scheduleId) {
    state.schedules = state.schedules.filter((item) => item.id !== scheduleId);
    if (state.activeScheduleId === scheduleId) state.activeScheduleId = state.schedules[0]?.id || '';
    if (state.scheduleStoreMode === 'remote' && state.client) {
      try {
        await App.data.deleteScheduleRemote(scheduleId);
      } catch (error) {
        console.warn('Remote delete failed.', error);
        state.scheduleStoreMode = 'local';
        state.scheduleSyncMessage = `Remote delete failed. Using this browser only. ${error.message || ''}`.trim();
      }
    }
    utils.storageSet(constants.SCHEDULE_STORAGE_KEY, state.schedules);
    renderAll();
  }

  function createScheduleRecord({ title, startDate, endDate, dayStartHour, dayEndHour, dayStartMinutes, dayEndMinutes, onlineDollars = 0, mailDollars = 0, meta = {} }) {
    const resolvedStartMinutes = Number.isFinite(Number(dayStartMinutes)) ? Number(dayStartMinutes) : (Number(dayStartHour || constants.DEFAULT_DAY_START_HOUR) * 60);
    let resolvedEndMinutes = Number.isFinite(Number(dayEndMinutes)) ? Number(dayEndMinutes) : (Number(dayEndHour || constants.DEFAULT_DAY_END_HOUR) * 60);
    if (resolvedEndMinutes <= resolvedStartMinutes) resolvedEndMinutes += 1440;
    return {
      id: utils.makeId('schedule'),
      title: title || defaultScheduleTitle(startDate, endDate),
      startDate,
      endDate,
      dayStartHour: Math.floor(resolvedStartMinutes / 60),
      dayEndHour: Math.floor(resolvedEndMinutes / 60),
      dayStartMinutes: resolvedStartMinutes,
      dayEndMinutes: resolvedEndMinutes,
      createdAt: new Date().toISOString(),
      placements: [],
      slotNotes: {},
      onlineDollars: Number(onlineDollars || 0) || 0,
      mailDollars: Number(mailDollars || 0) || 0,
      meta: meta || {}
    };
  }

  const importedBroadcastHydration = new Map();

  function placementBroadcastTotal(schedule = {}) {
    return (schedule?.placements || []).reduce((sum, placement) => {
      const value = Number(placement?.importedBroadcastDollars);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }

  function importedRowIsNonSpecific(row = {}) {
    const titleKey = utils.normalizeLookupKey(row?.imported_program_title || row?.program_title || row?.title || '').replace(/[^a-z0-9]+/g, ' ').trim();
    const nolaKey = utils.normalizeLookupKey(row?.nola_code || '').replace(/\s+/g, '');
    return Boolean(row?.is_non_specific) || nolaKey === 'nspl' || titleKey === 'non specific pledges' || titleKey.endsWith('non specific pledges');
  }

  function summarizeImportedRows(rows = []) {
    let importedBroadcastTotalDollars = 0;
    let importedProgramSpecificBroadcastTotalDollars = 0;
    let importedNonSpecificBroadcastTotalDollars = 0;
    let importedPledgesTotal = 0;
    const byFile = new Map();
    (Array.isArray(rows) ? rows : []).forEach((entry) => {
      const row = entry?.row || entry || {};
      const dollars = Number(row?.dollars || 0) || 0;
      importedBroadcastTotalDollars += dollars;
      importedPledgesTotal += Number(row?.pledge_count || row?.pledges || 0) || 0;
      if (importedRowIsNonSpecific(row)) importedNonSpecificBroadcastTotalDollars += dollars;
      else importedProgramSpecificBroadcastTotalDollars += dollars;
      const file = String(row?.source_file_name || '').trim();
      const value = Number(row?.source_report_total_dollars);
      if (!file || !Number.isFinite(value) || value <= 0) return;
      byFile.set(file, Math.max(byFile.get(file) || 0, value));
    });
    let reportedBroadcastTotalDollars = 0;
    byFile.forEach((value) => { reportedBroadcastTotalDollars += value; });
    return {
      importedBroadcastTotalDollars,
      importedProgramSpecificBroadcastTotalDollars,
      importedNonSpecificBroadcastTotalDollars,
      importedPledgesTotal,
      reportedBroadcastTotalDollars
    };
  }

  function scheduleImportedPledgesTotal(schedule = {}) {
    const metaTotal = Number(schedule?.meta?.importedPledgesTotal);
    return Number.isFinite(metaTotal) && metaTotal > 0 ? metaTotal : 0;
  }

  function scheduleReportedBroadcastTotal(schedule = {}) {
    const reportTotal = Number(schedule?.meta?.reportedBroadcastTotalDollars);
    return Number.isFinite(reportTotal) && reportTotal > 0 ? reportTotal : 0;
  }

  function scheduleImportedProgramSpecificTotal(schedule = {}) {
    const metaTotal = Number(schedule?.meta?.importedProgramSpecificBroadcastTotalDollars);
    if (Number.isFinite(metaTotal) && metaTotal > 0) return metaTotal;
    const placementTotal = placementBroadcastTotal(schedule);
    return Number.isFinite(placementTotal) && placementTotal > 0 ? placementTotal : 0;
  }

  function scheduleImportedNonSpecificTotal(schedule = {}) {
    const metaTotal = Number(schedule?.meta?.importedNonSpecificBroadcastTotalDollars);
    return Number.isFinite(metaTotal) && metaTotal > 0 ? metaTotal : 0;
  }

  function scheduleImportedAiringTotal(schedule = {}) {
    const metaTotal = Number(schedule?.meta?.importedBroadcastTotalDollars);
    if (Number.isFinite(metaTotal) && metaTotal > 0) return metaTotal;
    const detailedTotal = scheduleImportedProgramSpecificTotal(schedule) + scheduleImportedNonSpecificTotal(schedule);
    if (Number.isFinite(detailedTotal) && detailedTotal > 0) return detailedTotal;
    const placementTotal = placementBroadcastTotal(schedule);
    return Number.isFinite(placementTotal) && placementTotal > 0 ? placementTotal : 0;
  }

  function scheduleBroadcastTotal(schedule = {}) {
    const reported = scheduleReportedBroadcastTotal(schedule);
    if (reported > 0) return reported;
    return scheduleImportedAiringTotal(schedule);
  }

  function scheduleBroadcastDifference(schedule = {}) {
    const broadcast = scheduleBroadcastTotal(schedule);
    const imported = scheduleImportedAiringTotal(schedule);
    return Math.round(((broadcast || 0) - (imported || 0)) * 100) / 100;
  }

  function placementSignature(placement = {}, importedKey = '') {
    const titleKey = utils.normalizeLookupKey(placement?.programTitle || '');
    return [
      utils.normalizeText(placement?.programId),
      titleKey,
      utils.normalizeText(placement?.dateKey),
      String(Number(placement?.startMinutes || 0) || 0),
      utils.normalizeText(importedKey || placement?.importedFundraiserKey || '')
    ].join('|').toLowerCase();
  }

  async function ensureScheduleBroadcastTotal(schedule) {
    if (!schedule?.id) return;
    const alreadyHasImported = scheduleImportedAiringTotal(schedule) > 0;
    const alreadyHasReported = scheduleReportedBroadcastTotal(schedule) > 0;
    if (alreadyHasImported && alreadyHasReported) return;
    if (!(schedule?.placements || []).some((placement) => placement.importedFromReport)) return;
    if (importedBroadcastHydration.has(schedule.id)) return importedBroadcastHydration.get(schedule.id);
    const task = (async () => {
      try {
        const importedRows = state.imports?.airingsRows?.length ? state.imports.airingsRows : await App.data.fetchImportedAirings();
        if (!Array.isArray(importedRows) || !importedRows.length) return;
        const placementHashes = new Set((schedule.placements || []).map((placement) => String(placement.sourceAiringHash || '')).filter(Boolean));
        const importedKey = String(schedule?.meta?.importedFundraiserKey || '').toLowerCase();
        const placementFiles = new Set((schedule.placements || []).map((placement) => utils.normalizeLookupKey(placement?.sourceName || '')).filter(Boolean));
        const belongingRows = importedRows.filter((row) => {
          const rowHash = String(row?.row_hash || '');
          const rowFileKey = utils.normalizeLookupKey(row?.source_file_name || '');
          const rowKey = importedScheduleKey(row);
          return (placementHashes.size && placementHashes.has(rowHash)) || (importedKey && rowKey === importedKey) || (rowFileKey && placementFiles.has(rowFileKey));
        });
        const totals = summarizeImportedRows(belongingRows);
        if (!(totals.importedBroadcastTotalDollars > 0) && !(totals.reportedBroadcastTotalDollars > 0)) return;
        schedule.meta = {
          ...(schedule.meta || {}),
          importedBroadcastTotalDollars: totals.importedBroadcastTotalDollars > 0 ? totals.importedBroadcastTotalDollars : Number(schedule?.meta?.importedBroadcastTotalDollars || 0) || 0,
          importedProgramSpecificBroadcastTotalDollars: totals.importedProgramSpecificBroadcastTotalDollars > 0 ? totals.importedProgramSpecificBroadcastTotalDollars : Number(schedule?.meta?.importedProgramSpecificBroadcastTotalDollars || 0) || 0,
          importedNonSpecificBroadcastTotalDollars: totals.importedNonSpecificBroadcastTotalDollars > 0 ? totals.importedNonSpecificBroadcastTotalDollars : Number(schedule?.meta?.importedNonSpecificBroadcastTotalDollars || 0) || 0,
          importedPledgesTotal: totals.importedPledgesTotal > 0 ? totals.importedPledgesTotal : Number(schedule?.meta?.importedPledgesTotal || 0) || 0,
          reportedBroadcastTotalDollars: totals.reportedBroadcastTotalDollars > 0 ? totals.reportedBroadcastTotalDollars : Number(schedule?.meta?.reportedBroadcastTotalDollars || 0) || 0
        };
        if ((schedule.placements || []).length) {
          const byHash = new Map(importedRows.map((row) => [String(row?.row_hash || ''), Number(row?.dollars || 0) || 0]));
          schedule.placements = (schedule.placements || []).map((placement) => {
            if (Number.isFinite(Number(placement?.importedBroadcastDollars)) && Number(placement.importedBroadcastDollars) > 0) return placement;
            const hydrated = byHash.get(String(placement?.sourceAiringHash || ''));
            return Number.isFinite(hydrated) && hydrated > 0 ? { ...placement, importedBroadcastDollars: hydrated } : placement;
          });
        }
        await persistSchedules(schedule);
        renderScheduleList();
        renderScheduleForm();
        renderScheduledProgramDetails();
      } catch (error) {
        console.warn('Unable to hydrate imported broadcast total for schedule.', error);
      } finally {
        importedBroadcastHydration.delete(schedule.id);
      }
    })();
    importedBroadcastHydration.set(schedule.id, task);
    return task;
  }

  function scheduleGrandTotal(schedule = {}) {
    return scheduleBroadcastTotal(schedule) + (Number(schedule?.onlineDollars || 0) || 0) + (Number(schedule?.mailDollars || 0) || 0);
  }

  function getScheduleWindow(source = {}) {
    const startMinutes = Number.isFinite(Number(source.dayStartMinutes))
      ? Number(source.dayStartMinutes)
      : (Number(source.dayStartHour || constants.DEFAULT_DAY_START_HOUR) * 60);
    let endMinutes = Number.isFinite(Number(source.dayEndMinutes))
      ? Number(source.dayEndMinutes)
      : (Number(source.dayEndHour || constants.DEFAULT_DAY_END_HOUR) * 60);
    if (endMinutes <= startMinutes) endMinutes += 1440;
    return { startMinutes, endMinutes };
  }

  function toDisplayPlacement(placement = {}, windowStartMinutes = constants.DEFAULT_DAY_START_MINUTES) {
    const cutoff = ((Number(windowStartMinutes) % 1440) + 1440) % 1440;
    let displayDateKey = placement.dateKey;
    let displayStartMinutes = Number(placement.startMinutes || 0);
    if (displayStartMinutes < cutoff) {
      displayDateKey = utils.plusDays(displayDateKey, -1);
      displayStartMinutes += 1440;
    }
    const lengthMinutes = Math.max(1, Number(placement.lengthMinutes || 30));
    const displayEndMinutes = displayStartMinutes + Math.max(constants.DEFAULT_SLOT_MINUTES, Math.ceil(lengthMinutes / constants.DEFAULT_SLOT_MINUTES) * constants.DEFAULT_SLOT_MINUTES);
    return {
      ...placement,
      displayDateKey,
      displayStartMinutes,
      displayEndMinutes,
      displaySlotKey: `${displayDateKey}|${displayStartMinutes}`
    };
  }



  function importedRowDateKey(row = {}) {
    return utils.normalizeText(row.air_date) || utils.dateKeyFromDate(row.aired_at) || '';
  }

  function importedRowStartMinutes(row = {}) {
    const direct = utils.normalizeText(row.air_time);
    if (direct) {
      const match = direct.match(/^(\d{1,2}):(\d{2})/);
      if (match) return (Number(match[1]) * 60) + Number(match[2]);
    }
    const stamp = row.aired_at ? new Date(row.aired_at) : null;
    if (stamp && !Number.isNaN(stamp.getTime())) return (stamp.getHours() * 60) + stamp.getMinutes();
    return null;
  }

  function importedFundraiserLabel(row = {}) {
    return utils.normalizeText(row.fundraiser_label)
      || ((row.drive_start_date && row.drive_end_date) ? `Imported pledge ${utils.formatDate(row.drive_start_date)} – ${utils.formatDate(row.drive_end_date)}` : '')
      || utils.normalizeText(row.source_file_name)
      || 'Imported fundraiser';
  }

  function importedScheduleKey(row = {}) {
    const startDate = utils.normalizeText(row.drive_start_date);
    const endDate = utils.normalizeText(row.drive_end_date);
    if (startDate || endDate) return ['range', startDate, endDate].join('|').toLowerCase();
    const label = utils.normalizeLookupKey(row.fundraiser_label);
    if (label) return ['label', label].join('|').toLowerCase();
    return ['file', utils.normalizeLookupKey(row.source_file_name)].join('|').toLowerCase();
  }

  function importedNaturalKey(row = {}) {
    return [
      utils.normalizeLookupKey(row.nola_code || row.program_title || row.title || ''),
      utils.normalizeText(row.air_date) || utils.dateKeyFromDate(row.aired_at) || '',
      utils.normalizeText(row.air_time) || '',
      utils.normalizeText(row.drive_start_date) || '',
      utils.normalizeText(row.drive_end_date) || ''
    ].join('|').toLowerCase();
  }

  function importedRowFreshnessScore(row = {}) {
    const stamps = [row.imported_at, row.created_at, row.updated_at]
      .map((value) => {
        const date = value ? new Date(value) : null;
        return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
      });
    const stampScore = Math.max(0, ...stamps);
    const batchScore = utils.normalizeText(row.import_batch_id || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const matchScore = String(row.program_id || row.pledge_program_id || '').trim() ? 1000000 : 0;
    const reportScore = Number(row.source_report_total_dollars || 0) > 0 ? 10000 : 0;
    return stampScore + batchScore + matchScore + reportScore;
  }

  function choosePreferredImportedRow(existing = {}, candidate = {}) {
    const existingScore = importedRowFreshnessScore(existing);
    const candidateScore = importedRowFreshnessScore(candidate);
    if (candidateScore !== existingScore) return candidateScore > existingScore ? candidate : existing;
    return candidate;
  }

  function dedupeImportedRows(rows = []) {
    const byNaturalKey = new Map();
    const ordered = [];
    let collapsed = 0;
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const naturalKey = importedNaturalKey(row);
      const key = naturalKey || String(row?.row_hash || utils.makeId('importrow'));
      if (!byNaturalKey.has(key)) {
        byNaturalKey.set(key, row);
        ordered.push(key);
        return;
      }
      collapsed += 1;
      byNaturalKey.set(key, choosePreferredImportedRow(byNaturalKey.get(key), row));
    });
    return {
      rows: ordered.map((key) => byNaturalKey.get(key)).filter(Boolean),
      collapsed
    };
  }

  const IMPORTED_FUNDRAISER_CLUSTER_GAP_DAYS = 14;
  const IMPORTED_RANGE_SUSPICIOUS_SPAN_DAYS = 45;

  function dateKeyToDate(dateKey = '') {
    if (!dateKey) return null;
    const stamp = new Date(`${dateKey}T12:00:00`);
    return Number.isNaN(stamp.getTime()) ? null : stamp;
  }

  function daysBetweenDateKeys(a = '', b = '') {
    const da = dateKeyToDate(a);
    const db = dateKeyToDate(b);
    if (!da || !db) return null;
    return Math.round((db.getTime() - da.getTime()) / 86400000);
  }

  function labelIsSpecificFundraiser(label = '') {
    const clean = utils.normalizeText(label);
    if (!clean) return false;
    const key = utils.normalizeLookupKey(clean);
    if (!key) return false;
    if (key.startsWith('imported pledge ')) return false;
    if (key === 'imported fundraiser') return false;
    if (key.endsWith('.csv') || key.endsWith('.xlsx') || key.endsWith('.xls')) return false;
    return true;
  }

  function chooseImportedGroupSeed(row = {}) {
    const label = utils.normalizeText(row.fundraiser_label);
    if (labelIsSpecificFundraiser(label)) return ['label', utils.normalizeLookupKey(label)].join('|').toLowerCase();
    const sourceFile = utils.normalizeLookupKey(row.source_file_name);
    if (sourceFile) return ['file', sourceFile].join('|').toLowerCase();
    return importedScheduleKey(row);
  }

  function formatClusterTitle(group = {}) {
    const specificLabel = utils.normalizeText(group.rows?.find((entry) => labelIsSpecificFundraiser(entry.row?.fundraiser_label))?.row?.fundraiser_label || '');
    if (specificLabel) return specificLabel;
    const start = utils.normalizeText(group.startDate);
    const end = utils.normalizeText(group.endDate);
    if (start && end && start !== end) return `Imported pledge ${utils.formatDate(start)} – ${utils.formatDate(end)}`;
    if (start) return `Imported pledge ${utils.formatDate(start)}`;
    return utils.normalizeText(group.rows?.[0]?.row?.source_file_name) || 'Imported fundraiser';
  }

  function finalizeImportedCluster(seedKey, rows = []) {
    const validRows = rows.filter(Boolean).sort((a, b) => {
      const dateA = utils.normalizeText(a.dateKey || '');
      const dateB = utils.normalizeText(b.dateKey || '');
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return (Number(a.startMinutes) || 0) - (Number(b.startMinutes) || 0);
    });
    const startDate = validRows[0]?.dateKey || '';
    const endDate = validRows[validRows.length - 1]?.dateKey || startDate;
    const rowsHaveSpecificLabel = validRows.some((entry) => labelIsSpecificFundraiser(entry.row?.fundraiser_label));
    const identityKey = rowsHaveSpecificLabel
      ? ['cluster', seedKey].join('|').toLowerCase()
      : ['cluster', seedKey, startDate, endDate].join('|').toLowerCase();
    const group = { rows: validRows, key: identityKey, startDate, endDate, title: '' };
    group.title = formatClusterTitle(group);
    return group;
  }

  function buildImportedFundraiserGroups(preparedRows = []) {
    const seeded = new Map();
    preparedRows.forEach((prepared) => {
      const seedKey = chooseImportedGroupSeed(prepared.row);
      if (!seeded.has(seedKey)) seeded.set(seedKey, []);
      seeded.get(seedKey).push(prepared);
    });
    const groups = [];
    seeded.forEach((items, seedKey) => {
      const sorted = [...items].sort((a, b) => {
        const dateA = utils.normalizeText(a.dateKey || '');
        const dateB = utils.normalizeText(b.dateKey || '');
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return (Number(a.startMinutes) || 0) - (Number(b.startMinutes) || 0);
      });
      if (!sorted.length) return;
      const spanDays = daysBetweenDateKeys(sorted[0].dateKey, sorted[sorted.length - 1].dateKey);
      const shouldCluster = !sorted.some((entry) => labelIsSpecificFundraiser(entry.row?.fundraiser_label))
        || (Number.isFinite(spanDays) && spanDays > IMPORTED_RANGE_SUSPICIOUS_SPAN_DAYS);
      if (!shouldCluster) {
        groups.push(finalizeImportedCluster(seedKey, sorted));
        return;
      }
      let cluster = [sorted[0]];
      for (let index = 1; index < sorted.length; index += 1) {
        const current = sorted[index];
        const previous = sorted[index - 1];
        const gapDays = daysBetweenDateKeys(previous.dateKey, current.dateKey);
        if (Number.isFinite(gapDays) && gapDays > IMPORTED_FUNDRAISER_CLUSTER_GAP_DAYS) {
          groups.push(finalizeImportedCluster(seedKey, cluster));
          cluster = [current];
          continue;
        }
        cluster.push(current);
      }
      if (cluster.length) groups.push(finalizeImportedCluster(seedKey, cluster));
    });
    return groups.sort((a, b) => {
      const dateA = utils.normalizeText(a.startDate || '');
      const dateB = utils.normalizeText(b.startDate || '');
      return dateA.localeCompare(dateB);
    });
  }

  function scheduleIdentityKey(schedule = {}) {
    const importedKey = utils.normalizeText(schedule?.meta?.importedFundraiserKey)
      || utils.normalizeText(schedule?.placements?.find((placement) => placement?.importedFromReport && placement?.importedFundraiserKey)?.importedFundraiserKey);
    if (importedKey) return `imported|${importedKey}`.toLowerCase();
    return [
      utils.normalizeText(schedule.title),
      utils.normalizeText(schedule.startDate),
      utils.normalizeText(schedule.endDate)
    ].join('|').toLowerCase();
  }

  function scheduleImportedFileKeys(schedule = {}) {
    return new Set((schedule?.placements || [])
      .filter((placement) => placement?.importedFromReport)
      .map((placement) => utils.normalizeLookupKey(placement?.sourceName || ''))
      .filter(Boolean));
  }

  function groupImportedFileKeys(group = {}) {
    return new Set((group?.rows || [])
      .map((entry) => utils.normalizeLookupKey(entry?.row?.source_file_name || ''))
      .filter(Boolean));
  }

  function datesOverlap(startA = '', endA = '', startB = '', endB = '') {
    if (!(startA && endA && startB && endB)) return false;
    return !(endA < startB || endB < startA);
  }


  function getProgramLookupCache() {
    const rows = Array.isArray(state.rawRows) ? state.rawRows : [];
    if (cachedProgramLookup && cachedProgramLookupRows === rows) return cachedProgramLookup;
    const byProgramId = new Map();
    const byNola = new Map();
    const byTitle = new Map();
    rows.forEach((item) => {
      const programId = String(derive.programId(item) || '').trim();
      if (programId && !byProgramId.has(programId)) byProgramId.set(programId, item);
      const nolaKey = utils.normalizeLookupKey(derive.nola(item));
      if (nolaKey && !byNola.has(nolaKey)) byNola.set(nolaKey, item);
      const titleKey = utils.normalizeLookupKey(derive.title(item));
      if (titleKey && !byTitle.has(titleKey)) byTitle.set(titleKey, item);
    });
    cachedProgramLookupRows = rows;
    cachedProgramLookup = { byProgramId, byNola, byTitle };
    return cachedProgramLookup;
  }

  function findProgramRowForImportedAiring(row = {}) {
    const lookup = getProgramLookupCache();
    const programId = String(row.pledge_program_id || row.program_id || '').trim();
    if (programId && lookup.byProgramId.has(programId)) return lookup.byProgramId.get(programId);
    const wantedNola = utils.normalizeLookupKey(row.nola_code);
    if (wantedNola && lookup.byNola.has(wantedNola)) return lookup.byNola.get(wantedNola);
    const wantedTitle = utils.normalizeLookupKey(row.program_title || row.title);
    if (wantedTitle && lookup.byTitle.has(wantedTitle)) return lookup.byTitle.get(wantedTitle);
    return null;
  }

  function resolveImportedPlacementLength(row = {}, sourceRow = null) {
    const importedMinutes = Number(row.program_minutes);
    const runtimeMinutes = Number(derive.runtimeMinutes(sourceRow));
    const bucketMinutes = Number(derive.lengthBucket(sourceRow));
    let lengthMinutes = Number.isFinite(runtimeMinutes) && runtimeMinutes > 0
      ? runtimeMinutes
      : (Number.isFinite(importedMinutes) && importedMinutes > 0
        ? importedMinutes
        : (Number.isFinite(bucketMinutes) && bucketMinutes > 0 ? bucketMinutes : 30));
    const correctedFromLibrary = Number.isFinite(runtimeMinutes) && runtimeMinutes > 0 && Number.isFinite(importedMinutes) && importedMinutes > 0 && importedMinutes !== runtimeMinutes;
    return {
      lengthMinutes: Math.max(1, Math.round(lengthMinutes || 30)),
      correctedFromLibrary
    };
  }

  function buildPlacementFromImportedAiring(source = {}) {
    const prepared = source && source.row ? source : null;
    const row = prepared?.row || source;
    const sourceRow = prepared?.sourceRow || findProgramRowForImportedAiring(row);
    const dateKey = prepared?.dateKey || importedRowDateKey(row);
    const startMinutes = Number.isFinite(prepared?.startMinutes) ? prepared.startMinutes : importedRowStartMinutes(row);
    if (!sourceRow || !dateKey || !Number.isFinite(startMinutes)) return null;
    const { lengthMinutes, correctedFromLibrary } = resolveImportedPlacementLength(row, sourceRow);
    const endMinutes = startMinutes + Math.max(constants.DEFAULT_SLOT_MINUTES, Math.ceil(lengthMinutes / constants.DEFAULT_SLOT_MINUTES) * constants.DEFAULT_SLOT_MINUTES);
    return {
      id: utils.makeId('place'),
      programId: derive.programId(sourceRow),
      programTitle: derive.title(sourceRow),
      lengthMinutes,
      durationCorrectedFromLibrary: correctedFromLibrary,
      dateKey,
      startMinutes,
      endMinutes,
      startSlotKey: `${dateKey}|${startMinutes}`,
      liveBreakFlag: false,
      liveBreakNotes: '',
      isNonPledge: false,
      sourceName: row.source_file_name || '',
      sourceLabel: 'Imported report',
      transferredToStation: false,
      importedFromReport: true,
      importedBroadcastDollars: Number(row.dollars || 0) || 0,
      sourceAiringHash: row.row_hash || '',
      sourceImportBatchId: row.import_batch_id || '',
      importedFundraiserKey: importedScheduleKey(row),
      fundraiserLabel: importedFundraiserLabel(row)
    };
  }

  function mergeImportedRowsIntoSchedules(rows = [], { rebuild = false, activateFirst = true, dirtySchedules = [] } = {}) {
    const deduped = dedupeImportedRows(Array.isArray(rows) ? rows : []);
    const sourceRows = deduped.rows;
    const diagnostics = {
      inputRows: Array.isArray(rows) ? rows.length : 0,
      collapsedDuplicateImports: deduped.collapsed,
      eligibleRows: 0,
      noLibraryMatch: 0,
      badDate: 0,
      badTime: 0,
      droppedRows: []
    };
    const groupedRows = sourceRows.map((row) => ({
      row,
      sourceRow: importedRowIsNonSpecific(row) ? null : findProgramRowForImportedAiring(row),
      dateKey: importedRowDateKey(row) || utils.normalizeText(row.drive_start_date || row.drive_end_date || ''),
      startMinutes: Number.isFinite(importedRowStartMinutes(row)) ? importedRowStartMinutes(row) : 0,
      isNonSpecific: importedRowIsNonSpecific(row)
    })).filter((entry) => entry.dateKey);
    groupedRows.forEach((entry) => {
      if (entry.isNonSpecific) return;
      const reasons = [];
      if (!entry.sourceRow) reasons.push('no_library_match');
      if (!entry.dateKey) reasons.push('bad_date');
      if (!Number.isFinite(importedRowStartMinutes(entry.row))) reasons.push('bad_time');
      if (reasons.length) {
        if (reasons.includes('no_library_match')) diagnostics.noLibraryMatch += 1;
        if (reasons.includes('bad_date')) diagnostics.badDate += 1;
        if (reasons.includes('bad_time')) diagnostics.badTime += 1;
        if (diagnostics.droppedRows.length < 12) diagnostics.droppedRows.push({
          title: utils.normalizeText(entry.row.program_title || entry.row.title || 'Unknown title') || 'Unknown title',
          sourceFile: utils.normalizeText(entry.row.source_file_name || ''),
          airDate: utils.normalizeText(entry.row.air_date || entry.row.drive_start_date || ''),
          airTime: utils.normalizeText(entry.row.air_time || ''),
          reasons
        });
        return;
      }
      diagnostics.eligibleRows += 1;
    });
    const preparedRows = groupedRows.filter((entry) => !entry.isNonSpecific && entry.sourceRow && entry.dateKey && Number.isFinite(importedRowStartMinutes(entry.row))).map((entry) => ({
      ...entry,
      startMinutes: importedRowStartMinutes(entry.row)
    }));
    const skippedRows = Math.max(0, sourceRows.length - preparedRows.length - groupedRows.filter((entry) => entry.isNonSpecific).length);
    const groups = buildImportedFundraiserGroups(groupedRows);

    let createdSchedules = 0;
    let updatedSchedules = 0;
    let createdPlacements = 0;
    let skippedPlacements = 0;
    let correctedDurations = 0;
    let firstScheduleId = '';

    groups.forEach((group) => {
      const identity = `imported|${group.key}`.toLowerCase();
      const groupFileKeys = groupImportedFileKeys(group);
      let schedule = state.schedules.find((item) => scheduleIdentityKey(item) === identity) || null;
      if (!schedule) {
        schedule = state.schedules.find((item) => {
          const importedPlacement = (item.placements || []).find((placement) => placement?.importedFromReport && utils.normalizeText(placement?.importedFundraiserKey) === utils.normalizeText(group.key));
          return Boolean(importedPlacement);
        }) || null;
      }
      if (!schedule) {
        schedule = state.schedules.find((item) => {
          const sameRange = utils.normalizeText(item.startDate) === group.startDate && utils.normalizeText(item.endDate) === group.endDate;
          const hasImportedPlacements = (item.placements || []).some((placement) => placement.importedFromReport);
          return sameRange && hasImportedPlacements;
        }) || null;
      }
      if (!schedule) {
        schedule = state.schedules.find((item) => {
          const hasImportedPlacements = (item.placements || []).some((placement) => placement.importedFromReport);
          if (!hasImportedPlacements) return false;
          if (!datesOverlap(utils.normalizeText(item.startDate), utils.normalizeText(item.endDate), group.startDate, group.endDate)) return false;
          const itemFileKeys = scheduleImportedFileKeys(item);
          if (!itemFileKeys.size || !groupFileKeys.size) return false;
          return [...groupFileKeys].some((key) => itemFileKeys.has(key));
        }) || null;
      }
      if (!schedule) {
        schedule = createScheduleRecord({ title: group.title, startDate: group.startDate, endDate: group.endDate, dayStartHour: constants.DEFAULT_DAY_START_HOUR, dayEndHour: constants.DEFAULT_DAY_END_HOUR, dayStartMinutes: constants.DEFAULT_DAY_START_MINUTES, dayEndMinutes: constants.DEFAULT_DAY_END_MINUTES });
        state.schedules.unshift(schedule);
        createdSchedules += 1;
      } else {
        updatedSchedules += 1;
        if (rebuild) {
          schedule.placements = (schedule.placements || []).filter((item) => !item.importedFromReport);
        } else {
          schedule.placements = (schedule.placements || []).filter((placement) => {
            if (!placement?.importedFromReport) return true;
            const sameImportedKey = utils.normalizeText(placement?.importedFundraiserKey) === utils.normalizeText(group.key);
            const sameFile = groupFileKeys.has(utils.normalizeLookupKey(placement?.sourceName || ''));
            const inGroupRange = placement?.dateKey && group.startDate && group.endDate
              ? placement.dateKey >= group.startDate && placement.dateKey <= group.endDate
              : false;
            return !(sameImportedKey || (sameFile && inGroupRange));
          });
        }
      }
      const scheduleableRows = group.rows.filter((entry) => !entry?.isNonSpecific && entry?.sourceRow && entry?.dateKey && Number.isFinite(importedRowStartMinutes(entry.row)));
      const totals = summarizeImportedRows(group.rows);
      schedule.meta = {
        ...(schedule.meta || {}),
        importedFundraiserKey: group.key,
        importedFromReports: true,
        importedDriveStartDate: group.startDate,
        importedDriveEndDate: group.endDate,
        importedBroadcastTotalDollars: totals.importedBroadcastTotalDollars,
        importedProgramSpecificBroadcastTotalDollars: totals.importedProgramSpecificBroadcastTotalDollars,
        importedNonSpecificBroadcastTotalDollars: totals.importedNonSpecificBroadcastTotalDollars,
        importedPledgesTotal: totals.importedPledgesTotal,
        reportedBroadcastTotalDollars: totals.reportedBroadcastTotalDollars
      };
      if (!firstScheduleId) firstScheduleId = schedule.id;
      if (!dirtySchedules.includes(schedule)) dirtySchedules.push(schedule);
      const existingKeys = new Set((schedule.placements || []).map((placement) => placement.sourceAiringHash || `${placement.programId}|${placement.dateKey}|${placement.startMinutes}`));
      const existingSignatureMap = new Map((schedule.placements || []).filter((placement) => placement?.importedFromReport).map((placement, index) => [placementSignature(placement, group.key), index]));
      scheduleableRows.forEach((prepared) => {
        const placement = buildPlacementFromImportedAiring(prepared);
        if (!placement) return;
        const dedupeKey = placement.sourceAiringHash || `${placement.programId}|${placement.dateKey}|${placement.startMinutes}`;
        const signature = placementSignature(placement, group.key);
        if (existingKeys.has(dedupeKey)) { skippedPlacements += 1; return; }
        if (existingSignatureMap.has(signature)) {
          const existingIndex = existingSignatureMap.get(signature);
          const existingPlacement = schedule.placements[existingIndex];
          if (existingPlacement) {
            schedule.placements[existingIndex] = {
              ...existingPlacement,
              ...placement,
              id: existingPlacement.id || placement.id,
              transferredToStation: Boolean(existingPlacement.transferredToStation),
              importedBroadcastDollars: Number(placement.importedBroadcastDollars || 0) || 0,
              sourceAiringHash: placement.sourceAiringHash || existingPlacement.sourceAiringHash || ''
            };
            if (placement.sourceAiringHash) existingKeys.add(placement.sourceAiringHash);
            skippedPlacements += 1;
            return;
          }
        }
        schedule.placements.push(placement);
        existingKeys.add(dedupeKey);
        existingSignatureMap.set(signature, schedule.placements.length - 1);
        createdPlacements += 1;
        if (placement.durationCorrectedFromLibrary) correctedDurations += 1;
      });
    });

    if (activateFirst && firstScheduleId) {
      state.activeScheduleId = firstScheduleId;
      const active = getActiveSchedule();
      if (active) applyScheduleToView(active);
    }

    diagnostics.clusteredFundraisers = groups.length;
    return {
      schedulesCreated: createdSchedules,
      schedulesUpdated: updatedSchedules,
      placementsCreated: createdPlacements,
      placementsSkipped: skippedPlacements,
      skippedRows,
      correctedDurations,
      fundraiserCount: groups.length,
      diagnostics
    };
  }

  async function buildSchedulesFromImportedReports(options = {}) {
    if (!canScheduleEdit()) { setNotice('Sign in as admin to build fundraiser calendars from imported reports.', 'warn'); return null; }
    const rows = Array.isArray(options.rows) ? options.rows : await App.data.fetchImportedAirings();
    const dirtySchedules = [];
    const summary = mergeImportedRowsIntoSchedules(rows, { rebuild: Boolean(options.rebuild), activateFirst: options.activateFirst !== false, dirtySchedules });
    for (const schedule of dirtySchedules) {
      await persistSchedules(schedule);
    }
    renderAll();
    const noteBits = [
      `Imported reports built ${utils.formatCount(summary.placementsCreated)} scheduler entries across ${utils.formatCount(summary.fundraiserCount)} fundraisers.`,
      `${utils.formatCount(summary.placementsSkipped)} duplicates were skipped.`
    ];
    const diag = summary.diagnostics || {};
    if (summary.skippedRows) {
      noteBits.push(`${utils.formatCount(summary.skippedRows)} airings could not be placed automatically.`);
      const reasonBits = [];
      if (diag.noLibraryMatch) reasonBits.push(`${utils.formatCount(diag.noLibraryMatch)} without a library match`);
      if (diag.badDate) reasonBits.push(`${utils.formatCount(diag.badDate)} with a bad or missing air date`);
      if (diag.badTime) reasonBits.push(`${utils.formatCount(diag.badTime)} with a bad or missing air time`);
      if (reasonBits.length) noteBits.push(`Breakdown: ${reasonBits.join(', ')}.`);
    }
    if (diag.clusteredFundraisers) noteBits.push(`${utils.formatCount(diag.clusteredFundraisers)} fundraiser clusters were identified from actual airing dates.`);
    if (diag.collapsedDuplicateImports) noteBits.push(`${utils.formatCount(diag.collapsedDuplicateImports)} older imported duplicate row${diag.collapsedDuplicateImports === 1 ? '' : 's'} were collapsed before schedule build.`);
    if (summary.correctedDurations) noteBits.push(`${utils.formatCount(summary.correctedDurations)} durations were corrected from library runtimes.`);
    noteBits.push(state.scheduleSyncMessage);
    setNotice(noteBits.join(' '));
    if (summary.skippedRows && diag.droppedRows?.length) {
      const preview = diag.droppedRows.map((item) => ({
        title: item.title,
        air_date: item.airDate,
        air_time: item.airTime,
        reasons: item.reasons.join(', '),
        source_file: item.sourceFile
      }));
      console.table(preview);
      console.info('Build-from-import diagnostics', {
        inputRows: diag.inputRows,
        eligibleRows: diag.eligibleRows,
        noLibraryMatch: diag.noLibraryMatch,
        badDate: diag.badDate,
        badTime: diag.badTime,
        sampleDroppedRows: preview
      });
    }
    return summary;
  }

  function preferredVisibleEndMinutes(startMinutes, endMinutes) {
    const trimmed = Number(endMinutes) - 150;
    return Math.max(Number(startMinutes) + 240, trimmed);
  }

  function applyScheduleToView(schedule) {
    if (!schedule) return;
    state.activeScheduleId = schedule.id;
    const windowConfig = getScheduleWindow(schedule);
    const visibleEndMinutes = preferredVisibleEndMinutes(windowConfig.startMinutes, windowConfig.endMinutes);
    state.scheduleView.dayStartMinutes = windowConfig.startMinutes;
    state.scheduleView.dayEndMinutes = visibleEndMinutes;
    state.scheduleView.dayStartHour = Math.floor(windowConfig.startMinutes / 60);
    state.scheduleView.dayEndHour = Math.floor(visibleEndMinutes / 60);
    state.scheduleDraft.title = schedule.title || '';
    state.scheduleDraft.startDate = schedule.startDate || '';
    state.scheduleDraft.endDate = schedule.endDate || '';
    state.scheduleDraft.dayStartMinutes = windowConfig.startMinutes;
    state.scheduleDraft.dayEndMinutes = windowConfig.endMinutes;
    state.scheduleDraft.onlineDollars = Number(schedule.onlineDollars || 0) || 0;
    state.scheduleDraft.mailDollars = Number(schedule.mailDollars || 0) || 0;
    void ensureScheduleBroadcastTotal(schedule);
  }

  function visibleDateKeys(schedule) {
    return utils.datesBetween(schedule.startDate, schedule.endDate);
  }

  function allOccurrences(schedule) {
    return (schedule?.placements || []).slice().sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
      return Number(a.startMinutes || 0) - Number(b.startMinutes || 0);
    });
  }

  function annotatePlacements(schedule) {
    const counts = new Map();
    return allOccurrences(schedule).map((placement) => {
      const key = String(placement.programId || placement.programTitle || '');
      const prior = counts.get(key) || 0;
      counts.set(key, prior + 1);
      return { ...placement, isFirstRun: prior === 0, repeatIndex: prior + 1 };
    });
  }

  function findPlacementForSlot(schedule, slotKey) {
    const [dateKey, minutesRaw] = String(slotKey).split('|');
    const minutes = Number(minutesRaw || 0);
    return (schedule?.placements || []).find((placement) => (
      placement.dateKey === dateKey && minutes >= Number(placement.startMinutes) && minutes < Number(placement.endMinutes)
    )) || null;
  }

  function findPlacementById(schedule, placementId) {
    return (schedule?.placements || []).find((placement) => placement.id === placementId) || null;
  }

  function slotLabel(dateKey, minutes) {
    return `${formatScheduleDay(dateKey)} · ${utils.minutesToLabel(minutes)}`;
  }

  function scheduleRowLookupId(row = {}) {
    const direct = String(derive.programId(row) || '').trim();
    if (direct) return direct;
    const titleKey = utils.normalizeLookupKey(derive.title(row));
    const nolaKey = utils.normalizeLookupKey(derive.nola(row));
    if (!(titleKey || nolaKey)) return '';
    return `lookup:${titleKey}|${nolaKey}`;
  }

  function getProgramRowById(programId) {
    const key = String(programId || '').trim();
    return [...(state.rawRows || []), ...(state.nonPledgeRows || [])]
      .find((row) => String(derive.programId(row) || '').trim() === key || scheduleRowLookupId(row) === key) || null;
  }

  function isWeekendDateKey(dateKey) {
    const date = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(date.getTime())) return false;
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  function hasLiveBreakFlag(placement = {}) {
    if (placement?.liveBreakFlag === true) return true;
    if (placement?.liveBreakFlag === false) return false;
    return Boolean(utils.normalizeText(placement?.liveBreakNotes));
  }

  function liveBreakFlagLabel(placement = {}) {
    return hasLiveBreakFlag(placement) ? 'Live break flagged' : 'No live-break flag';
  }

  function timingLocalCutinSummary(timings = []) {
    if (!Array.isArray(timings) || !timings.length) return 'Local cut-ins: no break timings yet';
    const cutins = timings
      .map((row) => timingValue(row, ['local_cutin_seconds', 'local_cutin', 'local_cutin_length_seconds']))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!cutins.length) return 'Local cut-ins: none';
    return `Local cut-ins: ${cutins.length} total · ${cutins.map((value) => utils.formatSeconds(value)).join(', ')}`;
  }

  function timingExportSummary(timings = []) {
    if (!Array.isArray(timings) || !timings.length) return 'Break timings: none found';
    const summaries = timings
      .map((row) => timingRowSummary(row).join(' · '))
      .map((value) => utils.normalizeText(value))
      .filter(Boolean);
    if (summaries.length) {
      const preview = summaries.slice(0, 4).join(' | ');
      const suffix = summaries.length > 4 ? ` | +${summaries.length - 4} more` : '';
      return `Break timings: ${preview}${suffix}`;
    }
    return timingLocalCutinSummary(timings);
  }

  async function ensureScheduleExportDetails(rows = []) {
    const programIds = [...new Set((Array.isArray(rows) ? rows : [])
      .filter((item) => !item?.isNonPledge && item?.programId)
      .map((item) => String(item.programId || '').trim())
      .filter(Boolean))];
    if (!state.client || !programIds.length) return;
    await Promise.all(programIds.map(async (programId) => {
      const cache = state.scheduleDetailCache[programId];
      if (cache?.loaded || cache?.loading) return;
      state.scheduleDetailCache[programId] = { loading: true, loaded: false };
      try {
        const detail = await App.data.fetchProgramDetail(programId);
        state.scheduleDetailCache[programId] = { loading: false, loaded: true, detail };
      } catch (error) {
        state.scheduleDetailCache[programId] = { loading: false, loaded: true, error };
      }
    }));
  }

  function lengthMetaLabel(row = {}) {
    const runtimeMinutes = derive.runtimeMinutes(row);
    const runtimeClock = derive.actualRuntimeLabel(row);
    if (runtimeMinutes && runtimeClock !== '—') return `${runtimeMinutes} min · ${runtimeClock}`;
    if (runtimeMinutes) return `${runtimeMinutes} min`;
    if (runtimeClock !== '—') return runtimeClock;
    return 'Length unknown';
  }

  function ensureNonPledgeRowsLoaded() {
    if (!state.scheduleNonPledgeMode) return;
    if (state.nonPledgeLoadState === 'ready' || state.nonPledgeLoadState === 'loading') return;
    App.data.refreshNonPledgeRows().then(() => {
      if (!els.scheduleProgramModal?.classList.contains('hidden')) renderProgramPicker();
    }).catch((error) => {
      console.warn('Non-pledge library load failed.', error);
      if (!els.scheduleProgramModal?.classList.contains('hidden')) {
        showScheduleModalWarning(`Program Library read warning: ${error.message || error}`, 'warn');
        renderProgramPicker();
      }
    });
  }

  function canScheduleEdit() {
    return Boolean(App.auth?.canEdit?.());
  }

  function hasScheduleClipboard() {
    return Boolean(state.scheduleClipboard?.programId);
  }

  function copyPlacementToClipboard(placement) {
    if (!placement) return false;
    state.scheduleClipboard = {
      programId: placement.programId,
      programTitle: placement.programTitle,
      lengthMinutes: placement.lengthMinutes,
      liveBreakFlag: hasLiveBreakFlag(placement),
      isNonPledge: Boolean(placement.isNonPledge),
      sourceName: placement.sourceName || '',
      sourceLabel: placement.sourceLabel || '',
      liveBreakNotes: placement.liveBreakNotes || ''
    };
    return true;
  }

  function showScheduleModalWarning(text = '', type = 'warn') {
    state.scheduleModalWarning = { text, type };
    if (!els.scheduleModalWarning) return;
    if (!text) {
      els.scheduleModalWarning.className = 'notice-strip hidden';
      els.scheduleModalWarning.textContent = '';
      return;
    }
    els.scheduleModalWarning.textContent = text;
    els.scheduleModalWarning.className = 'notice-strip schedule-modal-warning';
    if (type) els.scheduleModalWarning.classList.add(type);
  }

  function scheduleSearchMinChars() {
    return 1;
  }

  function scheduleSlotYear(dateKey = '') {
    const raw = utils.normalizeText(dateKey);
    const match = raw.match(/^(\d{4})-/);
    return match ? Number(match[1]) : null;
  }

  function addAiringHistoryKey(map, key, dateValue) {
    const normalizedKey = utils.normalizeLookupKey(key);
    const normalizedDate = utils.normalizeText(dateValue);
    if (!normalizedKey || !normalizedDate) return;
    if (!map[normalizedKey]) map[normalizedKey] = new Set();
    map[normalizedKey].add(normalizedDate);
  }

  function buildScheduleAiringHistoryMap(rows = []) {
    const map = {};
    (rows || []).forEach((row) => {
      const dateValue = utils.normalizeText(row.air_date) || utils.dateKeyFromDate(row.aired_at) || '';
      addAiringHistoryKey(map, row.program_id || row.pledge_program_id, dateValue);
      addAiringHistoryKey(map, row.nola_code, dateValue);
      addAiringHistoryKey(map, row.program_title || row.title || row.imported_program_title || row.matched_library_title, dateValue);
    });
    return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, [...value].sort().reverse()]));
  }

  async function ensureScheduleAiringHistoryLoaded() {
    if (state.scheduleAiringHistoryLoading || state.scheduleAiringHistoryLoaded) return;
    state.scheduleAiringHistoryLoading = true;
    try {
      const rows = state.imports?.airingsRows?.length ? state.imports.airingsRows : await App.data.fetchImportedAirings();
      state.scheduleAiringHistoryMap = buildScheduleAiringHistoryMap(rows || []);
      state.scheduleAiringHistoryLoaded = true;
    } catch (error) {
      console.warn('Could not load scheduler airing history.', error);
      state.scheduleAiringHistoryMap = {};
      state.scheduleAiringHistoryLoaded = true;
    } finally {
      state.scheduleAiringHistoryLoading = false;
      if (!els.scheduleProgramModal?.classList.contains('hidden')) renderProgramPicker();
    }
  }

  function airDatesForScheduleRow(row = {}) {
    const map = state.scheduleAiringHistoryMap || {};
    const values = [];
    [derive.programId(row), derive.nola(row), derive.title(row)]
      .map((value) => utils.normalizeLookupKey(value))
      .filter(Boolean)
      .forEach((key) => {
        const bucket = Array.isArray(map[key]) ? map[key] : [];
        bucket.forEach((date) => { if (!values.includes(date)) values.push(date); });
      });
    return values.sort().reverse();
  }

  function airDatesSummaryForScheduleRow(row = {}) {
    const dates = airDatesForScheduleRow(row);
    if (!dates.length) return state.scheduleAiringHistoryLoading ? 'Air dates: loading…' : 'Air dates: none known yet';
    const visible = dates.slice(0, 4).map((value) => utils.formatDate(value, value));
    const remainder = dates.length > visible.length ? ` +${dates.length - visible.length} more` : '';
    return `Air dates: ${visible.join(', ')}${remainder}`;
  }

  function scheduleEntryHasAired(row) {
    return filters.rowHasAired(row);
  }

  function scheduleEntryPassesExtraFilters(row, slotDateKey, usingNonPledge = false) {
    if (!row) return false;
    const targetYear = scheduleSlotYear(slotDateKey) || scheduleSlotYear(getActiveSchedule()?.startDate || '') || new Date().getFullYear();
    return filters.rowMatchesScheduleFilters(row, {
      unairedOnly: !usingNonPledge && state.scheduleFilterUnaired,
      rightsStartYear: state.scheduleFilterRightsStartYear ? targetYear : null,
      topEarner: !usingNonPledge && state.scheduleFilterTopEarner,
      topEarnerThreshold: 500
    });
  }

  function scheduleLookupEntries(usingNonPledge = false) {
    const sourceRows = usingNonPledge ? (state.nonPledgeRows || []) : (state.rawRows || []);
    const collapsedRows = filters.collapseRows(sourceRows || [], { statusPreference: usingNonPledge ? 'all' : 'active' });
    const seen = new Set();
    return (collapsedRows || [])
      .filter((row) => usingNonPledge || derive.isActive(row))
      .map((row, index) => {
        const title = utils.normalizeText(derive.title(row));
        const nola = utils.normalizeText(derive.nola(row));
        const topic = utils.normalizeText(derive.topicPrimary(row));
        const titleKey = utils.normalizeLookupKey(title);
        const nolaKey = utils.normalizeLookupKey(nola);
        const topicKey = utils.normalizeLookupKey(topic);
        const programId = scheduleRowLookupId(row);
        const dedupeKey = programId || `${titleKey}|${nolaKey}|${topicKey}|${index}`;
        return {
          row,
          title,
          nola,
          topic,
          titleKey,
          nolaKey,
          topicKey,
          dedupeKey
        };
      })
      .filter((entry) => entry.titleKey || entry.nolaKey)
      .filter((entry) => {
        if (seen.has(entry.dedupeKey)) return false;
        seen.add(entry.dedupeKey);
        return true;
      });
  }

  function populateScheduleTopicSelect() {
    if (!els.scheduleProgramTopicSelect) return;
    const values = filters.canonicalOptionEntries(scheduleLookupEntries(Boolean(state.scheduleNonPledgeMode)).map((entry) => entry.topic).filter(Boolean));
    els.scheduleProgramTopicSelect.innerHTML = ['<option value="">All topics</option>', ...values.map((value) => `<option value="${utils.escapeHtml(value.value)}">${utils.escapeHtml(value.label)}</option>`)].join('');
    els.scheduleProgramTopicSelect.value = state.scheduleProgramTopicFilter || '';
  }

  function scheduleProgramMatches(query, topicFilter, slotDateKey) {
    const text = utils.normalizeLookupKey(query || '');
    const searchTokens = text ? text.split(/\s+/).filter(Boolean) : [];
    const topicKey = utils.normalizeLookupKey(topicFilter || '');
    const hasTopic = Boolean(topicKey);
    const hasSearch = searchTokens.length > 0 && text.length >= scheduleSearchMinChars();
    const usingNonPledge = Boolean(state.scheduleNonPledgeMode);
    const hasExtraFilters = Boolean(state.scheduleFilterUnaired || state.scheduleFilterRightsStartYear || state.scheduleFilterTopEarner);
    if (!hasTopic && !hasSearch && !hasExtraFilters) return [];
    return scheduleLookupEntries(usingNonPledge)
      .filter((entry) => {
        if (!hasTopic) return true;
        return entry.topicKey === topicKey;
      })
      .filter((entry) => {
        if (!hasSearch) return true;
        const haystack = `${entry.titleKey} ${entry.nolaKey}`.trim();
        return searchTokens.every((token) => haystack.includes(token));
      })
      .filter((entry) => scheduleEntryPassesExtraFilters(entry.row, slotDateKey, usingNonPledge))
      .map((entry) => ({ row: entry.row, rights: rightsCheckForDate(entry.row, slotDateKey), isNonPledge: usingNonPledge }))
      .sort((a, b) => {
        if (a.rights.ok !== b.rights.ok) return a.rights.ok ? -1 : 1;
        return utils.compareText(derive.title(a.row), derive.title(b.row));
      })
      .slice(0, hasTopic ? 120 : 60);
  }

  function ensureScheduleModalState(slot) {
    state.selectedScheduleSlot = slot;
    state.scheduleProgramQuery = '';
    state.scheduleProgramTopicFilter = '';
    state.scheduleFilterUnaired = false;
    state.scheduleFilterRightsStartYear = false;
    state.scheduleFilterTopEarner = false;
    showScheduleModalWarning('', '');
    const schedule = getActiveSchedule();
    const placement = slot && schedule ? findPlacementForSlot(schedule, slot.key) : null;
    state.selectedScheduleProgram = placement ? placement.programId : null;
    state.scheduleNonPledgeMode = Boolean(placement?.isNonPledge);
  }

  function openScheduleModal(slot) {
    ensureScheduleModalState(slot);
    renderProgramPicker();
    els.scheduleProgramModal?.classList.remove('hidden');
    els.scheduleProgramBackdrop?.classList.remove('hidden');
    document.body.classList.add('modal-open');
    window.setTimeout(() => { if (els.scheduleProgramSearch && !els.scheduleProgramSearch.disabled) { els.scheduleProgramSearch.focus(); els.scheduleProgramSearch.select?.(); } }, 0);
  }

  function closeScheduleModal() {
    els.scheduleProgramModal?.classList.add('hidden');
    els.scheduleProgramBackdrop?.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  function renderScheduleList() {
    const orderedSchedules = sortSchedulesNewestFirst(state.schedules || []);
    const selected = state.activeScheduleId || '';
    const scheduleOptionsHtml = ['<option value="">Select fundraiser…</option>'].concat(orderedSchedules.map((schedule) => {
      const spanInfo = getScheduleDateSpanInfo(schedule);
      const placementCount = Array.isArray(schedule.placements) ? schedule.placements.length : 0;
      const totalRaised = scheduleGrandTotal(schedule);
      const selectedAttr = schedule.id === selected ? ' selected' : '';
      const invalidSuffix = spanInfo.ok ? '' : ' · INVALID DATE RANGE';
      return `<option value="${utils.escapeHtml(schedule.id)}"${selectedAttr}>${utils.escapeHtml(`${schedule.title} · ${utils.formatDate(schedule.startDate)} – ${utils.formatDate(schedule.endDate)} · ${placementCount} blocks · ${utils.formatMoney(totalRaised)}${invalidSuffix}`)}</option>`;
    })).join('');
    if (els.scheduleDesktopSelect) {
      els.scheduleDesktopSelect.innerHTML = scheduleOptionsHtml;
      els.scheduleDesktopSelect.value = selected;
    }
    if (els.scheduleMobileSelect) {
      els.scheduleMobileSelect.innerHTML = scheduleOptionsHtml;
      els.scheduleMobileSelect.value = selected;
    }
    if (!els.scheduleList) {
      if (els.scheduleSummary) els.scheduleSummary.textContent = state.scheduleSyncMessage || (orderedSchedules.length ? `${orderedSchedules.length} fundraiser calendars ready.` : '0 fundraiser calendars yet.');
      if (els.scheduleMobileSummary) els.scheduleMobileSummary.textContent = state.scheduleSyncMessage || (orderedSchedules.length ? `${orderedSchedules.length} fundraiser calendars ready.` : '0 fundraiser calendars yet.');
      return;
    }
    if (!orderedSchedules.length) {
      els.scheduleList.innerHTML = '<div class="schedule-list-empty">No fundraiser calendars yet. Build one below.</div>';
      if (els.scheduleSummary) els.scheduleSummary.textContent = state.scheduleSyncMessage || '0 fundraiser calendars yet.';
      if (els.scheduleMobileSummary) els.scheduleMobileSummary.textContent = state.scheduleSyncMessage || '0 fundraiser calendars yet.';
      return;
    }
    els.scheduleList.innerHTML = orderedSchedules.map((schedule) => {
      const spanInfo = getScheduleDateSpanInfo(schedule);
      const active = schedule.id === state.activeScheduleId;
      const placementCount = Array.isArray(schedule.placements) ? schedule.placements.length : 0;
      const totalRaised = scheduleGrandTotal(schedule);
      return `
        <div class="schedule-list-item ${active ? 'active' : ''}${spanInfo.ok ? '' : ' invalid'}">
          <button type="button" class="schedule-list-open" data-schedule-id="${utils.escapeHtml(schedule.id)}" ${spanInfo.ok ? '' : 'data-invalid-schedule="true"'}>
            <span class="schedule-list-title">${utils.escapeHtml(schedule.title)}</span>
            <span class="schedule-list-meta">${utils.escapeHtml(utils.formatDate(schedule.startDate))} – ${utils.escapeHtml(utils.formatDate(schedule.endDate))} · ${placementCount} blocks · ${utils.escapeHtml(utils.formatMoney(totalRaised))}${spanInfo.ok ? '' : ' · INVALID DATE RANGE'}</span>
          </button>
          ${canScheduleEdit() ? `<button type="button" class="ghost tiny-button" data-delete-schedule-id="${utils.escapeHtml(schedule.id)}">Remove</button>` : ''}
        </div>
      `;
    }).join('');
    if (els.scheduleSummary) els.scheduleSummary.textContent = state.scheduleSyncMessage || `${orderedSchedules.length} fundraiser calendars ready.`;
    if (els.scheduleMobileSummary) els.scheduleMobileSummary.textContent = state.scheduleSyncMessage || `${orderedSchedules.length} fundraiser calendars ready.`;
  }

  function activateScheduleById(scheduleId, { focusCalendar = false } = {}) {
    const nextSchedule = state.schedules.find((item) => item.id === scheduleId) || null;
    if (!nextSchedule) return false;
    state.activeScheduleId = nextSchedule.id;
    const spanInfo = getScheduleDateSpanInfo(nextSchedule);
    if (spanInfo.ok) applyScheduleToView(nextSchedule);
    if (focusCalendar) {
      const schedulingPane = document.querySelector('[data-workspace-pane="scheduling"]');
      if (schedulingPane) schedulingPane.dataset.mobileMode = 'calendar';
    }
    renderAll();
    App.app?.ensureMobileModeControls?.();
    if (!spanInfo.ok) setNotice(spanInfo.reason, 'warn');
    return spanInfo.ok;
  }

  function resetToNewScheduleDraft() {
    state.activeScheduleId = '';
    state.selectedScheduleSlot = null;
    state.selectedScheduleProgram = null;
    state.scheduleDraft = {
      title: '',
      startDate: '',
      endDate: '',
      dayStartHour: constants.DEFAULT_DAY_START_HOUR,
      dayEndHour: constants.DEFAULT_DAY_END_HOUR,
      dayStartMinutes: constants.DEFAULT_DAY_START_MINUTES,
      dayEndMinutes: constants.DEFAULT_DAY_END_MINUTES,
      onlineDollars: 0,
      mailDollars: 0
    };
    state.scheduleView.dayStartMinutes = constants.DEFAULT_DAY_START_MINUTES;
    state.scheduleView.dayEndMinutes = preferredVisibleEndMinutes(constants.DEFAULT_DAY_START_MINUTES, constants.DEFAULT_DAY_END_MINUTES);
    state.scheduleView.dayStartHour = constants.DEFAULT_DAY_START_HOUR;
    state.scheduleView.dayEndHour = Math.floor(state.scheduleView.dayEndMinutes / 60);
    renderAll();
    App.app?.ensureMobileModeControls?.();
    els.fundraiserTitleInput?.focus();
  }

  function renderScheduleForm() {
    if (!els.scheduleForm) return;
    const editable = canScheduleEdit();
    els.fundraiserTitleInput.value = state.scheduleDraft.title || '';
    els.fundraiserStartInput.value = state.scheduleDraft.startDate || '';
    els.fundraiserEndInput.value = state.scheduleDraft.endDate || '';
    if (els.fundraiserOnlineInput) els.fundraiserOnlineInput.value = Number(state.scheduleDraft.onlineDollars || 0) || 0;
    if (els.fundraiserMailInput) els.fundraiserMailInput.value = Number(state.scheduleDraft.mailDollars || 0) || 0;
    const schedule = getActiveSchedule();
    const working = schedule || state.scheduleDraft || {};
    const broadcast = scheduleBroadcastTotal(working);
    const imported = scheduleImportedAiringTotal(working);
    const importedProgramSpecific = scheduleImportedProgramSpecificTotal(working);
    const importedNonSpecific = scheduleImportedNonSpecificTotal(working);
    const diff = scheduleBroadcastDifference(working);
    const importedPledges = scheduleImportedPledgesTotal(working);
    if (els.fundraiserBroadcastTotal) els.fundraiserBroadcastTotal.value = utils.formatMoney(broadcast);
    if (els.fundraiserPledgesTotal) els.fundraiserPledgesTotal.value = utils.formatCount(importedPledges);
    if (els.fundraiserImportTotal) els.fundraiserImportTotal.value = utils.formatMoney(imported);
    if (els.fundraiserImportDifference) els.fundraiserImportDifference.value = utils.formatMoney(diff);
    if (els.fundraiserNonSpecificTotal) els.fundraiserNonSpecificTotal.value = utils.formatMoney(importedNonSpecific);
    if (els.fundraiserGrandTotal) els.fundraiserGrandTotal.value = utils.formatMoney(scheduleGrandTotal(working));
    if (els.fundraiserBroadcastDiagnostic) {
      const show = imported > 0;
      const mismatch = show && Math.abs(diff) >= 0.01;
      els.fundraiserBroadcastDiagnostic.classList.toggle('hidden', !show);
      els.fundraiserBroadcastDiagnostic.innerHTML = show
        ? `${imported > 0 ? `<span class="diag-chip">Import total ${utils.escapeHtml(utils.formatMoney(imported))}</span>` : ''}${importedProgramSpecific > 0 ? `<span class="diag-chip">Program-specific ${utils.escapeHtml(utils.formatMoney(importedProgramSpecific))}</span>` : ''}${importedNonSpecific > 0 ? `<span class="diag-chip">Non-specific ${utils.escapeHtml(utils.formatMoney(importedNonSpecific))}</span>` : ''}${importedPledges > 0 ? `<span class="diag-chip">Pledges ${utils.escapeHtml(utils.formatCount(importedPledges))}</span>` : ''}${mismatch ? `<span class="diag-chip warn">Difference ${utils.escapeHtml(utils.formatMoney(diff))}</span>` : ''}`
        : '';
    }
    const builderTitle = document.getElementById('schedule-builder-title');
    if (builderTitle) builderTitle.textContent = working.title || state.scheduleDraft.title || 'New fundraiser';
    [els.fundraiserTitleInput, els.fundraiserStartInput, els.fundraiserEndInput, els.fundraiserOnlineInput, els.fundraiserMailInput, els.scheduleGenerateButton].forEach((el) => { if (el) el.disabled = !editable; });
    if (els.newScheduleButton) els.newScheduleButton.classList.toggle('hidden', !editable);
  }

  function placementHeight(lengthMinutes, slotHeight) {
    const slots = Math.max(1, Math.ceil((Number(lengthMinutes) || 30) / constants.DEFAULT_SLOT_MINUTES));
    const px = Math.max(2, (slots * slotHeight) - 2);
    return `${px}px`;
  }

  function rightsCheckForDate(row, dateKey) {
    const start = derive.rightsBegin(row);
    const end = derive.rightsEnd(row);
    if (!dateKey) return { ok: true, reason: '' };
    if (start && `${dateKey}` < `${start}`) {
      return { ok: false, reason: `Rights begin ${utils.formatDate(start)}. Cannot schedule on ${utils.formatDate(dateKey)}.` };
    }
    if (end && `${dateKey}` > `${end}`) {
      return { ok: false, reason: `Rights expired ${utils.formatDate(end)}. Cannot schedule on ${utils.formatDate(dateKey)}.` };
    }
    return { ok: true, reason: '' };
  }

  function timingValue(row, keys = []) {
    for (const key of keys) {
      const value = row?.[key];
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
      if (value === 0) return 0;
    }
    return null;
  }

  function timingRowSummary(row = {}) {
    const segment = Number(utils.firstNonEmpty(row.segment_number, row.slot_number));
    const actLabel = Number.isFinite(segment) && segment > 0 ? `Act ${segment}` : 'Act';
    const actSeconds = timingValue(row, ['program_segment_length_seconds', 'segment_seconds', 'act_seconds']);
    const breakSeconds = timingValue(row, ['pledge_break_seconds', 'break_length_seconds', 'break_seconds']);
    const localCutinSeconds = timingValue(row, ['local_cutin_seconds', 'local_cutin', 'local_cutin_length_seconds']);
    const parts = [actLabel];
    if (Number.isFinite(actSeconds)) parts.push(`Program ${utils.formatSeconds(actSeconds)}`);
    if (Number.isFinite(breakSeconds)) parts.push(`Break ${utils.formatSeconds(breakSeconds)}`);
    if (Number.isFinite(localCutinSeconds) && localCutinSeconds > 0) parts.push(`Local Cut In ${utils.formatSeconds(localCutinSeconds)}`);
    const note = utils.normalizeText(row.notes || row.description || row.segment_title || row.segment_name);
    if (note) parts.push(note);
    return parts;
  }

  function premiumLines(value) {
    const text = utils.normalizeText(value);
    if (!text) return ['—'];
    const lines = text
      .replace(/\r/g, '')
      .replace(/\s*;\s*/g, '\n')
      .replace(/\s+(?=\$)/g, '\n')
      .split(/\n+/)
      .map((part) => utils.normalizeText(part))
      .filter(Boolean);
    return lines.length ? lines : [text];
  }

  function premiumLinesHtml(value) {
    return `<div class="scheduled-premium-lines">${premiumLines(value).map((line) => `<div class="scheduled-premium-line">${utils.escapeHtml(line)}</div>`).join('')}</div>`;
  }

  function renderScheduleGrid() {
    const schedule = getActiveSchedule();
    if (!schedule) {
      els.scheduleEmpty.classList.remove('hidden');
      els.scheduleEditor.classList.add('hidden');
      els.scheduleProgramDetails.innerHTML = '<div class="schedule-hint">Scheduled program details will appear here once you start assigning titles.</div>';
      return;
    }
    const spanInfo = getScheduleDateSpanInfo(schedule);
    if (!spanInfo.ok) {
      els.scheduleEmpty.classList.remove('hidden');
      els.scheduleEditor.classList.add('hidden');
      if (els.scheduleEmpty) {
        const invalidDeleteHtml = canScheduleEdit()
          ? `<div class="schedule-invalid-actions"><button type="button" class="ghost" data-delete-invalid-schedule-id="${utils.escapeHtml(schedule.id)}">Remove this fundraiser</button></div>`
          : '<div class="schedule-hint">Sign in with edit access to remove this fundraiser.</div>';
        els.scheduleEmpty.innerHTML = `<div class="schedule-empty-title">This fundraiser cannot be opened safely.</div><div class="schedule-hint">${utils.escapeHtml(spanInfo.reason)}</div>${invalidDeleteHtml}`;
      }
      els.scheduleProgramDetails.innerHTML = '<div class="schedule-hint">Invalid fundraiser date range. Remove or repair this fundraiser before rendering the calendar.</div>';
      return;
    }

    els.scheduleEmpty.classList.add('hidden');
    els.scheduleEditor.classList.remove('hidden');

    const dayKeys = visibleDateKeys(schedule);
    const windowConfig = getScheduleWindow(state.scheduleView);
    const visibleStartMin = windowConfig.startMinutes;
    const visibleEndMin = windowConfig.endMinutes;
    const times = [];
    for (let minutes = visibleStartMin; minutes < visibleEndMin; minutes += constants.DEFAULT_SLOT_MINUTES) times.push(minutes);
    const placements = annotatePlacements(schedule).map((placement) => toDisplayPlacement(placement, visibleStartMin));
    const placementByDisplaySlot = new Map();
    const placementStartByDisplaySlot = new Map();
    placements.forEach((placement) => {
      const startKey = `${placement.displayDateKey}|${placement.displayStartMinutes}`;
      placementStartByDisplaySlot.set(startKey, placement);
      for (let minutes = Number(placement.displayStartMinutes); minutes < Number(placement.displayEndMinutes); minutes += constants.DEFAULT_SLOT_MINUTES) {
        placementByDisplaySlot.set(`${placement.displayDateKey}|${minutes}`, placement);
      }
    });

    const zoom = Math.min(2.8, Math.max(0.12, Number(state.scheduleView.zoom || 1)));
    const editable = canScheduleEdit();
    const columnWidth = Math.max(72, Math.round(126 * Math.min(1.28, 0.54 + (zoom * 0.40))));
    const timeColumnWidth = 96;
    const slotHeight = Math.max(6, Math.round(24 * zoom));
    const timeFontPx = zoom < 0.2 ? 8 : zoom < 0.34 ? 9 : zoom < 0.55 ? 10 : 11;
    const compactTimeLabels = zoom < 0.45;
    const ultraCompactTimeLabels = zoom < 0.22;
    const gridTemplate = `${timeColumnWidth}px repeat(${dayKeys.length}, ${columnWidth}px)`;
    const gridWidth = timeColumnWidth + (dayKeys.length * columnWidth);
    els.scheduleGrid.style.setProperty('--schedule-day-width', `${columnWidth}px`);
    els.scheduleGrid.style.setProperty('--schedule-slot-height', `${slotHeight}px`);
    els.scheduleGrid.style.setProperty('--schedule-time-font-size', `${timeFontPx}px`);
    els.scheduleGrid.style.setProperty('--schedule-time-width', `${timeColumnWidth}px`);
    els.scheduleWindowLabel.textContent = `${utils.minutesToLabel(visibleStartMin)} – ${utils.minutesToLabel(visibleEndMin - constants.DEFAULT_SLOT_MINUTES)}`;
    if (els.scheduleZoomValue) els.scheduleZoomValue.textContent = `${Math.round(zoom * 100)}%`;

    const header = ['<div class="schedule-corner sticky"></div>'];
    dayKeys.forEach((dateKey) => {
      header.push(`<div class="schedule-day-head sticky ${isWeekendDateKey(dateKey) ? 'weekend' : ''}"><span>${utils.escapeHtml(formatScheduleDay(dateKey))}</span></div>`);
    });

    const guideMinutes = new Set([420, 1200, 1440]);
    const body = [];
    times.forEach((minutes) => {
      const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;
      const showTimeLabel = !compactTimeLabels || (ultraCompactTimeLabels ? (normalizedMinutes % 120 === 0) : (normalizedMinutes % 60 === 0));
      const guideClass = guideMinutes.has(minutes) || guideMinutes.has(normalizedMinutes) ? ' guide-line-red' : '';
      body.push(`<div class="schedule-time-label ${showTimeLabel ? '' : 'quiet'}${guideClass}"><span>${showTimeLabel ? utils.escapeHtml(utils.minutesToLabel(minutes)) : ''}</span></div>`);
      dayKeys.forEach((displayDateKey) => {
        const actualDateKey = minutes >= 1440 ? utils.plusDays(displayDateKey, 1) : displayDateKey;
        const actualMinutes = minutes >= 1440 ? minutes - 1440 : minutes;
        const slotKey = `${actualDateKey}|${actualMinutes}`;
        const displaySlotKey = `${displayDateKey}|${minutes}`;
        const placement = placementByDisplaySlot.get(displaySlotKey) || null;
        const isStart = placementStartByDisplaySlot.has(displaySlotKey);
        const style = isStart ? `height:${placementHeight(placement.lengthMinutes, slotHeight)};` : '';
        const klass = [placement ? (placement.isFirstRun ? 'first-run' : 'repeat-run') : '', placement?.isNonPledge ? 'non-pledge' : '', hasLiveBreakFlag(placement) ? 'live-break' : ''].filter(Boolean).join(' ');
        const subtitleBits = [];
        if (placement) {
          subtitleBits.push(`${utils.escapeHtml(String(placement.lengthMinutes))} min`);
          if (placement.isNonPledge) subtitleBits.push('non-pledge');
          if (hasLiveBreakFlag(placement)) subtitleBits.push('live break');
        }
        body.push(`
          <button type="button" class="schedule-slot ${isWeekendDateKey(displayDateKey) ? 'weekend' : ''}${guideClass} ${state.selectedScheduleSlot?.key === slotKey ? 'selected' : ''} ${editable ? '' : 'viewer-only'}" data-slot-key="${utils.escapeHtml(slotKey)}" data-date-key="${utils.escapeHtml(actualDateKey)}" data-display-date-key="${utils.escapeHtml(displayDateKey)}" data-minutes="${actualMinutes}">
            ${isStart ? `<span title="${utils.escapeHtml(placement.programTitle)}" draggable="${editable ? 'true' : 'false'}" class="schedule-placement ${klass} ${editable ? '' : 'locked'}" data-placement-id="${utils.escapeHtml(placement.id)}" data-date-key="${utils.escapeHtml(placement.dateKey)}" data-minutes="${placement.startMinutes}" style="${style}">${renderProgramTitleLink(placement.isNonPledge ? '' : placement.programId, placement.programTitle, { nested: true, className: 'schedule-placement-title-link', titleAttr: placement.programTitle })}<span>${subtitleBits.join(' · ')}</span></span>` : ''}
          </button>
        `);
      });
    });

    const guideOverlays = [420, 1200, 1440]
      .filter((minutes) => minutes >= visibleStartMin && minutes < visibleEndMin)
      .map((minutes) => `<div class="schedule-guide-overlay" style="top:${((minutes - visibleStartMin) / constants.DEFAULT_SLOT_MINUTES) * slotHeight}px"></div>`)
      .join('');

    els.scheduleGrid.innerHTML = `
      <div class="schedule-grid-head" style="grid-template-columns:${gridTemplate}; width:${gridWidth}px; min-width:${gridWidth}px;">${header.join('')}</div>
      <div class="schedule-grid-body" style="grid-template-columns:${gridTemplate}; width:${gridWidth}px; min-width:${gridWidth}px;">${body.join('')}${guideOverlays}</div>
    `;
    renderScheduledProgramDetails();
  }

  function timingSummaryHtml(cacheEntry) {
    const timings = cacheEntry?.timings || [];
    if (!timings.length) return '<div class="scheduled-program-note">Detailed break information not loaded yet.</div>';
    return `<div class="scheduled-break-inline">${timings.slice(0, 12).map((row) => `<div class="scheduled-break-chip">${utils.escapeHtml(timingRowSummary(row).join(' · ') || 'Timing row')}</div>`).join('')}</div>`;
  }

  function scheduleScheduledProgramDetailsRerender() {
    window.clearTimeout(scheduledDetailRerenderTimer);
    scheduledDetailRerenderTimer = window.setTimeout(() => {
      scheduledDetailRerenderTimer = 0;
      renderScheduledProgramDetails();
    }, 60);
  }

  async function pumpScheduledDetailQueue() {
    if (scheduledDetailPumpActive || !scheduledDetailQueue.size) return;
    scheduledDetailPumpActive = true;
    try {
      while (scheduledDetailQueue.size) {
        const batch = [...scheduledDetailQueue].slice(0, 2);
        batch.forEach((programId) => scheduledDetailQueue.delete(programId));
        await Promise.all(batch.map(async (programId) => {
          try {
            const detail = await App.data.fetchProgramDetail(programId);
            state.scheduleDetailCache[programId] = { loading: false, loaded: true, detail };
          } catch (error) {
            state.scheduleDetailCache[programId] = { loading: false, loaded: true, error };
          }
        }));
        scheduleScheduledProgramDetailsRerender();
      }
    } finally {
      scheduledDetailPumpActive = false;
    }
  }

  function loadScheduledDetail(programId) {
    if (!programId || state.scheduleDetailCache[programId]?.loaded || state.scheduleDetailCache[programId]?.loading || !state.client) return;
    state.scheduleDetailCache[programId] = { loading: true, loaded: false };
    scheduledDetailQueue.add(programId);
    void pumpScheduledDetailQueue();
  }

  function renderScheduledProgramDetails() {
    const schedule = getActiveSchedule();
    if (schedule) void ensureScheduleBroadcastTotal(schedule);
    const fundraiserSummaryHtml = (() => {
      if (!schedule) return '';
      const broadcast = scheduleBroadcastTotal(schedule);
      const imported = scheduleImportedAiringTotal(schedule);
      const importedProgramSpecific = scheduleImportedProgramSpecificTotal(schedule);
      const importedNonSpecific = scheduleImportedNonSpecificTotal(schedule);
      const diff = Math.round(((broadcast || 0) - (imported || 0)) * 100) / 100;
      const mismatch = broadcast > 0 && imported > 0 && Math.abs(diff) >= 0.01;
      const extra = `${imported > 0 ? `<div class="scheduled-data-chunk"><span class="mini-label inline">Imported total</span><span>${utils.escapeHtml(utils.formatMoney(imported))}</span></div>` : ''}${importedProgramSpecific > 0 ? `<div class="scheduled-data-chunk"><span class="mini-label inline">Program-specific</span><span>${utils.escapeHtml(utils.formatMoney(importedProgramSpecific))}</span></div>` : ''}${importedNonSpecific > 0 ? `<div class="scheduled-data-chunk"><span class="mini-label inline">Non-specific</span><span>${utils.escapeHtml(utils.formatMoney(importedNonSpecific))}</span></div>` : ''}${mismatch ? `<div class="scheduled-data-chunk"><span class="mini-label inline">Difference</span><span>${utils.escapeHtml(utils.formatMoney(diff))}</span></div>` : ''}`;
      return extra ? `<div class="schedule-fundraiser-summary schedule-fundraiser-summary-compact">${extra}</div>` : '';
    })();
    if (!schedule || !schedule.placements?.length) {
      els.scheduleProgramDetails.innerHTML = fundraiserSummaryHtml || '<div class="schedule-hint">Scheduled program details will appear here once you start assigning titles.</div>';
      return;
    }
    const pledgePlacements = annotatePlacements(schedule).filter((placement) => !placement.isNonPledge);
    if (!pledgePlacements.length) {
      els.scheduleProgramDetails.innerHTML = `${fundraiserSummaryHtml}<div class="schedule-hint">Only non-pledge markers are on this calendar right now. They stay on the calendar, but they do not appear in the pledge detail list below.</div>`;
      return;
    }
    const grouped = new Map();
    pledgePlacements.forEach((placement) => {
      const key = String(placement.programId || placement.programTitle || placement.id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(placement);
    });
    const groupedEntries = [...grouped.entries()];
    const autoLoadLimit = groupedEntries.length > 12 ? 6 : 12;

    els.scheduleProgramDetails.innerHTML = fundraiserSummaryHtml + groupedEntries.map(([programId, occurrences], entryIndex) => {
      const row = getProgramRowById(programId) || {};
      if (entryIndex < autoLoadLimit) loadScheduledDetail(programId);
      const cache = state.scheduleDetailCache[programId];
      const runtimeLabel = derive.actualRuntimeLabel(row) !== '—' ? derive.actualRuntimeLabel(row) : `${occurrences[0]?.lengthMinutes || '—'} min`;
      const metaBits = [runtimeLabel, derive.nola(row) || 'No NOLA', derive.topicPrimary(row) || 'No topic'];
      const avgPerFundraiser = Number(derive.avgPerFundraiser(row) || 0) || 0;
      const fundraiserCount = Number(row?.fundraiser_count || row?.drive_count || row?.fundraiser_total || 0) || 0;
      const rawTotalRaised = Number(derive.totalRaised(row) || 0) || 0;
      const computedHistoricalTotal = rawTotalRaised > 0
        ? rawTotalRaised
        : (avgPerFundraiser > 0 ? (fundraiserCount > 0 ? (avgPerFundraiser * fundraiserCount) : avgPerFundraiser) : 0);
      const historicalTotalDisplay = computedHistoricalTotal > 0 ? utils.formatMoney(computedHistoricalTotal) : 'N/A';
      const historicalAvgDisplay = avgPerFundraiser > 0
        ? `${utils.formatMoney(avgPerFundraiser)}${fundraiserCount > 0 ? ` (${utils.formatCount(fundraiserCount)})` : ''}`
        : 'N/A';
      const scheduledRows = occurrences
        .sort((a, b) => (`${a.dateKey}|${a.startMinutes}`).localeCompare(`${b.dateKey}|${b.startMinutes}`))
        .map((item) => `
          <label class="scheduled-occurrence-row">
            <input type="checkbox" data-transfer-placement-id="${utils.escapeHtml(item.id)}" ${item.transferredToStation ? 'checked' : ''}>
            <span>${utils.escapeHtml(slotLabel(item.dateKey, item.startMinutes))}${hasLiveBreakFlag(item) ? ' · live-break' : ''}</span>
          </label>
        `).join('');
      let breakHtml = '<div class="scheduled-program-note">Loading break detail…</div>';
      if (entryIndex >= autoLoadLimit && !cache?.loaded) breakHtml = '<div class="scheduled-program-note">Break detail deferred so large fundraisers open faster.</div>';
      else if (cache?.error) breakHtml = `<div class="scheduled-program-note">Break detail unavailable: ${utils.escapeHtml(cache.error.message || 'load failed')}</div>`;
      else if (cache?.loaded) breakHtml = timingSummaryHtml(cache.detail);
      return `
        <article class="scheduled-program-card compact-program-card">
          <div class="scheduled-program-line scheduled-program-line-top">
            <div class="scheduled-program-title-wrap">
              ${renderProgramTitleLink(programId, derive.title(row) || occurrences[0].programTitle, { className: 'schedule-card-title-link' })}
              <div class="scheduled-program-meta-inline">${metaBits.map((bit) => `<span>${utils.escapeHtml(bit)}</span>`).join('<span class="meta-dot">•</span>')}</div>
            </div>
          </div>
          <div class="scheduled-program-line scheduled-program-line-bottom">
            <div class="scheduled-data-chunk"><span class="mini-label inline">Distributor</span><span>${utils.escapeHtml(derive.distributor(row) || '—')}</span></div>
            <div class="scheduled-data-chunk"><span class="mini-label inline">Historical Total Raised</span><span>${utils.escapeHtml(historicalTotalDisplay)}</span></div>
            <div class="scheduled-data-chunk"><span class="mini-label inline">Historical Avg / Fundraiser</span><span>${utils.escapeHtml(historicalAvgDisplay)}</span></div>
            <div class="scheduled-data-chunk scheduled-premium-chunk"><span class="mini-label inline">Premiums</span>${premiumLinesHtml(derive.premiumSummary(row) || '—')}</div>
            <div class="scheduled-data-chunk scheduled-occurrence-chunk"><span class="mini-label inline">Breaks in ProTrack</span><div class="scheduled-occurrence-list">${scheduledRows}</div></div>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderProgramPicker() {
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    if (!(schedule && slot)) return;
    const editable = canScheduleEdit();
    state.scheduleNonPledgeMode = false;
    void ensureScheduleAiringHistoryLoaded();
    populateScheduleTopicSelect();
    els.scheduleSlotLabel.textContent = slotLabel(slot.dateKey, slot.minutes);
    if (els.scheduleProgramSearch) {
      els.scheduleProgramSearch.value = state.scheduleProgramQuery || '';
      els.scheduleProgramSearch.disabled = !editable;
    }
    if (els.scheduleProgramTopicSelect) {
      els.scheduleProgramTopicSelect.value = state.scheduleProgramTopicFilter || '';
      els.scheduleProgramTopicSelect.disabled = !editable;
    }
    const usingNonPledge = false;
    if (els.scheduleFilterUnaired) {
      els.scheduleFilterUnaired.checked = Boolean(state.scheduleFilterUnaired);
      els.scheduleFilterUnaired.disabled = !editable || usingNonPledge;
    }
    if (els.scheduleFilterRightsStartYear) {
      els.scheduleFilterRightsStartYear.checked = Boolean(state.scheduleFilterRightsStartYear);
      els.scheduleFilterRightsStartYear.disabled = !editable;
    }
    if (els.scheduleFilterTopEarner) {
      els.scheduleFilterTopEarner.checked = Boolean(state.scheduleFilterTopEarner);
      els.scheduleFilterTopEarner.disabled = !editable || usingNonPledge;
    }
    const matches = scheduleProgramMatches(state.scheduleProgramQuery || '', state.scheduleProgramTopicFilter || '', slot.dateKey);
    const hasTopic = Boolean(utils.normalizeLookupKey(state.scheduleProgramTopicFilter || ''));
    const hasSearch = utils.normalizeLookupKey(state.scheduleProgramQuery || '').length >= scheduleSearchMinChars();
    const hasExtraFilters = Boolean(state.scheduleFilterUnaired || state.scheduleFilterRightsStartYear || state.scheduleFilterTopEarner);
    const sourceCount = scheduleLookupEntries(usingNonPledge).length;

    if (!editable) {
      showScheduleModalWarning('Viewer mode. Sign in as admin to create, move, remove, or edit scheduled programs.', 'warn');
    } else if (state.scheduleModalWarning?.text) {
      showScheduleModalWarning(state.scheduleModalWarning.text, state.scheduleModalWarning.type || 'warn');
    } else {
      showScheduleModalWarning('', '');
    }

    if (usingNonPledge && state.nonPledgeLoadState === 'loading') {
      els.scheduleProgramResults.innerHTML = '<div class="schedule-hint">Checking the WNMU Program Library for non-pledge titles…</div>';
    } else if (usingNonPledge && state.nonPledgeLoadState === 'missing') {
      els.scheduleProgramResults.innerHTML = '<div class="schedule-hint">No readable WNMU Program Library source was found. Add a source name in config.js if this app is pointing at the wrong table or view.</div>';
    } else if (usingNonPledge && state.nonPledgeLoadState === 'error') {
      els.scheduleProgramResults.innerHTML = '<div class="schedule-hint">The WNMU Program Library could not be read right now.</div>';
    } else if (!editable && !findPlacementForSlot(schedule, slot.key)) {
      els.scheduleProgramResults.innerHTML = '<div class="schedule-hint">Viewer mode. Empty slots cannot be edited until an admin signs in.</div>';
    } else if (!sourceCount) {
      els.scheduleProgramResults.innerHTML = `<div class="schedule-hint">No readable ${usingNonPledge ? 'Program Library' : 'pledge'} titles are loaded for scheduling right now.</div>`;
    } else if (!hasTopic && !hasSearch && !hasExtraFilters) {
      els.scheduleProgramResults.innerHTML = `<div class="schedule-hint">Choose a topic to browse, type ${scheduleSearchMinChars()}+ letter${scheduleSearchMinChars() === 1 ? '' : 's'} to match an existing ${usingNonPledge ? 'Program Library' : 'pledge'} title, or use the quick filters below.</div>`;
    } else if (!matches.length) {
      const filterBits = [];
      if (hasTopic) filterBits.push('topic');
      if (hasSearch) filterBits.push('title search');
      if (state.scheduleFilterUnaired) filterBits.push('unaired only');
      if (state.scheduleFilterRightsStartYear) filterBits.push(`rights start ${scheduleSlotYear(slot.dateKey) || 'this year'}`);
      if (state.scheduleFilterTopEarner) filterBits.push('top earner');
      const descriptor = filterBits.length ? filterBits.join(' + ') : 'this filter';
      els.scheduleProgramResults.innerHTML = `<div class="schedule-hint">No ${usingNonPledge ? 'Program Library' : 'database'} titles matched ${utils.escapeHtml(descriptor)}.</div>`;
    } else {
      els.scheduleProgramResults.innerHTML = matches.map(({ row, rights, isNonPledge }) => {
        const runtimeLabel = lengthMetaLabel(row);
        const rightsBegin = derive.rightsBegin(row) ? utils.formatDate(derive.rightsBegin(row)) : '—';
        const rightsEnd = derive.rightsEnd(row) ? utils.formatDate(derive.rightsEnd(row)) : '—';
        const topicText = derive.topicPrimary(row) || 'No topic';
        const airDatesText = airDatesSummaryForScheduleRow(row);
        const programLookupId = scheduleRowLookupId(row);
        return `
          <article class="schedule-program-match ${rights.ok ? '' : 'blocked'} ${isNonPledge ? 'external' : ''}">
            <div class="schedule-program-match-main" data-program-open-id="${utils.escapeHtml(programLookupId)}" tabindex="0" role="button">
              <strong class="schedule-match-title">${utils.escapeHtml(derive.title(row) || 'Untitled program')}</strong>
              <span class="schedule-program-match-meta">${utils.escapeHtml(runtimeLabel)} · ${utils.escapeHtml(derive.nola(row) || 'No NOLA')} · ${utils.escapeHtml(topicText)}</span>
              <span class="schedule-program-rights">Rights: ${utils.escapeHtml(rightsBegin)} → ${utils.escapeHtml(rightsEnd)}</span>
              <span class="schedule-program-air-dates">${utils.escapeHtml(airDatesText)}</span>
              ${rights.ok ? '' : `<span class="schedule-program-warning">Not available on ${utils.escapeHtml(utils.formatDate(slot.dateKey))}</span>`}
            </div>
            <div class="schedule-program-match-actions">
              <button type="button" class="primary schedule-program-assign-button" data-program-id="${utils.escapeHtml(programLookupId)}" data-rights-ok="${rights.ok ? 'true' : 'false'}" data-rights-reason="${utils.escapeHtml(rights.reason || '')}" ${editable ? '' : 'disabled'}>Schedule</button>
            </div>
          </article>
        `;
      }).join('');
    }

    const currentPlacement = findPlacementForSlot(schedule, slot.key);
    if (currentPlacement) {
      els.scheduleSelectedPreview.innerHTML = `<div class="schedule-selected-card">${renderProgramTitleLink(currentPlacement.isNonPledge ? '' : currentPlacement.programId, currentPlacement.programTitle, { className: 'schedule-selected-title-link' })}<div>${utils.escapeHtml(String(currentPlacement.lengthMinutes))} min</div></div>`;
      if (els.scheduleClearPlacementButton) els.scheduleClearPlacementButton.disabled = !editable;
      if (els.scheduleCopyPlacementButton) els.scheduleCopyPlacementButton.disabled = !editable;
    } else {
      els.scheduleSelectedPreview.innerHTML = '<div class="schedule-hint">No program assigned to this slot yet.</div>';
      if (els.scheduleClearPlacementButton) els.scheduleClearPlacementButton.disabled = true;
      if (els.scheduleCopyPlacementButton) els.scheduleCopyPlacementButton.disabled = true;
    }
    if (els.scheduleLiveBreakFlag) {
      els.scheduleLiveBreakFlag.checked = Boolean(currentPlacement?.liveBreakFlag);
      els.scheduleLiveBreakFlag.disabled = !editable;
    }
    if (els.schedulePastePlacementButton) els.schedulePastePlacementButton.disabled = !editable || !hasScheduleClipboard();
    if (els.scheduleAssignmentNote) {
      if (!editable) {
        els.scheduleAssignmentNote.textContent = 'Viewer mode is read-only. Rights dates are shown so you can still review what fits this slot.';
      } else if (state.scheduleFilterUnaired || state.scheduleFilterRightsStartYear || state.scheduleFilterTopEarner) {
        const notes = [];
        if (state.scheduleFilterUnaired) notes.push('unaired only');
        if (state.scheduleFilterRightsStartYear) notes.push(`rights begin in ${scheduleSlotYear(slot.dateKey) || 'this year'}`);
        if (state.scheduleFilterTopEarner) notes.push('top earners only');
        els.scheduleAssignmentNote.textContent = `Quick filters active: ${notes.join(' · ')}.`;
      } else {
        els.scheduleAssignmentNote.textContent = 'Selecting a program places a block sized to that title’s actual runtime when available. Rights are checked against the slot date.';
      }
    }
  }


  async function persistScheduleMetadataOnly(schedule) {
    if (state.scheduleStoreMode === 'remote' && state.client) {
      try {
        await state.client.from(constants.SCHEDULES_TABLE).upsert({
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
          }
        });
        state.scheduleSyncMessage = 'Fundraisers sync through Supabase.';
        return true;
      } catch (error) {
        console.warn('Remote schedule metadata save failed.', error);
        state.scheduleStoreMode = 'local';
        state.scheduleSyncMessage = `Remote save failed. Using this browser only. ${error.message || ''}`.trim();
      }
    }
    utils.storageSet(constants.SCHEDULE_STORAGE_KEY, state.schedules);
    return false;
  }

  async function saveActiveScheduleDraft(options = {}) {
    if (!canScheduleEdit()) { setNotice('Sign in as admin to edit fundraiser calendars.', 'warn'); return false; }
    const schedule = getActiveSchedule();
    const nextDayStartMinutes = Number(state.scheduleView.dayStartMinutes ?? (state.scheduleView.dayStartHour * 60));
    const nextDayEndMinutes = Number(state.scheduleView.dayEndMinutes ?? (state.scheduleView.dayEndHour * 60));
    const nextOnlineDollars = Number(els.fundraiserOnlineInput?.value || 0) || 0;
    const nextMailDollars = Number(els.fundraiserMailInput?.value || 0) || 0;
    const fallbackStartDate = schedule?.startDate || state.scheduleDraft.startDate || '';
    const fallbackEndDate = schedule?.endDate || state.scheduleDraft.endDate || '';
    const startDate = els.fundraiserStartInput?.value || fallbackStartDate;
    const endDate = els.fundraiserEndInput?.value || fallbackEndDate;
    const rawTitle = (els.fundraiserTitleInput?.value || '').trim();
    const title = rawTitle || defaultScheduleTitle(startDate, endDate);

    if (!schedule) {
      state.scheduleDraft.title = rawTitle;
      state.scheduleDraft.startDate = startDate;
      state.scheduleDraft.endDate = endDate;
      state.scheduleDraft.dayStartMinutes = nextDayStartMinutes;
      state.scheduleDraft.dayEndMinutes = nextDayEndMinutes;
      state.scheduleDraft.dayStartHour = Math.floor(nextDayStartMinutes / 60);
      state.scheduleDraft.dayEndHour = Math.floor(nextDayEndMinutes / 60);
      state.scheduleDraft.onlineDollars = nextOnlineDollars;
      state.scheduleDraft.mailDollars = nextMailDollars;
      return true;
    }

    if (!startDate || !endDate) {
      if (!options.silent) setNotice('A fundraiser needs both a start date and an end date.', 'warn');
      return false;
    }
    if (new Date(`${endDate}T00:00:00`) < new Date(`${startDate}T00:00:00`)) {
      if (!options.silent) setNotice('The fundraiser end date cannot be earlier than the start date.', 'warn');
      return false;
    }
    const titleChanged = schedule.title !== title;
    const dateRangeChanged = schedule.startDate !== startDate || schedule.endDate !== endDate;
    const windowChanged = Number(schedule.dayStartMinutes) !== nextDayStartMinutes || Number(schedule.dayEndMinutes) !== nextDayEndMinutes;
    const moneyChanged = Number(schedule.onlineDollars || 0) !== nextOnlineDollars || Number(schedule.mailDollars || 0) !== nextMailDollars;
    schedule.title = title;
    schedule.startDate = startDate;
    schedule.endDate = endDate;
    schedule.dayStartMinutes = nextDayStartMinutes;
    schedule.dayEndMinutes = nextDayEndMinutes;
    schedule.dayStartHour = Math.floor(schedule.dayStartMinutes / 60);
    schedule.dayEndHour = Math.floor(schedule.dayEndMinutes / 60);
    schedule.onlineDollars = nextOnlineDollars;
    schedule.mailDollars = nextMailDollars;
    state.scheduleDraft.title = title;
    state.scheduleDraft.startDate = startDate;
    state.scheduleDraft.endDate = endDate;
    state.scheduleDraft.dayStartMinutes = schedule.dayStartMinutes;
    state.scheduleDraft.dayEndMinutes = schedule.dayEndMinutes;
    state.scheduleDraft.dayStartHour = schedule.dayStartHour;
    state.scheduleDraft.dayEndHour = schedule.dayEndHour;
    state.scheduleDraft.onlineDollars = nextOnlineDollars;
    state.scheduleDraft.mailDollars = nextMailDollars;
    if (!(titleChanged || dateRangeChanged || windowChanged || moneyChanged)) return true;
    await persistScheduleMetadataOnly(schedule);
    renderScheduleList();
    renderScheduleForm();
    if (dateRangeChanged || windowChanged || moneyChanged) renderScheduleGrid();
    if (!options.silent) {
      const actionLabel = titleChanged && !(dateRangeChanged || windowChanged) ? 'Renamed' : 'Saved';
      setNotice(`${actionLabel} fundraiser calendar ${schedule.title}. ${state.scheduleSyncMessage}`);
    }
    return true;
  }

  async function createOrUpdateScheduleFromDraft() {
    if (!canScheduleEdit()) { setNotice('Sign in as admin to build or edit fundraiser schedules.', 'warn'); return; }
    const startDate = els.fundraiserStartInput.value;
    const endDate = els.fundraiserEndInput.value;
    const title = (els.fundraiserTitleInput.value || '').trim();
    if (!startDate || !endDate) {
      setNotice('A fundraiser needs both a start date and an end date.', 'warn');
      return;
    }
    if (new Date(`${endDate}T00:00:00`) < new Date(`${startDate}T00:00:00`)) {
      setNotice('The fundraiser end date cannot be earlier than the start date.', 'warn');
      return;
    }
    const schedule = createScheduleRecord({
      title,
      startDate,
      endDate,
      dayStartHour: constants.DEFAULT_DAY_START_HOUR,
      dayEndHour: constants.DEFAULT_DAY_END_HOUR,
      onlineDollars: Number(els.fundraiserOnlineInput?.value || 0) || 0,
      mailDollars: Number(els.fundraiserMailInput?.value || 0) || 0
    });
    state.schedules.unshift(schedule);
    applyScheduleToView(schedule);
    await persistSchedules(schedule);
    renderAll();
    setNotice(`Built fundraiser calendar ${schedule.title}. ${state.scheduleSyncMessage}`);
  }

  function toggleTransferred(placementId, checked) {
    const schedule = getActiveSchedule();
    if (!schedule) return;
    const placement = findPlacementById(schedule, placementId);
    if (!placement) return;
    placement.transferredToStation = checked;
    persistSchedules(schedule);
  }

  async function assignProgramToSelectedSlot(programId, options = {}) {
    if (!canScheduleEdit()) { showScheduleModalWarning('Viewer mode. Sign in as admin to assign programs.', 'bad'); return; }
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    const row = getProgramRowById(programId);
    if (!schedule || !slot || !row) return;
    const isNonPledge = Boolean(options.isNonPledge || row?.__external_source_name);
    const rightsCheck = rightsCheckForDate(row, slot.dateKey);
    if (!rightsCheck.ok) {
      setNotice(rightsCheck.reason, 'warn');
      if (els.scheduleAssignmentNote) els.scheduleAssignmentNote.textContent = rightsCheck.reason;
      showScheduleModalWarning(rightsCheck.reason, 'bad');
      return;
    }
    const lengthMinutes = derive.runtimeMinutes(row) || derive.lengthBucket(row) || 30;
    const slotCount = Math.max(1, Math.ceil(Number(lengthMinutes) / constants.DEFAULT_SLOT_MINUTES));
    const existing = findPlacementForSlot(schedule, slot.key);
    const endMinutes = slot.minutes + (slotCount * constants.DEFAULT_SLOT_MINUTES);
    const base = {
      id: existing?.id || utils.makeId('place'),
      programId: derive.programId(row),
      programTitle: derive.title(row),
      lengthMinutes,
      dateKey: slot.dateKey,
      startMinutes: slot.minutes,
      endMinutes,
      startSlotKey: slot.key,
      liveBreakFlag: Boolean(els.scheduleLiveBreakFlag?.checked),
      liveBreakNotes: Boolean(els.scheduleLiveBreakFlag?.checked) ? (existing?.liveBreakNotes || '') : '',
      isNonPledge,
      sourceName: row?.__external_source_name || '',
      sourceLabel: row?.__external_source_label || '',
      transferredToStation: existing?.transferredToStation || false
    };
    if (existing) Object.assign(existing, base);
    else schedule.placements.push(base);
    await persistSchedules(schedule);
    renderScheduleGrid();
    renderProgramPicker();
    setNotice(`Scheduled ${derive.title(row)} at ${slotLabel(slot.dateKey, slot.minutes)}. ${state.scheduleSyncMessage}`);
    closeScheduleModal();
  }

  async function clearSelectedPlacement() {
    if (!canScheduleEdit()) { showScheduleModalWarning('Viewer mode. Sign in as admin to remove programs.', 'bad'); return; }
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    if (!schedule || !slot) return;
    const target = findPlacementForSlot(schedule, slot.key);
    if (!target) return;
    schedule.placements = schedule.placements.filter((item) => item.id !== target.id);
    await persistSchedules(schedule);
    renderScheduleGrid();
    renderProgramPicker();
    closeScheduleModal();
    setNotice(`Removed ${target.programTitle} from ${slotLabel(target.dateKey, target.startMinutes)}.`);
  }

  async function updateLiveBreakFlag() {
    if (!canScheduleEdit()) return;
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    if (!schedule || !slot) return;
    const target = findPlacementForSlot(schedule, slot.key);
    if (!target) return;
    target.liveBreakFlag = Boolean(els.scheduleLiveBreakFlag?.checked);
    if (!target.liveBreakFlag) target.liveBreakNotes = '';
    await persistSchedules(schedule);
    renderScheduleGrid();
    renderProgramPicker();
  }

  function adjustZoom(delta) {
    state.scheduleView.zoom = Math.min(2.8, Math.max(0.12, Number((state.scheduleView.zoom + delta).toFixed(2))));
    renderScheduleGrid();
  }

  function adjustRange(kind, deltaHours) {
    const deltaMinutes = deltaHours * 60;
    const startMinutes = Number(state.scheduleView.dayStartMinutes ?? (state.scheduleView.dayStartHour * 60));
    const endMinutes = Number(state.scheduleView.dayEndMinutes ?? (state.scheduleView.dayEndHour * 60));
    if (kind === 'start') {
      state.scheduleView.dayStartMinutes = Math.max(constants.MIN_VISIBLE_HOUR * 60, Math.min(startMinutes + deltaMinutes, endMinutes - 60));
    } else {
      state.scheduleView.dayEndMinutes = Math.min(constants.MAX_VISIBLE_HOUR * 60, Math.max(endMinutes + deltaMinutes, startMinutes + 60));
    }
    state.scheduleView.dayStartHour = Math.floor(state.scheduleView.dayStartMinutes / 60);
    state.scheduleView.dayEndHour = Math.floor(state.scheduleView.dayEndMinutes / 60);
    renderScheduleGrid();
  }

  async function movePlacement(placementId, targetDateKey, targetMinutes) {
    if (!canScheduleEdit()) { setNotice('Viewer mode. Sign in as admin to move scheduled programs.', 'warn'); return; }
    const schedule = getActiveSchedule();
    const placement = findPlacementById(schedule, placementId);
    const row = getProgramRowById(placement?.programId);
    if (!schedule || !placement || !row) return;
    const rightsCheck = rightsCheckForDate(row, targetDateKey);
    if (!rightsCheck.ok) {
      setNotice(rightsCheck.reason, 'warn');
      showScheduleModalWarning(rightsCheck.reason, 'bad');
      return;
    }
    const slotCount = Math.max(1, Math.ceil(Number(placement.lengthMinutes || 30) / constants.DEFAULT_SLOT_MINUTES));
    placement.dateKey = targetDateKey;
    placement.startMinutes = targetMinutes;
    placement.endMinutes = targetMinutes + (slotCount * constants.DEFAULT_SLOT_MINUTES);
    placement.startSlotKey = `${targetDateKey}|${targetMinutes}`;
    await persistSchedules(schedule);
    renderScheduleGrid();
    setNotice(`Moved ${placement.programTitle} to ${slotLabel(targetDateKey, targetMinutes)}. ${state.scheduleSyncMessage}`);
  }

  function copySelectedPlacement(closeAfter = true) {
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    const target = schedule && slot ? findPlacementForSlot(schedule, slot.key) : null;
    if (!target) {
      showScheduleModalWarning('There is no scheduled program in this slot to copy.', 'warn');
      return false;
    }
    copyPlacementToClipboard(target);
    renderProgramPicker();
    showScheduleModalWarning(`Copied ${target.programTitle}.`, 'ok');
    setNotice(`Copied ${target.programTitle}.`);
    if (closeAfter) closeScheduleModal();
    return true;
  }

  async function pasteClipboardToSelectedSlot(closeAfter = true) {
    if (!canScheduleEdit()) { showScheduleModalWarning('Viewer mode. Sign in as admin to paste scheduled programs.', 'bad'); return false; }
    const clip = state.scheduleClipboard;
    const slot = state.selectedScheduleSlot;
    const schedule = getActiveSchedule();
    if (!clip?.programId || !slot || !schedule) {
      showScheduleModalWarning('Nothing is copied yet.', 'warn');
      return false;
    }
    const row = getProgramRowById(clip.programId);
    if (!row) {
      showScheduleModalWarning('The copied title could not be found in the current database.', 'bad');
      return false;
    }
    const rightsCheck = rightsCheckForDate(row, slot.dateKey);
    if (!rightsCheck.ok) {
      showScheduleModalWarning(rightsCheck.reason, 'bad');
      return false;
    }
    const existing = findPlacementForSlot(schedule, slot.key);
    if (existing) schedule.placements = schedule.placements.filter((item) => item.id !== existing.id);
    const lengthMinutes = Number(derive.runtimeMinutes(row) || clip.lengthMinutes || 30);
    const slotCount = Math.max(1, Math.ceil(Number(lengthMinutes) / constants.DEFAULT_SLOT_MINUTES));
    const endMinutes = slot.minutes + (slotCount * constants.DEFAULT_SLOT_MINUTES);
    schedule.placements.push({
      id: utils.makeId('placement'),
      programId: derive.programId(row),
      programTitle: derive.title(row),
      dateKey: slot.dateKey,
      startMinutes: slot.minutes,
      endMinutes,
      startSlotKey: slot.key,
      lengthMinutes,
      liveBreakFlag: Boolean(clip.liveBreakFlag),
      liveBreakNotes: Boolean(clip.liveBreakFlag) ? (clip.liveBreakNotes || '') : '',
      isNonPledge: Boolean(clip.isNonPledge || row?.__external_source_name),
      sourceName: clip.sourceName || row?.__external_source_name || '',
      sourceLabel: clip.sourceLabel || row?.__external_source_label || ''
    });
    await persistSchedules(schedule);
    renderScheduleGrid();
    renderProgramPicker();
    showScheduleModalWarning(`Pasted ${derive.title(row)} into ${slotLabel(slot.dateKey, slot.minutes)}.`, 'ok');
    setNotice(`Pasted ${derive.title(row)} into ${slotLabel(slot.dateKey, slot.minutes)}. ${state.scheduleSyncMessage}`);
    if (closeAfter) closeScheduleModal();
    return true;
  }

  async function openPlacementDetailFromContext(slot, editMode = true) {
    const schedule = getActiveSchedule();
    const placement = schedule && slot ? findPlacementForSlot(schedule, slot.key) : null;
    if (!placement || placement.isNonPledge) return false;
    await App.detailUi.loadProgramDetail(placement.programId, { preserveMode: editMode && canScheduleEdit() });
    if (editMode && canScheduleEdit()) App.detailUi.setDetailMode('edit');
    return true;
  }

  async function deletePlacementFromContext(slot) {
    if (!canScheduleEdit()) return false;
    const schedule = getActiveSchedule();
    const target = schedule && slot ? findPlacementForSlot(schedule, slot.key) : null;
    if (!schedule || !target) return false;
    schedule.placements = schedule.placements.filter((item) => item.id !== target.id);
    await persistSchedules(schedule);
    renderScheduleGrid();
    setNotice(`Removed ${target.programTitle} from ${slotLabel(target.dateKey, target.startMinutes)}.`);
    return true;
  }

  function scheduleSlotPayloadFromElement(target) {
    if (!target) return null;
    const placementEl = target.closest('[data-placement-id]');
    if (placementEl) {
      return {
        key: `${placementEl.dataset.dateKey}|${placementEl.dataset.minutes}`,
        dateKey: placementEl.dataset.dateKey,
        minutes: Number(placementEl.dataset.minutes || 0)
      };
    }
    const slotEl = target.closest('[data-slot-key]');
    if (!slotEl) return null;
    return {
      key: slotEl.dataset.slotKey,
      dateKey: slotEl.dataset.dateKey,
      minutes: Number(slotEl.dataset.minutes || 0)
    };
  }

  function ensureScheduleContextMenu() {
    let menu = document.getElementById('schedule-context-menu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'schedule-context-menu';
    menu.className = 'schedule-context-menu hidden';
    menu.innerHTML = [
      '<button type="button" data-action="copy">Copy program</button>',
      '<button type="button" data-action="paste">Paste copied program here</button>',
      '<button type="button" data-action="detail">Open details / edit</button>',
      '<button type="button" class="destructive" data-action="delete">Delete scheduled program</button>'
    ].join('');
    document.body.appendChild(menu);
    menu.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const slot = state.scheduleContextSlot;
      hideScheduleContextMenu();
      if (!slot) return;
      state.selectedScheduleSlot = slot;
      if (action === 'copy') copySelectedPlacement(false);
      if (action === 'paste') void pasteClipboardToSelectedSlot(false);
      if (action === 'detail') void openPlacementDetailFromContext(slot, true);
      if (action === 'delete') void deletePlacementFromContext(slot);
    });
    return menu;
  }

  function hideScheduleContextMenu() {
    const menu = document.getElementById('schedule-context-menu');
    if (!menu) return;
    menu.classList.add('hidden');
    menu.style.left = '-9999px';
    menu.style.top = '-9999px';
  }

  function showScheduleContextMenu(event, target) {
    if (!canScheduleEdit()) return;
    const slot = scheduleSlotPayloadFromElement(target);
    if (!slot) return;
    event.preventDefault();
    state.scheduleContextSlot = slot;
    state.selectedScheduleSlot = slot;
    const schedule = getActiveSchedule();
    const placement = schedule && slot ? findPlacementForSlot(schedule, slot.key) : null;
    const menu = ensureScheduleContextMenu();
    const copyButton = menu.querySelector('[data-action="copy"]');
    const pasteButton = menu.querySelector('[data-action="paste"]');
    const detailButton = menu.querySelector('[data-action="detail"]');
    const deleteButton = menu.querySelector('[data-action="delete"]');
    if (copyButton) copyButton.disabled = !placement;
    if (pasteButton) pasteButton.disabled = !hasScheduleClipboard();
    if (detailButton) detailButton.disabled = !placement || Boolean(placement?.isNonPledge);
    if (deleteButton) deleteButton.disabled = !placement;
    menu.classList.remove('hidden');
    menu.style.left = `${event.pageX}px`;
    menu.style.top = `${event.pageY}px`;
  }

  async function exportScheduleView() {
    const schedule = getActiveSchedule();
    if (!schedule) return;
    const rows = annotatePlacements(schedule);
    await ensureScheduleExportDetails(rows);
    const byDay = new Map();
    rows.forEach((item) => {
      if (!byDay.has(item.dateKey)) byDay.set(item.dateKey, []);
      byDay.get(item.dateKey).push(item);
    });
    const lines = [`${schedule.title}`, ''];
    for (const [dateKey, items] of [...byDay.entries()]) {
      lines.push(formatScheduleDay(dateKey));
      for (const item of items.sort((a, b) => a.startMinutes - b.startMinutes)) {
        const markerBits = [];
        if (item.isNonPledge) markerBits.push('non-pledge marker');
        if (hasLiveBreakFlag(item)) markerBits.push('live-break');
        lines.push(`- ${utils.minutesToLabel(item.startMinutes)} ${item.programTitle} (${item.lengthMinutes} min)${markerBits.length ? ` | ${markerBits.join(' · ')}` : ''}`);
        let breakLine = 'Break timings: none found';
        if (!item.isNonPledge && item.programId) {
          const cache = state.scheduleDetailCache[item.programId];
          if (cache?.detail?.timings) breakLine = timingExportSummary(cache.detail.timings);
          else if (cache?.error) breakLine = `Break timings unavailable: ${cache.error.message || 'load failed'}`;
          else breakLine = 'Break timings unavailable';
        }
        lines.push(`  ${breakLine}`);
      }
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${schedule.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'fundraiser'}-schedule.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function bindEvents() {
    els.newScheduleButton?.addEventListener('click', resetToNewScheduleDraft);
    els.scheduleMobileNewButton?.addEventListener('click', resetToNewScheduleDraft);
    const handleScheduleSelectChange = (event) => {
      const scheduleId = String(event.target?.value || '');
      if (!scheduleId) return;
      activateScheduleById(scheduleId, { focusCalendar: true });
    };
    const reopenSelectedSchedule = (event) => {
      const scheduleId = String(event.target?.value || state.activeScheduleId || '');
      if (!scheduleId) return;
      activateScheduleById(scheduleId, { focusCalendar: true });
    };
    els.scheduleDesktopSelect?.addEventListener('change', handleScheduleSelectChange);
    els.scheduleMobileSelect?.addEventListener('change', handleScheduleSelectChange);
    els.scheduleDesktopSelect?.addEventListener('click', reopenSelectedSchedule);
    els.scheduleMobileSelect?.addEventListener('click', reopenSelectedSchedule);
    els.scheduleGenerateButton?.addEventListener('click', () => { void createOrUpdateScheduleFromDraft(); });
    els.scheduleBuildFromImportsButton?.addEventListener('click', () => { void buildSchedulesFromImportedReports({ rebuild: false, activateFirst: true }); });
    els.scheduleRebuildFromImportsButton?.addEventListener('click', () => { void buildSchedulesFromImportedReports({ rebuild: true, activateFirst: true }); });
    const saveScheduleDraft = () => { void saveActiveScheduleDraft(); };
    els.fundraiserTitleInput?.addEventListener('change', saveScheduleDraft);
    els.fundraiserTitleInput?.addEventListener('blur', saveScheduleDraft);
    els.fundraiserTitleInput?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); saveScheduleDraft(); } });
    els.fundraiserStartInput?.addEventListener('change', saveScheduleDraft);
    els.fundraiserEndInput?.addEventListener('change', saveScheduleDraft);
    els.fundraiserOnlineInput?.addEventListener('change', saveScheduleDraft);
    els.fundraiserMailInput?.addEventListener('change', saveScheduleDraft);
    els.scheduleList?.addEventListener('click', (event) => {
      const open = event.target.closest('[data-schedule-id]');
      if (open) {
        activateScheduleById(open.dataset.scheduleId, { focusCalendar: true });
        return;
      }
      const del = event.target.closest('[data-delete-schedule-id], [data-delete-invalid-schedule-id]');
      if (del && window.confirm('Remove this fundraiser schedule?')) {
        const scheduleId = del.dataset.deleteScheduleId || del.dataset.deleteInvalidScheduleId;
        if (scheduleId) void deleteScheduleRecord(scheduleId);
      }
    });
    els.scheduleGrid?.addEventListener('click', (event) => {
      hideScheduleContextMenu();
      const block = event.target.closest('[data-placement-id]');
      if (block) {
        const schedule = getActiveSchedule();
        const placement = findPlacementById(schedule, block.dataset.placementId);
        if (placement) openScheduleModal({ key: `${placement.dateKey}|${placement.startMinutes}`, dateKey: placement.dateKey, minutes: placement.startMinutes });
        return;
      }
      const slot = event.target.closest('[data-slot-key]');
      if (!slot) return;
      openScheduleModal({ key: slot.dataset.slotKey, dateKey: slot.dataset.dateKey, minutes: Number(slot.dataset.minutes || 0) });
    });
    els.scheduleGrid?.addEventListener('contextmenu', (event) => {
      showScheduleContextMenu(event, event.target);
    });
    els.scheduleGrid?.addEventListener('dragstart', (event) => {
      if (!canScheduleEdit()) return;
      const block = event.target.closest('[data-placement-id]');
      if (!block) return;
      state.draggedPlacementId = block.dataset.placementId;
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', block.dataset.placementId);
        event.dataTransfer.effectAllowed = 'move';
      }
    });
    els.scheduleGrid?.addEventListener('dragend', () => {
      state.draggedPlacementId = '';
      els.scheduleGrid.querySelectorAll('.schedule-slot.drag-target').forEach((node) => node.classList.remove('drag-target'));
    });
    els.scheduleGrid?.addEventListener('dragover', (event) => {
      if (!canScheduleEdit()) return;
      const slot = event.target.closest('[data-slot-key]');
      if (!slot || !state.draggedPlacementId) return;
      event.preventDefault();
      slot.classList.add('drag-target');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });
    els.scheduleGrid?.addEventListener('dragleave', (event) => {
      const slot = event.target.closest('[data-slot-key]');
      if (slot) slot.classList.remove('drag-target');
    });
    els.scheduleGrid?.addEventListener('drop', (event) => {
      if (!canScheduleEdit()) return;
      const slot = event.target.closest('[data-slot-key]');
      const placementId = state.draggedPlacementId || event.dataTransfer?.getData('text/plain');
      if (!slot || !placementId) return;
      event.preventDefault();
      slot.classList.remove('drag-target');
      void movePlacement(placementId, slot.dataset.dateKey, Number(slot.dataset.minutes || 0));
    });
    els.scheduleProgramSearch?.addEventListener('input', (event) => { state.scheduleProgramQuery = event.target.value || ''; renderProgramPicker(); });
    els.scheduleProgramTopicSelect?.addEventListener('change', (event) => { state.scheduleProgramTopicFilter = event.target.value || ''; renderProgramPicker(); });
    els.scheduleFilterUnaired?.addEventListener('change', (event) => { state.scheduleFilterUnaired = Boolean(event.target.checked); renderProgramPicker(); });
    els.scheduleFilterRightsStartYear?.addEventListener('change', (event) => { state.scheduleFilterRightsStartYear = Boolean(event.target.checked); renderProgramPicker(); });
    els.scheduleFilterTopEarner?.addEventListener('change', (event) => { state.scheduleFilterTopEarner = Boolean(event.target.checked); renderProgramPicker(); });
    els.scheduleLiveBreakFlag?.addEventListener('change', () => { void updateLiveBreakFlag().catch((error) => setNotice(error?.message || 'Could not update live-break flag.', 'warn')); });
    els.scheduleProgramResults?.addEventListener('click', (event) => {
      const btn = event.target.closest('.schedule-program-assign-button');
      if (!btn) return;
      const rightsOk = btn.dataset.rightsOk !== 'false';
      const reason = btn.dataset.rightsReason || '';
      if (!rightsOk) {
        showScheduleModalWarning(reason || 'This title is out of rights for the selected slot.', 'bad');
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void assignProgramToSelectedSlot(btn.dataset.programId, { isNonPledge: false });
    });
    els.scheduleClearPlacementButton?.addEventListener('click', () => { void clearSelectedPlacement(); });
    els.scheduleZoomInButton?.addEventListener('click', () => adjustZoom(0.15));
    els.scheduleZoomOutButton?.addEventListener('click', () => adjustZoom(-0.15));
    els.scheduleStartEarlierButton?.addEventListener('click', () => adjustRange('start', -1));
    els.scheduleStartLaterButton?.addEventListener('click', () => adjustRange('start', 1));
    els.scheduleEndEarlierButton?.addEventListener('click', () => adjustRange('end', -1));
    els.scheduleEndLaterButton?.addEventListener('click', () => adjustRange('end', 1));
    els.scheduleExportButton?.addEventListener('click', () => { void exportScheduleView(); });
    els.scheduleProgramDetails?.addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-transfer-placement-id]');
      if (!checkbox) return;
      toggleTransferred(checkbox.dataset.transferPlacementId, checkbox.checked);
    });
    els.scheduleCopyPlacementButton?.addEventListener('click', () => { copySelectedPlacement(true); });
    els.schedulePastePlacementButton?.addEventListener('click', () => { void pasteClipboardToSelectedSlot(true); });
    els.scheduleProgramModal?.addEventListener('click', (event) => event.stopPropagation());
    els.scheduleProgramBackdrop?.addEventListener('click', closeScheduleModal);
    document.addEventListener('click', (event) => {
      const menu = document.getElementById('schedule-context-menu');
      if (menu && !menu.classList.contains('hidden') && !menu.contains(event.target)) hideScheduleContextMenu();
    });
    window.addEventListener('scroll', hideScheduleContextMenu, true);
    window.addEventListener('resize', hideScheduleContextMenu);
    els.scheduleProgramCloseButton?.addEventListener('click', closeScheduleModal);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideScheduleContextMenu();
        if (!els.scheduleProgramModal?.classList.contains('hidden')) closeScheduleModal();
      }
      if (els.scheduleProgramModal?.classList.contains('hidden')) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const activeTag = document.activeElement?.tagName || '';
      const inField = /INPUT|TEXTAREA|SELECT/.test(activeTag);
      if (event.key.toLowerCase() === 'c' && !inField) {
        event.preventDefault();
        copySelectedPlacement();
      }
      if (event.key.toLowerCase() === 'v' && !inField) {
        event.preventDefault();
        void pasteClipboardToSelectedSlot();
      }
    });
  }

  function renderAll() {
    const schedulingPane = document.querySelector('[data-workspace-pane="scheduling"]');
    if (schedulingPane) schedulingPane.dataset.scheduleState = getActiveSchedule() ? 'active' : 'empty';
    populateScheduleTopicSelect();
    renderScheduleList();
    renderScheduleForm();
    renderScheduleGrid();
  }

  App.schedulingUi = {
    loadSchedules,
    renderAll,
    bindEvents,
    renderScheduleGrid,
    renderScheduleList,
    renderScheduledProgramDetails,
    buildSchedulesFromImportedReports,
    mergeImportedRowsIntoSchedules,
    closeScheduleModal
  };
})();

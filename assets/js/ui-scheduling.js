(() => {
  const App = window.PledgeLib;
  const { state, constants, utils, derive } = App;
  const filters = App.programFilters;
  const { els, setNotice } = App.dom;
  const DELETE_ACTIVE_SCHEDULE_OPTION = '__delete_active_schedule__';
  let scheduledDetailRerenderTimer = 0;
  let cachedProgramLookupRows = null;
  let cachedProgramLookup = null;
  const scheduleInlineScrollbar = {
    dragActive: false,
    dragStartY: 0,
    dragStartScrollTop: 0,
    raf: 0
  };

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

  function requestScheduleExpectationData() {
    if (state.performance?.ready || state.scheduleExpectationLoading || !state.client || !App.performanceUi?.refreshData) return;
    state.scheduleExpectationLoading = true;
    App.performanceUi.refreshData({ silent: true })
      .then(() => {
        if (getActiveSchedule()) renderScheduleEditor();
      })
      .catch(() => {})
      .finally(() => {
        state.scheduleExpectationLoading = false;
      });
  }

  function scheduleExpectationBadgeHtml(placement, dateKey, startMinutes) {
    if (!placement || placement.isNonPledge || !App.performanceUi?.getScheduleExpectationForPlacement) return '';
    if (!App.auth?.canEdit?.()) return '';
    try {
      const expectation = App.performanceUi.getScheduleExpectationForPlacement(placement, dateKey, startMinutes);
      if (!expectation) return '';
      const evidenceClass = expectation.evidenceMode === 'overall_title' ? 'overall-fallback' : 'exact-slot';
      return `<span class="schedule-placement-expectation ${utils.escapeHtml(expectation.tone)} ${utils.escapeHtml(evidenceClass)}" aria-label="${utils.escapeHtml(expectation.tooltip)}" title="${utils.escapeHtml(expectation.tooltip)}">${utils.escapeHtml(expectation.symbol)}</span>`;
    } catch (error) {
      console.warn('Schedule slot-fit badge failed for placement.', error);
      return '';
    }
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

  function normalizePlacementBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const text = utils.normalizeText(value).toLowerCase();
    if (!text) return fallback;
    if (['true', 'yes', 'y', '1', 'live', 'has live breaks', 'flagged'].includes(text)) return true;
    if (['false', 'no', 'n', '0', 'none', 'no live breaks', 'no live-breaks', 'no live break', 'not live'].includes(text)) return false;
    return fallback;
  }

  function placementLooksNonSpecific(placement = {}) {
    return utils.isNonSpecificRow({
      isNonSpecific: placement?.isNonSpecific,
      is_non_specific: placement?.isNonSpecific,
      imported_program_title: placement?.programTitle,
      program_title: placement?.programTitle,
      title: placement?.programTitle,
      name: placement?.programTitle,
      nola_code: placement?.nolaCode || placement?.nola || '',
      nola: placement?.nolaCode || placement?.nola || '',
      program_nola: placement?.nolaCode || placement?.nola || ''
    });
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
    next.placements = (Array.isArray(next.placements) ? next.placements : []).filter((placement) => {
      return !(placement?.importedFromReport && placementLooksNonSpecific(placement));
    }).map((placement) => ({
      ...placement,
      liveBreakFlag: normalizePlacementBoolean(placement?.liveBreakFlag, Boolean(utils.normalizeText(placement?.liveBreakNotes))),
      isNonPledge: normalizePlacementBoolean(placement?.isNonPledge, Boolean(placement?.isNonPledge)),
      importedFromReport: normalizePlacementBoolean(placement?.importedFromReport, Boolean(placement?.importedFromReport)),
      transferredToStation: normalizePlacementBoolean(placement?.transferredToStation, Boolean(placement?.transferredToStation))
    }));
    return next;
  }

  function scheduleManualMoneyTotal(schedule = {}) {
    return (Number(schedule?.onlineDollars || 0) || 0)
      + (Number(schedule?.mailDollars || 0) || 0)
      + (Number(schedule?.goalDollars || 0) || 0);
  }

  function scheduleLooksAutoImported(schedule = {}) {
    const titleKey = utils.normalizeLookupKey(schedule?.title || '');
    return titleKey.startsWith('imported pledge')
      || Boolean(schedule?.meta?.importedFromReports)
      || Boolean(utils.normalizeText(schedule?.meta?.importedFundraiserKey || ''));
  }

  function scheduleSameRangePreferenceScore(schedule = {}) {
    let score = 0;
    const moneyTotal = scheduleManualMoneyTotal(schedule);
    if (moneyTotal > 0) score += 1000000 + Math.min(999999, Math.round(moneyTotal));
    if (!scheduleLooksAutoImported(schedule)) score += 100000;
    if ((schedule?.placements || []).some((placement) => !placement?.importedFromReport)) score += 50000;
    if ((schedule?.placements || []).some((placement) => placement?.importedFromReport)) score += 10000;
    if (schedule?.meta?.importedTotalsHydratedFromAirings) score += 5000;
    const updated = Date.parse(schedule?.updatedAt || schedule?.updated_at || schedule?.createdAt || '');
    if (Number.isFinite(updated)) score += Math.floor(updated / 1000000000);
    return score;
  }

  function sameDateRangeSchedules(startDate = '', endDate = '', exceptId = '') {
    const startKey = utils.normalizeText(startDate);
    const endKey = utils.normalizeText(endDate);
    if (!(startKey && endKey)) return [];
    return (state.schedules || []).filter((item) => {
      if (exceptId && utils.normalizeText(item?.id) === utils.normalizeText(exceptId)) return false;
      return utils.normalizeText(item?.startDate) === startKey && utils.normalizeText(item?.endDate) === endKey;
    }).sort((a, b) => scheduleSameRangePreferenceScore(b) - scheduleSameRangePreferenceScore(a));
  }

  function bestScheduleForDateRange(startDate = '', endDate = '', exceptId = '') {
    return sameDateRangeSchedules(startDate, endDate, exceptId)[0] || null;
  }

  function deleteScheduleWarningText(schedule = {}) {
    const placementCount = Array.isArray(schedule?.placements) ? schedule.placements.length : 0;
    const dateRange = `${utils.formatDate(schedule?.startDate)} – ${utils.formatDate(schedule?.endDate)}`;
    const moneyLines = [
      `Broadcast: ${utils.formatMoney(scheduleBroadcastTotal(schedule))}`,
      `Online: ${utils.formatMoney(Number(schedule?.onlineDollars || 0) || 0)}`,
      `Mail: ${utils.formatMoney(Number(schedule?.mailDollars || 0) || 0)}`,
      `Goal: ${utils.formatMoney(Number(schedule?.goalDollars || 0) || 0)}`,
      `Total raised: ${utils.formatMoney(scheduleGrandTotal(schedule))}`
    ].join('\n');
    return [
      'ARE YOU FUCKING CRAZY?',
      '',
      'This will permanently delete this fundraiser schedule row:',
      '',
      schedule?.title || 'Untitled fundraiser',
      dateRange,
      `${utils.formatCount(placementCount)} scheduled block${placementCount === 1 ? '' : 's'}`,
      moneyLines,
      '',
      'This does NOT delete imported pledge report rows, but it DOES remove this fundraiser calendar from the app.',
      '',
      'Click OK only if this is the wrong duplicate fundraiser.'
    ].join('\n');
  }

  async function requestDeleteSchedule(scheduleId = '') {
    if (!canScheduleEdit()) { setNotice('Sign in as admin to delete fundraiser schedules.', 'warn'); return false; }
    const schedule = (state.schedules || []).find((item) => item.id === scheduleId) || null;
    if (!schedule) { setNotice('That fundraiser schedule is not loaded anymore.', 'warn'); renderScheduleList(); return false; }
    const duplicateCount = sameDateRangeSchedules(schedule.startDate, schedule.endDate).length;
    if (!window.confirm(deleteScheduleWarningText(schedule))) {
      setNotice('Fundraiser delete cancelled. Nothing was removed.', 'warn');
      renderScheduleList();
      return false;
    }
    const typed = window.prompt(`Type DELETE to remove "${schedule.title || 'Untitled fundraiser'}".${duplicateCount > 1 ? ' There are duplicate fundraisers with this same date range.' : ''}`);
    if (String(typed || '').trim() !== 'DELETE') {
      setNotice('Fundraiser delete cancelled because DELETE was not typed. Nothing was removed.', 'warn');
      renderScheduleList();
      return false;
    }
    const deletedTitle = schedule.title || 'Untitled fundraiser';
    await deleteScheduleRecord(schedule.id);
    setNotice(`Deleted fundraiser schedule ${deletedTitle}. ${state.scheduleSyncMessage || ''}`.trim());
    return true;
  }

  function sortSchedulesNewestFirst(items = []) {
    return [...items].sort((a, b) => {
      const aRange = `${utils.normalizeText(a.startDate) || ''}|${utils.normalizeText(a.endDate) || ''}`;
      const bRange = `${utils.normalizeText(b.startDate) || ''}|${utils.normalizeText(b.endDate) || ''}`;
      if (aRange && aRange === bRange) {
        const preferenceDelta = scheduleSameRangePreferenceScore(b) - scheduleSameRangePreferenceScore(a);
        if (preferenceDelta !== 0) return preferenceDelta;
      }
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
    ensureCurrentScheduleApplied();
    renderScheduleList();
    renderHomeDriveSummary();
  }

  function ensureCurrentScheduleApplied() {
    const ordered = sortSchedulesNewestFirst(state.schedules || []);
    if (!ordered.length) {
      state.activeScheduleId = '';
      return null;
    }
    let activeSchedule = getActiveSchedule();
    const activeInfo = activeSchedule ? getScheduleDateSpanInfo(activeSchedule) : null;
    if (!state.activeScheduleId || !activeSchedule || !activeInfo?.ok) {
      activeSchedule = ordered.find((item) => getScheduleDateSpanInfo(item).ok) || ordered[0] || null;
      state.activeScheduleId = activeSchedule?.id || '';
    }
    if (activeSchedule && getScheduleDateSpanInfo(activeSchedule).ok) applyScheduleToView(activeSchedule);
    return activeSchedule;
  }

  async function healImportedSchedulesIfNeeded() {
    if (state.scheduleImportedHealCompleted) return;
    state.scheduleImportedHealCompleted = true;
    const importedSchedules = (state.schedules || []).filter((schedule) => (schedule?.meta?.importedFromReports) || (schedule?.placements || []).some((placement) => placement?.importedFromReport));
    if (!importedSchedules.length) return;
    try {
      const rows = state.imports?.airingsRows?.length ? state.imports.airingsRows : await App.data.fetchImportedAirings();
      if (!Array.isArray(rows) || !rows.length) return;
      const dirtySchedules = [];
      const summary = mergeImportedRowsIntoSchedules(rows, { rebuild: false, activateFirst: false, dirtySchedules });
      if ((summary.placementsCreated || summary.restoredPlacements || summary.reboundPlacements) && dirtySchedules.length) {
        for (const schedule of dirtySchedules) {
          await persistSchedules(schedule);
        }
      }
    } catch (error) {
      console.warn('Imported schedule auto-heal failed.', error);
    }
  }

  function scheduleWarmupDelay(defer = true) {
    if (!defer) return Promise.resolve();
    return new Promise((resolve) => {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(resolve, { timeout: 1600 });
        return;
      }
      window.setTimeout(resolve, 350);
    });
  }

  async function warmup(options = {}) {
    const defer = options.defer !== false;
    const renderHidden = options.renderHidden !== false;
    if (state.schedulingReady) {
      ensureCurrentScheduleApplied();
      renderHomeDriveSummary();
      if (renderHidden) renderAll();
      return true;
    }
    if (state.schedulingWarmupPromise) return state.schedulingWarmupPromise;

    state.schedulingWarmupPromise = (async () => {
      await scheduleWarmupDelay(defer);
      if (!state.schedulingReady) await loadSchedules();
      ensureCurrentScheduleApplied();
      renderHomeDriveSummary();
      if (renderHidden) renderAll();
      return true;
    })().finally(() => {
      state.schedulingWarmupPromise = null;
    });

    return state.schedulingWarmupPromise;
  }

  async function ensureReady() {
    if (!state.schedulingReady) {
      if (state.schedulingWarmupPromise) await state.schedulingWarmupPromise;
      else await warmup({ defer: false, renderHidden: false });
    }
    ensureCurrentScheduleApplied();
    renderHomeDriveSummary();
    renderAll();

    if (!state.performance?.ready && !state.scheduleExpectationLoading && App.performanceUi?.refreshData) {
      requestScheduleExpectationData();
    }

    void healImportedSchedulesIfNeeded()
      .then(() => {
        ensureCurrentScheduleApplied();
        if (state.activeWorkspace === 'scheduling') renderAll();
      })
      .catch((error) => {
        console.warn('Imported schedule auto-heal failed.', error);
      });
  }

  async function persistSchedules(schedule) {
    state.scheduleSlotRescueCache = {};
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
    state.scheduleSlotRescueCache = {};
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

  function createScheduleRecord({ title, startDate, endDate, dayStartHour, dayEndHour, dayStartMinutes, dayEndMinutes, onlineDollars = 0, mailDollars = 0, goalDollars = 0, meta = {} }) {
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
      goalDollars: Number(goalDollars || 0) || 0,
      meta: meta || {}
    };
  }

  const importedBroadcastHydration = new Map();
  const importedScheduleTotalsHydration = new Map();

  function importedRowsForSchedule(schedule = {}, rows = []) {
    const startKey = utils.normalizeText(schedule?.startDate);
    const endKey = utils.normalizeText(schedule?.endDate);
    if (!(startKey && endKey)) return [];
    return (Array.isArray(rows) ? rows : []).filter((row) => {
      const dateKey = importedRowDateKey(row);
      return dateKey && dateKey >= startKey && dateKey <= endKey;
    });
  }

  function importedTotalsSignature(schedule = {}, rows = []) {
    const latestStamp = (Array.isArray(rows) ? rows : []).reduce((latest, row) => {
      const stamp = utils.normalizeText(row?.updated_at || row?.created_at || row?.imported_at || '');
      return stamp > latest ? stamp : latest;
    }, '');
    return [
      utils.normalizeText(schedule?.id),
      utils.normalizeText(schedule?.startDate),
      utils.normalizeText(schedule?.endDate),
      String(Array.isArray(rows) ? rows.length : 0),
      latestStamp
    ].join('|');
  }

  function applyImportedTotalsToSchedule(schedule = {}, totals = {}, signature = '') {
    if (!schedule) return false;
    const currentMeta = schedule.meta || {};
    const nextMeta = {
      ...currentMeta,
      importedBroadcastTotalDollars: Number(totals.importedBroadcastTotalDollars || 0) || 0,
      importedProgramSpecificBroadcastTotalDollars: Number(totals.importedProgramSpecificBroadcastTotalDollars || 0) || 0,
      importedNonSpecificBroadcastTotalDollars: Number(totals.importedNonSpecificBroadcastTotalDollars || 0) || 0,
      importedPledgesTotal: Number(totals.importedPledgesTotal || 0) || 0,
      reportedBroadcastTotalDollars: Number(totals.reportedBroadcastTotalDollars || 0) || Number(currentMeta.reportedBroadcastTotalDollars || 0) || 0,
      importedTotalsHydratedFromAirings: true,
      importedTotalsHydratedAt: new Date().toISOString(),
      importedTotalsHydratedSignature: signature
    };
    const changed = JSON.stringify(currentMeta) !== JSON.stringify(nextMeta);
    schedule.meta = nextMeta;
    schedule.__importedTotalsSignature = signature;
    return changed;
  }

  async function ensureScheduleImportedTotals(schedule = {}) {
    if (!schedule?.id || !(schedule.startDate && schedule.endDate)) return;
    const key = utils.normalizeText(schedule.id);
    if (importedScheduleTotalsHydration.has(key)) return importedScheduleTotalsHydration.get(key);
    const task = (async () => {
      try {
        const rows = await ensureScheduleImportedAiringsLoaded();
        const signature = importedTotalsSignature(schedule, rows);
        if (schedule.__importedTotalsSignature === signature || schedule?.meta?.importedTotalsHydratedSignature === signature) return;
        const relevantRows = importedRowsForSchedule(schedule, rows);
        const totals = summarizeImportedRows(relevantRows);
        const changed = applyImportedTotalsToSchedule(schedule, totals, signature);
        if (changed) {
          renderScheduleForm();
          renderHomeDriveSummary();
          renderScheduledProgramDetails();
        }
      } catch (error) {
        console.warn('Unable to hydrate schedule totals from imported airings.', error);
      } finally {
        importedScheduleTotalsHydration.delete(key);
      }
    })();
    importedScheduleTotalsHydration.set(key, task);
    return task;
  }

  function placementBroadcastTotal(schedule = {}) {
    return (schedule?.placements || []).reduce((sum, placement) => {
      const value = Number(placement?.importedBroadcastDollars);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }

  function importedRowIsNonSpecific(row = {}) {
    return utils.isNonSpecificRow(row);
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

  function scheduleGoalTotal(schedule = {}) {
    return Number(schedule?.goalDollars || schedule?.goal || 0) || 0;
  }

  function scheduleGoalDifference(schedule = {}) {
    // Difference is over/under goal: positive means ahead of goal, negative means short.
    return scheduleGrandTotal(schedule) - scheduleGoalTotal(schedule);
  }

  function goalDifferenceTone(value = 0) {
    const numeric = Number(value || 0) || 0;
    if (numeric < 0) return 'negative';
    if (numeric > 0) return 'positive';
    return 'neutral';
  }

  function applyGoalDifferenceClass(node, value = 0) {
    if (!node) return;
    node.classList.remove('goal-difference-positive', 'goal-difference-negative', 'goal-difference-neutral');
    node.classList.add(`goal-difference-${goalDifferenceTone(value)}`);
  }

  function localTodayKey() {
    const now = new Date();
    return utils.dateKeyFromDate ? utils.dateKeyFromDate(now) : now.toISOString().slice(0, 10);
  }

  function scheduleDriveSummaryWindow(schedule = {}) {
    const span = getScheduleDateSpanInfo(schedule);
    if (!span.ok) return { show: false, mode: '', endOfWindow: '' };
    const today = localTodayKey();
    const startKey = utils.normalizeText(schedule.startDate);
    const endKey = utils.normalizeText(schedule.endDate);
    const endOfWindow = utils.plusDays ? utils.plusDays(endKey, 7) : endKey;
    if (today >= startKey && today <= endKey) return { show: true, mode: 'Live drive', endOfWindow };
    if (today > endKey && today <= endOfWindow) return { show: true, mode: 'Post-drive week', endOfWindow };
    return { show: false, mode: '', endOfWindow };
  }

  function getDriveSummarySchedule() {
    const active = getActiveSchedule();
    if (active && scheduleDriveSummaryWindow(active).show) return active;
    return sortSchedulesNewestFirst(state.schedules || []).find((schedule) => scheduleDriveSummaryWindow(schedule).show) || null;
  }

  function scheduleBroadcastUpdateStats(schedule = {}) {
    const placements = Array.isArray(schedule?.placements) ? schedule.placements : [];
    const counted = placements.filter((placement) => {
      if (!placement || placement.isNonPledge) return false;
      if (placementLooksNonSpecific(placement)) return false;
      return Boolean(utils.normalizeText(placement.programTitle || '') || placement.programId);
    });
    const total = counted.length;
    const loaded = Boolean(state.scheduleAiringHistoryLoaded) || counted.some((placement) => placement?.importedFromReport || placement?.sourceAiringHash || Number(placement?.importedBroadcastDollars || 0) > 0);
    if (!total) return { total: 0, updated: 0, loading: false, label: '0 of 0 broadcasts updated' };
    if (!loaded) return { total, updated: 0, loading: true, label: 'checking broadcast updates…' };
    const updated = counted.reduce((sum, placement) => {
      return sum + (placementHasImportedAiring(placement, placement.dateKey, placement.startMinutes) ? 1 : 0);
    }, 0);
    return { total, updated, loading: false, label: `${utils.formatCount(updated)} of ${utils.formatCount(total)} broadcasts updated` };
  }

  function renderHomeDriveSummary() {
    const box = els.homeDriveSummary || document.getElementById('home-drive-summary');
    if (!box) return;
    const schedule = getDriveSummarySchedule();
    if (!schedule) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    const windowInfo = scheduleDriveSummaryWindow(schedule);
    const driveTitle = [windowInfo.mode, schedule.title || 'Loaded fundraiser'].filter(Boolean).join(' — ');
    const updateStats = scheduleBroadcastUpdateStats(schedule);
    const goalDifference = scheduleGoalDifference(schedule);
    const values = [
      { label: 'Broadcast $', value: utils.formatMoney(scheduleBroadcastTotal(schedule)) },
      { label: 'Pledges', value: utils.formatCount(scheduleImportedPledgesTotal(schedule)) },
      { label: 'Online $', value: utils.formatMoney(Number(schedule.onlineDollars || 0) || 0) },
      { label: 'Mail $', value: utils.formatMoney(Number(schedule.mailDollars || 0) || 0) },
      { label: 'Non-Specific $', value: utils.formatMoney(scheduleImportedNonSpecificTotal(schedule)) },
      { label: 'Total Raised $', value: utils.formatMoney(scheduleGrandTotal(schedule)) },
      { label: 'Goal', value: utils.formatMoney(scheduleGoalTotal(schedule)) },
      { label: 'Difference', value: utils.formatMoney(goalDifference), tone: goalDifferenceTone(goalDifference) }
    ];
    box.innerHTML = `
      <div class="home-drive-summary-head">
        <div class="home-drive-summary-title-wrap">
          <div class="home-drive-summary-title-line">
            <span class="home-drive-summary-title">${utils.escapeHtml(driveTitle)}</span>
            <span class="home-drive-summary-coverage ${updateStats.loading ? 'loading' : ''}">${utils.escapeHtml(updateStats.label)}</span>
          </div>
        </div>
        <div class="home-drive-summary-date">${utils.escapeHtml(utils.formatDate(schedule.startDate))} – ${utils.escapeHtml(utils.formatDate(schedule.endDate))}</div>
      </div>
      <div class="home-drive-summary-grid">
        ${values.map((item) => `
          <div class="home-drive-summary-card ${item.tone ? `goal-difference-card goal-difference-${item.tone}` : ''}">
            <div class="home-drive-summary-label">${utils.escapeHtml(item.label)}</div>
            <div class="home-drive-summary-value ${item.tone ? `goal-difference-value goal-difference-${item.tone}` : ''}">${utils.escapeHtml(item.value)}</div>
          </div>
        `).join('')}
      </div>
    `;
    box.classList.remove('hidden');
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
    const lengthMinutes = Math.max(1, Number(scheduledPlacementRuntimeMinutes(placement) || placement.lengthMinutes || 30));
    const displayEndMinutes = displayStartMinutes + Math.max(constants.DEFAULT_SLOT_MINUTES, Math.ceil(lengthMinutes / constants.DEFAULT_SLOT_MINUTES) * constants.DEFAULT_SLOT_MINUTES);
    return {
      ...placement,
      lengthMinutes,
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

  function importedNolaCodeKey(value = '') {
    if (typeof utils.nolaCodeKey === 'function') return utils.nolaCodeKey(value);
    return utils.normalizeText(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function importedNaturalKey(row = {}) {
    const canonicalProgramId = String(utils.firstNonEmpty(row.program_id, row.pledge_program_id, row.manual_match_program_id, '') || '').trim();
    const identity = canonicalProgramId
      ? `program_id:${canonicalProgramId}`
      : (utils.nolaIdentityKey(
          row.nola_code || row.nola || row.program_nola || '',
          row.program_title || row.imported_program_title || row.title || row.name || ''
        ) || utils.normalizeLookupKey(row.program_title || row.imported_program_title || row.title || row.name || ''));
    return [
      identity,
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

  function findBestSameRangeScheduleForImportedGroup(group = {}) {
    const candidates = (state.schedules || []).filter((item) => {
      return utils.normalizeText(item?.startDate) === utils.normalizeText(group?.startDate)
        && utils.normalizeText(item?.endDate) === utils.normalizeText(group?.endDate);
    });
    if (!candidates.length) return null;
    return [...candidates].sort((a, b) => scheduleSameRangePreferenceScore(b) - scheduleSameRangePreferenceScore(a))[0] || null;
  }


  function getProgramLookupCache() {
    const rawRows = Array.isArray(state.rawRows) ? state.rawRows : [];
    const baseRows = Array.isArray(state.baseRows) ? state.baseRows : [];
    const cacheKeySource = `${rawRows.length}|${baseRows.length}|${rawRows === cachedProgramLookupRows?.raw ? 'same' : 'raw'}|${baseRows === cachedProgramLookupRows?.base ? 'same' : 'base'}`;
    if (cachedProgramLookup && cachedProgramLookupRows && cachedProgramLookupRows.key === cacheKeySource && cachedProgramLookupRows.raw === rawRows && cachedProgramLookupRows.base === baseRows) return cachedProgramLookup;
    const byProgramId = new Map();
    const byNola = new Map();
    const byTitle = new Map();
    [...rawRows, ...baseRows].forEach((item) => {
      const programId = String(derive.programId(item) || '').trim();
      if (programId && !byProgramId.has(programId)) byProgramId.set(programId, item);
      const nolaKey = utils.normalizeLookupKey(derive.nola(item));
      if (nolaKey && !byNola.has(nolaKey)) byNola.set(nolaKey, item);
      const titleKey = utils.normalizeLookupKey(derive.title(item));
      if (titleKey && !byTitle.has(titleKey)) byTitle.set(titleKey, item);
    });
    cachedProgramLookupRows = { raw: rawRows, base: baseRows, key: cacheKeySource };
    cachedProgramLookup = { byProgramId, byNola, byTitle };
    return cachedProgramLookup;
  }

  function findProgramRowForImportedAiring(row = {}) {
    const lookup = getProgramLookupCache();
    const candidateIds = [
      row.pledge_program_id,
      row.program_id,
      row.manual_match_program_id,
      row.pending_manual_match_program_id,
      row.pending_link_program_id
    ].map((value) => String(value || '').trim()).filter(Boolean);
    for (const programId of candidateIds) {
      if (programId && lookup.byProgramId.has(programId)) return lookup.byProgramId.get(programId);
    }
    const wantedNola = importedNolaCodeKey(utils.firstNonEmpty(row.nola_code, row.nola, row.program_nola, ''));
    if (wantedNola && lookup.byNola.has(wantedNola)) return lookup.byNola.get(wantedNola);
    const titleCandidates = [row.matched_library_title, row.program_title, row.imported_program_title, row.title, row.name]
      .map((value) => utils.normalizeLookupKey(value))
      .filter(Boolean);
    for (const wantedTitle of titleCandidates) {
      if (wantedTitle && lookup.byTitle.has(wantedTitle)) return lookup.byTitle.get(wantedTitle);
    }
    return null;
  }

  function importedPlacementTitle(row = {}, sourceRow = null) {
    return utils.normalizeText(
      derive.title(sourceRow)
      || utils.firstNonEmpty(row.matched_library_title, row.program_title, row.imported_program_title, row.title, row.name, '')
    );
  }

  function importedPlacementLookupId(row = {}, sourceRow = null) {
    const direct = String(derive.programId(sourceRow) || utils.firstNonEmpty(row.pledge_program_id, row.program_id, '') || '').trim();
    if (direct) return direct;
    const titleKey = utils.normalizeLookupKey(importedPlacementTitle(row, sourceRow));
    const nolaKey = utils.normalizeLookupKey(utils.firstNonEmpty(row.nola_code, row.nola, row.program_nola, ''));
    if (!(titleKey || nolaKey)) return '';
    return `lookup:${titleKey}|${nolaKey}`;
  }

  function canBuildImportedPlacement(prepared = {}) {
    const row = prepared?.row || prepared || {};
    const sourceRow = prepared?.sourceRow || findProgramRowForImportedAiring(row);
    return Boolean(importedPlacementTitle(row, sourceRow));
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
    const programTitle = importedPlacementTitle(row, sourceRow);
    if (!programTitle || !dateKey || !Number.isFinite(startMinutes)) return null;
    const { lengthMinutes, correctedFromLibrary } = resolveImportedPlacementLength(row, sourceRow);
    const endMinutes = startMinutes + Math.max(constants.DEFAULT_SLOT_MINUTES, Math.ceil(lengthMinutes / constants.DEFAULT_SLOT_MINUTES) * constants.DEFAULT_SLOT_MINUTES);
    const resolvedProgramId = importedPlacementLookupId(row, sourceRow);
    return {
      id: utils.makeId('place'),
      programId: resolvedProgramId,
      programTitle,
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
      sourceLabel: sourceRow ? 'Imported report' : 'Imported report (title-only)',
      transferredToStation: false,
      importedFromReport: true,
      importedBroadcastDollars: Number(row.dollars || 0) || 0,
      sourceAiringHash: row.row_hash || '',
      sourceImportBatchId: row.import_batch_id || '',
      importedFundraiserKey: importedScheduleKey(row),
      fundraiserLabel: importedFundraiserLabel(row),
      importMatchMethod: utils.normalizeText(row.match_method || ''),
      importMatchReason: utils.normalizeText(row.match_reason || ''),
      titleMismatchFlag: Boolean(row.title_mismatch_flag),
      nolaCode: utils.firstNonEmpty(row.nola_code, row.nola, row.program_nola, '') || ''
    };
  }

  function importedPlacementLooksLikeRow(placement = {}, prepared = {}) {
    const row = prepared?.row || prepared || {};
    const sourceRow = prepared?.sourceRow || findProgramRowForImportedAiring(row);
    if (!placement || !row) return false;
    const wantedHash = String(row?.row_hash || '').trim();
    if (wantedHash && String(placement?.sourceAiringHash || '').trim() === wantedHash) return true;
    const wantedDate = prepared?.dateKey || importedRowDateKey(row);
    const wantedStart = Number.isFinite(prepared?.startMinutes) ? prepared.startMinutes : importedRowStartMinutes(row);
    if (!wantedDate || !Number.isFinite(wantedStart)) return false;
    if (utils.normalizeText(placement?.dateKey) !== utils.normalizeText(wantedDate)) return false;
    if (Number(placement?.startMinutes || NaN) !== Number(wantedStart)) return false;
    const placementId = String(placement?.programId || '').trim();
    const wantedProgramId = importedPlacementLookupId(row, sourceRow);
    if (placementId && wantedProgramId && placementId === wantedProgramId) return true;
    const wantedTitleKey = utils.normalizeLookupKey(importedPlacementTitle(row, sourceRow));
    const placementTitleKey = utils.normalizeLookupKey(placement?.programTitle || '');
    if (wantedTitleKey && placementTitleKey && wantedTitleKey === placementTitleKey) return true;
    const wantedNola = utils.normalizeLookupKey(utils.firstNonEmpty(row?.nola_code, row?.nola, row?.program_nola, ''));
    const placementNola = utils.normalizeLookupKey(utils.firstNonEmpty(placement?.nolaCode, placement?.nola, ''));
    return Boolean(wantedNola && placementNola && wantedNola === placementNola);
  }

  function reconcileImportedScheduleCoverage(schedule = {}, preparedRows = [], groupKey = '') {
    const placements = Array.isArray(schedule?.placements) ? schedule.placements : [];
    let restoredPlacements = 0;
    let reboundPlacements = 0;
    let unresolvedCollisions = 0;
    (Array.isArray(preparedRows) ? preparedRows : []).forEach((prepared) => {
      const placement = buildPlacementFromImportedAiring(prepared);
      if (!placement) return;
      const wantedHash = String(placement?.sourceAiringHash || '').trim();
      if (wantedHash && placements.some((item) => String(item?.sourceAiringHash || '').trim() === wantedHash)) return;
      const legacyIndex = placements.findIndex((item) => importedPlacementLooksLikeRow(item, prepared));
      if (legacyIndex >= 0) {
        const existing = placements[legacyIndex] || {};
        placements[legacyIndex] = {
          ...existing,
          ...placement,
          id: existing.id || placement.id,
          liveBreakFlag: hasLiveBreakFlag(existing),
          liveBreakNotes: existing.liveBreakNotes || '',
          isNonPledge: Boolean(existing.isNonPledge),
          transferredToStation: Boolean(existing.transferredToStation),
          importedBroadcastDollars: Number(placement.importedBroadcastDollars || 0) || 0,
          importedFundraiserKey: utils.normalizeText(groupKey || placement.importedFundraiserKey || ''),
          sourceAiringHash: placement.sourceAiringHash || existing.sourceAiringHash || ''
        };
        reboundPlacements += 1;
        return;
      }
      const slotCollisionIndex = placements.findIndex((item) => {
        if (!item?.importedFromReport) return false;
        return utils.normalizeText(item?.dateKey) === utils.normalizeText(placement?.dateKey)
          && Number(item?.startMinutes || NaN) === Number(placement?.startMinutes || NaN);
      });
      if (slotCollisionIndex >= 0) {
        const existing = placements[slotCollisionIndex] || {};
        const existingHash = String(existing?.sourceAiringHash || '').trim();
        const sameTitle = utils.normalizeLookupKey(existing?.programTitle || '') === utils.normalizeLookupKey(placement?.programTitle || '');
        const existingImportedKey = utils.normalizeText(existing?.importedFundraiserKey || '');
        const wantedImportedKey = utils.normalizeText(groupKey || placement?.importedFundraiserKey || '');
        if (!existingHash || sameTitle || (existingImportedKey && wantedImportedKey && existingImportedKey !== wantedImportedKey)) {
          placements[slotCollisionIndex] = {
            ...existing,
            ...placement,
            id: existing.id || placement.id,
            liveBreakFlag: hasLiveBreakFlag(existing),
            liveBreakNotes: existing.liveBreakNotes || '',
            isNonPledge: Boolean(existing.isNonPledge),
            transferredToStation: Boolean(existing.transferredToStation),
            importedBroadcastDollars: Number(placement.importedBroadcastDollars || 0) || 0,
            importedFundraiserKey: wantedImportedKey || existingImportedKey,
            sourceAiringHash: placement.sourceAiringHash || existing.sourceAiringHash || ''
          };
          reboundPlacements += 1;
          return;
        }
        unresolvedCollisions += 1;
        return;
      }
      placements.push(placement);
      restoredPlacements += 1;
    });
    schedule.placements = placements;
    return { restoredPlacements, reboundPlacements, unresolvedCollisions };
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
      if (!canBuildImportedPlacement(entry)) reasons.push('no_library_match');
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
    const preparedRows = groupedRows.filter((entry) => !entry.isNonSpecific && canBuildImportedPlacement(entry) && entry.dateKey && Number.isFinite(importedRowStartMinutes(entry.row))).map((entry) => ({
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
    let restoredPlacements = 0;
    let reboundPlacements = 0;
    let unresolvedCollisions = 0;
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
        schedule = findBestSameRangeScheduleForImportedGroup(group);
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
      const scheduleableRows = group.rows.filter((entry) => !entry?.isNonSpecific && canBuildImportedPlacement(entry) && entry?.dateKey && Number.isFinite(importedRowStartMinutes(entry.row)));
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
              liveBreakFlag: hasLiveBreakFlag(existingPlacement),
              liveBreakNotes: existingPlacement.liveBreakNotes || '',
              isNonPledge: Boolean(existingPlacement.isNonPledge),
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
      const coverage = reconcileImportedScheduleCoverage(schedule, scheduleableRows, group.key);
      restoredPlacements += Number(coverage?.restoredPlacements || 0) || 0;
      reboundPlacements += Number(coverage?.reboundPlacements || 0) || 0;
      unresolvedCollisions += Number(coverage?.unresolvedCollisions || 0) || 0;
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
      restoredPlacements,
      reboundPlacements,
      unresolvedCollisions,
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
    state.scheduleDraft.goalDollars = Number(schedule.goalDollars || 0) || 0;
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
      return { ...placement, isFirstRun: prior === 0, repeatIndex: prior + 1, __sourcePlacement: placement };
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
    const parsed = normalizePlacementBoolean(placement?.liveBreakFlag, null);
    if (parsed === true) return true;
    if (parsed === false) return false;
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
    const rows = normalizeScheduledTimingRows(timings);
    if (!rows.length) return 'Break timings: TBD';
    const summaries = rows
      .map((entry) => [
        entry.label,
        `Program ${Number.isFinite(entry.programSeconds) ? utils.formatSeconds(entry.programSeconds) : '—'}`,
        `Break ${Number.isFinite(entry.breakSeconds) ? utils.formatSeconds(entry.breakSeconds) : 'TBD'}`,
        `Local Cut In ${Number.isFinite(entry.localCutInSeconds) ? utils.formatSeconds(entry.localCutInSeconds) : 'TBD'}`,
        entry.note || ''
      ].filter(Boolean).join(' | '))
      .map((value) => utils.normalizeText(value))
      .filter(Boolean);
    if (summaries.length) {
      const preview = summaries.slice(0, 4).join(' | ');
      const suffix = summaries.length > 4 ? ` | +${summaries.length - 4} more` : '';
      return `Break timings: ${preview}${suffix}`;
    }
    return timingLocalCutinSummary(timings);
  }

  function timingExportLines(timings = []) {
    const rows = normalizeScheduledTimingRows(timings);
    if (!rows.length) return ['Break timings: TBD'];
    const actLabelWidth = Math.max(5, ...rows.map((entry) => String(entry.label || '').length));
    return ['Break timings:'].concat(rows.map((entry) => {
      const label = String(entry.label || 'Act').padEnd(actLabelWidth, ' ');
      const program = Number.isFinite(entry.programSeconds) ? utils.formatSeconds(entry.programSeconds) : '—';
      const breakValue = Number.isFinite(entry.breakSeconds) ? utils.formatSeconds(entry.breakSeconds) : 'TBD';
      const localValue = Number.isFinite(entry.localCutInSeconds) ? utils.formatSeconds(entry.localCutInSeconds) : 'TBD';
      const note = entry.note ? ` | ${entry.note}` : '';
      return `  ${label} | Program ${program} | Break ${breakValue} | Local Cut In ${localValue}${note}`;
    }));
  }

  function historyGroupKey(row = {}) {
    return utils.normalizeLookupKey([
      row?.fundraiser_label || row?.drive_label || row?.drive_column || '',
      row?.drive_start_date || row?.drive_date || row?.air_date || utils.dateKeyFromDate(row?.aired_at) || '',
      row?.drive_end_date || ''
    ].join('|'));
  }

  function historicalFundraiserCount(row = {}, detail = null) {
    const direct = Number(utils.firstNonEmpty(
      row?.fundraiser_count,
      row?.drive_count,
      row?.fundraiser_total,
      row?.historical_fundraiser_count
    ) || 0) || 0;
    if (direct > 0) return direct;
    const groups = new Set();
    const driveResults = Array.isArray(detail?.driveResults) ? detail.driveResults : [];
    const airings = Array.isArray(detail?.airings) ? detail.airings : [];
    driveResults.forEach((entry) => {
      const key = historyGroupKey(entry);
      if (key) groups.add(key);
    });
    airings.forEach((entry) => {
      const key = historyGroupKey(entry);
      if (key) groups.add(key);
    });
    return groups.size;
  }

  function historicalAiringHistoryLines(detail = null) {
    const airings = Array.isArray(detail?.airings) ? detail.airings : [];
    const driveResults = Array.isArray(detail?.driveResults) ? detail.driveResults : [];
    const rows = airings.length ? airings : driveResults;
    const seen = new Set();
    const values = [];
    rows.forEach((row) => {
      const when = utils.rowLocalDateTime(row, { preferDriveFallback: !airings.length });
      const label = utils.rowDisplayDateTime(row, '', { preferDriveFallback: !airings.length });
      const normalized = utils.normalizeText(label);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      values.push({ label: normalized, sortTs: when instanceof Date && !Number.isNaN(when.getTime()) ? when.getTime() : Number.MAX_SAFE_INTEGER });
    });
    return values.sort((a, b) => a.sortTs - b.sortTs || a.label.localeCompare(b.label)).map((entry) => entry.label);
  }

  async function ensureScheduleExportDetails(rows = []) {
    const programIds = [...new Set((Array.isArray(rows) ? rows : [])
      .filter((item) => !item?.isNonPledge && item?.programId)
      .map((item) => String(item.programId || '').trim())
      .filter(Boolean))];
    if (!state.client || !programIds.length) return;
    await ensureScheduledDetailsBatch(programIds);
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


  function importedSlotMinute(row = {}) {
    const direct = utils.normalizeText(row.air_time);
    if (direct) {
      const match = direct.match(/^(\d{1,2})(?::?(\d{2}))?/);
      if (match) return (Number(match[1]) * 60) + Number(match[2] || 0);
    }
    const stamp = row.aired_at ? new Date(row.aired_at) : null;
    if (stamp && !Number.isNaN(stamp.getTime())) return (stamp.getHours() * 60) + stamp.getMinutes();
    return null;
  }

  function addImportedSlotKey(map, dateKey, startMinutes, kind, value) {
    const normalizedValue = kind === 'nola' ? importedNolaCodeKey(value) : utils.normalizeLookupKey(value);
    const date = utils.normalizeText(dateKey);
    if (!date || !Number.isFinite(Number(startMinutes)) || !kind || !normalizedValue) return;
    map.add(`${date}|${Number(startMinutes)}|${kind}:${normalizedValue}`);
  }

  function buildScheduleImportedSlotMap(rows = []) {
    const map = new Set();
    (rows || []).forEach((row) => {
      const dateKey = utils.normalizeText(row.air_date) || utils.dateKeyFromDate(row.aired_at) || '';
      const startMinutes = importedSlotMinute(row);
      if (!dateKey || !Number.isFinite(startMinutes)) return;
      addImportedSlotKey(map, dateKey, startMinutes, 'id', row.program_id || row.pledge_program_id || row.manual_match_program_id);
      addImportedSlotKey(map, dateKey, startMinutes, 'nola', row.nola_code || row.nola || row.program_nola);
      addImportedSlotKey(map, dateKey, startMinutes, 'title', row.matched_library_title || row.program_title || row.title || row.imported_program_title || row.name);
      addImportedSlotKey(map, dateKey, startMinutes, 'imported', row.imported_program_title || row.program_title || row.title || row.name);
    });
    return map;
  }

  function placementHasImportedAiring(placement = {}, dateKey = '', startMinutes = null) {
    if (!placement || placement.isNonPledge) return false;
    if (placement.importedFromReport || Number(placement.importedBroadcastDollars || 0) > 0 || placement.sourceAiringHash) return true;
    const map = state.scheduleImportedSlotMap;
    if (!(map instanceof Set) || !map.size) return false;
    const row = getProgramRowById(placement.programId) || {};
    const date = utils.normalizeText(dateKey || placement.dateKey);
    const minutes = Number.isFinite(Number(startMinutes)) ? Number(startMinutes) : Number(placement.startMinutes || 0);
    const candidates = [
      ['id', placement.programId || derive.programId(row)],
      ['nola', placement.nolaCode || placement.nola || derive.nola(row)],
      ['title', placement.programTitle || derive.title(row)]
    ];
    return candidates.some(([kind, value]) => {
      const normalizedValue = kind === 'nola' ? importedNolaCodeKey(value) : utils.normalizeLookupKey(value);
      return normalizedValue && map.has(`${date}|${minutes}|${kind}:${normalizedValue}`);
    });
  }

  async function ensureScheduleAiringHistoryLoaded() {
    if (state.scheduleAiringHistoryLoading || state.scheduleAiringHistoryLoaded) return;
    state.scheduleAiringHistoryLoading = true;
    try {
      const rows = await App.data.fetchImportedAirings();
      state.scheduleAiringHistoryMap = buildScheduleAiringHistoryMap(rows || []);
      state.scheduleImportedSlotMap = buildScheduleImportedSlotMap(rows || []);
      state.scheduleAiringHistoryLoaded = true;
    } catch (error) {
      console.warn('Could not load scheduler airing history.', error);
      state.scheduleAiringHistoryMap = {};
      state.scheduleImportedSlotMap = new Set();
      state.scheduleAiringHistoryLoaded = true;
    } finally {
      state.scheduleAiringHistoryLoading = false;
      if (getActiveSchedule()) {
        renderScheduleGrid();
        renderHomeDriveSummary();
      }
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

  async function ensureScheduleImportedAiringsLoaded() {
    if (Array.isArray(state.scheduleImportedAiringsCache)) return state.scheduleImportedAiringsCache;
    if (state.scheduleImportedAiringsPromise) return state.scheduleImportedAiringsPromise;
    state.scheduleImportedAiringsPromise = (async () => {
      try {
        const rows = await App.data.fetchImportedAirings();
        state.scheduleImportedAiringsCache = Array.isArray(rows) ? rows : [];
      } catch (error) {
        console.warn('Could not load imported airings for slot rescue.', error);
        state.scheduleImportedAiringsCache = [];
      } finally {
        state.scheduleImportedAiringsPromise = null;
      }
      return state.scheduleImportedAiringsCache;
    })();
    return state.scheduleImportedAiringsPromise;
  }

  function scheduleImportedPlacementByHash(schedule = {}, rowHash = '') {
    const wanted = String(rowHash || '').trim();
    if (!wanted) return null;
    return (schedule?.placements || []).find((placement) => String(placement?.sourceAiringHash || '') === wanted) || null;
  }

  function scheduleImportedFundraiserKeys(schedule = {}) {
    const values = new Set();
    const metaKey = utils.normalizeText(schedule?.meta?.importedFundraiserKey);
    if (metaKey) values.add(metaKey.toLowerCase());
    (schedule?.placements || []).forEach((placement) => {
      const next = utils.normalizeText(placement?.importedFundraiserKey);
      if (next) values.add(next.toLowerCase());
    });
    return values;
  }

  function scheduleImportedPlacementFiles(schedule = {}) {
    return new Set((schedule?.placements || []).map((placement) => utils.normalizeLookupKey(placement?.sourceName || '')).filter(Boolean));
  }

  function rowDateWithinSchedule(dateKey = '', schedule = {}) {
    const normalized = utils.normalizeText(dateKey);
    if (!normalized || !schedule?.startDate || !schedule?.endDate) return false;
    return normalized >= utils.normalizeText(schedule.startDate) && normalized <= utils.normalizeText(schedule.endDate);
  }

  function importedRowBelongsToSchedule(row = {}, schedule = {}) {
    const rowDateKey = importedRowDateKey(row);
    if (!rowDateWithinSchedule(rowDateKey, schedule)) return false;
    const importedKeys = scheduleImportedFundraiserKeys(schedule);
    const rowKey = importedScheduleKey(row);
    if (rowKey && importedKeys.has(String(rowKey).toLowerCase())) return true;
    const placementFiles = scheduleImportedPlacementFiles(schedule);
    const rowFileKey = utils.normalizeLookupKey(row?.source_file_name || '');
    if (rowFileKey && placementFiles.has(rowFileKey)) return true;
    if (!importedKeys.size && !placementFiles.size) return true;
    const driveStart = utils.normalizeText(row?.drive_start_date || rowDateKey);
    const driveEnd = utils.normalizeText(row?.drive_end_date || rowDateKey || driveStart);
    if (driveStart && driveEnd && schedule?.startDate && schedule?.endDate) {
      const overlaps = driveStart <= utils.normalizeText(schedule.endDate) && driveEnd >= utils.normalizeText(schedule.startDate);
      if (overlaps) return true;
    }
    return false;
  }

  function scheduleRescueCacheKey(schedule = {}, slot = {}) {
    return `${utils.normalizeText(schedule?.id || 'draft')}|${utils.normalizeText(slot?.dateKey)}|${String(Number(slot?.minutes || 0) || 0)}`;
  }

  function placementLookupIdLabel(placement = {}) {
    return String(placement?.programId || '').trim();
  }

  function describeSlotRescueCandidate(row = {}, schedule = {}, slot = {}, sourceRow = null) {
    const lines = [];
    const rowDateKey = importedRowDateKey(row);
    const rowMinutes = importedRowStartMinutes(row);
    const nonSpecific = importedRowIsNonSpecific(row);
    const alreadyLinked = scheduleImportedPlacementByHash(schedule, row?.row_hash || '');
    const preparedPlacement = buildPlacementFromImportedAiring({ row, sourceRow, dateKey: slot.dateKey, startMinutes: slot.minutes });
    const exactPlacement = buildPlacementFromImportedAiring({ row, sourceRow, dateKey: rowDateKey, startMinutes: rowMinutes });
    const importedKey = importedScheduleKey(row);
    const conflicting = exactPlacement
      ? (schedule?.placements || []).find((placement) => placement?.importedFromReport && placementSignature(placement, importedKey) === placementSignature(exactPlacement, importedKey) && String(placement?.sourceAiringHash || '') !== String(row?.row_hash || ''))
      : null;
    const fallbackOnly = !String(row?.pledge_program_id || row?.program_id || '').trim() && !derive.programId(sourceRow);
    const reasonSummary = nonSpecific
      ? 'Excluded as non-specific.'
      : (alreadyLinked
        ? `Currently linked to ${slotLabel(alreadyLinked.dateKey, alreadyLinked.startMinutes)}.`
        : 'Imported row exists, but no current calendar placement is linked to it.');
    if (nonSpecific) lines.push('This imported airing is classified as non-specific, so the normal importer excludes it from the schedule.');
    if (!rowDateKey) lines.push('The imported row does not have a usable date key.');
    if (!Number.isFinite(rowMinutes)) lines.push('The imported row does not have a usable start time.');
    if (!importedPlacementTitle(row, sourceRow)) lines.push('The imported row does not have a usable title for scheduling.');
    if (Number.isFinite(rowMinutes) && rowDateKey === slot?.dateKey && rowMinutes !== Number(slot?.minutes || 0)) {
      const delta = Math.abs(rowMinutes - Number(slot?.minutes || 0));
      lines.push(`The imported report time is ${utils.minutesToLabel(rowMinutes)}, which is ${delta} minute${delta === 1 ? '' : 's'} away from this slot.`);
    }
    if (alreadyLinked) lines.push(`This exact imported row hash is already attached to ${slotLabel(alreadyLinked.dateKey, alreadyLinked.startMinutes)}.`);
    if (conflicting) lines.push(`Another imported placement already occupies the same importer signature at ${slotLabel(conflicting.dateKey, conflicting.startMinutes)}.`);
    if (fallbackOnly) lines.push('It does not have a clean current library hit, so recovery uses the imported title fallback.');
    if (!lines.length && preparedPlacement) lines.push('This imported airing should be scheduleable, but the current schedule is not using it.');
    return {
      reasonSummary,
      lines,
      canPlace: Boolean(preparedPlacement) && !nonSpecific,
      alreadyLinked,
      fallbackOnly
    };
  }

  function buildSlotRescueCandidates(rows = [], schedule = {}, slot = {}) {
    const targetMinutes = Number(slot?.minutes || 0);
    const candidates = (Array.isArray(rows) ? rows : [])
      .filter((row) => importedRowBelongsToSchedule(row, schedule))
      .filter((row) => importedRowDateKey(row) === utils.normalizeText(slot?.dateKey || ''))
      .map((row) => {
        const rowMinutes = importedRowStartMinutes(row);
        if (!Number.isFinite(rowMinutes)) return null;
        const timeDelta = Math.abs(rowMinutes - targetMinutes);
        if (timeDelta > 60) return null;
        const sourceRow = importedRowIsNonSpecific(row) ? null : findProgramRowForImportedAiring(row);
        const title = importedPlacementTitle(row, sourceRow) || utils.normalizeText(row?.imported_program_title || row?.program_title || row?.title || row?.name || 'Untitled import');
        const matchLabel = timeDelta === 0 ? 'Exact imported day/time match' : `Same day, ${timeDelta} minute${timeDelta === 1 ? '' : 's'} off`;
        const diagnosis = describeSlotRescueCandidate(row, schedule, slot, sourceRow);
        return {
          row,
          sourceRow,
          title,
          timeDelta,
          matchLabel,
          diagnostics: diagnosis,
          dollars: Number(row?.dollars || 0) || 0,
          nola: utils.firstNonEmpty(row?.nola_code, row?.nola, row?.program_nola, ''),
          sourceFile: utils.normalizeText(row?.source_file_name || row?.sourceName || ''),
          currentTimeLabel: Number.isFinite(rowMinutes) ? utils.minutesToLabel(rowMinutes) : 'Unknown time'
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.timeDelta !== b.timeDelta) return a.timeDelta - b.timeDelta;
        if (a.diagnostics.canPlace !== b.diagnostics.canPlace) return a.diagnostics.canPlace ? -1 : 1;
        if (b.dollars !== a.dollars) return b.dollars - a.dollars;
        return utils.compareText(a.title, b.title);
      });
    const seen = new Set();
    return candidates.filter((entry) => {
      const key = `${utils.normalizeLookupKey(entry.title)}|${entry.currentTimeLabel}|${utils.normalizeText(entry.row?.row_hash || '')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  }

  async function ensureScheduleSlotRescueLoaded(schedule = {}, slot = {}) {
    const cacheKey = scheduleRescueCacheKey(schedule, slot);
    state.scheduleSlotRescueCache = state.scheduleSlotRescueCache || {};
    const existing = state.scheduleSlotRescueCache[cacheKey];
    if (existing?.loading || existing?.loaded) return existing;
    state.scheduleSlotRescueCache[cacheKey] = { loading: true, loaded: false, error: '', candidates: [] };
    if (!els.scheduleProgramModal?.classList.contains('hidden')) renderProgramPicker();
    try {
      const rows = await ensureScheduleImportedAiringsLoaded();
      state.scheduleSlotRescueCache[cacheKey] = {
        loading: false,
        loaded: true,
        error: '',
        candidates: buildSlotRescueCandidates(rows, schedule, slot)
      };
    } catch (error) {
      state.scheduleSlotRescueCache[cacheKey] = {
        loading: false,
        loaded: true,
        error: error?.message || 'Could not inspect imported airings for this slot.',
        candidates: []
      };
    }
    if (!els.scheduleProgramModal?.classList.contains('hidden')) renderProgramPicker();
    return state.scheduleSlotRescueCache[cacheKey];
  }

  function renderScheduleSlotRescue(schedule = {}, slot = {}, currentPlacement = null, editable = false) {
    if (!els.scheduleSlotRescue) return;
    if (currentPlacement || !editable) {
      els.scheduleSlotRescue.className = 'schedule-slot-rescue hidden';
      els.scheduleSlotRescue.innerHTML = '';
      return;
    }
    const cacheKey = scheduleRescueCacheKey(schedule, slot);
    state.scheduleSlotRescueCache = state.scheduleSlotRescueCache || {};
    const entry = state.scheduleSlotRescueCache[cacheKey];
    if (!entry) {
      els.scheduleSlotRescue.className = 'schedule-slot-rescue';
      els.scheduleSlotRescue.innerHTML = '<div class="schedule-hint">Checking imported report rows for this empty slot…</div>';
      void ensureScheduleSlotRescueLoaded(schedule, slot);
      return;
    }
    if (entry.loading) {
      els.scheduleSlotRescue.className = 'schedule-slot-rescue';
      els.scheduleSlotRescue.innerHTML = '<div class="schedule-hint">Checking imported report rows for this empty slot…</div>';
      return;
    }
    if (entry.error) {
      els.scheduleSlotRescue.className = 'schedule-slot-rescue';
      els.scheduleSlotRescue.innerHTML = `<div class="schedule-hint">${utils.escapeHtml(entry.error)}</div>`;
      return;
    }
    if (!entry.candidates?.length) {
      els.scheduleSlotRescue.className = 'schedule-slot-rescue';
      els.scheduleSlotRescue.innerHTML = '<div class="schedule-hint">No imported report rows matched this day/time closely enough to rescue.</div>';
      return;
    }
    els.scheduleSlotRescue.className = 'schedule-slot-rescue';
    els.scheduleSlotRescue.innerHTML = `
      <div class="schedule-slot-rescue-header">Possible imported matches for this empty slot</div>
      <div class="schedule-slot-rescue-list">${entry.candidates.map((candidate) => `
        <article class="schedule-slot-rescue-card ${candidate.diagnostics.canPlace ? '' : 'blocked'}">
          <div class="schedule-slot-rescue-main">
            <div class="schedule-slot-rescue-title-row">
              <strong>${utils.escapeHtml(candidate.title || 'Untitled import')}</strong>
              <span class="schedule-slot-rescue-chip">${utils.escapeHtml(candidate.matchLabel)}</span>
            </div>
            <div class="schedule-slot-rescue-meta">Imported ${utils.escapeHtml(candidate.currentTimeLabel)} · ${utils.escapeHtml(candidate.nola || 'No NOLA')} · ${utils.escapeHtml(utils.formatMoney(candidate.dollars || 0))}</div>
            <div class="schedule-slot-rescue-meta">${utils.escapeHtml(candidate.diagnostics.reasonSummary)}${candidate.sourceFile ? ` Source: ${utils.escapeHtml(candidate.sourceFile)}` : ''}</div>
            <div class="schedule-slot-rescue-detail hidden" data-rescue-detail="${utils.escapeHtml(String(candidate.row?.row_hash || ''))}">
              <ul>${candidate.diagnostics.lines.map((line) => `<li>${utils.escapeHtml(line)}</li>`).join('')}</ul>
            </div>
          </div>
          <div class="schedule-slot-rescue-actions">
            <button type="button" class="ghost tiny-button" data-rescue-toggle="${utils.escapeHtml(String(candidate.row?.row_hash || ''))}">View why missing</button>
            <button type="button" class="primary tiny-button" data-rescue-place="${utils.escapeHtml(String(candidate.row?.row_hash || ''))}" ${candidate.diagnostics.canPlace ? '' : 'disabled'}>${candidate.diagnostics.alreadyLinked ? 'Move here' : 'Place here'}</button>
          </div>
        </article>
      `).join('')}</div>
    `;
  }

  async function rescueImportedRowToSelectedSlot(rowHash = '') {
    if (!canScheduleEdit()) { showScheduleModalWarning('Viewer mode. Sign in as admin to rescue imported programs.', 'bad'); return false; }
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    if (!schedule || !slot || !rowHash) return false;
    const cacheKey = scheduleRescueCacheKey(schedule, slot);
    const entry = state.scheduleSlotRescueCache?.[cacheKey];
    const candidate = entry?.candidates?.find((item) => String(item?.row?.row_hash || '') === String(rowHash || '')) || null;
    const row = candidate?.row;
    if (!row) {
      showScheduleModalWarning('That imported row is not available anymore for slot rescue.', 'warn');
      return false;
    }
    const sourceRow = candidate?.sourceRow || (importedRowIsNonSpecific(row) ? null : findProgramRowForImportedAiring(row));
    const placement = buildPlacementFromImportedAiring({ row, sourceRow, dateKey: slot.dateKey, startMinutes: Number(slot.minutes || 0) });
    if (!placement || importedRowIsNonSpecific(row)) {
      showScheduleModalWarning('That imported row cannot be placed in the schedule as-is.', 'bad');
      return false;
    }
    const existingSlotPlacement = findPlacementForSlot(schedule, slot.key);
    const existingHashPlacement = scheduleImportedPlacementByHash(schedule, rowHash);
    schedule.placements = (schedule.placements || []).filter((item) => item.id !== existingSlotPlacement?.id && item.id !== existingHashPlacement?.id);
    if (existingHashPlacement?.transferredToStation) placement.transferredToStation = true;
    if (existingHashPlacement?.liveBreakFlag) {
      placement.liveBreakFlag = true;
      placement.liveBreakNotes = existingHashPlacement.liveBreakNotes || '';
    }
    schedule.placements.push({
      ...placement,
      id: existingHashPlacement?.id || existingSlotPlacement?.id || placement.id
    });
    state.scheduleSlotRescueCache = {};
    await persistSchedules(schedule);
    renderScheduleGrid();
    renderProgramPicker();
    closeScheduleModal();
    setNotice(`${existingHashPlacement ? 'Moved' : 'Placed'} imported airing ${placement.programTitle} at ${slotLabel(slot.dateKey, slot.minutes)}. ${state.scheduleSyncMessage}`.trim());
    return true;
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
        const identityKey = utils.nolaIdentityKey(nola, title) || '';
        const dedupeKey = programId || identityKey || `${titleKey}|${nolaKey}|${topicKey}|${index}`;
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
    const deleteOptionHtml = canScheduleEdit() && selected
      ? [
          '<option value="" disabled>──────────</option>',
          `<option value="${DELETE_ACTIVE_SCHEDULE_OPTION}">DELETE CURRENT FUNDRAISER…</option>`
        ]
      : [];
    const scheduleOptionsHtml = ['<option value="">Select fundraiser…</option>'].concat(deleteOptionHtml, orderedSchedules.map((schedule) => {
      const spanInfo = getScheduleDateSpanInfo(schedule);
      const placementCount = Array.isArray(schedule.placements) ? schedule.placements.length : 0;
      const totalRaised = scheduleGrandTotal(schedule);
      const sameRangeCount = sameDateRangeSchedules(schedule.startDate, schedule.endDate).length;
      const selectedAttr = schedule.id === selected ? ' selected' : '';
      const invalidSuffix = spanInfo.ok ? '' : ' · INVALID DATE RANGE';
      const duplicateSuffix = sameRangeCount > 1 ? ' · DUPLICATE DATES' : '';
      return `<option value="${utils.escapeHtml(schedule.id)}"${selectedAttr}>${utils.escapeHtml(`${schedule.title} · ${utils.formatDate(schedule.startDate)} – ${utils.formatDate(schedule.endDate)} · ${placementCount} blocks · ${utils.formatMoney(totalRaised)}${invalidSuffix}${duplicateSuffix}`)}</option>`;
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
      const sameRangeCount = sameDateRangeSchedules(schedule.startDate, schedule.endDate).length;
      const duplicateSuffix = sameRangeCount > 1 ? ' · DUPLICATE DATES' : '';
      return `
        <div class="schedule-list-item ${active ? 'active' : ''}${spanInfo.ok ? '' : ' invalid'}">
          <button type="button" class="schedule-list-open" data-schedule-id="${utils.escapeHtml(schedule.id)}" ${spanInfo.ok ? '' : 'data-invalid-schedule="true"'}>
            <span class="schedule-list-title">${utils.escapeHtml(schedule.title)}</span>
            <span class="schedule-list-meta">${utils.escapeHtml(utils.formatDate(schedule.startDate))} – ${utils.escapeHtml(utils.formatDate(schedule.endDate))} · ${placementCount} blocks · ${utils.escapeHtml(utils.formatMoney(totalRaised))}${spanInfo.ok ? '' : ' · INVALID DATE RANGE'}${duplicateSuffix}</span>
          </button>
          ${canScheduleEdit() ? `<button type="button" class="ghost tiny-button" data-delete-schedule-id="${utils.escapeHtml(schedule.id)}">Delete</button>` : ''}
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
      mailDollars: 0,
      goalDollars: 0
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
    if (els.fundraiserGoalInput) els.fundraiserGoalInput.value = Number(state.scheduleDraft.goalDollars || 0) || 0;
    const schedule = getActiveSchedule();
    if (schedule) void ensureScheduleImportedTotals(schedule);
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
    const goalDifference = scheduleGoalDifference(working);
    if (els.fundraiserGoalDifference) {
      els.fundraiserGoalDifference.value = utils.formatMoney(goalDifference);
      applyGoalDifferenceClass(els.fundraiserGoalDifference, goalDifference);
    }
    renderHomeDriveSummary();
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
    if (els.scheduleGenerateButton) {
      els.scheduleGenerateButton.textContent = schedule ? 'Save fundraiser' : 'Build blank calendar';
      els.scheduleGenerateButton.title = schedule
        ? 'Save changes to the open fundraiser. This will not create a duplicate.'
        : 'Create a new blank fundraiser calendar from the title and dates above.';
    }
    [els.fundraiserTitleInput, els.fundraiserStartInput, els.fundraiserEndInput, els.fundraiserOnlineInput, els.fundraiserMailInput, els.fundraiserGoalInput, els.scheduleGenerateButton].forEach((el) => { if (el) el.disabled = !editable; });
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
    const note = utils.normalizeText(row.notes || row.description || row.segment_title || row.segment_name || row.timing_note || row.timing_notes);
    if (note) parts.push(note);
    return parts;
  }

  function scheduledTimingLabel(row = {}, fallbackIndex = 0) {
    const direct = Number(utils.firstNonEmpty(row.segment_number, row.slot_number));
    const seq = Number.isFinite(direct) && direct > 0 ? direct : fallbackIndex + 1;
    return `Act ${seq}`;
  }

  function scheduledTimingNote(row = {}) {
    return utils.normalizeText(utils.firstNonEmpty(
      row.notes,
      row.description,
      row.segment_title,
      row.segment_name,
      row.timing_note,
      row.timing_notes
    ));
  }

  function normalizeScheduledTimingRows(timings = []) {
    return [...(Array.isArray(timings) ? timings : [])]
      .map((row, index) => ({
        row,
        sortKey: Number(utils.firstNonEmpty(row.segment_number, row.slot_number, index + 1)) || (index + 1),
        label: scheduledTimingLabel(row, index),
        programSeconds: timingValue(row, ['program_segment_length_seconds', 'segment_seconds', 'act_seconds']),
        breakSeconds: timingValue(row, ['pledge_break_seconds', 'break_length_seconds', 'break_seconds']),
        localCutInSeconds: timingValue(row, ['local_cutin_seconds', 'local_cutin', 'local_cutin_length_seconds']),
        note: scheduledTimingNote(row)
      }))
      .sort((a, b) => a.sortKey - b.sortKey);
  }

  function timingRowsWithCutTimes(timings = []) {
    let cumulativeSeconds = 0;
    return normalizeScheduledTimingRows(timings).map((entry) => {
      const programSeconds = Number.isFinite(entry.programSeconds) ? entry.programSeconds : null;
      const breakSeconds = Number.isFinite(entry.breakSeconds) ? entry.breakSeconds : null;
      const localCutInSeconds = Number.isFinite(entry.localCutInSeconds) ? entry.localCutInSeconds : null;
      const programStartSeconds = cumulativeSeconds;
      const breakCutTimeSeconds = programSeconds != null ? cumulativeSeconds + programSeconds : null;
      const localCutInCutTimeSeconds = breakCutTimeSeconds != null && breakSeconds != null
        ? breakCutTimeSeconds + breakSeconds
        : null;

      // Cut times are positions inside the delivered program/break file.
      // Local cut-ins are station inserts after the break; they should be listed with
      // their start point, but they are not part of the program file and must not
      // push later cut times forward.
      if (localCutInCutTimeSeconds != null) cumulativeSeconds = localCutInCutTimeSeconds;
      else if (breakCutTimeSeconds != null) cumulativeSeconds = breakCutTimeSeconds + (breakSeconds || 0);
      else if (programSeconds != null) cumulativeSeconds += programSeconds;

      return {
        ...entry,
        programStartSeconds,
        breakCutTimeSeconds,
        localCutInCutTimeSeconds,
        cutTimeSeconds: breakCutTimeSeconds
      };
    });
  }

  function scheduledTimingRuntimeSeconds(detail = {}) {
    const rows = normalizeScheduledTimingRows(detail?.timings || []);
    const hasProgramTime = rows.some((entry) => Number.isFinite(entry.programSeconds) && entry.programSeconds > 0);
    const hasBreakTime = rows.some((entry) => Number.isFinite(entry.breakSeconds) && entry.breakSeconds > 0);
    if (!hasProgramTime || !hasBreakTime) return null;
    const totalSeconds = rows.reduce((sum, entry) => {
      const programSeconds = Number.isFinite(entry.programSeconds) ? entry.programSeconds : 0;
      const breakSeconds = Number.isFinite(entry.breakSeconds) ? entry.breakSeconds : 0;
      return sum + programSeconds + breakSeconds;
    }, 0);
    return Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : null;
  }

  function scheduledRuntimeInfo(row = {}, cache = null, fallbackMinutes = null) {
    const timingSeconds = cache?.loaded && !cache?.error ? scheduledTimingRuntimeSeconds(cache.detail || {}) : null;
    if (Number.isFinite(timingSeconds) && timingSeconds > 0) {
      return { minutes: Math.round(timingSeconds / 60), label: utils.formatSeconds(timingSeconds), source: 'timing' };
    }
    const runtimeMinutes = Number(derive.runtimeMinutes(row));
    const runtimeClock = derive.actualRuntimeLabel(row);
    if (Number.isFinite(runtimeMinutes) && runtimeMinutes > 0 && runtimeClock !== '—') return { minutes: runtimeMinutes, label: runtimeClock, source: 'program' };
    if (Number.isFinite(runtimeMinutes) && runtimeMinutes > 0) return { minutes: runtimeMinutes, label: `${runtimeMinutes} min`, source: 'program' };
    const fallback = Number(fallbackMinutes);
    if (Number.isFinite(fallback) && fallback > 0) return { minutes: fallback, label: `${fallback} min`, source: 'placement' };
    return { minutes: null, label: 'Length unknown', source: 'unknown' };
  }

  function scheduledPlacementRuntimeMinutes(placement = {}) {
    if (!placement || placement.isNonPledge) return null;
    const detailKey = scheduleDetailKeyForPlacement(placement);
    const cache = detailKey ? state.scheduleDetailCache?.[detailKey] : null;
    const row = getProgramRowById(placement.programId || '') || {};
    const displayRow = cache?.detail?.program ? utils.mergeRows(cache.detail.program, row) : row;
    const info = scheduledRuntimeInfo(displayRow, cache, placement.lengthMinutes);
    return Number.isFinite(info.minutes) && info.minutes > 0 ? info.minutes : null;
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

  function queueScheduleInlineScrollbarSync() {
    return;
  }

  function syncScheduleInlineScrollbar() {
    return;
  }

  function handleInlineScrollbarDrag(event) {
    return;
  }

  function stopInlineScrollbarDrag() {
    scheduleInlineScrollbar.dragActive = false;
    document.body.classList.remove('schedule-inline-scrollbar-dragging');
  }

  function renderInlineScrollbar() {
    const container = els.scheduleGrid;
    if (!container) return;
    const existing = container.querySelector('.schedule-inline-scrollbar');
    if (existing) existing.remove();
  }

  function scheduleDetailKeyForPlacement(placement = {}) {
    if (!placement || placement.isNonPledge) return '';
    const directId = String(placement.programId || '').trim();
    const row = directId ? getProgramRowById(directId) : null;
    return String(derive.programId(row) || directId || '').trim();
  }

  function scheduleCalendarBreakInfoNeededHtml(placement = null) {
    if (!placement || placement.isNonPledge) return '';
    const detailKey = scheduleDetailKeyForPlacement(placement);
    if (!detailKey) return '';
    const cache = state.scheduleDetailCache?.[detailKey];
    if (!cache?.loaded || cache?.error) return '';
    if (scheduleDetailHasBreakInfo(cache.detail || {})) return '';
    return '<span class="schedule-placement-break-needed">BREAK INFO NEEDED</span>';
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

    requestScheduleExpectationData();
    if (!state.scheduleAiringHistoryLoaded && !state.scheduleAiringHistoryLoading) void ensureScheduleAiringHistoryLoaded();
    const dayKeys = visibleDateKeys(schedule);
    const windowConfig = getScheduleWindow(state.scheduleView);
    const visibleStartMin = windowConfig.startMinutes;
    const visibleEndMin = windowConfig.endMinutes;
    const times = [];
    for (let minutes = visibleStartMin; minutes < visibleEndMin; minutes += constants.DEFAULT_SLOT_MINUTES) times.push(minutes);
    const placements = annotatePlacements(schedule).map((placement) => toDisplayPlacement(placement, visibleStartMin));
    const calendarDetailIds = [...new Set(placements.map((placement) => scheduleDetailKeyForPlacement(placement)).filter(Boolean))];
    if (calendarDetailIds.length) void ensureScheduledDetailsBatch(calendarDetailIds);
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
        const hasImportedData = isStart && placementHasImportedAiring(placement, actualDateKey, actualMinutes);
        const klass = [placement ? (placement.isFirstRun ? 'first-run' : 'repeat-run') : '', placement?.isNonPledge ? 'non-pledge' : '', hasLiveBreakFlag(placement) ? 'live-break' : '', placement?.transferredToStation ? 'transferred-to-station' : '', hasImportedData ? 'imported-data' : ''].filter(Boolean).join(' ');
        const expectationBadge = isStart ? scheduleExpectationBadgeHtml(placement, actualDateKey, actualMinutes) : '';
        const breakWarning = isStart ? scheduleCalendarBreakInfoNeededHtml(placement) : '';
        const subtitleBits = [];
        if (placement) {
          subtitleBits.push(`${utils.escapeHtml(String(placement.lengthMinutes))} min`);
          if (placement.isNonPledge) subtitleBits.push('non-pledge');
          if (hasLiveBreakFlag(placement)) subtitleBits.push('live break');
        }
        const transferToggle = isStart && editable
          ? `<label class="schedule-placement-transfer-toggle" data-placement-transfer-toggle title="Mark this title as entered in traffic/scheduling software">
              <input type="checkbox" data-grid-transfer-placement-id="${utils.escapeHtml(placement.id)}" ${placement.transferredToStation ? 'checked' : ''}>
              <span class="schedule-placement-transfer-check" aria-hidden="true"></span>
            </label>`
          : '';
        const liveCalendarBadge = isStart && hasLiveBreakFlag(placement)
          ? '<span class="schedule-live-calendar-badge" title="Live break flagged">LIVE</span>'
          : '';
        body.push(`
          <button type="button" class="schedule-slot ${isWeekendDateKey(displayDateKey) ? 'weekend' : ''}${guideClass} ${state.selectedScheduleSlot?.key === slotKey ? 'selected' : ''} ${editable ? '' : 'viewer-only'}" data-slot-key="${utils.escapeHtml(slotKey)}" data-date-key="${utils.escapeHtml(actualDateKey)}" data-display-date-key="${utils.escapeHtml(displayDateKey)}" data-minutes="${actualMinutes}">
            ${isStart ? `<span title="${utils.escapeHtml(placement.programTitle)}" draggable="${editable ? 'true' : 'false'}" class="schedule-placement ${klass} ${editable ? '' : 'locked'}" data-placement-id="${utils.escapeHtml(placement.id)}" data-date-key="${utils.escapeHtml(placement.dateKey)}" data-minutes="${placement.startMinutes}" style="${style}">${transferToggle}${liveCalendarBadge}${renderProgramTitleLink(placement.isNonPledge ? '' : placement.programId, placement.programTitle, { nested: true, className: 'schedule-placement-title-link', titleAttr: placement.programTitle })}<span>${subtitleBits.join(' · ')}</span>${breakWarning}${expectationBadge}</span>` : ''}
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
    const slotFitCacheDirty = (schedule.placements || []).some((item) => item?.__slotFitCacheDirty);
    if (slotFitCacheDirty) {
      (schedule.placements || []).forEach((item) => { delete item.__slotFitCacheDirty; });
      void persistSchedules(schedule);
    }
    renderInlineScrollbar();
    renderScheduledProgramDetails();
  }


  function scheduleDetailHasBreakInfo(detail = {}) {
    const rows = normalizeScheduledTimingRows(detail?.timings || []);
    return rows.some((entry) => Number.isFinite(entry.breakSeconds) || Number.isFinite(entry.localCutInSeconds));
  }

  function breakInfoNeededHtml(cache = null) {
    if (!cache?.loaded || cache?.error) return '';
    return scheduleDetailHasBreakInfo(cache.detail || {}) ? '' : '<div class="scheduled-break-needed">BREAK INFO NEEDED</div>';
  }

  function signedMoney(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    const prefix = numeric > 0 ? '+' : (numeric < 0 ? '-' : '');
    return `${prefix}${utils.formatMoney(Math.abs(numeric))}`;
  }

  function slotFitResultForOccurrence(placement = {}) {
    try {
      const direct = App.performanceUi?.getScheduleExpectationForPlacement?.(placement, placement.dateKey, placement.startMinutes);
      if (direct) return direct;
    } catch (error) {
      console.warn('Schedule detail Slot Fit projection failed.', error);
    }
    return placement?.slotFitCache?.result || null;
  }

  function slotFitOccurrenceHtml(placement = {}) {
    const result = slotFitResultForOccurrence(placement);
    const projected = Number(result?.projectedAvg);
    const actualRaw = Number(placement?.importedBroadcastDollars);
    const actualKnown = Number.isFinite(actualRaw) && (actualRaw > 0 || placement?.importedFromReport || placement?.sourceAiringHash);
    if (!Number.isFinite(projected) && !actualKnown) return '';
    const actualText = actualKnown ? utils.formatMoney(actualRaw) : 'Actual TBD';
    const projectedText = Number.isFinite(projected) ? utils.formatMoney(projected) : 'Projection TBD';
    const deltaText = Number.isFinite(projected) && actualKnown ? ` · Δ ${signedMoney(actualRaw - projected)}` : '';
    const tone = Number.isFinite(projected) && actualKnown
      ? (actualRaw >= projected ? 'good' : 'weak')
      : 'pending';
    return `<div class="scheduled-slot-fit-tracker ${tone}"><span class="mini-label inline">Slot Fit</span><span>Projected ${utils.escapeHtml(projectedText)} · Actual ${utils.escapeHtml(actualText)}${utils.escapeHtml(deltaText)}</span></div>`;
  }

  function invalidateScheduleDetail(programId = '') {
    state.scheduleDetailCache = {};
    state.scheduleDetailBatchPending = {};
    if (state.activeWorkspace === 'scheduling') renderScheduledProgramDetails();
  }

  function timingSummaryHtml(cacheEntry) {
    const timings = cacheEntry?.timings || [];
    const rows = timingRowsWithCutTimes(timings);
    if (!rows.length) return '<div class="scheduled-program-note">TBD</div>';
    return `
      <div class="segment-table-wrap scheduled-break-detail-table-wrap">
        <table class="segment-table timing-acts-table scheduled-break-detail-table">
          <thead>
            <tr>
              <th>Act</th>
              <th>Program</th>
              <th>Break <span class="export-muted">(cut time)</span></th>
              <th>Local Cut In</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((entry) => `
              <tr>
                <td>${utils.escapeHtml(entry.label)}</td>
                <td>${utils.escapeHtml(Number.isFinite(entry.programSeconds) ? utils.formatSeconds(entry.programSeconds) : '—')}</td>
                <td>${Number.isFinite(entry.breakSeconds) ? `${utils.escapeHtml(utils.formatSeconds(entry.breakSeconds))}${Number.isFinite(entry.breakCutTimeSeconds) ? ` <span class="export-cut-time">(${utils.escapeHtml(utils.formatSeconds(entry.breakCutTimeSeconds))})</span>` : ''}` : 'TBD'}</td>
                <td>${Number.isFinite(entry.localCutInSeconds) ? `${utils.escapeHtml(utils.formatSeconds(entry.localCutInSeconds))}${Number.isFinite(entry.localCutInCutTimeSeconds) ? ` <span class="export-cut-time">(${utils.escapeHtml(utils.formatSeconds(entry.localCutInCutTimeSeconds))})</span>` : ''}` : 'TBD'}</td>
                <td>${utils.escapeHtml(entry.note || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function scheduleScheduledProgramDetailsRerender() {
    window.clearTimeout(scheduledDetailRerenderTimer);
    scheduledDetailRerenderTimer = window.setTimeout(() => {
      scheduledDetailRerenderTimer = 0;
      renderScheduledProgramDetails();
    }, 60);
  }

  async function ensureScheduledDetailsBatch(programIds = []) {
    const wantedIds = [...new Set((Array.isArray(programIds) ? programIds : [programIds])
      .map((value) => `${value || ''}`.trim())
      .filter(Boolean))];
    const neededIds = wantedIds.filter((programId) => !state.scheduleDetailCache[programId]?.loaded && !state.scheduleDetailCache[programId]?.loading);
    if (!neededIds.length || !state.client) return;
    if (!state.scheduleDetailBatchPending) state.scheduleDetailBatchPending = {};
    const batchKey = neededIds.slice().sort().join('|');
    if (state.scheduleDetailBatchPending[batchKey]) return state.scheduleDetailBatchPending[batchKey];
    neededIds.forEach((programId) => {
      state.scheduleDetailCache[programId] = {
        ...(state.scheduleDetailCache[programId] || {}),
        loading: true,
        loaded: false
      };
    });
    const task = (async () => {
      try {
        const detailMap = await App.data.fetchProgramDetailsBatch(neededIds);
        neededIds.forEach((programId) => {
          const detail = detailMap?.[programId] || { program: null, timings: [], driveResults: [], airings: [], warnings: [] };
          state.scheduleDetailCache[programId] = { loading: false, loaded: true, detail };
        });
      } catch (error) {
        neededIds.forEach((programId) => {
          state.scheduleDetailCache[programId] = { loading: false, loaded: true, error };
        });
      } finally {
        delete state.scheduleDetailBatchPending[batchKey];
        if (state.activeWorkspace === 'scheduling' && getActiveSchedule()) renderScheduleGrid();
        else scheduleScheduledProgramDetailsRerender();
      }
    })();
    state.scheduleDetailBatchPending[batchKey] = task;
    return task;
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
    const detailKeyByGroup = new Map(groupedEntries.map(([groupKey, occurrences]) => {
      const row = getProgramRowById(groupKey) || getProgramRowById(occurrences?.[0]?.programId || '') || null;
      const detailProgramId = String(derive.programId(row) || '').trim();
      return [groupKey, detailProgramId];
    }));
    void ensureScheduledDetailsBatch([...new Set(groupedEntries.map(([groupKey]) => detailKeyByGroup.get(groupKey)).filter(Boolean))]);
    const loadingCount = groupedEntries.filter(([groupKey]) => {
      const detailKey = detailKeyByGroup.get(groupKey);
      return detailKey && state.scheduleDetailCache[detailKey]?.loading && !state.scheduleDetailCache[detailKey]?.loaded;
    }).length;
    const loadedCount = groupedEntries.filter(([groupKey]) => {
      const detailKey = detailKeyByGroup.get(groupKey);
      return detailKey && state.scheduleDetailCache[detailKey]?.loaded;
    }).length;
    const progressHtml = loadingCount
      ? `<div class="schedule-detail-progress">Loading detailed break/history data for ${utils.escapeHtml(utils.formatCount(loadingCount))} of ${utils.escapeHtml(utils.formatCount(groupedEntries.length))} titles… ${utils.escapeHtml(utils.formatCount(loadedCount))} ready.</div>`
      : '';

    els.scheduleProgramDetails.innerHTML = fundraiserSummaryHtml + progressHtml + groupedEntries.map(([programId, occurrences]) => {
      const row = getProgramRowById(programId) || getProgramRowById(occurrences?.[0]?.programId || '') || {};
      const cache = state.scheduleDetailCache[detailKeyByGroup.get(programId) || ''];
      const detail = cache?.detail || null;
      const displayRow = detail?.program ? utils.mergeRows(detail.program, row) : row;
      const breakNeeded = breakInfoNeededHtml(cache);
      const runtimeInfo = scheduledRuntimeInfo(displayRow, cache, occurrences[0]?.lengthMinutes);
      const runtimeLabel = runtimeInfo.label;
      const metaBits = [runtimeLabel, derive.nola(displayRow) || 'No NOLA', derive.topicPrimary(displayRow) || 'No topic'];
      const avgPerFundraiser = Number(derive.avgPerFundraiser(displayRow) || 0) || 0;
      const fundraiserCount = historicalFundraiserCount(displayRow, detail);
      const rawTotalRaised = Number(derive.totalRaised(displayRow) || 0) || 0;
      const computedHistoricalTotal = rawTotalRaised > 0
        ? rawTotalRaised
        : (avgPerFundraiser > 0 ? (fundraiserCount > 0 ? (avgPerFundraiser * fundraiserCount) : avgPerFundraiser) : 0);
      const historicalTotalDisplay = computedHistoricalTotal > 0 ? utils.formatMoney(computedHistoricalTotal) : 'N/A';
      const historicalAvgDisplay = avgPerFundraiser > 0
        ? `${utils.formatMoney(avgPerFundraiser)} (${utils.formatCount(Math.max(fundraiserCount, 0))})`
        : 'N/A';
      const historicalAiringLines = historicalAiringHistoryLines(detail);
      const historicalAiringHtml = historicalAiringLines.length
        ? `<div class="scheduled-premium-lines scheduled-history-lines">${historicalAiringLines.map((line) => `<div class="scheduled-premium-line scheduled-history-line">${utils.escapeHtml(line)}</div>`).join('')}</div>`
        : `<div class="scheduled-program-note">${cache?.loaded ? 'TBD' : 'Loading…'}</div>`;
      const scheduledRows = occurrences
        .sort((a, b) => (`${a.dateKey}|${a.startMinutes}`).localeCompare(`${b.dateKey}|${b.startMinutes}`))
        .map((item) => {
          const slotFitHtml = slotFitOccurrenceHtml(item);
          return `
          <label class="scheduled-occurrence-row">
            <input type="checkbox" data-transfer-placement-id="${utils.escapeHtml(item.id)}" ${item.transferredToStation ? 'checked' : ''}>
            <span>${utils.escapeHtml(slotLabel(item.dateKey, item.startMinutes))}${hasLiveBreakFlag(item) ? ' · live-break' : ''}</span>
            ${slotFitHtml}
          </label>
        `;
        }).join('');
      let breakHtml = '<div class="scheduled-program-note">Loading…</div>';
      if (cache?.error) breakHtml = `<div class="scheduled-program-note">Break detail unavailable: ${utils.escapeHtml(cache.error.message || 'load failed')}</div>`;
      else if (cache?.loaded) breakHtml = timingSummaryHtml(cache.detail);
      return `
        <article class="scheduled-program-card compact-program-card scheduled-program-card-collapsed" data-scheduled-detail-card>
          <div class="scheduled-program-summary-row">
            <div class="scheduled-program-title-wrap">
              ${renderProgramTitleLink(programId, derive.title(displayRow) || occurrences[0].programTitle, { className: 'schedule-card-title-link' })}
              <div class="scheduled-program-meta-inline">${metaBits.map((bit) => `<span>${utils.escapeHtml(bit)}</span>`).join('<span class="meta-dot">•</span>')}</div>
              ${breakNeeded}
            </div>
            <button type="button" class="ghost scheduled-program-expand-button" data-scheduled-card-toggle aria-expanded="false">Details</button>
          </div>
          <div class="scheduled-program-line scheduled-program-line-bottom scheduled-program-expanded-detail" hidden>
            <div class="scheduled-data-chunk"><span class="mini-label inline">Distributor</span><span>${utils.escapeHtml(derive.distributor(displayRow) || '—')}</span></div>
            <div class="scheduled-data-chunk"><span class="mini-label inline">Historical Total Raised</span><span>${utils.escapeHtml(historicalTotalDisplay)}</span></div>
            <div class="scheduled-data-chunk"><span class="mini-label inline">Historical Avg / Fundraiser</span><span>${utils.escapeHtml(historicalAvgDisplay)}</span>${historicalAiringHtml}</div>
            <div class="scheduled-data-chunk scheduled-premium-chunk"><span class="mini-label inline">Premiums</span>${premiumLinesHtml(derive.premiumSummary(displayRow) || '—')}</div>
            <div class="scheduled-data-chunk scheduled-occurrence-chunk"><span class="mini-label inline">Breaks in ProTrack</span><div class="scheduled-occurrence-list">${scheduledRows}</div></div>
            <div class="scheduled-data-chunk scheduled-break-detail-chunk"><span class="mini-label inline">Break Detail</span>${breakHtml}</div>
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
    const currentPlacement = findPlacementForSlot(schedule, slot.key);
    renderScheduleSlotRescue(schedule, slot, currentPlacement, editable);

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


  async function persistScheduleMetadataOnly(schedule, options = {}) {
    const requireRemote = Boolean(options.requireRemote);
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
            goalDollars: Number(schedule.goalDollars || 0) || 0,
            meta: schedule.meta || {}
          }
        });
        state.scheduleSyncMessage = 'Fundraisers sync through Supabase.';
        return true;
      } catch (error) {
        console.warn('Remote schedule metadata save failed.', error);
        if (requireRemote) {
          state.scheduleSyncMessage = `Remote save failed. Manual fundraiser dollars were NOT saved to Supabase. ${error.message || ''}`.trim();
          throw error;
        }
        state.scheduleStoreMode = 'local';
        state.scheduleSyncMessage = `Remote save failed. Using this browser only. ${error.message || ''}`.trim();
      }
    }
    if (requireRemote) {
      state.scheduleSyncMessage = 'Manual fundraiser dollars were NOT saved because Supabase schedule sync is unavailable.';
      return false;
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
    const nextGoalDollars = Number(els.fundraiserGoalInput?.value || 0) || 0;
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
      state.scheduleDraft.goalDollars = nextGoalDollars;
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
    const moneyChanged = Number(schedule.onlineDollars || 0) !== nextOnlineDollars || Number(schedule.mailDollars || 0) !== nextMailDollars || Number(schedule.goalDollars || 0) !== nextGoalDollars;
    schedule.title = title;
    schedule.startDate = startDate;
    schedule.endDate = endDate;
    schedule.dayStartMinutes = nextDayStartMinutes;
    schedule.dayEndMinutes = nextDayEndMinutes;
    schedule.dayStartHour = Math.floor(schedule.dayStartMinutes / 60);
    schedule.dayEndHour = Math.floor(schedule.dayEndMinutes / 60);
    schedule.onlineDollars = nextOnlineDollars;
    schedule.mailDollars = nextMailDollars;
    schedule.goalDollars = nextGoalDollars;
    state.scheduleDraft.title = title;
    state.scheduleDraft.startDate = startDate;
    state.scheduleDraft.endDate = endDate;
    state.scheduleDraft.dayStartMinutes = schedule.dayStartMinutes;
    state.scheduleDraft.dayEndMinutes = schedule.dayEndMinutes;
    state.scheduleDraft.dayStartHour = schedule.dayStartHour;
    state.scheduleDraft.dayEndHour = schedule.dayEndHour;
    state.scheduleDraft.onlineDollars = nextOnlineDollars;
    state.scheduleDraft.mailDollars = nextMailDollars;
    state.scheduleDraft.goalDollars = nextGoalDollars;
    if (!(titleChanged || dateRangeChanged || windowChanged || moneyChanged)) return true;
    try {
      const remoteSaved = await persistScheduleMetadataOnly(schedule, { requireRemote: moneyChanged });
      if (moneyChanged && !remoteSaved) {
        renderScheduleForm();
        renderHomeDriveSummary();
        setNotice('Manual fundraiser dollars were NOT saved to Supabase. Refreshing or switching browsers may lose these values. Check Supabase sync before continuing.', 'bad');
        return false;
      }
    } catch (error) {
      renderScheduleForm();
      renderHomeDriveSummary();
      setNotice(`Manual fundraiser dollars were NOT saved to Supabase. ${error.message || ''}`.trim(), 'bad');
      return false;
    }
    renderScheduleList();
    renderScheduleForm();
    renderHomeDriveSummary();
    if (dateRangeChanged || windowChanged || moneyChanged) renderScheduleGrid();
    if (!options.silent) {
      const actionLabel = titleChanged && !(dateRangeChanged || windowChanged) ? 'Renamed' : 'Saved';
      setNotice(`${actionLabel} fundraiser calendar ${schedule.title}. ${state.scheduleSyncMessage}`);
    }
    return true;
  }

  async function createOrUpdateScheduleFromDraft() {
    if (!canScheduleEdit()) { setNotice('Sign in as admin to build or edit fundraiser schedules.', 'warn'); return; }
    const activeSchedule = getActiveSchedule();
    if (activeSchedule) {
      const saved = await saveActiveScheduleDraft({ silent: true });
      if (saved) {
        setNotice(`Saved existing fundraiser ${activeSchedule.title || 'Untitled fundraiser'}. To create a blank fundraiser, click New blank fundraiser first.`);
      }
      return;
    }
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
    const existingSameRange = bestScheduleForDateRange(startDate, endDate);
    if (existingSameRange) {
      activateScheduleById(existingSameRange.id, { focusCalendar: true });
      setNotice(`A fundraiser already exists for ${utils.formatDate(startDate)} – ${utils.formatDate(endDate)}. Opened ${existingSameRange.title || 'that fundraiser'} instead of creating a duplicate.`, 'warn');
      return;
    }
    const schedule = createScheduleRecord({
      title,
      startDate,
      endDate,
      dayStartHour: constants.DEFAULT_DAY_START_HOUR,
      dayEndHour: constants.DEFAULT_DAY_END_HOUR,
      onlineDollars: Number(els.fundraiserOnlineInput?.value || 0) || 0,
      mailDollars: Number(els.fundraiserMailInput?.value || 0) || 0,
      goalDollars: Number(els.fundraiserGoalInput?.value || 0) || 0
    });
    state.schedules.unshift(schedule);
    applyScheduleToView(schedule);
    await persistSchedules(schedule);
    renderAll();
    setNotice(`Built blank fundraiser calendar ${schedule.title}. ${state.scheduleSyncMessage}`);
  }

  function toggleTransferred(placementId, checked) {
    const schedule = getActiveSchedule();
    if (!schedule) return;
    const placement = findPlacementById(schedule, placementId);
    if (!placement) return;
    placement.transferredToStation = checked;
    void persistSchedules(schedule);
    renderScheduleGrid();
    renderScheduledProgramDetails();
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
    if (App.performanceUi?.refreshData) await App.performanceUi.refreshData({ silent: true });
    App.performanceUi?.renderAll?.();
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

  function scheduleExportTextLines(value = '') {
    const text = utils.normalizeText(value);
    if (!text) return ['—'];
    const lines = text
      .replace(/\r/g, '')
      .split(/\n+/)
      .map((line) => utils.normalizeText(line))
      .filter(Boolean);
    return lines.length ? lines : [text];
  }

  function scheduleExportMultilineHtml(value = '') {
    return scheduleExportTextLines(value)
      .map((line) => `<div>${utils.escapeHtml(line)}</div>`)
      .join('');
  }

  function scheduleExportPremiumHtml(value = '') {
    return premiumLines(value)
      .map((line) => `<div>${utils.escapeHtml(line)}</div>`)
      .join('');
  }

  function scheduleExportTimingHtml(timings = []) {
    const rows = timingRowsWithCutTimes(timings);
    if (!rows.length) {
      return '<div class="export-warning">BREAK INFO NEEDED</div><div class="export-muted">No break timing rows are available yet.</div>';
    }
    return `
      <table class="export-timing-table">
        <thead>
          <tr>
            <th>Act</th>
            <th>Program</th>
            <th>Break <span class="export-muted">(cut time)</span></th>
            <th>Local Cut In <span class="export-muted">(cut time)</span></th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((entry) => `
            <tr>
              <td>${utils.escapeHtml(entry.label || 'Act')}</td>
              <td>${Number.isFinite(entry.programSeconds) ? utils.escapeHtml(utils.formatSeconds(entry.programSeconds)) : '—'}</td>
              <td>${Number.isFinite(entry.breakSeconds) ? `${utils.escapeHtml(utils.formatSeconds(entry.breakSeconds))}${Number.isFinite(entry.breakCutTimeSeconds) ? ` <span class="export-cut-time">(${utils.escapeHtml(utils.formatSeconds(entry.breakCutTimeSeconds))})</span>` : ''}` : '<span class="export-warning-inline">TBD</span>'}</td>
              <td>${Number.isFinite(entry.localCutInSeconds) ? `${utils.escapeHtml(utils.formatSeconds(entry.localCutInSeconds))}${Number.isFinite(entry.localCutInCutTimeSeconds) ? ` <span class="export-cut-time">(${utils.escapeHtml(utils.formatSeconds(entry.localCutInCutTimeSeconds))})</span>` : ''}` : '—'}</td>
              <td>${entry.note ? utils.escapeHtml(entry.note) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function scheduleExportProgramHtml(item = {}) {
    const detailKey = scheduleDetailKeyForPlacement(item);
    const cache = detailKey ? state.scheduleDetailCache?.[detailKey] : null;
    const detail = cache?.detail || null;
    const baseRow = item.isNonPledge ? {} : (getProgramRowById(item.programId || '') || {});
    const displayRow = detail?.program ? utils.mergeRows(detail.program, baseRow) : baseRow;
    const runtime = scheduledRuntimeInfo(displayRow, cache, item.lengthMinutes);
    const markerBits = [];
    if (item.isNonPledge) markerBits.push('non-pledge marker');
    if (hasLiveBreakFlag(item)) markerBits.push('live break');
    if (item.transferredToStation) markerBits.push('entered in traffic');
    const nola = item.isNonPledge ? '' : derive.nola(displayRow);
    const topic = item.isNonPledge ? '' : derive.topicPrimary(displayRow);
    const distributor = item.isNonPledge ? '' : derive.distributor(displayRow);
    const description = item.isNonPledge ? '' : derive.description(displayRow);
    const premiums = item.isNonPledge ? '' : derive.premiumSummary(displayRow);
    const metaBits = [
      runtime?.label || (Number.isFinite(Number(item.lengthMinutes)) ? `${item.lengthMinutes} min` : ''),
      nola,
      topic,
      distributor,
      markerBits.join(' · ')
    ].map((part) => utils.normalizeText(part)).filter(Boolean);

    let timingHtml = '';
    if (!item.isNonPledge && item.programId) {
      if (cache?.loaded && !cache?.error) {
        const missingBreakInfo = !scheduleDetailHasBreakInfo(cache.detail || {});
        timingHtml = `
          ${missingBreakInfo ? '<div class="export-warning">BREAK INFO NEEDED</div>' : ''}
          <div class="export-subsection-title">Break detail</div>
          ${scheduleExportTimingHtml(cache.detail?.timings || [])}
        `;
      } else if (cache?.error) {
        timingHtml = `<div class="export-warning">BREAK INFO NEEDED</div><div class="export-muted">Break timing detail could not load: ${utils.escapeHtml(cache.error.message || 'load failed')}</div>`;
      } else {
        timingHtml = '<div class="export-warning">BREAK INFO NEEDED</div><div class="export-muted">Break timing detail did not finish loading before export.</div>';
      }
    }

    return `
      <article class="export-program">
        <div class="export-program-heading">
          <span class="export-program-time">${utils.escapeHtml(utils.minutesToLabel(item.startMinutes))}</span>
          <span class="export-program-title">${utils.escapeHtml(item.programTitle || derive.title(displayRow) || 'Untitled program')}</span>
        </div>
        ${metaBits.length ? `<div class="export-program-meta">${utils.escapeHtml(metaBits.join(' · '))}</div>` : ''}
        <div class="export-program-body">
          <div class="export-field">
            <div class="export-field-label">Distributor</div>
            <div class="export-field-value">${utils.escapeHtml(distributor || '—')}</div>
          </div>
          <div class="export-field">
            <div class="export-field-label">Description</div>
            <div class="export-field-value">${scheduleExportMultilineHtml(description)}</div>
          </div>
          <div class="export-field">
            <div class="export-field-label">Premiums</div>
            <div class="export-field-value">${scheduleExportPremiumHtml(premiums)}</div>
          </div>
          ${timingHtml}
        </div>
      </article>
    `;
  }

  function scheduleExportDocumentHtml(schedule = {}, rows = []) {
    const byDay = new Map();
    rows.forEach((item) => {
      if (!byDay.has(item.dateKey)) byDay.set(item.dateKey, []);
      byDay.get(item.dateKey).push(item);
    });
    const daySections = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dateKey, items]) => `
        <section class="export-day">
          <h2>${utils.escapeHtml(formatScheduleDay(dateKey))}</h2>
          ${items.sort((a, b) => Number(a.startMinutes || 0) - Number(b.startMinutes || 0)).map(scheduleExportProgramHtml).join('')}
        </section>
      `).join('');
    const generatedAt = new Date().toLocaleString();
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${utils.escapeHtml(schedule.title || 'Pledge Schedule')}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #ffffff;
      color: #111111;
      font-family: Aptos, "Segoe UI", Arial, Helvetica, sans-serif;
      font-size: 15px;
      line-height: 1.45;
    }
    .export-page {
      max-width: 980px;
      margin: 0 auto;
      padding: 44px 52px 64px;
      background: #ffffff;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 32px;
      line-height: 1.12;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #000000;
    }
    .export-subtitle {
      margin: 0 0 34px;
      color: #444444;
      font-size: 14px;
    }
    .export-day {
      margin-top: 42px;
      padding-top: 20px;
      border-top: 2px solid #111111;
      page-break-inside: avoid;
    }
    .export-day:first-of-type { margin-top: 28px; }
    h2 {
      margin: 0 0 18px;
      font-size: 22px;
      font-weight: 800;
      color: #000000;
    }
    .export-program {
      margin: 0 0 20px;
      padding: 0 0 16px;
      border-bottom: 1px solid #dddddd;
      page-break-inside: avoid;
    }
    .export-program:last-child { border-bottom: 0; }
    .export-program-heading {
      font-weight: 800;
      color: #000000;
      font-size: 16px;
      margin-bottom: 3px;
    }
    .export-program-time {
      display: inline-block;
      min-width: 86px;
      font-weight: 800;
    }
    .export-program-title {
      font-weight: 800;
      font-style: italic;
    }
    .export-program-meta {
      margin-left: 86px;
      color: #444444;
      font-size: 13px;
      margin-bottom: 9px;
    }
    .export-program-body {
      margin-left: 86px;
      padding-left: 18px;
      border-left: 3px solid #e4e4e4;
    }
    .export-field { margin: 8px 0 10px; }
    .export-field-label,
    .export-subsection-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.055em;
      font-weight: 800;
      color: #000000;
      margin-bottom: 3px;
    }
    .export-field-value { color: #111111; }
    .export-warning {
      display: inline-block;
      margin: 10px 0 8px;
      padding: 4px 8px;
      border: 2px solid #000000;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #000000;
      background: #ffffff;
    }
    .export-warning-inline {
      font-weight: 900;
      text-transform: uppercase;
      color: #000000;
    }
    .export-cut-time {
      font-weight: 800;
      color: #222222;
      white-space: nowrap;
    }
    .export-muted { color: #555555; font-size: 13px; }
    .export-timing-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 7px;
      font-size: 13px;
    }
    .export-timing-table th,
    .export-timing-table td {
      padding: 6px 8px;
      border-bottom: 1px solid #dddddd;
      text-align: left;
      vertical-align: top;
    }
    .export-timing-table th {
      font-weight: 800;
      color: #000000;
      background: #f6f6f6;
    }
    @media print {
      body { font-size: 12pt; }
      .export-page { max-width: none; padding: 0.45in; }
      .export-day { break-inside: avoid; }
      .export-program { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="export-page">
    <h1>${utils.escapeHtml(schedule.title || 'Pledge Schedule')}</h1>
    <div class="export-subtitle">${utils.escapeHtml(utils.formatDate(schedule.startDate))} – ${utils.escapeHtml(utils.formatDate(schedule.endDate))} · Exported ${utils.escapeHtml(generatedAt)}</div>
    ${daySections || '<p>No scheduled programs found.</p>'}
  </main>
</body>
</html>`;
  }

  function scheduleExportFallbackDownload(html = '', schedule = {}) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(schedule.title || 'fundraiser').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'fundraiser'}-daily-rundown.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function scheduleExportWriteTab(tab, html = '') {
    if (!tab || tab.closed) return false;
    try {
      tab.document.open();
      tab.document.write(html);
      tab.document.close();
      try { tab.focus(); } catch {}
      return true;
    } catch (error) {
      console.warn('Could not write daily rundown tab:', error);
      return false;
    }
  }

  function scheduleExportStatusHtml(message = 'Building daily rundown…') {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Daily Rundown</title><style>body{font-family:Aptos,"Segoe UI",Arial,sans-serif;margin:40px;color:#111;background:#fff;}h1{font-size:26px;margin:0 0 10px;}p{font-size:15px;}</style></head><body><h1>Daily Rundown</h1><p>${utils.escapeHtml(message)}</p></body></html>`;
  }

  async function exportScheduleView() {
    let previewTab = null;
    try {
      previewTab = window.open('', '_blank');
      if (previewTab) scheduleExportWriteTab(previewTab, scheduleExportStatusHtml('Building daily rundown…'));
    } catch (error) {
      previewTab = null;
    }

    try {
      if (!state.schedulingReady) await ensureReady();
      const schedule = getActiveSchedule();
      if (!schedule) {
        const message = 'No fundraiser is loaded yet. Open or create a fundraiser first.';
        if (!scheduleExportWriteTab(previewTab, scheduleExportStatusHtml(message))) alert(message);
        return;
      }
      const rows = annotatePlacements(schedule);
      await ensureScheduleExportDetails(rows);
      const html = scheduleExportDocumentHtml(schedule, rows);
      if (!scheduleExportWriteTab(previewTab, html)) scheduleExportFallbackDownload(html, schedule);
    } catch (error) {
      console.error(error);
      const message = error?.message || 'Daily rundown export failed.';
      if (!scheduleExportWriteTab(previewTab, scheduleExportStatusHtml(message))) alert(message);
    }
  }


  function driveComparisonDateFromRow(row = {}) {
    return utils.normalizeText(row.air_date)
      || utils.normalizeText(row.drive_start_date)
      || utils.dateKeyFromDate(row.aired_at)
      || utils.dateKeyFromDate(row.created_at)
      || '';
  }

  function driveComparisonDateFromSchedule(schedule = {}) {
    return utils.normalizeText(schedule.startDate || schedule.createdAt || schedule.updatedAt || '');
  }

  function driveComparisonQuarter(dateKey = '') {
    const month = Number(String(dateKey || '').slice(5, 7));
    if (!Number.isFinite(month) || month < 1 || month > 12) return 0;
    return Math.floor((month - 1) / 3) + 1;
  }

  function driveComparisonYear(dateKey = '') {
    const year = Number(String(dateKey || '').slice(0, 4));
    return Number.isFinite(year) ? year : 0;
  }

  function driveComparisonDateInRange(dateKey = '', startKey = '', endKey = '') {
    if (!dateKey) return false;
    if (startKey && dateKey < startKey) return false;
    if (endKey && dateKey > endKey) return false;
    return true;
  }

  function driveComparisonRangesOverlap(startA = '', endA = '', startB = '', endB = '') {
    if (!(startA && endA)) return false;
    if (startB && endA < startB) return false;
    if (endB && startA > endB) return false;
    return true;
  }

  function driveComparisonDefaults(rows = []) {
    const importedDates = (Array.isArray(rows) ? rows : [])
      .map(driveComparisonDateFromRow)
      .filter(Boolean)
      .sort();
    const scheduleDates = (state.schedules || [])
      .flatMap((schedule) => [utils.normalizeText(schedule.startDate), utils.normalizeText(schedule.endDate)])
      .filter(Boolean)
      .sort();
    const allDates = [...importedDates, ...scheduleDates].filter(Boolean).sort();
    const today = localTodayKey();
    const active = getActiveSchedule();
    const activeQuarter = driveComparisonQuarter(active?.startDate) || driveComparisonQuarter(today) || 1;
    return {
      startDate: importedDates[0] || allDates[0] || today,
      endDate: allDates[allDates.length - 1] || today,
      quarter: String(activeQuarter)
    };
  }

  function driveComparisonSummaryForRows(rows = []) {
    const totals = summarizeImportedRows(rows || []);
    return {
      broadcast: Number(totals.importedBroadcastTotalDollars || 0) || 0,
      pledges: Number(totals.importedPledgesTotal || 0) || 0
    };
  }

  function driveComparisonBuildSeriesRows(rows = []) {
    const startKey = els.driveComparisonStartDate?.value || '';
    const endKey = els.driveComparisonEndDate?.value || '';
    const mode = els.driveComparisonMode?.value || 'annual';
    const quarter = Number(els.driveComparisonQuarter?.value || 0) || 0;
    const rowsArray = Array.isArray(rows) ? rows : [];
    const validSchedules = (state.schedules || [])
      .filter((schedule) => getScheduleDateSpanInfo(schedule).ok)
      .filter((schedule) => driveComparisonRangesOverlap(schedule.startDate, schedule.endDate, startKey, endKey));

    const buckets = new Map();
    const coveredRowHashes = new Set();

    const addBucket = (dateKey, values = {}, sourceLabel = '') => {
      if (!dateKey) return;
      if (mode === 'quarter' && driveComparisonQuarter(dateKey) !== quarter) return;
      const year = driveComparisonYear(dateKey);
      if (!year) return;
      const q = driveComparisonQuarter(dateKey);
      const key = mode === 'quarter' ? `${year}-Q${quarter}` : `${year}`;
      const label = mode === 'quarter' ? `${year} Q${quarter}` : `${year}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          label,
          year,
          quarter: q,
          broadcast: 0,
          online: 0,
          mail: 0,
          total: 0,
          pledges: 0,
          fundraiserCount: 0,
          importedRows: 0,
          sources: new Set()
        });
      }
      const bucket = buckets.get(key);
      bucket.broadcast += Number(values.broadcast || 0) || 0;
      bucket.online += Number(values.online || 0) || 0;
      bucket.mail += Number(values.mail || 0) || 0;
      bucket.pledges += Number(values.pledges || 0) || 0;
      bucket.total += Number(values.total || 0) || 0;
      bucket.fundraiserCount += Number(values.fundraiserCount || 0) || 0;
      bucket.importedRows += Number(values.importedRows || 0) || 0;
      if (sourceLabel) bucket.sources.add(sourceLabel);
    };

    validSchedules.forEach((schedule) => {
      const scheduleRows = importedRowsForSchedule(schedule, rowsArray)
        .filter((row) => driveComparisonDateInRange(driveComparisonDateFromRow(row), startKey, endKey));
      scheduleRows.forEach((row) => {
        const hash = utils.normalizeText(row.row_hash || row.id || '');
        if (hash) coveredRowHashes.add(hash);
      });
      const importSummary = driveComparisonSummaryForRows(scheduleRows);
      const online = Number(schedule.onlineDollars || 0) || 0;
      const mail = Number(schedule.mailDollars || 0) || 0;
      const broadcast = importSummary.broadcast > 0 ? importSummary.broadcast : scheduleBroadcastTotal(schedule);
      const total = broadcast + online + mail;
      addBucket(schedule.startDate, {
        broadcast,
        online,
        mail,
        total,
        pledges: importSummary.pledges || scheduleImportedPledgesTotal(schedule),
        fundraiserCount: 1,
        importedRows: scheduleRows.length
      }, schedule.title || 'Scheduled fundraiser');
    });

    const unscheduledByDrive = new Map();
    rowsArray.forEach((row) => {
      const hash = utils.normalizeText(row.row_hash || row.id || '');
      if (hash && coveredRowHashes.has(hash)) return;
      const dateKey = driveComparisonDateFromRow(row);
      if (!driveComparisonDateInRange(dateKey, startKey, endKey)) return;
      const groupStart = utils.normalizeText(row.drive_start_date) || dateKey;
      const groupEnd = utils.normalizeText(row.drive_end_date) || dateKey;
      const key = [groupStart, groupEnd, utils.normalizeText(row.fundraiser_label || row.source_file_name || '')].join('|');
      if (!unscheduledByDrive.has(key)) unscheduledByDrive.set(key, { startDate: groupStart, endDate: groupEnd, rows: [] });
      unscheduledByDrive.get(key).rows.push(row);
    });

    unscheduledByDrive.forEach((entry) => {
      const summary = driveComparisonSummaryForRows(entry.rows);
      addBucket(entry.startDate, {
        broadcast: summary.broadcast,
        online: 0,
        mail: 0,
        total: summary.broadcast,
        pledges: summary.pledges,
        fundraiserCount: 1,
        importedRows: entry.rows.length
      }, 'Imported-only fundraiser');
    });

    return [...buckets.values()]
      .map((bucket) => ({ ...bucket, sourceCount: bucket.sources.size }))
      .sort((a, b) => a.year - b.year || a.key.localeCompare(b.key));
  }

  function driveComparisonFormatCompactMoney(value = 0) {
    const num = Number(value || 0) || 0;
    if (Math.abs(num) >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
    if (Math.abs(num) >= 1000) return `$${Math.round(num / 1000)}K`;
    return utils.formatMoney(num);
  }

  function driveComparisonPointPath(points = []) {
    return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  }

  function driveComparisonRenderChart(rows = []) {
    if (!els.driveComparisonChart || !els.driveComparisonTable) return;
    const mode = els.driveComparisonMode?.value || 'annual';
    const quarter = Number(els.driveComparisonQuarter?.value || 0) || 0;
    const chartView = els.driveComparisonChartView?.value === 'pledges' ? 'pledges' : 'dollars';
    if (els.driveComparisonQuarterWrap) els.driveComparisonQuarterWrap.classList.toggle('hidden', mode !== 'quarter');

    if (!rows.length) {
      els.driveComparisonChart.innerHTML = '<div class="drive-comparison-empty">No fundraiser totals match this date range yet.</div>';
      els.driveComparisonTable.innerHTML = '';
      if (els.driveComparisonSummary) els.driveComparisonSummary.textContent = 'No matching fundraiser data for this comparison.';
      return;
    }

    rows.forEach((row) => { row.total = row.broadcast + row.online + row.mail; });
    const dollarMax = Math.max(1, ...rows.flatMap((row) => [row.broadcast, row.online, row.mail, row.total]).map((value) => Number(value || 0) || 0));
    const pledgeMax = Math.max(1, ...rows.map((row) => Number(row.pledges || 0) || 0));
    const width = 840;
    const height = 310;
    const pad = { left: 64, right: 28, top: 30, bottom: 54 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const xFor = (index) => rows.length === 1 ? pad.left + (innerW / 2) : pad.left + (innerW * index / (rows.length - 1));
    const yDollar = (value) => pad.top + innerH - ((Number(value || 0) || 0) / dollarMax * innerH);
    const yPledge = (value) => pad.top + innerH - ((Number(value || 0) || 0) / pledgeMax * innerH);
    const dollarSeries = [
      { key: 'broadcast', label: 'Broadcast $', color: '#0066ff', y: yDollar, value: (row) => row.broadcast, money: true },
      { key: 'online', label: 'Online $', color: '#00a651', y: yDollar, value: (row) => row.online, money: true },
      { key: 'mail', label: 'Mail $', color: '#ff8c00', y: yDollar, value: (row) => row.mail, money: true },
      { key: 'total', label: 'Total raised $', color: '#8a2be2', y: yDollar, value: (row) => row.total, money: true }
    ];
    const pledgeSeries = [
      { key: 'pledges', label: 'Pledges', color: '#e31b23', y: yPledge, value: (row) => row.pledges, money: false }
    ];
    const activeSeries = chartView === 'pledges' ? pledgeSeries : dollarSeries;
    const activeMax = chartView === 'pledges' ? pledgeMax : dollarMax;
    const activeFormat = chartView === 'pledges'
      ? (value) => utils.formatCount(Math.round(Number(value || 0) || 0))
      : (value) => driveComparisonFormatCompactMoney(value);
    const axisTitle = chartView === 'pledges' ? 'Pledges' : 'Dollars';

    const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
      const y = pad.top + innerH - (ratio * innerH);
      const value = activeMax * ratio;
      return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="drive-comparison-grid-line"></line><text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" class="drive-comparison-axis-label">${utils.escapeHtml(activeFormat(value))}</text>`;
    }).join('');
    const xLabels = rows.map((row, index) => {
      const x = xFor(index);
      return `<text x="${x}" y="${height - 24}" text-anchor="middle" class="drive-comparison-x-label">${utils.escapeHtml(row.label)}</text>`;
    }).join('');
    const seriesSvg = activeSeries.map((entry) => {
      const points = rows.map((row, index) => ({ row, x: xFor(index), y: entry.y(entry.value(row)), value: entry.value(row) }));
      const circles = points.map((point) => {
        const valueText = entry.money ? utils.formatMoney(point.value) : utils.formatCount(point.value);
        return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.2" fill="${entry.color}"><title>${utils.escapeHtml(`${entry.label} · ${point.row.label}: ${valueText}`)}</title></circle>`;
      }).join('');
      return `<path d="${driveComparisonPointPath(points)}" fill="none" stroke="${entry.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>${circles}`;
    }).join('');
    const legend = activeSeries.map((entry) => `<span class="drive-comparison-legend-item"><span style="background:${entry.color}"></span>${utils.escapeHtml(entry.label)}</span>`).join('');
    const note = chartView === 'pledges'
      ? 'Showing pledge counts only so the scale is readable.'
      : 'Showing dollars only; switch to Pledges only to see pledge-count trends clearly.';
    els.driveComparisonChart.innerHTML = `
      <div class="drive-comparison-legend-row">
        <div class="drive-comparison-legend">${legend}</div>
        <div class="drive-comparison-view-note">${utils.escapeHtml(note)}</div>
      </div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Drive comparison ${chartView === 'pledges' ? 'pledge count' : 'dollar'} line chart">
        <rect x="0" y="0" width="${width}" height="${height}" class="drive-comparison-chart-bg"></rect>
        ${grid}
        <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + innerH}" class="drive-comparison-axis-line"></line>
        <line x1="${pad.left}" y1="${pad.top + innerH}" x2="${width - pad.right}" y2="${pad.top + innerH}" class="drive-comparison-axis-line"></line>
        <text x="${pad.left}" y="18" class="drive-comparison-axis-title">${utils.escapeHtml(axisTitle)}</text>
        ${seriesSvg}
        ${xLabels}
      </svg>
    `;
    const tableRows = rows.map((row) => `
      <tr>
        <td>${utils.escapeHtml(row.label)}</td>
        <td>${utils.escapeHtml(utils.formatMoney(row.broadcast))}</td>
        <td>${utils.escapeHtml(utils.formatMoney(row.online))}</td>
        <td>${utils.escapeHtml(utils.formatMoney(row.mail))}</td>
        <td>${utils.escapeHtml(utils.formatMoney(row.total))}</td>
        <td>${utils.escapeHtml(utils.formatCount(row.pledges))}</td>
        <td>${utils.escapeHtml(utils.formatCount(row.fundraiserCount))}</td>
      </tr>
    `).join('');
    els.driveComparisonTable.innerHTML = `
      <div class="table-wrap drive-comparison-results-wrap">
        <table class="programs-table drive-comparison-results-table">
          <thead><tr><th>Period</th><th>Broadcast $</th><th>Online $</th><th>Mail $</th><th>Total raised $</th><th>Pledges</th><th>Fundraisers</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    `;
    const totalFundraisers = rows.reduce((sum, row) => sum + row.fundraiserCount, 0);
    const comparisonLabel = mode === 'quarter' ? `Q${quarter} year-over-year` : 'annual totals';
    if (els.driveComparisonSummary) els.driveComparisonSummary.textContent = `${comparisonLabel}: ${utils.formatCount(totalFundraisers)} fundraiser period${totalFundraisers === 1 ? '' : 's'} included.`;
  }

  async function renderDriveComparison() {
    if (!els.driveComparisonChart) return;
    els.driveComparisonChart.innerHTML = '<div class="drive-comparison-empty">Loading fundraiser comparison…</div>';
    try {
      const rows = await ensureScheduleImportedAiringsLoaded();
      const defaults = driveComparisonDefaults(rows);
      if (els.driveComparisonStartDate && !els.driveComparisonStartDate.value) els.driveComparisonStartDate.value = defaults.startDate;
      if (els.driveComparisonEndDate && !els.driveComparisonEndDate.value) els.driveComparisonEndDate.value = defaults.endDate;
      if (els.driveComparisonQuarter && !els.driveComparisonQuarter.value) els.driveComparisonQuarter.value = defaults.quarter;
      const buckets = driveComparisonBuildSeriesRows(rows);
      driveComparisonRenderChart(buckets);
    } catch (error) {
      console.error(error);
      els.driveComparisonChart.innerHTML = `<div class="drive-comparison-empty error">${utils.escapeHtml(error?.message || 'Could not load drive comparison data.')}</div>`;
      if (els.driveComparisonSummary) els.driveComparisonSummary.textContent = 'Drive comparison failed to load.';
    }
  }

  async function openDriveComparison() {
    els.driveComparisonBackdrop?.classList.remove('hidden');
    els.driveComparisonModal?.classList.remove('hidden');
    document.body.classList.add('modal-open');
    await renderDriveComparison();
  }

  function closeDriveComparison() {
    els.driveComparisonBackdrop?.classList.add('hidden');
    els.driveComparisonModal?.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  function bindEvents() {
    document.addEventListener('wnmu:performance-ready', () => {
      if (!getActiveSchedule()) return;
      window.requestAnimationFrame(() => renderScheduleEditor());
    });
    els.newScheduleButton?.addEventListener('click', resetToNewScheduleDraft);
    els.scheduleMobileNewButton?.addEventListener('click', resetToNewScheduleDraft);
    els.driveComparisonButton?.addEventListener('click', () => { void openDriveComparison(); });
    els.driveComparisonCloseButton?.addEventListener('click', closeDriveComparison);
    els.driveComparisonBackdrop?.addEventListener('click', closeDriveComparison);
    els.driveComparisonRefreshButton?.addEventListener('click', () => { void renderDriveComparison(); });
    [els.driveComparisonStartDate, els.driveComparisonEndDate, els.driveComparisonMode, els.driveComparisonQuarter, els.driveComparisonChartView]
      .filter(Boolean)
      .forEach((node) => node.addEventListener('change', () => { void renderDriveComparison(); }));
    const handleScheduleSelectChange = (event) => {
      const scheduleId = String(event.target?.value || '');
      if (!scheduleId) return;
      if (scheduleId === DELETE_ACTIVE_SCHEDULE_OPTION) {
        const activeId = state.activeScheduleId || '';
        if (event.target) event.target.value = activeId;
        if (activeId) void requestDeleteSchedule(activeId);
        return;
      }
      activateScheduleById(scheduleId, { focusCalendar: true });
    };
    const reopenSelectedSchedule = (event) => {
      const scheduleId = String(event.target?.value || state.activeScheduleId || '');
      if (!scheduleId || scheduleId === DELETE_ACTIVE_SCHEDULE_OPTION) return;
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
    els.fundraiserGoalInput?.addEventListener('change', saveScheduleDraft);
    els.scheduleList?.addEventListener('click', (event) => {
      const open = event.target.closest('[data-schedule-id]');
      if (open) {
        activateScheduleById(open.dataset.scheduleId, { focusCalendar: true });
        return;
      }
      const del = event.target.closest('[data-delete-schedule-id], [data-delete-invalid-schedule-id]');
      if (del) {
        const scheduleId = del.dataset.deleteScheduleId || del.dataset.deleteInvalidScheduleId;
        if (scheduleId) void requestDeleteSchedule(scheduleId);
      }
    });
    els.scheduleGrid?.addEventListener('click', (event) => {
      if (event.target.closest('[data-placement-transfer-toggle], [data-grid-transfer-placement-id]')) return;
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
    els.scheduleGrid?.addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-grid-transfer-placement-id]');
      if (!checkbox) return;
      event.stopPropagation();
      toggleTransferred(checkbox.dataset.gridTransferPlacementId, checkbox.checked);
    });
    els.scheduleGrid?.addEventListener('scroll', queueScheduleInlineScrollbarSync, { passive: true });
    els.scheduleGrid?.addEventListener('mousedown', (event) => {
      const thumb = event.target.closest('.schedule-inline-scrollbar-thumb');
      const rail = event.target.closest('.schedule-inline-scrollbar');
      if (!thumb || !rail || !els.scheduleGrid) return;
      event.preventDefault();
      scheduleInlineScrollbar.dragActive = true;
      scheduleInlineScrollbar.dragStartY = event.clientY;
      scheduleInlineScrollbar.dragStartScrollTop = els.scheduleGrid.scrollTop || 0;
      document.body.classList.add('schedule-inline-scrollbar-dragging');
    });
    els.scheduleGrid?.addEventListener('click', (event) => {
      const rail = event.target.closest('.schedule-inline-scrollbar');
      const thumb = event.target.closest('.schedule-inline-scrollbar-thumb');
      if (!rail || thumb || !els.scheduleGrid) return;
      const rect = rail.getBoundingClientRect();
      const thumbEl = rail.querySelector('.schedule-inline-scrollbar-thumb');
      const thumbHeight = thumbEl?.offsetHeight || 44;
      const trackHeight = rail.clientHeight || 1;
      const maxThumbTravel = Math.max(1, trackHeight - thumbHeight);
      const clickY = Math.max(0, Math.min(trackHeight, event.clientY - rect.top - (thumbHeight / 2)));
      const scrollRange = Math.max(1, els.scheduleGrid.scrollHeight - els.scheduleGrid.clientHeight);
      els.scheduleGrid.scrollTop = (clickY / maxThumbTravel) * scrollRange;
      queueScheduleInlineScrollbarSync();
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
    els.scheduleSlotRescue?.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-rescue-toggle]');
      if (toggle) {
        event.preventDefault();
        const target = [...(els.scheduleSlotRescue?.querySelectorAll('[data-rescue-detail]') || [])]
          .find((node) => node.getAttribute('data-rescue-detail') === String(toggle.dataset.rescueToggle || ''));
        if (target) target.classList.toggle('hidden');
        return;
      }
      const place = event.target.closest('[data-rescue-place]');
      if (!place) return;
      event.preventDefault();
      event.stopPropagation();
      void rescueImportedRowToSelectedSlot(place.dataset.rescuePlace);
    });
    els.scheduleClearPlacementButton?.addEventListener('click', () => { void clearSelectedPlacement(); });
    els.scheduleZoomInButton?.addEventListener('click', () => adjustZoom(0.15));
    els.scheduleZoomOutButton?.addEventListener('click', () => adjustZoom(-0.15));
    els.scheduleStartEarlierButton?.addEventListener('click', () => adjustRange('start', -1));
    els.scheduleStartLaterButton?.addEventListener('click', () => adjustRange('start', 1));
    els.scheduleEndEarlierButton?.addEventListener('click', () => adjustRange('end', -1));
    els.scheduleEndLaterButton?.addEventListener('click', () => adjustRange('end', 1));
    const openDailyRundown = () => { void exportScheduleView(); };
    els.scheduleExportButton?.addEventListener('click', openDailyRundown);
    els.scheduleDailyRundownButton?.addEventListener('click', openDailyRundown);
    els.scheduleProgramDetails?.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-scheduled-card-toggle]');
      if (!toggle) return;
      event.preventDefault();
      event.stopPropagation();
      const card = toggle.closest('[data-scheduled-detail-card]');
      const detail = card?.querySelector('.scheduled-program-expanded-detail');
      if (!card || !detail) return;
      const nextExpanded = detail.hasAttribute('hidden');
      detail.toggleAttribute('hidden', !nextExpanded);
      card.classList.toggle('expanded', nextExpanded);
      toggle.textContent = nextExpanded ? 'Hide' : 'Details';
      toggle.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
    });
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
    window.addEventListener('resize', queueScheduleInlineScrollbarSync);
    window.addEventListener('mousemove', handleInlineScrollbarDrag);
    window.addEventListener('mouseup', stopInlineScrollbarDrag);
    els.scheduleProgramCloseButton?.addEventListener('click', closeScheduleModal);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideScheduleContextMenu();
        if (!els.scheduleProgramModal?.classList.contains('hidden')) closeScheduleModal();
        if (!els.driveComparisonModal?.classList.contains('hidden')) closeDriveComparison();
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

  async function refreshImportedAiringMarkers() {
    state.scheduleAiringHistoryLoaded = false;
    state.scheduleAiringHistoryLoading = false;
    state.scheduleImportedSlotMap = new Set();
    state.scheduleImportedAiringsCache = null;
    state.scheduleImportedAiringsPromise = null;
    importedScheduleTotalsHydration.clear();
    (state.schedules || []).forEach((schedule) => {
      if (schedule) {
        delete schedule.__importedTotalsSignature;
        if (schedule.meta) delete schedule.meta.importedTotalsHydratedSignature;
      }
    });
    await ensureScheduleAiringHistoryLoaded();
    const active = getActiveSchedule();
    if (active) await ensureScheduleImportedTotals(active);
  }

  function renderAll() {
    const schedulingPane = document.querySelector('[data-workspace-pane="scheduling"]');
    if (schedulingPane) schedulingPane.dataset.scheduleState = getActiveSchedule() ? 'active' : 'empty';
    populateScheduleTopicSelect();
    renderScheduleList();
    renderScheduleForm();
    renderScheduleGrid();
    renderHomeDriveSummary();
  }

  App.schedulingUi = {
    loadSchedules,
    warmup,
    ensureReady,
    renderAll,
    bindEvents,
    renderScheduleGrid,
    renderScheduleList,
    renderHomeDriveSummary,
    renderScheduledProgramDetails,
    invalidateScheduleDetail,
    refreshImportedAiringMarkers,
    buildSchedulesFromImportedReports,
    mergeImportedRowsIntoSchedules,
    closeScheduleModal
  };
})();

(() => {
  const App = window.PledgeLib;
  const { state, constants, utils, derive } = App;
  const { els, setNotice } = App.dom;

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
    state.schedules = Array.isArray(loaded) ? loaded : [];
    if (!state.activeScheduleId && state.schedules.length) state.activeScheduleId = state.schedules[0].id;
    if (getActiveSchedule()) applyScheduleToView(getActiveSchedule());
    renderScheduleList();
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

  function createScheduleRecord({ title, startDate, endDate, dayStartHour, dayEndHour, dayStartMinutes, dayEndMinutes }) {
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
      slotNotes: {}
    };
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

  function scheduleIdentityKey(schedule = {}) {
    const importedKey = utils.normalizeText(schedule?.meta?.importedFundraiserKey);
    if (importedKey) return `imported|${importedKey}`.toLowerCase();
    return [
      utils.normalizeText(schedule.title),
      utils.normalizeText(schedule.startDate),
      utils.normalizeText(schedule.endDate)
    ].join('|').toLowerCase();
  }

  function findProgramRowForImportedAiring(row = {}) {
    const programId = String(row.pledge_program_id || row.program_id || '').trim();
    if (programId) {
      const byId = (state.rawRows || []).find((item) => String(derive.programId(item)) === programId);
      if (byId) return byId;
    }
    const wantedNola = utils.normalizeLookupKey(row.nola_code);
    if (wantedNola) {
      const byNola = (state.rawRows || []).find((item) => utils.normalizeLookupKey(derive.nola(item)) === wantedNola) || null;
      if (byNola) return byNola;
    }
    const wantedTitle = utils.normalizeLookupKey(row.program_title || row.title);
    if (wantedTitle) {
      return (state.rawRows || []).find((item) => utils.normalizeLookupKey(derive.title(item)) === wantedTitle) || null;
    }
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

  function buildPlacementFromImportedAiring(row = {}) {
    const sourceRow = findProgramRowForImportedAiring(row);
    const dateKey = importedRowDateKey(row);
    const startMinutes = importedRowStartMinutes(row);
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
      sourceAiringHash: row.row_hash || '',
      sourceImportBatchId: row.import_batch_id || '',
      importedFundraiserKey: importedScheduleKey(row),
      fundraiserLabel: importedFundraiserLabel(row)
    };
  }

  function mergeImportedRowsIntoSchedules(rows = [], { rebuild = false, activateFirst = true, dirtySchedules = [] } = {}) {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const validRows = sourceRows.filter((row) => findProgramRowForImportedAiring(row) && importedRowDateKey(row) && Number.isFinite(importedRowStartMinutes(row)));
    const skippedRows = Math.max(0, sourceRows.length - validRows.length);
    const groups = new Map();
    validRows.forEach((row) => {
      const key = importedScheduleKey(row);
      if (!groups.has(key)) groups.set(key, { rows: [], key, title: importedFundraiserLabel(row), startDate: utils.normalizeText(row.drive_start_date) || importedRowDateKey(row), endDate: utils.normalizeText(row.drive_end_date) || importedRowDateKey(row) });
      const group = groups.get(key);
      group.rows.push(row);
      const dk = importedRowDateKey(row);
      if (dk && (!group.startDate || dk < group.startDate)) group.startDate = dk;
      if (dk && (!group.endDate || dk > group.endDate)) group.endDate = dk;
    });

    let createdSchedules = 0;
    let updatedSchedules = 0;
    let createdPlacements = 0;
    let skippedPlacements = 0;
    let correctedDurations = 0;
    let firstScheduleId = '';

    groups.forEach((group) => {
      const identity = `imported|${group.key}`.toLowerCase();
      let schedule = state.schedules.find((item) => scheduleIdentityKey(item) === identity) || null;
      if (!schedule) {
        schedule = state.schedules.find((item) => {
          const sameRange = utils.normalizeText(item.startDate) === group.startDate && utils.normalizeText(item.endDate) === group.endDate;
          const hasImportedPlacements = (item.placements || []).some((placement) => placement.importedFromReport);
          return sameRange && hasImportedPlacements;
        }) || null;
      }
      if (!schedule) {
        schedule = createScheduleRecord({ title: group.title, startDate: group.startDate, endDate: group.endDate, dayStartHour: constants.DEFAULT_DAY_START_HOUR, dayEndHour: constants.DEFAULT_DAY_END_HOUR, dayStartMinutes: constants.DEFAULT_DAY_START_MINUTES, dayEndMinutes: constants.DEFAULT_DAY_END_MINUTES });
        state.schedules.unshift(schedule);
        createdSchedules += 1;
      } else {
        updatedSchedules += 1;
        if (rebuild) schedule.placements = (schedule.placements || []).filter((item) => !item.importedFromReport);
      }
      schedule.meta = {
        ...(schedule.meta || {}),
        importedFundraiserKey: group.key,
        importedFromReports: true,
        importedDriveStartDate: group.startDate,
        importedDriveEndDate: group.endDate
      };
      if (!firstScheduleId) firstScheduleId = schedule.id;
      if (!dirtySchedules.includes(schedule)) dirtySchedules.push(schedule);
      const existingKeys = new Set((schedule.placements || []).map((placement) => placement.sourceAiringHash || `${placement.programId}|${placement.dateKey}|${placement.startMinutes}`));
      group.rows.forEach((row) => {
        const placement = buildPlacementFromImportedAiring(row);
        if (!placement) return;
        const dedupeKey = placement.sourceAiringHash || `${placement.programId}|${placement.dateKey}|${placement.startMinutes}`;
        if (existingKeys.has(dedupeKey)) { skippedPlacements += 1; return; }
        schedule.placements.push(placement);
        existingKeys.add(dedupeKey);
        createdPlacements += 1;
        if (placement.durationCorrectedFromLibrary) correctedDurations += 1;
      });
    });

    if (activateFirst && firstScheduleId) {
      state.activeScheduleId = firstScheduleId;
      const active = getActiveSchedule();
      if (active) applyScheduleToView(active);
    }

    return {
      schedulesCreated: createdSchedules,
      schedulesUpdated: updatedSchedules,
      placementsCreated: createdPlacements,
      placementsSkipped: skippedPlacements,
      skippedRows,
      correctedDurations,
      fundraiserCount: groups.size
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
    if (summary.skippedRows) noteBits.push(`${utils.formatCount(summary.skippedRows)} airings could not be placed automatically.`);
    if (summary.correctedDurations) noteBits.push(`${utils.formatCount(summary.correctedDurations)} durations were corrected from library runtimes.`);
    noteBits.push(state.scheduleSyncMessage);
    setNotice(noteBits.join(' '));
    return summary;
  }

  function applyScheduleToView(schedule) {
    if (!schedule) return;
    state.activeScheduleId = schedule.id;
    const windowConfig = getScheduleWindow(schedule);
    state.scheduleView.dayStartMinutes = windowConfig.startMinutes;
    state.scheduleView.dayEndMinutes = windowConfig.endMinutes;
    state.scheduleView.dayStartHour = Math.floor(windowConfig.startMinutes / 60);
    state.scheduleView.dayEndHour = Math.floor(windowConfig.endMinutes / 60);
    state.scheduleDraft.title = schedule.title || '';
    state.scheduleDraft.startDate = schedule.startDate || '';
    state.scheduleDraft.endDate = schedule.endDate || '';
    state.scheduleDraft.dayStartMinutes = windowConfig.startMinutes;
    state.scheduleDraft.dayEndMinutes = windowConfig.endMinutes;
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

  function getProgramRowById(programId) {
    const key = String(programId || '');
    return [...(state.rawRows || []), ...(state.nonPledgeRows || [])]
      .find((row) => String(derive.programId(row)) === key) || null;
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

  function populateScheduleTopicSelect() {
    if (!els.scheduleProgramTopicSelect) return;
    const sourceRows = state.scheduleNonPledgeMode ? (state.nonPledgeRows || []) : (state.rawRows || []);
    const values = [...new Set((sourceRows || [])
      .flatMap((row) => [derive.topicPrimary(row), derive.topicSecondary(row)])
      .map((value) => utils.normalizeText(value))
      .filter(Boolean))].sort((a, b) => utils.compareText(a, b));
    els.scheduleProgramTopicSelect.innerHTML = ['<option value="">All topics</option>', ...values.map((value) => `<option value="${utils.escapeHtml(value)}">${utils.escapeHtml(value)}</option>`)].join('');
    els.scheduleProgramTopicSelect.value = state.scheduleProgramTopicFilter || '';
  }

  function scheduleProgramMatches(query, topicFilter, slotDateKey) {
    const text = utils.normalizeText(query).toLowerCase();
    const topicKey = utils.normalizeLookupKey(topicFilter || '');
    const hasTopic = Boolean(topicKey);
    const hasSearch = text.length >= 4;
    const usingNonPledge = Boolean(state.scheduleNonPledgeMode);
    const sourceRows = usingNonPledge ? (state.nonPledgeRows || []) : (state.rawRows || []);
    if (!hasTopic && !hasSearch) return [];
    return sourceRows
      .filter((row) => usingNonPledge || derive.isActive(row))
      .filter((row) => {
        if (!hasTopic) return true;
        const topics = [derive.topicPrimary(row), derive.topicSecondary(row)].map((value) => utils.normalizeLookupKey(value));
        return topics.includes(topicKey);
      })
      .filter((row) => {
        if (!hasSearch) return true;
        const title = utils.normalizeText(derive.title(row)).toLowerCase();
        const nola = utils.normalizeText(derive.nola(row)).toLowerCase();
        return title.includes(text) || nola.includes(text);
      })
      .map((row) => ({ row, rights: rightsCheckForDate(row, slotDateKey), isNonPledge: usingNonPledge }))
      .sort((a, b) => {
        if (a.rights.ok !== b.rights.ok) return a.rights.ok ? -1 : 1;
        return utils.compareText(derive.title(a.row), derive.title(b.row));
      })
      .slice(0, hasTopic ? 60 : 24);
  }

  function ensureScheduleModalState(slot) {
    state.selectedScheduleSlot = slot;
    state.scheduleProgramQuery = '';
    state.scheduleProgramTopicFilter = '';
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
    if (!els.scheduleList) return;
    if (!state.schedules.length) {
      els.scheduleList.innerHTML = '<div class="schedule-list-empty">No fundraiser calendars yet. Build one below.</div>';
      if (els.scheduleSummary) els.scheduleSummary.textContent = state.scheduleSyncMessage || '0 fundraiser calendars yet.';
      return;
    }
    els.scheduleList.innerHTML = state.schedules.map((schedule) => {
      const active = schedule.id === state.activeScheduleId;
      const placementCount = Array.isArray(schedule.placements) ? schedule.placements.length : 0;
      return `
        <div class="schedule-list-item ${active ? 'active' : ''}">
          <button type="button" class="schedule-list-open" data-schedule-id="${utils.escapeHtml(schedule.id)}">
            <span class="schedule-list-title">${utils.escapeHtml(schedule.title)}</span>
            <span class="schedule-list-meta">${utils.escapeHtml(utils.formatDate(schedule.startDate))} – ${utils.escapeHtml(utils.formatDate(schedule.endDate))} · ${placementCount} scheduled blocks</span>
          </button>
          ${canScheduleEdit() ? `<button type="button" class="ghost tiny-button" data-delete-schedule-id="${utils.escapeHtml(schedule.id)}">Remove</button>` : ''}
        </div>
      `;
    }).join('');
    if (els.scheduleSummary) els.scheduleSummary.textContent = state.scheduleSyncMessage || `${state.schedules.length} fundraiser calendars ready.`;
  }

  function renderScheduleForm() {
    if (!els.scheduleForm) return;
    const editable = canScheduleEdit();
    els.fundraiserTitleInput.value = state.scheduleDraft.title || '';
    els.fundraiserStartInput.value = state.scheduleDraft.startDate || '';
    els.fundraiserEndInput.value = state.scheduleDraft.endDate || '';
    [els.fundraiserTitleInput, els.fundraiserStartInput, els.fundraiserEndInput, els.scheduleGenerateButton].forEach((el) => { if (el) el.disabled = !editable; });
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
    const segment = utils.firstNonEmpty(row.segment_number, row.slot_number);
    const actSeconds = timingValue(row, ['act_seconds', 'program_segment_length_seconds', 'segment_seconds']);
    const breakSeconds = timingValue(row, ['break_seconds', 'pledge_break_seconds', 'break_length_seconds']);
    const localCutinSeconds = timingValue(row, ['local_cutin_seconds', 'local_cutin', 'local_cutin_length_seconds']);
    const segmentStart = timingValue(row, ['act_offset_seconds', 'segment_start_seconds']);
    let breakAt = timingValue(row, ['break_offset_seconds', 'break_time_seconds']);
    if (!Number.isFinite(breakAt) && Number.isFinite(segmentStart) && Number.isFinite(actSeconds)) {
      breakAt = segmentStart + actSeconds;
    }
    const parts = [];
    if (segment != null && segment !== '') parts.push(`Seg ${segment}`);
    if (Number.isFinite(segmentStart)) parts.push(`Start ${utils.formatSeconds(segmentStart)}`);
    if (Number.isFinite(actSeconds)) parts.push(`Program ${utils.formatSeconds(actSeconds)}`);
    if (Number.isFinite(breakSeconds)) parts.push(`Break ${utils.formatSeconds(breakSeconds)}`);
    if (Number.isFinite(breakAt)) parts.push(`At ${utils.formatSeconds(breakAt)}`);
    if (Number.isFinite(localCutinSeconds) && localCutinSeconds > 0) parts.push(`Local cut-in ${utils.formatSeconds(localCutinSeconds)}`);
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

    els.scheduleEmpty.classList.add('hidden');
    els.scheduleEditor.classList.remove('hidden');

    const dayKeys = visibleDateKeys(schedule);
    const windowConfig = getScheduleWindow(state.scheduleView);
    const visibleStartMin = windowConfig.startMinutes;
    const visibleEndMin = windowConfig.endMinutes;
    const times = [];
    for (let minutes = visibleStartMin; minutes < visibleEndMin; minutes += constants.DEFAULT_SLOT_MINUTES) times.push(minutes);
    const placements = annotatePlacements(schedule).map((placement) => toDisplayPlacement(placement, visibleStartMin));

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
        const placement = placements.find((item) => item.displayDateKey === displayDateKey && Number(item.displayStartMinutes) <= minutes && Number(item.displayEndMinutes) > minutes) || null;
        const isStart = placement && Number(placement.displayStartMinutes) === minutes;
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
            ${isStart ? `<span title="${utils.escapeHtml(placement.programTitle)}" draggable="${editable ? 'true' : 'false'}" class="schedule-placement ${klass} ${editable ? '' : 'locked'}" data-placement-id="${utils.escapeHtml(placement.id)}" data-date-key="${utils.escapeHtml(placement.dateKey)}" data-minutes="${placement.startMinutes}" style="${style}"><strong>${utils.escapeHtml(placement.programTitle)}</strong><span>${subtitleBits.join(' · ')}</span></span>` : ''}
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

  function loadScheduledDetail(programId) {
    if (!programId || state.scheduleDetailCache[programId]?.loaded || state.scheduleDetailCache[programId]?.loading || !state.client) return;
    state.scheduleDetailCache[programId] = { loading: true, loaded: false };
    App.data.fetchProgramDetail(programId).then((detail) => {
      state.scheduleDetailCache[programId] = { loading: false, loaded: true, detail };
      renderScheduledProgramDetails();
    }).catch((error) => {
      state.scheduleDetailCache[programId] = { loading: false, loaded: true, error };
      renderScheduledProgramDetails();
    });
  }

  function renderScheduledProgramDetails() {
    const schedule = getActiveSchedule();
    if (!schedule || !schedule.placements?.length) {
      els.scheduleProgramDetails.innerHTML = '<div class="schedule-hint">Scheduled program details will appear here once you start assigning titles.</div>';
      return;
    }
    const pledgePlacements = annotatePlacements(schedule).filter((placement) => !placement.isNonPledge);
    if (!pledgePlacements.length) {
      els.scheduleProgramDetails.innerHTML = '<div class="schedule-hint">Only non-pledge markers are on this calendar right now. They stay on the calendar, but they do not appear in the pledge detail list below.</div>';
      return;
    }
    const grouped = new Map();
    pledgePlacements.forEach((placement) => {
      const key = String(placement.programId || placement.programTitle || placement.id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(placement);
    });

    els.scheduleProgramDetails.innerHTML = [...grouped.entries()].map(([programId, occurrences]) => {
      const row = getProgramRowById(programId) || {};
      loadScheduledDetail(programId);
      const cache = state.scheduleDetailCache[programId];
      const runtimeLabel = derive.actualRuntimeLabel(row) !== '—' ? derive.actualRuntimeLabel(row) : `${occurrences[0]?.lengthMinutes || '—'} min`;
      const metaBits = [runtimeLabel, derive.nola(row) || 'No NOLA', derive.topicPrimary(row) || 'No topic'];
      const avgPerFundraiser = Number(derive.avgPerFundraiser(row) || 0) || 0;
      const fundraiserCount = Number(row?.fundraiser_count || row?.drive_count || row?.fundraiser_total || 0) || 0;
      const rawTotalRaised = Number(derive.totalRaised(row) || 0) || 0;
      const computedHistoricalTotal = rawTotalRaised > 0
        ? rawTotalRaised
        : (avgPerFundraiser > 0 ? (fundraiserCount > 0 ? (avgPerFundraiser * fundraiserCount) : avgPerFundraiser) : 0);
      const historicalTotalDisplay = computedHistoricalTotal > 0 ? utils.formatMoney(computedHistoricalTotal) : 'Pending report import';
      const historicalAvgDisplay = avgPerFundraiser > 0 ? utils.formatMoney(avgPerFundraiser) : 'Pending report import';
      const fundraiserCountDisplay = fundraiserCount > 0 ? utils.formatCount(fundraiserCount) : '—';
      const scheduledRows = occurrences
        .sort((a, b) => (`${a.dateKey}|${a.startMinutes}`).localeCompare(`${b.dateKey}|${b.startMinutes}`))
        .map((item) => `
          <label class="scheduled-occurrence-row">
            <input type="checkbox" data-transfer-placement-id="${utils.escapeHtml(item.id)}" ${item.transferredToStation ? 'checked' : ''}>
            <span>${utils.escapeHtml(slotLabel(item.dateKey, item.startMinutes))}${hasLiveBreakFlag(item) ? ' · live-break' : ''}</span>
          </label>
        `).join('');
      let breakHtml = '<div class="scheduled-program-note">Loading break detail…</div>';
      if (cache?.error) breakHtml = `<div class="scheduled-program-note">Break detail unavailable: ${utils.escapeHtml(cache.error.message || 'load failed')}</div>`;
      else if (cache?.loaded) breakHtml = timingSummaryHtml(cache.detail);
      return `
        <article class="scheduled-program-card compact-program-card">
          <div class="scheduled-program-line scheduled-program-line-top">
            <div class="scheduled-program-title-wrap">
              <strong>${utils.escapeHtml(derive.title(row) || occurrences[0].programTitle)}</strong>
              <div class="scheduled-program-meta-inline">${metaBits.map((bit) => `<span>${utils.escapeHtml(bit)}</span>`).join('<span class="meta-dot">•</span>')}</div>
            </div>
          </div>
          <div class="scheduled-program-line scheduled-program-line-bottom">
            <div class="scheduled-data-chunk"><span class="mini-label inline">Distributor</span><span>${utils.escapeHtml(derive.distributor(row) || '—')}</span></div>
            <div class="scheduled-data-chunk"><span class="mini-label inline">Historical Total Raised</span><span>${utils.escapeHtml(historicalTotalDisplay)}</span></div>
            <div class="scheduled-data-chunk"><span class="mini-label inline">Historical Avg / Fundraiser</span><span>${utils.escapeHtml(historicalAvgDisplay)}</span></div>
            <div class="scheduled-data-chunk scheduled-break-chunk"><span class="mini-label inline">Break detail</span>${breakHtml}</div>
            <div class="scheduled-data-chunk scheduled-premium-chunk"><span class="mini-label inline">Premiums</span>${premiumLinesHtml(derive.premiumSummary(row) || '—')}</div>
            <div class="scheduled-data-chunk"><span class="mini-label inline">Fundraisers with data</span><span>${utils.escapeHtml(fundraiserCountDisplay)}</span></div>
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
    if (els.scheduleNonPledgeToggle) {
      els.scheduleNonPledgeToggle.checked = Boolean(state.scheduleNonPledgeMode);
      els.scheduleNonPledgeToggle.disabled = !editable;
    }
    if (state.scheduleNonPledgeMode) ensureNonPledgeRowsLoaded();
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
    if (els.scheduleLiveBreakFlag) els.scheduleLiveBreakFlag.disabled = !editable;
    const matches = scheduleProgramMatches(state.scheduleProgramQuery || '', state.scheduleProgramTopicFilter || '', slot.dateKey);
    const hasTopic = Boolean(utils.normalizeLookupKey(state.scheduleProgramTopicFilter || ''));
    const hasSearch = utils.normalizeText(state.scheduleProgramQuery || '').trim().length >= 4;
    const usingNonPledge = Boolean(state.scheduleNonPledgeMode);

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
    } else if (!hasTopic && !hasSearch) {
      els.scheduleProgramResults.innerHTML = `<div class="schedule-hint">Type at least 4 letters to match an existing ${usingNonPledge ? 'Program Library' : 'pledge'} title, or choose a topic to browse.</div>`;
    } else if (!matches.length) {
      els.scheduleProgramResults.innerHTML = `<div class="schedule-hint">No ${usingNonPledge ? 'Program Library' : 'database'} titles matched this topic/search combination.</div>`;
    } else {
      els.scheduleProgramResults.innerHTML = matches.map(({ row, rights, isNonPledge }) => {
        const runtimeLabel = lengthMetaLabel(row);
        const rightsBegin = derive.rightsBegin(row) ? utils.formatDate(derive.rightsBegin(row)) : '—';
        const rightsEnd = derive.rightsEnd(row) ? utils.formatDate(derive.rightsEnd(row)) : '—';
        const topicText = derive.topicPrimary(row) || derive.topicSecondary(row) || 'No topic';
        return `
          <button type="button" class="schedule-program-match ${rights.ok ? '' : 'blocked'} ${isNonPledge ? 'external' : ''}" data-program-id="${utils.escapeHtml(derive.programId(row))}" data-rights-ok="${rights.ok ? 'true' : 'false'}" data-rights-reason="${utils.escapeHtml(rights.reason || '')}" data-non-pledge="${isNonPledge ? 'true' : 'false'}" ${editable ? '' : 'disabled'}>
            <strong>${utils.escapeHtml(derive.title(row))}</strong>
            <span class="schedule-program-match-meta">${utils.escapeHtml(runtimeLabel)} · ${utils.escapeHtml(derive.nola(row) || 'No NOLA')} · ${utils.escapeHtml(topicText)}</span>
            <span class="schedule-program-rights">${isNonPledge ? 'Program Library marker' : `Rights: ${utils.escapeHtml(rightsBegin)} → ${utils.escapeHtml(rightsEnd)}`}</span>
            ${rights.ok ? '' : `<span class="schedule-program-warning">Not available on ${utils.escapeHtml(utils.formatDate(slot.dateKey))}</span>`}
          </button>
        `;
      }).join('');
    }

    const currentPlacement = findPlacementForSlot(schedule, slot.key);
    if (currentPlacement) {
      els.scheduleSelectedPreview.innerHTML = `<div class="schedule-selected-card"><strong>${utils.escapeHtml(currentPlacement.programTitle)}</strong><div>${utils.escapeHtml(String(currentPlacement.lengthMinutes))} min${currentPlacement.isNonPledge ? ' · non-pledge marker' : ''} · ${utils.escapeHtml(liveBreakFlagLabel(currentPlacement))}</div></div>`;
      if (els.scheduleLiveBreakFlag) els.scheduleLiveBreakFlag.checked = hasLiveBreakFlag(currentPlacement);
      if (els.scheduleClearPlacementButton) els.scheduleClearPlacementButton.disabled = !editable;
      if (els.scheduleCopyPlacementButton) els.scheduleCopyPlacementButton.disabled = !editable;
    } else {
      els.scheduleSelectedPreview.innerHTML = '<div class="schedule-hint">No program assigned to this slot yet.</div>';
      if (els.scheduleLiveBreakFlag) els.scheduleLiveBreakFlag.checked = false;
      if (els.scheduleClearPlacementButton) els.scheduleClearPlacementButton.disabled = true;
      if (els.scheduleCopyPlacementButton) els.scheduleCopyPlacementButton.disabled = true;
    }
    if (els.schedulePastePlacementButton) els.schedulePastePlacementButton.disabled = !editable || !hasScheduleClipboard();
    if (els.scheduleAssignmentNote) {
      if (!editable) {
        els.scheduleAssignmentNote.textContent = 'Viewer mode is read-only. Rights dates are shown so you can still review what fits this slot.';
      } else if (usingNonPledge) {
        els.scheduleAssignmentNote.textContent = 'Non-pledge markers come from the WNMU Program Library, render in light green, and stay out of the pledge detail list below.';
      } else {
        els.scheduleAssignmentNote.textContent = 'Selecting a program places a block sized to that title’s actual runtime when available. Rights are checked against the slot date.';
      }
    }
  }


  async function saveActiveScheduleDraft(options = {}) {
    if (!canScheduleEdit()) { setNotice('Sign in as admin to edit fundraiser calendars.', 'warn'); return false; }
    const schedule = getActiveSchedule();
    if (!schedule) {
      if (!options.silent) setNotice('Choose a fundraiser calendar first, or build a new one.', 'warn');
      return false;
    }
    const startDate = els.fundraiserStartInput?.value || schedule.startDate || '';
    const endDate = els.fundraiserEndInput?.value || schedule.endDate || '';
    const title = (els.fundraiserTitleInput?.value || '').trim() || defaultScheduleTitle(startDate, endDate);
    if (!startDate || !endDate) {
      if (!options.silent) setNotice('A fundraiser needs both a start date and an end date.', 'warn');
      return false;
    }
    if (new Date(`${endDate}T00:00:00`) < new Date(`${startDate}T00:00:00`)) {
      if (!options.silent) setNotice('The fundraiser end date cannot be earlier than the start date.', 'warn');
      return false;
    }
    schedule.title = title;
    schedule.startDate = startDate;
    schedule.endDate = endDate;
    schedule.dayStartMinutes = Number(state.scheduleView.dayStartMinutes ?? (state.scheduleView.dayStartHour * 60));
    schedule.dayEndMinutes = Number(state.scheduleView.dayEndMinutes ?? (state.scheduleView.dayEndHour * 60));
    schedule.dayStartHour = Math.floor(schedule.dayStartMinutes / 60);
    schedule.dayEndHour = Math.floor(schedule.dayEndMinutes / 60);
    state.scheduleDraft.title = title;
    state.scheduleDraft.startDate = startDate;
    state.scheduleDraft.endDate = endDate;
    state.scheduleDraft.dayStartMinutes = schedule.dayStartMinutes;
    state.scheduleDraft.dayEndMinutes = schedule.dayEndMinutes;
    await persistSchedules(schedule);
    renderScheduleList();
    renderScheduleForm();
    renderScheduleGrid();
    if (!options.silent) setNotice(`Saved fundraiser calendar ${schedule.title}. ${state.scheduleSyncMessage}`);
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
      dayEndHour: constants.DEFAULT_DAY_END_HOUR
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
        let cutinLine = 'Local cut-ins: no break timings yet';
        if (!item.isNonPledge && item.programId) {
          let cache = state.scheduleDetailCache[item.programId];
          if (!cache?.loaded && !cache?.loading && state.client) {
            try {
              const detail = await App.data.fetchProgramDetail(item.programId);
              cache = state.scheduleDetailCache[item.programId] = { loading: false, loaded: true, detail };
            } catch (error) {
              cache = state.scheduleDetailCache[item.programId] = { loading: false, loaded: true, error };
            }
          }
          if (cache?.detail?.timings) cutinLine = timingLocalCutinSummary(cache.detail.timings);
        }
        lines.push(`  ${cutinLine}`);
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
    URL.revokeObjectURL(url);
  }

  function bindEvents() {
    els.newScheduleButton?.addEventListener('click', () => {
      state.scheduleDraft = { title: '', startDate: '', endDate: '', dayStartHour: constants.DEFAULT_DAY_START_HOUR, dayEndHour: constants.DEFAULT_DAY_END_HOUR, dayStartMinutes: constants.DEFAULT_DAY_START_MINUTES, dayEndMinutes: constants.DEFAULT_DAY_END_MINUTES };
      renderScheduleForm();
      els.fundraiserTitleInput?.focus();
    });
    els.scheduleGenerateButton?.addEventListener('click', () => { void createOrUpdateScheduleFromDraft(); });
    els.scheduleBuildFromImportsButton?.addEventListener('click', () => { void buildSchedulesFromImportedReports({ rebuild: false, activateFirst: true }); });
    els.scheduleRebuildFromImportsButton?.addEventListener('click', () => { void buildSchedulesFromImportedReports({ rebuild: true, activateFirst: true }); });
    const saveScheduleDraft = () => { void saveActiveScheduleDraft(); };
    els.fundraiserTitleInput?.addEventListener('change', saveScheduleDraft);
    els.fundraiserTitleInput?.addEventListener('blur', saveScheduleDraft);
    els.fundraiserTitleInput?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); saveScheduleDraft(); } });
    els.fundraiserStartInput?.addEventListener('change', saveScheduleDraft);
    els.fundraiserEndInput?.addEventListener('change', saveScheduleDraft);
    els.scheduleList?.addEventListener('click', (event) => {
      const open = event.target.closest('[data-schedule-id]');
      if (open) {
        state.activeScheduleId = open.dataset.scheduleId;
        applyScheduleToView(getActiveSchedule());
        renderAll();
        return;
      }
      const del = event.target.closest('[data-delete-schedule-id]');
      if (del && window.confirm('Remove this fundraiser schedule?')) {
        void deleteScheduleRecord(del.dataset.deleteScheduleId);
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
    els.scheduleNonPledgeToggle?.addEventListener('change', (event) => { state.scheduleNonPledgeMode = Boolean(event.target.checked); state.scheduleProgramTopicFilter = ''; renderProgramPicker(); });
    els.scheduleProgramResults?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-program-id]');
      if (!btn) return;
      const rightsOk = btn.dataset.rightsOk !== 'false';
      const reason = btn.dataset.rightsReason || '';
      if (!rightsOk) {
        showScheduleModalWarning(reason || 'This title is out of rights for the selected slot.', 'bad');
        return;
      }
      void assignProgramToSelectedSlot(btn.dataset.programId, { isNonPledge: btn.dataset.nonPledge === 'true' });
    });
    els.scheduleLiveBreakFlag?.addEventListener('change', () => { void updateLiveBreakFlag(); });
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

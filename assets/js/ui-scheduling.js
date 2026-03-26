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

  function createScheduleRecord({ title, startDate, endDate, dayStartHour, dayEndHour }) {
    return {
      id: utils.makeId('schedule'),
      title: title || defaultScheduleTitle(startDate, endDate),
      startDate,
      endDate,
      dayStartHour,
      dayEndHour,
      createdAt: new Date().toISOString(),
      placements: [],
      slotNotes: {}
    };
  }

  function applyScheduleToView(schedule) {
    if (!schedule) return;
    state.activeScheduleId = schedule.id;
    state.scheduleView.dayStartHour = Number(schedule.dayStartHour || constants.DEFAULT_DAY_START_HOUR);
    state.scheduleView.dayEndHour = Number(schedule.dayEndHour || constants.DEFAULT_DAY_END_HOUR);
    state.scheduleDraft.title = schedule.title || '';
    state.scheduleDraft.startDate = schedule.startDate || '';
    state.scheduleDraft.endDate = schedule.endDate || '';
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
    return (state.rawRows || []).find((row) => String(derive.programId(row)) === String(programId)) || null;
  }

  function scheduleProgramMatches(query) {
    const text = utils.normalizeText(query).toLowerCase();
    if (text.length < 4) return [];
    return (state.rawRows || [])
      .filter((row) => derive.isActive(row))
      .filter((row) => {
        const title = utils.normalizeText(derive.title(row)).toLowerCase();
        const nola = utils.normalizeText(derive.nola(row)).toLowerCase();
        return title.includes(text) || nola.includes(text);
      })
      .sort((a, b) => utils.compareText(derive.title(a), derive.title(b)))
      .slice(0, 14);
  }

  function ensureScheduleModalState(slot) {
    state.selectedScheduleSlot = slot;
    state.scheduleProgramQuery = '';
    const schedule = getActiveSchedule();
    const placement = slot && schedule ? findPlacementForSlot(schedule, slot.key) : null;
    state.selectedScheduleProgram = placement ? placement.programId : null;
  }

  function openScheduleModal(slot) {
    ensureScheduleModalState(slot);
    renderProgramPicker();
    els.scheduleProgramModal?.classList.remove('hidden');
    els.scheduleProgramBackdrop?.classList.remove('hidden');
    document.body.classList.add('modal-open');
    window.setTimeout(() => els.scheduleProgramSearch?.focus(), 0);
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
          <button type="button" class="ghost tiny-button" data-delete-schedule-id="${utils.escapeHtml(schedule.id)}">Remove</button>
        </div>
      `;
    }).join('');
    if (els.scheduleSummary) els.scheduleSummary.textContent = state.scheduleSyncMessage || `${state.schedules.length} fundraiser calendars ready.`;
  }

  function renderScheduleForm() {
    if (!els.scheduleForm) return;
    els.fundraiserTitleInput.value = state.scheduleDraft.title || '';
    els.fundraiserStartInput.value = state.scheduleDraft.startDate || '';
    els.fundraiserEndInput.value = state.scheduleDraft.endDate || '';
  }

  function placementHeight(lengthMinutes, slotHeight) {
    const slots = Math.max(1, Math.ceil((Number(lengthMinutes) || 30) / constants.DEFAULT_SLOT_MINUTES));
    const px = Math.max(slotHeight, (slots * slotHeight) + Math.max(0, slots - 1) - 2);
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
    if (Number.isFinite(localCutinSeconds) && localCutinSeconds > 0) parts.push(`Local cutin ${utils.formatSeconds(localCutinSeconds)}`);
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
    const visibleStartMin = state.scheduleView.dayStartHour * 60;
    const visibleEndMin = state.scheduleView.dayEndHour * 60;
    const times = [];
    for (let minutes = visibleStartMin; minutes < visibleEndMin; minutes += constants.DEFAULT_SLOT_MINUTES) times.push(minutes);
    const placements = annotatePlacements(schedule);

    const zoom = Math.min(2.8, Math.max(0.16, Number(state.scheduleView.zoom || 1)));
    const columnWidth = Math.max(70, Math.round(122 * Math.min(1.28, 0.52 + (zoom * 0.42))));
    const slotHeight = Math.max(8, Math.round(24 * zoom));
    els.scheduleGrid.style.setProperty('--schedule-day-width', `${columnWidth}px`);
    els.scheduleGrid.style.setProperty('--schedule-slot-height', `${slotHeight}px`);
    els.scheduleWindowLabel.textContent = `${utils.minutesToLabel(visibleStartMin)} – ${utils.minutesToLabel(visibleEndMin === 1440 ? 1439 : visibleEndMin)}`;
    if (els.scheduleZoomValue) els.scheduleZoomValue.textContent = `${Math.round(zoom * 100)}%`;

    const header = ['<div class="schedule-corner sticky"></div>'];
    dayKeys.forEach((dateKey) => {
      header.push(`<div class="schedule-day-head sticky">${utils.escapeHtml(formatScheduleDay(dateKey))}</div>`);
    });

    const body = [];
    times.forEach((minutes) => {
      body.push(`<div class="schedule-time-label">${utils.escapeHtml(utils.minutesToLabel(minutes))}</div>`);
      dayKeys.forEach((dateKey) => {
        const slotKey = `${dateKey}|${minutes}`;
        const placement = placements.find((item) => item.dateKey === dateKey && Number(item.startMinutes) <= minutes && Number(item.endMinutes) > minutes) || null;
        const isStart = placement && Number(placement.startMinutes) === minutes;
        const style = isStart ? `height:${placementHeight(placement.lengthMinutes, slotHeight)};` : '';
        const klass = placement ? (placement.isFirstRun ? 'first-run' : 'repeat-run') : '';
        body.push(`
          <button type="button" class="schedule-slot ${state.selectedScheduleSlot?.key === slotKey ? 'selected' : ''}" data-slot-key="${utils.escapeHtml(slotKey)}" data-date-key="${utils.escapeHtml(dateKey)}" data-minutes="${minutes}">
            ${isStart ? `<span draggable="true" class="schedule-placement ${klass}" data-placement-id="${utils.escapeHtml(placement.id)}" style="${style}"><strong>${utils.escapeHtml(placement.programTitle)}</strong><span>${utils.escapeHtml(utils.minutesToLabel(placement.startMinutes))} · ${utils.escapeHtml(String(placement.lengthMinutes))} min</span></span>` : ''}
          </button>
        `);
      });
    });

    els.scheduleGrid.innerHTML = `
      <div class="schedule-grid-head" style="grid-template-columns:88px repeat(${dayKeys.length}, minmax(var(--schedule-day-width), 1fr));">${header.join('')}</div>
      <div class="schedule-grid-body" style="grid-template-columns:88px repeat(${dayKeys.length}, minmax(var(--schedule-day-width), 1fr));">${body.join('')}</div>
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
    const grouped = new Map();
    annotatePlacements(schedule).forEach((placement) => {
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
      const scheduledRows = occurrences
        .sort((a, b) => (`${a.dateKey}|${a.startMinutes}`).localeCompare(`${b.dateKey}|${b.startMinutes}`))
        .map((item) => `
          <label class="scheduled-occurrence-row">
            <input type="checkbox" data-transfer-placement-id="${utils.escapeHtml(item.id)}" ${item.transferredToStation ? 'checked' : ''}>
            <span>${utils.escapeHtml(slotLabel(item.dateKey, item.startMinutes))}</span>
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
            <div class="scheduled-data-chunk"><span class="mini-label inline">Total raised</span><span>${utils.escapeHtml(utils.formatMoney(derive.totalRaised(row)))}</span></div>
            <div class="scheduled-data-chunk"><span class="mini-label inline">Avg / fundraiser</span><span>${utils.escapeHtml(utils.formatMoney(derive.avgPerFundraiser(row)))}</span></div>
            <div class="scheduled-data-chunk scheduled-break-chunk"><span class="mini-label inline">Break detail</span>${breakHtml}</div>
            <div class="scheduled-data-chunk scheduled-premium-chunk"><span class="mini-label inline">Premiums</span>${premiumLinesHtml(derive.premiumSummary(row) || '—')}</div>
            <div class="scheduled-data-chunk scheduled-occurrence-chunk"><span class="mini-label inline">Scheduled in this fundraiser</span><div class="scheduled-occurrence-list">${scheduledRows}</div></div>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderProgramPicker() {
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    if (!(schedule && slot)) return;
    els.scheduleSlotLabel.textContent = slotLabel(slot.dateKey, slot.minutes);
    els.scheduleProgramSearch.value = state.scheduleProgramQuery || '';
    const matches = scheduleProgramMatches(state.scheduleProgramQuery || '');
    if ((state.scheduleProgramQuery || '').trim().length < 4) {
      els.scheduleProgramResults.innerHTML = '<div class="schedule-hint">Type at least 4 letters. This only schedules titles already in the database.</div>';
    } else if (!matches.length) {
      els.scheduleProgramResults.innerHTML = '<div class="schedule-hint">No database titles matched that search.</div>';
    } else {
      els.scheduleProgramResults.innerHTML = matches.map((row) => `
        <button type="button" class="schedule-program-match" data-program-id="${utils.escapeHtml(derive.programId(row))}">
          <strong>${utils.escapeHtml(derive.title(row))}</strong>
          <span>${utils.escapeHtml(derive.actualRuntimeLabel(row) !== '—' ? derive.actualRuntimeLabel(row) : `${String(derive.runtimeMinutes(row) || derive.lengthLabel(row) || '—')} min`)} · ${utils.escapeHtml(derive.nola(row) || 'No NOLA')}</span>
        </button>
      `).join('');
    }

    const currentPlacement = findPlacementForSlot(schedule, slot.key);
    if (currentPlacement) {
      els.scheduleSelectedPreview.innerHTML = `<div class="schedule-selected-card"><strong>${utils.escapeHtml(currentPlacement.programTitle)}</strong><div>${utils.escapeHtml(String(currentPlacement.lengthMinutes))} min · ${utils.escapeHtml(currentPlacement.liveBreakNotes || 'No live-break note')}</div></div>`;
      els.scheduleLiveBreakNotes.value = currentPlacement.liveBreakNotes || '';
      els.scheduleClearPlacementButton.disabled = false;
    } else {
      els.scheduleSelectedPreview.innerHTML = '<div class="schedule-hint">No program assigned to this slot yet.</div>';
      els.scheduleLiveBreakNotes.value = '';
      els.scheduleClearPlacementButton.disabled = true;
    }
    if (els.scheduleAssignmentNote) els.scheduleAssignmentNote.textContent = 'Selecting a program places a block sized to that title’s actual runtime when available. Rights are checked against the slot date.';
  }

  async function createOrUpdateScheduleFromDraft() {
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

  async function assignProgramToSelectedSlot(programId) {
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    const row = getProgramRowById(programId);
    if (!schedule || !slot || !row) return;
    const rightsCheck = rightsCheckForDate(row, slot.dateKey);
    if (!rightsCheck.ok) {
      setNotice(rightsCheck.reason, 'warn');
      if (els.scheduleAssignmentNote) els.scheduleAssignmentNote.textContent = rightsCheck.reason;
      return;
    }
    const lengthMinutes = derive.runtimeMinutes(row) || derive.lengthBucket(row) || 30;
    const slotCount = Math.max(1, Math.ceil(Number(lengthMinutes) / constants.DEFAULT_SLOT_MINUTES));
    const existing = findPlacementForSlot(schedule, slot.key);
    const endMinutes = Math.min((slot.minutes + (slotCount * constants.DEFAULT_SLOT_MINUTES)), 1440);
    const base = {
      id: existing?.id || utils.makeId('place'),
      programId,
      programTitle: derive.title(row),
      lengthMinutes,
      dateKey: slot.dateKey,
      startMinutes: slot.minutes,
      endMinutes,
      startSlotKey: slot.key,
      liveBreakNotes: (els.scheduleLiveBreakNotes.value || '').trim(),
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

  async function updateLiveBreakNote() {
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    if (!schedule || !slot) return;
    const target = findPlacementForSlot(schedule, slot.key);
    if (!target) return;
    target.liveBreakNotes = (els.scheduleLiveBreakNotes.value || '').trim();
    await persistSchedules(schedule);
    renderScheduleGrid();
  }

  function adjustZoom(delta) {
    state.scheduleView.zoom = Math.min(2.8, Math.max(0.16, Number((state.scheduleView.zoom + delta).toFixed(2))));
    renderScheduleGrid();
  }

  function adjustRange(kind, deltaHours) {
    const field = kind === 'start' ? 'dayStartHour' : 'dayEndHour';
    const other = kind === 'start' ? 'dayEndHour' : 'dayStartHour';
    const candidate = state.scheduleView[field] + deltaHours;
    if (kind === 'start') {
      state.scheduleView.dayStartHour = Math.max(constants.MIN_VISIBLE_HOUR, Math.min(candidate, state.scheduleView[other] - 1));
    } else {
      state.scheduleView.dayEndHour = Math.min(constants.MAX_VISIBLE_HOUR, Math.max(candidate, state.scheduleView[other] + 1));
    }
    renderScheduleGrid();
  }

  async function movePlacement(placementId, targetDateKey, targetMinutes) {
    const schedule = getActiveSchedule();
    const placement = findPlacementById(schedule, placementId);
    const row = getProgramRowById(placement?.programId);
    if (!schedule || !placement || !row) return;
    const rightsCheck = rightsCheckForDate(row, targetDateKey);
    if (!rightsCheck.ok) {
      setNotice(rightsCheck.reason, 'warn');
      return;
    }
    const slotCount = Math.max(1, Math.ceil(Number(placement.lengthMinutes || 30) / constants.DEFAULT_SLOT_MINUTES));
    placement.dateKey = targetDateKey;
    placement.startMinutes = targetMinutes;
    placement.endMinutes = Math.min(targetMinutes + (slotCount * constants.DEFAULT_SLOT_MINUTES), 1440);
    placement.startSlotKey = `${targetDateKey}|${targetMinutes}`;
    await persistSchedules(schedule);
    renderScheduleGrid();
    setNotice(`Moved ${placement.programTitle} to ${slotLabel(targetDateKey, targetMinutes)}. ${state.scheduleSyncMessage}`);
  }

  function exportScheduleView() {
    const schedule = getActiveSchedule();
    if (!schedule) return;
    const rows = annotatePlacements(schedule);
    const byDay = new Map();
    rows.forEach((item) => {
      if (!byDay.has(item.dateKey)) byDay.set(item.dateKey, []);
      byDay.get(item.dateKey).push(item);
    });
    const lines = [`${schedule.title}`, ''];
    [...byDay.entries()].forEach(([dateKey, items]) => {
      lines.push(formatScheduleDay(dateKey));
      items.sort((a, b) => a.startMinutes - b.startMinutes).forEach((item) => {
        lines.push(`- ${utils.minutesToLabel(item.startMinutes)} ${item.programTitle} (${item.lengthMinutes} min)${item.liveBreakNotes ? ` | Note: ${item.liveBreakNotes}` : ''}`);
      });
      lines.push('');
    });
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
      state.scheduleDraft = { title: '', startDate: '', endDate: '', dayStartHour: constants.DEFAULT_DAY_START_HOUR, dayEndHour: constants.DEFAULT_DAY_END_HOUR };
      renderScheduleForm();
      els.fundraiserTitleInput?.focus();
    });
    els.scheduleGenerateButton?.addEventListener('click', () => { void createOrUpdateScheduleFromDraft(); });
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
    els.scheduleGrid?.addEventListener('dragstart', (event) => {
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
      const slot = event.target.closest('[data-slot-key]');
      const placementId = state.draggedPlacementId || event.dataTransfer?.getData('text/plain');
      if (!slot || !placementId) return;
      event.preventDefault();
      slot.classList.remove('drag-target');
      void movePlacement(placementId, slot.dataset.dateKey, Number(slot.dataset.minutes || 0));
    });
    els.scheduleProgramSearch?.addEventListener('input', (event) => { state.scheduleProgramQuery = event.target.value || ''; renderProgramPicker(); });
    els.scheduleProgramResults?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-program-id]');
      if (!btn) return;
      void assignProgramToSelectedSlot(btn.dataset.programId);
    });
    els.scheduleLiveBreakNotes?.addEventListener('change', () => { void updateLiveBreakNote(); });
    els.scheduleClearPlacementButton?.addEventListener('click', () => { void clearSelectedPlacement(); });
    els.scheduleZoomInButton?.addEventListener('click', () => adjustZoom(0.15));
    els.scheduleZoomOutButton?.addEventListener('click', () => adjustZoom(-0.15));
    els.scheduleStartEarlierButton?.addEventListener('click', () => adjustRange('start', -1));
    els.scheduleStartLaterButton?.addEventListener('click', () => adjustRange('start', 1));
    els.scheduleEndEarlierButton?.addEventListener('click', () => adjustRange('end', -1));
    els.scheduleEndLaterButton?.addEventListener('click', () => adjustRange('end', 1));
    els.scheduleExportButton?.addEventListener('click', exportScheduleView);
    els.scheduleProgramDetails?.addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-transfer-placement-id]');
      if (!checkbox) return;
      toggleTransferred(checkbox.dataset.transferPlacementId, checkbox.checked);
    });
    els.scheduleProgramBackdrop?.addEventListener('click', closeScheduleModal);
    els.scheduleProgramCloseButton?.addEventListener('click', closeScheduleModal);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.scheduleProgramModal?.classList.contains('hidden')) closeScheduleModal();
    });
  }

  function renderAll() {
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
    closeScheduleModal
  };
})();

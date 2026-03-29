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
    const values = [...new Set((state.rawRows || [])
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
    if (!hasTopic && !hasSearch) return [];
    return (state.rawRows || [])
      .filter((row) => derive.isActive(row))
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
      .map((row) => ({ row, rights: rightsCheckForDate(row, slotDateKey) }))
      .sort((a, b) => {
        if (a.rights.ok !== b.rights.ok) return a.rights.ok ? -1 : 1;
        return utils.compareText(derive.title(a.row), derive.title(b.row));
      })
      .slice(0, hasTopic ? 60 : 20);
  }

  function ensureScheduleModalState(slot) {
    state.selectedScheduleSlot = slot;
    state.scheduleProgramQuery = '';
    state.scheduleProgramTopicFilter = '';
    showScheduleModalWarning('', '');
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

    const zoom = Math.min(2.8, Math.max(0.12, Number(state.scheduleView.zoom || 1)));
    const editable = canScheduleEdit();
    const columnWidth = Math.max(68, Math.round(122 * Math.min(1.28, 0.5 + (zoom * 0.42))));
    const slotHeight = Math.max(6, Math.round(24 * zoom));
    const timeFontPx = zoom < 0.2 ? 8 : zoom < 0.34 ? 9 : zoom < 0.55 ? 10 : 11;
    const compactTimeLabels = zoom < 0.45;
    const ultraCompactTimeLabels = zoom < 0.22;
    els.scheduleGrid.style.setProperty('--schedule-day-width', `${columnWidth}px`);
    els.scheduleGrid.style.setProperty('--schedule-slot-height', `${slotHeight}px`);
    els.scheduleGrid.style.setProperty('--schedule-time-font-size', `${timeFontPx}px`);
    els.scheduleWindowLabel.textContent = `${utils.minutesToLabel(visibleStartMin)} – ${utils.minutesToLabel(visibleEndMin === 1440 ? 1439 : visibleEndMin)}`;
    if (els.scheduleZoomValue) els.scheduleZoomValue.textContent = `${Math.round(zoom * 100)}%`;

    const header = ['<div class="schedule-corner sticky"></div>'];
    dayKeys.forEach((dateKey) => {
      header.push(`<div class="schedule-day-head sticky"><span>${utils.escapeHtml(formatScheduleDay(dateKey))}</span></div>`);
    });

    const body = [];
    times.forEach((minutes) => {
      const showTimeLabel = !compactTimeLabels || (ultraCompactTimeLabels ? (minutes % 120 === 0) : (minutes % 60 === 0));
      body.push(`<div class="schedule-time-label ${showTimeLabel ? '' : 'quiet'}"><span>${showTimeLabel ? utils.escapeHtml(utils.minutesToLabel(minutes)) : ''}</span></div>`);
      dayKeys.forEach((dateKey) => {
        const slotKey = `${dateKey}|${minutes}`;
        const placement = placements.find((item) => item.dateKey === dateKey && Number(item.startMinutes) <= minutes && Number(item.endMinutes) > minutes) || null;
        const isStart = placement && Number(placement.startMinutes) === minutes;
        const style = isStart ? `height:${placementHeight(placement.lengthMinutes, slotHeight)};` : '';
        const klass = placement ? (placement.isFirstRun ? 'first-run' : 'repeat-run') : '';
        body.push(`
          <button type="button" class="schedule-slot ${state.selectedScheduleSlot?.key === slotKey ? 'selected' : ''} ${editable ? '' : 'viewer-only'}" data-slot-key="${utils.escapeHtml(slotKey)}" data-date-key="${utils.escapeHtml(dateKey)}" data-minutes="${minutes}">
            ${isStart ? `<span draggable="${editable ? 'true' : 'false'}" class="schedule-placement ${klass} ${editable ? '' : 'locked'}" data-placement-id="${utils.escapeHtml(placement.id)}" style="${style}"><strong>${utils.escapeHtml(placement.programTitle)}</strong><span>${utils.escapeHtml(utils.minutesToLabel(placement.startMinutes))} · ${utils.escapeHtml(String(placement.lengthMinutes))} min</span></span>` : ''}
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
    const editable = canScheduleEdit();
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
    if (els.scheduleLiveBreakNotes) els.scheduleLiveBreakNotes.disabled = !editable;
    const matches = scheduleProgramMatches(state.scheduleProgramQuery || '', state.scheduleProgramTopicFilter || '', slot.dateKey);
    const hasTopic = Boolean(utils.normalizeLookupKey(state.scheduleProgramTopicFilter || ''));
    const hasSearch = utils.normalizeText(state.scheduleProgramQuery || '').trim().length >= 4;

    if (!editable) {
      showScheduleModalWarning('Viewer mode. Sign in as admin to create, move, remove, or edit scheduled programs.', 'warn');
    } else if (state.scheduleModalWarning?.text) {
      showScheduleModalWarning(state.scheduleModalWarning.text, state.scheduleModalWarning.type || 'warn');
    } else {
      showScheduleModalWarning('', '');
    }

    if (!editable && !findPlacementForSlot(schedule, slot.key)) {
      els.scheduleProgramResults.innerHTML = '<div class="schedule-hint">Viewer mode. Empty slots cannot be edited until an admin signs in.</div>';
    } else if (!hasTopic && !hasSearch) {
      els.scheduleProgramResults.innerHTML = '<div class="schedule-hint">Type at least 4 letters to match an existing title, or choose a topic to browse titles already in the database.</div>';
    } else if (!matches.length) {
      els.scheduleProgramResults.innerHTML = '<div class="schedule-hint">No database titles matched this topic/search combination.</div>';
    } else {
      els.scheduleProgramResults.innerHTML = matches.map(({ row, rights }) => {
        const runtimeLabel = derive.actualRuntimeLabel(row) !== '—' ? derive.actualRuntimeLabel(row) : `${String(derive.runtimeMinutes(row) || derive.lengthLabel(row) || '—')} min`;
        const rightsBegin = derive.rightsBegin(row) ? utils.formatDate(derive.rightsBegin(row)) : '—';
        const rightsEnd = derive.rightsEnd(row) ? utils.formatDate(derive.rightsEnd(row)) : '—';
        const topicText = derive.topicPrimary(row) || derive.topicSecondary(row) || 'No topic';
        return `
          <button type="button" class="schedule-program-match ${rights.ok ? '' : 'blocked'}" data-program-id="${utils.escapeHtml(derive.programId(row))}" data-rights-ok="${rights.ok ? 'true' : 'false'}" data-rights-reason="${utils.escapeHtml(rights.reason || '')}" ${editable ? '' : 'disabled'}>
            <strong>${utils.escapeHtml(derive.title(row))}</strong>
            <span class="schedule-program-match-meta">${utils.escapeHtml(runtimeLabel)} · ${utils.escapeHtml(derive.nola(row) || 'No NOLA')} · ${utils.escapeHtml(topicText)}</span>
            <span class="schedule-program-rights">Rights: ${utils.escapeHtml(rightsBegin)} → ${utils.escapeHtml(rightsEnd)}</span>
            ${rights.ok ? '' : `<span class="schedule-program-warning">Not available on ${utils.escapeHtml(utils.formatDate(slot.dateKey))}</span>`}
          </button>
        `;
      }).join('');
    }

    const currentPlacement = findPlacementForSlot(schedule, slot.key);
    if (currentPlacement) {
      els.scheduleSelectedPreview.innerHTML = `<div class="schedule-selected-card"><strong>${utils.escapeHtml(currentPlacement.programTitle)}</strong><div>${utils.escapeHtml(String(currentPlacement.lengthMinutes))} min · ${utils.escapeHtml(currentPlacement.liveBreakNotes || 'No live-break note')}</div></div>`;
      els.scheduleLiveBreakNotes.value = currentPlacement.liveBreakNotes || '';
      if (els.scheduleClearPlacementButton) els.scheduleClearPlacementButton.disabled = !editable;
      if (els.scheduleCopyPlacementButton) els.scheduleCopyPlacementButton.disabled = !editable;
    } else {
      els.scheduleSelectedPreview.innerHTML = '<div class="schedule-hint">No program assigned to this slot yet.</div>';
      els.scheduleLiveBreakNotes.value = '';
      if (els.scheduleClearPlacementButton) els.scheduleClearPlacementButton.disabled = true;
      if (els.scheduleCopyPlacementButton) els.scheduleCopyPlacementButton.disabled = true;
    }
    if (els.schedulePastePlacementButton) els.schedulePastePlacementButton.disabled = !editable || !hasScheduleClipboard();
    if (els.scheduleAssignmentNote) els.scheduleAssignmentNote.textContent = editable
      ? 'Selecting a program places a block sized to that title’s actual runtime when available. Rights are checked against the slot date.'
      : 'Viewer mode is read-only. Rights dates are shown so you can still review what fits this slot.';
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

  async function assignProgramToSelectedSlot(programId) {
    if (!canScheduleEdit()) { showScheduleModalWarning('Viewer mode. Sign in as admin to assign programs.', 'bad'); return; }
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    const row = getProgramRowById(programId);
    if (!schedule || !slot || !row) return;
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

  async function updateLiveBreakNote() {
    if (!canScheduleEdit()) return;
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
    state.scheduleView.zoom = Math.min(2.8, Math.max(0.12, Number((state.scheduleView.zoom + delta).toFixed(2))));
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
    placement.endMinutes = Math.min(targetMinutes + (slotCount * constants.DEFAULT_SLOT_MINUTES), 1440);
    placement.startSlotKey = `${targetDateKey}|${targetMinutes}`;
    await persistSchedules(schedule);
    renderScheduleGrid();
    setNotice(`Moved ${placement.programTitle} to ${slotLabel(targetDateKey, targetMinutes)}. ${state.scheduleSyncMessage}`);
  }

  function copySelectedPlacement() {
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    const target = schedule && slot ? findPlacementForSlot(schedule, slot.key) : null;
    if (!target) {
      showScheduleModalWarning('There is no scheduled program in this slot to copy.', 'warn');
      return;
    }
    copyPlacementToClipboard(target);
    renderProgramPicker();
    showScheduleModalWarning(`Copied ${target.programTitle}.`, 'ok');
  }

  async function pasteClipboardToSelectedSlot() {
    if (!canScheduleEdit()) { showScheduleModalWarning('Viewer mode. Sign in as admin to paste scheduled programs.', 'bad'); return; }
    const clip = state.scheduleClipboard;
    const slot = state.selectedScheduleSlot;
    const schedule = getActiveSchedule();
    if (!clip?.programId || !slot || !schedule) {
      showScheduleModalWarning('Nothing is copied yet.', 'warn');
      return;
    }
    const row = getProgramRowById(clip.programId);
    if (!row) {
      showScheduleModalWarning('The copied title could not be found in the current database.', 'bad');
      return;
    }
    const rightsCheck = rightsCheckForDate(row, slot.dateKey);
    if (!rightsCheck.ok) {
      showScheduleModalWarning(rightsCheck.reason, 'bad');
      return;
    }
    const existing = findPlacementForSlot(schedule, slot.key);
    if (existing) schedule.placements = schedule.placements.filter((item) => item.id !== existing.id);
    const lengthMinutes = Number(derive.runtimeMinutes(row) || clip.lengthMinutes || 30);
    const slotCount = Math.max(1, Math.ceil(Number(lengthMinutes) / constants.DEFAULT_SLOT_MINUTES));
    const endMinutes = Math.min((slot.minutes + (slotCount * constants.DEFAULT_SLOT_MINUTES)), 1440);
    schedule.placements.push({
      id: utils.makeId('placement'),
      programId: derive.programId(row),
      programTitle: derive.title(row),
      dateKey: slot.dateKey,
      startMinutes: slot.minutes,
      endMinutes,
      startSlotKey: slot.key,
      lengthMinutes,
      liveBreakNotes: clip.liveBreakNotes || ''
    });
    await persistSchedules(schedule);
    renderScheduleGrid();
    renderProgramPicker();
    showScheduleModalWarning(`Pasted ${derive.title(row)} into ${slotLabel(slot.dateKey, slot.minutes)}.`, 'ok');
    setNotice(`Pasted ${derive.title(row)} into ${slotLabel(slot.dateKey, slot.minutes)}. ${state.scheduleSyncMessage}`);
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
    els.scheduleProgramResults?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-program-id]');
      if (!btn) return;
      const rightsOk = btn.dataset.rightsOk !== 'false';
      const reason = btn.dataset.rightsReason || '';
      if (!rightsOk) {
        showScheduleModalWarning(reason || 'This title is out of rights for the selected slot.', 'bad');
        return;
      }
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
    els.scheduleCopyPlacementButton?.addEventListener('click', copySelectedPlacement);
    els.schedulePastePlacementButton?.addEventListener('click', () => { void pasteClipboardToSelectedSlot(); });
    els.scheduleProgramModal?.addEventListener('click', (event) => event.stopPropagation());
    els.scheduleProgramBackdrop?.addEventListener('click', closeScheduleModal);
    els.scheduleProgramCloseButton?.addEventListener('click', closeScheduleModal);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.scheduleProgramModal?.classList.contains('hidden')) closeScheduleModal();
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
    closeScheduleModal
  };
})();

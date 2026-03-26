(() => {
  const App = window.PledgeLib;
  const { state, constants, utils, derive } = App;
  const { els, setNotice } = App.dom;

  function loadSchedules() {
    const items = utils.storageGet(constants.SCHEDULE_STORAGE_KEY, []);
    state.schedules = Array.isArray(items) ? items : [];
    if (!state.activeScheduleId && state.schedules.length) state.activeScheduleId = state.schedules[0].id;
  }

  function persistSchedules() {
    utils.storageSet(constants.SCHEDULE_STORAGE_KEY, state.schedules);
  }

  function getActiveSchedule() {
    return derive.scheduleById(state.activeScheduleId);
  }

  function defaultScheduleTitle(startDate, endDate) {
    if (!startDate || !endDate) return 'New fundraiser';
    return `Fundraiser ${utils.formatDate(startDate)} – ${utils.formatDate(endDate)}`;
  }

  function buildHalfHourKeys(startDate, endDate) {
    const days = utils.datesBetween(startDate, endDate);
    const slots = [];
    days.forEach((dateKey) => {
      for (let minutes = 0; minutes < 1440; minutes += constants.DEFAULT_SLOT_MINUTES) {
        slots.push({
          key: `${dateKey}|${minutes}`,
          dateKey,
          minutes
        });
      }
    });
    return slots;
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
    state.scheduleDraft.dayStartHour = state.scheduleView.dayStartHour;
    state.scheduleDraft.dayEndHour = state.scheduleView.dayEndHour;
  }

  function renderScheduleList() {
    if (!els.scheduleList) return;
    if (!state.schedules.length) {
      els.scheduleList.innerHTML = '<div class="schedule-list-empty">No fundraiser calendars yet. Build one below.</div>';
      if (els.scheduleSummary) els.scheduleSummary.textContent = '0 fundraiser calendars saved in this browser.';
      return;
    }
    els.scheduleList.innerHTML = state.schedules.map((schedule) => {
      const active = schedule.id === state.activeScheduleId;
      const placementCount = Array.isArray(schedule.placements) ? schedule.placements.length : 0;
      return `
        <button type="button" class="schedule-list-item ${active ? 'active' : ''}" data-schedule-id="${utils.escapeHtml(schedule.id)}">
          <span class="schedule-list-title">${utils.escapeHtml(schedule.title)}</span>
          <span class="schedule-list-meta">${utils.escapeHtml(utils.formatDate(schedule.startDate))} – ${utils.escapeHtml(utils.formatDate(schedule.endDate))} · ${placementCount} scheduled blocks</span>
        </button>
      `;
    }).join('');
    if (els.scheduleSummary) els.scheduleSummary.textContent = `${state.schedules.length} fundraiser calendar${state.schedules.length === 1 ? '' : 's'} saved in this browser.`;
  }

  function renderScheduleForm() {
    if (!els.scheduleForm) return;
    els.fundraiserTitleInput.value = state.scheduleDraft.title || '';
    els.fundraiserStartInput.value = state.scheduleDraft.startDate || '';
    els.fundraiserEndInput.value = state.scheduleDraft.endDate || '';
  }

  function visibleDateKeys(schedule) {
    return utils.datesBetween(schedule.startDate, schedule.endDate);
  }

  function findPlacementForSlot(schedule, slotKey) {
    return (schedule.placements || []).find((placement) => {
      const slots = placement.slotKeys || [];
      return slots.includes(slotKey);
    }) || null;
  }

  function slotLabel(dateKey, minutes) {
    return `${utils.formatDate(dateKey)} · ${utils.minutesToLabel(minutes)}`;
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
      .slice(0, 12);
  }

  function renderProgramPicker() {
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    const canUse = Boolean(schedule && slot);
    els.scheduleProgramPicker.classList.toggle('hidden', !canUse);
    if (!canUse) return;
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
          <span>${utils.escapeHtml(derive.lengthLabel(row))} min · ${utils.escapeHtml(derive.nola(row) || 'No NOLA')}</span>
        </button>
      `).join('');
    }

    const currentPlacement = findPlacementForSlot(schedule, slot.key);
    if (currentPlacement) {
      els.scheduleSelectedPreview.innerHTML = `<div class="schedule-selected-card"><strong>${utils.escapeHtml(currentPlacement.programTitle)}</strong><div>${utils.escapeHtml(currentPlacement.lengthMinutes)} min · ${utils.escapeHtml(currentPlacement.liveBreakNotes || 'No live-break note')}</div></div>`;
      els.scheduleLiveBreakNotes.value = currentPlacement.liveBreakNotes || '';
      els.scheduleClearPlacementButton.disabled = false;
    } else {
      els.scheduleSelectedPreview.innerHTML = '<div class="schedule-hint">No program assigned to this slot yet.</div>';
      els.scheduleLiveBreakNotes.value = '';
      els.scheduleClearPlacementButton.disabled = true;
    }
  }

  function placementHeight(lengthMinutes) {
    const slots = Math.max(1, Math.ceil((Number(lengthMinutes) || 30) / constants.DEFAULT_SLOT_MINUTES));
    return `calc(${slots} * var(--schedule-slot-height))`;
  }

  function renderScheduleGrid() {
    const schedule = getActiveSchedule();
    if (!schedule) {
      els.scheduleEmpty.classList.remove('hidden');
      els.scheduleEditor.classList.add('hidden');
      els.scheduleProgramPicker.classList.add('hidden');
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

    const columnWidth = Math.max(150, Math.round(150 * state.scheduleView.zoom));
    els.scheduleGrid.style.setProperty('--schedule-day-width', `${columnWidth}px`);
    els.scheduleGrid.style.setProperty('--schedule-slot-height', `${Math.round(24 * state.scheduleView.zoom)}px`);
    els.scheduleWindowLabel.textContent = `${utils.minutesToLabel(visibleStartMin)} – ${utils.minutesToLabel(visibleEndMin % 1440 || 1440)}`;

    const header = ['<div class="schedule-corner"></div>'];
    dayKeys.forEach((dateKey) => {
      header.push(`<div class="schedule-day-head">${utils.escapeHtml(utils.formatDate(dateKey))}</div>`);
    });

    const body = [];
    times.forEach((minutes) => {
      body.push(`<div class="schedule-time-label">${utils.escapeHtml(utils.minutesToLabel(minutes))}</div>`);
      dayKeys.forEach((dateKey) => {
        const slotKey = `${dateKey}|${minutes}`;
        const placement = findPlacementForSlot(schedule, slotKey);
        const isStart = placement && placement.startSlotKey === slotKey;
        body.push(`
          <button type="button" class="schedule-slot ${state.selectedScheduleSlot?.key === slotKey ? 'selected' : ''}" data-slot-key="${utils.escapeHtml(slotKey)}" data-date-key="${utils.escapeHtml(dateKey)}" data-minutes="${minutes}">
            ${isStart ? `<span class="schedule-placement" style="height:${placementHeight(placement.lengthMinutes)}"><strong>${utils.escapeHtml(placement.programTitle)}</strong><span>${utils.escapeHtml(placement.lengthMinutes)} min</span></span>` : ''}
          </button>
        `);
      });
    });

    els.scheduleGrid.innerHTML = `<div class="schedule-grid-head">${header.join('')}</div><div class="schedule-grid-body">${body.join('')}</div>`;
    renderProgramPicker();
    renderScheduledProgramDetails();
  }

  function renderScheduledProgramDetails() {
    const schedule = getActiveSchedule();
    if (!schedule || !schedule.placements?.length) {
      els.scheduleProgramDetails.innerHTML = '<div class="schedule-hint">Scheduled program details will appear here once you start assigning titles.</div>';
      return;
    }
    const sorted = [...schedule.placements].sort((a, b) => `${a.dateKey}|${String(a.startMinutes).padStart(4, '0')}`.localeCompare(`${b.dateKey}|${String(b.startMinutes).padStart(4, '0')}`));
    els.scheduleProgramDetails.innerHTML = sorted.map((placement) => `
      <article class="scheduled-program-card">
        <div class="scheduled-program-head">
          <strong>${utils.escapeHtml(placement.programTitle)}</strong>
          <span>${utils.escapeHtml(utils.formatDate(placement.dateKey))} · ${utils.escapeHtml(utils.minutesToLabel(placement.startMinutes))}</span>
        </div>
        <div class="scheduled-program-meta">${utils.escapeHtml(placement.lengthMinutes)} minutes · ${utils.escapeHtml(placement.nola || 'No NOLA')} · ${utils.escapeHtml(placement.topic || 'No topic')}</div>
        <div class="scheduled-program-note">Live-break note: ${utils.escapeHtml(placement.liveBreakNotes || '—')}</div>
      </article>
    `).join('');
  }

  function renderAll() {
    renderScheduleList();
    renderScheduleForm();
    renderScheduleGrid();
  }

  function createNewSchedule() {
    const startDate = els.fundraiserStartInput.value;
    const endDate = els.fundraiserEndInput.value;
    const title = utils.normalizeText(els.fundraiserTitleInput.value) || defaultScheduleTitle(startDate, endDate);
    if (!startDate || !endDate) {
      setNotice('Scheduling needs both a start date and an end date.', 'warn');
      return;
    }
    if (endDate < startDate) {
      setNotice('End date cannot come before start date.', 'warn');
      return;
    }
    const schedule = createScheduleRecord({
      title,
      startDate,
      endDate,
      dayStartHour: state.scheduleView.dayStartHour,
      dayEndHour: state.scheduleView.dayEndHour
    });
    state.schedules.unshift(schedule);
    applyScheduleToView(schedule);
    persistSchedules();
    renderAll();
    setNotice(`Built fundraiser calendar for ${utils.formatDate(startDate)} through ${utils.formatDate(endDate)}.`);
  }

  function selectSchedule(scheduleId) {
    const schedule = derive.scheduleById(scheduleId);
    if (!schedule) return;
    applyScheduleToView(schedule);
    state.selectedScheduleSlot = null;
    state.scheduleProgramQuery = '';
    renderAll();
  }

  function chooseSlot(slotKey, dateKey, minutes) {
    state.selectedScheduleSlot = { key: slotKey, dateKey, minutes: Number(minutes) };
    state.scheduleProgramQuery = '';
    renderScheduleGrid();
  }

  function assignProgramToSelectedSlot(programId) {
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    const row = (state.rawRows || []).find((item) => String(derive.programId(item)) === String(programId));
    if (!schedule || !slot || !row) return;
    const lengthMinutes = Number(derive.lengthBucket(row)) || 30;
    const slotCount = Math.max(1, Math.ceil(lengthMinutes / constants.DEFAULT_SLOT_MINUTES));
    const slotKeys = [];
    for (let index = 0; index < slotCount; index += 1) {
      slotKeys.push(`${slot.dateKey}|${slot.minutes + (index * constants.DEFAULT_SLOT_MINUTES)}`);
    }
    schedule.placements = (schedule.placements || []).filter((placement) => !placement.slotKeys.some((key) => slotKeys.includes(key)));
    schedule.placements.push({
      id: utils.makeId('placement'),
      programId: derive.programId(row),
      programTitle: derive.title(row),
      startSlotKey: slot.key,
      slotKeys,
      dateKey: slot.dateKey,
      startMinutes: slot.minutes,
      lengthMinutes,
      nola: derive.nola(row),
      topic: derive.topicPrimary(row),
      liveBreakNotes: els.scheduleLiveBreakNotes.value || ''
    });
    persistSchedules();
    renderScheduleGrid();
    setNotice(`${derive.title(row)} placed at ${slotLabel(slot.dateKey, slot.minutes)}.`);
  }

  function clearSelectedPlacement() {
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    if (!schedule || !slot) return;
    schedule.placements = (schedule.placements || []).filter((placement) => !placement.slotKeys.includes(slot.key));
    persistSchedules();
    renderScheduleGrid();
    setNotice('Removed the scheduled block from that slot.');
  }

  function updateLiveBreakNotes() {
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    if (!schedule || !slot) return;
    const placement = findPlacementForSlot(schedule, slot.key);
    if (!placement) return;
    placement.liveBreakNotes = els.scheduleLiveBreakNotes.value || '';
    persistSchedules();
    renderScheduledProgramDetails();
  }

  function adjustZoom(delta) {
    state.scheduleView.zoom = Math.min(1.9, Math.max(0.75, Number((state.scheduleView.zoom + delta).toFixed(2))));
    renderScheduleGrid();
  }

  function shiftVisibleHours(delta) {
    const span = state.scheduleView.dayEndHour - state.scheduleView.dayStartHour;
    const nextStart = Math.max(constants.MIN_VISIBLE_HOUR, Math.min(constants.MAX_VISIBLE_HOUR - span, state.scheduleView.dayStartHour + delta));
    state.scheduleView.dayStartHour = nextStart;
    state.scheduleView.dayEndHour = nextStart + span;
    renderScheduleGrid();
  }

  function exportScheduleText() {
    const schedule = getActiveSchedule();
    if (!schedule) return;
    const sorted = [...(schedule.placements || [])].sort((a, b) => `${a.dateKey}|${String(a.startMinutes).padStart(4, '0')}`.localeCompare(`${b.dateKey}|${String(b.startMinutes).padStart(4, '0')}`));
    const lines = [`${schedule.title}`, `${utils.formatDate(schedule.startDate)} – ${utils.formatDate(schedule.endDate)}`, ''];
    let currentDate = '';
    sorted.forEach((placement) => {
      if (placement.dateKey !== currentDate) {
        currentDate = placement.dateKey;
        lines.push(utils.formatDate(currentDate));
      }
      lines.push(`  ${utils.minutesToLabel(placement.startMinutes)}  ${placement.programTitle}  (${placement.lengthMinutes} min)`);
      if (placement.liveBreakNotes) lines.push(`    Live-break note: ${placement.liveBreakNotes}`);
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${schedule.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'fundraiser-schedule'}.txt`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function bindEvents() {
    els.newScheduleButton?.addEventListener('click', () => {
      state.activeScheduleId = '';
      state.selectedScheduleSlot = null;
      state.scheduleDraft = {
        title: '',
        startDate: '',
        endDate: '',
        dayStartHour: state.scheduleView.dayStartHour,
        dayEndHour: state.scheduleView.dayEndHour
      };
      renderAll();
    });
    els.scheduleGenerateButton?.addEventListener('click', createNewSchedule);
    els.scheduleList?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-schedule-id]');
      if (!button) return;
      selectSchedule(button.dataset.scheduleId);
    });
    els.scheduleGrid?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-slot-key]');
      if (!button) return;
      chooseSlot(button.dataset.slotKey, button.dataset.dateKey, button.dataset.minutes);
    });
    els.scheduleProgramSearch?.addEventListener('input', (event) => {
      state.scheduleProgramQuery = event.target.value || '';
      renderProgramPicker();
    });
    els.scheduleProgramResults?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-program-id]');
      if (!button) return;
      assignProgramToSelectedSlot(button.dataset.programId);
    });
    els.scheduleClearPlacementButton?.addEventListener('click', clearSelectedPlacement);
    els.scheduleLiveBreakNotes?.addEventListener('change', updateLiveBreakNotes);
    els.scheduleZoomOutButton?.addEventListener('click', () => adjustZoom(-0.15));
    els.scheduleZoomInButton?.addEventListener('click', () => adjustZoom(0.15));
    els.scheduleEarlierButton?.addEventListener('click', () => shiftVisibleHours(-2));
    els.scheduleLaterButton?.addEventListener('click', () => shiftVisibleHours(2));
    els.scheduleExportButton?.addEventListener('click', exportScheduleText);
  }

  App.schedulingUi = {
    loadSchedules,
    persistSchedules,
    renderAll,
    bindEvents
  };
})();

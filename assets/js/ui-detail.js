(() => {
  const App = window.PledgeLib;
  const { state, utils, derive } = App;
  const { els, setDetailNotice } = App.dom;

  const PROGRAM_FIELD_ORDER = [
    'title', 'nola_code', 'program_id', 'id', 'topic_primary', 'topic_secondary', 'distributor', 'package_type',
    'source_format', 'length_bucket_minutes', 'actual_runtime_seconds', 'actual_runtime_minutes', 'runtime_minutes',
    'rights_start', 'rights_end', 'rights_notes', 'premium_summary', 'program_notes', 'status', 'library_state',
    'aired_on_13_1', 'aired_on_13_3', 'last_aired_at', 'last_aired', 'total_contributions', 'avg_contribution_per_drive'
  ];

  function canEdit() {
    return App.auth.canEdit();
  }


  function friendlyCreateError(error) {
    const message = String(error?.message || error || '');
    if (/created_by_email|updated_by_email|created_by|updated_by/i.test(message)) {
      return 'The app tried to send audit columns that do not belong in pledge_programs_v2. That was an app bug, not a valid program field.';
    }
    if (/source_row_number/i.test(message) && /duplicate key value|unique constraint/i.test(message)) {
      return 'The app collided with a unique import-row marker while creating a manual program. That was an app bug, not a duplicate title rule.';
    }
    if (/row-level security|violates row-level security|permission denied|new row violates/i.test(message)) {
      return 'Supabase is blocking new-title inserts on pledge_programs_v2. The app can read and probably update, but INSERT is still denied by RLS. Run the included SQL patch for pledge_programs_v2 insert/update policies, then try again.';
    }
    return message || 'Something went sideways while saving this title.';
  }

  function blankProgram() {
    return {
      title: '',
      nola_code: '',
      distributor: '',
      length_bucket_minutes: '',
      actual_runtime_seconds: '',
      topic_primary: '',
      topic_secondary: '',
      rights_start: '',
      rights_end: '',
      package_type: '',
      source_format: '',
      rights_notes: '',
      premium_summary: '',
      program_notes: ''
    };
  }

  function labelValue(label, value, extraClass = '') {
    return `
      <div class="${utils.escapeHtml(extraClass)}">
        <dt>${utils.escapeHtml(label)}</dt>
        <dd>${value}</dd>
      </div>
    `;
  }

  function detailSubtitleHtml(_program) {
    return state.detailCreateMode
      ? 'Create a new pledge title. NOLA is the key field for report matching.'
      : 'Everything we know about this program.';
  }

  function renderLead(program) {
    const topicValue = [derive.topicPrimary(program), derive.topicSecondary(program)].filter(Boolean).join(' / ') || '—';
    const rightsWindow = [utils.formatDate(derive.rightsBegin(program), '—'), utils.formatDate(derive.rightsEnd(program), '—')].join(' → ');
    const description = derive.description(program) || 'No description or program notes are available.';

    els.detailProgramMeta.innerHTML = [
      `<div class="detail-lead-chip"><span class="detail-lead-label">NOLA</span><strong>${utils.escapeHtml(derive.nola(program) || '—')}</strong></div>`,
      `<div class="detail-lead-chip"><span class="detail-lead-label">Topic</span><strong>${utils.escapeHtml(topicValue)}</strong></div>`,
      `<div class="detail-lead-chip"><span class="detail-lead-label">Distributor</span><strong>${utils.escapeHtml(derive.distributor(program) || '—')}</strong></div>`,
      `<div class="detail-lead-chip"><span class="detail-lead-label">Rights window</span><strong>${utils.escapeHtml(rightsWindow)}</strong></div>`
    ].join('');
    els.detailProgramDescription.innerHTML = `<div class="detail-long-text">${utils.escapeHtml(description)}</div>`;
  }

  function premiumSummaryHtml(value) {
    const text = utils.normalizeText(value);
    if (!text) return '<div class="premium-line">—</div>';
    const lines = text
      .replace(/\r/g, '')
      .replace(/\s*;\s*/g, '\n')
      .replace(/\s+(?=\$)/g, '\n')
      .split(/\n+/)
      .map((part) => utils.normalizeText(part))
      .filter(Boolean);
    const finalLines = lines.length ? lines : [text];
    return finalLines.map((line) => `<div class="premium-line">${utils.escapeHtml(line)}</div>`).join('');
  }

  function renderOverview(program, driveResults = [], exactAirings = []) {
    const topicValue = [derive.topicPrimary(program), derive.topicSecondary(program)].filter(Boolean).join(' / ') || '—';
    const lastAired = exactAirings.length
      ? utils.formatDate(utils.firstNonEmpty(exactAirings[0].aired_at, exactAirings[0].air_date), 'N/A')
      : driveResults.length
        ? utils.formatDate(utils.firstNonEmpty(driveResults[0].drive_date, driveResults[0].aired_at), 'N/A')
        : derive.lastAiredDisplay(program);

    els.overviewGrid.innerHTML = [
      labelValue('Actual runtime', utils.escapeHtml(derive.actualRuntimeLabel(program)), 'overview-spotlight'),
      labelValue('Length bucket', utils.escapeHtml(derive.lengthLabel(program)), 'overview-spotlight'),
      labelValue('Topic', utils.escapeHtml(topicValue), 'overview-spotlight'),
      labelValue('Distributor', utils.escapeHtml(derive.distributor(program) || '—'), 'overview-spotlight'),
      labelValue('Rights begin', utils.escapeHtml(utils.formatDate(derive.rightsBegin(program)))),
      labelValue('Rights end', utils.escapeHtml(utils.formatDate(derive.rightsEnd(program)))),
      labelValue('Last aired', utils.escapeHtml(lastAired || 'N/A')),
      labelValue('Status', utils.escapeHtml(utils.normalizeText(utils.firstNonEmpty(program.status, program.library_state, derive.isActive(program) ? 'Active' : 'Archived')) || '—')),
      labelValue('Total contributions', utils.escapeHtml(utils.formatMoney(derive.totalRaised(program)))),
      labelValue('Average per fundraiser', utils.escapeHtml(utils.formatMoney(derive.avgPerFundraiser(program)))),
      labelValue('Package type', utils.escapeHtml(utils.normalizeText(program.package_type) || '—')),
      labelValue('Source format', utils.escapeHtml(utils.normalizeText(program.source_format) || '—')),
      labelValue('Rights notes', utils.escapeHtml(utils.normalizeText(program.rights_notes) || '—'), 'overview-wide'),
      labelValue('Premium summary', premiumSummaryHtml(derive.premiumSummary(program) || '—'), 'overview-wide')
    ].join('');
  }

  function formatMaybeSeconds(key, value) {
    if (value == null || value === '') return '—';
    const numeric = Number(value);
    if (Number.isFinite(numeric) && /(seconds|offset|duration|runtime|cutin|break|act)_?seconds$/i.test(key)) {
      return utils.formatSeconds(numeric);
    }
    if (typeof value === 'object') return utils.escapeHtml(JSON.stringify(value));
    return utils.escapeHtml(utils.normalizeText(value) || String(value));
  }

  function candidateColumns(rows) {
    const preferred = [
      'segment_number', 'slot_number', 'act_offset_seconds', 'act_seconds', 'break_offset_seconds', 'break_seconds', 'local_cutin_seconds',
      'segment_title', 'segment_name', 'notes', 'title', 'nola_code', 'program_title'
    ];
    const seen = new Set();
    const keys = [];
    preferred.forEach((key) => {
      if (rows.some((row) => Object.prototype.hasOwnProperty.call(row || {}, key))) {
        seen.add(key);
        keys.push(key);
      }
    });
    rows.forEach((row) => {
      Object.keys(row || {}).forEach((key) => {
        if (!seen.has(key) && !/^created_at|updated_at$/i.test(key)) {
          seen.add(key);
          keys.push(key);
        }
      });
    });
    return keys;
  }

  function renderTiming(timings) {
    els.timingCountChip.textContent = `${timings.length}`;
    if (!timings.length) {
      els.timingList.innerHTML = '<div class="timing-card">No detailed timing rows are available for this title.</div>';
      return;
    }
    const rows = [...timings].sort((a, b) => Number(a.segment_number || a.slot_number || 0) - Number(b.segment_number || b.slot_number || 0));
    const columns = candidateColumns(rows).filter((key) => !/^(id|program_id|source_row_number)$/i.test(key));
    els.timingList.innerHTML = `
      <article class="timing-card">
        <div class="segment-table-wrap">
          <table class="segment-table">
            <thead>
              <tr>
                ${columns.map((key) => `<th>${utils.escapeHtml(displayKeyLabel(key))}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  ${columns.map((key) => `<td>${formatMaybeSeconds(key, row[key])}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderDriveResults(driveResults, exactAirings) {
    const combined = [];
    exactAirings.forEach((row) => {
      combined.push({
        when: utils.formatDateTime(utils.firstNonEmpty(row.aired_at, row.air_date), 'N/A'),
        contributed: utils.firstNonEmpty(row.contribution_amount, row.total_contributions, row.contributed),
        note: utils.normalizeText(utils.firstNonEmpty(row.fundraiser_label, row.drive_label, row.notes)) || '—'
      });
    });
    driveResults.forEach((row) => {
      const label = utils.normalizeText(utils.firstNonEmpty(row.drive_label, row.drive_column, row.fundraiser_label)) || 'Drive';
      const when = row.drive_date ? `${utils.formatDate(row.drive_date)}${row.drive_window_text ? ` · ${row.drive_window_text}` : ''}` : label;
      combined.push({ when, contributed: utils.firstNonEmpty(row.contribution_amount, row.total_contributions, row.contributed), note: label });
    });
    els.airingCountChip.textContent = `${combined.length}`;
    if (!combined.length) {
      els.airingList.innerHTML = '<div class="premium-card">No readable drive or airing history is available for this title.</div>';
      return;
    }
    els.airingList.innerHTML = `
      <div class="airing-table-wrap">
        <table class="segment-table">
          <thead>
            <tr>
              <th>Aired / drive</th>
              <th>Contributed</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${combined.map((row) => `
              <tr>
                <td>${utils.escapeHtml(row.when)}</td>
                <td>${utils.escapeHtml(row.contributed == null || row.contributed === '' ? '—' : utils.formatMoney(row.contributed))}</td>
                <td>${utils.escapeHtml(row.note || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderPremiums(program) {
    const lines = (App.listUi?.premiumLines ? App.listUi.premiumLines(derive.premiumSummary(program)) : [derive.premiumSummary(program)])
      .filter((line) => line && line !== '—');
    els.premiumCountChip.textContent = `${lines.length || 0}`;
    els.premiumsList.innerHTML = lines.length
      ? lines.map((line) => `<article class="premium-card">${utils.escapeHtml(line)}</article>`).join('')
      : '<div class="premium-card">No premium summary is available for this title.</div>';
  }

  function displayKeyLabel(key) {
    return key
      .replace(/^__resolved_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function sortedProgramEntries(program) {
    const seen = new Set();
    const orderedKeys = [...PROGRAM_FIELD_ORDER, ...Object.keys(program || {}).sort(utils.compareText)];
    return orderedKeys
      .filter((key) => {
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((key) => [key, program?.[key]])
      .filter(([key, value]) => !utils.isBlank(value) && !/^(?:__supplement_match_method|id|program_id|source_row_number)$/i.test(key));
  }

  function renderAllFields(program) {
    const entries = sortedProgramEntries(program);
    els.allFieldsList.innerHTML = entries.length
      ? `<dl class="raw-grid">${entries.map(([key, value]) => labelValue(displayKeyLabel(key), formatMaybeSeconds(key, value))).join('')}</dl>`
      : '<div class="premium-card">No readable program-row fields were available.</div>';
  }

  function renderDetail(program, timings, driveResults, exactAirings) {
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    els.detailTitle.textContent = state.detailCreateMode ? 'Add Program' : derive.title(program);
    els.detailSubtitle.textContent = detailSubtitleHtml(program);
    renderLead(program);
    renderOverview(program, driveResults, exactAirings);
    renderTiming(timings);
    renderDriveResults(driveResults, exactAirings);
    renderPremiums(program);
    renderAllFields(program);
  }

  function showDetailFailure(message) {
    els.detailTitle.textContent = 'Detail load failed';
    els.detailSubtitle.textContent = message || 'Something went sideways while loading this title.';
    els.detailContent.classList.add('hidden');
    els.detailEmpty.classList.remove('hidden');
    els.detailEmpty.textContent = message || 'Something went sideways while loading this title.';
  }

  function setFormFieldsFromSource(source = {}) {
    const form = els.detailEditForm;
    form.elements.title.value = derive.title(source) === 'Untitled program' ? '' : derive.title(source);
    form.elements.nola_code.value = derive.nola(source);
    form.elements.distributor.value = derive.distributor(source);
    form.elements.length_bucket_minutes.value = derive.lengthBucket(source) || '';
    form.elements.actual_runtime_input.value = derive.actualRuntimeLabel(source) === '—' ? '' : derive.actualRuntimeLabel(source);
    form.elements.topic_primary.value = derive.topicPrimary(source);
    form.elements.topic_secondary.value = derive.topicSecondary(source);
    form.elements.rights_start.value = derive.rightsBegin(source);
    form.elements.rights_end.value = derive.rightsEnd(source);
    form.elements.package_type.value = utils.normalizeText(source.package_type);
    form.elements.source_format.value = utils.normalizeText(source.source_format);
    form.elements.rights_notes.value = utils.normalizeText(source.rights_notes);
    form.elements.premium_summary.value = derive.premiumSummary(source);
    form.elements.program_notes.value = derive.description(source);
  }

  function findDuplicates({ title = '', nola = '', excludeId = '' } = {}) {
    const titleKey = utils.normalizeLookupKey(title);
    const nolaKey = utils.normalizeLookupKey(nola);
    const excludeKey = String(excludeId || '');
    let exactNola = null;
    let exactTitle = null;

    (state.rawRows || []).forEach((row) => {
      const rowId = String(derive.programId(row) || '');
      if (excludeKey && rowId === excludeKey) return;
      if (!exactNola && nolaKey && utils.normalizeLookupKey(derive.nola(row)) === nolaKey) exactNola = row;
      if (!exactTitle && titleKey && utils.normalizeLookupKey(derive.title(row)) === titleKey) exactTitle = row;
    });

    return { exactNola, exactTitle };
  }

  function editorDuplicateMessage({ title = '', nola = '' } = {}) {
    const duplicates = findDuplicates({ title, nola, excludeId: state.detailCreateMode ? '' : state.selectedProgramId });
    if (duplicates.exactNola) {
      return {
        text: `NOLA ${derive.nola(duplicates.exactNola)} already exists on “${derive.title(duplicates.exactNola)}”. NOLA is king, so this would create a duplicate title record.`,
        type: 'warn',
        blocking: true
      };
    }
    if (duplicates.exactTitle) {
      return {
        text: `Title matches existing record “${derive.title(duplicates.exactTitle)}”${derive.nola(duplicates.exactTitle) ? ` (${derive.nola(duplicates.exactTitle)})` : ''}. Double-check before saving.`,
        type: 'warn',
        blocking: false
      };
    }
    return { text: '', type: '', blocking: false };
  }

  function handleEditorInput() {
    if (!state.detailEditMode) return;
    const form = els.detailEditForm;
    const title = utils.normalizeText(form.elements.title.value);
    const nola = utils.normalizeText(form.elements.nola_code.value);
    const dup = editorDuplicateMessage({ title, nola });
    if (dup.text) {
      setDetailNotice(dup.text, dup.type || 'warn');
      return;
    }
    if (state.detailCreateMode) {
      setDetailNotice('Add the core fields now. Timings, premiums, and manual money screens come next.', '');
    } else {
      setDetailNotice('');
    }
  }

  function setDetailMode(mode = 'view') {
    state.detailEditMode = mode === 'edit' && canEdit();
    els.detailModal.classList.toggle('create-mode', state.detailCreateMode);
    els.detailEditForm.classList.toggle('hidden', !state.detailEditMode);
    els.detailEditButton.classList.toggle('hidden', !canEdit() || state.detailEditMode || state.detailCreateMode);
    if (els.detailFormHeading) els.detailFormHeading.textContent = state.detailCreateMode ? 'Add Program' : 'Edit program';
    if (els.detailSaveButton) els.detailSaveButton.textContent = state.detailCreateMode ? 'Create program' : 'Save';
    if (!state.detailEditMode) return;

    const source = state.currentDetailProgram || blankProgram();
    setFormFieldsFromSource(source);
    handleEditorInput();
  }

  function openDetailModal() {
    els.detailBackdrop.classList.remove('hidden');
    els.detailModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closeDetailModal() {
    els.detailBackdrop.classList.add('hidden');
    els.detailModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    state.detailEditMode = false;
    state.detailCreateMode = false;
    els.detailModal.classList.remove('create-mode');
    setDetailNotice('');
  }

  function openCreateProgram() {
    if (!canEdit()) return;
    state.selectedProgramId = '';
    App.listUi.syncSelectedRows();
    state.detailCreateMode = true;
    state.currentDetailProgram = blankProgram();
    state.currentDetailTimings = [];
    state.currentDetailDriveResults = [];
    state.currentDetailAirings = [];
    openDetailModal();
    els.detailTitle.textContent = 'Add Program';
    els.detailSubtitle.textContent = 'Create the library record now. NOLA is required because reports match by NOLA, not title.';
    if (els.detailProgramMeta) els.detailProgramMeta.innerHTML = '';
    if (els.detailProgramDescription) els.detailProgramDescription.innerHTML = '';
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    setDetailMode('edit');
    setDetailNotice('Add the core fields now. Timings, premiums, and manual money screens come next.');
    window.setTimeout(() => els.detailEditForm?.elements?.title?.focus(), 0);
  }

  async function loadProgramDetail(programId, options = {}) {
    if (!programId) return;
    state.detailCreateMode = false;
    state.selectedProgramId = String(programId);
    App.listUi.syncSelectedRows();
    openDetailModal();
    els.detailModal.classList.remove('create-mode');
    els.detailTitle.textContent = 'Loading detail…';
    els.detailSubtitle.textContent = 'Checking the program row, timing rows, and drive history.';
    if (els.detailProgramMeta) els.detailProgramMeta.innerHTML = '';
    if (els.detailProgramDescription) els.detailProgramDescription.innerHTML = '';
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.add('hidden');
    setDetailMode('view');
    setDetailNotice('');

    try {
      const detail = await App.data.fetchProgramDetail(programId);
      if (!detail.program) {
        showDetailFailure('No readable detail data came back for this title.');
        return;
      }

      state.currentDetailProgram = detail.program;
      state.currentDetailTimings = detail.timings;
      state.currentDetailDriveResults = detail.driveResults;
      state.currentDetailAirings = detail.airings;
      setDetailNotice(detail.warnings.join(' '), detail.warnings.length ? 'warn' : '');
      renderDetail(detail.program, detail.timings, detail.driveResults, detail.airings);
      if (options.preserveMode && canEdit()) setDetailMode('edit');
      els.detailCloseButton.focus();
    } catch (error) {
      console.error('Detail render failed.', error);
      setDetailNotice(`Detail render warning: ${error.message || error}`, 'bad');
      const fallbackProgram = state.rawRows.find((row) => String(derive.programId(row)) === String(programId)) || null;
      if (fallbackProgram) {
        state.currentDetailProgram = fallbackProgram;
        renderDetail(fallbackProgram, [], [], []);
      } else {
        showDetailFailure('Something went sideways while loading this title.');
      }
    }
  }

  function buildPayloadFromForm() {
    const form = els.detailEditForm;
    const payload = {
      title: utils.normalizeText(form.elements.title.value),
      nola_code: utils.normalizeText(form.elements.nola_code.value) || null,
      distributor: utils.normalizeText(form.elements.distributor.value) || null,
      length_bucket_minutes: form.elements.length_bucket_minutes.value ? Number(form.elements.length_bucket_minutes.value) : null,
      actual_runtime_seconds: utils.parseRuntimeInput(form.elements.actual_runtime_input.value),
      topic_primary: utils.normalizeText(form.elements.topic_primary.value) || null,
      topic_secondary: utils.normalizeText(form.elements.topic_secondary.value) || null,
      rights_start: utils.normalizeText(form.elements.rights_start.value) || null,
      rights_end: utils.normalizeText(form.elements.rights_end.value) || null,
      package_type: utils.normalizeText(form.elements.package_type.value) || null,
      source_format: utils.normalizeText(form.elements.source_format.value) || null,
      rights_notes: utils.normalizeText(form.elements.rights_notes.value) || null,
      premium_summary: utils.normalizeText(form.elements.premium_summary.value) || null,
      program_notes: utils.normalizeText(form.elements.program_notes.value) || null
    };
    if (payload.length_bucket_minutes != null && !Number.isFinite(payload.length_bucket_minutes)) payload.length_bucket_minutes = null;
    return payload;
  }

  async function saveDetailEdit(event) {
    event.preventDefault();
    if (!canEdit()) return;

    const payload = buildPayloadFromForm();
    if (!payload.title) {
      setDetailNotice('Title is required.', 'bad');
      els.detailEditForm.elements.title.focus();
      return;
    }
    if (state.detailCreateMode && !payload.nola_code) {
      setDetailNotice('NOLA is required for a new pledge title. Reports match to the library by NOLA.', 'bad');
      els.detailEditForm.elements.nola_code.focus();
      return;
    }

    const duplicateState = editorDuplicateMessage({ title: payload.title, nola: payload.nola_code || '' });
    if (duplicateState.blocking) {
      setDetailNotice(duplicateState.text, 'bad');
      els.detailEditForm.elements.nola_code.focus();
      return;
    }

    setDetailNotice(state.detailCreateMode ? 'Creating program…' : 'Saving changes…');

    if (state.detailCreateMode) {
      const response = await App.data.createProgram(payload);
      if (response.error) {
        const friendly = friendlyCreateError(response.error);
        setDetailNotice(friendly, 'bad');
        throw new Error(friendly);
      }
      const createdId = derive.programId(response.data || {});
      await App.app.refreshAll();
      if (createdId) {
        state.detailCreateMode = false;
        await loadProgramDetail(createdId, { preserveMode: false });
      } else {
        closeDetailModal();
      }
      App.dom.setNotice(`Added ${payload.title}.`);
      return;
    }

    const programId = state.selectedProgramId;
    if (!programId) return;
    const { error } = await App.data.updateProgram(programId, payload);
    if (error) throw error;
    await App.app.refreshAll({ preserveDetail: true });
    await loadProgramDetail(programId, { preserveMode: false });
    setDetailNotice('Changes saved.');
    App.dom.setNotice('Program updated.');
    setDetailMode('view');
  }

  App.detailUi = {
    canEdit,
    openDetailModal,
    closeDetailModal,
    openCreateProgram,
    setDetailMode,
    loadProgramDetail,
    saveDetailEdit,
    handleEditorInput,
    showDetailFailure
  };
})();

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

  function labelValue(label, value) {
    return `
      <div>
        <dt>${utils.escapeHtml(label)}</dt>
        <dd>${value}</dd>
      </div>
    `;
  }

  function detailSubtitleHtml(program) {
    return `
      <span class="detail-chip">Length ${utils.escapeHtml(derive.lengthLabel(program))}</span>
      <span class="detail-chip">Actual ${utils.escapeHtml(derive.actualRuntimeLabel(program))}</span>
      <span class="detail-chip">NOLA ${utils.escapeHtml(derive.nola(program) || 'No NOLA')}</span>
      <span class="detail-chip">${utils.escapeHtml(derive.distributor(program) || 'No distributor listed')}</span>
    `;
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
    const description = derive.description(program) || '—';

    els.overviewGrid.innerHTML = [
      labelValue('Title', utils.escapeHtml(derive.title(program))),
      labelValue('NOLA', utils.escapeHtml(derive.nola(program) || '—')),
      labelValue('Topic', utils.escapeHtml(topicValue)),
      labelValue('Distributor', utils.escapeHtml(derive.distributor(program) || '—')),
      labelValue('Length bucket', utils.escapeHtml(derive.lengthLabel(program))),
      labelValue('Actual runtime', utils.escapeHtml(derive.actualRuntimeLabel(program))),
      labelValue('Rights begin', utils.escapeHtml(utils.formatDate(derive.rightsBegin(program)))),
      labelValue('Rights end', utils.escapeHtml(utils.formatDate(derive.rightsEnd(program)))),
      labelValue('Package type', utils.escapeHtml(utils.normalizeText(program.package_type) || '—')),
      labelValue('Source format', utils.escapeHtml(utils.normalizeText(program.source_format) || '—')),
      labelValue('Last aired', utils.escapeHtml(lastAired || 'N/A')),
      labelValue('Status', utils.escapeHtml(utils.normalizeText(utils.firstNonEmpty(program.status, program.library_state, derive.isActive(program) ? 'Active' : 'Archived')) || '—')),
      labelValue('Total contributions', utils.escapeHtml(utils.formatMoney(derive.totalRaised(program)))),
      labelValue('Average per fundraiser', utils.escapeHtml(utils.formatMoney(derive.avgPerFundraiser(program)))),
      labelValue('Rights notes', utils.escapeHtml(utils.normalizeText(program.rights_notes) || '—')),
      labelValue('Premium summary', premiumSummaryHtml(derive.premiumSummary(program) || '—')),
      labelValue('Description / notes', `<div class="detail-long-text">${utils.escapeHtml(description)}</div>`)
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
      'slot_number', 'segment_number', 'act_seconds', 'break_seconds', 'local_cutin_seconds',
      'break_offset_seconds', 'act_offset_seconds', 'segment_title', 'segment_name', 'notes',
      'title', 'nola_code', 'program_title'
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
    const rows = [...timings].sort((a, b) => Number(a.slot_number || a.segment_number || 0) - Number(b.slot_number || b.segment_number || 0));
    const columns = candidateColumns(rows);
    els.timingList.innerHTML = `
      <article class="timing-card">
        <div class="segment-table-wrap">
          <table class="segment-table">
            <thead>
              <tr>
                ${columns.map((key) => `<th>${utils.escapeHtml(key.replace(/_/g, ' '))}</th>`).join('')}
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
      .filter(([key, value]) => !utils.isBlank(value) && !/^__supplement_match_method$/i.test(key));
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
    els.detailTitle.textContent = derive.title(program);
    els.detailSubtitle.innerHTML = detailSubtitleHtml(program);
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

  function setDetailMode(mode = 'view') {
    state.detailEditMode = mode === 'edit' && canEdit();
    els.detailEditForm.classList.toggle('hidden', !state.detailEditMode);
    els.detailEditButton.classList.toggle('hidden', !canEdit() || state.detailEditMode);
    if (!state.detailEditMode) return;

    const source = state.currentDetailProgram || {};
    const form = els.detailEditForm;
    form.elements.title.value = derive.title(source) === 'Untitled' ? '' : derive.title(source);
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
    setDetailNotice('');
  }

  async function loadProgramDetail(programId, options = {}) {
    if (!programId) return;
    state.selectedProgramId = String(programId);
    App.listUi.syncSelectedRows();
    openDetailModal();
    els.detailTitle.textContent = 'Loading detail…';
    els.detailSubtitle.textContent = 'Checking the program row, timing rows, and drive history.';
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

  async function saveDetailEdit(event) {
    event.preventDefault();
    if (!canEdit()) return;
    const programId = state.selectedProgramId;
    if (!programId) return;
    const form = els.detailEditForm;
    const title = utils.normalizeText(form.elements.title.value);
    if (!title) {
      setDetailNotice('Title is required.', 'bad');
      form.elements.title.focus();
      return;
    }

    const payload = {
      title,
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

    setDetailNotice('Saving changes…');
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
    setDetailMode,
    loadProgramDetail,
    saveDetailEdit,
    showDetailFailure
  };
})();

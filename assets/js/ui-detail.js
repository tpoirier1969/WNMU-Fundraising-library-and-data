(() => {
  const App = window.PledgeLib;
  const { state, constants, utils, derive } = App;
  const { els, setNotice, setDetailNotice } = App.dom;

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
    return [
      `<span class="detail-chip">Length ${utils.escapeHtml(derive.lengthLabel(program))}</span>`,
      `<span class="detail-chip">Actual ${utils.escapeHtml(derive.actualRuntimeLabel(program))}</span>`,
      `<span class="detail-chip">NOLA ${utils.escapeHtml(derive.nola(program) || 'No NOLA')}</span>`,
      `<span class="detail-chip">${utils.escapeHtml(derive.distributor(program) || 'No distributor listed')}</span>`
    ].join('');
  }

  function renderOverview(program, driveResults) {
    const topicValue = [derive.topicPrimary(program), derive.topicSecondary(program)].filter(Boolean).join(' / ') || '—';
    const rightsNotes = utils.normalizeText(program.rights_notes) || '—';
    const lastAired = driveResults.length
      ? utils.formatDate(utils.firstNonEmpty(driveResults[0].drive_date, driveResults[0].aired_at), 'N/A')
      : derive.lastAiredDisplay(program);
    els.overviewGrid.innerHTML = [
      labelValue('Topic', utils.escapeHtml(topicValue)),
      labelValue('Rights begin', utils.escapeHtml(utils.formatDate(derive.rightsBegin(program)))),
      labelValue('Rights end', utils.escapeHtml(utils.formatDate(derive.rightsEnd(program)))),
      labelValue('Last aired', utils.escapeHtml(lastAired || 'N/A')),
      labelValue('Package type', utils.escapeHtml(utils.normalizeText(program.package_type) || '—')),
      labelValue('Source', utils.escapeHtml(utils.normalizeText(program.source_format) || '—')),
      labelValue('Total contributions', utils.escapeHtml(utils.formatMoney(program.total_contributions))),
      labelValue('Average per drive', utils.escapeHtml(utils.formatMoney(program.avg_contribution_per_drive))),
      labelValue('Description', utils.escapeHtml(derive.description(program) || '—')),
      labelValue('Rights notes', utils.escapeHtml(rightsNotes)),
      labelValue('Premium summary', premiumSummaryHtml(derive.premiumSummary(program) || '—'))
    ].join('');
  }

  function premiumSummaryHtml(value) {
    const text = utils.normalizeText(value);
    if (!text) return '<div class="premium-line">—</div>';
    const lines = text
      .replace(/\s*;\s*/g, '\n')
      .replace(/\s+(?=\$)/g, '\n')
      .split(/\n+/)
      .map((part) => utils.normalizeText(part))
      .filter(Boolean);
    const finalLines = lines.length ? lines : [text];
    return finalLines.map((line) => `<div class="premium-line">${utils.escapeHtml(line)}</div>`).join('');
  }

  function renderTiming(timings) {
    els.timingCountChip.textContent = `${timings.length}`;
    if (!timings.length) {
      els.timingList.innerHTML = '<div class="timing-card">No detailed timing rows are available for this title.</div>';
      return;
    }
    const rows = [...timings].sort((a, b) => Number(a.slot_number || 0) - Number(b.slot_number || 0));
    els.timingList.innerHTML = `
      <article class="timing-card">
        <div class="segment-table-wrap">
          <table class="segment-table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Program segment</th>
                <th>Pledge break</th>
                <th>Local cut-in</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <td>${utils.escapeHtml(row.slot_number ?? '—')}</td>
                  <td>${utils.escapeHtml(utils.formatSeconds(row.act_seconds))}</td>
                  <td>${utils.escapeHtml(utils.formatSeconds(row.break_seconds))}</td>
                  <td>${utils.escapeHtml(utils.formatSeconds(row.local_cutin_seconds))}</td>
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
        when: utils.formatDateTime(row.aired_at, 'N/A'),
        contributed: row.contribution_amount,
        note: utils.normalizeText(utils.firstNonEmpty(row.fundraiser_label, row.notes)) || '—'
      });
    });
    driveResults.forEach((row) => {
      const label = utils.normalizeText(row.drive_label) || utils.normalizeText(row.drive_column) || 'Drive';
      const when = row.drive_date ? `${utils.formatDate(row.drive_date)}${row.drive_window_text ? ` · ${row.drive_window_text}` : ''}` : label;
      combined.push({ when, contributed: row.contribution_amount, note: label });
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
    const lines = App.listUi.premiumLines(derive.premiumSummary(program)).filter((line) => line !== '—');
    els.premiumCountChip.textContent = `${lines.length || 0}`;
    els.premiumsList.innerHTML = lines.length
      ? lines.map((line) => `<article class="premium-card">${utils.escapeHtml(line)}</article>`).join('')
      : '<div class="premium-card">No premium summary is available for this title.</div>';
  }

  function renderDetail(program, timings, driveResults, exactAirings) {
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    els.detailTitle.textContent = derive.title(program);
    els.detailSubtitle.innerHTML = detailSubtitleHtml(program);
    renderOverview(program, driveResults);
    renderTiming(timings);
    renderDriveResults(driveResults, exactAirings);
    renderPremiums(program);
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
    form.elements.actual_runtime_input.value = source.actual_runtime_seconds ? utils.formatSeconds(source.actual_runtime_seconds) : '';
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
  }

  async function saveDetailEdit(event) {
    event.preventDefault();
    if (!canEdit()) return;
    const programId = state.selectedProgramId;
    if (!programId) return;
    const form = els.detailEditForm;
    const title = utils.normalizeText(form.elements.title.value);
    if (!title) {
      form.elements.title.focus();
      throw new Error('Title is required.');
    }
    const payload = {
      title,
      nola_code: utils.normalizeText(form.elements.nola_code.value) || null,
      distributor: utils.normalizeText(form.elements.distributor.value) || null,
      length_bucket_minutes: utils.normalizeText(form.elements.length_bucket_minutes.value) ? Number(form.elements.length_bucket_minutes.value) : null,
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
    setNotice('Program updated.');
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

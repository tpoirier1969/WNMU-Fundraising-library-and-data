(() => {
  const App = window.PledgeLib;
  if (!App || window.__WNMU_EXISTING_DETAIL_SAVE_HOTFIX__) return;
  window.__WNMU_EXISTING_DETAIL_SAVE_HOTFIX__ = true;

  const HOTFIX_VERSION = 'v0.21.33';
  const HOTFIX_NOTE = 'Hotfix v0.21.33: existing title edits save directly, and duplicate-check redraw during typing is suppressed.';

  function firstNonEmpty(...values) {
    for (const value of values) {
      if (value === 0 || value === false) return value;
      if (value != null && String(value).trim() !== '') return value;
    }
    return '';
  }

  function existingId() {
    const state = App.state || {};
    const current = state.currentDetailProgram || {};
    return firstNonEmpty(
      current.id,
      current.program_id,
      current.pledge_program_id,
      current.program_uuid,
      current.uuid,
      current.__synthetic_program_id,
      state.selectedProgramId
    );
  }

  function existingEditActive() {
    const state = App.state || {};
    const heading = String(App.dom?.els?.detailFormHeading?.textContent || '').trim();
    return Boolean(state.detailEditMode && existingId() && !/new\s+program/i.test(heading));
  }

  function normalizeFieldName(raw = '') {
    return String(raw || '')
      .replace(/^detail[-_]?/i, '')
      .replace(/[-_]?input$/i, '')
      .replace(/-/g, '_')
      .trim();
  }

  function collectPayloadFromForm() {
    const form = App.dom?.els?.detailEditForm;
    const payload = {};
    if (!form) return payload;

    form.querySelectorAll('input, textarea, select').forEach((field) => {
      const type = String(field.type || '').toLowerCase();
      if (['submit', 'button', 'reset', 'file'].includes(type)) return;
      const explicitExtraKey = field.getAttribute('data-extra-field-key');
      const rawKey = explicitExtraKey || field.getAttribute('data-field') || field.name || field.id;
      const key = explicitExtraKey || normalizeFieldName(rawKey);
      if (!key) return;

      let value;
      if (type === 'checkbox') value = Boolean(field.checked);
      else value = String(field.value || '').trim();

      if (!explicitExtraKey && (key === 'actual_runtime_input' || key === 'actual_runtime_seconds')) {
        const parsed = App.utils?.parseRuntimeInput ? App.utils.parseRuntimeInput(value) : Number(value || 0) || null;
        payload.actual_runtime_seconds = parsed == null ? null : parsed;
        return;
      }

      if (!explicitExtraKey && key === 'length_bucket_minutes') {
        const parsed = Number(value);
        payload[key] = Number.isFinite(parsed) ? parsed : null;
        return;
      }

      if (!explicitExtraKey && (key === 'rights_start' || key === 'rights_end')) {
        const parsed = App.utils?.parseFlexibleDateInput ? App.utils.parseFlexibleDateInput(value) : null;
        payload[key] = parsed?.valid ? (parsed.iso || null) : (value || null);
        return;
      }

      payload[key] = value === '' ? null : value;
    });

    delete payload.id;
    delete payload.program_id;
    delete payload.created_at;
    delete payload.updated_at;
    delete payload.created_by;
    delete payload.updated_by;
    delete payload.row_hash;
    return payload;
  }

  async function saveExistingEditDirect(event) {
    if (!existingEditActive()) return false;
    event.preventDefault();
    event.stopImmediatePropagation();

    const state = App.state;
    const client = state?.client;
    if (!client) throw new Error('Supabase client is not ready.');

    state.detailCreateMode = false;
    App.dom?.setDetailNotice?.('Saving…');

    const id = existingId();
    const payload = collectPayloadFromForm();
    const { data, error } = await client
      .from(App.constants.BASE_TABLE)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    state.currentDetailProgram = { ...(state.currentDetailProgram || {}), ...(data || {}), ...payload, id };
    state.detailCreateMode = false;
    state.detailEditMode = false;
    App.dom?.setDetailNotice?.('Saved.');
    App.dom?.setNotice?.('Program updated.');

    if (typeof App.detailUi?.setDetailMode === 'function') {
      App.detailUi.setDetailMode('view');
    }

    if (App.libraryLoader?.refreshAll) {
      await App.libraryLoader.refreshAll({ preserveDetail: true, workspace: state.activeWorkspace });
    }
    return true;
  }

  function patchTypingGlitch() {
    if (!App.detailUi || typeof App.detailUi.handleEditorInput !== 'function') return;
    const original = App.detailUi.handleEditorInput.bind(App.detailUi);
    App.detailUi.handleEditorInput = function patchedHandleEditorInput(...args) {
      if (existingEditActive()) {
        App.state.detailCreateMode = false;
        const notice = String(App.dom?.els?.detailNotice?.textContent || '').toLowerCase();
        if (notice.includes('already exists') || notice.includes('duplicate title record') || notice.includes('nola is king')) {
          App.dom?.setDetailNotice?.('');
        }
        return;
      }
      return original(...args);
    };
  }

  function patchSubmitFlow() {
    const form = App.dom?.els?.detailEditForm;
    if (!form || form.dataset.hotfixExistingEditSave === 'true') return;
    form.dataset.hotfixExistingEditSave = 'true';
    form.addEventListener('submit', async (event) => {
      try {
        const handled = await saveExistingEditDirect(event);
        if (!handled) return;
      } catch (error) {
        console.error(error);
        App.dom?.setDetailNotice?.(error?.message || 'Save failed.', 'bad');
        App.dom?.setNotice?.(error?.message || 'Save failed.', 'warn');
      }
    }, true);
  }

  function patchModeSwitch() {
    if (!App.detailUi || typeof App.detailUi.setDetailMode !== 'function') return;
    const original = App.detailUi.setDetailMode.bind(App.detailUi);
    App.detailUi.setDetailMode = function patchedSetDetailMode(mode, ...args) {
      const result = original(mode, ...args);
      if (mode === 'edit' && existingId()) {
        App.state.detailCreateMode = false;
        const notice = String(App.dom?.els?.detailNotice?.textContent || '').toLowerCase();
        if (notice.includes('already exists') || notice.includes('duplicate title record') || notice.includes('nola is king')) {
          App.dom?.setDetailNotice?.('');
        }
      }
      return result;
    };
  }

  function applyUiStamp() {
    if (App.dom?.els?.versionFlag) App.dom.els.versionFlag.textContent = HOTFIX_VERSION;
    if (App.dom?.setBuildMeta) App.dom.setBuildMeta(HOTFIX_NOTE);
  }

  function bootHotfix() {
    applyUiStamp();
    patchModeSwitch();
    patchTypingGlitch();
    patchSubmitFlow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootHotfix);
  } else {
    bootHotfix();
  }
})();

(() => {
  'use strict';

  const App = window.PledgeLib;
  if (!App) return;

  const TABLE = 'pledge_program_editorial_overrides';
  const byProgramId = new Map();
  let loadPromise = null;
  let loaded = false;
  let loadError = '';

  function text(value) {
    return String(value ?? '').trim();
  }

  function normalizeRating(value) {
    const rating = text(value).toLowerCase();
    return ['high', 'medium', 'low'].includes(rating) ? rating : '';
  }

  function programIdOf(programOrId) {
    if (programOrId == null) return '';
    if (typeof programOrId === 'object') return text(App.derive?.programId?.(programOrId) || programOrId.program_id || programOrId.id);
    return text(programOrId);
  }

  function get(programOrId) {
    const id = programIdOf(programOrId);
    return id ? (byProgramId.get(id) || null) : null;
  }

  function pulseScorecard() {
    const body = document.getElementById('library-body');
    if (body) {
      const marker = document.createElement('span');
      marker.hidden = true;
      body.append(marker);
      marker.remove();
    }
    const overview = document.getElementById('overview-grid');
    if (overview) {
      const marker = document.createElement('span');
      marker.hidden = true;
      overview.append(marker);
      marker.remove();
    }
  }

  function emitChanged(reason = 'update') {
    document.dispatchEvent(new CustomEvent('pledge-editorial-overrides-changed', { detail: { reason } }));
    window.setTimeout(pulseScorecard, 0);
  }

  async function waitForClient() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (App.state?.client) return App.state.client;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    if (App.data?.createClient && App.state?.configReady) return App.data.createClient();
    return null;
  }

  async function load({ force = false } = {}) {
    if (loaded && !force) return [...byProgramId.values()];
    if (loadPromise && !force) return loadPromise;

    loadPromise = (async () => {
      const client = await waitForClient();
      if (!client) throw new Error('Supabase client was not ready for editorial overrides.');
      const { data, error } = await client.from(TABLE).select('*');
      if (error) throw error;
      byProgramId.clear();
      (data || []).forEach((row) => {
        const id = programIdOf(row?.program_id);
        const rating = normalizeRating(row?.rating);
        if (!id || !rating) return;
        byProgramId.set(id, { ...row, program_id: id, rating });
      });
      loaded = true;
      loadError = '';
      emitChanged('loaded');
      return [...byProgramId.values()];
    })().catch((error) => {
      loadError = String(error?.message || error || 'Unable to load editorial overrides.');
      console.warn('Editorial override load failed.', error);
      return [];
    }).finally(() => {
      loadPromise = null;
    });

    return loadPromise;
  }

  async function save(programOrId, ratingValue) {
    const id = programIdOf(programOrId);
    if (!id) throw new Error('This title does not have a pledge-program id.');
    if (!App.auth?.canEdit?.()) throw new Error('Admin sign-in is required to change a programmer rating.');

    const client = App.state?.client || App.data?.createClient?.();
    if (!client) throw new Error('Supabase client is not available.');

    const rating = normalizeRating(ratingValue);
    if (!rating) {
      const { error } = await client.from(TABLE).delete().eq('program_id', id);
      if (error) throw error;
      byProgramId.delete(id);
      emitChanged('saved');
      return null;
    }

    const now = new Date().toISOString();
    const payload = {
      program_id: Number(id),
      rating,
      rated_at: now,
      updated_at: now,
      updated_by_email: text(App.state?.userEmail) || null
    };
    const { data, error } = await client.from(TABLE).upsert(payload, { onConflict: 'program_id' }).select('*').single();
    if (error) throw error;
    const normalized = { ...(data || payload), program_id: id, rating };
    byProgramId.set(id, normalized);
    emitChanged('saved');
    return normalized;
  }

  function controlHtml(program = {}, overrideInfo = null) {
    const id = programIdOf(program);
    if (!id) return '';
    const row = get(id);
    const current = normalizeRating(row?.rating);
    const editable = Boolean(App.auth?.canEdit?.());
    const weakCount = Number(overrideInfo?.underperformances || 0);
    const activeProtection = Boolean(overrideInfo?.activeProtection);
    const note = current === 'high'
      ? activeProtection
        ? `High rating is protecting this title from a Low Confidence label. Clear weak prime tests since rating: ${weakCount}/2. A weak test is below $150 per pledge hour; a $0 prime airing counts even when duration is unavailable.`
        : weakCount >= 2
          ? 'High rating remains recorded, but two clear weak prime tests since the rating returned confidence to the automated evidence.'
          : 'High programmer rating recorded.'
      : 'Automatic confidence rules are in control.';

    if (!editable) {
      return current
        ? `<div class="scorecard-editorial-control scorecard-editorial-readonly"><strong>Programmer rating:</strong> ${App.utils.escapeHtml(current.charAt(0).toUpperCase() + current.slice(1))}<span>${App.utils.escapeHtml(note)}</span></div>`
        : '';
    }

    return `<div class="scorecard-editorial-control">
      <label><span>Programmer override</span>
        <select class="scorecard-editorial-rating" data-program-id="${App.utils.escapeHtml(id)}">
          <option value="" ${!current ? 'selected' : ''}>Automatic</option>
          <option value="high" ${current === 'high' ? 'selected' : ''}>High</option>
        </select>
      </label>
      <div class="scorecard-editorial-note">${App.utils.escapeHtml(note)}</div>
    </div>`;
  }

  async function handleChange(event) {
    const select = event.target?.closest?.('.scorecard-editorial-rating');
    if (!select) return;
    const programId = text(select.dataset.programId);
    const prior = get(programId)?.rating || '';
    select.disabled = true;
    try {
      await save(programId, select.value);
    } catch (error) {
      console.error(error);
      select.value = prior;
      window.alert(`Could not save programmer rating: ${error?.message || error}`);
    } finally {
      select.disabled = false;
    }
  }

  App.programEditorialOverrides = {
    table: TABLE,
    get,
    load,
    save,
    controlHtml,
    get loaded() { return loaded; },
    get loadError() { return loadError; }
  };

  document.addEventListener('change', handleChange, true);
  document.addEventListener('pledge-scorecard-airings-ready', () => window.setTimeout(pulseScorecard, 0));
  document.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(() => load(), 500);
  }, { once: true });
})();

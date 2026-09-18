(() => {
  'use strict';

  const App = window.PledgeLib;
  if (!App) return;

  const TABLE = 'pledge_program_editorial_overrides';
  const byProgramId = new Map();
  const LABELS = {
    dont_air: "Don't air",
    low_confidence: 'Low confidence',
    neutral: 'Neutral',
    viable: 'Viable',
    promising: 'Promising',
    must_air: 'Must Air'
  };
  let loadPromise = null;
  let loaded = false;
  let loadError = '';

  function text(value) {
    return String(value ?? '').trim();
  }

  function normalizeRating(value) {
    const rating = text(value).toLowerCase();
    if (rating === 'high') return 'must_air';
    if (rating === 'medium') return 'promising';
    if (rating === 'low') return 'low_confidence';
    return ['dont_air', 'low_confidence', 'neutral', 'viable', 'promising', 'must_air'].includes(rating) ? rating : '';
  }

  function ratingLabel(value) {
    const rating = normalizeRating(value);
    return rating ? LABELS[rating] : 'Neutral';
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
      if (!client) throw new Error('Supabase client was not ready for programmer ratings.');
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
      loadError = String(error?.message || error || 'Unable to load programmer ratings.');
      console.warn('Programmer rating load failed.', error);
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

  function optionsHtml(current = '') {
    return `
      <option value="dont_air" ${current === 'dont_air' ? 'selected' : ''}>Don't air</option>
      <option value="low_confidence" ${current === 'low_confidence' ? 'selected' : ''}>Low confidence</option>
      <option value="" ${!current ? 'selected' : ''}>Unrated</option>
      <option value="neutral" ${current === 'neutral' ? 'selected' : ''}>Neutral</option>
      <option value="viable" ${current === 'viable' ? 'selected' : ''}>Viable</option>
      <option value="promising" ${current === 'promising' ? 'selected' : ''}>Promising</option>
      <option value="must_air" ${current === 'must_air' ? 'selected' : ''}>Must Air</option>`;
  }

  function ratingNote(current = '', overrideInfo = null) {
    if (current === 'must_air') {
      if (overrideInfo?.secondChance) return 'Editorial priority for an appropriate placement. The first post-rating airing landed in a weak surrounding window or lacked usable performance data, so one reduced-priority second chance remains.';
      const effective = String(overrideInfo?.effectiveRating || overrideInfo?.rating || '').trim();
      if (effective && effective !== 'must_air') return `Must Air has already been resolved by post-rating performance and is currently treated as ${ratingLabel(effective)}.`;
      return 'Editorial priority for an appropriate placement, not a command to force the title into the next fundraiser. After it airs, performance and surrounding-night context determine the next effective rating; a clearly bad night may earn one second chance.';
    }
    if (current === 'neutral') return 'Reviewed without a positive or negative programmer adjustment.';
    if (current === 'viable') return 'Worth considering for pledge, but audience response is still uncertain; adds a modest positive signal.';
    if (current === 'promising') return 'Adds a strong positive programmer signal because the title looks likely to connect with the WNMU pledge audience.';
    if (current === 'low_confidence') return 'Adds a meaningful caution to the formula.';
    if (current === 'dont_air') return 'Adds a very strong negative programmer signal, but does not replace hard evidence or rights rules.';
    return 'No programmer weighting is being added.';
  }

  function controlHtml(program = {}, overrideInfo = null) {
    const id = programIdOf(program);
    if (!id) return '';
    const row = get(id);
    const current = normalizeRating(row?.rating);
    const editable = Boolean(App.auth?.canEdit?.());
    const note = ratingNote(current, overrideInfo);

    if (!editable) {
      return current
        ? `<div class="scorecard-editorial-control scorecard-editorial-readonly"><strong>Programmer rating:</strong> ${App.utils.escapeHtml(ratingLabel(current))}<span>${App.utils.escapeHtml(note)}</span></div>`
        : '';
    }

    return `<div class="scorecard-editorial-control">
      <label><span>Programmer rating</span>
        <select class="scorecard-editorial-rating" data-program-id="${App.utils.escapeHtml(id)}">${optionsHtml(current)}</select>
      </label>
      <div class="scorecard-editorial-note">${App.utils.escapeHtml(note)}</div>
    </div>`;
  }

  function headerControlHtml(program = {}, overrideInfo = null) {
    const id = programIdOf(program);
    if (!id) return '';
    const row = get(id);
    const current = normalizeRating(row?.rating);
    const editable = Boolean(App.auth?.canEdit?.());
    if (!editable) {
      return current
        ? `<div class="programmer-rating-header-readonly"><span>Programmer rating</span><strong>${App.utils.escapeHtml(ratingLabel(current))}</strong></div>`
        : '';
    }
    return `<label class="programmer-rating-header-control">
      <span>Programmer rating</span>
      <select class="scorecard-editorial-rating" data-program-id="${App.utils.escapeHtml(id)}">${optionsHtml(current)}</select>
    </label>`;
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
    headerControlHtml,
    normalizeRating,
    ratingLabel,
    ratingNote,
    get loaded() { return loaded; },
    get loadError() { return loadError; }
  };

  document.addEventListener('change', handleChange, true);
  document.addEventListener('pledge-scorecard-airings-ready', () => window.setTimeout(pulseScorecard, 0));
  document.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(() => load(), 500);
  }, { once: true });
})();
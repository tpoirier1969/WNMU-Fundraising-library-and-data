(() => {
  'use strict';

  const App = window.PledgeLib;
  const focus = App?.programFundraiserFocus;
  if (!App || !focus) return;

  const SEASONS = ['March', 'June', 'August', 'December'];
  const STORAGE_KEY = 'wnmuProgramOutlookSeasonV1';
  const originalEntries = typeof focus.entries === 'function' ? focus.entries.bind(focus) : () => [];
  const originalSet = typeof focus.set === 'function' ? focus.set.bind(focus) : () => {};
  const seasonKeyForDate = typeof focus.seasonKeyForDate === 'function' ? focus.seasonKeyForDate.bind(focus) : () => '';

  function text(value) {
    return String(value ?? '').trim();
  }

  function todayStart() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  function rawEntries() {
    return (originalEntries() || []).filter((entry) => entry?.id && entry?.start instanceof Date && !Number.isNaN(entry.start.getTime()));
  }

  function entriesForSeason(season) {
    return rawEntries().filter((entry) => seasonKeyForDate(entry.start) === season);
  }

  function representativeForSeason(season) {
    const entries = entriesForSeason(season);
    if (!entries.length) return null;
    const today = todayStart();

    const active = entries.find((entry) => entry.start <= today && (entry.end || entry.start) >= today);
    if (active) return active;

    const future = entries.find((entry) => entry.start > today);
    if (future) return future;

    return entries[entries.length - 1] || null;
  }

  function buildSeasonChoices() {
    return SEASONS.map((season) => {
      const representative = representativeForSeason(season);
      return {
        id: representative?.id || `__season_${season.toLowerCase()}__`,
        title: season,
        start: null,
        end: null,
        season,
        representative
      };
    });
  }

  function storedSeason() {
    try {
      const value = text(window.sessionStorage.getItem(STORAGE_KEY) || '');
      return SEASONS.includes(value) ? value : '';
    } catch (_error) {
      return '';
    }
  }

  function storeSeason(season) {
    try {
      if (season) window.sessionStorage.setItem(STORAGE_KEY, season);
      else window.sessionStorage.removeItem(STORAGE_KEY);
    } catch (_error) {
      // Browser storage is optional.
    }
  }

  function seasonForChoiceId(id) {
    const value = text(id);
    if (!value) return '';
    return buildSeasonChoices().find((choice) => choice.id === value)?.season || '';
  }

  function applySeasonSelection(season) {
    const normalized = SEASONS.includes(season) ? season : '';
    if (!normalized) {
      storeSeason('');
      originalSet('');
      return;
    }

    storeSeason(normalized);
    const representative = representativeForSeason(normalized);
    originalSet(representative?.id || '');
  }

  function seasonChoices() {
    const choices = buildSeasonChoices();
    const stored = storedSeason();
    if (stored) {
      const choice = choices.find((entry) => entry.season === stored);
      const desiredId = text(choice?.representative?.id || '');
      const currentId = text(App.state?.programOutlookFundraiserId || '');
      if (desiredId && currentId !== desiredId) originalSet(desiredId);
    }
    return choices;
  }

  function setSeasonChoice(id = '') {
    const value = text(id);
    if (!value) {
      applySeasonSelection('');
      return;
    }
    applySeasonSelection(seasonForChoiceId(value));
  }

  function selectedSeason() {
    const currentId = text(App.state?.programOutlookFundraiserId || '');
    const currentSeason = seasonForChoiceId(currentId);
    if (currentSeason) return currentSeason;
    return storedSeason();
  }

  function selectedRepresentative() {
    const season = selectedSeason();
    return season ? representativeForSeason(season) : null;
  }

  function rightsTarget() {
    const representative = selectedRepresentative();
    if (!representative?.start) return null;
    const today = todayStart();
    const end = representative.end || representative.start;
    if (end < today) return null;
    return representative;
  }

  function normalizeInitialSelection() {
    const stored = storedSeason();
    if (stored) {
      const representative = representativeForSeason(stored);
      originalSet(representative?.id || '');
      return;
    }

    const currentId = text(App.state?.programOutlookFundraiserId || '');
    const currentSeason = seasonForChoiceId(currentId);
    if (currentSeason) {
      storeSeason(currentSeason);
      return;
    }

    // v0.22.157 briefly stored individual fundraiser IDs. Do not carry those
    // forward into the seasonal selector. N/A is the default.
    originalSet('');
  }

  normalizeInitialSelection();

  App.programFundraiserFocus = {
    ...focus,
    entries: seasonChoices,
    get: rightsTarget,
    getDefault: () => null,
    set: setSeasonChoice,
    selectedSeason,
    selectedRepresentative,
    seasons: () => [...SEASONS]
  };

  // Untested is an evidence state, not a negative confidence judgment. An
  // unaired title can still be promising or weak for other reasons, but it does
  // not become Low Confidence until WNMU has actually tested it.
  if (App.programScorecard?.baseAssessment && App.programScorecard?.detailedAssessment) {
    const originalBaseAssessment = App.programScorecard.baseAssessment.bind(App.programScorecard);
    const originalDetailedAssessment = App.programScorecard.detailedAssessment.bind(App.programScorecard);
    const originalDetailHtml = App.programScorecard.detailHtml?.bind(App.programScorecard);

    function normalizeUntested(result = {}, exactAirings = null) {
      const summaryAirings = Number(result?.history?.airings || 0);
      const exactCount = Array.isArray(exactAirings) ? exactAirings.length : 0;
      if (summaryAirings > 0 || exactCount > 0) return result;

      let outlook = text(result.outlook || 'Needs first test');
      if (/^Low confidence\s*·\s*Promising$/i.test(outlook)) outlook = 'Promising new title';
      else if (/^Low confidence\s*·\s*Untested$/i.test(outlook)) outlook = 'Needs first test';
      else if (/^Low confidence\s*·\s*/i.test(outlook)) outlook = outlook.replace(/^Low confidence\s*·\s*/i, '');

      return {
        ...result,
        outlook,
        confidence: 'Untested',
        evidenceState: 'Untested'
      };
    }

    App.programScorecard.baseAssessment = (program = {}) => normalizeUntested(originalBaseAssessment(program));
    App.programScorecard.detailedAssessment = (program = {}, driveResults = [], exactAirings = []) =>
      normalizeUntested(originalDetailedAssessment(program, driveResults, exactAirings), exactAirings);

    if (originalDetailHtml) {
      App.programScorecard.detailHtml = (program = {}, driveResults = [], exactAirings = []) => {
        const normalized = App.programScorecard.detailedAssessment(program, driveResults, exactAirings);
        let html = originalDetailHtml(program, driveResults, exactAirings);
        if (normalized?.confidence === 'Untested') {
          html = html
            .replace(/(<strong>Evidence:<\/strong>\s*)(?:Low|Editorial)(?=<\/div>)/i, '$1Untested')
            .replace(
              'WNMU has no prior airing history for this title, so the model has less evidence to work with.',
              'WNMU has not aired this title. It is untested, not low-confidence.'
            );
        }
        return html;
      };
    }
  }

  // Programmer Rating already saves on selection change. Make that behavior
  // explicit so it is not mistaken for a field that waits for Program Editor Save.
  if (App.programEditorialOverrides?.headerControlHtml) {
    const originalHeaderControlHtml = App.programEditorialOverrides.headerControlHtml.bind(App.programEditorialOverrides);
    App.programEditorialOverrides.headerControlHtml = (...args) => originalHeaderControlHtml(...args)
      .replace('<span>Programmer rating</span>', '<span>Programmer rating · Autosaves</span>');
  }

  function fixUntestedWording() {
    document.querySelectorAll('.program-scorecard-header-confidence').forEach((node) => {
      if (/^Untested confidence$/i.test(text(node.textContent))) node.textContent = 'Untested';
    });
    document.querySelectorAll('.scorecard-list[title]').forEach((node) => {
      const title = node.getAttribute('title') || '';
      if (/Untested confidence/i.test(title)) node.setAttribute('title', title.replace(/Untested confidence/gi, 'Untested evidence'));
    });
  }

  function installWordingObserver() {
    fixUntestedWording();
    const root = document.querySelector('[data-workspace-pane="library"]') || document.body;
    if (!root) return;
    const observer = new MutationObserver(() => fixUntestedWording());
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installWordingObserver, { once: true });
  } else {
    installWordingObserver();
  }
})();

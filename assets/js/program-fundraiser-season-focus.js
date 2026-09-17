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
})();

(() => {
  'use strict';

  const App = window.PledgeLib;
  if (!App?.programScorecard?.baseAssessment || !App?.programScorecard?.detailedAssessment) return;

  const originalBaseAssessment = App.programScorecard.baseAssessment.bind(App.programScorecard);
  const originalDetailedAssessment = App.programScorecard.detailedAssessment.bind(App.programScorecard);
  const originalDetailHtml = App.programScorecard.detailHtml?.bind(App.programScorecard);

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeEvaluation(result = {}, { detailed = false, primeAirings = null } = {}) {
    const history = result.history || {};
    const airings = number(history.airings, 0);
    const score = Math.max(0, Math.min(100, number(result.score, 50)));
    const protectedOutlooks = new Set([
      'Do not schedule',
      'Save for December',
      'Context check first',
      "Programmer says don't air"
    ]);

    let confidence = result.confidence || 'Low';
    if (airings < 1 && confidence === 'Low') confidence = 'Untested';
    if (protectedOutlooks.has(result.outlook)) return { ...result, confidence };

    let outlook = 'Situational option';
    let tone = 'neutral';

    if (score >= 78) {
      outlook = 'High-priority candidate';
      tone = 'strong';
    } else if (score >= 65) {
      outlook = 'Strong candidate';
      tone = 'good';
    } else if (score >= 56) {
      outlook = airings > 0 ? 'Established option' : 'Promising';
      tone = airings > 0 ? 'neutral' : 'good';
    } else if (score >= 48) {
      outlook = 'Situational option';
      tone = 'neutral';
    } else if (score >= 40) {
      outlook = airings > 0 ? 'Mixed evidence' : 'Caution';
      tone = 'caution';
    } else {
      const heavyExposure = airings >= 8;
      const enoughPrimeEvidence = detailed
        ? (primeAirings != null && Number(primeAirings) >= 2)
        : airings >= 3;
      if (heavyExposure || enoughPrimeEvidence) {
        outlook = 'Low priority / rest';
        tone = 'warn';
      } else {
        outlook = 'Caution';
        tone = 'caution';
      }
    }

    return { ...result, score, outlook, tone, confidence };
  }

  App.programScorecard.baseAssessment = (program = {}) => normalizeEvaluation(originalBaseAssessment(program));

  App.programScorecard.detailedAssessment = (program = {}, driveResults = [], exactAirings = []) => {
    const result = originalDetailedAssessment(program, driveResults, exactAirings);
    const primeAirings = Number.isFinite(Number(result?.primeAirings))
      ? Number(result.primeAirings)
      : (Array.isArray(exactAirings) ? exactAirings.filter((row) => {
        const when = App.utils?.rowLocalDateTime?.(row, { preferDriveFallback: true });
        if (!(when instanceof Date) || Number.isNaN(when.getTime())) return false;
        const minutes = when.getHours() * 60 + when.getMinutes();
        return minutes >= 19 * 60 && minutes < 23 * 60;
      }).length : null);
    return normalizeEvaluation(result, { detailed: true, primeAirings });
  };

  if (originalDetailHtml) {
    App.programScorecard.detailHtml = (program = {}, driveResults = [], exactAirings = []) => {
      let html = originalDetailHtml(program, driveResults, exactAirings);
      const normalized = App.programScorecard.detailedAssessment(program, driveResults, exactAirings);
      html = html
        .replace('WNMU has no prior airing history for this title, so the model has less evidence to work with.', 'WNMU has no prior airing history for this title.')
        .replace('No prime-time test yet.', 'No verified prime-time airings.')
        .replace(/ A plausible title needs two weak prime tests before weak performance alone can retire it\./g, '')
        .replace(/(<strong>Evidence:<\/strong>\s*)Low(?=<\/div>)/i, `$1${App.utils.escapeHtml(normalized.confidence || 'Low')}`);
      return html;
    };
  }
})();

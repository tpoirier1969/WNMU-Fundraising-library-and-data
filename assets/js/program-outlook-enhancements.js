(() => {
  'use strict';

  const App = window.PledgeLib;
  if (!App?.programScorecard) return;

  const { state, utils, derive } = App;
  const originalBaseAssessment = App.programScorecard.baseAssessment.bind(App.programScorecard);
  const originalDetailedAssessment = App.programScorecard.detailedAssessment.bind(App.programScorecard);
  const DAY_MS = 86400000;
  const CHRISTMAS_PATTERN = /\b(?:christmas|holiday|holidays|noel|yuletide|nativity)\b/i;
  const LOCAL_WORD_PATTERN = /\b(?:michigan|upper peninsula|yooper|marquette|negaunee|ishpeming|keweenaw|mackinac|lake superior|great lakes|pelkie)\b/i;
  const LOCAL_UP_PATTERN = /(?:^|\W)(?:UP|U\.P\.?)(?=\W|$)/;
  const FOCUS_STORAGE_KEY = 'wnmuProgramOutlookFundraiserIdV2';
  const PROGRAMMER_WEIGHTS = {
    dont_air: -30,
    low_confidence: -14,
    promising: 14,
    must_air: 28
  };
  const WEAK_PRIME_RATE = 150;

  function text(value) {
    return String(value ?? '').trim();
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clampScore(value) {
    return Math.max(0, Math.min(100, number(value, 50)));
  }

  function parseDate(value) {
    const parsed = utils.parseDateLike?.(value, { preferDateOnlyLocal: true });
    return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }

  function scheduleEntries() {
    const schedules = Array.isArray(state.schedules) ? state.schedules : [];
    return schedules.map((schedule) => {
      const start = parseDate(schedule?.startDate || schedule?.start_date || '');
      const end = parseDate(schedule?.endDate || schedule?.end_date || schedule?.startDate || schedule?.start_date || '');
      return {
        id: text(schedule?.id),
        title: text(schedule?.title || schedule?.name || 'Fundraiser'),
        schedule,
        start,
        end: end || start
      };
    }).filter((entry) => entry.id && entry.start).sort((a, b) => a.start - b.start);
  }

  function defaultFundraiserEntry() {
    return null;
  }

  function focusedFundraiserEntry() {
    const entries = scheduleEntries();
    const manualId = text(state.programOutlookFundraiserId || '');
    if (!manualId) return null;
    return entries.find((entry) => entry.id === manualId) || null;
  }

  function setFocusedFundraiser(id = '') {
    state.programOutlookFundraiserId = text(id);
    try {
      if (state.programOutlookFundraiserId) {
        window.sessionStorage.setItem(FOCUS_STORAGE_KEY, state.programOutlookFundraiserId);
      } else {
        window.sessionStorage.removeItem(FOCUS_STORAGE_KEY);
      }
    } catch (_error) {
      // Browser storage is optional.
    }
  }

  function restoreFocusedFundraiser() {
    if (text(state.programOutlookFundraiserId)) return;
    try {
      const stored = text(window.sessionStorage.getItem(FOCUS_STORAGE_KEY) || '');
      if (stored) state.programOutlookFundraiserId = stored;
    } catch (_error) {
      // Browser storage is optional.
    }
  }

  function seasonKeyForDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const month = date.getMonth();
    if (month === 0 || month >= 9) return 'December';
    if (month <= 3) return 'March';
    if (month <= 5) return 'June';
    if (month <= 8) return 'August';
    return 'December';
  }

  function rowWhen(row = {}) {
    const driveStart = parseDate(utils.firstNonEmpty?.(
      row.drive_start_date,
      row.fundraiser_start_date,
      row.campaign_start_date,
      ''
    ));
    if (driveStart) return driveStart;
    const local = utils.rowLocalDateTime?.(row, { preferDriveFallback: true });
    if (local instanceof Date && !Number.isNaN(local.getTime())) return local;
    return parseDate(utils.firstNonEmpty?.(row.air_date, row.aired_at, row.drive_date, row.date_key, ''));
  }

  function airingWhen(row = {}) {
    const local = utils.rowLocalDateTime?.(row, { preferDriveFallback: true });
    if (local instanceof Date && !Number.isNaN(local.getTime())) return local;
    return parseDate(utils.firstNonEmpty?.(row.air_date, row.aired_at, row.drive_date, row.date_key, ''));
  }

  function rowContribution(row = {}) {
    return number(utils.firstNonEmpty?.(
      row.__resolved_contribution_amount,
      row.contribution_amount,
      row.total_contributions,
      row.total_dollars,
      row.dollars,
      row.broadcast_dollars,
      0
    ), 0);
  }

  function rowsForProgram(program = {}, exactAirings = null) {
    if (Array.isArray(exactAirings) && exactAirings.length) return exactAirings;
    const id = text(derive.programId?.(program));
    if (!id) return [];
    return (Array.isArray(state.scorecardAiringRows) ? state.scorecardAiringRows : []).filter((row) => {
      const linked = text(utils.firstNonEmpty?.(row?.manual_match_program_id, row?.pledge_program_id, row?.program_id, ''));
      return linked === id;
    });
  }

  function programText(program = {}) {
    return [derive.title(program), derive.description(program), derive.topicPrimary(program), derive.topicSecondary(program)]
      .filter(Boolean)
      .join(' ');
  }

  function localRelevance(program = {}) {
    const value = programText(program);
    return LOCAL_WORD_PATTERN.test(value) || LOCAL_UP_PATTERN.test(value);
  }

  function isPrimeRow(row = {}) {
    const when = airingWhen(row);
    if (!when) return false;
    const minutes = when.getHours() * 60 + when.getMinutes();
    return minutes >= 19 * 60 && minutes < 23 * 60;
  }

  function durationMinutes(program = {}, row = {}) {
    const seconds = number(utils.firstNonEmpty?.(program.actual_runtime_seconds, program.runtime_seconds, program.actual_runtime), 0);
    if (seconds > 0) return seconds / 60;
    const minutes = number(utils.firstNonEmpty?.(program.actual_runtime_minutes, program.runtime_minutes, program.length_minutes), 0);
    if (minutes > 0) return minutes;
    const bucket = number(utils.firstNonEmpty?.(program.length_bucket_minutes, derive.lengthBucket?.(program)), 0);
    if (bucket > 0) return bucket;
    const imported = number(row?.program_minutes, 0);
    return imported > 0 ? imported : null;
  }

  function programmerEvidence(program = {}, exactAirings = null) {
    const override = App.programEditorialOverrides?.get?.(program) || null;
    const rating = App.programEditorialOverrides?.normalizeRating?.(override?.rating) || '';
    if (!rating) return { rating: '', adjustment: 0, weakCount: 0, activeProtection: false, ratedAt: null };

    const ratedAt = override?.rated_at || override?.updated_at ? new Date(override.rated_at || override.updated_at) : null;
    let weakCount = 0;
    const tests = [];
    if (rating === 'must_air' && ratedAt instanceof Date && !Number.isNaN(ratedAt.getTime())) {
      const seen = new Set();
      rowsForProgram(program, exactAirings).forEach((row) => {
        const when = airingWhen(row);
        if (!when || when <= ratedAt || !isPrimeRow(row)) return;
        const key = `${utils.dateKeyFromDate?.(when) || when.toISOString().slice(0, 10)}|${text(row.air_time || when.toTimeString().slice(0, 5))}|${text(row.fundraiser_label || row.drive_start_date || '')}`;
        if (seen.has(key)) return;
        seen.add(key);
        const dollars = rowContribution(row);
        const minutes = durationMinutes(program, row);
        const rate = minutes > 0 ? (dollars * 60) / minutes : null;
        const weak = dollars <= 0 || (Number.isFinite(rate) && rate < WEAK_PRIME_RATE);
        tests.push({ when, dollars, rate, weak });
      });
      weakCount = tests.filter((test) => test.weak).length;
    }

    let adjustment = PROGRAMMER_WEIGHTS[rating] || 0;
    const activeProtection = rating === 'must_air' && weakCount < 2;
    if (rating === 'must_air' && weakCount >= 2) adjustment = 8;
    return { override, rating, adjustment, weakCount, activeProtection, ratedAt, tests };
  }

  function seasonalEvidence(program = {}, exactAirings = null) {
    const target = focusedFundraiserEntry();
    const targetSeason = seasonKeyForDate(target?.start);
    const rows = rowsForProgram(program, exactAirings);
    const sameSeasonRows = targetSeason ? rows.filter((row) => seasonKeyForDate(rowWhen(row)) === targetSeason) : [];
    const otherRows = targetSeason ? rows.filter((row) => seasonKeyForDate(rowWhen(row)) !== targetSeason) : [];
    const sameTotal = sameSeasonRows.reduce((sum, row) => sum + rowContribution(row), 0);
    const otherTotal = otherRows.reduce((sum, row) => sum + rowContribution(row), 0);
    const sameAvg = sameSeasonRows.length ? sameTotal / sameSeasonRows.length : null;
    const otherAvg = otherRows.length ? otherTotal / otherRows.length : null;
    let adjustment = 0;
    let comparison = '';

    if (sameSeasonRows.length >= 2 && otherRows.length >= 2 && Number.isFinite(otherAvg) && otherAvg > 0) {
      const ratio = sameAvg / otherAvg;
      if (ratio >= 1.35) adjustment += 6;
      else if (ratio <= 0.65) adjustment -= 6;
      comparison = `${targetSeason} airings average ${utils.formatMoney(sameAvg)} versus ${utils.formatMoney(otherAvg)} in other fundraiser seasons.`;
    } else if (sameSeasonRows.length >= 2) {
      if (sameAvg >= 600) adjustment += 4;
      else if (sameAvg === 0) adjustment -= 5;
      else if (sameAvg < 150) adjustment -= 3;
      comparison = `${targetSeason} history: ${sameSeasonRows.length} airings averaging ${utils.formatMoney(sameAvg)}.`;
    } else if (sameSeasonRows.length === 1) {
      if (sameAvg >= 500) adjustment += 2;
      comparison = `Only one ${targetSeason} airing is available, so it is not used as negative evidence by itself.`;
    } else if (targetSeason) {
      comparison = `No WNMU ${targetSeason} fundraiser history for this title.`;
    }

    const christmas = CHRISTMAS_PATTERN.test(programText(program));
    let explicitSeasonAdjustment = 0;
    if (christmas && targetSeason) explicitSeasonAdjustment = targetSeason === 'December' ? 14 : -18;
    adjustment += explicitSeasonAdjustment;

    return {
      target,
      targetSeason,
      rows: rows.length,
      sameSeasonRows: sameSeasonRows.length,
      sameTotal,
      sameAvg,
      otherRows: otherRows.length,
      otherAvg,
      comparison,
      christmas,
      explicitSeasonAdjustment,
      adjustment
    };
  }

  function cleanLegacyBadges(badges = []) {
    return (badges || []).filter((badge) => {
      const value = String(badge || '');
      return !/^Programmer rating:/i.test(value)
        && !/^Focus:/i.test(value)
        && value !== 'Seasonal fit'
        && value !== 'Local / U.P.'
        && value !== 'Rights ending soon'
        && value !== 'Rights ending soon after drive';
    });
  }

  function classify(result = {}, { detailed = false, primeAirings = null } = {}) {
    const score = clampScore(result.score);
    const history = result.history || {};
    const airings = number(history.airings, 0);
    const programmer = result.programmerEvidence || {};
    const season = result.seasonEvidence || {};
    let confidence = result.confidence || 'Low';

    if (result.rights?.expired) return { ...result, score, outlook: 'Do not schedule', tone: 'bad', confidence };

    // A programmer Low confidence rating is a statement about confidence, not merely a score nudge.
    // Keep the evidence score visible, but force the displayed outlook into the Low confidence family.
    if (programmer.rating === 'low_confidence') confidence = 'Low';
    if (programmer.rating === 'must_air' && programmer.activeProtection && confidence === 'Low') confidence = 'Editorial';

    let outlook = result.outlook || 'Situational option';
    let tone = 'neutral';

    if (season.christmas && season.targetSeason && season.targetSeason !== 'December' && programmer.rating !== 'must_air') {
      outlook = 'Save for December';
      tone = 'caution';
    } else if (result.drama?.olderCycle && !['promising', 'must_air'].includes(programmer.rating)) {
      outlook = 'Context check first';
      tone = 'warn';
    } else if (confidence === 'Low') {
      if (airings < 1) {
        if (score >= 58) { outlook = 'Low confidence · Promising'; tone = 'good'; }
        else { outlook = 'Low confidence · Untested'; tone = 'neutral'; }
      } else if (detailed && primeAirings != null && primeAirings < 2 && score < 55) {
        outlook = 'Low confidence · Needs another prime test';
        tone = 'caution';
      } else if (score >= 60) { outlook = 'Low confidence · Promising'; tone = 'good'; }
      else if (score < 45) { outlook = 'Low confidence · Caution'; tone = 'caution'; }
      else { outlook = 'Low confidence · Unclear'; tone = 'neutral'; }
    } else if (score >= 78) { outlook = 'High-priority candidate'; tone = 'strong'; }
    else if (score >= 65) { outlook = 'Strong candidate'; tone = 'good'; }
    else if (score >= 56) { outlook = 'Established option'; tone = 'neutral'; }
    else if (score >= 48) { outlook = 'Situational option'; tone = 'neutral'; }
    else if (score >= 40) { outlook = 'Mixed evidence'; tone = 'caution'; }
    else {
      const heavyExposure = airings >= 8;
      const enoughPrimeEvidence = detailed ? (primeAirings != null && primeAirings >= 2) : airings >= 3;
      if (!heavyExposure && !enoughPrimeEvidence) {
        outlook = detailed ? 'Needs another prime test' : 'Limited evidence';
        tone = 'caution';
      } else {
        outlook = 'Low priority / rest';
        tone = 'warn';
      }
    }

    if (programmer.rating === 'dont_air' && score < 45) {
      outlook = "Programmer says don't air";
      tone = 'bad';
    }

    return { ...result, score, outlook, tone, confidence };
  }

  function applyEnhancements(program = {}, sourceResult = {}, options = {}) {
    const seasonEvidence = seasonalEvidence(program, options.exactAirings || null);
    const programmer = programmerEvidence(program, options.exactAirings || null);
    const correctLocal = localRelevance(program);
    let score = number(sourceResult.score, 50);

    if (seasonEvidence.christmas && sourceResult.season?.matchesTarget) score -= 10;
    if (sourceResult.local && !correctLocal) score -= 8;
    else if (!sourceResult.local && correctLocal) score += 8;
    score += seasonEvidence.adjustment;
    score += programmer.adjustment;

    const badges = cleanLegacyBadges(sourceResult.badges || []);
    const cautions = [...(sourceResult.cautions || [])];
    if (correctLocal) badges.push('Local / U.P.');
    if (programmer.rating) badges.unshift(`Programmer: ${App.programEditorialOverrides?.ratingLabel?.(programmer.rating) || programmer.rating}`);
    if (seasonEvidence.target?.title) badges.push(`Focus: ${seasonEvidence.target.title}`);
    if (seasonEvidence.christmas && seasonEvidence.targetSeason === 'December') badges.push('Seasonal fit');
    if (seasonEvidence.christmas && seasonEvidence.targetSeason && seasonEvidence.targetSeason !== 'December') cautions.push('Christmas / holiday programming is out of season for the selected fundraiser.');
    if (programmer.rating === 'must_air' && programmer.weakCount === 1) cautions.unshift('One weak prime test since the Must air rating; one more will restore automated Low Confidence if warranted.');
    if (programmer.rating === 'must_air' && programmer.weakCount >= 2) cautions.unshift('Must air rating has two weak prime tests; its formula boost has been reduced and automated confidence is back in control.');

    const next = {
      ...sourceResult,
      score: clampScore(score),
      local: correctLocal,
      badges: [...new Set(badges)],
      cautions: [...new Set(cautions)],
      seasonEvidence,
      programmerEvidence: programmer,
      season: {
        ...(sourceResult.season || {}),
        tag: seasonEvidence.christmas ? 'Christmas / holiday' : sourceResult.season?.tag || '',
        matchesTarget: Boolean(seasonEvidence.christmas && seasonEvidence.targetSeason === 'December')
      },
      editorialOverride: {
        ...(sourceResult.editorialOverride || {}),
        override: programmer.override || sourceResult.editorialOverride?.override || null,
        underperformances: programmer.weakCount,
        activeProtection: programmer.activeProtection,
        weakCount: programmer.weakCount
      }
    };
    return classify(next, options);
  }

  function baseAssessment(program = {}) {
    return applyEnhancements(program, originalBaseAssessment(program), { detailed: false });
  }

  function detailedAssessment(program = {}, driveResults = [], exactAirings = []) {
    const source = originalDetailedAssessment(program, driveResults, exactAirings);
    const primeAirings = Number.isFinite(Number(source.primeAirings))
      ? Number(source.primeAirings)
      : (exactAirings || []).filter(isPrimeRow).length;
    return applyEnhancements(program, source, { detailed: true, primeAirings, exactAirings });
  }

  function metricCard(label, value, note = '') {
    return `<div class="scorecard-metric"><div class="scorecard-metric-label">${utils.escapeHtml(label)}</div><div class="scorecard-metric-value">${utils.escapeHtml(value)}</div>${note ? `<div class="scorecard-metric-note">${utils.escapeHtml(note)}</div>` : ''}</div>`;
  }

  function restText(days) {
    if (!Number.isFinite(days)) return 'No prior airing';
    if (days < 31) return `${days}d rest`;
    const months = Math.round(days / 30.4375);
    if (months < 24) return `${months} mo rest`;
    return `${Math.round((days / 365.25) * 10) / 10} yr rest`;
  }

  function explanation(result = {}) {
    const history = result.history || {};
    const season = result.seasonEvidence || {};
    const programmer = result.programmerEvidence || {};
    const parts = [];
    if (season.target?.title) parts.push(`The formula is currently aimed at ${season.target.title} (${season.targetSeason || 'season unknown'}).`);
    if (history.airings > 0) {
      parts.push(`WNMU has ${history.airings} known airing${history.airings === 1 ? '' : 's'} for this title${history.avgPledgeHour != null ? `, averaging ${utils.formatMoney(history.avgPledgeHour)} per pledge hour` : ''}.`);
    } else {
      parts.push('WNMU has no prior airing history for this title, so the model has less evidence to work with.');
    }
    if (season.comparison) parts.push(season.comparison);
    if (programmer.rating) {
      const label = App.programEditorialOverrides?.ratingLabel?.(programmer.rating) || programmer.rating;
      const sign = programmer.adjustment >= 0 ? '+' : '';
      parts.push(`Programmer rating ${label} contributes ${sign}${programmer.adjustment} points to the model.`);
    }
    if (result.biography) parts.push('Biography receives the small genre demotion already built into the model.');
    if (history.airings > 0 && Number.isFinite(history.restDays)) parts.push(`The latest known airing was ${restText(history.restDays)} ago.`);
    return parts.join(' ');
  }

  function detailHtml(program = {}, driveResults = [], exactAirings = []) {
    const result = detailedAssessment(program, driveResults, exactAirings);
    const history = result.history || {};
    const season = result.seasonEvidence || {};
    const contextBadges = [];
    if (result.local) contextBadges.push('Local / U.P. relevance');
    if (result.drama?.currentCycle) contextBadges.push('Current-cycle Drama Doc');
    if (result.drama?.olderCycle) contextBadges.push('Older Drama Doc cycle');
    if (result.core) contextBadges.push('Core PBS compatibility');
    if (result.biography) contextBadges.push('Biography demotion');
    if (derive.premiumSummary(program)) contextBadges.push('Premium information present');

    const seasonValue = season.targetSeason
      ? `${season.targetSeason} focus${season.sameSeasonRows ? ` · ${season.sameSeasonRows} matching airing${season.sameSeasonRows === 1 ? '' : 's'}` : ''}`
      : 'N/A';
    const seasonNote = season.targetSeason
      ? (season.comparison || 'No same-season evidence is available yet.')
      : 'No seasonal fundraiser weighting is being applied.';
    const primeAirings = number(result.primeAirings, 0);
    const primeNote = history.airings > 0
      ? `${primeAirings} verified prime-time airing${primeAirings === 1 ? '' : 's'}. A plausible title needs two weak prime tests before weak performance alone can retire it.`
      : 'No prime-time test yet.';
    const restNote = history.airings > 0
      ? `${restText(history.restDays)} since the latest known airing · ${history.airings} lifetime airing${history.airings === 1 ? '' : 's'}${result.exposure?.twelveMonths ? ` · ${result.exposure.twelveMonths} in the last 12 months` : ''}`
      : 'Unaired at WNMU.';
    const rateNote = history.avgPledgeHour != null
      ? `${utils.formatMoney(history.avgPledgeHour)} average $ / pledge hour`
      : history.airings > 0 && number(history.total, 0) === 0
        ? '$0 average $ / pledge hour'
        : 'No reliable pledge-hour rate yet';
    const programmer = result.programmerEvidence || {};
    const programmerValue = programmer.rating
      ? App.programEditorialOverrides?.ratingLabel?.(programmer.rating) || programmer.rating
      : 'Neutral';
    const programmerNote = programmer.rating
      ? `Formula adjustment ${programmer.adjustment >= 0 ? '+' : ''}${programmer.adjustment}${programmer.rating === 'must_air' ? ` · weak prime tests since rating ${programmer.weakCount}/2` : ''}`
      : 'No programmer weighting is being added.';

    const cautions = result.cautions?.length
      ? `<div class="scorecard-cautions"><strong>Watch:</strong> ${result.cautions.map((item) => `<span>${utils.escapeHtml(item)}</span>`).join('')}</div>`
      : '<div class="scorecard-cautions scorecard-cautions-clear"><strong>Watch:</strong> No major automated caution flags.</div>';

    return `
      <div class="program-scorecard-explanation scorecard-tone-${utils.escapeHtml(result.tone || 'neutral')}">
        <div class="program-scorecard-kicker">Why this outlook</div>
        <p>${utils.escapeHtml(explanation(result))}</p>
        <div class="program-scorecard-formula-line"><strong>Model score:</strong> ${utils.escapeHtml(String(Math.round(result.score)))} / 100 <span>·</span> <strong>Evidence:</strong> ${utils.escapeHtml(result.confidence || 'Low')}</div>
      </div>
      <div class="scorecard-metric-grid">
        ${metricCard('Fundraising history', history.airings ? `${history.airings} airing${history.airings === 1 ? '' : 's'}` : 'Unaired', rateNote)}
        ${metricCard('Selected fundraiser season', seasonValue, seasonNote)}
        ${metricCard('Programmer rating', programmerValue, programmerNote)}
        ${metricCard('Prime-time evidence', primeAirings ? `${primeAirings} prime airing${primeAirings === 1 ? '' : 's'}` : 'No verified prime test', primeNote)}
        ${metricCard('Rest & exposure', history.airings ? restText(history.restDays) : 'Fresh / unaired', restNote)}
        ${metricCard('Context', contextBadges.length ? contextBadges.join(' · ') : 'No special context flag', contextBadges.length ? 'These contextual factors can move a title above or below what raw fundraising history suggests.' : 'No automated local, Drama Doc, core-PBS, biography, or premium context flag was detected.')}
      </div>
      ${cautions}`;
  }

  restoreFocusedFundraiser();

  App.programFundraiserFocus = {
    entries: scheduleEntries,
    get: focusedFundraiserEntry,
    getDefault: defaultFundraiserEntry,
    set: setFocusedFundraiser,
    seasonKeyForDate
  };
  App.programScorecard.baseAssessment = baseAssessment;
  App.programScorecard.detailedAssessment = detailedAssessment;
  App.programScorecard.detailHtml = detailHtml;
  App.programOutlookEnhancements = {
    seasonalEvidence,
    programmerEvidence,
    localRelevance,
    PROGRAMMER_WEIGHTS,
    WEAK_PRIME_RATE
  };
})();
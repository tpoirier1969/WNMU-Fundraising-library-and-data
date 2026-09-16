(() => {
  'use strict';

  const App = window.PledgeLib;
  if (!App?.programScorecard) return;

  const { utils, derive, state } = App;
  const originalBaseAssessment = App.programScorecard.baseAssessment.bind(App.programScorecard);
  const originalDetailedAssessment = App.programScorecard.detailedAssessment.bind(App.programScorecard);
  const CHRISTMAS_PATTERN = /\b(?:christmas|holiday|holidays|noel|yuletide|nativity)\b/i;
  const EDITORIAL_WEAK_RATE = 150;

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function programText(program = {}) {
    return [derive.title(program), derive.description(program), derive.topicPrimary(program), derive.topicSecondary(program)]
      .filter(Boolean)
      .join(' ');
  }

  function isBiography(program = {}) {
    const primary = utils.normalizeLookupKey(derive.topicPrimary(program));
    const secondary = utils.normalizeLookupKey(derive.topicSecondary(program));
    return primary.includes('biograph') || secondary.includes('biograph');
  }

  function targetFundraiserDate() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const schedules = Array.isArray(state.schedules) ? state.schedules : [];
    const entries = schedules.map((schedule) => {
      const start = utils.parseDateLike(schedule?.startDate || schedule?.start_date || '', { preferDateOnlyLocal: true });
      const end = utils.parseDateLike(schedule?.endDate || schedule?.end_date || schedule?.startDate || schedule?.start_date || '', { preferDateOnlyLocal: true });
      return { schedule, start, end: end instanceof Date && !Number.isNaN(end.getTime()) ? end : start };
    }).filter((entry) => entry.start instanceof Date && !Number.isNaN(entry.start.getTime()));

    const active = entries.find((entry) => String(entry.schedule?.id || '') === String(state.activeScheduleId || '')) || null;
    if (active && active.end instanceof Date && active.end >= today) return active.start;

    const upcoming = entries
      .filter((entry) => entry.end instanceof Date && entry.end >= today)
      .sort((a, b) => a.start - b.start)[0] || null;
    return upcoming?.start || today;
  }

  function correctSeason(program, result) {
    const christmas = CHRISTMAS_PATTERN.test(programText(program));
    if (!christmas) return result;
    const targetMonth = targetFundraiserDate().getMonth();
    const matchesTarget = targetMonth === 10 || targetMonth === 11;
    const previouslyMatched = Boolean(result.season?.matchesTarget);
    let score = number(result.score, 50);
    if (previouslyMatched && !matchesTarget) score -= 10;
    if (!previouslyMatched && matchesTarget) score += 10;
    return {
      ...result,
      score: Math.max(0, Math.min(100, score)),
      season: { ...(result.season || {}), tag: 'Christmas / holiday', matchesTarget }
    };
  }

  function rowWhen(row = {}) {
    const when = utils.rowLocalDateTime?.(row, { preferDriveFallback: true });
    return when instanceof Date && !Number.isNaN(when.getTime()) ? when : null;
  }

  function isPrimeRow(row = {}) {
    const when = rowWhen(row);
    if (!when) return false;
    const minutes = when.getHours() * 60 + when.getMinutes();
    return minutes >= 19 * 60 && minutes < 23 * 60;
  }

  function primeAiringCount(rows = []) {
    return (Array.isArray(rows) ? rows : []).reduce((count, row) => count + (isPrimeRow(row) ? 1 : 0), 0);
  }

  function rowContribution(row = {}) {
    return number(utils.firstNonEmpty(
      row?.__resolved_contribution_amount,
      row?.contribution_amount,
      row?.dollars,
      row?.total_dollars,
      row?.broadcast_dollars,
      0
    ), 0);
  }

  function durationMinutes(program = {}, row = {}) {
    const seconds = number(utils.firstNonEmpty(program?.actual_runtime_seconds, program?.runtime_seconds, program?.actual_runtime), 0);
    if (seconds > 0) return seconds / 60;
    const minutes = number(utils.firstNonEmpty(program?.actual_runtime_minutes, program?.runtime_minutes, program?.length_minutes), 0);
    if (minutes > 0) return minutes;
    const bucket = number(utils.firstNonEmpty(program?.length_bucket_minutes, derive.lengthBucket?.(program)), 0);
    if (bucket > 0) return bucket;
    const imported = number(row?.program_minutes, 0);
    return imported > 0 ? imported : null;
  }

  function rowsForProgram(program = {}, exactAirings = null) {
    if (Array.isArray(exactAirings) && exactAirings.length) return exactAirings;
    const id = String(derive.programId(program) || '').trim();
    if (!id) return [];
    return (Array.isArray(state.scorecardAiringRows) ? state.scorecardAiringRows : []).filter((row) => {
      const linked = String(utils.firstNonEmpty(row?.manual_match_program_id, row?.pledge_program_id, row?.program_id, '') || '').trim();
      return linked === id;
    });
  }

  function editorialUnderperformanceInfo(program = {}, exactAirings = null) {
    const override = App.programEditorialOverrides?.get?.(program) || null;
    if (!override || override.rating !== 'high') return override ? { override, underperformances: 0, activeProtection: false, tests: [] } : null;

    const ratedAt = new Date(override.rated_at || override.updated_at || '');
    if (Number.isNaN(ratedAt.getTime())) return { override, underperformances: 0, activeProtection: true, tests: [] };

    const seen = new Set();
    const tests = [];
    rowsForProgram(program, exactAirings).forEach((row) => {
      const when = rowWhen(row);
      if (!when || when <= ratedAt || !isPrimeRow(row)) return;
      const key = `${utils.dateKeyFromDate?.(when) || when.toISOString().slice(0, 10)}|${String(row?.air_time || when.toTimeString().slice(0, 5))}|${String(row?.fundraiser_label || row?.drive_start_date || '')}`;
      if (seen.has(key)) return;
      seen.add(key);

      const dollars = rowContribution(row);
      const minutes = durationMinutes(program, row);
      const rate = minutes > 0 ? (dollars * 60) / minutes : null;
      const weak = dollars <= 0 || (Number.isFinite(rate) && rate < EDITORIAL_WEAK_RATE);
      tests.push({ when, dollars, minutes, rate, weak });
    });

    const underperformances = tests.filter((test) => test.weak).length;
    return {
      override,
      ratedAt,
      underperformances,
      activeProtection: underperformances < 2,
      tests
    };
  }

  function confidenceLabel(result, { detailed = false, primeAirings = null } = {}) {
    const history = result.history || {};
    const airings = number(history.airings, 0);
    const score = number(result.score, 50);
    const confidence = result.confidence || 'Low';
    const hardStop = result.rights?.expired || result.drama?.olderCycle;
    if (hardStop) return result;

    if (confidence === 'Low') {
      let outlook;
      let tone = 'neutral';
      if (airings < 1) {
        const positiveContext = Boolean(result.season?.matchesTarget || result.local || result.drama?.currentCycle || result.core);
        if (score >= 58 || positiveContext) {
          outlook = 'Low confidence · Promising';
          tone = 'good';
        } else {
          outlook = 'Low confidence · Untested';
        }
      } else if (detailed && primeAirings != null && primeAirings < 2 && score < 55) {
        outlook = 'Low confidence · Needs another prime test';
        tone = 'caution';
      } else if (score >= 60) {
        outlook = 'Low confidence · Promising';
        tone = 'good';
      } else if (score < 45) {
        outlook = 'Low confidence · Caution';
        tone = 'caution';
      } else {
        outlook = 'Low confidence · Unclear';
      }
      return { ...result, outlook, tone };
    }

    let outlook;
    let tone = 'neutral';
    if (score >= 76) { outlook = 'High-priority candidate'; tone = 'strong'; }
    else if (score >= 64) { outlook = 'Strong candidate'; tone = 'good'; }
    else if (score >= 56) { outlook = 'Established option'; }
    else if (score >= 48) { outlook = 'Situational option'; }
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
    return { ...result, outlook, tone };
  }

  function applyEditorialOverride(program, result, options = {}) {
    const info = editorialUnderperformanceInfo(program, options.exactAirings || null);
    if (!info) return result;

    const next = {
      ...result,
      editorialOverride: info,
      badges: [...(result.badges || [])],
      cautions: [...(result.cautions || [])]
    };
    const rating = info.override?.rating || '';
    if (rating) next.badges.unshift(`Programmer rating: ${rating.charAt(0).toUpperCase() + rating.slice(1)}`);

    const hardStop = next.rights?.expired || next.drama?.olderCycle;
    if (rating === 'high' && !hardStop && next.confidence === 'Low') {
      if (info.activeProtection) {
        next.confidence = 'Editorial';
        next.outlook = 'Programmer-rated high';
        next.tone = 'good';
        if (info.underperformances === 1) {
          next.cautions.unshift('One weak prime test since the High rating; a second will return confidence to the automated evidence.');
        }
      } else {
        next.cautions.unshift('High programmer rating has two weak prime tests since it was set; automated confidence is back in control.');
      }
    }

    next.badges = [...new Set(next.badges)];
    next.cautions = [...new Set(next.cautions)];
    return next;
  }

  function applyRules(program, sourceResult, options = {}) {
    let result = correctSeason(program, { ...sourceResult, cautions: [...(sourceResult.cautions || [])], badges: [...(sourceResult.badges || [])] });
    if (isBiography(program)) {
      result.score = Math.max(0, number(result.score, 50) - 4);
      result.cautions.push('Biography: small genre demotion');
      result.biography = true;
    }
    result.cautions = [...new Set(result.cautions)];
    result = confidenceLabel(result, options);
    return applyEditorialOverride(program, result, options);
  }

  function baseAssessment(program = {}) {
    return applyRules(program, originalBaseAssessment(program), { detailed: false });
  }

  function detailedAssessment(program = {}, driveResults = [], exactAirings = []) {
    const primeAirings = primeAiringCount(exactAirings);
    const result = applyRules(program, originalDetailedAssessment(program, driveResults, exactAirings), { detailed: true, primeAirings, exactAirings });
    return { ...result, primeAirings };
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

  function detailHtml(program = {}, driveResults = [], exactAirings = []) {
    const result = detailedAssessment(program, driveResults, exactAirings);
    const history = result.history || {};
    const contextBadges = [];
    if (result.season?.matchesTarget) contextBadges.push('Seasonal match for target fundraiser');
    else if (result.season?.tag) contextBadges.push(result.season.tag);
    if (result.local) contextBadges.push('Local / U.P. relevance');
    if (result.drama?.currentCycle) contextBadges.push('Current-cycle Drama Doc');
    if (result.drama?.olderCycle) contextBadges.push('Older Drama Doc cycle: verify current-series relevance');
    if (result.core) contextBadges.push('Core PBS compatibility');
    if (result.biography) contextBadges.push('Biography: small genre demotion');
    if (derive.premiumSummary(program)) contextBadges.push('Premium information present');

    const pledgeNote = result.totalPledges > 0
      ? `${utils.formatCount(result.totalPledges)} pledges in exact airing history${result.avgGift != null ? ` · ${utils.formatMoney(result.avgGift)} average dollars per pledge` : ''}`
      : 'No pledge-count history available for this title.';

    const restNote = history.airings > 0
      ? `${restText(history.restDays)} since the latest known airing · ${history.airings} lifetime airing${history.airings === 1 ? '' : 's'}${result.exposure?.twelveMonths ? ` · ${result.exposure.twelveMonths} in the last 12 months` : ''}`
      : 'Unaired at WNMU.';

    const rateNote = history.avgPledgeHour != null
      ? `${utils.formatMoney(history.avgPledgeHour)} average $ / pledge hour`
      : history.airings > 0 && number(history.total, 0) === 0
        ? '$0 average $ / pledge hour'
        : 'No reliable pledge-hour rate yet';

    const primeNote = history.airings > 0
      ? `${result.primeAirings} verified prime-time airing${result.primeAirings === 1 ? '' : 's'} in exact airing history. Two prime tests are required before a plausible title is retired for weak performance.`
      : 'No prime-time test yet.';

    const editorialControl = App.programEditorialOverrides?.controlHtml?.(program, result.editorialOverride) || '';

    const cautions = result.cautions.length
      ? `<div class="scorecard-cautions"><strong>Watch:</strong> ${result.cautions.map((item) => `<span>${utils.escapeHtml(item)}</span>`).join('')}</div>`
      : '<div class="scorecard-cautions scorecard-cautions-clear"><strong>Watch:</strong> No major automated caution flags.</div>';

    return `
      <div class="program-scorecard-head scorecard-tone-${utils.escapeHtml(result.tone || 'neutral')}">
        <div>
          <div class="program-scorecard-kicker">Automated programming outlook</div>
          <div class="program-scorecard-title">${utils.escapeHtml(result.outlook)}</div>
          <div class="program-scorecard-confidence">Evidence confidence: ${utils.escapeHtml(result.confidence)}</div>
        </div>
        <div class="program-scorecard-auto">Advisory only. A High programmer rating can replace Low Confidence until the title records two clear weak prime tests after that rating.</div>
      </div>
      ${editorialControl}
      <div class="scorecard-metric-grid">
        ${metricCard('Fundraising history', history.airings ? `${history.airings} airing${history.airings === 1 ? '' : 's'} · ${history.fundraisers || result.periods?.length || 0} pledge period${(history.fundraisers || result.periods?.length || 0) === 1 ? '' : 's'}` : 'Unaired', rateNote)}
        ${metricCard('Pledge response', result.totalPledges ? `${utils.formatCount(result.totalPledges)} pledges` : 'Not available', pledgeNote)}
        ${metricCard('Rest & exposure', history.airings ? restText(history.restDays) : 'Fresh / unaired', restNote)}
        ${metricCard('Trajectory', result.trend?.label || 'Not enough history', result.trend?.detail || 'No completed pledge-period history.')}
        ${metricCard('Prime-time evidence', result.primeAirings ? `${result.primeAirings} prime airing${result.primeAirings === 1 ? '' : 's'}` : 'No verified prime test', primeNote)}
        ${metricCard('Context', contextBadges.length ? contextBadges.join(' · ') : 'No special context flag', contextBadges.length ? 'Context can move a title above or below what raw fundraising history suggests.' : 'No automated seasonal, local, current Drama Doc, core-PBS, biography, or premium flag was detected.')}
      </div>
      ${cautions}`;
  }

  App.programScorecard.baseAssessment = baseAssessment;
  App.programScorecard.detailedAssessment = detailedAssessment;
  App.programScorecard.detailHtml = detailHtml;
  App.programOutlookRules = { isBiography, primeAiringCount, targetFundraiserDate, editorialUnderperformanceInfo, EDITORIAL_WEAK_RATE };
})();

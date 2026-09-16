(() => {
  'use strict';

  const App = window.PledgeLib;
  if (!App) return;
  const { state, utils, derive } = App;

  const DAY_MS = 86400000;
  const CURRENT_DRAMA_DOC_CUTOFF = new Date(2026, 7, 1);
  const CORE_TOPICS = new Set([
    'drama', 'drama doc', 'documentary', 'history', 'nature', 'science', 'public affairs', 'news', 'arts', 'arts culture'
  ]);
  const BIO_TOPICS = new Set(['bio', 'biography', 'biographical']);
  const LOCAL_PATTERN = /\b(?:michigan|upper peninsula|u\.?p\.?|yooper|marquette|negaunee|ishpeming|keweenaw|mackinac|lake superior|great lakes|pelkie)\b/i;
  const CHRISTMAS_PATTERN = /\b(?:christmas|holiday|holidays|noel|yuletide|nativity)\b/i;

  function numberValue(...values) {
    for (const value of values) {
      if (value == null || value === '') continue;
      const num = Number(value);
      if (Number.isFinite(num)) return num;
    }
    return null;
  }

  function rowContribution(row = {}) {
    return numberValue(
      row.__resolved_contribution_amount,
      row.contribution_amount,
      row.total_contributions,
      row.total_dollars,
      row.dollars,
      row.contributed,
      row.broadcast_dollars
    ) || 0;
  }

  function rowPledges(row = {}) {
    return numberValue(row.pledge_count, row.pledges, row.total_pledges, row.gift_count, row.donor_count) || 0;
  }

  function rowDate(row = {}) {
    const local = utils.rowLocalDateTime?.(row, { preferDriveFallback: true });
    if (local instanceof Date && !Number.isNaN(local.getTime())) return local;
    const raw = utils.firstNonEmpty(row.air_date, row.aired_at, row.drive_date, row.drive_start_date, row.date_key);
    return raw ? utils.parseDateLike(raw, { preferDateOnlyLocal: true }) : null;
  }

  function rowHasExplicitTime(row = {}) {
    return !utils.isBlank(utils.firstNonEmpty(row.air_time, row.time_of_day, row.scheduled_time, row.slot_time, row.airtime, row.broadcast_time));
  }

  function isPrimeAiring(row = {}) {
    if (!rowHasExplicitTime(row)) return false;
    const raw = utils.firstNonEmpty(row.air_time, row.time_of_day, row.scheduled_time, row.slot_time, row.airtime, row.broadcast_time);
    const parsed = utils.parseClockTime?.(raw);
    return Boolean(parsed && parsed.hour >= 19 && parsed.hour < 23);
  }

  function daysBetween(earlier, later = new Date()) {
    if (!(earlier instanceof Date) || Number.isNaN(earlier.getTime())) return null;
    return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / DAY_MS));
  }

  function restText(days) {
    if (!Number.isFinite(days)) return 'No prior airing';
    if (days < 31) return `${days}d rest`;
    const months = Math.round(days / 30.4375);
    if (months < 24) return `${months} mo rest`;
    const years = Math.round((days / 365.25) * 10) / 10;
    return `${years} yr rest`;
  }

  function normalizedToday() {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }

  function usableScheduleEntries() {
    const schedules = Array.isArray(state.schedules) && state.schedules.length
      ? state.schedules
      : (Array.isArray(state.scorecardSchedules) ? state.scorecardSchedules : []);
    return schedules.map((schedule) => {
      const start = utils.parseDateLike(schedule?.startDate || schedule?.start_date || '', { preferDateOnlyLocal: true });
      const end = utils.parseDateLike(schedule?.endDate || schedule?.end_date || schedule?.startDate || schedule?.start_date || '', { preferDateOnlyLocal: true });
      return { schedule, start, end };
    }).filter((entry) => entry.start instanceof Date && !Number.isNaN(entry.start.getTime()));
  }

  function targetFundraiserDate() {
    const entries = usableScheduleEntries();
    const today = normalizedToday();
    const active = entries.find((entry) => String(entry.schedule?.id || '') === String(state.activeScheduleId || '')) || null;
    const activeEnd = active?.end instanceof Date && !Number.isNaN(active.end.getTime()) ? active.end : active?.start;
    const activeIsCurrentOrFuture = Boolean(active && activeEnd >= today);
    const pick = activeIsCurrentOrFuture
      ? active
      : entries.filter((entry) => (entry.end || entry.start) >= today).sort((a, b) => a.start - b.start)[0] || null;
    return pick?.start instanceof Date && !Number.isNaN(pick.start.getTime()) ? pick.start : today;
  }

  function programText(program = {}) {
    return [derive.title(program), derive.description(program), derive.topicPrimary(program), derive.topicSecondary(program)].filter(Boolean).join(' ');
  }

  function seasonalInfo(program = {}) {
    const text = programText(program);
    if (!CHRISTMAS_PATTERN.test(text)) return { tag: '', matchesTarget: false };
    const month = targetFundraiserDate().getMonth();
    return { tag: 'Christmas / holiday', matchesTarget: month === 10 || month === 11 };
  }

  function localRelevance(program = {}) {
    return LOCAL_PATTERN.test(programText(program));
  }

  function biographyInfo(program = {}) {
    const topic = utils.normalizeLookupKey(derive.topicPrimary(program));
    return { isBiography: BIO_TOPICS.has(topic) || topic.startsWith('bio ') };
  }

  function dramaDocInfo(program = {}) {
    const isDramaDoc = utils.normalizeLookupKey(derive.topicPrimary(program)) === 'drama doc';
    if (!isDramaDoc) return { isDramaDoc: false, currentCycle: false, olderCycle: false };
    const rightsBegin = utils.parseDateLike(derive.rightsBegin(program), { preferDateOnlyLocal: true });
    const currentCycle = rightsBegin instanceof Date && !Number.isNaN(rightsBegin.getTime()) && rightsBegin >= CURRENT_DRAMA_DOC_CUTOFF;
    return { isDramaDoc: true, currentCycle, olderCycle: !currentCycle };
  }

  function corePbsFit(program = {}) {
    const topic = utils.normalizeLookupKey(derive.topicPrimary(program));
    const distributor = utils.normalizeLookupKey(derive.distributor(program));
    if (CORE_TOPICS.has(topic)) return true;
    return distributor === 'pbs' && /^(?:drama|documentary|history|nature|science|public affairs|news)/.test(topic);
  }

  function rightsInfo(program = {}) {
    const end = utils.parseDateLike(derive.rightsEnd(program), { preferDateOnlyLocal: true });
    if (!(end instanceof Date) || Number.isNaN(end.getTime())) return { end: null, days: null, expired: false, retiring: false };
    const today = normalizedToday();
    const days = Math.ceil((end.getTime() - today.getTime()) / DAY_MS);
    return { end, days, expired: days < 0, retiring: days >= 0 && days <= 90 };
  }

  function listHistory(program = {}) {
    const exactAirings = numberValue(program.__exact_airing_count);
    const airings = exactAirings != null
      ? exactAirings
      : numberValue(program.all_air_dates_count, program.total_airings, program.airing_count, program.aired_count, program.times_aired) || 0;
    const exactFundraisers = numberValue(program.__exact_fundraiser_count);
    const fundraisers = exactFundraisers != null
      ? exactFundraisers
      : numberValue(program.fundraiser_count, program.drive_count, program.fundraiser_total, program.drive_total) || 0;
    const total = Number(derive.totalRaised(program) || 0) || 0;
    const avgFundraiser = Number(derive.avgPerFundraiser(program) || 0) || 0;
    const avgPledgeHour = derive.avgPerPledgeHour(program);
    const latest = utils.parseDateLike(derive.latestAiredValue(program), { preferDateOnlyLocal: true });
    const restDays = daysBetween(latest);
    const primeAirings = numberValue(program.__prime_airing_count) || 0;
    const primeZeroAirings = numberValue(program.__prime_zero_airing_count) || 0;
    const exactPledges = numberValue(program.__exact_pledge_count) || 0;
    const recentSixMonths = numberValue(program.__recent_airing_count_6m) || 0;
    const recentTwelveMonths = numberValue(program.__recent_airing_count_12m) || 0;
    return { airings, fundraisers, total, avgFundraiser, avgPledgeHour, latest, restDays, primeAirings, primeZeroAirings, exactPledges, recentSixMonths, recentTwelveMonths };
  }

  function fundraiserKey(airing = {}) {
    const label = utils.normalizeText(utils.firstNonEmpty(airing.fundraiser_label, airing.fundraiser_name, airing.drive_label, airing.drive_name));
    if (label) return `label:${utils.normalizeLookupKey(label)}`;
    const start = utils.normalizeText(utils.firstNonEmpty(airing.drive_start_date, airing.fundraiser_start_date, '')).slice(0, 10);
    const end = utils.normalizeText(utils.firstNonEmpty(airing.drive_end_date, airing.fundraiser_end_date, '')).slice(0, 10);
    if (start || end) return `range:${start}|${end}`;
    const when = rowDate(airing);
    return when instanceof Date && !Number.isNaN(when.getTime()) ? `month:${utils.dateKeyFromDate(when).slice(0, 7)}` : '';
  }

  function libraryDurationMinutes(program = {}, airing = {}) {
    const seconds = Number(utils.firstNonEmpty(program.actual_runtime_seconds, program.runtime_seconds, program.actual_runtime));
    if (Number.isFinite(seconds) && seconds > 0) return seconds / 60;
    const direct = Number(utils.firstNonEmpty(program.actual_runtime_minutes, program.runtime_minutes, program.length_minutes));
    if (Number.isFinite(direct) && direct > 0) return direct;
    const bucket = Number(program.length_bucket_minutes || 0);
    if (Number.isFinite(bucket) && bucket > 0) return bucket;
    const imported = Number(airing.program_minutes || 0);
    return Number.isFinite(imported) && imported > 0 ? imported : null;
  }

  function installCorrectedHistoryRefresh() {
    if (!App.data?.fetchImportedAirings || App.data.__scorecardHistoryFixInstalled) return;
    App.data.__scorecardHistoryFixInstalled = true;

    const buildIndex = (airingsRows = []) => {
      const byId = new Map();
      const byLookup = new Map();
      const byTitle = new Map();
      const add = (map, rawKey, row) => {
        const key = utils.normalizeLookupKey(rawKey);
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        const rows = map.get(key);
        if (!rows.includes(row)) rows.push(row);
      };
      (airingsRows || []).forEach((row) => {
        if (!row || utils.isNonSpecificRow(row)) return;
        [row.pledge_program_id, row.manual_match_program_id, row.program_id]
          .map((value) => utils.normalizeText(value)).filter(Boolean)
          .forEach((value) => add(byId, value, row));
        const titles = [row.matched_library_title, row.imported_program_title, row.program_title, row.title, row.name]
          .map((value) => utils.normalizeText(value)).filter(Boolean);
        const nolas = [row.nola_code, row.nola, row.program_nola]
          .map((value) => utils.normalizeText(value)).filter(Boolean);
        titles.forEach((title) => add(byTitle, title, row));
        nolas.forEach((nola) => titles.forEach((title) => {
          const key = utils.nolaIdentityKey(nola, title);
          if (key) add(byLookup, key, row);
        }));
      });
      return { byId, byLookup, byTitle };
    };

    const resolveRows = (program, index) => {
      const id = utils.normalizeLookupKey(derive.programId(program));
      if (id && index.byId.has(id)) return index.byId.get(id);
      const lookup = utils.nolaIdentityKey(derive.nola(program), derive.title(program));
      const lookupKey = utils.normalizeLookupKey(lookup);
      if (lookupKey && index.byLookup.has(lookupKey)) return index.byLookup.get(lookupKey);
      const title = utils.normalizeLookupKey(derive.title(program));
      if (title && index.byTitle.has(title)) return index.byTitle.get(title);
      return [];
    };

    const attach = (programRows = [], index) => (programRows || []).map((program) => {
      const airings = resolveRows(program, index);
      const dateKeys = [...new Set(airings.map((row) => {
        const when = rowDate(row);
        return when instanceof Date && !Number.isNaN(when.getTime()) ? utils.dateKeyFromDate(when) : '';
      }).filter(Boolean))].sort((a, b) => b.localeCompare(a));

      const byFundraiser = new Map();
      airings.forEach((airing) => {
        const key = fundraiserKey(airing);
        if (!key) return;
        if (!byFundraiser.has(key)) byFundraiser.set(key, []);
        byFundraiser.get(key).push(airing);
      });
      const rates = [];
      byFundraiser.forEach((rows) => {
        const durations = rows.map((airing) => libraryDurationMinutes(program, airing));
        if (!durations.length || durations.some((minutes) => !(Number(minutes) > 0))) return;
        const minutes = durations.reduce((sum, value) => sum + Number(value || 0), 0);
        const dollars = rows.reduce((sum, airing) => sum + rowContribution(airing), 0);
        if (minutes > 0) rates.push((dollars * 60) / minutes);
      });
      const avgPledgeHour = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length : null;
      const primeRows = airings.filter(isPrimeAiring);
      const now = new Date();
      const recentSix = airings.filter((row) => {
        const when = rowDate(row);
        const days = daysBetween(when, now);
        return Number.isFinite(days) && days <= 183;
      }).length;
      const recentTwelve = airings.filter((row) => {
        const when = rowDate(row);
        const days = daysBetween(when, now);
        return Number.isFinite(days) && days <= 365;
      }).length;
      const display = dateKeys.map((value) => utils.formatDate(value, value)).join(' · ');

      return {
        ...program,
        all_air_dates_display: display,
        all_air_dates_latest: dateKeys[0] || '',
        all_air_dates_count: dateKeys.length,
        __exact_airing_count: airings.length,
        __exact_fundraiser_count: byFundraiser.size,
        __exact_pledge_count: airings.reduce((sum, row) => sum + rowPledges(row), 0),
        __exact_dollars_total: airings.reduce((sum, row) => sum + rowContribution(row), 0),
        __prime_airing_count: primeRows.length,
        __prime_zero_airing_count: primeRows.filter((row) => rowContribution(row) <= 0).length,
        __recent_airing_count_6m: recentSix,
        __recent_airing_count_12m: recentTwelve,
        __avg_dollars_per_pledge_hour: Number.isFinite(avgPledgeHour) ? avgPledgeHour : null
      };
    });

    App.data.refreshAiringHistory = async function correctedRefreshAiringHistory() {
      const sourceRows = Array.isArray(state.scheduleImportedAiringsCache)
        ? (App.data.canonicalizeImportedAirings?.(state.scheduleImportedAiringsCache) || state.scheduleImportedAiringsCache)
        : await App.data.fetchImportedAirings();
      const index = buildIndex(sourceRows || []);
      state.baseRows = attach(state.baseRows, index);
      state.rawRows = attach(state.rawRows, index);
      return state.rawRows;
    };
  }

  installCorrectedHistoryRefresh();

  function groupDriveResults(driveResults = [], exactAirings = []) {
    const source = Array.isArray(driveResults) && driveResults.length ? driveResults : exactAirings;
    const groups = new Map();
    (source || []).forEach((row, index) => {
      const label = utils.normalizeText(utils.firstNonEmpty(
        row.fundraiser_label, row.fundraiser_name, row.drive_label, row.drive_column, row.drive_name, row.campaign_name, ''
      ));
      const when = rowDate(row);
      const dateKey = when instanceof Date && !Number.isNaN(when.getTime()) ? utils.dateKeyFromDate(when) : '';
      const key = label ? `label:${utils.normalizeLookupKey(label)}` : `date:${dateKey || index}`;
      const current = groups.get(key) || { key, label: label || dateKey || `Pledge period ${groups.size + 1}`, when, dollars: 0, pledges: 0, rows: 0 };
      current.dollars += rowContribution(row);
      current.pledges += rowPledges(row);
      current.rows += 1;
      if (!current.when && when) current.when = when;
      groups.set(key, current);
    });
    return [...groups.values()].sort((a, b) => {
      const at = a.when instanceof Date ? a.when.getTime() : 0;
      const bt = b.when instanceof Date ? b.when.getTime() : 0;
      return at - bt;
    });
  }

  function trajectory(periods = []) {
    if (periods.length < 2) return { label: 'Not enough history', tone: 'neutral', detail: periods.length === 1 ? 'One pledge period is not enough to establish a trend.' : 'No completed pledge-period history.' };
    const amounts = periods.map((entry) => Number(entry.dollars || 0));
    const latest = amounts[amounts.length - 1];
    const previous = amounts[amounts.length - 2];
    if (periods.length === 2) {
      if (previous > 0 && latest >= previous * 1.25) return { label: 'Rising', tone: 'good', detail: `${utils.formatMoney(previous)} to ${utils.formatMoney(latest)} in the two most recent pledge periods.` };
      if (previous > 0 && latest <= previous * 0.6) return { label: 'Fading', tone: 'warn', detail: `${utils.formatMoney(previous)} to ${utils.formatMoney(latest)} in the two most recent pledge periods.` };
      return { label: 'Mixed / stable', tone: 'neutral', detail: `${utils.formatMoney(previous)} to ${utils.formatMoney(latest)} in the two most recent pledge periods.` };
    }
    const recent = amounts.slice(-2).reduce((sum, value) => sum + value, 0) / 2;
    const priorSlice = amounts.slice(Math.max(0, amounts.length - 4), -2);
    const prior = priorSlice.length ? priorSlice.reduce((sum, value) => sum + value, 0) / priorSlice.length : previous;
    if (prior > 0 && recent >= prior * 1.25) return { label: 'Rising', tone: 'good', detail: `Recent pledge periods average ${utils.formatMoney(recent)} versus ${utils.formatMoney(prior)} before that.` };
    if (prior > 0 && recent <= prior * 0.65) return { label: 'Fading', tone: 'warn', detail: `Recent pledge periods average ${utils.formatMoney(recent)} versus ${utils.formatMoney(prior)} before that.` };
    return { label: 'Mixed / stable', tone: 'neutral', detail: `Recent pledge periods average ${utils.formatMoney(recent)} versus ${utils.formatMoney(prior)} before that.` };
  }

  function recentExposure(exactAirings = []) {
    const now = new Date();
    let sixMonths = 0;
    let twelveMonths = 0;
    (exactAirings || []).forEach((row) => {
      const when = rowDate(row);
      if (!(when instanceof Date) || Number.isNaN(when.getTime())) return;
      const days = daysBetween(when, now);
      if (days <= 183) sixMonths += 1;
      if (days <= 365) twelveMonths += 1;
    });
    return { sixMonths, twelveMonths };
  }

  function classifyOutlook({ score, history, rights, drama, season, local, core, biography, trend = null, exposure = null }) {
    const contextualFit = Boolean(season.matchesTarget || local || drama.currentCycle || core);
    const heavyExposure = history.airings >= 8 || (exposure?.sixMonths || history.recentSixMonths) >= 3;
    const enoughPrimeEvidence = history.primeAirings >= 2;
    const trendFading = trend?.tone === 'warn';

    if (rights.expired) return { outlook: 'Do not schedule', tone: 'bad' };
    if (drama.olderCycle) return { outlook: 'Context check first', tone: 'warn' };
    if (history.airings < 1 && contextualFit) return { outlook: 'Promising new title', tone: 'good' };
    if (history.airings < 1) return { outlook: biography.isBiography ? 'New title, modest fit' : 'New title, untested', tone: 'neutral' };
    if (score >= 80) return { outlook: 'High-priority candidate', tone: 'strong' };
    if (score >= 68) return { outlook: 'Strong candidate', tone: 'good' };
    if (score >= 58) return { outlook: 'Established option', tone: 'neutral' };

    if (!enoughPrimeEvidence && !heavyExposure) {
      if (contextualFit) return { outlook: 'Needs another prime test', tone: 'caution' };
      return { outlook: 'Limited evidence', tone: 'neutral' };
    }

    if (score < 40 && (enoughPrimeEvidence || heavyExposure || trendFading)) return { outlook: 'Low priority / rest', tone: 'warn' };
    if (score < 50) return { outlook: 'Mixed evidence', tone: 'caution' };
    return { outlook: 'Situational option', tone: 'neutral' };
  }

  function baseAssessment(program = {}) {
    const history = listHistory(program);
    const season = seasonalInfo(program);
    const local = localRelevance(program);
    const biography = biographyInfo(program);
    const drama = dramaDocInfo(program);
    const core = corePbsFit(program);
    const rights = rightsInfo(program);
    let score = 50;
    const badges = [];
    const cautions = [];

    if (history.airings < 1) {
      badges.push('Unaired');
    } else {
      const rate = Number(history.avgPledgeHour);
      if (Number.isFinite(rate)) {
        if (rate >= 1000) score += 18;
        else if (rate >= 500) score += 12;
        else if (rate >= 250) score += 7;
        else if (rate >= 150) score += 3;
        else if (rate > 0) score -= 2;
        else score -= 8;
      }
      if (history.avgFundraiser >= 1000) score += 9;
      else if (history.avgFundraiser >= 600) score += 5;
      else if (history.avgFundraiser >= 300) score += 2;
      if (history.total >= 5000) score += 4;

      if (Number.isFinite(history.restDays)) {
        if (history.restDays >= 730) score += 8;
        else if (history.restDays >= 365) score += 6;
        else if (history.restDays >= 180) score += 2;
        else if (history.restDays < 90) score -= 10;
        else if (history.restDays < 180) score -= 5;
      }
      if (history.airings >= 12) score -= 8;
      else if (history.airings >= 8) score -= 5;
      else if (history.airings >= 5) score -= 2;
      else if (history.airings <= 2) score += 3;
    }

    if (season.matchesTarget) { score += 10; badges.push('Seasonal fit'); }
    else if (season.tag) badges.push(season.tag);
    if (local) { score += 8; badges.push('Local / U.P.'); }
    if (drama.currentCycle) { score += 8; badges.push('Current Drama Doc'); }
    if (drama.olderCycle) { score -= 12; cautions.push('Older Drama Doc cycle'); }
    if (core) { score += 4; badges.push('Core PBS fit'); }
    if (biography.isBiography) { score -= 4; cautions.push('Biography genre gets a small WNMU demotion'); }
    if (rights.retiring && !rights.expired) { score += history.airings ? 4 : 1; badges.push('Rights ending soon'); }
    if (rights.expired) { score -= 40; cautions.push('Rights expired'); }

    if (history.airings >= 8) cautions.push('Heavy lifetime exposure');
    if (Number.isFinite(history.restDays) && history.restDays < 90 && history.airings > 0) cautions.push('Very quick return');
    else if (Number.isFinite(history.restDays) && history.restDays < 180 && history.airings > 0) cautions.push('Short rest');
    if (history.airings > 0 && history.primeAirings < 2) cautions.push('Fewer than two prime-time tests');

    if (history.airings > 0) badges.unshift(restText(history.restDays));
    if (history.airings > 0) badges.splice(1, 0, `${history.primeAirings} prime test${history.primeAirings === 1 ? '' : 's'}`);
    badges.push(history.airings ? `${history.airings} airing${history.airings === 1 ? '' : 's'}` : 'No WNMU history');

    score = Math.max(0, Math.min(100, score));
    const classified = classifyOutlook({ score, history, rights, drama, season, local, core, biography });
    const confidence = history.fundraisers >= 4 || history.airings >= 6 ? 'High'
      : history.fundraisers >= 2 || history.airings >= 3 ? 'Medium'
        : 'Low';

    return { score, ...classified, confidence, history, season, local, biography, drama, core, rights, badges, cautions };
  }

  function detailedAssessment(program = {}, driveResults = [], exactAirings = []) {
    const result = baseAssessment(program);
    const airings = Array.isArray(exactAirings) ? exactAirings : [];
    const periods = groupDriveResults(driveResults, exactAirings);
    const totalPledges = airings.reduce((sum, row) => sum + rowPledges(row), 0);
    const totalExactDollars = airings.reduce((sum, row) => sum + rowContribution(row), 0);
    const avgGift = totalPledges > 0 ? totalExactDollars / totalPledges : null;
    const exposure = recentExposure(airings);
    const trend = trajectory(periods);
    const primeRows = airings.filter(isPrimeAiring);
    const history = {
      ...result.history,
      primeAirings: primeRows.length || result.history.primeAirings,
      primeZeroAirings: primeRows.length ? primeRows.filter((row) => rowContribution(row) <= 0).length : result.history.primeZeroAirings
    };
    let score = result.score;
    const cautions = [...result.cautions].filter((item) => !/^Fewer than two prime-time tests$/i.test(item));
    const badges = [...result.badges];

    if (totalPledges >= 15) score += 8;
    else if (totalPledges >= 8) score += 5;
    else if (totalPledges >= 4) score += 2;
    else if (totalPledges > 0 && totalExactDollars >= 800) cautions.push('Strong dollars from a thin pledge base');

    if (trend.tone === 'good') score += 5;
    if (trend.tone === 'warn') score -= 6;
    if (exposure.sixMonths >= 3) { score -= 8; cautions.push(`${exposure.sixMonths} airings in the last 6 months`); }
    else if (exposure.sixMonths === 2) { score -= 4; cautions.push('Two airings in the last 6 months'); }
    if (history.airings > 0 && history.primeAirings < 2) cautions.push('Fewer than two prime-time tests');

    score = Math.max(0, Math.min(100, score));
    const classified = classifyOutlook({
      score,
      history,
      rights: result.rights,
      drama: result.drama,
      season: result.season,
      local: result.local,
      core: result.core,
      biography: result.biography,
      trend,
      exposure
    });

    const confidence = periods.length >= 4 && totalPledges >= 10 ? 'High'
      : periods.length >= 2 || totalPledges >= 5 || airings.length >= 3 ? 'Medium'
        : 'Low';

    return {
      ...result,
      history,
      score,
      ...classified,
      confidence,
      totalPledges,
      totalExactDollars,
      avgGift,
      exposure,
      periods,
      trend,
      badges,
      cautions: [...new Set(cautions)]
    };
  }

  function listCellHtml(program = {}) {
    const result = baseAssessment(program);
    const badges = result.badges.slice(0, 3);
    const tooltipBits = [
      `${result.outlook} (${result.confidence} confidence)`,
      ...result.badges,
      ...result.cautions
    ];
    return `
      <div class="scorecard-list scorecard-tone-${utils.escapeHtml(result.tone)}" title="${utils.escapeHtml(tooltipBits.join(' · '))}">
        <div class="scorecard-list-outlook">${utils.escapeHtml(result.outlook)}</div>
        <div class="scorecard-list-badges">${badges.map((badge) => `<span>${utils.escapeHtml(badge)}</span>`).join('')}</div>
      </div>`;
  }

  function metricCard(label, value, note = '') {
    return `<div class="scorecard-metric"><div class="scorecard-metric-label">${utils.escapeHtml(label)}</div><div class="scorecard-metric-value">${utils.escapeHtml(value)}</div>${note ? `<div class="scorecard-metric-note">${utils.escapeHtml(note)}</div>` : ''}</div>`;
  }

  function detailHtml(program = {}, driveResults = [], exactAirings = []) {
    const result = detailedAssessment(program, driveResults, exactAirings);
    const history = result.history;
    const contextBadges = [];
    if (result.season.matchesTarget) contextBadges.push('Seasonal match for target fundraiser');
    else if (result.season.tag) contextBadges.push(result.season.tag);
    if (result.local) contextBadges.push('Local / U.P. relevance');
    if (result.drama.currentCycle) contextBadges.push('Current-cycle Drama Doc');
    if (result.drama.olderCycle) contextBadges.push('Older Drama Doc cycle');
    if (result.core) contextBadges.push('Core PBS compatibility');
    if (result.biography.isBiography) contextBadges.push('Biography slight demotion');
    if (derive.premiumSummary(program)) contextBadges.push('Premium information present');

    const pledgeNote = result.totalPledges > 0
      ? `${utils.formatCount(result.totalPledges)} pledges in exact airing history${result.avgGift != null ? ` · ${utils.formatMoney(result.avgGift)} average dollars per pledge` : ''}`
      : 'No pledge-count history available for this title.';

    const restNote = history.airings > 0
      ? `${restText(history.restDays)} since the latest known airing · ${history.airings} lifetime airing${history.airings === 1 ? '' : 's'}${result.exposure.twelveMonths ? ` · ${result.exposure.twelveMonths} in the last 12 months` : ''}`
      : 'Unaired at WNMU.';

    const primeNote = history.airings > 0
      ? `${history.primeAirings} prime-time airing${history.primeAirings === 1 ? '' : 's'} identified from exact airing times.${history.primeAirings < 2 ? ' Do not retire an otherwise plausible title from one prime result.' : ''}`
      : 'No prime-time test yet.';

    const visibleCautions = result.cautions.filter((item) => !/rights/i.test(item));
    const cautions = visibleCautions.length
      ? `<div class="scorecard-cautions"><strong>Watch:</strong> ${visibleCautions.map((item) => `<span>${utils.escapeHtml(item)}</span>`).join('')}</div>`
      : '<div class="scorecard-cautions scorecard-cautions-clear"><strong>Watch:</strong> No major automated caution flags.</div>';

    return `
      <div class="program-scorecard-head scorecard-tone-${utils.escapeHtml(result.tone)}">
        <div>
          <div class="program-scorecard-kicker">Automated programming outlook</div>
          <div class="program-scorecard-title">${utils.escapeHtml(result.outlook)}</div>
          <div class="program-scorecard-confidence">Evidence confidence: ${utils.escapeHtml(result.confidence)}</div>
        </div>
        <div class="program-scorecard-auto">Recalculates from current library and pledge history. Advisory only.</div>
      </div>
      <div class="scorecard-metric-grid">
        ${metricCard('Fundraising history', history.airings ? `${history.airings} airing${history.airings === 1 ? '' : 's'} · ${history.fundraisers || result.periods.length} pledge period${(history.fundraisers || result.periods.length) === 1 ? '' : 's'}` : 'Unaired', history.avgPledgeHour != null ? `${utils.formatMoney(history.avgPledgeHour)} average $ / pledge hour` : 'No reliable pledge-hour rate yet')}
        ${metricCard('Pledge response', result.totalPledges ? `${utils.formatCount(result.totalPledges)} pledges` : 'Not available', pledgeNote)}
        ${metricCard('Rest & exposure', history.airings ? restText(history.restDays) : 'Fresh / unaired', restNote)}
        ${metricCard('Prime-time evidence', history.primeAirings ? `${history.primeAirings} prime test${history.primeAirings === 1 ? '' : 's'}` : 'No prime test', primeNote)}
        ${metricCard('Trajectory', result.trend.label, result.trend.detail)}
        ${metricCard('Context', contextBadges.length ? contextBadges.join(' · ') : 'No special context flag', contextBadges.length ? 'Context can move a title above or below what the raw fundraising history suggests.' : 'No automated seasonal, local, current Drama Doc, biography, or core-PBS flag was detected.')}
      </div>
      ${cautions}`;
  }

  App.programScorecard = {
    baseAssessment,
    detailedAssessment,
    listCellHtml,
    detailHtml,
    isPrimeAiring
  };
})();

(() => {
  'use strict';

  const DAY_MS = 86400000;
  const HOLIDAY_PATTERN = /\b(?:christmas|holiday|holidays|noel|yuletide|nativity)\b/i;
  const LOCAL_WORD_PATTERN = /\b(?:michigan|upper peninsula|yooper|marquette|negaunee|ishpeming|keweenaw|mackinac|lake superior|great lakes|pelkie)\b/i;
  const LOCAL_UP_PATTERN = /(?:^|\W)(?:UP|U\.P\.?)(?=\W|$)/;
  const PROGRAMMER_WEIGHTS = Object.freeze({
    dont_air: -30,
    low_confidence: -14,
    promising: 14,
    must_air: 28
  });
  const PROGRAMMER_LABELS = Object.freeze({
    dont_air: "Don't air",
    low_confidence: 'Low confidence',
    promising: 'Promising',
    must_air: 'Must air'
  });
  const CORE_TOPICS = new Set([
    'drama', 'drama doc', 'documentary', 'history', 'nature', 'science',
    'public affairs', 'news', 'arts', 'arts culture'
  ]);

  function text(value) {
    return String(value ?? '').trim();
  }

  function lookupKey(value) {
    return text(value)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function first(...values) {
    for (const value of values) {
      if (value === 0 || value === false) return value;
      if (value != null && text(value) !== '') return value;
    }
    return null;
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
    const raw = text(value);
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [year, month, day] = raw.split('-').map(Number);
      const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function dateKey(value) {
    const date = parseDate(value);
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function addDays(value, days) {
    const date = parseDate(value);
    if (!date) return null;
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + Number(days || 0));
    return next;
  }

  function daysBetween(earlier, later) {
    const a = parseDate(earlier);
    const b = parseDate(later);
    if (!a || !b) return null;
    return Math.max(0, Math.floor((b.getTime() - a.getTime()) / DAY_MS));
  }

  function scheduleStart(schedule = {}) {
    return text(first(schedule.startDate, schedule.start_date, schedule?.schedule_data?.startDate, schedule?.schedule_data?.start_date, ''));
  }

  function scheduleEnd(schedule = {}) {
    return text(first(schedule.endDate, schedule.end_date, schedule?.schedule_data?.endDate, schedule?.schedule_data?.end_date, scheduleStart(schedule), ''));
  }

  function evidenceCutoff(schedule = {}) {
    return scheduleStart(schedule);
  }

  function airingDate(row = {}) {
    return text(first(row.dateKey, row.air_date, row.drive_date, row.date_key, row.aired_at, row.drive_start_date, ''));
  }

  function filterEvidenceAirings(rows = [], cutoffValue = '') {
    const cutoff = parseDate(cutoffValue);
    if (!cutoff) return [];
    return (rows || []).filter((row) => {
      const when = parseDate(airingDate(row));
      return Boolean(when && when < cutoff);
    });
  }

  function seasonForDate(value) {
    const date = parseDate(value);
    if (!date) return 'Special';
    const month = date.getMonth();
    if (month === 0 || month >= 9) return 'December';
    if (month <= 3) return 'March';
    if (month <= 5) return 'June';
    if (month <= 8) return 'August';
    return 'December';
  }

  function programId(program = {}) {
    return text(first(program.id, program.program_id, program.pledge_program_id, ''));
  }

  function programTitle(program = {}) {
    return text(first(program.title, program.program_title, program.name, program.matched_library_title, 'Untitled program'));
  }

  function programTopic(program = {}) {
    return text(first(program.__resolved_topic_primary, program.topic_primary, program.topic, program.primary_topic, 'Uncategorized'));
  }

  function programSecondary(program = {}) {
    return text(first(program.__resolved_topic_secondary, program.topic_secondary, program.secondary, program.secondary_topic, ''));
  }

  function programDescription(program = {}) {
    return text(first(program.description, program.program_description, program.program_notes, program.notes, program.rights_notes, ''));
  }

  function programDistributor(program = {}) {
    return text(first(program.__resolved_distributor, program.distributor, program.supplier, ''));
  }

  function rightsStart(program = {}) {
    return text(first(program.rights_start, program.rights_begin, program.rights_start_date, ''));
  }

  function rightsEnd(program = {}) {
    return text(first(program.rights_end, program.rights_end_date, ''));
  }

  function programRuntimeMinutes(program = {}) {
    const seconds = number(first(program.actual_runtime_seconds, program.runtime_seconds, program.actual_runtime), 0);
    if (seconds > 0) return seconds / 60;
    const minutes = number(first(program.actual_runtime_minutes, program.runtime_minutes, program.length_minutes, program.length_bucket_minutes), 0);
    return minutes > 0 ? minutes : null;
  }

  function premiumSummary(program = {}) {
    return text(first(program.premium_summary, program.premiums, program.premium, ''));
  }

  function programText(program = {}) {
    return [programTitle(program), programDescription(program), programTopic(program), programSecondary(program)]
      .filter(Boolean)
      .join(' ');
  }

  function isLocal(program = {}) {
    const value = programText(program);
    return LOCAL_WORD_PATTERN.test(value) || LOCAL_UP_PATTERN.test(value);
  }

  function isHoliday(program = {}) {
    return HOLIDAY_PATTERN.test(programText(program));
  }

  function isBiography(program = {}) {
    const primary = lookupKey(programTopic(program));
    const secondary = lookupKey(programSecondary(program));
    return primary.includes('biograph') || secondary.includes('biograph');
  }

  function isCorePbs(program = {}) {
    const topic = lookupKey(programTopic(program));
    const distributor = lookupKey(programDistributor(program));
    if (CORE_TOPICS.has(topic)) return true;
    return distributor === 'pbs' && /^(?:drama|documentary|history|nature|science|public affairs|news)/.test(topic);
  }

  function dramaInfo(program = {}, schedule = {}) {
    const isDramaDoc = lookupKey(programTopic(program)) === 'drama doc';
    if (!isDramaDoc) return { isDramaDoc: false, currentCycle: false, olderCycle: false, cycleUnknown: false };
    const target = parseDate(scheduleStart(schedule));
    const began = parseDate(rightsStart(program));
    if (!target || !began) return { isDramaDoc: true, currentCycle: false, olderCycle: false, cycleUnknown: true };
    const cycleFloor = addDays(target, -365);
    const currentCycle = began >= cycleFloor && began <= addDays(target, 31);
    return { isDramaDoc: true, currentCycle, olderCycle: !currentCycle, cycleUnknown: false, rightsBegin: began };
  }

  function titleEligibleForDate(program = {}, slotDate) {
    const date = parseDate(slotDate);
    if (!date) return false;
    const begin = parseDate(rightsStart(program));
    const end = parseDate(rightsEnd(program));
    if (begin && date < begin) return false;
    if (end && date > end) return false;
    return true;
  }

  function eligibleSomewhereInFundraiser(program = {}, schedule = {}) {
    const start = parseDate(scheduleStart(schedule));
    const end = parseDate(scheduleEnd(schedule));
    if (!start || !end) return false;
    const begin = parseDate(rightsStart(program));
    const rightsFinish = parseDate(rightsEnd(program));
    if (rightsFinish && rightsFinish < start) return false;
    if (begin && begin > end) return false;
    return true;
  }

  function normalizeRating(value) {
    const rating = text(value).toLowerCase();
    if (rating === 'high') return 'must_air';
    if (rating === 'medium') return 'promising';
    if (rating === 'low') return 'low_confidence';
    return Object.prototype.hasOwnProperty.call(PROGRAMMER_WEIGHTS, rating) ? rating : '';
  }

  function overrideIndex(overrides = []) {
    const index = new Map();
    (overrides || []).forEach((row) => {
      const id = text(first(row.program_id, row.id, ''));
      const rating = normalizeRating(row.rating);
      if (id && rating) index.set(id, { ...row, program_id: id, rating });
    });
    return index;
  }

  function rowProgramId(row = {}) {
    return text(first(row.programId, row.program_id, row.pledge_program_id, row.manual_match_program_id, ''));
  }

  function rowTitle(row = {}) {
    return text(first(row.title, row.plannedTitle, row.program_title, row.matched_library_title, row.imported_program_title, ''));
  }

  function rowTopic(row = {}) {
    return text(first(row.topic, row.topic_primary, row.__resolved_topic_primary, 'Uncategorized'));
  }

  function rowMinutes(row = {}, program = null) {
    const direct = number(first(row.minutes, row.program_minutes, row.lengthMinutes, row.length_minutes), 0);
    if (direct > 0) return direct;
    return program ? programRuntimeMinutes(program) : null;
  }

  function rowDollars(row = {}) {
    return number(first(row.dollars, row.contribution_amount, row.broadcast_dollars, row.total_dollars, row.total_contributions), 0);
  }

  function rowRate(row = {}, program = null) {
    const minutes = rowMinutes(row, program);
    return minutes > 0 ? rowDollars(row) * 60 / minutes : null;
  }

  function rowStartMinutes(row = {}) {
    const direct = Number(first(row.startMinutes, row.start_minutes, row.air_start_minutes));
    if (Number.isFinite(direct)) return ((direct % 1440) + 1440) % 1440;
    const raw = text(first(row.air_time, row.start_time, ''));
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
  }

  function rowWeekpart(row = {}) {
    const date = parseDate(airingDate(row));
    if (!date) return 'Unknown';
    if (date.getDay() === 6) return 'Saturday';
    if (date.getDay() === 0) return 'Sunday';
    return 'Weekday';
  }

  function daypartForMinutes(minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value)) return 'Unknown';
    const normalized = ((value % 1440) + 1440) % 1440;
    if (normalized >= 19 * 60 && normalized < 23 * 60) return 'Prime';
    if (normalized >= 17 * 60 && normalized < 19 * 60) return 'Early evening';
    if (normalized >= 12 * 60 && normalized < 17 * 60) return 'Afternoon';
    if (normalized >= 7 * 60 && normalized < 12 * 60) return 'Morning';
    return 'Overnight';
  }

  function median(values = []) {
    const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function mean(values = []) {
    const clean = values.map(Number).filter(Number.isFinite);
    return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
  }

  function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function dateRange(schedule = {}) {
    const start = parseDate(scheduleStart(schedule));
    const end = parseDate(scheduleEnd(schedule));
    if (!start || !end || end < start) return [];
    const days = [];
    for (let current = new Date(start.getTime()); current <= end; current = addDays(current, 1)) days.push(current);
    return days;
  }

  function planningWindows(schedule = {}) {
    const windows = [];
    const experimentalDates = new Set();
    dateRange(schedule).forEach((date) => {
      const day = date.getDay();
      const base = {
        date: dateKey(date),
        weekday: date.toLocaleDateString('en-US', { weekday: 'long' }),
        weekpart: day === 6 ? 'Saturday' : day === 0 ? 'Sunday' : 'Weekday'
      };
      if (day === 6 && experimentalDates.size < 2) {
        windows.push({ ...base, id: `${base.date}-1500`, label: 'Late afternoon', startMinutes: 15 * 60, endMinutes: 17 * 60, confidenceClass: 'experimental', experimental: true });
        experimentalDates.add(base.date);
      }
      windows.push({ ...base, id: `${base.date}-1700`, label: 'Early evening', startMinutes: 17 * 60, endMinutes: 19 * 60, confidenceClass: 'normal', experimental: false, blocked: false });
      if (day === 5) {
        windows.push({ ...base, id: `${base.date}-1900`, label: 'Prime', startMinutes: 19 * 60, endMinutes: 20 * 60, confidenceClass: 'normal', experimental: false, blocked: false });
        windows.push({ ...base, id: `${base.date}-2000-protected`, label: 'Protected regular programming', startMinutes: 20 * 60, endMinutes: 21 * 60, confidenceClass: 'blocked', experimental: false, blocked: true });
        windows.push({ ...base, id: `${base.date}-2100`, label: 'Prime', startMinutes: 21 * 60, endMinutes: 22 * 60 + 30, confidenceClass: 'normal', experimental: false, blocked: false });
      } else {
        windows.push({ ...base, id: `${base.date}-1900`, label: 'Prime', startMinutes: 19 * 60, endMinutes: day === 0 ? 22 * 60 : 22 * 60 + 30, confidenceClass: 'normal', experimental: false, blocked: false });
      }
    });
    return windows;
  }

  function programMatchesRow(program = {}, row = {}) {
    const id = programId(program);
    const rowId = rowProgramId(row);
    if (id && rowId && id === rowId) return true;
    const title = lookupKey(programTitle(program));
    return Boolean(title && title === lookupKey(rowTitle(row)));
  }

  function rowsForProgram(program = {}, evidenceRows = []) {
    return (evidenceRows || []).filter((row) => programMatchesRow(program, row));
  }

  function fundraiserCount(rows = []) {
    return new Set(rows.map((row) => text(first(row.fundraiserId, row.fundraiser_id, row.fundraiserTitle, row.fundraiser_label, airingDate(row)))).filter(Boolean)).size;
  }

  function rowSummary(rows = [], program = null) {
    const rates = rows.map((row) => rowRate(row, program)).filter(Number.isFinite);
    const dates = rows.map((row) => parseDate(airingDate(row))).filter(Boolean).sort((a, b) => a - b);
    return {
      rows: rows.length,
      fundraisers: fundraiserCount(rows),
      rates,
      medianRate: median(rates),
      averageRate: mean(rates),
      totalDollars: rows.reduce((sum, row) => sum + rowDollars(row), 0),
      latest: dates.length ? dates[dates.length - 1] : null,
      earliest: dates.length ? dates[0] : null
    };
  }

  function comparableRows(rows = [], slot = {}, { topic = '', exactWeekday = false } = {}) {
    const targetTopic = lookupKey(topic);
    const targetDate = parseDate(slot.date);
    const targetWeekday = targetDate?.getDay();
    const targetPart = slot.weekpart || (targetWeekday === 6 ? 'Saturday' : targetWeekday === 0 ? 'Sunday' : 'Weekday');
    const targetDaypart = daypartForMinutes(slot.startMinutes);
    return (rows || []).filter((row) => {
      if (targetTopic && lookupKey(rowTopic(row)) !== targetTopic) return false;
      const start = rowStartMinutes(row);
      const date = parseDate(airingDate(row));
      if (!date || !Number.isFinite(start)) return false;
      if (exactWeekday && date.getDay() !== targetWeekday) return false;
      if (!exactWeekday && rowWeekpart(row) !== targetPart) return false;
      return Math.abs(start - slot.startMinutes) <= 90 || daypartForMinutes(start) === targetDaypart;
    });
  }

  function rateAdjustment(rate) {
    if (!Number.isFinite(rate)) return 0;
    if (rate >= 1000) return 18;
    if (rate >= 500) return 12;
    if (rate >= 250) return 7;
    if (rate >= 150) return 3;
    if (rate > 0) return -2;
    return -8;
  }

  function topicWindowAdjustment(summary, baselineRate) {
    if (!summary || summary.rates.length < 3 || !Number.isFinite(summary.medianRate)) return 0;
    if (!Number.isFinite(baselineRate) || baselineRate <= 0) {
      if (summary.medianRate >= 500) return 6;
      if (summary.medianRate < 150) return -4;
      return 0;
    }
    const ratio = summary.medianRate / baselineRate;
    if (ratio >= 1.35) return 8;
    if (ratio >= 1.1) return 4;
    if (ratio <= 0.65) return -8;
    if (ratio <= 0.85) return -4;
    return 0;
  }

  function seasonEvidence(program = {}, historyRows = [], schedule = {}) {
    const targetSeason = seasonForDate(scheduleStart(schedule));
    const same = historyRows.filter((row) => seasonForDate(airingDate(row)) === targetSeason);
    const other = historyRows.filter((row) => seasonForDate(airingDate(row)) !== targetSeason);
    const sameSummary = rowSummary(same, program);
    const otherSummary = rowSummary(other, program);
    let adjustment = 0;
    const notes = [];
    if (sameSummary.rates.length >= 2 && otherSummary.rates.length >= 2 && Number.isFinite(otherSummary.medianRate) && otherSummary.medianRate > 0) {
      const ratio = sameSummary.medianRate / otherSummary.medianRate;
      if (ratio >= 1.35) adjustment += 6;
      else if (ratio <= 0.65) adjustment -= 6;
      notes.push(`${targetSeason} title history: ${sameSummary.rates.length} rate-valid airings, median ${Math.round(sameSummary.medianRate)}/hr.`);
    } else if (sameSummary.rates.length >= 2) {
      if (sameSummary.medianRate >= 600) adjustment += 4;
      else if (sameSummary.medianRate === 0) adjustment -= 5;
      else if (sameSummary.medianRate < 150) adjustment -= 3;
      notes.push(`${targetSeason} title history: ${sameSummary.rates.length} rate-valid airings.`);
    } else if (sameSummary.rates.length === 1) {
      if (sameSummary.medianRate >= 500) adjustment += 2;
      notes.push(`Only one ${targetSeason} title airing is available; it is not used as negative evidence by itself.`);
    }
    const holiday = isHoliday(program);
    if (holiday) {
      const explicit = targetSeason === 'December' ? 14 : -18;
      adjustment += explicit;
      notes.push(targetSeason === 'December' ? 'Christmas / holiday fit for December.' : `Christmas / holiday title is out of season for ${targetSeason}.`);
    }
    return { targetSeason, holiday, same: sameSummary, other: otherSummary, adjustment, notes };
  }

  function weakPrimeTestsSinceRating(program = {}, historyRows = [], override = null) {
    if (!override || normalizeRating(override.rating) !== 'must_air') return 0;
    const ratedAt = parseDate(first(override.rated_at, override.updated_at, ''));
    if (!ratedAt) return 0;
    return historyRows.filter((row) => {
      const when = parseDate(airingDate(row));
      const start = rowStartMinutes(row);
      const rate = rowRate(row, program);
      if (!when || when <= ratedAt || !Number.isFinite(start) || start < 19 * 60 || start >= 23 * 60) return false;
      return rowDollars(row) <= 0 || (Number.isFinite(rate) && rate < 150);
    }).length;
  }

  function programmerEvidence(program = {}, historyRows = [], override = null) {
    const rating = normalizeRating(override?.rating);
    if (!rating) return { rating: '', label: 'Neutral', adjustment: 0, weakCount: 0, activeProtection: false };
    const weakCount = weakPrimeTestsSinceRating(program, historyRows, override);
    let adjustment = PROGRAMMER_WEIGHTS[rating] || 0;
    const activeProtection = rating === 'must_air' && weakCount < 2;
    if (rating === 'must_air' && weakCount >= 2) adjustment = 8;
    return { rating, label: PROGRAMMER_LABELS[rating], adjustment, weakCount, activeProtection };
  }

  function baseHistoricalRate(evidenceRows = []) {
    return median((evidenceRows || []).map((row) => rowRate(row)).filter(Number.isFinite));
  }

  function scoreProgramForSlot(program = {}, slot = {}, context = {}) {
    const schedule = context.schedule || {};
    if (!titleEligibleForDate(program, slot.date)) return null;
    const evidenceRows = context.evidenceRows || [];
    const titleRows = rowsForProgram(program, evidenceRows);
    const titleHistory = rowSummary(titleRows, program);
    const exactComparable = comparableRows(titleRows, slot, { exactWeekday: true });
    const broadComparable = exactComparable.length ? exactComparable : comparableRows(titleRows, slot, { exactWeekday: false });
    const comparableHistory = rowSummary(broadComparable, program);
    const topic = programTopic(program);
    const exactTopicRows = comparableRows(evidenceRows, slot, { topic, exactWeekday: true });
    const topicRows = exactTopicRows.length >= 3 ? exactTopicRows : comparableRows(evidenceRows, slot, { topic, exactWeekday: false });
    const topicHistory = rowSummary(topicRows);
    const season = seasonEvidence(program, titleRows, schedule);
    const drama = dramaInfo(program, schedule);
    const override = context.overrideByProgramId?.get(programId(program)) || null;
    const programmer = programmerEvidence(program, titleRows, override);
    const baselineRate = Number.isFinite(context.baselineRate) ? context.baselineRate : baseHistoricalRate(evidenceRows);
    let score = 50;
    const reasons = [];
    const cautions = [];
    const adjustments = [];

    if (titleHistory.rows) {
      const adjustment = rateAdjustment(titleHistory.medianRate);
      score += adjustment;
      adjustments.push(['titleHistory', adjustment]);
      reasons.push(`WNMU title history: ${titleHistory.rows} airing${titleHistory.rows === 1 ? '' : 's'}${Number.isFinite(titleHistory.medianRate) ? `, median $${Math.round(titleHistory.medianRate)}/hr` : ''}.`);
    } else {
      reasons.push('No prior WNMU title airing before the evidence cutoff.');
    }

    if (comparableHistory.rates.length) {
      const adjustment = Math.max(-8, Math.min(10, Math.round(rateAdjustment(comparableHistory.medianRate) * 0.6)));
      score += adjustment;
      adjustments.push(['comparableTitleSlot', adjustment]);
      reasons.push(`${comparableHistory.rates.length} comparable title airing${comparableHistory.rates.length === 1 ? '' : 's'} near this day/time.`);
    }

    const topicAdjustment = topicWindowAdjustment(topicHistory, baselineRate);
    score += topicAdjustment;
    adjustments.push(['topicWindow', topicAdjustment]);
    if (topicHistory.rates.length) reasons.push(`${topic} has ${topicHistory.rates.length} comparable rate-valid airing${topicHistory.rates.length === 1 ? '' : 's'} in this window${Number.isFinite(topicHistory.medianRate) ? `, median $${Math.round(topicHistory.medianRate)}/hr` : ''}.`);

    if (titleHistory.latest) {
      const restDays = daysBetween(titleHistory.latest, scheduleStart(schedule));
      let restAdjustment = 0;
      if (restDays >= 730) restAdjustment = 8;
      else if (restDays >= 365) restAdjustment = 6;
      else if (restDays >= 180) restAdjustment = 2;
      else if (restDays < 90) restAdjustment = -10;
      else if (restDays < 180) restAdjustment = -5;
      score += restAdjustment;
      adjustments.push(['rest', restAdjustment]);
      if (restAdjustment > 0) reasons.push(`Rested ${restDays} days since the latest known airing.`);
      if (restAdjustment < 0) cautions.push(`Short rest: ${restDays} days since the latest known airing.`);
    }

    let fatigueAdjustment = 0;
    if (titleHistory.rows >= 12) fatigueAdjustment = -8;
    else if (titleHistory.rows >= 8) fatigueAdjustment = -5;
    else if (titleHistory.rows >= 5) fatigueAdjustment = -2;
    else if (titleHistory.rows > 0 && titleHistory.rows <= 2) fatigueAdjustment = 3;
    score += fatigueAdjustment;
    adjustments.push(['lifetimeExposure', fatigueAdjustment]);
    if (titleHistory.rows >= 8) cautions.push(`Heavy lifetime exposure: ${titleHistory.rows} known airings.`);

    score += season.adjustment;
    adjustments.push(['season', season.adjustment]);
    reasons.push(...season.notes);

    const local = isLocal(program);
    if (local) {
      score += 8;
      adjustments.push(['local', 8]);
      reasons.push('Local / U.P. relevance.');
    }

    if (drama.currentCycle) {
      score += 8;
      adjustments.push(['dramaDoc', 8]);
      reasons.push('Current-cycle Drama Doc proxy based on rights-start timing.');
    } else if (drama.olderCycle) {
      score -= 12;
      adjustments.push(['dramaDoc', -12]);
      cautions.push('Older Drama Doc cycle receives a real priority penalty unless stronger evidence overcomes it.');
    } else if (drama.cycleUnknown) {
      cautions.push('Drama Doc cycle is unknown because rights-start timing is unavailable.');
    }

    if (isBiography(program)) {
      score -= 4;
      adjustments.push(['biography', -4]);
      cautions.push('Biography receives the existing small genre demotion.');
    }

    if (isCorePbs(program)) {
      score += 4;
      adjustments.push(['corePbs', 4]);
    }

    score += programmer.adjustment;
    adjustments.push(['programmer', programmer.adjustment]);
    if (programmer.rating) {
      reasons.push(`Programmer rating: ${programmer.label} (${programmer.adjustment >= 0 ? '+' : ''}${programmer.adjustment}).`);
      if (programmer.rating === 'must_air' && programmer.weakCount >= 2) cautions.push('Must air has two weak prime tests after the rating; its boost is reduced.');
      if (programmer.rating === 'dont_air') cautions.push("Programmer rating says Don't air; this is a strong negative input, not a hard rights-style exclusion.");
    }

    const end = parseDate(rightsEnd(program));
    const slotDate = parseDate(slot.date);
    if (end && slotDate) {
      const remaining = daysBetween(slotDate, end);
      if (remaining != null && remaining <= 90) {
        const urgency = titleHistory.rows ? 3 : 1;
        score += urgency;
        adjustments.push(['rightsUrgency', urgency]);
        reasons.push(`Rights end ${remaining} day${remaining === 1 ? '' : 's'} after this slot; small supporting urgency only.`);
      }
    }

    score = clamp(score);
    const evidenceCount = titleHistory.rates.length + topicHistory.rates.length;
    let confidence = 'Low';
    if (titleHistory.fundraisers >= 3 && titleHistory.rates.length >= 5) confidence = 'High';
    else if (titleHistory.rates.length >= 2 || topicHistory.rates.length >= 4) confidence = 'Medium';
    if (programmer.activeProtection && confidence === 'Low') confidence = 'Editorial';

    let fit = 'Situational';
    if (score >= 78) fit = 'Strong fit';
    else if (score >= 65) fit = 'Good candidate';
    else if (score >= 56) fit = 'Supported option';
    else if (score < 40) fit = 'Rest / caution';
    else if (score < 48) fit = 'Mixed evidence';
    if (season.holiday && season.targetSeason !== 'December' && programmer.rating !== 'must_air') fit = 'Save for December';

    return {
      program,
      programId: programId(program),
      title: programTitle(program),
      topic,
      secondary: programSecondary(program),
      score,
      fit,
      confidence,
      reasons: [...new Set(reasons.filter(Boolean))],
      cautions: [...new Set(cautions.filter(Boolean))],
      adjustments,
      titleHistory,
      comparableHistory,
      topicHistory,
      season,
      local,
      drama,
      programmer,
      premiumPresent: Boolean(premiumSummary(program)),
      rights: { start: rightsStart(program), end: rightsEnd(program) },
      evidenceCount
    };
  }

  function rankProgramsForSlot(library = [], slot = {}, context = {}) {
    return (library || [])
      .map((program) => scoreProgramForSlot(program, slot, context))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || b.evidenceCount - a.evidenceCount || a.title.localeCompare(b.title));
  }

  function topicChoicesForSlot(ranked = []) {
    const seen = new Set();
    const choices = [];
    ranked.forEach((item) => {
      const key = lookupKey(item.topic);
      if (!key || seen.has(key)) return;
      seen.add(key);
      choices.push({ topic: item.topic, score: item.score, title: item.title, confidence: item.confidence });
    });
    return choices;
  }

  function mixFromSlots(slots = []) {
    const points = new Map();
    slots.filter((slot) => !slot.experimental && !slot.blocked).forEach((slot) => {
      (slot.recommendations || []).slice(0, 3).forEach((item, index) => {
        const key = lookupKey(item.topic);
        if (!key) return;
        const current = points.get(key) || { topic: item.topic, points: 0, appearances: 0, scores: [] };
        current.points += 3 - index;
        current.appearances += 1;
        current.scores.push(item.score);
        points.set(key, current);
      });
    });
    const list = [...points.values()].map((item) => ({ ...item, averageScore: mean(item.scores) || 0 }));
    const total = list.reduce((sum, item) => sum + item.points, 0);
    return list.sort((a, b) => b.points - a.points || b.averageScore - a.averageScore || a.topic.localeCompare(b.topic)).map((item, index) => {
      let strength = 'Situational';
      if (index <= 1 || item.averageScore >= 72) strength = 'Stronger';
      else if (item.averageScore >= 60 || item.appearances >= 3) strength = 'Moderate';
      const share = total > 0 && slots.filter((slot) => !slot.experimental && !slot.blocked).length >= 6 ? Math.round((item.points / total) * 20) * 5 : null;
      return { ...item, strength, approximateShare: share };
    });
  }

  function repeatCandidates(slots = []) {
    const byProgram = new Map();
    slots.filter((slot) => !slot.experimental && !slot.blocked && slot.label === 'Prime').forEach((slot) => {
      (slot.recommendations || []).slice(0, 4).forEach((item) => {
        if (!item.programId) return;
        const current = byProgram.get(item.programId) || { ...item, slots: [] };
        current.slots.push(slot);
        byProgram.set(item.programId, current);
      });
    });
    return [...byProgram.values()].filter((item) => {
      if (item.slots.length < 2 || item.score < 60) return false;
      const dates = item.slots.map((slot) => parseDate(slot.date)).filter(Boolean).sort((a, b) => a - b);
      return dates.length >= 2 && daysBetween(dates[0], dates[dates.length - 1]) >= 3;
    }).sort((a, b) => b.score - a.score).slice(0, 8);
  }

  function rightsConstraints(library = [], schedule = {}) {
    const start = parseDate(scheduleStart(schedule));
    const end = parseDate(scheduleEnd(schedule));
    if (!start || !end) return { unavailable: [], partial: [] };
    const unavailable = [];
    const partial = [];
    (library || []).forEach((program) => {
      const begin = parseDate(rightsStart(program));
      const finish = parseDate(rightsEnd(program));
      if ((finish && finish < start) || (begin && begin > end)) {
        unavailable.push({ title: programTitle(program), programId: programId(program), rightsStart: rightsStart(program), rightsEnd: rightsEnd(program) });
      } else if ((begin && begin > start) || (finish && finish < end)) {
        partial.push({ title: programTitle(program), programId: programId(program), rightsStart: rightsStart(program), rightsEnd: rightsEnd(program) });
      }
    });
    return { unavailable, partial };
  }

  function buildStrategy({ schedule = {}, library = [], evidenceRows = [], overrides = [] } = {}) {
    const cutoff = evidenceCutoff(schedule);
    const historicalRows = filterEvidenceAirings(evidenceRows, cutoff);
    const overrideByProgramId = overrideIndex(overrides);
    const baselineRate = baseHistoricalRate(historicalRows);
    const context = { schedule, evidenceRows: historicalRows, overrideByProgramId, baselineRate };
    const windows = planningWindows(schedule).map((slot) => {
      if (slot.blocked) {
        return { ...slot, recommendations: [], strongestTopics: [], alternativeTopics: [], evidenceRows: 0 };
      }
      const ranked = rankProgramsForSlot(library, slot, context);
      const topics = topicChoicesForSlot(ranked);
      return {
        ...slot,
        recommendations: ranked.slice(0, 5),
        strongestTopics: topics.slice(0, 3),
        alternativeTopics: topics.slice(3, 6),
        evidenceRows: comparableRows(historicalRows, slot).length
      };
    });
    const mix = mixFromSlots(windows);
    const repeats = repeatCandidates(windows);
    const rights = rightsConstraints(library, schedule);
    const viable = (library || []).filter((program) => eligibleSomewhereInFundraiser(program, schedule));
    const seasonal = viable.map((program) => {
      const history = rowsForProgram(program, historicalRows);
      const season = seasonEvidence(program, history, schedule);
      return { program, title: programTitle(program), programId: programId(program), topic: programTopic(program), season };
    }).filter((item) => item.season.adjustment > 0).sort((a, b) => b.season.adjustment - a.season.adjustment || a.title.localeCompare(b.title)).slice(0, 10);
    const local = viable.filter(isLocal).map((program) => {
      const slots = windows.filter((slot) => !slot.experimental && !slot.blocked).map((slot) => scoreProgramForSlot(program, slot, context)).filter(Boolean);
      const best = slots.sort((a, b) => b.score - a.score)[0] || null;
      return best;
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 10);
    const avoid = viable.map((program) => {
      const titleRows = rowsForProgram(program, historicalRows);
      const history = rowSummary(titleRows, program);
      const override = overrideByProgramId.get(programId(program)) || null;
      const rating = normalizeRating(override?.rating);
      const drama = dramaInfo(program, schedule);
      const season = seasonEvidence(program, titleRows, schedule);
      const restDays = history.latest ? daysBetween(history.latest, cutoff) : null;
      const reasons = [];
      if (rating === 'dont_air') reasons.push("Programmer rating: Don't air");
      if (history.rows >= 8) reasons.push(`Heavy lifetime exposure (${history.rows} airings)`);
      if (restDays != null && restDays < 90) reasons.push(`Very quick return (${restDays} days)`);
      else if (restDays != null && restDays < 180) reasons.push(`Short rest (${restDays} days)`);
      if (drama.olderCycle) reasons.push('Older Drama Doc cycle');
      if (season.holiday && season.targetSeason !== 'December') reasons.push('Holiday title out of season');
      return reasons.length ? { program, title: programTitle(program), programId: programId(program), topic: programTopic(program), reasons, history, rating, drama, season } : null;
    }).filter(Boolean).sort((a, b) => b.reasons.length - a.reasons.length || b.history.rows - a.history.rows || a.title.localeCompare(b.title)).slice(0, 15);

    return {
      schedule,
      cutoff,
      evidenceRows: historicalRows.length,
      evidenceFundraisers: fundraiserCount(historicalRows),
      libraryTitles: library.length,
      eligibleTitles: viable.length,
      baselineRate,
      windows,
      mix,
      repeats,
      seasonal,
      local,
      avoid,
      rights,
      peerEvidence: {
        available: false,
        note: 'Peer-station evidence is not yet structured in the report dataset and is not used in these recommendations.'
      },
      limitations: [
        'Only WNMU evidence dated before the selected fundraiser start is used.',
        'Programmer ratings are weighted inputs, not absolute overrides.',
        'Drama Doc cycle is inferred from rights-start recency because exact related-series cycle metadata is not stored in the report data.',
        'Premium information is shown only as context; premium effectiveness is not scored.',
        'Experimental windows are labeled separately from established planning windows.',
        'Friday 8–9 PM is treated as protected regular programming and is excluded from pledge recommendations.'
      ]
    };
  }

  const api = {
    PROGRAMMER_WEIGHTS,
    PROGRAMMER_LABELS,
    text,
    lookupKey,
    parseDate,
    dateKey,
    scheduleStart,
    scheduleEnd,
    evidenceCutoff,
    filterEvidenceAirings,
    seasonForDate,
    programId,
    programTitle,
    programTopic,
    programSecondary,
    programRuntimeMinutes,
    rightsStart,
    rightsEnd,
    premiumSummary,
    isLocal,
    isHoliday,
    dramaInfo,
    titleEligibleForDate,
    eligibleSomewhereInFundraiser,
    normalizeRating,
    overrideIndex,
    rowRate,
    rowStartMinutes,
    rowWeekpart,
    daypartForMinutes,
    median,
    planningWindows,
    rowsForProgram,
    rowSummary,
    comparableRows,
    seasonEvidence,
    programmerEvidence,
    scoreProgramForSlot,
    rankProgramsForSlot,
    mixFromSlots,
    repeatCandidates,
    rightsConstraints,
    buildStrategy
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.WNMUProgrammingStrategyAnalysis = api;
})();

'use strict';

importScripts('one-sheet-analysis.js?v=0.22.186', 'programming-strategy-analysis.js?v=0.22.186');

const A = self.WNMUOneSheetAnalysis;
const S = self.WNMUProgrammingStrategyAnalysis;
if (!A) throw new Error('Shared historical analysis module did not load in worker.');
if (!S) throw new Error('Programming strategy analysis module did not load in worker.');

const text = (value) => String(value ?? '').trim();
const nolaKey = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const nowMs = () => self.performance?.now?.() ?? Date.now();

function progress(requestId, stage, message) {
  self.postMessage({ type: 'progress', requestId, stage, message });
}

function completedHistoricalAnalyses(scheduleRows = [], canonicalAirings = [], library = [], cutoff = '') {
  const indexes = A.buildLibraryIndexes(library);
  const schedules = A.prepareSchedules((scheduleRows || []).map(A.normalizeSchedule))
    .filter((item) => item?.startDate && item?.endDate && (!cutoff || item.endDate <= cutoff));
  const analyses = schedules
    .map((item) => A.analyzeSchedule(item, canonicalAirings, indexes))
    .filter((analysis) => (analysis?.importedRows || []).length || Number(analysis?.broadcastDollars || 0) > 0);
  return { schedules, analyses, indexes };
}

function strategyEvidenceRowsFromAnalyses(analyses = []) {
  const rows = [];
  for (const analysis of analyses || []) {
    const schedule = analysis?.schedule || {};
    const fundraiserId = text(schedule.id || schedule.title);
    const fundraiserTitle = text(schedule.title);
    for (const row of analysis?.placementRows || []) {
      if (row?.countsTowardScheduleMinutes === false || row?.unmatchedImported || !row?.known) continue;
      const startMinutes = Number(row?.startMinutes);
      const minutes = Number(row?.minutes || 0);
      const durationMissing = Boolean(row?.durationMissing) || !(minutes > 0);
      rows.push({
        programId: text(row.programId || ''),
        title: text(row.title || row.plannedTitle || 'Untitled program'),
        topic: text(row.topic || 'Uncategorized') || 'Uncategorized',
        secondary: S.lookupKey(row.secondary || '') === 'unspecified' ? '' : text(row.secondary || ''),
        dateKey: text(row.dateKey || ''),
        startMinutes: Number.isFinite(startMinutes) ? startMinutes : null,
        endMinutes: Number.isFinite(Number(row.endMinutes))
          ? Number(row.endMinutes)
          : (Number.isFinite(startMinutes) && minutes > 0 ? startMinutes + minutes : null),
        minutes,
        dollars: Number(row.dollars || 0),
        pledges: Number(row.pledges || 0),
        fundraiserId,
        fundraiserTitle,
        driveStartDate: text(schedule.startDate || ''),
        driveEndDate: text(schedule.endDate || ''),
        known: true,
        durationMissing,
        countsTowardScheduleMinutes: true,
        durationSource: text(row.durationSource || '')
      });
    }
  }
  return rows;
}

function seasonAnalysisPool(schedule = {}, analyses = []) {
  const targetSeason = A.seasonForDate(schedule.startDate || schedule.start_date || '');
  const seasonal = (analyses || []).filter((analysis) =>
    text(analysis?.schedule?.season || A.seasonForDate(analysis?.schedule?.startDate || '')) === targetSeason
  );
  return {
    targetSeason: targetSeason || 'Special',
    fallback: seasonal.length < 2,
    analyses: seasonal.length < 2 ? analyses : seasonal
  };
}

function rankingStatsMap(rows = [], { normalizeUnassigned = false } = {}) {
  return new Map((rows || []).map((row) => {
    let key = S.lookupKey(row.key);
    if (normalizeUnassigned && key === 'unspecified') key = 'unassigned';
    return [key, {
      key: row.key,
      historyRows: Number(row.rateAirings || 0),
      fundraiserSamples: Number(row.fundraisers || 0),
      testedTitleCount: Number(row.titles || 0),
      averageRate: Number(row.averageDollarsPerHour),
      medianRate: Number(row.medianDollarsPerHour)
    }];
  }));
}

function buildHistoricalPerformanceStats(schedule = {}, analyses = []) {
  const targetSeason = A.seasonForDate(schedule.startDate || schedule.start_date || '');
  const seasonAnalyses = (analyses || []).filter((analysis) =>
    text(analysis?.schedule?.season || A.seasonForDate(analysis?.schedule?.startDate || '')) === targetSeason
  );
  const minimums = { minAirings: 1, minFundraisers: 1, minTitles: 1 };

  // Performance remains season-specific. Evidence depth is intentionally all-season:
  // repeated testing in March/June/August still tells us whether a topic is genuinely
  // well-tested, even though those other seasons do not set the December performance rate.
  const topic = rankingStatsMap(A.historicalRanking(seasonAnalyses, 'topic', minimums));
  const topicReliability = rankingStatsMap(A.historicalRanking(analyses, 'topic', minimums));
  const subtopicByTopic = new Map();
  const subtopicReliabilityByTopic = new Map();

  for (const topicKey of ['documentary', 'music', 'holiday christmas']) {
    const seasonalFiltered = seasonAnalyses.map((analysis) => ({
      ...analysis,
      placementRows: (analysis?.placementRows || []).filter((row) => S.lookupKey(row?.topic || '') === topicKey)
    }));
    const allSeasonFiltered = (analyses || []).map((analysis) => ({
      ...analysis,
      placementRows: (analysis?.placementRows || []).filter((row) => S.lookupKey(row?.topic || '') === topicKey)
    }));
    subtopicByTopic.set(
      topicKey,
      rankingStatsMap(A.historicalRanking(seasonalFiltered, 'subtopic', minimums), { normalizeUnassigned: true })
    );
    subtopicReliabilityByTopic.set(
      topicKey,
      rankingStatsMap(A.historicalRanking(allSeasonFiltered, 'subtopic', minimums), { normalizeUnassigned: true })
    );
  }

  return {
    targetSeason: targetSeason || 'Special',
    topic,
    topicReliability,
    subtopicByTopic,
    subtopicReliabilityByTopic
  };
}

function firstSaturday(startValue, endValue) {
  const start = S.parseDate(startValue);
  const end = S.parseDate(endValue);
  if (!start) return null;
  const next = new Date(start);
  while (next.getDay() !== 6) next.setDate(next.getDate() + 1);
  if (!end || next <= end) return next;
  const previous = new Date(start);
  while (previous.getDay() !== 6) previous.setDate(previous.getDate() - 1);
  return previous;
}

function ordinalWord(value) {
  return ['','First','Second','Third','Fourth','Fifth'][value] || `${value}th`;
}

function fundraiserDayTitle(schedule = {}, date) {
  const start = S.parseDate(schedule.startDate);
  if (!start || !(date instanceof Date)) {
    return date instanceof Date ? date.toLocaleDateString(undefined, { weekday: 'long' }) : 'Fundraiser day';
  }
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
  let occurrence = 0;
  for (let cursor = new Date(start); cursor <= date; cursor.setDate(cursor.getDate() + 1)) {
    if (cursor.getDay() === date.getDay()) occurrence += 1;
  }
  return `${ordinalWord(Math.max(1, occurrence))} ${weekday}`;
}

function buildDayOutlook(schedule = {}, analyses = []) {
  const pool = seasonAnalysisPool(schedule, analyses);
  const targetAnchor = firstSaturday(schedule.startDate, schedule.endDate);
  const start = S.parseDate(schedule.startDate);
  const end = S.parseDate(schedule.endDate);
  const targetOffsets = [];
  const targetDates = new Map();

  if (start && end && targetAnchor) {
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const key = S.dateKey(date);
      const offset = Math.round((date - targetAnchor) / 86400000);
      targetOffsets.push(offset);
      targetDates.set(offset, { date: key, label: fundraiserDayTitle(schedule, new Date(date)) });
    }
  }
  const targetOffsetSet = new Set(targetOffsets);
  const observations = new Map(targetOffsets.map((offset) => [offset, []]));

  for (const analysis of pool.analyses || []) {
    const allDays = (A.calendarDays(analysis) || [])
      .map((day) => ({
        ...day,
        offset: A.fundraiserDayOffset(analysis, day)
      }))
      .filter((day) =>
        Number(day.rateMinutes || 0) > 0
        && Number.isFinite(Number(day.dollarsPerHour))
      );

    const baseline = Number(analysis?.rateEligibleMinutes || 0) > 0
      ? A.dollarsPerHour(Number(analysis?.rateEligibleDollars || 0), Number(analysis?.rateEligibleMinutes || 0))
      : null;
    if (!(baseline > 0)) continue;

    for (const day of allDays) {
      if (!Number.isFinite(Number(day.offset)) || !targetOffsetSet.has(Number(day.offset))) continue;
      observations.get(Number(day.offset))?.push({
        rate: Number(day.dollarsPerHour),
        index: Number(day.dollarsPerHour) / baseline,
        fundraiserId: text(analysis?.schedule?.id || analysis?.schedule?.title || '')
      });
    }
  }

  const resultRows = targetOffsets.map((offset) => {
    const items = observations.get(offset) || [];
    const rates = items.map((item) => item.rate).filter(Number.isFinite);
    const indexes = items.map((item) => item.index).filter(Number.isFinite);
    const averageRate = S.mean(rates);
    const ratio = S.mean(indexes);
    let outlook = 'No comparable history';
    if (indexes.length === 1) outlook = 'Thin evidence';
    else if (indexes.length >= 2) {
      if (ratio >= 1.30) outlook = 'Usually strong';
      else if (ratio >= 1.15) outlook = 'Usually good';
      else if (ratio >= 0.85) outlook = 'Fair / typical';
      else if (ratio >= 0.70) outlook = 'Usually soft';
      else outlook = 'Usually weak';
    }
    const target = targetDates.get(offset) || {};
    return {
      date: target.date || '',
      label: target.label || 'Fundraiser day',
      offset,
      outlook,
      samples: indexes.length,
      averageRate,
      ratio,
      relativeIndex: ratio
    };
  });

  const ranked = resultRows
    .filter((row) => row.samples >= 2 && Number.isFinite(row.ratio))
    .sort((a, b) => b.ratio - a.ratio);
  const best = new Set(ranked.slice(0, 2).filter((row) => row.ratio >= 1.15).map((row) => row.date));
  resultRows.forEach((row) => { row.bestBet = best.has(row.date); });

  return {
    season: pool.targetSeason,
    fallback: pool.fallback,
    method: 'within-fundraiser-relative-day',
    rows: resultRows
  };
}

function reportableProgrammingRows(rows = []) {
  return (rows || []).filter((row) =>
    Number(row.minutes) > 0
    && Number.isFinite(Number(row.startMinutes))
    && S.lookupKey(row.topic) !== 'uncategorized'
  );
}

function seasonPlanningPool(schedule = {}, rows = []) {
  const targetSeason = S.seasonForDate(schedule.startDate);
  const clean = reportableProgrammingRows(rows);
  const seasonal = clean.filter((row) => S.rowSeason(row) === targetSeason);
  const seasonFundraisers = new Set(seasonal.map((row) => row.fundraiserId).filter(Boolean)).size;
  return {
    targetSeason,
    fallback: seasonFundraisers < 2,
    rows: seasonFundraisers < 2 ? clean : seasonal
  };
}

function summarizeTimeslotRows(rows = []) {
  const byFundraiser = new Map();
  const topicCounts = new Map();
  for (const row of rows) {
    const key = row.fundraiserId || row.dateKey;
    if (!byFundraiser.has(key)) byFundraiser.set(key, { dollars: 0, minutes: 0 });
    const group = byFundraiser.get(key);
    group.dollars += Number(row.dollars || 0);
    group.minutes += Number(row.minutes || 0);
    const topic = text(row.topic || 'Uncategorized');
    topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
  }
  const rates = [...byFundraiser.values()]
    .filter((group) => group.minutes > 0)
    .map((group) => group.dollars * 60 / group.minutes)
    .filter(Number.isFinite);
  const sortedTopics = [...topicCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const dominant = sortedTopics[0] || ['', 0];
  return {
    airings: rows.length,
    fundraiserSamples: rates.length,
    averageRate: S.mean(rates),
    dominantTopic: dominant[0],
    dominantShare: rows.length ? dominant[1] / rows.length : 0
  };
}

function buildHourlyPatterns(schedule = {}, rows = []) {
  const pool = seasonPlanningPool(schedule, rows);
  const weekdays = [
    { day: 1, weekday: 'Monday' },
    { day: 2, weekday: 'Tuesday' },
    { day: 3, weekday: 'Wednesday' },
    { day: 4, weekday: 'Thursday' },
    { day: 5, weekday: 'Friday' },
    { day: 6, weekday: 'Saturday' },
    { day: 0, weekday: 'Sunday' }
  ];
  const resultRows = [];
  for (const item of weekdays) {
    for (let hour = 12; hour <= 22; hour += 1) {
      const matched = pool.rows.filter((row) => {
        const date = S.parseDate(row.dateKey);
        const start = Number(row.startMinutes);
        return date && date.getDay() === item.day && start >= hour * 60 && start < (hour + 1) * 60;
      });
      resultRows.push({
        weekday: item.weekday,
        weekdayIndex: item.day,
        startMinutes: hour * 60,
        endMinutes: (hour + 1) * 60,
        ...summarizeTimeslotRows(matched)
      });
    }
  }
  return {
    season: pool.targetSeason,
    fallback: pool.fallback,
    rows: resultRows
  };
}

function daypartRange(label = '') {
  const key = text(label).toLowerCase();
  if (key.includes('morning')) return [6 * 60, 12 * 60];
  if (key.includes('afternoon')) return [12 * 60, 17 * 60];
  if (key.includes('prime')) return [19 * 60, 22 * 60 + 30];
  if (key.includes('evening') || key.includes('night')) return [17 * 60, 23 * 60 + 30];
  return null;
}

function windowsOverlap(aStart, aEnd, bStart, bEnd) {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

function peerEvidenceForWindow(schedule = {}, observations = [], weekday = '', startMinutes = 0, endMinutes = 0) {
  const targetSeason = S.seasonForDate(schedule.startDate);
  const matched = [];

  for (const item of observations || []) {
    if (text(item.day_of_week).toLowerCase() !== text(weekday).toLowerCase()) continue;

    const itemStart = Number(item.start_time_minutes);
    const itemEnd = Number(item.end_time_minutes);
    const range = daypartRange(item.daypart);
    let timeMatch = false;
    let timeSpecificity = 0;

    if (Number.isFinite(itemStart)) {
      const resolvedEnd = Number.isFinite(itemEnd) && itemEnd > itemStart ? itemEnd : itemStart + 60;
      timeMatch = windowsOverlap(startMinutes, endMinutes, itemStart, resolvedEnd);
      timeSpecificity = 2;
    } else if (range) {
      timeMatch = windowsOverlap(startMinutes, endMinutes, range[0], range[1]);
      timeSpecificity = 1;
    } else {
      timeMatch = true;
      timeSpecificity = 0;
    }
    if (!timeMatch) continue;

    const signal = Number(item.assessment_signal);
    const strength = Number(item.evidence_strength || 0);
    const season = text(item.season);
    const sameSeason = season && season === targetSeason;
    const seasonNeutral = !season;
    const relevance = (sameSeason ? 4 : seasonNeutral ? 2 : 0) + timeSpecificity + Math.min(5, strength) / 10;

    const sourceLabel = text(item.station_name || item.station_code || 'Other station');
    matched.push({
      signal: Number.isFinite(signal) ? signal : 0,
      strength,
      relevance,
      stationKey: S.lookupKey(item.station_code || sourceLabel),
      sourceLabel,
      text: text(item.summary || item.assessment_raw || ''),
      tone: signal > 0 ? 'positive' : signal < 0 ? 'negative' : 'neutral'
    });
  }

  // Reduce each station to its single best-matching observation for this slot so
  // a station that reports frequently cannot crowd out independent evidence.
  const bestByStation = new Map();
  const ranked = [...matched].sort((a, b) =>
    b.relevance - a.relevance
    || b.strength - a.strength
    || Math.abs(b.signal) - Math.abs(a.signal)
  );
  for (const item of ranked) {
    const key = item.stationKey || S.lookupKey(item.sourceLabel);
    if (!bestByStation.has(key)) bestByStation.set(key, item);
  }

  const independent = [...bestByStation.values()];
  const positive = independent.filter((item) => item.signal > 0)
    .sort((a, b) => b.relevance - a.relevance || b.strength - a.strength);
  const neutral = independent.filter((item) => item.signal === 0)
    .sort((a, b) => b.relevance - a.relevance || b.strength - a.strength);
  const negative = independent.filter((item) => item.signal < 0)
    .sort((a, b) => b.relevance - a.relevance || b.strength - a.strength);

  const chosen = [...positive.slice(0, 2)];
  if (chosen.length < 3) chosen.push(...neutral.slice(0, 3 - chosen.length));
  if (negative.length) chosen.push(negative[0]);
  if (chosen.length < 4) {
    const used = new Set(chosen.map((item) => item.stationKey || S.lookupKey(item.sourceLabel)));
    for (const item of independent) {
      const key = item.stationKey || S.lookupKey(item.sourceLabel);
      if (used.has(key)) continue;
      chosen.push(item);
      used.add(key);
      if (chosen.length >= 4) break;
    }
  }
  return chosen.slice(0, 4);
}

function buildOpportunityPatterns(schedule = {}, rows = [], hourly = null, peerObservations = []) {
  const patterns = hourly || buildHourlyPatterns(schedule, rows);
  const planningPool = seasonPlanningPool(schedule, rows);
  const baseline = summarizeTimeslotRows(planningPool.rows).averageRate;
  const byWeekday = new Map();
  patterns.rows.forEach((row) => {
    if (!byWeekday.has(row.weekday)) byWeekday.set(row.weekday, []);
    byWeekday.get(row.weekday).push(row);
  });

  const opportunities = [];

  // Keep the known Saturday 3–5 PM question as one weekly test window, not one
  // duplicate entry for every Saturday in the upcoming fundraiser. Historical
  // WNMU results here have often reflected a narrow programming mix, so weak
  // results should not be treated as proof that the clock time itself is bad.
  const saturdayAfternoonRows = planningPool.rows.filter((row) => {
    const date = S.parseDate(row.dateKey);
    const start = Number(row.startMinutes);
    return date && date.getDay() === 6 && start >= 15 * 60 && start < 17 * 60;
  });
  const saturdayAfternoon = summarizeTimeslotRows(saturdayAfternoonRows);
  if (saturdayAfternoon.airings >= 2 && saturdayAfternoon.dominantShare >= 0.5) {
    opportunities.push({
      weekday: 'Saturday',
      startMinutes: 15 * 60,
      endMinutes: 17 * 60,
      kind: 'narrow-test',
      label: 'Needs a broader test',
      averageRate: saturdayAfternoon.averageRate,
      fundraiserSamples: saturdayAfternoon.fundraiserSamples,
      airings: saturdayAfternoon.airings,
      dominantTopic: saturdayAfternoon.dominantTopic,
      dominantShare: saturdayAfternoon.dominantShare,
      rationale: `WNMU has ${saturdayAfternoon.airings} historical starts from 3–5 PM, but ${Math.round(saturdayAfternoon.dominantShare * 100)}% were ${saturdayAfternoon.dominantTopic || 'one programming type'}. That is not a broad test of normal pledge programming, so weak local results should not disqualify the timeslot.`
    });
  }

  byWeekday.forEach((dayRows, weekday) => {
    dayRows.sort((a, b) => a.startMinutes - b.startMinutes);
    const maxSamples = Math.max(0, ...dayRows.map((row) => row.fundraiserSamples || 0));

    for (let index = 0; index < dayRows.length; index += 1) {
      const row = dayRows[index];
      if (row.startMinutes < 12 * 60 || row.startMinutes > 21 * 60) continue;

      const underused = row.fundraiserSamples > 0
        && row.fundraiserSamples <= Math.max(2, Math.floor(maxSamples * 0.45));
      const productive = underused
        && Number.isFinite(row.averageRate)
        && Number.isFinite(baseline)
        && baseline > 0
        && row.averageRate >= baseline * 1.05;
      const narrowTest = row.airings >= 2
        && row.dominantShare >= 0.65
        && Number.isFinite(row.averageRate)
        && Number.isFinite(baseline)
        && baseline > 0
        && row.averageRate < baseline * 0.9;

      if (!productive && !narrowTest) continue;

      let endMinutes = row.endMinutes;
      const next = dayRows[index + 1];
      if (narrowTest && next && next.startMinutes === row.endMinutes && next.fundraiserSamples === 0) {
        endMinutes = next.endMinutes;
      }

      if (opportunities.some((item) =>
        item.weekday === weekday
        && Math.max(item.startMinutes, row.startMinutes) < Math.min(item.endMinutes, endMinutes)
      )) continue;

      if (narrowTest) {
        opportunities.push({
          weekday,
          startMinutes: row.startMinutes,
          endMinutes,
          kind: 'narrow-test',
          label: 'Needs a broader test',
          averageRate: row.averageRate,
          fundraiserSamples: row.fundraiserSamples,
          airings: row.airings,
          dominantTopic: row.dominantTopic,
          dominantShare: row.dominantShare,
          rationale: `WNMU has ${row.airings} historical start${row.airings === 1 ? '' : 's'} here, but ${Math.round(row.dominantShare * 100)}% were ${row.dominantTopic || 'one programming type'}. Weak results may reflect what was scheduled more than the timeslot itself.`
        });
      } else {
        opportunities.push({
          weekday,
          startMinutes: row.startMinutes,
          endMinutes,
          kind: 'underused-positive',
          label: 'Underused with encouraging results',
          averageRate: row.averageRate,
          fundraiserSamples: row.fundraiserSamples,
          airings: row.airings,
          dominantTopic: row.dominantTopic,
          dominantShare: row.dominantShare,
          rationale: `Average ${Math.round(row.averageRate)}/pledge hr across ${row.fundraiserSamples} fundraiser sample${row.fundraiserSamples === 1 ? '' : 's'}, but this hour has been used relatively infrequently.`
        });
      }
    }
  });

  const kindOrder = { 'underused-positive': 0, 'narrow-test': 1 };
  opportunities.sort((a, b) =>
    (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9)
    || (b.averageRate || 0) - (a.averageRate || 0)
    || a.weekday.localeCompare(b.weekday)
    || a.startMinutes - b.startMinutes
  );

  const rowsWithEvidence = opportunities.slice(0, 12).map((item) => ({
    ...item,
    evidenceItems: [
      {
        sourceLabel: 'WNMU history',
        text: item.rationale,
        tone: item.kind === 'underused-positive' ? 'positive' : 'neutral'
      },
      ...peerEvidenceForWindow(schedule, peerObservations, item.weekday, item.startMinutes, item.endMinutes)
    ]
  }));

  return {
    season: patterns.season,
    fallback: patterns.fallback,
    rows: rowsWithEvidence
  };
}

function compactRecommendation(item = {}) {
  return {
    programId: item.programId,
    title: item.title,
    topic: item.topic,
    secondary: item.secondary,
    score: item.score,
    fit: item.fit,
    confidence: item.confidence,
    reasons: item.reasons,
    cautions: item.cautions,
    season: item.season,
    local: item.local,
    drama: item.drama,
    programmer: item.programmer,
    newTitle: item.newTitle,
    reviewedNew: item.reviewedNew
  };
}

function compactStrategy(strategy = {}) {
  return {
    schedule: strategy.schedule,
    cutoff: strategy.cutoff,
    evidenceRows: strategy.evidenceRows,
    evidenceFundraisers: strategy.evidenceFundraisers,
    libraryTitles: strategy.libraryTitles,
    eligibleTitles: strategy.eligibleTitles,
    baselineRate: strategy.baselineRate,
    windows: (strategy.windows || []).map((slot) => ({
      id: slot.id,
      date: slot.date,
      weekday: slot.weekday,
      weekpart: slot.weekpart,
      label: slot.label,
      startMinutes: slot.startMinutes,
      endMinutes: slot.endMinutes,
      experimental: slot.experimental,
      blocked: slot.blocked,
      reason: slot.reason,
      evidenceRows: slot.evidenceRows,
      windowHistory: slot.windowHistory,
      experimentalEvidence: slot.experimentalEvidence,
      recommendations: (slot.recommendations || []).map(compactRecommendation)
    })),
    topicComparison: strategy.topicComparison,
    repeats: (strategy.repeats || []).map((item) => ({
      title: item.title,
      topic: item.topic,
      score: item.score,
      slots: (item.slots || []).map((slot) => ({
        id: slot.id,
        date: slot.date,
        weekday: slot.weekday,
        label: slot.label,
        startMinutes: slot.startMinutes,
        endMinutes: slot.endMinutes
      }))
    })),
    seasonal: (strategy.seasonal || []).map((item) => ({
      title: item.title,
      topic: item.topic,
      season: item.season
    })),
    local: (strategy.local || []).map((item) => ({
      title: item.title,
      topic: item.topic,
      score: item.score,
      fit: item.fit
    })),
    avoid: (strategy.avoid || []).map((item) => ({
      title: item.title,
      reasons: item.reasons
    })),
    rights: strategy.rights,
    limitations: strategy.limitations
  };
}

self.onmessage = (event) => {
  const payload = event.data || {};
  const requestId = payload.requestId;
  const diagnostics = {};
  const totalStarted = nowMs();

  try {
    progress(requestId, 'prepare', 'Preparing historical evidence…');
    let phase = nowMs();
    const library = Array.isArray(payload.library) ? payload.library : [];
    const rawAirings = Array.isArray(payload.airings) ? payload.airings : [];
    const overrides = Array.isArray(payload.overrides) ? payload.overrides : [];
    const scheduleRows = Array.isArray(payload.scheduleRows) ? payload.scheduleRows : [];
    const peerObservations = Array.isArray(payload.peerObservations) ? payload.peerObservations : [];
    const schedule = payload.schedule || {};
    const now = payload.now ? new Date(payload.now) : new Date();

    const canonical = A.canonicalizeImportedAirings(rawAirings);
    const cutoff = S.evidenceCutoff(schedule, now);
    const historical = completedHistoricalAnalyses(scheduleRows, canonical, library, cutoff);
    const analyses = historical.analyses;
    const rows = strategyEvidenceRowsFromAnalyses(analyses);
    const performanceStats = buildHistoricalPerformanceStats(schedule, analyses);

    diagnostics.prepareMs = Math.round(nowMs() - phase);
    diagnostics.rawAirings = rawAirings.length;
    diagnostics.canonicalAirings = canonical.length;
    diagnostics.historicalSchedules = historical.schedules.length;
    diagnostics.historicalAnalyses = analyses.length;
    diagnostics.evidenceRows = rows.length;

    progress(requestId, 'score', 'Scoring eligible titles against reconciled WNMU history…');
    phase = nowMs();
    const strategy = S.buildStrategy({
      schedule,
      library,
      evidenceRows: rows,
      overrides,
      performanceStats,
      now
    });
    diagnostics.strategyMs = Math.round(nowMs() - phase);

    progress(requestId, 'days', 'Calculating fundraiser-day and day/time patterns…');
    phase = nowMs();
    const dayOutlook = buildDayOutlook(schedule, analyses);
    const hourlyPatterns = buildHourlyPatterns(schedule, rows);
    const opportunities = buildOpportunityPatterns(schedule, rows, hourlyPatterns, peerObservations);
    diagnostics.dayOutlookMs = Math.round(nowMs() - phase);

    phase = nowMs();
    const compact = compactStrategy(strategy);
    diagnostics.compactMs = Math.round(nowMs() - phase);
    diagnostics.totalMs = Math.round(nowMs() - totalStarted);

    self.postMessage({
      type: 'result',
      requestId,
      strategy: compact,
      dayOutlook,
      hourlyPatterns,
      opportunities,
      diagnostics
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error?.message || String(error),
      stack: error?.stack || ''
    });
  }
};

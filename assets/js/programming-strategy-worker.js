'use strict';

importScripts('one-sheet-analysis.js?v=0.22.183', 'programming-strategy-analysis.js?v=0.22.183');

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
      if (row?.countsTowardScheduleMinutes === false || row?.unmatchedImported) continue;
      if (!row?.known || row?.durationMissing || !(Number(row?.minutes) > 0)) continue;
      if (!Number.isFinite(Number(row?.startMinutes))) continue;
      rows.push({
        programId: text(row.programId || ''),
        title: text(row.title || row.plannedTitle || 'Untitled program'),
        topic: text(row.topic || 'Uncategorized') || 'Uncategorized',
        secondary: text(row.secondary || ''),
        dateKey: text(row.dateKey || ''),
        startMinutes: Number(row.startMinutes),
        endMinutes: Number.isFinite(Number(row.endMinutes)) ? Number(row.endMinutes) : Number(row.startMinutes) + Number(row.minutes),
        minutes: Number(row.minutes),
        dollars: Number(row.dollars || 0),
        pledges: Number(row.pledges || 0),
        fundraiserId,
        fundraiserTitle,
        driveStartDate: text(schedule.startDate || ''),
        driveEndDate: text(schedule.endDate || ''),
        known: true,
        durationMissing: false,
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

function rankingStatsMap(rows = []) {
  return new Map((rows || []).map((row) => [S.lookupKey(row.key), {
    key: row.key,
    historyRows: Number(row.rateAirings || 0),
    fundraiserSamples: Number(row.fundraisers || 0),
    testedTitleCount: Number(row.titles || 0),
    averageRate: Number(row.averageDollarsPerHour),
    medianRate: Number(row.medianDollarsPerHour)
  }]));
}

function buildHistoricalPerformanceStats(schedule = {}, analyses = []) {
  const targetSeason = A.seasonForDate(schedule.startDate || schedule.start_date || '');
  const seasonAnalyses = (analyses || []).filter((analysis) =>
    text(analysis?.schedule?.season || A.seasonForDate(analysis?.schedule?.startDate || '')) === targetSeason
  );
  const minimums = { minAirings: 1, minFundraisers: 1, minTitles: 1 };
  const topic = rankingStatsMap(A.historicalRanking(seasonAnalyses, 'topic', minimums));
  const subtopicByTopic = new Map();

  for (const topicKey of ['documentary', 'music', 'holiday christmas']) {
    const filtered = seasonAnalyses.map((analysis) => ({
      ...analysis,
      placementRows: (analysis?.placementRows || []).filter((row) => S.lookupKey(row?.topic || '') === topicKey)
    }));
    subtopicByTopic.set(topicKey, rankingStatsMap(A.historicalRanking(filtered, 'subtopic', minimums)));
  }

  return { targetSeason: targetSeason || 'Special', topic, subtopicByTopic };
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
    const days = (A.calendarDays(analysis) || [])
      .map((day) => ({
        ...day,
        offset: A.fundraiserDayOffset(analysis, day.dateKey)
      }))
      .filter((day) =>
        Number.isFinite(Number(day.offset))
        && targetOffsetSet.has(Number(day.offset))
        && Number(day.rateMinutes || 0) > 0
        && Number.isFinite(Number(day.dollarsPerHour))
      );

    if (!days.length) continue;
    const baseline = S.mean(days.map((day) => Number(day.dollarsPerHour)).filter(Number.isFinite));
    if (!(baseline > 0)) continue;

    for (const day of days) {
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
  const seasonal = clean.filter((row) => S.seasonForDate(row.dateKey) === targetSeason);
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

function buildOpportunityPatterns(schedule = {}, rows = [], hourly = null) {
  const patterns = hourly || buildHourlyPatterns(schedule, rows);
  const allRates = patterns.rows.map((row) => row.averageRate).filter(Number.isFinite);
  const baseline = S.mean(allRates);
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
  const planningPool = seasonPlanningPool(schedule, rows);
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

  return {
    season: patterns.season,
    fallback: patterns.fallback,
    peerEvidenceAvailable: false,
    rows: opportunities.slice(0, 12)
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
    peerEvidence: strategy.peerEvidence,
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
    const schedule = payload.schedule || {};
    const now = payload.now ? new Date(payload.now) : new Date();

    const indexes = buildLibraryIndexes(library);
    const canonical = canonicalizeAirings(rawAirings);
    const cutoff = S.evidenceCutoff(schedule, now);
    const cutoffDate = S.parseDate(cutoff);
    const rows = canonical
      .filter((row) => {
        const when = S.parseDate(importedDateKey(row));
        return Boolean(when && cutoffDate && when <= cutoffDate);
      })
      .map((row) => normalizeAiring(row, indexes))
      .filter((row) => row.dateKey);
    diagnostics.prepareMs = Math.round(nowMs() - phase);
    diagnostics.rawAirings = rawAirings.length;
    diagnostics.canonicalAirings = canonical.length;
    diagnostics.evidenceRows = rows.length;

    progress(requestId, 'score', 'Scoring eligible titles against WNMU history…');
    phase = nowMs();
    const strategy = S.buildStrategy({
      schedule,
      library,
      evidenceRows: rows,
      overrides,
      now
    });
    diagnostics.strategyMs = Math.round(nowMs() - phase);

    progress(requestId, 'days', 'Calculating fundraiser-day and day/time patterns…');
    phase = nowMs();
    const dayOutlook = buildDayOutlook(schedule, rows);
    const hourlyPatterns = buildHourlyPatterns(schedule, rows);
    const opportunities = buildOpportunityPatterns(schedule, rows, hourlyPatterns);
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

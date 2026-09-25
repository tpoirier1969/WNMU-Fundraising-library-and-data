'use strict';

importScripts('one-sheet-analysis.js?v=0.22.186', 'programming-strategy-analysis.js?v=0.22.209', 'programming-strategy-backtest.js?v=0.22.208');

const A = self.WNMUOneSheetAnalysis;
const S = self.WNMUProgrammingStrategyAnalysis;
const B = self.WNMUStrategyBacktest;
if (!A) throw new Error('Shared historical analysis module did not load in worker.');
if (!S) throw new Error('Programming strategy analysis module did not load in worker.');
if (!B) throw new Error('Programming strategy backtest module did not load in worker.');

const text = (value) => String(value ?? '').trim();
const nullableNumber = (value) => value == null || String(value).trim() === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
const nolaKey = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const nowMs = () => self.performance?.now?.() ?? Date.now();

function progress(requestId, stage, message) {
  self.postMessage({ type: 'progress', requestId, stage, message });
}

function rawBreakCount(row = {}) {
  const raw = row?.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {};
  const value = Number(raw.break_count ?? raw.breaks ?? raw.breakCount);
  return Number.isFinite(value) ? value : null;
}

function strategyBoundaryBreakClassification(placement = {}, airing = null) {
  if (placement?.isNonPledge) {
    return { exclude: true, reason: 'Explicitly marked non-pledge.' };
  }

  // WNMU treats a program with an attached pledge break as a pledge program
  // whether the break is internal or follows the program. Do not infer
  // non-pledge status from break placement, break count, or reported break minutes.
  return { exclude: false, reason: '' };
}

function prepareStrategySchedules(scheduleRows = [], canonicalAirings = []) {
  const airings = canonicalAirings || [];
  const byHash = new Map(
    airings
      .map((row) => [text(row?.row_hash || ''), row])
      .filter(([key]) => key)
  );
  const airingForPlacement = (placement = {}) => {
    const hash = text(placement.sourceAiringHash || placement.source_airing_hash || '');
    if (hash && byHash.has(hash)) return byHash.get(hash);
    const dateKey = text(placement.dateKey || placement.date_key || '');
    const start = Number(placement.startMinutes ?? placement.start_minutes);
    const titleKey = S.lookupKey(placement.programTitle || placement.program_title || placement.title || '');
    const candidates = airings.filter((row) => {
      const rowDate = text(row?.air_date || row?.drive_date || '').slice(0,10);
      const time = text(row?.air_time || '');
      const match = time.match(/^(\d{1,2}):(\d{2})/);
      const rowStart = match ? Number(match[1]) * 60 + Number(match[2]) : null;
      if (rowDate !== dateKey || !Number.isFinite(start) || rowStart !== start) return false;
      if (!titleKey) return true;
      const rowTitle = S.lookupKey(row?.matched_library_title || row?.program_title || row?.title || row?.imported_program_title || '');
      return !rowTitle || rowTitle === titleKey;
    });
    return candidates.length === 1 ? candidates[0] : null;
  };
  let excludedBoundaryBreaks = 0;
  const excludedExamples = [];

  const normalizedSchedules = (scheduleRows || []).map((row) => row?.schedule_data ? A.normalizeSchedule(row) : (row?.startDate || Array.isArray(row?.placements) ? { ...row, placements: Array.isArray(row?.placements) ? row.placements : [] } : A.normalizeSchedule(row)));
  const schedules = normalizedSchedules.map((schedule) => {
    const placements = (schedule.placements || []).map((placement) => {
      const airing = airingForPlacement(placement);
      const classification = strategyBoundaryBreakClassification(placement, airing);
      if (!classification.exclude || placement?.isNonPledge) return placement;

      excludedBoundaryBreaks += 1;
      if (excludedExamples.length < 12) {
        excludedExamples.push({
          dateKey: text(placement.dateKey || placement.date_key || ''),
          startMinutes: Number(placement.startMinutes ?? placement.start_minutes),
          title: text(placement.programTitle || placement.program_title || placement.title || ''),
          reason: classification.reason
        });
      }
      return {
        ...placement,
        isNonPledge: true,
        strategyBoundaryBreakOnly: true,
        strategyBoundaryBreakReason: classification.reason
      };
    });
    return { ...schedule, placements };
  });

  return { schedules, excludedBoundaryBreaks, excludedExamples };
}
function completedHistoricalAnalyses(scheduleRows = [], canonicalAirings = [], library = [], cutoff = '') {
  const indexes = A.buildLibraryIndexes(library);
  const prepared = prepareStrategySchedules(scheduleRows, canonicalAirings);
  const schedules = A.prepareSchedules(prepared.schedules)
    .filter((item) => item?.startDate && item?.endDate && (!cutoff || item.endDate <= cutoff));
  const analyses = schedules
    .map((item) => A.analyzeSchedule(item, canonicalAirings, indexes))
    .filter((analysis) => (analysis?.importedRows || []).length || Number(analysis?.broadcastDollars || 0) > 0);
  return {
    schedules,
    analyses,
    indexes,
    excludedBoundaryBreaks: prepared.excludedBoundaryBreaks,
    excludedBoundaryBreakExamples: prepared.excludedExamples
  };
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

function targetBacktestRows(scheduleRows = [], canonicalAirings = [], library = [], targetSchedule = {}) {
  const prepared = prepareStrategySchedules(scheduleRows, canonicalAirings);
  const schedules = A.prepareSchedules(prepared.schedules);
  const targetId = text(targetSchedule.id || '');
  const targetStart = text(targetSchedule.startDate || targetSchedule.start_date || '').slice(0, 10);
  const targetEnd = text(targetSchedule.endDate || targetSchedule.end_date || '').slice(0, 10);
  const targetTitle = S.lookupKey(targetSchedule.title || '');

  const target = schedules.find((item) => targetId && text(item.id || '') === targetId)
    || schedules.find((item) =>
      targetStart
      && targetEnd
      && text(item.startDate || '').slice(0, 10) === targetStart
      && text(item.endDate || '').slice(0, 10) === targetEnd
      && (!targetTitle || S.lookupKey(item.title || '') === targetTitle)
    )
    || schedules.find((item) =>
      targetStart
      && targetEnd
      && text(item.startDate || '').slice(0, 10) === targetStart
      && text(item.endDate || '').slice(0, 10) === targetEnd
    );

  if (!target) return { rows: [], found: false, schedule: null };
  const indexes = A.buildLibraryIndexes(library);
  const analysis = A.analyzeSchedule(target, canonicalAirings, indexes);
  return {
    rows: strategyEvidenceRowsFromAnalyses([analysis]),
    found: true,
    schedule: target
  };
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

function pairedStartTimeCheck(rows = [], options = {}) {
  const bucketMinutes = Number.isFinite(Number(options.bucketMinutes)) ? Number(options.bucketMinutes) : 30;
  const startA = Number.isFinite(Number(options.startA))
    ? Number(options.startA)
    : (Number.isFinite(Number(options.hourA)) ? Number(options.hourA) * 60 : 20 * 60);
  const startB = Number.isFinite(Number(options.startB))
    ? Number(options.startB)
    : (Number.isFinite(Number(options.hourB)) ? Number(options.hourB) * 60 : 21 * 60);
  const weekdayIndex = Number.isFinite(Number(options.weekdayIndex)) ? Number(options.weekdayIndex) : null;
  const season = text(options.season);
  const byFundraiser = new Map();
  const topicCounts = { a: new Map(), b: new Map() };

  for (const row of reportableProgrammingRows(rows)) {
    const date = S.parseDate(row.dateKey);
    const start = Number(row.startMinutes);
    if (!date || !Number.isFinite(start) || Number(row.minutes) <= 0) continue;
    if (weekdayIndex != null && date.getDay() !== weekdayIndex) continue;
    if (season && S.rowSeason(row) !== season) continue;

    let bucket = '';
    if (start >= startA && start < startA + bucketMinutes) bucket = 'a';
    else if (start >= startB && start < startB + bucketMinutes) bucket = 'b';
    else continue;

    const key = row.fundraiserId || row.dateKey;
    if (!byFundraiser.has(key)) byFundraiser.set(key, {
      a: { dollars: 0, minutes: 0 },
      b: { dollars: 0, minutes: 0 }
    });
    const target = byFundraiser.get(key)[bucket];
    target.dollars += Number(row.dollars || 0);
    target.minutes += Number(row.minutes || 0);

    const topic = text(row.topic || 'Uncategorized');
    const counts = topicCounts[bucket];
    counts.set(topic, (counts.get(topic) || 0) + 1);
  }

  const pairs = [];
  for (const [fundraiserId, group] of byFundraiser.entries()) {
    if (!(group.a.minutes > 0) || !(group.b.minutes > 0)) continue;
    const rateA = group.a.dollars * 60 / group.a.minutes;
    const rateB = group.b.dollars * 60 / group.b.minutes;
    if (!Number.isFinite(rateA) || !Number.isFinite(rateB)) continue;
    pairs.push({ fundraiserId, rateA, rateB, difference: rateB - rateA });
  }

  const dominant = (map) => {
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const total = sorted.reduce((sum, item) => sum + item[1], 0);
    return {
      topic: sorted[0]?.[0] || '',
      share: total ? (sorted[0]?.[1] || 0) / total : 0,
      starts: total
    };
  };

  return {
    startA,
    startB,
    bucketMinutes,
    pairedFundraisers: pairs.length,
    hourAWins: pairs.filter((item) => item.rateA > item.rateB).length,
    hourBWins: pairs.filter((item) => item.rateB > item.rateA).length,
    ties: pairs.filter((item) => item.rateA === item.rateB).length,
    medianHourARate: S.median(pairs.map((item) => item.rateA)),
    medianHourBRate: S.median(pairs.map((item) => item.rateB)),
    medianDifference: S.median(pairs.map((item) => item.difference)),
    meanDifference: S.mean(pairs.map((item) => item.difference)),
    hourAMix: dominant(topicCounts.a),
    hourBMix: dominant(topicCounts.b)
  };
}

function buildStartTimeReconciliation(schedule = {}, rows = []) {
  const targetSeason = S.seasonForDate(schedule.startDate);
  const weekdays = [
    { day: 1, weekday: 'Monday' },
    { day: 2, weekday: 'Tuesday' },
    { day: 3, weekday: 'Wednesday' },
    { day: 4, weekday: 'Thursday' },
    { day: 5, weekday: 'Friday' },
    { day: 6, weekday: 'Saturday' },
    { day: 0, weekday: 'Sunday' }
  ];
  const exactOptions = { startA: 20 * 60, startB: 21 * 60, bucketMinutes: 30 };

  return {
    targetSeason,
    bucketMinutes: 30,
    startA: 20 * 60,
    startB: 21 * 60,
    overall: pairedStartTimeCheck(rows, exactOptions),
    weekdays: weekdays.map((item) => ({
      weekday: item.weekday,
      weekdayIndex: item.day,
      allHistory: pairedStartTimeCheck(rows, { ...exactOptions, weekdayIndex: item.day }),
      targetSeason: pairedStartTimeCheck(rows, { ...exactOptions, weekdayIndex: item.day, season: targetSeason })
    }))
  };
}

function buildHalfHourRows(poolRows = [], dayMatcher = () => true) {
  const rows = [];
  for (let slot = 12 * 60; slot <= 22 * 60 + 30; slot += 30) {
    const matched = poolRows.filter((row) => {
      const date = S.parseDate(row.dateKey);
      const start = Number(row.startMinutes);
      return date
        && dayMatcher(date.getDay())
        && Number.isFinite(start)
        && start >= slot
        && start < slot + 30;
    });
    rows.push({
      startMinutes: slot,
      endMinutes: slot + 30,
      ...summarizeTimeslotRows(matched)
    });
  }
  return rows;
}

function buildHourlyPatterns(schedule = {}, rows = []) {
  const targetSeason = S.seasonForDate(schedule.startDate);
  const clean = reportableProgrammingRows(rows);
  const seasonal = clean.filter((row) => S.rowSeason(row) === targetSeason);
  const weekdays = [
    { day: 1, weekday: 'Monday' },
    { day: 2, weekday: 'Tuesday' },
    { day: 3, weekday: 'Wednesday' },
    { day: 4, weekday: 'Thursday' },
    { day: 5, weekday: 'Friday' },
    { day: 6, weekday: 'Saturday' },
    { day: 0, weekday: 'Sunday' }
  ];

  const historyDates = clean.map((row) => text(row.dateKey)).filter(Boolean).sort();
  const seasonFundraisers = new Set(seasonal.map((row) => row.fundraiserId).filter(Boolean)).size;
  const allFundraisers = new Set(clean.map((row) => row.fundraiserId).filter(Boolean)).size;
  const resultRows = [];

  for (const item of weekdays) {
    const allRows = buildHalfHourRows(clean, (day) => day === item.day);
    const seasonRows = buildHalfHourRows(seasonal, (day) => day === item.day);
    for (let i = 0; i < allRows.length; i += 1) {
      resultRows.push({
        weekday: item.weekday,
        weekdayIndex: item.day,
        startMinutes: allRows[i].startMinutes,
        endMinutes: allRows[i].endMinutes,
        targetSeason: seasonRows[i],
        allHistory: allRows[i]
      });
    }
  }

  return {
    season: targetSeason,
    bucketMinutes: 30,
    rows: resultRows,
    seasonFundraisers,
    allFundraisers,
    historyStartDate: historyDates[0] || '',
    historyEndDate: historyDates[historyDates.length - 1] || '',
    reconciliation: buildStartTimeReconciliation(schedule, clean)
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
      tone: signal > 0 ? 'positive' : signal < 0 ? 'negative' : 'neutral',
      season,
      startMinutes: Number.isFinite(itemStart) ? itemStart : null,
      endMinutes: Number.isFinite(itemEnd) ? itemEnd : null,
      daypart: text(item.daypart),
      programTitle: text(item.program_title_raw),
      actualDollars: nullableNumber(item.actual_dollars),
      goalDollars: nullableNumber(item.goal_dollars),
      pledgeCount: nullableNumber(item.pledge_count),
      contextFlags: item.context_flags && typeof item.context_flags === 'object' ? item.context_flags : {}
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

function peerTimingAlternatives(schedule = {}, observations = [], weekday = '', anchorMinutes = 17 * 60) {
  const targetSeason = S.seasonForDate(schedule.startDate);
  const minStart = anchorMinutes - 60;
  const maxStart = anchorMinutes + 90;
  const candidates = [];

  for (const item of observations || []) {
    if (text(item.day_of_week).toLowerCase() !== text(weekday).toLowerCase()) continue;
    const start = Number(item.start_time_minutes);
    if (!Number.isFinite(start) || start < minStart || start > maxStart) continue;
    const strength = Number(item.evidence_strength || 0);
    if (strength < 3) continue;
    const signal = Number(item.assessment_signal);
    const sameSeason = text(item.season) === targetSeason;
    const sourceLabel = text(item.station_name || item.station_code || 'Other station');
    candidates.push({
      sourceLabel,
      stationKey: S.lookupKey(item.station_code || sourceLabel),
      startMinutes: start,
      signal: Number.isFinite(signal) ? signal : 0,
      strength,
      sameSeason,
      relevance: (sameSeason ? 5 : 1) + Math.min(5, strength) / 10 + Math.max(-2, Math.min(2, Number.isFinite(signal) ? signal : 0)),
      programTitle: text(item.program_title_raw),
      actualDollars: nullableNumber(item.actual_dollars),
      pledgeCount: nullableNumber(item.pledge_count),
      text: text(item.summary || item.assessment_raw || ''),
      tone: signal > 0 ? 'positive' : signal < 0 ? 'negative' : 'neutral'
    });
  }

  const ranked = candidates.sort((a, b) =>
    b.relevance - a.relevance
    || b.strength - a.strength
    || Math.abs(b.signal) - Math.abs(a.signal)
    || a.startMinutes - b.startMinutes
  );

  const seen = new Set();
  const selected = [];
  for (const item of ranked) {
    const key = `${item.stationKey}|${item.startMinutes}|${S.lookupKey(item.programTitle)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(item);
    if (selected.length >= 6) break;
  }
  return selected.sort((a, b) => a.startMinutes - b.startMinutes || b.relevance - a.relevance);
}

function buildSlotTimingEvidence(schedule = {}, peerObservations = [], slot = {}) {
  if (slot.blocked) return null;
  const history = slot.windowHistory || {};
  const localRows = Array.isArray(history.rates) ? history.rates.length : Number(slot.evidenceRows || 0);
  const localFundraisers = Number(history.fundraisers || 0);
  const peers = peerEvidenceForWindow(schedule, peerObservations, slot.weekday, slot.startMinutes, slot.endMinutes);
  const nearbyPeers = peerTimingAlternatives(schedule, peerObservations, slot.weekday, slot.startMinutes);
  const positivePeers = peers.filter((item) => item.signal > 0).length;
  const negativePeers = peers.filter((item) => item.signal < 0).length;

  let status = 'Exploratory timing';
  if (localFundraisers >= 2 && Number.isFinite(Number(history.averageRate))) status = 'WNMU-supported timing';
  else if (localRows > 0) status = 'Thin WNMU timing evidence';
  else if (positivePeers > 0) status = 'Peer-supported exploratory timing';

  let boundaryNote = '';
  if (slot.label === 'Early evening' && slot.startMinutes === 17 * 60) {
    boundaryNote = '5:00 PM is the model boundary for the Early evening planning window, not an evidence-selected exact start time. The historical data does not establish 5:00 over 4:00 or 5:30.';
  } else if (slot.label === 'Prime') {
    boundaryNote = 'This is a broad prime-time planning window; the displayed boundary is not automatically the exact start time for a program.';
  } else if (slot.experimental) {
    boundaryNote = 'This is explicitly a test window. The exact program start should follow the evidence shown here rather than the window boundary alone.';
  }

  return {
    status,
    boundaryNote,
    localRows,
    localFundraisers,
    localAverageRate: Number.isFinite(Number(history.averageRate)) ? Number(history.averageRate) : null,
    peerEvidence: peers,
    nearbyPeers,
    positivePeers,
    negativePeers,
    exactStartEstablished: localFundraisers >= 2 && localRows >= 3
  };
}

function positivePeerObservation(item = {}) {
  return Number(item.assessment_signal) > 0 && Number(item.evidence_strength || 0) >= 4;
}

function flagOn(item = {}, ...keys) {
  const flags = item.context_flags && typeof item.context_flags === 'object' ? item.context_flags : {};
  return keys.some((key) => Boolean(flags[key]));
}

function buildPeerPracticeGaps(schedule = {}, observations = []) {
  const definitions = [
    {
      id: 'challenge-grants',
      label: 'Challenge / matching grants',
      match: (item) => flagOn(item, 'challenge_grant'),
      wnmuStatus: 'Not tracked in WNMU strategy data; confirm whether current drives already use this.',
      testIdea: 'Test a clearly bounded challenge on a strong night or a program with a loyal audience, and compare response before/during the challenge.'
    },
    {
      id: 'tickets',
      label: 'Ticket-linked fundraising',
      match: (item) => flagOn(item, 'tickets'),
      wnmuStatus: 'Not tracked in WNMU strategy data; confirm whether WNMU currently has usable ticket inventory.',
      testIdea: 'When local/regional event tickets are available, compare the same title family with and without a ticket offer rather than assuming the program alone drove the result.'
    },
    {
      id: 'live-localized',
      label: 'Live / localized breaks and in-studio guests',
      match: (item) => flagOn(item, 'live', 'local_breaks', 'guest', 'guests', 'studio_animals', 'local_nonprofit'),
      wnmuStatus: 'Not represented as a structured tactic in the current strategy model.',
      testIdea: 'Identify one high-confidence program where a live guest, producer, local expert or community partner materially changes the break rather than simply making it live.'
    },
    {
      id: 'local-programming',
      label: 'Local productions as pledge anchors',
      match: (item) => flagOn(item, 'local') || text(item.topic_primary).toLowerCase() === 'local',
      wnmuStatus: 'WNMU does use local programming, but the strategy does not yet measure local-event treatment as a separate fundraising tactic.',
      testIdea: 'Separate ordinary local-title performance from locally produced pledge events with guests, premieres, special premiums or community framing.'
    },
    {
      id: 'off-drive',
      label: 'Themed off-drive pledge blocks',
      match: (item) => flagOn(item, 'toop'),
      wnmuStatus: 'Not part of the current fundraiser-only planning model.',
      testIdea: 'Consider a small themed pledge block outside the major drives and measure whether it reaches donors without displacing a full fundraiser.'
    },
    {
      id: 'sunday-morning',
      label: 'Sunday-morning pledge',
      match: (item) => text(item.day_of_week).toLowerCase() === 'sunday' && text(item.daypart).toLowerCase().includes('morning'),
      wnmuStatus: 'Current Day-by-Day strategy windows do not include Sunday morning.',
      testIdea: 'If rights and staffing allow, test one Sunday-morning block with programming aimed at an audience not already served by prime-time pledge.'
    },
    {
      id: 'marathons',
      label: 'Marathons / event blocks',
      match: (item) => flagOn(item, 'marathon'),
      wnmuStatus: 'WNMU has used marathons, so treat this as a tactic to evaluate rather than an automatic gap.',
      testIdea: 'Compare marathon results with ordinary single-title placements after adjusting for total pledge hours.'
    },
    {
      id: 'aircheck-reuse',
      label: 'Strategic aircheck / replay reuse',
      match: (item) => flagOn(item, 'aircheck'),
      wnmuStatus: 'Replay strategy is not explicitly scored as a peer tactic in the current report.',
      testIdea: 'When a strong event was previously airchecked, compare replay economics with producing new breaks or acquiring another title.'
    }
  ];

  const positive = (observations || []).filter(positivePeerObservation);
  const rows = [];

  for (const definition of definitions) {
    const matches = positive.filter(definition.match);
    if (!matches.length) continue;

    const bestByStation = new Map();
    const ranked = [...matches].sort((a, b) =>
      Number(b.evidence_strength || 0) - Number(a.evidence_strength || 0)
      || Number(b.assessment_signal || 0) - Number(a.assessment_signal || 0)
      || Number(b.actual_dollars || 0) - Number(a.actual_dollars || 0)
    );
    for (const item of ranked) {
      const station = text(item.station_name || item.station_code || 'Other station');
      const key = S.lookupKey(item.station_code || station);
      if (!bestByStation.has(key)) {
        bestByStation.set(key, {
          station,
          programTitle: text(item.program_title_raw),
          summary: text(item.summary || item.assessment_raw || ''),
          actualDollars: nullableNumber(item.actual_dollars),
          goalDollars: nullableNumber(item.goal_dollars),
          pledgeCount: nullableNumber(item.pledge_count),
          evidenceStrength: Number(item.evidence_strength || 0),
          signal: Number(item.assessment_signal || 0),
          season: text(item.season)
        });
      }
    }

    const examples = [...bestByStation.values()].slice(0, 4);
    rows.push({
      id: definition.id,
      label: definition.label,
      stationCount: bestByStation.size,
      observationCount: matches.length,
      averageStrength: matches.reduce((sum, item) => sum + Number(item.evidence_strength || 0), 0) / matches.length,
      wnmuStatus: definition.wnmuStatus,
      testIdea: definition.testIdea,
      examples
    });
  }

  return rows
    .sort((a, b) => b.stationCount - a.stationCount || b.averageStrength - a.averageStrength || b.observationCount - a.observationCount)
    .slice(0, 8);
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

function compactStrategy(strategy = {}, schedule = {}, peerObservations = []) {
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
      timingEvidence: buildSlotTimingEvidence(schedule, peerObservations, slot),
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
    const effectiveOverrides = payload.mode === 'backtest'
      ? overrides.filter((row) => {
        const when = text(row?.rated_at || row?.updated_at || '').slice(0, 10);
        return Boolean(when && cutoff && when <= cutoff);
      })
      : overrides;
    diagnostics.overrideRows = overrides.length;
    diagnostics.effectiveOverrideRows = effectiveOverrides.length;
    diagnostics.excludedPostCutoffOverrides = overrides.length - effectiveOverrides.length;
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
    diagnostics.excludedBoundaryBreakRows = Number(historical.excludedBoundaryBreaks || 0);
    diagnostics.excludedBoundaryBreakExamples = historical.excludedBoundaryBreakExamples || [];

    progress(requestId, 'score', 'Scoring eligible titles against reconciled WNMU history…');
    phase = nowMs();
    const strategy = S.buildStrategy({
      schedule,
      library,
      evidenceRows: rows,
      overrides: effectiveOverrides,
      performanceStats,
      now
    });
    diagnostics.strategyMs = Math.round(nowMs() - phase);

    let backtest = null;
    if (payload.mode === 'backtest') {
      progress(requestId, 'backtest', 'Comparing frozen recommendations with the fundraiser that actually aired…');
      phase = nowMs();
      const actual = targetBacktestRows(scheduleRows, canonical, library, schedule);
      diagnostics.backtestTargetFound = actual.found;
      diagnostics.backtestActualRows = actual.rows.length;
      backtest = B.evaluate({
        strategy,
        actualRows: actual.rows,
        schedule,
        recommendationLimit: payload.recommendationLimit || 20
      });
      backtest.targetScheduleFound = actual.found;
      diagnostics.backtestMs = Math.round(nowMs() - phase);
    }

    progress(requestId, 'days', 'Calculating fundraiser-day and day/time patterns…');
    phase = nowMs();
    const dayOutlook = buildDayOutlook(schedule, analyses);
    const hourlyPatterns = buildHourlyPatterns(schedule, rows);
    const opportunities = buildOpportunityPatterns(schedule, rows, hourlyPatterns, peerObservations);
    const peerPractices = buildPeerPracticeGaps(schedule, peerObservations);
    diagnostics.dayOutlookMs = Math.round(nowMs() - phase);

    phase = nowMs();
    const compact = compactStrategy(strategy, schedule, peerObservations);
    diagnostics.compactMs = Math.round(nowMs() - phase);
    diagnostics.totalMs = Math.round(nowMs() - totalStarted);

    self.postMessage({
      type: 'result',
      requestId,
      strategy: compact,
      dayOutlook,
      hourlyPatterns,
      opportunities,
      peerPractices,
      backtest,
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

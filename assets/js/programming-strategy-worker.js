'use strict';

importScripts('programming-strategy-analysis.js?v=0.22.177');

const S = self.WNMUProgrammingStrategyAnalysis;
if (!S) throw new Error('Programming strategy analysis module did not load in worker.');

const text = (value) => String(value ?? '').trim();
const nolaKey = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const nowMs = () => self.performance?.now?.() ?? Date.now();

function progress(requestId, stage, message) {
  self.postMessage({ type: 'progress', requestId, stage, message });
}

function importedDateKey(row = {}) {
  const direct = text(row.air_date);
  if (direct) return direct.slice(0, 10);
  return S.dateKey(S.parseDate(row.aired_at));
}

function importedStartMinutes(row = {}) {
  const raw = text(row.air_time);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (match) return (Number(match[1]) * 60) + Number(match[2]);
  const date = new Date(row.aired_at || '');
  return Number.isNaN(date.getTime()) ? null : (date.getHours() * 60) + date.getMinutes();
}

function libraryRuntimeMinutes(row = {}) {
  const seconds = Number(row.actual_runtime_seconds);
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds / 60);
  const bucket = Number(row.length_bucket_minutes);
  return Number.isFinite(bucket) && bucket > 0 ? bucket : null;
}

function buildLibraryIndexes(rows = []) {
  const byId = new Map();
  const byTitle = new Map();
  const byNola = new Map();
  for (const row of rows || []) {
    const id = text(row?.id);
    const title = S.lookupKey(row?.title);
    const nola = nolaKey(row?.nola_code);
    if (id) byId.set(id, row);
    if (title) byTitle.set(title, row);
    if (nola) {
      if (!byNola.has(nola)) byNola.set(nola, []);
      byNola.get(nola).push(row);
    }
  }
  return { byId, byTitle, byNola };
}

function libraryRowForAiring(row = {}, indexes = {}) {
  const ids = [row.manual_match_program_id, row.pledge_program_id, row.program_id]
    .map((value) => text(value))
    .filter(Boolean);
  for (const id of ids) {
    const hit = indexes.byId?.get(id);
    if (hit) return hit;
  }

  const titleKey = S.lookupKey(
    row.matched_library_title
    || row.program_title
    || row.title
    || row.imported_program_title
    || ''
  );
  const nola = nolaKey(row.nola_code);
  if (nola) {
    const matches = indexes.byNola?.get(nola) || [];
    if (titleKey) {
      const exact = matches.find((item) => S.lookupKey(item?.title) === titleKey);
      if (exact) return exact;
    }
    if (matches.length === 1) return matches[0];
  }
  return titleKey ? (indexes.byTitle?.get(titleKey) || null) : null;
}

function canonicalIdentity(row = {}) {
  const sourceCode = nolaKey(row.nola_code);
  if (sourceCode) return `code:${sourceCode}`;
  const title = S.lookupKey(
    row.imported_program_title
    || row.program_title
    || row.title
    || row.matched_library_title
    || ''
  );
  return title ? `title:${title}` : '';
}

function canonicalNaturalKey(row = {}) {
  const station = S.lookupKey(row.station || '');
  const identity = canonicalIdentity(row);
  const date = importedDateKey(row);
  const time = text(row.air_time);
  return identity && date && time ? [station, identity, date, time].join('|') : '';
}

function snapshotKey(row = {}) {
  const sourceName = text(row.source_file_name);
  const sourceKey = text(row.source_file_key);
  const batch = text(row.import_batch_id);
  const range = `${text(row.drive_start_date).slice(0, 10)}|${text(row.drive_end_date).slice(0, 10)}`;
  if (sourceName) return `source-name:${sourceName}|range:${range}`;
  if (sourceKey) return `source-key:${sourceKey}|range:${range}`;
  if (batch) return `batch:${batch}|range:${range}`;
  return `row:${text(row.row_hash || row.id || airingTimestamp(row))}`;
}

function airingTimestamp(row = {}) {
  return Date.parse(row.updated_at || row.created_at || '') || 0;
}

function aggregateSnapshot(entries = []) {
  const unique = [];
  const seen = new Set();
  for (const entry of entries) {
    const row = entry.row || {};
    const identity = text(row.row_hash || row.id || `index:${entry.index}`);
    if (seen.has(identity)) continue;
    seen.add(identity);
    unique.push(entry);
  }
  if (!unique.length) return {};

  const newest = [...unique].sort((a, b) => airingTimestamp(a.row) - airingTimestamp(b.row) || a.index - b.index).slice(-1)[0].row;
  const merged = { ...newest };
  merged.dollars = unique.reduce((sum, entry) => sum + (Number(entry.row?.dollars || 0) || 0), 0);
  merged.pledge_count = unique.reduce((sum, entry) => sum + (Number(entry.row?.pledge_count || 0) || 0), 0);
  const minutes = unique.reduce((sum, entry) => {
    const value = Number(entry.row?.program_minutes || 0);
    return value > 0 ? sum + value : sum;
  }, 0);
  merged.program_minutes = minutes > 0 ? minutes : newest.program_minutes;

  const preferredFields = [
    'manual_match_program_id','pledge_program_id','program_id','matched_library_title',
    'program_title','title','imported_program_title','nola_code','fundraiser_label',
    'drive_start_date','drive_end_date','station'
  ];
  for (const field of preferredFields) {
    const value = unique.map((entry) => entry.row?.[field]).find((candidate) => text(candidate));
    if (value != null && text(value)) merged[field] = value;
  }
  merged.__source_row_count = unique.length;
  return merged;
}

function canonicalizeAirings(rows = []) {
  const naturalGroups = new Map();
  const passthrough = [];

  (rows || []).forEach((row, index) => {
    const naturalKey = canonicalNaturalKey(row);
    if (!naturalKey) {
      passthrough.push({ index, row });
      return;
    }
    if (!naturalGroups.has(naturalKey)) naturalGroups.set(naturalKey, new Map());
    const snapshots = naturalGroups.get(naturalKey);
    const key = snapshotKey(row);
    if (!snapshots.has(key)) snapshots.set(key, {
      rows: [],
      reportEnd: '',
      timestamp: 0,
      lastIndex: index
    });
    const snapshot = snapshots.get(key);
    snapshot.rows.push({ row, index });
    snapshot.reportEnd = [snapshot.reportEnd, text(row.drive_end_date).slice(0, 10)].sort().slice(-1)[0] || '';
    snapshot.timestamp = Math.max(snapshot.timestamp, airingTimestamp(row));
    snapshot.lastIndex = Math.max(snapshot.lastIndex, index);
  });

  const chosen = [...passthrough];
  naturalGroups.forEach((snapshots) => {
    const best = [...snapshots.values()].sort((a, b) =>
      b.reportEnd.localeCompare(a.reportEnd)
      || b.timestamp - a.timestamp
      || b.lastIndex - a.lastIndex
    )[0];
    if (!best) return;
    chosen.push({
      index: Math.min(...best.rows.map((entry) => entry.index)),
      row: aggregateSnapshot(best.rows)
    });
  });

  return chosen.sort((a, b) => a.index - b.index).map((entry) => entry.row);
}

function normalizeAiring(row = {}, indexes = {}) {
  const lib = libraryRowForAiring(row, indexes) || {};
  const dateKey = importedDateKey(row);
  const startMinutes = importedStartMinutes(row);
  const directMinutes = Number(row.program_minutes || 0);
  const minutes = directMinutes > 0 ? directMinutes : Number(libraryRuntimeMinutes(lib) || 0);
  const programId = text(
    lib.id
    ?? row.manual_match_program_id
    ?? row.pledge_program_id
    ?? row.program_id
    ?? ''
  );
  const title = text(
    lib.title
    || row.matched_library_title
    || row.program_title
    || row.title
    || row.imported_program_title
    || 'Untitled program'
  );
  const driveStartDate = text(row.drive_start_date).slice(0, 10);
  const driveEndDate = text(row.drive_end_date).slice(0, 10);
  const fundraiserTitle = text(row.fundraiser_label);

  return {
    programId,
    title,
    topic: text(lib.topic_primary || 'Uncategorized') || 'Uncategorized',
    secondary: text(lib.topic_secondary),
    nola_code: text(lib.nola_code || row.nola_code),
    dateKey,
    startMinutes,
    endMinutes: Number.isFinite(startMinutes) && minutes > 0 ? startMinutes + minutes : null,
    minutes,
    dollars: Number(row.dollars || 0) || 0,
    pledges: Number(row.pledge_count || 0) || 0,
    fundraiserId: driveStartDate && driveEndDate
      ? `${driveStartDate}|${driveEndDate}`
      : (fundraiserTitle || dateKey),
    fundraiserTitle,
    driveStartDate,
    driveEndDate,
    known: true,
    durationMissing: !(minutes > 0),
    countsTowardScheduleMinutes: true
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

function driveDayRates(rows = []) {
  const drives = new Map();
  for (const row of rows) {
    const startDate = row.driveStartDate || row.dateKey;
    const endDate = row.driveEndDate || row.dateKey;
    const driveKey = `${startDate}|${endDate}`;
    if (!drives.has(driveKey)) {
      drives.set(driveKey, {
        startDate,
        endDate,
        season: S.seasonForDate(startDate),
        days: new Map()
      });
    }
    const drive = drives.get(driveKey);
    if (!drive.days.has(row.dateKey)) drive.days.set(row.dateKey, { dollars: 0, minutes: 0 });
    const day = drive.days.get(row.dateKey);
    if (!row.durationMissing && Number(row.minutes) > 0) {
      day.dollars += Number(row.dollars || 0);
      day.minutes += Number(row.minutes || 0);
    }
  }

  return [...drives.values()].map((drive) => {
    const anchor = firstSaturday(drive.startDate, drive.endDate);
    const byOffset = new Map();
    drive.days.forEach((day, dateKey) => {
      const date = S.parseDate(dateKey);
      if (!date || !anchor || !(day.minutes > 0)) return;
      const offset = Math.round((date - anchor) / 86400000);
      byOffset.set(offset, (day.dollars * 60) / day.minutes);
    });
    return { ...drive, byOffset };
  });
}

function buildDayOutlook(schedule = {}, rows = []) {
  const targetSeason = S.seasonForDate(schedule.startDate);
  const drives = driveDayRates(rows);
  let pool = drives.filter((drive) => drive.season === targetSeason);
  let fallback = false;
  if (pool.length < 2) {
    pool = drives;
    fallback = true;
  }

  const allRates = pool.flatMap((drive) => [...drive.byOffset.values()]).filter(Number.isFinite);
  const baseline = S.mean(allRates);
  const targetAnchor = firstSaturday(schedule.startDate, schedule.endDate);
  const start = S.parseDate(schedule.startDate);
  const end = S.parseDate(schedule.endDate);
  const resultRows = [];

  if (start && end) {
    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      const offset = targetAnchor ? Math.round((date - targetAnchor) / 86400000) : null;
      const rates = Number.isFinite(offset)
        ? pool.map((drive) => drive.byOffset.get(offset)).filter(Number.isFinite)
        : [];
      const averageRate = S.mean(rates);
      const ratio = rates.length && Number.isFinite(averageRate) && Number.isFinite(baseline) && baseline > 0
        ? averageRate / baseline
        : null;
      let outlook = 'No comparable history';
      if (rates.length === 1) outlook = 'Thin evidence';
      else if (rates.length >= 2) {
        if (ratio >= 1.25) outlook = 'Usually strong';
        else if (ratio >= 1.05) outlook = 'Usually good';
        else if (ratio >= 0.85) outlook = 'Fair / typical';
        else if (ratio >= 0.65) outlook = 'Usually soft';
        else outlook = 'Usually weak';
      }
      resultRows.push({
        date: S.dateKey(date),
        label: fundraiserDayTitle(schedule, date),
        outlook,
        samples: rates.length,
        averageRate,
        ratio
      });
    }
  }

  const ranked = resultRows
    .filter((row) => row.samples >= 2 && Number.isFinite(row.ratio))
    .sort((a, b) => b.ratio - a.ratio);
  const best = new Set(ranked.slice(0, 2).filter((row) => row.ratio >= 1.05).map((row) => row.date));
  resultRows.forEach((row) => { row.bestBet = best.has(row.date); });

  return { season: targetSeason, fallback, rows: resultRows };
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

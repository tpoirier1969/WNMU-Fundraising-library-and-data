'use strict';

importScripts('programming-strategy-analysis.js?v=0.22.176');

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

function canonicalNaturalKey(row = {}) {
  const station = S.lookupKey(row.station || '');
  const sourceNola = nolaKey(row.nola_code);
  const titleIdentity = S.lookupKey(
    row.imported_program_title
    || row.program_title
    || row.title
    || row.matched_library_title
    || ''
  );
  const identity = sourceNola ? `nola:${sourceNola}` : (titleIdentity ? `title:${titleIdentity}` : '');
  const date = importedDateKey(row);
  const time = text(row.air_time);
  return identity ? [station, identity, date, time].join('|') : '';
}

function canonicalizeAirings(rows = []) {
  const chosen = new Map();
  (rows || []).forEach((row, index) => {
    const key = canonicalNaturalKey(row) || `raw:${text(row.id || index)}`;
    const candidate = {
      row,
      index,
      reportEnd: text(row.drive_end_date).slice(0, 10),
      timestamp: Date.parse(row.updated_at || row.created_at || '') || 0
    };
    const current = chosen.get(key);
    const wins = !current
      || candidate.reportEnd > current.reportEnd
      || (candidate.reportEnd === current.reportEnd && candidate.timestamp > current.timestamp)
      || (candidate.reportEnd === current.reportEnd && candidate.timestamp === current.timestamp && candidate.index > current.index);
    if (wins) chosen.set(key, candidate);
  });
  return [...chosen.values()].sort((a, b) => a.index - b.index).map((entry) => entry.row);
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
  const baseline = S.median(allRates);
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
      const medianRate = S.median(rates);
      const ratio = rates.length && Number.isFinite(medianRate) && Number.isFinite(baseline) && baseline > 0
        ? medianRate / baseline
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
        medianRate,
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

function compactSeason(season = {}) {
  return {
    targetSeason: season.targetSeason,
    holiday: season.holiday,
    holidayCategory: season.holidayCategory,
    holidayInWindow: season.holidayInWindow,
    holidayOutOfSeason: season.holidayOutOfSeason,
    adjustment: season.adjustment,
    notes: Array.isArray(season.notes) ? season.notes : []
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
    reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 4) : [],
    cautions: Array.isArray(item.cautions) ? item.cautions.slice(0, 3) : [],
    season: compactSeason(item.season),
    local: Boolean(item.local),
    drama: {
      isDramaDoc: Boolean(item.drama?.isDramaDoc),
      currentCycle: Boolean(item.drama?.currentCycle),
      olderCycle: Boolean(item.drama?.olderCycle),
      cycleUnknown: Boolean(item.drama?.cycleUnknown)
    },
    programmer: {
      rating: item.programmer?.rating || '',
      label: item.programmer?.label || ''
    },
    newTitle: Boolean(item.newTitle),
    reviewedNew: Boolean(item.reviewedNew)
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
      windowHistory: {
        rows: Number(slot.windowHistory?.rates?.length || slot.windowHistory?.rows || 0),
        medianRate: Number.isFinite(slot.windowHistory?.medianRate) ? slot.windowHistory.medianRate : null
      },
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
      season: compactSeason(item.season)
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
    rights: {
      unavailable: (strategy.rights?.unavailable || []).slice(0, 20),
      partial: (strategy.rights?.partial || []).slice(0, 20)
    },
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

    progress(requestId, 'days', 'Calculating fundraiser-day outlook…');
    phase = nowMs();
    const dayOutlook = buildDayOutlook(schedule, rows);
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

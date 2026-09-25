(() => {
  'use strict';

  const txt = (v) => String(v ?? '').trim();
  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
  const keyTitle = (v) => txt(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const rowDate = (r) => txt(r.dateKey ?? r.date_key ?? r.air_date ?? r.drive_date ?? r.aired_at).slice(0, 10);
  const rowTitle = (r) => txt(r.title ?? r.programTitle ?? r.program_title ?? r.matched_library_title ?? r.imported_program_title ?? 'Untitled program');
  const rowId = (r) => txt(r.programId ?? r.program_id ?? r.pledge_program_id ?? r.manual_match_program_id);
  const itemKey = (x) => {
    const title = keyTitle(x.title ?? x.programTitle ?? x.program_title);
    if (title) return `title:${title}`;
    const id = txt(x.programId ?? x.program_id ?? x.id);
    return id ? `id:${id}` : '';
  };
  const median = (values) => {
    const a = values.filter(Number.isFinite).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const percentile = (values, p = .75) => {
    const a = values.filter(Number.isFinite).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    if (a.length === 1) return a[0];
    const pos = Math.max(0, Math.min(1, p)) * (a.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
  };
  function dayBefore(value) {
    const s = txt(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    const d = new Date(`${s}T12:00:00`);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function rowInRecommendationInventory(row = {}, strategy = {}) {
    const windows = (strategy.windows || []).filter((slot) =>
      txt(slot.date)
      && Number.isFinite(Number(slot.startMinutes))
      && Number.isFinite(Number(slot.endMinutes))
    );
    if (!windows.length) return true;
    const date = rowDate(row);
    const start = num(row.startMinutes ?? row.start_minutes);
    if (!date || start == null) return false;
    return windows.some((slot) =>
      !slot.blocked
      && txt(slot.date) === date
      && start >= Number(slot.startMinutes)
      && start < Number(slot.endMinutes)
    );
  }

  function actualTitleOutcomes(rows = [], schedule = {}, strategy = {}) {
    const start = txt(schedule.startDate ?? schedule.start_date), end = txt(schedule.endDate ?? schedule.end_date);
    const groups = new Map();
    for (const row of rows) {
      const date = rowDate(row), minutes = num(row.minutes ?? row.programMinutes ?? row.program_minutes) || 0;
      if (!date || (start && date < start) || (end && date > end) || minutes <= 0 || row.durationMissing || row.countsTowardScheduleMinutes === false || row.known === false || row.unmatchedImported) continue;
      const programId = rowId(row), title = rowTitle(row), titleKey = keyTitle(title), key = titleKey ? `title:${titleKey}` : `id:${programId}`;
      const x = groups.get(key) || { key, programId, title, topic: txt(row.topic ?? row.topic_primary ?? 'Uncategorized') || 'Uncategorized', airings: 0, recommendationInventoryAirings: 0, outsideRecommendationInventoryAirings: 0, minutes: 0, dollars: 0, pledges: 0 };
      x.airings += 1;
      if (rowInRecommendationInventory(row, strategy)) x.recommendationInventoryAirings += 1;
      else x.outsideRecommendationInventoryAirings += 1;
      x.minutes += minutes;
      x.dollars += num(row.dollars ?? row.on_air_dollars) || 0;
      x.pledges += num(row.pledges ?? row.pledge_count ?? row.on_air_pledges) || 0;
      groups.set(key, x);
    }
    return [...groups.values()].map((x) => ({ ...x, rate: x.dollars / (x.minutes / 60), averagePledge: x.pledges ? x.dollars / x.pledges : null }))
      .sort((a, b) => b.rate - a.rate || b.dollars - a.dollars || a.title.localeCompare(b.title));
  }

  function flattenRecommendations(strategy = {}, limit = 20) {
    const map = new Map();
    for (const slot of strategy.windows || []) {
      if (slot.blocked) continue;
      for (const rec of slot.recommendations || []) {
        const key = itemKey(rec);
        if (!key || key === 'title:') continue;
        const score = num(rec.score), x = map.get(key) || { key, programId: txt(rec.programId ?? rec.program_id), title: txt(rec.title), topic: txt(rec.topic || 'Uncategorized') || 'Uncategorized', score, fit: txt(rec.fit), confidence: txt(rec.confidence), reasons: rec.reasons || [], cautions: rec.cautions || [], windows: 0, normalWindows: 0, experimentalWindows: 0, recommendedWindows: [] };
        if (score != null && (x.score == null || score > x.score)) Object.assign(x, { score, fit: txt(rec.fit), confidence: txt(rec.confidence), reasons: rec.reasons || x.reasons, cautions: rec.cautions || x.cautions });
        x.windows += 1;
        slot.experimental ? x.experimentalWindows += 1 : x.normalWindows += 1;
        x.recommendedWindows.push({
          date: txt(slot.date),
          startMinutes: num(slot.startMinutes),
          endMinutes: num(slot.endMinutes),
          label: txt(slot.label),
          weekday: txt(slot.weekday),
          experimental: !!slot.experimental
        });
        map.set(key, x);
      }
    }
    return [...map.values()].sort((a, b) => (b.score ?? -999) - (a.score ?? -999) || b.normalWindows - a.normalWindows || b.windows - a.windows || a.title.localeCompare(b.title)).slice(0, Math.max(1, Number(limit) || 20));
  }

  function usableActualRows(rows = [], schedule = {}) {
    const start = txt(schedule.startDate ?? schedule.start_date), end = txt(schedule.endDate ?? schedule.end_date);
    return (rows || []).filter((row) => {
      const date = rowDate(row), minutes = num(row.minutes ?? row.programMinutes ?? row.program_minutes) || 0;
      return Boolean(date)
        && (!start || date >= start)
        && (!end || date <= end)
        && minutes > 0
        && !row.durationMissing
        && row.countsTowardScheduleMinutes !== false
        && row.known !== false
        && !row.unmatchedImported;
    });
  }

  function recommendationMatchedRows(rec = {}, rows = [], schedule = {}) {
    const titleKey = keyTitle(rec.title);
    const programId = txt(rec.programId ?? rec.program_id);
    const windows = rec.recommendedWindows || [];
    if (!windows.length) return [];
    return usableActualRows(rows, schedule).filter((row) => {
      const rowMatches = titleKey
        ? keyTitle(rowTitle(row)) === titleKey
        : Boolean(programId && rowId(row) === programId);
      if (!rowMatches) return false;
      const date = rowDate(row);
      const start = num(row.startMinutes ?? row.start_minutes);
      if (!date || start == null) return false;
      return windows.some((slot) =>
        txt(slot.date) === date
        && Number.isFinite(Number(slot.startMinutes))
        && Number.isFinite(Number(slot.endMinutes))
        && start >= Number(slot.startMinutes)
        && start < Number(slot.endMinutes)
      );
    });
  }

  function rowAggregate(rows = []) {
    const minutes = rows.reduce((sum, row) => sum + (num(row.minutes ?? row.programMinutes ?? row.program_minutes) || 0), 0);
    const dollars = rows.reduce((sum, row) => sum + (num(row.dollars ?? row.on_air_dollars) || 0), 0);
    const pledges = rows.reduce((sum, row) => sum + (num(row.pledges ?? row.pledge_count ?? row.on_air_pledges) || 0), 0);
    return {
      airings: rows.length,
      minutes,
      dollars,
      pledges,
      rate: minutes > 0 ? dollars / (minutes / 60) : null
    };
  }

  function correlation(items = []) {
    const a = items.filter((x) => Number.isFinite(x.score) && Number.isFinite(x.rate));
    if (a.length < 3) return null;
    const mx = a.reduce((s, x) => s + x.score, 0) / a.length, my = a.reduce((s, x) => s + x.rate, 0) / a.length;
    let n = 0, dx = 0, dy = 0;
    for (const x of a) { const vx = x.score - mx, vy = x.rate - my; n += vx * vy; dx += vx * vx; dy += vy * vy; }
    return dx && dy ? n / Math.sqrt(dx * dy) : null;
  }

  function evaluate({ strategy = {}, actualRows = [], schedule = {}, recommendationLimit = 20 } = {}) {
    const outcomes = actualTitleOutcomes(actualRows, schedule, strategy), recommendations = flattenRecommendations(strategy, recommendationLimit);
    const byKey = new Map(outcomes.map((x) => [x.key, x])), byTitle = new Map(outcomes.map((x) => [keyTitle(x.title), x]));
    const rates = outcomes.map((x) => x.rate), medianRate = median(rates), topThreshold = percentile(rates, .75);
    const actualRank = new Map(outcomes.map((x, i) => [x.key, i + 1]));
    const recommendationResults = recommendations.map((rec, i) => {
      const actual = byKey.get(rec.key) || byTitle.get(keyTitle(rec.title)) || null;
      const matchedRows = recommendationMatchedRows(rec, actualRows, schedule);
      const matched = rowAggregate(matchedRows);
      return {
        ...rec,
        recommendationRank: i + 1,
        observed: !!actual,
        actualRate: actual?.rate ?? null,
        actualDollars: actual?.dollars ?? null,
        actualPledges: actual?.pledges ?? null,
        actualAirings: actual?.airings ?? null,
        actualRank: actual ? actualRank.get(actual.key) : null,
        aboveMedian: actual && medianRate != null ? actual.rate > medianRate : null,
        topQuartile: actual && topThreshold != null ? actual.rate > 0 && actual.rate >= topThreshold : null,
        observedInRecommendedWindow: matched.airings > 0,
        matchedWindowAirings: matched.airings,
        matchedWindowRate: matched.rate,
        matchedWindowDollars: matched.dollars,
        matchedWindowPledges: matched.pledges,
        matchedWindowAboveMedian: matched.rate != null && medianRate != null ? matched.rate > medianRate : null,
        matchedWindowTopQuartile: matched.rate != null && topThreshold != null ? matched.rate > 0 && matched.rate >= topThreshold : null
      };
    });
    const recKeys = new Set(recommendations.map((x) => x.key)), recTitles = new Set(recommendations.map((x) => keyTitle(x.title)));
    const topActualAll = outcomes.filter((x) => topThreshold != null && x.rate > 0 && x.rate >= topThreshold).map((x) => {
      const rec = recommendationResults.find((r) => r.key === x.key || keyTitle(r.title) === keyTitle(x.title));
      return { ...x, recommended: recKeys.has(x.key) || recTitles.has(keyTitle(x.title)), recommendationRank: rec?.recommendationRank ?? null, inRecommendationInventory: x.recommendationInventoryAirings > 0 };
    });
    const topActual = topActualAll.filter((x) => x.inRecommendationInventory);
    const strongOutsideRecommendationInventory = topActualAll.filter((x) => !x.inRecommendationInventory);
    const tested = recommendationResults.filter((x) => x.observed);
    const windowTested = recommendationResults.filter((x) => x.observedInRecommendedWindow);
    const missed = topActual.filter((x) => !x.recommended);
    const driveMinutes = outcomes.reduce((s, x) => s + x.minutes, 0), driveDollars = outcomes.reduce((s, x) => s + x.dollars, 0);
    const expectedCutoff = dayBefore(schedule.startDate ?? schedule.start_date), cutoff = txt(strategy.cutoff);
    return {
      schedule: { id: txt(schedule.id), title: txt(schedule.title), startDate: txt(schedule.startDate ?? schedule.start_date), endDate: txt(schedule.endDate ?? schedule.end_date) },
      cutoff, expectedCutoff, leakageSafe: !!(cutoff && expectedCutoff && cutoff <= expectedCutoff),
      drive: { titleCount: outcomes.length, dollars: driveDollars, minutes: driveMinutes, rate: driveMinutes ? driveDollars / (driveMinutes / 60) : null, medianTitleRate: medianRate, topQuartileThreshold: topThreshold },
      summary: {
        recommendedTitles: recommendations.length,
        testedRecommendations: tested.length,
        untestedRecommendations: recommendations.length - tested.length,
        aboveMedianHits: tested.filter((x) => x.aboveMedian).length,
        topQuartileHits: tested.filter((x) => x.topQuartile).length,
        windowTestedRecommendations: windowTested.length,
        windowAboveMedianHits: windowTested.filter((x) => x.matchedWindowAboveMedian).length,
        windowTopQuartileHits: windowTested.filter((x) => x.matchedWindowTopQuartile).length,
        allTopActualTitles: topActualAll.length,
        topActualTitles: topActual.length,
        strongOutsideRecommendationInventory: strongOutsideRecommendationInventory.length,
        topActualCovered: topActual.length - missed.length,
        topActualCoverage: topActual.length ? (topActual.length - missed.length) / topActual.length : null,
        scoreRateCorrelation: correlation(tested.map((x) => ({ score: x.score, rate: x.actualRate }))),
        windowScoreRateCorrelation: correlation(windowTested.map((x) => ({ score: x.score, rate: x.matchedWindowRate })))
      },
      recommendationResults,
      topActual,
      missedTopPerformers: missed,
      strongOutsideRecommendationInventory,
      underperformingRecommendations: tested.filter((x) => medianRate != null && x.actualRate < medianRate).sort((a, b) => (b.score ?? -999) - (a.score ?? -999)),
      untestedRecommendations: recommendationResults.filter((x) => !x.observed),
      notes: [
        'Title-level results show whether a recommended program worked somewhere in the fundraiser; recommended-window results are the stricter test of the scheduling recommendation itself.',
        'Recommended titles that were not aired remain counterfactuals and are not scored as wins or losses.',
        'Strong actual performers that aired only outside the model’s eligible recommendation windows are shown separately and do not count as missed scheduling choices.',
        'The recommendation cutoff must be no later than the day before the fundraiser begins.',
        'Historical title availability depends on titles and rights dates still present in the current Program Library.'
      ]
    };
  }

  globalThis.WNMUStrategyBacktest = Object.freeze({ rowInRecommendationInventory, actualTitleOutcomes, flattenRecommendations, recommendationMatchedRows, rowAggregate, evaluate });
})();
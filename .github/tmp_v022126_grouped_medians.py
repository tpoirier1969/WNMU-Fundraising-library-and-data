from pathlib import Path

analysis_path = Path('assets/js/one-sheet-analysis.js')
reports_path = Path('assets/js/one-sheet-reports.js')
hardening_path = Path('tests/one-sheet-analysis-hardening.test.mjs')
refinement_path = Path('tests/one-sheet-report-refinements.test.mjs')
reports_test_path = Path('tests/one-sheet-reports.test.mjs')

analysis = analysis_path.read_text()
start = analysis.index('  function historicalRanking(analyses = [], dimension, options = {}) {')
end = analysis.index('\n  function missingDurationPrograms(analyses = []) {', start)
new_fn = r'''  function historicalRanking(analyses = [], dimension, options = {}) {
    if (dimension === 'season') return historicalSeasonRanking(analyses, options);
    const groups = new Map();

    (analyses || []).forEach((analysis) => {
      const fundraiserId = text(analysis?.schedule?.id || analysis?.schedule?.title);
      const fundraiserTitle = text(analysis?.schedule?.title);
      const localGroups = new Map();

      (analysis?.placementRows || []).forEach((row) => {
        if (row?.countsTowardScheduleMinutes === false || row?.unmatchedImported) return;
        const enriched = {
          ...row,
          fundraiserId,
          fundraiserTitle,
          season: canonicalCategory(analysis?.schedule?.season || seasonForDate(row?.dateKey), 'Special events'),
          weekpart: weekpartLabel(row?.dateKey),
          startBucket: Number.isFinite(Number(row?.startMinutes))
            ? Math.floor(((((Number(row.startMinutes) % 1440) + 1440) % 1440) / 30)) * 30
            : null,
          breakType: row?.liveBreak ? 'Live break' : 'Pre-recorded break'
        };
        const key = historicalGroupValue(enriched, dimension);
        if (!key) return;
        const normalized = dimension === 'startTime' ? key : lookupKey(key);
        if (!localGroups.has(normalized)) {
          localGroups.set(normalized, {
            key,
            airings: 0,
            totalDollars: 0,
            rateAirings: 0,
            rateDollars: 0,
            rateMinutes: 0,
            titles: new Set(),
            rateTitles: new Set(),
            complete: true
          });
        }
        const local = localGroups.get(normalized);
        local.airings += 1;
        if (row?.known) local.totalDollars += Number(row?.dollars || 0);
        const title = lookupKey(row?.title || row?.plannedTitle || '');
        if (title) local.titles.add(title);
        if (!row?.known || row?.durationMissing || !(Number(row?.minutes) > 0)) {
          local.complete = false;
          return;
        }
        local.rateAirings += 1;
        local.rateDollars += Number(row?.dollars || 0);
        local.rateMinutes += Number(row?.minutes || 0);
        if (title) local.rateTitles.add(title);
      });

      localGroups.forEach((local, normalized) => {
        if (!groups.has(normalized)) {
          groups.set(normalized, {
            key: local.key,
            airings: 0,
            rateAirings: 0,
            totalDollars: 0,
            rateDollars: 0,
            rateMinutes: 0,
            rates: [],
            fundraisers: new Set(),
            titles: new Set(),
            rateFundraisers: new Set(),
            rateTitles: new Set()
          });
        }
        const item = groups.get(normalized);
        item.airings += local.airings;
        item.totalDollars += local.totalDollars;
        item.fundraisers.add(fundraiserId);
        local.titles.forEach((title) => item.titles.add(title));
        if (!local.complete || !(local.rateMinutes > 0) || !local.rateAirings) return;
        item.rateAirings += local.rateAirings;
        item.rateDollars += local.rateDollars;
        item.rateMinutes += local.rateMinutes;
        item.rates.push(dollarsPerHour(local.rateDollars, local.rateMinutes));
        item.rateFundraisers.add(fundraiserId);
        local.rateTitles.forEach((title) => item.rateTitles.add(title));
      });
    });

    const defaultMinimums = dimension === 'startTime'
      ? { minAirings: 5, minFundraisers: 3, minTitles: 3 }
      : { minAirings: 3, minFundraisers: 2, minTitles: 1 };
    const minAirings = Number(options.minAirings ?? defaultMinimums.minAirings);
    const minFundraisers = Number(options.minFundraisers ?? defaultMinimums.minFundraisers);
    const minTitles = Number(options.minTitles ?? defaultMinimums.minTitles);

    return [...groups.values()].map((item) => ({
      key: item.key,
      airings: item.airings,
      rateAirings: item.rateAirings,
      fundraisers: item.rateFundraisers.size,
      titles: item.rateTitles.size,
      broadcastDollars: item.totalDollars,
      medianDollarsPerHour: median(item.rates),
      averageDollarsPerHour: item.rates.length ? item.rates.reduce((sum, value) => sum + value, 0) / item.rates.length : 0,
      minutes: item.rateMinutes,
      rateObservations: item.rates.length,
      sufficient: item.rateAirings >= minAirings && item.rateFundraisers.size >= minFundraisers && item.rateTitles.size >= minTitles
    })).filter((item) => item.sufficient)
      .sort((a, b) => b.medianDollarsPerHour - a.medianDollarsPerHour || b.fundraisers - a.fundraisers || b.rateAirings - a.rateAirings || String(a.key).localeCompare(String(b.key)));
  }
'''
analysis_path.write_text(analysis[:start] + new_fn + analysis[end:])

reports = reports_path.read_text()
replacements = {
"<div class=\"historical-control-copy\"><strong>All saved fundraiser history</strong><span>Historical rankings use median Broadcast $/hour and minimum evidence rules.</span></div>":
"<div class=\"historical-control-copy\"><strong>All saved fundraiser history</strong><span>Historical rankings use fundraiser-balanced median Broadcast $/hour and minimum evidence rules.</span></div>",
"const medianHeading = options.rateUnit === 'fundraiser' ? 'Median fundraiser $/hr' : 'Median $/hr';\n    const averageHeading = options.rateUnit === 'fundraiser' ? 'Avg fundraiser $/hr' : 'Avg $/hr';":
"const medianHeading = 'Median fundraiser $/hr';\n    const averageHeading = 'Avg fundraiser $/hr';",
"Only schedule-reconciled ${weekpart.toLowerCase()} 30-minute start slots with at least 5 rate-valid airings, 3 fundraisers, and 3 distinct titles are shown. Unmatched imported results remain in fundraiser totals but are excluded from start-time rankings. Sparse slots are excluded rather than displayed in the ranking.":
"Only schedule-reconciled ${weekpart.toLowerCase()} 30-minute start slots with at least 5 rate-valid airings, 3 fundraisers, and 3 distinct titles are shown. Each fundraiser contributes one slot-specific $/hour observation regardless of how many times that start slot occurred. Unmatched imported results remain in fundraiser totals but are excluded from performance rankings. Sparse slots are excluded rather than displayed in the ranking.",
"historicalRankingTable(analyses, 'topic', 'Topic performance', 'Topics with at least 3 rate-valid airings across at least 2 fundraisers, ranked by median Broadcast $/hour.'),":
"historicalRankingTable(analyses, 'topic', 'Topic performance', 'Each fundraiser contributes one topic-specific $/pledge-hour observation; topics require at least 3 rate-valid airings across at least 2 fundraisers.'),",
"historicalRankingTable(analyses, 'subtopic', 'Subtopic performance', 'Subtopics with at least 3 rate-valid airings across at least 2 fundraisers, ranked by median Broadcast $/hour.'),":
"historicalRankingTable(analyses, 'subtopic', 'Subtopic performance', 'Each fundraiser contributes one subtopic-specific $/pledge-hour observation; subtopics require at least 3 rate-valid airings across at least 2 fundraisers.'),",
"historicalRankingTable(analyses, 'weekpart', 'Weekday / Saturday / Sunday', 'Performance by calendar day type, ranked by median Broadcast $/hour.'),":
"historicalRankingTable(analyses, 'weekpart', 'Weekday / Saturday / Sunday', 'Each fundraiser contributes one aggregated weekday, Saturday, or Sunday $/pledge-hour observation.'),",
"historicalRankingTable(analyses, 'daypart', 'Daypart performance', 'Morning, afternoon, early evening, prime, and overnight performance.'),":
"historicalRankingTable(analyses, 'daypart', 'Daypart performance', 'Each fundraiser contributes one $/pledge-hour observation for each daypart it used: morning, afternoon, early evening, prime, or overnight.'),",
"historicalRankingTable(analyses, 'breakType', 'Live break vs pre-recorded break', 'Uses saved schedule live-break flags only. Imported rows without schedule flags are not used in this comparison.'),":
"historicalRankingTable(analyses, 'breakType', 'Live break vs pre-recorded break', 'Each fundraiser contributes one rate per break type. Uses saved schedule live-break flags only; unmatched imported rows are excluded.'),",
"historicalRankingTable(analyses, 'distributor', 'Distributor performance', 'Distributors with at least 3 rate-valid airings across at least 2 fundraisers.')":
"historicalRankingTable(analyses, 'distributor', 'Distributor performance', 'Each fundraiser contributes one distributor-specific $/pledge-hour observation; distributors require at least 3 rate-valid airings across at least 2 fundraisers.')",
"Historical rankings use median Broadcast $/hour. Rate calculations exclude unknown results and true program airings with missing duration from both numerator and denominator. Non-Specific Pledges are not treated as incomplete program/topic data. Start-time rankings are evaluated separately for Weekdays, Saturdays, and Sundays; each requires 5 rate-valid airings across 3 rate-valid fundraisers and 3 distinct rate-valid titles. Imported results that cannot be reconciled to a saved schedule placement remain in fundraiser totals but are excluded from start-time rankings.":
"Historical rankings use fundraiser-balanced median Broadcast $/hour: each fundraiser contributes at most one rate observation to each category or start-time slot, regardless of how many individual programs it aired there. A category is omitted for a fundraiser if any of its scheduled rows in that category has an unknown result or missing duration. Non-Specific Pledges are not treated as incomplete program/topic data. Start-time rankings are evaluated separately for Weekdays, Saturdays, and Sundays; each requires 5 rate-valid airings across 3 rate-valid fundraisers and 3 distinct rate-valid titles. Imported results that cannot be reconciled to a saved schedule placement remain in fundraiser totals but are excluded from historical performance rankings."
}
for old, new in replacements.items():
    if old not in reports:
        raise SystemExit(f'report replacement not found: {old[:90]}')
    reports = reports.replace(old, new, 1)
reports_path.write_text(reports)

# Add regression proving individual zero-heavy airings no longer force a false zero median.
hardening = hardening_path.read_text()
anchor = "const reportSource = fs.readFileSync(new URL('../assets/js/one-sheet-reports.js', import.meta.url), 'utf8');"
if hardening.count(anchor) != 1:
    raise SystemExit('hardening reportSource anchor not unique')
regression = r'''{
  const zeroHeavyWeekday = [
    {
      schedule: { id: 'weekday-a', title: 'Weekday A' },
      placementRows: [
        ...Array.from({ length: 8 }, (_unused, index) => ({
          dateKey: '2026-08-10', startMinutes: 600 + (index * 30), minutes: 60,
          known: true, durationMissing: false, countsTowardScheduleMinutes: true,
          title: `A Zero ${index}`, dollars: 0, pledges: 0
        })),
        { dateKey: '2026-08-10', startMinutes: 1200, minutes: 60, known: true, durationMissing: false, countsTowardScheduleMinutes: true, title: 'A Winner', dollars: 1000, pledges: 5 }
      ]
    },
    { schedule: { id: 'weekday-b', title: 'Weekday B' }, placementRows: [{ dateKey: '2026-08-11', startMinutes: 1200, minutes: 60, known: true, durationMissing: false, countsTowardScheduleMinutes: true, title: 'B', dollars: 200, pledges: 2 }] },
    { schedule: { id: 'weekday-c', title: 'Weekday C' }, placementRows: [{ dateKey: '2026-08-12', startMinutes: 1200, minutes: 60, known: true, durationMissing: false, countsTowardScheduleMinutes: true, title: 'C', dollars: 300, pledges: 3 }] }
  ];
  const weekday = A.historicalRanking(zeroHeavyWeekday, 'weekpart', { minAirings: 1, minFundraisers: 1, minTitles: 1 }).find((row) => row.key === 'Weekday');
  assert.ok(weekday);
  assert.equal(Math.round(weekday.medianDollarsPerHour), 200, 'weekday median must be based on one aggregated rate per fundraiser rather than individual zero-heavy airings');
  assert.equal(weekday.rateObservations, 3, 'each fundraiser contributes one weekday rate observation');
  assert.equal(weekday.fundraisers, 3);
  assert.equal(weekday.rateAirings, 11, 'airing count remains visible even though statistical weighting is fundraiser-balanced');
}

'''
hardening_path.write_text(hardening.replace(anchor, regression + anchor, 1))

refinement = refinement_path.read_text()
needle = "assert.match(reports, /Historical Fundraiser Analytics/);\n"
insert = "assert.match(reports, /Historical Fundraiser Analytics/);\nassert.match(reports, /fundraiser-balanced median Broadcast \\$\\/hour/);\nassert.match(reports, /Each fundraiser contributes one aggregated weekday/);\nassert.match(reports, /Each fundraiser contributes one distributor-specific/);\n"
if needle not in refinement:
    raise SystemExit('refinement historical assertion anchor missing')
refinement_path.write_text(refinement.replace(needle, insert, 1))

report_test = reports_test_path.read_text()
needle = "assert.match(reportSource, /Historical Fundraiser Analytics/);\n"
insert = "assert.match(reportSource, /Historical Fundraiser Analytics/);\nassert.match(reportSource, /fundraiser-balanced median Broadcast \\$\\/hour/);\nassert.match(reportSource, /each fundraiser contributes at most one rate observation/i);\n"
if needle not in report_test:
    raise SystemExit('one-sheet-reports historical assertion anchor missing')
reports_test_path.write_text(report_test.replace(needle, insert, 1))

# Guardrails
analysis_after = analysis_path.read_text()
reports_after = reports_path.read_text()
for token in ['rateObservations: item.rates.length', 'row?.countsTowardScheduleMinutes === false || row?.unmatchedImported', 'item.rates.push(dollarsPerHour(local.rateDollars, local.rateMinutes))']:
    if token not in analysis_after:
        raise SystemExit(f'missing grouped-median token: {token}')
for token in ['fundraiser-balanced median Broadcast $/hour', 'Each fundraiser contributes one aggregated weekday', 'excluded from historical performance rankings']:
    if token not in reports_after:
        raise SystemExit(f'missing report copy token: {token}')
print('fundraiser-balanced historical median update complete')

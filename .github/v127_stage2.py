from pathlib import Path
import re

root = Path('.')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, found {count}')
    print(f'OK {label}')
    return text.replace(old, new, 1)


def regex_once(text, pattern, repl, label):
    new, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, found {count}')
    print(f'OK {label}')
    return new


p = root / 'assets/js/ui-analytics.js'
s = p.read_text()

s = replace_once(
    s,
    "  const START_TIME_MIN_TITLES = 3;\n  const DURATION_MISMATCH_TOLERANCE_MINUTES = 10;\n",
    "  const START_TIME_MIN_TITLES = 3;\n  const RATE_MIN_AIRINGS = 3;\n  const RATE_MIN_FUNDRAISERS = 2;\n  const RATE_MIN_TITLES = 1;\n  const DURATION_MISMATCH_TOLERANCE_MINUTES = 10;\n",
    'shared historical evidence thresholds'
)

marker = "\n\n  function formatTimeFromMinutes(value) {\n"
helpers = r'''

  function fundraiserRateKey(record = {}) {
    const scheduleId = text(record.scheduleId || '');
    if (scheduleId) return `schedule:${scheduleId}`;
    const scheduleTitle = text(record.scheduleTitle || record.fundraiser || '');
    if (scheduleTitle) return `title:${lookupKey(scheduleTitle)}`;
    const start = text(record.row?.drive_start_date || '').slice(0, 10);
    const end = text(record.row?.drive_end_date || '').slice(0, 10);
    if (start || end) return `range:${start}|${end}`;
    return `season:${text(record.seasonYear || '')}`;
  }

  function fundraiserRateObservations(records = []) {
    const observations = [];
    groupBy(records.filter((record) => !record?.isNonSpecific), fundraiserRateKey).forEach((fundraiserRecords, key) => {
      if (!fundraiserRecords.length) return;
      const durations = fundraiserRecords.map((record) => Number(durationFromRecord(record) || 0));
      // Match Historical Analytics: if any airing in this fundraiser/group lacks a usable
      // internal length, the fundraiser does not become a partial rate observation.
      if (durations.some((minutes) => !(minutes > 0))) return;
      const minutes = durations.reduce((sum, value) => sum + value, 0);
      if (!(minutes > 0)) return;
      const dollars = fundraiserRecords.reduce((sum, record) => sum + Number(record.dollars || 0), 0);
      const pledges = fundraiserRecords.reduce((sum, record) => sum + Number(record.pledges || 0), 0);
      const titles = new Set(fundraiserRecords.map((record) => programIdentityKey(record)).filter(Boolean));
      observations.push({
        key,
        dollars,
        pledges,
        minutes,
        rate: (dollars * 60) / minutes,
        airings: fundraiserRecords.length,
        titles,
        records: fundraiserRecords
      });
    });
    return observations;
  }

  function fundraiserBalancedRateSummary(title, records = [], options = {}) {
    const base = summarizeGroup(title, records);
    const observations = fundraiserRateObservations(records);
    const rates = observations.map((item) => item.rate);
    const rateAirings = observations.reduce((sum, item) => sum + item.airings, 0);
    const rateMinutes = observations.reduce((sum, item) => sum + item.minutes, 0);
    const rateDollars = observations.reduce((sum, item) => sum + item.dollars, 0);
    const ratePledges = observations.reduce((sum, item) => sum + item.pledges, 0);
    const titleKeys = new Set();
    observations.forEach((item) => item.titles.forEach((key) => titleKeys.add(key)));
    const minAirings = Number(options.minAirings ?? RATE_MIN_AIRINGS);
    const minFundraisers = Number(options.minFundraisers ?? RATE_MIN_FUNDRAISERS);
    const minTitles = Number(options.minTitles ?? RATE_MIN_TITLES);
    const medianRate = medianValue(rates);
    const averageRate = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length : 0;
    const pooledRate = rateMinutes > 0 ? (rateDollars * 60) / rateMinutes : 0;
    return {
      ...base,
      medianRate,
      averageRate,
      pooledRate,
      median: medianRate,
      avg: averageRate,
      rateAirings,
      rateMinutes,
      rateDollars,
      ratePledges,
      fundraiserCount: observations.length,
      titleCount: titleKeys.size,
      rateObservations: observations,
      weak: rateAirings < minAirings || observations.length < minFundraisers || titleKeys.size < minTitles
    };
  }

  function pairedStartTimeComparison(records = [], firstMinutes = 1200, secondMinutes = 1260) {
    const bucket = (value) => Number.isFinite(Number(value)) ? Math.floor(Number(value) / 30) * 30 : null;
    const first = fundraiserRateObservations(records.filter((record) => bucket(record.startMinutes) === firstMinutes));
    const second = fundraiserRateObservations(records.filter((record) => bucket(record.startMinutes) === secondMinutes));
    const firstByFundraiser = new Map(first.map((item) => [item.key, item]));
    const secondByFundraiser = new Map(second.map((item) => [item.key, item]));
    const pairs = [...firstByFundraiser.keys()]
      .filter((key) => secondByFundraiser.has(key))
      .map((key) => ({ key, first: firstByFundraiser.get(key), second: secondByFundraiser.get(key) }));
    const differences = pairs.map((pair) => pair.second.rate - pair.first.rate);
    const firstRates = pairs.map((pair) => pair.first.rate);
    const secondRates = pairs.map((pair) => pair.second.rate);
    return {
      firstMinutes,
      secondMinutes,
      pairedFundraisers: pairs.length,
      firstMedianRate: medianValue(firstRates),
      secondMedianRate: medianValue(secondRates),
      medianDifference: medianValue(differences),
      firstWins: pairs.filter((pair) => pair.first.rate > pair.second.rate).length,
      secondWins: pairs.filter((pair) => pair.second.rate > pair.first.rate).length,
      ties: pairs.filter((pair) => pair.second.rate === pair.first.rate).length,
      pairs
    };
  }
'''
s = replace_once(s, marker, helpers + marker, 'fundraiser-balanced rate helpers')

s = regex_once(
    s,
    r"  function startTimeEvidence\(records = \[\]\) \{.*?\n  \}\n\n  function startTimeRead",
    """  function startTimeEvidence(records = []) {
    const summary = fundraiserBalancedRateSummary('Start time', records, {
      minAirings: START_TIME_MIN_AIRINGS,
      minFundraisers: START_TIME_MIN_FUNDRAISERS,
      minTitles: START_TIME_MIN_TITLES
    });
    return {
      rateAirings: summary.rateAirings,
      fundraiserCount: summary.fundraiserCount,
      titleCount: summary.titleCount,
      sufficient: !summary.weak
    };
  }

  function startTimeRead""",
    'start-time evidence uses fundraiser observations'
)

s = regex_once(
    s,
    r"  function startTimeRead\(rows = \[\]\) \{.*?\n  \}\n\n  function rowsStartTimes",
    """  function startTimeRead(rows = []) {
    if (!rows.length) return 'No start-time records match the current filters.';
    const useful = rows.filter((row) => !row.weak);
    const paired = pairedStartTimeComparison(filteredRecordsFor('startTimes'), 1200, 1260);
    const pairedRead = paired.pairedFundraisers
      ? `<br><br><b>8:00 PM vs 9:00 PM inside the same fundraisers:</b> ${formatNumber(paired.pairedFundraisers)} fundraiser(s) contain rate-valid evidence for both slots. 8:00 PM median: <b>${formatMoney(paired.firstMedianRate)} / pledge hr</b>; 9:00 PM median: <b>${formatMoney(paired.secondMedianRate)} / pledge hr</b>. Median within-fundraiser difference (9 PM minus 8 PM): <b>${formatMoney(paired.medianDifference)} / pledge hr</b>. 9 PM wins ${formatNumber(paired.secondWins)}, 8 PM wins ${formatNumber(paired.firstWins)}, ties ${formatNumber(paired.ties)}.`
      : '<br><br><b>8:00 PM vs 9:00 PM:</b> No fundraiser currently has rate-valid evidence for both slots under these filters, so the app will not manufacture a paired conclusion.';
    if (!useful.length) {
      return `Start-time performance is grouped in <b>30-minute actual program-start buckets</b>. Each fundraiser contributes at most one $/pledge-hour observation to a slot, so a long fundraiser cannot overpower shorter fundraisers by supplying more airings. No current bucket meets the Historical Analytics threshold of <b>${START_TIME_MIN_AIRINGS} rate-valid airings across ${START_TIME_MIN_FUNDRAISERS} fundraisers and ${START_TIME_MIN_TITLES} distinct titles</b>.${pairedRead}`;
    }
    const bestUseful = useful[0];
    return `Start-time performance is grouped in <b>30-minute actual program-start buckets</b>. Imported fundraiser results supply completed dollars and actual times; saved Scheduling placements retain completed report-day $0s and internal program length. Ranking uses the <b>median fundraiser $ / pledge hour</b>, not the median dollars of individual airings. Each fundraiser contributes one observation per slot. A bucket is considered usable only with <b>${START_TIME_MIN_AIRINGS}+ rate-valid airings, ${START_TIME_MIN_FUNDRAISERS}+ fundraisers, and ${START_TIME_MIN_TITLES}+ distinct titles</b>.<br><br>Current rank: <b>${escapeHtml(metricLabel())}</b>. Best qualified bucket: <b>${escapeHtml(bestUseful.title)}</b> at <b>${formatMetricValue(bestUseful)}</b>; fundraiser median <b>${formatMoney(bestUseful.medianRate || 0)}</b> / pledge hr, fundraiser average <b>${formatMoney(bestUseful.averageRate || 0)}</b> / pledge hr, pooled rate <b>${formatMoney(bestUseful.pooledRate || 0)}</b> / pledge hr, with <b>${formatNumber(bestUseful.rateAirings || 0)}</b> rate-valid airing(s) across <b>${formatNumber(bestUseful.fundraiserCount || 0)}</b> fundraiser(s) and <b>${formatNumber(bestUseful.titleCount || 0)}</b> title(s).${pairedRead}`;
  }

  function rowsStartTimes""",
    'start-time decision readout'
)

s = regex_once(
    s,
    r"  function rowsStartTimes\(\) \{.*?\n  \}\n\n  function rowsPrograms",
    """  function rowsStartTimes() {
    return applyEvidence([...groupBy(filteredRecordsFor('startTimes'), startTimeLabel)]
      .map(([title, records]) => {
        const row = fundraiserBalancedRateSummary(title, records, {
          minAirings: START_TIME_MIN_AIRINGS,
          minFundraisers: START_TIME_MIN_FUNDRAISERS,
          minTitles: START_TIME_MIN_TITLES
        });
        row.startMinutes = records.map((record) => Number(record.startMinutes)).filter((value) => Number.isFinite(value)).sort((a, b) => a - b)[0];
        return row;
      })
      .filter((row) => row.title !== 'Unknown start time')
      .sort((a, b) => metricValue(b) - metricValue(a) || startTimeSortKey(a) - startTimeSortKey(b)));
  }

  function rowsPrograms""",
    'start-time fundraiser-balanced ranking'
)

s = replace_once(
    s,
    "  function rowsTopics() {\n    return applyEvidence([...groupBy(filteredRecordsFor('topics'), (record) => record.topic)]\n      .map(([title, records]) => summarizeGroup(title, records))\n      .sort((a, b) => metricValue(b) - metricValue(a) || b.avg - a.avg));\n  }\n",
    "  function rowsTopics() {\n    return applyEvidence([...groupBy(filteredRecordsFor('topics'), (record) => record.topic)]\n      .map(([title, records]) => fundraiserBalancedRateSummary(title, records))\n      .sort((a, b) => metricValue(b) - metricValue(a) || b.averageRate - a.averageRate));\n  }\n",
    'topic fundraiser-balanced ranking'
)

s = replace_once(
    s,
    "  function rowsSecondaryTopics() {\n    return applyEvidence([...groupBy(filteredRecordsFor('secondaryTopics'), (record) => record.secondaryTopic || 'Unassigned secondary topic')]\n      .map(([title, records]) => summarizeGroup(title, records))\n      .filter((row) => row.title && row.title !== 'Unassigned secondary topic')\n      .sort((a, b) => metricValue(b) - metricValue(a) || b.avg - a.avg || b.dollars - a.dollars));\n  }\n",
    "  function rowsSecondaryTopics() {\n    return applyEvidence([...groupBy(filteredRecordsFor('secondaryTopics'), (record) => record.secondaryTopic || 'Unassigned secondary topic')]\n      .map(([title, records]) => fundraiserBalancedRateSummary(title, records))\n      .filter((row) => row.title && row.title !== 'Unassigned secondary topic')\n      .sort((a, b) => metricValue(b) - metricValue(a) || b.averageRate - a.averageRate || b.dollars - a.dollars));\n  }\n",
    'secondary-topic fundraiser-balanced ranking'
)

s = regex_once(
    s,
    r"  function rowsSeasonal\(\) \{.*?\n  \}\n\n  function evidenceLabel",
    """  function rowsSeasonal() {
    const rows = filteredRecordsFor('seasonal').filter((record) => !HOLIDAY_RE.test(`${record.title} ${record.topic}`));
    const out = [];
    groupBy(rows, (record) => record.topic).forEach((records, title) => {
      const bySeason = SEASONS.map((season) => {
        const matches = records.filter((record) => record.season === season);
        const summary = fundraiserBalancedRateSummary(season, matches);
        return {
          season,
          broadcasts: matches.length,
          dollars: matches.reduce((sum, record) => sum + Number(record.dollars || 0), 0),
          rateAirings: summary.rateAirings,
          fundraiserCount: summary.fundraiserCount,
          titleCount: summary.titleCount,
          medianRate: summary.medianRate,
          averageRate: summary.averageRate,
          pooledRate: summary.pooledRate,
          sufficient: !summary.weak && summary.fundraiserCount > 0,
          lift: null,
          isBaseline: false
        };
      });
      const real = bySeason.filter((item) => item.sufficient && Number.isFinite(item.medianRate));
      if (!real.length) return;
      const baseline = closestMedianSeason(real) || real[0];
      const baselineRate = Number(baseline?.medianRate || 0);
      bySeason.forEach((item) => {
        if (!item.sufficient || !Number.isFinite(item.medianRate) || !(baselineRate > 0)) return;
        item.lift = ((item.medianRate - baselineRate) / baselineRate) * 100;
        item.isBaseline = item.season === baseline.season;
      });
      const best = real.reduce((winner, item) => Number(item.lift || 0) > Number(winner.lift || 0) ? item : winner, real[0]);
      const worst = real.reduce((winner, item) => Number(item.lift || 0) < Number(winner.lift || 0) ? item : winner, real[0]);
      const positiveLift = Math.max(...real.map((item) => Number(item.lift || 0)), 0);
      const negativeLift = Math.min(...real.map((item) => Number(item.lift || 0)), 0);
      const summary = fundraiserBalancedRateSummary(title, records);
      out.push({
        ...summary,
        seasons: real.length,
        avg: baselineRate,
        baselineSeason: baseline.season,
        baselineRate,
        seasonStats: bySeason,
        bestSeason: best.season,
        bestLift: Number(best.lift || 0),
        worstSeason: worst.season,
        worstLift: Number(worst.lift || 0),
        liftRangeLabel: `${formatPercent(positiveLift)} / ${formatPercent(negativeLift)}`,
        weak: summary.weak || real.length < 2
      });
    });
    return applyEvidence(out.sort((a, b) => b.baselineRate - a.baselineRate || b.dollars - a.dollars));
  }

  function evidenceLabel""",
    'seasonal fundraiser-balanced rates'
)

s = replace_once(
    s,
    "  function closestMedianSeason(realSeasonStats = []) {\n    const median = medianValue(realSeasonStats.map((item) => item.avg));\n    return realSeasonStats.reduce((winner, item) => {\n      if (!winner) return item;\n      const winnerDistance = Math.abs(Number(winner.avg || 0) - median);\n      const itemDistance = Math.abs(Number(item.avg || 0) - median);\n      if (itemDistance < winnerDistance) return item;\n      if (itemDistance === winnerDistance && Number(item.avg || 0) < Number(winner.avg || 0)) return item;\n      return winner;\n    }, null);\n  }\n",
    "  function closestMedianSeason(realSeasonStats = []) {\n    const value = (item) => Number(firstNonEmpty(item?.medianRate, item?.avg, 0) || 0);\n    const median = medianValue(realSeasonStats.map(value));\n    return realSeasonStats.reduce((winner, item) => {\n      if (!winner) return item;\n      const winnerDistance = Math.abs(value(winner) - median);\n      const itemDistance = Math.abs(value(item) - median);\n      if (itemDistance < winnerDistance) return item;\n      if (itemDistance === winnerDistance && value(item) < value(winner)) return item;\n      return winner;\n    }, null);\n  }\n",
    'season baseline uses fundraiser median rate'
)

s = replace_once(
    s,
    "  function seasonStat(row, season) {\n    return (row.seasonStats || []).find((item) => item.season === season) || { broadcasts: 0, dollars: 0, avg: null, lift: null, isBaseline: false };\n  }\n",
    "  function seasonStat(row, season) {\n    return (row.seasonStats || []).find((item) => item.season === season) || { broadcasts: 0, dollars: 0, medianRate: null, averageRate: null, fundraiserCount: 0, rateAirings: 0, sufficient: false, lift: null, isBaseline: false };\n  }\n",
    'season stat rate fallback'
)

s = regex_once(
    s,
    r"  function seasonPerformanceCell\(row, season\) \{.*?\n  \}\n\n  function labelWithMixCell",
    """  function seasonPerformanceCell(row, season) {
    const stat = seasonStat(row, season);
    if (!stat.broadcasts || !stat.fundraiserCount) return '<span class="muted-cell">—</span>';
    if (!stat.sufficient) {
      return `<b>${formatMoney(stat.medianRate || 0)} / hr</b><br><span class="mix">${formatNumber(stat.fundraiserCount)} drive(s) · ${formatNumber(stat.rateAirings)} valid airing(s) · low sample</span>`;
    }
    const lift = Number.isFinite(stat.lift) ? stat.lift : 0;
    const liftText = stat.isBaseline ? '0% baseline' : formatPercent(lift);
    return `<b>${formatMoney(stat.medianRate || 0)} / hr</b><br><span class="mix">${formatNumber(stat.fundraiserCount)} drive(s) · <span class="season-lift ${liftClass(lift)}">${escapeHtml(liftText)}</span></span>`;
  }

  function labelWithMixCell""",
    'season rate cell'
)

s = regex_once(
    s,
    r"  function topicRead\(rows\) \{.*?\n  \}\n\n  function secondaryTopicRead",
    """  function topicRead(rows) {
    if (!rows.length) return 'No topic records match the current filters.';
    const top = rows[0];
    const total = rows.reduce((sum, row) => sum + Number(row.dollars || 0), 0);
    const fourSeason = rows.filter((row) => row.allFour).length;
    return `${formatNumber(rows.length)} primary topic(s) match the current filters. Rankings use one $/pledge-hour observation per fundraiser, so drives with more airings do not receive extra weight. <b>${escapeHtml(top.title)}</b> leads by ${metricLabel().toLowerCase()} at <b>${formatMetricValue(top)}</b>.<br><br>${topRowsText(rows)}<br><br>For the leading row: fundraiser median <b>${formatMoney(top.medianRate || 0)}</b> / pledge hr, fundraiser average <b>${formatMoney(top.averageRate || 0)}</b> / pledge hr, pooled rate <b>${formatMoney(top.pooledRate || 0)}</b> / pledge hr across <b>${formatNumber(top.fundraiserCount || 0)}</b> fundraiser(s). Combined factual dollars in these topic rows: <b>${formatMoney(total)}</b>. ${formatNumber(fourSeason)} topic(s) have airings in all four pledge seasons.`;
  }

  function secondaryTopicRead""",
    'topic rate explanation'
)

s = regex_once(
    s,
    r"  function secondaryTopicRead\(rows\) \{.*?\n  \}\n\n  function seasonalRead",
    """  function secondaryTopicRead(rows) {
    if (!rows.length) return 'No secondary-topic records match the current filters.';
    const top = rows[0];
    const total = rows.reduce((sum, row) => sum + Number(row.dollars || 0), 0);
    const topicText = Array.isArray(state.topicFilters) && state.topicFilters.length === 1 ? ` inside <b>${escapeHtml(state.topicFilters[0])}</b>` : '';
    return `${formatNumber(rows.length)} secondary topic(s) match the current filters${topicText}. Each fundraiser contributes at most one $/pledge-hour observation to a subtopic. <b>${escapeHtml(top.title)}</b> leads by ${metricLabel().toLowerCase()} at <b>${formatMetricValue(top)}</b>.<br><br>${topRowsText(rows)}<br><br>For the leading row: fundraiser median <b>${formatMoney(top.medianRate || 0)}</b> / pledge hr, fundraiser average <b>${formatMoney(top.averageRate || 0)}</b> / pledge hr, pooled rate <b>${formatMoney(top.pooledRate || 0)}</b> / pledge hr across <b>${formatNumber(top.fundraiserCount || 0)}</b> fundraiser(s). Combined factual dollars in these secondary-topic rows: <b>${formatMoney(total)}</b>. For Music, choose Primary topic = Music and leave Secondary topic on All to compare the subtopics against each other.`;
  }

  function seasonalRead""",
    'secondary-topic rate explanation'
)

s = regex_once(
    s,
    r"  function seasonalRead\(rows\) \{.*?\n  \}\n\n  function liveRead",
    """  function seasonalRead(rows) {
    if (!rows.length) return 'No seasonal topic records match the current filters.';
    const topLines = rows.slice(0, 3).map((row, index) => {
      const seasonBits = SEASONS.map((season) => {
        const stat = seasonStat(row, season);
        if (!stat.broadcasts || !stat.fundraiserCount) return `${season}: no rate-valid fundraiser evidence`;
        if (!stat.sufficient) return `${season}: ${formatMoney(stat.medianRate || 0)}/hr (low sample)`;
        const liftText = stat.isBaseline ? '0% baseline' : formatPercent(Number(stat.lift || 0));
        return `${season}: ${formatMoney(stat.medianRate || 0)}/hr (${liftText}; ${stat.fundraiserCount} drives)`;
      }).join(' · ');
      return `${index + 1}. <b>${escapeHtml(row.title)}</b> — baseline <b>${escapeHtml(row.baselineSeason || '')}</b> at <b>${formatMoney(row.baselineRate || 0)} / pledge hr</b>; ${escapeHtml(seasonBits)}.`;
    }).join('<br>');
    return `This view compares each primary topic to <b>itself</b> using the same fundraiser-balanced rate logic as Historical Analytics. Each season value is the <b>median fundraiser $ / pledge hour</b> for that topic, not average dollars per airing. A season needs at least ${RATE_MIN_AIRINGS} rate-valid airings across ${RATE_MIN_FUNDRAISERS} fundraisers before it can establish the baseline or a lift. The qualifying season closest to that topic’s median seasonal rate becomes the <b>0% baseline</b>.<br><br>${topLines}`;
  }

  function liveRead""",
    'seasonal rate explanation'
)

# Question definitions and labels.
s = replace_once(
    s,
    "      graphTitle: 'Start time buckets',\n      tableTitle: 'Start time performance',\n",
    "      graphTitle: 'Start time by fundraiser-balanced $ / pledge hour',\n      tableTitle: 'Start time performance',\n      rateBalanced: true,\n",
    'start time rate-balanced flag'
)
s = replace_once(
    s,
    "        ['Median / airing', (row) => formatMoney(row.median || 0), 'money emphasis', (row) => row.median || 0],\n        ['Avg / airing', (row) => formatMoney(row.avg || 0), 'money', (row) => row.avg || 0],\n        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],\n",
    "        ['Median $ / pledge hr', (row) => formatMoney(row.medianRate || 0), 'money emphasis', (row) => row.medianRate || 0],\n        ['Avg $ / pledge hr', (row) => formatMoney(row.averageRate || 0), 'money', (row) => row.averageRate || 0],\n        ['Pooled $ / pledge hr', (row) => formatMoney(row.pooledRate || 0), 'money', (row) => row.pooledRate || 0],\n        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],\n",
    'start time rate columns'
)

s = replace_once(
    s,
    "      summary: 'Topic strength by median dollars per airing, with average, outliers, and four-season coverage shown.',\n      graphTitle: 'Topics by typical dollars per airing',\n      tableTitle: 'Topic ranking',\n      tableNote: 'Season mix uses M/J/A/D counts, for example [M-3, J-1, A-0, D-5].',\n      rows: rowsTopics,\n      metricDriven: true,\n",
    "      summary: 'Topic strength by fundraiser-balanced Broadcast $ / pledge hour.',\n      graphTitle: 'Topics by median fundraiser $ / pledge hour',\n      tableTitle: 'Topic ranking',\n      tableNote: 'Each fundraiser contributes one rate observation per topic. Historical evidence thresholds are 3 rate-valid airings across 2 fundraisers. Season mix uses M/J/A/D airing counts for context.',\n      source: 'schedule',\n      excludeNonSpecific: true,\n      rateBalanced: true,\n      rows: rowsTopics,\n      metricDriven: true,\n",
    'topic schedule source and rate method'
)

s = replace_once(
    s,
    "        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis analytics-left', (row) => row.median],\n        ['Avg / airing', (row) => formatMoney(row.avg), 'money analytics-left', (row) => row.avg],\n        ['Distribution / outliers', (row) => groupOutlierDetailCell(row), 'analytics-left', (row) => row.zeroDominated ? Number(row.zeroCount || 0) : (row.outlierCount || 0)],\n        ['Total $', (row) => formatMoney(row.dollars), 'money analytics-left', (row) => row.dollars],\n        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num analytics-left', (row) => row.broadcasts],\n        ['Season mix', (row) => escapeHtml(row.mix), 'analytics-left', (row) => row.seasons || 0]\n      ]\n    },\n    secondaryTopics:",
    "        ['Median $ / pledge hr', (row) => formatMoney(row.medianRate), 'money emphasis analytics-left', (row) => row.medianRate],\n        ['Avg $ / pledge hr', (row) => formatMoney(row.averageRate), 'money analytics-left', (row) => row.averageRate],\n        ['Pooled $ / pledge hr', (row) => formatMoney(row.pooledRate), 'money analytics-left', (row) => row.pooledRate],\n        ['Rate evidence', (row) => `${formatNumber(row.fundraiserCount || 0)} drives · ${formatNumber(row.rateAirings || 0)} valid · ${formatNumber(row.titleCount || 0)} titles`, 'analytics-left', (row) => row.rateAirings || 0],\n        ['Total $', (row) => formatMoney(row.dollars), 'money analytics-left', (row) => row.dollars],\n        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num analytics-left', (row) => row.broadcasts],\n        ['Season mix', (row) => escapeHtml(row.mix), 'analytics-left', (row) => row.seasons || 0]\n      ]\n    },\n    secondaryTopics:",
    'topic rate columns'
)

s = replace_once(
    s,
    "      summary: 'Subtopic strength inside the selected filters. Use Primary topic = Music for Music styles.',\n      graphTitle: 'Secondary topics by typical dollars per airing',\n      tableTitle: 'Secondary topic ranking',\n      tableNote: 'Choose Primary topic = Music and leave Secondary topic = All to compare Music subtopics against each other.',\n      rows: rowsSecondaryTopics,\n      metricDriven: true,\n",
    "      summary: 'Subtopic strength by fundraiser-balanced Broadcast $ / pledge hour. Use Primary topic = Music for Music styles.',\n      graphTitle: 'Secondary topics by median fundraiser $ / pledge hour',\n      tableTitle: 'Secondary topic ranking',\n      tableNote: 'Each fundraiser contributes one rate observation per subtopic. Choose Primary topic = Music and leave Secondary topic = All to compare Music subtopics against each other.',\n      source: 'schedule',\n      excludeNonSpecific: true,\n      rateBalanced: true,\n      rows: rowsSecondaryTopics,\n      metricDriven: true,\n",
    'secondary topic schedule source and rate method'
)

# Replace only the secondary-topic column block now that the topic block is unique.
s = replace_once(
    s,
    "        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis analytics-left', (row) => row.median],\n        ['Avg / airing', (row) => formatMoney(row.avg), 'money analytics-left', (row) => row.avg],\n        ['Distribution / outliers', (row) => groupOutlierDetailCell(row), 'analytics-left', (row) => row.zeroDominated ? Number(row.zeroCount || 0) : (row.outlierCount || 0)],\n        ['Total $', (row) => formatMoney(row.dollars), 'money analytics-left', (row) => row.dollars],\n        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num analytics-left', (row) => row.broadcasts],\n        ['Season mix', (row) => escapeHtml(row.mix), 'analytics-left', (row) => row.seasons || 0]\n      ]\n    },\n    seasonal:",
    "        ['Median $ / pledge hr', (row) => formatMoney(row.medianRate), 'money emphasis analytics-left', (row) => row.medianRate],\n        ['Avg $ / pledge hr', (row) => formatMoney(row.averageRate), 'money analytics-left', (row) => row.averageRate],\n        ['Pooled $ / pledge hr', (row) => formatMoney(row.pooledRate), 'money analytics-left', (row) => row.pooledRate],\n        ['Rate evidence', (row) => `${formatNumber(row.fundraiserCount || 0)} drives · ${formatNumber(row.rateAirings || 0)} valid · ${formatNumber(row.titleCount || 0)} titles`, 'analytics-left', (row) => row.rateAirings || 0],\n        ['Total $', (row) => formatMoney(row.dollars), 'money analytics-left', (row) => row.dollars],\n        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num analytics-left', (row) => row.broadcasts],\n        ['Season mix', (row) => escapeHtml(row.mix), 'analytics-left', (row) => row.seasons || 0]\n      ]\n    },\n    seasonal:",
    'secondary topic rate columns'
)

s = replace_once(
    s,
    "      summary: 'Compares each primary topic across March, June, August, and December using that topic’s own median-like season as the baseline.',\n      graphTitle: 'Season lift by topic',\n      tableTitle: 'Topic seasonal lift',\n      tableNote: 'Holiday-related titles are excluded. Each topic uses its own closest-to-median season as the 0% average, then March, June, August, and December show avg/airing, total dollars, and percent above or below that topic baseline.',\n      useSeason: false,\n      rows: rowsSeasonal,\n      metric: (rows) => rows[0] ? formatMoney(rows[0].avg) : '—',\n      tag: 'four-season lift',\n      chartValue: (row) => row.avg || 0,\n      chartLabel: (row) => formatMoney(row.avg || 0),\n",
    "      summary: 'Compares each primary topic across March, June, August, and December using fundraiser-balanced $ / pledge hour.',\n      graphTitle: 'Season lift by topic',\n      tableTitle: 'Topic seasonal lift',\n      tableNote: 'Holiday-related titles and Non-Specific Pledges are excluded. Each season uses the median fundraiser $/pledge-hour for that topic; low-sample seasons cannot establish the baseline or lift.',\n      useSeason: false,\n      source: 'schedule',\n      excludeNonSpecific: true,\n      rows: rowsSeasonal,\n      metric: (rows) => rows[0] ? formatMoney(rows[0].baselineRate) : '—',\n      tag: 'four-season rate lift',\n      chartValue: (row) => row.baselineRate || 0,\n      chartLabel: (row) => `${formatMoney(row.baselineRate || 0)} / hr`,\n",
    'seasonal schedule source and rate method'
)

s = replace_once(
    s,
    "        ['Average', (row) => `${formatMoney(row.baselineAvg || row.avg || 0)}<br><span class=\"mix\">${escapeHtml(row.baselineSeason || '')} baseline</span>`, 'money emphasis', (row) => row.baselineAvg || row.avg || 0],\n        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],\n",
    "        ['Baseline median $ / pledge hr', (row) => `${formatMoney(row.baselineRate || 0)}<br><span class=\"mix\">${escapeHtml(row.baselineSeason || '')} baseline</span>`, 'money emphasis', (row) => row.baselineRate || 0],\n        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],\n",
    'seasonal baseline column'
)

# Metric semantics must change only for the rate-balanced questions.
insert_metric = r'''
  function rateBalancedQuestion(questionId = state.question) {
    return Boolean((QUESTIONS[questionId] || {}).rateBalanced);
  }

  function updateMetricLabels() {
    if (!dom.advMetric) return;
    const balanced = rateBalancedQuestion();
    const medianOption = dom.advMetric.querySelector('option[value="median"]');
    const averageOption = dom.advMetric.querySelector('option[value="avg"]');
    if (medianOption) medianOption.textContent = balanced ? 'Median fundraiser $ / pledge hour' : 'Median $ / airing';
    if (averageOption) averageOption.textContent = balanced ? 'Average fundraiser $ / pledge hour' : 'Average $ / airing';
  }

'''
s = replace_once(s, "  function metricValue(row) {\n", insert_metric + "  function metricValue(row) {\n", 'rate-balanced metric mode')

s = replace_once(
    s,
    "  function metricValue(row) {\n    if (state.metric === 'median') return Number(row.median || 0);\n    if (state.metric === 'total') return Number(row.dollars || 0);\n    if (state.metric === 'pledges') return Number(row.pledges || 0);\n    if (state.metric === 'broadcasts') return Number(row.broadcasts || 0);\n    return Number(row.avg || 0);\n  }\n\n  function formatMetricValue(row) {\n    if (state.metric === 'median') return formatMoney(row.median || 0);\n    if (state.metric === 'total') return formatMoney(row.dollars || 0);\n    if (state.metric === 'pledges') return formatNumber(row.pledges || 0);\n    if (state.metric === 'broadcasts') return formatNumber(row.broadcasts || 0);\n    return formatMoney(row.avg || 0);\n  }\n\n  function metricLabel() {\n    if (state.metric === 'median') return 'Median / airing';\n    if (state.metric === 'total') return 'Total dollars';\n    if (state.metric === 'pledges') return 'Pledges';\n    if (state.metric === 'broadcasts') return 'Broadcasts';\n    return 'Avg / airing';\n  }\n",
    "  function metricValue(row) {\n    const balanced = rateBalancedQuestion();\n    if (state.metric === 'median') return Number(balanced ? row.medianRate : row.median || 0);\n    if (state.metric === 'total') return Number(row.dollars || 0);\n    if (state.metric === 'pledges') return Number(row.pledges || 0);\n    if (state.metric === 'broadcasts') return Number(row.broadcasts || 0);\n    return Number(balanced ? row.averageRate : row.avg || 0);\n  }\n\n  function formatMetricValue(row) {\n    const balanced = rateBalancedQuestion();\n    if (state.metric === 'median') return balanced ? `${formatMoney(row.medianRate || 0)} / pledge hr` : formatMoney(row.median || 0);\n    if (state.metric === 'total') return formatMoney(row.dollars || 0);\n    if (state.metric === 'pledges') return formatNumber(row.pledges || 0);\n    if (state.metric === 'broadcasts') return formatNumber(row.broadcasts || 0);\n    return balanced ? `${formatMoney(row.averageRate || 0)} / pledge hr` : formatMoney(row.avg || 0);\n  }\n\n  function metricLabel() {\n    const balanced = rateBalancedQuestion();\n    if (state.metric === 'median') return balanced ? 'Median fundraiser $ / pledge hour' : 'Median / airing';\n    if (state.metric === 'total') return 'Total dollars';\n    if (state.metric === 'pledges') return 'Pledges';\n    if (state.metric === 'broadcasts') return 'Broadcasts';\n    return balanced ? 'Average fundraiser $ / pledge hour' : 'Avg / airing';\n  }\n",
    'metric functions respect fundraiser rate mode'
)

s = replace_once(
    s,
    "  function updateFilterState() {\n    const question = QUESTIONS[state.question] || QUESTIONS.programs;\n",
    "  function updateFilterState() {\n    const question = QUESTIONS[state.question] || QUESTIONS.programs;\n    updateMetricLabels();\n",
    'dynamic metric labels'
)

p.write_text(s)
print('WROTE ui-analytics.js')

# Add a focused behavior test that executes the new helpers in the existing browser-like VM.
test_path = root / 'tests/analytics-balanced-rates-v127.test.mjs'
test_path.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sourcePath = new URL('../assets/js/ui-analytics.js', import.meta.url);
let source = fs.readFileSync(sourcePath, 'utf8');
const marker = '  App.analyticsUi = { ensureReady, openCohort, reload };';
assert.ok(source.includes(marker), 'analytics export marker must exist');
source = source.replace(marker, `${marker}\n  globalThis.__balancedRateHooks = { fundraiserBalancedRateSummary, pairedStartTimeComparison };`);

const context = {
  window: {
    PledgeLib: { constants: {}, state: {}, data: {}, derive: {}, utils: {} },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: async () => { throw new Error('network unavailable in balanced-rate tests'); }
  },
  document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {}, createElement: () => ({ innerHTML: '', textContent: '', innerText: '' }) },
  console,
  Date,
  Map,
  Set,
  Promise,
  Number,
  String,
  Math,
  Intl,
  URLSearchParams
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'ui-analytics.js' });
const hooks = context.__balancedRateHooks;

const rec = (scheduleId, title, dollars, durationMinutes, startMinutes = 1200) => ({
  scheduleId,
  scheduleTitle: scheduleId,
  fundraiser: scheduleId,
  title,
  programId: title,
  programOpenId: title,
  dollars,
  pledges: 1,
  durationMinutes,
  startMinutes,
  season: 'August',
  seasonYear: 'August 2026',
  isNonSpecific: false
});

test('fundraiser-balanced rate gives each fundraiser one observation regardless of airing count', () => {
  const rows = [
    rec('drive-a', 'A1', 100, 60),
    rec('drive-a', 'A2', 100, 60),
    rec('drive-a', 'A3', 100, 60),
    rec('drive-a', 'A4', 100, 60),
    rec('drive-b', 'B1', 500, 60)
  ];
  const summary = hooks.fundraiserBalancedRateSummary('slot', rows, { minAirings: 1, minFundraisers: 1, minTitles: 1 });
  assert.equal(summary.fundraiserCount, 2);
  assert.equal(summary.rateAirings, 5);
  assert.equal(summary.medianRate, 300); // median of drive rates 100 and 500, not median airing dollars 100
  assert.equal(summary.averageRate, 300);
  assert.equal(Math.round(summary.pooledRate), 180); // useful volume-weighted context, not the ranking statistic
});

test('a fundraiser with a missing duration is excluded as a partial rate observation', () => {
  const rows = [
    rec('drive-a', 'A1', 100, 60),
    rec('drive-a', 'A2', 100, 0),
    rec('drive-b', 'B1', 400, 60)
  ];
  const summary = hooks.fundraiserBalancedRateSummary('topic', rows, { minAirings: 1, minFundraisers: 1, minTitles: 1 });
  assert.equal(summary.fundraiserCount, 1);
  assert.equal(summary.rateAirings, 1);
  assert.equal(summary.medianRate, 400);
});

test('8 PM vs 9 PM comparison uses only fundraisers containing both rate-valid slots', () => {
  const rows = [
    rec('drive-a', 'A8', 100, 60, 1200), rec('drive-a', 'A9', 200, 60, 1260),
    rec('drive-b', 'B8', 300, 60, 1200), rec('drive-b', 'B9', 150, 60, 1260),
    rec('drive-c', 'C8', 500, 60, 1200)
  ];
  const comparison = hooks.pairedStartTimeComparison(rows, 1200, 1260);
  assert.equal(comparison.pairedFundraisers, 2);
  assert.equal(comparison.firstMedianRate, 200);
  assert.equal(comparison.secondMedianRate, 175);
  assert.equal(comparison.medianDifference, -25);
  assert.equal(comparison.firstWins, 1);
  assert.equal(comparison.secondWins, 1);
  assert.equal(comparison.ties, 0);
});

test('rate-based Performance Analytics questions use saved schedule rows and label pledge-hour statistics', () => {
  const text = fs.readFileSync(sourcePath, 'utf8');
  assert.match(text, /rateBalanced: true/);
  assert.match(text, /source: 'schedule'/);
  assert.match(text, /Median \$ \/ pledge hr/);
  assert.match(text, /pairedStartTimeComparison\(filteredRecordsFor\('startTimes'\), 1200, 1260\)/);
  assert.match(text, /Each fundraiser contributes one rate observation per topic/);
  assert.match(text, /median fundraiser \$ \/ pledge hour/);
});
''')
print('WROTE analytics-balanced-rates-v127.test.mjs')

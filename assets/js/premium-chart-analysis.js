(() => {
  'use strict';

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function netAfterPremium(row = {}) {
    if (Number.isFinite(Number(row.estimatedNetAfterPremium))) return Number(row.estimatedNetAfterPremium);
    return number(row.pledgedDollars) - number(row.sentCost) - number(row.outstandingCost) - number(row.totalPremiumCost && !(row.sentCost || row.outstandingCost) ? row.totalPremiumCost : 0);
  }

  function premiumCost(row = {}) {
    if (Number.isFinite(Number(row.totalPremiumCost))) return Number(row.totalPremiumCost);
    return number(row.sentCost) + number(row.outstandingCost);
  }

  function aggregateRows(rows = []) {
    const pledgeCount = rows.reduce((sum, row) => sum + number(row.pledgeCount), 0);
    const pledgedDollars = rows.reduce((sum, row) => sum + number(row.pledgedDollars), 0);
    const totalPremiumCost = rows.reduce((sum, row) => sum + premiumCost(row), 0);
    const estimatedNetAfterPremium = pledgedDollars - totalPremiumCost;
    return {
      rows: rows.length,
      pledgeCount,
      pledgedDollars,
      totalPremiumCost,
      estimatedNetAfterPremium,
      averagePledge: pledgeCount ? pledgedDollars / pledgeCount : 0,
      costPercentOfPledged: pledgedDollars ? totalPremiumCost / pledgedDollars : 0
    };
  }

  function packageMetric(row = {}, metric = 'workhorse') {
    if (metric === 'net') return netAfterPremium(row);
    if (metric === 'pledges') return number(row.pledgeCount);
    if (metric === 'average') return number(row.averagePledge) || (number(row.pledgeCount) ? number(row.pledgedDollars) / number(row.pledgeCount) : 0);
    if (metric === 'costPercent') return Number.isFinite(Number(row.costPercentOfPledged))
      ? Number(row.costPercentOfPledged)
      : (number(row.pledgedDollars) ? premiumCost(row) / number(row.pledgedDollars) : 0);
    if (metric === 'pledged') return number(row.pledgedDollars);
    if (metric === 'cost') return premiumCost(row);
    return number(row.workhorseScore);
  }

  function workhorseLeaders(packages = [], limit = 5) {
    const usable = packages.filter((row) => number(row.pledgeCount) > 0 && netAfterPremium(row) > 0);
    const maxNet = Math.max(0, ...usable.map(netAfterPremium));
    const maxPledges = Math.max(0, ...usable.map((row) => number(row.pledgeCount)));
    return usable.map((row) => {
      const net = netAfterPremium(row);
      const pledges = number(row.pledgeCount);
      const netNorm = maxNet ? net / maxNet : 0;
      const pledgeNorm = maxPledges ? pledges / maxPledges : 0;
      const workhorseScore = Math.sqrt(Math.max(0, netNorm) * Math.max(0, pledgeNorm)) * 100;
      return {
        ...row,
        estimatedNetAfterPremium: net,
        totalPremiumCost: premiumCost(row),
        workhorseScore
      };
    }).sort((a, b) => b.workhorseScore - a.workhorseScore || b.estimatedNetAfterPremium - a.estimatedNetAfterPremium)
      .slice(0, Math.max(1, limit));
  }

  function rankPackages(packages = [], metric = 'net', direction = 'top', limit = 12) {
    const enriched = packages.map((row) => ({
      ...row,
      estimatedNetAfterPremium: netAfterPremium(row),
      totalPremiumCost: premiumCost(row)
    }));
    if (metric === 'workhorse') {
      const all = workhorseLeaders(enriched, Math.max(enriched.length, limit));
      return (direction === 'bottom' ? [...all].reverse() : all).slice(0, limit);
    }
    const sorted = [...enriched].sort((a, b) => {
      const delta = packageMetric(b, metric) - packageMetric(a, metric);
      return direction === 'bottom' ? -delta : delta;
    });
    return sorted.slice(0, limit);
  }

  function metricForRows(rows = [], metric = 'net') {
    const a = aggregateRows(rows);
    if (metric === 'pledged') return a.pledgedDollars;
    if (metric === 'pledges') return a.pledgeCount;
    if (metric === 'cost') return a.totalPremiumCost;
    if (metric === 'average') return a.averagePledge;
    if (metric === 'costPercent') return a.costPercentOfPledged;
    return a.estimatedNetAfterPremium;
  }

  function groupRows(rows = [], keyFn) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = String(keyFn(row) || 'Unclassified').trim() || 'Unclassified';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return groups;
  }

  function compositionMix(rows = [], metric = 'net', maxSeries = 7) {
    const byComposition = groupRows(rows, (row) => row.packageCompositionLabel || 'Composition unknown');
    const compositionTotals = [...byComposition.entries()]
      .map(([label, group]) => ({ label, value: metricForRows(group, metric) }))
      .sort((a, b) => b.value - a.value);
    const keep = new Set(compositionTotals.slice(0, maxSeries).map((item) => item.label));
    const seriesLabels = [...keep];
    if (compositionTotals.length > maxSeries) seriesLabels.push('Remaining compositions');

    const fundraiserGroups = groupRows(rows, (row) => row.fundraiserLabel || row.fundraiserKey || 'Unknown fundraiser');
    const categories = [...fundraiserGroups.keys()].sort((a, b) => {
      const aRow = fundraiserGroups.get(a)?.[0] || {};
      const bRow = fundraiserGroups.get(b)?.[0] || {};
      return String(aRow.fundraiserKey || a).localeCompare(String(bRow.fundraiserKey || b));
    });
    const series = seriesLabels.map((label) => ({
      label,
      values: categories.map((fundraiser) => {
        const group = fundraiserGroups.get(fundraiser) || [];
        const chosen = label === 'Remaining compositions'
          ? group.filter((row) => !keep.has(row.packageCompositionLabel || 'Composition unknown'))
          : group.filter((row) => (row.packageCompositionLabel || 'Composition unknown') === label);
        return metricForRows(chosen, metric);
      })
    }));
    return { categories, series };
  }

  function topicCompositionHeatmap(rows = [], metric = 'net', maxTopics = 10, maxCompositions = 8) {
    const mapped = rows.filter((row) => row.topicPrimary && row.packageCompositionLabel);
    const topicTotals = [...groupRows(mapped, (row) => row.topicPrimary).entries()]
      .map(([label, group]) => ({ label, value: metricForRows(group, metric) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, maxTopics);
    const compositionTotals = [...groupRows(mapped, (row) => row.packageCompositionLabel).entries()]
      .map(([label, group]) => ({ label, value: metricForRows(group, metric) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, maxCompositions);
    const topics = topicTotals.map((item) => item.label);
    const compositions = compositionTotals.map((item) => item.label);
    const values = topics.map((topic) => compositions.map((composition) => {
      const cellRows = mapped.filter((row) => row.topicPrimary === topic && row.packageCompositionLabel === composition);
      return metricForRows(cellRows, metric);
    }));
    return { topics, compositions, values };
  }

  function brandPie(brandScopes = [], metric = 'pledges') {
    return brandScopes.map((row) => ({
      label: row.scope,
      value: metric === 'net' ? netAfterPremium(row)
        : metric === 'pledged' ? number(row.pledgedDollars)
        : number(row.pledgeCount)
    })).filter((item) => item.value > 0);
  }

  const api = {
    netAfterPremium,
    premiumCost,
    aggregateRows,
    packageMetric,
    workhorseLeaders,
    rankPackages,
    metricForRows,
    compositionMix,
    topicCompositionHeatmap,
    brandPie
  };

  globalThis.WNMUPremiumChartAnalysis = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
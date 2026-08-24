from pathlib import Path
import json

ROOT = Path('.')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing patch target: {label}')
    return text.replace(old, new, 1)


def replace_count(text, old, new, expected, label):
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{label}: expected {expected} matches, found {count}')
    return text.replace(old, new)

# Fundraiser Comparison Lab: align by fundraiser sequence rather than stale absolute metadata.
comparison_path = ROOT / 'assets/js/ui-fundraiser-comparison.js'
comparison = comparison_path.read_text(encoding='utf-8')

old_anchor = """  function firstSaturdayAnchor(analysis = {}) {
    const startDate = parseDate(analysis?.schedule?.startDate);
    const fallback = calendarDays(analysis)[0]?.date || null;
    const start = startDate || fallback;
    if (!start) return null;
    const anchor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const daysToSaturday = (6 - anchor.getDay() + 7) % 7;
    anchor.setDate(anchor.getDate() + daysToSaturday);
    return anchor;
  }
"""
new_anchor = """  function firstSaturdayAnchor(analysis = {}) {
    const placementDays = calendarDays(analysis)
      .map((day) => day?.date || parseDate(day?.dateKey))
      .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
      .sort((a, b) => a - b);
    const startDate = placementDays[0] || parseDate(analysis?.schedule?.startDate);
    if (!startDate) return null;
    const anchor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const weekday = anchor.getDay();
    const daysToSaturday = weekday === 0 ? -1 : (6 - weekday + 7) % 7;
    anchor.setDate(anchor.getDate() + daysToSaturday);
    return anchor;
  }
"""
comparison = replace_once(comparison, old_anchor, new_anchor, 'first Saturday anchor')

old_aligned = """  function alignedDailyContextRows(analyses = []) {
    const maps = analyses.map((analysis) => {
      const map = new Map();
      calendarDays(analysis).forEach((day) => {
        const offset = fundraiserDayOffset(analysis, day);
        if (Number.isFinite(offset)) map.set(offset, day);
      });
      return map;
    });
    const offsets = [...new Set(maps.flatMap((map) => [...map.keys()]))].sort((a, b) => a - b);
    return offsets.map((offset) => ({ offset, days: maps.map((map) => map.get(offset) || null) }));
  }
"""
new_aligned = """  function alignedDailyContextRows(analyses = []) {
    const maps = analyses.map((analysis) => {
      const map = new Map();
      calendarDays(analysis).forEach((day) => {
        const offset = fundraiserDayOffset(analysis, day);
        if (Number.isFinite(offset) && offset >= -1) map.set(offset, day);
      });
      return map;
    });
    const maxOffsets = maps.map((map) => {
      const postSaturday = [...map.keys()].filter((offset) => offset >= 0);
      return postSaturday.length ? Math.max(...postSaturday) : null;
    });
    const offsets = [...new Set(maps.flatMap((map) => [...map.keys()]))]
      .filter((offset) => {
        if (offset === -1) return maps.some((map) => map.has(-1));
        if (offset < 0) return false;
        const comparableWindows = maxOffsets.filter((maxOffset) => Number.isFinite(maxOffset) && offset <= maxOffset).length;
        return comparableWindows >= 2;
      })
      .sort((a, b) => a - b);
    return offsets.map((offset) => ({ offset, days: maps.map((map) => map.get(offset) || null) }));
  }
"""
comparison = replace_once(comparison, old_aligned, new_aligned, 'aligned daily context rows')

old_context_note = "Days are aligned to the first Saturday of each fundraiser: first Saturday with first Saturday, first Sunday with first Sunday, and so on. A Friday immediately before the first Saturday is Day -1. Selected fundraisers with no scheduled pledge programming are omitted until there is a day to compare."
new_context_note = "Days are aligned by fundraiser sequence, not by calendar date: first Saturday with first Saturday, first Sunday with first Sunday, second Saturday with second Saturday, and so on. Day 0 is the first Saturday; only the Friday immediately before it can appear as Day -1. Extra tail days that fall outside the shared comparison window are omitted."
comparison = replace_once(comparison, old_context_note, new_context_note, 'daily context explanatory note')

old_scatter = """        const offset = fundraiserDayOffset(analysis, day);
        const label = Number.isFinite(offset) ? fundraiserDayLabel(offset).title : day.weekday;
"""
new_scatter = """        const offset = fundraiserDayOffset(analysis, day);
        if (Number.isFinite(offset) && offset < -1) return;
        const label = Number.isFinite(offset) ? fundraiserDayLabel(offset).title : day.weekday;
"""
comparison = replace_once(comparison, old_scatter, new_scatter, 'weather scatter fundraiser-day guard')
comparison_path.write_text(comparison, encoding='utf-8')

# Performance Analytics: distinguish zero-dominated distributions from statistical outliers.
analytics_path = ROOT / 'assets/js/ui-analytics.js'
analytics = analytics_path.read_text(encoding='utf-8')

old_outlier_cell = """  function groupOutlierDetailCell(row = {}) {
    if (!Number(row.outlierCount || 0)) return escapeHtml(outlierLabel(row));
    const id = groupDetailId(row);
    return `<button type=\"button\" class=\"analytics-detail-link outlier-link\" data-group-detail-id=\"${escapeHtml(id)}\" data-group-detail-mode=\"outliers\">${escapeHtml(outlierLabel(row))}</button>`;
  }
"""
new_outlier_cell = """  function distributionLabel(row = {}) {
    const count = Array.isArray(row.records) ? row.records.length : Number(row.broadcasts || 0);
    const zeroCount = Number(row.zeroCount || 0);
    if (row.zeroDominated && count > 0) {
      const outlierText = Number(row.outlierCount || 0) ? ` · ${outlierLabel(row)}` : '';
      return `Zero-dominated · ${zeroCount}/${count} at $0${outlierText}`;
    }
    return outlierLabel(row);
  }

  function groupOutlierDetailCell(row = {}) {
    const hasOutliers = Number(row.outlierCount || 0) > 0;
    const hasDistributionWarning = Boolean(row.zeroDominated);
    if (!hasOutliers && !hasDistributionWarning) return escapeHtml(distributionLabel(row));
    const id = groupDetailId(row);
    const mode = hasDistributionWarning ? 'distribution' : 'outliers';
    const linkClass = hasDistributionWarning ? 'distribution-link' : 'outlier-link';
    return `<button type=\"button\" class=\"analytics-detail-link ${linkClass}\" data-group-detail-id=\"${escapeHtml(id)}\" data-group-detail-mode=\"${mode}\">${escapeHtml(distributionLabel(row))}</button>`;
  }
"""
analytics = replace_once(analytics, old_outlier_cell, new_outlier_cell, 'distribution warning cell')

old_summary_prefix = """  function summarizeGroup(title, records) {
    const seasons = new Set(records.map((record) => record.seasonYear));
    const dollars = records.reduce((sum, record) => sum + Number(record.dollars || 0), 0);
    const pledges = records.reduce((sum, record) => sum + Number(record.pledges || 0), 0);
    const mix = seasonMix(records);
"""
new_summary_prefix = """  function summarizeGroup(title, records) {
    const seasons = new Set(records.map((record) => record.seasonYear));
    const resultValues = records.map((record) => Number(record.dollars || 0));
    const dollars = resultValues.reduce((sum, value) => sum + value, 0);
    const pledges = records.reduce((sum, record) => sum + Number(record.pledges || 0), 0);
    const median = medianValue(resultValues);
    const zeroCount = resultValues.filter((value) => value === 0).length;
    const zeroDominated = dollars > 0 && zeroCount > resultValues.length / 2;
    const mix = seasonMix(records);
"""
analytics = replace_once(analytics, old_summary_prefix, new_summary_prefix, 'summarize group distribution inputs')

old_summary_stats = """      avg: records.length ? dollars / records.length : 0,
      median: medianValue(records.map((record) => Number(record.dollars || 0))),
      ...outlierSummary(records.map((record) => Number(record.dollars || 0))),
"""
new_summary_stats = """      avg: records.length ? dollars / records.length : 0,
      median,
      zeroCount,
      zeroShare: resultValues.length ? zeroCount / resultValues.length : 0,
      zeroDominated,
      ...outlierSummary(resultValues),
"""
analytics = replace_once(analytics, old_summary_stats, new_summary_stats, 'summarize group distribution stats')

old_sort_block = """    const sortedRecords = records.sort((a, b) => {
      if (mode === 'outliers') {
        const aFlagged = outlierStatusForRecord(row, a) ? 1 : 0;
        const bFlagged = outlierStatusForRecord(row, b) ? 1 : 0;
        if (aFlagged !== bFlagged) return bFlagged - aFlagged;
      }
      const aTime = a.date instanceof Date && !Number.isNaN(a.date.getTime()) ? a.date.getTime() : 0;
"""
new_sort_block = """    const sortedRecords = records.sort((a, b) => {
      if (mode === 'outliers') {
        const aFlagged = outlierStatusForRecord(row, a) ? 1 : 0;
        const bFlagged = outlierStatusForRecord(row, b) ? 1 : 0;
        if (aFlagged !== bFlagged) return bFlagged - aFlagged;
      } else if (mode === 'distribution') {
        const aZero = Number(a.dollars || 0) === 0 ? 1 : 0;
        const bZero = Number(b.dollars || 0) === 0 ? 1 : 0;
        if (aZero !== bZero) return bZero - aZero;
      }
      const aTime = a.date instanceof Date && !Number.isNaN(a.date.getTime()) ? a.date.getTime() : 0;
"""
analytics = replace_once(analytics, old_sort_block, new_sort_block, 'group detail distribution sort')

old_detail_note = """      <div class=\"program-detail-note\">${mode === 'outliers' ? 'Flagged outliers are listed first. ' : ''}Outlier flags use Median Absolute Deviation. No airing is removed or discounted from the Median, Average, or Total shown here.</div>`;
"""
new_detail_note = """      <div class=\"program-detail-note\">${row.zeroDominated ? `Zero-dominated distribution: ${formatNumber(zeroCount)} of ${formatNumber(records.length)} included airings are $0. This is a distribution warning, not an outlier claim. ` : ''}${mode === 'outliers' ? 'Flagged outliers are listed first. ' : ''}${mode === 'distribution' ? 'Zero-dollar airings are listed first. ' : ''}Outlier flags use Median Absolute Deviation. No airing is removed or discounted from the Median, Average, or Total shown here.</div>`;
"""
analytics = replace_once(analytics, old_detail_note, new_detail_note, 'group detail distribution note')

analytics = replace_count(
    analytics,
    "['Outliers', (row) => groupOutlierDetailCell(row), 'analytics-left', (row) => row.outlierCount || 0]",
    "['Distribution / outliers', (row) => groupOutlierDetailCell(row), 'analytics-left', (row) => row.zeroDominated ? Number(row.zeroCount || 0) : (row.outlierCount || 0)]",
    3,
    'topic distribution column labels'
)
analytics_path.write_text(analytics, encoding='utf-8')

workspace_path = ROOT / 'assets/analytics-workspace.html'
workspace = workspace_path.read_text(encoding='utf-8')
workspace = replace_once(
    workspace,
    "    .analytics-detail-link.outlier-link { color: var(--bad); display: inline; }\n",
    "    .analytics-detail-link.outlier-link { color: var(--bad); display: inline; }\n    .analytics-detail-link.distribution-link { color: #8a5f15; display: inline; }\n",
    'distribution link style'
)
workspace_path.write_text(workspace, encoding='utf-8')

# Regression tests.
comparison_test_path = ROOT / 'tests/fundraiser-comparison.test.mjs'
comparison_test = comparison_test_path.read_text(encoding='utf-8')
comparison_test += """

test('corresponding fundraiser alignment uses actual pledge placement sequence even when saved start date is stale', () => {
  const analysis = {
    schedule: { startDate: '2026-08-01' },
    placementRows: ['2026-08-21', '2026-08-22', '2026-08-23'].map((dateKey) => ({ dateKey, startMinutes: 420, title: 'Test', topic: 'Test', secondary: 'Unspecified', daypart: 'Morning', minutes: 60, known: true, dollars: 100, pledges: 1 }))
  };
  assert.equal(hooks.fundraiserDayOffset(analysis, { dateKey: '2026-08-21' }), -1);
  assert.equal(hooks.fundraiserDayOffset(analysis, { dateKey: '2026-08-22' }), 0);
  assert.equal(hooks.fundraiserDayOffset(analysis, { dateKey: '2026-08-23' }), 1);
});

test('daily context starts at the pre-Saturday Friday at earliest and omits unmatched tail days', () => {
  const makeAnalysis = (startDate, dates) => ({
    schedule: { startDate },
    placementRows: dates.map((dateKey) => ({ dateKey, startMinutes: 420, title: 'Test', topic: 'Test', secondary: 'Unspecified', daypart: 'Morning', minutes: 60, known: true, dollars: 100, pledges: 1 }))
  });
  const longer = makeAnalysis('2026-08-01', ['2026-08-17', '2026-08-21', '2026-08-22', '2026-08-23', '2026-08-29', '2026-09-05']);
  const peer = makeAnalysis('2025-08-08', ['2025-08-08', '2025-08-09', '2025-08-10', '2025-08-16']);
  const rows = hooks.alignedDailyContextRows([longer, peer]);
  assert.deepEqual(Array.from(rows, (row) => row.offset), [-1, 0, 1, 7]);
});
"""
comparison_test_path.write_text(comparison_test, encoding='utf-8')

analytics_test_path = ROOT / 'tests/performance-analytics.test.mjs'
analytics_test = analytics_test_path.read_text(encoding='utf-8')
old_export = "globalThis.__analyticsTestHooks = { daypartFromMinutes, medianValue, outlierSummary, buildAiringRecordLookup, findAiringForSchedulePlacement, buildScheduleRecords, dedupeSchedulesByDateRange, getScheduleAudit: () => state.scheduleAudit, getMetric: () => state.metric };"
new_export = "globalThis.__analyticsTestHooks = { daypartFromMinutes, medianValue, outlierSummary, summarizeGroup, distributionLabel, buildAiringRecordLookup, findAiringForSchedulePlacement, buildScheduleRecords, dedupeSchedulesByDateRange, getScheduleAudit: () => state.scheduleAudit, getMetric: () => state.metric };"
analytics_test = replace_once(analytics_test, old_export, new_export, 'analytics test hooks')
analytics_test += """

test('zero-dominated groups are flagged even when MAD has no statistical outlier', () => {
  const values = [0, 0, 0, 400, 900];
  const records = values.map((dollars, index) => ({ dollars, pledges: 0, season: 'August', seasonYear: `August ${2020 + index}` }));
  const row = hooks.summarizeGroup('Drama Doc', records);
  assert.equal(row.median, 0);
  assert.equal(row.avg, 260);
  assert.equal(row.zeroCount, 3);
  assert.equal(row.zeroDominated, true);
  assert.equal(row.outlierCount, 0);
  assert.match(hooks.distributionLabel(row), /Zero-dominated/);
  assert.match(hooks.distributionLabel(row), /3\/5 at \$0/);
});
"""
analytics_test_path.write_text(analytics_test, encoding='utf-8')

version_path = ROOT / 'version.json'
version = json.loads(version_path.read_text(encoding='utf-8'))
version['appVersion'] = '0.22.94'
version['releasedAt'] = '2026-08-24'
version_path.write_text(json.dumps(version, separators=(',', ':')) + '\n', encoding='utf-8')

print('v0.22.94 patch applied')

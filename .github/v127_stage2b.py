from pathlib import Path

root = Path('.')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, found {count}')
    print(f'OK {label}')
    return text.replace(old, new, 1)


def replace_exact_count(text, old, new, expected, label):
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f'{label}: expected {expected} occurrences, found {count}')
    print(f'OK {label} ({count})')
    return text.replace(old, new)


p = root / 'assets/js/ui-analytics.js'
s = p.read_text()

marker = "\n\n  function formatTimeFromMinutes(value) {\n"
helper = r'''

  function sameTitleStartTimeComparison(records = [], firstMinutes = 1200, secondMinutes = 1260) {
    const bucket = (value) => Number.isFinite(Number(value)) ? Math.floor(Number(value) / 30) * 30 : null;
    const relevant = records.filter((record) => {
      const value = bucket(record.startMinutes);
      return value === firstMinutes || value === secondMinutes;
    });
    const titlePairs = [];
    groupBy(relevant, programIdentityKey).forEach((titleRecords, key) => {
      const first = fundraiserRateObservations(titleRecords.filter((record) => bucket(record.startMinutes) === firstMinutes));
      const second = fundraiserRateObservations(titleRecords.filter((record) => bucket(record.startMinutes) === secondMinutes));
      if (!first.length || !second.length) return;
      const firstMedianRate = medianValue(first.map((item) => item.rate));
      const secondMedianRate = medianValue(second.map((item) => item.rate));
      titlePairs.push({
        key,
        title: groupDisplayTitle(titleRecords, key),
        firstMedianRate,
        secondMedianRate,
        difference: secondMedianRate - firstMedianRate,
        firstFundraisers: first.length,
        secondFundraisers: second.length
      });
    });
    const differences = titlePairs.map((item) => item.difference);
    return {
      firstMinutes,
      secondMinutes,
      titlesCompared: titlePairs.length,
      medianDifference: medianValue(differences),
      firstWins: titlePairs.filter((item) => item.firstMedianRate > item.secondMedianRate).length,
      secondWins: titlePairs.filter((item) => item.secondMedianRate > item.firstMedianRate).length,
      ties: titlePairs.filter((item) => item.secondMedianRate === item.firstMedianRate).length,
      titlePairs
    };
  }
'''
s = replace_once(s, marker, helper + marker, 'same-title start-time comparison helper')

old = """    const paired = pairedStartTimeComparison(filteredRecordsFor('startTimes'), 1200, 1260);
    const pairedRead = paired.pairedFundraisers
      ? `<br><br><b>8:00 PM vs 9:00 PM inside the same fundraisers:</b> ${formatNumber(paired.pairedFundraisers)} fundraiser(s) contain rate-valid evidence for both slots. 8:00 PM median: <b>${formatMoney(paired.firstMedianRate)} / pledge hr</b>; 9:00 PM median: <b>${formatMoney(paired.secondMedianRate)} / pledge hr</b>. Median within-fundraiser difference (9 PM minus 8 PM): <b>${formatMoney(paired.medianDifference)} / pledge hr</b>. 9 PM wins ${formatNumber(paired.secondWins)}, 8 PM wins ${formatNumber(paired.firstWins)}, ties ${formatNumber(paired.ties)}.`
      : '<br><br><b>8:00 PM vs 9:00 PM:</b> No fundraiser currently has rate-valid evidence for both slots under these filters, so the app will not manufacture a paired conclusion.';
"""
new = """    const comparisonRecords = filteredRecordsFor('startTimes');
    const paired = pairedStartTimeComparison(comparisonRecords, 1200, 1260);
    const sameTitle = sameTitleStartTimeComparison(comparisonRecords, 1200, 1260);
    const pairedRead = paired.pairedFundraisers
      ? `<br><br><b>8:00 PM vs 9:00 PM inside the same fundraisers:</b> ${formatNumber(paired.pairedFundraisers)} fundraiser(s) contain rate-valid evidence for both slots. 8:00 PM median: <b>${formatMoney(paired.firstMedianRate)} / pledge hr</b>; 9:00 PM median: <b>${formatMoney(paired.secondMedianRate)} / pledge hr</b>. Median within-fundraiser difference (9 PM minus 8 PM): <b>${formatMoney(paired.medianDifference)} / pledge hr</b>. 9 PM wins ${formatNumber(paired.secondWins)}, 8 PM wins ${formatNumber(paired.firstWins)}, ties ${formatNumber(paired.ties)}.`
      : '<br><br><b>8:00 PM vs 9:00 PM inside the same fundraisers:</b> No fundraiser currently has rate-valid evidence for both slots under these filters, so the app will not manufacture a paired conclusion.';
    const sameTitleRead = sameTitle.titlesCompared
      ? `<br><br><b>Same-title 8:00 PM vs 9:00 PM check:</b> ${formatNumber(sameTitle.titlesCompared)} title(s) have rate-valid history at both starts. Median title-level difference (9 PM minus 8 PM): <b>${formatMoney(sameTitle.medianDifference)} / pledge hr</b>. 9 PM wins ${formatNumber(sameTitle.secondWins)} title(s), 8 PM wins ${formatNumber(sameTitle.firstWins)}, ties ${formatNumber(sameTitle.ties)}. This controls for program identity even when the two airings occurred in different fundraisers.`
      : '<br><br><b>Same-title 8:00 PM vs 9:00 PM check:</b> No title has rate-valid history at both starts under these filters.';
"""
s = replace_once(s, old, new, 'same-title 8 PM vs 9 PM readout')
s = replace_exact_count(s, '${pairedRead}`;', '${pairedRead}${sameTitleRead}`;', 2, 'append same-title readout to both start-time branches')

s = replace_once(
    s,
    "      metric: (rows) => rows[0] ? formatMoney(rows[0].median) : '—',\n      tag: 'topic lens',\n",
    "      metric: (rows) => rows[0] ? formatMetricValue(rows[0]) : '—',\n      tag: 'topic lens',\n",
    'topic headline metric label'
)
s = replace_once(
    s,
    "      metric: (rows) => rows[0] ? formatMoney(rows[0].median) : '—',\n      tag: 'subtopic lens',\n",
    "      metric: (rows) => rows[0] ? formatMetricValue(rows[0]) : '—',\n      tag: 'subtopic lens',\n",
    'subtopic headline metric label'
)

for season in ['March', 'June', 'August', 'December']:
    old_sort = f"(row) => Number(seasonStat(row, '{season}').avg || 0)"
    new_sort = f"(row) => Number(seasonStat(row, '{season}').medianRate || 0)"
    s = replace_once(s, old_sort, new_sort, f'{season} seasonal sort uses median rate')

p.write_text(s)
print('WROTE ui-analytics.js')

# Extend the focused regression test with same-title and seasonal-sort assertions.
tp = root / 'tests/analytics-balanced-rates-v127.test.mjs'
t = tp.read_text()
t = replace_once(
    t,
    "  globalThis.__balancedRateHooks = { fundraiserBalancedRateSummary, pairedStartTimeComparison };",
    "  globalThis.__balancedRateHooks = { fundraiserBalancedRateSummary, pairedStartTimeComparison, sameTitleStartTimeComparison };",
    'test hook export'
)
append = r'''

test('same-title 8 PM vs 9 PM comparison controls for program identity', () => {
  const rows = [
    rec('drive-a', 'Shared', 100, 60, 1200),
    rec('drive-b', 'Shared', 220, 60, 1260),
    rec('drive-c', 'Only 8', 900, 60, 1200),
    rec('drive-d', 'Only 9', 20, 60, 1260)
  ];
  const comparison = hooks.sameTitleStartTimeComparison(rows, 1200, 1260);
  assert.equal(comparison.titlesCompared, 1);
  assert.equal(comparison.secondWins, 1);
  assert.equal(comparison.firstWins, 0);
  assert.equal(comparison.medianDifference, 120);
});

test('seasonal topic table sorts season columns by median fundraiser rate', () => {
  const text = fs.readFileSync(sourcePath, 'utf8');
  for (const season of ['March', 'June', 'August', 'December']) {
    assert.ok(text.includes(`seasonStat(row, '${season}').medianRate`));
  }
  assert.match(text, /Same-title 8:00 PM vs 9:00 PM check/);
});
'''
if 'same-title 8 PM vs 9 PM comparison controls for program identity' not in t:
    t += append
tp.write_text(t)
print('WROTE analytics-balanced-rates-v127.test.mjs')

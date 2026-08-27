from pathlib import Path


def read(path):
    return Path(path).read_text()


def write(path, value):
    Path(path).write_text(value)


def replace_once(path, old, new, label):
    value = read(path)
    count = value.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 exact match in {path}, found {count}')
    write(path, value.replace(old, new, 1))


reports = 'assets/js/one-sheet-reports.js'
atest = 'tests/performance-analytics.test.mjs'
ottest = 'tests/one-sheet-analysis-hardening.test.mjs'

# Repair two malformed tests produced by the core hardening patch. The product
# logic is correct; these fixtures were accidentally testing schedule-specific
# IDs as if they represented only two distinct program titles.
replace_once(
    atest,
    "  assert.match(text, /missing from an otherwise populated imported report day counts as a completed \\$0/);",
    "  assert.match(text, /Saved Scheduling placements retain completed report-day \\$0s/);",
    'analytics copy test follows current wording'
)
replace_once(
    atest,
    "  const make = (scheduleId, title, durationMinutes = 60) => ({ scheduleId, scheduleTitle: scheduleId, fundraiser: scheduleId, title, programId: `${scheduleId}-${title}`, programOpenId: `${scheduleId}-${title}`, durationMinutes });",
    "  const make = (scheduleId, title, durationMinutes = 60) => ({ scheduleId, scheduleTitle: scheduleId, fundraiser: scheduleId, title, programId: title, programOpenId: title, durationMinutes });",
    'analytics start-time distinct-title fixture'
)

# Non-Specific Pledges are an intentional giving bucket, not failed topic
# attribution. Keep a separate summary and reserve the warning for genuinely
# unidentified imported program results.
replace_once(
    reports,
    """  function unmatchedBroadcastSummary(analysis = {}) {
    const rows = analysis.unmatchedImportedRows || [];
    return {
      rows: rows.length,
      dollars: rows.reduce((sum, row) => sum + Number(row.dollars || 0), 0),
      pledges: rows.reduce((sum, row) => sum + Number(row.pledges || 0), 0)
    };
  }
""",
    """  function nonSpecificRows(analysis = {}) {
    return (analysis.unmatchedImportedRows || []).filter((row) => rowIsNonSpecific(row));
  }

  function nonSpecificSummary(analysis = {}) {
    const rows = nonSpecificRows(analysis);
    return {
      rows: rows.length,
      dollars: rows.reduce((sum, row) => sum + Number(row.dollars || 0), 0),
      pledges: rows.reduce((sum, row) => sum + Number(row.pledges || 0), 0)
    };
  }

  function unmatchedBroadcastSummary(analysis = {}) {
    const rows = (analysis.unmatchedImportedRows || []).filter((row) => !rowIsNonSpecific(row));
    return {
      rows: rows.length,
      dollars: rows.reduce((sum, row) => sum + Number(row.dollars || 0), 0),
      pledges: rows.reduce((sum, row) => sum + Number(row.pledges || 0), 0)
    };
  }
""",
    'separate non-specific from genuine unmatched imported rows'
)

replace_once(
    reports,
    """  function topicComparisonChart(analyses, rows) {
    return lineChartSvg({
      labels: rows.map((row) => row.key),
      series: analyses.map((analysis, analysisIndex) => ({
        label: analysis.schedule.title,
        values: rows.map((row) => Number(row.values?.[analysisIndex]?.scheduled || 0) > 0 ? Number(row.values[analysisIndex].dollars || 0) : 0)
      })),
      ariaLabel: 'Broadcast dollars by topic across selected fundraisers',
      className: 'topic-comparison-chart'
    });
  }

  function comparisonTopicMatrix(analyses) {
    const rows = A.topicComparisonRows(analyses);
""",
    """  function topicComparisonChart(analyses, rows) {
    return lineChartSvg({
      labels: rows.map((row) => row.key),
      series: analyses.map((analysis, analysisIndex) => ({
        label: analysis.schedule.title,
        values: rows.map((row) => row.isNonSpecific
          ? Number(row.values?.[analysisIndex]?.dollars || 0)
          : (Number(row.values?.[analysisIndex]?.scheduled || 0) > 0 ? Number(row.values[analysisIndex].dollars || 0) : 0))
      })),
      ariaLabel: 'Broadcast dollars by topic and non-specific giving across selected fundraisers',
      className: 'topic-comparison-chart'
    });
  }

  function topicIncomeDenominator(analysis = {}) {
    const topicDollars = [...(analysis.topics?.values?.() || [])].reduce((sum, item) => sum + Number(item.dollars || 0), 0);
    return topicDollars + Number(nonSpecificSummary(analysis).dollars || 0);
  }

  function comparisonTopicMatrix(analyses) {
    const rows = A.topicComparisonRows(analyses);
    const nonSpecific = {
      key: 'Non-Specific Pledges',
      isNonSpecific: true,
      values: analyses.map((analysis) => {
        const summary = nonSpecificSummary(analysis);
        return { dollars: summary.dollars, pledges: summary.pledges, rows: summary.rows, scheduled: 0, minutes: 0, rateMinutes: 0, share: 0 };
      })
    };
    if (nonSpecific.values.some((value) => Number(value.dollars || 0) > 0 || Number(value.pledges || 0) > 0 || Number(value.rows || 0) > 0)) rows.push(nonSpecific);
""",
    'add non-specific giving row to comparison topic matrix'
)

replace_once(
    reports,
    """        ${row.values.map((value, analysisIndex) => {
          if (!(Number(value.scheduled || 0) > 0)) return '<td class=\"muted-cell\">—</td>';
          const analysis = analyses[analysisIndex];
          const hoursShare = Math.max(0, Math.min(100, Number(value.share || 0) * 100));
          const topicIncomeDenominator = [...(analysis.topics?.values?.() || [])].reduce((sum, item) => sum + Number(item.dollars || 0), 0);
          const incomeShare = topicIncomeDenominator > 0 ? Math.max(0, Math.min(100, (Number(value.dollars || 0) / topicIncomeDenominator) * 100)) : 0;
          const programs = topicProgramMarkup(analysis, row.key, recurringKeys);
          const rateBase = rateBaseSuffix(value.rateMinutes, value.minutes);
          return `<td class=\"topic-cell\"><div class=\"topic-performance-line\"><strong>${escapeHtml(money(value.dollarsPerHour))}/hr</strong><span>Hours ${hoursShare.toFixed(0)}%</span><span>Income ${incomeShare.toFixed(0)}%</span></div><small>${escapeHtml(hours(value.minutes))}${escapeHtml(rateBase)} · ${escapeHtml(money(value.dollars))} · ${escapeHtml(count(value.pledges))} pledges · ${escapeHtml(count(value.scheduled))} airings</small>${programs ? `<small class=\"topic-programs\">${programs}</small>` : ''}</td>`;
        }).join('')}
""",
    """        ${row.values.map((value, analysisIndex) => {
          const analysis = analyses[analysisIndex];
          const incomeBase = topicIncomeDenominator(analysis);
          const incomeShare = incomeBase > 0 ? Math.max(0, Math.min(100, (Number(value.dollars || 0) / incomeBase) * 100)) : 0;
          if (row.isNonSpecific) {
            if (!(Number(value.rows || 0) > 0 || Number(value.dollars || 0) > 0 || Number(value.pledges || 0) > 0)) return '<td class=\"muted-cell\">—</td>';
            return `<td class=\"topic-cell non-specific-topic\"><div class=\"topic-performance-line\"><strong>Not applicable</strong><span>Hours N/A</span><span>Income ${incomeShare.toFixed(0)}%</span></div><small>${escapeHtml(money(value.dollars))} · ${escapeHtml(count(value.pledges))} pledges · not tied to a specific program</small></td>`;
          }
          if (!(Number(value.scheduled || 0) > 0)) return '<td class=\"muted-cell\">—</td>';
          const hoursShare = Math.max(0, Math.min(100, Number(value.share || 0) * 100));
          const programs = topicProgramMarkup(analysis, row.key, recurringKeys);
          const rateBase = rateBaseSuffix(value.rateMinutes, value.minutes);
          return `<td class=\"topic-cell\"><div class=\"topic-performance-line\"><strong>${escapeHtml(money(value.dollarsPerHour))}/hr</strong><span>Hours ${hoursShare.toFixed(0)}%</span><span>Income ${incomeShare.toFixed(0)}%</span></div><small>${escapeHtml(hours(value.minutes))}${escapeHtml(rateBase)} · ${escapeHtml(money(value.dollars))} · ${escapeHtml(count(value.pledges))} pledges · ${escapeHtml(count(value.scheduled))} airings</small>${programs ? `<small class=\"topic-programs\">${programs}</small>` : ''}</td>`;
        }).join('')}
""",
    'render non-specific giving without fake airtime or rate'
)

replace_once(
    reports,
    """    return `<section class=\"sheet-section topic-matrix\"><div class=\"section-heading\"><div><h2>Topic airtime & performance</h2><p>$ / hour uses only airings with valid duration and known results. Hours % and Income % show scheduled allocation and attributable Broadcast income. Programs shown in bold aired in two or more selected fundraisers.</p></div></div>${topicComparisonChart(analyses, rows)}<div class=\"table-scroll\"><table><thead><tr><th>Topic</th>${head}</tr></thead><tbody>${body || '<tr><td>No topic data.</td></tr>'}</tbody></table></div></section>`;
""",
    """    return `<section class=\"sheet-section topic-matrix\"><div class=\"section-heading\"><div><h2>Topic airtime & performance</h2><p>$ / hour uses only program airings with valid duration and known results. Non-Specific Pledges are shown as their own giving category; because those donations are not tied to a program, airtime and $/hour are not applicable. Income % includes Non-Specific Pledges in the giving-category denominator. Programs shown in bold aired in two or more selected fundraisers.</p></div></div>${topicComparisonChart(analyses, rows)}<div class=\"table-scroll\"><table><thead><tr><th>Topic / giving category</th>${head}</tr></thead><tbody>${body || '<tr><td>No topic data.</td></tr>'}</tbody></table></div></section>`;
""",
    'explain non-specific giving semantics in comparison report'
)

replace_once(
    reports,
    """  function programResultsTable(analysis) {
    const rows = A.programResultsRows(analysis);
""",
    """  function programResultsTable(analysis) {
    const rows = A.programResultsRows(analysis).filter((row) => !isNonSpecificLabel(row.title) && !isNonSpecificLabel(row.topic));
""",
    'keep non-specific giving out of program results'
)

replace_once(
    reports,
    """  function singleTopicSummary(analysis) {
    const rows = A.topicComparisonRows([analysis])
      .map((row) => ({ row, value: row.values[0] }))
      .filter((item) => Number(item.value.scheduled || 0) > 0)
      .sort((a, b) => b.value.dollarsPerHour - a.value.dollarsPerHour || b.value.dollars - a.value.dollars || a.row.key.localeCompare(b.row.key));
    const totalTopicIncome = rows.reduce((sum, item) => sum + Number(item.value.dollars || 0), 0);
    const body = rows.map(({ row, value }) => {
      const incomeShare = totalTopicIncome > 0 ? Number(value.dollars || 0) / totalTopicIncome : 0;
      const programs = topicProgramMarkup(analysis, row.key);
      const rateBase = rateBaseSuffix(value.rateMinutes, value.minutes);
      return `<tr><th>${escapeHtml(row.key)}</th><td><strong>${escapeHtml(money(value.dollars))} / ${escapeHtml(money(value.dollarsPerHour))}/hr / ${escapeHtml(percent(incomeShare))} income</strong><span>${escapeHtml(hours(value.minutes))}${escapeHtml(rateBase)} / ${escapeHtml(percent(value.share))} / ${escapeHtml(count(value.scheduled))} airings</span>${programs ? `<small class=\"topic-programs\">${programs}</small>` : ''}</td></tr>`;
    }).join('');
    return `<section class=\"sheet-section topic-summary\"><div class=\"section-heading\"><div><h2>Topic airtime & performance</h2><p>Topics are ranked by Broadcast $/hour. The first line shows attributable income; the second shows scheduled airtime, the rate base when different, and exposure.</p></div></div><div class=\"table-scroll\"><table><thead><tr><th>Topic</th><th>Fundraiser result</th></tr></thead><tbody>${body || '<tr><td colspan=\"2\">No topic data.</td></tr>'}</tbody></table></div></section>`;
  }
""",
    """  function singleTopicSummary(analysis) {
    const rows = A.topicComparisonRows([analysis])
      .map((row) => ({ row, value: row.values[0] }))
      .filter((item) => Number(item.value.scheduled || 0) > 0)
      .sort((a, b) => b.value.dollarsPerHour - a.value.dollarsPerHour || b.value.dollars - a.value.dollars || a.row.key.localeCompare(b.row.key));
    const nonSpecific = nonSpecificSummary(analysis);
    const totalTopicIncome = rows.reduce((sum, item) => sum + Number(item.value.dollars || 0), 0) + Number(nonSpecific.dollars || 0);
    const topicBody = rows.map(({ row, value }) => {
      const incomeShare = totalTopicIncome > 0 ? Number(value.dollars || 0) / totalTopicIncome : 0;
      const programs = topicProgramMarkup(analysis, row.key);
      const rateBase = rateBaseSuffix(value.rateMinutes, value.minutes);
      return `<tr><th>${escapeHtml(row.key)}</th><td><strong>${escapeHtml(money(value.dollars))} / ${escapeHtml(money(value.dollarsPerHour))}/hr / ${escapeHtml(percent(incomeShare))} income</strong><span>${escapeHtml(hours(value.minutes))}${escapeHtml(rateBase)} / ${escapeHtml(percent(value.share))} / ${escapeHtml(count(value.scheduled))} airings</span>${programs ? `<small class=\"topic-programs\">${programs}</small>` : ''}</td></tr>`;
    }).join('');
    const nonSpecificBody = nonSpecific.rows || nonSpecific.dollars || nonSpecific.pledges
      ? `<tr class=\"non-specific-topic\"><th>Non-Specific Pledges</th><td><strong>${escapeHtml(money(nonSpecific.dollars))} / ${escapeHtml(percent(totalTopicIncome > 0 ? nonSpecific.dollars / totalTopicIncome : 0))} income</strong><span>No program airtime · $/hour N/A · ${escapeHtml(count(nonSpecific.pledges))} pledges</span></td></tr>`
      : '';
    const body = `${topicBody}${nonSpecificBody}`;
    return `<section class=\"sheet-section topic-summary\"><div class=\"section-heading\"><div><h2>Topic airtime & performance</h2><p>Program topics are ranked by Broadcast $/hour. Non-Specific Pledges appear as a separate giving category with no program airtime or $/hour.</p></div></div><div class=\"table-scroll\"><table><thead><tr><th>Topic / giving category</th><th>Fundraiser result</th></tr></thead><tbody>${body || '<tr><td colspan=\"2\">No topic data.</td></tr>'}</tbody></table></div></section>`;
  }
""",
    'show non-specific giving in single-fundraiser topic summary'
)

# Regression assertions for the business rule. Keep the genuine attribution
# warning available, but ensure NSPL is filtered from it and rendered separately.
source = read(nottest)
marker = "assert.match(reportSource, /Regional weather/);\n"
addition = """assert.match(reportSource, /function nonSpecificSummary/);\nassert.match(reportSource, /filter\\(\\(row\\) => !rowIsNonSpecific\\(row\\)\\)/);\nassert.match(reportSource, /Non-Specific Pledges are shown as their own giving category/);\nassert.match(reportSource, /not tied to a specific program/);\n"""
if addition not in source:
    if source.count(marker) != 1:
        raise SystemExit('non-specific regression test insertion marker not found exactly once')
    source = source.replace(marker, marker + addition, 1)
    write(nottest, source)

from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match in {path}, found {count}')
    p.write_text(text.replace(old, new, 1))


def replace_all(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count < 1:
        raise SystemExit(f'{label}: expected at least one match in {path}, found {count}')
    p.write_text(text.replace(old, new))

analysis = 'assets/js/one-sheet-analysis.js'
reports = 'assets/js/one-sheet-reports.js'

replace_once(
    analysis,
    """  function historicalRanking(analyses = [], dimension, options = {}) {
    if (dimension === 'season') return historicalSeasonRanking(analyses, options);
    const rows = historicalRows(analyses);
""",
    """  function historicalRanking(analyses = [], dimension, options = {}) {
    if (dimension === 'season') return historicalSeasonRanking(analyses, options);
    const rows = historicalRows(analyses).filter((row) => dimension !== 'startTime' || !row.unmatchedImported);
""",
    'exclude unmatched imports from start-time ranking'
)

replace_once(
    analysis,
    """    const importedDollars = Number(row?.dollars || 0) || 0;
    const importedProgramId = text(row?.programId || '');
""",
    """    const importedDollars = Number(row?.dollars || 0) || 0;
    const importedPledges = Number(row?.pledges || 0) || 0;
    const importedProgramId = text(row?.programId || '');
""",
    'capture unmatched imported pledges'
)

replace_once(
    analysis,
    """      detail: `${analysis?.schedule?.title || 'Fundraiser'} · imported ${importedDate || 'unknown date'}${Number.isFinite(importedStart) ? ` ${preflightClockLabel(importedStart)}` : ''} · $${importedDollars.toFixed(2)} · ${parts.join(' · ')}`,
      imported: {
        title: importedTitle,
        dateKey: importedDate,
        startMinutes: Number.isFinite(importedStart) ? importedStart : null,
        dollars: importedDollars
      },
""",
    """      detail: `${analysis?.schedule?.title || 'Fundraiser'} · imported ${importedDate || 'unknown date'}${Number.isFinite(importedStart) ? ` ${preflightClockLabel(importedStart)}` : ''} · $${importedDollars.toFixed(2)} · ${importedPledges} pledge${importedPledges === 1 ? '' : 's'} · ${parts.join(' · ')}`,
      imported: {
        title: importedTitle,
        dateKey: importedDate,
        startMinutes: Number.isFinite(importedStart) ? importedStart : null,
        dollars: importedDollars,
        pledges: importedPledges
      },
""",
    'show pledges in unmatched diagnostic'
)

replace_once(
    analysis,
    """    const unmatchedPrograms = [];
    const healthIndexes = buildLibraryIndexes(library);
    let nonSpecificRows = 0;
    let nonSpecificDollars = 0;
    (analyses || []).forEach((analysis) => {
      (analysis?.unmatchedImportedRows || []).forEach((row) => {
        if ([row?.title, row?.plannedTitle, row?.topic].some(isNonSpecificDataLabel)) {
          nonSpecificRows += 1;
          nonSpecificDollars += Number(row?.dollars || 0);
          return;
        }
        unmatchedPrograms.push(preflightUnmatchedDiagnostic(row, analysis, healthIndexes));
      });
    });
    add('unmatched-imported', 'Unmatched imported program results', 'fail', unmatchedPrograms.length ? 'Imported program results remain that cannot be assigned confidently to a scheduled program/topic.' : 'All imported program-specific results are attributable; Non-Specific Pledges are intentionally excluded from this check.', unmatchedPrograms);
""",
    """    const unmatchedPrograms = [];
    const unmatchedStartTimes = new Map();
    const healthIndexes = buildLibraryIndexes(library);
    let nonSpecificRows = 0;
    let nonSpecificDollars = 0;
    (analyses || []).forEach((analysis) => {
      (analysis?.unmatchedImportedRows || []).forEach((row) => {
        if ([row?.title, row?.plannedTitle, row?.topic].some(isNonSpecificDataLabel)) {
          nonSpecificRows += 1;
          nonSpecificDollars += Number(row?.dollars || 0);
          return;
        }
        const diagnostic = preflightUnmatchedDiagnostic(row, analysis, healthIndexes);
        unmatchedPrograms.push(diagnostic);
        const start = Number(diagnostic?.imported?.startMinutes);
        const bucket = Number.isFinite(start)
          ? Math.floor(((((start % 1440) + 1440) % 1440) / 30)) * 30
          : null;
        const key = Number.isFinite(bucket) ? String(bucket) : 'unknown';
        if (!unmatchedStartTimes.has(key)) {
          unmatchedStartTimes.set(key, {
            startMinutes: Number.isFinite(bucket) ? bucket : null,
            label: Number.isFinite(bucket) ? preflightClockLabel(bucket) : 'Unknown time',
            count: 0
          });
        }
        unmatchedStartTimes.get(key).count += 1;
      });
    });
    add('unmatched-imported', 'Unmatched imported program results', 'fail', unmatchedPrograms.length
      ? 'Imported program results remain that cannot be assigned confidently to a saved schedule placement. Their dollars remain in fundraiser totals, but these rows are excluded from historical start-time performance.'
      : 'All imported program-specific results are attributable; Non-Specific Pledges are intentionally excluded from this check.', unmatchedPrograms);
    checks[checks.length - 1].startTimeBreakdown = [...unmatchedStartTimes.values()]
      .sort((a, b) => (Number.isFinite(a.startMinutes) ? a.startMinutes : 99999) - (Number.isFinite(b.startMinutes) ? b.startMinutes : 99999));
""",
    'add unmatched start-time audit'
)

replace_once(
    reports,
    """    const description = (weekpart) => `Only ${weekpart.toLowerCase()} 30-minute start slots with at least 5 rate-valid airings, 3 fundraisers, and 3 distinct titles are shown. Sparse slots are excluded rather than displayed in the ranking.`;
""",
    """    const description = (weekpart) => `Only schedule-reconciled ${weekpart.toLowerCase()} 30-minute start slots with at least 5 rate-valid airings, 3 fundraisers, and 3 distinct titles are shown. Unmatched imported results remain in fundraiser totals but are excluded from start-time rankings. Sparse slots are excluded rather than displayed in the ranking.`;
""",
    'clarify historical start-time eligibility'
)

replace_once(
    reports,
    """    const detailMarkup = details.length
      ? `<details ${check.severity !== 'info' && check.count ? 'open' : ''}><summary>${escapeHtml(count(details.length))} detail${details.length === 1 ? '' : 's'}</summary><ul>${details.map((item) => `<li>${detailItemMarkup(item)}</li>`).join('')}</ul></details>`
      : '';
    return `<section class="preflight-check severity-${escapeHtml(check.severity)} ${check.count ? 'has-findings' : 'clear'}"><div class="preflight-check-head"><div><h2>${escapeHtml(check.label)}</h2><p>${escapeHtml(check.summary)}</p></div><span class="preflight-status">${escapeHtml(statusLabel)}${check.count ? ` · ${escapeHtml(count(check.count))}` : ''}</span></div>${detailMarkup}</section>`;
""",
    """    const detailMarkup = details.length
      ? `<details ${check.severity !== 'info' && check.count ? 'open' : ''}><summary>${escapeHtml(count(details.length))} detail${details.length === 1 ? '' : 's'}</summary><ul>${details.map((item) => `<li>${detailItemMarkup(item)}</li>`).join('')}</ul></details>`
      : '';
    const startTimeBreakdown = Array.isArray(check.startTimeBreakdown) ? check.startTimeBreakdown : [];
    const startTimeMarkup = startTimeBreakdown.length
      ? `<div class="preflight-detail-line"><strong>Unmatched rows by reported start time</strong><span class="preflight-mismatch-tags">${startTimeBreakdown.map((item) => `<span class="preflight-mismatch-tag">${escapeHtml(item.label)} · ${escapeHtml(count(item.count))}</span>`).join('')}</span></div>`
      : '';
    return `<section class="preflight-check severity-${escapeHtml(check.severity)} ${check.count ? 'has-findings' : 'clear'}"><div class="preflight-check-head"><div><h2>${escapeHtml(check.label)}</h2><p>${escapeHtml(check.summary)}</p></div><span class="preflight-status">${escapeHtml(statusLabel)}${check.count ? ` · ${escapeHtml(count(check.count))}` : ''}</span></div>${startTimeMarkup}${detailMarkup}</section>`;
""",
    'render unmatched start-time breakdown'
)

replace_once(
    reports,
    """    $('#report-output').innerHTML = `<article class="one-sheet historical-sheet">${historicalHeader(analyses)}${durationNoticeSection(analyses)}${historicalReportBody(analyses)}<footer class="sheet-footer">Historical rankings use median Broadcast $/hour. Rate calculations exclude unknown results and true program airings with missing duration from both numerator and denominator. Non-Specific Pledges are not treated as incomplete program/topic data. Start-time rankings are evaluated separately for Weekdays, Saturdays, and Sundays; each requires 5 rate-valid airings across 3 rate-valid fundraisers and 3 distinct rate-valid titles.</footer></article>`;
""",
    """    $('#report-output').innerHTML = `<article class="one-sheet historical-sheet">${historicalHeader(analyses)}${durationNoticeSection(analyses)}${historicalReportBody(analyses)}<footer class="sheet-footer">Historical rankings use median Broadcast $/hour. Rate calculations exclude unknown results and true program airings with missing duration from both numerator and denominator. Non-Specific Pledges are not treated as incomplete program/topic data. Start-time rankings are evaluated separately for Weekdays, Saturdays, and Sundays; each requires 5 rate-valid airings across 3 rate-valid fundraisers and 3 distinct rate-valid titles. Imported results that cannot be reconciled to a saved schedule placement remain in fundraiser totals but are excluded from start-time rankings.</footer></article>`;
""",
    'historical footer unmatched rule'
)

replace_once(
    reports,
    """      <footer class="sheet-footer">PASS means no blocking defects were found in fundraiser schedule coverage, Broadcast reconciliation, program duration coverage, imported program attribution, or duplicate fundraiser ranges. Warnings identify cleanup or verification work that does not currently invalidate the printed report math. Non-Specific Pledges are treated as a valid giving category, not an attribution error.</footer>
""",
    """      <footer class="sheet-footer">PASS means no blocking defects were found in fundraiser schedule coverage, Broadcast reconciliation, program duration coverage, imported program attribution, or duplicate fundraiser ranges. Warnings identify cleanup or verification work that does not currently invalidate the printed report math. Non-Specific Pledges are treated as a valid giving category, not an attribution error. Unmatched imported program rows remain in factual fundraiser totals but are excluded from historical start-time rankings.</footer>
""",
    'preflight footer unmatched rule'
)

# Data-health regression: make the existing unmatched example a 9 PM row with pledges.
replace_once(
    'tests/data-health-preflight.test.mjs',
    "const unmatched = { title: 'Mystery Program', topic: 'Unattributed', unmatchedImported: true, known: true, dollars: 20, dateKey: '2026-08-08' };",
    "const unmatched = { title: 'Mystery Program', topic: 'Unattributed', unmatchedImported: true, known: true, dollars: 20, pledges: 2, dateKey: '2026-08-08', startMinutes: 1260 };",
    'data-health unmatched fixture'
)
replace_once(
    'tests/data-health-preflight.test.mjs',
    """assert.equal(health.checks.find((check) => check.id === 'unmatched-imported').count, 1, 'Non-Specific Pledges must not count as unmatched program results');
""",
    """const unmatchedHealthCheck = health.checks.find((check) => check.id === 'unmatched-imported');
assert.equal(unmatchedHealthCheck.count, 1, 'Non-Specific Pledges must not count as unmatched program results');
assert.equal(unmatchedHealthCheck.startTimeBreakdown.find((item) => item.label === '9:00 PM')?.count, 1, 'Preflight must expose unmatched imported rows by reported start time');
assert.match(unmatchedHealthCheck.details[0].detail, /2 pledges/, 'unmatched detail should include pledge count');
""",
    'data-health unmatched audit assertions'
)

# Historical ranking regression: unmatched 9 PM rows must not create a start-time winner.
hardening_path = Path('tests/one-sheet-analysis-hardening.test.mjs')
hardening = hardening_path.read_text()
anchor = """{
  const schedule = {
    id: 'tooltip-day-scope', title: 'Aug 16, 2019–Aug 29, 2019', startDate: '2019-08-16', endDate: '2019-08-29',
"""
if hardening.count(anchor) != 1:
    raise SystemExit('hardening insertion anchor not found exactly once')
regression = """{
  const analyses = Array.from({ length: 5 }, (_unused, index) => ({
    schedule: { id: `start-audit-${index}`, title: `Start Audit ${index}` },
    placementRows: [
      {
        dateKey: `2026-08-${String(10 + index).padStart(2, '0')}`,
        startMinutes: 1200, minutes: 60, durationMissing: false, known: true,
        title: `Scheduled 8 PM ${index}`, dollars: 100 + index, pledges: 1,
        unmatchedImported: false
      },
      {
        dateKey: `2026-08-${String(10 + index).padStart(2, '0')}`,
        startMinutes: 1260, minutes: 60, durationMissing: false, known: true,
        title: `Unmatched 9 PM ${index}`, dollars: 1000 + index, pledges: 5,
        unmatchedImported: true, source: 'report-unmatched'
      }
    ]
  }));
  const ranking = A.historicalRanking(analyses, 'startTime');
  const eightPm = ranking.find((row) => row.key === '1200');
  assert.equal(eightPm?.rateAirings, 5, 'schedule-reconciled start-time rows remain eligible');
  assert.equal(ranking.some((row) => row.key === '1260'), false, 'unmatched imported rows must not qualify or influence historical start-time rankings');
}

"""
hardening_path.write_text(hardening.replace(anchor, regression + anchor, 1))

# Report-source assertions.
replace_once(
    'tests/one-sheet-report-refinements.test.mjs',
    "assert.match(reports, /Sunday start-time performance/);\n",
    """assert.match(reports, /Sunday start-time performance/);
assert.match(reports, /Only schedule-reconciled/);
assert.match(reports, /excluded from start-time rankings/);
assert.match(reports, /Unmatched rows by reported start time/);
""",
    'report refinement unmatched start-time assertions'
)
replace_once(
    'tests/one-sheet-reports.test.mjs',
    "assert.match(reportSource, /5 rate-valid airings, 3 fundraisers, and 3 distinct titles/);\n",
    """assert.match(reportSource, /5 rate-valid airings, 3 fundraisers, and 3 distinct titles/);
assert.match(reportSource, /Only schedule-reconciled/);
assert.match(reportSource, /excluded from start-time rankings/);
""",
    'report test unmatched start-time assertions'
)

# Version/cache bump.
for path in [
    'reports.html',
    'tests/library-load-performance.test.mjs',
    'tests/one-sheet-report-refinements.test.mjs',
    'tests/one-sheet-reports.test.mjs',
    'version.json',
]:
    replace_all(path, '0.22.125', '0.22.126', f'version bump {path}')

# Guardrails proving the intended source rules exist after edits.
analysis_text = Path(analysis).read_text()
reports_text = Path(reports).read_text()
if "dimension !== 'startTime' || !row.unmatchedImported" not in analysis_text:
    raise SystemExit('start-time unmatched exclusion missing after update')
if 'startTimeBreakdown' not in analysis_text or 'Unmatched rows by reported start time' not in reports_text:
    raise SystemExit('Preflight unmatched start-time audit missing after update')
if '0.22.125' in Path('version.json').read_text() or '0.22.125' in Path('reports.html').read_text():
    raise SystemExit('stale v0.22.125 report cache/version reference remains')

print('v0.22.126 source updater completed')

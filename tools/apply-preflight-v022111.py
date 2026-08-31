from pathlib import Path
import json

ROOT = Path('.')

def replace_once(path, old, new):
    text = path.read_text()
    if old not in text:
        raise SystemExit(f'missing expected block in {path}: {old[:120]!r}')
    if text.count(old) != 1:
        raise SystemExit(f'expected one match in {path}, found {text.count(old)}')
    path.write_text(text.replace(old, new, 1))

analysis = ROOT / 'assets/js/one-sheet-analysis.js'
reports = ROOT / 'assets/js/one-sheet-reports.js'
css = ROOT / 'assets/one-sheet-reports.css'
html = ROOT / 'reports.html'
refine = ROOT / 'tests/one-sheet-report-refinements.test.mjs'
report_test = ROOT / 'tests/one-sheet-reports.test.mjs'
version = ROOT / 'version.json'

replace_once(analysis,
"""      onlineTracked: Boolean(data.onlineTracked ?? meta.onlineTracked ?? onlineDollars > 0),
      mailTracked: Boolean(data.mailTracked ?? meta.mailTracked ?? mailDollars > 0),
      meta,
""",
"""      onlineTracked: Boolean(data.onlineTracked ?? meta.onlineTracked ?? onlineDollars > 0),
      mailTracked: Boolean(data.mailTracked ?? meta.mailTracked ?? mailDollars > 0),
      onlineTrackedExplicit: data.onlineTracked !== undefined || meta.onlineTracked !== undefined,
      mailTrackedExplicit: data.mailTracked !== undefined || meta.mailTracked !== undefined,
      meta,
""")

health_code = r'''
  function isNonSpecificDataLabel(value) {
    const key = lookupKey(value);
    const compact = key.replace(/\s+/g, '');
    return compact === 'nspl'
      || key === 'non specific'
      || key === 'non specific pledge'
      || key === 'non specific pledges'
      || key === 'non specific web pledge'
      || key === 'non specific web pledges';
  }

  function compactIdentityKey(value) {
    return text(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function preflightCaseCollisions(rows = [], field = '', label = '') {
    const groups = new Map();
    (rows || []).forEach((row) => {
      const raw = text(row?.[field]);
      const key = lookupKey(raw);
      if (!raw || !key) return;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(raw);
    });
    return [...groups.entries()]
      .filter(([_key, values]) => values.size > 1)
      .map(([_key, values]) => `${label}: ${[...values].sort().join(' / ')}`);
  }

  function preflightAmbiguousIdentities(airings = [], library = []) {
    const byTitle = new Map();
    const byNola = new Map();
    (library || []).forEach((row) => {
      const titleKey = lookupKey(row?.title);
      const nola = compactIdentityKey(row?.nola_code);
      if (titleKey) {
        if (!byTitle.has(titleKey)) byTitle.set(titleKey, []);
        byTitle.get(titleKey).push(row);
      }
      if (nola) {
        if (!byNola.has(nola)) byNola.set(nola, []);
        byNola.get(nola).push(row);
      }
    });
    const groups = new Map();
    (airings || []).forEach((row) => {
      const explicitId = text(row?.pledge_program_id || row?.manual_match_program_id || row?.program_id || '');
      if (explicitId) return;
      const title = text(row?.matched_library_title || row?.program_title || row?.title || row?.imported_program_title || '');
      if (!title || isNonSpecificDataLabel(title)) return;
      const titleKey = lookupKey(title);
      const nola = compactIdentityKey(row?.nola_code || row?.nola || row?.program_nola || '');
      const nolaRows = nola ? (byNola.get(nola) || []) : [];
      const titleRows = titleKey ? (byTitle.get(titleKey) || []) : [];
      let candidates = [];
      if (nola && titleKey) {
        candidates = nolaRows.filter((candidate) => lookupKey(candidate?.title) === titleKey);
        if (!candidates.length) candidates = nolaRows;
      } else if (nola) candidates = nolaRows;
      else candidates = titleRows;
      if (candidates.length <= 1) return;
      const key = `${titleKey}|${nola}`;
      if (!groups.has(key)) groups.set(key, { title, nola, rows: 0, candidates: candidates.length, sampleDate: importedDateKey(row) });
      groups.get(key).rows += 1;
    });
    return [...groups.values()]
      .sort((a, b) => b.rows - a.rows || a.title.localeCompare(b.title))
      .map((item) => `${item.title}${item.nola ? ` (${item.nola.toUpperCase()})` : ''}: ${item.rows} imported row${item.rows === 1 ? '' : 's'} could map to ${item.candidates} Library records${item.sampleDate ? `; sample ${item.sampleDate}` : ''}`);
  }

  function dataHealthReport(schedules = [], analyses = [], airings = [], library = []) {
    const checks = [];
    const add = (id, label, severity, summary, details = [], countOverride = null) => {
      const count = countOverride === null ? details.length : Number(countOverride || 0);
      checks.push({ id, label, severity, summary, count, details });
    };

    const reconciliation = [];
    (analyses || []).forEach((analysis) => {
      if (!(analysis?.importedRows || []).length) return;
      const imported = (analysis.importedRows || []).reduce((sum, row) => sum + (Number(row?.dollars ?? row?.contribution_amount ?? 0) || 0), 0);
      const represented = (analysis.placementRows || []).reduce((sum, row) => sum + (row?.known ? Number(row?.dollars || 0) : 0), 0);
      const difference = represented - imported;
      if (Math.abs(difference) > 0.01) {
        reconciliation.push(`${analysis.schedule?.title || 'Fundraiser'}: imported ${imported.toFixed(2)}, represented ${represented.toFixed(2)}, difference ${difference.toFixed(2)}`);
      }
    });
    add('broadcast-reconciliation', 'Broadcast reconciliation', 'fail', reconciliation.length ? 'Imported Broadcast totals do not fully reconcile to the analyzed result rows.' : 'Imported Broadcast totals reconcile to the analyzed result rows.', reconciliation);

    const missingDurations = [];
    (analyses || []).forEach((analysis) => {
      (analysis?.missingDurationRows || []).forEach((row) => {
        if ([row?.title, row?.plannedTitle, row?.topic].some(isNonSpecificDataLabel)) return;
        missingDurations.push(`${analysis.schedule?.title || 'Fundraiser'} · ${row?.dateKey || 'unknown date'} · ${text(row?.title || row?.plannedTitle || 'Untitled program')}`);
      });
    });
    add('missing-duration', 'Missing program durations', 'fail', missingDurations.length ? 'Programs without a saved schedule length or reliable Program Library runtime are excluded from $/hour analytics.' : 'Every scheduled program used by the reports has a usable duration.', missingDurations);

    const unmatchedPrograms = [];
    let nonSpecificRows = 0;
    let nonSpecificDollars = 0;
    (analyses || []).forEach((analysis) => {
      (analysis?.unmatchedImportedRows || []).forEach((row) => {
        if ([row?.title, row?.plannedTitle, row?.topic].some(isNonSpecificDataLabel)) {
          nonSpecificRows += 1;
          nonSpecificDollars += Number(row?.dollars || 0);
          return;
        }
        unmatchedPrograms.push(`${analysis.schedule?.title || 'Fundraiser'} · ${row?.dateKey || 'unknown date'} · ${text(row?.title || 'Unidentified imported result')} · $${Number(row?.dollars || 0).toFixed(2)}`);
      });
    });
    add('unmatched-imported', 'Unmatched imported program results', 'fail', unmatchedPrograms.length ? 'Imported program results remain that cannot be assigned confidently to a scheduled program/topic.' : 'All imported program-specific results are attributable; Non-Specific Pledges are intentionally excluded from this check.', unmatchedPrograms);

    const duplicateRanges = (schedules || [])
      .filter((schedule) => Number(schedule?.duplicateRangeCount || 1) > 1)
      .map((schedule) => `${schedule.title || 'Fundraiser'} · ${schedule.startDate || '?'}–${schedule.endDate || '?'} · ${schedule.duplicateRangeCount} records share this date range`);
    add('duplicate-ranges', 'Duplicate fundraiser date ranges', 'fail', duplicateRanges.length ? 'Multiple saved fundraiser records share an identical date range; analytics keeps the preferred record and suppresses the others.' : 'No duplicate fundraiser date ranges were detected.', duplicateRanges);

    const airingHashes = new Set((airings || []).map((row) => text(row?.row_hash)).filter(Boolean));
    const staleHashes = [];
    (schedules || []).forEach((schedule) => {
      (schedule?.placements || []).forEach((placement) => {
        const hash = text(placement?.sourceAiringHash || placement?.source_airing_hash || '');
        if (!hash || airingHashes.has(hash)) return;
        staleHashes.push(`${schedule.title || 'Fundraiser'} · ${text(placement?.dateKey || placement?.date_key || '?')} · ${text(placement?.programTitle || placement?.program_title || placement?.title || 'Untitled program')}`);
      });
    });
    add('stale-hashes', 'Stale imported-airing links', 'warn', staleHashes.length ? 'Saved placements reference imported row hashes that are no longer present. Current reports can often rematch by date/time/identity, but these links should be reviewed.' : 'No saved imported-airing hashes point to missing rows.', staleHashes);

    const ambiguousIdentities = preflightAmbiguousIdentities(airings, library);
    add('ambiguous-identities', 'Potential ambiguous imported identities', 'warn', ambiguousIdentities.length ? 'Some imported rows without an explicit Program Library ID have more than one plausible Library record.' : 'No multi-candidate imported identities were detected among rows lacking an explicit Library ID.', ambiguousIdentities);

    const topicCollisions = [
      ...preflightCaseCollisions(library, 'topic_primary', 'Primary topic'),
      ...preflightCaseCollisions(library, 'topic_secondary', 'Secondary topic')
    ];
    add('topic-case', 'Topic/subtopic case collisions', 'warn', topicCollisions.length ? 'Stored topic labels differ only by capitalization. Analytics combines them case-insensitively, but the source taxonomy should be cleaned.' : 'No topic or subtopic capitalization collisions were detected.', topicCollisions);

    const channelTracking = [];
    (schedules || []).forEach((schedule) => {
      if (!schedule?.onlineTrackedExplicit && Number(schedule?.onlineDollars || 0) === 0) channelTracking.push(`${schedule.title || 'Fundraiser'}: Online tracking is not explicitly recorded; $0 cannot distinguish tracked-zero from not tracked.`);
      if (!schedule?.mailTrackedExplicit && Number(schedule?.mailDollars || 0) === 0) channelTracking.push(`${schedule.title || 'Fundraiser'}: Mail tracking is not explicitly recorded; $0 cannot distinguish tracked-zero from not tracked.`);
    });
    add('channel-tracking', 'Online/Mail tracking state', 'warn', channelTracking.length ? 'Some historical fundraiser records rely on inferred channel tracking state.' : 'Online and Mail tracking state is explicitly recorded for all saved fundraisers.', channelTracking);

    const splitForWeekpart = (weekpart) => (analyses || []).map((analysis) => ({
      ...analysis,
      placementRows: (analysis?.placementRows || []).filter((row) => {
        const date = parseDate(row?.dateKey);
        if (!date) return false;
        if (weekpart === 'Saturday') return date.getDay() === 6;
        if (weekpart === 'Sunday') return date.getDay() === 0;
        return date.getDay() >= 1 && date.getDay() <= 5;
      })
    }));
    const coverage = ['Weekday', 'Saturday', 'Sunday'].map((weekpart) => ({
      weekpart,
      slots: historicalRanking(splitForWeekpart(weekpart), 'startTime').length
    }));
    add('start-time-coverage', 'Historical start-time sample coverage', 'info', 'Qualifying 30-minute start slots use the same 5-airing / 3-fundraiser / 3-title evidence rule as Historical Analytics.', coverage.map((item) => `${item.weekpart}: ${item.slots} qualifying start slot${item.slots === 1 ? '' : 's'}`), coverage.reduce((sum, item) => sum + item.slots, 0));

    add('non-specific', 'Non-Specific Pledges', 'info', 'Non-Specific Pledges are a legitimate giving category, not an attribution error; they have no program airtime or $/hour.', [`${nonSpecificRows} imported row${nonSpecificRows === 1 ? '' : 's'} · $${nonSpecificDollars.toFixed(2)} Broadcast`], nonSpecificRows);

    const failures = checks.filter((check) => check.severity === 'fail' && check.count > 0).length;
    const warnings = checks.filter((check) => check.severity === 'warn' && check.count > 0).length;
    return {
      status: failures ? 'review' : 'pass',
      failures,
      warnings,
      checks,
      metrics: {
        fundraisers: (analyses || []).length,
        importedRows: (analyses || []).reduce((sum, analysis) => sum + Number(analysis?.importedRows?.length || 0), 0),
        libraryPrograms: (library || []).length,
        scheduledAirings: (analyses || []).reduce((sum, analysis) => sum + Number(analysis?.scheduled || 0), 0)
      }
    };
  }
'''
replace_once(analysis, "\n  return {\n    SEASONS,\n", health_code + "\n  return {\n    SEASONS,\n")
replace_once(analysis, """    historicalRanking,
    missingDurationPrograms
""", """    historicalRanking,
    missingDurationPrograms,
    dataHealthReport
""")

old_titles = r'''  function titlesForFundraiserDay(analysis, day) {
    const dateKey = A.text(day?.dateKey || '');
    if (!dateKey) return [];
    const seen = new Set();
    return [...(analysis?.placementRows || [])]
      .filter((row) => A.text(row.dateKey) === dateKey && !rowIsNonSpecific(row))
      .sort((a, b) => Number(a.startMinutes ?? 99999) - Number(b.startMinutes ?? 99999))
      .map((row) => A.text(row.title || row.plannedTitle || ''))
      .filter((title) => {
        const key = title.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
'''
new_titles = r'''  function programResultsForFundraiserDay(analysis, day) {
    const dateKey = A.text(day?.dateKey || '');
    if (!dateKey) return [];
    const groups = new Map();
    [...(analysis?.placementRows || [])]
      .filter((row) => A.text(row.dateKey) === dateKey && !rowIsNonSpecific(row))
      .sort((a, b) => Number(a.startMinutes ?? 99999) - Number(b.startMinutes ?? 99999))
      .forEach((row) => {
        const title = A.text(row.title || row.plannedTitle || '');
        const key = title.toLowerCase();
        if (!key) return;
        if (!groups.has(key)) groups.set(key, { title, dollars: 0, known: false });
        const item = groups.get(key);
        if (row.known) {
          item.known = true;
          item.dollars += Number(row.dollars || 0);
        }
      });
    return [...groups.values()];
  }
'''
replace_once(reports, old_titles, new_titles)
replace_once(reports, "if (!weather) return 'Weather —';", "if (!weather) return '—';")
replace_once(reports,
"""            detail: `${formatDate(day.date)} · ${entry.label.title} · ${money(day.dollars)} Broadcast`,
            lines: titlesForFundraiserDay(analysis, day)
""",
"""            detail: `${formatDate(day.date)} · ${entry.label.title} · ${money(day.dollars)} Broadcast · Regional ${weatherLine(day)}`,
            lines: programResultsForFundraiserDay(analysis, day).map((item) => item.known
              ? `${item.title} — ${money(item.dollars)}`
              : `${item.title} — result unavailable`)
""")

hub_old = r'''        <a class="report-card-link" href="reports.html?report=historical">
          <div class="report-card-number">03</div>
          <div><h2>Historical Fundraiser Analytics</h2><p>Rank historical performance by season, topic, subtopic, start time by day type, weekday/weekend, daypart, break type, and distributor using median $/hour.</p></div><span>Open report →</span>
        </a>
      </section>`;
'''
hub_new = r'''        <a class="report-card-link" href="reports.html?report=historical">
          <div class="report-card-number">03</div>
          <div><h2>Historical Fundraiser Analytics</h2><p>Rank historical performance by season, topic, subtopic, start time by day type, weekday/weekend, daypart, break type, and distributor using median $/hour.</p></div><span>Open report →</span>
        </a>
        <a class="report-card-link" href="reports.html?report=preflight">
          <div class="report-card-number">04</div>
          <div><h2>Data Health / Preflight</h2><p>Check report readiness, Broadcast reconciliation, durations, unmatched imports, duplicate fundraisers, topic taxonomy, source links, channel tracking, and historical sample coverage.</p></div><span>Run preflight →</span>
        </a>
      </section>`;
'''
replace_once(reports, hub_old, hub_new)

preflight_code = r'''
  function preflightControls() {
    $('#report-controls').innerHTML = `<div class="report-control-row"><div class="historical-control-copy"><strong>Full historical dataset</strong><span>Preflight uses the same saved schedules, imported pledge results, and Program Library records as the reports.</span></div><button type="button" class="report-button" id="report-print">Print preflight</button></div>`;
    $('#report-print')?.addEventListener('click', () => window.print());
  }

  function preflightCheckMarkup(check) {
    const statusLabel = check.severity === 'fail'
      ? (check.count ? 'Needs attention' : 'Pass')
      : check.severity === 'warn'
        ? (check.count ? 'Warning' : 'Clear')
        : 'Information';
    const details = Array.isArray(check.details) ? check.details : [];
    const detailMarkup = details.length
      ? `<details ${check.severity !== 'info' && check.count ? 'open' : ''}><summary>${escapeHtml(count(details.length))} detail${details.length === 1 ? '' : 's'}</summary><ul>${details.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>`
      : '';
    return `<section class="preflight-check severity-${escapeHtml(check.severity)} ${check.count ? 'has-findings' : 'clear'}"><div class="preflight-check-head"><div><h2>${escapeHtml(check.label)}</h2><p>${escapeHtml(check.summary)}</p></div><span class="preflight-status">${escapeHtml(statusLabel)}${check.count ? ` · ${escapeHtml(count(check.count))}` : ''}</span></div>${detailMarkup}</section>`;
  }

  function renderPreflightReport() {
    const analyses = historicalAnalyses();
    const health = A.dataHealthReport(state.schedules, analyses, state.airings, state.library);
    const passed = health.status === 'pass';
    const headline = passed ? 'PASS' : 'REVIEW REQUIRED';
    const bannerCopy = passed
      ? (health.warnings ? `No blocking report-data defects detected. ${health.warnings} warning categor${health.warnings === 1 ? 'y' : 'ies'} remains for cleanup or verification.` : 'No blocking report-data defects or warnings were detected.')
      : `${health.failures} blocking check${health.failures === 1 ? '' : 's'} require attention before treating the report set as fully clean.`;
    const metrics = health.metrics || {};
    $('#report-output').innerHTML = `<article class="one-sheet preflight-sheet">
      <header class="sheet-title"><div><div class="report-kicker">WNMU-TV PBS report readiness</div><h1>Data Health / Preflight</h1><p>Automated consistency checks across the Pledge Library, Scheduler history, imported pledge results, and report analytics.</p></div><div class="sheet-stamp">Generated ${escapeHtml(new Date().toLocaleDateString())}</div></header>
      <section class="preflight-banner ${passed ? 'pass' : 'review'}"><strong>${escapeHtml(headline)}</strong><span>${escapeHtml(bannerCopy)}</span></section>
      <section class="preflight-metrics">
        <div><span>Fundraisers</span><strong>${escapeHtml(count(metrics.fundraisers))}</strong></div>
        <div><span>Imported rows</span><strong>${escapeHtml(count(metrics.importedRows))}</strong></div>
        <div><span>Scheduled airings</span><strong>${escapeHtml(count(metrics.scheduledAirings))}</strong></div>
        <div><span>Library programs</span><strong>${escapeHtml(count(metrics.libraryPrograms))}</strong></div>
      </section>
      <div class="preflight-checks">${(health.checks || []).map(preflightCheckMarkup).join('')}</div>
      <footer class="sheet-footer">PASS means no blocking defects were found in Broadcast reconciliation, program duration coverage, imported program attribution, or duplicate fundraiser ranges. Warnings identify cleanup or verification work that does not currently invalidate the printed report math. Non-Specific Pledges are treated as a valid giving category, not an attribution error.</footer>
    </article>`;
  }

  async function initPreflight() {
    document.title = 'WNMU Data Health / Preflight';
    $('#report-page-title').textContent = 'Data Health / Preflight';
    $('#report-page-subtitle').textContent = 'Report-readiness checks across the full pledge dataset';
    preflightControls();
    renderPreflightReport();
  }

'''
replace_once(reports, "\n  function weatherEndpointOrder(endDate = '') {\n", "\n" + preflight_code + "  function weatherEndpointOrder(endDate = '') {\n")
replace_once(reports,
"""      if (mode === 'comparison') await initComparison();
      else if (mode === 'fundraiser') await initFundraiser();
      else if (mode === 'historical') await initHistorical();
      else renderHub();
""",
"""      if (mode === 'comparison') await initComparison();
      else if (mode === 'fundraiser') await initFundraiser();
      else if (mode === 'historical') await initHistorical();
      else if (mode === 'preflight') await initPreflight();
      else renderHub();
""")

css_insert = r'''
.preflight-banner{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid #b8c9d1;border-radius:7px}.preflight-banner strong{font-size:1.35rem;letter-spacing:.03em}.preflight-banner span{font-size:.92rem;line-height:1.35}.preflight-banner.pass{background:#edf7f0;border-color:#9fc5aa;color:#245b35}.preflight-banner.review{background:#fff3e8;border-color:#d4a66d;color:#784917}
.preflight-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.preflight-metrics>div{border:1px solid #d0dade;border-radius:6px;padding:8px;background:#fff}.preflight-metrics span{display:block;font-size:.78rem;text-transform:uppercase;font-weight:850;color:var(--muted)}.preflight-metrics strong{display:block;font-size:1.2rem;margin-top:2px}
.preflight-checks{display:grid;gap:6px}.preflight-check{border:1px solid #d0dade;border-left:5px solid #9eb2bc;border-radius:6px;background:#fff;padding:8px 9px}.preflight-check.severity-fail.has-findings{border-left-color:#b4483f;background:#fff8f7}.preflight-check.severity-warn.has-findings{border-left-color:#b27a18;background:#fffbf1}.preflight-check.severity-info{border-left-color:#4c82a2}.preflight-check-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.preflight-check h2{font-size:1rem;margin:0 0 2px}.preflight-check p{margin:0;color:var(--muted);font-size:.86rem;line-height:1.35}.preflight-status{white-space:nowrap;font-size:.78rem;font-weight:900;text-transform:uppercase;letter-spacing:.03em}.preflight-check details{margin-top:6px;border-top:1px solid #e0e7ea;padding-top:5px}.preflight-check summary{cursor:pointer;font-weight:800;font-size:.82rem;color:#31586e}.preflight-check ul{margin:5px 0 0 18px;padding:0}.preflight-check li{margin:2px 0;font-size:.82rem;line-height:1.3;color:#415c69}
'''
replace_once(css, "\n@media(max-width:900px)", "\n" + css_insert + "@media(max-width:900px)")
replace_once(css, "  .report-topbar,.report-toolbar,.report-modal-backdrop{display:none!important}", "  .report-topbar,.report-toolbar,.report-modal-backdrop,.chart-hover-tooltip{display:none!important}")
replace_once(css, "  .fundraiser-kpis{grid-template-columns:repeat(4,minmax(0,1fr));gap:3px}", "  .fundraiser-kpis{grid-template-columns:repeat(4,minmax(0,1fr));gap:3px}.preflight-metrics{grid-template-columns:repeat(4,minmax(0,1fr));gap:3px}.preflight-check{break-inside:avoid;padding:5px 6px}.preflight-check details>ul{display:block!important}")

for old in ['0.22.110']:
    text = html.read_text()
    html.write_text(text.replace(old, '0.22.111'))

ref_text = refine.read_text()
ref_text = ref_text.replace("assert.match(reports, /function titlesForFundraiserDay/);", "assert.match(reports, /function programResultsForFundraiserDay/);\nassert.match(reports, /Regional \\${weatherLine\\(day\\)}/);\nassert.match(reports, /item\\.title} — \\${money\\(item\\.dollars\\)}/);")
ref_text = ref_text.replace('0\\.22\\.110', '0\\.22\\.111')
ref_text = ref_text.replace("assert.match(reports, /Return to Pledge Program Library/);", "assert.match(reports, /Return to Pledge Program Library/);\nassert.match(reports, /Data Health \\/ Preflight/);\nassert.match(reports, /function renderPreflightReport/);\nassert.match(reports, /A\\.dataHealthReport/);")
refine.write_text(ref_text)

report_text = report_test.read_text()
report_text = report_text.replace("assert.match(reportSource, /Continue with incomplete data/);", "assert.match(reportSource, /Continue with incomplete data/);\nassert.match(reportSource, /Data Health \\/ Preflight/);\nassert.match(reportSource, /programResultsForFundraiserDay/);\nassert.match(reportSource, /Regional \\${weatherLine\\(day\\)}/);")
report_test.write_text(report_text)

preflight_test = ROOT / 'tests/data-health-preflight.test.mjs'
preflight_test.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/one-sheet-analysis.js', import.meta.url), 'utf8');
const sandbox = { console, Date, Map, Set, Math, Number, String, Array, Object, RegExp };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const A = sandbox.WNMUOneSheetAnalysis;
assert.ok(A?.dataHealthReport, 'dataHealthReport should be exported');

const schedule = A.normalizeSchedule({
  id: 's1', title: 'August 2026', start_date: '2026-08-08', end_date: '2026-08-18',
  schedule_data: { placements: [{ dateKey: '2026-08-08', programTitle: 'Missing Length', sourceAiringHash: 'gone-hash' }], onlineDollars: 0, mailDollars: 0 }
});
assert.equal(schedule.onlineTrackedExplicit, false);
assert.equal(schedule.mailTrackedExplicit, false);
schedule.duplicateRangeCount = 2;

const nspl = { title: 'Non-Specific Pledges', topic: 'Non-Specific Pledges', unmatchedImported: true, known: true, dollars: 50, dateKey: '2026-08-08' };
const unmatched = { title: 'Mystery Program', topic: 'Unattributed', unmatchedImported: true, known: true, dollars: 20, dateKey: '2026-08-08' };
const missing = { title: 'Missing Length', topic: 'Music', known: true, dollars: 90, durationMissing: true, minutes: 0, dateKey: '2026-08-08', startMinutes: 1200 };
const analysis = {
  schedule,
  importedRows: [{ row_hash: 'live-hash', air_date: '2026-08-08', dollars: 100 }],
  placementRows: [missing, nspl, unmatched],
  unmatchedImportedRows: [nspl, unmatched],
  missingDurationRows: [missing],
  scheduled: 1
};
const library = [
  { id: 'a', title: 'Concert A', topic_primary: 'Music', topic_secondary: 'Concert' },
  { id: 'b', title: 'Concert B', topic_primary: 'MUSIC', topic_secondary: 'CONCERT' }
];
const health = A.dataHealthReport([schedule], [analysis], [{ row_hash: 'live-hash', air_date: '2026-08-08', dollars: 100, program_id: 'a' }], library);
assert.equal(health.status, 'review');
assert.ok(health.checks.find((check) => check.id === 'missing-duration').count > 0);
assert.equal(health.checks.find((check) => check.id === 'unmatched-imported').count, 1, 'Non-Specific Pledges must not count as unmatched program results');
assert.ok(health.checks.find((check) => check.id === 'topic-case').count >= 2);
assert.ok(health.checks.find((check) => check.id === 'duplicate-ranges').count > 0);
assert.ok(health.checks.find((check) => check.id === 'stale-hashes').count > 0);
assert.ok(health.checks.find((check) => check.id === 'channel-tracking').count > 0);

const cleanSchedule = { id: 'clean', title: 'Clean', startDate: '2026-08-01', endDate: '2026-08-02', placements: [], onlineDollars: 0, mailDollars: 0, onlineTrackedExplicit: true, mailTrackedExplicit: true };
const cleanAnalysis = { schedule: cleanSchedule, importedRows: [{ row_hash: 'r1', dollars: 25 }], placementRows: [{ known: true, dollars: 25, durationMissing: false, title: 'Clean Program', dateKey: '2026-08-01', startMinutes: 1200, minutes: 60 }], unmatchedImportedRows: [], missingDurationRows: [], scheduled: 1 };
const cleanHealth = A.dataHealthReport([cleanSchedule], [cleanAnalysis], [{ row_hash: 'r1', dollars: 25, program_id: 'p1' }], [{ id: 'p1', title: 'Clean Program', topic_primary: 'Music', topic_secondary: 'Concert' }]);
assert.equal(cleanHealth.status, 'pass');
assert.equal(cleanHealth.failures, 0);

console.log('data health preflight tests passed');
''')

version.write_text(json.dumps({'appVersion':'0.22.111','releasedAt':'2026-08-31'}, separators=(',', ':')) + '\n')

print('v0.22.111 preflight patch applied')

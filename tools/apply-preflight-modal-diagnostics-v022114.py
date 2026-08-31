from pathlib import Path
import json

ROOT = Path('.')


def replace_once(path, old, new):
    text = path.read_text()
    if old not in text:
        raise SystemExit(f'missing expected block in {path}: {old[:180]!r}')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one match in {path}, found {count}')
    path.write_text(text.replace(old, new, 1))

analysis = ROOT / 'assets/js/one-sheet-analysis.js'
reports = ROOT / 'assets/js/one-sheet-reports.js'
css = ROOT / 'assets/one-sheet-reports.css'
index = ROOT / 'index.html'
report_html = ROOT / 'reports.html'
version = ROOT / 'version.json'
health_test = ROOT / 'tests/data-health-preflight.test.mjs'
refine_test = ROOT / 'tests/one-sheet-report-refinements.test.mjs'
load_test = ROOT / 'tests/library-load-performance.test.mjs'

# Preserve raw imported identity on unmatched normalized rows so Preflight can explain what did not line up.
replace_once(
    analysis,
    "      rowHash: text(row.row_hash || ''),\n      programId: text(lib.id || row.program_id || row.pledge_program_id || '')\n",
    "      rowHash: text(row.row_hash || ''),\n      importedSourceTitle: text(row.imported_program_title || row.program_title || row.title || ''),\n      importedMatchedTitle: text(row.matched_library_title || ''),\n      importedNola: text(row.nola_code || row.nola || row.program_nola || ''),\n      programId: text(lib.id || row.program_id || row.pledge_program_id || '')\n"
)

helpers = r'''  function preflightClockLabel(minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value)) return 'unknown time';
    const normalized = ((Math.round(value) % 1440) + 1440) % 1440;
    const hour24 = Math.floor(normalized / 60);
    const minute = normalized % 60;
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
  }

  function preflightSavedPlacementDollars(placement = {}) {
    const imported = placement?.importedBroadcastDollars;
    if (imported !== '' && imported != null && Number.isFinite(Number(imported))) return Number(imported);
    if (placement?.manualResultRecorded && Number.isFinite(Number(placement?.manualBroadcastDollars))) return Number(placement.manualBroadcastDollars);
    return null;
  }

  function preflightUnmatchedDiagnostic(row = {}, analysis = {}, indexes = {}) {
    const importedTitle = text(row?.importedSourceTitle || row?.title || 'Unidentified imported result');
    const resolvedTitle = text(row?.title || importedTitle);
    const importedDate = text(row?.dateKey || '');
    const importedStart = Number(row?.startMinutes);
    const importedDollars = Number(row?.dollars || 0) || 0;
    const importedProgramId = text(row?.programId || '');
    const placements = (analysis?.schedule?.placements || [])
      .filter((placement) => !placement?.isNonPledge)
      .map((placement) => {
        const lib = libraryForPlacement(placement, indexes) || {};
        return {
          placement,
          dateKey: text(placement?.dateKey || placement?.date_key || ''),
          startMinutes: placementStartMinutes(placement),
          title: text(lib?.title || placement?.programTitle || placement?.program_title || placement?.title || 'Untitled program'),
          programId: text(lib?.id || placement?.programId || placement?.program_id || ''),
          savedDollars: preflightSavedPlacementDollars(placement)
        };
      });

    const identityMatches = (candidate) => {
      if (!candidate) return false;
      if (importedProgramId && candidate.programId && importedProgramId === candidate.programId) return true;
      const candidateKey = lookupKey(candidate.title);
      return Boolean(candidateKey && [importedTitle, resolvedTitle].some((value) => lookupKey(value) === candidateKey));
    };
    const sameDate = placements.filter((candidate) => importedDate && candidate.dateKey === importedDate);
    const sameDateTime = sameDate.filter((candidate) => Number.isFinite(importedStart) && Number.isFinite(candidate.startMinutes) && candidate.startMinutes === importedStart);
    const sameIdentity = placements.filter(identityMatches);
    const sameDateIdentity = sameDate.filter(identityMatches);
    const sameIdentityTime = sameIdentity.filter((candidate) => Number.isFinite(importedStart) && Number.isFinite(candidate.startMinutes) && candidate.startMinutes === importedStart);

    let candidate = null;
    let ambiguous = false;
    const unique = (rows) => rows.length === 1 ? rows[0] : null;
    candidate = unique(sameDateTime.filter(identityMatches))
      || unique(sameDateTime)
      || unique(sameDateIdentity)
      || unique(sameIdentityTime)
      || unique(sameIdentity)
      || unique(sameDate);
    if (!candidate) {
      ambiguous = sameDateTime.length > 1 || sameDateIdentity.length > 1 || sameIdentity.length > 1 || sameDate.length > 1;
    }

    const mismatchTypes = [];
    const parts = [];
    const addMismatch = (type, message) => {
      if (!mismatchTypes.includes(type)) mismatchTypes.push(type);
      if (message) parts.push(message);
    };

    if (candidate) {
      const rawTitleKey = lookupKey(importedTitle);
      const scheduledTitleKey = lookupKey(candidate.title);
      if (rawTitleKey && scheduledTitleKey && rawTitleKey !== scheduledTitleKey) {
        addMismatch('Title match problem', `Title: imported “${importedTitle}” vs scheduled “${candidate.title}”`);
      }
      if (importedDate && candidate.dateKey && importedDate !== candidate.dateKey) {
        addMismatch('Air date mismatch', `Air date: imported ${importedDate} vs scheduled ${candidate.dateKey}`);
      }
      if (Number.isFinite(importedStart) && Number.isFinite(candidate.startMinutes) && importedStart !== candidate.startMinutes) {
        addMismatch('Air time mismatch', `Air time: imported ${preflightClockLabel(importedStart)} vs scheduled ${preflightClockLabel(candidate.startMinutes)}`);
      }
      if (Number.isFinite(candidate.savedDollars) && Math.abs(candidate.savedDollars - importedDollars) > 0.01) {
        addMismatch('Dollar mismatch', `Dollars: imported $${importedDollars.toFixed(2)} vs saved $${candidate.savedDollars.toFixed(2)}`);
      }
      if (!mismatchTypes.length) {
        addMismatch('No unique scheduled match', 'The imported row resembles a scheduled placement, but it was not the unique row consumed by the current matching rules.');
      }
    } else {
      if (!sameDate.length) addMismatch('Air date mismatch', `Air date: imported ${importedDate || 'unknown'}; no scheduled pledge placement exists on that date.`);
      if (!sameIdentity.length) addMismatch('Title match problem', `Title: imported “${importedTitle}”; no scheduled placement has the same Program Library identity/title.`);
      if (sameDate.length && Number.isFinite(importedStart) && !sameDate.some((candidate) => Number.isFinite(candidate.startMinutes) && candidate.startMinutes === importedStart)) {
        const scheduledTimes = [...new Set(sameDate.map((candidate) => candidate.startMinutes).filter(Number.isFinite).map(preflightClockLabel))];
        addMismatch('Air time mismatch', `Air time: imported ${preflightClockLabel(importedStart)}${scheduledTimes.length ? `; scheduled that day: ${scheduledTimes.join(', ')}` : ''}`);
      }
      if (ambiguous) addMismatch('Ambiguous schedule slot', 'More than one scheduled placement is plausible, so the imported row cannot be assigned confidently.');
      if (!mismatchTypes.length) addMismatch('No unique scheduled match', 'No unique scheduled pledge placement could be identified for this imported result.');
    }

    return {
      title: resolvedTitle || importedTitle,
      programId: importedProgramId,
      mismatchTypes,
      detail: `${analysis?.schedule?.title || 'Fundraiser'} · imported ${importedDate || 'unknown date'}${Number.isFinite(importedStart) ? ` ${preflightClockLabel(importedStart)}` : ''} · $${importedDollars.toFixed(2)} · ${parts.join(' · ')}`,
      imported: {
        title: importedTitle,
        dateKey: importedDate,
        startMinutes: Number.isFinite(importedStart) ? importedStart : null,
        dollars: importedDollars
      },
      scheduled: candidate ? {
        title: candidate.title,
        programId: candidate.programId,
        dateKey: candidate.dateKey,
        startMinutes: Number.isFinite(candidate.startMinutes) ? candidate.startMinutes : null,
        dollars: Number.isFinite(candidate.savedDollars) ? candidate.savedDollars : null
      } : null
    };
  }

'''
replace_once(analysis, "  function dataHealthReport(schedules = [], analyses = [], airings = [], library = []) {\n", helpers + "  function dataHealthReport(schedules = [], analyses = [], airings = [], library = []) {\n")

# Make reconciliation findings explicitly identify a dollar mismatch.
replace_once(
    analysis,
    "        reconciliation.push(`${analysis.schedule?.title || 'Fundraiser'}: imported ${imported.toFixed(2)}, represented ${represented.toFixed(2)}, difference ${difference.toFixed(2)}`);\n",
    "        reconciliation.push({\n          title: text(analysis.schedule?.title || 'Fundraiser'),\n          programId: '',\n          mismatchTypes: ['Dollar mismatch'],\n          detail: `Imported Broadcast $${imported.toFixed(2)} vs analyzed $${represented.toFixed(2)} · difference $${difference.toFixed(2)}`\n        });\n"
)

replace_once(
    analysis,
    "    const unmatchedPrograms = [];\n    let nonSpecificRows = 0;\n",
    "    const unmatchedPrograms = [];\n    const healthIndexes = buildLibraryIndexes(library);\n    let nonSpecificRows = 0;\n"
)
replace_once(
    analysis,
    "        unmatchedPrograms.push({\n          title: text(row?.title || 'Unidentified imported result'),\n          programId: text(row?.programId || ''),\n          detail: `${analysis.schedule?.title || 'Fundraiser'} · ${row?.dateKey || 'unknown date'} · $${Number(row?.dollars || 0).toFixed(2)}`\n        });\n",
    "        unmatchedPrograms.push(preflightUnmatchedDiagnostic(row, analysis, healthIndexes));\n"
)

# Reports: replace deep links with in-place modal buttons and structured mismatch tags.
old_detail = """      const titleMarkup = programId && title
        ? `<a class=\"preflight-program-link\" href=\"./?openProgram=${encodeURIComponent(programId)}\" target=\"_blank\" rel=\"noopener\" title=\"Open ${escapeHtml(title)} in the Pledge Program Library\">${escapeHtml(title)}</a>`
        : escapeHtml(title);
      return `${titleMarkup}${detail ? `${titleMarkup ? ' · ' : ''}${escapeHtml(detail)}` : ''}` || '—';
"""
new_detail = """      const mismatchTypes = Array.isArray(item.mismatchTypes) ? item.mismatchTypes.filter(Boolean) : [];
      const titleMarkup = programId && title
        ? `<button type=\"button\" class=\"preflight-program-link\" data-preflight-program-id=\"${escapeHtml(programId)}\" data-preflight-program-title=\"${escapeHtml(title)}\" title=\"Edit ${escapeHtml(title)}\">${escapeHtml(title)}</button>`
        : escapeHtml(title);
      const tags = mismatchTypes.length ? `<span class=\"preflight-mismatch-tags\">${mismatchTypes.map((type) => `<span class=\"preflight-mismatch-tag\">${escapeHtml(type)}</span>`).join('')}</span>` : '';
      return `<span class=\"preflight-detail-line\">${titleMarkup}${tags}${detail ? `<span class=\"preflight-detail-copy\">${escapeHtml(detail)}</span>` : ''}</span>` || '—';
"""
replace_once(reports, old_detail, new_detail)

modal_helpers = r'''  function ensurePreflightProgramEditor() {
    let backdrop = document.getElementById('preflight-program-editor-backdrop');
    if (backdrop) return backdrop;
    backdrop = document.createElement('div');
    backdrop.id = 'preflight-program-editor-backdrop';
    backdrop.className = 'preflight-program-editor-backdrop hidden';
    backdrop.innerHTML = `<section class="preflight-program-editor-modal" role="dialog" aria-modal="true" aria-labelledby="preflight-program-editor-title">
      <header class="preflight-program-editor-head">
        <div><div class="report-kicker">Pledge Program Library editor</div><h2 id="preflight-program-editor-title">Program details</h2></div>
        <button type="button" class="report-button" id="preflight-program-editor-close">Close & refresh Preflight</button>
      </header>
      <div class="preflight-program-editor-body"><iframe id="preflight-program-editor-frame" title="Pledge Program Library detail editor"></iframe></div>
    </section>`;
    document.body.append(backdrop);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) void closePreflightProgramEditor();
    });
    backdrop.querySelector('#preflight-program-editor-close')?.addEventListener('click', () => { void closePreflightProgramEditor(); });
    return backdrop;
  }

  function openPreflightProgramEditor(programId, title = '') {
    const id = A.text(programId || '');
    if (!id) return;
    const backdrop = ensurePreflightProgramEditor();
    const frame = backdrop.querySelector('#preflight-program-editor-frame');
    const heading = backdrop.querySelector('#preflight-program-editor-title');
    if (heading) heading.textContent = title ? `Edit ${title}` : 'Edit program';
    if (frame) frame.src = `./?openProgram=${encodeURIComponent(id)}&detailOnly=1&from=preflight`;
    backdrop.classList.remove('hidden');
    document.body.classList.add('preflight-program-editor-open');
    backdrop.querySelector('#preflight-program-editor-close')?.focus();
  }

  async function closePreflightProgramEditor({ refresh = true } = {}) {
    const backdrop = document.getElementById('preflight-program-editor-backdrop');
    if (!backdrop || backdrop.classList.contains('hidden')) return;
    backdrop.classList.add('hidden');
    document.body.classList.remove('preflight-program-editor-open');
    const frame = backdrop.querySelector('#preflight-program-editor-frame');
    if (frame) frame.src = 'about:blank';
    if (refresh && reportMode() === 'preflight') {
      if ($('#report-status')) $('#report-status').textContent = 'Refreshing Preflight after program edit…';
      await loadData();
      renderPreflightReport();
      if ($('#report-status')) $('#report-status').textContent = 'Preflight refreshed.';
    }
  }

  function bindPreflightProgramEditor() {
    const output = $('#report-output');
    if (!output || output.dataset.preflightEditorBound === 'true') return;
    output.dataset.preflightEditorBound = 'true';
    output.addEventListener('click', (event) => {
      const button = event.target?.closest?.('[data-preflight-program-id]');
      if (!button) return;
      openPreflightProgramEditor(button.getAttribute('data-preflight-program-id') || '', button.getAttribute('data-preflight-program-title') || button.textContent || '');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !document.getElementById('preflight-program-editor-backdrop')?.classList.contains('hidden')) {
        event.preventDefault();
        void closePreflightProgramEditor();
      }
    });
  }

'''
replace_once(reports, "  function preflightControls() {\n", modal_helpers + "  function preflightControls() {\n")
replace_once(
    reports,
    "    preflightControls();\n    renderPreflightReport();\n",
    "    preflightControls();\n    renderPreflightReport();\n    bindPreflightProgramEditor();\n"
)

# Report CSS for true in-place editor modal and mismatch labels.
css_add = r'''
.preflight-program-link{appearance:none;border:0;background:none;padding:0;margin:0;font:inherit;font-weight:850;color:#145f91;text-decoration:underline;text-underline-offset:2px;cursor:pointer;text-align:left}
.preflight-program-link:hover,.preflight-program-link:focus-visible{color:#0b456d;text-decoration-thickness:2px;outline-offset:2px}
.preflight-detail-line{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}
.preflight-detail-copy{flex-basis:100%;color:#425e6d}
.preflight-mismatch-tags{display:inline-flex;flex-wrap:wrap;gap:4px}
.preflight-mismatch-tag{display:inline-flex;align-items:center;border:1px solid #d2a8a8;border-radius:999px;background:#fff4f4;color:#8a2e2e;padding:1px 7px;font-size:.78rem;font-weight:850}
.preflight-program-editor-backdrop{position:fixed;inset:0;z-index:5000;background:rgb(12 31 42 / 58%);display:grid;place-items:center;padding:22px}
.preflight-program-editor-backdrop.hidden{display:none}
.preflight-program-editor-modal{width:min(1180px,96vw);height:min(900px,94vh);background:#fff;border-radius:14px;box-shadow:0 24px 70px rgb(0 0 0 / 30%);overflow:hidden;display:grid;grid-template-rows:auto 1fr}
.preflight-program-editor-head{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 16px;border-bottom:1px solid #d7e2e7;background:#f8fbfc}
.preflight-program-editor-head h2{margin:2px 0 0;font-size:1.15rem;color:#17384a}
.preflight-program-editor-body{min-height:0;background:#fff}
.preflight-program-editor-body iframe{display:block;width:100%;height:100%;border:0;background:#fff}
body.preflight-program-editor-open{overflow:hidden}
@media(max-width:720px){.preflight-program-editor-backdrop{padding:0}.preflight-program-editor-modal{width:100vw;height:100vh;border-radius:0}.preflight-program-editor-head{align-items:flex-start;flex-direction:column}}
@media print{.preflight-program-editor-backdrop{display:none!important}.preflight-program-link{color:inherit;text-decoration:none}.preflight-mismatch-tag{font-size:8pt}}
'''
css_text = css.read_text()
# Replace the earlier simpler link rules so we do not maintain duplicate definitions.
css_text = css_text.replace("\n.preflight-program-link{font-weight:850;color:#145f91;text-decoration:underline;text-underline-offset:2px}\n.preflight-program-link:hover,.preflight-program-link:focus-visible{color:#0b456d;text-decoration-thickness:2px}\n", "\n")
if '.preflight-program-editor-backdrop{' not in css_text:
    css_text += css_add
css.write_text(css_text)

# Program Library detail-only mode: use the exact existing editor, but hide the complete Library workspace inside the iframe.
replace_once(index, "    let VERSION='', LABEL='';\n", "    let VERSION='', LABEL='';\n    const DETAIL_ONLY=new URL(window.location.href).searchParams.get('detailOnly')==='1';\n")
detail_only_fn = r'''    function applyDetailOnly(doc){
      if(!DETAIL_ONLY)return;
      doc.body.classList.add('library-detail-only');
      const style=doc.createElement('style');
      style.id='library-detail-only-style';
      style.textContent=`
        body.library-detail-only{margin:0!important;background:#fff!important;min-height:100vh;overflow:auto!important}
        body.library-detail-only .topbar,
        body.library-detail-only .workspace-switcher,
        body.library-detail-only .controls,
        body.library-detail-only .list-panel,
        body.library-detail-only #library-split-mobile-switcher,
        body.library-detail-only #library-split-divider,
        body.library-detail-only #library-split-add-button,
        body.library-detail-only #loading-banner,
        body.library-detail-only #update-banner,
        body.library-detail-only #version-gate,
        body.library-detail-only footer,
        body.library-detail-only [data-workspace-pane]:not([data-workspace-pane="library"]){display:none!important}
        body.library-detail-only .app-shell{display:block!important;max-width:none!important;margin:0!important;padding:0!important}
        body.library-detail-only [data-workspace-pane="library"]{display:block!important;margin:0!important;padding:0!important}
        body.library-detail-only #library-split-detail-host{display:block!important;position:static!important;width:100%!important;max-width:none!important;min-width:0!important;height:auto!important;border:0!important;padding:0!important;margin:0!important}
        body.library-detail-only #detail-backdrop{display:none!important}
        body.library-detail-only #detail-modal,body.library-detail-only #detail-modal.hidden{display:block!important;position:static!important;inset:auto!important;width:100%!important;max-width:none!important;height:auto!important;max-height:none!important;margin:0!important;padding:0!important}
        body.library-detail-only #detail-modal .detail-modal-card{width:100%!important;max-width:none!important;min-height:100vh!important;max-height:none!important;margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important}
        body.library-detail-only #detail-close-button{display:none!important}
        body.library-detail-only.modal-open{overflow:auto!important}
      `;
      doc.head.append(style);
    }
'''
replace_once(index, "    function injectReportsLink(doc){\n", detail_only_fn + "    function injectReportsLink(doc){\n")
replace_once(index, "      buildSplit(doc);injectReportsLink(doc);injectAssets(doc);\n", "      buildSplit(doc);injectReportsLink(doc);injectAssets(doc);applyDetailOnly(doc);\n")

# Cache/version release markers.
report_text = report_html.read_text().replace('0.22.113', '0.22.114')
report_html.write_text(report_text)
payload = json.loads(version.read_text())
payload['appVersion'] = '0.22.114'
payload['releasedAt'] = '2026-08-31'
version.write_text(json.dumps(payload, separators=(',', ':')) + '\n')

# Existing version tests must follow the release.
load_text = load_test.read_text().replace("assert.equal(version.appVersion, '0.22.113');", "assert.equal(version.appVersion, '0.22.114');")
load_test.write_text(load_text)
refine_text = refine_test.read_text().replace(r'0\.22\.113', r'0\.22\.114')
refine_test.write_text(refine_text)

# Regression coverage: exact mismatch reasons and in-place popup behavior.
with health_test.open('a') as fh:
    fh.write(r'''

const mismatchSchedule = A.normalizeSchedule({
  id: 'mismatch', title: 'Mismatch Drive', start_date: '2026-08-08', end_date: '2026-08-18',
  schedule_data: { placements: [{ dateKey: '2026-08-08', startMinutes: 1200, programTitle: 'Expected Program', importedBroadcastDollars: 35, lengthMinutes: 60 }] }
});
const mismatchAnalysis = {
  schedule: mismatchSchedule,
  importedRows: [{ row_hash: 'mismatch-row', air_date: '2026-08-08', air_time: '20:30', dollars: 40, imported_program_title: 'Wrong Imported Title' }],
  placementRows: [],
  unmatchedImportedRows: [{ title: 'Wrong Imported Title', importedSourceTitle: 'Wrong Imported Title', programId: '', dateKey: '2026-08-08', startMinutes: 1230, dollars: 40, unmatchedImported: true, known: true }],
  missingDurationRows: [],
  scheduled: 1
};
const mismatchHealth = A.dataHealthReport([mismatchSchedule], [mismatchAnalysis], mismatchAnalysis.importedRows, []);
const mismatchDetail = mismatchHealth.checks.find((check) => check.id === 'unmatched-imported').details[0];
assert.ok(mismatchDetail.mismatchTypes.includes('Title match problem'));
assert.ok(mismatchDetail.mismatchTypes.includes('Air time mismatch'));
assert.ok(mismatchDetail.mismatchTypes.includes('Dollar mismatch'));
assert.match(mismatchDetail.detail, /Wrong Imported Title/);
assert.match(mismatchDetail.detail, /Expected Program/);
assert.match(mismatchDetail.detail, /8:30 PM/);
assert.match(mismatchDetail.detail, /8:00 PM/);
assert.match(mismatchDetail.detail, /\$40\.00/);
assert.match(mismatchDetail.detail, /\$35\.00/);
''')

with refine_test.open('a') as fh:
    fh.write(r'''

assert.match(reports, /data-preflight-program-id/);
assert.match(reports, /function openPreflightProgramEditor/);
assert.match(reports, /preflight-program-editor-frame/);
assert.match(reports, /detailOnly=1/);
assert.match(reports, /Close & refresh Preflight/);
assert.match(reports, /preflight-mismatch-tag/);
assert.doesNotMatch(reports, /class=\"preflight-program-link\" href=/);
assert.match(index, /const DETAIL_ONLY=/);
assert.match(index, /library-detail-only/);
assert.match(index, /#detail-close-button\{display:none!important\}/);
assert.match(css, /\.preflight-program-editor-backdrop\{/);
''')

print('v0.22.114 Preflight modal diagnostics patch applied')

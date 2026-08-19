from pathlib import Path
import json


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


shell = Path("app-shell.html")
dom = Path("assets/js/dom.js")
sched = Path("assets/js/ui-scheduling.js")
styles = Path("assets/styles.css")
version = Path("version.json")

replace_once(
    shell,
    '''          <div class="schedule-picker-actions">''',
    '''          <section id="schedule-manual-result-panel" class="schedule-manual-result-panel hidden" aria-label="Manual pledge result">
            <div class="schedule-manual-result-head">
              <div>
                <strong>Manual result</strong>
                <div id="schedule-manual-result-status" class="muted">Use this when no pledge report result is available for this airing.</div>
              </div>
            </div>
            <div class="schedule-manual-result-fields">
              <label class="filter-field narrow">
                <span class="filter-label">Broadcast $</span>
                <input id="schedule-manual-result-dollars" type="number" min="0" step="0.01" inputmode="decimal" value="0">
              </label>
              <label class="filter-field narrow">
                <span class="filter-label">Pledges</span>
                <input id="schedule-manual-result-pledges" type="number" min="0" step="1" inputmode="numeric" value="0">
              </label>
              <div class="schedule-manual-result-actions">
                <button type="button" class="primary" id="schedule-manual-result-save-button">Save result</button>
                <button type="button" class="ghost" id="schedule-manual-result-clear-button">Clear manual result</button>
              </div>
            </div>
          </section>
          <div class="schedule-picker-actions">''',
    "manual result panel",
)

replace_once(
    dom,
    '''    scheduleLiveBreakFlag: document.getElementById('schedule-live-break-flag'),
    scheduleFilterUnaired:''',
    '''    scheduleLiveBreakFlag: document.getElementById('schedule-live-break-flag'),
    scheduleManualResultPanel: document.getElementById('schedule-manual-result-panel'),
    scheduleManualResultStatus: document.getElementById('schedule-manual-result-status'),
    scheduleManualResultDollars: document.getElementById('schedule-manual-result-dollars'),
    scheduleManualResultPledges: document.getElementById('schedule-manual-result-pledges'),
    scheduleManualResultSaveButton: document.getElementById('schedule-manual-result-save-button'),
    scheduleManualResultClearButton: document.getElementById('schedule-manual-result-clear-button'),
    scheduleFilterUnaired:''',
    "manual result DOM refs",
)

replace_once(
    sched,
    '''      importedFromReport: normalizePlacementBoolean(placement?.importedFromReport, Boolean(placement?.importedFromReport)),
      transferredToStation:''',
    '''      importedFromReport: normalizePlacementBoolean(placement?.importedFromReport, Boolean(placement?.importedFromReport)),
      manualResultRecorded: normalizePlacementBoolean(placement?.manualResultRecorded, Boolean(placement?.manualResultRecorded)),
      manualBroadcastDollars: Number.isFinite(Number(placement?.manualBroadcastDollars)) ? Number(placement.manualBroadcastDollars) : 0,
      manualPledgeCount: Number.isFinite(Number(placement?.manualPledgeCount)) ? Math.max(0, Math.trunc(Number(placement.manualPledgeCount))) : 0,
      manualResultUpdatedAt: utils.normalizeText(placement?.manualResultUpdatedAt || ''),
      transferredToStation:''',
    "manual result normalization",
)

replace_once(
    sched,
    '''  function placementBroadcastTotal(schedule = {}) {
    return (schedule?.placements || []).reduce((sum, placement) => {
      const value = Number(placement?.importedBroadcastDollars);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }
''',
    '''  function placementHasManualResult(placement = {}) {
    return Boolean(placement && !placement.isNonPledge && normalizePlacementBoolean(placement?.manualResultRecorded, false));
  }

  function placementManualResultDollars(placement = {}) {
    if (!placementHasManualResult(placement)) return 0;
    const value = Number(placement?.manualBroadcastDollars);
    return Number.isFinite(value) ? value : 0;
  }

  function scheduleManualBroadcastTotal(schedule = {}) {
    return (schedule?.placements || []).reduce((sum, placement) => sum + placementManualResultDollars(placement), 0);
  }

  function scheduleManualPledgesTotal(schedule = {}) {
    return (schedule?.placements || []).reduce((sum, placement) => {
      if (!placementHasManualResult(placement)) return sum;
      const value = Number(placement?.manualPledgeCount);
      return sum + (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);
    }, 0);
  }

  function placementBroadcastTotal(schedule = {}) {
    return (schedule?.placements || []).reduce((sum, placement) => {
      const value = Number(placement?.importedBroadcastDollars);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  }
''',
    "manual result total helpers",
)

replace_once(
    sched,
    '''  function scheduleImportedPledgesTotal(schedule = {}) {
    const metaTotal = Number(schedule?.meta?.importedPledgesTotal);
    return Number.isFinite(metaTotal) && metaTotal > 0 ? metaTotal : 0;
  }
''',
    '''  function scheduleImportedPledgesTotal(schedule = {}) {
    const metaTotal = Number(schedule?.meta?.importedPledgesTotal);
    return Number.isFinite(metaTotal) && metaTotal > 0 ? metaTotal : 0;
  }

  function schedulePledgesTotal(schedule = {}) {
    return scheduleImportedPledgesTotal(schedule) + scheduleManualPledgesTotal(schedule);
  }
''',
    "manual pledge total helper",
)

replace_once(
    sched,
    '''  function scheduleBroadcastTotal(schedule = {}) {
    const reported = scheduleReportedBroadcastTotal(schedule);
    if (reported > 0) return reported;
    return scheduleImportedAiringTotal(schedule);
  }
''',
    '''  function scheduleBroadcastTotal(schedule = {}) {
    const reported = scheduleReportedBroadcastTotal(schedule);
    const importedBase = reported > 0 ? reported : scheduleImportedAiringTotal(schedule);
    return importedBase + scheduleManualBroadcastTotal(schedule);
  }
''',
    "manual broadcast total",
)

replace_once(
    sched,
    '''      importedFromReport: true,
      importedBroadcastDollars:''',
    '''      importedFromReport: true,
      manualResultRecorded: false,
      manualBroadcastDollars: 0,
      manualPledgeCount: 0,
      manualResultUpdatedAt: '',
      importedBroadcastDollars:''',
    "imported placement clears manual result",
)

replace_once(
    sched,
    '''          existingAtSlot.importedFromReport = true;
          existingAtSlot.importedBroadcastDollars =''',
    '''          existingAtSlot.importedFromReport = true;
          existingAtSlot.manualResultRecorded = false;
          existingAtSlot.manualBroadcastDollars = 0;
          existingAtSlot.manualPledgeCount = 0;
          existingAtSlot.manualResultUpdatedAt = '';
          existingAtSlot.importedBroadcastDollars =''',
    "real import supersedes manual result",
)

replace_once(
    sched,
    '''  async function ensureScheduleAiringHistoryLoaded() {''',
    '''  function placementHasRecordedResult(placement = {}, dateKey = '', startMinutes = null) {
    return placementHasManualResult(placement) || placementHasImportedAiring(placement, dateKey, startMinutes);
  }

  async function ensureScheduleAiringHistoryLoaded() {''',
    "recorded result helper",
)

replace_once(
    sched,
    '''      return sum + (placementHasImportedAiring(placement, placement.dateKey, placement.startMinutes) ? 1 : 0);''',
    '''      return sum + (placementHasRecordedResult(placement, placement.dateKey, placement.startMinutes) ? 1 : 0);''',
    "coverage includes manual result",
)

replace_once(
    sched,
    '''      { label: 'Pledges', value: utils.formatCount(scheduleImportedPledgesTotal(schedule)) },''',
    '''      { label: 'Pledges', value: utils.formatCount(schedulePledgesTotal(schedule)) },''',
    "home pledge total",
)

replace_once(
    sched,
    '''      summary.pledges += scheduleImportedPledgesTotal(schedule);''',
    '''      summary.pledges += schedulePledgesTotal(schedule);''',
    "YTD pledge total",
)

replace_once(
    sched,
    '''    const importedPledges = scheduleImportedPledgesTotal(working);''',
    '''    const importedPledges = schedulePledgesTotal(working);''',
    "form pledge total",
)

replace_once(
    sched,
    '''        const hasImportedData = isStart && placementHasImportedAiring(placement, actualDateKey, actualMinutes);
        const isPlaceholder = isPlaceholderPlacement(placement);
        const klass = [placement ? (placement.isFirstRun ? 'first-run' : 'repeat-run') : '', placement?.isNonPledge ? 'non-pledge' : '', isPlaceholder ? 'placeholder' : '', calendarPlacementIsLive(schedule, placement) ? 'live-break' : '', placement?.transferredToStation ? 'transferred-to-station' : '', hasImportedData ? 'imported-data' : ''].filter(Boolean).join(' ');''',
    '''        const hasImportedData = isStart && placementHasImportedAiring(placement, actualDateKey, actualMinutes);
        const hasManualData = isStart && !hasImportedData && placementHasManualResult(placement);
        const isPlaceholder = isPlaceholderPlacement(placement);
        const klass = [placement ? (placement.isFirstRun ? 'first-run' : 'repeat-run') : '', placement?.isNonPledge ? 'non-pledge' : '', isPlaceholder ? 'placeholder' : '', calendarPlacementIsLive(schedule, placement) ? 'live-break' : '', placement?.transferredToStation ? 'transferred-to-station' : '', hasImportedData ? 'imported-data' : (hasManualData ? 'manual-data' : '')].filter(Boolean).join(' ');''',
    "manual result calendar class",
)

replace_once(
    sched,
    '''        const breakWarning = isStart && !isPlaceholder ? scheduleCalendarBreakInfoNeededHtml(placement) : '';
        const subtitleBits = [];''',
    '''        const breakWarning = isStart && !isPlaceholder ? scheduleCalendarBreakInfoNeededHtml(placement) : '';
        const manualResultBadge = hasManualData ? `<span class="schedule-placement-manual-result" title="Manual pledge result">${utils.escapeHtml(utils.formatMoney(placementManualResultDollars(placement)))}</span>` : '';
        const subtitleBits = [];''',
    "manual amount badge",
)

replace_once(
    sched,
    '''<span>${subtitleBits.join(' · ')}</span>${breakWarning}${expectationBadge}</span>` : ''}''',
    '''<span>${subtitleBits.join(' · ')}</span>${manualResultBadge}${breakWarning}${expectationBadge}</span>` : ''}''',
    "manual amount badge render",
)

manual_helpers = '''  function placementHasConfirmedImportedResult(placement = {}) {
    if (!placement) return false;
    if (placementHasImportedAiring(placement, placement.dateKey, placement.startMinutes)) return true;
    return Boolean(placement?.importedFromReport && utils.normalizeText(placement?.sourceAiringHash || ''));
  }

  function renderManualResultControls(currentPlacement = null, editable = false) {
    const panel = els.scheduleManualResultPanel;
    if (!panel) return;
    const eligible = Boolean(currentPlacement && !currentPlacement.isNonPledge && !isPlaceholderPlacement(currentPlacement));
    panel.classList.toggle('hidden', !eligible);
    if (!eligible) return;
    const imported = placementHasConfirmedImportedResult(currentPlacement);
    const manual = placementHasManualResult(currentPlacement);
    if (els.scheduleManualResultDollars) {
      els.scheduleManualResultDollars.value = manual ? String(placementManualResultDollars(currentPlacement)) : '0';
      els.scheduleManualResultDollars.disabled = !editable || imported;
    }
    if (els.scheduleManualResultPledges) {
      els.scheduleManualResultPledges.value = manual ? String(Number(currentPlacement.manualPledgeCount || 0) || 0) : '0';
      els.scheduleManualResultPledges.disabled = !editable || imported;
    }
    if (els.scheduleManualResultSaveButton) els.scheduleManualResultSaveButton.disabled = !editable || imported;
    if (els.scheduleManualResultClearButton) {
      els.scheduleManualResultClearButton.disabled = !editable || !manual || imported;
      els.scheduleManualResultClearButton.classList.toggle('hidden', !manual || imported);
    }
    if (els.scheduleManualResultStatus) {
      if (imported) {
        els.scheduleManualResultStatus.textContent = 'A pledge-report result is already attached to this airing. Imported results are authoritative.';
      } else if (manual) {
        els.scheduleManualResultStatus.textContent = `Manual result saved: ${utils.formatMoney(placementManualResultDollars(currentPlacement))}, ${utils.formatCount(Number(currentPlacement.manualPledgeCount || 0) || 0)} pledge${Number(currentPlacement.manualPledgeCount || 0) === 1 ? '' : 's'}.`;
      } else {
        els.scheduleManualResultStatus.textContent = 'No pledge-report result is attached to this airing. $0 and 0 pledges are valid completed results.';
      }
    }
  }

  async function saveManualResultToSelectedPlacement() {
    if (!canScheduleEdit()) { showScheduleModalWarning('Viewer mode. Sign in as admin to enter results.', 'bad'); return false; }
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    const placement = schedule && slot ? findPlacementForSlot(schedule, slot.key) : null;
    if (!placement || placement.isNonPledge || isPlaceholderPlacement(placement)) {
      showScheduleModalWarning('Select a scheduled pledge program before entering a manual result.', 'warn');
      return false;
    }
    if (placementHasConfirmedImportedResult(placement)) {
      showScheduleModalWarning('This airing already has a pledge-report result. The imported result remains authoritative.', 'warn');
      return false;
    }
    const dollars = Number(els.scheduleManualResultDollars?.value);
    const pledges = Number(els.scheduleManualResultPledges?.value);
    if (!Number.isFinite(dollars) || dollars < 0) {
      showScheduleModalWarning('Broadcast dollars must be zero or greater.', 'warn');
      els.scheduleManualResultDollars?.focus?.();
      return false;
    }
    if (!Number.isFinite(pledges) || pledges < 0 || !Number.isInteger(pledges)) {
      showScheduleModalWarning('Pledges must be a whole number zero or greater.', 'warn');
      els.scheduleManualResultPledges?.focus?.();
      return false;
    }
    placement.manualResultRecorded = true;
    placement.manualBroadcastDollars = Math.round(dollars * 100) / 100;
    placement.manualPledgeCount = Math.trunc(pledges);
    placement.manualResultUpdatedAt = new Date().toISOString();
    await persistSchedules(schedule);
    renderScheduleGrid();
    renderScheduleForm();
    renderHomeDriveSummary();
    renderScheduledProgramDetails();
    renderProgramPicker();
    setNotice(`Saved manual result for ${placement.programTitle}: ${utils.formatMoney(placement.manualBroadcastDollars)}, ${utils.formatCount(placement.manualPledgeCount)} pledge${placement.manualPledgeCount === 1 ? '' : 's'}.`);
    showScheduleModalWarning('Manual result saved. This airing now counts as updated.', 'ok');
    return true;
  }

  async function clearManualResultFromSelectedPlacement() {
    if (!canScheduleEdit()) return false;
    const schedule = getActiveSchedule();
    const slot = state.selectedScheduleSlot;
    const placement = schedule && slot ? findPlacementForSlot(schedule, slot.key) : null;
    if (!placement || !placementHasManualResult(placement)) return false;
    placement.manualResultRecorded = false;
    placement.manualBroadcastDollars = 0;
    placement.manualPledgeCount = 0;
    placement.manualResultUpdatedAt = '';
    await persistSchedules(schedule);
    renderScheduleGrid();
    renderScheduleForm();
    renderHomeDriveSummary();
    renderScheduledProgramDetails();
    renderProgramPicker();
    setNotice(`Cleared the manual result for ${placement.programTitle}.`);
    showScheduleModalWarning('Manual result cleared. This airing is waiting for a result again.', 'warn');
    return true;
  }

'''
replace_once(sched, "  function renderProgramPicker() {", manual_helpers + "  function renderProgramPicker() {", "manual control helpers")

replace_once(
    sched,
    '''    const currentPlacement = findPlacementForSlot(schedule, slot.key);
    syncPlaceholderControls(currentPlacement, editable);''',
    '''    const currentPlacement = findPlacementForSlot(schedule, slot.key);
    syncPlaceholderControls(currentPlacement, editable);
    renderManualResultControls(currentPlacement, editable);''',
    "render manual controls",
)

replace_once(
    sched,
    '''    els.scheduleLiveBreakFlag?.addEventListener('change', () => { void updateLiveBreakFlag().catch((error) => setNotice(error?.message || 'Could not update live-break flag.', 'warn')); });''',
    '''    els.scheduleLiveBreakFlag?.addEventListener('change', () => { void updateLiveBreakFlag().catch((error) => setNotice(error?.message || 'Could not update live-break flag.', 'warn')); });
    els.scheduleManualResultSaveButton?.addEventListener('click', () => { void saveManualResultToSelectedPlacement(); });
    els.scheduleManualResultClearButton?.addEventListener('click', () => { void clearManualResultFromSelectedPlacement(); });''',
    "manual result event bindings",
)

css = styles.read_text(encoding="utf-8")
marker = "/* manual schedule results v0.22.71 */"
if marker in css:
    raise SystemExit("manual result CSS already present")
css += '''\n\n/* manual schedule results v0.22.71 */
.schedule-manual-result-panel {
  margin: 0 0 10px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #f7fbf8;
}
.schedule-manual-result-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin-bottom:8px; }
.schedule-manual-result-head strong { color: var(--heading); }
.schedule-manual-result-fields { display:flex; align-items:end; gap:8px; flex-wrap:wrap; }
.schedule-manual-result-fields .filter-field { min-width:110px; }
.schedule-manual-result-fields input { width:100%; padding:7px 8px; border:1px solid var(--border); border-radius:9px; background:#fff; }
.schedule-manual-result-actions { display:flex; gap:7px; align-items:center; padding-bottom:1px; }
.schedule-placement.manual-data {
  background: linear-gradient(180deg, #77b98f, #5f9d79) !important;
  color: #102c1d !important;
  border: 1px solid rgba(56,115,82,.38);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.16), 0 1px 4px rgba(20,92,49,.14) !important;
}
.schedule-placement.manual-data::after {
  content: "MANUAL";
  display: inline-flex;
  width: fit-content;
  max-width: calc(100% - 8px);
  margin-top: 2px;
  padding: 1px 4px;
  border-radius: 999px;
  background: rgba(255,255,255,.72);
  color: #24583a;
  font-size: clamp(.38rem,.42vw,.48rem);
  line-height: 1.05;
  font-weight: 800;
  letter-spacing: .03em;
}
.schedule-placement.manual-data.live-break,
.schedule-placement.manual-data[data-live-break="true"] {
  background: linear-gradient(180deg, #77b98f, #5f9d79) !important;
  color: #102c1d !important;
  border: 3px solid #c1122f !important;
}
.schedule-placement-manual-result {
  position:absolute;
  top:3px;
  right:19px;
  z-index:4;
  display:inline-flex;
  align-items:center;
  min-height:13px;
  padding:1px 4px;
  border-radius:5px;
  background:rgba(255,255,255,.80);
  color:#174b2d;
  border:1px solid rgba(23,75,45,.18);
  font-size:clamp(.42rem,.46vw,.54rem) !important;
  line-height:1 !important;
  font-weight:800 !important;
  opacity:1 !important;
}
'''
styles.write_text(css, encoding="utf-8")

payload = json.loads(version.read_text(encoding="utf-8"))
if payload.get("appVersion") != "0.22.70":
    raise SystemExit(f"Expected v0.22.70, found {payload.get('appVersion')}")
payload["appVersion"] = "0.22.71"
payload["releasedAt"] = "2026-08-19"
version.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")

print("Manual scheduler result entry staged successfully.")

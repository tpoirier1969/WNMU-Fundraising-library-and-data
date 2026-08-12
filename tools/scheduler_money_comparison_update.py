from pathlib import Path
import json


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)

# Add comparison box to the existing scheduling toolbar.
html_path = Path('app-shell.html')
html = html_path.read_text(encoding='utf-8')
old_toolbar = '''              <div class="schedule-toolbar-group">
                <span class="schedule-sub-label">End</span>
                <button type="button" class="ghost" id="schedule-end-earlier-button">−1 hr</button>
                <button type="button" class="ghost" id="schedule-end-later-button">+1 hr</button>
              </div>
              <div class="schedule-toolbar-group">
                <button type="button" class="ghost" id="schedule-zoom-out-button">−</button>
'''
new_toolbar = '''              <div class="schedule-toolbar-group">
                <span class="schedule-sub-label">End</span>
                <button type="button" class="ghost" id="schedule-end-earlier-button">−1 hr</button>
                <button type="button" class="ghost" id="schedule-end-later-button">+1 hr</button>
              </div>
              <div id="schedule-same-fundraiser-comparison" class="schedule-same-fundraiser-comparison" aria-live="polite">
                <div class="schedule-comparison-kicker">Same fundraiser comparison</div>
                <div class="schedule-comparison-status">Waiting for imported results…</div>
              </div>
              <div class="schedule-toolbar-group">
                <button type="button" class="ghost" id="schedule-zoom-out-button">−</button>
'''
html = replace_once(html, old_toolbar, new_toolbar, 'schedule comparison toolbar markup')
html_path.write_text(html, encoding='utf-8')

# Register the new persistent DOM element.
dom_path = Path('assets/js/dom.js')
dom = dom_path.read_text(encoding='utf-8')
dom = replace_once(
    dom,
    "    scheduleWindowLabel: document.getElementById('schedule-window-label'),\n    scheduleGrid: document.getElementById('schedule-grid'),",
    "    scheduleWindowLabel: document.getElementById('schedule-window-label'),\n    scheduleSameFundraiserComparison: document.getElementById('schedule-same-fundraiser-comparison'),\n    scheduleGrid: document.getElementById('schedule-grid'),",
    'DOM comparison element'
)
dom_path.write_text(dom, encoding='utf-8')

# Add calculation and rendering helpers to the existing scheduler module.
sched_path = Path('assets/js/ui-scheduling.js')
sched = sched_path.read_text(encoding='utf-8')
marker = '  function renderScheduleGrid() {'
if sched.count(marker) != 1:
    raise SystemExit(f'renderScheduleGrid marker expected once, found {sched.count(marker)}')
helpers = r'''  function scheduleFundraiserDayKeys(schedule = {}) {
    return schedule?.startDate && schedule?.endDate ? utils.datesBetween(schedule.startDate, schedule.endDate) : [];
  }

  function scheduleOnlineMailCents(schedule = {}) {
    const total = (Number(schedule?.onlineDollars || 0) || 0) + (Number(schedule?.mailDollars || 0) || 0);
    return Math.round(total * 100);
  }

  function scheduleProratedOnlineMailByDate(schedule = {}) {
    const days = scheduleFundraiserDayKeys(schedule);
    const result = new Map();
    if (!days.length) return result;
    const totalCents = scheduleOnlineMailCents(schedule);
    const baseCents = Math.trunc(totalCents / days.length);
    const remainderCents = totalCents - (baseCents * days.length);
    days.forEach((dateKey, index) => {
      result.set(dateKey, baseCents + (index === days.length - 1 ? remainderCents : 0));
    });
    return result;
  }

  function scheduleImportedDates(schedule = {}, importedRows = []) {
    return [...new Set(importedRowsForSchedule(schedule, importedRows)
      .map((row) => importedRowDateKey(row))
      .filter(Boolean))]
      .sort();
  }

  function scheduleDailyMoneyMap(schedule = {}, importedRows = []) {
    const relevantRows = importedRowsForSchedule(schedule, importedRows);
    const broadcastByDate = new Map();
    const importedDates = new Set();
    relevantRows.forEach((row) => {
      const dateKey = importedRowDateKey(row);
      if (!dateKey) return;
      importedDates.add(dateKey);
      broadcastByDate.set(dateKey, (broadcastByDate.get(dateKey) || 0) + (Number(row?.dollars || 0) || 0));
    });
    const manualByDate = scheduleProratedOnlineMailByDate(schedule);
    const result = new Map();
    scheduleFundraiserDayKeys(schedule).forEach((dateKey) => {
      const hasImportedResults = importedDates.has(dateKey);
      const broadcast = hasImportedResults ? (broadcastByDate.get(dateKey) || 0) : 0;
      const onlineMail = hasImportedResults ? ((manualByDate.get(dateKey) || 0) / 100) : 0;
      result.set(dateKey, {
        dateKey,
        hasImportedResults,
        broadcast,
        onlineMail,
        total: broadcast + onlineMail
      });
    });
    return result;
  }

  function schedulePartialOnlineMailTotal(schedule = {}, dayCount = 0) {
    const days = scheduleFundraiserDayKeys(schedule);
    const count = Math.max(0, Math.min(days.length, Math.trunc(Number(dayCount) || 0)));
    if (!days.length || !count) return 0;
    const shares = scheduleProratedOnlineMailByDate(schedule);
    return days.slice(0, count).reduce((sum, dateKey) => sum + ((shares.get(dateKey) || 0) / 100), 0);
  }

  function scheduleFundraiserMonth(schedule = {}) {
    const month = Number(String(schedule?.startDate || '').slice(5, 7));
    return Number.isFinite(month) && month >= 1 && month <= 12 ? month : 0;
  }

  function scheduleFundraiserYear(schedule = {}) {
    const year = Number(String(schedule?.startDate || '').slice(0, 4));
    return Number.isFinite(year) ? year : 0;
  }

  function scheduleFundraiserMonthLabel(schedule = {}) {
    const month = scheduleFundraiserMonth(schedule);
    if (!month) return 'Same fundraiser';
    const date = new Date(2000, month - 1, 1);
    return `${date.toLocaleDateString(undefined, { month: 'long' })} fundraiser`;
  }

  function scheduleComparablePartialResult(schedule = {}, importedRows = [], dayCount = 0) {
    const wantedCount = Math.max(0, Math.trunc(Number(dayCount) || 0));
    if (!wantedCount) return null;
    const relevantRows = importedRowsForSchedule(schedule, importedRows);
    const importedDates = [...new Set(relevantRows.map((row) => importedRowDateKey(row)).filter(Boolean))].sort();
    if (importedDates.length < wantedCount) return null;
    const selectedDates = new Set(importedDates.slice(0, wantedCount));
    const broadcast = relevantRows.reduce((sum, row) => selectedDates.has(importedRowDateKey(row)) ? sum + (Number(row?.dollars || 0) || 0) : sum, 0);
    const onlineMail = schedulePartialOnlineMailTotal(schedule, wantedCount);
    return {
      dayCount: wantedCount,
      broadcast,
      onlineMail,
      total: broadcast + onlineMail
    };
  }

  function scheduleSameFundraiserComparison(schedule = {}, importedRows = []) {
    const currentDays = scheduleImportedDates(schedule, importedRows);
    const dayCount = currentDays.length;
    const currentMonth = scheduleFundraiserMonth(schedule);
    const currentYear = scheduleFundraiserYear(schedule);
    if (!dayCount || !currentMonth || !currentYear) return { dayCount, comparisons: [], previous: null, average: null };

    const bestByYear = new Map();
    (state.schedules || []).forEach((candidate) => {
      if (!candidate || candidate.id === schedule.id || !getScheduleDateSpanInfo(candidate).ok) return;
      const year = scheduleFundraiserYear(candidate);
      if (!year || year >= currentYear || scheduleFundraiserMonth(candidate) !== currentMonth) return;
      const existing = bestByYear.get(year);
      if (!existing || scheduleSameRangePreferenceScore(candidate) > scheduleSameRangePreferenceScore(existing)) bestByYear.set(year, candidate);
    });

    const comparisons = [...bestByYear.entries()]
      .map(([year, candidate]) => {
        const result = scheduleComparablePartialResult(candidate, importedRows, dayCount);
        return result ? { year, schedule: candidate, ...result } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.year - b.year);
    const previous = comparisons[comparisons.length - 1] || null;
    const average = comparisons.length
      ? comparisons.reduce((sum, item) => sum + item.total, 0) / comparisons.length
      : null;
    return { dayCount, comparisons, previous, average };
  }

  function renderSameFundraiserComparison(schedule = {}, importedRows = [], importedRowsReady = false) {
    const el = els.scheduleSameFundraiserComparison;
    if (!el) return;
    if (!schedule) {
      el.innerHTML = '<div class="schedule-comparison-kicker">Same fundraiser comparison</div><div class="schedule-comparison-status">No fundraiser selected.</div>';
      return;
    }
    const fundraiserLabel = scheduleFundraiserMonthLabel(schedule);
    if (!importedRowsReady) {
      el.innerHTML = `<div class="schedule-comparison-kicker">${utils.escapeHtml(fundraiserLabel)}</div><div class="schedule-comparison-status">Loading comparable results…</div>`;
      return;
    }
    const comparison = scheduleSameFundraiserComparison(schedule, importedRows);
    if (!comparison.dayCount) {
      el.innerHTML = `<div class="schedule-comparison-kicker">${utils.escapeHtml(fundraiserLabel)}</div><div class="schedule-comparison-status">Waiting for the first imported result-day.</div>`;
      return;
    }
    const dayLabel = `${comparison.dayCount} imported day${comparison.dayCount === 1 ? '' : 's'}`;
    const previousLabel = comparison.previous ? `Previous ${comparison.previous.year}` : 'Previous';
    const previousValue = comparison.previous ? utils.formatMoney(comparison.previous.total) : 'N/A';
    const averageLabel = comparison.comparisons.length ? `Prior avg (${comparison.comparisons.length})` : 'Prior avg';
    const averageValue = Number.isFinite(comparison.average) ? utils.formatMoney(comparison.average) : 'N/A';
    el.innerHTML = `
      <div class="schedule-comparison-kicker">${utils.escapeHtml(fundraiserLabel)} · first ${utils.escapeHtml(dayLabel)}</div>
      <div class="schedule-comparison-values">
        <span><small>${utils.escapeHtml(previousLabel)}</small><strong>${utils.escapeHtml(previousValue)}</strong></span>
        <span><small>${utils.escapeHtml(averageLabel)}</small><strong>${utils.escapeHtml(averageValue)}</strong></span>
      </div>
    `;
  }

'''
sched = sched.replace(marker, helpers + marker, 1)

# Load imported results for the calendar once and rerender when ready.
old_daykeys = '''    const dayKeys = visibleDateKeys(schedule);
    const windowConfig = getScheduleWindow(state.scheduleView);
'''
new_daykeys = '''    const dayKeys = visibleDateKeys(schedule);
    const importedRowsReady = Array.isArray(state.scheduleImportedAiringsCache);
    const importedRows = importedRowsReady ? state.scheduleImportedAiringsCache : [];
    if (!importedRowsReady && !state.scheduleImportedAiringsPromise) {
      const scheduleId = schedule.id;
      void ensureScheduleImportedAiringsLoaded().then(() => {
        if (state.activeScheduleId === scheduleId) renderScheduleGrid();
      });
    }
    const dailyMoney = scheduleDailyMoneyMap(schedule, importedRows);
    renderSameFundraiserComparison(schedule, importedRows, importedRowsReady);
    const windowConfig = getScheduleWindow(state.scheduleView);
'''
sched = replace_once(sched, old_daykeys, new_daykeys, 'calendar imported money load')

old_header = '''    dayKeys.forEach((dateKey) => {
      const label = utils.escapeHtml(formatScheduleDay(dateKey));
      const weekendClass = isWeekendDateKey(dateKey) ? 'weekend' : '';
      header.push(`<div class="schedule-day-head sticky ${weekendClass}"><span>${label}</span></div>`);
      footer.push(`<div class="schedule-day-head schedule-day-foot ${weekendClass}"><span>${label}</span></div>`);
    });
'''
new_header = '''    dayKeys.forEach((dateKey) => {
      const label = utils.escapeHtml(formatScheduleDay(dateKey));
      const weekendClass = isWeekendDateKey(dateKey) ? 'weekend' : '';
      const money = dailyMoney.get(dateKey) || { broadcast: 0, onlineMail: 0, total: 0, hasImportedResults: false };
      const moneyTitle = money.hasImportedResults
        ? `Imported broadcast ${utils.formatMoney(money.broadcast)} + prorated Online/Mail ${utils.formatMoney(money.onlineMail)}`
        : 'No imported results for this date yet';
      header.push(`<div class="schedule-day-head sticky ${weekendClass}"><span class="schedule-day-date">${label}</span><span class="schedule-day-total ${money.hasImportedResults ? 'reported' : 'unreported'}" title="${utils.escapeHtml(moneyTitle)}">${utils.escapeHtml(utils.formatMoney(money.total))}</span></div>`);
      footer.push(`<div class="schedule-day-head schedule-day-foot ${weekendClass}"><span>${label}</span></div>`);
    });
'''
sched = replace_once(sched, old_header, new_header, 'calendar daily money header')

sched_path.write_text(sched, encoding='utf-8')

# Add styling to the existing stylesheet, no new runtime stylesheet.
css_path = Path('assets/styles.css')
css = css_path.read_text(encoding='utf-8')
css_add = r'''

/* Scheduling daily fundraiser results and same-point historical comparison */
.schedule-grid-head .schedule-day-head {
  flex-direction: column;
  gap: 2px;
  padding-top: 6px;
  padding-bottom: 6px;
}
.schedule-grid-head .schedule-day-date {
  display: block;
  max-width: 100%;
}
.schedule-day-total {
  display: block;
  max-width: 100%;
  font-size: .78rem;
  line-height: 1;
  font-weight: 900;
  color: #244b67;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.schedule-day-total.reported { color: #0c5a3d; }
.schedule-day-total.unreported { color: #6e7f8c; font-weight: 750; }
.schedule-same-fundraiser-comparison {
  min-width: 250px;
  max-width: 340px;
  padding: 6px 9px;
  border: 1px solid #cfdde6;
  border-radius: 10px;
  background: #f7fafc;
  color: var(--heading);
  align-self: stretch;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
}
.schedule-comparison-kicker {
  font-size: .66rem;
  line-height: 1.15;
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: .045em;
  color: #536f82;
}
.schedule-comparison-status {
  font-size: .76rem;
  line-height: 1.2;
  color: var(--muted);
}
.schedule-comparison-values {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.schedule-comparison-values span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.schedule-comparison-values small {
  color: #61798a;
  font-size: .64rem;
  line-height: 1.1;
}
.schedule-comparison-values strong {
  color: var(--heading);
  font-size: .88rem;
  line-height: 1.15;
  white-space: nowrap;
}
@media (max-width: 900px) {
  .schedule-same-fundraiser-comparison {
    min-width: 210px;
    max-width: none;
  }
}
@media (max-width: 720px) {
  .schedule-same-fundraiser-comparison {
    grid-column: 1 / -1;
    width: 100%;
    max-width: none;
  }
}
'''
if 'schedule-same-fundraiser-comparison {' in css:
    raise SystemExit('comparison CSS already present unexpectedly')
css_path.write_text(css.rstrip() + css_add + '\n', encoding='utf-8')

# Version remains single-source in version.json.
version_path = Path('version.json')
version = json.loads(version_path.read_text(encoding='utf-8'))
if version.get('appVersion') != '0.22.62':
    raise SystemExit(f"Expected version 0.22.62, found {version.get('appVersion')!r}")
version['appVersion'] = '0.22.63'
version['releasedAt'] = '2026-08-12'
version_path.write_text(json.dumps(version, separators=(',', ':')) + '\n', encoding='utf-8')

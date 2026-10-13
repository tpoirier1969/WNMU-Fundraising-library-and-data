import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scheduling = fs.readFileSync(new URL('../assets/js/ui-scheduling.js', import.meta.url), 'utf8');
const begin = scheduling.indexOf('  function renderScheduleGrid() {');
const end = scheduling.indexOf('\n  function scheduleDetailHasBreakInfo(', begin);
assert.ok(begin >= 0 && end > begin, 'the real calendar renderer must be present');
const actualRenderSource = scheduling.slice(begin, end);

function renderFixture({ placements = [], fundraisingWindows = [], noSchedule = false } = {}) {
  const days = ['2026-11-27', '2026-11-28'];
  const schedule = noSchedule ? null : {
    id: 'nov26', startDate: days[0], endDate: days[1], placements, fundraisingWindows
  };
  const classes = () => ({ add() {}, remove() {} });
  const element = () => ({ innerHTML: '', style: { setProperty() {} }, classList: classes(), textContent: '' });
  const els = {
    scheduleEmpty: element(), scheduleEditor: element(), scheduleProgramDetails: element(),
    scheduleGrid: element(), scheduleWindowLabel: element(), scheduleZoomValue: element()
  };
  let detailRenderCount = 0;
  const context = {
    els, App: { auth: { canEdit: () => true }, performanceUi: null },
    state: {
      activeScheduleId: 'nov26', scheduleAiringHistoryLoaded: true,
      scheduleImportedAiringsCache: [], scheduleView: { zoom: 1 },
      selectedScheduleSlot: null, scheduleHighlightedRowMinutes: null
    },
    constants: { DEFAULT_SLOT_MINUTES: 30 },
    BREAK_MODES: { LIVE: 'live', WEB_ONLY: 'web_only', PHONES_STAFFED: 'phones_staffed' },
    utils: {
      escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
      minutesToLabel: n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`,
      formatMoney: n => `$${n}`, formatCount: n => String(n),
      plusDays: (day, offset) => new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10)
    },
    getActiveSchedule: () => schedule,
    getScheduleDateSpanInfo: () => ({ ok: true }),
    canScheduleEdit: () => true,
    requestScheduleExpectationData() {},
    ensureScheduleAiringHistoryLoaded() {},
    ensureScheduleImportedAiringsLoaded() {},
    visibleDateKeys: () => days,
    scheduleDailyMoneyMap: () => new Map(),
    scheduleFundraisingMinutesByDate: () => new Map(),
    scheduleTotalFundraisingMinutes: () => 0,
    scheduleStartBucketMoneyMap: () => new Map(),
    renderSameFundraiserComparison() {},
    historicalSeasonWeekdayRate: () => null,
    getScheduleWindow: () => ({ startMinutes: 1200, endMinutes: 1260 }),
    annotatePlacements: s => (s.placements || []).map(p => ({ ...p, isFirstRun: true })),
    toDisplayPlacement: p => ({
      ...p, displayDateKey: p.dateKey, displayStartMinutes: p.startMinutes,
      displayEndMinutes: p.startMinutes + p.lengthMinutes
    }),
    schedulePlacementUseCounts: s => new Map((s.placements || []).map(p => [`id:${p.programId}`, 1])),
    normalizedFundraisingWindows: s => s.fundraisingWindows || [],
    toDisplayFundraisingWindow: w => ({ ...w, displayDateKey: w.dateKey, displayStartMinutes: w.startMinutes, displayEndMinutes: w.endMinutes }),
    scheduleDetailKeyForPlacement: () => '',
    ensureScheduledDetailsBatch() {},
    scheduleFundraisingHoursLabel: n => `${n / 60}h`,
    formatScheduleDay: day => day,
    isWeekendDateKey: () => false,
    placementHeight: (length, height) => `${Math.ceil(length / 30) * height}px`,
    placementHasImportedAiring: () => false,
    placementHasManualResult: () => false,
    isPlaceholderPlacement: p => Boolean(p?.isPlaceholder || p?.placementType === 'placeholder'),
    isRegularSchedulePlacement: p => p?.placementType === 'regular',
    calendarPlacementBreakMode: (_s, p) => p?.breakMode || '',
    scheduleExpectationBadgeHtml: () => '',
    placementManualResultDollars: () => 0,
    placementScheduleNote: p => p?.scheduleNote || '',
    placeholderTitle: p => p?.placeholderTitle || p?.programTitle || 'Placeholder',
    breakModeLabel: mode => mode,
    schedulePlacementUseKey: p => p?.programId ? `id:${p.programId}` : '',
    renderProgramTitleLink: (_id, title) => `<strong>${title}</strong>`,
    fundraisingWindowPriorityLabel: () => 'Open to pledge',
    renderInlineScrollbar() {},
    renderScheduledProgramDetails() { detailRenderCount += 1; },
    persistSchedules() {},
    console
  };
  vm.runInNewContext(`${actualRenderSource}\nrenderScheduleGrid();`, context, { filename: 'ui-scheduling.js:renderScheduleGrid' });
  return { html: els.scheduleGrid.innerHTML, detailRenderCount, els };
}

test('empty slots render the full calendar grid instead of throwing on null placement', () => {
  const { html, detailRenderCount } = renderFixture();
  assert.match(html, /schedule-grid-head/);
  assert.match(html, /schedule-grid-body/);
  assert.match(html, /schedule-grid-foot/);
  assert.equal((html.match(/class="schedule-slot /g) || []).length, 4, '2 days by 2 half-hour slots');
  assert.equal(detailRenderCount, 1, 'the program detail list still renders');
});

test('filled and empty slots coexist, with program title and fundraiser count', () => {
  const { html } = renderFixture({ placements: [{
    id: 'p1', programId: 'a1', programTitle: 'Sample Pledge Show',
    dateKey: '2026-11-27', startMinutes: 1200, lengthMinutes: 30, breakMode: 'phones_staffed'
  }] });
  assert.match(html, /Sample Pledge Show/);
  assert.match(html, /schedule-placement-use-count/);
  assert.match(html, /PHONES/);
  assert.equal((html.match(/class="schedule-slot /g) || []).length, 4);
});

test('fundraising window and regular/placeholder blocks still appear alongside empty slots', () => {
  const { html } = renderFixture({
    fundraisingWindows: [{ dateKey: '2026-11-27', startMinutes: 1200, endMinutes: 1260, priority: 'open', note: 'Fundraising opportunity' }],
    placements: [
      { id: 'r1', programTitle: 'Regular News', placementType: 'regular', isNonPledge: true, dateKey: '2026-11-27', startMinutes: 1200, lengthMinutes: 30 },
      { id: 'h1', programTitle: 'Temporary Hold', placementType: 'placeholder', isPlaceholder: true, dateKey: '2026-11-28', startMinutes: 1230, lengthMinutes: 30 }
    ]
  });
  assert.match(html, /Regular News/);
  assert.match(html, /Temporary Hold/);
  assert.match(html, /Fundraising opportunity/);
  assert.equal((html.match(/class="schedule-slot /g) || []).length, 4);
});

test('no selected fundraiser does not render calendar cells', () => {
  const { html, els } = renderFixture({ noSchedule: true });
  assert.equal(html, '');
  assert.match(els.scheduleProgramDetails.innerHTML, /start assigning titles/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/programming-strategy-analysis.js', import.meta.url), 'utf8');
const oneSheetSource = fs.readFileSync(new URL('../assets/js/one-sheet-analysis.js', import.meta.url), 'utf8');
const workerSource = fs.readFileSync(new URL('../assets/js/programming-strategy-worker.js', import.meta.url), 'utf8');
const context = { console, Date, Map, Set, Math, Number, String, Object, Array, RegExp, Intl };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: 'programming-strategy-analysis.js' });
const S = context.WNMUProgrammingStrategyAnalysis;

const schedule = { id: 'dec26', title: 'December 2026', startDate: '2026-12-05', endDate: '2026-12-13' };
const baseProgram = (overrides = {}) => ({
  id: overrides.id || '1',
  title: overrides.title || 'Test Program',
  topic_primary: overrides.topic_primary || 'Music',
  rights_start: overrides.rights_start ?? '2026-01-01',
  rights_end: overrides.rights_end ?? '2027-12-31',
  length_bucket_minutes: overrides.length_bucket_minutes || 60,
  ...overrides
});
const row = (overrides = {}) => ({
  programId: overrides.programId === undefined ? '1' : overrides.programId,
  title: overrides.title || 'Test Program',
  topic: overrides.topic || 'Music',
  dateKey: overrides.dateKey || '2026-08-08',
  startMinutes: overrides.startMinutes ?? 19 * 60,
  minutes: overrides.minutes ?? 60,
  dollars: overrides.dollars ?? 600,
  fundraiserId: overrides.fundraiserId || 'aug26',
  nola_code: overrides.nola_code ?? '',
  ...overrides
});

const historicalScheduleRow = ({ id, title, startDate, endDate, placements = [] }) => ({
  id,
  title,
  start_date: startDate,
  end_date: endDate,
  created_at: `${startDate}T00:00:00Z`,
  updated_at: `${endDate}T23:59:59Z`,
  schedule_data: { placements }
});

function makeWorkerHarness() {
  const workerMessages = [];
  const workerContext = {
    console, Date, Map, Set, Math, Number, String, Object, Array, RegExp, Intl,
    performance: { now: () => Date.now() }
  };
  workerContext.globalThis = workerContext;
  workerContext.self = workerContext;
  workerContext.postMessage = (message) => workerMessages.push(message);
  workerContext.importScripts = () => {};
  vm.runInNewContext(oneSheetSource, workerContext, { filename: 'one-sheet-analysis.js' });
  vm.runInNewContext(source, workerContext, { filename: 'programming-strategy-analysis.js' });
  vm.runInNewContext(workerSource, workerContext, { filename: 'programming-strategy-worker.js' });
  return { workerContext, workerMessages };
}

test('evidence cutoff uses today for future drives and day-before-start for historical drives', () => {
  const now = new Date('2026-09-18T12:00:00');
  assert.equal(S.evidenceCutoff(schedule, now), '2026-09-18');
  assert.equal(
    S.evidenceCutoff({ startDate: '2026-08-08', endDate: '2026-08-16' }, now),
    '2026-08-07'
  );
  const filtered = S.filterEvidenceAirings([
    row({ dateKey: '2026-09-17' }),
    row({ dateKey: '2026-09-18' }),
    row({ dateKey: '2026-09-19' })
  ], S.evidenceCutoff(schedule, now));
  assert.deepEqual(Array.from(filtered, (entry) => entry.dateKey), ['2026-09-17', '2026-09-18']);
});

test('post-cutoff airings cannot enter strategy evidence', () => {
  const program = baseProgram();
  const pre = [row({ dateKey: '2025-12-06', dollars: 120, fundraiserId: 'dec25' })];
  const futureWindfall = row({ dateKey: '2027-12-04', dollars: 12000, fundraiserId: 'dec27' });
  const now = new Date('2026-09-18T12:00:00');
  const before = S.buildStrategy({ schedule, library: [program], evidenceRows: pre, now });
  const after = S.buildStrategy({ schedule, library: [program], evidenceRows: [...pre, futureWindfall], now });
  assert.equal(before.evidenceRows, 1);
  assert.equal(after.evidenceRows, 1);
  const beforeTopic = before.topicComparison.find((item) => item.topic === 'Music');
  const afterTopic = after.topicComparison.find((item) => item.topic === 'Music');
  assert.equal(afterTopic.historyRows, beforeTopic.historyRows);
  assert.equal(afterTopic.averageRate, beforeTopic.averageRate);
});

test('Report 5 season buckets match Historical Analytics pledge seasons', () => {
  assert.equal(S.seasonForDate('2026-02-01'), 'March');
  assert.equal(S.seasonForDate('2026-03-31'), 'March');
  assert.equal(S.seasonForDate('2026-05-01'), 'June');
  assert.equal(S.seasonForDate('2026-06-30'), 'June');
  assert.equal(S.seasonForDate('2026-08-01'), 'August');
  assert.equal(S.seasonForDate('2026-09-30'), 'August');
  assert.equal(S.seasonForDate('2026-11-01'), 'December');
  assert.equal(S.seasonForDate('2026-12-31'), 'December');
  assert.equal(S.seasonForDate('2026-01-15'), 'Special');
  assert.equal(S.seasonForDate('2026-04-15'), 'Special');
  assert.equal(S.seasonForDate('2026-07-15'), 'Special');
  assert.equal(S.seasonForDate('2026-10-15'), 'Special');
});

test('planning-window evidence uses the actual window instead of broad daypart leakage', () => {
  const slot = {
    date: '2026-12-05',
    weekpart: 'Saturday',
    startMinutes: 19 * 60,
    endMinutes: 22 * 60 + 30
  };
  const rows = [
    row({ title: 'Too Early', dateKey: '2025-12-06', startMinutes: 17 * 60 }),
    row({ title: 'Seven', dateKey: '2025-12-06', startMinutes: 19 * 60 }),
    row({ title: 'Ten', dateKey: '2025-12-06', startMinutes: 22 * 60 }),
    row({ title: 'Boundary', dateKey: '2025-12-06', startMinutes: 22 * 60 + 30 })
  ];
  assert.deepEqual(
    Array.from(S.comparableRows(rows, slot, { exactWeekday: true }), (item) => item.title),
    ['Seven', 'Ten']
  );
});

test('rights exclude a title from a slot where it cannot legally air', () => {
  const expired = baseProgram({ id: 'expired', title: 'Expired', rights_end: '2026-12-01' });
  const future = baseProgram({ id: 'future', title: 'Future Rights', rights_start: '2026-12-10' });
  const firstSlot = S.planningWindows(schedule)[0];
  assert.equal(S.titleEligibleForDate(expired, firstSlot.date), false);
  assert.equal(S.titleEligibleForDate(future, firstSlot.date), false);
  const laterSlot = S.planningWindows(schedule).find((entry) => entry.date === '2026-12-12');
  assert.equal(S.titleEligibleForDate(future, laterSlot.date), true);
});

test('normal pledge windows are present and experimental opportunities are visibly distinct', () => {
  const windows = S.planningWindows(schedule);
  assert.ok(windows.some((entry) => entry.confidenceClass === 'normal' && entry.label === 'Early evening'));
  assert.ok(windows.some((entry) => entry.confidenceClass === 'normal' && entry.label === 'Prime'));
  const experimental = windows.filter((entry) => entry.experimental);
  assert.ok(experimental.length >= 1);
  assert.ok(experimental.every((entry) => entry.weekday === 'Saturday' && entry.label === 'Late afternoon' && entry.confidenceClass === 'experimental'));
});

test('Friday 8–9 PM is protected regular programming, not pledge inventory', () => {
  const windows = S.planningWindows(schedule);
  const blocked = windows.find((entry) => entry.weekday === 'Friday' && entry.startMinutes === 20 * 60);
  assert.ok(blocked);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.endMinutes, 21 * 60);
  const strategy = S.buildStrategy({ schedule, library: [baseProgram()], evidenceRows: [] });
  const strategyBlocked = strategy.windows.find((entry) => entry.id === blocked.id);
  assert.equal(strategyBlocked.recommendations.length, 0);
});

test('recommended titles come only from the supplied Program Library', () => {
  const library = [baseProgram({ id: 'a', title: 'Library A' }), baseProgram({ id: 'b', title: 'Library B', topic_primary: 'History' })];
  const strategy = S.buildStrategy({ schedule, library, evidenceRows: [row({ programId: 'ghost', title: 'Ghost Result', dollars: 5000 })] });
  const allowed = new Set(library.map((program) => program.title));
  strategy.windows.forEach((window) => window.recommendations.forEach((recommendation) => assert.ok(allowed.has(recommendation.title))));
});

test('older Drama Docs are penalized relative to current-cycle Drama Docs', () => {
  const oldDoc = baseProgram({ id: 'old', title: 'Old Drama Doc', topic_primary: 'Drama Doc', rights_start: '2024-01-01' });
  const currentDoc = baseProgram({ id: 'current', title: 'Current Drama Doc', topic_primary: 'Drama Doc', rights_start: '2026-09-01' });
  const slot = S.planningWindows(schedule).find((entry) => entry.label === 'Prime');
  const context = { schedule, evidenceRows: [], overrideByProgramId: new Map(), baselineRate: null };
  const oldScore = S.scoreProgramForSlot(oldDoc, slot, context);
  const currentScore = S.scoreProgramForSlot(currentDoc, slot, context);
  assert.equal(oldScore.drama.olderCycle, true);
  assert.equal(currentScore.drama.currentCycle, true);
  assert.ok(currentScore.score > oldScore.score);
});

test('holiday season fit rewards December and strongly penalizes out-of-season use', () => {
  const holiday = baseProgram({ id: 'holiday', title: 'Christmas at the Lake', topic_primary: 'Music' });
  const december = S.seasonEvidence(holiday, [], schedule);
  const june = S.seasonEvidence(holiday, [], { startDate: '2027-06-05', endDate: '2027-06-13' });
  assert.equal(december.adjustment, 14);
  assert.equal(june.adjustment, -18);
  assert.ok(december.adjustment > june.adjustment);
});

test('programmer ratings include explicit Neutral and Viable between Neutral and Promising', () => {
  const program = baseProgram();
  const slot = S.planningWindows(schedule).find((entry) => entry.label === 'Prime');
  const evidenceRows = [];
  const unrated = S.scoreProgramForSlot(program, slot, { schedule, evidenceRows, overrideByProgramId: new Map(), baselineRate: 500 });
  const neutral = S.scoreProgramForSlot(program, slot, { schedule, evidenceRows, overrideByProgramId: new Map([['1', { program_id: '1', rating: 'neutral' }]]), baselineRate: 500 });
  const viable = S.scoreProgramForSlot(program, slot, { schedule, evidenceRows, overrideByProgramId: new Map([['1', { program_id: '1', rating: 'viable' }]]), baselineRate: 500 });
  const promising = S.scoreProgramForSlot(program, slot, { schedule, evidenceRows, overrideByProgramId: new Map([['1', { program_id: '1', rating: 'promising' }]]), baselineRate: 500 });
  const dont = S.scoreProgramForSlot(program, slot, { schedule, evidenceRows, overrideByProgramId: new Map([['1', { program_id: '1', rating: 'dont_air' }]]), baselineRate: 500 });
  assert.equal(S.normalizeRating('neutral'), 'neutral');
  assert.equal(S.normalizeRating('viable'), 'viable');
  assert.ok(neutral.score > unrated.score, 'explicit Neutral should mark a reviewed new title for first-test priority');
  assert.ok(viable.score > neutral.score);
  assert.ok(promising.score > viable.score);
  assert.ok(dont.score < unrated.score);
});

test('day-map selector favors new titles and keeps previously aired anchors at one-third or less', () => {
  const make = (id, score, newTitle, rating = '') => ({
    programId: id,
    title: id,
    score,
    newTitle,
    reviewedNew: newTitle && ['neutral', 'viable', 'promising', 'must_air'].includes(rating),
    programmer: { rating },
    season: { holidayOutOfSeason: false }
  });
  const ranked = [
    make('old-anchor', 92, false),
    make('new-promising', 76, true, 'promising'),
    make('new-viable', 70, true, 'viable'),
    make('new-neutral', 64, true, 'neutral'),
    make('old-two', 88, false)
  ];
  const selected = S.selectRecommendationsForSlot(ranked, 4);
  assert.equal(selected.length, 4);
  assert.equal(selected.filter((item) => !item.newTitle).length, 1);
  assert.equal(selected[0].programId, 'new-promising');
  assert.ok(selected.some((item) => item.programId === 'old-anchor'));
});

test('lowercase ordinary "up" does not create Local / U.P. relevance', () => {
  assert.equal(S.isLocal(baseProgram({ title: 'Growing Up Together', program_notes: 'A look up the road.' })), false);
  assert.equal(S.isLocal(baseProgram({ title: 'UP Stories' })), true);
  assert.equal(S.isLocal(baseProgram({ title: 'Lake Superior Stories' })), true);
});

test('rights constraints separate fully unavailable titles from partial-drive rights', () => {
  const library = [
    baseProgram({ id: 'x', title: 'Expired Before Drive', rights_end: '2026-12-01' }),
    baseProgram({ id: 'p', title: 'Partial', rights_start: '2026-12-10' }),
    baseProgram({ id: 'ok', title: 'Full Drive' })
  ];
  const rights = S.rightsConstraints(library, schedule);
  assert.deepEqual(Array.from(rights.unavailable, (item) => item.title), ['Expired Before Drive']);
  assert.deepEqual(Array.from(rights.partial, (item) => item.title), ['Partial']);
});


test('holiday taxonomy distinguishes Christmas, Jewish, Muslim, and New Year programming', () => {
  assert.equal(S.holidayCategory(baseProgram({ title: 'A Classic Christmas', topic_primary: 'Holiday - Christmas' })), 'Holiday - Christmas');
  assert.equal(S.holidayCategory(baseProgram({ title: 'Hanukkah: A Festival of Delights', topic_primary: 'Holiday - Jewish' })), 'Holiday - Jewish');
  assert.equal(S.holidayCategory(baseProgram({ title: 'Ramadan Reflections', topic_primary: 'Holiday - Muslim' })), 'Holiday - Muslim');
  assert.equal(S.holidayCategory(baseProgram({ title: "New Year's Eve Celebration", topic_primary: 'Holiday - New Year' })), 'Holiday - New Year');
});

test('Jewish and Muslim holiday categories use movable holiday windows rather than a blanket December boost', () => {
  const hanukkah = baseProgram({ id: 'j', title: 'Hanukkah: A Festival of Delights', topic_primary: 'Holiday - Jewish' });
  const ramadan = baseProgram({ id: 'm', title: 'Ramadan Reflections', topic_primary: 'Holiday - Muslim' });
  const hanukkahFit = S.holidaySeasonAdjustment(hanukkah, schedule);
  const ramadanDecember = S.holidaySeasonAdjustment(ramadan, schedule);
  const ramadanFit = S.holidaySeasonAdjustment(ramadan, { startDate: '2026-02-18', endDate: '2026-02-25' });
  assert.equal(hanukkahFit.inWindow, true);
  assert.ok(hanukkahFit.adjustment > 0);
  assert.equal(ramadanDecember.inWindow, false);
  assert.ok(ramadanDecember.adjustment < 0);
  assert.equal(ramadanFit.inWindow, true);
  assert.ok(ramadanFit.adjustment > 0);
});

test('New Year programming gets a narrow late-December / early-January window', () => {
  const newYear = baseProgram({ id: 'ny', title: "New Year's Eve Celebration", topic_primary: 'Holiday - New Year' });
  const earlyDecember = S.holidaySeasonAdjustment(newYear, schedule);
  const newYearDrive = S.holidaySeasonAdjustment(newYear, { startDate: '2026-12-29', endDate: '2027-01-02' });
  assert.ok(earlyDecember.adjustment < 0);
  assert.equal(newYearDrive.inWindow, true);
  assert.ok(newYearDrive.adjustment > 0);
});

test('historical matching does not fall back to title when both program IDs disagree', () => {
  const program = baseProgram({ id: 'A', title: 'Shared Title', nola_code: 'AAAA' });
  const wrongId = row({ programId: 'B', title: 'Shared Title', nola_code: 'AAAA' });
  assert.equal(S.rowsForProgram(program, [wrongId]).length, 0);
  const nolaOnly = row({ programId: '', title: 'Different Imported Title', nola_code: 'AAAA' });
  assert.equal(S.rowsForProgram(program, [nolaOnly]).length, 1);
});

test('Report 5 omits topics with no titles eligible for the selected fundraiser', () => {
  const library = [
    baseProgram({ id: 'music', title: 'Music', topic_primary: 'Music' }),
    baseProgram({ id: 'history-expired', title: 'History', topic_primary: 'History', rights_end: '2026-01-01' })
  ];
  const rows = S.topicComparison(library, S.planningWindows(schedule), { schedule, evidenceRows: [] });
  assert.deepEqual(Array.from(rows, (item) => item.topic), ['Music']);
  assert.equal(rows[0].eligibleProgramCount, 1);
});

test('topic performance uses full historical topic evidence, excludes Uncategorized, and details key subtopics', () => {
  const library = [
    baseProgram({ id: 'music', title: 'Music', topic_primary: 'Music', topic_secondary: 'Rock / Pop / Soul' }),
    baseProgram({ id: 'music-expired', title: 'Old Music', topic_primary: 'Music', topic_secondary: 'Rock / Pop / Soul', rights_end: '2026-01-01' }),
    baseProgram({ id: 'doc-hist', title: 'History Doc', topic_primary: 'Documentary', topic_secondary: 'History' }),
    baseProgram({ id: 'doc-blank', title: 'Unassigned Doc', topic_primary: 'Documentary', topic_secondary: '' }),
    baseProgram({ id: 'xmas', title: 'Christmas Special', topic_primary: 'Holiday - Christmas', topic_secondary: 'Music' }),
    baseProgram({ id: 'junk', title: 'Incidental', topic_primary: 'Uncategorized' })
  ];
  const evidenceRows = [
    row({ programId: 'music', title: 'Music', topic: 'Music', dateKey: '2025-12-06', startMinutes: 19 * 60, minutes: 60, dollars: 100, fundraiserId: 'd1' }),
    row({ programId: 'music-expired', title: 'Old Music', topic: 'Music', dateKey: '2024-12-07', startMinutes: 19 * 60, minutes: 60, dollars: 900, fundraiserId: 'd2', secondary: 'Rock / Pop / Soul' }),
    { ...row({ programId: 'doc-hist', title: 'History Doc', topic: 'Documentary', dateKey: '2025-12-07', startMinutes: 20 * 60, minutes: 60, dollars: 300, fundraiserId: 'd1' }), secondary: 'History' },
    { ...row({ programId: 'doc-blank', title: 'Unassigned Doc', topic: 'Documentary', dateKey: '2024-12-08', startMinutes: 20 * 60, minutes: 60, dollars: 200, fundraiserId: 'd2' }), secondary: '' },
    { ...row({ programId: 'xmas', title: 'Christmas Special', topic: 'Holiday - Christmas', dateKey: '2025-12-05', startMinutes: 20 * 60, minutes: 60, dollars: 400, fundraiserId: 'd1' }), secondary: 'Music' }
  ];
  const rows = S.topicComparison(library, S.planningWindows(schedule), { schedule, evidenceRows, seasonRows: evidenceRows });

  assert.ok(!rows.some((item) => item.topic === 'Uncategorized'));
  const music = rows.find((item) => item.topic === 'Music');
  assert.equal(Math.round(music.averageRate), 500, 'expired and current historical Music titles should count equally in the topic average');
  assert.equal(music.testedTitleCount, 2);
  assert.ok(music.subtopicDetails.some((item) => item.label === 'Rock / Pop / Soul'));

  const documentary = rows.find((item) => item.topic === 'Documentary');
  assert.ok(documentary.subtopicDetails.some((item) => item.label === 'History'));
  assert.ok(documentary.subtopicDetails.some((item) => item.label === 'Unassigned'));

  const christmas = rows.find((item) => item.topic === 'Holiday - Christmas');
  assert.ok(christmas.subtopicDetails.some((item) => item.label === 'Music'));
});

test('Report 5 subtopics are ordered by best raw average performance', () => {
  const library = [
    baseProgram({ id: 'rock', title: 'Rock', topic_primary: 'Music', topic_secondary: 'Rock / Pop / Soul' }),
    baseProgram({ id: 'classical', title: 'Classical', topic_primary: 'Music', topic_secondary: 'Classical' }),
    baseProgram({ id: 'folk', title: 'Folk', topic_primary: 'Music', topic_secondary: 'Folk' })
  ];
  const evidenceRows = [
    { ...row({ programId: 'rock', title: 'Rock', topic: 'Music', dateKey: '2025-12-06', minutes: 60, dollars: 200, fundraiserId: 'r1' }), secondary: 'Rock / Pop / Soul' },
    { ...row({ programId: 'classical', title: 'Classical', topic: 'Music', dateKey: '2025-12-07', minutes: 60, dollars: 600, fundraiserId: 'c1' }), secondary: 'Classical' }
  ];
  const rows = S.topicComparison(library, S.planningWindows(schedule), { schedule, evidenceRows, seasonRows: evidenceRows });
  const music = rows.find((item) => item.topic === 'Music');
  assert.deepEqual(Array.from(music.subtopicDetails, (item) => item.label), ['Classical', 'Rock / Pop / Soul', 'Folk']);
});

test('topic ranking uses seasonal performance but all-season evidence depth for confidence', () => {
  const library = [
    baseProgram({ id: 'xmas', title: 'Christmas', topic_primary: 'Holiday - Christmas' }),
    baseProgram({ id: 'loukinen', title: 'Loukinen', topic_primary: 'Loukinen' })
  ];
  const seasonRows = [
    row({ programId: 'xmas', title: 'Christmas', topic: 'Holiday - Christmas', dateKey: '2025-12-06', dollars: 123, fundraiserId: 'xmas-dec' }),
    row({ programId: 'loukinen', title: 'Loukinen', topic: 'Loukinen', dateKey: '2025-12-07', dollars: 241, fundraiserId: 'loukinen-dec' })
  ];
  const performanceStats = {
    topic: new Map([
      ['holiday christmas', { averageRate: 123, testedTitleCount: 8, fundraiserSamples: 6, historyRows: 18 }],
      ['loukinen', { averageRate: 241, testedTitleCount: 5, fundraiserSamples: 4, historyRows: 9 }]
    ]),
    topicReliability: new Map([
      ['holiday christmas', { testedTitleCount: 9, fundraiserSamples: 8 }],
      ['loukinen', { testedTitleCount: 9, fundraiserSamples: 15 }]
    ]),
    subtopicByTopic: new Map(),
    subtopicReliabilityByTopic: new Map()
  };

  const rows = S.topicComparison(library, S.planningWindows(schedule), {
    schedule,
    evidenceRows: seasonRows,
    seasonRows,
    performanceStats
  });

  assert.equal(rows[0].topic, 'Loukinen');
  const loukinen = rows.find((item) => item.topic === 'Loukinen');
  assert.equal(loukinen.averageRate, 241, 'performance should remain December-specific');
  assert.equal(loukinen.testedTitleCount, 5, 'seasonal tested-title count should remain visible');
  assert.equal(loukinen.fundraiserSamples, 4, 'seasonal fundraiser count should remain visible');
  assert.equal(loukinen.confidenceTitleCount, 9, 'ranking confidence should use all-season title depth');
  assert.equal(loukinen.confidenceFundraiserSamples, 15, 'ranking confidence should use all-season fundraiser depth');
});

test('broad repeatable topic evidence outranks spectacular but thin topic evidence', () => {
  const library = [];
  const evidenceRows = [];

  for (let i = 0; i < 10; i += 1) {
    library.push(baseProgram({ id: `music-${i}`, title: `Music ${i}`, topic_primary: 'Music' }));
  }
  library.push(baseProgram({ id: 'nature-1', title: 'Nature One', topic_primary: 'Nature' }));
  library.push(baseProgram({ id: 'nature-2', title: 'Nature Two', topic_primary: 'Nature' }));

  for (let f = 0; f < 6; f += 1) {
    const year = 2020 + f;
    for (let i = 0; i < 10; i += 1) {
      evidenceRows.push(row({
        programId: `music-${i}`,
        title: `Music ${i}`,
        topic: 'Music',
        dateKey: `${year}-12-05`,
        minutes: 60,
        dollars: 300,
        fundraiserId: `music-drive-${f}`
      }));
    }
  }
  evidenceRows.push(row({ programId: 'nature-1', title: 'Nature One', topic: 'Nature', dateKey: '2024-12-06', minutes: 60, dollars: 1500, fundraiserId: 'nature-a' }));
  evidenceRows.push(row({ programId: 'nature-2', title: 'Nature Two', topic: 'Nature', dateKey: '2025-12-06', minutes: 60, dollars: 1500, fundraiserId: 'nature-b' }));

  const rows = S.topicComparison(library, S.planningWindows(schedule), { schedule, evidenceRows, seasonRows: evidenceRows });
  assert.equal(rows[0].topic, 'Music');
  const nature = rows.find((item) => item.topic === 'Nature');
  const music = rows.find((item) => item.topic === 'Music');
  assert.ok(nature.averageRate > music.averageRate, 'Nature should retain its higher raw average');
  assert.ok(nature.planningRankScore < music.planningRankScore, 'thin evidence should not outrank broad repeatable evidence');
});

test('overall mix remains qualitative rather than inventing percentage quotas', () => {
  const strategy = S.buildStrategy({
    schedule,
    library: [
      baseProgram({ id: 'm1', title: 'Music One', topic_primary: 'Music' }),
      baseProgram({ id: 'h1', title: 'History One', topic_primary: 'History' })
    ],
    evidenceRows: []
  });
  assert.ok(strategy.mix.length > 0);
  assert.ok(strategy.mix.every((item) => item.approximateShare === null));
});


test('strategy UI keeps the Report Hub card, future-only picker, compact map, and six rating levels', () => {
  const reportUi = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
  const hubUi = fs.readFileSync(new URL('../assets/js/report-hub-programming-strategy.js', import.meta.url), 'utf8');
  const ratingsUi = fs.readFileSync(new URL('../assets/js/program-editorial-overrides.js', import.meta.url), 'utf8');
  assert.match(hubUi, /card\.className = 'report-card-link'/);
  assert.match(reportUi, /schedule_data/);
  assert.match(reportUi, /strategy-program-row/);
  assert.match(reportUi, /Anticipated day strength/);
  assert.match(reportUi, /Scheduling opportunities \/ tests/);
  assert.match(ratingsUi, />Unrated</);
  assert.match(ratingsUi, /value="neutral"[^>]*>Neutral</);
  assert.match(ratingsUi, /value="viable"[^>]*>Viable</);
  assert.match(ratingsUi, /value="promising"[^>]*>Promising</);
  assert.match(ratingsUi, /value="must_air"[^>]*>Must Air</);
});


test('Report 5 trimmed airing query contains only live Supabase columns', () => {
  const reportUi = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
  const block = reportUi.match(/const airingSelect=\[([\s\S]*?)\]\.join\(','\);/)?.[1] || '';
  assert.ok(block, 'airingSelect block should be present');
  assert.doesNotMatch(block, /source_file_key/);
  assert.match(block, /source_file_name/);
  assert.match(block, /import_batch_id/);
  assert.match(block, /row_hash/);
  assert.match(block, /raw_payload/);
});

test('strategy report keeps heavy analysis off the browser UI thread and trims Supabase payloads', () => {
  const reportUi = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../programming-strategy.html', import.meta.url), 'utf8');
  const workerUi = fs.readFileSync(new URL('../assets/js/programming-strategy-worker.js', import.meta.url), 'utf8');

  assert.match(reportUi, /new Worker\('assets\/js\/programming-strategy-worker\.js\?v=0\.22\.183'\)/);
  assert.match(reportUi, /Scoring eligible titles against WNMU history|Starting strategy analysis/);
  assert.doesNotMatch(reportUi, /\.lte\('air_date',cutoff\)/);
  assert.match(reportUi, /const airingSelect=\[/);
  assert.doesNotMatch(reportUi, /canonicalizeImportedAirings/);
  assert.doesNotMatch(reportUi, /WNMUOneSheetAnalysis/);
  assert.doesNotMatch(reportUi, /WNMUProgrammingStrategyAnalysis/);

  assert.match(workerUi, /importScripts\('one-sheet-analysis\.js\?v=0\.22\.183', 'programming-strategy-analysis\.js\?v=0\.22\.183'\)/);
  assert.match(workerUi, /A\.canonicalizeImportedAirings/);
  assert.match(workerUi, /A\.analyzeSchedule/);
  assert.match(workerUi, /buildDayOutlook/);

  assert.match(page, /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/);
  assert.doesNotMatch(page, /one-sheet-analysis\.js/);
  assert.doesNotMatch(page, /<script defer src="assets\/js\/programming-strategy-analysis\.js/);
});

test('Report 5 presentation removes visible median language and evidence-through card', () => {
  const reportUi = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
  assert.doesNotMatch(reportUi, /median about|median Broadcast|Established/);
  assert.doesNotMatch(reportUi, /strategy-summary/);
  assert.doesNotMatch(reportUi, /sheet-stamp">Evidence through/);
  assert.match(reportUi, /Avg \$.*\/pledge hr/);
  assert.match(reportUi, /All-season depth/);
  assert.match(reportUi, /subtopics/);
  assert.match(reportUi, /Day\/time performance/);
});

test('main Program Library list shows secondary topic under primary topic', () => {
  const listUi = fs.readFileSync(new URL('../assets/js/ui-list.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../assets/styles.css', import.meta.url), 'utf8');
  assert.match(listUi, /derive\.topicSecondary\(row\)/);
  assert.match(listUi, /topic-secondary-label/);
  assert.match(styles, /\.topic-secondary-label/);
});

test('strategy worker returns a complete result without blocking report code paths', () => {
  const { workerContext, workerMessages } = makeWorkerHarness();

  const library = [
    baseProgram({ id: 1, title: 'New Music', nola_code: 'NMUS', rights_start: '2026-01-01', rights_end: '2027-12-31' }),
    baseProgram({ id: 2, title: 'Old Music', nola_code: 'OMUS', rights_start: '2026-01-01', rights_end: '2027-12-31' })
  ];
  const airings = [{
    id: 1,
    program_id: 2,
    pledge_program_id: '2',
    title: 'Old Music',
    program_title: 'Old Music',
    imported_program_title: 'Old Music',
    matched_library_title: 'Old Music',
    nola_code: 'OMUS',
    air_date: '2025-12-06',
    air_time: '19:00',
    aired_at: '2025-12-07T00:00:00Z',
    dollars: 600,
    pledge_count: 4,
    program_minutes: 60,
    fundraiser_label: 'December 2025',
    drive_start_date: '2025-12-05',
    drive_end_date: '2025-12-14',
    station: 'WNMU',
    updated_at: '2025-12-15T00:00:00Z',
    created_at: '2025-12-15T00:00:00Z'
  }];

  workerContext.onmessage({
    data: {
      requestId: 7,
      schedule,
      library,
      airings,
      scheduleRows: [historicalScheduleRow({
        id: 'dec25',
        title: 'December 2025',
        startDate: '2025-12-05',
        endDate: '2025-12-14',
        placements: [{ programId: '2', programTitle: 'Old Music', nolaCode: 'OMUS', dateKey: '2025-12-06', startMinutes: 19 * 60, lengthMinutes: 60 }]
      })],
      overrides: [{ program_id: 1, rating: 'viable', rated_at: '2026-09-18T00:00:00Z', updated_at: '2026-09-18T00:00:00Z' }],
      now: '2026-09-18T12:00:00Z'
    }
  });

  const result = workerMessages.find((message) => message.type === 'result');
  assert.ok(result);
  assert.equal(result.requestId, 7);
  assert.ok(Array.isArray(result.strategy.windows));
  assert.ok(Array.isArray(result.strategy.topicComparison));
  assert.ok(Array.isArray(result.dayOutlook.rows));
  assert.ok(Array.isArray(result.hourlyPatterns.rows));
  assert.ok(Array.isArray(result.opportunities.rows));
  assert.ok(result.hourlyPatterns.rows.some((item) => item.weekday === 'Saturday' && item.startMinutes === 19 * 60));
  assert.equal(result.diagnostics.rawAirings, 1);
  assert.equal(result.diagnostics.evidenceRows, 1);
  assert.ok(workerMessages.some((message) => message.type === 'progress' && message.stage === 'score'));
});

test('Report 5 uses reconciled schedule duration and excludes unmatched or out-of-period rows', () => {
  const { workerContext, workerMessages } = makeWorkerHarness();
  const localSchedule = { id: 'dec26-local', title: 'December 2026', startDate: '2026-12-05', endDate: '2026-12-13' };
  const library = [baseProgram({
    id: 352,
    title: 'Linked to Legends',
    nola_code: 'LTLG',
    topic_primary: 'Music',
    length_bucket_minutes: 90,
    actual_runtime_seconds: null
  })];
  const airings = [
    {
      id: 1, program_id: 352, pledge_program_id: '352', imported_program_title: 'Linked to Legends',
      nola_code: 'LTLG', air_date: '2025-12-06', air_time: '19:00', dollars: 200, pledge_count: 1,
      program_minutes: 1, drive_start_date: '2025-12-05', drive_end_date: '2025-12-14',
      fundraiser_label: 'December 2025', station: 'WNMU', row_hash: 'linked', source_file_name: 'dec25.csv'
    },
    {
      id: 2, imported_program_title: 'Mystery Pledge', air_date: '2025-12-06', air_time: '20:00',
      dollars: 5000, pledge_count: 10, program_minutes: 60, drive_start_date: '2025-12-05',
      drive_end_date: '2025-12-14', fundraiser_label: 'December 2025', station: 'WNMU',
      row_hash: 'unmatched', source_file_name: 'dec25.csv'
    },
    {
      id: 3, program_id: 352, pledge_program_id: '352', imported_program_title: 'Linked to Legends',
      nola_code: 'LTLG', air_date: '2025-12-20', air_time: '19:00', dollars: 9000, pledge_count: 20,
      program_minutes: 1, drive_start_date: '2025-12-05', drive_end_date: '2025-12-14',
      fundraiser_label: 'December 2025', station: 'WNMU', row_hash: 'outside', source_file_name: 'dec25.csv'
    }
  ];
  const scheduleRows = [historicalScheduleRow({
    id: 'dec25-reconciled',
    title: 'December 2025',
    startDate: '2025-12-05',
    endDate: '2025-12-14',
    placements: [{
      programId: '352', programTitle: 'Linked to Legends', nolaCode: 'LTLG',
      dateKey: '2025-12-06', startMinutes: 19 * 60, lengthMinutes: 90
    }]
  })];

  workerContext.onmessage({
    data: { requestId: 701, schedule: localSchedule, library, airings, scheduleRows, overrides: [], now: '2026-09-18T12:00:00Z' }
  });
  const result = workerMessages.find((message) => message.type === 'result');
  assert.ok(result);
  assert.equal(result.diagnostics.rawAirings, 3);
  assert.equal(result.diagnostics.evidenceRows, 1);
  const music = result.strategy.topicComparison.find((item) => item.topic === 'Music');
  assert.ok(music);
  assert.equal(Math.round(music.averageRate), 133, '$200 over the reconciled 90-minute placement should be about $133/hr, not $12,000/hr');
  const saturdaySeven = result.hourlyPatterns.rows.find((item) => item.weekday === 'Saturday' && item.startMinutes === 19 * 60);
  assert.equal(Math.round(saturdaySeven.averageRate), 133);
  const saturdayEight = result.hourlyPatterns.rows.find((item) => item.weekday === 'Saturday' && item.startMinutes === 20 * 60);
  assert.equal(saturdayEight.fundraiserSamples, 0, 'unmatched imported dollars must not become start-time performance evidence');
});

test('Anticipated Day Strength normalizes against the full accepted historical fundraiser schedule', () => {
  const { workerContext, workerMessages } = makeWorkerHarness();
  const selected = { id: 'short-dec26', title: 'Short December 2026', startDate: '2026-12-05', endDate: '2026-12-06' };
  const library = [baseProgram({ id: 1, title: 'Anchor', nola_code: 'ANCH', length_bucket_minutes: 60 })];

  const makeDrive = (id, startDate, dates) => historicalScheduleRow({
    id,
    title: id,
    startDate,
    endDate: dates[2],
    placements: dates.map((dateKey, index) => ({
      programId: '1', programTitle: 'Anchor', nolaCode: 'ANCH', dateKey,
      startMinutes: 19 * 60, lengthMinutes: 60, id: `${id}-p${index}`
    }))
  });
  const scheduleRows = [
    makeDrive('December 2024', '2024-12-07', ['2024-12-07', '2024-12-08', '2024-12-09']),
    makeDrive('December 2025', '2025-12-06', ['2025-12-06', '2025-12-07', '2025-12-08'])
  ];
  const dollarsByDate = new Map([
    ['2024-12-07', 100], ['2024-12-08', 100], ['2024-12-09', 10000],
    ['2025-12-06', 100], ['2025-12-07', 100], ['2025-12-08', 10000]
  ]);
  const airings = [...dollarsByDate.entries()].map(([dateKey, dollars], index) => ({
    id: index + 1, program_id: 1, pledge_program_id: '1', imported_program_title: 'Anchor',
    nola_code: 'ANCH', air_date: dateKey, air_time: '19:00', dollars, pledge_count: 1,
    program_minutes: 60, drive_start_date: dateKey.startsWith('2024') ? '2024-12-07' : '2025-12-06',
    drive_end_date: dateKey.startsWith('2024') ? '2024-12-09' : '2025-12-08',
    fundraiser_label: dateKey.startsWith('2024') ? 'December 2024' : 'December 2025',
    station: 'WNMU', row_hash: `day-${index}`, source_file_name: `drive-${dateKey.slice(0,4)}.csv`
  }));

  workerContext.onmessage({
    data: { requestId: 702, schedule: selected, library, airings, scheduleRows, overrides: [], now: '2026-09-18T12:00:00Z' }
  });
  const result = workerMessages.find((message) => message.type === 'result');
  assert.ok(result);
  assert.equal(result.dayOutlook.rows.length, 2);
  assert.ok(
    result.dayOutlook.rows.every((item) => item.outlook === 'Usually weak'),
    JSON.stringify(result.dayOutlook.rows)
  );
  assert.ok(
    result.dayOutlook.rows.every((item) => item.relativeIndex < 0.1),
    JSON.stringify(result.dayOutlook.rows)
  );
});

test('strategy scoring caches repeated program and slot evidence scans', () => {
  assert.match(source, /function buildProgramRowIndex/);
  assert.match(source, /function buildSlotEvidenceIndex/);
  assert.match(source, /programRowIndex: buildProgramRowIndex\(historicalRows\)/);
  assert.match(source, /slotEvidenceIndex: buildSlotEvidenceIndex\(historicalRows\)/);
  assert.match(source, /rankProgramsForSlot\(viable, slot, context\)/);
  assert.match(source, /scoreCache: new Map\(\)/);
  assert.match(source, /exactTopicSummaries/);
  assert.match(source, /seasonSlotEvidenceIndex/);
  assert.match(source, /seasonTopicSummaryCache/);
});


test('Report 5 unhides after successful admin access and does not silently discard programmer ratings', () => {
  const reportUi = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
  assert.match(reportUi, /#strategy-app'\)\?\.classList\.remove\('hidden'\)/);
  assert.match(reportUi, /fetchAll\('pledge_program_editorial_overrides'/);
  assert.doesNotMatch(reportUi, /fetchOptional\('pledge_program_editorial_overrides'/);
  assert.match(reportUi, /Strategy analysis exceeded 90 seconds/);
  assert.match(reportUi, /90000/);
});

test('Saturday 3–5 PM is reported once as a broader-test window when history is narrowly Michigan programming', () => {
  const { workerContext, workerMessages } = makeWorkerHarness();

  workerContext.onmessage({
    data: {
      requestId: 88,
      schedule,
      library: [
        baseProgram({ id: 1, title: 'Michigan Test', topic_primary: 'Michigan', nola_code: 'MICH' }),
        baseProgram({ id: 2, title: 'Music Anchor', topic_primary: 'Music', nola_code: 'MUSC' })
      ],
      airings: [
        { id: 1, program_id: 1, pledge_program_id: '1', imported_program_title: 'Michigan Test', nola_code: 'MICH', air_date: '2025-12-06', air_time: '15:30', dollars: 0, pledge_count: 0, program_minutes: 30, drive_start_date: '2025-12-05', drive_end_date: '2025-12-14', fundraiser_label: 'December 2025', station: 'WNMU', row_hash: 'm1', import_batch_id: 'b1', source_file_name: 'dec25.csv' },
        { id: 2, program_id: 1, pledge_program_id: '1', imported_program_title: 'Michigan Test', nola_code: 'MICH', air_date: '2024-12-07', air_time: '15:30', dollars: 0, pledge_count: 0, program_minutes: 30, drive_start_date: '2024-12-06', drive_end_date: '2024-12-15', fundraiser_label: 'December 2024', station: 'WNMU', row_hash: 'm2', import_batch_id: 'b2', source_file_name: 'dec24.csv' },
        { id: 3, program_id: 2, pledge_program_id: '2', imported_program_title: 'Music Anchor', nola_code: 'MUSC', air_date: '2025-12-06', air_time: '19:00', dollars: 600, pledge_count: 4, program_minutes: 60, drive_start_date: '2025-12-05', drive_end_date: '2025-12-14', fundraiser_label: 'December 2025', station: 'WNMU', row_hash: 'a1', import_batch_id: 'b1', source_file_name: 'dec25.csv' },
        { id: 4, program_id: 2, pledge_program_id: '2', imported_program_title: 'Music Anchor', nola_code: 'MUSC', air_date: '2024-12-07', air_time: '19:00', dollars: 600, pledge_count: 4, program_minutes: 60, drive_start_date: '2024-12-06', drive_end_date: '2024-12-15', fundraiser_label: 'December 2024', station: 'WNMU', row_hash: 'a2', import_batch_id: 'b2', source_file_name: 'dec24.csv' }
      ],
      scheduleRows: [
        historicalScheduleRow({
          id: 'dec25',
          title: 'December 2025',
          startDate: '2025-12-05',
          endDate: '2025-12-14',
          placements: [
            { programId: '1', programTitle: 'Michigan Test', nolaCode: 'MICH', dateKey: '2025-12-06', startMinutes: 15 * 60 + 30, lengthMinutes: 60 },
            { programId: '2', programTitle: 'Music Anchor', nolaCode: 'MUSC', dateKey: '2025-12-06', startMinutes: 19 * 60, lengthMinutes: 60 }
          ]
        }),
        historicalScheduleRow({
          id: 'dec24',
          title: 'December 2024',
          startDate: '2024-12-06',
          endDate: '2024-12-15',
          placements: [
            { programId: '1', programTitle: 'Michigan Test', nolaCode: 'MICH', dateKey: '2024-12-07', startMinutes: 15 * 60 + 30, lengthMinutes: 60 },
            { programId: '2', programTitle: 'Music Anchor', nolaCode: 'MUSC', dateKey: '2024-12-07', startMinutes: 19 * 60, lengthMinutes: 60 }
          ]
        })
      ],
      overrides: [],
      now: '2026-09-18T12:00:00Z'
    }
  });

  const result = workerMessages.find((message) => message.type === 'result');
  assert.ok(result);
  const saturday = result.opportunities.rows.filter((item) => item.weekday === 'Saturday' && item.startMinutes === 15 * 60 && item.endMinutes === 17 * 60);
  assert.equal(saturday.length, 1);
  assert.equal(saturday[0].kind, 'narrow-test');
  assert.equal(saturday[0].dominantTopic, 'Michigan');
  assert.match(saturday[0].rationale, /not a broad test of normal pledge programming/i);
});

test('worker aggregates separate pledge breaks from the same airing instead of dropping one', () => {
  const { workerContext, workerMessages } = makeWorkerHarness();

  workerContext.onmessage({
    data: {
      requestId: 8,
      schedule,
      library: [baseProgram({ id: 1, title: 'Break Test', nola_code: 'BRKT' })],
      airings: [
        {
          id: 101, row_hash: 'a', import_batch_id: 'batch-1', source_file_name: 'breaks.csv',
          program_id: 1, pledge_program_id: '1', imported_program_title: 'Break Test', nola_code: 'BRKT',
          air_date: '2025-12-06', air_time: '19:00', dollars: 100, pledge_count: 1, program_minutes: 10,
          drive_start_date: '2025-12-05', drive_end_date: '2025-12-14', station: 'WNMU'
        },
        {
          id: 102, row_hash: 'b', import_batch_id: 'batch-1', source_file_name: 'breaks.csv',
          program_id: 1, pledge_program_id: '1', imported_program_title: 'Break Test', nola_code: 'BRKT',
          air_date: '2025-12-06', air_time: '19:00', dollars: 50, pledge_count: 1, program_minutes: 20,
          drive_start_date: '2025-12-05', drive_end_date: '2025-12-14', station: 'WNMU'
        }
      ],
      scheduleRows: [historicalScheduleRow({
        id: 'dec25-breaks',
        title: 'December 2025',
        startDate: '2025-12-05',
        endDate: '2025-12-14',
        placements: [{ programId: '1', programTitle: 'Break Test', nolaCode: 'BRKT', dateKey: '2025-12-06', startMinutes: 19 * 60, lengthMinutes: 30 }]
      })],
      overrides: [],
      now: '2026-09-18T12:00:00Z'
    }
  });

  const result = workerMessages.find((message) => message.type === 'result');
  assert.ok(result);
  assert.equal(result.diagnostics.rawAirings, 2);
  assert.equal(result.diagnostics.canonicalAirings, 1);
  assert.equal(result.diagnostics.evidenceRows, 1);
  const music = result.strategy.topicComparison.find((item) => item.topic === 'Music');
  assert.ok(music);
  assert.equal(Math.round(music.averageRate), 300, '100 + 50 dollars over 10 + 20 pledge minutes must equal $300/hr');
});

test('Must Air waits for a suitable placement and can earn one bad-night second chance', () => {
  const program = baseProgram({ id: 'must', title: 'Must Test', topic_primary: 'Music' });
  const slot = S.planningWindows(schedule).find((entry) => entry.date === '2026-12-05' && entry.label === 'Prime');
  const override = { program_id: 'must', rating: 'must_air', rated_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' };
  const history = [
    row({ programId: 'must', title: 'Must Test', dateKey: '2026-08-08', startMinutes: 19 * 60, minutes: 60, dollars: 50, fundraiserId: 'aug26' }),
    row({ programId: 'other-a', title: 'Other A', dateKey: '2026-08-08', startMinutes: 18 * 60, minutes: 60, dollars: 60, fundraiserId: 'aug26' }),
    row({ programId: 'other-b', title: 'Other B', dateKey: '2026-08-08', startMinutes: 20 * 60, minutes: 60, dollars: 70, fundraiserId: 'aug26' }),
    row({ programId: 'normal-a', title: 'Normal A', dateKey: '2026-03-07', startMinutes: 19 * 60, minutes: 60, dollars: 600, fundraiserId: 'mar26' }),
    row({ programId: 'normal-b', title: 'Normal B', dateKey: '2026-03-08', startMinutes: 19 * 60, minutes: 60, dollars: 650, fundraiserId: 'mar26' })
  ];
  const first = S.scoreProgramForSlot(program, slot, {
    schedule,
    evidenceRows: history,
    overrideByProgramId: new Map([['must', override]])
  });
  assert.equal(first.programmer.rating, 'must_air');
  assert.equal(first.programmer.secondChance, true);
  assert.equal(first.programmer.adjustment, 14, 'second-chance Must Air should carry reduced priority, not the full +28');
  assert.match(first.programmer.label, /second chance/i);

  const secondHistory = [
    ...history,
    row({ programId: 'must', title: 'Must Test', dateKey: '2026-09-12', startMinutes: 19 * 60, minutes: 60, dollars: 40, fundraiserId: 'sep26' }),
    row({ programId: 'normal-c', title: 'Normal C', dateKey: '2026-09-12', startMinutes: 18 * 60, minutes: 60, dollars: 620, fundraiserId: 'sep26' }),
    row({ programId: 'normal-d', title: 'Normal D', dateKey: '2026-09-12', startMinutes: 20 * 60, minutes: 60, dollars: 610, fundraiserId: 'sep26' })
  ];
  const resolved = S.scoreProgramForSlot(program, slot, {
    schedule,
    evidenceRows: secondHistory,
    overrideByProgramId: new Map([['must', override]])
  });
  assert.equal(resolved.programmer.storedRating, 'must_air');
  assert.equal(resolved.programmer.rating, 'low_confidence');
  assert.equal(resolved.programmer.secondChance, false);
});

test('Must Air does not override an obviously wrong seasonal placement', () => {
  const holiday = baseProgram({ id: 'holiday-must', title: 'A Classic Christmas', topic_primary: 'Holiday - Christmas' });
  const juneSchedule = { id: 'june27', title: 'June 2027', startDate: '2027-06-05', endDate: '2027-06-13' };
  const slot = S.planningWindows(juneSchedule).find((entry) => entry.label === 'Prime');
  const scored = S.scoreProgramForSlot(holiday, slot, {
    schedule: juneSchedule,
    evidenceRows: [],
    overrideByProgramId: new Map([['holiday-must', { program_id: 'holiday-must', rating: 'must_air', rated_at: '2026-09-18T00:00:00Z' }]])
  });
  assert.equal(scored.fit, 'Save for Christmas season');
  assert.ok(scored.cautions.some((item) => /does not override seasonal fit/i.test(item)));
});

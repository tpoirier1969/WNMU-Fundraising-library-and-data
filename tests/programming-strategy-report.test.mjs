import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/programming-strategy-analysis.js', import.meta.url), 'utf8');
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
  assert.equal(afterTopic.medianRate, beforeTopic.medianRate);
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

test('topic comparison includes every Program Library topic, including topics with no drive-eligible title', () => {
  const library = [
    baseProgram({ id: 'music', title: 'Music', topic_primary: 'Music' }),
    baseProgram({ id: 'history-expired', title: 'History', topic_primary: 'History', rights_end: '2026-01-01' })
  ];
  const rows = S.topicComparison(library, S.planningWindows(schedule), { schedule, evidenceRows: [] });
  assert.deepEqual(Array.from(rows, (item) => item.topic).sort(), ['History', 'Music']);
  assert.equal(rows.find((item) => item.topic === 'History').eligibleProgramCount, 0);
  assert.equal(rows.find((item) => item.topic === 'Music').eligibleProgramCount, 1);
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
  assert.match(reportUi, /\.gte\('start_date',todayKey\(\)\)/);
  assert.match(reportUi, /strategy-program-row/);
  assert.match(reportUi, /Anticipated day strength/);
  assert.match(reportUi, /Experimental opportunities/);
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
});

test('strategy report keeps heavy analysis off the browser UI thread and trims Supabase payloads', () => {
  const reportUi = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../programming-strategy.html', import.meta.url), 'utf8');
  const workerUi = fs.readFileSync(new URL('../assets/js/programming-strategy-worker.js', import.meta.url), 'utf8');

  assert.match(reportUi, /new Worker\('assets\/js\/programming-strategy-worker\.js\?v=0\.22\.177'\)/);
  assert.match(reportUi, /Scoring eligible titles against WNMU history|Starting strategy analysis/);
  assert.match(reportUi, /\.lte\('air_date',cutoff\)/);
  assert.match(reportUi, /const airingSelect=\[/);
  assert.doesNotMatch(reportUi, /canonicalizeImportedAirings/);
  assert.doesNotMatch(reportUi, /WNMUOneSheetAnalysis/);
  assert.doesNotMatch(reportUi, /WNMUProgrammingStrategyAnalysis/);

  assert.match(workerUi, /importScripts\('programming-strategy-analysis\.js\?v=0\.22\.177'\)/);
  assert.match(workerUi, /canonicalizeAirings/);
  assert.match(workerUi, /buildDayOutlook/);

  assert.match(page, /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/);
  assert.doesNotMatch(page, /one-sheet-analysis\.js/);
  assert.doesNotMatch(page, /<script defer src="assets\/js\/programming-strategy-analysis\.js/);
});

test('strategy worker returns a complete result without blocking report code paths', () => {
  const workerSource = fs.readFileSync(new URL('../assets/js/programming-strategy-worker.js', import.meta.url), 'utf8');
  const workerMessages = [];
  const workerContext = {
    console, Date, Map, Set, Math, Number, String, Object, Array, RegExp, Intl,
    performance: { now: () => Date.now() }
  };
  workerContext.globalThis = workerContext;
  workerContext.self = workerContext;
  workerContext.postMessage = (message) => workerMessages.push(message);
  workerContext.importScripts = () => {};
  vm.runInNewContext(source, workerContext, { filename: 'programming-strategy-analysis.js' });
  vm.runInNewContext(workerSource, workerContext, { filename: 'programming-strategy-worker.js' });

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
  assert.equal(result.diagnostics.rawAirings, 1);
  assert.equal(result.diagnostics.evidenceRows, 1);
  assert.ok(workerMessages.some((message) => message.type === 'progress' && message.stage === 'score'));
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

test('worker aggregates separate pledge breaks from the same airing instead of dropping one', () => {
  const workerSource = fs.readFileSync(new URL('../assets/js/programming-strategy-worker.js', import.meta.url), 'utf8');
  const workerMessages = [];
  const workerContext = {
    console, Date, Map, Set, Math, Number, String, Object, Array, RegExp, Intl,
    performance: { now: () => Date.now() }
  };
  workerContext.globalThis = workerContext;
  workerContext.self = workerContext;
  workerContext.postMessage = (message) => workerMessages.push(message);
  workerContext.importScripts = () => {};
  vm.runInNewContext(source, workerContext, { filename: 'programming-strategy-analysis.js' });
  vm.runInNewContext(workerSource, workerContext, { filename: 'programming-strategy-worker.js' });

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
  assert.equal(Math.round(music.medianRate), 300, '100 + 50 dollars over 10 + 20 pledge minutes must equal $300/hr');
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

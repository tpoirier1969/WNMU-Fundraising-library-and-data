import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/programming-strategy-analysis.js', import.meta.url), 'utf8');
const oneSheetSource = fs.readFileSync(new URL('../assets/js/one-sheet-analysis.js', import.meta.url), 'utf8');
const backtestSource = fs.readFileSync(new URL('../assets/js/programming-strategy-backtest.js', import.meta.url), 'utf8');
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
  vm.runInNewContext(backtestSource, workerContext, { filename: 'programming-strategy-backtest.js' });
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

test('December 2026 5–7 PM is web-only experimental while staffed prime windows stay normal', () => {
  const windows = S.planningWindows(schedule);
  const early = windows.filter((entry) => entry.startMinutes === 17 * 60 && entry.endMinutes === 19 * 60);
  assert.ok(early.length > 0);
  assert.ok(early.every((entry) => entry.label === 'Early evening'));
  assert.ok(early.every((entry) => entry.webOnlyExperimental === true));
  assert.ok(early.every((entry) => entry.fundraisingMode === 'web-only'));
  assert.ok(early.every((entry) => entry.experimental === true && entry.confidenceClass === 'experimental'));
  assert.ok(windows.some((entry) => entry.confidenceClass === 'normal' && entry.label === 'Prime'));

  const saturdayLate = windows.filter((entry) => entry.weekday === 'Saturday' && entry.label === 'Late afternoon');
  assert.ok(saturdayLate.length >= 1);
  assert.ok(saturdayLate.every((entry) => entry.experimental && entry.confidenceClass === 'experimental'));

  const june = S.planningWindows({ startDate:'2027-06-05', endDate:'2027-06-13' });
  const juneEarly = june.filter((entry) => entry.startMinutes === 17 * 60 && entry.endMinutes === 19 * 60);
  assert.ok(juneEarly.length > 0);
  assert.ok(juneEarly.every((entry) => !entry.webOnlyExperimental && entry.fundraisingMode === 'staffed'));
  assert.ok(juneEarly.every((entry) => !entry.experimental && entry.confidenceClass === 'normal'));
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

test('scheduler-defined Fundraising Windows replace default planning inventory', () => {
  const custom = {
    ...schedule,
    fundraisingWindows:[{
      id:'sat-afternoon',
      dateKey:'2026-12-05',
      startMinutes:10*60,
      endMinutes:13*60,
      priority:'prefer',
      note:'Explore more pledge hours'
    }]
  };
  const windows = S.planningWindows(custom);
  assert.equal(windows.length,1);
  assert.equal(windows[0].userDefined,true);
  assert.equal(windows[0].sourceWindowId,'sat-afternoon');
  assert.equal(windows[0].startMinutes,10*60);
  assert.equal(windows[0].endMinutes,13*60);
  assert.equal(windows[0].priority,'prefer');
  assert.equal(windows[0].priorityLabel,'Prefer pledge');
  assert.equal(windows[0].note,'Explore more pledge hours');
  assert.ok(!windows.some((entry)=>entry.label==='Prime'),'default evening inventory must not be added after explicit windows exist');
});

test('December 2026 Fundraising Windows split the 5–7 PM Web-only experiment from staffed inventory', () => {
  const custom={
    ...schedule,
    fundraisingWindows:[{
      id:'mixed-window',
      dateKey:'2026-12-05',
      startMinutes:16*60,
      endMinutes:20*60,
      priority:'prefer'
    }]
  };
  const windows=S.planningWindows(custom);
  assert.deepEqual(Array.from(windows,(entry)=>[entry.startMinutes,entry.endMinutes,entry.fundraisingMode]),[
    [16*60,17*60,'staffed'],
    [17*60,19*60,'web-only'],
    [19*60,20*60,'staffed']
  ]);
  assert.equal(windows[1].webOnlyExperimental,true);
  assert.equal(windows[0].webOnlyExperimental,false);
  assert.equal(windows[2].webOnlyExperimental,false);
});

test('Friday Fundraising Windows preserve the protected 8–9 PM regular-programming hour', () => {
  const custom = {
    ...schedule,
    fundraisingWindows:[{
      id:'fri-window',
      dateKey:'2026-12-11',
      startMinutes:19*60,
      endMinutes:22*60,
      priority:'commit'
    }]
  };
  const windows = S.planningWindows(custom);
  assert.equal(windows.length,3);
  assert.equal(windows[0].startMinutes,19*60);
  assert.equal(windows[0].endMinutes,20*60);
  assert.equal(windows[0].blocked,false);
  assert.equal(windows[1].startMinutes,20*60);
  assert.equal(windows[1].endMinutes,21*60);
  assert.equal(windows[1].blocked,true);
  assert.equal(windows[2].startMinutes,21*60);
  assert.equal(windows[2].endMinutes,22*60);
  assert.equal(windows[2].blocked,false);
});

test('Fundraising Window optimizer can choose multiple strong programs and leave unused time', () => {
  const result=S.optimizeFundraisingWindowCandidates([
    {key:'a',startUnit:0,units:2,value:100,score:80,title:'A'},
    {key:'b',startUnit:2,units:2,value:90,score:78,title:'B'},
    {key:'c',startUnit:0,units:5,value:150,score:85,title:'C'}
  ],5);
  assert.deepEqual(Array.from(result.items,(item)=>item.key),['a','b']);
  assert.equal(result.usedUnits,4);
  assert.equal(5-result.usedUnits,1,'one 30-minute unit should remain unused rather than forcing a weaker full-window choice');
});

test('strategy builds an actual multi-title lineup inside a marked window without forcing full coverage', () => {
  const custom={
    ...schedule,
    fundraisingWindows:[{
      id:'window',
      dateKey:'2026-12-05',
      startMinutes:10*60,
      endMinutes:12*60+30,
      priority:'open'
    }]
  };
  const library=[
    baseProgram({id:'a',title:'Strong New A',topic_primary:'Music',length_bucket_minutes:60}),
    baseProgram({id:'b',title:'Strong New B',topic_primary:'Music',length_bucket_minutes:60})
  ];
  const overrides=[
    {program_id:'a',rating:'must_air'},
    {program_id:'b',rating:'must_air'}
  ];
  const strategy=S.buildStrategy({schedule:custom,library,evidenceRows:[],overrides,now:new Date('2026-09-29T12:00:00')});
  const window=strategy.windows.find((entry)=>entry.sourceWindowId==='window');
  assert.ok(window);
  assert.equal(window.lineup.length,2);
  assert.equal(window.recommendedMinutes,120);
  assert.equal(window.unusedMinutes,30);
  assert.equal(new Set(window.lineup.map((item)=>item.programId)).size,2);
  assert.ok(window.lineup.every((item)=>item.plannedStartMinutes>=10*60&&item.plannedEndMinutes<=12*60+30));
});

test('same-day Fundraising Windows do not recommend the same title twice', () => {
  const custom={
    ...schedule,
    fundraisingWindows:[
      {id:'first',dateKey:'2026-12-05',startMinutes:10*60,endMinutes:11*60,priority:'open'},
      {id:'second',dateKey:'2026-12-05',startMinutes:12*60,endMinutes:13*60,priority:'open'}
    ]
  };
  const library=[
    baseProgram({id:'a',title:'Strong New A',topic_primary:'Music',length_bucket_minutes:60}),
    baseProgram({id:'b',title:'Strong New B',topic_primary:'Music',length_bucket_minutes:60})
  ];
  const overrides=[
    {program_id:'a',rating:'must_air'},
    {program_id:'b',rating:'must_air'}
  ];
  const strategy=S.buildStrategy({schedule:custom,library,evidenceRows:[],overrides,now:new Date('2026-09-29T12:00:00')});
  const planned=strategy.windows.filter((entry)=>entry.userDefined&&!entry.blocked);
  assert.equal(planned.length,2);
  assert.equal(planned[0].lineup.length,1);
  assert.equal(planned[1].lineup.length,1);
  assert.notEqual(planned[0].lineup[0].programId,planned[1].lineup[0].programId);
});

test('fundraiser-wide title allocation allows four appearances but no more than two in one daypart', () => {
  const make=(id,score)=>({
    programId:id,
    title:id,
    score,
    evidenceCount:4,
    newTitle:true,
    reviewedNew:true,
    programmer:{rating:'promising'},
    season:{holidayOutOfSeason:false},
    drama:{isDramaDoc:false}
  });
  const rankedWindows=[
    {slot:{id:'prime-1',date:'2026-12-01',startMinutes:19*60,endMinutes:20*60},ranked:[make('dominant',82)]},
    {slot:{id:'prime-2',date:'2026-12-03',startMinutes:19*60,endMinutes:20*60},ranked:[make('dominant',81)]},
    {slot:{id:'prime-3',date:'2026-12-05',startMinutes:19*60,endMinutes:20*60},ranked:[make('dominant',80)]},
    {slot:{id:'early-1',date:'2026-12-07',startMinutes:17*60,endMinutes:18*60},ranked:[make('dominant',79)]},
    {slot:{id:'early-2',date:'2026-12-09',startMinutes:17*60,endMinutes:18*60},ranked:[make('dominant',78)]},
    {slot:{id:'early-3',date:'2026-12-11',startMinutes:17*60,endMinutes:18*60},ranked:[make('dominant',77)]},
    {slot:{id:'afternoon-1',date:'2026-12-13',startMinutes:15*60,endMinutes:16*60},ranked:[make('dominant',76)]}
  ];
  const assigned=S.buildFundraiserTitleAssignments(rankedWindows);
  const dominant=[...(assigned.get('dominant')||[])];
  assert.equal(dominant.length,4);
  assert.deepEqual(dominant,['prime-1','prime-2','early-1','early-2']);
  assert.ok(!dominant.includes('prime-3'),'a third Prime appearance must be rejected even when it scores higher than another daypart');
  assert.ok(!dominant.includes('early-3'),'a third Early evening appearance must be rejected');
  assert.ok(!dominant.includes('afternoon-1'),'the drive-wide cap remains four');
});

test('Fundraiser Plan enforces four-per-drive and two-per-daypart caps', () => {
  const custom={
    ...schedule,
    fundraisingWindows:[
      {id:'m1',dateKey:'2026-12-05',startMinutes:9*60,endMinutes:10*60,priority:'open'},
      {id:'p1',dateKey:'2026-12-06',startMinutes:19*60,endMinutes:20*60,priority:'open'},
      {id:'m2',dateKey:'2026-12-07',startMinutes:9*60,endMinutes:10*60,priority:'open'},
      {id:'p2',dateKey:'2026-12-08',startMinutes:19*60,endMinutes:20*60,priority:'open'},
      {id:'m3',dateKey:'2026-12-09',startMinutes:9*60,endMinutes:10*60,priority:'open'},
      {id:'p3',dateKey:'2026-12-10',startMinutes:19*60,endMinutes:20*60,priority:'open'}
    ]
  };
  const library=[
    baseProgram({id:'dominant',title:'Dominant New Music',topic_primary:'Music',length_bucket_minutes:60}),
    baseProgram({id:'b',title:'New Music B',topic_primary:'Music',length_bucket_minutes:60}),
    baseProgram({id:'c',title:'New Music C',topic_primary:'Music',length_bucket_minutes:60}),
    baseProgram({id:'d',title:'New Music D',topic_primary:'Music',length_bucket_minutes:60})
  ];
  const overrides=[
    {program_id:'dominant',rating:'must_air'},
    {program_id:'b',rating:'promising'},
    {program_id:'c',rating:'promising'},
    {program_id:'d',rating:'promising'}
  ];
  const strategy=S.buildStrategy({schedule:custom,library,evidenceRows:[],overrides,now:new Date('2026-09-29T12:00:00')});
  const dominantAppearances=strategy.windows
    .filter((entry)=>entry.userDefined&&!entry.blocked)
    .flatMap((entry)=>entry.lineup||[])
    .filter((item)=>item.programId==='dominant');
  const byDaypart=new Map();
  dominantAppearances.forEach((item)=>{
    const daypart=S.daypartForMinutes(item.plannedStartMinutes);
    byDaypart.set(daypart,(byDaypart.get(daypart)||0)+1);
  });
  assert.equal(strategy.titleAppearanceCap,4);
  assert.equal(strategy.titleDaypartAppearanceCap,2);
  assert.equal(dominantAppearances.length,4,'a strong title may be used more than twice when different dayparts justify it');
  assert.ok([...byDaypart.values()].every((count)=>count<=2));
  assert.equal(byDaypart.get('Morning'),2);
  assert.equal(byDaypart.get('Prime'),2);
});

test('recommended titles come only from the supplied Program Library', () => {
  const library = [baseProgram({ id: 'a', title: 'Library A' }), baseProgram({ id: 'b', title: 'Library B', topic_primary: 'History' })];
  const strategy = S.buildStrategy({ schedule, library, evidenceRows: [row({ programId: 'ghost', title: 'Ghost Result', dollars: 5000 })] });
  const allowed = new Set(library.map((program) => program.title));
  strategy.windows.forEach((window) => window.recommendations.forEach((recommendation) => assert.ok(allowed.has(recommendation.title))));
});

test('Drama Doc season detection prefers explicit series-season evidence over rights-start recency', () => {
  const target={startDate:'2026-12-05',endDate:'2026-12-13'};
  const library=[
    baseProgram({id:'s4',title:'All Creatures Great and Small: A Season 4 Change',topic_primary:'Drama Doc',program_notes:'Go behind the scenes of Season 4.',rights_start:'2024-08-10',rights_end:'2028-02-17'}),
    baseProgram({id:'s5',title:'All Creatures Great and Small: Chapter Five',topic_primary:'Drama Doc',program_notes:'Season 5 finds young baby Jimmy...',rights_start:'2025-08-07',rights_end:'2027-09-06'}),
    baseProgram({id:'s6',title:'All Creatures Great and Small: Chapter Six',topic_primary:'Drama Doc',program_notes:'Go behind the scenes as the cast discuss what happens in Season 6.',rights_start:'2026-08-05',rights_end:'2032-02-18'}),
    baseProgram({id:'e8',title:'Endeavour: The Evolution',topic_primary:'Drama Doc',program_notes:'In advance of the Season 8 premiere.',rights_start:'2022-02-26',rights_end:'2027-09-30'}),
    baseProgram({id:'e9',title:'Endeavour: A Countdown to the Final Goodbye',topic_primary:'Drama Doc',program_notes:'Final season, Season 9.',rights_start:'2023-02-25',rights_end:'2027-07-01'})
  ];
  const index=S.buildDramaCycleIndex(library,target);
  const s4=S.dramaInfo(library[0],target,index);
  const s5=S.dramaInfo(library[1],target,index);
  const s6=S.dramaInfo(library[2],target,index);
  const e9=S.dramaInfo(library[4],target,index);

  assert.deepEqual(Array.from(S.dramaSeasonNumbers(library[1])),[5]);
  assert.equal(S.dramaSeriesKey(library[2]),'all creatures great and small');
  assert.equal(s4.currentSeriesSeason,6);
  assert.equal(s4.currentCycle,false);
  assert.equal(s5.currentCycle,false);
  assert.equal(s6.currentCycle,true);
  assert.equal(s6.basis,'series-season');
  assert.equal(e9.currentSeriesSeason,9);
  assert.equal(e9.currentCycle,false,'matching an old season number is not enough when the series itself is no longer current');
});

test('explicit Drama Doc cycle status overrides inferred season and rights timing', () => {
  const schedule={ startDate:'2026-12-05', endDate:'2026-12-13' };
  const explicitCurrent=baseProgram({
    id:'explicit-current',
    title:'Old Rights But Current Drama',
    topic_primary:'Drama Doc',
    rights_start:'2024-01-01',
    drama_cycle_status:'current'
  });
  const explicitOlder=baseProgram({
    id:'explicit-older',
    title:'Recent Rights But Older Drama',
    topic_primary:'Drama Doc',
    rights_start:'2026-09-01',
    drama_cycle_status:'older'
  });
  const current=S.dramaInfo(explicitCurrent,schedule,new Map());
  const older=S.dramaInfo(explicitOlder,schedule,new Map());
  assert.equal(current.basis,'explicit');
  assert.equal(current.currentCycle,true);
  assert.equal(current.olderCycle,false);
  assert.equal(older.basis,'explicit');
  assert.equal(older.currentCycle,false);
  assert.equal(older.olderCycle,true);
});

test('Drama Doc recommendation rule allows new titles and current-cycle repeats only', () => {
  const newDrama = {
    programId:'new-drama', title:'New Drama Doc', topic:'Drama Doc', score:75, newTitle:true, reviewedNew:true,
    programmer:{rating:'promising'}, season:{holidayOutOfSeason:false},
    drama:{isDramaDoc:true,currentCycle:false,olderCycle:true}
  };
  const currentRepeat = {
    programId:'current-repeat', title:'Current Drama Repeat', topic:'Drama Doc', score:82, newTitle:false,
    programmer:{rating:''}, season:{holidayOutOfSeason:false},
    drama:{isDramaDoc:true,currentCycle:true,olderCycle:false,basis:'series-season'}
  };
  const explicitCurrentRepeat = {
    programId:'explicit-current', title:'Explicit Current Drama Repeat', topic:'Drama Doc', score:80, newTitle:false,
    programmer:{rating:''}, season:{holidayOutOfSeason:false},
    drama:{isDramaDoc:true,currentCycle:true,olderCycle:false,basis:'explicit'}
  };
  const rightsOnlyRepeat = {
    programId:'rights-only', title:'Recent Rights Only Drama Repeat', topic:'Drama Doc', score:90, newTitle:false,
    programmer:{rating:''}, season:{holidayOutOfSeason:false},
    drama:{isDramaDoc:true,currentCycle:false,olderCycle:false,cycleUnknown:true,basis:'rights-start-only',recentRightsStart:true}
  };
  const olderRepeat = {
    programId:'old-repeat', title:'Old Drama Repeat', topic:'Drama Doc', score:99, newTitle:false,
    programmer:{rating:''}, season:{holidayOutOfSeason:false},
    drama:{isDramaDoc:true,currentCycle:false,olderCycle:true,basis:'series-season'}
  };

  assert.equal(S.dramaDocRecommendationAllowed(newDrama),true);
  assert.equal(S.dramaDocRecommendationAllowed(currentRepeat),true);
  assert.equal(S.dramaDocRecommendationAllowed(explicitCurrentRepeat),true);
  assert.equal(S.dramaDocRecommendationAllowed(rightsOnlyRepeat),false);
  assert.equal(S.dramaDocRecommendationAllowed(olderRepeat),false);

  const normalNewA = {
    programId:'new-a', title:'New A', topic:'Music', score:78, newTitle:true, reviewedNew:true,
    programmer:{rating:'promising'}, season:{holidayOutOfSeason:false}, drama:{isDramaDoc:false}
  };
  const normalNewB = {
    programId:'new-b', title:'New B', topic:'Music', score:76, newTitle:true, reviewedNew:true,
    programmer:{rating:'promising'}, season:{holidayOutOfSeason:false}, drama:{isDramaDoc:false}
  };
  const selected=S.selectRecommendationsForSlot([olderRepeat,rightsOnlyRepeat,currentRepeat,normalNewA,normalNewB],4);
  assert.ok(selected.some((item)=>item.programId==='current-repeat'));
  assert.ok(!selected.some((item)=>item.programId==='old-repeat'));
  assert.ok(!selected.some((item)=>item.programId==='rights-only'));
});

test('rights-start timing alone leaves Drama Doc cycle unknown while explicit current outranks explicit older', () => {
  const unknownRecent = baseProgram({ id: 'unknown', title: 'Recent Rights Only Drama Doc', topic_primary: 'Drama Doc', rights_start: '2026-09-01' });
  const oldDoc = baseProgram({ id: 'old', title: 'Old Drama Doc', topic_primary: 'Drama Doc', rights_start: '2026-09-01', drama_cycle_status:'older' });
  const currentDoc = baseProgram({ id: 'current', title: 'Current Drama Doc', topic_primary: 'Drama Doc', rights_start: '2024-01-01', drama_cycle_status:'current' });
  const slot = S.planningWindows(schedule).find((entry) => entry.label === 'Prime');
  const context = { schedule, evidenceRows: [], overrideByProgramId: new Map(), baselineRate: null };
  const unknownScore = S.scoreProgramForSlot(unknownRecent, slot, context);
  const oldScore = S.scoreProgramForSlot(oldDoc, slot, context);
  const currentScore = S.scoreProgramForSlot(currentDoc, slot, context);
  assert.equal(unknownScore.drama.currentCycle, false);
  assert.equal(unknownScore.drama.olderCycle, false);
  assert.equal(unknownScore.drama.cycleUnknown, true);
  assert.equal(unknownScore.drama.basis, 'rights-start-only');
  assert.equal(unknownScore.drama.recentRightsStart, true);
  assert.equal(oldScore.drama.olderCycle, true);
  assert.equal(currentScore.drama.currentCycle, true);
  assert.ok(currentScore.score > oldScore.score);
});

test('avoid list excludes fixed schedule, Drama Doc, recurring protected examples, and above-baseline titles', () => {
  const programs = [
    baseProgram({ id:'news', title:'PBS Newshour', topic_primary:'News' }),
    baseProgram({ id:'drama', title:'Drama Special', topic_primary:'Drama Doc' }),
    baseProgram({ id:'mood', title:'Michigan Out of Doors', topic_primary:'Michigan' }),
    baseProgram({ id:'hsb', title:'High School Bowl', topic_primary:'WNMU' }),
    baseProgram({ id:'fixed-generic', title:'Weekly Fixed Show', topic_primary:'Music' }),
    baseProgram({ id:'welk', title:'Lawrence Welk: Strong Special', topic_primary:'Music' }),
    baseProgram({ id:'weak', title:'Weak Discretionary Special', topic_primary:'Music' })
  ];
  const rows = [];
  for (let i = 0; i < 8; i += 1) {
    const day = String(1 + i).padStart(2,'0');
    rows.push(
      row({ programId:'news', title:'PBS Newshour', topic:'News', dateKey:`2025-12-${day}`, fundraiserId:`dec25-${i}`, dollars:0 }),
      row({ programId:'drama', title:'Drama Special', topic:'Drama Doc', dateKey:`2025-12-${day}`, fundraiserId:`dec25-${i}`, dollars:0 }),
      row({ programId:'mood', title:'Michigan Out of Doors', topic:'Michigan', dateKey:`2025-12-${day}`, fundraiserId:`dec25-${i}`, dollars:0 }),
      row({ programId:'hsb', title:'High School Bowl', topic:'WNMU', dateKey:`2025-12-${day}`, fundraiserId:`dec25-${i}`, dollars:0 }),
      row({ programId:'fixed-generic', title:'Weekly Fixed Show', topic:'Music', dateKey:`2025-12-${day}`, fundraiserId:`dec25-${i}`, dollars:0 }),
      row({ programId:'welk', title:'Lawrence Welk: Strong Special', topic:'Music', dateKey:`2025-12-${day}`, fundraiserId:`dec25-${i}`, dollars:1000 }),
      row({ programId:'weak', title:'Weak Discretionary Special', topic:'Music', dateKey:`2025-12-${day}`, fundraiserId:`dec25-${i}`, dollars:0 })
    );
  }
  const strategy = S.buildStrategy({ schedule, library: programs, evidenceRows: rows, fixedScheduleProgramIds:['fixed-generic'], fixedScheduleTitles:['Weekly Fixed Show'], now:new Date('2026-09-28T12:00:00Z') });
  const titles = new Set(strategy.avoid.map(item=>item.title));
  assert.ok(titles.has('Weak Discretionary Special'));
  assert.ok(!titles.has('PBS Newshour'));
  assert.ok(!titles.has('Drama Special'));
  assert.ok(!titles.has('Michigan Out of Doors'));
  assert.ok(!titles.has('High School Bowl'));
  assert.ok(!titles.has('Weekly Fixed Show'));
  assert.ok(!titles.has('Lawrence Welk: Strong Special'));
});

test('avoid report labels the section as discretionary and explains exclusions', () => {
  const reportUi = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
  assert.match(reportUi, /Discretionary titles to avoid \/ rest/);
  assert.match(reportUi, /Fixed-schedule programs, Drama Docs/);
  assert.match(reportUi, /at or above WNMU's relevant pledge baseline/);
});

test('new-title confidence requires repeatable fundraiser evidence, not just multiple airings', () => {
  const fresh = baseProgram({ id:'fresh-doc', title:'Fresh Documentary', topic_primary:'Documentary' });
  const slot = S.planningWindows(schedule).find((entry) => entry.weekday === 'Saturday' && entry.label === 'Prime');

  const thinEvidence = [
    row({ programId:'other-a', title:'Other Documentary A', topic:'Documentary', dateKey:'2025-12-06', startMinutes:19*60, dollars:300, fundraiserId:'dec25' }),
    row({ programId:'other-b', title:'Other Documentary B', topic:'Documentary', dateKey:'2025-12-06', startMinutes:20*60, dollars:320, fundraiserId:'dec25' })
  ];
  const thin = S.scoreProgramForSlot(fresh, slot, {
    schedule,
    evidenceRows: thinEvidence,
    overrideByProgramId:new Map(),
    baselineRate:250
  });
  assert.equal(thin.newTitle, true);
  assert.equal(thin.topicHistory.rates.length, 2);
  assert.equal(thin.topicHistory.fundraisers, 1);
  assert.equal(thin.confidence, 'Low');
  assert.equal(thin.fit, 'Exploratory new title');
  assert.ok(thin.cautions.some((item) => /fresh-title test, not a proven pattern/i.test(item)));

  const repeatableEvidence = [
    row({ programId:'other-a', title:'Other Documentary A', topic:'Documentary', dateKey:'2025-12-06', startMinutes:19*60, dollars:300, fundraiserId:'dec25' }),
    row({ programId:'other-b', title:'Other Documentary B', topic:'Documentary', dateKey:'2024-12-07', startMinutes:19*60, dollars:320, fundraiserId:'dec24' }),
    row({ programId:'other-c', title:'Other Documentary C', topic:'Documentary', dateKey:'2023-12-02', startMinutes:19*60, dollars:340, fundraiserId:'dec23' })
  ];
  const repeatable = S.scoreProgramForSlot(fresh, slot, {
    schedule,
    evidenceRows: repeatableEvidence,
    overrideByProgramId:new Map(),
    baselineRate:250
  });
  assert.equal(repeatable.topicHistory.fundraisers, 3);
  assert.equal(repeatable.confidence, 'Medium');
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

test('stale single-airing success is capped while multiple proven successes keep full rested value', () => {
  const slot = S.planningWindows(schedule).find((entry) => entry.label === 'Prime');
  const single = baseProgram({ id:'stale-single', title:'Stale Single Winner', topic_primary:'Music' });
  const proven = baseProgram({ id:'proven-old', title:'Proven Old Winner', topic_primary:'Music' });

  const singleHistory = [
    row({ programId:'stale-single', title:'Stale Single Winner', dateKey:'2020-03-08', minutes:90, dollars:1200, fundraiserId:'mar20' })
  ];
  const provenHistory = [
    row({ programId:'proven-old', title:'Proven Old Winner', dateKey:'2020-03-08', minutes:90, dollars:1200, fundraiserId:'mar20' }),
    row({ programId:'proven-old', title:'Proven Old Winner', dateKey:'2021-03-06', minutes:90, dollars:1200, fundraiserId:'mar21' })
  ];

  const stale = S.scoreProgramForSlot(single, slot, {
    schedule,
    evidenceRows: singleHistory,
    overrideByProgramId:new Map(),
    baselineRate:300
  });
  const multi = S.scoreProgramForSlot(proven, slot, {
    schedule,
    evidenceRows: provenHistory,
    overrideByProgramId:new Map(),
    baselineRate:300
  });

  const adjustment = (result, name) => result.adjustments.find(([key]) => key === name)?.[1];
  assert.equal(adjustment(stale, 'titleHistory'), 4, 'one success older than two years should not keep the full high-rate title boost');
  assert.equal(adjustment(stale, 'rest'), 2, 'a long rest should be modest when it rests on only one ancient result');
  assert.ok(stale.cautions.some((item) => /stale single-airing evidence is capped/i.test(item)));

  assert.equal(adjustment(multi, 'titleHistory'), 12, 'multiple proven successes should retain the full historical rate signal');
  assert.equal(adjustment(multi, 'rest'), 8, 'multiple proven successes can still benefit from a long rest');
  assert.ok(multi.score > stale.score);
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

test('web-only selector favors rested repeats and protects stronger staffed-slot opportunities', () => {
  const make = (id, score, newTitle, latest = null) => ({
    programId:id,
    title:id,
    topic:'Music',
    score,
    newTitle,
    reviewedNew:false,
    programmer:{rating:''},
    season:{holidayOutOfSeason:false},
    titleHistory:{rows:newTitle?0:3, latest}
  });
  const ranked = [
    make('protected-prime',82,false,'2025-01-01'),
    make('rested-repeat',66,false,'2025-02-01'),
    make('recent-repeat',63,false,'2026-10-01'),
    make('exploratory-new',58,true,null)
  ];
  const staffedBest = new Map([
    ['protected-prime',{score:86}],
    ['rested-repeat',{score:58}],
    ['recent-repeat',{score:55}],
    ['exploratory-new',{score:52}]
  ]);
  const selected = S.selectWebOnlyRecommendationsForSlot(ranked, staffedBest, {date:'2026-12-05'}, 4);
  assert.equal(selected[0].programId,'rested-repeat');
  assert.match(selected[0].webOnlyReason,/Rested repeat/i);
  assert.ok(selected.findIndex((item)=>item.programId==='protected-prime') > selected.findIndex((item)=>item.programId==='exploratory-new'));
  assert.equal(selected.find((item)=>item.programId==='protected-prime').webOnlyReason,'Also has a stronger staffed-slot opportunity');
});

test('unrated new-title score clusters are labeled as equivalent until programmer review', () => {
  const make = (id, score, topic, rating = '') => ({
    programId:id,
    title:id,
    topic,
    score,
    newTitle:true,
    reviewedNew:false,
    programmer:{rating},
    season:{holidayOutOfSeason:false},
    cautions:[]
  });
  const ranked = [
    make('music-a',67,'Music'),
    make('music-b',67,'Music'),
    make('music-c',67,'Music'),
    make('music-d',66,'Music'),
    make('doc-a',67,'Documentary')
  ];
  const selected = S.selectRecommendationsForSlot(ranked, 3);
  const tied = selected.find((item) => item.programId === 'music-a');
  assert.ok(tied);
  assert.equal(tied.newTitleTieCount,3);
  assert.deepEqual(Array.from(tied.newTitleTieExamples),['music-a','music-b','music-c']);
  assert.ok(tied.cautions.some((item) => /3 unrated new Music titles share this score/i.test(item)));
  const doc = selected.find((item) => item.programId === 'doc-a');
  if (doc) assert.equal(doc.newTitleTieCount,undefined);
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

test('Report 5 keeps all library topics while separating current eligibility', () => {
  const library = [
    baseProgram({ id: 'music', title: 'Music', topic_primary: 'Music' }),
    baseProgram({ id: 'history-expired', title: 'History', topic_primary: 'History', rights_end: '2026-01-01' })
  ];
  const rows = S.topicComparison(library, S.planningWindows(schedule), { schedule, evidenceRows: [] });
  assert.ok(rows.some((item) => item.topic === 'Music'));
  assert.ok(rows.some((item) => item.topic === 'History'));
  assert.equal(rows.find((item) => item.topic === 'Music').eligibleProgramCount, 1);
  assert.equal(rows.find((item) => item.topic === 'History').eligibleProgramCount, 0);
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
    baseProgram({ id: 'loukinen', title: 'Loukinen', topic_primary: 'Loukinen' }),
    baseProgram({ id: 'bio', title: 'Biography', topic_primary: 'Biography' })
  ];
  const seasonRows = [
    row({ programId: 'xmas', title: 'Christmas', topic: 'Holiday - Christmas', dateKey: '2025-12-06', dollars: 123, fundraiserId: 'xmas-dec' }),
    row({ programId: 'loukinen', title: 'Loukinen', topic: 'Loukinen', dateKey: '2025-12-07', dollars: 241, fundraiserId: 'loukinen-dec' }),
    row({ programId: 'bio', title: 'Biography', topic: 'Biography', dateKey: '2025-12-08', dollars: 460, fundraiserId: 'bio-dec' })
  ];
  const performanceStats = {
    topic: new Map([
      ['holiday christmas', { averageRate: 123, testedTitleCount: 8, fundraiserSamples: 6, historyRows: 18 }],
      ['loukinen', { averageRate: 241, testedTitleCount: 5, fundraiserSamples: 4, historyRows: 9 }],
      ['biography', { averageRate: 460, testedTitleCount: 2, fundraiserSamples: 3, historyRows: 3 }]
    ]),
    topicReliability: new Map([
      ['holiday christmas', { testedTitleCount: 9, fundraiserSamples: 8 }],
      ['loukinen', { testedTitleCount: 9, fundraiserSamples: 15 }],
      ['biography', { testedTitleCount: 14, fundraiserSamples: 19 }]
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
  assert.ok(
    rows.findIndex((item) => item.topic === 'Biography') > rows.findIndex((item) => item.topic === 'Loukinen'),
    'a high seasonal average backed by only a couple of seasonal titles should retain a seasonal-support penalty'
  );
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
  assert.match(reportUi, /Fundraiser day & topic takeaways/);
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

  assert.match(reportUi, /new Worker\('assets\/js\/programming-strategy-worker\.js\?v=0\.22\.249'\)/);
  assert.match(reportUi, /Scoring eligible titles against WNMU history|Starting strategy analysis/);
  assert.doesNotMatch(reportUi, /\.lte\('air_date',cutoff\)/);
  assert.match(reportUi, /const airingSelect=\[/);
  assert.doesNotMatch(reportUi, /canonicalizeImportedAirings/);
  assert.doesNotMatch(reportUi, /WNMUOneSheetAnalysis/);
  assert.doesNotMatch(reportUi, /WNMUProgrammingStrategyAnalysis/);

  assert.match(workerUi, /importScripts\('one-sheet-analysis\.js\?v=0\.22\.186', 'programming-strategy-analysis\.js\?v=0\.22\.249', 'programming-strategy-backtest\.js\?v=0\.22\.249'\)/);
  assert.match(workerUi, /A\.canonicalizeImportedAirings/);
  assert.match(workerUi, /A\.analyzeSchedule/);
  assert.match(workerUi, /buildDayOutlook/);
  assert.match(workerUi, /peerEvidenceForWindow/);
  assert.match(workerUi, /peerObservations/);

  assert.match(page, /<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>/);
  assert.match(page, /version\.json\?_=/);
  assert.match(page, /cache:'no-store'/);
  assert.match(page, /searchParams\.get\('v'\)/);
  assert.match(page, /window\.location\.replace/);
  assert.match(page, /programming-strategy-report\.js\?v=0\.22\.250/);
  assert.doesNotMatch(page, /one-sheet-analysis\.js/);
  assert.doesNotMatch(page, /<script defer src="assets\/js\/programming-strategy-analysis\.js/);
});

test('strategy report carries scheduler Fundraising Windows through the worker and renders partial-use plans', () => {
  const reportUi=fs.readFileSync(new URL('../assets/js/programming-strategy-report.js',import.meta.url),'utf8');
  const workerUi=fs.readFileSync(new URL('../assets/js/programming-strategy-worker.js',import.meta.url),'utf8');
  assert.match(reportUi,/schedulePayload\(row\)/);
  assert.match(reportUi,/fundraisingWindows:Array\.isArray\(saved\.fundraisingWindows\)/);
  assert.match(reportUi,/slot\.lineup/);
  assert.match(reportUi,/minutes recommended/);
  assert.match(reportUi,/Leave .* minutes regular \/ unfilled/);
  assert.match(reportUi,/No title clears this window/);
  assert.match(workerUi,/recommendedMinutes: slot\.recommendedMinutes/);
  assert.match(workerUi,/unusedMinutes: slot\.unusedMinutes/);
  assert.match(workerUi,/lineup: \(slot\.lineup \|\| \[\]\)/);
});

test('topic cards show every topic with optional expandable subtopics', () => {
  const reportUi = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../assets/programming-strategy-report.css', import.meta.url), 'utf8');
  assert.match(reportUi, /strategy-topic-card-grid/);
  assert.match(reportUi, /strategy-topic-subtopics/);
  assert.match(reportUi, /Show subtopics/);
  assert.match(reportUi, /All Program Library topics are shown/);
  assert.match(styles, /\.strategy-topic-card-grid/);
  assert.match(styles, /\.strategy-topic-subtopics/);
});

test('Report 5 presentation keeps the concise style while restoring analytical depth', () => {
  const reportUi = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
  assert.doesNotMatch(reportUi, /median about|median Broadcast|Established/);
  assert.doesNotMatch(reportUi, /strategy-summary/);
  assert.doesNotMatch(reportUi, /sheet-stamp\">Evidence through/);
  assert.match(reportUi, /Topic performance/);
  assert.match(reportUi, /Show subtopics/);
  assert.match(reportUi, /Time-of-day comparisons/);
  assert.match(reportUi, /Half-hour program-start buckets/);
  assert.match(reportUi, /Peer practices worth testing/);
  assert.match(reportUi, /pledge_peer_evidence_observations/);
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
  assert.ok(Array.isArray(result.topicTimeMatrix.rows));
  assert.ok(result.hourlyPatterns.rows.some((item) => item.weekday === 'Saturday' && item.startMinutes === 19 * 60));
  const saturdaySeven = result.hourlyPatterns.rows.find((item) => item.weekday === 'Saturday' && item.startMinutes === 19 * 60);
  assert.ok(Array.isArray(saturdaySeven.targetSeason.topTopics));
  assert.equal(saturdaySeven.targetSeason.topTopics[0].topic, 'Music');
  assert.ok(result.hourlyPatterns.rows.some((item) => item.weekday === 'Saturday' && item.startMinutes === 6 * 60), 'all-day timing analysis should begin at 6 AM');
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
  assert.equal(Math.round(saturdaySeven.targetSeason.averageRate), 133);
  assert.equal(Math.round(saturdaySeven.allHistory.averageRate), 133);
  const saturdayEight = result.hourlyPatterns.rows.find((item) => item.weekday === 'Saturday' && item.startMinutes === 20 * 60);
  assert.equal(saturdayEight.targetSeason.fundraiserSamples, 0, 'unmatched imported dollars must not become start-time performance evidence');
  assert.equal(saturdayEight.allHistory.fundraiserSamples, 0, 'unmatched imported dollars must not become all-history start-time evidence');
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
      peerObservations: [
        {
          station_code: 'PBSUTAH',
          station_name: 'PBS Utah',
          season: 'March',
          evidence_scope: 'title',
          day_of_week: 'Saturday',
          daypart: 'Afternoon',
          assessment_signal: 2,
          evidence_strength: 5,
          summary: 'A Saturday-afternoon Peter, Paul and Mary airing doubled its goal.'
        },
        {
          station_code: 'PBSUTAH',
          station_name: 'PBS Utah',
          season: 'December',
          evidence_scope: 'title',
          day_of_week: 'Saturday',
          daypart: 'Afternoon',
          assessment_signal: 2,
          evidence_strength: 4,
          summary: 'A Saturday-afternoon food program also doubled its goal.'
        },
        {
          station_code: 'ARPBS',
          station_name: 'Arkansas PBS',
          season: 'March',
          evidence_scope: 'timeslot',
          day_of_week: 'Saturday',
          start_time_minutes: 12 * 60,
          end_time_minutes: 22 * 60 + 30,
          assessment_signal: 1,
          evidence_strength: 4,
          summary: 'Steady Saturday pledge results were reported from noon through 10:30 PM.'
        }
      ],
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
  assert.ok(saturday[0].evidenceItems.some((item) => item.sourceLabel === 'WNMU history'));
  assert.ok(saturday[0].evidenceItems.some((item) => item.sourceLabel === 'PBS Utah' && /doubled its goal/i.test(item.text)));
  assert.equal(saturday[0].evidenceItems.filter((item) => item.sourceLabel === 'PBS Utah').length, 1, 'one station should contribute at most one displayed evidence item');
  assert.ok(saturday[0].evidenceItems.some((item) => item.sourceLabel === 'Arkansas PBS'));
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


test('early-evening planning boundary explains that 5 PM is not an evidence-selected exact start', () => {
  const { workerContext, workerMessages } = makeWorkerHarness();
  workerContext.onmessage({
    data: {
      requestId: 195,
      schedule,
      library: [baseProgram({ id: 1, title: 'Test Music', topic_primary: 'Music', nola_code: 'TMUS' })],
      airings: [],
      scheduleRows: [],
      overrides: [],
      peerObservations: [
        {
          station_code: 'PEERA', station_name: 'Peer A', season: 'December',
          day_of_week: 'Sunday', start_time_minutes: 960, end_time_minutes: 1020,
          program_title_raw: 'Four PM Test', assessment_signal: 1, evidence_strength: 4,
          actual_dollars: 420, pledge_count: 2, summary: 'Sunday 4 PM produced an encouraging result.'
        },
        {
          station_code: 'PEERB', station_name: 'Peer B', season: 'December',
          day_of_week: 'Sunday', start_time_minutes: 1020, end_time_minutes: 1080,
          program_title_raw: 'Five PM Test', assessment_signal: -1, evidence_strength: 5,
          summary: 'Station said 5 PM was too early for this drive.'
        },
        {
          station_code: 'PEERC', station_name: 'Peer C', season: 'December',
          day_of_week: 'Sunday', start_time_minutes: 1050, end_time_minutes: 1110,
          program_title_raw: 'Five Thirty Test', assessment_signal: 2, evidence_strength: 5,
          actual_dollars: 3200, pledge_count: 23, summary: 'Sunday 5:30 PM was a strong result.'
        }
      ],
      now: '2026-09-24T12:00:00Z'
    }
  });

  const result = workerMessages.find((message) => message.type === 'result');
  assert.ok(result);
  const sundayEarly = result.strategy.windows.find((slot) =>
    slot.weekday === 'Sunday' && slot.label === 'Early evening' && slot.startMinutes === 17 * 60
  );
  assert.ok(sundayEarly);
  assert.match(sundayEarly.timingEvidence.boundaryNote, /5:00 PM is the model boundary/i);
  assert.match(sundayEarly.timingEvidence.boundaryNote, /not an evidence-selected exact start time/i);
  assert.match(sundayEarly.timingEvidence.boundaryNote, /4:00 or 5:30/i);
  assert.deepEqual(
    Array.from(sundayEarly.timingEvidence.nearbyPeers, (item) => item.startMinutes),
    [960, 1020, 1050]
  );
  assert.ok(sundayEarly.timingEvidence.peerEvidence.some((item) => /5:30 PM was a strong result/i.test(item.text)));
  assert.ok(sundayEarly.timingEvidence.peerEvidence.some((item) => /5 PM was too early/i.test(item.text)));
});

test('worker surfaces positive peer fundraising practices separately from title scheduling', () => {
  const { workerContext, workerMessages } = makeWorkerHarness();
  workerContext.onmessage({
    data: {
      requestId: 196,
      schedule,
      library: [baseProgram({ id: 1, title: 'Test Music', topic_primary: 'Music', nola_code: 'TMUS' })],
      airings: [],
      scheduleRows: [],
      overrides: [],
      peerObservations: [
        {
          station_code: 'MATCH', station_name: 'Match PBS', season: 'December',
          evidence_scope: 'strategy', assessment_signal: 2, evidence_strength: 5,
          context_flags: { challenge_grant: true, live: true },
          actual_dollars: 6000, goal_dollars: 2000,
          summary: 'A live challenge-grant night tripled its goal.'
        },
        {
          station_code: 'TICKET', station_name: 'Ticket PBS', season: 'December',
          evidence_scope: 'strategy', assessment_signal: 2, evidence_strength: 5,
          context_flags: { tickets: true },
          summary: 'Ticket-linked programs accounted for a large share of drive revenue.'
        },
        {
          station_code: 'MORNING', station_name: 'Morning PBS', season: 'December',
          evidence_scope: 'timeslot', assessment_signal: 2, evidence_strength: 4,
          day_of_week: 'Sunday', daypart: 'Morning', topic_primary: 'Drama',
          program_title_raw: 'Sunday Drama',
          summary: 'Sunday-morning Drama reaches a different audience and produces regular revenue.'
        }
      ],
      now: '2026-09-24T12:00:00Z'
    }
  });

  const result = workerMessages.find((message) => message.type === 'result');
  assert.ok(result);
  const labels = new Set((result.peerPractices || []).map((item) => item.label));
  assert.ok(labels.has('Challenge / matching grants'));
  assert.ok(labels.has('Ticket-linked fundraising'));
  assert.ok(labels.has('Sunday-morning pledge'));
  const sunday = result.peerPractices.find((item) => item.label === 'Sunday-morning pledge');
  assert.match(sunday.wnmuStatus, /peer-led test/i);
  assert.equal(sunday.topTopics[0].topic, 'Drama');
  assert.equal(sunday.examples[0].programTitle, 'Sunday Drama');
});


test('peer daypart evidence surfaces Sunday morning as an explicit WNMU test gap', () => {
  const { workerContext, workerMessages } = makeWorkerHarness();
  workerContext.onmessage({
    data: {
      requestId: 197,
      schedule,
      library: [baseProgram({ id: 1, title: 'How-To Test', topic_primary: 'How-to', nola_code: 'HOWT' })],
      airings: [],
      scheduleRows: [],
      overrides: [],
      peerObservations: [
        {
          station_code: 'SOPT', station_name: 'Southern Oregon Public Television',
          day_of_week: 'Sunday', daypart: 'Morning', start_time_minutes: null,
          topic_primary: 'How-to', assessment_signal: 2, evidence_strength: 4,
          summary: 'Long-running Sunday-morning pledge reaches a different audience.'
        },
        {
          station_code: 'KIXE', station_name: 'KIXE Redding',
          day_of_week: 'Sunday', daypart: 'Morning', start_time_minutes: null,
          topic_primary: 'How-to', assessment_signal: 2, evidence_strength: 3,
          summary: 'Another station reports a long-running Sunday-morning pledge practice.'
        }
      ],
      now: '2026-09-28T12:00:00Z'
    }
  });

  const result = workerMessages.find((message) => message.type === 'result');
  assert.ok(result);
  const sundayMorning = result.opportunities.rows.find((item) =>
    item.weekday === 'Sunday' && item.startMinutes === 6 * 60 && item.endMinutes === 12 * 60
  );
  assert.ok(sundayMorning, JSON.stringify(result.opportunities.rows));
  assert.equal(sundayMorning.kind, 'peer-gap');
  assert.equal(sundayMorning.positivePeerStations, 2);
  assert.match(sundayMorning.rationale, /no rate-valid pledge-program history/i);
  assert.match(sundayMorning.rationale, /reason to test, not a WNMU performance claim/i);

  const matrix = result.topicTimeMatrix.rows.find((item) =>
    item.weekday === 'Sunday' && item.daypart === 'Morning'
  );
  assert.ok(matrix);
  assert.equal(matrix.evidenceState, 'Peer-led test');
  assert.equal(matrix.peer.positiveStations, 2);
  assert.ok(matrix.peer.topTopics.some((item) => item.topic === 'How-to'));
});

test('Sunday-morning peer practice retains a real Drama signal even outside the generic top four topics', () => {
  const { workerContext } = makeWorkerHarness();
  assert.equal(typeof workerContext.buildPeerPracticeGaps, 'function');
  const topics=['How-to','Music','Travel','Health','Drama'];
  const observations=topics.map((topic,index)=>({
    station_code:'S'+index,
    station_name:'Station '+index,
    day_of_week:'Sunday',
    daypart:'Morning',
    topic_primary:topic,
    assessment_signal:2,
    evidence_strength:4,
    summary:topic+' Sunday morning example'
  }));
  const rows=workerContext.buildPeerPracticeGaps({},observations,[]);
  const sunday=rows.find((item)=>item.id==='sunday-morning');
  assert.ok(sunday);
  assert.ok(sunday.topTopics.some((item)=>item.topic==='Drama'),JSON.stringify(sunday.topTopics));
});

test('Sunday-morning peer practice attaches dated normal-slot context without changing peer evidence strength', () => {
  const { workerContext } = makeWorkerHarness();
  const observations=[{
    station_code:'SOPT',
    station_name:'Southern Oregon Public Television',
    day_of_week:'Sunday',
    daypart:'Morning',
    topic_primary:'How-to',
    assessment_signal:2,
    evidence_strength:4,
    summary:'Sunday-morning pledge reached a different audience.'
  }];
  const contexts=[
    {
      id:1,
      station_code:'SOPT',
      station_name:'Southern Oregon Public Television',
      context_period_start:'2019-01-01',
      context_period_end:'2019-01-31',
      day_of_week:'Sunday',
      start_time_minutes:540,
      end_time_minutes:720,
      schedule_label:'Special Presentation',
      schedule_pattern:'recurring_special_presentation_block',
      representative_programs:[{date:'2019-01-20',start_time:'10:00',title:"Suze Orman's Financial Solutions for You"}],
      source_kind:'public_program_guide',
      source_reference:'https://example.test/january-guide.pdf',
      source_summary:'Sunday 9 AM-noon was reserved as Special Presentation.',
      evidence_strength:5,
      notes:'Historical context only.'
    },
    {
      id:2,
      station_code:'OTHER',
      station_name:'Other station',
      context_period_start:'2019-01-01',
      context_period_end:'2019-01-31',
      day_of_week:'Sunday',
      start_time_minutes:540,
      end_time_minutes:720,
      schedule_label:'Unrelated',
      evidence_strength:5
    }
  ];
  const rows=workerContext.buildPeerPracticeGaps({},observations,[],contexts);
  const sunday=rows.find((item)=>item.id==='sunday-morning');
  assert.ok(sunday);
  assert.equal(sunday.stationCount,1);
  assert.equal(sunday.contextStationCount,1);
  assert.equal(sunday.contextCoverage,1);
  assert.equal(sunday.examples[0].evidenceStrength,4,'schedule context must not inflate the pledge evidence strength');
  assert.equal(sunday.examples[0].scheduleContexts.length,1);
  assert.equal(sunday.examples[0].scheduleContexts[0].scheduleLabel,'Special Presentation');
  assert.match(sunday.examples[0].scheduleContexts[0].sourceSummary,/reserved as Special Presentation/);
});

test('strategy report restores topic, timing, peer, promotion, and ranked opportunity depth', () => {
  const reportUi = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../assets/programming-strategy-report.css', import.meta.url), 'utf8');
  const calendar = fs.readFileSync(new URL('../assets/js/programming-strategy-calendar.js', import.meta.url), 'utf8');

  assert.doesNotThrow(() => new vm.Script(calendar, { filename:'programming-strategy-calendar.js' }));
  assert.match(reportUi,/function briefSection/);
  assert.match(reportUi,/<h2>Brief<\/h2>/);
  assert.match(reportUi,/<h3>Ideas & tests<\/h3>/);
  assert.match(reportUi,/const webOnlyWindows=planWindows\.filter\(slot=>slot\.webOnlyExperimental&&!slot\.blocked\)/);
  assert.match(reportUi,/5–7 PM Web-only pledge test/);
  assert.match(reportUi,/active experiments already placed in this Fundraiser Plan/);
  assert.doesNotMatch(reportUi,/<h3>Promotion<\/h3>/);
  assert.match(reportUi,/function promotionExamplesSection/);
  assert.match(reportUi,/Fundraiser promotion ideas worth discussing/);
  assert.doesNotMatch(reportUi,/Fundraiser promotion ideas already worth discussing/);
  assert.match(reportUi,/strategy-section-card strategy-promotion-card/);

  assert.match(reportUi,/function fundraiserPlanSection/);
  assert.match(reportUi,/<h2>Fundraiser plan<\/h2>/);
  assert.match(reportUi,/topicSignals\.slice\(0,5\)/);
  assert.match(reportUi,/function topicSignalStrength/);
  assert.match(reportUi,/ratio>=1\.15/);
  assert.match(reportUi,/Strong pocket/);
  assert.match(reportUi,/Relative leader/);
  assert.match(reportUi,/not automatic recommendations/);
  assert.match(reportUi,/strategy-plan-window/);
  assert.match(reportUi,/WEB-ONLY EXPERIMENT/);
  assert.match(reportUi,/Break mode is recorded on each scheduled program for later comparison/);

  assert.match(reportUi,/function topicComparisonSection/);
  assert.match(reportUi,/strategy-topic-card-grid/);
  assert.match(reportUi,/function timeOfDayComparisonSection/);
  assert.match(reportUi,/strategy-time-day-grid/);
  assert.match(reportUi,/function peerPracticesCompactSection/);
  assert.match(reportUi,/Observed peer topics/);
  assert.match(reportUi,/pledge_peer_schedule_context/);
  assert.match(reportUi,/Normal-slot context/);
  assert.match(reportUi,/context is explanatory only/i);
  assert.match(reportUi,/peerScheduleContexts:state\.peerScheduleContexts/);

  assert.match(reportUi,/function programOpportunitiesSection/);
  assert.match(reportUi,/<h2>Program opportunities<\/h2>/);
  assert.match(reportUi,/\.slice\(0,20\)/);
  assert.match(reportUi,/strategy-opportunity-body/);
  assert.match(reportUi,/row\.badges\.push\('Recommended'\)/);
  assert.match(reportUi,/if\(item\.newTitle\)row\.badges\.push\('New'\)/);
  assert.match(reportUi,/Current cycle/);
  assert.match(reportUi,/const recommended=row\.badges\.includes\('Recommended'\)/);
  assert.match(reportUi,/return recommended&&\(row\.newTitle\|\|row\.drama\?\.currentCycle===true\)/);
  assert.match(reportUi,/row\.badges\.push\('Repeat'\)/);
  assert.match(reportUi,/row\.badges\.push\('Seasonal'\)/);
  assert.match(reportUi,/row\.badges\.push\('Local \/ U\.P\.'\)/);

  const renderStart=reportUi.indexOf('out.innerHTML=`<article');
  const renderEnd=reportUi.indexOf('globalThis.WNMUStrategyEnhancements',renderStart);
  const render=reportUi.slice(renderStart,renderEnd);
  const needles=[
    '${briefSection(result,opportunities,schedule)}',
    '${promotionExamplesSection()}',
    '${fundraiserPlanSection(strategy,dayOutlook,result.topicTimeMatrix,hourlyPatterns,schedule)}',
    '${topicComparisonSection(strategy)}',
    '${timeOfDayComparisonSection(hourlyPatterns)}',
    '${peerPracticesCompactSection(result.peerPractices||[])}',
    '${programOpportunitiesSection(strategy)}'
  ];
  const positions=needles.map((needle)=>render.indexOf(needle));
  assert.ok(positions.every((position)=>position>=0));
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions);

  assert.match(styles,/\.strategy-brief-card/);
  assert.match(styles,/\.strategy-promotion-examples/);
  assert.match(styles,/\.strategy-topic-card-grid/);
  assert.match(styles,/\.strategy-time-day-grid/);
  assert.match(styles,/\.strategy-program-opportunity-list/);
  assert.match(styles,/\.strategy-opportunity-badges span[\s\S]*?justify-content:center/);
  assert.match(styles,/four-column time cards: stack topic text under time\/rate/);
  assert.match(calendar,/Hanukkah/);
  assert.match(calendar,/Big Ten Football Championship/);
  assert.match(calendar,/NMU vs\. Augustana hockey/);
  assert.match(calendar,/Buffalo Bills at Green Bay Packers/);
});

test('strategy enhancement layer only adds structural controls to the concise report', () => {
  const page = fs.readFileSync(new URL('../programming-strategy.html', import.meta.url), 'utf8');
  const reportUi = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
  const enhancements = fs.readFileSync(new URL('../assets/js/programming-strategy-enhancements.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../assets/programming-strategy-report.css', import.meta.url), 'utf8');

  assert.doesNotThrow(() => new vm.Script(enhancements, { filename: 'programming-strategy-enhancements.js' }));
  assert.match(page, /programming-strategy-enhancements\.js\?v=0\.22\.224/);
  assert.match(reportUi, /WNMUStrategyEnhancements\?\.decorate\?\.\(out,result\)/);
  assert.match(enhancements, /splitCompoundSections/);
  assert.match(enhancements, /enableCollapsibleSections/);
  const decorateBlock=enhancements.slice(enhancements.indexOf('function decorate(root, result)'),enhancements.indexOf('globalThis.WNMUStrategyEnhancements'));
  assert.doesNotMatch(decorateBlock,/insertPeerPractices/);
  assert.doesNotMatch(decorateBlock,/decorateDayMap/);
  assert.match(styles, /\.sheet-section\.is-collapsed/);
  assert.match(styles, /\.strategy-collapse-toggle/);
});

test('paired start-time reconciliation can show broad 8 PM strength while Monday favors 9 PM', () => {
  const { workerContext } = makeWorkerHarness();
  assert.equal(typeof workerContext.pairedStartTimeCheck, 'function');

  const rows = [
    // Fundraiser A: Monday 9 PM wins
    row({ fundraiserId:'a', dateKey:'2025-12-01', startMinutes:20*60, minutes:60, dollars:100 }),
    row({ fundraiserId:'a', dateKey:'2025-12-01', startMinutes:21*60, minutes:60, dollars:300 }),
    // Fundraiser B: Monday 9 PM wins
    row({ fundraiserId:'b', dateKey:'2024-12-02', startMinutes:20*60, minutes:60, dollars:100 }),
    row({ fundraiserId:'b', dateKey:'2024-12-02', startMinutes:21*60, minutes:60, dollars:250 }),
    // Three non-Monday fundraisers where 8 PM wins, making the broad result favor 8 PM
    row({ fundraiserId:'c', dateKey:'2025-12-02', startMinutes:20*60, minutes:60, dollars:400 }),
    row({ fundraiserId:'c', dateKey:'2025-12-02', startMinutes:21*60, minutes:60, dollars:100 }),
    row({ fundraiserId:'d', dateKey:'2025-12-03', startMinutes:20*60, minutes:60, dollars:500 }),
    row({ fundraiserId:'d', dateKey:'2025-12-03', startMinutes:21*60, minutes:60, dollars:100 }),
    row({ fundraiserId:'e', dateKey:'2025-12-04', startMinutes:20*60, minutes:60, dollars:450 }),
    row({ fundraiserId:'e', dateKey:'2025-12-04', startMinutes:21*60, minutes:60, dollars:100 })
  ];

  const overall = workerContext.pairedStartTimeCheck(rows,{hourA:20,hourB:21});
  const monday = workerContext.pairedStartTimeCheck(rows,{hourA:20,hourB:21,weekdayIndex:1,season:'December'});

  assert.equal(overall.hourAWins,3);
  assert.equal(overall.hourBWins,2);
  assert.ok(overall.medianDifference < 0);
  assert.equal(monday.hourAWins,0);
  assert.equal(monday.hourBWins,2);
  assert.ok(monday.medianDifference > 0);
});

test('strategy report no longer renders a separate 8 PM vs 9 PM cross-check', () => {
  const enhancements = fs.readFileSync(new URL('../assets/js/programming-strategy-enhancements.js', import.meta.url), 'utf8');
  assert.doesNotMatch(enhancements,/8:00 PM vs 9:00 PM cross-check/);
  assert.doesNotMatch(enhancements,/Paired-fundraiser comparison/);
  assert.doesNotMatch(enhancements,/startTimeReconciliationHtml/);
  assert.doesNotMatch(enhancements,/decorateHourlySection/);
});

test('compact time-of-day print hides weekday daytime but retains weekend rows', () => {
  const report = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../assets/programming-strategy-report.css', import.meta.url), 'utf8');
  assert.match(report,/\['Monday','Tuesday','Wednesday','Thursday','Friday'\]\.includes\(row\.weekday\)/);
  assert.match(report,/Number\(row\.startMinutes\)<17\*60/);
  assert.match(report,/row\.printHidden\?' strategy-hourly-print-hide':''/);
  assert.match(styles,/\.strategy-hourly-print-hide\{display:none!important\}/);
});

test('strategy print CSS starts each section on a new page and keeps dense four-column timing', () => {
  const styles = fs.readFileSync(new URL('../assets/programming-strategy-report.css', import.meta.url), 'utf8');
  assert.match(styles,/@page\{[\s\S]*?margin:0\.85in 0\.58in 0\.70in 0\.82in/);
  assert.match(styles,/\.strategy-sheet>section\.sheet-section\+section\.sheet-section[\s\S]*?page-break-before:always/);
  assert.match(styles,/\.strategy-time-day-grid\{[\s\S]*?grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles,/\.strategy-plan-signals\{gap:1px\}/);
  assert.match(styles,/\.strategy-day-calendar>span,[\s\S]*?background:#f8dfdf/);
  assert.match(styles,/break-inside:avoid-page/);
});

test('strategy keeps attached external and end pledge breaks as pledge-program performance', () => {
  const { workerContext } = makeWorkerHarness();
  assert.equal(typeof workerContext.strategyBoundaryBreakClassification, 'function');

  const cases = [
    {
      placement:{ dateKey:'2020-03-02', startMinutes:20*60, lengthMinutes:60, programTitle:'Antiques Roadshow', isNonPledge:false },
      airing:{ program_minutes:60, raw_payload:{}, imported_program_title:'ANTIQUES ROADSHOW' },
      label:'Monday Antiques Roadshow with an end pledge break'
    },
    {
      placement:{ dateKey:'2025-12-05', startMinutes:20*60, lengthMinutes:24, programTitle:'Washington Week In Review', isNonPledge:false },
      airing:{ program_minutes:30, raw_payload:{}, dollars:156, pledge_count:2 },
      label:'Friday Washington Week with a pledge break after the program'
    },
    {
      placement:{ dateKey:'2018-11-27', startMinutes:12*60, lengthMinutes:60, programTitle:'Regular Series', isNonPledge:false },
      airing:{ program_minutes:3, raw_payload:{break_count:' 1 '} },
      label:'short single attached pledge break'
    },
    {
      placement:{ dateKey:'2015-12-04', startMinutes:20*60, lengthMinutes:90, programTitle:'Simon & Garfunkel: The Concert in Central Park', isNonPledge:false },
      airing:{ program_minutes:90, raw_payload:{}, dollars:785, pledge_count:8 },
      label:'traditional pledge special'
    },
    {
      placement:{ dateKey:'2022-02-28', startMinutes:21*60, lengthMinutes:90, programTitle:'Safe Money in Tough Times', isNonPledge:false },
      airing:{ program_minutes:90, raw_payload:{}, dollars:0, pledge_count:0 },
      label:'pledge program that raised zero dollars'
    }
  ];

  cases.forEach(({placement,airing,label}) => {
    const classification = workerContext.strategyBoundaryBreakClassification(placement, airing);
    assert.equal(classification.exclude,false,label + ' must remain pledge-title evidence');
  });

  const explicitNonPledge = workerContext.strategyBoundaryBreakClassification({
    dateKey:'2025-12-05',
    startMinutes:20*60,
    lengthMinutes:60,
    programTitle:'Explicit Non-Pledge',
    isNonPledge:true
  }, null);
  assert.equal(explicitNonPledge.exclude,true);
  assert.match(explicitNonPledge.reason,/Explicitly marked non-pledge/i);
});

test('prepared strategy schedules do not convert attached pledge breaks to non-pledge', () => {
  const { workerContext } = makeWorkerHarness();
  const prepared = workerContext.prepareStrategySchedules([
    {
      id:'drive',
      title:'Drive',
      startDate:'2018-11-25',
      endDate:'2018-12-05',
      placements:[
        {
          id:'ar',
          dateKey:'2018-11-26',
          startMinutes:20*60,
          lengthMinutes:60,
          programTitle:'Antiques Roadshow',
          sourceAiringHash:'ar-hash',
          isNonPledge:false
        },
        {
          id:'pledge',
          dateKey:'2018-11-26',
          startMinutes:21*60,
          lengthMinutes:90,
          programTitle:'Pledge Special',
          sourceAiringHash:'pledge-hash',
          isNonPledge:false
        }
      ]
    }
  ],[
    {row_hash:'ar-hash',program_minutes:2,raw_payload:{break_count:' 1 '}},
    {row_hash:'pledge-hash',program_minutes:90,raw_payload:{break_count:' 4 '}}
  ]);

  assert.equal(prepared.excludedBoundaryBreaks,0);
  assert.equal(prepared.schedules[0].placements[0].isNonPledge,false);
  assert.equal(prepared.schedules[0].placements[0].strategyBoundaryBreakOnly,undefined);
  assert.equal(prepared.schedules[0].placements[1].isNonPledge,false);
});

test('collapsed strategy sections stay out of print instead of reopening', () => {
  const styles = fs.readFileSync(new URL('../assets/programming-strategy-report.css', import.meta.url), 'utf8');
  assert.match(styles,/\.strategy-sheet \.sheet-section\.is-collapsed\{\s*display:none!important;/);
});


test('Day/Time performance keeps 8:00 and 8:30 starts in separate half-hour buckets', () => {
  const { workerContext } = makeWorkerHarness();
  assert.equal(typeof workerContext.buildHourlyPatterns, 'function');

  const rows = [
    row({ fundraiserId:'a', dateKey:'2025-12-01', startMinutes:20*60, minutes:60, dollars:300 }),
    row({ fundraiserId:'a', dateKey:'2025-12-01', startMinutes:20*60+30, minutes:60, dollars:100 }),
    row({ fundraiserId:'b', dateKey:'2024-12-02', startMinutes:20*60, minutes:60, dollars:200 }),
    row({ fundraiserId:'b', dateKey:'2024-12-02', startMinutes:20*60+30, minutes:60, dollars:100 })
  ];

  const result = workerContext.buildHourlyPatterns(schedule, rows);
  assert.equal(result.bucketMinutes, 30);

  const mondayEight = result.rows.find((item) =>
    item.weekday === 'Monday' && item.startMinutes === 20*60
  );
  const mondayEightThirty = result.rows.find((item) =>
    item.weekday === 'Monday' && item.startMinutes === 20*60+30
  );

  assert.ok(mondayEight);
  assert.ok(mondayEightThirty);
  assert.equal(mondayEight.targetSeason.airings, 2);
  assert.equal(mondayEightThirty.targetSeason.airings, 2);
  assert.equal(mondayEight.targetSeason.averageRate, 250);
  assert.equal(mondayEightThirty.targetSeason.averageRate, 100);
  assert.equal(mondayEight.allHistory.airings, 2);
  assert.equal(mondayEightThirty.allHistory.airings, 2);
});

test('Day/Time performance keeps target-season evidence primary while carrying all-history context', () => {
  const { workerContext } = makeWorkerHarness();
  const rows = [
    row({ fundraiserId:'dec-a', dateKey:'2025-12-03', startMinutes:22*60, minutes:60, dollars:300 }),
    row({ fundraiserId:'mar-a', dateKey:'2025-03-05', startMinutes:22*60, minutes:60, dollars:500 })
  ];

  const result = workerContext.buildHourlyPatterns(schedule, rows);
  const wednesdayTen = result.rows.find((item) =>
    item.weekday === 'Wednesday' && item.startMinutes === 22*60
  );

  assert.ok(wednesdayTen);
  assert.equal(result.season,'December');
  assert.equal(wednesdayTen.targetSeason.airings,1);
  assert.equal(wednesdayTen.targetSeason.fundraiserSamples,1);
  assert.equal(wednesdayTen.allHistory.airings,2);
  assert.equal(wednesdayTen.allHistory.fundraiserSamples,2);
  assert.ok(result.historyStartDate);
  assert.ok(result.historyEndDate);
});

test('8:00 vs 9:00 paired comparison excludes 8:30 and 9:30 starts', () => {
  const { workerContext } = makeWorkerHarness();
  const rows = [
    row({ fundraiserId:'a', dateKey:'2025-12-01', startMinutes:20*60, minutes:60, dollars:100 }),
    row({ fundraiserId:'a', dateKey:'2025-12-01', startMinutes:20*60+30, minutes:60, dollars:10000 }),
    row({ fundraiserId:'a', dateKey:'2025-12-01', startMinutes:21*60, minutes:60, dollars:300 }),
    row({ fundraiserId:'a', dateKey:'2025-12-01', startMinutes:21*60+30, minutes:60, dollars:1 })
  ];

  const exact = workerContext.pairedStartTimeCheck(rows,{
    startA:20*60,
    startB:21*60,
    bucketMinutes:30,
    weekdayIndex:1,
    season:'December'
  });

  assert.equal(exact.pairedFundraisers,1);
  assert.equal(exact.hourAWins,0);
  assert.equal(exact.hourBWins,1);
  assert.equal(exact.medianHourARate,100);
  assert.equal(exact.medianHourBRate,300);
});

test('Day/Time report shows exact half-hour buckets, topic context, and season plus all-history fallback without redundant weekday overview', () => {
  const reportUi = fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url), 'utf8');
  const enhancements = fs.readFileSync(new URL('../assets/js/programming-strategy-enhancements.js', import.meta.url), 'utf8');

  assert.match(reportUi,/Half-hour program-start buckets/);
  assert.match(reportUi,/strongest topics in that exact bucket/);
  assert.match(reportUi,/selected pledge season is used when available/);
  assert.match(reportUi,/all-history context/);
  assert.match(reportUi,/const dayCards=order\.map/);
  assert.doesNotMatch(reportUi,/General weekday \/ weekend pattern/);
  assert.doesNotMatch(reportUi,/minStart/);
  assert.doesNotMatch(reportUi,/maxStart/);
  assert.doesNotMatch(enhancements,/8:00 PM vs 9:00 PM cross-check/);
  assert.doesNotMatch(enhancements,/startTimeReconciliationHtml/);
});



test('topic-time matrix keeps first and second Saturdays separate', () => {
  const { workerContext } = makeWorkerHarness();
  assert.equal(typeof workerContext.buildTopicTimeMatrix, 'function');
  const rows = [
    row({ fundraiserId:'dec25', driveStartDate:'2025-12-05', dateKey:'2025-12-06', startMinutes:19*60, topic:'Music', title:'First Music', dollars:600 }),
    row({ fundraiserId:'dec25', driveStartDate:'2025-12-05', dateKey:'2025-12-13', startMinutes:19*60, topic:'Health', title:'Second Health', dollars:900 }),
    row({ fundraiserId:'dec24', driveStartDate:'2024-12-06', dateKey:'2024-12-07', startMinutes:19*60, topic:'Music', title:'First Music 2', dollars:500 }),
    row({ fundraiserId:'dec24', driveStartDate:'2024-12-06', dateKey:'2024-12-14', startMinutes:19*60, topic:'Health', title:'Second Health 2', dollars:800 }),
    row({ fundraiserId:'long23', driveStartDate:'2023-11-24', dateKey:'2023-12-09', startMinutes:19*60, topic:'News', title:'Third Saturday History', dollars:5000 }),
    row({ fundraiserId:'long23', driveStartDate:'2023-11-24', dateKey:'2023-12-16', startMinutes:19*60, topic:'Drama', title:'Fourth Saturday History', dollars:6000 })
  ];
  const matrix = workerContext.buildTopicTimeMatrix(schedule, rows, []);
  const saturdayPrime = matrix.rows.find((item) => item.weekday === 'Saturday' && item.daypart === 'Prime');
  assert.ok(saturdayPrime);
  assert.deepEqual(Array.from(saturdayPrime.positionBreakdown, (item) => item.label), ['First Saturday','Second Saturday']);
  assert.ok(!saturdayPrime.positionBreakdown.some((item) => /Third|Fourth/.test(item.label)), 'target drive has only two Saturdays, so longer historical drives must not leak third/fourth Saturday labels');
  assert.equal(saturdayPrime.positionBreakdown[0].localTopics[0].topic, 'Music');
  assert.equal(saturdayPrime.positionBreakdown[1].localTopics[0].topic, 'Health');
  assert.equal(saturdayPrime.positionBreakdown[0].localTopics[0].fundraiserSamples, 2);
  assert.equal(saturdayPrime.positionBreakdown[1].localTopics[0].fundraiserSamples, 2);
});

test('peer local-production practice carries WNMU title-level counterevidence', () => {
  const { workerContext } = makeWorkerHarness();
  const peer = [{
    station_code:'PEERLOCAL',
    station_name:'Peer Local PBS',
    season:'December',
    assessment_signal:2,
    evidence_strength:5,
    context_flags:{ local:true },
    summary:'A local special was a strong pledge anchor.'
  }];
  const evidenceRows = [
    row({ fundraiserId:'d1', driveStartDate:'2025-12-05', dateKey:'2025-12-06', topic:'WNMU', title:'Local Special', dollars:900, minutes:60 }),
    row({ fundraiserId:'d2', driveStartDate:'2024-12-06', dateKey:'2024-12-07', topic:'WNMU', title:'Local Special', dollars:700, minutes:60 }),
    row({ fundraiserId:'d1', driveStartDate:'2025-12-05', dateKey:'2025-12-08', topic:'WNMU', title:'Recurring Local', dollars:20, minutes:60 }),
    row({ fundraiserId:'d2', driveStartDate:'2024-12-06', dateKey:'2024-12-09', topic:'WNMU', title:'Recurring Local', dollars:40, minutes:60 })
  ];
  const practices = workerContext.buildPeerPracticeGaps(schedule, peer, evidenceRows);
  const local = practices.find((item) => item.id === 'local-programming');
  assert.ok(local);
  assert.ok(local.wnmuEvidence);
  assert.equal(local.wnmuEvidence.strongest[0].title, 'Local Special');
  assert.equal(local.wnmuEvidence.weakest[0].title, 'Recurring Local');
  assert.match(local.wnmuStatus, /routine local series/i);
  assert.match(local.testIdea, /specials, documentaries or event treatment/i);
});

test('peer-practice evidence preserves missing financials as missing rather than zero', () => {
  const { workerContext } = makeWorkerHarness();
  assert.equal(typeof workerContext.buildPeerPracticeGaps, 'function');
  const practices = workerContext.buildPeerPracticeGaps(schedule,[
    {
      station_code:'PBSWIS',
      station_name:'PBS Wisconsin',
      season:'December',
      program_title_raw:'Bucky Badger documentary',
      assessment_raw:'Local documentary premiere was a major success, rated 5+++.',
      summary:'Local documentary premiere was a major success, rated 5+++.',
      assessment_signal:2,
      evidence_strength:5,
      context_flags:{ local:true, live:true, guest:true },
      actual_dollars:null,
      goal_dollars:null,
      pledge_count:null
    }
  ]);
  const local = practices.find((item) => item.label === 'Local productions as pledge anchors');
  assert.ok(local);
  assert.equal(local.examples[0].actualDollars,null);
  assert.equal(local.examples[0].goalDollars,null);
  assert.equal(local.examples[0].pledgeCount,null);
  assert.match(local.examples[0].summary,/5\+\+\+/);
});

test('peer-practice renderer does not coerce missing financials into $0 or 0 pledges', () => {
  const enhancements = fs.readFileSync(new URL('../assets/js/programming-strategy-enhancements.js', import.meta.url), 'utf8');
  assert.match(enhancements,/example\.actualDollars != null/);
  assert.match(enhancements,/example\.goalDollars != null/);
  assert.match(enhancements,/example\.pledgeCount != null/);
  assert.match(enhancements,/WNMU measured local-production history/);
  assert.match(enhancements,/Do not generalize peer success with local specials\/events/);
});


test('strategy print controls clearly state that collapsed sections will not print', () => {
  const page = fs.readFileSync(new URL('../programming-strategy.html', import.meta.url), 'utf8');
  assert.match(page,/Print visible sections/);
  assert.match(page,/Collapsed sections will not print\./);
});


test('nearby peer timing evidence does not convert missing dollars or pledge counts to zero', () => {
  const enhancements = fs.readFileSync(new URL('../assets/js/programming-strategy-enhancements.js', import.meta.url), 'utf8');
  assert.match(enhancements,/item\.actualDollars != null/);
  assert.match(enhancements,/item\.pledgeCount != null/);
  assert.doesNotMatch(enhancements,/if \(Number\.isFinite\(Number\(item\.pledgeCount\)\)\)/);
});


test('historical backtest freezes recommendations before the target fundraiser and uses target results only as the answer key', () => {
  const { workerContext, workerMessages } = makeWorkerHarness();
  const target = { id:'dec25-target', title:'December 2025 Target', startDate:'2025-12-05', endDate:'2025-12-14' };
  const library = [
    baseProgram({ id:'1', title:'Music Anchor', nola_code:'MUSC', topic_primary:'Music', rights_start:'2024-01-01', rights_end:'2027-12-31' }),
    baseProgram({ id:'2', title:'History Winner', nola_code:'HIST', topic_primary:'History', rights_start:'2024-01-01', rights_end:'2027-12-31' })
  ];
  const scheduleRows = [
    historicalScheduleRow({
      id:'dec24-prior', title:'December 2024 Prior', startDate:'2024-12-06', endDate:'2024-12-15',
      placements:[{ programId:'1', programTitle:'Music Anchor', nolaCode:'MUSC', dateKey:'2024-12-07', startMinutes:19*60, lengthMinutes:60 }]
    }),
    historicalScheduleRow({
      id:'dec25-target', title:'December 2025 Target', startDate:'2025-12-05', endDate:'2025-12-14',
      placements:[
        { programId:'1', programTitle:'Music Anchor', nolaCode:'MUSC', dateKey:'2025-12-06', startMinutes:19*60, lengthMinutes:60 },
        { programId:'2', programTitle:'History Winner', nolaCode:'HIST', dateKey:'2025-12-07', startMinutes:19*60, lengthMinutes:60 }
      ]
    })
  ];
  const airings = [
    {
      id:1, program_id:'1', pledge_program_id:'1', imported_program_title:'Music Anchor', matched_library_title:'Music Anchor',
      nola_code:'MUSC', air_date:'2024-12-07', air_time:'19:00', dollars:200, pledge_count:2, program_minutes:60,
      drive_start_date:'2024-12-06', drive_end_date:'2024-12-15', fundraiser_label:'December 2024 Prior',
      station:'WNMU', row_hash:'prior-music', source_file_name:'dec24.csv'
    },
    {
      id:2, program_id:'1', pledge_program_id:'1', imported_program_title:'Music Anchor', matched_library_title:'Music Anchor',
      nola_code:'MUSC', air_date:'2025-12-06', air_time:'19:00', dollars:100, pledge_count:1, program_minutes:60,
      drive_start_date:'2025-12-05', drive_end_date:'2025-12-14', fundraiser_label:'December 2025 Target',
      station:'WNMU', row_hash:'target-music', source_file_name:'dec25.csv'
    },
    {
      id:3, program_id:'2', pledge_program_id:'2', imported_program_title:'History Winner', matched_library_title:'History Winner',
      nola_code:'HIST', air_date:'2025-12-07', air_time:'19:00', dollars:900, pledge_count:6, program_minutes:60,
      drive_start_date:'2025-12-05', drive_end_date:'2025-12-14', fundraiser_label:'December 2025 Target',
      station:'WNMU', row_hash:'target-history', source_file_name:'dec25.csv'
    }
  ];

  workerContext.onmessage({
    data:{
      requestId:203,
      mode:'backtest',
      schedule:target,
      library,
      airings,
      scheduleRows,
      overrides:[{ program_id:'2', rating:'must_air', rated_at:'2026-01-10T00:00:00Z', updated_at:'2026-01-10T00:00:00Z' }],
      peerObservations:[],
      now:'2026-09-24T12:00:00Z'
    }
  });

  const result = workerMessages.find((message) => message.type === 'result');
  assert.ok(result);
  assert.equal(result.strategy.cutoff, '2025-12-04');
  assert.equal(result.diagnostics.overrideRows, 1);
  assert.equal(result.diagnostics.effectiveOverrideRows, 0, 'a programmer rating entered after the target drive must not time-travel into the recommendation');
  assert.equal(result.diagnostics.excludedPostCutoffOverrides, 1);
  assert.equal(result.diagnostics.evidenceRows, 1, 'only the completed 2024 fundraiser may inform December 2025 recommendations');
  assert.equal(result.diagnostics.backtestTargetFound, true);
  assert.equal(result.diagnostics.backtestActualRows, 2, 'the target fundraiser is read separately for outcome grading');
  assert.ok(result.backtest);
  assert.equal(result.backtest.leakageSafe, true);
  assert.equal(result.backtest.expectedCutoff, '2025-12-04');
  assert.equal(result.backtest.drive.titleCount, 2);
  assert.ok(result.backtest.topActual.some((item) => item.title === 'History Winner'));
  assert.ok(workerMessages.some((message) => message.type === 'progress' && message.stage === 'backtest'));
});


test('strategy recommendation ranking collapses duplicate Program Library rows with the same title', () => {
  const slot = S.planningWindows(schedule).find((entry) => entry.label === 'Prime' && !entry.blocked);
  const library = [
    baseProgram({ id:'dup-old', title:'Final Run: Storms of the Century', topic_primary:'Michigan', rights_end:'2026-12-31' }),
    baseProgram({ id:'dup-current', title:'Final Run: Storms of the Century', topic_primary:'Michigan', rights_end:'2049-12-31' }),
    baseProgram({ id:'other', title:'Different Michigan Program', topic_primary:'Michigan', rights_end:'2049-12-31' })
  ];
  const ranked = S.rankProgramsForSlot(library, slot, {
    schedule,
    evidenceRows:[],
    overrideByProgramId:new Map(),
    baselineRate:null
  });
  assert.equal(ranked.filter((item) => item.title === 'Final Run: Storms of the Century').length, 1);
  const recommendations = S.selectRecommendationsForSlot(ranked, 4);
  assert.equal(recommendations.filter((item) => item.title === 'Final Run: Storms of the Century').length, 1);
});


test('national PBS titles do not become Local / U.P. from secondary Michigan metadata alone', () => {
  assert.equal(S.isLocal(baseProgram({
    title:'PBS NewsHour',
    topic_primary:'News',
    topic_secondary:'Michigan',
    distributor:'PBS',
    program_notes:''
  })), false);
  assert.equal(S.isLocal(baseProgram({
    title:'Washington Week',
    topic_primary:'News',
    topic_secondary:'Michigan',
    distributor:'PBS',
    program_notes:''
  })), false);
  assert.equal(S.isLocal(baseProgram({
    title:'Off the Record',
    topic_primary:'News',
    topic_secondary:'Michigan',
    distributor:'WKAR',
    program_notes:''
  })), true);
  assert.equal(S.isLocal(baseProgram({
    title:'Great Lakes Stories',
    topic_primary:'Documentary',
    topic_secondary:'History',
    distributor:'PBS',
    program_notes:'A documentary about Michigan and Lake Superior.'
  })), true);
});

test('long-rest former performers are not put in Avoid solely for lifetime exposure', () => {
  const target={id:'dec26-rest',title:'December 2026',startDate:'2026-12-05',endDate:'2026-12-13'};
  const rested=baseProgram({id:'rested-heavy',title:'Rested Heavy Performer',topic_primary:'Music',rights_start:'2018-01-01',rights_end:'2030-12-31'});
  const recent=baseProgram({id:'recent-heavy',title:'Recent Heavy Performer',topic_primary:'Music',rights_start:'2018-01-01',rights_end:'2030-12-31'});
  const benchmark=baseProgram({id:'benchmark',title:'Benchmark Performer',topic_primary:'Music',rights_start:'2018-01-01',rights_end:'2030-12-31'});
  const history=[];
  for(let i=0;i<9;i+=1){
    history.push(row({
      programId:'rested-heavy',
      title:'Rested Heavy Performer',
      dateKey:`2019-12-${String(1+i).padStart(2,'0')}`,
      dollars:100,
      fundraiserId:'dec19'
    }));
    history.push(row({
      programId:'recent-heavy',
      title:'Recent Heavy Performer',
      dateKey:`2026-09-${String(1+i).padStart(2,'0')}`,
      dollars:100,
      fundraiserId:'sep26'
    }));
    history.push(row({
      programId:'benchmark',
      title:'Benchmark Performer',
      dateKey:`2025-12-${String(1+i).padStart(2,'0')}`,
      dollars:900,
      fundraiserId:'dec25'
    }));
  }
  const strategy=S.buildStrategy({schedule:target,library:[rested,recent,benchmark],evidenceRows:history,now:new Date('2026-09-25T12:00:00')});
  const restedAvoid=strategy.avoid.find(item=>item.title==='Rested Heavy Performer');
  const recentAvoid=strategy.avoid.find(item=>item.title==='Recent Heavy Performer');
  assert.equal(restedAvoid,undefined);
  assert.ok(recentAvoid);
  assert.ok(recentAvoid.reasons.some(reason=>/Heavy lifetime exposure/.test(reason)));
});

test('strategy report runtime parses after fundraising-window template changes', () => {
  const reportUi=fs.readFileSync(new URL('../assets/js/programming-strategy-report.js', import.meta.url),'utf8');
  assert.doesNotThrow(()=>new vm.Script(reportUi,{filename:'programming-strategy-report.js'}));
});


test('historical backtest ignores present-day explicit Drama Doc cycle overrides', () => {
  const { workerContext, workerMessages: messages } = makeWorkerHarness();

  const target={id:'aug24-cycle',title:'August 2024',startDate:'2024-08-30',endDate:'2024-09-09'};
  const seasonFour=baseProgram({
    id:'season-four',
    title:'All Creatures Great and Small: A Season 4 Change',
    topic_primary:'Drama Doc',
    program_notes:'Behind the scenes of Season 4.',
    rights_start:'2024-08-10',
    rights_end:'2028-02-17',
    drama_cycle_status:'older'
  });
  const seasonSix=baseProgram({
    id:'season-six',
    title:'All Creatures Great and Small: Chapter Six',
    topic_primary:'Drama Doc',
    program_notes:'Behind the scenes of Season 6.',
    rights_start:'2026-08-05',
    rights_end:'2032-02-18',
    drama_cycle_status:'current'
  });

  workerContext.onmessage({data:{
    requestId:991,
    mode:'backtest',
    schedule:target,
    library:[seasonFour,seasonSix],
    airings:[],
    scheduleRows:[],
    overrides:[],
    peerObservations:[],
    peerScheduleContexts:[],
    now:'2026-10-01T12:00:00Z'
  }});

  const result=messages.find((message)=>message.type==='result');
  assert.ok(result);
  const recommendation=(result.strategy.windows||[])
    .flatMap((slot)=>slot.recommendations||[])
    .find((item)=>item.title==='All Creatures Great and Small: A Season 4 Change');
  assert.ok(recommendation,'Season 4 should be inferred from the 2024 target date rather than blocked by today\'s older override');
  assert.equal(recommendation.drama?.basis,'series-season');
  assert.equal(recommendation.drama?.currentCycle,true);
});


test('blank-cycle Drama Doc with recent rights cannot be treated as a current-cycle repeat', () => {
  const target={startDate:'2026-12-05',endDate:'2026-12-13'};
  const program=baseProgram({
    id:'rights-only-repeat',
    title:'Recent Rights Mystery Special',
    topic_primary:'Drama Doc',
    rights_start:'2026-09-01',
    rights_end:'2028-12-31'
  });
  const info=S.dramaInfo(program,target,new Map());
  assert.equal(info.currentCycle,false);
  assert.equal(info.cycleUnknown,true);
  assert.equal(info.basis,'rights-start-only');
  assert.equal(info.recentRightsStart,true);
});


test('new Drama Docs receive first-run priority without requiring a current-cycle repeat classification', () => {
  const slot=S.planningWindows(schedule).find((entry)=>entry.label==='Prime');
  const newDrama=baseProgram({
    id:'new-drama-priority',
    title:'Brand New Drama Special',
    topic_primary:'Drama Doc',
    rights_start:'2026-09-01',
    rights_end:'2028-12-31'
  });
  const scored=S.scoreProgramForSlot(newDrama,slot,{
    schedule,
    evidenceRows:[],
    overrideByProgramId:new Map(),
    baselineRate:null
  });
  const newDramaAdjustment=scored.adjustments.find(([name])=>name==='newDramaDoc')?.[1];
  assert.equal(scored.newTitle,true);
  assert.equal(scored.drama.currentCycle,false);
  assert.equal(scored.drama.cycleUnknown,true);
  assert.equal(newDramaAdjustment,8);
  assert.ok(scored.reasons.some((reason)=>/New \/ unaired Drama Doc receives first-run priority/.test(reason)));
  assert.equal(S.dramaDocRecommendationAllowed(scored),true);
});


test('dated companion titles are excluded from staffed windows but eligible for the December 2026 5–7 PM Web-only test', () => {
  const program=baseProgram({
    id:'dated-companion',
    title:'Dated companion special',
    topic_primary:'Drama Doc',
    companion_program_status:'dated',
    drama_cycle_status:'current'
  });
  const staffed={date:'2026-12-05',weekday:'Saturday',weekpart:'Saturday',label:'Prime',startMinutes:19*60,endMinutes:22*60,experimental:false,webOnlyExperimental:false};
  const webOnly={date:'2026-12-05',weekday:'Saturday',weekpart:'Saturday',label:'Early evening',startMinutes:17*60,endMinutes:19*60,experimental:true,webOnlyExperimental:true};
  const context={schedule:{id:'dec26',title:'December 2026',startDate:'2026-11-27',endDate:'2026-12-07'},evidenceRows:[],overrideByProgramId:new Map(),baselineRate:300};
  const staffedScore=S.scoreProgramForSlot(program,staffed,context);
  const webScore=S.scoreProgramForSlot(program,webOnly,context);
  assert.equal(staffedScore.companionStatus,'dated');
  assert.equal(S.recommendationAllowed(staffedScore,staffed),false);
  assert.equal(S.recommendationAllowed(webScore,webOnly),true);
  assert.ok(webScore.reasons.some(reason=>/5–7 PM Web-only test/i.test(reason)));
});

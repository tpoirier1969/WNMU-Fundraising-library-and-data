import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../assets/js/programming-strategy-analysis.js',import.meta.url),'utf8');
const context={console,Date,Map,Set,Math,Number,String,Object,Array,RegExp,Intl};context.globalThis=context;vm.runInNewContext(source,context,{filename:'programming-strategy-analysis.js'});const S=context.WNMUProgrammingStrategyAnalysis;
const schedule={id:'dec26',title:'December 2026',startDate:'2026-12-05',endDate:'2026-12-13'};
const baseProgram=(o={})=>({id:o.id||'1',title:o.title||'Test Program',topic_primary:o.topic_primary||'Music',topic_secondary:o.topic_secondary||'',rights_start:o.rights_start??'2026-01-01',rights_end:o.rights_end??'2027-12-31',length_bucket_minutes:o.length_bucket_minutes||60,...o});
const row=(o={})=>({programId:o.programId||'1',title:o.title||'Test Program',topic:o.topic||'Music',dateKey:o.dateKey||'2026-08-08',startMinutes:o.startMinutes??19*60,minutes:o.minutes??60,dollars:o.dollars??600,fundraiserId:o.fundraiserId||'aug26',...o});

test('future fundraiser evidence is capped at today, not fundraiser start',()=>{
  assert.equal(S.evidenceCutoff(schedule,new Date(2026,8,17,9)),'2026-09-17');
  const filtered=S.filterEvidenceAirings([row({dateKey:'2026-09-17'}),row({dateKey:'2026-09-18'}),row({dateKey:'2026-12-04'})],S.evidenceCutoff(schedule,new Date(2026,8,17,9)));
  assert.deepEqual(Array.from(filtered,x=>x.dateKey),['2026-09-17']);
});

test('historical fundraiser evidence stops the day before the drive',()=>{
  assert.equal(S.evidenceCutoff({startDate:'2025-12-06'},new Date(2026,8,17)),'2025-12-05');
});

test('post-cutoff results cannot improve a recommendation',()=>{
  const p=baseProgram(),now=new Date(2026,8,17),pre=[row({dateKey:'2026-08-08',dollars:120})],future=row({dateKey:'2026-10-03',dollars:12000});
  const a=S.buildStrategy({schedule,library:[p],evidenceRows:pre,now}),b=S.buildStrategy({schedule,library:[p],evidenceRows:[...pre,future],now});
  assert.equal(a.windows.find(x=>x.label==='Prime').recommendations[0].score,b.windows.find(x=>x.label==='Prime').recommendations[0].score);
  assert.equal(b.evidenceRows,1);
});

test('rights are enforced on the actual proposed slot date',()=>{
  const expired=baseProgram({rights_end:'2026-12-01'}),future=baseProgram({rights_start:'2026-12-10'}),first=S.planningWindows(schedule)[0],later=S.planningWindows(schedule).find(x=>x.date==='2026-12-12');
  assert.equal(S.titleEligibleForDate(expired,first.date),false);assert.equal(S.titleEligibleForDate(future,first.date),false);assert.equal(S.titleEligibleForDate(future,later.date),true);
});

test('Friday 8-9 PM remains protected regular programming',()=>{
  const blocked=S.planningWindows(schedule).find(x=>x.weekday==='Friday'&&x.startMinutes===20*60);assert.ok(blocked);assert.equal(blocked.blocked,true);assert.equal(S.buildStrategy({schedule,library:[baseProgram()],evidenceRows:[],now:new Date(2026,8,17)}).windows.find(x=>x.id===blocked.id).recommendations.length,0);
});

test('normal slots do not silently borrow another weekday to create topic confidence',()=>{
  const thursday=S.planningWindows(schedule).find(x=>x.weekday==='Thursday'&&x.label==='Prime'),p=baseProgram({topic_primary:'Drama Doc'}),rows=[row({topic:'Drama Doc',dateKey:'2026-08-03',startMinutes:19*60,dollars:1200})];
  const scored=S.scoreProgramForSlot(p,thursday,{schedule,evidenceRows:rows,overrideByProgramId:new Map(),baselineRate:600});
  assert.equal(scored.topicHistory.rates.length,0);assert.ok(scored.score<=64);assert.ok(scored.cautions.some(x=>x.includes('No WNMU Drama Doc evidence')));
});

test('weak Friday performance lowers Friday recommendations',()=>{
  const friday=S.planningWindows(schedule).find(x=>x.weekday==='Friday'&&x.label==='Prime'),saturday=S.planningWindows(schedule).find(x=>x.weekday==='Saturday'&&x.label==='Prime'),p=baseProgram();
  const rows=[row({dateKey:'2026-08-07',dollars:60}),row({dateKey:'2026-06-05',dollars:70,fundraiserId:'jun26'}),row({dateKey:'2026-08-08',dollars:900}),row({dateKey:'2026-06-06',dollars:850,fundraiserId:'jun26'})];
  const ctx={schedule,evidenceRows:rows,overrideByProgramId:new Map(),baselineRate:500};
  assert.ok(S.scoreProgramForSlot(p,friday,ctx).score<S.scoreProgramForSlot(p,saturday,ctx).score);
});

test('Low confidence materially demotes and caps the displayed posture',()=>{
  const p=baseProgram(),slot=S.planningWindows(schedule).find(x=>x.label==='Prime'),rows=[row({dateKey:'2026-08-08',dollars:1800}),row({dateKey:'2026-06-06',dollars:1600,fundraiserId:'jun26'})];
  const neutral=S.scoreProgramForSlot(p,slot,{schedule,evidenceRows:rows,overrideByProgramId:new Map(),baselineRate:500}),low=S.scoreProgramForSlot(p,slot,{schedule,evidenceRows:rows,overrideByProgramId:new Map([['1',{program_id:'1',rating:'low_confidence'}]]),baselineRate:500});
  assert.ok(low.score<neutral.score);assert.ok(low.score<=58);assert.equal(low.fit,'Programmer caution');
});

test('programmer rating lookup is by the actual Program Library id',()=>{
  const idx=S.overrideIndex([{program_id:41,rating:'low_confidence'}]);assert.equal(idx.get('41').rating,'low_confidence');assert.equal(idx.get('42'),undefined);
});

test('older Drama Docs are penalized relative to current-cycle Drama Docs',()=>{
  const old=baseProgram({id:'old',topic_primary:'Drama Doc',rights_start:'2024-01-01'}),cur=baseProgram({id:'cur',topic_primary:'Drama Doc',rights_start:'2026-09-01'}),slot=S.planningWindows(schedule).find(x=>x.label==='Prime'),ctx={schedule,evidenceRows:[],overrideByProgramId:new Map(),baselineRate:null};
  assert.ok(S.scoreProgramForSlot(cur,slot,ctx).score>S.scoreProgramForSlot(old,slot,ctx).score);
});

test('holiday detection supports the planned holiday-specific topic names',()=>{
  assert.equal(S.isHoliday(baseProgram({topic_primary:'Holiday - Christmas',topic_secondary:'Music'})),true);assert.equal(S.isHoliday(baseProgram({topic_primary:'Holiday - Easter',topic_secondary:'Drama'})),true);assert.equal(S.isHoliday(baseProgram({topic_primary:'Holiday - Halloween',topic_secondary:'Documentary'})),true);
});

test('topic comparison includes every eligible Library topic',()=>{
  const library=[baseProgram({id:'a',topic_primary:'Music'}),baseProgram({id:'b',topic_primary:'Holiday - Christmas'}),baseProgram({id:'c',topic_primary:'Local'})],strategy=S.buildStrategy({schedule,library,evidenceRows:[],now:new Date(2026,8,17)}),topics=new Set(strategy.topicComparison.map(x=>x.topic));
  assert.deepEqual([...topics].sort(),['Holiday - Christmas','Local','Music']);
});

test('lowercase ordinary up does not create Local / U.P. relevance',()=>{
  assert.equal(S.isLocal(baseProgram({title:'Growing Up Together',program_notes:'A look up the road.'})),false);assert.equal(S.isLocal(baseProgram({title:'UP Stories'})),true);assert.equal(S.isLocal(baseProgram({title:'Lake Superior Stories'})),true);
});

test('rights constraints separate unavailable from partial-drive titles',()=>{
  const rights=S.rightsConstraints([baseProgram({id:'x',title:'Expired',rights_end:'2026-12-01'}),baseProgram({id:'p',title:'Partial',rights_start:'2026-12-10'}),baseProgram({id:'ok',title:'Full'})],schedule);
  assert.deepEqual(Array.from(rights.unavailable,x=>x.title),['Expired']);assert.deepEqual(Array.from(rights.partial,x=>x.title),['Partial']);
});

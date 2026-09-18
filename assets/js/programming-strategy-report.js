(() => {
'use strict';
const A=globalThis.WNMUOneSheetAnalysis,S=globalThis.WNMUProgrammingStrategyAnalysis,cfg=globalThis.PLEDGE_MANAGER_CONFIG||{};
const state={client:null,allSchedules:[],schedules:[],airings:[],library:[],indexes:null,overrides:[],selectedScheduleId:'',analysisReady:false};
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function fmt(v,year=true){const d=S.parseDate(v);return d?d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:year?'numeric':undefined}):esc(v||'—');}
function clock(m){m=Number(m);if(!Number.isFinite(m))return'—';m=((m%1440)+1440)%1440;const h=Math.floor(m/60),mi=m%60;return`${h%12||12}${mi?`:${String(mi).padStart(2,'0')}`:''} ${h>=12?'PM':'AM'}`;}
function status(msg,tone=''){const n=$('#strategy-status');if(n){n.textContent=msg||'';n.className=`strategy-status${tone?` ${tone}`:''}`;}}
function makeClient(){if(!globalThis.supabase?.createClient)throw new Error('Supabase library did not load.');if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)throw new Error('Supabase configuration is missing.');return globalThis.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);}
async function requireAdmin(){state.client=makeClient();const{data,error}=await state.client.auth.getSession();if(error)throw error;const session=data?.session||null,email=String(session?.user?.email||'').trim().toLowerCase(),admins=Array.isArray(cfg.ADMIN_EMAILS)?cfg.ADMIN_EMAILS.map(x=>String(x).trim().toLowerCase()).filter(Boolean):[],ok=!!(session&&(!admins.length||admins.includes(email)));if(ok){$('#strategy-role').textContent=email?`Admin · ${email}`:'Admin';return true;}$('#strategy-app')?.classList.add('hidden');const gate=$('#strategy-access-gate');if(gate){gate.classList.remove('hidden');gate.innerHTML=`<div class="report-gate-card"><div class="report-kicker">Admin report center</div><h1>Admin access required</h1><p>${esc(session?`${email||'This account'} does not have administrator report access.`:'Sign in as an administrator from the Pledge Program Library, then return to this report.')}</p><a class="report-button primary" href="./">Open Pledge Program Library</a></div>`;}return false;}
async function fetchAll(table,select='*',order=''){const rows=[];for(let from=0;;from+=1000){let q=state.client.from(table).select(select).range(from,from+999);if(order)q=q.order(order,{ascending:true});const{data,error}=await q;if(error)throw error;const chunk=Array.isArray(data)?data:[];rows.push(...chunk);if(chunk.length<1000)break;}return rows;}
async function fetchOptional(table){try{return await fetchAll(table);}catch(e){console.warn(`Optional report source ${table} unavailable.`,e);return[];}}
function todayStart(){const d=new Date();d.setHours(0,0,0,0);return d;}
function defaultSchedule(){return state.schedules[0]||null;}
function scheduleLabel(s){return`${s.title} · ${fmt(s.startDate)}–${fmt(s.endDate,false)}`;}
async function loadSchedules(){
  status('Loading upcoming fundraiser choices…');
  const rows=await fetchAll('pledge_fundraiser_schedules','id,title,start_date,end_date,created_at,updated_at,schedule_data','start_date');
  state.allSchedules=A.prepareSchedules(rows.map(A.normalizeSchedule))
    .filter(x=>x.startDate&&x.endDate&&!x.reportOnly)
    .sort((a,b)=>String(a.startDate).localeCompare(String(b.startDate)));
  const today=todayStart();
  state.schedules=state.allSchedules.filter(x=>{
    const start=S.parseDate(x.startDate);
    return start&&start>=today;
  });
  renderControls();
  status(state.schedules.length
    ? `${state.schedules.length} upcoming fundraiser${state.schedules.length===1?'':'s'} ready. Loading history and Program Library…`
    : 'No upcoming fundraiser is saved yet.');
}
async function loadAnalysisData(){const[airings,library,overrides]=await Promise.all([fetchAll('pledge_program_airings_v2','*','air_date'),fetchAll('pledge_programs_v2'),fetchOptional('pledge_program_editorial_overrides')]);state.airings=A.canonicalizeImportedAirings?A.canonicalizeImportedAirings(airings):airings;state.library=library;state.indexes=A.buildLibraryIndexes(library);state.overrides=overrides;state.analysisReady=true;status('Data loaded. Calculating strategy…');renderStrategy();}
function renderControls(){
  const select=$('#strategy-fundraiser');
  if(!select)return;
  const initial=defaultSchedule();
  if(!initial){
    select.innerHTML='<option value="">No upcoming fundraisers</option>';
    select.disabled=true;
    state.selectedScheduleId='';
  }else{
    select.innerHTML=state.schedules.map(x=>`<option value="${esc(x.id)}">${esc(scheduleLabel(x))}</option>`).join('');
    state.selectedScheduleId=initial.id;
    select.value=initial.id;
    select.disabled=false;
  }
  select.onchange=()=>{state.selectedScheduleId=select.value;renderStrategy();};
  $('#strategy-print').onclick=()=>window.print();
}
const selectedSchedule=()=>state.schedules.find(x=>String(x.id)===String(state.selectedScheduleId))||null;
function evidenceBundle(schedule){
  const cutoff=S.evidenceCutoff(schedule,new Date());
  const cutoffAirings=S.filterEvidenceAirings(state.airings,cutoff);
  const cutoffDate=S.parseDate(cutoff);
  const authoritative=state.allSchedules.filter(x=>
    String(x.id)!==String(schedule.id)&&
    cutoffDate&&S.parseDate(x.startDate)<=cutoffDate
  );
  const reportOnly=typeof A.reportOnlySchedulesFromAirings==='function'
    ?A.reportOnlySchedulesFromAirings(authoritative,cutoffAirings,state.indexes):[];
  const history=[...authoritative,...reportOnly].filter(x=>cutoffDate&&S.parseDate(x.startDate)<=cutoffDate);
  const analyses=history.map(x=>A.analyzeSchedule(x,cutoffAirings,state.indexes));
  return {cutoff,airings:cutoffAirings,analyses,rows:A.historicalRows(analyses)};
}
function topicPill(x){return`<span class="strategy-pill"><strong>${esc(x.topic)}</strong><small>${esc(x.confidence||'')}</small></span>`;}
function recommendationHtml(x){const flags=[];if(x.local)flags.push('Local / U.P.');if(x.season?.holidayInWindow)flags.push(x.season.holidayCategory||'Seasonal fit');if(x.drama?.currentCycle)flags.push('Current Drama Doc');if(x.programmer?.rating)flags.push(`Programmer: ${x.programmer.label}`);return`<article class="strategy-title-card"><div class="strategy-title-card-head"><div><strong>${esc(x.title)}</strong><span>${esc(x.topic)}${x.secondary?` · ${esc(x.secondary)}`:''}</span></div><div class="strategy-score"><b>${Math.round(x.score)}</b><small>${esc(x.fit)}</small></div></div><div class="strategy-title-meta">Confidence: ${esc(x.confidence)}${flags.length?` · ${flags.map(esc).join(' · ')}`:''}</div><p>${esc(x.reasons.slice(0,2).join(' '))}</p>${x.cautions.length?`<div class="strategy-caution">${esc(x.cautions.slice(0,2).join(' '))}</div>`:''}</article>`;}
function topicComparisonSection(strategy){
  const rows=strategy.topicComparison||[];
  if(!rows.length)return'<section class="sheet-section"><h2>Topic performance in selected season</h2><p>No eligible topic data is available.</p></section>';
  const season=rows[0]?.season||S.seasonForDate(strategy.schedule?.startDate)||'selected';
  return`<section class="sheet-section"><div class="strategy-section-head"><div><h2>Topic performance · ${esc(season)} season</h2><p>Complete list of topics represented by titles eligible for this fundraiser. Performance uses WNMU history from the same fundraiser season, not a strongest-topics shortlist.</p></div></div><div class="strategy-topic-list">${rows.map(x=>`<div class="strategy-topic-list-row"><div><strong>${esc(x.topic)}</strong><span class="strategy-strength strength-${esc(x.signal.toLowerCase().replace(/\s+/g,'-'))}">${esc(x.signal)}</span></div><div>${x.historyRows?`${x.historyRows} rate-valid ${esc(season)} row${x.historyRows===1?'':'s'}${Number.isFinite(x.medianRate)?` · median $${Math.round(x.medianRate)}/hr`:''}`:`No rate-valid ${esc(season)} history yet`}</div><div>${x.bestWindows.length?`Best supported: ${x.bestWindows.map(w=>`${w.weekday} ${w.label}`).join(' · ')}`:'No established weekday/time fit in this season yet'}</div><small>${x.programCount} Library title${x.programCount===1?'':'s'} · ${x.eligibleProgramCount} eligible for this fundraiser${x.subtopics.length?` · Current subtopics: ${esc(x.subtopics.join(' · '))}`:''}</small></div>`).join('')}</div></section>`;
}

function groupedDayparts(strategy){
  const groups=new Map();
  for(const slot of strategy.windows.filter(x=>!x.experimental&&!x.blocked)){
    const key=`${slot.weekday}|${slot.startMinutes}|${slot.endMinutes}`;
    const rates=slot.windowHistory?.rates||[];
    const existing=groups.get(key);
    if(!existing||rates.length>(existing.rates?.length||0)){
      groups.set(key,{weekday:slot.weekday,label:slot.label,startMinutes:slot.startMinutes,endMinutes:slot.endMinutes,rows:rates.length,rates:[...rates]});
    }
  }
  const weekdayOrder=new Map(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((d,i)=>[d,i]));
  return[...groups.values()].map(g=>({...g,median:S.median(g.rates)}))
    .sort((a,b)=>(weekdayOrder.get(a.weekday)??9)-(weekdayOrder.get(b.weekday)??9)||a.startMinutes-b.startMinutes);
}

function daypartSection(strategy){
  const strengths=groupedDayparts(strategy),experiments=strategy.windows.filter(x=>x.experimental);
  return`<section class="sheet-section strategy-two-column"><div><h2>Strongest day/time patterns</h2><p>Listed Monday through Sunday so the week is easy to scan. Historical median and sample size show which windows actually have WNMU support.</p>${strengths.map(x=>`<div class="strategy-line"><strong>${esc(x.weekday)} · ${clock(x.startMinutes)}–${clock(x.endMinutes)}</strong><span>${x.rows?`${x.rows} exact-weekday comparable historical row${x.rows===1?'':'s'}${Number.isFinite(x.median)?` · median about $${Math.round(x.median)}/hr`:''}`:'No exact-weekday evidence'}</span></div>`).join('')||'<p>No normal-window evidence available.</p>'}</div><div><h2>Experimental opportunities</h2>${experiments.map(x=>{const e=x.experimentalEvidence||{};return`<div class="strategy-line experimental"><strong>${esc(x.weekday)} ${fmt(x.date,false)} · ${clock(x.startMinutes)}–${clock(x.endMinutes)}</strong><span><b>${esc(e.verdict||'Hypothesis only')}.</b> ${esc(e.rationale||'No direct WNMU evidence is available.')} ${esc(e.peerEvidence||'')}</span></div>`;}).join('')||'<p>No experimental window identified.</p>'}</div></section>`;
}

function targetDays(schedule){
  const out=[],start=S.parseDate(schedule?.startDate),end=S.parseDate(schedule?.endDate);
  if(!start||!end)return out;
  for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1))out.push(new Date(d));
  return out;
}
function firstSaturdayForSchedule(schedule){
  const start=S.parseDate(schedule?.startDate),end=S.parseDate(schedule?.endDate);
  if(!start)return null;
  const next=new Date(start);while(next.getDay()!==6)next.setDate(next.getDate()+1);
  if(!end||next<=end)return next;
  const previous=new Date(start);while(previous.getDay()!==6)previous.setDate(previous.getDate()-1);
  return previous;
}
function dayOutlook(schedule,analyses){
  const season=S.seasonForDate(schedule?.startDate);
  let pool=(analyses||[]).filter(a=>S.seasonForDate(a?.schedule?.startDate)===season);
  let fallback=false;
  if(pool.length<2){pool=analyses||[];fallback=true;}
  const aligned=A.alignedDailyRows(pool);
  const baselineRates=aligned.flatMap(item=>item.days||[]).filter(Boolean).map(d=>Number(d.dollarsPerHour)).filter(Number.isFinite);
  const baseline=S.median(baselineRates);
  const anchor=firstSaturdayForSchedule(schedule);
  const rows=targetDays(schedule).map(date=>{
    const offset=anchor?Math.round((date-anchor)/86400000):null;
    const match=aligned.find(item=>item.offset===offset);
    const rates=(match?.days||[]).filter(Boolean).map(d=>Number(d.dollarsPerHour)).filter(Number.isFinite);
    const med=S.median(rates);
    const ratio=Number.isFinite(med)&&Number.isFinite(baseline)&&baseline>0?med/baseline:null;
    let outlook='No comparable history';
    if(rates.length===1)outlook='Thin evidence';
    else if(rates.length>=2){
      if(ratio>=1.25)outlook='Usually strong';
      else if(ratio>=1.05)outlook='Usually good';
      else if(ratio>=0.85)outlook='Fair / typical';
      else if(ratio>=0.65)outlook='Usually soft';
      else outlook='Usually weak';
    }
    return{
      date:S.dateKey(date),
      label:Number.isFinite(offset)?A.fundraiserDayLabel(offset).title:date.toLocaleDateString(undefined,{weekday:'long'}),
      outlook,samples:rates.length,medianRate:med,ratio
    };
  });
  const ranked=rows.filter(x=>x.samples>=2&&Number.isFinite(x.ratio)).sort((a,b)=>b.ratio-a.ratio);
  const best=new Set(ranked.slice(0,2).filter(x=>x.ratio>=1.05).map(x=>x.date));
  rows.forEach(x=>x.bestBet=best.has(x.date));
  return{season,fallback,rows};
}
function dayOutlookSection(schedule,analyses){
  const outlook=dayOutlook(schedule,analyses);
  return`<section class="sheet-section"><div class="strategy-section-head"><div><h2>Anticipated day strength</h2><p>Compares each fundraiser-day position with the same position in prior ${esc(outlook.season)} drives${outlook.fallback?' (same-season sample was thin, so all historical drives are used as fallback)':''}. The rating is based on median Broadcast $/pledge hour, not total dollars.</p></div></div><div class="strategy-day-outlook">${outlook.rows.map(x=>`<div class="strategy-day-outlook-row"><strong>${esc(x.label)}</strong><span class="strategy-day-rating">${esc(x.outlook)}${x.bestBet?' · Best bet':''}</span><span>${x.samples?`${x.samples} comparable historical day${x.samples===1?'':'s'}${Number.isFinite(x.medianRate)?` · median about $${Math.round(x.medianRate)}/hr`:''}`:'No corresponding historical day sample'}</span></div>`).join('')}</div></section>`;
}

function dayMapSection(strategy){
  const byDate=new Map();
  for(const slot of strategy.windows){if(!byDate.has(slot.date))byDate.set(slot.date,[]);byDate.get(slot.date).push(slot);}
  return`<section class="sheet-section"><h2>Day-by-day programming map</h2><p>Compact planning view. Each candidate is one row; evidence and cautions stay visible without large title cards.</p><div class="strategy-days-compact">${[...byDate.entries()].map(([date,slots])=>`<section class="strategy-day-compact"><header><strong>${esc(slots[0].weekday)}</strong><span>${fmt(date)}</span></header><div class="strategy-program-table"><div class="strategy-program-row strategy-program-head"><span>Time</span><span>Title / topic</span><span>Evidence</span><span>Fit</span></div>${slots.map(slot=>{
    if(slot.blocked)return`<div class="strategy-window-divider is-blocked"><strong>${clock(slot.startMinutes)}–${clock(slot.endMinutes)} · Protected regular programming</strong><span>Not pledge inventory.</span></div>`;
    const exp=slot.experimentalEvidence||{};
    const divider=`<div class="strategy-window-divider ${slot.experimental?'is-experimental':''}"><strong>${clock(slot.startMinutes)}–${clock(slot.endMinutes)} · ${esc(slot.label)}${slot.experimental?' · Experimental':''}</strong><span>${slot.experimental?esc(`${exp.verdict||'Hypothesis only'}: ${exp.rationale||''}`):(slot.evidenceRows?`${slot.evidenceRows} exact-weekday comparable historical row${slot.evidenceRows===1?'':'s'}`:'No exact-weekday slot history')}</span></div>`;
    const rows=slot.recommendations.slice(0,4).map(x=>`<div class="strategy-program-row"><span class="strategy-program-time">${clock(slot.startMinutes)}</span><span class="strategy-program-title"><strong>${esc(x.title)}${x.newTitle?'<span class="strategy-new-title">NEW</span>':''}</strong><small>${esc(x.topic)}${x.secondary?` · ${esc(x.secondary)}`:''}${x.programmer?.rating?` · Programmer: ${esc(x.programmer.label)}`:''}</small></span><span class="strategy-program-evidence"><b>${esc(x.confidence)}</b> · ${esc((x.newTitle&&x.reviewedNew?x.reasons.find(r=>/^New \/ unaired/i.test(r)):null)||x.reasons[0]||'No direct title history.')}${x.cautions.length?` <em>${esc(x.cautions[0])}</em>`:''}</span><span class="strategy-program-fit"><b>${Math.round(x.score)}</b><small>${esc(x.fit)}</small></span></div>`).join('');
    return divider+(rows||'<div class="strategy-program-empty">No eligible Program Library title for this slot.</div>');
  }).join('')}</div></section>`).join('')}</div></section>`;
}

function compact(items,renderer,empty){return items?.length?`<div class="strategy-compact-list">${items.map(renderer).join('')}</div>`:`<p>${esc(empty)}</p>`;}
function supportingSections(strategy){return`<section class="sheet-section strategy-two-column"><div><h2>Repeat candidates</h2>${compact(strategy.repeats,x=>`<div><strong>${esc(x.title)}</strong><span>${esc(x.topic)} · score ${Math.round(x.score)} · supported on ${x.slots.length} separated prime windows.</span></div>`,'No repeat candidate clears the threshold.')}<h2>Seasonal opportunities</h2>${compact(strategy.seasonal,x=>`<div><strong>${esc(x.title)}</strong><span>${esc(x.topic)} · ${esc(x.season.notes.join(' ')||`${x.season.targetSeason} seasonal support`)}</span></div>`,'No distinct seasonal opportunity identified.')}</div><div><h2>Local / U.P. opportunities</h2>${compact(strategy.local,x=>`<div><strong>${esc(x.title)}</strong><span>${esc(x.topic)} · best-window score ${Math.round(x.score)} · ${esc(x.fit)}</span></div>`,'No eligible Local / U.P. title identified.')}<h2>Titles to avoid / rest</h2>${compact(strategy.avoid,x=>`<div><strong>${esc(x.title)}</strong><span>${esc(x.reasons.join(' · '))}</span></div>`,'No title needs a prominent rest/avoid caution.')}</div></section>`;}
function rightsSection(strategy){const desc=x=>`${x.rightsStart?`Starts ${fmt(x.rightsStart)}`:''}${x.rightsStart&&x.rightsEnd?' · ':''}${x.rightsEnd?`Ends ${fmt(x.rightsEnd)}`:''}`;return`<section class="sheet-section strategy-two-column"><div><h2>Rights constraints</h2>${compact(strategy.rights.unavailable.slice(0,20),x=>`<div><strong>${esc(x.title)}</strong><span>${esc(desc(x))}</span></div>`,'No fully unavailable title detected.')}</div><div><h2>Partial-drive rights</h2>${compact(strategy.rights.partial.slice(0,20),x=>`<div><strong>${esc(x.title)}</strong><span>${esc(desc(x))}</span></div>`,'No partial-drive rights restriction detected.')}</div></section>`;}
function limitationsSection(strategy){return`<section class="sheet-section"><h2>Evidence confidence & limitations</h2><div class="strategy-facts"><div><strong>${strategy.evidenceRows.toLocaleString()}</strong><span>pre-cutoff historical program rows</span></div><div><strong>${strategy.evidenceFundraisers.toLocaleString()}</strong><span>historical fundraiser/event groups</span></div></div><ul class="strategy-limitations">${strategy.limitations.map(x=>`<li>${esc(x)}</li>`).join('')}<li>${esc(strategy.peerEvidence.note)}</li></ul></section>`;}
function renderStrategy(){
  const schedule=selectedSchedule(),out=$('#strategy-output');
  if(!schedule||!out){
    if(out)out.innerHTML='<div class="report-empty">No upcoming fundraiser is available.</div>';
    return;
  }
  if(!state.analysisReady){
    out.innerHTML='<div class="report-loading-card"><strong>Fundraiser selected.</strong><span>Loading WNMU history and Program Library data for analysis…</span></div>';
    return;
  }
  status('Calculating pre-drive strategy…');
  try{
    const evidence=evidenceBundle(schedule);
    const strategy=S.buildStrategy({schedule,library:state.library,evidenceRows:evidence.rows,overrides:state.overrides,now:new Date()});
    out.innerHTML=`<article class="report-sheet strategy-sheet"><header class="sheet-title"><div><div class="report-kicker">WNMU-TV PBS pre-drive planning</div><h1>Fundraiser Programming Strategy</h1><p>${esc(schedule.title)} · ${fmt(schedule.startDate)}–${fmt(schedule.endDate,false)}</p></div><div class="sheet-stamp">Evidence through ${fmt(strategy.cutoff)}</div></header><section class="strategy-summary"><div><span>Evidence through</span><strong>${fmt(strategy.cutoff)}</strong><small>Future drives are capped at today; historical drives stop before they began.</small></div></section>${topicComparisonSection(strategy)}${dayOutlookSection(schedule,evidence.analyses)}${daypartSection(strategy)}${dayMapSection(strategy)}${supportingSections(strategy)}${rightsSection(strategy)}${limitationsSection(strategy)}</article>`;
    status(`Strategy generated using evidence through ${fmt(strategy.cutoff)}.`,'good');
  }catch(e){
    console.error(e);out.innerHTML=`<div class="report-empty"><strong>Could not generate strategy.</strong><p>${esc(e?.message||e)}</p></div>`;status('Strategy generation failed.','error');
  }
}
async function init(){try{if(!A||!S)throw new Error('Programming strategy analysis modules did not load.');if(!await requireAdmin())return;await loadSchedules();renderStrategy();await loadAnalysisData();}catch(e){console.error(e);status(e?.message||String(e),'error');const out=$('#strategy-output');if(out)out.innerHTML=`<div class="report-empty"><strong>Report could not start.</strong><p>${esc(e?.message||e)}</p></div>`;}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else void init();
})();
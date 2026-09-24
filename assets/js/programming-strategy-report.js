(() => {
'use strict';
const cfg=globalThis.PLEDGE_MANAGER_CONFIG||{};
const state={client:null,schedules:[],scheduleRows:[],airings:[],library:[],overrides:[],peerObservations:[],selectedScheduleId:'',analysisReady:false,worker:null,workerReject:null,workerTimer:null,requestId:0,dataLoadMs:0};
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function parseDate(value){const raw=String(value??'').trim();if(!raw)return null;if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){const[y,m,d]=raw.split('-').map(Number);const out=new Date(y,m-1,d);return Number.isNaN(out.getTime())?null:out;}const out=new Date(raw);return Number.isNaN(out.getTime())?null:out;}
function dateKey(value){const d=value instanceof Date?value:parseDate(value);return d&&!Number.isNaN(d.getTime())?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:'';}
function seasonForDate(value){const d=parseDate(value);if(!d)return'Special';const m=d.getMonth()+1;if(m===2||m===3)return'March';if(m===5||m===6)return'June';if(m===8||m===9)return'August';if(m===11||m===12)return'December';return'Special';}
function median(values=[]){const sorted=(values||[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return null;const mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;}
function fmt(v,year=true){const d=parseDate(v);return d?d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:year?'numeric':undefined}):esc(v||'—');}
function clock(m){m=Number(m);if(!Number.isFinite(m))return'—';m=((m%1440)+1440)%1440;const h=Math.floor(m/60),mi=m%60;return`${h%12||12}${mi?`:${String(mi).padStart(2,'0')}`:''} ${h>=12?'PM':'AM'}`;}
function status(msg,tone=''){const n=$('#strategy-status');if(n){n.textContent=msg||'';n.className=`strategy-status${tone?` ${tone}`:''}`;}}
function makeClient(){if(!globalThis.supabase?.createClient)throw new Error('Supabase library did not load.');if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)throw new Error('Supabase configuration is missing.');return globalThis.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);}
async function requireAdmin(){state.client=makeClient();const{data,error}=await state.client.auth.getSession();if(error)throw error;const session=data?.session||null,email=String(session?.user?.email||'').trim().toLowerCase(),admins=Array.isArray(cfg.ADMIN_EMAILS)?cfg.ADMIN_EMAILS.map(x=>String(x).trim().toLowerCase()).filter(Boolean):[],ok=!!(session&&(!admins.length||admins.includes(email)));if(ok){$('#strategy-access-gate')?.classList.add('hidden');$('#strategy-app')?.classList.remove('hidden');const role=$('#strategy-role');if(role)role.textContent=email?`Admin · ${email}`:'Admin';return true;}$('#strategy-app')?.classList.add('hidden');const gate=$('#strategy-access-gate');if(gate){gate.classList.remove('hidden');gate.innerHTML=`<div class="report-gate-card"><div class="report-kicker">Admin report center</div><h1>Admin access required</h1><p>${esc(session?`${email||'This account'} does not have administrator report access.`:'Sign in as an administrator from the Pledge Program Library, then return to this report.')}</p><a class="report-button primary" href="./">Open Pledge Program Library</a></div>`;}return false;}
async function fetchAll(table,select='*',{orders=['id'],apply=null}={}){
  const pageSize=1000,batchPages=3;
  const fetchPage=async(page)=>{
    let q=state.client.from(table).select(select);
    if(typeof apply==='function')q=apply(q);
    for(const order of orders||[])q=q.order(order,{ascending:true});
    const from=page*pageSize;
    const{data,error}=await q.range(from,from+pageSize-1);
    if(error)throw error;
    return Array.isArray(data)?data:[];
  };
  const first=await fetchPage(0);
  const rows=[...first];
  if(first.length<pageSize)return rows;
  for(let page=1;;page+=batchPages){
    const pages=await Promise.all(Array.from({length:batchPages},(_,i)=>fetchPage(page+i)));
    for(const chunk of pages)rows.push(...chunk);
    if(pages.some(chunk=>chunk.length<pageSize))break;
  }
  return rows;
}
async function fetchOptional(table,select='*',options={}){try{return await fetchAll(table,select,options);}catch(e){console.warn(`Optional report source ${table} unavailable.`,e);return[];}}
function todayStart(){const d=new Date();d.setHours(0,0,0,0);return d;}
function todayKey(){return dateKey(todayStart());}
function defaultSchedule(){return state.schedules[0]||null;}
function scheduleLabel(s){return`${s.title} · ${fmt(s.startDate)}–${fmt(s.endDate,false)}`;}
async function loadSchedules(){
  status('Loading fundraiser history and upcoming choices…');
  let q=state.client.from('pledge_fundraiser_schedules')
    .select('id,title,start_date,end_date,created_at,updated_at,schedule_data')
    .order('start_date',{ascending:true})
    .order('updated_at',{ascending:false});
  const{data,error}=await q;
  if(error)throw error;
  state.scheduleRows=Array.isArray(data)?data:[];
  const byRange=new Map();
  for(const row of state.scheduleRows){
    const startDate=String(row.start_date||'').slice(0,10);
    const endDate=String(row.end_date||'').slice(0,10);
    if(!startDate||!endDate||startDate<todayKey())continue;
    const key=`${startDate}|${endDate}`;
    if(byRange.has(key))continue;
    byRange.set(key,{
      id:String(row.id||''),
      title:String(row.title||'Untitled fundraiser'),
      startDate,
      endDate,
      updatedAt:String(row.updated_at||'')
    });
  }
  state.schedules=[...byRange.values()].sort((a,b)=>a.startDate.localeCompare(b.startDate));
  renderControls();
  status(state.schedules.length
    ?`${state.schedules.length} upcoming fundraiser${state.schedules.length===1?'':'s'} ready. Loading strategy data…`
    :'No upcoming fundraiser is saved yet.');
}
async function loadAnalysisData(){
  const started=globalThis.performance?.now?.()??Date.now();
  const cutoff=todayKey();
  const airingSelect=[
    'id','program_id','pledge_program_id','manual_match_program_id',
    'title','program_title','imported_program_title','matched_library_title','nola_code',
    'air_date','air_time','aired_at','dollars','pledge_count','program_minutes',
    'fundraiser_label','drive_start_date','drive_end_date','station','row_hash','source_file_name','import_batch_id','raw_payload','updated_at','created_at'
  ].join(',');
  const programSelect=[
    'id','title','program_notes','length_bucket_minutes','nola_code','topic_primary','topic_secondary',
    'rights_start','rights_end','rights_notes','distributor','premium_summary','actual_runtime_seconds'
  ].join(',');
  const overrideSelect='program_id,rating,rated_at,updated_at';
  const peerSelect='id,evidence_scope,season,station_code,station_name,program_title_raw,program_title_normalized,matched_program_id,topic_primary,topic_secondary,day_of_week,start_time_minutes,end_time_minutes,daypart,assessment_raw,station_rating,assessment_signal,actual_dollars,goal_dollars,pledge_count,context_flags,evidence_strength,summary';
  const[airings,library,overrides,peerObservations]=await Promise.all([
    fetchAll('pledge_program_airings_v2',airingSelect,{orders:['id']}),
    fetchAll('pledge_programs_v2',programSelect,{orders:['id']}),
    fetchAll('pledge_program_editorial_overrides',overrideSelect,{orders:['program_id']}),
    fetchOptional('pledge_peer_evidence_observations',peerSelect,{orders:['id']})
  ]);
  state.airings=airings;
  state.library=library;
  state.overrides=overrides;
  state.peerObservations=peerObservations;
  state.analysisReady=true;
  state.dataLoadMs=Math.round((globalThis.performance?.now?.()??Date.now())-started);
  status(`Strategy data loaded in ${(state.dataLoadMs/1000).toFixed(1)}s. Building report…`);
  void renderStrategy();
}
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
  select.onchange=()=>{state.selectedScheduleId=select.value;void renderStrategy();};
  $('#strategy-print').onclick=()=>window.print();
}
const selectedSchedule=()=>state.schedules.find(x=>String(x.id)===String(state.selectedScheduleId))||null;

function topicComparisonSection(strategy){
  const rows=strategy.topicComparison||[];
  if(!rows.length)return'<section class="sheet-section"><h2>Topic performance in selected season</h2><p>No eligible topic data is available.</p></section>';
  const season=rows[0]?.season||seasonForDate(strategy.schedule?.startDate)||'selected';
  const evidenceLine=(item)=>{
    if(!item.fundraiserSamples)return'No rate-valid seasonal fundraiser sample yet';
    const seasonalTitles=Number(item.testedTitleCount||0);
    const seasonalFundraisers=Number(item.fundraiserSamples||0);
    const confidenceTitles=Number(item.confidenceTitleCount||seasonalTitles);
    const confidenceFundraisers=Number(item.confidenceFundraiserSamples||seasonalFundraisers);
    const success=Number.isFinite(item.successRate)?Math.round(item.successRate*100):null;
    return `Season: ${seasonalTitles} title${seasonalTitles===1?'':'s'} · ${seasonalFundraisers} fundraiser${seasonalFundraisers===1?'':'s'}${success!=null?` · ${success}% non-zero tests`:''} · All-season depth: ${confidenceTitles} title${confidenceTitles===1?'':'s'} / ${confidenceFundraisers} fundraiser${confidenceFundraisers===1?'':'s'}`;
  };
  const subtopicBreakdown=(topic,items=[])=>{
    if(!items.length)return'';
    return`<div class="strategy-documentary-subtopics"><div class="strategy-documentary-subtopics-title">${esc(topic)} subtopics</div>${items.map(item=>`<div class="strategy-documentary-subtopic"><strong>${esc(item.label)}</strong><span>${item.programCount} title${item.programCount===1?'':'s'} · ${item.eligibleProgramCount} eligible</span><span><span class="strategy-rate">${Number.isFinite(item.averageRate)?`Avg $${Math.round(item.averageRate)}/pledge hr`:'No seasonal performance history'}</span>${item.fundraiserSamples?` · ${esc(evidenceLine(item))}`:''}</span></div>`).join('')}</div>`;
  };
  return`<section class="sheet-section"><div class="strategy-section-head"><div><h2>Topic performance · ${esc(season)} season</h2><p>Only topics with at least one title eligible for this fundraiser are shown. Ranking combines this season’s Avg $ / Pledge Hour, seasonal consistency and sample support, plus the topic’s full all-season WNMU testing depth.</p></div></div><div class="strategy-topic-list">${rows.map(x=>`<div class="strategy-topic-list-row"><div class="strategy-topic-main"><strong>${esc(x.topic)}</strong><small>${x.programCount} Library title${x.programCount===1?'':'s'} · ${x.eligibleProgramCount} eligible for this fundraiser</small></div><div class="strategy-topic-performance"><strong class="strategy-rate">${Number.isFinite(x.averageRate)?`Avg $${Math.round(x.averageRate)}/pledge hr`:'No seasonal history'}</strong><span>${esc(evidenceLine(x))}</span></div>${subtopicBreakdown(x.topic,x.subtopicDetails||[])}</div>`).join('')}</div></section>`;
}

function dayTone(outlook=''){
  const key=String(outlook).toLowerCase();
  if(key.includes('strong')||key.includes('good'))return'good';
  if(key.includes('soft')||key.includes('weak'))return'weak';
  if(key.includes('fair')||key.includes('thin'))return'fair';
  return'neutral';
}

function dayOutlookSection(outlook){
  const data=outlook||{season:'selected',fallback:false,rows:[]};
  return`<section class="sheet-section"><div class="strategy-section-head"><div><h2>Anticipated day strength</h2><p>Compares each fundraiser-day position with the same position in prior ${esc(data.season||'selected')} drives${data.fallback?' (same-season sample was thin, so all historical drives are used as fallback)':''}. Strength is normalized to each historical fundraiser’s own typical day; the displayed Avg $ / Pledge Hour is the factual corresponding-day average.</p></div></div><div class="strategy-day-outlook">${(data.rows||[]).map(x=>`<div class="strategy-day-outlook-row tone-${dayTone(x.outlook)}"><strong>${esc(x.label)}</strong><span class="strategy-day-rating">${esc(x.outlook)}${x.bestBet?' · Best bet':''}</span><span>${x.samples?`${x.samples} comparable historical day${x.samples===1?'':'s'}${Number.isFinite(x.averageRate)?` · <b class="strategy-rate">Avg $${Math.round(x.averageRate)}/pledge hr</b>`:''}`:'No corresponding historical day sample'}</span></div>`).join('')}</div></section>`;
}

function hourlyPatternsSection(hourly){
  const data=hourly||{season:'selected',fallback:false,rows:[]};
  const groups=new Map();
  for(const row of data.rows||[]){
    if(!groups.has(row.weekday))groups.set(row.weekday,[]);
    groups.get(row.weekday).push(row);
  }
  const order=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  return`<section class="sheet-section"><div class="strategy-section-head"><div><h2>Day/time performance</h2><p>Hourly start-time buckets from noon onward. Half-hour starts are included in the hour they begin. Values use fundraiser-balanced Avg $ / Pledge Hour for the ${esc(data.season||'selected')} season${data.fallback?' with all-season fallback because same-season history is thin':''}.</p></div></div><div class="strategy-hourly-grid">${order.map(day=>{const rows=(groups.get(day)||[]).sort((a,b)=>a.startMinutes-b.startMinutes);return`<section class="strategy-hourly-day"><h3>${day}</h3><div>${rows.map(x=>`<div class="strategy-hourly-row"><span class="strategy-hourly-time">${clock(x.startMinutes)}–${clock(x.endMinutes)}</span><span class="strategy-rate">${Number.isFinite(x.averageRate)?`Avg $${Math.round(x.averageRate)}/pledge hr`:'No history'}</span><small>${x.fundraiserSamples?`${x.fundraiserSamples} fundraiser${x.fundraiserSamples===1?'':'s'} · ${x.airings} airing${x.airings===1?'':'s'}`:'No fundraiser sample'}</small></div>`).join('')}</div></section>`}).join('')}</div></section>`;
}

function opportunitiesSection(opportunities){
  const data=opportunities||{rows:[]};
  const rows=data.rows||[];
  const evidenceList=(x)=>{
    const items=Array.isArray(x.evidenceItems)?x.evidenceItems:[];
    if(!items.length)return'';
    return`<div class="strategy-opportunity-evidence"><strong>Why explore this?</strong><ul>${items.map(item=>`<li class="evidence-${esc(item.tone||'neutral')}"><b>${esc(item.sourceLabel||'Evidence')}:</b> ${esc(item.text||'')}</li>`).join('')}</ul></div>`;
  };
  return`<section class="sheet-section"><div class="strategy-section-head"><div><h2>Scheduling opportunities / tests</h2><p>Each weekly timeslot appears once. A test is shown only with visible evidence explaining why it may be worth trying or why limited WNMU history is not conclusive.</p></div></div>${rows.length?`<div class="strategy-opportunity-list">${rows.map(x=>`<div class="strategy-opportunity-row opportunity-${esc(x.kind)}"><div><strong>${esc(x.weekday)} · ${clock(x.startMinutes)}–${clock(x.endMinutes)}</strong><span>${esc(x.label)}</span></div><div><span class="strategy-rate">${Number.isFinite(x.averageRate)?`Avg ${Math.round(x.averageRate)}/pledge hr`:'No reliable average yet'}</span><small>${x.fundraiserSamples} fundraiser sample${x.fundraiserSamples===1?'':'s'} · ${x.airings} airing${x.airings===1?'':'s'}</small></div>${evidenceList(x)}</div>`).join('')}</div>`:'<p>No distinct exploratory timeslot currently has enough evidence to justify a test.</p>'}</section>`;
}

function dayMapSection(strategy){
  const byDate=new Map();
  for(const slot of strategy.windows){if(!byDate.has(slot.date))byDate.set(slot.date,[]);byDate.get(slot.date).push(slot);}
  return`<section class="sheet-section"><h2>Day-by-day programming map</h2><p>Compact planning view. Each candidate is one row; evidence and cautions stay visible without large title cards.</p><div class="strategy-days-compact">${[...byDate.entries()].map(([date,slots])=>`<section class="strategy-day-compact"><header><strong>${esc(slots[0].weekday)}</strong><span>${fmt(date)}</span></header><div class="strategy-program-table"><div class="strategy-program-row strategy-program-head"><span>Time</span><span>Title / topic</span><span>Evidence</span><span>Fit</span></div>${slots.map(slot=>{
    if(slot.blocked)return`<div class="strategy-window-divider is-blocked"><strong>${clock(slot.startMinutes)}–${clock(slot.endMinutes)} · Protected regular programming</strong><span>Not pledge inventory.</span></div>`;
    const exp=slot.experimentalEvidence||{};
    const divider=`<div class="strategy-window-divider ${slot.experimental?'is-experimental':''}"><strong>${clock(slot.startMinutes)}–${clock(slot.endMinutes)} · ${esc(slot.label)}${slot.experimental?' · Test window':''}</strong><span>${slot.experimental?'See scheduling opportunities / tests above.':(slot.evidenceRows?`${slot.evidenceRows} exact-weekday comparable historical row${slot.evidenceRows===1?'':'s'}`:'No exact-weekday slot history')}</span></div>`;
    const rows=slot.recommendations.slice(0,4).map(x=>`<div class="strategy-program-row"><span class="strategy-program-time">${clock(slot.startMinutes)}</span><span class="strategy-program-title"><strong>${esc(x.title)}${x.newTitle?'<span class="strategy-new-title">NEW</span>':''}</strong><small>${esc(x.topic)}${x.secondary?` · ${esc(x.secondary)}`:''}${x.programmer?.rating?` · Programmer: ${esc(x.programmer.label)}`:''}</small></span><span class="strategy-program-evidence"><b>${esc(x.confidence)}</b> · ${esc((x.newTitle&&x.reviewedNew?x.reasons.find(r=>/^New \/ unaired/i.test(r)):null)||x.reasons[0]||'No direct title history.')}${x.cautions.length?` <em>${esc(x.cautions[0])}</em>`:''}</span><span class="strategy-program-fit"><b>${Math.round(x.score)}</b><small>${esc(x.fit)}</small></span></div>`).join('');
    return divider+(rows||'<div class="strategy-program-empty">No eligible Program Library title for this slot.</div>');
  }).join('')}</div></section>`).join('')}</div></section>`;
}

function compact(items,renderer,empty){return items?.length?`<div class="strategy-compact-list">${items.map(renderer).join('')}</div>`:`<p>${esc(empty)}</p>`;}
function supportingSections(strategy){return`<section class="sheet-section strategy-two-column"><div><h2>Repeat candidates</h2>${compact(strategy.repeats,x=>`<div><strong>${esc(x.title)}</strong><span>${esc(x.topic)} · score ${Math.round(x.score)} · supported on ${x.slots.length} separated prime windows.</span></div>`,'No repeat candidate clears the threshold.')}<h2>Seasonal opportunities</h2>${compact(strategy.seasonal,x=>`<div><strong>${esc(x.title)}</strong><span>${esc(x.topic)} · ${esc(x.season.notes.join(' ')||`${x.season.targetSeason} seasonal support`)}</span></div>`,'No distinct seasonal opportunity identified.')}</div><div><h2>Local / U.P. opportunities</h2>${compact(strategy.local,x=>`<div><strong>${esc(x.title)}</strong><span>${esc(x.topic)} · best-window score ${Math.round(x.score)} · ${esc(x.fit)}</span></div>`,'No eligible Local / U.P. title identified.')}<h2>Titles to avoid / rest</h2>${compact(strategy.avoid,x=>`<div><strong>${esc(x.title)}</strong><span>${esc(x.reasons.join(' · '))}</span></div>`,'No title needs a prominent rest/avoid caution.')}</div></section>`;}
function rightsSection(strategy){const desc=x=>`${x.rightsStart?`Starts ${fmt(x.rightsStart)}`:''}${x.rightsStart&&x.rightsEnd?' · ':''}${x.rightsEnd?`Ends ${fmt(x.rightsEnd)}`:''}`;return`<section class="sheet-section strategy-two-column"><div><h2>Rights constraints</h2>${compact(strategy.rights.unavailable.slice(0,20),x=>`<div><strong>${esc(x.title)}</strong><span>${esc(desc(x))}</span></div>`,'No fully unavailable title detected.')}</div><div><h2>Partial-drive rights</h2>${compact(strategy.rights.partial.slice(0,20),x=>`<div><strong>${esc(x.title)}</strong><span>${esc(desc(x))}</span></div>`,'No partial-drive rights restriction detected.')}</div></section>`;}
function limitationsSection(strategy){return`<section class="sheet-section"><h2>Evidence confidence & limitations</h2><div class="strategy-facts"><div><strong>${strategy.evidenceRows.toLocaleString()}</strong><span>pre-cutoff historical program rows</span></div><div><strong>${strategy.evidenceFundraisers.toLocaleString()}</strong><span>historical fundraiser/event groups</span></div></div><ul class="strategy-limitations">${strategy.limitations.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>`;}
function clearStrategyWorkerTimer(){if(state.workerTimer){globalThis.clearTimeout(state.workerTimer);state.workerTimer=null;}}
function stopStrategyWorker(reason='Superseded'){
  clearStrategyWorkerTimer();
  if(state.workerReject){
    const reject=state.workerReject;
    state.workerReject=null;
    reject(new Error(reason));
  }
  if(state.worker){
    state.worker.terminate();
    state.worker=null;
  }
}
function runStrategyWorker(schedule){
  stopStrategyWorker('Superseded');
  const requestId=++state.requestId;
  return new Promise((resolve,reject)=>{
    let worker;
    try{
      worker=new Worker('assets/js/programming-strategy-worker.js?v=0.22.195');
    }catch(error){
      reject(error);
      return;
    }
    state.worker=worker;
    state.workerReject=reject;
    state.workerTimer=globalThis.setTimeout(()=>{
      if(state.worker!==worker)return;
      state.workerReject=null;
      state.workerTimer=null;
      worker.terminate();
      state.worker=null;
      reject(new Error('Strategy analysis exceeded 90 seconds and was stopped. Reload the report and try again.'));
    },90000);
    worker.onmessage=(event)=>{
      const message=event.data||{};
      if(message.requestId!==requestId)return;
      if(message.type==='progress'){
        status(message.message||'Building strategy…');
        return;
      }
      if(message.type==='error'){
        clearStrategyWorkerTimer();
        state.workerReject=null;
        worker.terminate();
        if(state.worker===worker)state.worker=null;
        reject(new Error(message.message||'Strategy worker failed.'));
        return;
      }
      if(message.type==='result'){
        clearStrategyWorkerTimer();
        state.workerReject=null;
        worker.terminate();
        if(state.worker===worker)state.worker=null;
        resolve(message);
      }
    };
    worker.onerror=(event)=>{
      clearStrategyWorkerTimer();
      state.workerReject=null;
      worker.terminate();
      if(state.worker===worker)state.worker=null;
      reject(new Error(event?.message||'Strategy worker failed to load.'));
    };
    try{
      worker.postMessage({
        requestId,
        schedule,
        library:state.library,
        airings:state.airings,
        overrides:state.overrides,
        scheduleRows:state.scheduleRows,
        peerObservations:state.peerObservations,
        now:new Date().toISOString()
      });
    }catch(error){
      clearStrategyWorkerTimer();
      state.workerReject=null;
      worker.terminate();
      if(state.worker===worker)state.worker=null;
      reject(error);
    }
  });
}

async function renderStrategy(){
  const schedule=selectedSchedule(),out=$('#strategy-output');
  if(!schedule||!out){
    stopStrategyWorker('No fundraiser selected');
    if(out)out.innerHTML='<div class="report-empty">No upcoming fundraiser is available.</div>';
    return;
  }
  if(!state.analysisReady){
    out.innerHTML='<div class="report-loading-card"><strong>Fundraiser selected.</strong><span>Loading WNMU history and Program Library data for analysis…</span></div>';
    return;
  }

  out.innerHTML='<div class="report-loading-card"><strong>Building strategy…</strong><span>The analysis is running off the page’s UI thread, so this screen should remain responsive.</span></div>';
  status('Starting strategy analysis…');
  await new Promise(resolve=>{
    const raf=globalThis.requestAnimationFrame||((callback)=>globalThis.setTimeout(callback,0));
    raf(()=>resolve());
  });

  try{
    const result=await runStrategyWorker(schedule);
    const strategy=result.strategy||{};
    const dayOutlook=result.dayOutlook||{};
    const hourlyPatterns=result.hourlyPatterns||{};
    const opportunities=result.opportunities||{};
    const diagnostics=result.diagnostics||{};
    const renderStarted=globalThis.performance?.now?.()??Date.now();

    out.innerHTML=`<article class="report-sheet strategy-sheet"><header class="sheet-title"><div><div class="report-kicker">WNMU-TV PBS pre-drive planning</div><h1>Fundraiser Programming Strategy</h1><p>${esc(schedule.title)} · ${fmt(schedule.startDate)}–${fmt(schedule.endDate,false)}</p></div></header>${topicComparisonSection(strategy)}${dayOutlookSection(dayOutlook)}${hourlyPatternsSection(hourlyPatterns)}${opportunitiesSection(opportunities)}${dayMapSection(strategy)}${supportingSections(strategy)}${rightsSection(strategy)}${limitationsSection(strategy)}</article>`;
    globalThis.WNMUStrategyEnhancements?.decorate?.(out,result);

    const renderMs=Math.round((globalThis.performance?.now?.()??Date.now())-renderStarted);
    const perf={
      dataLoadMs:state.dataLoadMs,
      workerTotalMs:Number(diagnostics.totalMs||0),
      prepareMs:Number(diagnostics.prepareMs||0),
      strategyMs:Number(diagnostics.strategyMs||0),
      dayOutlookMs:Number(diagnostics.dayOutlookMs||0),
      renderMs,
      rawAirings:Number(diagnostics.rawAirings||0),
      canonicalAirings:Number(diagnostics.canonicalAirings||0),
      evidenceRows:Number(diagnostics.evidenceRows||0)
    };
    console.info('[Fundraiser Programming Strategy performance]',perf);
    status(`Strategy ready · data ${(perf.dataLoadMs/1000).toFixed(1)}s · analysis ${(perf.workerTotalMs/1000).toFixed(1)}s · render ${(perf.renderMs/1000).toFixed(1)}s.`,'good');
  }catch(e){
    if(e?.message==='Superseded'||e?.message==='No fundraiser selected')return;
    console.error(e);
    out.innerHTML=`<div class="report-empty"><strong>Could not generate strategy.</strong><p>${esc(e?.message||e)}</p></div>`;
    status('Strategy generation failed.','error');
  }
}
async function init(){try{if(!await requireAdmin())return;await loadSchedules();void renderStrategy();await loadAnalysisData();}catch(e){console.error(e);status(e?.message||String(e),'error');const out=$('#strategy-output');if(out)out.innerHTML=`<div class="report-empty"><strong>Report could not start.</strong><p>${esc(e?.message||e)}</p></div>`;}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else void init();
})();
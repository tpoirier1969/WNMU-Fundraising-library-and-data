(() => {
'use strict';
const cfg=globalThis.PLEDGE_MANAGER_CONFIG||{};
const state={client:null,schedules:[],scheduleRows:[],airings:[],library:[],overrides:[],peerObservations:[],worker:null,workerTimer:null,requestId:0,loaded:false};
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function parseDate(value){const raw=String(value??'').trim();if(!raw)return null;if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){const[y,m,d]=raw.split('-').map(Number);const out=new Date(y,m-1,d);return Number.isNaN(out.getTime())?null:out;}const out=new Date(raw);return Number.isNaN(out.getTime())?null:out;}
function dateKey(value){const d=value instanceof Date?value:parseDate(value);return d&&!Number.isNaN(d.getTime())?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:'';}
function todayKey(){const d=new Date();d.setHours(0,0,0,0);return dateKey(d);}
function fmtDate(v){const d=parseDate(v);return d?d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'—';}
function money(v){const n=Number(v);return Number.isFinite(n)?n.toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0}):'—';}
function rate(v){const n=Number(v);return Number.isFinite(n)?`${money(n)}/hr`:'—';}
function pct(v){const n=Number(v);return Number.isFinite(n)?`${Math.round(n*100)}%`:'—';}
function corr(v){const n=Number(v);return Number.isFinite(n)?n.toFixed(2):'Not enough tested titles';}
function status(msg,tone=''){const node=$('#backtest-status');if(node){node.textContent=msg||'';node.className=`strategy-status${tone?` ${tone}`:''}`;}}
function makeClient(){if(!globalThis.supabase?.createClient)throw new Error('Supabase library did not load.');if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)throw new Error('Supabase configuration is missing.');return globalThis.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);}
async function requireAdmin(){
  state.client=makeClient();
  const{data,error}=await state.client.auth.getSession();
  if(error)throw error;
  const session=data?.session||null,email=String(session?.user?.email||'').trim().toLowerCase();
  const admins=Array.isArray(cfg.ADMIN_EMAILS)?cfg.ADMIN_EMAILS.map(x=>String(x).trim().toLowerCase()).filter(Boolean):[];
  const ok=!!(session&&(!admins.length||admins.includes(email)));
  if(ok){
    $('#backtest-access-gate')?.classList.add('hidden');
    $('#backtest-app')?.classList.remove('hidden');
    const role=$('#backtest-role');if(role)role.textContent=email?`Admin · ${email}`:'Admin';
    return true;
  }
  $('#backtest-app')?.classList.add('hidden');
  const gate=$('#backtest-access-gate');
  if(gate){gate.classList.remove('hidden');gate.innerHTML=`<div class="report-gate-card"><div class="report-kicker">Admin report center</div><h1>Admin access required</h1><p>${esc(session?`${email||'This account'} does not have administrator report access.`:'Sign in as an administrator from the Pledge Program Library, then return to this report.')}</p><a class="report-button primary" href="./">Open Pledge Program Library</a></div>`;}
  return false;
}
async function fetchAll(table,select='*',{orders=['id']}={}){
  const pageSize=1000,batchPages=3;
  const page=async(index)=>{let q=state.client.from(table).select(select);for(const order of orders||[])q=q.order(order,{ascending:true});const from=index*pageSize;const{data,error}=await q.range(from,from+pageSize-1);if(error)throw error;return Array.isArray(data)?data:[];};
  const first=await page(0),rows=[...first];if(first.length<pageSize)return rows;
  for(let p=1;;p+=batchPages){const pages=await Promise.all(Array.from({length:batchPages},(_,i)=>page(p+i)));for(const part of pages)rows.push(...part);if(pages.some(part=>part.length<pageSize))break;}
  return rows;
}
async function fetchOptional(table,select='*',options={}){try{return await fetchAll(table,select,options);}catch(error){console.warn(`Optional backtest source ${table} unavailable.`,error);return[];}}
async function loadSchedules(){
  status('Loading historical fundraiser schedules…');
  let q=state.client.from('pledge_fundraiser_schedules').select('id,title,start_date,end_date,created_at,updated_at,schedule_data').order('start_date',{ascending:false}).order('updated_at',{ascending:false});
  const{data,error}=await q;if(error)throw error;
  state.scheduleRows=Array.isArray(data)?data:[];
  const byRange=new Map(),today=todayKey();
  for(const row of state.scheduleRows){
    const startDate=String(row.start_date||'').slice(0,10),endDate=String(row.end_date||'').slice(0,10);
    if(!startDate||!endDate||endDate>=today)continue;
    const key=`${startDate}|${endDate}`;if(byRange.has(key))continue;
    byRange.set(key,{id:String(row.id||''),title:String(row.title||'Untitled fundraiser'),startDate,endDate,updatedAt:String(row.updated_at||'')});
  }
  state.schedules=[...byRange.values()].sort((a,b)=>b.startDate.localeCompare(a.startDate));
  const select=$('#backtest-fundraiser');
  if(!state.schedules.length){select.innerHTML='<option value="">No completed fundraiser schedules</option>';select.disabled=true;$('#backtest-run').disabled=true;status('No completed fundraiser schedules are available.','warn');return;}
  select.innerHTML=state.schedules.map(s=>`<option value="${esc(s.id)}">${esc(s.title)} · ${esc(fmtDate(s.startDate))}–${esc(fmtDate(s.endDate))}</option>`).join('');
}
async function loadData(){
  status('Loading Program Library and historical pledge results…');
  const airingSelect=['id','program_id','pledge_program_id','manual_match_program_id','title','program_title','imported_program_title','matched_library_title','nola_code','air_date','air_time','aired_at','dollars','pledge_count','program_minutes','fundraiser_label','drive_start_date','drive_end_date','station','row_hash','source_file_name','import_batch_id','raw_payload','updated_at','created_at'].join(',');
  const programSelect=['id','title','program_notes','length_bucket_minutes','nola_code','topic_primary','topic_secondary','rights_start','rights_end','rights_notes','distributor','premium_summary','actual_runtime_seconds'].join(',');
  const peerSelect='id,evidence_scope,season,station_code,station_name,program_title_raw,program_title_normalized,matched_program_id,topic_primary,topic_secondary,day_of_week,start_time_minutes,end_time_minutes,daypart,assessment_raw,station_rating,assessment_signal,actual_dollars,goal_dollars,pledge_count,context_flags,evidence_strength,summary';
  const[airings,library,overrides,peerObservations]=await Promise.all([
    fetchAll('pledge_program_airings_v2',airingSelect,{orders:['id']}),
    fetchAll('pledge_programs_v2',programSelect,{orders:['id']}),
    fetchAll('pledge_program_editorial_overrides','program_id,rating,rated_at,updated_at',{orders:['program_id']}),
    fetchOptional('pledge_peer_evidence_observations',peerSelect,{orders:['id']})
  ]);
  Object.assign(state,{airings,library,overrides,peerObservations,loaded:true});
  status('Historical data loaded. Choose a fundraiser and run the backtest.');
}
function selectedSchedule(){const id=$('#backtest-fundraiser')?.value;return state.schedules.find(x=>String(x.id)===String(id))||null;}
function stopWorker(){if(state.workerTimer){clearTimeout(state.workerTimer);state.workerTimer=null;}if(state.worker){state.worker.terminate();state.worker=null;}}
function runWorker(schedule){
  stopWorker();const requestId=++state.requestId;
  return new Promise((resolve,reject)=>{
    const worker=new Worker('assets/js/programming-strategy-worker.js?v=0.22.210');state.worker=worker;
    state.workerTimer=setTimeout(()=>{stopWorker();reject(new Error('Backtest exceeded 90 seconds and was stopped.'));},90000);
    worker.onmessage=(event)=>{
      const msg=event.data||{};if(msg.requestId!==requestId)return;
      if(msg.type==='progress'){status(msg.message||'Running backtest…');return;}
      if(msg.type==='error'){stopWorker();reject(new Error(msg.message||'Backtest worker failed.'));return;}
      if(msg.type==='result'){stopWorker();resolve(msg);}
    };
    worker.onerror=(event)=>{stopWorker();reject(new Error(event?.message||'Backtest worker failed to load.'));};
    worker.postMessage({requestId,mode:'backtest',recommendationLimit:20,schedule,library:state.library,airings:state.airings,overrides:state.overrides,scheduleRows:state.scheduleRows,peerObservations:state.peerObservations,now:new Date().toISOString()});
  });
}
function metric(value,label){return `<div class="backtest-metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`;}
function recommendationRows(rows=[]){
  if(!rows.length)return '<p class="backtest-empty">No recommendation rows to compare.</p>';
  return `<table class="backtest-table"><thead><tr><th class="num">#</th><th>Recommended title</th><th class="num">Model score</th><th>What actually happened</th></tr></thead><tbody>${rows.map(x=>{
    const outcome=!x.observed
      ?'<span class="backtest-outcome-untested">Not aired · untestable</span>'
      :`<span class="${x.aboveMedian?'backtest-outcome-good':'backtest-outcome-low'}">${esc(rate(x.actualRate))}</span><span class="backtest-sub">${esc(money(x.actualDollars))} · ${x.actualAirings} airing${x.actualAirings===1?'':'s'}${x.topQuartile?' · top quartile':''}</span>`;
    return `<tr><td class="num">${x.recommendationRank}</td><td><span class="backtest-title">${esc(x.title)}</span><span class="backtest-sub">${esc(x.topic)} · ${x.normalWindows} normal window${x.normalWindows===1?'':'s'}${x.experimentalWindows?` · ${x.experimentalWindows} experimental`:''}</span></td><td class="num">${Number.isFinite(Number(x.score))?Math.round(Number(x.score)):'—'}</td><td>${outcome}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function simpleList(rows=[],type){
  if(!rows.length)return '<p class="backtest-empty">None in this backtest.</p>';
  return `<div class="backtest-list">${rows.map(x=>{
    const detail=type==='missed'
      ?`${rate(x.rate)} · ${money(x.dollars)} · ${x.airings} airing${x.airings===1?'':'s'}`
      : type==='untested'
        ?`Model score ${Math.round(Number(x.score)||0)} · not aired in this fundraiser`
        :`Model score ${Math.round(Number(x.score)||0)} · actual ${rate(x.actualRate)} · ${money(x.actualDollars)}`;
    return `<article><strong>${esc(x.title)}</strong><span class="backtest-sub">${esc(x.topic||'Uncategorized')} · ${esc(detail)}</span></article>`;
  }).join('')}</div>`;
}
function render(result){
  const b=result.backtest,out=$('#backtest-output');
  if(!b){out.innerHTML='<section class="backtest-intro"><strong>No backtest result was returned.</strong></section>';return;}
  const s=b.summary,drive=b.drive,safe=b.leakageSafe&&b.targetScheduleFound!==false;
  const correlation=Number.isFinite(Number(s.scoreRateCorrelation))?Number(s.scoreRateCorrelation):null;
  out.innerHTML=`<div class="backtest-sheet">
    <section class="backtest-verdict">
      <div><h2>${esc(b.schedule.title||'Historical fundraiser')}</h2><p>${esc(fmtDate(b.schedule.startDate))}–${esc(fmtDate(b.schedule.endDate))} · actual drive ${esc(rate(drive.rate))} across ${drive.titleCount} measured title${drive.titleCount===1?'':'s'}</p></div>
      <div class="backtest-cutoff"><span class="backtest-badge ${safe?'good':'bad'}">${safe?'No future leakage detected':'Cutoff problem detected'}</span><span class="backtest-badge">Evidence through ${esc(fmtDate(b.cutoff))}</span></div>
    </section>
    <section class="backtest-metrics">
      ${metric(`${s.testedRecommendations}/${s.recommendedTitles}`,'recommended titles that actually aired and can be tested')}
      ${metric(`${s.aboveMedianHits}/${s.testedRecommendations||0}`,'tested recommendations above this drive’s median title rate')}
      ${metric(`${s.topQuartileHits}/${s.testedRecommendations||0}`,'tested recommendations that landed in the drive’s top quartile')}
      ${metric(s.topActualTitles?pct(s.topActualCoverage):'—','top-quartile performers inside recommendation inventory covered by the recommendation set')}
      ${metric(corr(correlation),'model-score / actual-rate correlation; requires at least 3 tested titles')}
    </section>
    <section class="backtest-section"><h2>Recommendation answer sheet</h2><p>This is the useful comparison. “Not aired” is not a miss; it is a counterfactual we cannot grade.</p>${recommendationRows(b.recommendationResults)}</section>
    <section class="backtest-section"><h2>Strong actual performers the model missed</h2><p>Top-quartile titles that aired inside a window the model was allowed to schedule, but did not appear in its top recommendation set. These are the cleanest places to look for weak weighting or missing context.</p>${simpleList(b.missedTopPerformers,'missed')}</section>
    <section class="backtest-section"><h2>Strong performers outside recommendation inventory</h2><p>These titles performed strongly, but only in times the recommendation engine was not allowed to fill. They remain valid pledge-performance evidence without counting as missed scheduling choices.</p>${simpleList(b.strongOutsideRecommendationInventory,'missed')}</section>
    <section class="backtest-section"><h2>High-score recommendations that underperformed</h2><p>Recommended titles that actually aired but finished below the fundraiser’s median title rate. These can expose over-weighted history, insufficient fatigue penalties, poor seasonal logic, or a bad-night anomaly.</p>${simpleList(b.underperformingRecommendations,'under')}</section>
    <section class="backtest-section"><h2>Untestable recommendations</h2><p>These were recommended by the frozen model but WNMU did not air them in this fundraiser. They remain hypotheses, not losses.</p>${simpleList(b.untestedRecommendations,'untested')}</section>
    <section class="backtest-section backtest-method"><h2>Method and limitations</h2><ul>${(b.notes||[]).map(x=>`<li>${esc(x)}</li>`).join('')}<li>${Number(result.diagnostics?.excludedPostCutoffOverrides||0)} programmer rating${Number(result.diagnostics?.excludedPostCutoffOverrides||0)===1?' was':'s were'} entered after the evidence cutoff and excluded from this historical run.</li><li>Actual performance is aggregated by title using reconciled fundraiser schedule duration and broadcast dollars.</li><li>The top-quartile and median comparisons are within this fundraiser, so they help diagnose ranking behavior without pretending every drive has the same dollar scale.</li></ul></section>
  </div>`;
}
async function run(){
  if(!state.loaded){status('Historical data is still loading…');return;}
  const schedule=selectedSchedule();if(!schedule){status('Choose a historical fundraiser.','warn');return;}
  const button=$('#backtest-run');if(button)button.disabled=true;
  try{status(`Freezing the model before ${schedule.title}…`);const result=await runWorker(schedule);render(result);status(`Backtest complete: ${schedule.title}.`,'success');}
  catch(error){console.error(error);status(error.message||String(error),'error');}
  finally{if(button)button.disabled=false;}
}
async function init(){
  try{
    if(!await requireAdmin())return;
    $('#backtest-run')?.addEventListener('click',()=>void run());
    $('#backtest-fundraiser')?.addEventListener('change',()=>{const out=$('#backtest-output');if(out)out.innerHTML='<section class="backtest-intro"><strong>Ready to rerun.</strong><p>The selected fundraiser will be hidden from the recommendation evidence and used only afterward for outcome comparison.</p></section>';});
    await loadSchedules();
    if(state.schedules.length)await loadData();
  }catch(error){console.error(error);status(error.message||String(error),'error');}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void init(),{once:true});else void init();
})();
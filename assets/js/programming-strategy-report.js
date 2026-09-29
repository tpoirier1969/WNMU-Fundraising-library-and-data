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
  if(!rows.length)return '<section class="sheet-section strategy-topic-performance-section"><h2>Topic performance</h2><p>No topic data is available.</p></section>';
  const season=rows[0]?.season||seasonForDate(strategy.schedule?.startDate)||'selected';
  const topicCard=(item)=>{
    const numericRate=Number(item.averageRate);
    const rate=Number.isFinite(numericRate)?'&#36;'+Math.round(numericRate)+'/hr':'No seasonal history';
    const samples=Number(item.fundraiserSamples||0);
    const tested=Number(item.testedTitleCount||0);
    const eligible=Number(item.eligibleProgramCount||0);
    const allTitles=Number(item.programCount||0);
    const subtopics=Array.isArray(item.subtopicDetails)?item.subtopicDetails:[];
    const subtopicHtml=subtopics.length
      ? '<details class="strategy-topic-subtopics"><summary>Show subtopics ('+subtopics.length+')</summary><div>'+subtopics.map(sub=>{
          const sr=Number(sub.averageRate);
          const subRate=Number.isFinite(sr)?'&#36;'+Math.round(sr)+'/hr':'—';
          const count=Number(sub.programCount||0);
          const elig=Number(sub.eligibleProgramCount||0);
          return '<span><b>'+esc(sub.label)+'</b><strong class="strategy-rate">'+subRate+'</strong><small>'+count+' title'+(count===1?'':'s')+' · '+elig+' eligible</small></span>';
        }).join('')+'</div></details>'
      : '';
    const evidence=samples
      ? samples+' fundraiser'+(samples===1?'':'s')+' · '+tested+' tested title'+(tested===1?'':'s')
      : 'No rate-valid seasonal fundraiser sample';
    return '<article class="strategy-topic-card"><header><strong>'+esc(item.topic)+'</strong><span class="strategy-rate">'+rate+'</span></header><p>'+allTitles+' Library title'+(allTitles===1?'':'s')+' · '+eligible+' eligible</p><small>'+evidence+'</small>'+subtopicHtml+'</article>';
  };
  return '<section class="sheet-section strategy-topic-performance-section"><div class="strategy-section-head"><div><h2>Topic performance · '+esc(season)+' season</h2><p>All Program Library topics are shown. Current eligibility is listed separately from historical performance, and subtopics can be expanded when you want the extra detail.</p></div></div><div class="strategy-topic-card-grid">'+rows.map(topicCard).join('')+'</div></section>';
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
  return`<section class="sheet-section"><div class="strategy-section-head"><div><h2>Anticipated day strength</h2><p>Compares each fundraiser-day position with the same position in prior ${esc(data.season||'selected')} drives${data.fallback?' (same-season sample was thin, so all historical drives are used as fallback)':''}. Strength is normalized to each historical fundraiser’s own typical day; the displayed Avg $ / Pledge Hour is the factual corresponding-day average.</p></div></div><div class="strategy-day-outlook">${(data.rows||[]).map(x=>`<div class="strategy-day-outlook-row tone-${dayTone(x.outlook)}"><strong>${esc(x.label)}</strong><span class="strategy-day-rating">${esc(x.outlook)}${x.bestBet?' · Best bet':''}</span><span>${x.samples?`${x.samples} comparable historical day${x.samples===1?'':'s'}${Number.isFinite(x.averageRate)?` · <b class="strategy-rate">Avg ${Math.round(x.averageRate)}/pledge hr</b>`:''}`:'No corresponding historical day sample'}</span></div>`).join('')}</div></section>`;
}


function scheduleOccurrenceForDate(schedule={},dateKey=''){
  const start=new Date(String(schedule.startDate||'')+'T12:00:00');
  const target=new Date(String(dateKey||'')+'T12:00:00');
  if(Number.isNaN(start.getTime())||Number.isNaN(target.getTime())||target<start)return null;
  let occurrence=0;
  for(let cursor=new Date(start);cursor<=target;cursor.setDate(cursor.getDate()+1)){
    if(cursor.getDay()===target.getDay())occurrence+=1;
  }
  return occurrence||null;
}

function daySchedulingAction(day={},signals=[]){
  const outlook=String(day?.outlook||'').toLowerCase();
  const hasSignal=Array.isArray(signals)&&signals.length>0;
  if(outlook.includes('usually weak')||outlook.includes('usually soft')){
    return hasSignal
      ?'Concentrate pledge hours in the strongest topic/time pockets shown here; a weak day does not mean every program on the day is weak.'
      :'Consider fewer discretionary pledge hours on this day unless a strong title-specific reason overrides the broad history.';
  }
  if(outlook.includes('usually strong')||outlook.includes('usually good')){
    return hasSignal
      ?'This day can support a broader pledge effort, with the strongest topic/time pockets used as anchors.'
      :'The day itself has favorable history, but title and topic choices still matter.';
  }
  if(outlook.includes('thin')||outlook.includes('no comparable')){
    return hasSignal
      ?'Use the topic/time evidence as the stronger guide; the day-level sample is too thin to carry much weight.'
      :'Treat the day cautiously until stronger WNMU evidence exists.';
  }
  return hasSignal
    ?'Use the topic/time signals to decide where to concentrate effort; the day-level average is context, not a score for every program.'
    :'Treat the day-level average as broad context, not as proof that every program on the day performs the same.';
}

function combinedDayTopicSection(outlook,matrix,schedule){
  const dayData=outlook||{season:'selected',fallback:false,rows:[]};
  const matrixRows=Array.isArray(matrix?.rows)?matrix.rows:[];
  const actualDays=Array.isArray(dayData.rows)?dayData.rows:[];

  const dayRows=actualDays.map(day=>{
    const date=new Date(String(day.date||'')+'T12:00:00');
    const weekdayIndex=Number.isNaN(date.getTime())?null:date.getDay();
    const occurrence=scheduleOccurrenceForDate(schedule,day.date);
    const matching=matrixRows.filter(row=>row.weekdayIndex===weekdayIndex);
    const topicSignals=[];

    matching.forEach(row=>{
      const position=(row.positionBreakdown||[]).find(item=>Number(item.occurrence)===Number(occurrence));
      if(!position)return;
      (position.localTopics||[]).forEach(topic=>{
        const samples=Number(topic.fundraiserSamples||0);
        const titles=Number(topic.titleCount||0);
        const rate=Number(topic.averageRate);
        if(samples<2||titles<2||!Number.isFinite(rate))return;
        topicSignals.push({
          daypart:row.daypart,
          topic:topic.topic,
          rate,
          samples,
          titles
        });
      });
    });
    topicSignals.sort((a,b)=>b.rate-a.rate||b.samples-a.samples||b.titles-a.titles);

    return{...day,occurrence,topicSignals:topicSignals.slice(0,3)};
  });

  const peerGaps=[];
  const seenPeer=new Set();
  matrixRows.forEach(row=>{
    const positives=Number(row.peer?.positiveStations||0);
    if(positives<2)return;
    const key=`${row.weekdayIndex}|${row.daypartId}`;
    if(seenPeer.has(key))return;
    seenPeer.add(key);
    peerGaps.push({
      weekday:row.weekday,
      daypart:row.daypart,
      positives,
      topics:(row.peer?.topTopics||[]).map(item=>item.topic).filter(Boolean)
    });
  });
  peerGaps.sort((a,b)=>b.positives-a.positives||a.weekday.localeCompare(b.weekday));

  const peerHtml=peerGaps.length
    ?`<div class="strategy-day-topic-peer"><strong>Under-tested windows supported by peers</strong>${peerGaps.slice(0,4).map(item=>`<span><b>${esc(item.weekday)} · ${esc(item.daypart)}</b> · ${item.positives} positive independent peer station${item.positives===1?'':'s'}${item.topics.length?` · ${esc(item.topics.join(', '))}`:''}</span>`).join('')}<small>Peer evidence justifies a test; it does not predict WNMU revenue.</small></div>`
    :'';

  return`<section class="sheet-section strategy-day-topic-section"><div class="strategy-section-head"><div><h2>Fundraiser day & topic takeaways</h2><p>Combines anticipated day strength with topic/time evidence for the <strong>actual dates in this selected fundraiser</strong>. Historical first/second/third weekday evidence is shown only when that occurrence actually exists in this drive. Each day shows up to three topic/time signals supported by at least two fundraiser samples and two different titles.</p></div></div><div class="strategy-day-topic-list">${dayRows.map(day=>{
    const topicHtml=day.topicSignals.length
      ?day.topicSignals.map(item=>`<span class="strategy-day-topic-signal"><b>${esc(item.daypart)} · ${esc(item.topic)}</b><span class="strategy-rate">Avg &#36;${Math.round(item.rate)}/pledge hr</span><small>${item.samples} fundraisers · ${item.titles} titles</small></span>`).join('')
      :'<span class="strategy-no-history">No repeat multi-title topic/time signal clears the threshold for this fundraiser day.</span>';
    return`<div class="strategy-day-topic-row tone-${dayTone(day.outlook)}"><div class="strategy-day-topic-date"><strong>${esc(day.label)}</strong><small>${esc(fmt(day.date,false))}</small></div><div class="strategy-day-topic-strength"><span class="strategy-day-rating">${esc(day.outlook)}${day.bestBet?' · Best bet':''}</span><small>${day.samples?`${day.samples} comparable historical day${day.samples===1?'':'s'}${Number.isFinite(day.averageRate)?` · Avg &#36;${Math.round(day.averageRate)}/pledge hr`:''}`:'No corresponding historical day sample'}</small><small class="strategy-day-topic-action"><b>Scheduling implication:</b> ${esc(daySchedulingAction(day,day.topicSignals))}</small></div><div class="strategy-day-topic-signals">${topicHtml}</div></div>`;
  }).join('')}</div>${peerHtml}</section>`;
}

function hourlyPatternIndex(hourly){
  const data=hourly||{season:'selected',rows:[]};
  const groups=new Map();
  for(const row of data.rows||[]){
    if(!groups.has(row.weekday))groups.set(row.weekday,[]);
    groups.get(row.weekday).push(row);
  }
  groups.forEach(rows=>rows.sort((a,b)=>a.startMinutes-b.startMinutes));
  const span=data.historyStartDate&&data.historyEndDate
    ?`${fmt(data.historyStartDate,false)}–${fmt(data.historyEndDate,false)}`
    :'available history';
  return{data,groups,span};
}

function timingHistoryForWindow(index,slot){
  const data=index?.data||{season:'selected'};
  const allRows=index?.groups?.get(slot.weekday)||[];
  const rows=allRows.filter(row=>
    Number(row.startMinutes)>=Number(slot.startMinutes)
    && Number(row.startMinutes)<Number(slot.endMinutes)
    && (Number(row.targetSeason?.fundraiserSamples||0)>0||Number(row.allHistory?.fundraiserSamples||0)>0)
  );
  if(!rows.length)return`<div class="strategy-window-time-history strategy-window-time-empty"><strong>Timing history</strong><span>No rate-valid half-hour start history inside this planning window.</span></div>`;

  const metric=(row)=>{
    if(!row||!Number(row.fundraiserSamples||0))return'<span class="strategy-no-history">No history</span>';
    return`<span class="strategy-rate">&#36;${Math.round(row.averageRate)}/hr</span><small>${row.fundraiserSamples} drive${row.fundraiserSamples===1?'':'s'} · ${row.airings} airing${row.airings===1?'':'s'}</small>`;
  };

  return`<div class="strategy-window-time-history"><strong>Timing history · 30-minute start buckets</strong><div class="strategy-window-time-head"><span>Start</span><span>${esc(data.season||'Season')}</span><span>All history</span></div><div class="strategy-window-time-grid">${rows.map(row=>`<div class="strategy-window-time-row"><span class="strategy-window-time-clock">${clock(row.startMinutes)}</span><span>${metric(row.targetSeason)}</span><span>${metric(row.allHistory)}</span></div>`).join('')}</div></div>`;
}

function promotionExamplesSection(){
  const examples=[
    {station:'Vermont Public',idea:'Build the campaign before the event across TV/radio spots, podcast pre-rolls, the website, social, email/newsletters and text messaging.'},
    {station:'Houston Public Media',idea:'Tie promotion to a specific program or event, then reinforce it with targeted email, a matching challenge and a locally produced pledge break.'},
    {station:'WLRN',idea:'Use segmented email and SMS, suppress very recent donors where appropriate, and test message variants instead of sending one generic appeal to everyone.'},
    {station:'Vegas PBS',idea:'Brand pledge as a local television event, using local personalities, community stories and social promotion to create anticipation rather than simply announcing a drive.'}
  ];
  return`<section class="sheet-section strategy-promotion-examples"><div class="strategy-section-head"><div><h2>Fundraiser promotion ideas already worth discussing</h2><p>Initial examples already identified, not a full promotion study yet. The useful common thread is to build awareness around <strong>what is happening during the fundraiser</strong>, not only the fact that a fundraiser is coming.</p></div></div><div class="strategy-section-card strategy-promotion-card"><div class="strategy-promotion-grid">${examples.map(item=>`<article><strong>${esc(item.station)}</strong><span>${esc(item.idea)}</span></article>`).join('')}</div></div></section>`;
}

function topicTimeMatrixSection(matrix){
  const data=matrix||{rows:[]};
  const rows=Array.isArray(data.rows)?data.rows:[];
  if(!rows.length)return'<section class="sheet-section"><h2>Topic × time takeaways</h2><p>No WNMU or structured peer timing evidence is available for the analyzed dayparts.</p></section>';

  const topicText=(items=[],limit=3)=>{
    if(!items.length)return'<span class="strategy-no-history">No rate-valid WNMU topic result</span>';
    return items.slice(0,limit).map(item=>`<span class="strategy-topic-time-topic"><b>${esc(item.topic)}</b> <span class="strategy-rate">${Number.isFinite(item.averageRate)?`&#36;${Math.round(item.averageRate)}/pledge hr`:'—'}</span><small>${item.fundraiserSamples} fundraiser${item.fundraiserSamples===1?'':'s'} · ${item.airings} airing${item.airings===1?'':'s'} · ${Number(item.titleCount||0)} title${Number(item.titleCount||0)===1?'':'s'}</small></span>`).join('');
  };
  const peerText=(peer={})=>{
    const positive=Number(peer.positiveStations||0),negative=Number(peer.negativeStations||0),stations=Number(peer.stations||0);
    if(!stations)return'<span class="strategy-no-history">No matching structured peer evidence</span>';
    const topics=(peer.topTopics||[]).map(item=>item.topic).filter(Boolean);
    return `<span><b>${positive} positive</b> · ${negative} negative · ${stations} independent station${stations===1?'':'s'}</span>${topics.length?`<small>Positive peer topics: ${esc(topics.join(', '))}</small>`:''}`;
  };
  const positionText=(row)=>{
    const positions=Array.isArray(row.positionBreakdown)?row.positionBreakdown.filter(item=>Number(item.local?.airings||0)>0):[];
    if(positions.length<2)return'';
    return `<div class="strategy-topic-time-positions"><strong>Fundraiser-position split</strong>${positions.map(pos=>`<div><span><b>${esc(pos.label)}</b>${Number.isFinite(Number(pos.local?.averageRate))?` · Avg &#36;${Math.round(Number(pos.local.averageRate))}/pledge hr`:''} · ${Number(pos.local?.fundraiserSamples||0)} fundraiser${Number(pos.local?.fundraiserSamples||0)===1?'':'s'}</span><span>${topicText(pos.localTopics||[],2)}</span></div>`).join('')}</div>`;
  };

  const localCandidates=[];
  const singleTitleCandidates=[];
  rows.forEach(row=>{
    const positions=Array.isArray(row.positionBreakdown)&&row.positionBreakdown.length
      ?row.positionBreakdown
      :[{label:row.weekday,local:row.local||{},localTopics:row.localTopics||[]}];
    positions.forEach(pos=>{
      (pos.localTopics||[]).forEach(topic=>{
        const samples=Number(topic.fundraiserSamples||0);
        const titles=Number(topic.titleCount||0);
        const rate=Number(topic.averageRate);
        if(samples<2||!Number.isFinite(rate))return;
        const item={
          weekday:row.weekday,
          daypart:row.daypart,
          positionLabel:pos.label||row.weekday,
          topic:topic.topic,
          rate,
          samples,
          titles
        };
        if(titles>=2)localCandidates.push(item);
        else singleTitleCandidates.push(item);
      });
    });
  });
  localCandidates.sort((a,b)=>b.rate-a.rate||b.samples-a.samples||b.titles-a.titles);
  singleTitleCandidates.sort((a,b)=>b.rate-a.rate||b.samples-a.samples);

  const splitTakeaways=[];
  rows.forEach(row=>{
    const positions=(row.positionBreakdown||[]).filter(pos=>Number.isFinite(Number(pos.local?.averageRate))&&Number(pos.local?.fundraiserSamples||0)>0);
    if(positions.length<2)return;
    const sorted=[...positions].sort((a,b)=>Number(b.local.averageRate)-Number(a.local.averageRate));
    const high=sorted[0],low=sorted[sorted.length-1];
    const highRate=Number(high.local.averageRate),lowRate=Number(low.local.averageRate);
    const spread=highRate>0?Math.abs(highRate-lowRate)/highRate:0;
    if(spread<0.20)return;
    splitTakeaways.push({
      weekday:row.weekday,
      daypart:row.daypart,
      high,
      low,
      spread,
      weight:Number(high.local.fundraiserSamples||0)+Number(low.local.fundraiserSamples||0)
    });
  });
  splitTakeaways.sort((a,b)=>b.spread-a.spread||b.weight-a.weight);

  const peerGaps=rows
    .filter(row=>row.evidenceState==='Peer-led test'||(Number(row.peer?.positiveStations||0)>=2&&Number(row.local?.fundraiserSamples||0)<2))
    .sort((a,b)=>Number(b.peer?.positiveStations||0)-Number(a.peer?.positiveStations||0)
      || Number(a.local?.fundraiserSamples||0)-Number(b.local?.fundraiserSamples||0));

  const localHtml=localCandidates.length
    ?localCandidates.slice(0,6).map(item=>`<div class="strategy-time-takeaway-row"><strong>${esc(item.positionLabel)} · ${esc(item.daypart)}</strong><span><b>${esc(item.topic)}</b> · <span class="strategy-rate">Avg &#36;${Math.round(item.rate)}/pledge hr</span></span><small>${item.samples} fundraisers · ${item.titles} titles</small></div>`).join('')
    :'<p>No topic/time pattern has repeat evidence from at least two different titles yet.</p>';

  const splitHtml=splitTakeaways.length
    ?splitTakeaways.slice(0,5).map(item=>{
      const highTop=item.high.localTopics?.[0]?.topic||'mixed topics';
      const lowTop=item.low.localTopics?.[0]?.topic||'mixed topics';
      return`<div class="strategy-time-takeaway-row"><strong>${esc(item.weekday)} · ${esc(item.daypart)}</strong><span>${esc(item.high.label)}: <span class="strategy-rate">&#36;${Math.round(Number(item.high.local.averageRate))}/hr</span> (${esc(highTop)})</span><span>${esc(item.low.label)}: <span class="strategy-rate">&#36;${Math.round(Number(item.low.local.averageRate))}/hr</span> (${esc(lowTop)})</span><small>${Math.round(item.spread*100)}% spread between fundraiser positions. Treat those occurrences separately.</small></div>`;
    }).join('')
    :'<p>No first-vs-later weekday difference is large enough to call out separately.</p>';

  const peerHtml=peerGaps.length
    ?peerGaps.slice(0,5).map(row=>`<div class="strategy-time-takeaway-row"><strong>${esc(row.weekday)} · ${esc(row.daypart)}</strong><span>${Number(row.peer?.positiveStations||0)} positive independent peer station${Number(row.peer?.positiveStations||0)===1?'':'s'}${(row.peer?.topTopics||[]).length?` · ${esc(row.peer.topTopics.map(x=>x.topic).join(', '))}`:''}</span><small>${Number(row.local?.fundraiserSamples||0)?`Only ${Number(row.local.fundraiserSamples)} WNMU fundraiser sample${Number(row.local.fundraiserSamples)===1?'':'s'} here.`:'No rate-valid WNMU pledge history here.'} Peer evidence supports testing, not a revenue forecast.</small></div>`).join('')
    :'<p>No peer-supported timing gap currently clears the threshold.</p>';

  const singleTitleNote=singleTitleCandidates.length
    ?`<p class="strategy-time-watchout"><strong>Not promoted as topic signals:</strong> ${singleTitleCandidates.slice(0,3).map(item=>`${esc(item.topic)} at ${esc(item.positionLabel)} ${esc(item.daypart)}`).join('; ')}. Each is currently driven by only one title, so the report treats it as title evidence rather than proof that the whole topic works there.</p>`
    :'';

  const order=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const groups=new Map(order.map(day=>[day,[]]));
  rows.forEach(row=>{if(!groups.has(row.weekday))groups.set(row.weekday,[]);groups.get(row.weekday).push(row);});
  const detailed=`<div class="strategy-topic-time-groups">${order.map(day=>{
    const dayRows=groups.get(day)||[];
    if(!dayRows.length)return'';
    return`<section class="strategy-topic-time-day"><h3>${esc(day)}</h3><div class="strategy-topic-time-head"><span>Daypart</span><span>WNMU use</span><span>WNMU topic signals</span><span>Peer context</span></div>${dayRows.map(row=>{
      const local=row.local||{},peer=row.peer||{};
      const localUse=Number(local.airings||0)
        ?`<b>${Number(local.fundraiserSamples||0)} fundraiser${Number(local.fundraiserSamples||0)===1?'':'s'}</b><small>${Number(local.airings||0)} airing${Number(local.airings||0)===1?'':'s'} · ${Number(local.titleCount||0)} title${Number(local.titleCount||0)===1?'':'s'}${Number.isFinite(Number(local.averageRate))?` · Avg &#36;${Math.round(Number(local.averageRate))}/pledge hr`:''}</small>`
        :'<span class="strategy-no-history">No rate-valid WNMU history</span>';
      return`<div class="strategy-topic-time-row evidence-${esc(String(row.evidenceState||'').toLowerCase().replace(/[^a-z0-9]+/g,'-'))}"><span class="strategy-topic-time-window"><b>${clock(row.startMinutes)}–${clock(row.endMinutes)}</b><small>${esc(row.daypart)} · ${esc(row.evidenceState||'')}</small></span><span class="strategy-topic-time-use">${localUse}</span><span class="strategy-topic-time-topics">${topicText(row.localTopics||[])}</span><span class="strategy-topic-time-peer">${peerText(peer)}</span>${positionText(row)}</div>`;
    }).join('')}</section>`;
  }).join('')}</div>`;

  return`<section class="sheet-section strategy-topic-time-section"><div class="strategy-section-head"><div><h2>Topic × time takeaways</h2><p>A short interpretation of the timing evidence. The default view only calls out patterns that could change a programming decision. Single-title results are not promoted as broad topic conclusions, and repeated weekdays inside a fundraiser are separated when their results materially differ.</p></div></div><div class="strategy-time-takeaway-grid"><article><h3>WNMU topic/time signals</h3>${localHtml}</article><article><h3>Same weekday, different fundraiser position</h3>${splitHtml}</article><article><h3>Peer-supported gaps</h3>${peerHtml}</article></div>${singleTitleNote}<details class="strategy-topic-time-detail"><summary>Show full weekday/daypart evidence</summary>${detailed}</details></section>`;
}

function meetingBriefSection(result){
  const strategy=result?.strategy||{};
  const opportunities=result?.opportunities?.rows||[];
  const matrix=result?.topicTimeMatrix?.rows||[];
  const practices=result?.peerPractices||[];

  const windows=opportunities.slice(0,5);
  const peerLed=matrix
    .filter(row=>row.evidenceState==='Peer-led test')
    .sort((a,b)=>Number(b?.peer?.positiveStations||0)-Number(a?.peer?.positiveStations||0))
    .slice(0,4);
  const livePractice=practices.find(item=>item.id==='live-localized');

  const windowHtml=windows.length?windows.map(item=>{
    const saturdayAfternoon=item.weekday==='Saturday'&&Number(item.startMinutes)===15*60&&Number(item.endMinutes)===17*60;
    return`<div><strong>${esc(item.weekday)} · ${clock(item.startMinutes)}–${clock(item.endMinutes)}</strong><span>${esc(item.label)}${item.kind==='peer-gap'?` · ${Number(item.positivePeerStations||0)} positive peer stations`:''}</span><small>${esc(item.rationale||'No rationale recorded.')}</small>${saturdayAfternoon?'<small><b>Saturday 3–5 PM:</b> Treat this as a test of a broader program/topic mix. WNMU historical use here has been narrow, so the old results do not prove the clock time itself is weak.</small>':''}</div>`;
  }).join(''):'<p>No distinct timing test currently clears the evidence rules.</p>';

  const peerHtml=peerLed.length
    ?peerLed.map(row=>`<div><strong>${esc(row.weekday)} · ${esc(row.daypart)}</strong><span>${Number(row.peer.positiveStations||0)} positive independent peer station${Number(row.peer.positiveStations||0)===1?'':'s'}${(row.peer.topTopics||[]).length?` · ${esc(row.peer.topTopics.map(x=>x.topic).join(', '))}`:''}</span></div>`).join('')
    :practices.filter(item=>item.id!=='live-localized').slice(0,4).map(item=>`<div><strong>${esc(item.label)}</strong><span>${Number(item.stationCount||0)} peer station${Number(item.stationCount||0)===1?'':'s'} represented</span></div>`).join('')||'<p>No peer-led test currently clears the evidence rules.</p>';

  const liveHtml=livePractice
    ?`<div><strong>${esc(livePractice.label)}</strong><span>${Number(livePractice.stationCount||0)} independent peer station${Number(livePractice.stationCount||0)===1?'':'s'} · ${Number(livePractice.observationCount||0)} positive observation${Number(livePractice.observationCount||0)===1?'':'s'}</span><small>${esc(livePractice.testIdea||'Use live/localized breaks as a bounded program-specific test, not as proof that live presentation alone causes stronger results.')}</small></div>${(livePractice.examples||[]).slice(0,3).map(example=>{
      const metrics=[];
      if(Number.isFinite(Number(example.actualDollars)))metrics.push(`$${Math.round(Number(example.actualDollars)).toLocaleString()}`);
      if(Number.isFinite(Number(example.pledgeCount)))metrics.push(`${Number(example.pledgeCount)} pledge${Number(example.pledgeCount)===1?'':'s'}`);
      if(Number.isFinite(Number(example.goalDollars)))metrics.push(`goal $${Math.round(Number(example.goalDollars)).toLocaleString()}`);
      return`<div><strong>${esc(example.station||'Peer station')}${example.programTitle?` · ${esc(example.programTitle)}`:''}</strong><span>${metrics.length?esc(metrics.join(' · ')):esc(example.summary||'Positive peer observation')}</span>${metrics.length&&example.summary?`<small>${esc(example.summary)}</small>`:''}</div>`;
    }).join('')}`
    :'<p>No structured peer live/localized-break observation currently clears the evidence threshold.</p>';

  return`<section class="sheet-section strategy-meeting-brief"><div class="strategy-section-head"><div><h2>Meeting brief</h2><p>A compact discussion starter. Detailed day/topic recommendations are below; this section keeps only timing opportunities, peer gaps, and break-format evidence that may change how the fundraiser is built.</p></div></div><div class="strategy-meeting-facts"><span><b>${Number(strategy.evidenceFundraisers||0)}</b> historical fundraiser/event groups</span><span><b>${Number(strategy.evidenceRows||0).toLocaleString()}</b> reconciled program rows</span><span><b>${Number(strategy.eligibleTitles||0)}</b> currently eligible library titles</span></div><div class="strategy-meeting-grid"><article><h3>Windows worth discussing</h3><div class="strategy-meeting-list">${windowHtml}</div></article><article><h3>Peer-led gaps to consider</h3><div class="strategy-meeting-list">${peerHtml}</div></article><article class="strategy-meeting-live"><h3>Live / localized break evidence</h3><div class="strategy-meeting-list">${liveHtml}</div></article></div></section>`;
}

function opportunitiesSection(opportunities){
  const data=opportunities||{rows:[]};
  const rows=data.rows||[];
  const evidenceList=(x)=>{
    const items=Array.isArray(x.evidenceItems)?x.evidenceItems:[];
    if(!items.length)return'';
    return`<div class="strategy-opportunity-evidence"><strong>Why explore this?</strong><ul>${items.map(item=>`<li class="evidence-${esc(item.tone||'neutral')}"><b>${esc(item.sourceLabel||'Evidence')}:</b> ${esc(item.text||'')}</li>`).join('')}</ul></div>`;
  };
  return`<section class="sheet-section strategy-opportunities-section"><div class="strategy-section-head"><div><h2>Scheduling opportunities / tests</h2><p>Each weekly timeslot appears once. A test is shown only with visible evidence explaining why it may be worth trying or why limited WNMU history is not conclusive.</p></div></div>${rows.length?`<div class="strategy-opportunity-list">${rows.map(x=>`<div class="strategy-opportunity-row opportunity-${esc(x.kind)}"><div><strong>${esc(x.weekday)} · ${clock(x.startMinutes)}–${clock(x.endMinutes)}</strong><span>${esc(x.label)}</span></div><div><span class="strategy-rate">${Number.isFinite(x.averageRate)?`Avg ${Math.round(x.averageRate)}/pledge hr`:'No reliable average yet'}</span><small>${x.fundraiserSamples} fundraiser sample${x.fundraiserSamples===1?'':'s'} · ${x.airings} airing${x.airings===1?'':'s'}${x.kind==='peer-gap'?` · ${Number(x.positivePeerStations||0)} positive peer stations`:''}</small></div><div class="strategy-opportunity-summary"><p>${esc(x.rationale||'')}</p></div>${evidenceList(x)}</div>`).join('')}</div>`:'<p>No distinct exploratory timeslot currently has enough evidence to justify a test.</p>'}</section>`;
}

function dayMapSection(strategy,hourly){
  const byDate=new Map();
  const timingIndex=hourlyPatternIndex(hourly);
  for(const slot of strategy.windows){
    if(!byDate.has(slot.date))byDate.set(slot.date,[]);
    byDate.get(slot.date).push(slot);
  }
  return`<section class="sheet-section strategy-day-map-section"><h2>Day-by-day programming map + timing history</h2><p>Planning decisions and historical start-time performance are shown together. Each planning window includes WNMU's 30-minute start buckets, with ${esc(timingIndex.data.season||'season')} history first and all-history context beside it. History span: ${esc(timingIndex.span)}.</p><div class="strategy-days-compact">${[...byDate.entries()].map(([date,slots])=>`<section class="strategy-day-compact"><header><strong>${esc(slots[0].weekday)}</strong><span>${fmt(date)}</span></header><div class="strategy-program-table"><div class="strategy-program-row strategy-program-head"><span>Time</span><span>Title / topic</span><span>Evidence</span><span>Fit</span></div>${slots.map(slot=>{
    if(slot.blocked)return`<div class="strategy-window-divider is-blocked"><strong>${clock(slot.startMinutes)}–${clock(slot.endMinutes)} · Protected regular programming</strong><span>Not pledge inventory.</span></div>`;
    const divider=`<div class="strategy-window-divider ${slot.experimental?'is-experimental':''}"><strong>${clock(slot.startMinutes)}–${clock(slot.endMinutes)} · ${esc(slot.label)}${slot.experimental?' · Test window':''}</strong><span>${slot.experimental?'See scheduling opportunities / tests above.':(slot.evidenceRows?`${slot.evidenceRows} exact-weekday comparable historical row${slot.evidenceRows===1?'':'s'}`:'No exact-weekday slot history')}</span></div>`;
    const timing=timingHistoryForWindow(timingIndex,slot);
    const rows=slot.recommendations.slice(0,4).map(x=>`<div class="strategy-program-row"><span class="strategy-program-time">${clock(slot.startMinutes)}</span><span class="strategy-program-title"><strong>${esc(x.title)}${x.newTitle?'<span class="strategy-new-title">NEW</span>':''}</strong><small>${esc(x.topic)}${x.secondary?` · ${esc(x.secondary)}`:''}${x.programmer?.rating?` · Programmer: ${esc(x.programmer.label)}`:''}</small></span><span class="strategy-program-evidence"><b>${esc(x.confidence)}</b> · ${esc((x.newTitle&&x.reviewedNew?x.reasons.find(r=>/^New \/ unaired/i.test(r)):null)||x.reasons[0]||'No direct title history.')}${x.cautions.length?` <em>${esc(x.cautions[0])}</em>`:''}</span><span class="strategy-program-fit"><b>${Math.round(x.score)}</b><small>${esc(x.fit)}</small></span></div>`).join('');
    return divider+timing+(rows||'<div class="strategy-program-empty">No eligible Program Library title for this slot.</div>');
  }).join('')}</div></section>`).join('')}</div></section>`;
}

function calendarRowsForSchedule(schedule={}){
  try{
    return globalThis.WNMUStrategyCalendar?.forSchedule?.(schedule)||[];
  }catch(_error){
    return[];
  }
}

function calendarRowsForDate(rows=[],dateKey=''){
  const target=new Date(String(dateKey||'')+'T12:00:00');
  if(Number.isNaN(target.getTime()))return[];
  return rows.filter(item=>{
    const start=new Date(String(item.date||'')+'T12:00:00');
    const end=new Date(String(item.endDate||item.date||'')+'T12:00:00');
    return !Number.isNaN(start.getTime())&&!Number.isNaN(end.getTime())&&target>=start&&target<=end;
  });
}

function briefSection(result={},opportunities={},schedule={}){
  const peerRows=Array.isArray(result.peerPractices)?result.peerPractices:[];
  const sunday=peerRows.find(item=>item.id==='sunday-morning');
  const peer=sunday&&!peerRows.slice(0,4).includes(sunday)?[...peerRows.slice(0,3),sunday]:peerRows.slice(0,4);
  const localIdeas=(opportunities.rows||[]).slice(0,4);
  const ideaCards=[
    ...localIdeas.map(item=>({
      source:'WNMU',
      title:item.weekday+' · '+clock(item.startMinutes)+'–'+clock(item.endMinutes),
      text:item.rationale||item.label||'Worth testing.',
      meta:Number.isFinite(item.averageRate)?'Avg '+Math.round(item.averageRate)+'/pledge hr':(item.label||'')
    })),
    ...peer.map(item=>({
      source:'Peer',
      title:item.label||'Peer-station practice',
      text:item.testIdea||item.wnmuStatus||'Worth a bounded WNMU test.',
      meta:[Number(item.stationCount||0)+' station'+(Number(item.stationCount||0)===1?'':'s'),(item.topTopics||[]).length?'Topics: '+item.topTopics.map(x=>x.topic).join(', '):''].filter(Boolean).join(' · ')
    }))
  ].slice(0,8);
  const cards=ideaCards.length?ideaCards.map(item=>'<article><span class="strategy-source-tag">'+esc(item.source)+'</span><strong>'+esc(item.title)+'</strong><p>'+esc(item.text)+'</p>'+(item.meta?'<small>'+esc(item.meta)+'</small>':'')+'</article>').join(''):'<p>No distinct scheduling or peer-practice test currently clears the report threshold.</p>';
  return '<section class="sheet-section strategy-brief-section"><div class="strategy-section-head"><div><h2>Brief</h2><p>The ideas most likely to change how this fundraiser is built.</p></div></div><div class="strategy-brief-card"><h3>Ideas & tests</h3><div class="strategy-brief-ideas">'+cards+'</div></div></section>';
}

function compactTimingForSlot(hourlyIndex,slot={}){
  const rows=hourlyIndex?.groups?.get(slot.weekday)||[];
  const row=rows.find(item=>Number(item.startMinutes)===Number(slot.startMinutes));
  if(!row)return'';
  const season=row.targetSeason||{};
  const all=row.allHistory||{};
  if(Number(season.fundraiserSamples||0)>0&&Number.isFinite(Number(season.averageRate))){
    return`Timing &#36;${Math.round(Number(season.averageRate))}/hr · ${Number(season.fundraiserSamples)} drive${Number(season.fundraiserSamples)===1?'':'s'}`;
  }
  if(Number(all.fundraiserSamples||0)>0&&Number.isFinite(Number(all.averageRate))){
    return`All-history timing &#36;${Math.round(Number(all.averageRate))}/hr · ${Number(all.fundraiserSamples)} drive${Number(all.fundraiserSamples)===1?'':'s'}`;
  }
  return'';
}

function fundraiserPlanSection(strategy={},outlook={},matrix={},hourly={},schedule={}){
  const calendar=calendarRowsForSchedule(schedule);
  const timingIndex=hourlyPatternIndex(hourly);
  const matrixRows=Array.isArray(matrix?.rows)?matrix.rows:[];
  const windowsByDate=new Map();
  (strategy.windows||[]).forEach(slot=>{
    if(!windowsByDate.has(slot.date))windowsByDate.set(slot.date,[]);
    windowsByDate.get(slot.date).push(slot);
  });

  const topicSnapshot=(strategy.topicComparison||[]).slice(0,6);
  const days=(outlook.rows||[]).map(day=>{
    const date=new Date(String(day.date||'')+'T12:00:00');
    const weekdayIndex=Number.isNaN(date.getTime())?null:date.getDay();
    const occurrence=scheduleOccurrenceForDate(schedule,day.date);
    const topicSignals=[];
    matrixRows.filter(row=>row.weekdayIndex===weekdayIndex).forEach(row=>{
      const position=(row.positionBreakdown||[]).find(item=>Number(item.occurrence)===Number(occurrence));
      (position?.localTopics||[]).forEach(topic=>{
        const samples=Number(topic.fundraiserSamples||0);
        const titles=Number(topic.titleCount||0);
        const rate=Number(topic.averageRate);
        if(samples<2||titles<2||!Number.isFinite(rate))return;
        topicSignals.push({daypart:row.daypart,topic:topic.topic,rate,samples,titles});
      });
    });
    topicSignals.sort((a,b)=>b.rate-a.rate||b.samples-a.samples||b.titles-a.titles);

    const daySlots=(windowsByDate.get(day.date)||[])
      .filter(slot=>!slot.blocked)
      .sort((a,b)=>a.startMinutes-b.startMinutes);

    // A title belongs to the one window where its slot-specific score is highest.
    // This prevents a strong title from being repeated across several windows just
    // because it happens to rank well everywhere.
    const bestSlotByTitle=new Map();
    daySlots.forEach(slot=>{
      (slot.recommendations||[]).forEach(rec=>{
        const key=String(rec?.programId||rec?.title||'').trim().toLowerCase();
        if(!key)return;
        const current=bestSlotByTitle.get(key);
        const score=Number(rec?.score);
        const currentScore=Number(current?.rec?.score);
        if(!current||(!Number.isFinite(currentScore)&&Number.isFinite(score))||(Number.isFinite(score)&&score>currentScore)){
          bestSlotByTitle.set(key,{slot,rec});
        }
      });
    });

    const assignedBySlot=new Map(daySlots.map(slot=>[slot.id,[]]));
    bestSlotByTitle.forEach(({slot,rec})=>{
      if(!assignedBySlot.has(slot.id))assignedBySlot.set(slot.id,[]);
      assignedBySlot.get(slot.id).push(rec);
    });

    const programs=daySlots
      .map(slot=>{
        const options=(assignedBySlot.get(slot.id)||[])
          .sort((a,b)=>Number(b.score||0)-Number(a.score||0)||String(a.title||'').localeCompare(String(b.title||'')))
          .slice(0,3);
        return{slot,options};
      })
      .filter(item=>item.options.length)
      .slice(0,3);

    return{...day,topicSignals:topicSignals.slice(0,5),programs,calendar:calendarRowsForDate(calendar,day.date)};
  });

  return`<section class="sheet-section strategy-fundraiser-plan"><div class="strategy-section-head"><div><h2>Fundraiser plan</h2><p>Day, topic, timing and program direction in one compact planning view.</p></div></div>
    <div class="strategy-topic-snapshot"><h3>Topic snapshot</h3><div>${topicSnapshot.length?topicSnapshot.map(item=>`<span><b>${esc(item.topic)}</b><strong class="strategy-rate">${Number.isFinite(item.averageRate)?`&#36;${Math.round(item.averageRate)}/hr`:'No seasonal history'}</strong><small>${Number(item.fundraiserSamples||0)} drive${Number(item.fundraiserSamples||0)===1?'':'s'} · ${Number(item.eligibleProgramCount||0)} eligible</small></span>`).join(''):'<p>No eligible seasonal topic history.</p>'}</div></div>
    <div class="strategy-plan-days">${days.map(day=>`<article class="strategy-plan-day tone-${dayTone(day.outlook)}">
      <header><div><strong>${esc(day.label)}</strong><span>${esc(fmt(day.date,false))}</span></div><div><b>${esc(day.outlook)}</b>${Number.isFinite(day.averageRate)?`<span class="strategy-rate">Avg &#36;${Math.round(day.averageRate)}/pledge hr</span>`:''}</div></header>
      ${day.calendar.length?`<div class="strategy-day-calendar">${day.calendar.map(item=>`<span class="impact-${esc(item.impact||'context')}"><b>${esc(item.title)}</b>${item.time?` · ${esc(item.time)}`:''}</span>`).join('')}</div>`:''}
      <div class="strategy-plan-day-body"><p class="strategy-plan-action">${esc(daySchedulingAction(day,day.topicSignals))}</p>
        <div class="strategy-plan-signals">${day.topicSignals.length?day.topicSignals.map(item=>`<span><b>${esc(item.daypart)} · ${esc(item.topic)}</b><strong class="strategy-rate">&#36;${Math.round(item.rate)}/hr</strong></span>`).join(''):'<span class="strategy-no-history">No repeat multi-title topic/time signal.</span>'}</div>
        <div class="strategy-plan-programs">${day.programs.length?day.programs.map(({slot,options})=>`<div class="strategy-plan-window${slot.webOnlyExperimental?' strategy-web-only-window':''}"><div class="strategy-plan-window-head"><strong>${clock(slot.startMinutes)}–${clock(slot.endMinutes)}${slot.webOnlyExperimental?' · WEB-ONLY EXPERIMENT':slot.experimental?' · TEST':''}</strong>${!slot.webOnlyExperimental&&compactTimingForSlot(timingIndex,slot)?`<small>${compactTimingForSlot(timingIndex,slot)}</small>`:''}</div>${slot.webOnlyExperimental?'<p class="strategy-web-only-note">No reliable WNMU 5–7 PM pledge history. Breaks default to Web-only with no operators standing by, so use lower-opportunity-cost inventory here and keep stronger staffed-slot titles elsewhere. Break mode is recorded on each scheduled program for later comparison.</p>':''}<ol>${options.map(rec=>`<li><b>${esc(rec.title)}</b><span>${esc(rec.topic)}</span>${slot.webOnlyExperimental&&rec.webOnlyReason?`<small>${esc(rec.webOnlyReason)}</small>`:''}</li>`).join('')}</ol></div>`).join(''):'<span class="strategy-no-history">No discretionary pledge recommendation for this date.</span>'}</div>
      </div>
    </article>`).join('')}</div>
  </section>`;
}

function timeOfDayComparisonSection(hourly={}){
  const data=hourly||{rows:[]};
  const order=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const groups=new Map(order.map(day=>[day,[]]));
  (data.rows||[]).forEach(row=>{
    const season=row.targetSeason||{};
    const all=row.allHistory||{};
    const useSeason=Number(season.fundraiserSamples||0)>0&&Number.isFinite(Number(season.averageRate));
    const metric=useSeason?season:all;
    if(!Number(metric.fundraiserSamples||0)||!Number.isFinite(Number(metric.averageRate)))return;
    const topics=(metric.topTopics||[]).slice(0,2).map(item=>item.topic).filter(Boolean);
    if(!groups.has(row.weekday))groups.set(row.weekday,[]);
    groups.get(row.weekday).push({
      startMinutes:row.startMinutes,
      rate:Number(metric.averageRate),
      fundraisers:Number(metric.fundraiserSamples||0),
      topics,
      source:useSeason?(data.season||'Season'):'All history'
    });
  });
  const dayCards=order.map(day=>{
    const rows=groups.get(day)||[];
    if(!rows.length)return '';
    const body=rows.map(row=>'<div class="strategy-half-hour-row"><b>'+clock(row.startMinutes)+'</b><strong class="strategy-rate">&#36;'+Math.round(row.rate)+'/hr</strong><span>'+esc(row.topics.length?row.topics.join(' · '):'Mixed / no repeat topic')+'</span><small>'+row.fundraisers+' drive'+(row.fundraisers===1?'':'s')+' · '+esc(row.source)+'</small></div>').join('');
    return '<article class="strategy-time-day-card"><h3>'+esc(day)+'</h3>'+body+'</article>';
  }).join('');
  return '<section class="sheet-section strategy-time-of-day-section"><div class="strategy-section-head"><div><h2>Time-of-day comparisons</h2><p>Half-hour program-start buckets. Each row shows the fundraiser-balanced average and the strongest topics in that exact bucket. The selected pledge season is used when available; otherwise the row is clearly marked as all-history context.</p></div></div><div class="strategy-time-day-grid">'+(dayCards||'<p>No rate-valid half-hour history is available.</p>')+'</div></section>';
}

function peerPracticesCompactSection(rows=[]){
  if(!Array.isArray(rows)||!rows.length)return '<section class="sheet-section strategy-peer-practices-compact"><div class="strategy-section-head"><div><h2>Peer practices</h2><p>No strong positive peer-practice evidence is loaded yet.</p></div></div></section>';
  const html=rows.map(item=>{
    const topics=(item.topTopics||[]).map(x=>x.topic).filter(Boolean);
    const topicLine=topics.length?'<p><b>Observed peer topics:</b> '+esc(topics.join(', '))+'</p>':'';
    const examples=(item.examples||[]).slice(0,2).map(example=>'<small><b>'+esc(example.station||'Other station')+'</b>'+ (example.programTitle?' · '+esc(example.programTitle):'') +(example.summary?' · '+esc(example.summary):'')+'</small>').join('');
    return '<article><header><strong>'+esc(item.label||'Peer practice')+'</strong><span>'+Number(item.stationCount||0)+' station'+(Number(item.stationCount||0)===1?'':'s')+'</span></header>'+topicLine+'<p>'+esc(item.testIdea||item.wnmuStatus||'Worth a bounded WNMU test.')+'</p>'+examples+'</article>';
  }).join('');
  return '<section class="sheet-section strategy-peer-practices-compact"><div class="strategy-section-head"><div><h2>Peer practices worth testing</h2><p>Positive practices reported by other public-TV stations. Topic labels are retained so a signal such as Sunday-morning Drama does not disappear into a generic daypart label.</p></div></div><div class="strategy-peer-compact-grid">'+html+'</div></section>';
}
function programOpportunitiesSection(strategy={}){
  const byKey=new Map();
  const keyFor=(item)=>String(item?.programId||item?.title||'').trim().toLowerCase();
  const ensure=(item)=>{
    const key=keyFor(item);
    if(!key)return null;
    if(!byKey.has(key))byKey.set(key,{title:item.title||'',topic:item.topic||'',score:null,badges:[],notes:[],newTitle:false,drama:null});
    const row=byKey.get(key);
    if(!row.title&&item.title)row.title=item.title;
    if(!row.topic&&item.topic)row.topic=item.topic;
    if(item.newTitle===true)row.newTitle=true;
    if(item.drama)row.drama=item.drama;
    if(Number.isFinite(Number(item.score)))row.score=Math.max(Number.isFinite(row.score)?row.score:-Infinity,Number(item.score));
    return row;
  };
  (strategy.windows||[]).forEach(slot=>{
    if(slot.blocked)return;
    (slot.recommendations||[]).forEach(item=>{
      const row=ensure(item); if(!row)return;
      row.badges.push('Recommended');
      if(item.newTitle)row.badges.push('New');
      if(item.drama?.isDramaDoc&&!item.newTitle&&item.drama?.currentCycle)row.badges.push('Current cycle');
      if(item.fit)row.notes.push(item.fit);
    });
  });
  (strategy.repeats||[]).forEach(item=>{
    const row=ensure(item); if(!row)return;
    row.badges.push('Repeat');
    if(item.drama?.isDramaDoc&&item.drama?.currentCycle)row.badges.push('Current cycle');
    if(item.slots?.length)row.notes.push('Works across '+item.slots.length+' separated prime windows');
  });
  (strategy.seasonal||[]).forEach(item=>{
    const row=ensure(item); if(!row)return;
    row.badges.push('Seasonal');
    const note=item.season?.notes?.[0]||((item.season?.targetSeason||'Seasonal')+' fit');
    if(note)row.notes.push(note);
  });
  (strategy.local||[]).forEach(item=>{
    const row=ensure(item); if(!row)return;
    row.badges.push('Local / U.P.');
    if(item.fit)row.notes.push(item.fit);
  });
  const rows=[...byKey.values()]
    .map(row=>({...row,badges:[...new Set(row.badges)],notes:[...new Set(row.notes)]}))
    .filter(row=>{
      if(!row.drama?.isDramaDoc)return true;
      const recommended=row.badges.includes('Recommended');
      return recommended&&(row.newTitle||row.drama?.currentCycle===true);
    })
    .sort((a,b)=>{
      const as=Number.isFinite(Number(a.score))?Number(a.score):-Infinity;
      const bs=Number.isFinite(Number(b.score))?Number(b.score):-Infinity;
      return bs-as||a.title.localeCompare(b.title);
    })
    .slice(0,20);
  const html=rows.length?rows.map((item,index)=>{
    const badgeHtml=item.badges.map(badge=>'<span>'+esc(badge)+'</span>').join('');
    const note=esc(item.notes.slice(0,2).join(' · ')||'Worth considering in the current fundraiser mix.');
    const score=Number.isFinite(item.score)?'<small>Score '+Math.round(item.score)+'</small>':'';
    return '<article><div class="strategy-opportunity-rank">'+(index+1)+'</div><div class="strategy-opportunity-body"><div class="strategy-opportunity-title"><strong>'+esc(item.title)+'</strong><span>'+esc(item.topic)+'</span></div><div class="strategy-opportunity-badges">'+badgeHtml+'</div><p>'+note+'</p>'+score+'</div></article>';
  }).join(''):'<p>No program opportunity currently clears the filters.</p>';
  return '<section class="sheet-section strategy-program-opportunities"><div class="strategy-section-head"><div><h2>Program opportunities</h2><p>Up to 20 current candidates, sorted by best-window score. Badges explain why a title is surfacing.</p></div></div><div class="strategy-program-opportunity-list">'+html+'</div></section>';
}

function compact(items,renderer,empty){return items?.length?`<div class="strategy-compact-list">${items.map(renderer).join('')}</div>`:`<p>${esc(empty)}</p>`;}
function supportingSections(strategy){return`<section class="sheet-section strategy-two-column"><div><h2>Repeat candidates</h2>${compact(strategy.repeats,x=>`<div><strong>${esc(x.title)}</strong><span>${esc(x.topic)} · score ${Math.round(x.score)} · supported on ${x.slots.length} separated prime windows.</span></div>`,'No repeat candidate clears the threshold.')}<h2>Seasonal opportunities</h2>${compact(strategy.seasonal,x=>`<div><strong>${esc(x.title)}</strong><span>${esc(x.topic)} · ${esc(x.season.notes.join(' ')||`${x.season.targetSeason} seasonal support`)}</span></div>`,'No distinct seasonal opportunity identified.')}</div><div><h2>Local / U.P. opportunities</h2>${compact(strategy.local,x=>`<div><strong>${esc(x.title)}</strong><span>${esc(x.topic)} · best-window score ${Math.round(x.score)} · ${esc(x.fit)}</span></div>`,'No eligible Local / U.P. title identified.')}<h2>Discretionary titles to avoid / rest</h2><p class="strategy-section-note">Only discretionary pledge titles appear here. Fixed-schedule programs, Drama Docs, and titles still performing at or above WNMU's relevant pledge baseline are omitted unless you explicitly rated them Don't air or Low confidence.</p>${compact(strategy.avoid,x=>`<div><strong>${esc(x.title)}</strong><span>${esc(x.reasons.join(' · '))}</span></div>`,'No discretionary title currently needs a prominent rest/avoid caution.')}</div></section>`;}
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
      worker=new Worker('assets/js/programming-strategy-worker.js?v=0.22.231');
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

    out.innerHTML=`<article class="report-sheet strategy-sheet"><header class="sheet-title"><div><div class="report-kicker">WNMU-TV PBS pre-drive planning</div><h1>Fundraiser Programming Strategy</h1><p>${esc(schedule.title)} · ${fmt(schedule.startDate)}–${fmt(schedule.endDate,false)}</p></div></header>${briefSection(result,opportunities,schedule)}${promotionExamplesSection()}${fundraiserPlanSection(strategy,dayOutlook,result.topicTimeMatrix,hourlyPatterns,schedule)}${topicComparisonSection(strategy)}${timeOfDayComparisonSection(hourlyPatterns)}${peerPracticesCompactSection(result.peerPractices||[])}${programOpportunitiesSection(strategy)}</article>`;
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
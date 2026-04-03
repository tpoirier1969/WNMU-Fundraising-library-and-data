const APP_VERSION='v10.33.1';
const FishingVocab=window.FishingVocab || {};
const FISHING_STORAGE_KEY='fishingLogbook.entries';
const FISHING_ANGLER_SETTINGS_KEY='fishingLogbook.anglerSettings';
const FISHING_LEGACY_STORAGE_KEYS=['fishMapTestV10.entries'];
const OVERPASS_URL='https://overpass-api.de/api/interpreter';
const OVERPASS_RADIUS_METERS=1200;
const NOMINATIM_REVERSE_URL='https://nominatim.openstreetmap.org/reverse';
const DEFAULT_CENTER=[46.62,-87.67];
const DEFAULT_ZOOM=9;
const DEFAULT_LOG_ZOOM=14;
const DEFAULT_ANGLER_SETTINGS={name:localStorage.getItem('fishingLogbook.currentAngler')||localStorage.getItem('fishMap.currentAngler')||'Tod', key:'', shareName:true, locationShareLevel:'Water Type Only'};
const COLOR_SOLID_OPTIONS=FishingVocab.COLOR_SOLID_OPTIONS || ['Black','Blue','Brown','Chartreuse','Copper','Cream','Gold','Gray','Green','Orange','Pink','Purple','Red','Silver','White','Yellow'];
const COLOR_COMBO_OPTIONS=FishingVocab.COLOR_COMBO_OPTIONS || ['Black / Gold','Black / Silver','Blue / Silver','Brown / Orange','Fire Tiger','Glow','Gold / Red','Natural','Perch','Rainbow','Silver / Black','Silver / Blue','Silver / Chartreuse','White / Chartreuse','White / Pink','White / Red'];
const COLOR_OPTIONS=FishingVocab.COLOR_OPTIONS || [...COLOR_SOLID_OPTIONS, ...COLOR_COMBO_OPTIONS];
const ANGLER_MARKER_COLORS=FishingVocab.ANGLER_MARKER_COLORS || ['#2563eb','#dc2626','#16a34a','#ea580c','#7c3aed','#0891b2','#c026d3','#65a30d','#b45309','#be123c','#0f766e','#4f46e5'];
const DEFAULT_FISHING_SUPABASE_CONFIG={url:'',anonKey:'',table:'fishing_catch_logs',appId:'fishing_logbook_shared',autoSyncOnLoad:true,autoSyncOnSave:true};
const FLY_TYPES=FishingVocab.FLY_TYPES || ['Dry','Nymph','Streamer','Emerger','Wet Fly','Terrestrial','Other'];
const LURE_TYPES=FishingVocab.LURE_TYPES || ['Spoon','Plug / Crankbait','Spinner','Jerkbait','Soft Plastic','Jig','Swimbait','Topwater','Other'];
const LIVE_BAIT_TYPES=FishingVocab.LIVE_BAIT_TYPES || ['Minnow','Crawler','Worm','Cut Bait','Spawn','Waxworm / Wiggler','Leech','Grasshopper','Other'];
const MIDWEST_FISH_SPECIES=FishingVocab.MIDWEST_FISH_SPECIES || [
  'Atlantic Salmon','Black Crappie','Bluegill','Bowfin','Brook Trout','Brown Trout','Bullhead','Burbot','Channel Catfish',
  'Chinook Salmon','Cisco','Coho Salmon','Common Carp','Flathead Catfish','Freshwater Drum','Gar','Hybrid Striped Bass',
  'Lake Sturgeon','Lake Trout','Lake Whitefish','Largemouth Bass','Muskellunge','Northern Pike','Pumpkinseed',
  'Rainbow Trout / Steelhead','Rock Bass','Sauger','Smallmouth Bass','Splake','Sunfish','Walleye','White Bass','White Crappie','Whitefish (Lake Whitefish)','Yellow Perch'
].sort((a,b)=>a.localeCompare(b));

const GREAT_LAKE_FALLBACKS=[
  {name:'Lake Superior', minLat:46.20, maxLat:48.45, minLng:-92.35, maxLng:-84.20},
  {name:'Lake Michigan', minLat:41.55, maxLat:46.20, minLng:-88.40, maxLng:-85.00},
  {name:'Lake Huron', minLat:43.00, maxLat:46.60, minLng:-84.95, maxLng:-79.55},
  {name:'Lake Erie', minLat:41.20, maxLat:42.95, minLng:-83.65, maxLng:-78.75},
  {name:'Lake Ontario', minLat:43.10, maxLat:44.55, minLng:-79.95, maxLng:-76.05}
];


const accessPointCache=new Map();

function normalizeAccessFeatureLabel(tags={}){
  if(tags.leisure==='slipway') return 'Boat launch';
  if(tags.leisure==='marina') return 'Marina';
  if(tags.leisure==='fishing') return 'Fishing access';
  if(tags.highway && (tags.bridge==='yes' || tags.bridge)) return 'Road crossing';
  if(tags.man_made==='pier') return 'Pier access';
  if(tags.tourism==='camp_site') return 'Camp access';
  if(tags.amenity==='parking') return 'Access parking';
  return 'Public access';
}

function chooseAccessRadiusMeters(waterType='Lake'){
  switch(String(waterType||'')){
    case 'Stream': return 5000;
    case 'River': return 8000;
    case 'Great Lake': return 20000;
    case 'Lake': return 10000;
    case 'Pond': return 4000;
    default: return 8000;
  }
}

function buildAccessQuery(lat,lng,waterType='Lake'){
  const radius=chooseAccessRadiusMeters(waterType);
  const streamish=waterType==='Stream' || waterType==='River';
  if(streamish){
    return `[out:json][timeout:25];(node["leisure"="fishing"](around:${radius},${lat},${lng});way["leisure"="fishing"](around:${radius},${lat},${lng});node["highway"]["bridge"](around:${radius},${lat},${lng});way["highway"]["bridge"](around:${radius},${lat},${lng});node["ford"](around:${radius},${lat},${lng});way["ford"](around:${radius},${lat},${lng});node["amenity"="parking"](around:${Math.min(radius,2500)},${lat},${lng});way["amenity"="parking"](around:${Math.min(radius,2500)},${lat},${lng}););out center tags;`;
  }
  return `[out:json][timeout:25];(node["leisure"~"slipway|marina|fishing"](around:${radius},${lat},${lng});way["leisure"~"slipway|marina|fishing"](around:${radius},${lat},${lng});node["man_made"="pier"](around:${radius},${lat},${lng});way["man_made"="pier"](around:${radius},${lat},${lng});node["amenity"="parking"](around:${Math.min(radius,3500)},${lat},${lng});way["amenity"="parking"](around:${Math.min(radius,3500)},${lat},${lng});node["tourism"="camp_site"](around:${Math.min(radius,5000)},${lat},${lng});way["tourism"="camp_site"](around:${Math.min(radius,5000)},${lat},${lng}););out center tags;`;
}

function normalizeAccessCandidates(elements,lat,lng,waterType='Lake'){
  const items=[];
  for(const el of elements||[]){
    const tags=el.tags||{};
    const pointLat=typeof el.lat==='number' ? el.lat : (typeof el.center?.lat==='number' ? el.center.lat : null);
    const pointLng=typeof el.lon==='number' ? el.lon : (typeof el.center?.lon==='number' ? el.center.lon : null);
    if(typeof pointLat!=='number' || typeof pointLng!=='number') continue;
    const distance=haversineMeters(lat,lng,pointLat,pointLng);
    let score=distance;
    const label=normalizeAccessFeatureLabel(tags);
    if(label==='Boat launch') score-=1200;
    else if(label==='Fishing access') score-=900;
    else if(label==='Road crossing') score-=600;
    else if(label==='Pier access') score-=500;
    else if(label==='Marina') score-=300;
    if((waterType==='Stream' || waterType==='River') && label==='Road crossing') score-=700;
    if((waterType==='Lake' || waterType==='Great Lake' || waterType==='Pond') && label==='Boat launch') score-=900;
    items.push({lat:pointLat,lng:pointLng,distance,score,label,name:(tags.name||'').trim(),tags});
  }
  items.sort((a,b)=>a.score-b.score || a.distance-b.distance);
  const dedup=[];
  const seen=new Set();
  for(const item of items){
    const key=`${item.label}|${item.lat.toFixed(4)}|${item.lng.toFixed(4)}`;
    if(seen.has(key)) continue;
    seen.add(key);
    dedup.push(item);
    if(dedup.length>=12) break;
  }
  return dedup;
}

async function findNearestPublicAccessPoint(entry={}){
  const lat=Number(entry?.marker?.lat);
  const lng=Number(entry?.marker?.lng);
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const waterType=determineWaterType({waterName:entry.waterName, candidateType:entry.waterType, lat, lng}) || entry.waterType || 'Lake';
  const cacheKey=[(entry.waterName||'').trim().toLowerCase(), waterType, Math.round(lat*50)/50, Math.round(lng*50)/50].join('|');
  if(accessPointCache.has(cacheKey)) return accessPointCache.get(cacheKey);
  try{
    const response=await fetch(OVERPASS_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:buildAccessQuery(lat,lng,waterType)});
    if(!response.ok) throw new Error(`Overpass returned ${response.status}`);
    const data=await response.json();
    const candidates=normalizeAccessCandidates(data.elements||[],lat,lng,waterType);
    const best=candidates[0] || null;
    accessPointCache.set(cacheKey,best);
    return best;
  }catch{
    accessPointCache.set(cacheKey,null);
    return null;
  }
}

const state={
  angler:loadAnglerSettings(),
  entries:loadEntries(),
  markerCluster:null,
  currentDraftMarker:null,
  currentDraftMeta:{source:'',accuracy:null},
  addMode:false,
  pickOnMapArmed:false,
  mapPickOverlay:null,
  _mapPickOverlayHandler:null,
  pendingLocationRequestId:0,
  _mapPickLeafletHandler:null,
  _mapPickDomHandler:null,
  _lastMapPickAt:0,
  filters:{dateFrom:'',dateTo:'',species:'',color:'',baitType:'',waterType:'',timeOfDay:'',sky:'',retrieveSpeed:''},
  cloud:{configured:false,ready:false,syncing:false,status:'Local only',lastSyncAt:'',lastError:'',client:null,table:DEFAULT_FISHING_SUPABASE_CONFIG.table,appId:DEFAULT_FISHING_SUPABASE_CONFIG.appId,autoSyncOnSave:true}
};

const $=id=>document.getElementById(id);
const map=L.map('map',{zoomControl:true,preferCanvas:true}).setView(DEFAULT_CENTER,DEFAULT_ZOOM);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
state.markerCluster=L.markerClusterGroup();
map.addLayer(state.markerCluster);

function setOptions(select, values, placeholder='Choose one'){
  if(!select) return;
  select.innerHTML=`<option value="">${placeholder}</option>`;
  values.forEach(v=>{
    const o=document.createElement('option');
    o.value=v;
    o.textContent=v;
    select.appendChild(o);
  });
}

function setColorOptions(select, {includeBlank=true, blankLabel='Choose one'}={}){
  if(!select) return;
  select.innerHTML=includeBlank ? `<option value="">${blankLabel}</option>` : '';
  COLOR_OPTIONS.forEach(color=>{
    const o=document.createElement('option');
    o.value=color;
    o.textContent=color;
    select.appendChild(o);
  });
}

function populateColorOptions(){
  const mainValue=$('mainColor').value;
  const addValue=$('additionalColor').value;
  const filterValue=$('filterColor').value;
  setColorOptions($('mainColor'), {includeBlank:true, blankLabel:'Choose one'});
  setColorOptions($('additionalColor'), {includeBlank:true, blankLabel:'None'});
  setColorOptions($('filterColor'), {includeBlank:true, blankLabel:'All'});
  if(mainValue && COLOR_OPTIONS.includes(mainValue)) $('mainColor').value=mainValue;
  if(addValue && COLOR_OPTIONS.includes(addValue)) $('additionalColor').value=addValue;
  if(filterValue && COLOR_OPTIONS.includes(filterValue)) $('filterColor').value=filterValue;
}

function isValidCoordinatePair(lat,lng){
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if(lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if(Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return false;
  return true;
}

function shouldForceWesternHemisphere({lat,lng,stateName='',countyName='',waterName=''}={}){
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const hasUSContext=Boolean(String(stateName||'').trim() || String(countyName||'').trim() || /(lake superior|lake michigan|lake huron|lake erie|lake ontario|mississippi|yellow dog|st\.? marys|menominee|fox river|wisconsin river)/i.test(String(waterName||'')));
  if(!hasUSContext) return false;
  return lat >= 20 && lat <= 60 && lng > 0 && lng <= 180;
}

function sanitizeCoordinatePair(latValue,lngValue, context={}){
  let lat=latValue==='' || latValue==null ? null : Number(latValue);
  let lng=lngValue==='' || lngValue==null ? null : Number(lngValue);
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return {lat:null,lng:null};
  if(shouldForceWesternHemisphere({lat,lng,...context})) lng=-Math.abs(lng);
  if(!isValidCoordinatePair(lat,lng)) return {lat:null,lng:null};
  return {lat:Number(lat.toFixed(6)), lng:Number(lng.toFixed(6))};
}

function hasMarker(entry){
  return isValidCoordinatePair(Number(entry?.marker?.lat), Number(entry?.marker?.lng));
}

function hasSharedMarker(entry){
  return isValidCoordinatePair(Number(entry?.sharedMarker?.lat), Number(entry?.sharedMarker?.lng));
}


function entryBelongsToCurrentAngler(entry={}){
  const entryKey=String(entry?.anglerKey || '').trim();
  const currentKey=String(state?.angler?.key || '').trim();
  if(entryKey && currentKey) return entryKey===currentKey;
  const owner=String(entry?.owner || '').trim().toLowerCase();
  const currentName=String(state?.angler?.name || '').trim().toLowerCase();
  return !!owner && !!currentName && owner===currentName;
}

function getDrawableMarker(entry){
  const exactMarker=sanitizeCoordinatePair(entry?.marker?.lat, entry?.marker?.lng, {stateName:entry.stateName, countyName:entry.countyName, waterName:entry.waterName});
  const sharedMarker=sanitizeCoordinatePair(entry?.sharedMarker?.lat, entry?.sharedMarker?.lng, {stateName:entry.stateName, countyName:entry.countyName, waterName:entry.waterName});
  if(entryBelongsToCurrentAngler(entry) && isValidCoordinatePair(exactMarker.lat, exactMarker.lng)) return {point:exactMarker, exact:true};
  if(isValidCoordinatePair(sharedMarker.lat, sharedMarker.lng)) return {point:sharedMarker, exact:false};
  if(isValidCoordinatePair(exactMarker.lat, exactMarker.lng)) return {point:exactMarker, exact:true};
  return null;
}


function isSharedDisplaySource(value=''){
  return String(value || '').startsWith('shared-display');
}

function clamp(value,min,max){
  return Math.min(max, Math.max(min, value));
}

function hashSeedToUnit(seed=''){
  let hash=2166136261;
  const text=String(seed || '');
  for(let i=0;i<text.length;i+=1){
    hash^=text.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  return ((hash>>>0)%1000000)/1000000;
}

function getSharedPointProfile(waterType='', shareLocationLevel='Water Type Only'){
  const type=String(waterType || '').trim() || 'Lake';
  const level=normalizeLocationShareLevel(shareLocationLevel);
  const fine=level==='Body of Water Name';
  switch(type){
    case 'Stream': return fine ? {latStep:0.06,lngStep:0.08,offsetFrac:0.18} : {latStep:0.22,lngStep:0.28,offsetFrac:0.28};
    case 'River': return fine ? {latStep:0.08,lngStep:0.10,offsetFrac:0.18} : {latStep:0.26,lngStep:0.34,offsetFrac:0.28};
    case 'Pond': return fine ? {latStep:0.015,lngStep:0.02,offsetFrac:0.12} : {latStep:0.08,lngStep:0.10,offsetFrac:0.22};
    case 'Great Lake': return fine ? {latStep:0.18,lngStep:0.24,offsetFrac:0.16} : {latStep:0.45,lngStep:0.60,offsetFrac:0.24};
    case 'Lake':
    default: return fine ? {latStep:0.04,lngStep:0.055,offsetFrac:0.16} : {latStep:0.18,lngStep:0.24,offsetFrac:0.24};
  }
}

async function buildSharedDisplayPoint(entry={}){
  const lat=Number(entry?.marker?.lat);
  const lng=Number(entry?.marker?.lng);
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const waterType=determineWaterType({waterName:entry.waterName, candidateType:entry.waterType, lat, lng}) || entry.waterType || 'Lake';
  const level=normalizeLocationShareLevel(entry.shareLocationLevel || state.angler.locationShareLevel || 'Water Type Only');
  const accessPoint=await findNearestPublicAccessPoint(entry);
  if(accessPoint && Number.isFinite(accessPoint.lat) && Number.isFinite(accessPoint.lng)) {
    return {lat:accessPoint.lat, lng:accessPoint.lng, label:accessPoint.label || 'Public access', exact:false, method:'public-access'};
  }
  const profile=getSharedPointProfile(waterType, level);
  const latIndex=Math.floor(lat / profile.latStep);
  const lngIndex=Math.floor(lng / profile.lngStep);
  const baseLat=(latIndex * profile.latStep) + (profile.latStep / 2);
  const baseLng=(lngIndex * profile.lngStep) + (profile.lngStep / 2);
  const seedBase=[entry.waterName || '', waterType, level, entry.owner || '', entry.anglerKey || '', entry.id || ''].join('|');
  const latShift=(hashSeedToUnit(seedBase + '|lat') - 0.5) * profile.latStep * profile.offsetFrac;
  const lngShift=(hashSeedToUnit(seedBase + '|lng') - 0.5) * profile.lngStep * profile.offsetFrac;
  return {
    lat:clamp(baseLat + latShift, (latIndex * profile.latStep) + (profile.latStep * 0.1), (latIndex * profile.latStep) + (profile.latStep * 0.9)),
    lng:clamp(baseLng + lngShift, (lngIndex * profile.lngStep) + (profile.lngStep * 0.1), (lngIndex * profile.lngStep) + (profile.lngStep * 0.9)),
    label:'Approximate shared area',
    exact:false,
    method:'regionalized'
  };
}

function getEntryBaitLabel(entry={}){
  return entry.baitName || entry.baitSubtype || entry.baitType || '—';
}

function getAnglerMarkerSeed(entry={}){
  return String(entry.anglerKey || entry.owner || 'anonymous');
}

function getAnglerMarkerColor(entry={}){
  const seed=getAnglerMarkerSeed(entry);
  let hash=0;
  for(let i=0;i<seed.length;i+=1){
    hash=((hash<<5)-hash)+seed.charCodeAt(i);
    hash|=0;
  }
  return ANGLER_MARKER_COLORS[Math.abs(hash)%ANGLER_MARKER_COLORS.length];
}

function getAnglerMarkerInitial(entry={}){
  const label=String(entry.owner || '').trim() || 'A';
  const match=label.match(/[A-Za-z0-9]/);
  return (match ? match[0] : 'A').toUpperCase();
}

function createAnglerMarkerIcon(entry={}){
  const color=getAnglerMarkerColor(entry);
  const initial=escapeHtml(getAnglerMarkerInitial(entry));
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42" aria-hidden="true">
    <path d="M15 1C7.3 1 1 7.3 1 15c0 10.4 12.2 24.1 13 25 .3.4.8.4 1.1 0 .8-.9 13-14.6 13-25C29 7.3 22.7 1 15 1z" fill="${color}" stroke="white" stroke-width="2"/>
    <circle cx="15" cy="15" r="8" fill="rgba(255,255,255,0.14)"/>
    <text x="15" y="19" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700" fill="white">${initial}</text>
  </svg>`;
  return L.icon({
    iconUrl:`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    iconSize:[30,42],
    iconAnchor:[15,41],
    popupAnchor:[0,-34],
    className:'fishingAnglerMarkerIcon'
  });
}


function normalizeLocationShareLevel(value){
  return value==='Body of Water Name' ? 'Body of Water Name' : 'Water Type Only';
}

function inferWaterTypeFromName(name=''){
  const value=String(name || '').trim().toLowerCase();
  if(!value) return '';
  if(/\b(superior|michigan|huron|erie|ontario)\b/.test(value) && /\blake\b/.test(value)) return 'Great Lake';
  if(/\b(stream|brook|branch|fork|kill|run|drain|ditch)\b/.test(value)) return 'Stream';
  if(/\b(river)\b/.test(value)) return 'River';
  if(/\b(pond)\b/.test(value)) return 'Pond';
  if(/\b(lake|reservoir|flowage)\b/.test(value)) return 'Lake';
  return '';
}

function determineWaterType({waterName='', candidateType='', lat=null, lng=null}={}){
  const explicit=String(candidateType || '').trim();
  if(explicit){
    if(/stream|ditch|canal|brook|run/i.test(explicit)) return 'Stream';
    if(/river/i.test(explicit)) return 'River';
    if(/pond/i.test(explicit)) return 'Pond';
    if(/lake|reservoir|water/i.test(explicit)){
      const inferredName=inferWaterTypeFromName(waterName);
      return inferredName || 'Lake';
    }
  }
  const inferred=inferWaterTypeFromName(waterName);
  if(inferred) return inferred;
  const guessed=guessGreatLake(Number(lat), Number(lng));
  if(guessed) return 'Great Lake';
  return '';
}

function getSharedOwnerLabel(entry={}){
  return entry.shareAnglerName===false ? 'Anonymous' : (entry.owner || state.angler.name || DEFAULT_ANGLER_SETTINGS.name || 'Anonymous');
}

function getSharedCountyLabel(entry={}){
  const county=(entry.countyName || '').trim();
  const stateName=(entry.stateName || '').trim();
  if(county && stateName) return `${county}, ${stateName}`;
  return county || stateName || '';
}

function getSharedWaterLabel(entry={}){
  const level=normalizeLocationShareLevel(entry.shareLocationLevel);
  if(level==='Body of Water Name') return (entry.waterName || '').trim() || (entry.waterType || '').trim() || 'Water not shared';
  return (entry.waterType || '').trim() || determineWaterType({waterName:entry.waterName, candidateType:entry.waterType, lat:entry?.marker?.lat, lng:entry?.marker?.lng}) || 'Water';
}

function clearWaterSuggestions(){
  const list=$('waterNameSuggestionsList');
  if(list) list.innerHTML='';
}

function setWaterSuggestions(candidates=[]){
  clearWaterSuggestions();
  const list=$('waterNameSuggestionsList');
  if(!list) return;
  candidates.forEach(candidate=>{
    const option=document.createElement('option');
    option.value=candidate.name;
    option.label=`${candidate.featureLabel} · ${Math.round(candidate.distance)}m`;
    list.appendChild(option);
  });
}

function getFishingSupabaseConfig(){
  const cfg=(window.FISHING_SUPABASE_CONFIG && typeof window.FISHING_SUPABASE_CONFIG==='object') ? window.FISHING_SUPABASE_CONFIG : {};
  return {
    url:String(cfg.url || '').trim(),
    anonKey:String(cfg.anonKey || cfg.publishableKey || '').trim(),
    table:String(cfg.table || DEFAULT_FISHING_SUPABASE_CONFIG.table).trim() || DEFAULT_FISHING_SUPABASE_CONFIG.table,
    appId:String(cfg.appId || DEFAULT_FISHING_SUPABASE_CONFIG.appId).trim() || DEFAULT_FISHING_SUPABASE_CONFIG.appId,
    autoSyncOnLoad:cfg.autoSyncOnLoad!==false,
    autoSyncOnSave:cfg.autoSyncOnSave!==false
  };
}

function getCloudConfigDiagnostics(){
  const cfg=getFishingSupabaseConfig();
  const missing=[];
  if(!cfg.url) missing.push('Supabase project URL');
  if(!cfg.anonKey) missing.push('publishable/anon key');
  if(!(window.supabase && typeof window.supabase.createClient==='function')) missing.push('Supabase JavaScript library');
  return {cfg, missing, configured: missing.length===0};
}

function cloudIsConfigured(){
  return getCloudConfigDiagnostics().configured;
}

function formatCloudSyncTime(value=''){
  if(!value) return '';
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function updateCloudUi(){
  const cloudBtn=$('cloudBtn');
  const cloudBadge=$('cloudBadge');
  const cloudSummary=$('cloudSummary');
  let badgeText='Local only';
  let buttonText='Cloud Setup';
  let summary='Local-only mode. Add Supabase details in supabase-config.js to share logs across devices. Angler settings control whether your name is shown and whether locations are shared by water type or body of water name.';

  if(state.cloud.syncing){
    badgeText='Cloud syncing…';
    buttonText='Syncing…';
    summary='Syncing local and shared logs now.';
  }else if(state.cloud.ready){
    badgeText='Cloud connected';
    buttonText='Sync Cloud';
    summary=`Shared database connected. ${state.cloud.lastSyncAt ? 'Last sync: ' + formatCloudSyncTime(state.cloud.lastSyncAt) + '.' : 'Ready to sync.'}`;
  }else if(state.cloud.configured){
    badgeText='Cloud error';
    buttonText='Retry Cloud';
    summary=`Cloud is configured but not connected${state.cloud.lastError ? ': ' + state.cloud.lastError : '.'}`;
  }

  if(cloudBtn){
    cloudBtn.textContent=buttonText;
    cloudBtn.disabled=state.cloud.syncing;
  }
  if(cloudBadge) cloudBadge.textContent=badgeText;
  if(cloudSummary) cloudSummary.textContent=summary;
  const reviewSubcopy=$('reviewSubcopy');
  if(reviewSubcopy){
    reviewSubcopy.textContent=state.cloud.ready ? 'Shared logs are available across devices when cloud sync is on.' : 'Saved logs stay tucked away until you want them. Cloud sync is optional.';
  }
}

function normalizeEntry(entry={}){
  const marker=entry.marker && typeof entry.marker==='object' ? entry.marker : {};
  const sharedMarker=entry.sharedMarker && typeof entry.sharedMarker==='object' ? entry.sharedMarker : {};
  const cleanMarker=sanitizeCoordinatePair(marker.lat, marker.lng, {stateName:entry.stateName, countyName:entry.countyName, waterName:entry.waterName});
  const cleanSharedMarker=sanitizeCoordinatePair(sharedMarker.lat, sharedMarker.lng, {stateName:entry.stateName, countyName:entry.countyName, waterName:entry.waterName});
  return {
    ...entry,
    id:String(entry.id || getSafeRandomId()),
    owner:String(entry.owner || state.angler.name || DEFAULT_ANGLER_SETTINGS.name),
    anglerKey:String(entry.anglerKey || state.angler.key || ''),
    shareAnglerName:entry.shareAnglerName!==false,
    waterType:entry.waterType || inferWaterTypeFromName(entry.waterName || '') || '',
    createdAt:entry.createdAt || new Date().toISOString(),
    waypointName:entry.waypointName || '',
    baitSubtype:entry.baitSubtype || '',
    additionalColor:entry.additionalColor || '',
    baitSize:entry.baitSize || '',
    weight:entry.weight || '',
    quantity:Number(entry.quantity || 1),
    airTemp:entry.airTemp==='' || entry.airTemp==null ? null : Number(entry.airTemp),
    waterTemp:entry.waterTemp==='' || entry.waterTemp==null ? null : Number(entry.waterTemp),
    hatches:entry.hatches || '',
    notes:entry.notes || '',
    locationSource:entry.locationSource || '',
    shareToCloud:true,
    shareLocationLevel:normalizeLocationShareLevel(entry.shareLocationLevel || state.angler.locationShareLevel || 'Water Type Only'),
    shareAnglerName:entry.shareAnglerName!==false,
    shareBaitDetails:true,
    shareSizeDetails:true,
    shareNotes:true,
    countyName:entry.countyName || '',
    stateName:entry.stateName || '',
    markerAccuracy:entry.markerAccuracy==='' || entry.markerAccuracy==null ? null : Number(entry.markerAccuracy),
    marker:cleanMarker,
    sharedMarker:cleanSharedMarker
  };
}

function normalizeEntryArray(entries=[]){
  if(!Array.isArray(entries)) return [];
  return entries.map(normalizeEntry).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}

function mergeEntries(localEntries=[], remoteEntries=[]){
  const mapById=new Map();
  [...localEntries, ...remoteEntries].forEach(raw=>{
    const entry=normalizeEntry(raw);
    const prior=mapById.get(entry.id);
    if(!prior){
      mapById.set(entry.id, entry);
      return;
    }
    const priorStamp=Date.parse(prior.createdAt || 0) || 0;
    const entryStamp=Date.parse(entry.createdAt || 0) || 0;
    const winner=entryStamp>=priorStamp ? entry : prior;
    const loser=winner===entry ? prior : entry;

    if(!hasMarker(winner) && hasMarker(loser)){
      winner.marker={...loser.marker};
      if((winner.locationSource || '').trim()==='') winner.locationSource=loser.locationSource || '';
      if((winner.markerAccuracy==null || winner.markerAccuracy==='') && loser.markerAccuracy!=null) winner.markerAccuracy=loser.markerAccuracy;
    }

    if(!hasSharedMarker(winner) && hasSharedMarker(loser)){
      winner.sharedMarker={...loser.sharedMarker};
    }

    if(isSharedDisplaySource(winner.locationSource) && hasMarker(loser) && !isSharedDisplaySource(loser.locationSource)){
      winner.sharedMarker=hasSharedMarker(winner) ? {...winner.sharedMarker} : (hasMarker(winner) ? {...winner.marker} : {lat:null,lng:null});
      winner.marker={...loser.marker};
      winner.locationSource=loser.locationSource || winner.locationSource;
      if((winner.markerAccuracy==null || winner.markerAccuracy==='') && loser.markerAccuracy!=null) winner.markerAccuracy=loser.markerAccuracy;
    }

    mapById.set(entry.id, winner);
  });
  return [...mapById.values()].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}

async function entryToCloudRow(entry){
  const shareLocationLevel=normalizeLocationShareLevel(entry.shareLocationLevel || state.angler.locationShareLevel || 'Water Type Only');
  const sharedWaterName=getSharedWaterLabel(entry);
  const sharedWaterType=determineWaterType({waterName:entry.waterName, candidateType:entry.waterType, lat:entry?.marker?.lat, lng:entry?.marker?.lng});
  const sharedPoint=await buildSharedDisplayPoint(entry);
  const cleanExactMarker=sanitizeCoordinatePair(entry?.marker?.lat, entry?.marker?.lng, {stateName:entry.stateName, countyName:entry.countyName, waterName:entry.waterName});
  const exactLat=isValidCoordinatePair(cleanExactMarker.lat, cleanExactMarker.lng) ? cleanExactMarker.lat : null;
  const exactLng=isValidCoordinatePair(cleanExactMarker.lat, cleanExactMarker.lng) ? cleanExactMarker.lng : null;
  const cleanSharedPoint=sharedPoint ? sanitizeCoordinatePair(sharedPoint.lat, sharedPoint.lng, {stateName:entry.stateName, countyName:entry.countyName, waterName:entry.waterName}) : {lat:null,lng:null};
  let sharedLat=isValidCoordinatePair(cleanSharedPoint.lat, cleanSharedPoint.lng) ? cleanSharedPoint.lat : null;
  let sharedLng=isValidCoordinatePair(cleanSharedPoint.lat, cleanSharedPoint.lng) ? cleanSharedPoint.lng : null;
  let sharedWaypointName=shareLocationLevel==='Body of Water Name' ? (entry.waypointName || null) : null;
  let sharedLocationSource=sharedPoint?.method==='public-access' ? (shareLocationLevel==='Body of Water Name' ? 'shared-access-body-of-water' : 'shared-access-water-type') : (shareLocationLevel==='Body of Water Name' ? 'shared-display-body-of-water' : 'shared-display-water-type');
  let sharedAccuracy=null;

  return {
    id:entry.id,
    app_id:state.cloud.appId,
    owner_name:getSharedOwnerLabel(entry),
    owner_is_anonymous:entry.shareAnglerName===false,
    angler_key:entry.anglerKey || null,
    created_at:entry.createdAt,
    log_date:entry.date,
    time_of_day:entry.timeOfDay,
    water_name:sharedWaterName || 'Water',
    water_type:sharedWaterType || null,
    waypoint_name:sharedWaypointName,
    bait_type:entry.baitType,
    bait_subtype:entry.baitSubtype || null,
    bait_name:getEntryBaitLabel(entry),
    main_color:entry.mainColor || null,
    additional_color:entry.additionalColor || null,
    bait_size:entry.baitSize || null,
    species:entry.species,
    size_inches:entry.sizeInches,
    weight:entry.weight || null,
    quantity:entry.quantity || 1,
    air_temp:entry.airTemp,
    water_temp:entry.waterTemp,
    sky_condition:entry.skyCondition || null,
    water_condition:entry.waterCondition || null,
    water_clarity:entry.waterClarity || null,
    depth_zone:entry.depthZone || null,
    retrieve_speed:entry.retrieveSpeed || null,
    presentation_style:entry.presentationStyle || null,
    structure_type:entry.structureType || null,
    hatches:entry.hatches || null,
    notes:entry.notes || null,
    location_source:sharedLocationSource,
    marker_accuracy:sharedAccuracy,
    marker_lat:sharedLat,
    marker_lng:sharedLng,
    exact_marker_lat:exactLat,
    exact_marker_lng:exactLng,
    share_to_cloud:true,
    share_location_level:shareLocationLevel,
    share_angler_name:entry.shareAnglerName!==false,
    share_bait_details:true,
    share_size_details:true,
    share_notes:true,
    county_name:entry.countyName || null,
    state_name:entry.stateName || null,
    updated_at:new Date().toISOString()
  };
}

function cloudRowToEntry(row){
  const exactMarker=sanitizeCoordinatePair(row.exact_marker_lat, row.exact_marker_lng, {stateName:row.state_name, countyName:row.county_name, waterName:row.water_name});
  const sharedMarker=sanitizeCoordinatePair(row.marker_lat, row.marker_lng, {stateName:row.state_name, countyName:row.county_name, waterName:row.water_name});
  return normalizeEntry({
    id:row.id,
    owner:row.owner_name || state.angler.name || DEFAULT_ANGLER_SETTINGS.name,
    anglerKey:row.angler_key || '',
    shareAnglerName:row.share_angler_name!==false,
    createdAt:row.created_at,
    date:row.log_date,
    timeOfDay:row.time_of_day,
    waterName:row.water_name,
    waterType:row.water_type || '',
    waypointName:row.waypoint_name || '',
    baitType:row.bait_type,
    baitSubtype:row.bait_subtype || '',
    baitName:row.bait_name,
    mainColor:row.main_color || '',
    additionalColor:row.additional_color || '',
    baitSize:row.bait_size || '',
    species:row.species,
    sizeInches:row.size_inches==='' || row.size_inches==null ? null : Number(row.size_inches),
    weight:row.weight || '',
    quantity:row.quantity==='' || row.quantity==null ? null : Number(row.quantity),
    airTemp:row.air_temp,
    waterTemp:row.water_temp,
    skyCondition:row.sky_condition || '',
    waterCondition:row.water_condition || '',
    waterClarity:row.water_clarity || '',
    depthZone:row.depth_zone || '',
    retrieveSpeed:row.retrieve_speed || '',
    presentationStyle:row.presentation_style || '',
    structureType:row.structure_type || '',
    hatches:row.hatches || '',
    notes:row.notes || '',
    locationSource:row.location_source || '',
    shareToCloud:row.share_to_cloud!==false,
    shareLocationLevel:normalizeLocationShareLevel(row.share_location_level || 'Water Type Only'),
    shareAnglerName:row.share_angler_name!==false,
    shareBaitDetails:true,
    shareSizeDetails:true,
    shareNotes:true,
    countyName:row.county_name || '',
    stateName:row.state_name || '',
    markerAccuracy:row.marker_accuracy,
    marker:exactMarker,
    sharedMarker
  });
}

async function initCloud({syncOnLoad=true}={}){
  const cfg=getFishingSupabaseConfig();
  state.cloud.configured=cloudIsConfigured();
  state.cloud.table=cfg.table;
  state.cloud.appId=cfg.appId;
  state.cloud.autoSyncOnSave=cfg.autoSyncOnSave;
  state.cloud.lastError='';
  if(!state.cloud.configured){
    state.cloud.ready=false;
    state.cloud.client=null;
    updateCloudUi();
    return false;
  }
  try{
    state.cloud.client=window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false}
    });
    state.cloud.ready=true;
    updateCloudUi();
    if(syncOnLoad && cfg.autoSyncOnLoad) await syncCloud({quiet:true});
    return true;
  }catch(error){
    state.cloud.ready=false;
    state.cloud.client=null;
    state.cloud.lastError=error?.message || 'unknown error';
    updateCloudUi();
    return false;
  }
}

async function syncCloud({quiet=false}={}){
  if(!state.cloud.ready){
    const ok=await initCloud({syncOnLoad:false});
    if(!ok){
      const diag=getCloudConfigDiagnostics();
      if(!quiet) alert('Cloud sync is not ready. Missing: ' + (diag.missing.length ? diag.missing.join(', ') : 'unknown item') + '.');
      return false;
    }
  }
  if(state.cloud.syncing) return false;
  state.cloud.syncing=true;
  updateCloudUi();
  if(!quiet) setStatus('Syncing shared logs…', 2600);
  try{
    const rows=(await Promise.all(normalizeEntryArray(state.entries).map(entryToCloudRow))).filter(Boolean);
    if(rows.length){
      const {error:pushError}=await state.cloud.client.from(state.cloud.table).upsert(rows, {onConflict:'id'});
      if(pushError) throw pushError;
    }
    const {data,error}=await state.cloud.client.from(state.cloud.table).select('*').eq('app_id', state.cloud.appId).order('created_at', {ascending:false});
    if(error) throw error;
    state.entries=mergeEntries(state.entries, (data||[]).map(cloudRowToEntry));
    persistEntries();
    render();
    state.cloud.lastSyncAt=new Date().toISOString();
    state.cloud.lastError='';
    updateCloudUi();
    if(!quiet) setStatus(`Cloud synced: ${state.entries.length} logs available.`, 3600);
    return true;
  }catch(error){
    state.cloud.lastError=error?.message || 'unknown error';
    state.cloud.ready=false;
    updateCloudUi();
    if(!quiet){
      alert(`Cloud sync failed: ${state.cloud.lastError}`);
      setStatus(`Cloud sync failed: ${state.cloud.lastError}`, 4200);
    }
    return false;
  }finally{
    state.cloud.syncing=false;
    updateCloudUi();
  }
}

async function deleteCloudEntry(entryId){
  if(!state.cloud.ready || !entryId) return false;
  try{
    const {error}=await state.cloud.client.from(state.cloud.table).delete().eq('id', entryId).eq('app_id', state.cloud.appId);
    if(error) throw error;
    state.cloud.lastSyncAt=new Date().toISOString();
    state.cloud.lastError='';
    updateCloudUi();
    return true;
  }catch(error){
    state.cloud.lastError=error?.message || 'unknown error';
    updateCloudUi();
    return false;
  }
}

function validateLogForm(){
  const requiredChecks=[
    ['date',$('date').value],
    ['Time of Day',$('timeOfDay').value],
    ['Body of Water',$('waterName').value.trim()],
    ['Water Type',$('waterType').value],
    ['Sky',$('skyCondition').value],
    ['Water Conditions',$('waterCondition').value],
    ['Water Clarity',$('waterClarity').value],
    ['Depth Zone',$('depthZone').value],
    ['Presentation Style',$('presentationStyle').value],
    ['Structure Type',$('structureType').value],
    ['Bait Type',$('baitType').value],
    ['Main Color',$('mainColor').value],
    ['Retrieve Speed',$('retrieveSpeed').value],
    ['Species',$('species').value],
    ['Size (inches)',$('sizeInches').value],
    ['Quantity',$('quantity').value]
  ];
  for(const [label, value] of requiredChecks){
    if(!String(value || '').trim()) return label;
  }
  if($('baitType').value==='Fly'){
    if(!$('baitSubtype').value) return 'Fly Type';
    if(!$('baitName').value.trim()) return 'Fly Pattern';
    if(!$('baitSize').value) return 'Fly Size';
  }
  if($('baitType').value==='Lure'){
    if(!$('baitSubtype').value) return 'Lure Type';
  }
  if($('baitType').value==='Live Bait' && !$('baitSubtype').value) return 'Bait Type';
  if(!state.currentDraftMarker) return 'Fishing Spot';
  return '';
}

function populateSpeciesOptions(){
  const formValue=$('species').value;
  const filterValue=$('filterSpecies').value;
  setOptions($('species'), MIDWEST_FISH_SPECIES, 'Choose one');
  setOptions($('filterSpecies'), MIDWEST_FISH_SPECIES, 'All');
  if(formValue && MIDWEST_FISH_SPECIES.includes(formValue)) $('species').value=formValue;
  if(filterValue && MIDWEST_FISH_SPECIES.includes(filterValue)) $('filterSpecies').value=filterValue;
}

function populateFilterDropdowns(){
  const baitTypeValue=$('filterBaitType') ? $('filterBaitType').value : '';
  setOptions($('filterBaitType'), ['Fly','Lure','Live Bait'], 'All');
  if(baitTypeValue && ['Fly','Lure','Live Bait'].includes(baitTypeValue)) $('filterBaitType').value=baitTypeValue;
}

function setLabelText(labelEl, text){
  if(!labelEl) return;
  const firstText=[...labelEl.childNodes].find(node=>node.nodeType===Node.TEXT_NODE);
  if(firstText){
    firstText.textContent=text;
  }else{
    labelEl.insertBefore(document.createTextNode(text), labelEl.firstChild);
  }
}

function syncAddLogButton(){
  const btn=$('addLogBtn');
  if(!btn) return;
  btn.textContent='Add Log';
  btn.classList.add('primary');
}



function setMapPickVisuals(isActive){
  const mapEl=document.getElementById('map');
  if(!mapEl) return;
  mapEl.style.cursor=isActive ? 'crosshair' : '';
  mapEl.classList.toggle('map-pick-armed', !!isActive);
}

function pointFromClientEvent(event){
  const touch = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0] : null;
  const clientX = touch ? touch.clientX : event.clientX;
  const clientY = touch ? touch.clientY : event.clientY;
  if(!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const rect=map.getContainer().getBoundingClientRect();
  const point=L.point(clientX-rect.left, clientY-rect.top);
  return map.containerPointToLatLng(point);
}

function eventHitsLeafletUi(event){
  const target=event && event.target instanceof Element ? event.target : null;
  if(!target) return false;
  return !!target.closest('.leaflet-control-container, .leaflet-control, .leaflet-popup, .leaflet-marker-icon, .leaflet-marker-shadow');
}

function disarmMapPick(){
  state.pickOnMapArmed=false;
  detachMapPickHandlers();
  setMapPickVisuals(false);
}

function cancelAddMode(message=''){
  state.addMode=false;
  disarmMapPick();
  syncAddLogButton();
  if(message) setStatus(message, 3200);
}

function beginAddLog(){
  cancelAddMode();
  state.addMode=true;
  closeSheet($('reviewSheet'));
  closeSheet($('filterSheet'));
  closeSheet($('anglerSheet'));
  closeSheet($('predictSheet'));
  openSheet($('logSheet'));
  if(state.currentDraftMarker){
    const ll=state.currentDraftMarker.getLatLng();
    updateLocationSummary(ll.lat, ll.lng, state.currentDraftMeta.accuracy, state.currentDraftMeta.source);
    $('waterLookupStatus').textContent='Spot already set. You can use your location again, drag the marker, or pick a new spot on the map.';
  }else{
    $('waterLookupStatus').textContent='Use My Location or Pick on Map to set the fishing spot before saving.';
  }
  setStatus('Log opened. Set the spot with Use My Location or Pick on Map.', 3200);
}

async function finishMapPick(lat,lng){
  if(!state.pickOnMapArmed || !state.addMode) return;
  if(!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))){
    setStatus('Map pick failed. Tap the map again.', 3200);
    return;
  }
  disarmMapPick();
  setDraftMarker(Number(lat),Number(lng),{source:'map',accuracy:null,recenter:false});
  closeAllSheets();
  openSheet($('logSheet'));
  $('waterLookupStatus').textContent='Map spot set. Checking nearby water...';
  await detectNearbyWater(Number(lat),Number(lng));
  setStatus('Spot set from map. Fill out the log and save it.', 3600);
}


let _mapPickInitialized=false;

function detachMapPickHandlers(){
  if(state._mapPickLeafletHandler){
    map.off('click', state._mapPickLeafletHandler);
  }
  const mapEl=map.getContainer();
  if(mapEl && state._mapPickDomHandler){
    ['pointerup','touchend','mouseup','click'].forEach(type=>mapEl.removeEventListener(type, state._mapPickDomHandler, true));
  }
  state._mapPickLeafletHandler=null;
  state._mapPickDomHandler=null;
}

function initializeMapPickHandlers(){
  if(_mapPickInitialized) return;
  _mapPickInitialized=true;
}

function armMapPickHandlers(){
  detachMapPickHandlers();
  const mapEl=map.getContainer();
  state._mapPickLeafletHandler=async event=>{
    if(!state.pickOnMapArmed || !state.addMode) return;
    const ll=event && event.latlng ? event.latlng : null;
    if(!ll || !Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)){
      setStatus('Map pick failed. Tap the map again.', 3200);
      return;
    }
    await finishMapPick(ll.lat,ll.lng);
  };
  state._mapPickDomHandler=async event=>{
    if(!state.pickOnMapArmed || !state.addMode) return;
    if(event.type==='pointerup' && event.pointerType==='mouse' && event.button!==0) return;
    if(eventHitsLeafletUi(event)) return;
    const ll=pointFromClientEvent(event);
    if(!ll || !Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)) return;
    event.preventDefault();
    event.stopPropagation();
    await finishMapPick(ll.lat,ll.lng);
  };
  map.on('click', state._mapPickLeafletHandler);
  ['pointerup','touchend','mouseup','click'].forEach(type=>mapEl.addEventListener(type, state._mapPickDomHandler, true));
}

function beginPickOnMap(){
  state.pendingLocationRequestId+=1;
  state.addMode=true;
  state.pickOnMapArmed=true;
  state._lastMapPickAt=0;
  syncAddLogButton();
  closeSheet($('logSheet'));
  closeSheet($('reviewSheet'));
  closeSheet($('filterSheet'));
  closeSheet($('anglerSheet'));
  closeSheet($('predictSheet'));
  setMapPickVisuals(true);
  armMapPickHandlers();
  setStatus(state.currentDraftMarker ? 'Pick on Map is active. Tap the map once to move the spot.' : 'Pick on Map is active. Tap the map once to set the spot.', 7000);
  $('waterLookupStatus').textContent='Pick on Map is active. Tap the map once to set the fishing spot.';
  try{
    map.invalidateSize();
    window.requestAnimationFrame(()=>map.invalidateSize());
    window.setTimeout(()=>{ if(state.pickOnMapArmed) map.invalidateSize(); }, 220);
  }catch(_e){}
}


function supportsGeolocation(){
  return typeof navigator!=='undefined' && !!navigator.geolocation;
}

function setLocationControlsDisabled(isDisabled){
  ['useDeviceLocationBtn'].forEach(id=>{
    const el=$(id);
    if(el) el.disabled=isDisabled;
  });
}

function getGeoErrorMessage(error){
  if(!error) return 'unknown error';
  if(error.code===1) return 'permission denied';
  if(error.code===2) return 'position unavailable';
  if(error.code===3) return 'timed out';
  return error.message || 'unknown error';
}

function locationSourceLabel(source=''){
  if(source==='device') return 'Device GPS';
  if(source==='map') return 'Map-picked';
  if(source==='adjusted') return 'Adjusted marker';
  if(source==='body-water-only') return 'Body of water only';
  if(source==='county-only') return 'County only';
  if(source==='hidden') return 'Location hidden';
  return 'Spot';
}

function formatCoord(value){
  return Number(value).toFixed(5);
}

function updateLocationSummary(lat,lng,accuracy=null,source=''){
  const summary=$('locationSummary');
  if(typeof lat!=='number' || typeof lng!=='number'){
    summary.textContent='';
    summary.classList.add('hidden');
    return;
  }
  const bits=[locationSourceLabel(source), `${formatCoord(lat)}, ${formatCoord(lng)}`];
  if(Number.isFinite(accuracy)) bits.push(`±${Math.round(accuracy)} m`);
  summary.textContent=bits.join(' · ');
  summary.classList.remove('hidden');
}

function updateDraftMarkerPopup(){
  if(!state.currentDraftMarker) return;
  const ll=state.currentDraftMarker.getLatLng();
  const bits=[locationSourceLabel(state.currentDraftMeta.source), `${formatCoord(ll.lat)}, ${formatCoord(ll.lng)}`];
  if(Number.isFinite(state.currentDraftMeta.accuracy)) bits.push(`±${Math.round(state.currentDraftMeta.accuracy)} m`);
  state.currentDraftMarker.bindPopup(bits.join(' · '));
}

async function useCurrentLocation({auto=false, confirmBeforeOpen=false}={}){
  if(!supportsGeolocation()){
    $('waterLookupStatus').textContent='This browser does not support device location here. Use Pick on Map.';
    if(auto && confirmBeforeOpen) openSheet($('logSheet'));
    if(!auto) setStatus('No device location available in this browser.', 3200);
    return;
  }
  cancelAddMode();
  const requestId=++state.pendingLocationRequestId;
  setLocationControlsDisabled(true);
  $('waterLookupStatus').textContent='Requesting your device location...';
  navigator.geolocation.getCurrentPosition(async position=>{
    if(requestId!==state.pendingLocationRequestId){
      setLocationControlsDisabled(false);
      return;
    }
    const {latitude, longitude, accuracy}=position.coords;
    setDraftMarker(latitude, longitude, {source:'device', accuracy, recenter:true});
    map.setView([latitude, longitude], Math.max(map.getZoom(), DEFAULT_LOG_ZOOM));
    setLocationControlsDisabled(false);

    if(confirmBeforeOpen){
      const accuracyText=Number.isFinite(accuracy) ? ` (±${Math.round(accuracy)} m)` : '';
      const useSpot=window.confirm(`Use your current location${accuracyText}?`);
      if(!useSpot){
        clearDraftMarker();
        beginPickOnMap();
        $('waterLookupStatus').textContent='Location not confirmed. Tap the map to choose the spot instead.';
        setStatus('Tap the map to choose your spot.', 3600);
        return;
      }
      openSheet($('logSheet'));
      closeSheet($('reviewSheet'));
      closeSheet($('filterSheet'));
      $('waterLookupStatus').textContent=`Using your device location${accuracyText}. Checking nearby water...`;
      await detectNearbyWater(latitude, longitude);
      setStatus('Location confirmed. Fill out the log and save it.', 3600);
      return;
    }

    $('waterLookupStatus').textContent=`Using your device location${Number.isFinite(accuracy) ? ` (±${Math.round(accuracy)} m)` : ''}. Drag the marker or use Pick on Map if you need to tweak it.`;
    await detectNearbyWater(latitude, longitude);
    setStatus('Device location set.', 3200);
  }, error=>{
    if(requestId!==state.pendingLocationRequestId){
      setLocationControlsDisabled(false);
      return;
    }
    const message=getGeoErrorMessage(error);
    $('waterLookupStatus').textContent=`Could not get device location (${message}). Use Pick on Map instead.`;
    setLocationControlsDisabled(false);
    if(auto && confirmBeforeOpen){
      openSheet($('logSheet'));
      setStatus(`Location failed: ${message}. Pick a spot on the map.`, 4200);
      return;
    }
    if(!auto) setStatus(`Location failed: ${message}.`, 3600);
  }, {
    enableHighAccuracy:true,
    timeout:12000,
    maximumAge:30000
  });
}

function setBaitHelper(message=''){
  const helper=$('baitHelper');
  const clean=(message||'').trim();
  helper.textContent=clean;
  helper.classList.toggle('hidden', !clean);
}

const BAIT_COLOR_DEFAULTS={
  'Lure':{
    'Spoon':{main:'Silver',additional:''},
    'Plug / Crankbait':{main:'Silver',additional:''},
    'Spinner':{main:'Silver',additional:''},
    'Jerkbait':{main:'Silver',additional:''},
    'Soft Plastic':{main:'Green',additional:''},
    'Jig':{main:'White',additional:''},
    'Swimbait':{main:'Silver',additional:''},
    'Topwater':{main:'White',additional:''},
    'Other':{main:'Silver',additional:''}
  },
  'Live Bait':{
    'Minnow':{main:'Brown',additional:'Silver'},
    'Crawler':{main:'Brown',additional:''},
    'Worm':{main:'Brown',additional:''},
    'Cut Bait':{main:'White',additional:'Silver'},
    'Spawn':{main:'Pink',additional:'Orange'},
    'Waxworm / Wiggler':{main:'Cream',additional:'Brown'},
    'Leech':{main:'Black',additional:''},
    'Grasshopper':{main:'Green',additional:'Yellow'},
    'Other':{main:'Brown',additional:''}
  }
};

function getFlyReference(){
  return Array.isArray(window.FLY_REFERENCE) ? window.FLY_REFERENCE : [];
}

function findExactFly(name, subtype=''){
  const normalized=(name||'').trim().toLowerCase();
  if(!normalized) return null;
  return getFlyReference().find(item=>item.name.toLowerCase()===normalized && (!subtype || item.category===subtype)) || null;
}

function getFlyMatches(query='', subtype=''){
  const normalized=(query||'').trim().toLowerCase();
  return getFlyReference().filter(item=>{
    const subtypeOk=!subtype || item.category===subtype;
    const queryOk=!normalized || item.name.toLowerCase().includes(normalized);
    return subtypeOk && queryOk;
  });
}

function refreshFlySizeOptions(){
  if($('baitType').value!=='Fly'){
    $('baitSize').innerHTML='<option value="">Choose one</option>';
    return;
  }
  const subtype=$('baitSubtype').value;
  const exact=findExactFly($('baitName').value, subtype);
  let sizes=[];
  if(exact){
    sizes=exact.sizes||[];
  }else{
    const pool=subtype ? getFlyReference().filter(item=>item.category===subtype) : getFlyReference();
    sizes=[...new Set(pool.flatMap(item=>item.sizes||[]))].sort((a,b)=>Number(a)-Number(b));
  }
  setOptions($('baitSize'), sizes, sizes.length ? 'Choose fly size' : 'No sizes loaded');
}

function applySubtypeColorDefaults(){
  const type=$('baitType').value;
  const subtype=$('baitSubtype').value;
  if(type==='Fly' || !subtype) return;
  const defaults=BAIT_COLOR_DEFAULTS[type]?.[subtype];
  if(!defaults) return;
  $('mainColor').value=defaults.main || '';
  $('additionalColor').value=defaults.additional || '';
}

function updateColorFieldVisibility(){
  const isLure=$('baitType').value==='Lure';
  ['mainColorWrap','additionalColorWrap'].forEach(id=>{ const el=$(id); if(el) el.classList.toggle('hidden', !isLure); });
  $('mainColor').required=isLure;
  if(!isLure){ $('mainColor').value=''; $('additionalColor').value=''; }
}

function getTimeOfDayForNow(dateObj=new Date()){
  const hour=dateObj.getHours();
  if(hour>=4 && hour<7) return 'Dawn';
  if(hour>=7 && hour<11) return 'Morning';
  if(hour>=11 && hour<15) return 'Midday';
  if(hour>=15 && hour<18) return 'Afternoon';
  if(hour>=18 && hour<21) return 'Evening';
  return 'Night';
}

function applyBaitTypeUI(){
  const type=$('baitType').value;
  const baitSubtype=$('baitSubtype');
  const baitSize=$('baitSize');
  const baitName=$('baitName');
  $('nameSuggestions').classList.add('hidden');
  baitName.value='';
  baitSize.innerHTML='<option value="">Choose one</option>';
  setBaitHelper('');

  baitSubtype.disabled=false;
  baitSubtype.required=false;
  baitSize.disabled=true;
  baitSize.required=false;
  baitName.disabled=false;
  baitName.required=false;

  if(type==='Fly'){
    $('subtypeWrap').classList.remove('hidden');
    $('sizeWrap').classList.remove('hidden');
    $('nameWrap').classList.remove('hidden');
    setOptions(baitSubtype, FLY_TYPES, 'Choose fly type');
    setLabelText($('subtypeWrap'), 'Fly Type');
    setLabelText($('nameLabel'), 'Fly Pattern');
    baitSubtype.required=true;
    baitSize.disabled=false;
    baitSize.required=true;
    baitName.required=true;
    baitName.placeholder='Start typing fly name...';
    refreshFlySizeOptions();
  } else if(type==='Lure'){
    $('subtypeWrap').classList.remove('hidden');
    $('sizeWrap').classList.add('hidden');
    $('nameWrap').classList.remove('hidden');
    setOptions(baitSubtype, LURE_TYPES, 'Choose lure type');
    setLabelText($('subtypeWrap'), 'Lure Type');
    setLabelText($('nameLabel'), 'Lure Name (optional)');
    baitSubtype.required=true;
    baitName.placeholder='Optional lure name...';
  } else if(type==='Live Bait'){
    $('subtypeWrap').classList.remove('hidden');
    $('sizeWrap').classList.add('hidden');
    $('nameWrap').classList.add('hidden');
    setOptions(baitSubtype, LIVE_BAIT_TYPES, 'Choose bait type');
    setLabelText($('subtypeWrap'), 'Bait Type');
    baitSubtype.required=true;
    baitName.disabled=true;
  } else {
    $('subtypeWrap').classList.remove('hidden');
    $('sizeWrap').classList.add('hidden');
    $('nameWrap').classList.remove('hidden');
    setOptions(baitSubtype, [], 'Choose one');
    setLabelText($('subtypeWrap'), 'Subtype');
    setLabelText($('nameLabel'), 'Name');
    baitName.placeholder='Choose bait type first...';
    baitName.disabled=true;
  }
  updateColorFieldVisibility();
}

function updateFlySuggestions(query){
  if($('baitType').value!=='Fly') return;
  const subtype=$('baitSubtype').value;
  const matches=getFlyMatches(query, subtype).slice(0,12);
  $('nameSuggestions').innerHTML='';
  if(!matches.length){
    $('nameSuggestions').classList.add('hidden');
    return;
  }
  matches.forEach(item=>{
    const div=document.createElement('div');
    div.className='suggestion-item';
    div.innerHTML=`<span class="suggestion-name">${escapeHtml(item.name)}</span><span class="suggestion-meta">${escapeHtml(item.category)} · sizes ${(item.sizes||[]).join(', ')}</span>`;
    div.addEventListener('click',()=>{
      applyFly(item);
      $('nameSuggestions').classList.add('hidden');
    });
    $('nameSuggestions').appendChild(div);
  });
  $('nameSuggestions').classList.remove('hidden');
}

function applyFly(item){
  $('baitName').value=item.name;
  $('baitSubtype').value=item.category || $('baitSubtype').value;
  if(item.primary?.length) $('mainColor').value=item.primary[0];
  if(item.secondary?.length) $('additionalColor').value=item.secondary[0];
  refreshFlySizeOptions();
  setBaitHelper(`${item.notes}. Suggested colors: ${[...(item.primary||[]), ...(item.secondary||[])].join(', ')}.`);
}

async function detectNearbyWater(lat,lng){
  $('waterLookupStatus').textContent='Checking Overpass for nearby rivers and lakes...';
  clearWaterSuggestions();
  const query=`[out:json][timeout:25];(way["waterway"~"river|stream|canal|ditch"](around:${OVERPASS_RADIUS_METERS},${lat},${lng});relation["waterway"~"river|stream|canal|ditch"](around:${OVERPASS_RADIUS_METERS},${lat},${lng});way["natural"="water"](around:${OVERPASS_RADIUS_METERS},${lat},${lng});relation["natural"="water"](around:${OVERPASS_RADIUS_METERS},${lat},${lng});way["water"~"lake|pond|reservoir"](around:${OVERPASS_RADIUS_METERS},${lat},${lng});relation["water"~"lake|pond|reservoir"](around:${OVERPASS_RADIUS_METERS},${lat},${lng});relation["place"="sea"](around:${OVERPASS_RADIUS_METERS},${lat},${lng}););out tags center;`;
  try{
    const response=await fetch(OVERPASS_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:query});
    if(!response.ok) throw new Error(`Overpass returned ${response.status}`);
    const data=await response.json();
    const candidates=normalizeWaterCandidates(data.elements||[],lat,lng);
    if(!candidates.length){
      const fallbackName=await fallbackNearbyWaterName(lat,lng);
      if(fallbackName){
        $('waterName').value=fallbackName;
        $('waterType').value=determineWaterType({waterName:fallbackName, lat, lng});
        refreshSharingSummary();
        $('waterLookupStatus').textContent=`Fallback matched: ${fallbackName}.`;
        return;
      }
      $('waterLookupStatus').textContent='No named nearby water found. Type it manually if needed.';
      return;
    }
    if(candidates.length===1){
      $('waterName').value=candidates[0].name;
      $('waterType').value=determineWaterType({waterName:candidates[0].name, candidateType:candidates[0].featureLabel, lat, lng});
      refreshSharingSummary();
      $('waterLookupStatus').textContent=`Overpass matched: ${candidates[0].name}.`;
      return;
    }
    setWaterSuggestions(candidates);
    $('waterName').value=candidates[0].name;
    $('waterType').value=determineWaterType({waterName:candidates[0].name, candidateType:candidates[0].featureLabel, lat, lng});
    refreshSharingSummary();
    $('waterLookupStatus').textContent=`Overpass found ${candidates.length} nearby water features. Pick the right one in the Body of Water field.`;
  }catch(error){
    const fallbackName=await fallbackNearbyWaterName(lat,lng);
    if(fallbackName){
      $('waterName').value=fallbackName;
      $('waterType').value=determineWaterType({waterName:fallbackName, lat, lng});
      refreshSharingSummary();
      $('waterLookupStatus').textContent=`Overpass lookup failed, but fallback matched: ${fallbackName}.`;
      return;
    }
    $('waterLookupStatus').textContent=`Overpass lookup failed: ${error.message}. Type the body of water manually.`;
  }
}

function normalizeWaterCandidates(elements,lat,lng){
  const dedupe=new Map();
  for(const el of elements){
    const tags=el.tags||{};
    const name=(tags.name||'').trim();
    if(!name) continue;
    const centerLat=el.center?.lat ?? el.lat;
    const centerLng=el.center?.lon ?? el.lon;
    if(typeof centerLat!=='number' || typeof centerLng!=='number') continue;
    const featureLabel=tags.waterway ? capitalize(tags.waterway) : tags.water ? capitalize(tags.water) : tags.natural==='water' ? 'Lake' : 'Water';
    const distance=haversineMeters(lat,lng,centerLat,centerLng);
    const key=`${name.toLowerCase()}|${featureLabel.toLowerCase()}`;
    if(!dedupe.has(key) || dedupe.get(key).distance > distance){
      dedupe.set(key,{name,featureLabel,distance});
    }
  }
  return [...dedupe.values()].sort((a,b)=>a.distance-b.distance).slice(0,8);
}

function haversineMeters(lat1,lon1,lat2,lon2){
  const R=6371000;
  const toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1);
  const dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}


async function fallbackNearbyWaterName(lat,lng){
  const reverseName=await reverseLookupWaterName(lat,lng);
  if(reverseName) return reverseName;
  return guessGreatLake(lat,lng);
}

async function reverseLookupWaterName(lat,lng){
  const params=new URLSearchParams({
    format:'jsonv2',
    lat:String(lat),
    lon:String(lng),
    zoom:'10',
    addressdetails:'1'
  });
  try{
    const response=await fetch(`${NOMINATIM_REVERSE_URL}?${params.toString()}`,{
      headers:{'Accept':'application/json'}
    });
    if(!response.ok) throw new Error(`reverse lookup returned ${response.status}`);
    const data=await response.json();
    return extractReverseWaterName(data);
  }catch{
    return '';
  }
}

async function reverseLookupPlaceDetails(lat,lng){
  const params=new URLSearchParams({
    format:'jsonv2',
    lat:String(lat),
    lon:String(lng),
    zoom:'10',
    addressdetails:'1'
  });
  try{
    const response=await fetch(`${NOMINATIM_REVERSE_URL}?${params.toString()}`,{
      headers:{'Accept':'application/json'}
    });
    if(!response.ok) throw new Error(`reverse lookup returned ${response.status}`);
    const data=await response.json();
    const address=data?.address || {};
    return {
      county:(address.county || address.state_district || '').trim(),
      stateName:(address.state || address.province || '').trim()
    };
  }catch{
    return {county:'', stateName:''};
  }
}

function extractReverseWaterName(data){
  const address=data?.address || {};
  const direct=[
    address.body_of_water,
    address.water,
    address.sea,
    address.bay,
    address.lake,
    address.river,
    address.stream,
    address.reservoir,
    address.canal
  ].find(value=>typeof value==='string' && value.trim());
  if(direct) return direct.trim();

  const candidates=[data?.name, data?.display_name]
    .filter(value=>typeof value==='string' && value.trim())
    .flatMap(value=>value.split(','))
    .map(value=>value.trim())
    .filter(Boolean);

  return candidates.find(value=>/\b(lake|river|creek|stream|bay|harbor|pond|reservoir|ocean|sea|gulf|canal)\b/i.test(value)) || '';
}

function guessGreatLake(lat,lng){
  const match=GREAT_LAKE_FALLBACKS.find(lake=>lat>=lake.minLat && lat<=lake.maxLat && lng>=lake.minLng && lng<=lake.maxLng);
  return match ? match.name : '';
}

function getSafeRandomId(){
  try{
    if(typeof crypto!=='undefined' && crypto?.randomUUID) return crypto.randomUUID();
  }catch{}
  return `fishinglog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
}

function getLabelTextForControl(control){
  if(!(control instanceof HTMLElement)) return 'that field';
  const label=control.closest('label');
  if(label){
    const clone=label.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, div').forEach(node=>node.remove());
    const text=clone.textContent.replace(/\s+/g,' ').trim();
    if(text) return text;
  }
  return control.getAttribute('name') || control.id || 'that field';
}

function setDraftMarker(lat,lng,{source='map',accuracy=null,recenter=false}={}){
  state.currentDraftMeta={source,accuracy:Number.isFinite(accuracy) ? accuracy : null};
  if(state.currentDraftMarker){
    state.currentDraftMarker.setLatLng([lat,lng]);
  }else{
    state.currentDraftMarker=L.marker([lat,lng],{draggable:true}).addTo(map);
    state.currentDraftMarker.on('dragend', async ()=>{
      const ll=state.currentDraftMarker.getLatLng();
      state.currentDraftMeta={source:'adjusted',accuracy:null};
      updateDraftMarkerPopup();
      updateLocationSummary(ll.lat,ll.lng,null,'adjusted');
      $('waterLookupStatus').textContent='Marker adjusted. Checking nearby water again...';
      await detectNearbyWater(ll.lat,ll.lng);
      setStatus('Spot adjusted.', 2600);
    });
  }
  if(recenter) map.setView([lat,lng], Math.max(map.getZoom(), DEFAULT_LOG_ZOOM));
  updateDraftMarkerPopup();
  updateLocationSummary(lat,lng,state.currentDraftMeta.accuracy,state.currentDraftMeta.source);
}

function getFilteredEntries(){
  return state.entries.filter(entry=>{
    if(state.filters.dateFrom && entry.date<state.filters.dateFrom) return false;
    if(state.filters.dateTo && entry.date>state.filters.dateTo) return false;
    if(state.filters.species && entry.species!==state.filters.species) return false;
    if(state.filters.color && entry.mainColor!==state.filters.color) return false;
    if(state.filters.baitType && entry.baitType!==state.filters.baitType) return false;
    if(state.filters.waterType && entry.waterType!==state.filters.waterType) return false;
    if(state.filters.timeOfDay && entry.timeOfDay!==state.filters.timeOfDay) return false;
    if(state.filters.sky && entry.skyCondition!==state.filters.sky) return false;
    if(state.filters.retrieveSpeed && entry.retrieveSpeed!==state.filters.retrieveSpeed) return false;
    return true;
  });
}

function render(){
  const visible=getFilteredEntries();
  state.markerCluster.clearLayers();
  const drawablePoints=[];
  let skippedInvalidMapPoints=0;
  visible.forEach(entry=>{
    const drawable=getDrawableMarker(entry);
    if(!drawable){ skippedInvalidMapPoints+=1; return; }
    drawablePoints.push([drawable.point.lat, drawable.point.lng]);
    const marker=L.marker([drawable.point.lat,drawable.point.lng],{icon:createAnglerMarkerIcon(entry)});
    const sharedLevel=normalizeLocationShareLevel(entry.shareLocationLevel);
    const waterLine=escapeHtml(getSharedWaterLabel(entry));
    const waypointLine=drawable.exact && entry.waypointName && sharedLevel==='Body of Water Name' ? `<br>${escapeHtml(entry.waypointName)}` : '';
    const approxLabel=(entry.markerAccuracy==='nearest-public-access' || (entry.locationSource||'').startsWith('shared-access')) ? 'Nearest public access area' : 'Approximate shared area';
    const coordLine=drawable.exact ? `<br>${escapeHtml(formatCoord(drawable.point.lat))}, ${escapeHtml(formatCoord(drawable.point.lng))}` : `<br>${escapeHtml(approxLabel)}`;
    marker.bindPopup(`<div><strong>${escapeHtml(getSharedOwnerLabel(entry))}</strong><br>${waterLine}${waypointLine}<br>${escapeHtml(entry.species)}${entry.sizeInches!=null ? ' · ' + escapeHtml(String(entry.sizeInches)) + '"' : ''}${entry.quantity!=null ? ' · Qty ' + escapeHtml(String(entry.quantity)) : ''}<br>${escapeHtml(getEntryBaitLabel(entry))}${entry.baitSize ? ' · #' + escapeHtml(entry.baitSize) : ''} · ${escapeHtml(entry.baitType)}${coordLine}</div>`);
    state.markerCluster.addLayer(marker);
  });

  const visibleWithSize=visible.filter(entry=>entry.sizeInches!=null);
  $('statsGrid').innerHTML='';
  [
    ['Entries',visible.length],
    ['Fish Logged',visible.reduce((s,e)=>s+(e.quantity||0),0)],
    ['Avg Size',visibleWithSize.length ? (visibleWithSize.reduce((s,e)=>s+(e.sizeInches||0),0)/visibleWithSize.length).toFixed(1)+'"' : '0.0"'],
    ['Top Bait',mostCommon(visible,'baitName')||mostCommon(visible,'baitSubtype')||'—'],
    ['Top Retrieve',mostCommon(visible,'retrieveSpeed')||'—']
  ].forEach(([label,val])=>{
    const card=document.createElement('div');
    card.className='statCard';
    card.innerHTML=`<div class="statLabel">${escapeHtml(label)}</div><div class="statValue">${escapeHtml(String(val))}</div>`;
    $('statsGrid').appendChild(card);
  });

  if(drawablePoints.length){
    const visibleBounds=map.getBounds();
    const anyVisible=drawablePoints.some(([lat,lng])=>visibleBounds.contains([lat,lng]));
    if(!anyVisible){
      map.fitBounds(drawablePoints,{padding:[28,28], maxZoom:12});
    }
  }

  const sortedVisible=[...visible].sort((a,b)=>{
    const mode=state.reviewSort || 'newest';
    if(mode==='oldest') return String(a.date||'').localeCompare(String(b.date||'')) || String(a.createdAt||'').localeCompare(String(b.createdAt||''));
    if(mode==='species') return String(a.species||'').localeCompare(String(b.species||'')) || String(b.date||'').localeCompare(String(a.date||''));
    if(mode==='angler') return String(getSharedOwnerLabel(a)||'').localeCompare(String(getSharedOwnerLabel(b)||'')) || String(b.date||'').localeCompare(String(a.date||''));
    if(mode==='water') return String(getSharedWaterLabel(a)||'').localeCompare(String(getSharedWaterLabel(b)||'')) || String(b.date||'').localeCompare(String(a.date||''));
    if(mode==='bait') return String(getEntryBaitLabel(a)||'').localeCompare(String(getEntryBaitLabel(b)||'')) || String(b.date||'').localeCompare(String(a.date||''));
    return String(b.date||'').localeCompare(String(a.date||'')) || String(b.createdAt||'').localeCompare(String(a.createdAt||''));
  });
  $('entryList').innerHTML='';
  $('entryCount').textContent=`${visible.length} shown / ${state.entries.length} total${skippedInvalidMapPoints ? ` · ${skippedInvalidMapPoints} with invalid map points` : ''}`;
  if(!sortedVisible.length){
    $('entryList').innerHTML='<div class="entryRow empty">No logs match the current filters.</div>';
    return;
  }

  sortedVisible.forEach(entry=>{
    const detail=[entry.species||'—', entry.sizeInches!=null ? `${entry.sizeInches}"` : '', entry.quantity && entry.quantity!==1 ? `x${entry.quantity}` : ''].filter(Boolean).join(' · ');
    const water=getSharedWaterLabel(entry);
    const bait=[entry.baitType, entry.baitSubtype || '', getEntryBaitLabel(entry)].filter(Boolean).join(' · ');
    const conditions=[entry.skyCondition, entry.waterCondition, entry.waterClarity, entry.timeOfDay].filter(Boolean).join(' · ');
    const locateDisabled=!getDrawableMarker(entry) ? ' disabled' : '';
    const row=document.createElement('div');
    row.className='entryRow';
    row.innerHTML=`<div class="entryRowMain"><strong>${escapeHtml(entry.date || '')}</strong> · ${escapeHtml(getSharedOwnerLabel(entry))} · ${escapeHtml(detail)}<br><span>${escapeHtml(water)} · ${escapeHtml(bait || '—')} · ${escapeHtml(conditions || '—')}</span></div><div class="entryRowActions"><button type="button" class="miniBtn locateBtn"${locateDisabled}>Locate</button><button type="button" class="miniBtn deleteBtn">Delete</button></div>`;
    row.querySelector('.locateBtn').addEventListener('click',()=>{
      const drawable=getDrawableMarker(entry);
      if(!drawable){ setStatus('No drawable map point for that log yet.', 2800); return; }
      map.setView([drawable.point.lat,drawable.point.lng],DEFAULT_LOG_ZOOM);
      closeSheet($('reviewSheet'));
    });
    row.querySelector('.deleteBtn').addEventListener('click',()=>{
      if(!confirm('Delete this fishing log?')) return;
      state.entries=state.entries.filter(e=>e.id!==entry.id);
      persistEntries();
      render();
      deleteCloudEntry(entry.id);
    });
    $('entryList').appendChild(row);
  });
}

async function onSubmit(event){
  event.preventDefault();
  const missingField=validateLogForm();
  if(missingField){
    setStatus(`Missing or incomplete: ${missingField}.`, 3800);
    alert(`Missing or incomplete: ${missingField}.`);
    return;
  }
  try{
    const raw=Object.fromEntries(new FormData($('logForm')).entries());
    let baitName='';
    if(raw.baitType==='Fly') baitName=(raw.baitName||'').trim();
    if(raw.baitType==='Lure') baitName=(raw.baitName||'').trim() || raw.baitSubtype || '';
    if(raw.baitType==='Live Bait') baitName=raw.baitSubtype || '';
    if(!baitName) throw new Error('Bait details are incomplete.');
    if(!state.currentDraftMarker) throw new Error('Fishing spot is missing.');
    const ll=state.currentDraftMarker.getLatLng();
    const placeDetails=await reverseLookupPlaceDetails(ll.lat,ll.lng);
    const entry=normalizeEntry({
      id:getSafeRandomId(),
      owner:state.angler.name || DEFAULT_ANGLER_SETTINGS.name,
      anglerKey:state.angler.key || '',
      shareAnglerName:state.angler.shareName!==false,
      createdAt:new Date().toISOString(),
      date:raw.date,
      timeOfDay:raw.timeOfDay,
      waterName:(raw.waterName||'').trim(),
      waterType:determineWaterType({waterName:(raw.waterName||'').trim(), candidateType:raw.waterType, lat:ll.lat, lng:ll.lng}),
      waypointName:(raw.waypointName||'').trim(),
      baitType:raw.baitType,
      baitSubtype:raw.baitSubtype,
      baitName,
      mainColor:raw.mainColor,
      additionalColor:raw.additionalColor,
      baitSize:raw.baitType==='Fly' ? raw.baitSize : '',
      species:raw.species,
      sizeInches:Number(raw.sizeInches||0),
      weight:(raw.weight||'').trim(),
      quantity:Number(raw.quantity||1),
      airTemp:raw.airTemp ? Number(raw.airTemp) : null,
      waterTemp:raw.waterTemp ? Number(raw.waterTemp) : null,
      skyCondition:raw.skyCondition,
      waterCondition:raw.waterCondition,
      waterClarity:raw.waterClarity,
      depthZone:raw.depthZone,
      retrieveSpeed:raw.retrieveSpeed,
      presentationStyle:raw.presentationStyle,
      structureType:raw.structureType,
      hatches:(raw.hatches||'').trim(),
      notes:(raw.notes||'').trim(),
      shareToCloud:true,
      shareLocationLevel:normalizeLocationShareLevel(state.angler.locationShareLevel),
      shareBaitDetails:true,
      shareSizeDetails:true,
      shareNotes:true,
      countyName:placeDetails.county,
      stateName:placeDetails.stateName,
      locationSource:state.currentDraftMeta.source,
      markerAccuracy:state.currentDraftMeta.accuracy,
      marker:{lat:ll.lat,lng:ll.lng}
    });
    state.entries=mergeEntries([entry], state.entries);
    persistEntries();
    clearFormAfterSave();
    render();
    openSheet($('reviewSheet'));
    closeSheet($('logSheet'));
    setStatus('Fishing log saved locally.', 2600);
    if(cloudIsConfigured() && state.cloud.autoSyncOnSave){
      syncCloud({quiet:true}).then(ok=>{
        if(ok) setStatus('Fishing log saved and synced.', 3200);
      });
    }
  }catch(error){
    console.error('Save log failed', error);
    alert(`Save log failed: ${error?.message || 'unknown error'}`);
    setStatus(`Save failed: ${error?.message || 'unknown error'}`, 4200);
  }
}

function applyLogDateTimeDefaults(){
  $('date').value=new Date().toISOString().slice(0,10);
  $('timeOfDay').value=getTimeOfDayForNow(new Date());
}

function clearFormAfterSave(){
  $('logForm').reset();
  applyLogDateTimeDefaults();
  clearDraftMarker();
  $('waterType').value='';
  refreshSharingSummary();
  applyBaitTypeUI();
}

function clearDraftMarker(){
  state.pendingLocationRequestId+=1;
  $('waterName').value='';
  $('waypointName').value='';
  $('waterType').value='';
  clearWaterSuggestions();
  $('waterLookupStatus').textContent='Tap Add Log to use your phone location, or pick a spot on the map.';
  refreshSharingSummary();
  updateLocationSummary();
  state.currentDraftMeta={source:'',accuracy:null};
  if(state.currentDraftMarker){
    map.removeLayer(state.currentDraftMarker);
    state.currentDraftMarker=null;
  }
  cancelAddMode();
}

function openSheet(el){
  if(window.SheetController) return window.SheetController.open(el);
  el.classList.add('visible');
  el.setAttribute('aria-hidden','false');
}

function closeSheet(el){
  if(window.SheetController) return window.SheetController.close(el);
  el.classList.remove('visible');
  el.setAttribute('aria-hidden','true');
}

function closeAllSheets(){
  if(window.SheetController) return window.SheetController.closeAll(['logSheet','anglerSheet','reviewSheet','predictSheet','filterSheet']);
  ['logSheet','anglerSheet','reviewSheet','predictSheet','filterSheet'].forEach(id=>closeSheet($(id)));
}

function wireGenericSheetCloseButtons(){
  if(window.SheetController){
    window.SheetController.bindGenericCloseButtons({ onLogClose: ()=>cancelAddMode() });
    return;
  }
  document.querySelectorAll('.sheetClose').forEach(btn=>{
    btn.addEventListener('click', event=>{
      event.preventDefault();
      event.stopPropagation();
      const sheet=btn.closest('.sheet');
      if(sheet) closeSheet(sheet);
      if(sheet && sheet.id==='logSheet') cancelAddMode();
    });
  });
}

function setStatus(message, duration=2600){
  $('statusBadge').textContent=message;
  $('statusBadge').classList.remove('hidden');
  clearTimeout(setStatus._timer);
  setStatus._timer=setTimeout(()=>$('statusBadge').classList.add('hidden'),duration);
}


function loadAnglerSettings(){
  try{
    const raw=localStorage.getItem(FISHING_ANGLER_SETTINGS_KEY);
    if(!raw) return {...DEFAULT_ANGLER_SETTINGS};
    const parsed=JSON.parse(raw);
    return {
      name:String(parsed.name || DEFAULT_ANGLER_SETTINGS.name).trim() || DEFAULT_ANGLER_SETTINGS.name,
      key:String(parsed.key || '').trim(),
      shareName:parsed.shareName!==false,
      locationShareLevel:normalizeLocationShareLevel(parsed.locationShareLevel || DEFAULT_ANGLER_SETTINGS.locationShareLevel)
    };
  }catch{
    return {...DEFAULT_ANGLER_SETTINGS};
  }
}

function persistAnglerSettings(){
  localStorage.setItem(FISHING_ANGLER_SETTINGS_KEY, JSON.stringify(state.angler));
  localStorage.setItem('fishingLogbook.currentAngler', state.angler.name || DEFAULT_ANGLER_SETTINGS.name);
}

function refreshAnglerUi(){
  if($('anglerNameInput')) $('anglerNameInput').value=state.angler.name || '';
  if($('anglerKeyInput')) $('anglerKeyInput').value=state.angler.key || '';
  if($('shareAnglerNameInput')) $('shareAnglerNameInput').value=state.angler.shareName===false ? 'No' : 'Yes';
  if($('locationShareLevelInput')) $('locationShareLevelInput').value=normalizeLocationShareLevel(state.angler.locationShareLevel);
  if($('anglerPreviewBox')) $('anglerPreviewBox').textContent=`Shared as ${state.angler.shareName===false ? 'Anonymous' : (state.angler.name || 'Anonymous')} · ${normalizeLocationShareLevel(state.angler.locationShareLevel)}`;
  refreshSharingSummary();
}

function refreshSharingSummary(){
  const displayName=state.angler.shareName===false ? 'Anonymous' : (state.angler.name || 'Anonymous');
  if($('sharingSummaryBox')) $('sharingSummaryBox').textContent=`All logs are shared. Current device setup: ${displayName} · ${normalizeLocationShareLevel(state.angler.locationShareLevel)}. Fish details, bait, conditions, and notes are shared; map sharing uses a nearest public access point when possible, otherwise an approximate display point. Your own devices use the exact point when your angler key matches; other anglers draw from the shared point.`;
  if($('sharePreview')) $('sharePreview').value=`${displayName} · ${normalizeLocationShareLevel(state.angler.locationShareLevel)}`;
}

function saveAnglerSettingsFromForm(event){
  event.preventDefault();
  const name=String($('anglerNameInput').value || '').trim();
  if(!name){
    alert('Angler Name is required.');
    $('anglerNameInput').focus();
    return;
  }
  let key=String($('anglerKeyInput').value || '').trim();
  if(!key) key=`angler-${Math.random().toString(36).slice(2,10)}-${Date.now().toString(36)}`;
  state.angler={
    name,
    key,
    shareName:$('shareAnglerNameInput').value!=='No',
    locationShareLevel:normalizeLocationShareLevel($('locationShareLevelInput').value)
  };
  persistAnglerSettings();
  refreshAnglerUi();
  closeSheet($('anglerSheet'));
  setStatus('Angler settings saved.', 2600);
}

function persistEntries(){
  localStorage.setItem(FISHING_STORAGE_KEY, JSON.stringify(normalizeEntryArray(state.entries)));
}

function loadEntries(){
  try{
    const direct=localStorage.getItem(FISHING_STORAGE_KEY);
    if(direct) return normalizeEntryArray(JSON.parse(direct));
    for(const legacyKey of FISHING_LEGACY_STORAGE_KEYS){
      const legacyValue=localStorage.getItem(legacyKey);
      if(!legacyValue) continue;
      const migratedEntries=normalizeEntryArray(JSON.parse(legacyValue));
      if(migratedEntries.length){
        localStorage.setItem(FISHING_STORAGE_KEY, JSON.stringify(migratedEntries));
      }
      return migratedEntries;
    }
    return [];
  }catch{
    return [];
  }
}

function mostCommon(entries,key){
  const counts=new Map();
  for(const entry of entries){
    if(!entry[key]) continue;
    counts.set(entry[key],(counts.get(entry[key])||0)+1);
  }
  const sorted=[...counts.entries()].sort((a,b)=>b[1]-a[1]);
  return sorted.length ? sorted[0][0] : '';
}

function capitalize(v){
  return v ? v.charAt(0).toUpperCase()+v.slice(1) : '';
}

function formatDate(v){
  if(!v) return '';
  const [y,m,d]=v.split('-');
  return `${m}/${d}/${y}`;
}

function escapeHtml(v){
  return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

$('date').value=new Date().toISOString().slice(0,10);
wireGenericSheetCloseButtons();

function rewireLocationButtons(){
  const useBtn=$('useDeviceLocationBtn');
  if(useBtn){
    useBtn.onclick=event=>{
      event.preventDefault();
      event.stopPropagation();
      useCurrentLocation();
    };
  }
  const pickBtn=$('pickOnMapBtn');
  if(pickBtn){
    pickBtn.onclick=event=>{
      event.preventDefault();
      event.stopPropagation();
      beginPickOnMap();
    };
  }
}

populateSpeciesOptions();
populateColorOptions();
populateFilterDropdowns();
refreshAnglerUi();
$('anglerSetupBtn').addEventListener('click',()=>{ refreshAnglerUi(); openSheet($('anglerSheet')); closeSheet($('logSheet')); closeSheet($('reviewSheet')); closeSheet($('filterSheet')); });
$('addLogBtn').addEventListener('click',beginAddLog);
$('reviewBtn').addEventListener('click',()=>{
  cancelAddMode();
  closeAllSheets();
  openSheet($('reviewSheet'));
});
$('filterBtn').addEventListener('click',()=>{
  cancelAddMode();
  closeAllSheets();
  openSheet($('filterSheet'));
});
$('cloudBtn').addEventListener('click', async ()=>{
  const diag=getCloudConfigDiagnostics();
  if(!diag.configured) {
    const message=diag.missing.length
      ? 'Cloud setup is incomplete. Missing: ' + diag.missing.join(', ') + '. Check supabase-config.js and make sure the page can load the Supabase JS library.'
      : 'Cloud setup is incomplete.';
    alert(message);
    return;
  }
  await syncCloud({quiet:false});
});
$('closeLogSheetBtn').addEventListener('click',()=>{
  closeSheet($('logSheet'));
  cancelAddMode();
});
$('closeAnglerSheetBtn').addEventListener('click',()=>closeSheet($('anglerSheet')));

$('predictBtn').addEventListener('click',()=>{ openSheet($('predictSheet')); closeSheet($('logSheet')); closeSheet($('reviewSheet')); closeSheet($('filterSheet')); closeSheet($('anglerSheet')); });
$('closePredictSheetBtn').addEventListener('click',()=>closeSheet($('predictSheet')));
$('predictNotLiveBtn').addEventListener('click',()=>setStatus('Prediction section is just the form shell for now.', 2600));
setOptions($('predictSpecies'), MIDWEST_FISH_SPECIES, 'Choose one');
['sortNewest','sortOldest','sortSpecies','sortAngler','sortWater','sortBait'].forEach(id=>{
  $(id).addEventListener('change',()=>{
    if(!$(id).checked){ $(id).checked=true; return; }
    ['sortNewest','sortOldest','sortSpecies','sortAngler','sortWater','sortBait'].forEach(other=>{ if(other!==id) $(other).checked=false; });
    state.reviewSort=id.replace('sort','').toLowerCase();
    render();
  });
});
$('closeReviewSheetBtn').addEventListener('click',event=>{ event.preventDefault(); event.stopPropagation(); closeSheet($('reviewSheet')); });

$('closeFilterSheetBtn').addEventListener('click',()=>closeSheet($('filterSheet')));
$('anglerForm').addEventListener('submit', saveAnglerSettingsFromForm);
$('generateAnglerKeyBtn').addEventListener('click',()=>{ $('anglerKeyInput').value=`angler-${Math.random().toString(36).slice(2,10)}-${Date.now().toString(36)}`; });
$('copyAnglerKeyBtn').addEventListener('click', async ()=>{ const value=String($('anglerKeyInput').value || '').trim(); if(!value){ setStatus('No sync key to copy yet.', 2600); return; } try{ await navigator.clipboard.writeText(value); setStatus('Sync key copied.', 2200);}catch{ $('anglerKeyInput').select(); setStatus('Copy failed. Key selected so you can copy it manually.', 3200);} });
$('shareAnglerNameInput').addEventListener('change',()=>{ const demoName=String($('anglerNameInput').value || '').trim() || 'Anonymous'; $('anglerPreviewBox').textContent=`Shared as ${$('shareAnglerNameInput').value==='No' ? 'Anonymous' : demoName} · ${normalizeLocationShareLevel($('locationShareLevelInput').value)}`; });
$('anglerNameInput').addEventListener('input',()=>{ const demoName=String($('anglerNameInput').value || '').trim() || 'Anonymous'; $('anglerPreviewBox').textContent=`Shared as ${$('shareAnglerNameInput').value==='No' ? 'Anonymous' : demoName} · ${normalizeLocationShareLevel($('locationShareLevelInput').value)}`; });
$('locationShareLevelInput').addEventListener('change',()=>{ const demoName=String($('anglerNameInput').value || '').trim() || 'Anonymous'; $('anglerPreviewBox').textContent=`Shared as ${$('shareAnglerNameInput').value==='No' ? 'Anonymous' : demoName} · ${normalizeLocationShareLevel($('locationShareLevelInput').value)}`; });
$('clearSpotBtn').addEventListener('click',event=>{ event.preventDefault(); event.stopPropagation(); clearDraftMarker(); });
rewireLocationButtons();
initializeMapPickHandlers();
$('resetFiltersBtn').addEventListener('click',()=>{
  $('filterDateFrom').value='';
  $('filterDateTo').value='';
  $('filterSpecies').value='';
  $('filterColor').value='';
  $('filterBaitType').value='';
  $('filterWaterType').value='';
  $('filterTimeOfDay').value='';
  $('filterSky').value='';
  $('filterRetrieveSpeed').value='';
  state.filters={dateFrom:'',dateTo:'',species:'',color:'',baitType:'',waterType:'',timeOfDay:'',sky:'',retrieveSpeed:''};
  render();
});
['filterDateFrom','filterDateTo','filterSpecies','filterColor','filterBaitType','filterWaterType','filterTimeOfDay','filterSky','filterRetrieveSpeed'].forEach(id=>$(id).addEventListener('change',()=>{
  state.filters.dateFrom=$('filterDateFrom').value;
  state.filters.dateTo=$('filterDateTo').value;
  state.filters.species=$('filterSpecies').value;
  state.filters.color=$('filterColor').value;
  state.filters.baitType=$('filterBaitType').value;
  state.filters.waterType=$('filterWaterType').value;
  state.filters.timeOfDay=$('filterTimeOfDay').value;
  state.filters.sky=$('filterSky').value;
  state.filters.retrieveSpeed=$('filterRetrieveSpeed').value;
  render();
}));
$('baitType').addEventListener('change',applyBaitTypeUI);
$('baitSubtype').addEventListener('change',()=>{
  if($('baitType').value==='Fly'){
    const exact=findExactFly($('baitName').value);
    if(exact && exact.category!==$('baitSubtype').value) $('baitName').value='';
    setBaitHelper('');
    refreshFlySizeOptions();
    updateFlySuggestions($('baitName').value.trim());
    return;
  }
  applySubtypeColorDefaults();
});
$('baitName').addEventListener('input',()=>{
  if($('baitType').value==='Fly'){
    const query=$('baitName').value.trim();
    updateFlySuggestions(query);
    const exact=findExactFly(query, $('baitSubtype').value);
    if(exact) applyFly(exact);
    else {
      refreshFlySizeOptions();
      setBaitHelper('');
    }
  }
});
$('baitName').addEventListener('focus',()=>{
  if($('baitType').value==='Fly'){
    refreshFlySizeOptions();
    updateFlySuggestions($('baitName').value.trim());
  }
});
document.addEventListener('click',event=>{
  if(!$('nameSuggestions').contains(event.target) && event.target!==$('baitName')) $('nameSuggestions').classList.add('hidden');
});
$('waterName').addEventListener('input',()=>{
  const waterName=$('waterName').value.trim();
  if(!waterName) clearWaterSuggestions();
  const inferred=inferWaterTypeFromName(waterName);
  if(inferred) $('waterType').value=inferred;
  refreshSharingSummary();
});
$('waterType').addEventListener('change',refreshSharingSummary);
$('saveBtn').addEventListener('click',()=>{
  const missingField=validateLogForm();
  if(missingField) setStatus(`Missing or incomplete: ${missingField}.`, 3600);
});
$('logForm').addEventListener('submit',onSubmit);
applyBaitTypeUI();
syncAddLogButton();
updateCloudUi();
setStatus(`Fishing Logbook ${APP_VERSION} loaded.`, 2200);
render();
initCloud();

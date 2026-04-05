const APP_VERSION='v10.39.2';
const FishingVocab=window.FishingVocab || {};
const FISHING_STORAGE_KEY='fishingLogbook.entries';
const FISHING_ANGLER_SETTINGS_KEY='fishingLogbook.anglerSettings';
const FISHING_UI_OPTIONS_KEY='fishingLogbook.uiOptions';
const FISHING_FILTERS_KEY='fishingLogbook.savedFilters';
const FISHING_DOCK_STATE_KEY='fishingLogbook.mapOnly';
const FISHING_LEGACY_STORAGE_KEYS=['fishMapTestV10.entries'];
const OVERPASS_URL='https://overpass-api.de/api/interpreter';
const OVERPASS_RADIUS_METERS=1200;
const NOMINATIM_REVERSE_URL='https://nominatim.openstreetmap.org/reverse';
const NOMINATIM_SEARCH_URL='https://nominatim.openstreetmap.org/search';
const DEFAULT_CENTER=[46.62,-87.67];
const DEFAULT_ZOOM=9;
const DEFAULT_LOG_ZOOM=14;
const DEFAULT_ANGLER_SETTINGS={name:localStorage.getItem('fishingLogbook.currentAngler')||localStorage.getItem('fishMap.currentAngler')||'Tod', key:'', shareName:true, locationShareLevel:'Water Type Only'};
const DEFAULT_UI_OPTIONS={mapStyle:'Standard', showWaypoint:false};
const DEFAULT_FILTERS={dateFrom:'',dateTo:'',species:'',color:'',baitType:'',waterType:'',timeOfDay:'',sky:'',retrieveSpeed:'',windDirection:'',waterTemp:'',sizeInches:'',airTemp:''};
const COLOR_SOLID_OPTIONS=FishingVocab.COLOR_SOLID_OPTIONS || ['Black','Blue','Brown','Chartreuse','Copper','Cream','Gold','Gray','Green','Orange','Pink','Purple','Red','Silver','White','Yellow'];
const COLOR_COMBO_OPTIONS=FishingVocab.COLOR_COMBO_OPTIONS || ['Black / Gold','Black / Silver','Blue / Silver','Brown / Orange','Fire Tiger','Glow','Gold / Red','Natural','Perch','Rainbow','Silver / Black','Silver / Blue','Silver / Chartreuse','White / Chartreuse','White / Pink','White / Red'];
const COLOR_OPTIONS=FishingVocab.COLOR_OPTIONS || [...COLOR_SOLID_OPTIONS, ...COLOR_COMBO_OPTIONS];
const ANGLER_MARKER_COLORS=FishingVocab.ANGLER_MARKER_COLORS || ['#2563eb','#dc2626','#16a34a','#ea580c','#7c3aed','#0891b2','#c026d3','#65a30d','#b45309','#be123c','#0f766e','#4f46e5'];
const DEFAULT_FISHING_SUPABASE_CONFIG={url:'',anonKey:'',table:'fishing_catch_logs',appId:'fishing_logbook_shared',autoSyncOnLoad:true,autoSyncOnSave:true};
const FLY_TYPES=FishingVocab.FLY_TYPES || ['Dry','Nymph','Streamer','Emerger','Wet Fly','Terrestrial','Other'];
const LURE_TYPES=FishingVocab.LURE_TYPES || ['Spoon','Plug / Crankbait','Spinner','Jerkbait','Soft Plastic','Jig','Swimbait','Topwater','Other'];
const LIVE_BAIT_TYPES=FishingVocab.LIVE_BAIT_TYPES || ['Minnow','Crawler','Worm','Cut Bait','Spawn','Waxworm / Wiggler','Leech','Grasshopper','Other'];
const ICE_BAIT_TYPES=['Minnow','Shiner','Sucker Minnow','Waxworm / Euro Larva','Mealworm','Spawn','Cut Bait','Soft Plastic','Artificial Jig / Spoon','Other'];
const SKY_OPTIONS=['Clear','Partly Cloudy','Cloudy','Rain','Snow','Night'];
const LAKE_WATER_LEVEL_OPTIONS=['Low','Normal','High'];
const RIVER_WATER_LEVEL_OPTIONS=['Low','Normal','High','Bankfull'];
const LAKE_SURFACE_OPTIONS=['Still','Rippled','Choppy','Wavy','Rolling','Rough'];
const RIVER_CURRENT_OPTIONS=['Slow','Medium','Strong','Fast','Rapids'];
const LAKE_STRUCTURE_TYPES=['Weed Edge','Rock Pile','Drop-off','Point','Flat','Hump','Shoal','Reef','Inside Turn','Outside Turn','Inlet / Outlet','Dock','Marina','Shoreline','Open Water','Timber'];
const LAKE_BOTTOM_TYPES=['Sand','Mud','Silt','Gravel','Rock','Boulder','Clay','Marl','Mixed'];
const RIVER_STRUCTURE_TYPES=['Pool','Riffle','Run','Seam','Undercut Bank','Logjam','Boulder','Current Break','Eddy','Tailout','Bend','Cut Bank','Inside Turn','Pocket Water','Tributary Mouth','Bridge Area'];
const RIVER_BOTTOM_TYPES=['Sand','Mud','Silt','Gravel','Cobble','Boulder','Bedrock','Clay','Mixed'];
const PRESENTATION_OPTIONS={
  'Fly':{styles:['Dead Drift','Swing','Strip','Skate','Nymph Under Indicator','Tight Line / Euro','Dry Fly','Popper'],depths:['Surface','Just Under Surface','Mid-Column','Near Bottom','Bottom'],speeds:['Dead Drift','Slow','Medium','Fast']},
  'Lure':{styles:['Steady Retrieve','Twitch','Jig','Rip','Burn','Trolling','Stop-and-Go','Wake'],depths:['Surface','Shallow','Mid-Column','Deep','Bottom'],speeds:['Slow','Medium','Fast','Erratic']},
  'Live Bait':{styles:['Under Bobber','Slip Float','Bottom Rig','Drift','Free Line','Tip-Up'],depths:['Surface','Shallow','Mid-Column','Near Bottom','Bottom'],speeds:['Static','Slow Drift','Controlled Drift']},
  'Ice':{styles:['Tip-Up','Jigging','Deadstick','Set Line','Spearing / Hand Gaff','Lift and Drop','Pound Bottom','Hover','Swim / Glide'],depths:['Just Under Ice','Upper Column','Mid-Column','Near Bottom','Bottom'],speeds:['Still','Subtle','Moderate','Aggressive']}
};
const MIDWEST_FISH_SPECIES=FishingVocab.MIDWEST_FISH_SPECIES || [
  'Atlantic Salmon','Black Crappie','Bluegill','Bowfin','Brook Trout','Brown Trout','Bullhead','Burbot','Channel Catfish',
  'Chinook Salmon','Cisco','Coho Salmon','Common Carp','Flathead Catfish','Freshwater Drum','Gar','Hybrid Striped Bass',
  'Lake Sturgeon','Lake Trout','Lake Whitefish','Largemouth Bass','Muskellunge','Northern Pike','Pumpkinseed',
  'Rainbow Trout','Rock Bass','Sauger','Smallmouth Bass','Splake','Steelhead','Sunfish','Walleye','White Bass','White Crappie','Whitefish (Lake Whitefish)','Yellow Perch'
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

function loadSavedFilters(){
  try{
    const raw=localStorage.getItem(FISHING_FILTERS_KEY);
    if(!raw) return {...DEFAULT_FILTERS};
    return {...DEFAULT_FILTERS, ...JSON.parse(raw)};
  }catch{
    return {...DEFAULT_FILTERS};
  }
}

function persistFilters(){
  try{ localStorage.setItem(FISHING_FILTERS_KEY, JSON.stringify(state.filters || DEFAULT_FILTERS)); }catch{}
}

function loadDockHidden(){
  try{ return localStorage.getItem(FISHING_DOCK_STATE_KEY)==='1'; }catch{ return false; }
}

function persistDockHidden(isHidden){
  try{ localStorage.setItem(FISHING_DOCK_STATE_KEY, isHidden ? '1' : '0'); }catch{}
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
  filters:loadSavedFilters(),
  ui:loadUiOptions(),
  cloud:{configured:false,ready:false,syncing:false,status:'Local only',lastSyncAt:'',lastError:'',client:null,table:DEFAULT_FISHING_SUPABASE_CONFIG.table,appId:DEFAULT_FISHING_SUPABASE_CONFIG.appId,autoSyncOnSave:true}
};

const $=id=>document.getElementById(id);
const map=L.map('map',{zoomControl:true,preferCanvas:true}).setView(DEFAULT_CENTER,DEFAULT_ZOOM);
const baseLayers={
  Standard:L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}),
  Satellite:L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles &copy; Esri'})
};
let activeBaseLayer=null;
applyMapStyle(state.ui?.mapStyle || 'Standard');
state.markerCluster=L.markerClusterGroup();
map.addLayer(state.markerCluster);

function setOptions(select, values, placeholder='Choose one'){
  if(!select) return;
  const previous=select.value;
  select.innerHTML=`<option value="">${placeholder}</option>`;
  values.forEach(v=>{
    const o=document.createElement('option');
    o.value=v;
    o.textContent=v;
    select.appendChild(o);
  });
  if(previous && values.includes(previous)) select.value=previous;
  if(select.dataset.sheetSelectReady==='true') updateSheetSelectTrigger(select);
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
  const accessPoint=await findNearestPublicAccessPoint(entry);
  if(accessPoint && Number.isFinite(accessPoint.lat) && Number.isFinite(accessPoint.lng)) {
    return {lat:accessPoint.lat, lng:accessPoint.lng, label:accessPoint.label || 'Public access', exact:false, method:'public-access'};
  }
  return {lat, lng, label:'Saved fishing spot', exact:false, method:'saved-spot'};
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
  let buttonText='Cloud Sync';
  let summary='Local-only mode. Add Supabase details in supabase-config.js to share logs across devices. Angler settings control whether your name is shown and whether locations are shared by water type or body of water name.';

  if(state.cloud.syncing){
    badgeText='Cloud syncing…';
    buttonText='Syncing…';
    summary='Syncing local and shared logs now.';
  }else if(state.cloud.ready){
    badgeText='Cloud connected';
    buttonText='Cloud Sync';
    summary=`Shared database connected. ${state.cloud.lastSyncAt ? 'Last sync: ' + formatCloudSyncTime(state.cloud.lastSyncAt) + '.' : 'Ready to sync.'}`;
  }else if(state.cloud.configured){
    badgeText='Cloud error';
    buttonText='Cloud Sync';
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
    waterDepthFt:entry.waterDepthFt==='' || entry.waterDepthFt==null ? null : Number(entry.waterDepthFt),
    wind:entry.wind || '',
    windDirection:entry.windDirection || '',
    bottomType:entry.bottomType || '',
    presentationDepthFt:entry.presentationDepthFt==='' || entry.presentationDepthFt==null ? null : Number(entry.presentationDepthFt),
    surfaceCondition:entry.surfaceCondition || '',
    currentSpeed:entry.currentSpeed || '',
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
    water_depth_ft:entry.waterDepthFt,
    presentation_depth_ft:entry.presentationDepthFt,
    wind:entry.wind || null,
    sky_condition:entry.skyCondition || null,
    water_condition:entry.waterCondition || null,
    water_clarity:entry.waterClarity || null,
    surface_condition:entry.surfaceCondition || null,
    current_speed:entry.currentSpeed || null,
    depth_zone:entry.depthZone || null,
    retrieve_speed:entry.retrieveSpeed || null,
    presentation_style:entry.presentationStyle || null,
    wind_direction:entry.windDirection || null,
    structure_type:entry.structureType || null,
    bottom_type:entry.bottomType || null,
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
    waterDepthFt:row.water_depth_ft==='' || row.water_depth_ft==null ? null : Number(row.water_depth_ft),
    presentationDepthFt:row.presentation_depth_ft==='' || row.presentation_depth_ft==null ? null : Number(row.presentation_depth_ft),
    wind:row.wind || '',
    skyCondition:row.sky_condition || '',
    waterCondition:row.water_condition || '',
    waterClarity:row.water_clarity || '',
    surfaceCondition:row.surface_condition || '',
    currentSpeed:row.current_speed || '',
    depthZone:row.depth_zone || '',
    retrieveSpeed:row.retrieve_speed || '',
    presentationStyle:row.presentation_style || '',
    windDirection:row.wind_direction || '',
    structureType:row.structure_type || '',
    bottomType:row.bottom_type || '',
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
    {label:'Body of Water', el:$('waterName'), value:$('waterName').value.trim()},
    {label:'Air Temp', el:$('airTemp'), value:$('airTemp').value.trim()},
    {label:'Sky', el:$('skyCondition'), value:$('skyCondition').value},
    {label:'Water Depth', el:$('waterDepthFt'), value:$('waterDepthFt').value.trim()},
    {label:'Wind Direction', el:$('windDirection'), value:$('windDirection').value},
    {label:'Fishing Type', el:$('baitType'), value:$('baitType').value},
    {label:'Bait / Fly / Lure', el:$('baitSubtype'), value:$('baitSubtype').value},
    {label:'Color', el:$('mainColor'), value:$('mainColor').value},
    {label:'Results', el:$('species'), value:$('species').value}
  ];
  for(const field of requiredChecks){
    if(!String(field.value || '').trim()) return field;
  }
  if(!state.currentDraftMarker) return {label:'Location', el:$('useDeviceLocationBtn') || $('pickOnMapBtn') || $('waterName'), message:'Use My Location or Pick on Map to set the location.'};
  return null;
}

function focusMissingField(field){
  if(!field) return;
  document.querySelectorAll('#logForm .field-missing').forEach(el=>el.classList.remove('field-missing'));
  const el=field.el;
  if(!el) return;
  const wrapper=el.closest('label, .typeahead-wrap, .location-actions, .helper-box');
  if(wrapper) wrapper.classList.add('field-missing');
  const target=(el.tagName==='SELECT' && el.nextElementSibling && el.nextElementSibling.classList.contains('sheet-select-trigger')) ? el.nextElementSibling : el;
  if(wrapper) wrapper.scrollIntoView({behavior:'smooth', block:'center', inline:'nearest'});
  setTimeout(()=>{ try{ target.focus({preventScroll:true}); }catch{ try{ target.focus(); }catch{} } }, 140);
}


function populateSpeciesOptions(){
  const formValue=$('species').value;
  const filterValue=$('filterSpecies').value;
  const reviewFilterValue=$('reviewFilterSpecies') ? $('reviewFilterSpecies').value : '';
  setOptions($('species'), MIDWEST_FISH_SPECIES, 'Choose one');
  setOptions($('filterSpecies'), MIDWEST_FISH_SPECIES, 'All');
  if($('reviewFilterSpecies')) setOptions($('reviewFilterSpecies'), MIDWEST_FISH_SPECIES, 'All');
  if(formValue && MIDWEST_FISH_SPECIES.includes(formValue)) $('species').value=formValue;
  if(filterValue && MIDWEST_FISH_SPECIES.includes(filterValue)) $('filterSpecies').value=filterValue;
  if(reviewFilterValue && MIDWEST_FISH_SPECIES.includes(reviewFilterValue) && $('reviewFilterSpecies')) $('reviewFilterSpecies').value=reviewFilterValue;
  if($('predictSpecies')) setOptions($('predictSpecies'), MIDWEST_FISH_SPECIES, 'Choose one');
}


function populateFilterDropdowns(){
  const baitTypes=['Fly','Lure','Live Bait','Ice'];
  const baitTypeValue=$('filterBaitType') ? $('filterBaitType').value : '';
  const reviewBaitTypeValue=$('reviewFilterBaitType') ? $('reviewFilterBaitType').value : '';
  setOptions($('filterBaitType'), baitTypes, 'All');
  if($('reviewFilterBaitType')) setOptions($('reviewFilterBaitType'), baitTypes, 'All');
  if(baitTypeValue && baitTypes.includes(baitTypeValue)) $('filterBaitType').value=baitTypeValue;
  if(reviewBaitTypeValue && baitTypes.includes(reviewBaitTypeValue) && $('reviewFilterBaitType')) $('reviewFilterBaitType').value=reviewBaitTypeValue;
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

function disarmMapPick(){
  state.pickOnMapArmed=false;
  if(state._mapPickFallbackTimer){
    clearTimeout(state._mapPickFallbackTimer);
    state._mapPickFallbackTimer=null;
  }
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
  applyLogDateTimeDefaults();
  updateConditionFieldsForWaterType();
  openSheet($('logSheet'));
  requestAnimationFrame(()=>{ map.invalidateSize(); updateFieldFillStates(); });
  if(state.currentDraftMarker){
    const ll=state.currentDraftMarker.getLatLng();
    updateLocationSummary(ll.lat, ll.lng, state.currentDraftMeta.accuracy, state.currentDraftMeta.source);
    setWaterLookupStatusText('Spot already set. You can use your location again, drag the marker, or pick a new spot on the map.');
  }else{
    setWaterLookupStatusText('');
  }
  setStatus('Log opened.', 2200);
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
  requestAnimationFrame(()=>{ map.invalidateSize(); updateFieldFillStates(); });
  setWaterLookupStatusText('Map spot set. Checking nearby water...');
  await detectNearbyWater(Number(lat),Number(lng));
  setStatus('Spot set from map. Fill out the log and save it.', 3600);
}


let _mapPickInitialized=false;
function ensureMapPickOverlay(){
  if(state.mapPickOverlay && document.body.contains(state.mapPickOverlay)) return state.mapPickOverlay;
  const overlay=document.createElement('div');
  overlay.id='mapPickOverlay';
  overlay.className='map-pick-overlay';
  overlay.setAttribute('aria-hidden','true');
  document.body.appendChild(overlay);
  state.mapPickOverlay=overlay;
  return overlay;
}

function hideMapPickOverlay(){
  const overlay=ensureMapPickOverlay();
  overlay.classList.remove('visible');
  overlay.setAttribute('aria-hidden','true');
  overlay.style.pointerEvents='none';
}

function showMapPickOverlay(){
  const overlay=ensureMapPickOverlay();
  const mapEl=map.getContainer();
  const rect=mapEl.getBoundingClientRect();
  overlay.style.left=rect.left+'px';
  overlay.style.top=rect.top+'px';
  overlay.style.width=rect.width+'px';
  overlay.style.height=rect.height+'px';
  overlay.classList.add('visible');
  overlay.setAttribute('aria-hidden','false');
  overlay.style.pointerEvents='auto';
}

function detachMapPickHandlers(){
  const overlay=state.mapPickOverlay;
  if(overlay && state._mapPickOverlayHandler){
    ['click','pointerup','touchend','mouseup'].forEach(type=>overlay.removeEventListener(type, state._mapPickOverlayHandler, true));
  }
  state._mapPickOverlayHandler=null;
  hideMapPickOverlay();
}

function initializeMapPickHandlers(){
  if(_mapPickInitialized) return;
  _mapPickInitialized=true;
  window.addEventListener('resize', ()=>{ if(state.pickOnMapArmed) showMapPickOverlay(); });
  window.addEventListener('scroll', ()=>{ if(state.pickOnMapArmed) showMapPickOverlay(); }, true);
}

function armMapPickHandlers(){
  detachMapPickHandlers();
  const overlay=ensureMapPickOverlay();
  state._mapPickOverlayHandler=async event=>{
    if(!state.pickOnMapArmed || !state.addMode) return;
    if(event.type==='pointerup' && event.pointerType==='mouse' && event.button!==0) return;
    event.preventDefault();
    event.stopPropagation();
    const ll=pointFromClientEvent(event);
    if(!ll || !Number.isFinite(ll.lat) || !Number.isFinite(ll.lng)){
      setStatus('Map pick failed. Tap the map again.', 3200);
      return;
    }
    await finishMapPick(ll.lat,ll.lng);
  };
  ['click','pointerup','touchend','mouseup'].forEach(type=>overlay.addEventListener(type, state._mapPickOverlayHandler, true));
  showMapPickOverlay();
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
  setWaterLookupStatusText('Pick on Map is active. Tap the map once to set the spot.');
  try{ map.invalidateSize(); showMapPickOverlay(); }catch(_e){}
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
  const bits=[locationSourceLabel(source), 'Spot locked in on the map'];
  if(Number.isFinite(accuracy)) bits.push(`±${Math.round(accuracy)} m`);
  summary.textContent=bits.join(' · ');
  summary.classList.remove('hidden');
}

function updateDraftMarkerPopup(){
  if(!state.currentDraftMarker) return;
  const bits=[locationSourceLabel(state.currentDraftMeta.source), 'Fishing spot'];
  if(Number.isFinite(state.currentDraftMeta.accuracy)) bits.push(`±${Math.round(state.currentDraftMeta.accuracy)} m`);
  state.currentDraftMarker.bindPopup(bits.join(' · '));
}

async function useCurrentLocation({auto=false, confirmBeforeOpen=false}={}){
  if(!supportsGeolocation()){
    setWaterLookupStatusText('This browser does not support device location here. Use Pick on Map.');
    if(auto && confirmBeforeOpen) openSheet($('logSheet'));
    if(!auto) setStatus('No device location available in this browser.', 3200);
    return;
  }
  cancelAddMode();
  const requestId=++state.pendingLocationRequestId;
  setLocationControlsDisabled(true);
  setWaterLookupStatusText('Requesting your device location...');
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
        setWaterLookupStatusText('Location not confirmed. Tap the map to choose the spot instead.');
        setStatus('Tap the map to choose your spot.', 3600);
        return;
      }
      openSheet($('logSheet'));
  requestAnimationFrame(()=>{ map.invalidateSize(); updateFieldFillStates(); });
      closeSheet($('reviewSheet'));
      closeSheet($('filterSheet'));
      setWaterLookupStatusText(`Using your device location${accuracyText}. Checking nearby water...`);
      await detectNearbyWater(latitude, longitude);
      setStatus('Location confirmed. Fill out the log and save it.', 3600);
      return;
    }

    setWaterLookupStatusText(`Using your device location${Number.isFinite(accuracy) ? ` (±${Math.round(accuracy)} m)` : ''}. Drag the marker or use Pick on Map if you need to tweak it.`);
    await detectNearbyWater(latitude, longitude);
    setStatus('Device location set.', 3200);
  }, error=>{
    if(requestId!==state.pendingLocationRequestId){
      setLocationControlsDisabled(false);
      return;
    }
    const message=getGeoErrorMessage(error);
    setWaterLookupStatusText(`Could not get device location (${message}). Use Pick on Map instead.`);
    setLocationControlsDisabled(false);
    if(auto && confirmBeforeOpen){
      openSheet($('logSheet'));
  requestAnimationFrame(()=>{ map.invalidateSize(); updateFieldFillStates(); });
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
  if(!helper) return;
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

const LURE_TYPE_EXAMPLES={
  'Spoon':'Common example: Little Cleo or Kastmaster.',
  'Plug / Crankbait':'Common example: Rapala Shad Rap or Original Floating Rapala.',
  'Spinner':'Common example: Mepps Aglia inline spinner.',
  'Jerkbait':'Common example: Rapala X-Rap or Husky Jerk.',
  'Soft Plastic':'Common example: Zoom Super Fluke or a straight-tail worm.',
  'Jig':'Common example: a bucktail jig or round-head jig with a grub.',
  'Swimbait':'Common example: a paddle-tail like a Keitech Swing Impact on a jighead.',
  'Topwater':'Common example: Heddon Zara Spook or Jitterbug.',
  'Other':'Pick the closest family and use Notes when it needs more detail.'
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
  const grid=$('lureColorGrid');
  if(grid) grid.classList.remove('hidden');
  ['mainColorWrap','additionalColorWrap'].forEach(id=>{ const el=$(id); if(el) el.classList.remove('hidden'); });
  const mainLabel=$('mainColorWrap');
  const addLabel=$('additionalColorWrap');
  if(mainLabel) setLabelText(mainLabel, 'Color');
  if(addLabel) setLabelText(addLabel, 'Accent Color');
  $('mainColor').required=true;
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



function isRiverLikeWaterType(value=''){
  return value==='River' || value==='Stream';
}

function syncMirroredConditionFields(){}


function updateConditionFieldsForWaterType(){
  const waterType=$('waterType').value || 'Lake';
  const riverLike=isRiverLikeWaterType(waterType);
  const isGreatLake=waterType==='Great Lake';
  const currentValues={
    waterCondition:$('waterCondition')?.value || '',
    structureType:$('structureType')?.value || '',
    bottomType:$('bottomType')?.value || '',
    surfaceCondition:$('surfaceCondition')?.value || '',
    currentSpeed:$('currentSpeed')?.value || ''
  };
  const waterCondition=$('waterCondition');
  const structure=$('structureType');
  const bottomType=$('bottomType');
  const surfaceWrap=$('surfaceConditionWrap');
  const currentWrap=$('currentSpeedWrap');
  const greatLakeDepthRow=$('greatLakeDepthRow');
  setOptions(waterCondition, riverLike ? RIVER_WATER_LEVEL_OPTIONS : LAKE_WATER_LEVEL_OPTIONS, 'Choose one');
  setOptions(structure, riverLike ? RIVER_STRUCTURE_TYPES : LAKE_STRUCTURE_TYPES, 'Choose one');
  if(bottomType) setOptions(bottomType, riverLike ? RIVER_BOTTOM_TYPES : LAKE_BOTTOM_TYPES, 'Choose one');
  if(surfaceWrap) surfaceWrap.classList.toggle('hidden', riverLike);
  if(currentWrap) currentWrap.classList.toggle('hidden', !riverLike);
  if(riverLike){
    setOptions($('currentSpeed'), RIVER_CURRENT_OPTIONS, 'Choose one');
    if($('surfaceCondition')) $('surfaceCondition').value='';
  }else{
    setOptions($('surfaceCondition'), LAKE_SURFACE_OPTIONS, 'Choose one');
    if($('currentSpeed')) $('currentSpeed').value='';
  }
  if(currentValues.waterCondition && [...waterCondition.options].some(o=>o.value===currentValues.waterCondition)) waterCondition.value=currentValues.waterCondition;
  if(currentValues.structureType && [...structure.options].some(o=>o.value===currentValues.structureType)) structure.value=currentValues.structureType;
  if(bottomType && currentValues.bottomType && [...bottomType.options].some(o=>o.value===currentValues.bottomType)) bottomType.value=currentValues.bottomType;
  if(!riverLike && $('surfaceCondition') && currentValues.surfaceCondition && [...$('surfaceCondition').options].some(o=>o.value===currentValues.surfaceCondition)) $('surfaceCondition').value=currentValues.surfaceCondition;
  if(riverLike && $('currentSpeed') && currentValues.currentSpeed && [...$('currentSpeed').options].some(o=>o.value===currentValues.currentSpeed)) $('currentSpeed').value=currentValues.currentSpeed;
  if(greatLakeDepthRow) greatLakeDepthRow.classList.toggle('hidden', !isGreatLake);
  if(!isGreatLake && $('presentationDepthFt')) $('presentationDepthFt').value='';
  updateSheetSelectTriggers();
  updateFieldFillStates();
}


function updatePresentationOptions(){
  const type=$('baitType').value;
  const profile=PRESENTATION_OPTIONS[type] || {styles:[],depths:[],speeds:[]};
  setOptions($('presentationStyle'), profile.styles, 'Choose one');
  setOptions($('depthZone'), profile.depths, 'Choose one');
  setOptions($('retrieveSpeed'), profile.speeds, 'Choose one');
}

function updateHatchesVisibility(){
  const wrap=$('hatchesWrap');
  const show=$('baitType').value==='Fly';
  if(wrap) wrap.classList.toggle('hidden', !show);
  if(!show && $('hatches')) $('hatches').value='';
  updateSheetSelectTriggers();
}

function updateBaitHelperContext(){
  const helper=$('baitHelper');
  if(!helper) return;

  const type=$('baitType').value;
  const subtype=$('baitSubtype').value;
  if(type==='Fly'){
    if(!$('baitName').value.trim()) setBaitHelper('Start typing a fly pattern to see matches and suggested sizes.');
    else setBaitHelper('Fly fishing selected. Hatch appears only here, where it belongs.');
    return;
  }
  if(type==='Lure'){
    setBaitHelper(subtype ? (LURE_TYPE_EXAMPLES[subtype] || LURE_TYPE_EXAMPLES.Other) : 'Choose a lure type and a plain-English example will show here.');
    return;
  }
  if(type==='Live Bait'){
    setBaitHelper(subtype ? `Bait selected: ${subtype}.` : 'Choose your bait approach first.');
    return;
  }
  if(type==='Ice'){
    setBaitHelper(subtype ? `Ice bait selected: ${subtype}. Choose how you fished it in Presentation Style.` : 'Choose the bait first, then set Presentation Style, Depth, and Speed.');
    return;
  }
  setBaitHelper('');
}

function applyBaitTypeUI(){
  const type=$('baitType').value;
  const baitSubtype=$('baitSubtype');
  const baitSize=$('baitSize');
  const baitName=$('baitName');
  $('nameSuggestions').classList.add('hidden');
  baitName.value='';
  baitSize.innerHTML='<option value="">Choose one</option>';
  if($('baitHelper')) setBaitHelper('');

  baitSubtype.disabled=false;
  baitSubtype.required=false;
  baitSize.disabled=true;
  baitSize.required=false;
  baitName.disabled=false;
  baitName.required=false;
  updatePresentationOptions();
  updateHatchesVisibility();

  if(type==='Fly'){
    $('subtypeWrap').classList.remove('hidden');
    $('sizeWrap').classList.remove('hidden');
    $('nameWrap').classList.add('hidden');
    setOptions(baitSubtype, FLY_TYPES, 'Choose fly type');
    setLabelText($('subtypeWrap'), 'Fly Type');
    setLabelText($('nameLabel'), 'Fly Pattern');
    baitSubtype.required=true;
    baitSize.disabled=false;
    baitSize.required=true;
    baitName.required=false;
    baitName.placeholder='';
    refreshFlySizeOptions();
  } else if(type==='Lure'){
    $('subtypeWrap').classList.remove('hidden');
    $('sizeWrap').classList.add('hidden');
    $('nameWrap').classList.add('hidden');
    setOptions(baitSubtype, LURE_TYPES, 'Choose lure type');
    setLabelText($('subtypeWrap'), 'Lure Type');
    setLabelText($('nameLabel'), 'Lure Name (optional)');
    baitSubtype.required=true;
    baitName.placeholder='';
  } else if(type==='Live Bait'){
    $('subtypeWrap').classList.remove('hidden');
    $('sizeWrap').classList.add('hidden');
    $('nameWrap').classList.add('hidden');
    setOptions(baitSubtype, LIVE_BAIT_TYPES, 'Choose bait type');
    setLabelText($('subtypeWrap'), 'Bait Type');
    baitSubtype.required=true;
    baitName.disabled=true;
  } else if(type==='Ice'){
    $('subtypeWrap').classList.remove('hidden');
    $('sizeWrap').classList.add('hidden');
    $('nameWrap').classList.add('hidden');
    setOptions(baitSubtype, ICE_BAIT_TYPES, 'Choose ice bait');
    setLabelText($('subtypeWrap'), 'Ice Bait');
    baitSubtype.required=true;
    baitName.disabled=true;
  } else {
    $('subtypeWrap').classList.add('hidden');
    $('sizeWrap').classList.add('hidden');
    $('nameWrap').classList.add('hidden');
    setOptions(baitSubtype, [], 'Choose one');
    setLabelText($('subtypeWrap'), '');
    setLabelText($('nameLabel'), '');
    baitName.placeholder='';
    baitName.disabled=true;
  }
  updateColorFieldVisibility();
  updateHatchesVisibility();
  updatePresentationOptions();
  updateBaitHelperContext();
  updateSheetSelectTriggers();
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
  setWaterLookupStatusText('Checking nearby named water...');
  clearWaterSuggestions();
  const reverseMatch=await reverseLookupWaterName(lat,lng,{zoom:'18'});
  const query=`[out:json][timeout:25];(way["waterway"~"river|stream|canal|ditch"](around:${OVERPASS_RADIUS_METERS},${lat},${lng});relation["waterway"~"river|stream|canal|ditch"](around:${OVERPASS_RADIUS_METERS},${lat},${lng});way["natural"="water"](around:${OVERPASS_RADIUS_METERS},${lat},${lng});relation["natural"="water"](around:${OVERPASS_RADIUS_METERS},${lat},${lng});way["water"~"lake|pond|reservoir"](around:${OVERPASS_RADIUS_METERS},${lat},${lng});relation["water"~"lake|pond|reservoir"](around:${OVERPASS_RADIUS_METERS},${lat},${lng});relation["place"="sea"](around:${OVERPASS_RADIUS_METERS},${lat},${lng}););out tags center;`;
  try{
    const response=await fetch(OVERPASS_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:query});
    if(!response.ok) throw new Error(`Overpass returned ${response.status}`);
    const data=await response.json();
    const candidates=rankWaterCandidates(normalizeWaterCandidates(data.elements||[],lat,lng), lat, lng, reverseMatch);
    if(candidates.length) setWaterSuggestions(candidates);
    const chosen=chooseBestWaterCandidate(candidates, reverseMatch);
    if(chosen){
      $('waterName').value=chosen.name;
      $('waterType').value=determineWaterType({waterName:chosen.name, candidateType:chosen.featureLabel, lat, lng});
      updateConditionFieldsForWaterType();
      refreshSharingSummary();
      setWaterLookupStatusText(chosen.reason==='reverse-match'
        ? `Matched nearby water: ${chosen.name}.`
        : `Matched nearby water: ${chosen.name}. Check the suggestions if you meant a different spot.`);
      return;
    }
    const fallbackName=await fallbackNearbyWaterName(lat,lng, reverseMatch);
    if(fallbackName){
      $('waterName').value=fallbackName;
      $('waterType').value=determineWaterType({waterName:fallbackName, lat, lng});
      updateConditionFieldsForWaterType();
      refreshSharingSummary();
      setWaterLookupStatusText(`Matched nearby water: ${fallbackName}.`);
      return;
    }
    setWaterLookupStatusText(candidates.length ? `Found ${candidates.length} nearby water features. Pick the right one in the Body of Water field.` : 'No named nearby water found. Type it manually if needed.');
  }catch(error){
    const fallbackName=await fallbackNearbyWaterName(lat,lng, reverseMatch);
    if(fallbackName){
      $('waterName').value=fallbackName;
      $('waterType').value=determineWaterType({waterName:fallbackName, lat, lng});
      updateConditionFieldsForWaterType();
      refreshSharingSummary();
      setWaterLookupStatusText(`Matched nearby water: ${fallbackName}.`);
      return;
    }
    setWaterLookupStatusText(`Nearby-water lookup failed: ${error.message}. Type the body of water manually.`);
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
    const existing=dedupe.get(key);
    if(!existing || existing.distance > distance){
      dedupe.set(key,{name,featureLabel,distance,score:distance,reason:'distance'});
    }
  }
  return [...dedupe.values()].sort((a,b)=>a.distance-b.distance).slice(0,12);
}

function normalizeWaterNameForMatch(value=''){
  return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/(lake|river|stream|creek|pond|reservoir|bay|harbor|canal|ditch|brook|branch|fork)/g,'').replace(/\s+/g,' ').trim();
}

function isGreatLakeName(value=''){
  return /^(lake superior|lake michigan|lake huron|lake erie|lake ontario)$/i.test(String(value||'').trim());
}

function rankWaterCandidates(candidates, lat, lng, reverseName=''){
  const reverseKey=normalizeWaterNameForMatch(reverseName);
  return (candidates||[]).map(candidate=>{
    let score=candidate.distance;
    let reason='distance';
    const candidateKey=normalizeWaterNameForMatch(candidate.name);
    const combined=`${candidate.name} ${candidate.featureLabel}`.toLowerCase();
    if(reverseKey){
      if(candidateKey && candidateKey===reverseKey){
        score-=3000;
        reason='reverse-match';
      }else if(candidateKey && (candidateKey.includes(reverseKey) || reverseKey.includes(candidateKey))){
        score-=1800;
        reason='reverse-close-match';
      }
    }
    if(isGreatLakeName(candidate.name) && !isGreatLakeName(reverseName) && candidates.some(item=>!isGreatLakeName(item.name))) score+=2500;
    if(/(river|stream|creek|brook|branch|fork)/i.test(combined)) score-=120;
    if(/(lake|pond|reservoir|bay|harbor)/i.test(combined)) score-=60;
    return {...candidate, score, reason};
  }).sort((a,b)=>a.score-b.score || a.distance-b.distance).slice(0,8);
}

function chooseBestWaterCandidate(candidates, reverseName=''){
  if(!(candidates||[]).length) return null;
  const first=candidates[0];
  const second=candidates[1] || null;
  if(first.reason==='reverse-match' || first.reason==='reverse-close-match') return first;
  if(!second) return first;
  if(first.score <= second.score * 0.55) return first;
  if(first.distance <= 120 && second.distance >= 350) return first;
  return null;
}

async function fallbackNearbyWaterName(lat,lng, initialReverseName=''){
  if(initialReverseName) return initialReverseName;
  const reverseName=await reverseLookupWaterName(lat,lng,{zoom:'14'});
  if(reverseName) return reverseName;
  return '';
}

async function reverseLookupWaterName(lat,lng,{zoom='14'}={}){
  const params=new URLSearchParams({format:'jsonv2',lat:String(lat),lon:String(lng),zoom:String(zoom),addressdetails:'1'});
  try{
    const response=await fetch(`${NOMINATIM_REVERSE_URL}?${params.toString()}`,{headers:{'Accept':'application/json'}});
    if(!response.ok) return '';
    const data=await response.json();
    const address=data.address || {};
    const direct=[address.body_of_water,address.water,address.sea,address.bay,address.lake,address.river,address.stream,address.reservoir,address.canal].find(value=>typeof value==='string' && value.trim());
    if(direct) return direct.trim();
    const candidates=[data?.name, data?.display_name].filter(value=>typeof value==='string' && value.trim()).flatMap(value=>value.split(',')).map(value=>value.trim()).filter(Boolean);
    return candidates.find(value=>/(lake|river|stream|creek|pond|bay|harbor|reservoir|canal|ditch)/i.test(value)) || '';
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

function setWaterLookupStatusText(text=''){
  const box=$('waterLookupStatus');
  if(!box) return;
  box.textContent=text || '';
  box.classList.toggle('hidden', !String(text || '').trim());
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
      setWaterLookupStatusText('Marker adjusted. Checking nearby water again...');
      await detectNearbyWater(ll.lat,ll.lng);
      setStatus('Spot adjusted.', 2600);
    });
  }
  if(recenter) map.setView([lat,lng], Math.max(map.getZoom(), DEFAULT_LOG_ZOOM));
  updateDraftMarkerPopup();
  updateLocationSummary(lat,lng,state.currentDraftMeta.accuracy,state.currentDraftMeta.source);
}

function matchesNumericFilter(filterValue, entryValue){
  const filterText=String(filterValue || '').trim();
  if(!filterText) return true;
  if(entryValue==null || entryValue==='') return false;
  const normalized=filterText.replace(/\s+/g,'');
  const operator=normalized.endsWith('+') ? '+' : (normalized.endsWith('-') ? '-' : '');
  const numericPart=operator ? normalized.slice(0,-1) : normalized;
  const target=Number(numericPart);
  const actual=Number(entryValue);
  if(!Number.isFinite(target) || !Number.isFinite(actual)) return false;
  if(operator==='+') return actual>=target;
  if(operator==='-') return actual<=target;
  return actual===target;
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
    if(state.filters.windDirection && entry.windDirection!==state.filters.windDirection) return false;
    if(state.filters.waterTemp && !matchesNumericFilter(state.filters.waterTemp, entry.waterTemp)) return false;
    if(state.filters.sizeInches && !matchesNumericFilter(state.filters.sizeInches, entry.sizeInches)) return false;
    if(state.filters.airTemp && !matchesNumericFilter(state.filters.airTemp, entry.airTemp)) return false;
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
    const approxLabel=(entry.markerAccuracy==='nearest-public-access' || (entry.locationSource||'').startsWith('shared-access')) ? 'Nearest public access' : 'Saved fishing spot';
    const coordLine=drawable.exact ? '<br>Exact spot on your map' : `<br>${escapeHtml(approxLabel)}`;
    const techniqueLine=[entry.presentationStyle || '', entry.presentationDepthFt!=null ? `Presentation ${entry.presentationDepthFt} ft` : (entry.depthZone ? `Presentation ${entry.depthZone}` : ''), entry.waterDepthFt!=null ? `Water ${entry.waterDepthFt} ft` : '', [entry.wind||'', entry.windDirection||''].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
    marker.bindPopup(`<div><strong>${escapeHtml(getSharedOwnerLabel(entry))}</strong><br>${waterLine}${waypointLine}<br>${escapeHtml(entry.species)}${entry.sizeInches!=null ? ' · ' + escapeHtml(String(entry.sizeInches)) + '"' : ''}${entry.quantity!=null ? ' · Qty ' + escapeHtml(String(entry.quantity)) : ''}<br>${escapeHtml(getEntryBaitLabel(entry))}${entry.baitSize ? ' · #' + escapeHtml(entry.baitSize) : ''} · ${escapeHtml(entry.baitType)}${techniqueLine ? '<br>' + escapeHtml(techniqueLine) : ''}${coordLine}</div>`);
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
    const waterMotion=isRiverLikeWaterType(entry.waterType) ? entry.currentSpeed : entry.surfaceCondition;
    const conditions=[entry.skyCondition, entry.airTemp!=null ? `${entry.airTemp}° air` : '', entry.waterDepthFt!=null ? `${entry.waterDepthFt} ft` : '', entry.windDirection || '', entry.waterCondition, entry.waterClarity, waterMotion || '', entry.bottomType || '', entry.timeOfDay].filter(Boolean).join(' · ');
    const locateDisabled=!getDrawableMarker(entry) ? ' disabled' : '';
    const canDelete=!!(state.angler?.key && entry.anglerKey && state.angler.key===entry.anglerKey) || (!!entry.owner && !entry.anglerKey && entry.owner===state.angler?.name);
    const deleteDisabled=canDelete ? '' : ' disabled';
    const row=document.createElement('div');
    row.className='entryRow';
    row.innerHTML=`<div class="entryRowTop"><div class="entryRowMain"><strong>${escapeHtml(entry.date || '')}</strong> · ${escapeHtml(getSharedOwnerLabel(entry))}<br><span>${escapeHtml(detail)}</span></div><div class="entryRowActions"><button type="button" class="miniBtn locateBtn"${locateDisabled}>Locate</button><button type="button" class="miniBtn deleteBtn"${deleteDisabled}>Delete</button></div></div><div class="entryRowSpecs">${escapeHtml(water)} · ${escapeHtml(bait || '—')} · ${escapeHtml(conditions || '—')}</div>`;
    row.querySelector('.locateBtn').addEventListener('click',()=>{
      const drawable=getDrawableMarker(entry);
      if(!drawable){ setStatus('No drawable map point for that log yet.', 2800); return; }
      map.setView([drawable.point.lat,drawable.point.lng],DEFAULT_LOG_ZOOM);
      closeSheet($('reviewSheet'));
    });
    row.querySelector('.deleteBtn').addEventListener('click',()=>{
      if(!canDelete){ setStatus('Only the angler who created that log can delete it on this device.', 3200); return; }
      if(!confirm('Delete this fishing log?')) return;
      state.entries=state.entries.filter(e=>e.id!==entry.id);
      persistEntries();
      render();
      deleteCloudEntry(entry.id);
    });
    $('entryList').appendChild(row);
  });
}


function parseOptionalNumber(value){
  const raw=String(value ?? '').trim();
  if(!raw) return null;
  const cleaned=raw.replace(/,/g,'');
  const num=Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

let activeSheetSelect=null;
let pickerScrollTimer=null;
const PICKER_OPTION_HEIGHT=52;
function ensureSheetSelectButton(select){
  if(!select || select.dataset.sheetSelectReady==='true') return;
  const trigger=document.createElement('button');
  trigger.type='button';
  trigger.className='sheet-select-trigger';
  trigger.setAttribute('aria-haspopup','dialog');
  trigger.addEventListener('click',()=>openSheetSelect(select, trigger));
  select.classList.add('native-select-hidden');
  select.insertAdjacentElement('afterend', trigger);
  select.dataset.sheetSelectReady='true';
}

function getSheetSelectLabel(select){
  const label=select.closest('label');
  if(!label) return 'Choose one';
  const clone=label.cloneNode(true);
  clone.querySelectorAll('select,input,textarea,button,div').forEach(el=>el.remove());
  return clone.textContent.trim() || 'Choose one';
}

function updateSheetSelectTrigger(select){
  if(!select || !select.dataset.sheetSelectReady) return;
  const trigger=select.nextElementSibling;
  if(!trigger || !trigger.classList.contains('sheet-select-trigger')) return;
  const current=select.options[select.selectedIndex];
  const placeholder=(select.options[0] && !select.options[0].value ? select.options[0].textContent.trim() : 'Choose one');
  trigger.textContent=(current && current.value ? current.textContent : placeholder);
  trigger.classList.toggle('is-placeholder', !(current && current.value));
  trigger.disabled=select.disabled;
  const label=select.closest('label');
  const hidden=(label && label.closest('.hidden')) || select.closest('.hidden');
  trigger.classList.toggle('hidden', !!hidden);
}

function cleanupSheetSelectButton(select){
  if(!select) return;
  select.classList.remove('native-select-hidden');
  delete select.dataset.sheetSelectReady;
  const trigger=select.nextElementSibling;
  if(trigger && trigger.classList.contains('sheet-select-trigger')) trigger.remove();
}

function shouldUseCustomPicker(select){
  return !!select && !!select.closest('#logForm, #anglerSheet');
}

function updateSheetSelectTriggers(){
  document.querySelectorAll('.sheet select').forEach(select=>{
    if(shouldUseCustomPicker(select)){
      ensureSheetSelectButton(select);
      updateSheetSelectTrigger(select);
    }else{
      cleanupSheetSelectButton(select);
    }
  });
}

function initTrackFillWrappers(){
  document.querySelectorAll('#logForm label').forEach(label=>{
    if(label.querySelector('input, textarea, select')) label.classList.add('track-fill');
  });
  const nameWrap=$('nameWrap');
  if(nameWrap) nameWrap.classList.add('track-fill');
}

function getPickerTriggerForSelect(select){
  return select && select.nextElementSibling && select.nextElementSibling.classList.contains('sheet-select-trigger') ? select.nextElementSibling : null;
}

function openPickerPopover(){
  const picker=$('sheetPicker');
  if(!picker) return;
  picker.classList.add('visible');
  picker.setAttribute('aria-hidden','false');
  document.body.classList.add('picker-open');
}

function closePickerPopover(){
  const picker=$('sheetPicker');
  if(!picker) return;
  picker.classList.remove('visible');
  picker.setAttribute('aria-hidden','true');
  document.body.classList.remove('picker-open');
  activeSheetSelect=null;
  const optionsWrap=$('pickerOptions');
  if(optionsWrap) optionsWrap.onscroll=null;
}


function positionPickerPopover(trigger){
  const picker=$('sheetPicker');
  if(!picker || !trigger) return;
  const rect=trigger.getBoundingClientRect();
  const vw=window.innerWidth;
  const vh=window.innerHeight;
  const isPhone=vw <= 680;
  const width=isPhone ? Math.min(vw - 18, 370) : Math.min(Math.max(rect.width, 300), Math.min(vw - 20, 380));
  let left=isPhone ? Math.max(9, (vw - width) / 2) : rect.left + (rect.width/2) - (width/2);
  left=Math.max(9, Math.min(left, vw - width - 9));
  const idealTop=isPhone ? Math.min(vh * 0.18, 120) : rect.top + (rect.height/2) - 176;
  let top=Math.max(8, Math.min(idealTop, vh - 420));
  picker.style.setProperty('--picker-left', `${left}px`);
  picker.style.setProperty('--picker-top', `${top}px`);
  picker.style.setProperty('--picker-width', `${width}px`);
}


function isTrackFieldFilled(wrapper){
  if(!wrapper || wrapper.closest('.hidden')) return false;
  const controls=[...wrapper.querySelectorAll('input:not([type="hidden"]), textarea, select')].filter(el=>!el.disabled && !el.closest('.hidden'));
  if(!controls.length) return false;
  return controls.some(input=>String(input.value || '').trim()!=='');
}

function updateFieldFillStates(){
  initTrackFillWrappers();
  document.querySelectorAll('#logForm .track-fill').forEach(wrapper=>{
    if(wrapper.closest('.hidden')) return;
    const filled=isTrackFieldFilled(wrapper);
    wrapper.classList.toggle('field-complete', filled);
    wrapper.classList.toggle('field-pending', !filled);
  });
}


function setPickerSelection(select, value, {dispatch=true}={}){
  if(!select) return;
  if(select.value===value && !dispatch){
    const optionsWrap=$('pickerOptions');
    if(optionsWrap){
      optionsWrap.querySelectorAll('.picker-option').forEach(btn=>btn.classList.toggle('selected', btn.dataset.value===value));
    }
    return;
  }
  select.value=value;
  const optionsWrap=$('pickerOptions');
  if(optionsWrap){
    optionsWrap.querySelectorAll('.picker-option').forEach(btn=>btn.classList.toggle('selected', btn.dataset.value===value));
  }
  if(dispatch) select.dispatchEvent(new Event('change',{bubbles:true}));
  updateSheetSelectTrigger(select);
  updateFieldFillStates();
}

function centerPickerOnValue(value,{smooth=false}={}){
  const optionsWrap=$('pickerOptions');
  if(!optionsWrap) return;
  const target=optionsWrap.querySelector(`.picker-option[data-value="${CSS.escape(value)}"]`) || optionsWrap.querySelector('.picker-option');
  if(!target) return;
  const top=target.offsetTop - (optionsWrap.clientHeight/2) + (target.offsetHeight/2);
  const nextTop=Math.max(0, top);
  if(typeof optionsWrap.scrollTo==='function'){
    optionsWrap.scrollTo({top:nextTop, behavior:smooth ? 'smooth' : 'auto'});
  }else{
    optionsWrap.scrollTop=nextTop;
  }
}

function syncPickerSelectionFromScroll({snap=true}={}){
  const optionsWrap=$('pickerOptions');
  if(!optionsWrap || !activeSheetSelect) return;
  const center=optionsWrap.scrollTop + (optionsWrap.clientHeight / 2);
  let closest=null;
  let bestDistance=Infinity;
  optionsWrap.querySelectorAll('.picker-option').forEach(option=>{
    const optionCenter=option.offsetTop + (option.offsetHeight / 2);
    const distance=Math.abs(optionCenter - center);
    if(distance < bestDistance){ bestDistance=distance; closest=option; }
  });
  if(!closest) return;
  setPickerSelection(activeSheetSelect, closest.dataset.value);
  if(snap){
    centerPickerOnValue(closest.dataset.value,{smooth:true});
  }
}

function openSheetSelect(select, triggerEl=null){
  if(!select || select.disabled) return;
  activeSheetSelect=select;
  const trigger=triggerEl || getPickerTriggerForSelect(select);
  $('pickerTitle').textContent=getSheetSelectLabel(select);
  const optionsWrap=$('pickerOptions');
  optionsWrap.innerHTML='';
  const values=[...select.options].filter((option, index)=>!(index===0 && !option.value));
  values.forEach(option=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='picker-option';
    btn.textContent=option.textContent;
    btn.dataset.value=option.value;
    btn.addEventListener('click',()=>{
      setPickerSelection(select, option.value);
      centerPickerOnValue(option.value,{smooth:true});
    });
    optionsWrap.appendChild(btn);
  });
  optionsWrap.onscroll=()=>{
    clearTimeout(pickerScrollTimer);
    pickerScrollTimer=setTimeout(()=>syncPickerSelectionFromScroll({snap:true}), 90);
  };
  positionPickerPopover(trigger);
  openPickerPopover();
  requestAnimationFrame(()=>{
    centerPickerOnValue(select.value || (optionsWrap.querySelector('.picker-option')?.dataset.value || ''));
    requestAnimationFrame(()=>syncPickerSelectionFromScroll({snap:false}));
  });
}

async function onSubmit(event){
  event.preventDefault();
  const missingField=validateLogForm();
  if(missingField){
    const message=missingField.message || `Missing or incomplete: ${missingField.label}.`;
    setStatus(message, 3800);
    alert(message);
    focusMissingField(missingField);
    return;
  }
  try{
    const raw=Object.fromEntries(new FormData($('logForm')).entries());
    let baitName='';
    if(raw.baitType==='Fly') baitName=(raw.baitName||'').trim();
    if(raw.baitType==='Lure') baitName=(raw.baitName||'').trim() || raw.baitSubtype || '';
    if(raw.baitType==='Live Bait') baitName=raw.baitSubtype || '';
    if(raw.baitType==='Ice') baitName=raw.baitSubtype || '';
    if(!baitName && raw.baitSubtype) baitName=raw.baitSubtype;
    if(!baitName) throw new Error('Bait / fly / lure is incomplete.');
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
      sizeInches:parseOptionalNumber(raw.sizeInches),
      weight:(raw.weight||'').trim(),
      quantity:Number(raw.quantity||1),
      airTemp:parseOptionalNumber(raw.airTemp),
      waterTemp:parseOptionalNumber(raw.waterTemp),
      waterDepthFt:parseOptionalNumber(raw.waterDepthFt),
      presentationDepthFt:parseOptionalNumber(raw.presentationDepthFt),
      wind:(raw.wind||'').trim(),
      windDirection:(raw.windDirection||'').trim(),
      bottomType:(raw.bottomType||'').trim(),
      skyCondition:raw.skyCondition,
      waterCondition:raw.waterCondition,
      waterClarity:raw.waterClarity,
      surfaceCondition:raw.surfaceCondition || '',
      currentSpeed:raw.currentSpeed || '',
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
  updateFieldFillStates();
}

function clearFormAfterSave(){
  $('logForm').reset();
  applyLogDateTimeDefaults();
  clearDraftMarker();
  $('waterType').value='';
  updateConditionFieldsForWaterType();
  refreshSharingSummary();
  applyBaitTypeUI();
  syncMirroredConditionFields();
  applyWaypointOption();
  updateSheetSelectTriggers();
  updateFieldFillStates();
}

function clearDraftMarker(){
  state.pendingLocationRequestId+=1;
  $('waterName').value='';
  if($('waypointName')) $('waypointName').value='';
  if($('windDirection')) $('windDirection').value='';
  $('waterType').value='';
  if($('waterCondition')) $('waterCondition').value='';
  if($('surfaceCondition')) $('surfaceCondition').value='';
  if($('currentSpeed')) $('currentSpeed').value='';
  if($('bottomType')) $('bottomType').value='';
  if($('presentationDepthFt')) $('presentationDepthFt').value='';
  clearWaterSuggestions();
  setWaterLookupStatusText('');
  updateConditionFieldsForWaterType();
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
  if(window.SheetController) return window.SheetController.closeAll(['logSheet','anglerSheet','reviewSheet','predictSheet','filterSheet','readMeSheet']);
  ['logSheet','anglerSheet','reviewSheet','predictSheet','filterSheet','readMeSheet'].forEach(id=>{ const el=$(id); if(el) closeSheet(el); });
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

function toggleMapSearchPanel(force){
  const panel=$('mapSearchPanel');
  if(!panel) return;
  const show=typeof force==='boolean' ? force : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !show);
  panel.setAttribute('aria-hidden', show ? 'false' : 'true');
  if(show){
    $('mapSearchInput')?.focus();
  }else if($('mapSearchResults')){
    $('mapSearchResults').classList.add('hidden');
    $('mapSearchResults').innerHTML='';
  }
}

function renderMapSearchResults(results=[]){
  const wrap=$('mapSearchResults');
  if(!wrap) return;
  wrap.innerHTML='';
  if(!results.length){
    wrap.classList.add('hidden');
    return;
  }
  results.forEach(result=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='map-search-result';
    btn.innerHTML=`<strong>${escapeHtml(result.display_name.split(',')[0] || result.display_name)}</strong><span>${escapeHtml(result.display_name)}</span>`;
    btn.addEventListener('click',()=>{
      const lat=Number(result.lat);
      const lng=Number(result.lon);
      if(Number.isFinite(lat) && Number.isFinite(lng)){
        map.setView([lat,lng], result.type==='waterway' ? 11 : 13);
        setStatus(`Map moved to ${result.display_name.split(',')[0] || 'search result'}.`, 2400);
      }
      toggleMapSearchPanel(false);
    });
    wrap.appendChild(btn);
  });
  wrap.classList.remove('hidden');
}

async function searchMapLocations(){
  const query=String($('mapSearchInput')?.value || '').trim();
  if(!query){
    setStatus('Type a place or body of water to search.', 2600);
    return;
  }
  setStatus('Searching the map…', 1800);
  try{
    const url=`${NOMINATIM_SEARCH_URL}?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`;
    const response=await fetch(url,{headers:{'Accept':'application/json'}});
    if(!response.ok) throw new Error(`Search returned ${response.status}`);
    const results=await response.json();
    renderMapSearchResults(Array.isArray(results) ? results : []);
    if(!Array.isArray(results) || !results.length){
      setStatus('No map results found for that search.', 2800);
    }
  }catch(error){
    setStatus(`Map search failed: ${error.message}.`, 3200);
  }
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

function loadUiOptions(){
  try{
    const raw=localStorage.getItem(FISHING_UI_OPTIONS_KEY);
    if(!raw) return {...DEFAULT_UI_OPTIONS};
    const parsed=JSON.parse(raw);
    return {
      mapStyle: parsed.mapStyle==='Satellite' ? 'Satellite' : 'Standard',
      showWaypoint: parsed.showWaypoint===true
    };
  }catch{
    return {...DEFAULT_UI_OPTIONS};
  }
}

function persistUiOptions(){
  localStorage.setItem(FISHING_UI_OPTIONS_KEY, JSON.stringify(state.ui || DEFAULT_UI_OPTIONS));
}

function applyMapStyle(style='Standard'){
  const target=style==='Satellite' ? 'Satellite' : 'Standard';
  if(activeBaseLayer && map.hasLayer(activeBaseLayer)) map.removeLayer(activeBaseLayer);
  activeBaseLayer=baseLayers[target] || baseLayers.Standard;
  activeBaseLayer.addTo(map);
  if(state.ui) state.ui.mapStyle=target;
}

function applyWaypointOption(){
  const show=!!state.ui?.showWaypoint;
  if($('waypointFieldWrap')) $('waypointFieldWrap').classList.toggle('hidden', !show);
}

function refreshAnglerUi(){
  if($('anglerNameInput')) $('anglerNameInput').value=state.angler.name || '';
  if($('anglerKeyInput')) $('anglerKeyInput').value=state.angler.key || '';
  if($('shareAnglerNameInput')) $('shareAnglerNameInput').value=state.angler.shareName===false ? 'No' : 'Yes';
  if($('locationShareLevelInput')) $('locationShareLevelInput').value=normalizeLocationShareLevel(state.angler.locationShareLevel);
  if($('mapStyleInput')) $('mapStyleInput').value=state.ui?.mapStyle || 'Standard';
  if($('showWaypointInput')) $('showWaypointInput').value=state.ui?.showWaypoint ? 'Yes' : 'No';
  if($('anglerPreviewBox')) $('anglerPreviewBox').textContent=`Shared as ${state.angler.shareName===false ? 'Anonymous' : (state.angler.name || 'Anonymous')} · ${normalizeLocationShareLevel(state.angler.locationShareLevel)}`;
  refreshSharingSummary();
}

function refreshSharingSummary(){
  const displayName=state.angler.shareName===false ? 'Anonymous' : (state.angler.name || 'Anonymous');
  if($('sharingSummaryBox')) $('sharingSummaryBox').textContent=`All logs are shared. Current device setup: ${displayName} · ${normalizeLocationShareLevel(state.angler.locationShareLevel)}. Fish details, bait, conditions, and notes are shared; map sharing uses a nearest public access point when possible, otherwise the saved fishing spot. Your own devices use the exact point when your angler key matches; other anglers draw from the shared point.`;
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
  state.ui={
    mapStyle:$('mapStyleInput')?.value==='Satellite' ? 'Satellite' : 'Standard',
    showWaypoint:$('showWaypointInput')?.value==='Yes'
  };
  persistAnglerSettings();
  persistUiOptions();
  applyMapStyle(state.ui.mapStyle);
  applyWaypointOption();
  refreshAnglerUi();
  closeSheet($('anglerSheet'));
  setStatus('Options saved.', 2600);
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
setOptions($('skyCondition'), SKY_OPTIONS, 'Choose one');
updateConditionFieldsForWaterType();
refreshAnglerUi();
applyWaypointOption();
$('anglerSetupBtn').addEventListener('click',()=>{ refreshAnglerUi(); openSheet($('anglerSheet')); closeSheet($('logSheet')); closeSheet($('reviewSheet')); closeSheet($('filterSheet')); closeSheet($('readMeSheet')); });
$('addLogBtn').addEventListener('click',beginAddLog);
function setActionDockHidden(isHidden){
  const hidden=!!isHidden;
  document.body.classList.toggle('action-dock-hidden', hidden);
  if($('showActionDockBtn')) $('showActionDockBtn').classList.toggle('hidden', !hidden);
  persistDockHidden(hidden);
}
if($('hideActionDockBtn')) $('hideActionDockBtn').addEventListener('click',()=>setActionDockHidden(true));
setActionDockHidden(loadDockHidden());
if($('showActionDockBtn')) $('showActionDockBtn').addEventListener('click',()=>setActionDockHidden(false));
if($('mapSearchToggleBtn')) $('mapSearchToggleBtn').addEventListener('click',()=>toggleMapSearchPanel());
if($('mapSearchGoBtn')) $('mapSearchGoBtn').addEventListener('click',searchMapLocations);
if($('mapSearchInput')) $('mapSearchInput').addEventListener('keydown',event=>{ if(event.key==='Enter'){ event.preventDefault(); searchMapLocations(); }});
if($('readMeBtn')) $('readMeBtn').addEventListener('click',()=>{ closeAllSheets(); openSheet($('readMeSheet')); });
if($('closeReadMeSheetBtn')) $('closeReadMeSheetBtn').addEventListener('click',()=>closeSheet($('readMeSheet')));
$('reviewBtn').addEventListener('click',()=>{
  cancelAddMode();
  closeAllSheets();
  syncStateToReviewFilters();
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

$('predictBtn').addEventListener('click',()=>{ setStatus('Prediction is coming, but it is not live yet.', 2600); });
$('closePredictSheetBtn').addEventListener('click',()=>closeSheet($('predictSheet')));
$('predictNotLiveBtn').addEventListener('click',()=>setStatus('Prediction section is just the form shell for now.', 2600));
setOptions($('predictSpecies'), MIDWEST_FISH_SPECIES, 'Choose one');
const reviewSortIds=['sortNewest','sortOldest','sortSpecies','sortAngler','sortWater','sortBait'];
reviewSortIds.forEach(id=>{
  const el=$(id);
  if(!el) return;
  el.addEventListener('change',()=>{
    if(!el.checked){ el.checked=true; return; }
    reviewSortIds.forEach(other=>{
      if(other===id) return;
      const otherEl=$(other);
      if(otherEl) otherEl.checked=false;
    });
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
function syncReviewFiltersToState(){
  if($('reviewFilterSpecies')) $('filterSpecies').value=$('reviewFilterSpecies').value;
  if($('reviewFilterBaitType')) $('filterBaitType').value=$('reviewFilterBaitType').value;
  if($('reviewFilterWaterType')) $('filterWaterType').value=$('reviewFilterWaterType').value;
  if($('reviewFilterSky')) $('filterSky').value=$('reviewFilterSky').value;
}
function syncStateToAllFilterInputs(){
  if($('filterDateFrom')) $('filterDateFrom').value=state.filters.dateFrom || '';
  if($('filterDateTo')) $('filterDateTo').value=state.filters.dateTo || '';
  if($('filterSpecies')) $('filterSpecies').value=state.filters.species || '';
  if($('filterColor')) $('filterColor').value=state.filters.color || '';
  if($('filterBaitType')) $('filterBaitType').value=state.filters.baitType || '';
  if($('filterWaterType')) $('filterWaterType').value=state.filters.waterType || '';
  if($('filterTimeOfDay')) $('filterTimeOfDay').value=state.filters.timeOfDay || '';
  if($('filterSky')) $('filterSky').value=state.filters.sky || '';
  if($('filterRetrieveSpeed')) $('filterRetrieveSpeed').value=state.filters.retrieveSpeed || '';
  syncStateToReviewFilters();
}

function syncStateToReviewFilters(){
  if($('reviewFilterSpecies')) $('reviewFilterSpecies').value=state.filters.species || '';
  if($('reviewFilterBaitType')) $('reviewFilterBaitType').value=state.filters.baitType || '';
  if($('reviewFilterWaterType')) $('reviewFilterWaterType').value=state.filters.waterType || '';
  if($('reviewFilterWindDirection')) $('reviewFilterWindDirection').value=state.filters.windDirection || '';
  if($('reviewFilterWaterTemp')) $('reviewFilterWaterTemp').value=state.filters.waterTemp || '';
  if($('reviewFilterSky')) $('reviewFilterSky').value=state.filters.sky || '';
  if($('reviewFilterSizeInches')) $('reviewFilterSizeInches').value=state.filters.sizeInches || '';
  if($('reviewFilterAirTemp')) $('reviewFilterAirTemp').value=state.filters.airTemp || '';
  updateSheetSelectTriggers();
}
function applyMapAndReviewFiltersFromInputs(){
  syncReviewFiltersToState();
  state.filters.dateFrom=$('filterDateFrom').value;
  state.filters.dateTo=$('filterDateTo').value;
  state.filters.species=$('filterSpecies').value;
  state.filters.color=$('filterColor').value;
  state.filters.baitType=$('filterBaitType').value;
  state.filters.waterType=$('filterWaterType').value;
  state.filters.timeOfDay=$('filterTimeOfDay').value;
  state.filters.sky=$('filterSky').value;
  state.filters.retrieveSpeed=$('filterRetrieveSpeed').value;
  state.filters.windDirection=$('reviewFilterWindDirection') ? $('reviewFilterWindDirection').value : '';
  state.filters.waterTemp=$('reviewFilterWaterTemp') ? $('reviewFilterWaterTemp').value.trim() : '';
  state.filters.sizeInches=$('reviewFilterSizeInches') ? $('reviewFilterSizeInches').value.trim() : '';
  state.filters.airTemp=$('reviewFilterAirTemp') ? $('reviewFilterAirTemp').value.trim() : '';
  syncStateToReviewFilters();
  persistFilters();
  render();
}
function resetAllFilters(){
  $('filterDateFrom').value='';
  $('filterDateTo').value='';
  $('filterSpecies').value='';
  $('filterColor').value='';
  $('filterBaitType').value='';
  $('filterWaterType').value='';
  $('filterTimeOfDay').value='';
  $('filterSky').value='';
  $('filterRetrieveSpeed').value='';
  ['reviewFilterSpecies','reviewFilterBaitType','reviewFilterWaterType','reviewFilterWindDirection','reviewFilterWaterTemp','reviewFilterSky','reviewFilterSizeInches','reviewFilterAirTemp'].forEach(id=>{ if($(id)) $(id).value=''; });
  state.filters={dateFrom:'',dateTo:'',species:'',color:'',baitType:'',waterType:'',timeOfDay:'',sky:'',retrieveSpeed:'',windDirection:'',waterTemp:'',sizeInches:'',airTemp:''};
  updateSheetSelectTriggers();
  persistFilters();
  render();
}
$('resetFiltersBtn').addEventListener('click',resetAllFilters);
if($('reviewResetFiltersBtn')) $('reviewResetFiltersBtn').addEventListener('click',resetAllFilters);
['filterDateFrom','filterDateTo','filterSpecies','filterColor','filterBaitType','filterWaterType','filterTimeOfDay','filterSky','filterRetrieveSpeed'].forEach(id=>$(id).addEventListener('change',applyMapAndReviewFiltersFromInputs));
['reviewFilterSpecies','reviewFilterBaitType','reviewFilterWaterType','reviewFilterWindDirection','reviewFilterSky'].forEach(id=>$(id)?.addEventListener('change',applyMapAndReviewFiltersFromInputs));
['reviewFilterWaterTemp','reviewFilterSizeInches','reviewFilterAirTemp'].forEach(id=>$(id)?.addEventListener('input',applyMapAndReviewFiltersFromInputs));
$('baitType').addEventListener('change',()=>{ applyBaitTypeUI(); updateSheetSelectTriggers(); updateFieldFillStates(); });
$('baitSubtype').addEventListener('change',()=>{ refreshFlySizeOptions(); applySubtypeColorDefaults(); updateBaitHelperContext(); updateSheetSelectTriggers(); updateFieldFillStates(); });
$('presentationStyle').addEventListener('change',updateFieldFillStates);
$('depthZone').addEventListener('change',updateFieldFillStates);
$('retrieveSpeed').addEventListener('change',updateFieldFillStates);
$('species').addEventListener('change',updateFieldFillStates);
$('presentationDepthFt').addEventListener('input',updateFieldFillStates);
$('waterTemp').addEventListener('input',updateFieldFillStates);
$('airTemp').addEventListener('input',updateFieldFillStates);
$('waterDepthFt').addEventListener('input',()=>{ syncMirroredConditionFields(); updateFieldFillStates(); });
$('baitName').addEventListener('input',()=>{
  if($('baitType').value==='Fly'){
    const query=$('baitName').value.trim();
    updateFlySuggestions(query);
    const exact=findExactFly(query, $('baitSubtype').value);
    if(exact) applyFly(exact);
    else {
      refreshFlySizeOptions();
      updateBaitHelperContext();
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
  updateConditionFieldsForWaterType();
  refreshSharingSummary();
  updateSheetSelectTriggers();
});
$('waterType').addEventListener('change',()=>{ updateConditionFieldsForWaterType(); refreshSharingSummary(); updateSheetSelectTriggers(); });
['date','timeOfDay','waterName','wind','windDirection','waterCondition','waterClarity','surfaceCondition','currentSpeed','bottomType','structureType','baitSize','mainColor','additionalColor','species','notes','sizeInches','airTemp','waterTemp'].forEach(id=>{ const el=$(id); if(el) ['input','change'].forEach(evt=>el.addEventListener(evt, updateFieldFillStates)); });
$('waterClarity').addEventListener('change',syncMirroredConditionFields);
$('waterDepthFt').addEventListener('input',syncMirroredConditionFields);
$('saveBtn').addEventListener('click',()=>{
  const missingField=validateLogForm();
  if(missingField){
    setStatus(missingField.message || `Missing or incomplete: ${missingField.label}.`, 3600);
    focusMissingField(missingField);
  }
});
$('logForm').addEventListener('submit',onSubmit);
updateConditionFieldsForWaterType();
applyBaitTypeUI();
initTrackFillWrappers();
syncAddLogButton();
updateCloudUi();
updateSheetSelectTriggers();
syncStateToAllFilterInputs();
setStatus(`Fishing Logbook ${APP_VERSION} loaded.`, 2200);
render();
initCloud();

$('closePickerBtn').addEventListener('click',()=>closePickerPopover());
document.addEventListener('click',event=>{ const picker=$('sheetPicker'); if(!picker || !picker.classList.contains('visible')) return; if(picker.contains(event.target) || event.target.classList.contains('sheet-select-trigger')) return; closePickerPopover(); });
document.addEventListener('keydown',event=>{ if(event.key==='Escape') closePickerPopover(); });
window.addEventListener('resize', ()=>{ updateSheetSelectTriggers(); if(activeSheetSelect) positionPickerPopover(getPickerTriggerForSelect(activeSheetSelect)); });

import {OFFICIAL_SUBSCRIPTION_ID,OFFICIAL_SUBSCRIPTION_URL,OFFICIAL_SUBSCRIPTION_NAME,OFFICIAL_LIST_VERSION,OFFICIAL_SEED} from './official-list.js';

export const SCHEMA = 'guga-blocklist/v1';
export const MAX_ENTRIES = 20000;
export const MAX_BYTES = 4 * 1024 * 1024;
export const SUBSCRIPTION_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
const reserved = new Set(['home','explore','notifications','messages','settings','search','compose','intent','i','login','logout','signup','tos','privacy']);

export function normalizeHandle(value) {
  let s = String(value ?? '').trim();
  if (/^https?:\/\//i.test(s)) {
    const url = new URL(s);
    if (!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(url.hostname)) throw new Error('Only X / Twitter profile URLs are accepted.');
    if (!/^\/[A-Za-z0-9_]{1,15}\/?$/.test(url.pathname)) throw new Error('Use a profile URL, not a post URL.');
    s = url.pathname.slice(1).replace(/\/$/, '');
  }
  s = s.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(s) || reserved.has(s)) throw new Error(`Invalid X handle: ${String(value).slice(0,50)}`);
  return s;
}

export function safeEvidence(value) {
  if (!Array.isArray(value)) value = value ? [value] : [];
  return value.slice(0,10).map(x => {
    try { const u = new URL(String(x)); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; }
    catch { return null; }
  }).filter(Boolean);
}

export function normalizeEntry(value, {source='local', status='approved'}={}) {
  const obj = typeof value === 'string' ? {handle:value} : value;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Each entry must contain an X handle.');
  const raw = obj.handle ?? obj.screen_name ?? obj.username;
  if (!raw && (obj.id || obj.userId)) throw new Error('Numeric-ID-only lists need an ID-to-handle mapping. Bird Shield ID lists cannot be used as handle lists.');
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) throw new Error('Bare numeric IDs are not handles. Supply @handle or a JSON handle field.');
  const handle = normalizeHandle(raw);
  const id = obj.id ?? obj.userId;
  if (id != null && (typeof id !== 'string' || !/^\d{1,25}$/.test(id))) throw new Error('User IDs must be decimal strings, never JSON numbers.');
  return {handle, ...(id ? {id} : {}), reason:String(obj.reason ?? '').slice(0,1000), evidence:safeEvidence(obj.evidence), source, status, addedAt:now()};
}

export function parseCSV(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i=0;i<text.length;i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i+1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell=''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && text[i+1] === '\n') i++; row.push(cell); if (row.some(x=>x.trim())) rows.push(row); row=[]; cell=''; }
    else cell += c;
  }
  if (quoted) throw new Error('Unclosed quote in CSV.');
  row.push(cell); if (row.some(x=>x.trim())) rows.push(row);
  return rows;
}

export function parseImport(text, {source='local', status='approved', strictPublic=false}={}) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('List is too large (maximum 4 MB).');
  text = text.replace(/^\uFEFF/,'').trim();
  let values, meta = {};
  if (text.startsWith('{') || text.startsWith('[')) {
    let parsed; try { parsed=JSON.parse(text); } catch { throw new Error('Invalid JSON.'); }
    if (strictPublic && (parsed.schema !== SCHEMA || !Array.isArray(parsed.entries))) throw new Error(`Subscription must be a ${SCHEMA} JSON file.`);
    if (Array.isArray(parsed)) values=parsed;
    else if (parsed && typeof parsed==='object') { values=parsed.entries ?? parsed.accounts ?? parsed.handles; meta={name:String(parsed.name ?? '').slice(0,120),updatedAt:parsed.updatedAt}; }
    if (!Array.isArray(values)) throw new Error('JSON must contain an entries array.');
  } else {
    if (strictPublic) throw new Error('Subscriptions require Guga JSON, not a TXT list.');
    const rows=parseCSV(text);
    if (rows.length && /^(handle|username|screen_name)$/i.test(rows[0][0].trim())) {
      const headers=rows.shift().map(x=>x.trim().toLowerCase());
      values=rows.map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i] ?? '']))).map(o=>{ if(o.evidence) {try{o.evidence=JSON.parse(o.evidence);}catch{o.evidence=o.evidence.split(' ');}} if(o.id==='') delete o.id; return o; });
    } else values=rows.flat().map(s=>s.trim()).filter(s=>s && !s.startsWith('#'));
  }
  if (values.length > MAX_ENTRIES) throw new Error(`Too many entries (maximum ${MAX_ENTRIES}).`);
  const unique=new Map();
  for (let i=0;i<values.length;i++) {
    let e; try {e=normalizeEntry(values[i],{source,status});} catch(err){throw new Error(`Entry ${i+1}: ${err.message}`);}
    const existing=unique.get(e.handle);
    if(existing?.id&&e.id&&existing.id!==e.id) throw new Error(`Conflicting numeric IDs for @${e.handle} in this import.`);
    if(!existing) unique.set(e.handle,e);
    else if(!existing.id&&e.id) unique.set(e.handle,{...existing,id:e.id});
  }
  // A newer alias for one numeric identity is one account, not another target.
  // Validate all handle conflicts above before collapsing these aliases.
  const identities=new Map();
  for(const entry of unique.values()) identities.set(identityKey(entry),entry);
  return {entries:[...identities.values()],duplicates:values.length-identities.size,...meta};
}

export function initialState() {
  const state={version:2,executorVersion:'x-api-v1',settings:{language:'zh',hideContent:true,autoBlock:false,accountHandle:'',accountId:'',sessionInvalid:false,intervalSeconds:30},entries:[],subscriptions:[],allowlist:[],allowlistPins:{},queue:[],logs:[],capture:{entries:[],updatedAt:null},lastSync:null,paused:true,pauseReason:'',workerTabId:null,runId:null,nativeBlocked:{},apiCooldown:null,apiBudget:{accountId:'',writes:[]}};
  installOfficialSubscription(state);
  initializeSubscriptionSchedule(state);
  return state;
}

export function initializeSubscriptionSchedule(state, timestamp=Date.now()) {
  if(Number.isFinite(state.nextAutoSyncAt)&&state.nextAutoSyncAt>0&&state.nextAutoSyncAt<=8.64e15)return false;
  const lastSync=typeof state.lastSync==='string'?Date.parse(state.lastSync):NaN;
  const base=Number.isFinite(lastSync)&&lastSync>0&&lastSync<=8.64e15-SUBSCRIPTION_REFRESH_MS?lastSync:timestamp;
  state.nextAutoSyncAt=base+SUBSCRIPTION_REFRESH_MS;
  state.lastSyncAttemptAt??=null;
  return true;
}

export function installOfficialSubscription(state) {
  // This records the one-time default installation, not consent to execute.
  // In particular a removed source must never reappear on worker/browser restart
  // or merely because a later extension bundles a newer seed version.
  if(Number.isInteger(state.officialListVersion)&&state.officialListVersion>0)return false;
  const matching=state.subscriptions.filter(sub=>sub.url===OFFICIAL_SUBSCRIPTION_URL);
  if(matching.length) {
    // Preserve a prior opt-out and the chosen source's cache (including an empty
    // curator list). Older duplicate URL sources do not create extra targets.
    const kept=matching.find(sub=>!sub.enabled)||matching[0];
    const removed=new Set(matching.filter(sub=>sub!==kept&&sub.id!==kept.id).map(sub=>sub.id));
    const entries=state.entries.filter(entry=>!removed.has(entry.source));
    retainAllowlistIdentities(state,entries);
    state.entries=entries;
    state.subscriptions=state.subscriptions.filter(sub=>sub.url!==OFFICIAL_SUBSCRIPTION_URL||sub===kept);
  } else {
    const id=state.subscriptions.some(sub=>sub.id===OFFICIAL_SUBSCRIPTION_ID)?uid():OFFICIAL_SUBSCRIPTION_ID;
    const parsed=parseImport(JSON.stringify(OFFICIAL_SEED),{source:id,status:'approved',strictPublic:true});
    // A full pre-existing local database remains usable. Leave its contents
    // intact and expose a normal subscription error until space is freed.
    const fits=state.entries.length+parsed.entries.length<=MAX_ENTRIES;
    const seeded=fits?parsed.entries:[];
    state.entries=[...state.entries,...seeded];
    state.subscriptions=[...state.subscriptions,{id,url:OFFICIAL_SUBSCRIPTION_URL,name:OFFICIAL_SUBSCRIPTION_NAME,enabled:true,updatedAt:fits?OFFICIAL_SEED.updatedAt:null,error:fits?'':'Combined list exceeds 20,000 entries.',count:seeded.length}];
  }
  state.officialListVersion=OFFICIAL_LIST_VERSION;
  return true;
}

export function retainAllowlistIdentities(state, nextEntries=state.entries) {
  // Exceptions follow every known numeric identity even when an alias disappears
  // from a refreshed list. Removing the exception discards its retained pins.
  const pins={},allowed=new Set(state.allowlist),known=new Map([...allowed].map(handle=>[handle,new Set()]));
  const valid=id=>typeof id==='string'&&/^\d{1,25}$/.test(id);
  for(const handle of allowed) {
    const previous=Object.hasOwn(state.allowlistPins||{},handle)?state.allowlistPins[handle]:[];
    if(Array.isArray(previous))for(const id of previous)if(valid(id))known.get(handle).add(id);
  }
  for(const e of [...state.entries,...nextEntries])if(allowed.has(e.handle)&&valid(e.id))known.get(e.handle).add(e.id);
  for(const [handle,ids] of known)if(ids.size)Object.defineProperty(pins,handle,{value:[...ids],enumerable:true,writable:true,configurable:true});
  state.allowlistPins=pins;
  return pins;
}

export function effectiveEntries(state) {
  const allow=new Set(state.allowlist); const active=new Set(state.subscriptions.filter(s=>s.enabled).map(s=>s.id));
  const candidates=state.entries.filter(e=>e.status==='approved'&&(e.source==='local'||active.has(e.source)));
  const excludedIds=new Set(state.entries.filter(e=>e.id&&(allow.has(e.handle)||e.handle===state.settings.accountHandle)).map(e=>e.id));
  if(state.settings.accountId)excludedIds.add(state.settings.accountId);
  for(const handle of allow) {
    const pins=Object.hasOwn(state.allowlistPins||{},handle)?state.allowlistPins[handle]:[];
    if(Array.isArray(pins))for(const id of pins)if(typeof id==='string'&&/^\d{1,25}$/.test(id))excludedIds.add(id);
  }
  const handles=new Map();
  for(const e of candidates) {
    if(allow.has(e.handle)||e.handle===state.settings.accountHandle||(e.id&&excludedIds.has(e.id))) continue;
    const previous=handles.get(e.handle);
    if(previous?.id&&e.id&&previous.id!==e.id) throw new Error(`Conflicting numeric IDs for @${e.handle}. Review the active lists before blocking.`);
    // A handle-only source must not erase another source's stronger identity pin.
    handles.set(e.handle,{...previous,...e,...((previous?.id||e.id)?{id:previous?.id||e.id}:{})});
  }
  const identities=new Map();
  for(const e of handles.values()) identities.set(identityKey(e),e);
  return [...identities.values()];
}

export function mergeLocal(state, incoming) {
  const map=new Map(state.entries.filter(e=>e.source==='local').map(e=>[e.handle,{...e}]));
  const idHandles=new Map();
  const remember=e=>{if(e.id){if(!idHandles.has(e.id))idHandles.set(e.id,new Set());idHandles.get(e.id).add(e.handle);}};
  const remove=handle=>{const old=map.get(handle);map.delete(handle);if(old?.id)idHandles.get(old.id)?.delete(handle);};
  const put=e=>{remove(e.handle);map.set(e.handle,e);remember(e);};
  for(const e of map.values())remember(e);
  let imported=0,duplicates=0,updated=0;
  const incomingIds=new Map();
  for(const value of incoming) {
    const e=normalizeEntry(value);
    const previousId=incomingIds.get(e.handle);
    if(previousId&&e.id&&previousId!==e.id)throw new Error(`Conflicting numeric IDs for @${e.handle} in this import.`);
    if(e.id)incomingIds.set(e.handle,e.id);
    const existing=map.get(e.handle);
    if(existing) {
      duplicates++;
      if(existing.id&&e.id&&existing.id!==e.id)throw new Error(`The numeric ID for @${e.handle} differs from the local record. Correct its local identity before importing a replacement.`);
      const enrich=!existing.id&&e.id;
      if(enrich||existing.status!=='approved') {
        // Explicit import enables matching local rows, including previously
        // disabled rows. Keep their known identity and user-edited metadata.
        const next={...existing,...(enrich?{id:e.id}:{}),status:'approved'};
        if(enrich)for(const alias of [...(idHandles.get(e.id)||[])])if(alias!==e.handle)remove(alias);
        put(next);updated++;
      }
      continue;
    }
    const aliases=e.id?[...(idHandles.get(e.id)||[])]:[];
    if(aliases.length) {
      const known=map.get(aliases.at(-1));
      for(const alias of aliases)remove(alias);
      put({...known,handle:e.handle,status:'approved'});duplicates++;updated++;
    } else {put({...e,source:'local',status:'approved'});imported++;}
  }
  const other=state.entries.filter(e=>e.source!=='local');
  if(map.size+other.length>MAX_ENTRIES) throw new Error('Local storage entry limit reached.');
  const entries=[...other,...map.values()];
  // Do not partially change approved identity data if active sources conflict.
  const nextState={...state};retainAllowlistIdentities(nextState,entries);
  effectiveEntries({...nextState,entries});
  state.entries=entries;state.allowlistPins=nextState.allowlistPins;return {imported,duplicates,updated};
}

export function identityKey(entry) {
  if(entry.id!=null) {
    if(typeof entry.id!=='string'||!/^\d{1,25}$/.test(entry.id))throw new Error('User IDs must be decimal strings, never JSON numbers.');
    return `id:${entry.id}`;
  }
  return `handle:${normalizeHandle(entry.handle)}`;
}

const jobIdentity=job=>identityKey({handle:job.handle,...(job.userId?{id:job.userId}:{})});
export const accountKey=state=>state.settings.accountId?`id:${state.settings.accountId}`:state.settings.accountHandle;
export const jobAccountKey=job=>job.accountId?`id:${job.accountId}`:job.accountHandle;
const activeJob=job=>['pending','needs_id','running','failed','uncertain'].includes(job.status);
const ownBucket=(state,account)=>Object.hasOwn(state.nativeBlocked||{},account)?state.nativeBlocked[account]:{};

function blockedIdentities(state,account) {
  const ids=new Set(),handles=new Set();
  for(const [key,value] of Object.entries(ownBucket(state,account)||{})) {
    if(/^id:\d{1,25}$/.test(key))ids.add(key.slice(3));
    else {
      const handle=key.startsWith('handle:')?key.slice(7):key;
      if(/^[a-z0-9_]{1,15}$/.test(handle))handles.add(handle);
    }
    if(value&&typeof value==='object'&&typeof value.handle==='string')handles.add(value.handle);
  }
  for(const job of state.queue)if(jobAccountKey(job)===account&&job.status==='done') {
    if(job.userId)ids.add(job.userId);
    handles.add(job.handle);
  }
  return {ids,handles};
}

export function recordBlocked(state,job,responseId) {
  const id=responseId??job.userId;
  const target={handle:job.handle,...(id?{id}:{})};
  const key=identityKey(target);
  if(job.userId&&id!==job.userId)throw new Error('The confirmed numeric ID differs from the queued account.');
  state.nativeBlocked??={};
  const account=jobAccountKey(job);
  if(!Object.hasOwn(state.nativeBlocked,account))Object.defineProperty(state.nativeBlocked,account,{value:{},enumerable:true,writable:true,configurable:true});
  const value={at:now(),handle:normalizeHandle(job.handle),...(id?{userId:id}:{})};
  Object.defineProperty(state.nativeBlocked[account],key,{value,enumerable:true,writable:true,configurable:true});
  return key;
}

export function reconcileQueue(state) {
  const entries=effectiveEntries(state),account=accountKey(state);
  const byHandle=new Map(entries.map(e=>[e.handle,e]));
  const byId=new Map(entries.filter(e=>e.id).map(e=>[e.id,e]));
  const blocked=blockedIdentities(state,account);
  const seen=new Set(state.queue.filter(j=>j.status==='running'&&jobAccountKey(j)===account).map(jobIdentity));
  const seenHandles=new Set(state.queue.filter(j=>j.status==='running'&&jobAccountKey(j)===account).map(j=>j.handle));
  const priority={uncertain:0,failed:1,pending:2,needs_id:3};
  const queued=state.queue.filter(j=>['pending','needs_id','failed','uncertain'].includes(j.status)).sort((a,b)=>priority[a.status]-priority[b.status]);
  const skip=(job,message)=>{job.status='skipped';job.error=message;job.updatedAt=now();};
  for(const job of queued) {
    // An uncertain write belongs forever to the original actor and numeric
    // target. A new list identity must not erase the outstanding readback.
    if(job.status==='uncertain'||job.reconcileOnly){
      if(jobAccountKey(job)===account){
        const sameIdentity=job.userId&&byId.get(job.userId);
        if(sameIdentity)job.handle=sameIdentity.handle;
        seen.add(jobIdentity(job));seenHandles.add(job.handle);
      }
      continue;
    }
    if(jobAccountKey(job)!==account){skip(job,'No longer eligible');continue;}
    const entry=(job.userId&&byId.get(job.userId))||byHandle.get(job.handle);
    if(!entry){skip(job,'No longer eligible');continue;}
    // Only jobs that cannot be in flight may change identities. Preserve a known
    // pin when a source temporarily supplies only a handle instead of its ID.
    const id=entry.id||job.userId;
    const key=identityKey({handle:entry.handle,...(id?{id}:{})});
    if((id&&blocked.ids.has(id))||(!id&&blocked.handles.has(entry.handle))){skip(job,'Already confirmed blocked');continue;}
    if(seen.has(key)||(!entry.id&&seenHandles.has(entry.handle))){skip(job,'Another job already covers this account');continue;}
    if(job.handle!==entry.handle||job.userId!==id) {
      job.handle=entry.handle;
      if(id)job.userId=id;
      job.updatedAt=now();
    }
    if(state.settings.accountId&&!id&&['pending','needs_id'].includes(job.status))job.status='needs_id';
    else if(id&&job.status==='needs_id')job.status='pending';
    job.accountHandle=state.settings.accountHandle;
    seen.add(key);seenHandles.add(entry.handle);
  }
}

export function retryFailed(state) {
  reconcileQueue(state);let retried=0;
  for(const job of state.queue)if(['failed','uncertain'].includes(job.status)&&jobAccountKey(job)===accountKey(state)) {
    if(job.status==='uncertain')job.reconcileOnly=true;
    job.status=state.settings.accountId&&!job.userId?'needs_id':'pending';job.error='';job.updatedAt=now();retried++;
  }
  state.pauseReason='';return {retried};
}

export function enqueueApproved(state) {
  const account=accountKey(state); if(!account) throw new Error('Open X, sign in, then connect your account first.');
  reconcileQueue(state);
  const present=state.queue.filter(j=>jobAccountKey(j)===account&&activeJob(j));
  const presentIds=new Set(present.filter(j=>j.userId).map(j=>j.userId));
  const presentHandles=new Set(present.map(j=>j.handle));
  const unpinnedRunning=new Set(present.filter(j=>j.status==='running'&&!j.userId).map(j=>j.handle));
  const done=blockedIdentities(state,account);
  const additions=effectiveEntries(state).filter(e=>e.id?!presentIds.has(e.id)&&!unpinnedRunning.has(e.handle)&&!done.ids.has(e.id):!presentHandles.has(e.handle)&&!done.handles.has(e.handle));
  const active=state.queue.filter(activeJob);
  if(active.length+additions.length>MAX_ENTRIES)throw new Error('Queue is full; finish or remove pending entries first.');
  const history=state.queue.filter(j=>!activeJob(j));
  const keep=Math.max(0,MAX_ENTRIES-active.length-additions.length);
  state.queue=[...(keep?history.slice(-keep):[]),...active];
  for(const e of additions)state.queue.push({id:uid(),handle:e.handle,...(e.id?{userId:e.id}:{}),accountHandle:state.settings.accountHandle,...(state.settings.accountId?{accountId:state.settings.accountId}:{}),status:state.settings.accountId&&!e.id?'needs_id':'pending',error:'',updatedAt:now()});
}

export function publicDocument(state) {
  return {schema:SCHEMA,name:'Guga community blocklist',updatedAt:now(),entries:state.entries.filter(e=>e.source==='local'&&e.status==='approved'&&!state.allowlist.includes(e.handle)).map(({handle,id,reason,evidence})=>({handle,...(id?{id}:{}),reason,evidence}))};
}

export function csvExport(entries) {
  const quote=v=>'"'+String(v ?? '').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"';
  return ['handle,id,reason,evidence,status',...entries.map(e=>[e.handle,e.id,e.reason,JSON.stringify(e.evidence),e.status].map(quote).join(','))].join('\r\n');
}

export function subscriptionURL(value) {
  let u;try{u=new URL(value);}catch{throw new Error('Enter a public GitHub raw JSON URL.');}
  if(u.protocol!=='https:'||u.hostname!=='raw.githubusercontent.com'||u.username||u.password||u.port||u.search||u.hash||u.pathname.split('/').filter(Boolean).length<4||!u.pathname.endsWith('.json')) throw new Error('Use https://raw.githubusercontent.com/OWNER/REPO/BRANCH/list.json without a token.');
  return u.href;
}

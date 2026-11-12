export const SCHEMA = 'guga-blocklist/v1';
export const MAX_ENTRIES = 20000;
export const MAX_BYTES = 4 * 1024 * 1024;
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

export function normalizeEntry(value, {source='local', status='pending'}={}) {
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

export function parseImport(text, {source='local', status='pending', strictPublic=false}={}) {
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
    if(!unique.has(e.handle)) unique.set(e.handle,e);
  }
  return {entries:[...unique.values()],duplicates:values.length-unique.size,...meta};
}

export function initialState() {
  return {version:1,settings:{language:'zh',hideContent:true,autoBlock:false,accountHandle:'',intervalSeconds:30},entries:[],subscriptions:[],allowlist:[],queue:[],logs:[],capture:{entries:[],updatedAt:null},lastSync:null,paused:true,pauseReason:'',workerTabId:null,runId:null,nativeBlocked:{}};
}

export function effectiveEntries(state) {
  const allow=new Set(state.allowlist); const active=new Set(state.subscriptions.filter(s=>s.enabled).map(s=>s.id));
  const map=new Map();
  for (const e of state.entries) if (e.status==='approved' && (e.source==='local'||active.has(e.source)) && !allow.has(e.handle) && e.handle!==state.settings.accountHandle) map.set(e.handle,e);
  return [...map.values()];
}

export function mergeLocal(state, incoming) {
  const map=new Map(state.entries.filter(e=>e.source==='local').map(e=>[e.handle,e])); let imported=0,duplicates=0;
  for(const e of incoming) {if(map.has(e.handle)){duplicates++;continue;} map.set(e.handle,{...e,source:'local',status:'pending'});imported++;}
  if(map.size+state.entries.filter(e=>e.source!=='local').length>MAX_ENTRIES) throw new Error('Local storage entry limit reached.');
  state.entries=[...state.entries.filter(e=>e.source!=='local'),...map.values()];return {imported,duplicates};
}

export function reconcileQueue(state) {
  const effective=new Set(effectiveEntries(state).map(e=>e.handle));
  for(const job of state.queue) if (['pending','failed','uncertain'].includes(job.status) && (!effective.has(job.handle)||job.accountHandle!==state.settings.accountHandle)) {job.status='skipped';job.error='No longer eligible';job.updatedAt=now();}
}

export function enqueueApproved(state) {
  const account=state.settings.accountHandle; if(!account) throw new Error('Open X, sign in, then connect your account first.');
  reconcileQueue(state);
  const present=new Set(state.queue.filter(j=>j.accountHandle===account && !['skipped'].includes(j.status)).map(j=>j.handle));
  const done=Object.hasOwn(state.nativeBlocked,account)?state.nativeBlocked[account]:{};
  const additions=effectiveEntries(state).filter(e=>!present.has(e.handle)&&!Object.hasOwn(done,e.handle));
  const active=state.queue.filter(j=>['pending','running','failed','uncertain'].includes(j.status));
  if(active.length+additions.length>MAX_ENTRIES)throw new Error('Queue is full; finish or remove pending entries first.');
  const history=state.queue.filter(j=>!['pending','running','failed','uncertain'].includes(j.status));
  state.queue=[...history.slice(-Math.max(0,MAX_ENTRIES-active.length-additions.length)),...active];
  if(active.length+additions.length===MAX_ENTRIES)state.queue=[...active];
  for(const e of additions)state.queue.push({id:uid(),handle:e.handle,...(e.id?{userId:e.id}:{}),accountHandle:account,status:'pending',error:'',updatedAt:now()});
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

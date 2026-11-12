import {SCHEMA,MAX_BYTES,MAX_ENTRIES,now,uid,initialState,normalizeHandle,safeEvidence,parseImport,mergeLocal,effectiveEntries,enqueueApproved,reconcileQueue,publicDocument,csvExport,subscriptionURL} from './lib/core.js';

let lock=Promise.resolve();
let pumping=false;
let syncing=false;
async function readState() { const {state}=await chrome.storage.local.get('state'); return state ? {...initialState(),...state,settings:{...initialState().settings,...state.settings}} : initialState(); }
function mutate(fn) {
  const result=lock.then(async()=>{const state=await readState();const extra=await fn(state);await chrome.storage.local.set({state});return {state,...extra};});
  lock=result.catch(()=>{});return result;
}
function log(state,action,handle='',message='') {state.logs.unshift({at:now(),action,handle,message:String(message).slice(0,500)});state.logs=state.logs.slice(0,1000);}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function schedule(delay=30000) {await chrome.alarms.create('gab-queue',{when:Date.now()+Math.max(30000,delay)});}
async function setup() {
  if(!await chrome.alarms.get('gab-sync')) await chrome.alarms.create('gab-sync',{periodInMinutes:360});
  // A periodic watchdog survives a worker dying between a native click and recording its result.
  if(!await chrome.alarms.get('gab-watchdog')) await chrome.alarms.create('gab-watchdog',{periodInMinutes:1});
}
void setup();
chrome.runtime.onInstalled.addListener(()=>{void mutate(()=>{});void setup();});
chrome.runtime.onStartup.addListener(()=>{void setup();void schedule();});

async function recentXTab(path) {
  const state=await readState();
  const tabs=await chrome.tabs.query({url:['https://x.com/*','https://twitter.com/*']});
  const matches=tabs.filter(t=>t.id!==state.workerTabId && (!path||new URL(t.url).pathname.startsWith(path))).sort((a,b)=>(b.active-a.active)||((b.lastAccessed??0)-(a.lastAccessed??0)));
  if(!matches.length) throw new Error(path?'Open https://x.com/settings/blocked/all first, then return here.':'Open X and sign in first, then return here.');
  return matches[0];
}
async function toTab(tabId,message) {
  try {return await chrome.tabs.sendMessage(tabId,message);}catch(error){throw new Error(`X page did not respond. Refresh that X tab and try again. ${String(error.message).slice(0,180)}`);}
}

async function fetchSubscription(url) {
  if(!await chrome.permissions.contains({origins:['https://raw.githubusercontent.com/*']})) throw new Error('Allow GitHub raw-list access with the subscription button first.');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
  try {
    const response=await fetch(subscriptionURL(url),{credentials:'omit',redirect:'error',cache:'no-cache',signal:controller.signal});
    if(!response.ok) throw new Error(`Subscription HTTP ${response.status}`);
    if(Number(response.headers.get('content-length')??0)>MAX_BYTES) throw new Error('Subscription exceeds 4 MB.');
    const reader=response.body.getReader();const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw new Error('Subscription exceeds 4 MB.');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    return parseImport(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{status:'approved',strictPublic:true});
  }finally{clearTimeout(timeout);}
}

async function syncOne(id) {
  const initial=await readState();const sub=initial.subscriptions.find(s=>s.id===id&&s.enabled);if(!sub)return;
  try {
    const parsed=await fetchSubscription(sub.url);
    await mutate(state=>{const live=state.subscriptions.find(s=>s.id===id&&s.enabled);if(!live||live.url!==sub.url)return;
      const retained=state.entries.filter(e=>e.source!==id);
      if(retained.length+parsed.entries.length>MAX_ENTRIES)throw new Error('Combined list exceeds 20,000 entries.');
      state.entries=[...retained,...parsed.entries.map(e=>({...e,source:id}))];
      Object.assign(live,{updatedAt:now(),error:'',count:parsed.entries.length});state.lastSync=now();reconcileQueue(state);
      if(state.settings.autoBlock&&state.settings.accountHandle)enqueueApproved(state);
      log(state,'subscription-updated','',`${live.name}: ${parsed.entries.length}`);
    });
  } catch(err) {await mutate(state=>{const live=state.subscriptions.find(s=>s.id===id);if(live)live.error=err.message;log(state,'subscription-error','',err.message);});}
}
async function syncAll() {
  if(syncing)return;syncing=true;
  try{const state=await readState();for(const sub of state.subscriptions.filter(s=>s.enabled))await syncOne(sub.id);}finally{syncing=false;}
  void pump();
}

async function getWorkerTab(state,handle) {
  const url=`https://x.com/${encodeURIComponent(handle)}`;let tab;
  if(state.workerTabId!=null){try{tab=await chrome.tabs.get(state.workerTabId);}catch{}}
  if(tab){const prior=new URL(tab.url??'about:blank');if(!['x.com','twitter.com'].includes(prior.hostname))throw new Error('Worker tab was used for another site. Pause, close it, and start again.');tab=await chrome.tabs.update(tab.id,{url});}
  else {tab=await chrome.tabs.create({url,active:false});await mutate(s=>{s.workerTabId=tab.id;});}
  for(let i=0;i<25;i++){await sleep(600);const fresh=await chrome.tabs.get(tab.id);if(fresh.status==='complete'){await sleep(800);return fresh;}}
  throw new Error('X profile page timed out.');
}
async function pump() {
  if(pumping)return;pumping=true;
  let picked;
  try {
    const chosen=await mutate(state=>{
      const active=state.queue.find(j=>j.status==='running');
      if(active){if(Date.now()-Date.parse(active.updatedAt)>120000){active.status='uncertain';active.error='Previous operation was interrupted; inspect X before retrying.';state.paused=true;state.pauseReason=active.error;log(state,'interrupted',active.handle,active.error);}return;}
      if(state.paused||!state.settings.accountHandle)return;
      reconcileQueue(state);
      const last=Date.parse(state.lastAttemptAt??'')||0;const wait=Math.max(30000,state.settings.intervalSeconds*1000)-(Date.now()-last);
      if(wait>0)return {wait};
      const job=state.queue.find(j=>j.status==='pending');if(!job)return;
      state.runId=uid();state.lastAttemptAt=now();job.status='running';job.updatedAt=now();return {job:{...job},runId:state.runId};
    });
    if(chosen.wait){await schedule(chosen.wait);return;}
    if(!chosen.job)return;picked=chosen;
    await schedule(90000);
    const tab=await getWorkerTab(chosen.state,chosen.job.handle);
    const current=await readState();if(current.paused||current.runId!==chosen.runId)throw new Error('Queue paused before operation.');
    const response=await toTab(tab.id,{type:'GAB_BLOCK',handle:chosen.job.handle,userId:chosen.job.userId,accountHandle:chosen.job.accountHandle,jobId:chosen.job.id,runId:chosen.runId});
    await mutate(state=>{
      const job=state.queue.find(j=>j.id===chosen.job.id);if(!job||job.status!=='running'||state.runId!==chosen.runId)return;
      job.updatedAt=now();
      if(response?.ok){job.status='done';job.error='';if(!Object.hasOwn(state.nativeBlocked,job.accountHandle))Object.defineProperty(state.nativeBlocked,job.accountHandle,{value:{},enumerable:true,writable:true,configurable:true});Object.defineProperty(state.nativeBlocked[job.accountHandle],job.handle,{value:now(),enumerable:true,writable:true,configurable:true});
        if(typeof response.id==='string'&&/^\d{1,25}$/.test(response.id))for(const e of state.entries)if(e.source==='local'&&e.handle===job.handle&&!e.id)e.id=response.id;
        log(state,response.alreadyBlocked?'already-blocked':'blocked',job.handle);}
      else{job.status=response?.uncertain?'uncertain':'failed';job.error=response?.error||'No verified response from X.';state.paused=true;state.pauseReason=job.error;log(state,'block-error',job.handle,job.error);}
    });
  }catch(err){if(picked)await mutate(state=>{const job=state.queue.find(j=>j.id===picked.job.id);if(job&&job.status==='running'){job.status='uncertain';job.error=err.message;job.updatedAt=now();state.paused=true;state.pauseReason=err.message;log(state,'block-error',job.handle,err.message);}});}
  finally{pumping=false;const s=await readState();if(!s.paused&&s.queue.some(j=>j.status==='pending'))await schedule(Math.max(30,s.settings.intervalSeconds)*1000);}
}

async function handle(message,sender) {
  if(sender.id!==chrome.runtime.id)throw new Error('Untrusted sender.');
  const extensionPage=sender.url?.startsWith(chrome.runtime.getURL(''));
  const content=!extensionPage;
  if(content&&(!sender.tab||!/^https:\/\/(x|twitter)\.com\//.test(sender.url??'')))throw new Error('Untrusted page.');
  if(content&&!['GET_STATE','CAPTURE_PROGRESS'].includes(message.type))throw new Error('This operation is only available in the extension dashboard.');
  if(!content&&!extensionPage)throw new Error('Untrusted extension page.');
  switch(message.type) {
    case 'GET_STATE':return {state:await readState()};
    case 'SAVE_SETTINGS':return mutate(state=>{
      const x=message.settings??{};const enabling=x.autoBlock===true&&!state.settings.autoBlock;
      if(enabling&&!state.settings.accountHandle)throw new Error('Connect your X account first.');
      if(enabling&&state.queue.some(j=>j.accountHandle===state.settings.accountHandle&&['failed','uncertain'].includes(j.status)))throw new Error('Review failed / uncertain items and use Retry before enabling automatic blocking.');
      if(x.language!=null){if(!['zh','ja','en'].includes(x.language))throw new Error('Invalid language');state.settings.language=x.language;}
      if(x.hideContent!=null)state.settings.hideContent=!!x.hideContent;
      if(x.intervalSeconds!=null){const n=Number(x.intervalSeconds);if(!Number.isFinite(n))throw new Error('Invalid interval');state.settings.intervalSeconds=Math.max(30,Math.min(300,n));}
      if(x.autoBlock!=null){state.settings.autoBlock=!!x.autoBlock;if(enabling){enqueueApproved(state);state.paused=false;state.pauseReason='';void schedule();}else if(!x.autoBlock){state.paused=true;state.pauseReason='Automatic blocking disabled';}}
    });
    case 'BIND_ACCOUNT':{
      const tab=await recentXTab();const result=await toTab(tab.id,{type:'GAB_IDENTITY'});
      if(!result?.ok)throw new Error(result?.error||'Cannot identify the signed-in X account.');
      const account=normalizeHandle(result.accountHandle);
      return mutate(state=>{if(state.queue.some(j=>j.status==='running'))throw new Error('Pause the queue and wait for the current operation before reconnecting.');state.settings.accountHandle=account;state.settings.autoBlock=false;state.paused=true;state.pauseReason='';reconcileQueue(state);log(state,'account-connected',account);});
    }
    case 'IMPORT':return mutate(state=>{const parsed=parseImport(message.text);return {...mergeLocal(state,parsed.entries),fileDuplicates:parsed.duplicates};});
    case 'IMPORT_CAPTURE':return mutate(state=>mergeLocal(state,state.capture.entries.map(e=>({...e,source:'local',status:'pending',reason:'',evidence:[],addedAt:now()}))));
    case 'REVIEW':return mutate(state=>{if(!['approved','pending'].includes(message.status))throw new Error('Invalid review status');const handles=new Set(message.handles.map(normalizeHandle));for(const e of state.entries)if(e.source==='local'&&handles.has(e.handle))e.status=message.status;reconcileQueue(state);if(state.settings.autoBlock){enqueueApproved(state);void schedule();}});
    case 'EDIT_ENTRY':return mutate(state=>{const h=normalizeHandle(message.handle);const e=state.entries.find(e=>e.source==='local'&&e.handle===h);if(!e)throw new Error('Local entry not found');e.reason=String(message.reason??'').slice(0,1000);e.evidence=safeEvidence(message.evidence);});
    case 'REMOVE_ENTRIES':return mutate(state=>{const handles=new Set(message.handles.map(normalizeHandle));state.entries=state.entries.filter(e=>e.source!=='local'||!handles.has(e.handle));reconcileQueue(state);});
    case 'ALLOW':return mutate(state=>{const h=normalizeHandle(message.handle);state.allowlist=state.allowlist.filter(x=>x!==h);if(message.enabled)state.allowlist.push(h);reconcileQueue(state);if(!message.enabled&&state.settings.autoBlock){enqueueApproved(state);void schedule();}});
    case 'ADD_SUBSCRIPTION':{
      const url=subscriptionURL(message.url);const id=uid();await mutate(state=>{if(state.subscriptions.length>=20)throw new Error('Maximum 20 subscriptions.');if(state.subscriptions.some(s=>s.url===url))throw new Error('Already subscribed.');state.subscriptions.push({id,url,name:String(message.name||'Community list').slice(0,120),enabled:true,updatedAt:null,error:'',count:0});});await syncOne(id);void pump();return {state:await readState()};
    }
    case 'SYNC':await syncAll();return {state:await readState()};
    case 'REMOVE_SUBSCRIPTION':return mutate(state=>{state.subscriptions=state.subscriptions.filter(s=>s.id!==message.id);state.entries=state.entries.filter(e=>e.source!==message.id);reconcileQueue(state);});
    case 'QUEUE_APPROVED':return mutate(state=>{enqueueApproved(state);});
    case 'START_QUEUE':{const result=await mutate(state=>{enqueueApproved(state);if(state.queue.some(j=>['uncertain','failed'].includes(j.status)))throw new Error('Review failed / uncertain items and use Retry before continuing.');state.paused=false;state.pauseReason='';});void pump();return result;}
    case 'PAUSE_QUEUE':return mutate(state=>{state.paused=true;state.pauseReason='Paused by you';log(state,'paused');});
    case 'RETRY_FAILED':return mutate(state=>{reconcileQueue(state);for(const j of state.queue)if(['failed','uncertain'].includes(j.status)&&j.accountHandle===state.settings.accountHandle){j.status='pending';j.error='';j.updatedAt=now();}state.pauseReason='';});
    case 'CAPTURE':{const tab=await recentXTab('/settings/blocked');const identity=await toTab(tab.id,{type:'GAB_IDENTITY'});if(!identity?.ok)throw new Error(identity?.error||'Cannot identify capture account.');const captureId=uid();const accountHandle=normalizeHandle(identity.accountHandle);
      await mutate(state=>{if(state.capture.status==='scanning')throw new Error('Stop the current capture first.');state.capture={entries:[],updatedAt:now(),status:'scanning',captureId,accountHandle,tabId:tab.id};});
      try{const result=await toTab(tab.id,{type:'GAB_CAPTURE',autoScroll:!!message.autoScroll,captureId,accountHandle});if(!result?.ok)throw new Error(result?.error||'Capture failed.');}catch(error){await mutate(s=>{if(s.capture.captureId===captureId)s.capture.status='stopped';});throw error;}return {state:await readState()};}
    case 'STOP_CAPTURE':{const state=await readState();if(state.capture.tabId)try{await toTab(state.capture.tabId,{type:'GAB_STOP_CAPTURE'});}catch{}return mutate(s=>{s.capture.status='stopped';});}
    case 'CAPTURE_PROGRESS':{
      if(!sender.tab||!/^https:\/\/(x|twitter)\.com\/settings\/blocked(?:\/|$)/.test(sender.url??''))throw new Error('Capture only works on X blocked-account settings.');
      const parsed=parseImport(JSON.stringify(message.entries));
      return mutate(state=>{if(state.capture.tabId!==sender.tab.id||state.capture.captureId!==message.captureId||state.capture.accountHandle!==message.accountHandle)throw new Error('Capture session changed; start a new capture.');const map=new Map(state.capture.entries.map(e=>[e.handle,e]));for(const e of parsed.entries)map.set(e.handle,{handle:e.handle,...(e.id?{id:e.id}:{})});if(map.size>MAX_ENTRIES)throw new Error('Capture limit reached.');state.capture={...state.capture,entries:[...map.values()],updatedAt:now(),status:String(message.status).slice(0,30),message:String(message.message??'').slice(0,300)};});
    }
    case 'EXPORT':{
      const state=await readState();const entries=state.entries.filter(e=>e.source==='local');
      if(message.kind==='public')return {filename:'guga-blocklist.json',mime:'application/json',text:JSON.stringify(publicDocument(state),null,2)};
      if(message.kind==='private')return {filename:'guga-private-backup.json',mime:'application/json',text:JSON.stringify({schema:SCHEMA,name:'Private local backup',updatedAt:now(),entries},null,2)};
      if(message.kind==='csv')return {filename:'guga-local-list.csv',mime:'text/csv',text:csvExport(entries)};
      throw new Error('Unknown export type.');
    }
    default:throw new Error('Unknown operation.');
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{handle(message,sender).then(result=>respond({ok:true,...result})).catch(err=>respond({ok:false,error:String(err.message??err)}));return true;});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='gab-sync')void syncAll();if(['gab-queue','gab-watchdog'].includes(alarm.name))void pump();});
chrome.tabs.onRemoved.addListener(tabId=>{void mutate(state=>{if(state.workerTabId===tabId){state.workerTabId=null;if(state.queue.some(j=>j.status==='running')){state.paused=true;state.pauseReason='Worker tab was closed.';}}});});

import {SCHEMA,MAX_BYTES,MAX_ENTRIES,now,uid,initialState,normalizeHandle,safeEvidence,parseImport,mergeLocal,effectiveEntries,enqueueApproved,reconcileQueue,recordBlocked,retryFailed,retainAllowlistIdentities,csvExport,subscriptionURL} from './lib/core.js';
import {prepareStorage,stateBytes,RECOVERY_BUDGET} from './lib/storage-budget.js';

let lock=Promise.resolve();
let pumping=false;
let syncing=false;
let recoveryRequired=false;
function resetInterruptedSession(state) {
  state.workerTabId=null;state.runId=null;
  for(const job of state.queue)if(job.status==='running'){
    job.status='uncertain';job.error='Browser restarted during an operation; verify before retrying.';job.updatedAt=now();state.paused=true;state.pauseReason=job.error;
  }
}
async function readState() {
  const {state}=await chrome.storage.local.get('state');
  const result=state ? {...initialState(),...state,settings:{...initialState().settings,...state.settings}} : initialState();
  if(recoveryRequired){resetInterruptedSession(result);result.paused=true;result.pauseReason='Local data is too large. Export a private backup, then remove unused data to recover.';}
  return result;
}
function mutate(fn, {critical=false}={}) {
  const result=lock.then(async()=>{const state=await readState();const extra=await fn(state);prepareStorage(state,{critical});await chrome.storage.local.set({state});if(recoveryRequired){await chrome.storage.session.set({gabRecovery:false});recoveryRequired=false;}return {state,...extra};});
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
// A session marker survives MV3 worker suspension, but never browser restart.
// It prevents a persisted tab ID from taking over an unrelated tab next session.
async function initializeSession() {
  const {gabSession,gabRecovery}=await chrome.storage.session.get(['gabSession','gabRecovery']);
  recoveryRequired=!!gabRecovery;
  if(!gabSession||recoveryRequired){
    try {await mutate(resetInterruptedSession,{critical:true});}
    catch(error){if(error.code!=='STORAGE_BUDGET')throw error;recoveryRequired=true;}
    // Legacy oversized state remains exportable; never activate a stale worker tab.
    await chrome.storage.session.set({gabSession:gabSession||uid(),gabRecovery:recoveryRequired});
  }
  await setup();
}
const ready=initializeSession();
// Register handlers synchronously; await initialization inside each handler.
ready.catch(error=>console.error('Guga initialization failed:',error.message));
chrome.runtime.onInstalled.addListener(()=>{void ready.then(()=>setup());});
chrome.runtime.onStartup.addListener(()=>{void ready.then(async()=>{await setup();await schedule();});});

async function recentXTab(path) {
  const state=await readState();
  const tabs=await chrome.tabs.query({url:['https://x.com/*','https://twitter.com/*']});
  const matches=tabs.filter(t=>!t.incognito&&t.id!==state.workerTabId && (!path||new URL(t.url).pathname.startsWith(path))).sort((a,b)=>(b.active-a.active)||((b.lastAccessed??0)-(a.lastAccessed??0)));
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
      const nextEntries=[...retained,...parsed.entries.map(e=>({...e,source:id}))];
      retainAllowlistIdentities(state,nextEntries);state.entries=nextEntries;
      Object.assign(live,{updatedAt:now(),error:'',count:parsed.entries.length});state.lastSync=now();reconcileQueue(state);
      if(state.settings.autoBlock&&state.settings.accountHandle)enqueueApproved(state);
      log(state,'subscription-updated','',`${live.name}: ${parsed.entries.length}`);
    });
  } catch(err) {await mutate(state=>{const live=state.subscriptions.find(s=>s.id===id);if(live)live.error=err.message;log(state,'subscription-error','',err.message);});}
}
async function syncAll() {
  if(syncing)return;syncing=true;
  try{const state=await readState();for(const sub of state.subscriptions.filter(s=>s.enabled))await syncOne(sub.id);}finally{syncing=false;}
  await pump();
}

async function waitForTab(tabId) {
  for(let i=0;i<25;i++){await sleep(600);const fresh=await chrome.tabs.get(tabId);if(fresh.status==='complete'){await sleep(800);return fresh;}}
  throw new Error('X profile page timed out.');
}
async function getWorkerTab(state,handle) {
  const url=`https://x.com/${encodeURIComponent(handle)}`;let tab;
  if(state.workerTabId!=null){try{tab=await chrome.tabs.get(state.workerTabId);}catch{}}
  if(tab){const prior=new URL(tab.url??'about:blank');if(tab.incognito||!['x.com','twitter.com'].includes(prior.hostname))throw new Error('Worker tab was used for another context. Pause, close it, and start again.');tab=await chrome.tabs.update(tab.id,{url});}
  else {tab=await chrome.tabs.create({url:'about:blank',active:false});await mutate(s=>{s.workerTabId=tab.id;},{critical:true});tab=await chrome.tabs.update(tab.id,{url});}
  return waitForTab(tab.id);
}
async function pump() {
  await ready;
  if(recoveryRequired)return;
  if(pumping)return;pumping=true;
  let picked;
  try {
    const chosen=await mutate(state=>{
      const active=state.queue.find(j=>j.status==='running');
      if(active){if(!Number.isFinite(Date.parse(active.updatedAt))||Date.now()-Date.parse(active.updatedAt)>120000){active.status='uncertain';active.error='Previous operation was interrupted; inspect X before retrying.';state.paused=true;state.pauseReason=active.error;log(state,'interrupted',active.handle,active.error);}return;}
      if(state.paused||!state.settings.accountHandle)return;
      reconcileQueue(state);
      const last=Date.parse(state.lastAttemptAt??'')||0;const wait=Math.max(30000,state.settings.intervalSeconds*1000)-(Date.now()-last);
      if(wait>0)return {wait};
      const job=state.queue.find(j=>j.status==='pending');if(!job)return;
      if(stateBytes(state)>RECOVERY_BUDGET-65536)throw new Error('Storage is nearly full. Export a backup and remove unused data before continuing.');
      state.runId=uid();state.lastAttemptAt=now();job.status='running';job.updatedAt=now();return {job:{...job},runId:state.runId};
    },{critical:true});
    if(chosen.wait){await schedule(chosen.wait);return;}
    if(!chosen.job)return;picked=chosen;
    await schedule(90000);
    const tab=await getWorkerTab(chosen.state,chosen.job.handle);
    const current=await readState();if(current.paused||current.runId!==chosen.runId)throw new Error('Queue paused before operation.');
    const request={handle:chosen.job.handle,userId:chosen.job.userId,accountHandle:chosen.job.accountHandle,jobId:chosen.job.id,runId:chosen.runId};
    const probe=await toTab(tab.id,{type:'GAB_PROBE',...request});
    if(!probe?.ok||typeof probe.id!=='string'||!/^\d{1,25}$/.test(probe.id)||(request.userId&&request.userId!==probe.id))throw new Error(probe?.error||'Cannot pin the target numeric ID before blocking.');
    // Persist identity before any native click. A crash must not turn a retry
    // into a fresh handle lookup for a possibly different account holder.
    await mutate(state=>{
      const job=state.queue.find(j=>j.id===chosen.job.id);
      const eligible=effectiveEntries(state).find(e=>e.id===probe.id||(!e.id&&e.handle===request.handle));
      if(state.paused||state.runId!==chosen.runId||!job||job.status!=='running'||!eligible||(job.userId&&job.userId!==probe.id))throw new Error('Queue or target identity changed before the block.');
      job.userId=probe.id;
      for(const e of state.entries)if(e.source==='local'&&e.handle===job.handle&&!e.id)e.id=probe.id;
    },{critical:true});
    request.userId=probe.id;chosen.job.userId=probe.id;
    let response=await toTab(tab.id,{type:'GAB_BLOCK',...request});
    if(response?.ok){
      if(typeof response.id!=='string'||!/^\d{1,25}$/.test(response.id)||(chosen.job.userId&&response.id!==chosen.job.userId))throw new Error('X returned an unverified target ID.');
      const observed=response;
      await chrome.tabs.reload(tab.id,{bypassCache:true});await waitForTab(tab.id);
      const verified=await toTab(tab.id,{type:'GAB_VERIFY',...request,userId:observed.id});
      if(!verified?.ok||verified.id!==observed.id)throw new Error(verified?.error||'The block result did not survive a page reload.');
      response={...verified,alreadyBlocked:observed.alreadyBlocked};
    }
    await mutate(state=>{
      const job=state.queue.find(j=>j.id===chosen.job.id);if(!job||job.status!=='running'||state.runId!==chosen.runId)return;
      job.updatedAt=now();
      if(response?.ok){
        const eligible=effectiveEntries(state).find(e=>e.id===response.id||(!e.id&&e.handle===job.handle));
        if(state.paused||!eligible||(eligible.id&&eligible.id!==response.id))throw new Error('Eligibility or target identity changed before recording the result.');
        recordBlocked(state,job,response.id);job.userId=response.id;job.status='done';job.error='';
        for(const e of state.entries)if(e.source==='local'&&e.handle===job.handle&&!e.id)e.id=response.id;
        log(state,response.alreadyBlocked?'already-blocked':'blocked',job.handle);}
      else{job.status=response?.uncertain?'uncertain':'failed';job.error=response?.error||'No verified response from X.';state.paused=true;state.pauseReason=job.error;log(state,'block-error',job.handle,job.error);}
    },{critical:true});
  }catch(err){await mutate(state=>{
    if(picked){const job=state.queue.find(j=>j.id===picked.job.id);if(job&&job.status==='running'){job.status='uncertain';job.error=err.message;job.updatedAt=now();}}
    state.paused=true;state.pauseReason=err.message;log(state,'block-error',picked?.job.handle||'',err.message);
  },{critical:true});}
  finally{pumping=false;const s=await readState();if(!s.paused&&s.queue.some(j=>j.status==='pending'))await schedule(Math.max(30,s.settings.intervalSeconds)*1000);}
}

async function handle(message,sender) {
  await ready;
  if(!message||typeof message!=='object')throw new Error('Invalid message.');
  if(sender.tab?.incognito)throw new Error('Incognito X sessions are not supported.');
  if(sender.id!==chrome.runtime.id)throw new Error('Untrusted sender.');
  const extensionPage=sender.url?.startsWith(chrome.runtime.getURL(''));
  const content=!extensionPage;
  if(content&&(!sender.tab||!/^https:\/\/(x|twitter)\.com\//.test(sender.url??'')))throw new Error('Untrusted page.');
  if(content&&!['GET_STATE','CAPTURE_PROGRESS'].includes(message.type))throw new Error('This operation is only available in the extension dashboard.');
  if(!content&&!extensionPage)throw new Error('Untrusted extension page.');
  if(recoveryRequired&&!['GET_STATE','EXPORT','REMOVE_ENTRIES','REMOVE_SUBSCRIPTION','PAUSE_QUEUE'].includes(message.type))throw new Error('Export a private backup and remove unused data before continuing.');
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
    case 'IMPORT':return mutate(state=>{const parsed=parseImport(message.text);const merged=mergeLocal(state,parsed.entries);reconcileQueue(state);return {...merged,fileDuplicates:parsed.duplicates};});
    case 'IMPORT_CAPTURE':return mutate(state=>{const result=mergeLocal(state,state.capture.entries.map(e=>({...e,source:'local',status:'pending',reason:'',evidence:[],addedAt:now()})));reconcileQueue(state);return result;});
    case 'REVIEW':return mutate(state=>{if(!['approved','pending'].includes(message.status))throw new Error('Invalid review status');const handles=new Set(message.handles.map(normalizeHandle));for(const e of state.entries)if(e.source==='local'&&handles.has(e.handle))e.status=message.status;reconcileQueue(state);if(state.settings.autoBlock){enqueueApproved(state);void schedule();}});
    case 'EDIT_ENTRY':return mutate(state=>{
      const h=normalizeHandle(message.handle);const e=state.entries.find(e=>e.source==='local'&&e.handle===h);if(!e)throw new Error('Local entry not found');
      if(message.id!=null){
        if(typeof message.id!=='string'||(message.id&&!/^\d{1,25}$/.test(message.id)))throw new Error('User IDs must be decimal strings (1–25 digits).');
        if(e.id&&!message.id)throw new Error('A verified numeric ID cannot be cleared. Correct the ID or remove the entry.');
        if(message.id&&message.id!==e.id){
          if(state.queue.some(j=>j.handle===h&&j.status==='running'))throw new Error('Wait for the current operation before editing its ID.');
          if(e.id)e.status='pending';e.id=message.id;
        }
      }
      e.reason=String(message.reason??'').slice(0,1000);e.evidence=safeEvidence(message.evidence);reconcileQueue(state);
    });
    case 'REMOVE_ENTRIES':return mutate(state=>{const handles=new Set(message.handles.map(normalizeHandle));state.entries=state.entries.filter(e=>e.source!=='local'||!handles.has(e.handle));reconcileQueue(state);});
    case 'ALLOW':return mutate(state=>{const h=normalizeHandle(message.handle);state.allowlist=state.allowlist.filter(x=>x!==h);if(message.enabled)state.allowlist.push(h);retainAllowlistIdentities(state);reconcileQueue(state);if(!message.enabled&&state.settings.autoBlock){enqueueApproved(state);void schedule();}});
    case 'ADD_SUBSCRIPTION':{
      const url=subscriptionURL(message.url);const id=uid();await mutate(state=>{if(state.subscriptions.length>=20)throw new Error('Maximum 20 subscriptions.');if(state.subscriptions.some(s=>s.url===url))throw new Error('Already subscribed.');state.subscriptions.push({id,url,name:String(message.name||'Community list').slice(0,120),enabled:true,updatedAt:null,error:'',count:0});});await syncOne(id);void pump();return {state:await readState()};
    }
    case 'SYNC':await syncAll();return {state:await readState()};
    case 'REMOVE_SUBSCRIPTION':return mutate(state=>{state.subscriptions=state.subscriptions.filter(s=>s.id!==message.id);state.entries=state.entries.filter(e=>e.source!==message.id);reconcileQueue(state);});
    case 'QUEUE_APPROVED':return mutate(state=>{enqueueApproved(state);});
    case 'START_QUEUE':{const result=await mutate(state=>{enqueueApproved(state);if(state.queue.some(j=>['uncertain','failed'].includes(j.status)))throw new Error('Review failed / uncertain items and use Retry before continuing.');state.paused=false;state.pauseReason='';});void pump();return result;}
    case 'PAUSE_QUEUE':return mutate(state=>{state.paused=true;state.pauseReason='Paused by you';log(state,'paused');},{critical:true});
    case 'RETRY_FAILED':return mutate(state=>{retryFailed(state);state.pauseReason='';});
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
      if(message.kind==='private')return {filename:'guga-private-backup.json',mime:'application/json',text:JSON.stringify({schema:SCHEMA,name:'Private local backup',updatedAt:now(),entries},null,2)};
      if(message.kind==='csv')return {filename:'guga-local-list.csv',mime:'text/csv',text:csvExport(entries)};
      throw new Error('Unknown export type.');
    }
    default:throw new Error('Unknown operation.');
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{handle(message,sender).then(result=>respond({ok:true,...result})).catch(err=>respond({ok:false,error:String(err.message??err)}));return true;});
chrome.alarms.onAlarm.addListener(alarm=>ready.then(()=>{if(alarm.name==='gab-sync')return syncAll();if(['gab-queue','gab-watchdog'].includes(alarm.name))return pump();}));
chrome.tabs.onRemoved.addListener(tabId=>{void ready.then(()=>mutate(state=>{if(state.workerTabId===tabId){state.workerTabId=null;if(state.queue.some(j=>j.status==='running')){state.paused=true;state.pauseReason='Worker tab was closed.';}}},{critical:true}));});

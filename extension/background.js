import {SCHEMA,MAX_BYTES,MAX_ENTRIES,now,uid,initialState,normalizeHandle,safeEvidence,parseImport,mergeLocal,effectiveEntries,enqueueApproved,reconcileQueue,recordBlocked,retryFailed,retainAllowlistIdentities,csvExport,subscriptionURL,accountKey,jobAccountKey} from './lib/core.js';
import {createXApiAdapter, XApiError} from './lib/x-api.js';
import {createXSessionProvider} from './lib/x-session.js';
import {prepareStorage,stateBytes,RECOVERY_BUDGET} from './lib/storage-budget.js';

const xSession=createXSessionProvider();
const xApi=createXApiAdapter({getSession:()=>xSession.getSession(),fetchImpl:(...args)=>fetch(...args)});
// These are conservative local budgets, not claims about X's server quotas.
const API_WINDOW=15*60*1000, API_WRITES=30, API_BATCH=10, API_BATCH_PAUSE=2*60*1000;
const validId=value=>typeof value==='string'&&/^[1-9]\d{0,24}$/.test(value);
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
  if(state&&state.executorVersion!=='x-api-v1'){
    result.executorVersion='x-api-v1';result.version=2;
    result.settings.accountId='';result.settings.sessionInvalid=true;result.settings.autoBlock=false;
    result.paused=true;result.pauseReason='Reconnect X to verify the API execution account after this update.';
    result.workerTabId=null;result.runId=null;result.apiCooldown=null;result.apiBudget={accountId:'',writes:[]};
    for(const job of result.queue)if(job.status==='running'){job.status='uncertain';job.error='The previous page-based operation was interrupted by an extension update.';job.updatedAt=now();}
    for(const job of result.queue)if(['pending','failed'].includes(job.status)){job.status='skipped';job.error='Legacy page-based job; reconnect and rebuild the API queue.';}
  }
  if(recoveryRequired){resetInterruptedSession(result);result.paused=true;result.pauseReason='Local data is too large. Export a private backup, then remove unused data to recover.';}
  return result;
}
function mutate(fn, {critical=false}={}) {
  const result=lock.then(async()=>{const state=await readState();const extra=await fn(state);prepareStorage(state,{critical});await chrome.storage.local.set({state});if(recoveryRequired){await chrome.storage.session.set({gabRecovery:false});recoveryRequired=false;}return {state,...extra};});
  lock=result.catch(()=>{});return result;
}
function log(state,action,handle='',message='') {state.logs.unshift({at:now(),action,handle,message:String(message).slice(0,500)});state.logs=state.logs.slice(0,1000);}
async function schedule(delay=30000) {await chrome.alarms.create('gab-queue',{when:Date.now()+Math.max(30000,delay)});}
async function setup() {
  if(!await chrome.alarms.get('gab-sync')) await chrome.alarms.create('gab-sync',{periodInMinutes:360});
  // A periodic watchdog detects interrupted API writes without replaying them.
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
  await mutate(()=>{}, {critical:true}).catch(error=>{if(error.code!=='STORAGE_BUDGET')throw error;});
  await setup();
}
const ready=initializeSession();
// Register handlers synchronously; await initialization inside each handler.
ready.catch(error=>console.error('Guga initialization failed:',error.message));
chrome.runtime.onInstalled.addListener(()=>{void ready.then(()=>setup());});
chrome.runtime.onStartup.addListener(()=>{void ready.then(async()=>{await setup();await schedule();});});

function validateXTab(tab,state,path) {
  let url;try{url=new URL(tab?.url);}catch{}
  if(!Number.isInteger(tab?.id)||tab.id<0||tab.incognito||tab.id===state.workerTabId||!url||url.protocol!=='https:'||!['x.com','twitter.com'].includes(url.hostname)||url.username||url.password)throw new Error('Select a normal X tab in this window. The automatic worker tab cannot connect an account.');
  if(path&&url.pathname!==path&&!url.pathname.startsWith(`${path}/`))throw new Error('Open https://x.com/settings/blocked/all in this window first.');
  return tab;
}
async function checkedXTab(tabId,path) {
  if(!Number.isInteger(tabId)||tabId<0)throw new Error('Invalid X tab selection.');
  const state=await readState();return validateXTab(await chrome.tabs.get(tabId),state,path);
}
async function recentXTab(path) {
  const state=await readState();
  const tabs=await chrome.tabs.query({currentWindow:true,url:['https://x.com/*','https://twitter.com/*']});
  const matches=tabs.filter(tab=>{try{validateXTab(tab,state,path);return true;}catch{return false;}}).sort((a,b)=>(Number(b.active)-Number(a.active))||((b.lastAccessed??0)-(a.lastAccessed??0)));
  if(!matches.length)throw new Error(path?'Open https://x.com/settings/blocked/all in this window first, then return here.':'Open X and sign in in this window first, then return here.');
  return checkedXTab(matches[0].id,path);
}
async function toTab(tabId,message) {
  try {return await chrome.tabs.sendMessage(tabId,message,{frameId:0});}catch(error){throw new Error(`X page did not respond. Refresh that X tab and try again. ${String(error.message).slice(0,180)}`);}
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

function requireApiAccount(state) {
  if(!validId(state.settings.accountId)||state.settings.sessionInvalid)throw new Error('Reconnect X to verify your current API execution account.');
}
function requireNoCooldown(state) {
  if(Number(state.apiCooldown?.until)>Date.now())throw new Error('X requests are cooling down. Wait until the displayed time before trying again.');
}
function budgetWrites(state) {
  state.apiBudgets??={};
  const accountId=state.settings.accountId;
  if(!Object.hasOwn(state.apiBudgets,accountId))state.apiBudgets[accountId]={accountId,writes:state.apiBudget?.accountId===accountId?state.apiBudget.writes:[]};
  state.apiBudget=state.apiBudgets[accountId];
  const timestamp=Date.now();
  state.apiBudget.writes=(state.apiBudget.writes||[]).filter(at=>Number.isFinite(at)&&at>timestamp-API_WINDOW&&at<=timestamp);
  return state.apiBudget.writes;
}
function guardJob(state,picked,{readOnly=false}={}) {
  requireApiAccount(state);
  const job=state.queue.find(j=>j.id===picked.job.id);
  const entry=effectiveEntries(state).find(e=>e.id===picked.job.userId);
  if(state.paused||state.runId!==picked.runId||!job||job.status!=='running'||job.accountId!==state.settings.accountId||job.userId!==picked.job.userId||(!entry&&!(readOnly&&job.reconcileOnly))||!validId(job.userId))throw new Error('The API queue, account or approved target changed.');
  return job;
}
function errorText(error){return error instanceof XApiError?error.message:String(error?.message||'The operation failed.').slice(0,300);}
function noteCooldown(state,kind,until){
  const timestamp=Date.now();
  const deadline=Number.isFinite(until)&&until>timestamp?until:timestamp+15*60*1000;
  state.apiCooldown={kind,until:Math.max(deadline,Number(state.apiCooldown?.until)||0)};
}
async function pump() {
  await ready;
  if(recoveryRequired||pumping)return;pumping=true;
  let picked,writeStarted=false,writeConfirmed=false;
  try {
    const chosen=await mutate(state=>{
      const active=state.queue.find(j=>j.status==='running');
      if(active){if(!Number.isFinite(Date.parse(active.updatedAt))||Date.now()-Date.parse(active.updatedAt)>120000){active.status='uncertain';active.error='Previous API operation was interrupted. Retry performs a relationship read before any new write.';state.paused=true;state.pauseReason=active.error;log(state,'interrupted',active.handle,active.error);}return;}
      if(state.paused||!validId(state.settings.accountId)||state.settings.sessionInvalid)return;
      reconcileQueue(state);
      const cooldown=Number(state.apiCooldown?.until)||0;
      if(cooldown>Date.now())return {wait:cooldown-Date.now()};
      state.apiCooldown=null;
      const writes=budgetWrites(state);
      if(writes.length>=API_WRITES){noteCooldown(state,'budget',writes[0]+API_WINDOW);return {wait:state.apiCooldown.until-Date.now()};}
      const last=Date.parse(state.lastAttemptAt??'')||0;
      const wait=Math.max(30000,state.settings.intervalSeconds*1000)-(Date.now()-last);
      if(wait>0)return {wait};
      const job=state.queue.find(j=>j.status==='pending'&&j.accountId===state.settings.accountId);if(!job)return;
      if(!validId(job.userId)){job.status='needs_id';return;}
      if(stateBytes(state)>RECOVERY_BUDGET-65536)throw new Error('Storage is nearly full. Export a backup and remove unused data before continuing.');
      state.runId=uid();state.lastAttemptAt=now();job.status='running';job.updatedAt=now();return {job:{...job},runId:state.runId};
    },{critical:true});
    if(chosen.wait){await schedule(chosen.wait);return;}
    if(!chosen.job)return;picked=chosen;
    await schedule(90000);
    guardJob(await readState(),picked,{readOnly:true});
    const options={expectedAccountId:picked.job.accountId};
    // Every attempt, including an uncertain retry, reads the relationship first.
    let relationship=await xApi.readRelationship(picked.job.userId,options);
    guardJob(await readState(),picked,{readOnly:true});
    const alreadyBlocked=relationship.blocking;
    if(picked.job.reconcileOnly&&!alreadyBlocked){
      const reconciled=await mutate(state=>{
        const job=guardJob(state,picked,{readOnly:true});
        if(!effectiveEntries(state).some(e=>e.id===job.userId)){
          job.status='skipped';job.error='The previous write is not present and this numeric target is no longer approved.';job.updatedAt=now();delete job.reconcileOnly;return {retired:true};
        }
      },{critical:true});
      if(reconciled.retired)return;
    }
    if(!alreadyBlocked){
      await xApi.blockUser(picked.job.userId,{...options,beforeWrite:async()=>{
        await mutate(state=>{
          const job=guardJob(state,picked);requireNoCooldown(state);
          const writes=budgetWrites(state);if(writes.length>=API_WRITES)throw new Error('The local operation budget is exhausted.');
          writes.push(Date.now());job.writeAttemptAt=now();
        },{critical:true});
        writeStarted=true;
      },beforeDispatch:async()=>{const state=await readState();guardJob(state,picked);requireNoCooldown(state);}});
      writeConfirmed=true;
      // Do not accept an optimistic response without an independent readback.
      relationship=await xApi.readRelationship(picked.job.userId,options);
      if(!relationship.blocking)throw new XApiError('X did not confirm the block relationship after the write.',{kind:'response',uncertain:true});
    }
    await mutate(state=>{
      const job=guardJob(state,picked,{readOnly:alreadyBlocked});
      if(relationship.accountId!==job.accountId||relationship.targetId!==job.userId||!relationship.blocking)throw new Error('X returned an unverified block relationship.');
      recordBlocked(state,job,job.userId);job.status='done';job.error='';job.updatedAt=now();delete job.reconcileOnly;
      if(writeStarted&&budgetWrites(state).length%API_BATCH===0)noteCooldown(state,'budget',Date.now()+API_BATCH_PAUSE);
      log(state,alreadyBlocked?'already-blocked':'blocked',job.handle);
    },{critical:true});
  }catch(error){await mutate(state=>{
    const job=picked&&state.queue.find(j=>j.id===picked.job.id);
    const message=errorText(error);
    const uncertain=!!picked?.job.reconcileOnly||writeConfirmed||!!error.uncertain||(writeStarted&&!['auth','rate_limit','request','target_unavailable','target_suspended','cancelled'].includes(error.kind));
    if(job&&job.status==='running'){
      job.status=uncertain?'uncertain':'failed';job.error=message;job.updatedAt=now();
      if(error.kind==='rate_limit'&&!uncertain){job.status='pending';noteCooldown(state,'rate_limit',error.retryAt);}
      if(['target_unavailable','target_suspended'].includes(error.kind)&&!uncertain)job.status='skipped';
    }
    if(error.kind==='rate_limit')noteCooldown(state,'rate_limit',error.retryAt);
    if(!(error.kind==='rate_limit'&&!uncertain)&&(!['target_unavailable','target_suspended'].includes(error.kind)||uncertain)){state.paused=true;state.pauseReason=message;}
    if(['auth','account_changed'].includes(error.kind)){state.settings.sessionInvalid=true;state.settings.autoBlock=false;noteCooldown(state,'auth',Date.now()+60000);state.paused=true;}
    else if(['network','timeout','server'].includes(error.kind))noteCooldown(state,'network',Date.now()+60000);
    log(state,'block-error',picked?.job.handle||'',message);
  },{critical:true});}
  finally{pumping=false;const state=await readState();if(!state.paused&&state.queue.some(j=>j.status==='pending'&&j.accountId===state.settings.accountId))await schedule(Math.max(30000,state.settings.intervalSeconds*1000,(state.apiCooldown?.until||0)-Date.now()));}
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
      if(enabling){requireApiAccount(state);requireNoCooldown(state);}
      if(enabling&&state.queue.some(j=>jobAccountKey(j)===accountKey(state)&&['failed','uncertain'].includes(j.status)))throw new Error('Review failed / uncertain items and use Retry before enabling automatic blocking.');
      if(x.language!=null){if(!['zh','ja','en'].includes(x.language))throw new Error('Invalid language');state.settings.language=x.language;}
      if(x.hideContent!=null)state.settings.hideContent=!!x.hideContent;
      if(x.intervalSeconds!=null){const n=Number(x.intervalSeconds);if(!Number.isFinite(n))throw new Error('Invalid interval');state.settings.intervalSeconds=Math.max(30,Math.min(300,n));}
      if(x.autoBlock!=null){state.settings.autoBlock=!!x.autoBlock;if(enabling){enqueueApproved(state);state.paused=false;state.pauseReason='';void schedule();}else if(!x.autoBlock){state.paused=true;state.pauseReason='Automatic blocking disabled';}}
    });
    case 'BIND_ACCOUNT':{
      const requestId=uid();
      await mutate(state=>{
        requireNoCooldown(state);
        if(state.queue.some(j=>j.status==='running'))throw new Error('Pause the queue and wait for the current operation before reconnecting.');
        state.settings.autoBlock=false;state.paused=true;state.pauseReason='Connecting X account';
        state.lastConnection={requestId,status:'connecting',at:now(),error:''};
      });
      try{
        const identity=await xApi.verifyAccount();
        if(!validId(identity.accountId))throw new Error('X did not verify a numeric execution account.');
        const account=normalizeHandle(identity.handle);
        return await mutate(state=>{
          if(state.lastConnection?.requestId!==requestId)throw new Error('A newer connection request replaced this one.');
          if(state.queue.some(j=>j.status==='running'))throw new Error('Pause the current operation before reconnecting.');
          state.settings.accountHandle=account;state.settings.accountId=identity.accountId;state.settings.sessionInvalid=false;
          state.settings.autoBlock=false;state.paused=true;state.pauseReason='';
          state.lastConnection={...state.lastConnection,status:'connected',at:now(),error:''};
          // Reconnecting cannot erase a persisted budget or rate-limit deadline.
          budgetWrites(state);reconcileQueue(state);log(state,'account-connected',account);
        });
      }catch(error){
        await mutate(state=>{if(state.lastConnection?.requestId===requestId){state.lastConnection={...state.lastConnection,status:'failed',at:now(),error:errorText(error)};state.paused=true;state.settings.autoBlock=false;state.settings.sessionInvalid=true;state.pauseReason=state.lastConnection.error;if(error.kind==='rate_limit')noteCooldown(state,'rate_limit',error.retryAt);else if(['auth','account_changed'].includes(error.kind))noteCooldown(state,'auth',Date.now()+60000);}});
        throw error;
      }
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
    case 'QUEUE_APPROVED':return mutate(state=>{requireApiAccount(state);enqueueApproved(state);});
    case 'START_QUEUE':{const result=await mutate(state=>{requireApiAccount(state);requireNoCooldown(state);enqueueApproved(state);if(state.queue.some(j=>jobAccountKey(j)===accountKey(state)&&['uncertain','failed'].includes(j.status)))throw new Error('Review failed / uncertain items and use Retry before continuing.');state.paused=false;state.pauseReason='';});void pump();return result;}
    case 'PAUSE_QUEUE':return mutate(state=>{state.paused=true;state.pauseReason='Paused by you';log(state,'paused');},{critical:true});
    case 'RETRY_FAILED':return mutate(state=>{requireApiAccount(state);requireNoCooldown(state);retryFailed(state);state.pauseReason='';});
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
chrome.runtime.onMessage.addListener((message,sender,respond)=>{const reply=value=>{try{respond(value);}catch{/* A closed popup must not undo a persisted result. */}};handle(message,sender).then(result=>reply({ok:true,...result})).catch(err=>reply({ok:false,error:String(err.message??err)}));return true;});
chrome.alarms.onAlarm.addListener(alarm=>ready.then(()=>{if(alarm.name==='gab-sync')return syncAll();if(['gab-queue','gab-watchdog'].includes(alarm.name))return pump();}));
chrome.cookies?.onChanged?.addListener(change=>{
  if(!['twid','ct0'].includes(change.cookie?.name)||!['x.com','.x.com'].includes(change.cookie?.domain))return;
  void ready.then(async()=>{
    let current;try{current=await xSession.getSession();}catch{}
    await mutate(state=>{
      if(!state.settings.accountId)return;
      if(!current||current.accountId!==state.settings.accountId){state.settings.sessionInvalid=true;state.settings.autoBlock=false;state.paused=true;state.pauseReason='The X browser session changed. Reconnect before continuing.';}
    },{critical:true});
  }).catch(()=>{});
});

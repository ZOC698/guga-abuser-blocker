import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {initialState,effectiveEntries} from '../extension/lib/core.js';
import {STATE_BUDGET,stateBytes} from '../extension/lib/storage-budget.js';

const RealDate=Date;let clock=RealDate.now();
globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}};
after(()=>{globalThis.Date=RealDate;});
const ACCOUNT='9007199254740993',OTHER_ACCOUNT='9007199254740997',TARGET='9007199254740995',CSRF='a'.repeat(64);
const SCREEN_PATH='/i/api/graphql/AMIBMjtxEEATh4z8V9GtRg/UserByScreenName',REST_PATH='/i/api/graphql/mxaYWwt52eAb6OAzYHMVzg/UserByRestId';
const VIEWER_PATH='/i/api/graphql/TpQxQtWMTMnIAMPlMGMqNw/Viewer';
const VIEWER_FEATURES={subscriptions_upsells_api_enabled:false,profile_label_improvements_pcf_label_in_post_enabled:true,responsive_web_profile_redirect_enabled:true,rweb_tipjar_consumption_enabled:false,verified_phone_label_enabled:false,creator_subscriptions_tweet_preview_api_enabled:true,responsive_web_graphql_timeline_navigation_enabled:true};
let storage={state:initialState()},session={},listener,alarmListener,startupListener,cookieListener,alarms=new Map();
let cookieAccount=ACCOUNT,cookieCSRF=CSRF,cookieHook=null,cookieReads=[],requests=[],tabCalls=[],fetchHook=null,blocked=new Set(),serial=0;
const serverHandles=new Map([[ACCOUNT,'owner'],[OTHER_ACCOUNT,'other_owner']]);
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
const graphUser=(id,handle='target',blocking=false)=>({data:{user:{result:{__typename:'User',rest_id:id,core:{screen_name:handle},relationship_perspectives:{blocking}}}}});
const graphViewer=(id,handle)=>({data:{viewer:{user_results:{result:graphUser(id,handle).data.user.result}}}});
const graphVariables=call=>JSON.parse(new URL(call.url).searchParams.get('variables'));
const originalFetch=globalThis.fetch;after(()=>{globalThis.fetch=originalFetch;});
async function fakeFetch(url,init={}) {
  const call={url:String(url),method:init.method||'GET',body:init.body,init};requests.push(call);
  if(fetchHook){const response=await fetchHook(call);if(response!==undefined)return response;}
  const parsed=new URL(call.url);assert.equal(init.credentials,'include');assert.equal(init.redirect,'error');
  assert.equal(parsed.origin,'https://x.com');
  if(parsed.pathname===VIEWER_PATH){assert.equal(call.method,'GET');assert.deepEqual([...parsed.searchParams.keys()].sort(),['features','fieldToggles','variables']);assert.deepEqual(graphVariables(call),{withCommunitiesMemberships:false});assert.deepEqual(JSON.parse(parsed.searchParams.get('features')),VIEWER_FEATURES);assert.deepEqual(JSON.parse(parsed.searchParams.get('fieldToggles')),{withAuxiliaryUserLabels:true,isDelegate:false});return json(graphViewer(cookieAccount,serverHandles.get(cookieAccount)));}
  if(parsed.pathname===SCREEN_PATH){assert.equal(call.method,'GET');const handle=graphVariables(call).screen_name;return json(graphUser([...serverHandles].find(([,name])=>name===handle)?.[0],handle));}
  if(parsed.pathname===REST_PATH){assert.equal(call.method,'GET');const id=graphVariables(call).userId;assert.match(id,/^[1-9]\d{0,24}$/);return json(graphUser(id,'target',blocked.has(`${cookieAccount}:${id}`)));}
  if(parsed.pathname==='/i/api/1.1/blocks/create.json'){assert.equal(call.method,'POST');const body=new URLSearchParams(call.body);assert.deepEqual([...body.keys()],['user_id']);const id=body.get('user_id');assert.match(id,/^[1-9]\d{0,24}$/);blocked.add(`${cookieAccount}:${id}`);return json({id_str:id,blocking:true});}
  throw new Error('Unexpected fixture endpoint');
}
globalThis.fetch=fakeFetch;
const unexpectedTab=method=>async()=>{tabCalls.push(method);throw new Error('Unexpected browser operation in API execution');};
storage.state.workerTabId=99;storage.state.runId='old-run';storage.state.paused=false;
storage.state.queue=[{id:'interrupted',handle:'target',accountHandle:'owner',status:'running',updatedAt:new Date().toISOString()}];
const extensionId='fixture';
globalThis.chrome={
  runtime:{id:extensionId,getURL:path=>`chrome-extension://${extensionId}/${path}`,onMessage:{addListener:fn=>listener=fn},onInstalled:{addListener(){}},onStartup:{addListener:fn=>startupListener=fn}},
  storage:{local:{get:async()=>structuredClone(storage),set:async value=>{storage=structuredClone(value);}},session:{get:async()=>structuredClone(session),set:async value=>{session={...session,...value};}}},
  alarms:{get:async name=>alarms.get(name),create:async(name,value)=>alarms.set(name,value),onAlarm:{addListener:fn=>alarmListener=fn}},
  permissions:{contains:async()=>true},
  cookies:{onChanged:{addListener:fn=>cookieListener=fn},get:async args=>{assert.equal(args.url,'https://x.com/i/api/1.1/');assert.ok(['twid','ct0'].includes(args.name));cookieReads.push(args.name);if(cookieHook)await cookieHook(args,cookieReads.length);const value=args.name==='twid'?(cookieAccount?`u%3D${cookieAccount}`:null):cookieCSRF;return value?{name:args.name,value,domain:'.x.com',secure:true,path:'/',storeId:'0'}:null;}},
  tabs:{query:unexpectedTab('query'),get:unexpectedTab('get'),sendMessage:unexpectedTab('sendMessage'),create:unexpectedTab('create'),update:unexpectedTab('update'),reload:unexpectedTab('reload')}
};
await import('../extension/background.js');
const send=(message,sender={id:extensionId,url:'chrome-extension://fixture/options.html',tab:{id:8}})=>new Promise(resolve=>listener(message,sender,resolve));
const entry=(handle='target',id=TARGET)=>({handle,...(id?{id}:{}),source:'local',status:'approved',reason:'',evidence:[]});
function reset({bound=false,entries=[]}={}){clock+=60000;storage={state:initialState()};storage.state.entries=entries;cookieAccount=ACCOUNT;cookieCSRF=CSRF;cookieHook=null;cookieReads=[];requests=[];tabCalls=[];fetchHook=null;blocked=new Set();globalThis.fetch=fakeFetch;if(bound)Object.assign(storage.state.settings,{accountId:ACCOUNT,accountHandle:'owner',sessionInvalid:false});}
async function until(predicate){for(let i=0;i<300;i++){if(predicate()){await new Promise(resolve=>setImmediate(resolve));return;}await new Promise(resolve=>setTimeout(resolve,1));}assert.ok(predicate(),'Fixture operation did not settle');}
async function runQueue(){const result=await send({type:'START_QUEUE'});assert.equal(result.ok,true,result.error);await until(()=>!storage.state.queue.some(job=>job.status==='running')&&(storage.state.queue.some(job=>['done','failed','uncertain','skipped','needs_id'].includes(job.status))||storage.state.apiCooldown));return storage.state;}
const posts=()=>requests.filter(call=>call.method==='POST');
const apiPaths=()=>requests.map(call=>new URL(call.url).pathname.replace(/^\/(?:i\/api\/)?1\.1\//,'').replace(/^\/i\/api\/graphql\/[^/]+\//,''));
async function reloadWorker(){await import(`../extension/background.js?api-test-${++serial}`);await send({type:'GET_STATE'});}

test('new browser session discards stale tab ownership and pauses interrupted writes',async()=>{
  const result=await send({type:'GET_STATE'});
  assert.equal(result.state.workerTabId,null);assert.equal(result.state.runId,null);assert.equal(result.state.queue[0].status,'uncertain');assert.equal(result.state.paused,true);
  assert.ok(session.gabSession);assert.ok(alarms.has('gab-watchdog'));assert.ok(alarms.has('gab-sync'));
  storage={state:initialState()};
});

test('background enforces message authority and binds identity',async()=>{
  let result=await send({type:'BIND_ACCOUNT'});assert.equal(result.ok,true,result.error);assert.equal(result.state.settings.accountHandle,'owner');assert.equal(result.state.settings.accountId,ACCOUNT);assert.deepEqual(apiPaths(),['Viewer']);assert.deepEqual(tabCalls,[]);
  result=await send({type:'IMPORT',text:'@example'},{id:extensionId,url:'https://x.com/home',tab:{id:1}});assert.equal(result.ok,false);assert.equal(storage.state.entries.length,0);
  result=await send({type:'GET_STATE'},{id:'other',url:'chrome-extension://fixture/options.html'});assert.equal(result.ok,false);
});
test('imported rows are enabled and private exports preserve the read-only public boundary',async()=>{
  assert.equal((await send({type:'IMPORT',text:'@example\n@private'})).ok,true);
  assert.ok(storage.state.entries.every(e=>e.status==='approved'));
  await send({type:'REVIEW',handles:['private'],status:'pending'});
  const pub=await send({type:'EXPORT',kind:'public'});assert.equal(pub.ok,false);
  assert.equal((await send({type:'UPLOAD',entries:[{handle:'example'}]})).ok,false);
  const priv=await send({type:'EXPORT',kind:'private'});assert.equal(priv.ok,true);assert.equal(JSON.parse(priv.text).entries.length,2);assert.equal(priv.text.includes('nativeBlocked'),false);
});
test('automatic mode queues only enabled entries and pause remains durable',async()=>{
  let result=await send({type:'SAVE_SETTINGS',settings:{autoBlock:true,intervalSeconds:1}});assert.equal(result.ok,true);assert.equal(result.state.settings.intervalSeconds,30);assert.deepEqual(result.state.queue.filter(j=>j.status!=='skipped').map(j=>j.handle),['example']);
  result=await send({type:'PAUSE_QUEUE'});assert.equal(result.state.paused,true);
  result=await send({type:'SAVE_SETTINGS',settings:{language:'ja'}});assert.equal(result.state.paused,true);
  result=await send({type:'ALLOW',handle:'example',enabled:true});assert.equal(result.state.queue[0].status,'skipped');
});
test('failed remote refresh retains last known list and records error',async()=>{
  storage.state.subscriptions=[{id:'subscription',url:'https://raw.githubusercontent.com/o/r/main/list.json',enabled:true,name:'List'}];storage.state.entries.push({handle:'retained',source:'subscription',status:'approved'});
  globalThis.fetch=async()=>new Response('not-json',{status:200});
  const result=await send({type:'SYNC'});assert.equal(result.ok,true);assert.ok(result.state.entries.some(e=>e.handle==='retained'));assert.ok(result.state.subscriptions[0].error);
});
test('successful remote replacement removes stale eligibility but never unblocks X',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({schema:'guga-blocklist/v1',entries:[{handle:'new_member'}]}),{status:200});
  const result=await send({type:'SYNC'});assert.ok(!result.state.entries.some(e=>e.handle==='retained'));assert.ok(result.state.entries.some(e=>e.handle==='new_member'));assert.equal(result.state.paused,true);
});
test('capture progress rejects wrong session and tab',async()=>{
  storage.state.capture={entries:[],captureId:'session',accountHandle:'owner',tabId:2};
  const result=await send({type:'CAPTURE_PROGRESS',entries:[{handle:'example'}],captureId:'stale',accountHandle:'owner',status:'scanning'},{id:extensionId,url:'https://x.com/settings/blocked/all',tab:{id:2}});assert.equal(result.ok,false);assert.equal(storage.state.capture.entries.length,0);
});

test('ID enrichment, explicit correction and retry refresh the queued identity',async()=>{
  reset({bound:true});
  await send({type:'IMPORT',text:'@target'});await send({type:'REVIEW',handles:['target'],status:'approved'});await send({type:'QUEUE_APPROVED'});
  let result=await send({type:'IMPORT',text:JSON.stringify([{handle:'target',id:'111'}])});
  assert.equal(result.updated,1);assert.equal(result.state.queue[0].userId,'111');
  result=await send({type:'EDIT_ENTRY',handle:'target',id:'222',reason:'Corrected',evidence:[]});
  assert.equal(result.ok,true);assert.equal(result.state.entries[0].status,'pending');assert.equal(result.state.queue[0].status,'skipped');
  assert.equal((await send({type:'EDIT_ENTRY',handle:'target',id:''})).ok,false);
  await send({type:'REVIEW',handles:['target'],status:'approved'});await send({type:'QUEUE_APPROVED'});
  const job=storage.state.queue.find(j=>j.status==='pending');job.status='failed';job.userId='111';
  result=await send({type:'RETRY_FAILED'});assert.equal(result.ok,true);assert.equal(result.state.queue.find(j=>j.id===job.id).userId,'222');
});

test('oversized aggregate refresh atomically retains the last valid subscription',async()=>{
  storage={state:initialState()};
  storage.state.subscriptions=[{id:'s',enabled:true,name:'Fixture',url:'https://raw.githubusercontent.com/o/r/main/list.json'}];
  storage.state.entries=Array.from({length:6500},(_,i)=>({handle:`old_${i}`,reason:'r'.repeat(1000),evidence:[],source:'local',status:'pending'}));
  storage.state.entries.push({handle:'retained',reason:'',evidence:[],source:'s',status:'approved'});
  assert.ok(stateBytes(storage.state)<STATE_BUDGET);
  const incoming=Array.from({length:1600},(_,i)=>({handle:`new_${i}`,reason:'x'.repeat(1000)}));
  globalThis.fetch=async()=>new Response(JSON.stringify({schema:'guga-blocklist/v1',entries:incoming}),{status:200});
  const result=await send({type:'SYNC'});assert.equal(result.ok,true);assert.match(result.state.subscriptions[0].error,/too large/);
  assert.equal(result.state.entries.length,6501);assert.ok(result.state.entries.some(e=>e.handle==='retained'));assert.ok(!result.state.entries.some(e=>e.handle==='new_0'));
  assert.equal((await send({type:'PAUSE_QUEUE'})).ok,true);
});

test('watchdog marks stale in-flight work uncertain instead of repeating it',async()=>{
  storage={state:initialState()};storage.state.paused=false;storage.state.settings.accountHandle='owner';
  storage.state.queue=[{id:'stale',handle:'target',accountHandle:'owner',status:'running',updatedAt:'invalid'}];
  await alarmListener({name:'gab-watchdog'});
  assert.equal(storage.state.queue[0].status,'uncertain');assert.equal(storage.state.paused,true);
});

test('worker suspension preserves durable API limits and restart clears obsolete tab ownership',async()=>{
  storage={state:initialState()};storage.state.workerTabId=44;storage.state.apiCooldown={kind:'rate_limit',until:clock+60000};
  await import('../extension/background.js?same-session');
  assert.equal((await send({type:'GET_STATE'})).state.apiCooldown.until,clock+60000);
  session={};await import('../extension/background.js?next-session');
  assert.equal((await send({type:'GET_STATE'})).state.workerTabId,null);
  alarms.clear();startupListener();await new Promise(resolve=>setTimeout(resolve,0));assert.ok(alarms.has('gab-sync'));assert.ok(alarms.has('gab-watchdog'));assert.ok(alarms.has('gab-queue'));
});

test('incognito content and arbitrary write methods cannot reach the queue',async()=>{
  const result=await send({type:'GET_STATE'},{id:extensionId,url:'https://x.com/home',tab:{id:1,incognito:true}});assert.equal(result.ok,false);
  assert.equal((await send({type:'PUSH_GITHUB',token:'synthetic'})).ok,false);
});

test('oversized legacy state remains paused, exportable and recoverable after upgrade',async()=>{
  storage={state:initialState()};session={};storage.state.workerTabId=88;storage.state.paused=false;
  storage.state.entries=[{handle:'legacy',source:'local',status:'pending',reason:'x'.repeat(9*1024*1024),evidence:[]}];
  await import('../extension/background.js?legacy-recovery');
  let result=await send({type:'GET_STATE'});assert.equal(result.ok,true);assert.equal(result.state.paused,true);assert.equal(result.state.workerTabId,null);assert.equal(storage.state.entries.length,1);
  assert.equal((await send({type:'EXPORT',kind:'private'})).ok,true);assert.equal((await send({type:'START_QUEUE'})).ok,false);
  result=await send({type:'REMOVE_ENTRIES',handles:['legacy']});assert.equal(result.ok,true);assert.equal(result.state.entries.length,0);assert.equal(session.gabRecovery,false);assert.equal(result.state.paused,true);
});

test('production API queue performs GraphQL preflight, one numeric POST and independent GraphQL readback without tabs',async()=>{
  reset({entries:[entry()]});assert.equal((await send({type:'BIND_ACCOUNT'})).ok,true);
  fetchHook=async call=>{if(call.method==='POST'){assert.equal(storage.state.apiBudget.writes.length,1);assert.ok(storage.state.queue[0].writeAttemptAt);}return undefined;};
  await runQueue();assert.equal(storage.state.queue[0].status,'done');assert.equal(storage.state.queue[0].accountId,ACCOUNT);assert.equal(posts().length,1);
  assert.deepEqual(apiPaths(),['Viewer','UserByRestId','blocks/create.json','UserByRestId']);
  assert.deepEqual(requests.map(call=>new URL(call.url).origin),Array(4).fill('https://x.com'));
  assert.deepEqual(requests.map(call=>call.method),['GET','GET','POST','GET']);
  assert.deepEqual(graphVariables(requests[0]),{withCommunitiesMemberships:false});
  assert.deepEqual([graphVariables(requests[1]).userId,graphVariables(requests[3]).userId],[TARGET,TARGET]);assert.deepEqual(tabCalls,[]);
  assert.ok(storage.state.nativeBlocked[`id:${ACCOUNT}`][`id:${TARGET}`]);assert.equal(JSON.stringify(storage).includes(CSRF),false);
});

test('missing numeric IDs become needs_id without any network request',async()=>{
  reset({bound:true,entries:[entry('unknown',null)]});await runQueue();assert.equal(storage.state.queue[0].status,'needs_id');assert.equal(requests.length,0);assert.deepEqual(tabCalls,[]);await alarmListener({name:'gab-watchdog'});assert.equal(requests.length,0);
});

test('known blocks require no POST and history follows execution ID rather than account handle',async()=>{
  reset({bound:true,entries:[entry()]});blocked.add(`${ACCOUNT}:${TARGET}`);await runQueue();assert.equal(posts().length,0);assert.equal(storage.state.queue[0].status,'done');
  storage.state.settings.accountHandle='renamed_owner';await send({type:'QUEUE_APPROVED'});assert.equal(storage.state.queue.length,1);
  cookieAccount=OTHER_ACCOUNT;clock+=60000;assert.equal((await send({type:'BIND_ACCOUNT'})).ok,true);await runQueue();assert.equal(posts().length,1);assert.ok(storage.state.nativeBlocked[`id:${ACCOUNT}`][`id:${TARGET}`]);assert.ok(storage.state.nativeBlocked[`id:${OTHER_ACCOUNT}`][`id:${TARGET}`]);
});

test('429 cooldown survives restart and START RETRY BIND or automatic mode cannot bypass it',async()=>{
  reset({bound:true,entries:[entry()]});let limited=true;fetchHook=async()=>limited?json({errors:[{code:88}]},429,{'retry-after':'60','x-rate-limit-reset':String((clock+120000)/1000)}):undefined;
  await runQueue();assert.equal(storage.state.queue[0].status,'pending');const deadline=storage.state.apiCooldown.until;assert.equal(deadline,clock+120000);const count=requests.length;
  await reloadWorker();assert.equal(storage.state.apiCooldown.until,deadline);await alarmListener({name:'gab-watchdog'});assert.equal(requests.length,count);
  for(const message of [{type:'START_QUEUE'},{type:'RETRY_FAILED'},{type:'BIND_ACCOUNT'},{type:'SAVE_SETTINGS',settings:{autoBlock:true}}])assert.equal((await send(message)).ok,false);
  assert.equal(requests.length,count);limited=false;clock=deadline+1;await alarmListener({name:'gab-watchdog'});assert.equal(storage.state.queue[0].status,'done');assert.equal(posts().length,1);
});

test('401 requires a new server-verified binding before retrying',async()=>{
  reset({bound:true,entries:[entry()]});fetchHook=async()=>json({errors:[{code:89}]},401);await runQueue();assert.equal(storage.state.queue[0].status,'failed');assert.equal(storage.state.settings.sessionInvalid,true);assert.equal(storage.state.paused,true);assert.equal(posts().length,0);
  clock+=61000;assert.equal((await send({type:'START_QUEUE'})).ok,false);assert.equal((await send({type:'RETRY_FAILED'})).ok,false);fetchHook=null;assert.equal((await send({type:'BIND_ACCOUNT'})).ok,true);assert.equal((await send({type:'RETRY_FAILED'})).ok,true);await runQueue();assert.equal(storage.state.queue[0].status,'done');assert.equal(posts().length,1);
});

test('lost POST response remains uncertain and retry reads the relationship without repeating the write',async()=>{
  reset({bound:true,entries:[entry()]});fetchHook=async call=>{if(call.method==='POST'){blocked.add(`${ACCOUNT}:${TARGET}`);throw new Error('Fixture reply lost after server write');}return undefined;};
  await runQueue();assert.equal(storage.state.queue[0].status,'uncertain');assert.equal(posts().length,1);assert.equal(storage.state.apiBudget.writes.length,1);assert.deepEqual(storage.state.nativeBlocked,{});await alarmListener({name:'gab-watchdog'});assert.equal(posts().length,1);
  clock+=61000;fetchHook=null;assert.equal((await send({type:'RETRY_FAILED'})).ok,true);await runQueue();assert.equal(storage.state.queue[0].status,'done');assert.equal(posts().length,1);assert.equal(requests.at(-1).method,'GET');
});

test('post-write 429 and false readbacks are uncertain rather than confirmed success or retryable writes',async()=>{
  for(const mode of ['rate','false']){reset({bound:true,entries:[entry()]});let wrote=false;fetchHook=async call=>{if(call.method==='POST'){wrote=true;return undefined;}if(wrote)return mode==='rate'?json({errors:[{code:88}]},429,{'retry-after':'90'}):json(graphUser(TARGET,'target',false));return undefined;};
    await runQueue();assert.equal(storage.state.queue[0].status,'uncertain');assert.equal(storage.state.paused,true);assert.equal(posts().length,1);assert.deepEqual(storage.state.nativeBlocked,{});if(mode==='rate')assert.equal(storage.state.apiCooldown.until,clock+90000);
  }
});

test('pause allowlist and revoked approval during write preflight each cancel the POST',async()=>{
  for(const message of [{type:'PAUSE_QUEUE'},{type:'ALLOW',handle:'target',enabled:true},{type:'REVIEW',handles:['target'],status:'pending'}]){
    reset({bound:true,entries:[entry()]});let guarded=false;cookieHook=async(_args,count)=>{if(count===9){guarded=true;assert.equal((await send(message)).ok,true);}};
    await runQueue();assert.equal(guarded,true);assert.equal(posts().length,0);assert.equal(storage.state.apiBudget.writes.length,0);assert.equal(storage.state.paused,true);assert.equal(storage.state.queue[0].status,'failed');
  }
});

test('in-flight ID edits are rejected without changing the numeric POST identity',async()=>{
  reset({bound:true,entries:[entry()]});let edit;cookieHook=async(_args,count)=>{if(count===9)edit=await send({type:'EDIT_ENTRY',handle:'target',id:'123',reason:'Changed',evidence:[]});};
  await runQueue();assert.equal(edit.ok,false);assert.equal(storage.state.entries[0].id,TARGET);assert.equal(posts()[0].body,`user_id=${TARGET}`);assert.equal(storage.state.queue[0].status,'done');
});

test('pause or eligibility revocation during the final session read still prevents dispatch',async()=>{
  for(const message of [{type:'PAUSE_QUEUE'},{type:'ALLOW',handle:'target',enabled:true},{type:'REVIEW',handles:['target'],status:'pending'}]){
    reset({bound:true,entries:[entry()]});let interrupted=false;
    cookieHook=async(_args,count)=>{if(count===13){interrupted=true;assert.equal(storage.state.apiBudget.writes.length,1);assert.equal((await send(message)).ok,true);}};
    await runQueue();assert.equal(interrupted,true);assert.equal(posts().length,0);assert.equal(storage.state.queue[0].status,'failed');assert.equal(storage.state.paused,true);
    assert.equal(storage.state.apiBudget.writes.length,1,'A reserved attempt remains counted conservatively after cancellation');
  }
});

test('unavailable or suspended target errors skip only that target with no write',async()=>{
  for(const [code,status] of [[50,404],[63,403]]){reset({bound:true,entries:[entry()]});fetchHook=async()=>json({errors:[{code}]},status);await runQueue();assert.equal(storage.state.queue[0].status,'skipped');assert.equal(posts().length,0);assert.equal(storage.state.settings.sessionInvalid,false);}
});

test('closed popup connection outcomes remain readable after response delivery is lost',async()=>{
  reset();let release;fetchHook=async call=>new URL(call.url).pathname===VIEWER_PATH?new Promise(resolve=>{release=resolve;}):undefined;const sender={id:extensionId,url:'chrome-extension://fixture/popup.html'};
  assert.equal(listener({type:'BIND_ACCOUNT'},sender,()=>{throw new Error('Fixture popup closed');}),true);await until(()=>release);assert.equal(storage.state.lastConnection.status,'connecting');release(json(graphViewer(ACCOUNT,'owner')));await until(()=>storage.state.lastConnection.status==='connected');assert.equal((await send({type:'GET_STATE'})).state.settings.accountId,ACCOUNT);
  release=null;listener({type:'BIND_ACCOUNT'},sender,()=>{});await until(()=>release);release(json({errors:[{code:89}]},401));await until(()=>storage.state.lastConnection.status==='failed');const state=(await send({type:'GET_STATE'})).state;assert.equal(state.settings.accountId,ACCOUNT);assert.equal(state.settings.sessionInvalid,true);assert.ok(state.lastConnection.error);
});

test('failed binding exposes safe HTTP route diagnostics and durably stops the queue',async()=>{
  reset({bound:true,entries:[entry()]});
  assert.equal((await send({type:'QUEUE_APPROVED'})).ok,true);
  storage.state.settings.autoBlock=true;storage.state.paused=false;
  const untrustedDetail='fixture-private-server-detail';
  fetchHook=async call=>new URL(call.url).pathname===VIEWER_PATH
    ?json({errors:[{message:untrustedDetail}]},404):undefined;

  // Exercise the real adapter's XApiError path; this HTTP failure has no API code.
  const result=await send({type:'BIND_ACCOUNT'});
  assert.equal(result.ok,false);assert.match(result.error,/HTTP 404/);assert.match(result.error,/Viewer/);
  for(const secret of [untrustedDetail,CSRF,'variables=','TpQxQtWMTMnIAMPlMGMqNw'])assert.equal(result.error.includes(secret),false);
  let state=(await send({type:'GET_STATE'})).state;
  assert.equal(state.lastConnection.status,'failed');assert.equal(state.lastConnection.error,result.error);
  assert.equal(state.pauseReason,result.error);assert.equal(state.settings.autoBlock,false);
  assert.equal(state.settings.sessionInvalid,true);assert.equal(state.paused,true);
  assert.equal(state.queue[0].status,'pending');assert.equal(posts().length,0);
  assert.deepEqual(apiPaths(),['Viewer']);

  const requestCount=requests.length;
  await reloadWorker();await alarmListener({name:'gab-watchdog'});
  state=(await send({type:'GET_STATE'})).state;
  assert.equal(state.lastConnection.status,'failed');assert.equal(state.lastConnection.error,result.error);
  assert.equal(state.settings.autoBlock,false);assert.equal(state.settings.sessionInvalid,true);assert.equal(state.paused,true);
  assert.equal(state.queue[0].status,'pending');assert.equal(requests.length,requestCount);assert.equal(posts().length,0);
});

test('Viewer rejection retains HTTP and X error codes without exposing response text',async()=>{
  reset();
  fetchHook=async()=>json({errors:[{code:34,message:'fixture-untrusted-server-message'}]},404);
  const result=await send({type:'BIND_ACCOUNT'});
  assert.equal(result.ok,false);assert.match(result.error,/HTTP 404/);assert.match(result.error,/X 34/);assert.match(result.error,/Viewer/);
  assert.equal(result.error.includes('fixture-untrusted-server-message'),false);
  assert.equal(storage.state.lastConnection.status,'failed');assert.equal(storage.state.lastConnection.error,result.error);
  assert.equal(storage.state.settings.autoBlock,false);assert.equal(storage.state.paused,true);assert.equal(posts().length,0);
  assert.deepEqual(apiPaths(),['Viewer']);
  assert.equal(new URL(requests[0].url).origin,'https://x.com');
  assert.deepEqual(graphVariables(requests[0]),{withCommunitiesMemberships:false});
});

test('binding requires the current server Viewer identity and never falls back to a target lookup',async()=>{
  for(const response of [graphViewer(OTHER_ACCOUNT,'other_owner'),graphUser(ACCOUNT,'owner')]){
    reset({bound:true,entries:[entry()]});
    assert.equal((await send({type:'QUEUE_APPROVED'})).ok,true);
    storage.state.settings.autoBlock=true;storage.state.paused=false;
    fetchHook=async()=>json(response);
    const result=await send({type:'BIND_ACCOUNT'});
    assert.equal(result.ok,false);assert.equal(storage.state.lastConnection.status,'failed');
    assert.equal(storage.state.settings.accountId,ACCOUNT);assert.equal(storage.state.settings.sessionInvalid,true);
    assert.equal(storage.state.settings.autoBlock,false);assert.equal(storage.state.paused,true);
    await alarmListener({name:'gab-watchdog'});
    assert.deepEqual(apiPaths(),['Viewer']);assert.equal(posts().length,0);assert.equal(storage.state.queue[0].status,'pending');
  }
});

test('a stale account verification cannot overwrite the latest connection outcome',async()=>{
  reset();let release,viewerCalls=0;fetchHook=async call=>{if(new URL(call.url).pathname===VIEWER_PATH&&++viewerCalls===1)return new Promise(resolve=>{release=resolve;});return undefined;};
  const first=send({type:'BIND_ACCOUNT'});await until(()=>release);const firstId=storage.state.lastConnection.requestId;assert.equal((await send({type:'BIND_ACCOUNT'})).ok,true);const latestId=storage.state.lastConnection.requestId;assert.notEqual(firstId,latestId);release(json(graphViewer(ACCOUNT,'owner')));assert.equal((await first).ok,false);assert.equal(storage.state.lastConnection.status,'connected');assert.equal(storage.state.lastConnection.requestId,latestId);
});

test('legacy handle-only bindings cannot automatically execute after migration',async()=>{
  reset({entries:[entry()]});delete storage.state.executorVersion;storage.state.version=1;Object.assign(storage.state.settings,{accountHandle:'owner',autoBlock:true});delete storage.state.settings.accountId;storage.state.paused=false;storage.state.queue=[{id:'legacy',handle:'target',accountHandle:'owner',userId:TARGET,status:'pending'}];await reloadWorker();
  const state=(await send({type:'GET_STATE'})).state;assert.equal(state.settings.accountId,'');assert.equal(state.settings.sessionInvalid,true);assert.equal(state.settings.autoBlock,false);assert.equal(state.paused,true);assert.equal(state.queue[0].status,'skipped');assert.equal((await send({type:'START_QUEUE'})).ok,false);await alarmListener({name:'gab-watchdog'});assert.equal(requests.length,0);
});

test('same-session migration immediately preserves a running legacy write as uncertain',async()=>{
  reset({bound:true,entries:[entry()]});assert.ok(session.gabSession);delete storage.state.executorVersion;storage.state.version=1;storage.state.paused=false;storage.state.runId='legacy-run';storage.state.workerTabId=77;
  storage.state.queue=[{id:'legacy-running',handle:'target',accountHandle:'owner',userId:TARGET,status:'running',updatedAt:new Date().toISOString()}];
  await reloadWorker();const state=(await send({type:'GET_STATE'})).state;
  assert.equal(state.queue[0].status,'uncertain');assert.equal(state.queue[0].userId,TARGET);assert.equal(state.runId,null);assert.equal(state.workerTabId,null);assert.equal(state.paused,true);assert.equal(state.settings.accountId,'');assert.equal(state.settings.sessionInvalid,true);assert.equal(requests.length,0);
  assert.equal((await send({type:'BIND_ACCOUNT'})).ok,true,'An immediately retired legacy operation must not falsely keep the new connection busy');assert.equal(storage.state.queue[0].status,'uncertain');assert.equal(posts().length,0);
});

test('account or missing-session cookie changes invalidate execution without network access',async()=>{
  reset({bound:true});storage.state.settings.autoBlock=true;storage.state.paused=false;cookieAccount=OTHER_ACCOUNT;cookieListener({cookie:{name:'twid',domain:'.x.com'}});await until(()=>storage.state.settings.sessionInvalid);assert.equal(storage.state.paused,true);assert.equal(storage.state.settings.autoBlock,false);assert.equal(requests.length,0);
  reset({bound:true});cookieCSRF=null;cookieListener({cookie:{name:'ct0',domain:'x.com'}});await until(()=>storage.state.settings.sessionInvalid);assert.equal(requests.length,0);
  reset({bound:true});cookieAccount=OTHER_ACCOUNT;cookieListener({cookie:{name:'twid',domain:'example.com'}});await new Promise(resolve=>setImmediate(resolve));assert.equal(storage.state.settings.sessionInvalid,false);
});

test('write budgets persist across reconnect restart and account switching',async()=>{
  reset({bound:true,entries:[entry()]});await runQueue();const firstWrite=storage.state.apiBudget.writes[0];await reloadWorker();assert.equal(storage.state.apiBudget.writes[0],firstWrite);assert.equal((await send({type:'BIND_ACCOUNT'})).ok,true);assert.deepEqual(storage.state.apiBudget.writes,[firstWrite]);cookieAccount=OTHER_ACCOUNT;assert.equal((await send({type:'BIND_ACCOUNT'})).ok,true);assert.deepEqual(storage.state.apiBudget.writes,[]);cookieAccount=ACCOUNT;assert.equal((await send({type:'BIND_ACCOUNT'})).ok,true);assert.deepEqual(storage.state.apiBudget.writes,[firstWrite]);
});

test('local write cap and batch pause remain durable and prevent unbounded writes',async()=>{
  reset({bound:true,entries:[entry()]});storage.state.apiBudget={accountId:ACCOUNT,writes:Array.from({length:30},(_,i)=>clock-1000+i)};await runQueue();assert.equal(requests.length,0);assert.equal(storage.state.apiCooldown.kind,'budget');const deadline=storage.state.apiCooldown.until;await reloadWorker();assert.equal(storage.state.apiCooldown.until,deadline);assert.equal((await send({type:'BIND_ACCOUNT'})).ok,false);assert.equal((await send({type:'START_QUEUE'})).ok,false);
  reset({bound:true,entries:[entry()]});storage.state.apiBudget={accountId:ACCOUNT,writes:Array.from({length:9},(_,i)=>clock-1000+i)};await runQueue();assert.equal(storage.state.queue[0].status,'done');assert.equal(storage.state.apiBudget.writes.length,10);assert.equal(storage.state.apiCooldown.kind,'budget');assert.equal(storage.state.apiCooldown.until,clock+120000);
});

test('a replaced source identity cannot redirect an uncertain write readback to the new account',async()=>{
  for(const outcome of ['blocked','not-blocked','error']){
    reset({bound:true,entries:[{...entry('target','111'),source:'sub'}]});
    storage.state.subscriptions=[{id:'sub',enabled:true,name:'Fixture',url:'https://raw.githubusercontent.com/o/r/main/list.json'}];
    storage.state.queue=[{id:'old-write',handle:'target',userId:'111',accountId:ACCOUNT,accountHandle:'owner',status:'uncertain',error:'A prior response was lost',updatedAt:new Date().toISOString()}];
    if(outcome==='blocked')blocked.add(`${ACCOUNT}:111`);
    fetchHook=async call=>{
      if(call.url.startsWith('https://raw.githubusercontent.com/'))return json({schema:'guga-blocklist/v1',entries:[{handle:'target',id:'222'}]});
      if(outcome==='error')return json({},503);
      return undefined;
    };
    assert.equal((await send({type:'SYNC'})).ok,true);assert.equal(storage.state.entries[0].id,'222');assert.equal(storage.state.queue[0].userId,'111');assert.equal(storage.state.queue[0].status,'uncertain');
    assert.equal((await send({type:'RETRY_FAILED'})).ok,true);assert.equal(storage.state.queue[0].reconcileOnly,true);
    assert.equal((await send({type:'START_QUEUE'})).ok,true);
    const expected=outcome==='blocked'?'done':outcome==='not-blocked'?'skipped':'uncertain';
    await until(()=>storage.state.queue.find(job=>job.id==='old-write')?.status===expected);
    const original=storage.state.queue.find(job=>job.id==='old-write');assert.equal(original.userId,'111');assert.equal(original.accountId,ACCOUNT);
    const apiRequests=requests.filter(call=>call.url.startsWith('https://x.com/'));assert.equal(apiRequests.length,1);assert.equal(graphVariables(apiRequests[0]).userId,'111');assert.equal(apiRequests[0].method,'GET');assert.equal(posts().length,0);
    assert.ok(storage.state.queue.some(job=>job.userId==='222'&&job.status==='pending'));
    if(outcome==='blocked')assert.ok(storage.state.nativeBlocked[`id:${ACCOUNT}`]['id:111']);else assert.deepEqual(storage.state.nativeBlocked,{});
    if(outcome==='error'){assert.equal(original.reconcileOnly,true);assert.equal(storage.state.paused,true);}
  }
});

test('switching execution accounts leaves another account readback pending without pausing the new queue',async()=>{
  reset({bound:true,entries:[entry('target','222')]});
  storage.state.queue=[{id:'account-a-readback',handle:'target',userId:'111',accountId:ACCOUNT,accountHandle:'owner',status:'uncertain',error:'Prior response lost',updatedAt:new Date().toISOString()}];
  assert.equal((await send({type:'RETRY_FAILED'})).ok,true);assert.equal(storage.state.queue[0].status,'pending');assert.equal(storage.state.queue[0].reconcileOnly,true);
  cookieAccount=OTHER_ACCOUNT;assert.equal((await send({type:'BIND_ACCOUNT'})).ok,true);requests=[];
  await runQueue();const original=storage.state.queue.find(job=>job.id==='account-a-readback'),current=storage.state.queue.find(job=>job.accountId===OTHER_ACCOUNT);
  assert.equal(original.status,'pending');assert.equal(original.reconcileOnly,true);assert.equal(original.accountId,ACCOUNT);assert.equal(original.userId,'111');assert.equal(current.userId,'222');assert.equal(current.status,'done');assert.equal(storage.state.paused,false);
  assert.equal(posts().length,1);assert.equal(posts()[0].body,'user_id=222');assert.deepEqual(requests.filter(call=>call.method==='GET').map(call=>graphVariables(call).userId),['222','222']);assert.ok(storage.state.nativeBlocked[`id:${OTHER_ACCOUNT}`]['id:222']);assert.equal(storage.state.nativeBlocked[`id:${ACCOUNT}`],undefined);
});

test('missing cookie API keeps management available and rejects connection without sending requests',async()=>{
  reset();const cookieAPI=chrome.cookies;
  try {
    delete chrome.cookies;await reloadWorker();
    assert.equal((await send({type:'GET_STATE'})).ok,true);
    const connected=await send({type:'BIND_ACCOUNT'});assert.equal(connected.ok,false);assert.equal(storage.state.lastConnection.status,'failed');
    assert.equal(storage.state.settings.sessionInvalid,true);assert.equal(requests.length,0);
  } finally {chrome.cookies=cookieAPI;await reloadWorker();}
});

test('import immediately enables local hiding without requiring a connected account or review',async()=>{
  reset();alarms.delete('gab-queue');
  const result=await send({type:'IMPORT',text:'@target\n@another'});
  assert.equal(result.ok,true);assert.ok(result.state.entries.every(e=>e.status==='approved'));
  assert.deepEqual(effectiveEntries(result.state).map(e=>e.handle),['target','another']);assert.equal(result.state.queue.length,0);
  assert.equal(result.state.settings.autoBlock,false);assert.equal(result.state.paused,true);assert.equal(alarms.has('gab-queue'),false);assert.equal(requests.length,0);
});

test('import in running automatic mode durably queues enabled numeric targets and schedules normal execution',async()=>{
  reset({bound:true});storage.state.settings.autoBlock=true;storage.state.paused=false;alarms.delete('gab-queue');
  const result=await send({type:'IMPORT',text:JSON.stringify([{handle:'target',id:TARGET}])});
  assert.equal(result.ok,true);assert.equal(result.state.entries[0].status,'approved');assert.equal(result.state.queue[0].status,'pending');assert.equal(result.state.queue[0].userId,TARGET);assert.equal(result.state.queue[0].accountId,ACCOUNT);
  assert.equal(result.state.settings.autoBlock,true);assert.equal(result.state.paused,false);assert.ok(alarms.has('gab-queue'));assert.equal(requests.length,0,'Import schedules after storage commit and does not directly issue a request');
  await alarmListener({name:'gab-queue'});assert.equal(storage.state.queue[0].status,'done');assert.equal(posts().length,1);assert.equal(posts()[0].body,`user_id=${TARGET}`);
});

test('import preserves disabled or paused global execution while still preparing the connected queue',async()=>{
  for(const autoBlock of [false,true]){
    reset({bound:true});storage.state.settings.autoBlock=autoBlock;storage.state.paused=true;storage.state.pauseReason='Keep this pause';alarms.delete('gab-queue');
    const result=await send({type:'IMPORT',text:JSON.stringify([{handle:'target',id:TARGET}])});
    assert.equal(result.ok,true);assert.equal(result.state.queue[0].status,'pending');assert.equal(result.state.settings.autoBlock,autoBlock);assert.equal(result.state.paused,true);assert.equal(result.state.pauseReason,'Keep this pause');
    assert.equal(alarms.has('gab-queue'),autoBlock);await alarmListener({name:'gab-watchdog'});assert.equal(requests.length,0);assert.equal(storage.state.queue[0].status,'pending');
  }
});

test('import does not clear cooldowns or use an invalid authenticated session',async()=>{
  reset({bound:true});storage.state.settings.autoBlock=true;storage.state.paused=false;storage.state.apiCooldown={kind:'rate_limit',until:clock+120000};const cooldown=structuredClone(storage.state.apiCooldown);
  assert.equal((await send({type:'IMPORT',text:JSON.stringify([{handle:'target',id:TARGET}])})).ok,true);
  assert.deepEqual(storage.state.apiCooldown,cooldown);await alarmListener({name:'gab-queue'});assert.deepEqual(storage.state.apiCooldown,cooldown);assert.equal(requests.length,0);assert.equal(storage.state.queue[0].status,'pending');
  reset({bound:true});storage.state.settings.sessionInvalid=true;storage.state.settings.autoBlock=true;storage.state.paused=false;storage.state.pauseReason='Reconnect required';alarms.delete('gab-queue');
  const result=await send({type:'IMPORT',text:JSON.stringify([{handle:'target',id:TARGET}])});
  assert.equal(result.ok,true);assert.equal(result.state.entries[0].status,'approved');assert.equal(result.state.queue.length,0);assert.equal(result.state.settings.sessionInvalid,true);assert.equal(result.state.settings.autoBlock,true);assert.equal(result.state.paused,false);assert.equal(result.state.pauseReason,'Reconnect required');
  assert.equal(alarms.has('gab-queue'),false);await alarmListener({name:'gab-watchdog'});assert.equal(requests.length,0);
});

test('imported handle-only entries wait for IDs and never issue a username-based write',async()=>{
  reset({bound:true});storage.state.settings.autoBlock=true;storage.state.paused=false;
  const result=await send({type:'IMPORT',text:'@target'});
  assert.equal(result.ok,true);assert.equal(result.state.entries[0].status,'approved');assert.equal(result.state.queue[0].status,'needs_id');assert.equal(result.state.queue[0].userId,undefined);
  await alarmListener({name:'gab-queue'});await alarmListener({name:'gab-watchdog'});assert.equal(requests.length,0);assert.equal(posts().length,0);
});

test('import cannot bypass handle exceptions retained numeric exceptions or self exclusion',async()=>{
  reset({bound:true,entries:[{...entry('except','333'),status:'pending'}]});storage.state.allowlist=['except','protected'];
  const result=await send({type:'IMPORT',text:JSON.stringify([
    {handle:'renamed_except',id:'333'},{handle:'protected',id:'444'},{handle:'owner',id:'555'},
    {handle:'self_alias',id:ACCOUNT},{handle:'target',id:TARGET}
  ])});
  assert.equal(result.ok,true);assert.ok(result.state.entries.every(e=>e.status==='approved'));assert.deepEqual(result.state.allowlist,['except','protected']);assert.deepEqual(result.state.allowlistPins.except,['333']);
  assert.deepEqual(result.state.queue.map(job=>[job.handle,job.userId]),[['target',TARGET]]);assert.equal(requests.length,0);assert.deepEqual(result.state.nativeBlocked,{});
});

test('explicit reimport enables disabled rows preserves metadata and remains atomic on identity conflict',async()=>{
  reset({bound:true,entries:[{...entry('target',null),status:'pending',reason:'Keep reason',evidence:['https://example.com/proof'],addedAt:'2026-01-01T00:00:00Z'}]});
  let result=await send({type:'IMPORT',text:JSON.stringify([{handle:'target',id:TARGET,reason:'Overwrite',status:'pending'}])});
  assert.equal(result.ok,true);assert.equal(result.updated,1);assert.equal(result.state.entries[0].status,'approved');assert.equal(result.state.entries[0].id,TARGET);assert.equal(result.state.entries[0].reason,'Keep reason');assert.deepEqual(result.state.entries[0].evidence,['https://example.com/proof']);assert.equal(result.state.entries[0].addedAt,'2026-01-01T00:00:00Z');assert.equal(result.state.queue[0].status,'pending');
  await send({type:'REVIEW',handles:['target'],status:'pending'});assert.equal(storage.state.queue[0].status,'skipped');
  result=await send({type:'IMPORT',text:'@target'});assert.equal(result.ok,true);assert.equal(result.updated,1);assert.equal(result.state.entries[0].status,'approved');assert.equal(result.state.entries[0].id,TARGET);assert.equal(result.state.queue.at(-1).status,'pending');assert.equal(result.state.paused,true);assert.equal(result.state.settings.autoBlock,false);
  storage.state.entries.push({...entry('disabled','111'),status:'pending'});storage.state.settings.autoBlock=true;alarms.delete('gab-queue');const before=structuredClone(storage.state);
  result=await send({type:'IMPORT',text:JSON.stringify([{handle:'disabled',id:'111'},{handle:'target',id:'222'}])});assert.equal(result.ok,false);assert.deepEqual(storage.state,before);assert.equal(alarms.has('gab-queue'),false);assert.equal(requests.length,0);
});

test('captured-list import enables and queues targets through the same guarded automatic path',async()=>{
  reset({bound:true});storage.state.settings.autoBlock=true;storage.state.paused=false;storage.state.capture.entries=[{handle:'target',id:TARGET}];alarms.delete('gab-queue');
  const result=await send({type:'IMPORT_CAPTURE'});
  assert.equal(result.ok,true);assert.equal(result.imported,1);assert.equal(result.state.entries[0].status,'approved');assert.equal(result.state.entries[0].source,'local');assert.equal(result.state.queue[0].status,'pending');assert.ok(alarms.has('gab-queue'));assert.equal(requests.length,0);
  await alarmListener({name:'gab-queue'});assert.equal(storage.state.queue[0].status,'done');assert.equal(posts().length,1);
});

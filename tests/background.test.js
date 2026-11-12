import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../extension/lib/core.js';
import {STATE_BUDGET,stateBytes} from '../extension/lib/storage-budget.js';

let storage={state:initialState()}, session={}, listener, alarmListener, startupListener, alarms=new Map();
storage.state.workerTabId=99;storage.state.runId='old-run';storage.state.paused=false;
storage.state.queue=[{id:'interrupted',handle:'target',accountHandle:'owner',status:'running',updatedAt:new Date().toISOString()}];
const extensionId='fixture';
globalThis.chrome={
  runtime:{id:extensionId,getURL:path=>`chrome-extension://${extensionId}/${path}`,onMessage:{addListener:fn=>listener=fn},onInstalled:{addListener(){}},onStartup:{addListener:fn=>startupListener=fn}},
  storage:{local:{get:async()=>structuredClone(storage),set:async value=>{storage=structuredClone(value);}},session:{get:async()=>structuredClone(session),set:async value=>{session={...session,...value};}}},
  alarms:{get:async name=>alarms.get(name),create:async(name,value)=>alarms.set(name,value),onAlarm:{addListener:fn=>alarmListener=fn}},
  permissions:{contains:async()=>true},
  tabs:{onRemoved:{addListener(){}},query:async()=>[{id:1,url:'https://x.com/home',active:true,windowId:1}],get:async id=>({id,url:'https://x.com/home',active:true,windowId:1}),sendMessage:async()=>({ok:true,accountHandle:'owner'}),create:async()=>{throw new Error('Unexpected browser operation in unit test');}},
  scripting:{executeScript:async()=>{throw new Error('Unexpected injection in unit test');},insertCSS:async()=>{throw new Error('Unexpected CSS injection in unit test');}}
};
await import('../extension/background.js');
const send=(message,sender={id:extensionId,url:'chrome-extension://fixture/options.html',tab:{id:8}})=>new Promise(resolve=>listener(message,sender,resolve));

test('new browser session discards stale tab ownership and pauses interrupted writes',async()=>{
  const result=await send({type:'GET_STATE'});
  assert.equal(result.state.workerTabId,null);assert.equal(result.state.runId,null);assert.equal(result.state.queue[0].status,'uncertain');assert.equal(result.state.paused,true);
  assert.ok(session.gabSession);assert.ok(alarms.has('gab-watchdog'));assert.ok(alarms.has('gab-sync'));
  storage={state:initialState()};
});

test('background enforces message authority and binds identity',async()=>{
  let result=await send({type:'BIND_ACCOUNT'});assert.equal(result.ok,true);assert.equal(result.state.settings.accountHandle,'owner');
  result=await send({type:'IMPORT',text:'@example'},{id:extensionId,url:'https://x.com/home',tab:{id:1}});assert.equal(result.ok,false);assert.equal(storage.state.entries.length,0);
  result=await send({type:'GET_STATE'},{id:'other',url:'chrome-extension://fixture/options.html'});assert.equal(result.ok,false);
});
test('import, approval and private exports preserve read-only public boundary',async()=>{
  assert.equal((await send({type:'IMPORT',text:'@example\n@private'})).ok,true);
  await send({type:'REVIEW',handles:['example'],status:'approved'});
  const pub=await send({type:'EXPORT',kind:'public'});assert.equal(pub.ok,false);
  assert.equal((await send({type:'UPLOAD',entries:[{handle:'example'}]})).ok,false);
  const priv=await send({type:'EXPORT',kind:'private'});assert.equal(priv.ok,true);assert.equal(JSON.parse(priv.text).entries.length,2);assert.equal(priv.text.includes('nativeBlocked'),false);
});
test('automatic mode queues only approved entries and pause remains durable',async()=>{
  let result=await send({type:'SAVE_SETTINGS',settings:{autoBlock:true,intervalSeconds:1}});assert.equal(result.ok,true);assert.equal(result.state.settings.intervalSeconds,30);assert.deepEqual(result.state.queue.map(j=>j.handle),['example']);
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
  storage={state:initialState()};storage.state.settings.accountHandle='owner';
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

test('worker suspension keeps same-session tab ownership; restart replaces it',async()=>{
  storage={state:initialState()};storage.state.workerTabId=44;
  await import('../extension/background.js?same-session');
  assert.equal((await send({type:'GET_STATE'})).state.workerTabId,44);
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

async function exerciseOperation(mode) {
  storage={state:initialState()};storage.state.settings.accountHandle='owner';
  storage.state.entries=[{handle:'target',source:'local',status:'approved',reason:'',evidence:[]}];
  const original={...chrome.tabs}, calls=[];let tab;
  chrome.tabs.create=async args=>(tab={id:101,url:args.url,status:'complete'});
  chrome.tabs.update=async(id,args)=>(tab={...tab,...args});chrome.tabs.get=async()=>tab;
  chrome.tabs.reload=async()=>{calls.push('reload');};
  chrome.tabs.sendMessage=async(id,message)=>{
    calls.push(message.type);
    if(message.type==='GAB_PROBE'){
      if(mode==='paused')storage.state.paused=true;
      return {ok:true,id:'777'};
    }
    if(message.type==='GAB_BLOCK'){
      assert.equal(storage.state.queue[0].userId,'777','ID must be durable before the first click');
      assert.equal(storage.state.entries[0].id,'777');
      if(mode==='lost-reply')throw new Error('Fixture lost reply after native click');
      return {ok:true,id:'777',alreadyBlocked:false};
    }
    if(message.type==='GAB_VERIFY')return {ok:false,error:'Fixture result vanished after reload',uncertain:true};
    throw new Error('Unexpected fixture message');
  };
  try {
    assert.equal((await send({type:'START_QUEUE'})).ok,true);
    for(let i=0;i<200;i++){
      if(storage.state.queue[0]&&['failed','uncertain','done'].includes(storage.state.queue[0].status))break;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.equal(storage.state.queue[0].status,'uncertain');assert.equal(storage.state.paused,true);
    assert.deepEqual(storage.state.nativeBlocked,{});
    if(mode==='paused')assert.deepEqual(calls,['GAB_PROBE']);
    else {assert.equal(storage.state.queue[0].userId,'777');assert.equal(calls.filter(type=>type==='GAB_BLOCK').length,1);}
    if(mode==='reload-failed')assert.deepEqual(calls,['GAB_PROBE','GAB_BLOCK','reload','GAB_VERIFY']);
  }finally{Object.assign(chrome.tabs,original);}
}
test('first observed ID is durable even when the block reply is lost',async()=>exerciseOperation('lost-reply'));
test('pausing during target probe prevents any native block message',async()=>exerciseOperation('paused'));
test('an optimistic block response cannot mark done when reload verification fails',async()=>exerciseOperation('reload-failed'));

async function connectionFixture(run) {
  const originalTabs={...chrome.tabs},originalScripting={...chrome.scripting};
  storage={state:initialState()};storage.state.settings.accountHandle='previous';storage.state.settings.autoBlock=true;storage.state.paused=false;
  const tabs=new Map([
    [10,{id:10,url:'https://x.com/home',windowId:1,active:true,lastAccessed:1}],
    [11,{id:11,url:'https://x.com/target',windowId:1,active:false,lastAccessed:100}],
    [20,{id:20,url:'https://twitter.com/home',windowId:2,active:true,lastAccessed:999}]
  ]),calls=[],injections=[],css=[],queries=[];
  chrome.tabs.query=async query=>{queries.push(query);assert.equal(query.currentWindow,true);return [...tabs.values()].filter(tab=>tab.windowId===1);};
  chrome.tabs.get=async id=>{if(!tabs.has(id))throw new Error('No tab with that ID');return {...tabs.get(id)};};
  chrome.tabs.sendMessage=async(id,message,options)=>{calls.push({id,message,options});assert.deepEqual(options,{frameId:0});return {ok:true,accountHandle:`account_${id}`};};
  chrome.scripting.executeScript=async args=>{injections.push(args);return [{frameId:0}];};
  chrome.scripting.insertCSS=async args=>{css.push(args);};
  try{await run({tabs,calls,injections,css,queries});}
  finally{Object.assign(chrome.tabs,originalTabs);Object.assign(chrome.scripting,originalScripting);}
}
async function until(predicate) {
  for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}
  assert.ok(predicate(),'Fixture operation did not settle');
}

test('connection fixes the popup tab and default selection stays in the current window',async()=>connectionFixture(async({calls,queries,tabs})=>{
  let result=await send({type:'BIND_ACCOUNT',tabId:11});
  assert.equal(result.ok,true);assert.equal(result.state.settings.accountHandle,'account_11');assert.equal(queries.length,0);assert.equal(calls[0].id,11);
  result=await send({type:'BIND_ACCOUNT'});assert.equal(result.ok,true);assert.equal(calls.at(-1).id,10);assert.equal(result.state.lastConnection.tabId,10);
  tabs.delete(10);tabs.delete(11);const before=calls.length;
  result=await send({type:'BIND_ACCOUNT'});assert.equal(result.ok,false);assert.match(result.error,/this window/);assert.equal(calls.length,before);assert.equal(storage.state.settings.accountHandle,'account_10');
}));

test('invalid explicit connection tabs never fall back to another X account',async()=>connectionFixture(async({tabs,calls,queries,injections})=>{
  tabs.set(30,{id:30,url:'https://x.com/home',incognito:true});
  tabs.set(31,{id:31,url:'http://x.com/home'});tabs.set(32,{id:32,url:'https://x.com.evil.invalid/home'});
  tabs.set(33,{id:33,url:'https://example.com/'});tabs.set(34,{id:34,url:'https://x.com/home'});storage.state.workerTabId=34;
  for(const tabId of [-1,'10',null,404,30,31,32,33,34]) {
    const result=await send({type:'BIND_ACCOUNT',tabId});assert.equal(result.ok,false);assert.equal(storage.state.settings.accountHandle,'previous');assert.equal(storage.state.lastConnection.status,'failed');
  }
  assert.equal(calls.length,0);assert.equal(queries.length,0);assert.equal(injections.length,0);assert.equal(storage.state.paused,true);assert.equal(storage.state.settings.autoBlock,false);
}));

test('missing identity receiver is restored exactly once in the main isolated frame',async()=>connectionFixture(async({injections,css})=>{
  let attempts=0;
  chrome.tabs.sendMessage=async(id,message,options)=>{assert.equal(id,10);assert.deepEqual(options,{frameId:0});assert.equal(message.type,'GAB_IDENTITY');if(++attempts===1)throw new Error('Could not establish connection. Receiving end does not exist.');return {ok:true,accountHandle:'restored'};};
  const result=await send({type:'BIND_ACCOUNT',tabId:10});assert.equal(result.ok,true);assert.equal(attempts,2);
  assert.deepEqual(injections,[{target:{tabId:10,frameIds:[0]},world:'ISOLATED',files:['content.js']}]);
  assert.deepEqual(css,[{target:{tabId:10,frameIds:[0]},files:['content.css']}]);assert.equal(storage.state.lastConnection.status,'connected');
}));

test('identity ambiguity and lost-response errors neither inject nor select another tab',async()=>connectionFixture(async({injections,queries})=>{
  let attempts=0;
  chrome.tabs.sendMessage=async id=>{attempts++;assert.equal(id,10);return {ok:false,error:'Fixture account is ambiguous'};};
  let result=await send({type:'BIND_ACCOUNT',tabId:10});assert.equal(result.ok,false);assert.equal(storage.state.lastConnection.error,'Fixture account is ambiguous');
  chrome.tabs.sendMessage=async()=>{attempts++;throw new Error('The message port closed before a response was received.');};
  result=await send({type:'BIND_ACCOUNT',tabId:10});assert.equal(result.ok,false);assert.equal(attempts,2);assert.equal(injections.length,0);assert.equal(queries.length,0);assert.equal(storage.state.settings.accountHandle,'previous');
}));

test('identity recovery revalidates navigation and stops after one failed injection attempt',async()=>connectionFixture(async({tabs,injections,css})=>{
  chrome.tabs.sendMessage=async()=>{tabs.get(10).url='https://example.com/';throw new Error('Receiving end does not exist.');};
  let result=await send({type:'BIND_ACCOUNT',tabId:10});assert.equal(result.ok,false);assert.equal(injections.length,0);
  tabs.get(10).url='https://x.com/home';let attempts=0;
  chrome.tabs.sendMessage=async()=>{attempts++;throw new Error('Receiving end does not exist.');};
  result=await send({type:'BIND_ACCOUNT',tabId:10});assert.equal(result.ok,false);assert.equal(attempts,2);assert.equal(injections.length,1);assert.equal(css.length,1);assert.equal(storage.state.lastConnection.status,'failed');assert.equal(storage.state.settings.accountHandle,'previous');
}));

test('closing the popup does not cancel a persisted connection outcome',async()=>connectionFixture(async()=>{
  let resolveIdentity;
  chrome.tabs.sendMessage=async()=>new Promise(resolve=>{resolveIdentity=resolve;});
  const sender={id:extensionId,url:'chrome-extension://fixture/popup.html'};
  assert.equal(listener({type:'BIND_ACCOUNT',tabId:10},sender,()=>{throw new Error('Fixture popup is gone');}),true);
  await until(()=>resolveIdentity);assert.equal(storage.state.lastConnection.status,'connecting');assert.equal(storage.state.settings.accountHandle,'previous');assert.equal(storage.state.settings.autoBlock,false);assert.equal(storage.state.paused,true);
  resolveIdentity({ok:true,accountHandle:'completed'});await until(()=>storage.state.lastConnection.status==='connected');
  let reopened=await send({type:'GET_STATE'});assert.equal(reopened.state.settings.accountHandle,'completed');
  resolveIdentity=null;listener({type:'BIND_ACCOUNT',tabId:10},sender,()=>{});await until(()=>resolveIdentity);
  resolveIdentity({ok:false,error:'Fixture could not identify account'});await until(()=>storage.state.lastConnection.status==='failed');
  reopened=await send({type:'GET_STATE'});assert.equal(reopened.state.lastConnection.error,'Fixture could not identify account');assert.equal(reopened.state.settings.accountHandle,'completed');
}));

test('the latest connection request wins even if an older identity reply arrives last',async()=>connectionFixture(async()=>{
  let resolveFirst;
  chrome.tabs.sendMessage=async id=>id===10?new Promise(resolve=>{resolveFirst=resolve;}):{ok:true,accountHandle:'latest'};
  const first=send({type:'BIND_ACCOUNT',tabId:10});await until(()=>resolveFirst);const firstId=storage.state.lastConnection.requestId;
  const latest=await send({type:'BIND_ACCOUNT',tabId:20});assert.equal(latest.ok,true);const latestId=storage.state.lastConnection.requestId;assert.notEqual(firstId,latestId);
  resolveFirst({ok:true,accountHandle:'stale'});const stale=await first;assert.equal(stale.ok,false);assert.match(stale.error,/newer connection/);
  assert.equal(storage.state.settings.accountHandle,'latest');assert.equal(storage.state.lastConnection.requestId,latestId);assert.equal(storage.state.lastConnection.status,'connected');assert.equal(storage.state.logs.some(log=>log.handle==='stale'),false);
}));

test('connection refuses an in-flight block before changing state or reading another identity',async()=>connectionFixture(async({calls})=>{
  storage.state.queue=[{id:'active',handle:'target',status:'running',accountHandle:'previous'}];const before=structuredClone(storage.state);
  const result=await send({type:'BIND_ACCOUNT',tabId:10});assert.equal(result.ok,false);assert.deepEqual(storage.state,before);assert.equal(calls.length,0);
}));

test('blocked-list capture only selects a blocked settings tab in the current window',async()=>connectionFixture(async({tabs,calls})=>{
  tabs.get(20).url='https://x.com/settings/blocked/all';
  const result=await send({type:'CAPTURE'});assert.equal(result.ok,false);assert.match(result.error,/this window/);assert.equal(calls.length,0);
}));

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
  tabs:{onRemoved:{addListener(){}},query:async()=>[{id:1,url:'https://x.com/home',active:true}],sendMessage:async()=>({ok:true,accountHandle:'owner'}),create:async()=>{throw new Error('Unexpected browser operation in unit test');}}
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
    else {assert.equal(storage.state.queue[0].userId,'777');assert.ok(calls.includes('GAB_BLOCK'));}
    if(mode==='reload-failed')assert.deepEqual(calls,['GAB_PROBE','GAB_BLOCK','reload','GAB_VERIFY']);
  }finally{Object.assign(chrome.tabs,original);}
}
test('first observed ID is durable even when the block reply is lost',async()=>exerciseOperation('lost-reply'));
test('pausing during target probe prevents any native block message',async()=>exerciseOperation('paused'));
test('an optimistic block response cannot mark done when reload verification fails',async()=>exerciseOperation('reload-failed'));

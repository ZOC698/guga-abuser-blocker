import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../extension/lib/core.js';

let storage={state:initialState()}, listener, alarms=new Map();
const extensionId='fixture';
globalThis.chrome={
  runtime:{id:extensionId,getURL:path=>`chrome-extension://${extensionId}/${path}`,onMessage:{addListener:fn=>listener=fn},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
  storage:{local:{get:async()=>structuredClone(storage),set:async value=>{storage=structuredClone(value);}}},
  alarms:{get:async name=>alarms.get(name),create:async(name,value)=>alarms.set(name,value),onAlarm:{addListener(){}}},
  permissions:{contains:async()=>true},
  tabs:{onRemoved:{addListener(){}},query:async()=>[{id:1,url:'https://x.com/home',active:true}],sendMessage:async()=>({ok:true,accountHandle:'owner'}),create:async()=>{throw new Error('Unexpected browser operation in unit test');}}
};
await import('../extension/background.js');
const send=(message,sender={id:extensionId,url:'chrome-extension://fixture/options.html',tab:{id:8}})=>new Promise(resolve=>listener(message,sender,resolve));

test('background enforces message authority and binds identity',async()=>{
  let result=await send({type:'BIND_ACCOUNT'});assert.equal(result.ok,true);assert.equal(result.state.settings.accountHandle,'owner');
  result=await send({type:'IMPORT',text:'@example'},{id:extensionId,url:'https://x.com/home',tab:{id:1}});assert.equal(result.ok,false);assert.equal(storage.state.entries.length,0);
  result=await send({type:'GET_STATE'},{id:'other',url:'chrome-extension://fixture/options.html'});assert.equal(result.ok,false);
});
test('import, approval and public/private exports preserve privacy boundary',async()=>{
  assert.equal((await send({type:'IMPORT',text:'@example\n@private'})).ok,true);
  await send({type:'REVIEW',handles:['example'],status:'approved'});
  const pub=await send({type:'EXPORT',kind:'public'});assert.equal(pub.ok,true);assert.deepEqual(JSON.parse(pub.text).entries.map(e=>e.handle),['example']);
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

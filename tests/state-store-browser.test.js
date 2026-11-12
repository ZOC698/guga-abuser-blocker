import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {initialState} from '../extension/lib/core.js';

const require=createRequire(import.meta.url);let playwright;
try{playwright=require(process.env.PLAYWRIGHT_MODULE||'playwright');}catch{}
const project=path.resolve(import.meta.dirname,'..');
const owner='9876543210987654321',target='9876543210987654322';

// A copied unpacked extension and a new disposable profile only. A test-owned
// bootstrap statically imports a seed barrier before the unchanged production
// worker. The barrier orders the first storage read after a synthetic legacy
// seed. Restarts never seed when state or a revision marker already exists.
// No production API exposes a fixture mode or plaintext fallback.
test('Chromium encrypts and migrates legacy state, survives restart, and blocks execution on persistence or decryption failure',{
  skip:!playwright&&'Set PLAYWRIGHT_MODULE or install Playwright.',timeout:120000
},async t=>{
  const debug=phase=>{if(process.env.GAB_STORAGE_DEBUG)console.error(`[encrypted state] ${phase}`);};
  const work=path.resolve(project,'../../work');await fs.mkdir(work,{recursive:true});
  const scratch=await fs.mkdtemp(path.join(work,'encrypted-state-browser-'));
  const extension=path.join(scratch,'extension'),profile=path.join(scratch,'profile');
  await fs.cp(path.join(project,'extension'),extension,{recursive:true});
  const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));
  const legacy={...initialState(),subscriptions:[],entries:[{handle:'private_fixture',id:target,source:'local',status:'approved',reason:'synthetic private note',evidence:[]}],
    allowlist:['protected_fixture'],allowlistPins:{protected_fixture:['123']},
    settings:{...initialState().settings,accountHandle:'fixture_owner',accountId:owner,autoBlock:true,sessionInvalid:false},
    paused:false,runId:'interrupted-fixture',workerTabId:91,
    queue:[{id:'old-running',handle:'private_fixture',userId:target,accountId:owner,accountHandle:'fixture_owner',status:'running',updatedAt:new Date().toISOString()}],
    logs:[{at:new Date().toISOString(),action:'fixture',handle:'private_fixture',message:'synthetic activity'}],
    apiBudget:{accountId:owner,writes:[Date.now()-1000]},apiCooldown:{kind:'rate_limit',until:Date.now()+600000},
    nativeBlocked:{[`id:${owner}`]:{'id:456':{handle:'previous_fixture'}}}};
  await fs.writeFile(path.join(extension,'fixture-seed.js'),`const originalGet=chrome.storage.local.get.bind(chrome.storage.local);\nconst seeded=(async()=>{const old=await originalGet(['state','gabStateRevision']);if(!Object.hasOwn(old,'state')&&!Object.hasOwn(old,'gabStateRevision'))await chrome.storage.local.set({state:${JSON.stringify(legacy)}});})();\nchrome.storage.local.get=async keys=>{await seeded;return originalGet(keys);};\n`);
  await fs.writeFile(path.join(extension,'fixture-bootstrap.js'),"import './fixture-seed.js';\nimport './background.js';\n");
  await fs.writeFile(path.join(extension,'manifest.json'),JSON.stringify({...manifest,background:{service_worker:'fixture-bootstrap.js',type:'module'}}));
  await fs.writeFile(path.join(extension,'fixture.html'),'<!doctype html><meta charset="utf-8"><title>Encrypted state fixture</title>');
  const contexts=new Set(),requests=[];let context,page,worker,id;
  t.after(async()=>{await Promise.allSettled([...contexts].map(item=>item.close()));});
  async function launch(){
    debug('launch');
    context=await playwright.chromium.launchPersistentContext(profile,{
      channel:'chromium',headless:true,timeout:20000,
      ...(process.env.GAB_CHROMIUM_PATH?{executablePath:process.env.GAB_CHROMIUM_PATH}:{}),
      args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-background-networking','--disable-component-update','--disable-sync','--disable-quic','--host-resolver-rules=MAP * ~NOTFOUND']
    });contexts.add(context);
    await context.route(/https?:\/\//,async route=>{requests.push({method:route.request().method(),origin:new URL(route.request().url()).origin});await route.abort();});
    if(id){
      page=await context.newPage();await page.goto(`chrome-extension://${id}/fixture.html`);
      // A registered MV3 worker may stay dormant after browser restart until a
      // message wakes it. Opening the fixture before waiting avoids a deadlock.
      await page.evaluate(()=>Promise.race([chrome.runtime.sendMessage({type:'GET_STATE'}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Fixture worker did not respond')),15000))]));
      worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
    }else{
      worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
      id=new URL(worker.url()).host;page=await context.newPage();await page.goto(`chrome-extension://${id}/fixture.html`);
    }
    debug('fixture ready');
  }
  async function close(){debug('close');await context.close();contexts.delete(context);debug('closed');}
  const send=(type,payload={})=>page.evaluate(({type,payload})=>chrome.runtime.sendMessage({type,...payload}),{type,payload});
  async function read(){const result=await send('GET_STATE');assert.equal(result.ok,true,result.error);return result.state;}
  async function inspect(){return page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('gab-encrypted-state',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction('vault','readonly');let key,envelope;const vault=tx.objectStore('vault');
      vault.get('key').onsuccess=e=>{key=e.target.result;};vault.get('state').onsuccess=e=>{envelope=e.target.result;};
      tx.oncomplete=()=>resolve({keyPresent:!!key,extractable:key?.extractable,algorithm:key?.algorithm,revision:envelope?.revision,format:envelope?.format,iv:envelope?[...envelope.iv]:[],ciphertext:envelope?[...new Uint8Array(envelope.ciphertext)]:[]});tx.onerror=()=>reject(tx.error);
    });}finally{db.close();}
  });}
  async function replaceState(state){await page.evaluate(async state=>{
    const {createStateStore}=await import('./lib/state-store.js');const {initialState}=await import('./lib/core.js');
    const store=createStateStore({initialState});try{await store.write(state);}finally{store.close();}
  },state);}
  async function damage(kind,pristine){await page.evaluate(async({kind,pristine})=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('gab-encrypted-state',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{await new Promise((resolve,reject)=>{const tx=db.transaction('vault','readwrite'),vault=tx.objectStore('vault');
      const envelope={format:pristine.format,revision:pristine.revision,iv:new Uint8Array(pristine.iv),ciphertext:new Uint8Array(pristine.ciphertext).buffer};
      if(kind==='ciphertext')new Uint8Array(envelope.ciphertext)[0]^=1;
      vault.put(envelope,'state');if(kind==='key')vault.delete('key');
      tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);
    });}finally{db.close();}
  },{kind,pristine});}

  await launch();debug('migration read');let state=await read();debug('migration read complete');
  assert.deepEqual(state.entries,legacy.entries);assert.deepEqual(state.logs,legacy.logs);assert.deepEqual(state.settings,legacy.settings);
  for(const field of ['allowlist','allowlistPins','apiBudget','apiCooldown','nativeBlocked','nextAutoSyncAt'])assert.deepEqual(state[field],legacy[field]);
  assert.equal(state.paused,true);assert.equal(state.runId,null);assert.equal(state.workerTabId,null);assert.equal(state.queue[0].status,'uncertain');
  assert.equal((await page.evaluate(()=>chrome.storage.local.get('state'))).state,undefined);
  assert.deepEqual(Object.keys(await page.evaluate(()=>chrome.storage.local.get(null))),['gabStateRevision']);
  const encrypted=await inspect();assert.equal(encrypted.extractable,false);assert.deepEqual(encrypted.algorithm,{name:'AES-GCM',length:256});assert.equal(encrypted.iv.length,12);
  assert.equal(new TextDecoder().decode(new Uint8Array(encrypted.ciphertext)).includes('synthetic private note'),false);
  assert.equal((await send('IMPORT',{text:'@added_fixture'})).ok,true);state=await read();assert.ok(state.entries.some(entry=>entry.handle==='added_fixture'));
  const persisted=structuredClone(state);await close();
  await launch();debug('restart read');state=await read();assert.deepEqual(state,persisted,'A full browser restart must retain the migrated encrypted state and operation history');
  assert.equal((await page.evaluate(()=>chrome.storage.local.get('state'))).state,undefined);assert.equal((await inspect()).extractable,false);

  // Fail the actual durable queue write before dispatch. Only test-owned runtime
  // instrumentation is used; the installed production files remain unchanged.
  const paused={...state,paused:true,apiCooldown:null,queue:[{id:'write-failure',handle:'private_fixture',userId:target,accountId:owner,accountHandle:'fixture_owner',status:'pending',updatedAt:new Date().toISOString()}]};
  await replaceState(paused);
  debug('simulate failed write');
  await worker.evaluate(()=>{globalThis.fixtureOriginalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='state'){this.transaction.abort();return;}return globalThis.fixtureOriginalPut.call(this,value,key);};});
  const failedWrite=await send('START_QUEUE');assert.equal(failedWrite.ok,false);assert.equal(failedWrite.code,'STATE_STORAGE');assert.equal((await read()).paused,true);assert.deepEqual((await read()).queue,paused.queue);
  await worker.evaluate(()=>{IDBObjectStore.prototype.put=globalThis.fixtureOriginalPut;delete globalThis.fixtureOriginalPut;});
  await replaceState(persisted);const pristine=await inspect();

  for(const kind of ['ciphertext','key']){
    debug(`damage ${kind}`);
    await damage(kind,pristine);await close();await launch();
    for(const type of ['GET_STATE','START_QUEUE','BIND_ACCOUNT','SYNC']){const result=await send(type);assert.equal(result.ok,false);assert.equal(result.code,'STATE_STORAGE');assert.equal(result.state,undefined);}
    const damaged=await inspect();assert.equal(damaged.revision,pristine.revision);if(kind==='key')assert.equal(damaged.keyPresent,false);
    assert.equal((await page.evaluate(()=>chrome.storage.local.get('state'))).state,undefined);
  }
  assert.deepEqual(requests,[],'No X/GitHub request may escape migration, failed persistence, or failed decryption');
  await close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {createStateStore, STATE_OBJECT_STORE, STATE_REVISION_KEY} from '../extension/lib/state-store.js';

const sample = () => ({settings:{accountId:'9007199254740993',autoBlock:false},entries:[{handle:'fixture_private',id:'9007199254740995',reason:'private note sentinel'}],queue:[],logs:[],paused:true});
function fixture(legacy) {
  const indexedDB=new IDBFactory(), dbName='unit-encrypted-state';
  const local=legacy===undefined?{}:{state:structuredClone(legacy)};
  let failSignal=false,failRemove=false;
  const legacyStorage={
    get:async()=>structuredClone(local),
    set:async value=>{assert.equal(Object.hasOwn(value,'state'),false,'Production must never write plaintext state');if(failSignal)throw new Error('Fixture notification unavailable');Object.assign(local,structuredClone(value));},
    remove:async key=>{if(failRemove)throw new Error('Fixture cleanup unavailable');delete local[key];}
  };
  const options={indexedDB,crypto:webcrypto,legacyStorage,dbName,initialState:sample};
  const stores=[];
  const create=()=>{const store=createStateStore(options);stores.push(store);return store;};
  async function raw(change) {
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(dbName,1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STATE_OBJECT_STORE,change?'readwrite':'readonly');const vault=tx.objectStore(STATE_OBJECT_STORE);let key,envelope;
      vault.get('key').onsuccess=event=>{key=event.target.result;};
      vault.get('state').onsuccess=event=>{envelope=event.target.result;if(change)change(vault,envelope);};
      tx.oncomplete=()=>resolve({key,envelope});tx.onerror=tx.onabort=()=>reject(tx.error);
    });}finally{db.close();}
  }
  return {local,create,raw,options,close:()=>stores.forEach(store=>store.close()),set failSignal(value){failSignal=value;},set failRemove(value){failRemove=value;}};
}
const unavailable=error=>error.code==='STATE_STORAGE'&&!/private note|900719925474099/.test(error.message);

test('fresh state is AES-GCM encrypted with a persistent non-extractable key and no plaintext local state',async t=>{
  const f=fixture();t.after(f.close);const store=f.create();assert.deepEqual(await store.read(),sample());
  assert.deepEqual(Object.keys(f.local),[STATE_REVISION_KEY]);assert.equal(f.local[STATE_REVISION_KEY],1);
  const {key,envelope}=await f.raw();assert.equal(key.extractable,false);assert.equal(key.algorithm.name,'AES-GCM');assert.equal(key.algorithm.length,256);
  await assert.rejects(webcrypto.subtle.exportKey('raw',key));assert.equal(envelope.iv.byteLength,12);assert.ok(envelope.ciphertext instanceof ArrayBuffer);
  assert.equal(new TextDecoder().decode(envelope.ciphertext).includes('private note sentinel'),false);
  store.close();assert.deepEqual(await f.create().read(),sample(),'A new instance must recover only from the encrypted record');
});

test('legacy migration preserves all fields before removing plaintext and encrypted data then wins over stale state',async t=>{
  const original={...sample(),allowlist:['keep'],apiCooldown:{until:1234},apiBudget:{writes:[1]},nextAutoSyncAt:4567};
  const f=fixture(original);t.after(f.close);const first=f.create();assert.deepEqual(await first.read(),original);assert.equal('state'in f.local,false);
  f.local.state={...sample(),entries:[]};first.close();assert.deepEqual(await f.create().read(),original);assert.equal('state'in f.local,false);
});

test('each successful write has a new IV and authenticated revision, and queued writes remain ordered',async t=>{
  const f=fixture();t.after(f.close);const store=f.create();await store.read();const first=(await f.raw()).envelope;
  await Promise.all([store.write({...sample(),counter:1}),store.write({...sample(),counter:2})]);
  const last=(await f.raw()).envelope;assert.equal(last.revision,3);assert.notDeepEqual(last.iv,first.iv);assert.equal((await store.read()).counter,2);assert.equal(f.local[STATE_REVISION_KEY],3);
});

test('failed revision notification cannot turn an already committed state into a failed write',async t=>{
  const f=fixture();t.after(f.close);const store=f.create();await store.read();f.failSignal=true;
  await store.write({...sample(),counter:1});assert.equal((await store.read()).counter,1);assert.equal((await f.raw()).envelope.revision,2);assert.equal(f.local[STATE_REVISION_KEY],1);
  f.failSignal=false;await store.write({...sample(),counter:2});assert.equal(f.local[STATE_REVISION_KEY],3);
});

for(const fault of ['cleanup','notification'])test(`interrupted migration ${fault} retains encrypted authority and completes cleanup on retry`,async t=>{
  const original={...sample(),queue:[{id:'durable',status:'uncertain'}]},f=fixture(original);t.after(f.close);
  if(fault==='cleanup')f.failRemove=true;else f.failSignal=true;
  const first=f.create();await assert.rejects(first.read(),unavailable);assert.deepEqual(f.local.state,original);assert.ok((await f.raw()).envelope);
  f.local.state={...sample(),entries:[]};f.failRemove=false;f.failSignal=false;first.close();assert.deepEqual(await f.create().read(),original);assert.equal('state'in f.local,false);
});

test('an aborted first transaction leaves neither a key nor ciphertext and keeps the original state',async t=>{
  const f=fixture(sample());t.after(f.close);const originalPut=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){if(key==='state'){this.transaction.abort();return;}return originalPut.call(this,value,key);};
  try{await assert.rejects(f.create().read(),unavailable);}finally{IDBObjectStore.prototype.put=originalPut;}
  assert.deepEqual(f.local,{state:sample()});assert.deepEqual(await f.raw(),{key:undefined,envelope:undefined});
  assert.deepEqual(await f.create().read(),sample());assert.equal('state'in f.local,false);
});

for(const damage of ['ciphertext','missing-key','missing-state','missing-both','revision','format','invalid-iv'])test(`encrypted ${damage} fails closed and never restores stale plaintext`,async t=>{
  const f=fixture();t.after(f.close);const first=f.create();await first.read();first.close();f.local.state={...sample(),entries:[]};
  await f.raw((store,envelope)=>{
    if(damage==='missing-key'||damage==='missing-both')store.delete('key');
    if(damage==='missing-state'||damage==='missing-both')store.delete('state');
    if(damage==='ciphertext'){new Uint8Array(envelope.ciphertext)[0]^=1;store.put(envelope,'state');}
    if(damage==='revision'){envelope.revision++;store.put(envelope,'state');}
    if(damage==='format'){envelope.format='unexpected';store.put(envelope,'state');}
    if(damage==='invalid-iv'){envelope.iv=new Uint8Array(11);store.put(envelope,'state');}
  });
  const next=f.create();await assert.rejects(next.read(),unavailable);await assert.rejects(next.write(sample()),unavailable);
  assert.deepEqual(f.local.state.entries,[],'Failure must not delete the only remaining legacy evidence');
});

test('read verifies durable ciphertext again instead of trusting an earlier plaintext cache',async t=>{
  const f=fixture();t.after(f.close);const store=f.create();await store.read();
  await f.raw((vault,envelope)=>{new Uint8Array(envelope.ciphertext)[0]^=1;vault.put(envelope,'state');});
  await assert.rejects(store.read(),unavailable);await assert.rejects(store.write(sample()),unavailable);
});

test('a deleted or substituted key is not regenerated to overwrite encrypted state',async t=>{
  const f=fixture();t.after(f.close);const store=f.create();await store.read();
  const wrong=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  await f.raw(vault=>vault.put(wrong,'key'));await assert.rejects(store.read(),unavailable);await assert.rejects(store.write(sample()),unavailable);
});

test('invalid legacy data is never replaced by bundled defaults',async t=>{
  const f=fixture(null);t.after(f.close);await assert.rejects(f.create().read(),unavailable);assert.deepEqual(f.local,{state:null});
  assert.deepEqual(await f.raw(),{key:undefined,envelope:undefined});
});

test('deleting the entire database with a retained revision cannot reset the user to a new installation',async t=>{
  const f=fixture();t.after(f.close);const store=f.create();await store.read();store.close();
  await new Promise((resolve,reject)=>{const request=f.options.indexedDB.deleteDatabase(f.options.dbName);request.onsuccess=resolve;request.onerror=()=>reject(request.error);});
  await assert.rejects(f.create().read(),unavailable);assert.equal(f.local[STATE_REVISION_KEY],1);
  assert.deepEqual(await f.raw(),{key:undefined,envelope:undefined});
});

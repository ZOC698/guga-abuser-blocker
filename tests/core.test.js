import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,normalizeHandle,parseImport,mergeLocal,publicDocument,effectiveEntries,enqueueApproved,reconcileQueue,retryFailed,identityKey,recordBlocked,retainAllowlistIdentities,subscriptionURL,csvExport,MAX_ENTRIES} from '../extension/lib/core.js';

const entry=(handle,extra={})=>({handle,source:'local',status:'approved',reason:'',evidence:[],...extra});
test('TXT handles are normalized and deduplicated, numeric IDs are not handles',()=>{
  const result=parseImport('\uFEFF@Example_A\r\n@example_a\nhttps://x.com/Example_B\n');
  assert.deepEqual(result.entries.map(e=>e.handle),['example_a','example_b']);assert.equal(result.duplicates,1);assert.equal(result.entries[0].status,'pending');
  assert.throws(()=>parseImport('1234567890123456789'),/numeric IDs/);
  assert.equal(parseImport('@123456').entries[0].handle,'123456');
  assert.throws(()=>normalizeHandle('https://x.com/example/status/123'),/profile URL/);
  assert.throws(()=>normalizeHandle('https://evil.invalid/example'),/Only X/);
});
test('JSON preserves exact numeric strings and rejects precision-loss numbers',()=>{
  const parsed=parseImport(JSON.stringify({entries:[{handle:'example',id:'1234567890123456789',status:'approved',reason:'test',evidence:['https://x.com/example/status/1','javascript:alert(1)']}]}));
  assert.equal(parsed.entries[0].id,'1234567890123456789');assert.equal(parsed.entries[0].status,'pending');assert.equal(parsed.entries[0].evidence.length,1);
  assert.throws(()=>parseImport('{"entries":[{"handle":"example","id":1234567890123456789}]}'),/decimal strings/);
  assert.throws(()=>parseImport('{"entries":[{"userId":"1234"}]}'),/ID-to-handle/);
});
test('CSV roundtrip retains quoted reasons and evidence',()=>{
  const original=entry('example',{reason:'A comma, a "quote"\nand a line',evidence:['https://x.com/example/status/1']});
  const result=parseImport(csvExport([original]));assert.equal(result.entries[0].reason,original.reason);assert.deepEqual(result.entries[0].evidence,original.evidence);
  assert.match(csvExport([entry('example',{reason:'=HYPERLINK("https://evil.invalid")'})]),/'=HYPERLINK/);
  assert.throws(()=>parseImport('handle,reason\nexample,"unclosed'),/Unclosed/);
});
test('public export contains only approved local rows and excludes exceptions',()=>{
  const s=initialState();s.entries=[entry('public'),entry('pending',{status:'pending'}),entry('private',{source:'sub'}),entry('except')];s.allowlist=['except'];
  assert.deepEqual(publicDocument(s).entries.map(e=>e.handle),['public']);
  assert.equal(publicDocument(s).schema,'guga-blocklist/v1');
});
test('failed import is atomic and duplicate import does not erase approvals',()=>{
  const s=initialState();s.entries=[entry('existing')];
  assert.throws(()=>mergeLocal(s,parseImport('@new\nwrong handle').entries));assert.equal(s.entries.length,1);
  const result=mergeLocal(s,parseImport('@existing\n@new').entries);assert.equal(result.duplicates,1);assert.equal(result.imported,1);assert.equal(s.entries.find(e=>e.handle==='existing').status,'approved');assert.equal(s.entries.find(e=>e.handle==='new').status,'pending');
});
test('queue respects self, exceptions, subscriptions, prior account outcomes and own object keys',()=>{
  const s=initialState();s.settings.accountHandle='__proto__';s.subscriptions=[{id:'s1',enabled:true}];
  s.entries=[entry('constructor'),entry('__proto__'),entry('ordinary'),entry('except'),entry('inactive',{source:'s2'}),entry('active',{source:'s1'})];s.allowlist=['except'];
  assert.deepEqual(effectiveEntries(s).map(e=>e.handle),['constructor','ordinary','active']);enqueueApproved(s);assert.deepEqual(s.queue.map(j=>j.handle),['constructor','ordinary','active']);
  enqueueApproved(s);assert.equal(s.queue.length,3);s.allowlist.push('ordinary');reconcileQueue(s);assert.equal(s.queue.find(j=>j.handle==='ordinary').status,'skipped');
});
test('queue cap prunes terminal history without evicting active work',()=>{
  const s=initialState();s.settings.accountHandle='owner';s.entries=[entry('new')];
  s.queue=[{id:'running',handle:'busy',accountHandle:'owner',status:'running'},...Array.from({length:MAX_ENTRIES-1},(_,i)=>({id:String(i),handle:`old${i}`,accountHandle:'owner',status:'done'}))];
  enqueueApproved(s);assert.equal(s.queue.length,MAX_ENTRIES);assert.ok(s.queue.some(j=>j.id==='running'));assert.ok(s.queue.some(j=>j.handle==='new'));
});
test('subscription URL confines fetch to public raw GitHub JSON without token or redirects',()=>{
  assert.equal(subscriptionURL('https://raw.githubusercontent.com/owner/repo/main/list.json'),'https://raw.githubusercontent.com/owner/repo/main/list.json');
  for(const url of ['http://raw.githubusercontent.com/a/b/c/d.json','https://raw.githubusercontent.com.evil.invalid/a/b/c/d.json','https://raw.githubusercontent.com/a/b/c/d.json?token=secret','https://user:pass@raw.githubusercontent.com/a/b/c/d.json','https://127.0.0.1/list.json'])assert.throws(()=>subscriptionURL(url));
  assert.throws(()=>parseImport('["@example"]',{strictPublic:true}),/guga-blocklist/);
});

test('duplicate imports enrich one ID, reject conflicting IDs, and collapse verified aliases',()=>{
  const enriched=parseImport(JSON.stringify({entries:[{handle:'target'},{handle:'target',id:'123'}]}));
  assert.equal(enriched.entries.length,1);assert.equal(enriched.entries[0].id,'123');assert.equal(enriched.duplicates,1);
  const renamed=parseImport(JSON.stringify({entries:[{handle:'old_name',id:'123'},{handle:'new_name',id:'123'}]}));
  assert.deepEqual(renamed.entries.map(e=>[e.handle,e.id]),[['new_name','123']]);assert.equal(renamed.duplicates,1);
  // Earlier alias collapsing must not hide a conflicting later row.
  assert.throws(()=>parseImport(JSON.stringify({entries:[{handle:'old_name',id:'123'},{handle:'new_name',id:'123'},{handle:'old_name',id:'456'}]})),/Conflicting numeric IDs/);
});

test('local ID enrichment preserves reviews and metadata; conflicting replacement is atomic',()=>{
  const s=initialState();s.entries=[entry('reviewed',{reason:'Reviewed reason',evidence:['https://example.com/evidence']}),entry('pending',{status:'pending'})];
  const result=mergeLocal(s,parseImport(JSON.stringify({entries:[{handle:'reviewed',id:'123',reason:'Unreviewed replacement',status:'approved'},{handle:'pending',id:'456',status:'approved'}]})).entries);
  assert.deepEqual(result,{imported:0,duplicates:2,updated:2});
  assert.deepEqual(s.entries.map(e=>[e.handle,e.id,e.status]),[['reviewed','123','approved'],['pending','456','pending']]);
  assert.equal(s.entries[0].reason,'Reviewed reason');assert.deepEqual(s.entries[0].evidence,['https://example.com/evidence']);
  const before=structuredClone(s);
  assert.throws(()=>mergeLocal(s,parseImport(JSON.stringify({entries:[{handle:'another',id:'789'},{handle:'reviewed',id:'999'}]})).entries),/Edit its identity and review/);
  assert.deepEqual(s,before);
});

test('a renamed numeric identity updates a local alias without creating or granting approval',()=>{
  for(const status of ['approved','pending']) {
    const s=initialState();s.entries=[entry('old_name',{id:'123',status,reason:'Keep this'})];
    const result=mergeLocal(s,parseImport(JSON.stringify({entries:[{handle:'new_name',id:'123'}]})).entries);
    assert.deepEqual(result,{imported:0,duplicates:1,updated:1});
    assert.equal(s.entries.length,1);assert.equal(s.entries[0].handle,'new_name');assert.equal(s.entries[0].status,status);assert.equal(s.entries[0].reason,'Keep this');
  }
});

test('effective identities keep numeric pins, reject active ID conflicts and honor alias exceptions',()=>{
  const s=initialState();s.settings.accountHandle='owner';s.subscriptions=[{id:'s1',enabled:true},{id:'s2',enabled:false}];
  s.entries=[entry('target',{id:'123'}),entry('target',{source:'s1'}),entry('target',{source:'s2',id:'999'})];
  assert.equal(effectiveEntries(s)[0].id,'123');
  s.entries.push(entry('target',{source:'s1',id:'456'}));
  assert.throws(()=>effectiveEntries(s),/Conflicting numeric IDs/);
  assert.throws(()=>enqueueApproved(s),/Conflicting numeric IDs/);assert.equal(s.queue.length,0);
  s.entries=[entry('old_name',{id:'123'}),entry('new_name',{id:'123',source:'s1'})];
  assert.equal(effectiveEntries(s).length,1);s.allowlist=['old_name'];assert.equal(effectiveEntries(s).length,0);
});

test('confirmed ID history follows a rename but never suppresses a reassigned handle',()=>{
  const s=initialState();s.settings.accountHandle='owner';s.entries=[entry('old_name',{id:'123'})];enqueueApproved(s);
  const completed=s.queue[0];completed.status='done';recordBlocked(s,completed,'123');
  s.entries=[entry('new_name',{id:'123'})];enqueueApproved(s);assert.equal(s.queue.length,1);
  s.entries=[entry('old_name',{id:'456'})];enqueueApproved(s);
  assert.equal(s.queue.length,2);assert.equal(s.queue.at(-1).userId,'456');assert.equal(s.queue.at(-1).status,'pending');
  // The ID-keyed history continues working after old queue history is pruned.
  s.queue=[];s.entries=[entry('new_name',{id:'123'})];enqueueApproved(s);assert.equal(s.queue.length,0);
});

test('legacy handle-only history cannot suppress a newly pinned numeric target',()=>{
  const s=initialState();s.settings.accountHandle='owner';s.nativeBlocked.owner={target:'2026-01-01T00:00:00Z'};
  s.queue=[{id:'legacy-job',handle:'target',accountHandle:'owner',status:'done'}];
  s.entries=[entry('target')];enqueueApproved(s);assert.equal(s.queue.length,1);
  s.entries=[entry('target',{id:'123'})];enqueueApproved(s);assert.equal(s.queue.length,2);assert.equal(s.queue.at(-1).userId,'123');
});

test('pending and failed identities refresh, but running jobs never silently change identity',()=>{
  for(const status of ['pending','failed','uncertain']) {
    const s=initialState();s.settings.accountHandle='owner';s.entries=[entry('target',{id:'123'})];enqueueApproved(s);s.queue[0].status=status;
    s.entries=[entry('target',{id:'456'})];reconcileQueue(s);
    assert.equal(s.queue[0].userId,'456');assert.equal(s.queue[0].status,status);
    if(status!=='pending'){assert.equal(retryFailed(s).retried,1);assert.equal(s.queue[0].status,'pending');}
  }
  const s=initialState();s.settings.accountHandle='owner';s.entries=[entry('old_name',{id:'123'})];enqueueApproved(s);s.queue[0].status='running';
  const running=structuredClone(s.queue[0]);s.entries=[entry('new_name',{id:'123'})];enqueueApproved(s);
  assert.deepEqual(s.queue,[running]);
  s.entries=[entry('old_name',{id:'456'})];reconcileQueue(s);assert.deepEqual(s.queue[0],running);
});

test('queue alias dedupe preserves uncertain work and never weakens an existing numeric pin',()=>{
  const s=initialState();s.settings.accountHandle='owner';s.entries=[entry('new_name',{id:'123'})];
  s.queue=[{id:'pending-copy',handle:'new_name',userId:'123',accountHandle:'owner',status:'pending'}, {id:'uncertain-original',handle:'old_name',userId:'123',accountHandle:'owner',status:'uncertain'}];
  reconcileQueue(s);assert.equal(s.queue[0].status,'skipped');assert.equal(s.queue[1].status,'uncertain');assert.equal(s.queue[1].handle,'new_name');
  retryFailed(s);assert.equal(s.queue[1].status,'pending');enqueueApproved(s);assert.equal(s.queue.filter(j=>j.status==='pending').length,1);
  s.entries=[entry('new_name')];reconcileQueue(s);assert.equal(s.queue[1].userId,'123');enqueueApproved(s);assert.equal(s.queue.filter(j=>j.status==='pending').length,1);
});

test('successful history validates response identity and accepts adversarial object-key handles safely',()=>{
  const s=initialState(),job={handle:'constructor',accountHandle:'__proto__',userId:'123'};
  assert.equal(identityKey({handle:'TARGET'}),'handle:target');assert.equal(identityKey({handle:'target',id:'123'}),'id:123');
  assert.throws(()=>identityKey({handle:'target',id:123}),/decimal strings/);
  assert.throws(()=>recordBlocked(s,job,'456'),/differs/);assert.equal(Object.hasOwn(s.nativeBlocked,'__proto__'),false);
  assert.equal(recordBlocked(s,job,'123'),'id:123');assert.equal(Object.hasOwn(s.nativeBlocked,'__proto__'),true);assert.equal(s.nativeBlocked.__proto__['id:123'].handle,'constructor');
  assert.equal(Object.getPrototypeOf(s.nativeBlocked),Object.prototype);
});

test('local rename preserves an exception by ID until the user removes that exception',()=>{
  const s=initialState();s.settings.accountHandle='owner';s.entries=[entry('old_name',{id:'123'})];enqueueApproved(s);
  s.allowlist=['old_name'];
  recordBlocked(s,{handle:'unrelated',accountHandle:'owner',userId:'789'},'789');const history=structuredClone(s.nativeBlocked);
  mergeLocal(s,parseImport(JSON.stringify({entries:[{handle:'new_name',id:'123'}]})).entries);
  assert.deepEqual(s.entries.map(e=>e.handle),['new_name']);assert.deepEqual(s.allowlistPins,{old_name:['123']});
  assert.equal(effectiveEntries(s).length,0);reconcileQueue(s);assert.equal(s.queue[0].status,'skipped');
  s.allowlist=[];retainAllowlistIdentities(s);
  assert.deepEqual(s.allowlistPins,{});assert.deepEqual(effectiveEntries(s).map(e=>e.handle),['new_name']);
  enqueueApproved(s);assert.equal(s.queue.at(-1).status,'pending');assert.equal(s.queue.at(-1).userId,'123');
  assert.deepEqual(s.nativeBlocked,history); // Removing an exception never erases or reverses a recorded X block.
});

test('subscription replacement retains exception identities even after the old alias disappears',()=>{
  const s=initialState();s.subscriptions=[{id:'sub',enabled:true}];s.entries=[entry('old_name',{id:'123',source:'sub'})];s.allowlist=['old_name'];
  const next=[entry('new_name',{id:'123',source:'sub'}),entry('old_name',{id:'456',source:'sub'})];
  retainAllowlistIdentities(s,next);s.entries=next;
  assert.deepEqual(s.allowlistPins,{old_name:['123','456']});assert.equal(effectiveEntries(s).length,0);
  const later=[entry('renamed_again',{id:'123',source:'sub'}),entry('second_alias',{id:'456',source:'sub'})];
  retainAllowlistIdentities(s,later);s.entries=later;
  assert.equal(effectiveEntries(s).length,0);
  // Only currently selected exceptions activate pins, even before a cleanup save.
  s.allowlist=[];assert.equal(effectiveEntries(s).length,2);retainAllowlistIdentities(s);assert.deepEqual(s.allowlistPins,{});
});

test('exception pins use known inactive identities and safe own properties for special handles',()=>{
  const s=initialState();s.allowlist=['__proto__','constructor'];s.entries=[entry('__proto__',{id:'123',status:'pending'}),entry('constructor',{id:'456',source:'disabled'}),entry('alias_a',{id:'123'}),entry('alias_b',{id:'456'})];
  retainAllowlistIdentities(s);
  assert.equal(Object.getPrototypeOf(s.allowlistPins),Object.prototype);assert.equal(Object.hasOwn(s.allowlistPins,'__proto__'),true);
  assert.deepEqual(s.allowlistPins.__proto__,['123']);assert.deepEqual(s.allowlistPins.constructor,['456']);assert.equal(effectiveEntries(s).length,0);
  s.entries=[entry('alias_a',{id:'123'})];s.allowlistPins=Object.create({__proto__:['123'],constructor:['123']});
  assert.equal(effectiveEntries(s).length,1);retainAllowlistIdentities(s);assert.deepEqual(s.allowlistPins,{});
});

test('failed local identity merge leaves exception pins and entries atomic',()=>{
  const s=initialState();s.subscriptions=[{id:'sub',enabled:true}];s.entries=[entry('old_name',{id:'123'}),entry('target'),entry('target',{id:'456',source:'sub'})];s.allowlist=['old_name'];
  const before=structuredClone(s);
  assert.throws(()=>mergeLocal(s,[{handle:'new_name',id:'123'},{handle:'target',id:'789'}]),/Conflicting numeric IDs/);assert.deepEqual(s,before);
  const full=initialState();full.allowlist=['old_name'];full.entries=[entry('old_name',{id:'123'}),...Array.from({length:MAX_ENTRIES-1},(_,i)=>entry(`other${i}`,{source:'disabled'}))];const oldEntries=full.entries;
  assert.throws(()=>mergeLocal(full,[{handle:'new_name',id:'123'},{handle:'additional',id:'456'}]),/entry limit/);
  assert.equal(full.entries,oldEntries);assert.deepEqual(full.allowlistPins,{});assert.equal(full.entries[0].handle,'old_name');
});

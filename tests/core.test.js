import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,normalizeHandle,parseImport,mergeLocal,publicDocument,effectiveEntries,enqueueApproved,reconcileQueue,subscriptionURL,csvExport,MAX_ENTRIES} from '../extension/lib/core.js';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPublicList, buildFile } from '../scripts/build-list.mjs';
import { validatePublicList, validateFile, validateTimestamp } from '../scripts/validate-list.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const timestamp = '2026-11-12T00:00:00.000Z';
const document = entries => ({ schema: 'guga-blocklist/v1', name: 'Guga community blocklist', updatedAt: timestamp, entries });
const approved = (handle, extra = {}) => ({ handle, status: 'approved', reason: 'Maintainer-reviewed test fixture', evidence: [`https://x.com/${handle}/status/1`], ...extra });

test('empty public list and minimal statusless handles are valid without reason or evidence', () => {
  assert.deepEqual(validatePublicList(document([])), { entries: 0, withNumericId: 0, withoutNumericId: 0 });
  const { document: built } = buildPublicList({entries:[{handle:'sample_user'}]}, { updatedAt: timestamp });
  assert.deepEqual(built.entries,[{handle:'sample_user'}]);
  assert.equal(validatePublicList(built).withoutNumericId, 1);
});

test('explicit minimal maintainer input publishes 523 exact string identities without invented context',()=>{
  const entries=Array.from({length:523},(_,index)=>({handle:`fixture_${index}`,id:(9007199254740993n+BigInt(index)).toString(),source:'old-source',privateNote:'PRIVATE_ONLY'}));
  const built=buildPublicList({entries,secret:'PRIVATE_ONLY'},{updatedAt:timestamp});
  assert.equal(built.counts.selected,523);assert.equal(built.counts.published,523);
  assert.deepEqual(validatePublicList(built.document),{entries:523,withNumericId:523,withoutNumericId:0});
  const original=new Map(entries.map(row=>[row.handle,row.id]));
  for(const row of built.document.entries){assert.deepEqual(Object.keys(row),['handle','id']);assert.equal(row.id,original.get(row.handle));assert.equal(typeof row.id,'string');}
  assert.equal(JSON.stringify(built.document).includes('PRIVATE_ONLY'),false);
});

test('build excludes private statuses and metadata, sorts deterministically and respects allowlist', () => {
  const review = {
    ...document([
      { handle: 'pending_person', status: 'pending', reason: '', evidence: [], privateNote: 'not reviewed' },
      approved('@Zulu', { evidence: ['https://x.com/Zulu/status/1'], original_order: 2, profileUrl: 'https://x.com/Zulu', category: 'unknown', source: 'local' }),
      { handle: 'excluded_person', status: 'excluded', reason: '', evidence: [] },
      approved('alpha', { id: '1234567890123456789', privateNote: 'private' }),
      approved('allowed_person')
    ]),
    visibility: 'private',
    allowlist: ['@allowed_person'],
    secret: 'PRIVATE_MARKER'
  };
  const first = buildPublicList(review, { updatedAt: timestamp });
  const second = buildPublicList(review, { updatedAt: timestamp });
  assert.deepEqual(first, second);
  assert.deepEqual(first.document.entries.map(row => row.handle), ['alpha', 'zulu']);
  assert.deepEqual(first.counts, { selected: 0, pending: 1, approved: 3, excluded: 1, allowlisted: 1, published: 2 });
  assert.equal(first.document.entries[0].id, '1234567890123456789');
  const serialized = JSON.stringify(first.document);
  for (const forbidden of ['PRIVATE_MARKER', 'privateNote', 'original_order', 'source', 'status', 'category']) assert.equal(serialized.includes(`"${forbidden}"`), false);
});

test('blank optional context is omitted and supplied context still requires valid types and HTTPS syntax', () => {
  for(const extra of [{},{reason:''},{reason:'   ',evidence:[]},{evidence:[]}]){
    const built=buildPublicList({entries:[{handle:'sample_user',id:'9007199254740993',...extra}]},{updatedAt:timestamp});
    assert.deepEqual(built.document.entries,[{handle:'sample_user',id:'9007199254740993'}]);
  }
  const withContext=buildPublicList({entries:[{handle:'sample_user',reason:'  Optional owner note  ',evidence:['https://x.com/sample_user/status/1']}]},{updatedAt:timestamp});
  assert.equal(withContext.document.entries[0].reason,'Optional owner note');
  const badRows = [
    approved('sample_user', { reason: null }),
    approved('sample_user', { reason: 1 }),
    approved('sample_user', { reason: 'x'.repeat(1001) }),
    approved('sample_user', { evidence: null }),
    approved('sample_user', { evidence: 'https://x.com/sample_user' }),
    approved('sample_user', { evidence: ['javascript:alert(1)'] }),
    approved('sample_user', { evidence: ['http://x.com/sample_user/status/1'] }),
    approved('sample_user', { evidence: ['https://user:secret@x.com/sample_user/status/1'] }),
    approved('sample_user', { evidence: ['https://x.com/a b'] }),
    approved('sample_user', { evidence: ['https://x.com/a', 'https://x.com/a'] })
  ];
  for (const row of badRows) assert.throws(() => buildPublicList(document([row]), { updatedAt: timestamp }));
});

test('public validator rejects private fields, duplicates, precision-loss IDs and wrong calendar dates', () => {
  const publicRow = { handle: 'sample_user' };
  assert.throws(() => validatePublicList({ ...document([]), visibility: 'private' }), /unsupported field/);
  assert.throws(() => validatePublicList(document([{ ...publicRow, status: 'pending' }])), /unsupported field/);
  assert.throws(() => validatePublicList(document([{ ...publicRow, handle: 'Sample_User' }])), /lowercase/);
  assert.throws(() => validatePublicList(document([publicRow, publicRow])), /duplicate handle/);
  assert.throws(() => validatePublicList(document([{ ...publicRow, id: 1234567890123456789 }])), /decimal string/);
  assert.throws(() => validatePublicList(document([{ ...publicRow, id: '123' }, { ...publicRow, handle: 'other_user', id: '123' }])), /duplicate numeric ID/);
  for(const extra of [{reason:''},{reason:null},{reason:' untrimmed '},{evidence:[]},{evidence:null},{evidence:['http://x.com/sample_user'] }])assert.throws(()=>validatePublicList(document([{...publicRow,...extra}])));
  assert.throws(() => validateTimestamp('2026-02-31T00:00:00.000Z'), /calendar/);
  assert.throws(() => validateTimestamp('2026-11-12'), /UTC ISO/);
});

test('maintainer input catches duplicate handles, unknown statuses and incorrect supplied schema', () => {
  assert.throws(() => buildPublicList(document([approved('sample_user'), { handle: '@Sample_User', status: 'pending' }]), { updatedAt: timestamp }), /duplicate handle/);
  assert.throws(() => buildPublicList(document([{ handle: 'sample_user', status: 'aproved' }]), { updatedAt: timestamp }), /status must be/);
  assert.throws(()=>buildPublicList({schema:'wrong',entries:[{handle:'sample_user'}]},{updatedAt:timestamp}),/schema must be/);
  assert.throws(()=>buildPublicList({entries:[{handle:'sample_user',status:null}]},{updatedAt:timestamp}),/status must be/);
});

test('published JSON schema requires only a handle and keeps optional context constrained',async()=>{
  const schema=JSON.parse(await fs.readFile(path.join(project,'schemas/guga-blocklist.schema.json'),'utf8'));
  const row=schema.properties.entries.items;
  assert.deepEqual(row.required,['handle']);assert.equal(row.additionalProperties,false);
  assert.equal(row.properties.id.type,'string');assert.equal(row.properties.reason.maxLength,1000);
  assert.equal(row.properties.evidence.maxItems,10);assert.equal(row.properties.evidence.items.format,'uri');
});

test('failed build preserves existing public output and cannot overwrite private input', async () => {
  const testRoot = path.join(project, 'test-results');
  await fs.mkdir(testRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(testRoot, 'gab-list-test-'));
  try {
    const input = path.join(directory, 'private.json');
    const output = path.join(directory, 'public.json');
    const original = JSON.stringify(document([]), null, 2) + '\n';
    await fs.writeFile(output, original);
    await fs.writeFile(input, JSON.stringify(document([approved('sample_user', { evidence: ['http://x.com/sample_user'] })])));
    await assert.rejects(buildFile(input, output, { updatedAt: timestamp }), /evidence/);
    assert.equal(await fs.readFile(output, 'utf8'), original);
    assert.deepEqual((await fs.readdir(directory)).sort(), ['private.json', 'public.json']);
    await assert.rejects(buildFile(input, input, { updatedAt: timestamp }), /cannot replace/);
    await fs.writeFile(input, JSON.stringify({entries:[{handle:'sample_user',id:'9007199254740993'}]}));
    const result = await buildFile(input, output, { updatedAt: timestamp });
    assert.equal(result.published, 1);
    assert.equal((await validateFile(output)).entries, 1);
    const cli = execFileSync(process.execPath, [path.join(project, 'scripts/validate-list.mjs'), output], { encoding: 'utf8' });
    assert.equal(JSON.parse(cli).ok, true);
    const builder=path.join(project,'scripts/build-list.mjs');
    for(const flag of ['--input','--review']){
      const result=JSON.parse(execFileSync(process.execPath,[builder,flag,input,'--output',output,'--updated-at',timestamp],{encoding:'utf8'}));
      assert.equal(result.published,1);assert.equal(result.selected,1);
      assert.deepEqual(JSON.parse(await fs.readFile(output,'utf8')).entries,[{handle:'sample_user',id:'9007199254740993'}]);
    }
    assert.throws(()=>execFileSync(process.execPath,[builder,'--input',input,'--review',input,'--output',output],{encoding:'utf8',stdio:'pipe'}));
    assert.deepEqual((await fs.readdir(directory)).sort(), ['private.json', 'public.json']);
  } finally {
    const target = path.resolve(directory);
    const tempRoot = path.resolve(testRoot) + path.sep;
    assert.ok(target.startsWith(tempRoot) && path.basename(target).startsWith('gab-list-test-'));
    await fs.rm(target, { recursive: true, force: true });
  }
});

test('repository subscription is valid and explicit legacy pending source data stays excluded', async () => {
  const result = await validateFile(path.join(project, 'lists/guga-blocklist.json'));
  assert.ok(Number.isInteger(result.entries) && result.entries >= 0);
  const review = document(Array.from({ length: 523 }, (_, index) => ({ handle: `fixture_${index}`, status: 'pending', reason: '', evidence: [] })));
  const built = buildPublicList(review, { updatedAt: timestamp });
  assert.equal(built.counts.pending, 523);
  assert.equal(built.document.entries.length, 0);
});

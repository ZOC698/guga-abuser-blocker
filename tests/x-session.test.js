import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createXSessionProvider, XSessionError} from '../extension/lib/x-session.js';

const ACCOUNT = '9007199254740993';
const OTHER = '9007199254740995';
const CSRF = 'ab'.repeat(80);
const TIMESTAMP = 1800000000000;
const cookie = (name, value = name === 'twid' ? `u%3D${ACCOUNT}` : CSRF) => ({
  name, value, domain: '.x.com', path: '/', secure: true, httpOnly: false,
  storeId: '0', session: false, expirationDate: TIMESTAMP / 1000 + 3600
});

function fixture({get, contains, ...config} = {}) {
  const reads = [], permissionReads = [];
  const provider = createXSessionProvider({
    cookies: {get: async details => {
      reads.push(structuredClone(details));
      return get ? get(details.name, reads.length) : cookie(details.name);
    }},
    permissions: {contains: async details => {
      permissionReads.push(structuredClone(details));
      return contains ? contains(details) : true;
    }},
    now: () => TIMESTAMP, ...config
  });
  return {provider, reads, permissionReads};
}

async function expectError(promise, kind = 'auth') {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof XSessionError);
    assert.equal(error.kind, kind);
    assert.equal(error.uncertain, false);
    const serialized = JSON.stringify(error);
    for (const value of [CSRF, `u%3D${ACCOUNT}`, 'personal-secret-test']) assert.equal(serialized.includes(value), false);
    assert.equal('cause' in error, false);
    return true;
  });
}

test('session provider reads only twid/ct0 in the fetch context and returns exact string identity', async () => {
  const f = fixture();
  const session = await f.provider.getSession();
  assert.equal(session.accountId, ACCOUNT);
  assert.equal(session.csrfToken, CSRF);
  assert.match(session.authorization, /^Bearer [\x21-\x7e]+$/);
  assert.deepEqual(Object.keys(session).sort(), ['accountId', 'authorization', 'csrfToken']);
  assert.deepEqual(f.reads.map(read => read.name), ['twid', 'ct0', 'twid', 'ct0']);
  assert.ok(f.reads.every(read => read.url === 'https://x.com/i/api/1.1/' && Object.keys(read).length === 2));
  assert.deepEqual(f.permissionReads, [{permissions: ['cookies'], origins: ['https://x.com/*']}]);
});

test('twid accepts one URI decoding pass and never coerces account IDs to numbers', async () => {
  for (const value of [`u=${ACCOUNT}`, `u%3d${ACCOUNT}`, `u%3D${ACCOUNT}`, 'u=1234567890123456789012345']) {
    const f = fixture({get: name => cookie(name, name === 'twid' ? value : CSRF)});
    assert.equal((await f.provider.getSession()).accountId, decodeURIComponent(value).slice(2));
  }
  for (const value of ['', undefined, 123, 'u=0', 'u=01', `user=${ACCOUNT}`, `u=${ACCOUNT} extra`,
    `"u=${ACCOUNT}"`, ` u=${ACCOUNT}`, `u=${ACCOUNT}\n`, 'u=%ZZ', `u%253D${ACCOUNT}`, `u=${'1'.repeat(26)}`]) {
    const f = fixture({get: name => ({...cookie(name), value: name === 'twid' ? value : CSRF})});
    await expectError(f.provider.getSession());
    assert.equal(f.reads.length, 1);
  }
});

test('ct0 must be a bounded even-length hexadecimal string with no header control characters', async () => {
  for (const value of ['a'.repeat(32), 'B'.repeat(160), 'a'.repeat(256)]) {
    const f = fixture({get: name => cookie(name, name === 'ct0' ? value : `u=${ACCOUNT}`)});
    assert.equal((await f.provider.getSession()).csrfToken, value);
  }
  for (const value of ['', 'f'.repeat(30), 'f'.repeat(33), 'f'.repeat(258), 'g'.repeat(32), `${CSRF}\r\nCookie: x`, 123, null]) {
    const f = fixture({get: name => ({...cookie(name), ...(name === 'ct0' ? {value} : {})})});
    await expectError(f.provider.getSession());
  }
});

test('missing cookie permissions fail closed before reading cookies', async () => {
  for (const contains of [async () => false, async () => { throw new Error('personal-secret-test'); }]) {
    const f = fixture({contains});
    await expectError(f.provider.getSession(), 'permission');
    assert.equal(f.reads.length, 0);
  }
  await expectError(createXSessionProvider({cookies: null, permissions: null}).getSession(), 'permission');
  await expectError(createXSessionProvider({cookies: {get: async () => cookie('twid')}, permissions: null}).getSession(), 'permission');
});

test('null, malformed, expired, foreign, insecure and partitioned cookies are rejected', async () => {
  const invalid = [null, undefined, {}, {...cookie('twid'), name: 'auth_token'},
    {...cookie('twid'), domain: 'twitter.com'}, {...cookie('twid'), domain: 'evil.x.com'},
    {...cookie('twid'), secure: false}, {...cookie('twid'), path: '/another-path'},
    {...cookie('twid'), storeId: ''}, {...cookie('twid'), partitionKey: {topLevelSite: 'https://x.com'}},
    {...cookie('twid'), expirationDate: TIMESTAMP / 1000}, {...cookie('twid'), expirationDate: NaN}];
  for (const value of invalid) await expectError(fixture({get: () => value}).provider.getSession());
  await expectError(fixture({get: () => { throw new Error('personal-secret-test'); }}).provider.getSession(), 'permission');
});

test('session cookies and host-only x.com cookies are supported', async () => {
  const f = fixture({get: name => {
    const value = cookie(name);
    value.domain = 'x.com'; value.session = true; delete value.expirationDate;
    return value;
  }});
  assert.equal(await f.provider.readAccountId(), ACCOUNT);
});

test('a configured execution-account pin rejects another signed-in account', async () => {
  const f = fixture({expectedAccountId: OTHER});
  await expectError(f.provider.getSession(), 'account_changed');
  assert.equal(f.reads.length, 1);
});

test('account changes and logout during cookie reads are rejected', async () => {
  await expectError(fixture({get: (name, call) => cookie(name, name === 'twid' ? `u=${call > 2 ? OTHER : ACCOUNT}` : CSRF)}).provider.getSession(), 'account_changed');
  await expectError(fixture({get: (name, call) => call === 3 ? null : cookie(name)}).provider.getSession());
});

test('CSRF rotation and mismatched cookie stores cannot produce a mixed session', async () => {
  await expectError(fixture({get: (name, call) => cookie(name, name === 'ct0' ? (call === 4 ? 'cd'.repeat(80) : CSRF) : `u=${ACCOUNT}`)}).provider.getSession(), 'session_changed');
  await expectError(fixture({get: (name, call) => ({...cookie(name), storeId: call === 2 ? '1' : '0'})}).provider.getSession(), 'session_changed');
});

test('each session read is fresh; no previous identity or credential is cached', async () => {
  let account = ACCOUNT;
  const f = fixture({get: name => cookie(name, name === 'twid' ? `u=${account}` : CSRF)});
  const first = await f.provider.getSession(); first.csrfToken = 'caller-modified';
  account = OTHER;
  assert.equal(await f.provider.readAccountId(), OTHER);
  assert.equal((await f.provider.getSession()).csrfToken, CSRF);
  assert.equal(f.reads.length, 12);
});

test('a hanging cookie read times out and cannot continue reading credentials afterward', async () => {
  let release;
  const f = fixture({timeoutMs: 10, get: () => new Promise(resolve => { release = resolve; })});
  await expectError(f.provider.getSession(), 'timeout');
  release(cookie('twid'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.reads.length, 1);
});

test('a hanging permission check times out before any cookie access', async () => {
  let release;
  const f = fixture({timeoutMs: 10, contains: () => new Promise(resolve => { release = resolve; })});
  await expectError(f.provider.getSession(), 'timeout');
  release(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.reads.length, 0);
});

test('invalid provider configuration is rejected without touching cookies', () => {
  for (const config of [{expectedAccountId: 12}, {expectedAccountId: '0'}, {timeoutMs: 0}, {timeoutMs: 30001}, {now: 123}]) {
    assert.throws(() => createXSessionProvider(config), error => error instanceof XSessionError && error.kind === 'validation');
  }
});

test('provider has no auth-token read, cookie mutation, logging, persistence or network calls', async () => {
  const source = await readFile(new URL('../extension/lib/x-session.js', import.meta.url), 'utf8');
  assert.equal(/cookies\.(?:getAll|set|remove)\s*\(/.test(source), false);
  assert.equal(/read\(['"]auth_token['"]\)/.test(source), false);
  assert.equal(/\b(?:fetch|console\.(?:log|warn|error)|localStorage|sessionStorage)\s*\(/.test(source), false);
  assert.equal(/chrome\.storage/.test(source), false);
});
